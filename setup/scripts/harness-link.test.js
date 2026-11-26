const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const asar = require('@electron/asar');
const {
  assertSafePackageEntries,
  builderConfig,
  copyRuntimeDependencies,
  runtimePackage,
  verifyPackagedApp
} = require('./harness-link');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexa-package-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function writePackage(root, name, version, dependencies = {}) {
  const directory = path.join(root, 'node_modules', ...name.split('/'));
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name, version, main: 'index.js', dependencies }));
  fs.writeFileSync(path.join(directory, 'index.js'), 'module.exports = true\n');
  return directory;
}

test('runtime manifest retains only main-process dependencies', () => {
  const source = {
    name: 'nexa',
    productName: 'nexa',
    version: '1.2.3',
    main: 'out/main/index.js',
    dependencies: {
      zod: '^3.25.0',
      'electron-updater': '^6.8.11',
      react: '^19.1.0',
      monaco: '^0.52.0'
    }
  };
  const result = runtimePackage(source);
  assert.equal(result.name, 'nexa');
  assert.equal(result.productName, 'Nexa');
  assert.equal(result.version, '1.2.3');
  assert.equal(result.main, 'out/main/index.js');
  assert.deepEqual(result.dependencies, { zod: '^3.25.0', 'electron-updater': '^6.8.11' });
});

test('runtime dependency copy includes transitive packages and excludes local secrets', async (t) => {
  const root = fixture(t);
  const destination = path.join(root, 'staging');
  const updater = writePackage(root, 'electron-updater', '6.8.11', { 'builder-util-runtime': '^9.7.0' });
  writePackage(root, 'builder-util-runtime', '9.7.0');
  writePackage(root, 'zod', '3.25.76');
  fs.writeFileSync(path.join(root, '.env.local'), 'DO_NOT_PACKAGE=true\n');
  fs.writeFileSync(path.join(updater, '.env'), 'DO_NOT_PACKAGE=true\n');
  fs.mkdirSync(path.join(updater, 'node_modules', 'nested'), { recursive: true });
  fs.writeFileSync(path.join(updater, 'node_modules', 'nested', 'secret.txt'), 'nested\n');

  const copied = await copyRuntimeDependencies(root, destination, ['electron-updater', 'zod']);
  assert.deepEqual(copied.map((item) => item.name).sort(), ['builder-util-runtime', 'electron-updater', 'zod']);
  assert.ok(fs.existsSync(path.join(destination, 'node_modules', 'builder-util-runtime', 'index.js')));
  assert.ok(!fs.existsSync(path.join(destination, '.env.local')));
  assert.ok(!fs.existsSync(path.join(destination, 'node_modules', 'electron-updater', '.env')));
  assert.ok(!fs.existsSync(path.join(destination, 'node_modules', 'electron-updater', 'node_modules')));
});

test('runtime dependency copy rejects conflicting versions instead of producing a broken app', async (t) => {
  const root = fixture(t);
  const destination = path.join(root, 'staging');
  const first = writePackage(root, 'first', '1.0.0', { shared: '1.0.0' });
  writePackage(root, 'second', '1.0.0', { shared: '2.0.0' });
  writePackage(root, 'shared', '1.0.0');
  writePackage(first, 'shared', '2.0.0');
  await assert.rejects(copyRuntimeDependencies(root, destination, ['first', 'second']), /Conflicting runtime dependency versions/);
});

test('package entry validation rejects traversal and development files', () => {
  assert.doesNotThrow(() => assertSafePackageEntries(['/out/main/index.js', '/node_modules/zod/package.json', '/package.json']));
  for (const entry of ['/../escape', '/out/../../escape', '/.env.local', '/src/main/index.ts', '/tests/secret.test.ts']) {
    assert.throws(() => assertSafePackageEntries([entry]), /Unsafe packaged file/);
  }
});

test('packaged app verification reads nested ASAR entries on Windows', async (t) => {
  const root = fixture(t);
  const source = path.join(root, 'source');
  const appDirectory = path.join(root, 'win-unpacked');
  const resources = path.join(appDirectory, 'resources');
  fs.mkdirSync(path.join(source, 'out', 'main'), { recursive: true });
  fs.mkdirSync(path.join(source, 'out', 'preload'), { recursive: true });
  fs.mkdirSync(path.join(source, 'out', 'renderer'), { recursive: true });
  fs.mkdirSync(resources, { recursive: true });
  fs.writeFileSync(path.join(source, 'package.json'), JSON.stringify({
    name: 'nexa',
    main: 'out/main/index.js',
    dependencies: { zod: '^3.25.0', 'electron-updater': '^6.8.11' }
  }));
  fs.writeFileSync(path.join(source, 'out', 'main', 'index.js'), [
    'Untrusted renderer request.',
    'senderFrame',
    'mainFrame',
    'senderFrame.url',
    'isTrustedRendererUrl',
    'will-navigate'
  ].join('\n'));
  fs.writeFileSync(path.join(source, 'out', 'preload', 'index.js'), 'module.exports = {}\n');
  fs.writeFileSync(path.join(source, 'out', 'renderer', 'index.html'), `<title>Nexa</title>${'x'.repeat(1024 * 1024)}\n`);
  fs.writeFileSync(path.join(appDirectory, 'nexa.exe'), Buffer.alloc(1024 * 1024 + 1));
  await asar.createPackageWithOptions(source, path.join(resources, 'app.asar'), {});

  const verified = await verifyPackagedApp(appDirectory);
  assert.equal(verified.executable, path.join(appDirectory, 'nexa.exe'));
  assert.ok(verified.fileCount > 5);
});

test('builder config creates an unpackaged x64 Nexa app from the reviewed harness', () => {
  const config = builderConfig({
    stagingRoot: 'C:\\build\\staging',
    outputRoot: 'C:\\build\\output',
    buildResources: 'C:\\setup\\build',
    electronDist: 'C:\\harness\\node_modules\\electron\\dist',
    electronVersion: '37.10.3',
    icon: 'C:\\harness\\assets\\icon.ico'
  });
  assert.equal(config.directories.output, 'C:\\build\\output');
  assert.equal(config.directories.buildResources, 'C:\\setup\\build');
  assert.equal(config.electronVersion, '37.10.3');
  assert.equal(config.electronDist, 'C:\\harness\\node_modules\\electron\\dist');
  assert.equal(config.asar, true);
  assert.equal(config.npmRebuild, false);
  assert.equal(config.win.executableName, 'nexa');
  assert.deepEqual(config.win.target, [{ target: 'dir', arch: ['x64'] }]);
  assert.equal(config.win.icon, 'C:\\harness\\assets\\icon.ico');
  assert.ok(config.files.includes('node_modules/**/*'));
});
