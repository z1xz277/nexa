const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const asar = require('@electron/asar');
const { inspectZip, resolveEntryPath, sha256File } = require('../src/main/zip');

const setupRoot = path.resolve(__dirname, '..');
const runtimeDependencies = ['zod', 'electron-updater'];
const authorizationMarkers = [
  'Untrusted renderer request.',
  'senderFrame',
  'mainFrame',
  'senderFrame.url',
  'isTrustedRendererUrl',
  'will-navigate'
];

function runtimePackage(source) {
  const dependencies = {};
  for (const name of runtimeDependencies) {
    const version = source.dependencies?.[name];
    if (typeof version !== 'string' || !version.trim()) throw new Error(`The harness is missing its ${name} runtime dependency.`);
    dependencies[name] = version;
  }
  return {
    name: 'nexa',
    productName: 'Nexa',
    version: source.version,
    description: source.description,
    author: 'Nexa',
    main: source.main,
    private: true,
    dependencies
  };
}

function builderConfig({ outputRoot, buildResources, electronDist, electronVersion, icon }) {
  return {
    appId: 'nexa.desktop',
    productName: 'Nexa',
    directories: { output: outputRoot, buildResources },
    files: ['out/**/*', 'package.json', 'node_modules/**/*', '!**/.env*', '!**/.npmrc'],
    asar: true,
    npmRebuild: false,
    buildDependenciesFromSource: false,
    electronVersion,
    electronDist,
    compression: 'normal',
    win: {
      target: [{ target: 'dir', arch: ['x64'] }],
      executableName: 'nexa',
      artifactName: 'nexa',
      icon
    }
  };
}

