const crypto = require('node:crypto');
const fs = process.versions.electron ? require('original-fs') : require('node:fs');
const appFs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');
const { Transform } = require('node:stream');
const windows = require('./platform/windows');
const { assertAborted, extractZip, inspectZip, resolveEntryPath, sha256File } = require('./zip');
const logger = require('./logger');
const { PRODUCT } = require('./product');

class InstallError extends Error {
  constructor(message) {
    super(message);
    this.name = 'InstallError';
  }
}

function isCancelled(error) {
  return error?.name === 'CancelledError' || error?.name === 'AbortError';
}

function pathExists(target) {
  try {
    fs.accessSync(target);
    return true;
  } catch {
    return false;
  }
}

function isInside(candidate, parent) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function systemFolders() {
  return [
    process.env.SystemRoot,
    process.env.WINDIR,
    process.env.ProgramFiles,
    process.env['ProgramFiles(x86)'],
    process.env.ProgramData,
    process.env.ProgramW6432
  ].filter(Boolean).map((folder) => path.resolve(folder));
}

function validateSystemPath(target) {
  const resolved = path.resolve(target);
  const root = path.parse(resolved).root;
  const home = path.resolve(os.homedir());
  if (resolved === root) throw new InstallError('Choose a folder inside your user profile.');
  if (resolved === home) throw new InstallError(`Choose a dedicated folder for ${PRODUCT.name}.`);
  for (const folder of systemFolders()) {
    if (isInside(resolved, folder)) throw new InstallError('Choose a per-user folder, not a Windows system folder.');
  }
  return resolved;
}

async function nearestExistingDirectory(target) {
  let current = target;
  while (!pathExists(current)) {
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  const stat = await fs.promises.stat(current);
  if (!stat.isDirectory()) throw new InstallError('The selected location is not a folder.');
  return current;
}

async function freeBytes(target) {
  const ancestor = await nearestExistingDirectory(target);
  const stats = await fs.promises.statfs(ancestor);
  return Number(stats.bavail) * Number(stats.bsize);
}

async function copyFileWithProgress(source, destination, signal, onProgress) {
  const total = fs.statSync(source).size;
  let copied = 0;
  const counter = new Transform({
    transform(chunk, encoding, callback) {
      copied += chunk.length;
      onProgress?.(copied, total);
      callback(null, chunk);
    }
  });
  await pipeline(fs.createReadStream(source), counter, fs.createWriteStream(destination), { signal });
}

async function directorySize(root) {
  let total = 0;
  async function visit(directory) {
    const entries = await fs.promises.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(target);
      } else if (entry.isFile()) {
        total += (await fs.promises.stat(target)).size;
      }
    }
  }
  await visit(root);
  return total;
}

async function remove(target) {
  await fs.promises.rm(target, { recursive: true, force: true, maxRetries: 6, retryDelay: 200 });
}

function readManifest(installDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(installDir, 'install-manifest.json'), 'utf8'));
  } catch {
    return null;
  }
}

function isOwnedManifest(manifest) {
  return Boolean(
    manifest?.product === PRODUCT.name &&
    typeof manifest.exe === 'string' &&
    Array.isArray(manifest.files) &&
    manifest.files.every((file) => typeof file === 'string')
  );
}

function listRelativeFiles(root) {
  const files = [];
  function visit(directory, prefix) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(target, relative);
      else if (entry.isFile()) files.push(relative);
    }
  }
  visit(root, '');
  return files.sort();
}

class InstallEngine {
  constructor({ appRoot, isPackaged, resourcesPath }) {
    this.appRoot = appRoot;
    this.isPackaged = isPackaged;
    this.resourcesPath = resourcesPath;
    this.payloadDir = isPackaged ? path.join(resourcesPath, 'payload') : path.join(appRoot, 'payload');
    this.iconSource = path.join(appRoot, 'assets', 'icon.ico');
    this.forceDev = false;
  }

  setForceDev(value) {
    this.forceDev = Boolean(value);
  }

