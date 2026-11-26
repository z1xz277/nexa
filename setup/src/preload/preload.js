const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  const listener = (event, data) => callback(data);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('nexaSetup', {
  getConfig: () => ipcRenderer.invoke('setup:config'),
  chooseFolder: () => ipcRenderer.invoke('setup:choose-folder'),
  validatePath: (folder) => ipcRenderer.invoke('setup:validate-path', folder),
  checkRunning: () => ipcRenderer.invoke('setup:check-running'),
  closeInstalledApp: () => ipcRenderer.invoke('setup:close-installed-app'),
  startInstall: (input) => ipcRenderer.invoke('setup:start-install', input),
  startUninstall: (input) => ipcRenderer.invoke('setup:start-uninstall', input),
  cancelAndClose: () => ipcRenderer.invoke('setup:cancel-and-close'),
  close: () => ipcRenderer.invoke('setup:close'),
  minimize: () => ipcRenderer.invoke('setup:minimize'),
  showLog: () => ipcRenderer.invoke('setup:show-log'),
  launch: (exePath) => ipcRenderer.invoke('setup:launch', exePath),
  onProgress: (callback) => subscribe('setup:progress', callback),
  onCloseRequest: (callback) => subscribe('setup:close-request', callback),
  onOperationComplete: (callback) => subscribe('setup:operation-complete', callback)
});
