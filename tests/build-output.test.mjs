import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

function check(source) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexa-build-check-'))
  try {
    const file = path.join(dir, 'index.js')
    fs.writeFileSync(file, source)
    return spawnSync(process.execPath, ['scripts/check-build.mjs', file], {
      cwd: process.cwd(),
      encoding: 'utf8',
      windowsHide: true
    })
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

test('build check rejects a main bundle without trusted-frame authorization', () => {
  const result = check('ipcMain.handle("terminal:input", handler)')
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /trusted.frame/i)
})

test('build check accepts the trusted-frame and renderer-origin authorization markers', () => {
  const result = check(`
    function isTrustedRendererUrl(url, rendererUrl) { return url === rendererUrl }
    function isTrustedIpc(event, window, rendererUrl) {
      return event.sender.id === window.webContents.id &&
        event.senderFrame === window.webContents.mainFrame &&
        isTrustedRendererUrl(event.senderFrame.url, rendererUrl)
    }
    webContents.on('will-navigate', (event, url) => {
      if (!isTrustedRendererUrl(url, rendererUrl)) event.preventDefault()
    })
    ipcMain.handle(channel, (event, ...args) => {
      if (!isTrustedIpc(event, win, rendererUrl)) throw new Error('Untrusted renderer request.')
      return listener(event, ...args)
    })
  `)
  assert.equal(result.status, 0, result.stderr)
})

test('build check rejects frame identity without renderer-origin authorization', () => {
  const result = check(`
    function isTrustedIpc(event, window) {
      return event.sender.id === window.webContents.id &&
        event.senderFrame === window.webContents.mainFrame
    }
    ipcMain.handle(channel, (event, ...args) => {
      if (!isTrustedIpc(event, win)) throw new Error('Untrusted renderer request.')
      return listener(event, ...args)
    })
  `)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /renderer.origin/i)
})

test('build check rejects direct IPC handlers beside the guard', () => {
  const result = check(`
    event.senderFrame === window.webContents.mainFrame
    throw new Error('Untrusted renderer request.')
    ipcMain.handle('terminal:input', handler)
  `)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /direct IPC/i)
})
