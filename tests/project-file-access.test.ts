import assert from 'node:assert/strict'
import childProcess from 'node:child_process'
import fsSync from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import * as projectPath from '../src/main/project-path.ts'

type SecureProjectFs = {
  readProjectFile(base: string, rel: string): Promise<string>
  readProjectFileSnapshot(base: string, rel: string): Promise<string | null>
  readProjectDirectory(base: string, rel: string): Promise<{ name: string; kind: 'file' | 'dir' }[]>
  restoreProjectFiles(base: string, files: { path: string; before: string | null }[]): Promise<void>
  writeProjectFile(base: string, rel: string, content: string, signal?: AbortSignal): Promise<void>
  removeProjectFile(base: string, rel: string): Promise<void>
}

async function fixture(t: test.TestContext) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nexa-project-fs-'))
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'nexa-project-outside-'))
  const project = path.join(root, 'project')
  await fs.mkdir(path.join(project, 'nested'), { recursive: true })
  await fs.writeFile(path.join(project, 'nested', 'file.txt'), 'inside')
  await fs.writeFile(path.join(outside, 'file.txt'), 'outside')
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true })
    await fs.rm(outside, { recursive: true, force: true })
  })
  return { project, outside }
}

function interceptPathBoundary(
  t: test.TestContext,
  parent: string,
  outside: string,
  trigger: string,
  method: 'mkdir' | 'rm'
): void {
  const original = fs[method].bind(fs) as (...args: any[]) => Promise<unknown>
  const originalExecFile = childProcess.execFile.bind(childProcess)
  const triggerPath = path.resolve(trigger)
  let swapped = false
  const swap = () => {
    if (swapped) return
    swapped = true
    fsSync.renameSync(parent, `${parent}-safe`)
    fsSync.symlinkSync(outside, parent, 'junction')
  }
  t.mock.method(fs, method, ((...args: any[]) => {
    if (path.resolve(args[0]) === triggerPath) swap()
    return original(...args)
  }) as typeof fs[typeof method])
  t.mock.method(childProcess, 'execFile', ((...args: any[]) => {
    const options = args[2] as { cwd?: string } | undefined
    if (options?.cwd && path.resolve(options.cwd) === path.resolve(parent)) swap()
    return (originalExecFile as any)(...args)
  }) as typeof childProcess.execFile)
}

test('outside paths are rejected before target canonicalization', async (t) => {
  const { project, outside } = await fixture(t)
  projectPath.resolveProjectPath(project, '.')
  const target = path.join(outside, 'file.txt')
  const original = fsSync.realpathSync.bind(fsSync)
  let touched = false
  t.mock.method(fsSync, 'realpathSync', ((value: fsSync.PathLike) => {
    if (path.resolve(String(value)) === target) {
      touched = true
      throw Object.assign(new Error('Blocked target resolution.'), { code: 'EBLOCKED' })
    }
    return original(value)
  }) as typeof fsSync.realpathSync)
  assert.equal(projectPath.resolveProjectPath(project, target).inside, false)
  assert.equal(touched, false)
})

test('UNC paths are rejected before Windows can resolve the network share', { skip: process.platform !== 'win32' }, async (t) => {
  const { project } = await fixture(t)
  projectPath.resolveProjectPath(project, '.')
  const target = '\\\\attacker.example\\share\\secret.txt'
  const original = fsSync.realpathSync.bind(fsSync)
  let touched = false
  t.mock.method(fsSync, 'realpathSync', ((value: fsSync.PathLike) => {
    if (String(value).toLowerCase() === target.toLowerCase()) {
      touched = true
      throw Object.assign(new Error('Blocked UNC resolution.'), { code: 'EBLOCKED' })
    }
    return original(value)
  }) as typeof fsSync.realpathSync)
  assert.equal(projectPath.resolveProjectPath(project, target).inside, false)
  assert.equal(touched, false)
})

test('secure file helpers read and write nested project files', async (t) => {
  const { project } = await fixture(t)
  const secure = projectPath as unknown as SecureProjectFs
  await secure.writeProjectFile(project, 'new/deep/file.txt', 'created')
  assert.equal(await secure.readProjectFile(project, 'new/deep/file.txt'), 'created')
  assert.equal(await fs.readFile(path.join(project, 'nested', 'file.txt'), 'utf8'), 'inside')
})