  async getPayloadInfo() {
    const archivePath = path.join(this.payloadDir, 'nexa-harness.zip');
    const metadataPath = path.join(this.payloadDir, 'payload.json');
    const hasArchive = pathExists(archivePath);
    const hasMetadata = pathExists(metadataPath);

    if (this.forceDev || (!this.isPackaged && !hasArchive && !hasMetadata)) {
      const sampleSize = 4096;
      return {
        sample: true,
        devMode: true,
        name: PRODUCT.sampleName,
        version: '0.0.0-dev',
        sha256: null,
        sizeBytes: sampleSize,
        exe: 'NexaSample.cmd',
        archivePath: null,
        metadataPath: null,
        installSizeBytes: sampleSize,
        uncompressedBytes: sampleSize
      };
    }

    if (!hasArchive || !hasMetadata) {
      throw new InstallError('The installer payload is incomplete. Package the installer again.');
    }

    let metadata;
    try {
      metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    } catch {
      throw new InstallError('The installer payload information could not be read. Package the installer again.');
    }

    for (const field of ['name', 'version', 'sha256', 'exe']) {
      if (typeof metadata[field] !== 'string' || !metadata[field].trim()) {
        throw new InstallError('The installer payload information is incomplete. Package the installer again.');
      }
    }
    if (!Number.isSafeInteger(metadata.sizeBytes) || metadata.sizeBytes <= 0) {
      throw new InstallError('The installer payload size is invalid. Package the installer again.');
    }
    if (!/^[a-f0-9]{64}$/i.test(metadata.sha256)) {
      throw new InstallError('The installer payload checksum is invalid. Package the installer again.');
    }
    const exe = metadata.exe.replaceAll('\\', '/');
    if (path.isAbsolute(metadata.exe) || exe.split('/').some((part) => !part || part === '.' || part === '..')) {
      throw new InstallError('The installer payload executable path is invalid. Package the installer again.');
    }

    const archiveStat = await fs.promises.stat(archivePath);
    if (archiveStat.size !== metadata.sizeBytes) {
      throw new InstallError('The installer payload size does not match its package information.');
    }

    const inspected = await inspectZip(archivePath);
    const installerSize = pathExists(windows.getInstallerSource()) ? fs.statSync(windows.getInstallerSource()).size : 0;
    return {
      sample: false,
      devMode: metadata.devMode === true,
      name: metadata.name,
      version: metadata.version,
      sha256: metadata.sha256.toLowerCase(),
      sizeBytes: metadata.sizeBytes,
      exe,
      archivePath,
      metadataPath,
      installSizeBytes: inspected.totalBytes + installerSize + 32768,
      uncompressedBytes: inspected.totalBytes
    };
  }

  async getConfig() {
    const payload = await this.getPayloadInfo();
    const registry = windows.readUninstallRegistry();
    const defaultInstallDir = registry.InstallLocation?.value || windows.getDefaultInstallDir();
    return {
      name: PRODUCT.name,
      publisher: PRODUCT.publisher,
      version: payload.version,
      devMode: payload.devMode,
      installSizeBytes: payload.installSizeBytes,
      payloadSizeBytes: payload.sizeBytes,
      defaultInstallDir,
      existingVersion: registry.DisplayVersion?.value || null,
      existingInstallDir: registry.InstallLocation?.value || null,
      defaults: { desktop: true, startMenu: true, launch: true }
    };
  }

  async validatePath(input) {
    const problems = [];
    let target = '';
    let available = 0;
    let required = 256 * 1024 * 1024;

    try {
      const payload = await this.getPayloadInfo();
      required = Math.ceil(payload.installSizeBytes * 1.25) + 64 * 1024 * 1024;
    } catch (error) {
      problems.push(error.message);
    }

    try {
      if (typeof input !== 'string' || !input.trim()) throw new InstallError('Choose an install folder.');
      target = validateSystemPath(input.trim().replace(/^"(.*)"$/, '$1'));
      if (pathExists(target)) {
        const stat = await fs.promises.stat(target);
        if (!stat.isDirectory()) throw new InstallError('The selected location is a file. Choose a folder.');
        const entries = await fs.promises.readdir(target);
        if (entries.length > 0 && !isOwnedManifest(readManifest(target))) {
          throw new InstallError(`This folder contains files that do not belong to ${PRODUCT.name}. Choose another folder.`);
        }
      }
      const ancestor = await nearestExistingDirectory(target);
      const probe = path.join(pathExists(target) ? target : ancestor, `.nexa-write-test-${process.pid}-${crypto.randomBytes(4).toString('hex')}`);
      await fs.promises.writeFile(probe, '');
      await fs.promises.rm(probe, { force: true });
      const stats = await fs.promises.statfs(ancestor);
      available = Number(stats.bavail) * Number(stats.bsize);
      if (available < required) problems.push('There is not enough available space for the installation.');
    } catch (error) {
      problems.push(error.message || 'The selected folder cannot be used.');
    }

    return { valid: problems.length === 0, path: target, freeBytes: available, requiredBytes: required, problems };
  }

