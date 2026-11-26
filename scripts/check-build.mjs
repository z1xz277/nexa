import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const input = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, 'out', 'main', 'index.js')

try {
  const source = fs.readFileSync(input, 'utf8')
  const required = [
    'Untrusted renderer request.',
    'senderFrame',
    'mainFrame',
    'senderFrame.url',
    'isTrustedRendererUrl',
    'will-navigate'
  ]
  if (/ipcMain\.handle\(\s*['"`]/.test(source)) {
    throw new Error('Build contains a direct IPC handler outside the trusted-frame guard.')
  }
  const missing = required.filter((marker) => !source.includes(marker))
  if (missing.length) {
    throw new Error(`Build is missing trusted-frame or renderer-origin authorization markers: ${missing.join(', ')}. Rebuild from the reviewed source.`)
  }
  if (!process.argv[2]) {
    for (const relative of ['out/preload/index.js', 'out/renderer/index.html']) {
      if (!fs.existsSync(path.join(root, relative))) throw new Error(`Build is missing ${relative}.`)
    }
  }
  console.log('Build authorization checks passed.')
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
