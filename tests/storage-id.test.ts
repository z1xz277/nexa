import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import { isStorageId, storagePath } from '../src/main/storage-id.ts'

test('storage ids reject traversal and separators', () => {
  for (const value of ['', '../escape', '..\\escape', 'nested/id', '/absolute', 'C:\\absolute', 'id.json', 'white space']) {
    assert.equal(isStorageId(value), false, value)
  }
  assert.equal(isStorageId('m1abc2-3_4'), true)
})

test('storage paths stay inside their data directory', () => {
  const root = path.resolve('data')
  assert.equal(storagePath(root, 'messages', 'session-1', '.json'), path.join(root, 'messages', 'session-1.json'))
  assert.throws(() => storagePath(root, 'messages', '../sessions', '.json'), /Invalid storage id/)
})
