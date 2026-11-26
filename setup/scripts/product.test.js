const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { PRODUCT, dataDirectories, installDirectory } = require('../src/main/product');

test('setup uses the Nexa desktop identity without legacy branding', () => {
  assert.equal(PRODUCT.name, 'Nexa');
  assert.equal(PRODUCT.setupName, 'Nexa Setup');
  assert.equal(PRODUCT.publisher, 'Nexa');
  assert.equal(PRODUCT.appUserModelId, 'nexa.desktop');
  assert.equal(PRODUCT.setupAppUserModelId, 'nexa.desktop.setup');
  assert.equal(PRODUCT.uninstallKey, 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Nexa');
  assert.doesNotMatch(JSON.stringify(PRODUCT), /zyink/i);
});

test('installed app and user data paths match the Electron product name', () => {
  const local = 'C:\\Users\\Test\\AppData\\Local';
  const roaming = 'C:\\Users\\Test\\AppData\\Roaming';
  assert.equal(installDirectory(local), path.join(local, 'Programs', 'Nexa'));
  assert.deepEqual(dataDirectories(roaming, local), [
    path.join(roaming, 'nexa'),
    path.join(local, 'nexa')
  ]);
});
