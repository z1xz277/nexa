import assert from 'node:assert/strict'
import test from 'node:test'
import { isTrustedIpc, isTrustedRendererUrl, parseProjectPatch } from '../src/main/ipc-validation.ts'

test('project patches allow only user editable fields', () => {
  assert.deepEqual(parseProjectPatch({
    name: 'Renamed',
    instructions: 'Keep changes focused.',
    defaultModel: 'model-1',
    defaultEffort: 'high',
    pinnedFiles: ['src/app.ts', 'PROJECT.md']
  }), {
    name: 'Renamed',
    instructions: 'Keep changes focused.',
    defaultModel: 'model-1',
    defaultEffort: 'high',
    pinnedFiles: ['src/app.ts', 'PROJECT.md']
  })
  for (const patch of [
    { path: 'C:/outside' },
    { id: 'other-project' },
    { createdAt: 0 },
    { name: 'x', unknown: true }
  ]) assert.throws(() => parseProjectPatch(patch), /Invalid project update/)
  assert.throws(() => parseProjectPatch({ pinnedFiles: ['../outside'] }), /Invalid project update/)
})

test('IPC accepts only the owning window main frame at the trusted renderer URL', () => {
  const rendererUrl = 'file:///C:/nexa/out/renderer/index.html'
  const frame = { url: rendererUrl }
  const sender = { id: 7, mainFrame: frame }
  const win = { webContents: sender }
  assert.equal(isTrustedIpc({ sender, senderFrame: frame }, win, rendererUrl), true)
  assert.equal(isTrustedIpc({ sender, senderFrame: { url: 'https://untrusted.example/' } }, win, rendererUrl), false)
  assert.equal(isTrustedIpc({ sender, senderFrame: {} }, win, rendererUrl), false)
  assert.equal(isTrustedIpc({ sender: { ...sender, id: 8 }, senderFrame: frame }, win, rendererUrl), false)
  assert.equal(isTrustedIpc({ sender, senderFrame: null }, win, rendererUrl), false)
})

test('renderer URL authorization is exact for files and origin-bound for development', () => {
  const bundled = 'file:///C:/nexa/out/renderer/index.html'
  assert.equal(isTrustedRendererUrl(bundled, bundled), true)
  assert.equal(isTrustedRendererUrl(`${bundled}#other`, bundled), false)
  assert.equal(isTrustedRendererUrl('https://untrusted.example/index.html', bundled), false)
  assert.equal(isTrustedRendererUrl('http://localhost:5173/workspace?view=code', 'http://localhost:5173'), true)
  assert.equal(isTrustedRendererUrl('http://localhost:5174/', 'http://localhost:5173'), false)
  assert.equal(isTrustedRendererUrl('not a URL', 'http://localhost:5173'), false)
})
