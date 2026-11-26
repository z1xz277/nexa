import childProcess from 'node:child_process'
import type { Stats } from 'node:fs'
import { safeChildEnvironment } from './terminal'

interface FileIdentity {
  dev: number
  ino: number
}

interface RelativeRequest {
  op: 'mkdir' | 'unlink' | 'write' | 'readdir'
  name: string
  cwd: FileIdentity & { path: string }
  target?: FileIdentity | null
  content?: string
}

interface RelativeResult {
  stat: FileIdentity | null
  entries?: { name: string; kind: 'file' | 'dir' }[]
}

const HELPER = String.raw`
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const fail = (message, code = 1) => {
  process.stderr.write(message)
  process.exit(code)
}
const samePath = (a, b) => process.platform === 'win32'
  ? a.toLowerCase() === b.toLowerCase()
  : a === b
const sameIdentity = (a, b) => a && b && a.dev === b.dev && a.ino === b.ino
let input = ''
try {
  const chunks = []
  let size = 0
  const buffer = Buffer.allocUnsafe(65536)
  for (;;) {
    const chunk = fs.readSync(0, buffer, 0, buffer.length, null)
    if (chunk === 0) break
    size += chunk
    if (size > 64 * 1024 * 1024) fail('Project filesystem request is too large.', 2)
    chunks.push(buffer.subarray(0, chunk))
  }
  input = Buffer.concat(chunks).toString('utf8')
} catch {
  fail('Project filesystem request failed.', 1)
}
let req
try {
  req = JSON.parse(input)
} catch {
  fail('Invalid project filesystem request.', 2)
}
const checkCwd = () => {
  let cwd
  try {
    cwd = fs.lstatSync('.')
  } catch {
    fail('Project folder changed.', 2)
  }
  if (cwd.isSymbolicLink() || !cwd.isDirectory() ||
      !sameIdentity(cwd, req.cwd) || !samePath(fs.realpathSync('.'), req.cwd.path)) {
    fail('Project folder changed.', 2)
  }
}
checkCwd()
if ((req.op !== 'readdir' && (!req.name || req.name === '.' || req.name === '..')) ||
    (req.name && (path.basename(req.name) !== req.name || /[\\/]/.test(req.name)))) {
  fail('Invalid filesystem target.', 2)
}
const readTarget = () => {
  try {
    const stat = fs.lstatSync(req.name)
    if (stat.isSymbolicLink()) fail('Path contains an unresolved link.', 2)
    return stat
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}
try {
  let stat = null
  let temporary = null
  if (req.op === 'mkdir') {
    try {
      fs.mkdirSync(req.name)
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
    }
    stat = fs.lstatSync(req.name)
    if (stat.isSymbolicLink() || !stat.isDirectory()) fail('Invalid filesystem target.', 2)
  } else if (req.op === 'unlink') {
    stat = readTarget()
    if (!stat || stat.isDirectory() || !sameIdentity(stat, req.target)) fail('Project file changed.', 2)
    fs.unlinkSync(req.name)
    stat = null
  } else if (req.op === 'readdir') {
    stat = readTarget()
    if (!stat || !stat.isDirectory()) fail('Project folder changed.', 2)
    checkCwd()
    const entries = []
    for (const entry of fs.readdirSync('.', { withFileTypes: true })) {
      if (entry.isDirectory()) entries.push({ name: entry.name, kind: 'dir' })
      else if (entry.isFile()) entries.push({ name: entry.name, kind: 'file' })
    }
    checkCwd()
    process.stdout.write(JSON.stringify({ stat: { dev: stat.dev, ino: stat.ino }, entries }))
    process.exit(0)
  } else if (req.op === 'write') {
    if (typeof req.content !== 'string') fail('Invalid project file content.', 2)
    stat = readTarget()
    if (stat && (!stat.isFile() || stat.nlink > 1)) fail('Hard-linked or non-regular project files are not supported.', 2)
    for (let attempt = 0; attempt < 10; attempt++) {
      temporary = '.' + path.basename(req.name) + '.' + crypto.randomUUID() + '.nexa-tmp'
      try {
        const handle = fs.openSync(temporary, 'wx', 0o600)
        try {
          fs.writeFileSync(handle, req.content, 'utf8')
          fs.fsyncSync(handle)
        } finally {
          fs.closeSync(handle)
        }
        break
      } catch (error) {
        if (error.code !== 'EEXIST') throw error
        temporary = null
      }
    }
    if (!temporary) fail('Project filesystem operation failed.', 1)
    checkCwd()
    const current = readTarget()
    if (!(current === null && stat === null) && !sameIdentity(current, stat)) fail('Project file changed.', 2)
    fs.renameSync(temporary, req.name)
    temporary = null
    stat = readTarget()
    if (!stat || !stat.isFile() || stat.nlink > 1) fail('Project file changed.', 2)
  } else {
    fail('Invalid filesystem operation.', 2)
  }
  process.stdout.write(JSON.stringify({
    stat: stat ? { dev: stat.dev, ino: stat.ino } : null
  }))
} catch (error) {
  if (temporary) {
    try { fs.unlinkSync(temporary) } catch {}
  }
  fail(error && error.code === 'ENOENT' ? 'Project path no longer exists.' : 'Project filesystem operation failed.', error && error.code === 'ENOENT' ? 2 : 1)
}
`

