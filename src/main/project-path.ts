import fs from 'node:fs'
import fsPromises from 'node:fs/promises'
import { constants, type Stats } from 'node:fs'
import path from 'node:path'
import { createRelativeDirectory, readRelativeDirectory, removeRelativeFile, writeRelativeFile } from './relative-fs'

interface ProjectRoot {
  path: string
  dev: number
  ino: number
}

const projectRoots = new Map<string, ProjectRoot>()

function projectRoot(base: string): string {
  const absolute = path.resolve(base)
  const key = process.platform === 'win32' ? absolute.toLowerCase() : absolute
  const root = fs.realpathSync(absolute)
  const stat = fs.lstatSync(root)
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Project folder changed or was replaced.')
  const previous = projectRoots.get(key)
  if (previous && (!samePath(previous.path, root) || previous.dev !== stat.dev || previous.ino !== stat.ino)) {
    throw new Error('Project folder changed or was replaced.')
  }
  if (!previous) projectRoots.set(key, { path: root, dev: stat.dev, ino: stat.ino })
  return root
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

function canonicalize(abs: string): string {
  let current = abs
  const missing: string[] = []
  for (;;) {
    try {
      return path.resolve(fs.realpathSync(current), ...missing.reverse())
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? error.code : undefined
      if (code !== 'ENOENT' && code !== 'ENOTDIR') throw error
      try {
        fs.lstatSync(current)
        throw new Error('Path contains an unresolved link.')
      } catch (linkError) {
        const linkCode = linkError instanceof Error && 'code' in linkError ? linkError.code : undefined
        if (linkCode !== 'ENOENT' && linkCode !== 'ENOTDIR') throw linkError
      }
      const parent = path.dirname(current)
      if (parent === current) throw error
      missing.push(path.basename(current))
      current = parent
    }
  }
}

export function resolveProjectPath(base: string | null, rel: string): { abs: string; inside: boolean } {
  if (base === null) return { abs: path.resolve(rel), inside: false }
  const root = projectRoot(base)
  const resolved = path.resolve(root, rel)
  if (!isWithin(root, resolved)) return { abs: resolved, inside: false }
  const canonical = canonicalize(resolved)
  return { abs: canonical, inside: isWithin(root, canonical) }
}

export function requireProjectPath(base: string | null, rel: string): string {
  const resolved = resolveProjectPath(base, rel)
  if (!resolved.inside) throw new Error('Path is outside the project folder.')
  return resolved.abs
}

function samePath(a: string, b: string): boolean {
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
}

async function ensureProjectDirectory(base: string, target: string, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted()
  const root = projectRoot(base)
  const relative = path.relative(root, target)
  if (!isWithin(root, target)) throw new Error('Path is outside the project folder.')
  let current = root
  for (const part of relative.split(path.sep).filter(Boolean)) {
    signal?.throwIfAborted()
    const next = path.join(current, part)
    let stat: Stats
    try {
      stat = await fsPromises.lstat(next)
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
      const parent = await fsPromises.lstat(current)
      signal?.throwIfAborted()
      if (parent.isSymbolicLink() || !parent.isDirectory()) throw new Error('Project folder changed or was replaced.')
      requireProjectPath(base, current)
      signal?.throwIfAborted()
      const created = await createRelativeDirectory(current, parent, part)
      signal?.throwIfAborted()
      stat = await fsPromises.lstat(next)
      if (created.dev !== stat.dev || created.ino !== stat.ino) throw new Error('Project folder changed or was replaced.')
    }
    signal?.throwIfAborted()
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Path contains an unresolved link.')
    requireProjectPath(base, next)
    current = next
  }
}

async function assertOpenFile(base: string | null, abs: string, handle: fsPromises.FileHandle): Promise<Stats> {
  const current = requireProjectPath(base, abs)
  if (!samePath(current, abs)) throw new Error('Path changed while it was being opened.')
  const [opened, disk] = await Promise.all([handle.stat(), fsPromises.lstat(current)])
  if (disk.isSymbolicLink() || opened.dev !== disk.dev || opened.ino !== disk.ino) {
    throw new Error('Path changed while it was being opened.')
  }
  if (!opened.isFile() || opened.nlink > 1) throw new Error('Hard-linked or non-regular project files are not supported.')
  return opened
}

export async function readProjectFile(base: string | null, rel: string, maxBytes?: number): Promise<string> {
  const abs = requireProjectPath(base, rel)
  const handle = await fsPromises.open(abs, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const stat = await assertOpenFile(base, abs, handle)
    if (maxBytes !== undefined && stat.size > maxBytes) throw new Error('File is larger than 2 MB.')
    return handle.readFile('utf8')
  } finally {
    await handle.close()
  }
}

export async function readProjectFileSnapshot(base: string | null, rel: string): Promise<string | null> {
  try {
    return await readProjectFile(base, rel)
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null
    throw error
  }
}

export async function readProjectDirectory(base: string | null, rel: string): Promise<{ name: string; kind: 'file' | 'dir' }[]> {
  const normalized = rel === '.' ? '' : rel
  const abs = requireProjectPath(base, normalized)
  const before = await fsPromises.lstat(abs)
  if (before.isSymbolicLink() || !before.isDirectory()) throw new Error('Path contains an unresolved link.')
  const entries = await readRelativeDirectory(abs, before)
  requireProjectPath(base, normalized)
  const closed = await fsPromises.lstat(abs)
  if (closed.isSymbolicLink() || !closed.isDirectory() || closed.dev !== before.dev || closed.ino !== before.ino) {
    throw new Error('Path changed while it was being opened.')
  }
  return entries
}

export async function removeProjectFile(base: string | null, rel: string): Promise<void> {
  const abs = requireProjectPath(base, rel)
  const handle = await fsPromises.open(abs, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  let opened: Stats
  try {
    opened = await assertOpenFile(base, abs, handle)
  } finally {
    await handle.close()
  }
  const parent = requireProjectPath(base, path.dirname(abs))
  const identity = await fsPromises.lstat(parent)
  if (identity.isSymbolicLink() || !identity.isDirectory()) throw new Error('Project folder changed or was replaced.')
  await removeRelativeFile(parent, identity, path.basename(abs), opened)
  requireProjectPath(base, parent)
}

export async function restoreProjectFiles(base: string | null, files: { path: string; before: string | null }[]): Promise<void> {
  if (base === null) throw new Error('Project folder is missing.')
  const targets = new Map<string, { path: string; abs: string; before: string | null; current: string | null }>()
  for (const file of files) {
    const abs = requireProjectPath(base, file.path)
    const key = process.platform === 'win32' ? abs.toLowerCase() : abs
    if (targets.has(key)) throw new Error('Checkpoint contains duplicate file paths.')
    if (file.before !== null && typeof file.before !== 'string') throw new Error('Checkpoint file data is invalid.')
    targets.set(key, { path: file.path, abs, before: file.before, current: await readProjectFileSnapshot(base, file.path) })
  }
  const changed: { path: string; current: string | null }[] = []
  try {
    for (const target of targets.values()) {
      changed.push(target)
      if (target.before === null) {
        if (target.current !== null) await removeProjectFile(base, target.path)
      } else if (target.current !== target.before) {
        await writeProjectFile(base, target.path, target.before)
      }
    }
  } catch (error) {
    const rollbackErrors: unknown[] = []
    for (const target of changed.reverse()) {
      try {
        if (target.current === null) {
          try { await removeProjectFile(base, target.path) } catch (rollbackError) {
            if (!(rollbackError instanceof Error && 'code' in rollbackError && rollbackError.code === 'ENOENT')) throw rollbackError
          }
        } else {
          await writeProjectFile(base, target.path, target.current)
        }
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError)
      }
    }
    if (rollbackErrors.length) throw new Error('Checkpoint restore failed and rollback was incomplete.')
    throw error
  }
}

export async function writeProjectFile(base: string | null, rel: string, content: string, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted()
  const abs = requireProjectPath(base, rel)
  if (base === null) throw new Error('Project folder is missing.')
  await ensureProjectDirectory(base, path.dirname(abs), signal)
  signal?.throwIfAborted()
  const current = requireProjectPath(base, abs)
  if (!samePath(current, abs)) throw new Error('Path changed while it was being opened.')
  const parentPath = requireProjectPath(base, path.dirname(current))
  const parent = await fsPromises.lstat(parentPath)
  if (parent.isSymbolicLink() || !parent.isDirectory()) throw new Error('Project folder changed or was replaced.')
  let target: Stats | null = null
  try {
    target = await fsPromises.lstat(current)
    if (target.isSymbolicLink()) throw new Error('Path contains an unresolved link.')
    if (!target.isFile() || target.nlink > 1) throw new Error('Hard-linked or non-regular project files are not supported.')
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
  }
  signal?.throwIfAborted()
  const written = await writeRelativeFile(parentPath, parent, path.basename(current), target, content)
  signal?.throwIfAborted()
  const final = await fsPromises.lstat(current)
  if (final.isSymbolicLink() || !final.isFile() || final.nlink > 1 || written.dev !== final.dev || written.ino !== final.ino) {
    throw new Error('Project file changed after it was written.')
  }
}