test('project reads reject hard links to files outside the project', async (t) => {
  const { project, outside } = await fixture(t)
  const secure = projectPath as unknown as SecureProjectFs
  await fs.link(path.join(outside, 'file.txt'), path.join(project, 'nested', 'alias.txt'))
  await assert.rejects(secure.readProjectFile(project, 'nested/alias.txt'), /hard.link/i)
})

test('project writes reject hard links to files outside the project', async (t) => {
  const { project, outside } = await fixture(t)
  const secure = projectPath as unknown as SecureProjectFs
  await fs.link(path.join(outside, 'file.txt'), path.join(project, 'nested', 'alias.txt'))
  await assert.rejects(secure.writeProjectFile(project, 'nested/alias.txt', 'attacker content'), /hard.link/i)
  assert.equal(await fs.readFile(path.join(outside, 'file.txt'), 'utf8'), 'outside')
})

test('an aborted project write leaves existing files and missing directories untouched', async (t) => {
  const { project } = await fixture(t)
  const secure = projectPath as unknown as SecureProjectFs
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(secure.writeProjectFile(project, 'nested/file.txt', 'replacement', controller.signal), /abort/i)
  await assert.rejects(secure.writeProjectFile(project, 'missing/deep/file.txt', 'replacement', controller.signal), /abort/i)
  assert.equal(await fs.readFile(path.join(project, 'nested', 'file.txt'), 'utf8'), 'inside')
  await assert.rejects(fs.stat(path.join(project, 'missing')), { code: 'ENOENT' })
})

test('a parent junction swapped after opening a file cannot expose outside content', async (t) => {
  const { project, outside } = await fixture(t)
  const secure = projectPath as unknown as SecureProjectFs
  const originalOpen = fs.open.bind(fs)
  let swapped = false
  t.mock.method(fs, 'open', async (...args: Parameters<typeof fs.open>) => {
    const handle = await originalOpen(...args)
    await handle.close()
    if (!swapped) {
      swapped = true
      await fs.rename(path.join(project, 'nested'), path.join(project, 'nested-safe'))
      await fs.symlink(outside, path.join(project, 'nested'), 'junction')
    }
    return handle
  })
  await assert.rejects(secure.readProjectFile(project, 'nested/file.txt'), /outside the project|unresolved link/i)
  assert.equal(await fs.readFile(path.join(outside, 'file.txt'), 'utf8'), 'outside')
})

test('a parent junction swapped before an atomic write cannot overwrite outside content', async (t) => {
  const { project, outside } = await fixture(t)
  const secure = projectPath as unknown as SecureProjectFs
  const parent = path.join(project, 'nested')
  const originalExecFile = childProcess.execFile.bind(childProcess)
  let swapped = false
  t.mock.method(childProcess, 'execFile', ((...args: any[]) => {
    const options = args[2] as { cwd?: string } | undefined
    if (!swapped && options?.cwd && path.resolve(options.cwd) === path.resolve(parent)) {
      swapped = true
      fsSync.renameSync(parent, `${parent}-safe`)
      fsSync.symlinkSync(outside, parent, 'junction')
    }
    return (originalExecFile as any)(...args)
  }) as typeof childProcess.execFile)
  await assert.rejects(secure.writeProjectFile(project, 'nested/file.txt', 'attacker content'), /outside the project|project folder changed|unresolved link/i)
  assert.equal(await fs.readFile(path.join(outside, 'file.txt'), 'utf8'), 'outside')
  assert.equal(await fs.readFile(path.join(parent, 'file.txt'), 'utf8'), 'outside')
  assert.equal(await fs.readFile(path.join(project, 'nested-safe', 'file.txt'), 'utf8'), 'inside')
})

