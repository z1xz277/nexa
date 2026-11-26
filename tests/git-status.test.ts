import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { readGitStatus } from '../src/main/git-status.ts'

async function fixture(t: test.TestContext) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nexa-git-status-'))
  const hook = path.join(root, 'fsmonitor.sh')
  const marker = path.join(root, 'fsmonitor-ran')
  await fs.writeFile(path.join(root, 'file.txt'), 'hello\n')
  await fs.writeFile(hook, '#!/bin/sh\nprintf "%s" "$NEXA_OPENROUTER_KEY" > fsmonitor-ran\nprintf "token\\n"\n')
  await fs.chmod(hook, 0o755)
  execFileSync('git', ['init', '--quiet'], { cwd: root })
  execFileSync('git', ['config', 'core.fsmonitor', hook.replace(/\\/g, '/')], { cwd: root })
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  return { root, marker }
}

test('automatic git status ignores a repository worktree override', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nexa-git-worktree-'))
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'nexa-git-outside-'))
  await fs.writeFile(path.join(root, 'inside.txt'), 'inside\n')
  await fs.writeFile(path.join(outside, 'outside.txt'), 'outside\n')
  execFileSync('git', ['init', '--quiet'], { cwd: root })
  execFileSync('git', ['config', 'core.worktree', outside.replace(/\\/g, '/')], { cwd: root })
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  t.after(() => fs.rm(outside, { recursive: true, force: true }))
  const status = await readGitStatus(root)
  assert.equal(status['inside.txt'], 'A')
  assert.equal(status['outside.txt'], undefined)
})

test('a replaced project root cannot redirect later git status calls', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nexa-git-root-'))
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'nexa-git-replaced-'))
  await fs.writeFile(path.join(root, 'inside.txt'), 'inside\n')
  await fs.writeFile(path.join(outside, 'outside.txt'), 'outside\n')
  execFileSync('git', ['init', '--quiet'], { cwd: root })
  execFileSync('git', ['init', '--quiet'], { cwd: outside })
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  t.after(() => fs.rm(outside, { recursive: true, force: true }))
  assert.equal((await readGitStatus(root))['inside.txt'], 'A')
  await fs.rename(root, `${root}-safe`)
  await fs.symlink(outside, root, 'junction')
  assert.deepEqual(await readGitStatus(root), {})
})

test('automatic git status cannot execute repository fsmonitor hooks', async (t) => {
  const { root, marker } = await fixture(t)
  const sentinel = 'test-secret-that-must-not-reach-git-hooks'
  execFileSync('git', ['status', '--porcelain'], {
    cwd: root,
    env: { ...process.env, NEXA_OPENROUTER_KEY: sentinel }
  })
  assert.equal(await fs.readFile(marker, 'utf8'), sentinel)
  await fs.rm(marker)

  const status = await readGitStatus(root)
  assert.equal(status['file.txt'], 'A')
  assert.equal(await fs.stat(marker).then(() => true, () => false), false)
})
