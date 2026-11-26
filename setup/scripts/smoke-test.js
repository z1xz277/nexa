const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawn, spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');
const { resolveEntryPath } = require('../src/main/zip');
const { PRODUCT } = require('../src/main/product');

const root = path.resolve(__dirname, '..');
const electronPath = require('electron');
const packagedSetupPath = process.env.NEXA_SETUP_EXE ? path.resolve(process.env.NEXA_SETUP_EXE) : null;
const uninstallKey = PRODUCT.uninstallKey;
const installDir = path.join(os.tmpdir(), `nexa-smoke-${process.pid}-${Date.now()}`);
const payload = JSON.parse(fs.readFileSync(path.join(root, 'payload', 'payload.json'), 'utf8'));
const isRelease = !payload.devMode;
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
let launchedApp = null;
let launchedProfile = null;
let ownsInstall = false;

function registryValues() {
  try {
    return execFileSync('reg.exe', ['query', uninstallKey], { encoding: 'utf8' });
  } catch {
    return '';
  }
}

function registryExists() {
  return Boolean(registryValues());
}

function userDataDigest() {
  const settings = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), PRODUCT.dataFolder, 'settings.json');
  return fs.existsSync(settings) ? crypto.createHash('sha256').update(fs.readFileSync(settings)).digest('hex') : null;
}

function installedProcesses() {
  const query = 'Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $env:NEXA_PROCESS_PATH } | Select-Object ProcessId,ExecutablePath | ConvertTo-Json -Compress';
  const result = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', query], {
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NEXA_PROCESS_PATH: path.join(installDir, payload.exe) }
  });
  const parsed = result.trim() ? JSON.parse(result) : [];
  return Array.isArray(parsed) ? parsed : [parsed];
}

async function assertNoInstalledProcesses(message, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline && installedProcesses().length > 0) await delay(100);
  assert.equal(installedProcesses().length, 0, message);
}

function smokeInstalledApp() {
  const profile = path.join(os.tmpdir(), `nexa-app-smoke-${process.pid}-${Date.now()}`);
  fs.mkdirSync(profile, { recursive: true });
  try {
    const result = spawnSync(path.join(installDir, payload.exe), ['--smoke', `--user-data-dir=${profile}`], {
      cwd: installDir,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 45000,
      env: { ...process.env, ELECTRON_RENDERER_URL: '' }
    });
    const output = `${result.stdout || ''}\n${result.stderr || ''}`;
    assert(!result.error, `The installed app could not start: ${result.error?.message}`);
    assert.equal(result.status, 0, `The installed app smoke test failed.\n${output.slice(-2000)}`);
    assert(output.includes('NEXA_SMOKE_OK'), 'The installed app did not finish loading its renderer.');
  } finally {
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
  }
}

async function launchInstalledApp() {
  launchedProfile = path.join(os.tmpdir(), `nexa-running-smoke-${process.pid}-${Date.now()}`);
  fs.mkdirSync(launchedProfile, { recursive: true });
  launchedApp = spawn(path.join(installDir, payload.exe), [`--user-data-dir=${launchedProfile}`], {
    cwd: installDir,
    stdio: 'ignore',
    windowsHide: true,
    env: { ...process.env, ELECTRON_RENDERER_URL: '' }
  });
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline && installedProcesses().length < 2) {
    assert.equal(launchedApp.exitCode, null, 'The installed app exited before uninstall could close it.');
    await delay(100);
  }
  assert(installedProcesses().length >= 2, 'The installed app did not finish starting.');
}