function findPackageRoot(harnessRoot, name, fromDirectory = harnessRoot) {
  let current = path.resolve(fromDirectory);
  while (true) {
    const candidate = path.join(current, 'node_modules', ...name.split('/'));
    const manifest = path.join(candidate, 'package.json');
    if (fs.existsSync(manifest) && fs.statSync(manifest).isFile()) return candidate;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function packageFileFilter(root) {
  return (source) => {
    const relative = path.relative(root, source);
    const parts = relative ? relative.split(path.sep) : [];
    const name = path.basename(source);
    if (fs.lstatSync(source).isSymbolicLink()) return false;
    if (parts.includes('node_modules')) return false;
    if (name.startsWith('.env') || name === '.npmrc' || name === '.git') return false;
    return true;
  };
}

async function copyRuntimeDependencies(harnessRoot, destinationRoot, names = runtimeDependencies) {
  const copied = new Map();
  const destinationModules = path.join(destinationRoot, 'node_modules');
  await fs.promises.mkdir(destinationModules, { recursive: true });

  async function copy(name, fromDirectory) {
    const source = findPackageRoot(harnessRoot, name, fromDirectory);
    if (!source) throw new Error(`The harness runtime dependency could not be found: ${name}`);
    const manifest = JSON.parse(await fs.promises.readFile(path.join(source, 'package.json'), 'utf8'));
    const previous = copied.get(name);
    if (previous) {
      if (previous !== manifest.version) throw new Error(`Conflicting runtime dependency versions for ${name}: ${previous} and ${manifest.version}.`);
      return;
    }
    copied.set(name, manifest.version);
    const destination = path.join(destinationModules, ...name.split('/'));
    await fs.promises.cp(source, destination, { recursive: true, filter: packageFileFilter(source) });
    for (const dependency of Object.keys(manifest.dependencies || {})) await copy(dependency, source);
  }

  for (const name of names) await copy(name, harnessRoot);
  return [...copied].map(([name, version]) => ({ name, version }));
}

function assertSafePackageEntries(entries) {
  for (const entry of entries) {
    const normalized = entry.replaceAll('\\', '/');
    const relative = normalized.replace(/^\/+/, '');
    const parts = relative.split('/');
    const allowed = relative === 'package.json' || parts[0] === 'out' || parts[0] === 'node_modules';
    if (!allowed || parts.some((part) => !part || part === '.' || part === '..') || parts.some((part) => part.startsWith('.env') || part === '.npmrc')) {
      throw new Error(`Unsafe packaged file: ${entry}`);
    }
  }
}

async function verifyPackagedApp(appDirectory) {
  const executable = path.join(appDirectory, 'nexa.exe');
  const archive = path.join(appDirectory, 'resources', 'app.asar');
  for (const file of [executable, archive]) {
    const stat = await fs.promises.stat(file);
    if (!stat.isFile() || stat.size < 1024 * 1024) throw new Error(`The packaged app contains an invalid ${path.basename(file)}.`);
  }

  const entries = await asar.listPackage(archive);
  assertSafePackageEntries(entries);
  const manifest = JSON.parse((await asar.extractFile(archive, path.join('package.json'))).toString('utf8'));
  if (JSON.stringify(Object.keys(manifest.dependencies || {}).sort()) !== JSON.stringify([...runtimeDependencies].sort())) {
    throw new Error('The packaged app does not contain the expected runtime dependencies.');
  }
  const main = (await asar.extractFile(archive, path.join('out', 'main', 'index.js'))).toString('utf8');
  const missing = authorizationMarkers.filter((marker) => !main.includes(marker));
  if (missing.length) throw new Error(`The packaged app is missing authorization guards: ${missing.join(', ')}.`);
  if (/ipcMain\.handle\(\s*['"`]/.test(main)) throw new Error('The packaged app contains an unguarded IPC handler.');
  await asar.extractFile(archive, path.join('out', 'preload', 'index.js'));
  await asar.extractFile(archive, path.join('out', 'renderer', 'index.html'));

  const secretPattern = /(?:nvapi-[A-Za-z0-9_-]{20,}|sk-or-v1-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{32,})/;
  for (const entry of entries) {
    if (!/\.(?:js|json|html|css|yml|yaml)$/i.test(entry)) continue;
    const nativeEntry = path.join(...entry.replaceAll('\\', '/').replace(/^\/+/, '').split('/'));
    const content = await asar.extractFile(archive, nativeEntry);
    if (secretPattern.test(content.toString('utf8'))) throw new Error(`The packaged app contains a provider key in ${entry}.`);
  }
  return { executable, archive, fileCount: entries.length };
}

function runNode(script, args, cwd) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd,
    stdio: 'inherit',
    windowsHide: true,
    timeout: 10 * 60 * 1000
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${path.basename(script)} failed with exit code ${result.status}.`);
}

function smokePackagedApp(executable, profileDirectory) {
  const result = spawnSync(executable, ['--smoke', `--user-data-dir=${profileDirectory}`], {
    cwd: path.dirname(executable),
    encoding: 'utf8',
    windowsHide: true,
    timeout: 45000,
    env: { ...process.env, ELECTRON_RENDERER_URL: '' }
  });
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  if (result.error) throw result.error;
  if (result.status !== 0 || !output.includes('NEXA_SMOKE_OK')) {
    throw new Error(`The packaged Nexa app did not pass its smoke test.\n${output.slice(-2000)}`);
  }
}

async function verifyPayload(payloadDirectory, version) {
  const metadataPath = path.join(payloadDirectory, 'payload.json');
  const archivePath = path.join(payloadDirectory, 'nexa-harness.zip');
  const metadata = JSON.parse(await fs.promises.readFile(metadataPath, 'utf8'));
  const stat = await fs.promises.stat(archivePath);
  if (metadata.name !== 'Nexa' || metadata.version !== version || metadata.exe !== 'nexa.exe' || metadata.devMode === true) {
    throw new Error('The setup payload metadata is not a release Nexa build.');
  }
  if (metadata.sizeBytes !== stat.size || metadata.sha256 !== await sha256File(archivePath)) {
    throw new Error('The setup payload checksum does not match its archive.');
  }
  const inspected = await inspectZip(archivePath);
  const names = inspected.entries.map((item) => item.fileName);
  if (!names.includes('nexa.exe') || !names.includes('resources/app.asar')) throw new Error('The setup payload is missing the Nexa executable or app archive.');
  for (const name of names) {
    resolveEntryPath(path.parse(archivePath).root, name);
    if (name.split(/[\\/]/).some((part) => part.startsWith('.env') || part === '.npmrc')) {
      throw new Error(`The setup payload contains a development secret file: ${name}`);
    }
  }
  return { archivePath, metadata, fileCount: names.length };
}

async function linkHarness(harnessRoot) {
  const root = path.resolve(harnessRoot || path.join(setupRoot, '..', '883452ff'));
  const harnessPackagePath = path.join(root, 'package.json');
  const harnessPackage = JSON.parse(await fs.promises.readFile(harnessPackagePath, 'utf8'));
  if (harnessPackage.name !== 'nexa' || harnessPackage.main !== 'out/main/index.js') {
    throw new Error('The selected folder is not the Nexa harness.');
  }

  const electronPackagePath = path.join(root, 'node_modules', 'electron', 'package.json');
  const electronPackage = JSON.parse(await fs.promises.readFile(electronPackagePath, 'utf8'));
  const icon = path.join(root, 'assets', 'icon.ico');
  const outputRoot = path.join(setupRoot, 'build', 'nexa');
  const outputMarker = path.join(outputRoot, '.nexa-generated.json');
  if (fs.existsSync(outputRoot) && !fs.existsSync(outputMarker)) {
    throw new Error('build/nexa exists but was not generated by the linking script. Choose a clean setup project.');
  }

  const temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'nexa-harness-link-'));
  try {
    const stagingRoot = path.join(temporary, 'app');
    const builderOutput = path.join(temporary, 'output');
    const setupOutput = path.join(temporary, 'setup-output');
    const payloadDirectory = path.join(temporary, 'payload');
    const profileDirectory = path.join(temporary, 'profile');
    await fs.promises.mkdir(stagingRoot, { recursive: true });
    await fs.promises.mkdir(profileDirectory, { recursive: true });

    console.log('Building the current Nexa harness.');
    runNode(path.join(root, 'node_modules', 'electron-vite', 'bin', 'electron-vite.js'), ['build'], root);
    runNode(path.join(root, 'scripts', 'check-build.mjs'), [], root);

    await fs.promises.cp(path.join(root, 'out'), path.join(stagingRoot, 'out'), {
      recursive: true,
      filter: packageFileFilter(path.join(root, 'out'))
    });
    await fs.promises.writeFile(path.join(stagingRoot, 'package.json'), `${JSON.stringify(runtimePackage(harnessPackage), null, 2)}\n`);
    const dependencies = await copyRuntimeDependencies(root, stagingRoot);
    console.log(`Packed runtime dependencies: ${dependencies.map((item) => `${item.name}@${item.version}`).join(', ')}`);

    const config = builderConfig({
      outputRoot: builderOutput,
      buildResources: path.join(setupRoot, 'build'),
      electronDist: path.join(root, 'node_modules', 'electron', 'dist'),
      electronVersion: electronPackage.version,
      icon
    });
    const configPath = path.join(stagingRoot, 'electron-builder.config.cjs');
    await fs.promises.writeFile(configPath, `module.exports = ${JSON.stringify(config, null, 2)}\n`);
    console.log('Packaging the Windows x64 app.');
    runNode(path.join(setupRoot, 'node_modules', 'electron-builder', 'cli.js'), ['--win', '--config', configPath], stagingRoot);

    const appDirectory = path.join(builderOutput, 'win-unpacked');
    const verified = await verifyPackagedApp(appDirectory);
    console.log(`Verified app.asar with ${verified.fileCount} entries.`);
    smokePackagedApp(verified.executable, profileDirectory);
    console.log('Packaged Nexa smoke test passed.');

    runNode(path.join(setupRoot, 'scripts', 'payload.js'), [appDirectory, '--exe', 'nexa.exe', '--name', 'Nexa', '--version', harnessPackage.version, '--output', payloadDirectory], setupRoot);
    const payload = await verifyPayload(payloadDirectory, harnessPackage.version);
    console.log(`Verified setup payload with ${payload.fileCount} files.`);

    await fs.promises.mkdir(path.join(setupRoot, 'payload'), { recursive: true });
    for (const name of ['nexa-harness.zip', 'payload.json']) {
      await fs.promises.copyFile(path.join(payloadDirectory, name), path.join(setupRoot, 'payload', name));
    }

    console.log('Building Nexa Setup.');
    runNode(path.join(setupRoot, 'scripts', 'copy-fonts.js'), [], setupRoot);
    runNode(path.join(setupRoot, 'scripts', 'generate-icons.js'), [], setupRoot);
    runNode(path.join(setupRoot, 'node_modules', 'electron-builder', 'cli.js'), ['--win', 'portable', `-c.directories.output=${setupOutput}`], setupRoot);
    const builtSetupExecutable = path.join(setupOutput, 'NexaSetup.exe');
    const setupStat = await fs.promises.stat(builtSetupExecutable);
    if (!setupStat.isFile() || setupStat.size < 1024 * 1024) throw new Error('Nexa Setup was not produced.');
    const setupExecutable = path.join(setupRoot, 'release', 'NexaSetup.exe');
    await fs.promises.mkdir(path.dirname(setupExecutable), { recursive: true });
    await fs.promises.copyFile(builtSetupExecutable, setupExecutable);

    if (fs.existsSync(outputRoot)) await fs.promises.rm(outputRoot, { recursive: true, force: true });
    await fs.promises.cp(appDirectory, outputRoot, { recursive: true });
    await fs.promises.writeFile(outputMarker, `${JSON.stringify({ version: harnessPackage.version, builtAt: new Date().toISOString() }, null, 2)}\n`);
    console.log(`Nexa ${harnessPackage.version} linked successfully.`);
    console.log(`Installer: ${setupExecutable}`);
    console.log(`Packaged app: ${outputRoot}`);
  } finally {
    await fs.promises.rm(temporary, { recursive: true, force: true });
  }
}

if (require.main === module) {
  linkHarness(process.argv[2]).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

module.exports = {
  assertSafePackageEntries,
  builderConfig,
  copyRuntimeDependencies,
  linkHarness,
  runtimePackage,
  verifyPackagedApp,
  verifyPayload
};
