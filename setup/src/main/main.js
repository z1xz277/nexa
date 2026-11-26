const path = require('node:path');
const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const { InstallEngine, isCancelled } = require('./install-engine');
const logger = require('./logger');
const windows = require('./platform/windows');
const { PRODUCT } = require('./product');

const gotLock = app.requestSingleInstanceLock();
const args = process.argv.slice(1);
const uninstallMode = args.includes('--uninstall');
const silentMode = args.some((arg) => arg.toLowerCase() === '/s' || arg === '--silent');
const devMode = args.includes('--dev');
const directoryIndex = args.findIndex((arg) => /^\/d=/i.test(arg));
const directoryArg = directoryIndex >= 0 ? args.slice(directoryIndex).join(' ') : null;

app.setAppUserModelId(PRODUCT.setupAppUserModelId);

if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

let mainWindow = null;
let engine = null;
let activeOperation = null;
let allowClose = false;
let uninstallReady = false;
let uninstallResult = null;
let exitCode = 0;
let operationCompleted = false;

function errorMessage(error) {
  return error?.message || 'The operation could not be completed.';
}

function send(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, data);
}

function scheduleExit(code) {
  exitCode = code;
  app.exitCode = code;
  allowClose = true;
  setTimeout(() => app.exit(code), 50);
}

function createWindow() {
  const iconPath = path.join(app.getAppPath(), 'assets', 'icon.ico');
  mainWindow = new BrowserWindow({
    width: 880,
    height: 540,
    minWidth: 880,
    minHeight: 540,
    maxWidth: 880,
    maxHeight: 540,
    frame: false,
    resizable: false,
    fullscreenable: false,
    maximizable: false,
    minimizable: true,
    closable: true,
    roundedCorners: false,
    show: false,
    backgroundColor: '#FFF',
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());

  mainWindow.on('close', (event) => {
    if (allowClose) return;
    if (activeOperation) {
      event.preventDefault();
      send('setup:close-request', { kind: activeOperation.kind });
      return;
    }
    if (uninstallReady) {
      event.preventDefault();
      finalizeUninstall();
      return;
    }
    const code = !operationCompleted && exitCode === 0 ? 2 : exitCode;
    if (code === 0) return;
    event.preventDefault();
    scheduleExit(code);
  });
}

function finalizeUninstall() {
  if (uninstallReady && !allowClose) {
    if (engine.isPackaged && uninstallResult?.installDir) windows.scheduleSelfDelete(uninstallResult.installDir);
    allowClose = true;
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
    else app.quit();
  }
}

function registerIpc() {
  ipcMain.handle('setup:config', async () => {
    if (uninstallMode) {
      return { mode: 'uninstall', ...await engine.getUninstallInfo() };
    }
    return { mode: 'install', ...await engine.getConfig() };
  });

  ipcMain.handle('setup:choose-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose install folder',
      defaultPath: windows.getDefaultInstallDir(),
      properties: ['openDirectory', 'createDirectory', 'promptToCreate']
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('setup:validate-path', (event, folder) => engine.validatePath(folder));
  ipcMain.handle('setup:check-running', () => engine.checkInstalledRunning());
  ipcMain.handle('setup:close-installed-app', async () => {
    try {
      await engine.closeInstalledApp();
      return { ok: true };
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }
  });

  ipcMain.handle('setup:start-install', async (event, input) => {
    if (activeOperation) return { ok: false, error: 'Another operation is already in progress.' };
    const controller = new AbortController();
    const promise = engine.install({
      installDir: input.installDir,
      options: {
        desktop: Boolean(input.desktop),
        startMenu: Boolean(input.startMenu),
        launch: Boolean(input.launch)
      },
      signal: controller.signal,
      onProgress(data) {
        send('setup:progress', { kind: 'install', data });
      }
    });
    activeOperation = { kind: 'install', controller, promise };
    try {
      const result = await promise;
      exitCode = 0;
      operationCompleted = true;
      send('setup:operation-complete', { kind: 'install', ok: true, result });
      return { ok: true, result };
    } catch (error) {
      exitCode = 1;
      logger.error(errorMessage(error));
      return { ok: false, error: errorMessage(error), cancelled: isCancelled(error) };
    } finally {
      activeOperation = null;
    }
  });

  ipcMain.handle('setup:start-uninstall', async (event, input) => {
    if (activeOperation) return { ok: false, error: 'Another operation is already in progress.' };
    const controller = new AbortController();
    const promise = engine.uninstall({
      removeData: Boolean(input.removeData),
      signal: controller.signal,
      onProgress(data) {
        send('setup:progress', { kind: 'uninstall', data });
      }
    });
    activeOperation = { kind: 'uninstall', controller, promise };
    try {
      const result = await promise;
      exitCode = 0;
      operationCompleted = true;
      uninstallReady = true;
      uninstallResult = result;
      send('setup:operation-complete', { kind: 'uninstall', ok: true, result });
      return { ok: true, result };
    } catch (error) {
      exitCode = 1;
      logger.error(errorMessage(error));
      return { ok: false, error: errorMessage(error), cancelled: isCancelled(error) };
    } finally {
      activeOperation = null;
    }
  });

  ipcMain.handle('setup:cancel-and-close', async () => {
    if (activeOperation?.kind === 'uninstall') {
      return { ok: false, error: 'Removal cannot be cancelled safely. Keep this window open until it finishes.' };
    }
    if (activeOperation) {
      activeOperation.controller.abort();
      try {
        await activeOperation.promise;
      } catch {
        // The install engine restores the previous version before rejecting.
      }
    }
    scheduleExit(2);
    return { ok: true };
  });

  ipcMain.handle('setup:close', () => {
    if (uninstallReady) finalizeUninstall();
    else {
      const code = !operationCompleted && exitCode === 0 ? 2 : exitCode;
      if (code === 0) {
        allowClose = true;
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
        else app.quit();
      } else {
        scheduleExit(code);
      }
    }
    return { ok: true };
  });

  ipcMain.handle('setup:minimize', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize();
  });

  ipcMain.handle('setup:show-log', async () => {
    const error = await shell.openPath(logger.logPath);
    return error ? { ok: false, error } : { ok: true };
  });

  ipcMain.handle('setup:launch', async (event, exePath) => {
    const error = await shell.openPath(exePath);
    return error ? { ok: false, error } : { ok: true };
  });
}

async function runSilent() {
  try {
    if (uninstallMode) {
      uninstallResult = await engine.uninstall({ removeData: false, onProgress() {} });
      if (engine.isPackaged) windows.scheduleSelfDelete(uninstallResult.installDir);
      app.exit(0);
      return;
    }

    const installDir = directoryArg ? directoryArg.slice(3).replace(/^"(.*)"$/, '$1') : windows.getDefaultInstallDir();
    const registry = windows.readUninstallRegistry();
    if (registry.InstallLocation?.value) await engine.closeInstalledApp();
    await engine.install({
      installDir,
      options: { desktop: true, startMenu: true, launch: false },
      onProgress() {}
    });
    app.exit(0);
  } catch (error) {
    logger.error(`Silent setup failed: ${errorMessage(error)}`);
    app.exit(isCancelled(error) ? 2 : 1);
  }
}

app.whenReady().then(async () => {
  engine = new InstallEngine({
    appRoot: app.getAppPath(),
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath
  });
  engine.setForceDev(devMode);
  logger.info(`Starting ${PRODUCT.setupName}${uninstallMode ? ' uninstall' : ''}${silentMode ? ' silently' : ''}`);

  if (silentMode) {
    await runSilent();
    return;
  }

  registerIpc();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  app.exitCode = exitCode;
});