function cleanupSmoke() {
  if (launchedApp && launchedApp.exitCode === null) launchedApp.kill();
  if (ownsInstall) {
    for (const item of installedProcesses()) {
      try {
        execFileSync('taskkill', ['/PID', String(item.ProcessId), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      } catch {
        // The process may already be gone.
      }
    }
    try {
      execFileSync('reg.exe', ['delete', uninstallKey, '/f'], { windowsHide: true, stdio: 'ignore' });
    } catch {
      // The key may already be gone.
    }
    fs.rmSync(installDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
  }
  if (launchedProfile) fs.rmSync(launchedProfile, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
}

function testZipSlip() {
  const root = path.join(os.tmpdir(), 'nexa-zip-root');
  for (const unsafe of ['../escape.txt', '..\\escape.txt', 'C:\\escape.txt', '/escape.txt', 'safe/../../escape.txt']) {
    let rejected = false;
    try {
      resolveEntryPath(root, unsafe);
    } catch {
      rejected = true;
    }
    assert(rejected, `Zip-slip validation did not reject: ${unsafe}`);
  }
}

class DevTools {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.errors = [];
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(message.error.message));
        else resolve(message.result);
        return;
      }
      if (message.method === 'Runtime.exceptionThrown') this.errors.push(message.params.exceptionDetails.text);
      if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
        this.errors.push(message.params.args.map((item) => item.value || item.description).join(' '));
      }
      if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') {
        this.errors.push(message.params.entry.text);
      }
    });
    const rejectPending = () => {
      for (const { reject } of this.pending.values()) reject(new Error('The DevTools connection closed.'));
      this.pending.clear();
    };
    socket.addEventListener('close', rejectPending, { once: true });
    socket.addEventListener('error', rejectPending, { once: true });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  }

  async waitFor(expression, timeout = 20000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await this.evaluate(expression)) return;
      await delay(100);
    }
    throw new Error(`Timed out waiting for: ${expression}`);
  }

  async screenshot(filePath) {
    const result = await this.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(filePath, Buffer.from(result.data, 'base64'));
  }
}

async function launch(port, extraArgs = [], executablePath = null) {
  const standalone = Boolean(executablePath || packagedSetupPath);
  const child = spawn(executablePath || packagedSetupPath || electronPath, [
    ...(standalone ? [] : [root]),
    `--remote-debugging-port=${port}`,
    ...extraArgs
  ], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' }
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  child.on('error', (error) => { stderr += error.message; });

  let targets;
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Electron exited before the window opened.\n${stderr}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      targets = await response.json();
      if (targets.some((target) => target.type === 'page' && target.url.includes('index.html'))) break;
    } catch {
      // The debugging endpoint starts shortly after Electron.
    }
    await delay(100);
  }
  const page = targets?.find((target) => target.type === 'page' && target.url.includes('index.html'));
  if (!page) throw new Error(`The renderer page did not appear.\n${stderr}`);

  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  const devtools = new DevTools(socket);
  await devtools.send('Runtime.enable');
  await devtools.send('Log.enable');
  await devtools.send('Page.enable');
  return { child, devtools, stderr: () => stderr };
}

async function closeSession(session) {
  try {
    await session.devtools.evaluate('window.nexaSetup.close()');
  } catch {
    session.child.kill();
  }
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline && session.child.exitCode === null) await delay(100);
  if (session.child.exitCode === null) session.child.kill();
  session.devtools.socket.close();
  assert(session.devtools.errors.length === 0, `Renderer errors: ${session.devtools.errors.join('\n')}`);
}

async function waitForRemoval(target, timeout = 45000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline && fs.existsSync(target)) await delay(250);
  assert(!fs.existsSync(target), `Timed out waiting for removal: ${target}`);
}