test('a parent junction swapped after opening a file cannot delete an outside file', async (t) => {
  const { project, outside } = await fixture(t)
  const secure = projectPath as unknown as SecureProjectFs
  const originalOpen = fs.open.bind(fs)
  let swapped = false
  t.mock.method(fs, 'open', async (...args: Parameters<typeof fs.open>) => {
    const handle = await originalOpen(...args)
    await handle.close()
    if (!swapped) {
      swapped = true
      await fs.rename(path.join(project, 'nested'), path.join(project, 'nested-safe'))
      await fs.symlink(outside, path.join(project, 'nested'), 'junction')
    }
    return handle
  })
  await assert.rejects(secure.removeProjectFile(project, 'nested/file.txt'), /outside the project|unresolved link/i)
  assert.equal(await fs.readFile(path.join(outside, 'file.txt'), 'utf8'), 'outside')
})

test('a replaced project root cannot redirect later file operations', async (t) => {
  const { project, outside } = await fixture(t)
  const secure = projectPath as unknown as SecureProjectFs
  assert.equal(await secure.readProjectFile(project, 'nested/file.txt'), 'inside')
  await fs.mkdir(path.join(outside, 'nested'))
  await fs.writeFile(path.join(outside, 'nested', 'file.txt'), 'outside')
  await fs.rename(project, `${project}-safe`)
  await fs.symlink(outside, project, 'junction')
  await assert.rejects(secure.readProjectFile(project, 'nested/file.txt'), /project folder changed/i)
})

test('directory enumeration cannot expose outside entries during a swap and restore', async (t) => {
  const { project, outside } = await fixture(t)
  const secure = projectPath as unknown as SecureProjectFs
  await fs.writeFile(path.join(outside, 'secret.txt'), 'outside')
  assert.deepEqual(await secure.readProjectDirectory(project, 'nested'), [{ name: 'file.txt', kind: 'file' }])
  const parent = path.join(project, 'nested')
  const originalOpenDir = fs.opendir.bind(fs)
  const originalExecFile = childProcess.execFile.bind(childProcess)
  let swapped = false
  t.mock.method(fs, 'opendir', async (...args: Parameters<typeof fs.opendir>) => {
    if (!swapped && path.resolve(String(args[0])) === parent) {
      swapped = true
      await fs.rename(parent, `${parent}-safe`)
      await fs.symlink(outside, parent, 'junction')
      const handle = await originalOpenDir(...args)
      await fs.rename(parent, `${parent}-link`)
      await fs.rename(`${parent}-safe`, parent)
      return handle
    }
    return originalOpenDir(...args)
  })
  t.mock.method(childProcess, 'execFile', ((...args: any[]) => {
    const options = args[2] as { cwd?: string } | undefined
    if (!swapped && options?.cwd && path.resolve(options.cwd) === parent) {
      swapped = true
      fsSync.renameSync(parent, `${parent}-safe`)
      fsSync.symlinkSync(outside, parent, 'junction')
      const child = (originalExecFile as any)(...args)
      fsSync.renameSync(parent, `${parent}-link`)
      fsSync.renameSync(`${parent}-safe`, parent)
      return child
    }
    return (originalExecFile as any)(...args)
  }) as typeof childProcess.execFile)
  let entries: { name: string; kind: 'file' | 'dir' }[] = []
  try {
    entries = await secure.readProjectDirectory(project, 'nested')
  } catch (error) {
    assert.match(String(error), /outside the project|unresolved link|changed/i)
    return
  }
  assert.deepEqual(entries, [{ name: 'file.txt', kind: 'file' }])
})

test('file snapshots distinguish missing files from unreadable files', async (t) => {
  const { project } = await fixture(t)
  const secure = projectPath as unknown as SecureProjectFs
  assert.equal(await secure.readProjectFileSnapshot(project, 'missing.txt'), null)
  assert.equal(await secure.readProjectFileSnapshot(project, 'nested/file.txt'), 'inside')
  const originalOpen = fs.open.bind(fs)
  t.mock.method(fs, 'open', async (...args: Parameters<typeof fs.open>) => {
    if (path.resolve(String(args[0])) === path.join(project, 'nested', 'file.txt')) {
      throw Object.assign(new Error('Access denied.'), { code: 'EACCES' })
    }
    return originalOpen(...args)
  })
  await assert.rejects(secure.readProjectFileSnapshot(project, 'nested/file.txt'), /Access denied/)
})