  async createSample(destination, signal, onProgress) {
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${PRODUCT.sampleName}</title></head><body style="font-family:Arial,sans-serif;background:#FFF;color:#000;margin:64px"><h1>${PRODUCT.sampleName}</h1><p>The installer development payload is working.</p></body></html>`;
    const command = '@echo off\r\nstart "" "%~dp0sample.html"\r\n';
    const files = [
      ['NexaSample.cmd', command],
      ['sample.html', html]
    ];
    let written = 0;
    const total = files.reduce((sum, [, content]) => sum + Buffer.byteLength(content), 0);
    for (const [name, content] of files) {
      assertAborted(signal);
      await fs.promises.writeFile(path.join(destination, name), content, 'utf8');
      written += Buffer.byteLength(content);
      onProgress(written, total, name);
    }
  }

  async install({ installDir, options, signal, onProgress }) {
    const payload = await this.getPayloadInfo();
    const validation = await this.validatePath(installDir);
    if (!validation.valid) throw new InstallError(validation.problems[0]);
    const targetDir = validation.path;
    const report = (progress, status, detail = '') => onProgress?.({ progress, status, detail });

    report(0.01, 'Preparing', payload.devMode ? 'Development mode, installing the development build.' : '');
    assertAborted(signal);
    await fs.promises.mkdir(path.dirname(targetDir), { recursive: true });

    const token = `${process.pid}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const stagingDir = path.join(path.dirname(targetDir), `.nexa-harness-install-${token}`);
    const backupDir = path.join(path.dirname(targetDir), `.nexa-harness-backup-${token}`);
    const payloadSnapshot = path.join(path.dirname(targetDir), `.nexa-harness-payload-${token}.zip`);
    const shortcutBackupDir = path.join(path.dirname(targetDir), `.nexa-harness-shortcuts-${token}`);
    const previousRegistry = windows.readUninstallRegistry();
    const shortcuts = windows.shortcutPaths();
    let moved = false;
    let backupCreated = false;
    let registryTouched = false;
    let snapshotCreated = false;
    let shortcutBackupsCreated = false;

    try {
      await fs.promises.mkdir(stagingDir, { recursive: true });

      if (payload.sample) {
        report(0.08, 'Preparing', 'Development mode, installing a sample app.');
        await this.createSample(stagingDir, signal, (done, total) => report(0.08 + (done / total) * 0.08, 'Preparing'));
      } else {
        report(0.05, 'Preparing', 'Checking the payload.');
        await copyFileWithProgress(payload.archivePath, payloadSnapshot, signal, (done, total) => {
          report(0.05 + (done / total) * 0.04, 'Preparing');
        });
        snapshotCreated = true;
        const actualHash = await sha256File(payloadSnapshot, signal);
        if (actualHash !== payload.sha256 || fs.statSync(payloadSnapshot).size !== payload.sizeBytes) {
          throw new InstallError('The payload does not match its checksum. Download the installer again.');
        }
        report(0.14, 'Unpacking files');
        await extractZip(payloadSnapshot, stagingDir, {
          signal,
          onProgress(done, total) {
            const ratio = total > 0 ? done / total : 1;
            report(0.14 + ratio * 0.54, 'Unpacking files');
          }
        });
        await remove(payloadSnapshot);
        snapshotCreated = false;
      }

      const stagingExePath = resolveEntryPath(stagingDir, payload.exe);
      if (!pathExists(stagingExePath)) throw new InstallError('The application executable is missing from the payload.');
      if (!payload.sample && path.extname(stagingExePath).toLowerCase() !== '.exe') {
        throw new InstallError('The payload executable must be a Windows .exe file.');
      }

      await appFs.promises.copyFile(this.iconSource, path.join(stagingDir, 'leaf.ico'));
      if (!payload.sample) {
        report(0.70, 'Finishing up', 'Preparing the uninstaller.');
        await copyFileWithProgress(windows.getInstallerSource(), path.join(stagingDir, 'uninstall.exe'), signal, (done, total) => {
          report(0.70 + (done / total) * 0.07, 'Finishing up');
        });
      }

      const ownedFiles = [...listRelativeFiles(stagingDir), 'install-manifest.json'];
      await fs.promises.writeFile(path.join(stagingDir, 'install-manifest.json'), JSON.stringify({
        product: PRODUCT.name,
        name: payload.name,
        version: payload.version,
        exe: payload.exe,
        files: ownedFiles,
        installedAt: new Date().toISOString()
      }, null, 2));

      const installedSize = await directorySize(stagingDir);
      report(0.78, 'Finishing up');
      assertAborted(signal);

      if (pathExists(targetDir)) {
        await fs.promises.rename(targetDir, backupDir);
        backupCreated = true;
      }
      try {
        await fs.promises.rename(stagingDir, targetDir);
        moved = true;
      } catch (error) {
        if (backupCreated) {
          await fs.promises.rename(backupDir, targetDir);
          backupCreated = false;
        }
        throw error;
      }

      const exePath = resolveEntryPath(targetDir, payload.exe);
      report(0.82, 'Creating shortcuts');
      const selectedShortcuts = [
        ['desktop', shortcuts.desktop, options.desktop],
        ['startMenu', shortcuts.startMenu, options.startMenu]
      ].filter(([, , selected]) => selected);
      for (const [key, shortcut] of selectedShortcuts) {
        if (!pathExists(shortcut)) continue;
        if (!shortcutBackupsCreated) {
          await fs.promises.mkdir(shortcutBackupDir, { recursive: true });
          shortcutBackupsCreated = true;
        }
        await fs.promises.copyFile(shortcut, path.join(shortcutBackupDir, `${key}.lnk`));
      }
      windows.createShortcuts({
        installDir: targetDir,
        exePath,
        iconPath: path.join(targetDir, 'leaf.ico'),
        desktop: options.desktop,
        startMenu: options.startMenu
      });
      report(0.90, 'Finishing up');
      assertAborted(signal);

      const uninstallCommand = payload.sample
        ? `${windows.quote(process.execPath)} ${windows.quote(this.appRoot)} --uninstall`
        : `${windows.quote(path.join(targetDir, 'uninstall.exe'))} --uninstall`;
      registryTouched = true;
      windows.registerUninstaller({
        installDir: targetDir,
        version: payload.version,
        iconPath: path.join(targetDir, 'leaf.ico'),
        sizeBytes: installedSize,
        uninstallCommand
      });
      report(0.96, 'Finishing up');
      assertAborted(signal);

      if (backupCreated) {
        await remove(backupDir).catch((error) => logger.warn(`Previous version backup could not be removed: ${error.message}`));
        backupCreated = false;
      }
      if (shortcutBackupsCreated) {
        await remove(shortcutBackupDir).catch((error) => logger.warn(`Shortcut backup could not be removed: ${error.message}`));
        shortcutBackupsCreated = false;
      }
      report(1, 'Finishing up');
      logger.info(`Installed ${payload.name} ${payload.version} in ${targetDir}`);
      return { installDir: targetDir, exePath, version: payload.version, devMode: payload.devMode };
    } catch (error) {
      logger.error(`Install failed: ${error.message}`);
      if (moved) {
        try {
          await remove(targetDir);
        } catch (removeError) {
          logger.error(`Partial installation could not be removed: ${removeError.message}`);
        }
      }
      if (backupCreated && !pathExists(targetDir)) {
        try {
          await fs.promises.rename(backupDir, targetDir);
          backupCreated = false;
        } catch (restoreError) {
          logger.error(`Previous version could not be restored: ${restoreError.message}`);
        }
      }
      await remove(stagingDir).catch(() => {});
      if (snapshotCreated) await remove(payloadSnapshot).catch(() => {});
      for (const [key, shortcut, selected] of [
        ['desktop', shortcuts.desktop, options.desktop],
        ['startMenu', shortcuts.startMenu, options.startMenu]
      ]) {
        if (!selected) continue;
        const backup = path.join(shortcutBackupDir, `${key}.lnk`);
        try {
          if (pathExists(backup)) fs.copyFileSync(backup, shortcut);
          else fs.rmSync(shortcut, { force: true, maxRetries: 4, retryDelay: 150 });
        } catch (shortcutError) {
          logger.error(`Shortcut could not be restored: ${shortcutError.message}`);
        }
      }
      if (shortcutBackupsCreated) await remove(shortcutBackupDir).catch(() => {});
      if (registryTouched) {
        try {
          if (Object.keys(previousRegistry).length > 0) windows.writeUninstallEntry(previousRegistry);
          else windows.deleteUninstallEntry();
        } catch (registryError) {
          logger.error(`Registry could not be restored: ${registryError.message}`);
        }
      }
      throw error;
    }
  }

