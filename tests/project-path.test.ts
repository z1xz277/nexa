import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { resolveProjectPath } from '../src/main/project-path.ts'

function fixture(t: test.TestContext) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexa-path-policy-'))
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }))
  const root = path.join(temp, 'project')
  fs.mkdirSync(root)
  return { temp, root }
}

test('project paths allow normalized files and new descendants', (t) => {
  const { root } = fixture(t)
  assert.equal(resolveProjectPath(root, 'src/../README.md').inside, true)
  assert.equal(resolveProjectPath(root, 'new/nested/file.ts').inside, true)
})

test('project paths reject traversal and sibling-prefix escapes', (t) => {
  const { temp, root } = fixture(t)
  const sibling = `${root}-other`
  fs.mkdirSync(sibling)
  fs.writeFileSync(path.join(sibling, 'secret.txt'), 'secret')
  assert.equal(resolveProjectPath(root, '../project-other/secret.txt').inside, false)
  assert.equal(resolveProjectPath(root, path.join(sibling, 'secret.txt')).inside, false)
})

test('project paths reject symlink escapes', (t) => {
  const { temp, root } = fixture(t)
  const outside = path.join(temp, 'outside')
  fs.mkdirSync(outside)
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'secret')
  const link = path.join(root, 'link')
  fs.symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir')
  assert.equal(resolveProjectPath(root, 'link/secret.txt').inside, false)
})

test('project paths allow links that resolve inside the project', (t) => {
  const { root } = fixture(t)
  fs.mkdirSync(path.join(root, 'src'))
  const link = path.join(root, 'source')
  fs.symlinkSync(path.join(root, 'src'), link, process.platform === 'win32' ? 'junction' : 'dir')
  assert.equal(resolveProjectPath(root, 'source/new.ts').inside, true)
})
