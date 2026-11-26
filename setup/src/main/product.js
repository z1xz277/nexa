const path = require('node:path');

const PRODUCT = Object.freeze({
  name: 'Nexa',
  setupName: 'Nexa Setup',
  sampleName: 'Nexa Sample',
  publisher: 'Nexa',
  appUserModelId: 'nexa.desktop',
  setupAppUserModelId: 'nexa.desktop.setup',
  uninstallKey: 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Nexa',
  installFolder: 'Nexa',
  dataFolder: 'nexa'
});

function installDirectory(localAppData) {
  return path.join(localAppData, 'Programs', PRODUCT.installFolder);
}

function dataDirectories(roaming, local) {
  return [path.join(roaming, PRODUCT.dataFolder), path.join(local, PRODUCT.dataFolder)];
}

module.exports = { PRODUCT, dataDirectories, installDirectory };
