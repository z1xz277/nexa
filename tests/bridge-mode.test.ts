import assert from 'node:assert/strict'
import test from 'node:test'
import { isBrowserPreview } from '../src/renderer/bridge-mode.ts'

test('scripted bridge is limited to the local development preview', () => {
  assert.equal(isBrowserPreview({ dev: true, hostname: 'localhost', port: '5173' }), true)
  assert.equal(isBrowserPreview({ dev: true, hostname: '127.0.0.1', port: '5173' }), true)
  assert.equal(isBrowserPreview({ dev: true, hostname: 'evil.example', port: '5173' }), false)
  assert.equal(isBrowserPreview({ dev: true, hostname: 'localhost', port: '3000' }), false)
  assert.equal(isBrowserPreview({ dev: false, hostname: 'localhost', port: '5173' }), false)
})