function execute(cwd: string, request: RelativeRequest): Promise<RelativeResult> {
  return new Promise((resolve, reject) => {
    const child = childProcess.execFile(process.execPath, ['-e', HELPER], {
      cwd,
      env: { ...safeChildEnvironment(), ELECTRON_RUN_AS_NODE: '1' },
      windowsHide: true,
      timeout: 30_000,
      maxBuffer: 8 * 1024 * 1024
    }, (error, stdout, stderr) => {
      if (error) {
        const code = typeof error.code === 'number' ? error.code : undefined
        const message = code === 2 || /Project (folder|file) changed/.test(stderr)
          ? stderr.trim() || 'Project path changed.'
          : 'Project filesystem operation failed.'
        reject(new Error(message))
        return
      }
      try {
        resolve(JSON.parse(stdout) as RelativeResult)
      } catch {
        reject(new Error('Project filesystem operation failed.'))
      }
    })
    const input = child.stdin
    if (!input) {
      child.kill()
      reject(new Error('Project filesystem operation failed.'))
      return
    }
    input.on('error', () => {})
    input.end(JSON.stringify(request))
  })
}

export async function createRelativeDirectory(cwd: string, identity: Stats, name: string): Promise<FileIdentity> {
  const result = await execute(cwd, { op: 'mkdir', name, cwd: { path: cwd, dev: identity.dev, ino: identity.ino } })
  if (!result.stat) throw new Error('Project filesystem operation failed.')
  return result.stat
}

export async function removeRelativeFile(cwd: string, identity: Stats, name: string, target: Stats): Promise<void> {
  await execute(cwd, {
    op: 'unlink',
    name,
    cwd: { path: cwd, dev: identity.dev, ino: identity.ino },
    target: { dev: target.dev, ino: target.ino }
  })
}

export async function writeRelativeFile(
  cwd: string,
  identity: Stats,
  name: string,
  target: Stats | null,
  content: string
): Promise<FileIdentity> {
  const result = await execute(cwd, {
    op: 'write',
    name,
    cwd: { path: cwd, dev: identity.dev, ino: identity.ino },
    target: target ? { dev: target.dev, ino: target.ino } : null,
    content
  })
  if (!result.stat) throw new Error('Project filesystem operation failed.')
  return result.stat
}

export async function readRelativeDirectory(
  cwd: string,
  identity: Stats
): Promise<{ name: string; kind: 'file' | 'dir' }[]> {
  const result = await execute(cwd, {
    op: 'readdir',
    name: '.',
    cwd: { path: cwd, dev: identity.dev, ino: identity.ino }
  })
  if (!result.entries) throw new Error('Project filesystem operation failed.')
  return result.entries
}
