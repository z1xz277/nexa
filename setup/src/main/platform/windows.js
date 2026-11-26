const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');
const { app } = require('electron');
const logger = require('../logger');
const { PRODUCT, dataDirectories, installDirectory } = require('../product');

const UNINSTALL_KEY = PRODUCT.uninstallKey;
const APP_USER_MODEL_ID = PRODUCT.appUserModelId;

function quote(value) {
  return `"${value.replaceAll('"', '')}"`;
}

function runReg(args) {
  return execFileSync('reg.exe', args, {
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

function getDefaultInstallDir() {
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  return installDirectory(localAppData);
}

function getDataDirectories() {
  const roaming = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  return dataDirectories(roaming, local);
}

function readUninstallRegistry() {
  try {
    const output = runReg(['query', UNINSTALL_KEY]);
    const values = {};
    for (const line of output.split(/\r?\n/)) {
      const match = line.match(/^\s{4}(.*?)\s+(REG_SZ|REG_EXPAND_SZ|REG_DWORD|REG_QWORD|REG_MULTI_SZ)\s+(.*)$/);
      if (!match) continue;
      values[match[1]] = { type: match[2], value: match[3].trim() };
    }
    return values;
  } catch {
    return {};
  }
}

function setRegistryValue(name, type, value) {
  runReg(['add', UNINSTALL_KEY, '/v', name, '/t', type, '/d', String(value), '/f']);
}

function writeUninstallEntry(entry) {
  try {
    runReg(['delete', UNINSTALL_KEY, '/f']);
  } catch {
    // The key may not exist yet.
  }
  for (const [name, item] of Object.entries(entry)) {
    if (!name || name === '(Default)') continue;
    setRegistryValue(name, item.type, item.value);
  }
}

function registerUninstaller({ installDir, version, iconPath, sizeBytes, uninstallCommand }) {
  writeUninstallEntry({
    DisplayName: { type: 'REG_SZ', value: PRODUCT.name },
    DisplayVersion: { type: 'REG_SZ', value: version },
    Publisher: { type: 'REG_SZ', value: PRODUCT.publisher },
    InstallLocation: { type: 'REG_SZ', value: installDir },
    DisplayIcon: { type: 'REG_SZ', value: `${quote(iconPath)},0` },
    UninstallString: { type: 'REG_SZ', value: uninstallCommand },
    EstimatedSize: { type: 'REG_DWORD', value: Math.max(1, Math.ceil(sizeBytes / 1024)) },
    NoModify: { type: 'REG_DWORD', value: 1 },
    NoRepair: { type: 'REG_DWORD', value: 1 }
  });
}

function deleteUninstallEntry() {
  try {
    runReg(['delete', UNINSTALL_KEY, '/f']);
    return true;
  } catch {
    return false;
  }
}

function shortcutPaths() {
  const roaming = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  return {
    desktop: path.join(app.getPath('desktop'), `${PRODUCT.name}.lnk`),
    startMenu: path.join(roaming, 'Microsoft', 'Windows', 'Start Menu', 'Programs', `${PRODUCT.name}.lnk`)
  };
}

function writeShortcut(target, details, label) {
  const script = [
    '$shell = New-Object -ComObject WScript.Shell',
    '$shortcut = $shell.CreateShortcut($env:NEXA_SHORTCUT_PATH)',
    '$shortcut.TargetPath = $env:NEXA_SHORTCUT_TARGET',
    '$shortcut.WorkingDirectory = $env:NEXA_SHORTCUT_CWD',
    '$shortcut.IconLocation = $env:NEXA_SHORTCUT_ICON + ",0"',
    '$shortcut.Description = $env:NEXA_SHORTCUT_DESCRIPTION',
    '$shortcut.AppUserModelID = $env:NEXA_SHORTCUT_APP_ID',
    '$shortcut.Save()'
  ].join('\r\n');
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  try {
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
      windowsHide: true,
      stdio: 'ignore',
      env: {
        ...process.env,
        NEXA_SHORTCUT_PATH: target,
        NEXA_SHORTCUT_TARGET: details.target,
        NEXA_SHORTCUT_CWD: details.cwd,
        NEXA_SHORTCUT_ICON: details.icon,
        NEXA_SHORTCUT_DESCRIPTION: details.description,
        NEXA_SHORTCUT_APP_ID: details.appUserModelId
      }
    });
  } catch {
    throw new Error(`The ${label} shortcut could not be created.`);
  }
  if (!fs.existsSync(target)) throw new Error(`The ${label} shortcut could not be created.`);
}

function createShortcuts({ installDir, exePath, iconPath, desktop, startMenu }) {
  const created = [];
  const details = {
    target: exePath,
    cwd: installDir,
    icon: iconPath,
    description: PRODUCT.name,
    appUserModelId: APP_USER_MODEL_ID
  };
  if (desktop) {
    const target = shortcutPaths().desktop;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    writeShortcut(target, details, 'desktop');
    created.push(target);
  }
  if (startMenu) {
    const target = shortcutPaths().startMenu;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    writeShortcut(target, details, 'Start menu');
    created.push(target);
  }
  return created;
}

function removeShortcuts() {
  for (const shortcut of Object.values(shortcutPaths())) {
    fs.rmSync(shortcut, { force: true, maxRetries: 5, retryDelay: 150 });
  }
}

function getRunningProcesses(exePath) {
  const script = 'Get-CimInstance Win32_Process | Select-Object ProcessId,ExecutablePath | ConvertTo-Json -Compress';
  let output;
  try {
    output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
  } catch {
    throw new Error(`Running apps could not be checked. Close ${PRODUCT.name}, then try again.`);
  }

  const expected = path.resolve(exePath.replace(/^\\\\\?\\/, '')).toLowerCase();
  const parsed = output.trim() ? JSON.parse(output) : [];
  const processes = Array.isArray(parsed) ? parsed : [parsed];
  return processes
    .filter((item) => item?.ExecutablePath && path.resolve(item.ExecutablePath.replace(/^\\\\\?\\/, '')).toLowerCase() === expected)
    .map((item) => ({ name: path.basename(item.ExecutablePath), pid: Number(item.ProcessId) }))
    .filter((item) => Number.isInteger(item.pid) && item.pid > 0);
}

async function closeRunningProcesses(exePath) {
  const processes = getRunningProcesses(exePath);
  for (const item of processes) {
    try {
      execFileSync('taskkill', ['/PID', String(item.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      });
    } catch {
      // The process may have closed after the process list was read.
    }
  }
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (getRunningProcesses(exePath).length === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${PRODUCT.name} is still running. Close it, then try again.`);
}

function getInstallerSource() {
  return process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
}

function getPortableInstallDir() {
  return process.env.PORTABLE_EXECUTABLE_DIR || null;
}

function scheduleSelfDelete(installDir) {
  const executablePath = getInstallerSource();
  const helperPath = path.join(os.tmpdir(), `.nexa-self-delete-${process.pid}-${crypto.randomBytes(6).toString('hex')}.cmd`);
  const command = [
    '@echo off',
    'set /a NEXA_RETRY=0',
    ':retry',
    'del /f /q "%NEXA_SELF_DELETE_FILE%" >nul 2>&1',
    'if exist "%NEXA_SELF_DELETE_FILE%" goto wait',
    'goto remove',
    ':wait',
    'ping 127.0.0.1 -n 2 >nul',
    'set /a NEXA_RETRY+=1',
    'if %NEXA_RETRY% LSS 30 goto retry',
    ':remove',
    'rd /s /q "%NEXA_SELF_DELETE_DIR%" >nul 2>&1',
    'del /f /q "%~f0" >nul 2>&1'
  ].join('\r\n');
  try {
    fs.writeFileSync(helperPath, command, { encoding: 'utf8', flag: 'wx' });
  } catch (error) {
    logger.error(`Self-delete helper could not be written: ${error.message}`);
    return;
  }
  const child = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/c', helperPath], {
    cwd: os.tmpdir(),
    detached: true,
    windowsHide: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      NEXA_SELF_DELETE_FILE: executablePath,
      NEXA_SELF_DELETE_DIR: installDir
    }
  });
  child.on('error', (error) => {
    logger.error(`Self-delete helper could not start: ${error.message}`);
    fs.rmSync(helperPath, { force: true });
  });
  child.unref();
  logger.info(`Scheduled self-delete for ${path.basename(executablePath)}`);
}

module.exports = {
  APP_USER_MODEL_ID,
  UNINSTALL_KEY,
  closeRunningProcesses,
  createShortcuts,
  deleteUninstallEntry,
  getDataDirectories,
  getDefaultInstallDir,
  getInstallerSource,
  getPortableInstallDir,
  getRunningProcesses,
  quote,
  readUninstallRegistry,
  registerUninstaller,
  removeShortcuts,
  scheduleSelfDelete,
  shortcutPaths,
  writeUninstallEntry
};
