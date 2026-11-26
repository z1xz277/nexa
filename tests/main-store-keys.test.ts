import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { registerHooks } from 'node:module'
import test from 'node:test'

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'nexa-key-store-'))
const appPath = path.join(temporary, 'app')
const userData = path.join(temporary, 'data')
fs.mkdirSync(appPath, { recursive: true })

const electronStub = `
export const app = {
  getAppPath: () => ${JSON.stringify(appPath)},
  getPath: () => ${JSON.stringify(userData)}
}
export const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(value),
  decryptString: (value) => value.toString()
}
`

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'electron') {
      return { url: `data:text/javascript,${encodeURIComponent(electronStub)}`, shortCircuit: true }
    }
    return nextResolve(specifier, context)
  }
})

process.env.NEXA_NVIDIA_KEY = 'environment-test-key'

test('explicit key changes override environment credentials and invalidate model cache', async () => {
  try {
    const { store } = await import('../src/main/store.ts')
    assert.equal(store.getKey('nvidia'), 'environment-test-key')

    store.modelCache.set('nvidia', [])
    store.setKey('nvidia', 'replacement-test-key')
    assert.equal(store.getKey('nvidia'), 'replacement-test-key')
    assert.equal(store.modelCache.get('nvidia'), null)

    store.modelCache.set('nvidia', [])
    store.clearKey('nvidia')
    assert.equal(store.getKey('nvidia'), null)
    assert.equal(store.modelCache.get('nvidia'), null)
  } finally {
    delete process.env.NEXA_NVIDIA_KEY
    fs.rmSync(temporary, { recursive: true, force: true })
  }
})
