(() => {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const byId = (id) => document.getElementById(id);
  const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

  function createPreviewApi() {
    const listeners = new Map();
    const emit = (channel, data) => {
      for (const listener of listeners.get(channel) || []) listener(data);
    };
    const subscribe = (channel, callback) => {
      const current = listeners.get(channel) || [];
      current.push(callback);
      listeners.set(channel, current);
      return () => listeners.set(channel, current.filter((item) => item !== callback));
    };
    const runProgress = (kind, seconds) => new Promise((resolve) => {
      const started = performance.now();
      const timer = setInterval(() => {
        const progress = Math.min(1, (performance.now() - started) / (seconds * 1000));
        const status = progress < 0.2 ? 'Preparing' : progress < 0.75 ? 'Unpacking files' : progress < 0.9 ? 'Creating shortcuts' : 'Finishing up';
        emit('setup:progress', { kind, data: { progress, status } });
        if (progress >= 1) {
          clearInterval(timer);
          resolve({ ok: true, result: { installDir: 'C:\\Users\\User\\AppData\\Local\\Programs\\Nexa', exePath: 'C:\\Users\\User\\AppData\\Local\\Programs\\Nexa\\NexaSample.cmd' } });
        }
      }, 40);
    });

    return {
      getConfig: async () => ({
        mode: new URLSearchParams(location.search).get('uninstall') ? 'uninstall' : 'install',
        name: 'Nexa',
        publisher: 'Nexa',
        version: '0.0.0-dev',
        devMode: true,
        installSizeBytes: 4096,
        payloadSizeBytes: 4096,
        defaultInstallDir: 'C:\\Users\\User\\AppData\\Local\\Programs\\Nexa',
        existingVersion: null,
        existingInstallDir: null,
        defaults: { desktop: true, startMenu: true, launch: true },
        installDir: 'C:\\Users\\User\\AppData\\Local\\Programs\\Nexa',
        hasSettings: true
      }),
      chooseFolder: async () => null,
      validatePath: async (folder) => ({ valid: Boolean(folder), path: folder, freeBytes: 42 * 1024 ** 3, requiredBytes: 256 * 1024 ** 2, problems: folder ? [] : ['Choose an install folder.'] }),
      checkRunning: async () => ({ running: false, processes: [] }),
      closeInstalledApp: async () => ({ ok: true }),
      startInstall: () => runProgress('install', 3),
      startUninstall: () => runProgress('uninstall', 2),
      cancelAndClose: async () => ({ ok: true }),
      close: async () => ({ ok: true }),
      minimize: async () => ({ ok: true }),
      showLog: async () => ({ ok: true }),
      launch: async () => ({ ok: true }),
      onProgress: (callback) => subscribe('setup:progress', callback),
      onCloseRequest: (callback) => subscribe('setup:close-request', callback),
      onOperationComplete: (callback) => subscribe('setup:operation-complete', callback)
    };
  }

  const previewAllowed = /^https?:$/.test(location.protocol) && ['localhost', '127.0.0.1'].includes(location.hostname);
  const unavailableApi = new Proxy({}, {
    get(_target, property) {
      if (property === 'getConfig') return async () => { throw new Error('Installer services could not start. Restart the installer.'); };
      if (property === 'onProgress' || property === 'onCloseRequest' || property === 'onOperationComplete') return () => () => {};
      return async () => ({ ok: false, error: 'Installer services are unavailable.' });
    }
  });
  const api = window.nexaSetup || (previewAllowed ? createPreviewApi() : unavailableApi);
  const state = {
    mode: 'install',
    config: null,
    screen: null,
    options: { desktop: true, startMenu: true, launch: true },
    result: null,
    busy: false,
    activeKind: null,
    installOrigin: 'welcome',
    errorContext: 'install',
    errorReturn: 'welcome',
    removeData: false,
    targetProgress: 0,
    displayedProgress: 0,
    progressFrame: 0,
    progressStarted: 0,
    lastEtaUpdate: 0,
    launchTimer: 0,
    launched: false,
    validationTimer: 0,
    modalResolver: null,
    modalPreviousFocus: null,
    transitionToken: 0
  };

  const screens = [...document.querySelectorAll('[data-screen]')];
  const stepLabels = {
    welcome: '01 / 04',
    customize: '02 / 04',
    installing: '03 / 04',
    done: '04 / 04',
    error: '03 / 04',
    'uninstall-confirm': '01 / 03',
    uninstalling: '02 / 03',
    'uninstall-done': '03 / 03'
  };

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
    const units = ['B', 'KB', 'MB', 'GB'];
    const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
    const value = bytes / 1024 ** index;
    return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
  }

  function formatEta(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return 'Estimating';
    if (seconds < 5) return 'A few seconds';
    if (seconds < 60) return `About ${Math.ceil(seconds)} sec`;
    return `About ${Math.ceil(seconds / 60)} min`;
  }

  function setLeafFill(progress) {
    byId('brand-leaf').style.setProperty('--leaf-fill', String(Math.max(0, Math.min(1, progress))));
  }

  function updateStep(screen) {
    byId('step-index').textContent = stepLabels[screen] || '';
  }

  async function showScreen(name, immediate = false) {
    if (name === state.screen) return;
    const token = ++state.transitionToken;
    const previous = screens.find((screen) => screen.dataset.screen === state.screen);
    const next = screens.find((screen) => screen.dataset.screen === name);
    if (!next) return;

    if (previous && !immediate && !reducedMotion.matches) {
      previous.classList.add('is-leaving');
      await delay(180);
    }
    if (token !== state.transitionToken) return;
    if (previous) {
      previous.classList.remove('is-leaving');
      previous.hidden = true;
    }
    next.hidden = false;
    next.classList.remove('is-entering');
    state.screen = name;
    updateStep(name);
    if (!reducedMotion.matches) {
      void next.offsetWidth;
      next.classList.add('is-entering');
    }
  }

  function setStatus(element, text) {
    if (element.textContent === text) return;
    if (reducedMotion.matches) {
      element.textContent = text;
      return;
    }
    element.animate([{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'translateY(0)' }], {
      duration: 180,
      easing: 'cubic-bezier(0.22, 1, 0.36, 1)'
    });
    element.textContent = text;
  }

  function updateProgressUI() {
    const percentage = Math.max(0, Math.min(100, state.displayedProgress));
    const isInstall = state.activeKind === 'install';
    const percentageElement = byId(isInstall ? 'install-percentage' : 'uninstall-percentage');
    const track = byId(isInstall ? 'install-progress' : 'uninstall-progress');
    const fill = byId(isInstall ? 'install-progress-fill' : 'uninstall-progress-fill');
    percentageElement.textContent = `${percentage.toFixed(1)}%`;
    fill.style.transform = `scaleX(${percentage / 100})`;
    track.setAttribute('aria-valuenow', percentage.toFixed(1));
    window.NexaBackground?.setProgress(percentage / 100);
    if (isInstall) setLeafFill(percentage / 100);

    if (isInstall && performance.now() - state.lastEtaUpdate > 250) {
      state.lastEtaUpdate = performance.now();
      const elapsed = (performance.now() - state.progressStarted) / 1000;
      const eta = percentage > 1 ? elapsed * (100 - percentage) / percentage : 0;
      byId('install-eta').textContent = percentage >= 99.9 ? 'Finishing' : formatEta(eta);
    }
  }

  function progressLoop() {
    const difference = state.targetProgress - state.displayedProgress;
    state.displayedProgress += difference * (reducedMotion.matches ? 1 : 0.14);
    if (Math.abs(difference) < 0.02) state.displayedProgress = state.targetProgress;
    updateProgressUI();
    if (state.activeKind && state.displayedProgress !== state.targetProgress) {
      state.progressFrame = requestAnimationFrame(progressLoop);
    } else {
      state.progressFrame = 0;
    }
  }

  function ensureProgressLoop() {
    if (!state.progressFrame) state.progressFrame = requestAnimationFrame(progressLoop);
  }

  function startProgress(kind) {
    cancelAnimationFrame(state.progressFrame);
    state.activeKind = kind;
    state.targetProgress = 0;
    state.displayedProgress = 0;
    state.progressStarted = performance.now();
    state.lastEtaUpdate = 0;
    setLeafFill(0);
    updateProgressUI();
    ensureProgressLoop();
  }

  function stopProgress() {
    state.activeKind = null;
    cancelAnimationFrame(state.progressFrame);
    state.progressFrame = 0;
    window.NexaBackground?.setProgress(1);
    setLeafFill(1);
  }

  function handleProgress(event) {
    if (!state.activeKind || event.kind !== state.activeKind) return;
    state.targetProgress = Math.max(state.targetProgress, Math.min(1, event.data.progress)) * 100;
    const status = byId(state.activeKind === 'install' ? 'install-status' : 'uninstall-status');
    setStatus(status, event.data.status || 'Preparing');
    ensureProgressLoop();
  }

  function openModal({ title, message, confirmLabel, cancelLabel = 'Cancel', onConfirm }) {
    if (state.modalResolver) {
      state.modalResolver(false);
      closeModal(false);
    }
    state.modalPreviousFocus = document.activeElement;
    byId('modal-title').textContent = title;
    byId('modal-message').textContent = message;
    byId('modal-confirm').textContent = confirmLabel;
    byId('modal-cancel').textContent = cancelLabel;
    byId('modal-cancel').hidden = !cancelLabel;
    byId('modal-backdrop').hidden = false;
    return new Promise((resolve) => {
      state.modalResolver = resolve;
      byId(cancelLabel ? 'modal-cancel' : 'modal-confirm').focus();
    });
  }

  function closeModal(result) {
    if (!state.modalResolver) return;
    const resolve = state.modalResolver;
    state.modalResolver = null;
    byId('modal-backdrop').hidden = true;
    state.modalPreviousFocus?.focus?.();
    resolve(result);
  }

  function likelyCause(message) {
    if (/checksum|payload|package/i.test(message)) return 'The installer package may be damaged or incomplete.';
    if (/running|close it/i.test(message)) return 'Nexa may still be open. Close it, then try again.';
    if (/space|disk/i.test(message)) return 'The selected drive may not have enough available space.';
    if (/folder|writable|access|permission/i.test(message)) return 'Windows may be blocking access to the selected folder.';
    return 'The operation was interrupted before it could finish.';
  }

  function showError(message, context = state.mode) {
    const previous = state.screen;
    state.errorContext = context;
    state.errorReturn = context === 'uninstall'
      ? 'uninstall-confirm'
      : state.installOrigin === 'customize' ? 'customize' : 'welcome';
    if (previous === 'error') state.errorReturn = context === 'uninstall' ? 'uninstall-confirm' : state.installOrigin;
    byId('error-title').textContent = context === 'uninstall' ? 'Removal could not finish' : 'Setup could not finish';
    byId('error-message').textContent = message;
    byId('error-cause').textContent = likelyCause(message);
    byId('retry-button').textContent = context === 'launch' ? 'Launch' : 'Retry';
    stopProgress();
    showScreen('error');
  }

  async function validateCurrentPath() {
    clearTimeout(state.validationTimer);
    const folder = byId('install-path').value.trim();
    const button = byId('customize-install-button');
    const feedback = byId('path-feedback');
    button.disabled = true;
    feedback.classList.remove('is-error');
    feedback.textContent = 'Checking folder';
    try {
      const result = await api.validatePath(folder);
      if (byId('install-path').value.trim() !== folder) return;
      feedback.textContent = result.valid
        ? `${formatBytes(result.freeBytes)} available`
        : result.problems.join(' ');
      feedback.classList.toggle('is-error', !result.valid);
      button.disabled = !result.valid;
    } catch (error) {
      feedback.textContent = error.message || 'The selected folder cannot be used.';
      feedback.classList.add('is-error');
    }
  }

  function schedulePathValidation() {
    clearTimeout(state.validationTimer);
    state.validationTimer = setTimeout(validateCurrentPath, 220);
  }

  function readOptions() {
    state.options = {
      desktop: byId('desktop-shortcut').checked,
      startMenu: byId('start-menu-shortcut').checked,
      launch: byId('launch-when-finished').checked
    };
  }

  async function requestCancelInstall() {
    if (state.mode !== 'install' || !state.activeKind) return;
    const confirmed = await openModal({
      title: 'Cancel installation?',
      message: 'The installer will remove partial files and restore any previous version.',
      confirmLabel: 'Cancel installation',
      cancelLabel: 'Keep installing'
    });
    if (confirmed) await api.cancelAndClose();
  }

  async function launchApp() {
    if (!state.result?.exePath || state.launched) return;
    state.launched = true;
    const result = await api.launch(state.result.exePath);
    if (!result.ok) {
      state.launched = false;
      byId('done-message').textContent = 'Nexa could not be opened. Use Launch to try again.';
    }
  }

  async function runInstall() {
    if (state.busy) return;
    state.busy = true;
    const installDir = state.installOrigin === 'customize' ? byId('install-path').value.trim() : state.config.defaultInstallDir;
    if (state.installOrigin === 'customize') {
      const validation = await api.validatePath(installDir);
      if (!validation.valid) {
        state.busy = false;
        byId('path-feedback').textContent = validation.problems.join(' ');
        byId('path-feedback').classList.add('is-error');
        return;
      }
    }
    readOptions();
    state.result = null;
    state.launched = false;
    clearTimeout(state.launchTimer);
    await showScreen('installing');
    startProgress('install');
    try {
      const result = await api.startInstall({ installDir, ...state.options });
      if (!result.ok) throw new Error(result.error || 'The installation could not be completed.');
      state.result = result.result;
      stopProgress();
      byId('done-message').textContent = state.config.devMode
        ? 'The development build is ready.'
        : 'Your installation is complete.';
      await showScreen('done');
      if (state.options.launch) state.launchTimer = setTimeout(launchApp, 1000);
    } catch (error) {
      showError(error.message || 'The installation could not be completed.', 'install');
    } finally {
      state.busy = false;
    }
  }

  async function beginInstall() {
    if (state.busy || !state.config) return;
    state.busy = true;
    if (state.screen !== 'error') state.installOrigin = state.screen === 'customize' ? 'customize' : 'welcome';
    try {
      const running = await api.checkRunning();
      if (running.running) {
        const closeApp = await openModal({
          title: 'Close Nexa?',
          message: 'Nexa is running. Close it to continue the installation.',
          confirmLabel: 'Close app',
          cancelLabel: 'Cancel'
        });
        if (!closeApp) return;
        const result = await api.closeInstalledApp();
        if (!result.ok) throw new Error(result.error || 'Nexa could not be closed.');
      }
      state.busy = false;
      await runInstall();
    } catch (error) {
      showError(error.message || 'Nexa could not be closed.', 'install');
    } finally {
      state.busy = false;
    }
  }

  async function runUninstall() {
    if (state.busy) return;
    state.busy = true;
    state.removeData = byId('remove-data').checked;
    await showScreen('uninstalling');
    startProgress('uninstall');
    try {
      const result = await api.startUninstall({ removeData: state.removeData });
      if (!result.ok) throw new Error(result.error || 'Nexa could not be removed.');
      state.result = result.result;
      stopProgress();
      byId('uninstall-done-message').textContent = state.removeData
        ? 'The app, shortcuts, settings, and data have been removed.'
        : 'The app and its shortcuts have been removed. Your settings and data were kept.';
      await showScreen('uninstall-done');
    } catch (error) {
      showError(error.message || 'Nexa could not be removed.', 'uninstall');
    } finally {
      state.busy = false;
    }
  }

  async function closeWindow() {
    if (state.screen === 'installing') {
      await requestCancelInstall();
      return;
    }
    await api.close();
  }

  function bindEvents() {
    byId('minimize-button').addEventListener('click', () => api.minimize());
    byId('close-button').addEventListener('click', closeWindow);
    byId('install-button').addEventListener('click', beginInstall);
    byId('customize-button').addEventListener('click', async () => {
      readOptions();
      await showScreen('customize');
      await validateCurrentPath();
      byId('install-path').focus();
    });
    byId('browse-button').addEventListener('click', async () => {
      const folder = await api.chooseFolder();
      if (folder) {
        byId('install-path').value = folder;
        await validateCurrentPath();
      }
    });
    byId('install-path').addEventListener('input', schedulePathValidation);
    byId('options-form').addEventListener('submit', (event) => {
      event.preventDefault();
      beginInstall();
    });
    byId('customize-install-button').addEventListener('click', beginInstall);
    byId('back-button').addEventListener('click', () => showScreen('welcome'));
    byId('cancel-install-button').addEventListener('click', requestCancelInstall);
    byId('launch-button').addEventListener('click', launchApp);
    byId('done-close-button').addEventListener('click', () => api.close());
    byId('retry-button').addEventListener('click', () => {
      if (state.errorContext === 'uninstall') runUninstall();
      else if (state.errorContext === 'launch') launchApp();
      else beginInstall();
    });
    byId('show-log-button').addEventListener('click', () => api.showLog());
    byId('error-close-button').addEventListener('click', () => api.close());
    byId('remove-button').addEventListener('click', runUninstall);
    byId('uninstall-cancel-button').addEventListener('click', () => api.close());
    byId('uninstall-done-close-button').addEventListener('click', () => api.close());
    byId('modal-confirm').addEventListener('click', () => closeModal(true));
    byId('modal-cancel').addEventListener('click', () => closeModal(false));
    byId('modal-backdrop').addEventListener('click', (event) => {
      if (event.target === byId('modal-backdrop') && !byId('modal-cancel').hidden) closeModal(false);
    });

    api.onProgress(handleProgress);
    api.onCloseRequest(({ kind }) => {
      if (kind === 'uninstall') {
        openModal({
          title: 'Keep removal open',
          message: 'Removal cannot be cancelled safely. Keep this window open until it finishes.',
          confirmLabel: 'Continue',
          cancelLabel: null
        });
      } else {
        requestCancelInstall();
      }
    });

    document.addEventListener('keydown', (event) => {
      if (state.modalResolver) {
        if (event.key === 'Escape' && !byId('modal-cancel').hidden) {
          event.preventDefault();
          closeModal(false);
          return;
        }
        if (event.key === 'Tab') {
          const focusable = [...byId('modal-backdrop').querySelectorAll('button:not([hidden])')];
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }
        return;
      }

      if (event.key !== 'Escape') return;
      if (state.screen === 'installing') {
        event.preventDefault();
        requestCancelInstall();
      } else if (state.screen === 'customize') {
        event.preventDefault();
        showScreen('welcome');
      } else if (state.screen === 'error') {
        event.preventDefault();
        showScreen(state.errorReturn);
      } else if (state.screen === 'uninstall-confirm') {
        event.preventDefault();
        api.close();
      }
    });
  }

  async function initialize() {
    bindEvents();
    try {
      const config = await api.getConfig();
      state.config = config;
      state.mode = config.mode;
      state.options = { ...config.defaults };
      byId('brand-version').textContent = `Version ${config.version}`;
      byId('brand-mode').textContent = config.mode === 'uninstall' ? 'Uninstaller' : 'Windows installer';

      if (config.mode === 'uninstall') {
        byId('uninstall-version').textContent = config.version || 'Unknown';
        byId('uninstall-path').textContent = config.installDir || 'Install folder not found';
        await showScreen('uninstall-confirm', true);
      } else {
        byId('welcome-version').textContent = config.version;
        byId('welcome-size').textContent = formatBytes(config.installSizeBytes);
        byId('dev-label').hidden = !config.devMode;
        byId('install-path').value = config.defaultInstallDir;
        byId('desktop-shortcut').checked = config.defaults.desktop;
        byId('start-menu-shortcut').checked = config.defaults.startMenu;
        byId('launch-when-finished').checked = config.defaults.launch;
        if (config.existingVersion) document.querySelector('#welcome-screen .lede').textContent = 'Your existing installation will be updated.';
        byId('install-button').disabled = false;
        byId('customize-button').disabled = false;
        await showScreen('welcome', true);
        byId('brand-leaf').classList.add('is-drawing');
        setTimeout(() => byId('brand-leaf').classList.remove('is-drawing'), 1500);
      }
      byId('remove-button').disabled = !config.installDir;
    } catch (error) {
      state.config = state.config || { devMode: false, defaults: { desktop: true, startMenu: true, launch: true }, defaultInstallDir: '' };
      showError(error.message || 'The installer could not start.', state.mode);
    }
  }

  initialize();
})();