test('checkpoint restore preflights every path before changing any file', async (t) => {
  const { project } = await fixture(t)
  const secure = projectPath as unknown as SecureProjectFs
  await secure.writeProjectFile(project, 'first.txt', 'first-before')
  await secure.writeProjectFile(project, 'second.txt', 'second-before')
  const originalOpen = fs.open.bind(fs)
  t.mock.method(fs, 'open', async (...args: Parameters<typeof fs.open>) => {
    if (path.resolve(String(args[0])) === path.join(project, 'second.txt')) {
      throw Object.assign(new Error('Access denied.'), { code: 'EACCES' })
    }
    return originalOpen(...args)
  })
  await assert.rejects(secure.restoreProjectFiles(project, [
    { path: 'first.txt', before: 'restored-first' },
    { path: 'second.txt', before: 'restored-second' }
  ]), /Access denied/)
  assert.equal(await fs.readFile(path.join(project, 'first.txt'), 'utf8'), 'first-before')
  assert.equal(await fs.readFile(path.join(project, 'second.txt'), 'utf8'), 'second-before')
})

test('checkpoint restore rolls back earlier files when a later atomic write fails', async (t) => {
  const { project } = await fixture(t)
  const secure = projectPath as unknown as SecureProjectFs
  await secure.writeProjectFile(project, 'first.txt', 'first-before')
  await secure.writeProjectFile(project, 'second.txt', 'second-before')
  const originalExecFile = childProcess.execFile.bind(childProcess)
  let writes = 0
  t.mock.method(childProcess, 'execFile', ((...args: any[]) => {
    const options = args[2] as { cwd?: string } | undefined
    if (options?.cwd && path.resolve(options.cwd) === path.resolve(project) && ++writes === 2) {
      throw Object.assign(new Error('Disk failure.'), { code: 'EIO' })
    }
    return (originalExecFile as any)(...args)
  }) as typeof childProcess.execFile)
  await assert.rejects(secure.restoreProjectFiles(project, [
    { path: 'first.txt', before: 'restored-first' },
    { path: 'second.txt', before: 'restored-second' }
  ]), /Disk failure/)
  assert.equal(await fs.readFile(path.join(project, 'first.txt'), 'utf8'), 'first-before')
  assert.equal(await fs.readFile(path.join(project, 'second.txt'), 'utf8'), 'second-before')
})

test('a failed atomic write preserves the existing project file', async (t) => {
  const { project } = await fixture(t)
  const secure = projectPath as unknown as SecureProjectFs
  await secure.writeProjectFile(project, 'nested/file.txt', 'before')
  const originalExecFile = childProcess.execFile.bind(childProcess)
  t.mock.method(childProcess, 'execFile', ((...args: any[]) => {
    const options = args[2] as { cwd?: string } | undefined
    if (options?.cwd && path.resolve(options.cwd) === path.resolve(project, 'nested')) {
      throw Object.assign(new Error('Disk failure.'), { code: 'EIO' })
    }
    return (originalExecFile as any)(...args)
  }) as typeof childProcess.execFile)
  await assert.rejects(secure.writeProjectFile(project, 'nested/file.txt', 'replacement'), /Disk failure/)
  assert.equal(await fs.readFile(path.join(project, 'nested', 'file.txt'), 'utf8'), 'before')
})

test('a parent swap during directory creation cannot create outside the project', async (t) => {
  const { project, outside } = await fixture(t)
  const secure = projectPath as unknown as SecureProjectFs
  const parent = path.join(project, 'nested')
  interceptPathBoundary(t, parent, outside, path.join(parent, 'deep'), 'mkdir')
  await assert.rejects(secure.writeProjectFile(project, 'nested/deep/file.txt', 'created'), /outside the project|project folder changed|unresolved link/i)
  assert.equal(await fs.stat(path.join(outside, 'deep')).then(() => true, () => false), false)
})

test('a parent swap immediately before deletion cannot remove an outside file', async (t) => {
  const { project, outside } = await fixture(t)
  const secure = projectPath as unknown as SecureProjectFs
  const parent = path.join(project, 'nested')
  interceptPathBoundary(t, parent, outside, path.join(parent, 'file.txt'), 'rm')
  await assert.rejects(secure.removeProjectFile(project, 'nested/file.txt'), /outside the project|project folder changed|unresolved link/i)
  assert.equal(await fs.readFile(path.join(outside, 'file.txt'), 'utf8'), 'outside')
})