  async checkInstalledRunning() {
    const registry = windows.readUninstallRegistry();
    const installDir = registry.InstallLocation?.value;
    if (!installDir) return { running: false, processes: [] };
    const manifest = readManifest(installDir);
    const payload = await this.getPayloadInfo();
    const exe = manifest?.exe || payload.exe;
    const exePath = resolveEntryPath(installDir, exe);
    const processes = pathExists(exePath) ? windows.getRunningProcesses(exePath) : [];
    return { running: processes.length > 0, processes };
  }

  async closeInstalledApp() {
    const registry = windows.readUninstallRegistry();
    const installDir = registry.InstallLocation?.value;
    if (!installDir) return;
    const manifest = readManifest(installDir);
    const payload = await this.getPayloadInfo();
    const exePath = resolveEntryPath(installDir, manifest?.exe || payload.exe);
    if (pathExists(exePath)) await windows.closeRunningProcesses(exePath);
  }

  async getUninstallInfo() {
    const registry = windows.readUninstallRegistry();
    const portableDir = windows.getPortableInstallDir();
    const candidates = [registry.InstallLocation?.value, portableDir].filter(Boolean);
    let installDir = '';
    let manifest = null;
    for (const candidate of candidates) {
      const candidateManifest = readManifest(candidate);
      if (isOwnedManifest(candidateManifest)) {
        installDir = candidate;
        manifest = candidateManifest;
        break;
      }
    }
    const dataDirectories = windows.getDataDirectories();
    return {
      installDir,
      version: registry.DisplayVersion?.value || manifest?.version || '',
      hasSettings: dataDirectories.some(pathExists)
    };
  }

