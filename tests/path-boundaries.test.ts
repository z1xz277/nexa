import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { readProjectFile, requireProjectPath, resolveProjectPath } from '../src/main/project-path.ts'
import { resolveVirtualPath } from '../src/core/virtual-path.ts'

test('required project paths reject escapes before filesystem access', (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexa-required-path-'))
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }))
  const root = path.join(temp, 'project')
  fs.mkdirSync(root)
  assert.equal(requireProjectPath(root, 'src/file.ts'), path.join(root, 'src', 'file.ts'))
  assert.throws(() => requireProjectPath(root, '../secret.txt'), /outside the project/i)
})

test('virtual paths reject traversal, absolute paths, and backslash escapes', () => {
  assert.deepEqual(resolveVirtualPath('src/../README.md'), { abs: '/README.md', inside: true })
  for (const value of ['../secret', 'src/../../secret', '/secret', 'C:/secret', '\\\\server\\share', '..\\secret']) {
    assert.equal(resolveVirtualPath(value).inside, false, value)
  }
})

test('secure file helpers reject reads without a project root', async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexa-no-project-'))
  const file = path.join(temp, 'secret.txt')
  fs.writeFileSync(file, 'outside')
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }))
  await assert.rejects(readProjectFile(null, file), /project folder/i)
})

test('virtual paths allow nested project files', () => {
  assert.deepEqual(resolveVirtualPath('src\\app.ts'), { abs: '/src/app.ts', inside: true })
  assert.deepEqual(resolveVirtualPath('./new/file.ts'), { abs: '/new/file.ts', inside: true })
  assert.equal(resolveProjectPath(null, 'README.md').inside, false)
})
