import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { CheckpointVault, type CheckpointCodec } from '../src/main/checkpoint-vault.ts'
import type { Checkpoint } from '../src/shared/types.ts'

function codec(available = true): CheckpointCodec {
  const key = randomBytes(32)
  return {
    isEncryptionAvailable: () => available,
    encrypt(value) {
      const iv = randomBytes(12)
      const cipher = createCipheriv('aes-256-gcm', key, iv)
      const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
      return Buffer.concat([iv, cipher.getAuthTag(), encrypted])
    },
    decrypt(value) {
      const decipher = createDecipheriv('aes-256-gcm', key, value.subarray(0, 12))
      decipher.setAuthTag(value.subarray(12, 28))
      return Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString('utf8')
    }
  }
}

function fixture(t: test.TestContext, available = true) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexa-checkpoint-vault-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return { root, vault: new CheckpointVault(root, codec(available)) }
}

const metadata: Checkpoint = {
  id: 'checkpoint-1',
  sessionId: 'session-1',
  ts: 1,
  label: 'src/app.ts',
  files: [{ path: 'src/app.ts', existed: true }]
}

test('checkpoint vault encrypts raw snapshots and never stores them in metadata', (t) => {
  const { root, vault } = fixture(t)
  vault.save(metadata, [{ path: 'src/app.ts', before: 'opaque-secret-value' }])
  const metaFile = path.join(root, 'checkpoints.json')
  const payloadFile = path.join(root, 'checkpoint-data', 'checkpoint-1.bin')
  assert.equal(fs.readFileSync(metaFile, 'utf8').includes('opaque-secret-value'), false)
  assert.equal(fs.readFileSync(payloadFile).toString('base64').includes('opaque-secret-value'), false)
  assert.deepEqual(vault.list(), [metadata])
  assert.deepEqual(vault.read('checkpoint-1'), [{ path: 'src/app.ts', before: 'opaque-secret-value' }])
})

test('checkpoint vault fails closed when encryption is unavailable', (t) => {
  const { vault } = fixture(t, false)
  assert.throws(() => vault.save(metadata, [{ path: 'src/app.ts', before: 'raw' }]), /encryption/i)
  assert.deepEqual(vault.list(), [])
})

test('checkpoint vault rejects missing, corrupt, and mismatched snapshots', (t) => {
  const { root, vault } = fixture(t)
  vault.save(metadata, [{ path: 'src/app.ts', before: 'raw' }])
  const payloadFile = path.join(root, 'checkpoint-data', 'checkpoint-1.bin')
  fs.writeFileSync(payloadFile, 'corrupt')
  assert.throws(() => vault.read('checkpoint-1'), /decrypt|invalid/i)
  fs.rmSync(payloadFile)
  assert.throws(() => vault.read('checkpoint-1'), /missing|unavailable/i)
  fs.writeFileSync(path.join(root, 'checkpoints.json'), JSON.stringify([{ ...metadata, id: 'other' }]))
  assert.throws(() => vault.read('checkpoint-1'), /missing|unavailable/i)
})

test('checkpoint vault rejects mismatched snapshot paths', (t) => {
  const { vault } = fixture(t)
  vault.save(metadata, [{ path: 'other.ts', before: 'raw' }])
  assert.throws(() => vault.read('checkpoint-1'), /invalid|mismatch/i)
})

test('checkpoint vault removes session snapshots with their metadata', (t) => {
  const { root, vault } = fixture(t)
  vault.save(metadata, [{ path: 'src/app.ts', before: 'raw' }])
  vault.removeSession('session-1')
  assert.deepEqual(vault.list(), [])
  assert.equal(fs.existsSync(path.join(root, 'checkpoint-data', 'checkpoint-1.bin')), false)
})

test('checkpoint vault upgrades legacy raw metadata to encrypted snapshots', (t) => {
  const { root, vault } = fixture(t)
  const metadataFile = path.join(root, 'checkpoints.json')
  fs.writeFileSync(metadataFile, JSON.stringify([{
    ...metadata,
    files: [{ path: 'src/app.ts', before: 'legacy-opaque-secret' }]
  }]))
  assert.deepEqual(vault.list(), [metadata])
  assert.deepEqual(vault.read(metadata.id), [{ path: 'src/app.ts', before: 'legacy-opaque-secret' }])
  assert.equal(fs.readFileSync(metadataFile, 'utf8').includes('legacy-opaque-secret'), false)
  assert.equal(fs.readFileSync(path.join(root, 'checkpoint-data', 'checkpoint-1.bin')).toString('base64').includes('legacy-opaque-secret'), false)
})

test('checkpoint vault leaves legacy metadata untouched when encryption is unavailable', (t) => {
  const { root, vault } = fixture(t, false)
  const metadataFile = path.join(root, 'checkpoints.json')
  const legacy = JSON.stringify([{ ...metadata, files: [{ path: 'src/app.ts', before: 'legacy-raw' }] }])
  fs.writeFileSync(metadataFile, legacy)
  assert.throws(() => vault.list(), /encryption/i)
  assert.equal(fs.readFileSync(metadataFile, 'utf8'), legacy)
  assert.equal(fs.existsSync(path.join(root, 'checkpoint-data', 'checkpoint-1.bin')), false)
})

test('checkpoint vault rejects malformed legacy metadata without rewriting it', (t) => {
  const { root, vault } = fixture(t)
  const metadataFile = path.join(root, 'checkpoints.json')
  const malformed = JSON.stringify([{ ...metadata, files: [{ path: 'src/app.ts', before: 42 }] }])
  fs.writeFileSync(metadataFile, malformed)
  assert.throws(() => vault.list(), /invalid/i)
  assert.equal(fs.readFileSync(metadataFile, 'utf8'), malformed)
  assert.equal(fs.existsSync(path.join(root, 'checkpoint-data', 'checkpoint-1.bin')), false)
})