async function main() {
  assert(process.platform === 'win32', 'The smoke test is Windows only.');
  assert(!registryExists(), `An existing ${PRODUCT.name} registry entry was found. Remove it before running the smoke test.`);
  const settingsBefore = userDataDigest();
  testZipSlip();
  console.log('Zip-slip checks passed.');

  const installSession = await launch(9331);
  console.log('Install window opened.');
  try {
    await installSession.devtools.waitFor("!document.getElementById('welcome-screen').hidden");
    assert(await installSession.devtools.evaluate("document.getElementById('background').width === 528"), 'The background canvas is not rendering at 0.6 DPR.');
    await installSession.devtools.screenshot(path.join(os.tmpdir(), 'nexa-smoke-welcome.png'));
    await installSession.devtools.evaluate("document.getElementById('customize-button').click()");
    await installSession.devtools.waitFor("!document.getElementById('customize-screen').hidden");
    await installSession.devtools.evaluate(`(() => {
      const input = document.getElementById('install-path');
      input.value = ${JSON.stringify(installDir)};
      input.dispatchEvent(new Event('input', { bubbles: true }));
      document.getElementById('desktop-shortcut').checked = false;
      document.getElementById('start-menu-shortcut').checked = false;
      document.getElementById('launch-when-finished').checked = false;
    })()`);
    assert.equal(await installSession.devtools.evaluate("document.getElementById('launch-when-finished').checked"), false, 'Auto-launch was not disabled.');
    await installSession.devtools.waitFor("!document.getElementById('customize-install-button').disabled");
    console.log('Customize path validated.');
    ownsInstall = true;
    await installSession.devtools.evaluate("document.getElementById('customize-install-button').click()");
    await installSession.devtools.waitFor("!document.getElementById('installing-screen').hidden");
    console.log('Installation started.');
    await installSession.devtools.waitFor("!document.getElementById('done-screen').hidden || !document.getElementById('error-screen').hidden", 30000);
    const installState = await installSession.devtools.evaluate("({ done: !document.getElementById('done-screen').hidden, error: !document.getElementById('error-screen').hidden, message: document.getElementById('error-message').textContent })");
    assert(installState.done, `Install did not finish: ${installState.message || 'unknown error'}`);
    console.log('Installation completed.');
    assert(fs.existsSync(path.join(installDir, payload.exe)), 'The payload executable was not installed.');
    assert(fs.existsSync(path.join(installDir, 'uninstall.exe')), 'The copied uninstaller is missing.');
    assert(fs.existsSync(path.join(installDir, 'leaf.ico')), 'The installed leaf icon is missing.');
    const manifest = JSON.parse(fs.readFileSync(path.join(installDir, 'install-manifest.json'), 'utf8'));
    assert.equal(manifest.product, PRODUCT.name);
    assert.equal(manifest.version, payload.version);
    assert.equal(manifest.exe, payload.exe);
    const registry = registryValues();
    assert(registry.includes(`DisplayName    REG_SZ    ${PRODUCT.name}`), 'The uninstall display name is incorrect.');
    assert(registry.includes(`Publisher    REG_SZ    ${PRODUCT.publisher}`), 'The uninstall publisher is incorrect.');
    if (isRelease) {
      assert.equal(payload.name, PRODUCT.name);
      assert.equal(payload.exe, 'nexa.exe');
      assert(fs.existsSync(path.join(installDir, 'resources', 'app.asar')), 'The packaged app archive was not installed.');
      smokeInstalledApp();
      await assertNoInstalledProcesses('The packaged smoke launch left Nexa processes running.');
      await launchInstalledApp();
      console.log('Installed Nexa launch smoke test passed.');
    } else {
      assert(fs.existsSync(path.join(installDir, 'sample.html')), 'The development payload page was not installed.');
    }
    await installSession.devtools.screenshot(path.join(os.tmpdir(), 'nexa-smoke-done.png'));
  } finally {
    await closeSession(installSession);
  }

  const copiedUninstaller = path.join(installDir, 'uninstall.exe');
  const uninstallSession = await launch(9332, ['--uninstall'], packagedSetupPath ? copiedUninstaller : null);
  console.log('Uninstall window opened.');
  try {
    await uninstallSession.devtools.waitFor("!document.getElementById('uninstall-confirm-screen').hidden");
    await uninstallSession.devtools.evaluate("document.getElementById('remove-button').click()");
    await uninstallSession.devtools.waitFor("!document.getElementById('uninstall-done-screen').hidden", 30000);
    assert(!registryExists(), 'The uninstall registry entry was not removed.');
    await assertNoInstalledProcesses('Uninstall left the running Nexa process tree alive.');
  } finally {
    await closeSession(uninstallSession);
  }

  if (packagedSetupPath) await waitForRemoval(installDir);
  const remaining = fs.existsSync(installDir) ? fs.readdirSync(installDir) : [];
  assert(remaining.length === 0, `Uninstall left files behind: ${remaining.join(', ')}`);
  assert.equal(userDataDigest(), settingsBefore, 'Uninstall changed existing Nexa settings.');
  if (fs.existsSync(installDir)) fs.rmdirSync(installDir);

  const cancellationSession = await launch(9333);
  console.log('Cancellation session opened.');
  try {
    await cancellationSession.devtools.waitFor("!document.getElementById('welcome-screen').hidden");
  } finally {
    await closeSession(cancellationSession);
  }
  console.log(`Cancellation session returned exit code ${cancellationSession.child.exitCode}.`);
  assert(cancellationSession.child.exitCode === 2, `Closing before completion returned exit code ${cancellationSession.child.exitCode}.`);
  console.log('Smoke test passed: zip-slip protection, install UI, payload install, app launch, registry, uninstall UI, cleanup, settings preservation, and cancellation exit code.');
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
}).finally(cleanupSmoke);