  async uninstall({ removeData, signal, onProgress }) {
    const info = await this.getUninstallInfo();
    if (!info.installDir) throw new InstallError(`The ${PRODUCT.name} installation record could not be found.`);
    const installDir = validateSystemPath(info.installDir);
    const report = (progress, status, detail = '') => onProgress?.({ progress, status, detail });
    const manifest = readManifest(installDir);
    if (!isOwnedManifest(manifest)) throw new InstallError(`The ${PRODUCT.name} installation record is invalid.`);

    report(0.03, 'Preparing');
    assertAborted(signal);
    const exePath = resolveEntryPath(installDir, manifest.exe);
    if (pathExists(exePath) && windows.getRunningProcesses(exePath).length > 0) {
      report(0.08, 'Preparing', `Closing ${PRODUCT.name}.`);
      await windows.closeRunningProcesses(exePath);
    }

    report(0.16, 'Removing files');
    const keepNames = new Set([
      path.basename(windows.getInstallerSource()).toLowerCase(),
      path.basename(process.execPath).toLowerCase()
    ]);
    const directories = new Set();
    let index = 0;
    for (const relative of manifest.files) {
      assertAborted(signal);
      const target = resolveEntryPath(installDir, relative);
      if (relative === 'install-manifest.json' || keepNames.has(path.basename(target).toLowerCase())) continue;
      await remove(target);
      let parent = path.dirname(target);
      while (parent !== installDir && isInside(parent, installDir)) {
        directories.add(parent);
        parent = path.dirname(parent);
      }
      index += 1;
      report(0.16 + (index / Math.max(1, manifest.files.length)) * 0.44, 'Removing files');
    }
    for (const directory of [...directories].sort((left, right) => right.length - left.length)) {
      try {
        await fs.promises.rmdir(directory);
      } catch {
        // Unknown user files may remain in an owned directory.
      }
    }

    if (removeData) {
      report(0.64, 'Removing files', 'Removing settings and data.');
      const dataDirectories = windows.getDataDirectories();
      let removed = 0;
      for (const directory of dataDirectories) {
        assertAborted(signal);
        if (pathExists(directory)) await remove(directory);
        removed += 1;
        report(0.64 + (removed / dataDirectories.length) * 0.18, 'Removing files');
      }
    }

    report(0.86, 'Finishing up');
    windows.removeShortcuts();
    const registry = windows.readUninstallRegistry();
    if (Object.keys(registry).length > 0 && !windows.deleteUninstallEntry()) {
      throw new InstallError('The uninstall entry could not be removed. Try again.');
    }
    assertAborted(signal);
    await remove(path.join(installDir, 'install-manifest.json'));
    report(0.94, 'Finishing up');
    assertAborted(signal);
    report(1, 'Finishing up');
    logger.info(`Removed ${PRODUCT.name} from ${installDir}`);
    return { installDir, removeData };
  }
}

module.exports = {
  InstallEngine,
  InstallError,
  isCancelled,
  pathExists,
  validateSystemPath
};
