import assert from 'node:assert/strict'
import test from 'node:test'
import { createTools } from '../src/core/tools.ts'

function context(raw: string) {
  const writes: string[] = []
  return {
    writes,
    value: {
      projectPath: null,
      resolve: () => ({ abs: '', inside: false }),
      readFile: async () => raw.replace('opaque-secret-value', '[REDACTED]'),
      readFileRaw: async () => raw,
      writeFile: async (_path: string, content: string) => { writes.push(content) },
      listDir: async () => [],
      search: async () => [],
      runCommand: async () => ({ output: '', exitCode: 0 }),
      readMemory: async () => '',
      checkpoint: async () => {}
    }
  }
}

test('propose_memory creates a restorable checkpoint before writing', async () => {
  const checkpointed: string[][] = []
  const writes: string[] = []
  const tool = createTools().find((item) => item.name === 'propose_memory')!
  await tool.run({ content: 'new memory' }, {
    ...context('old memory').value,
    async checkpoint(paths) { checkpointed.push(paths) },
    async writeFile(_path, content) { writes.push(content) }
  })
  assert.deepEqual(checkpointed, [['PROJECT.md']])
  assert.deepEqual(writes, ['new memory'])
})

test('edit_file matches raw content while reads stay redacted', async () => {
  const fixture = context('prefix opaque-secret-value suffix')
  const edit = createTools().find((tool) => tool.name === 'edit_file')!
  const result = await edit.run({ path: 'secret.txt', search: 'opaque-secret-value', replace: 'safe-value' }, fixture.value)
  assert.match(result, /Edited/)
  assert.deepEqual(fixture.writes, ['prefix safe-value suffix'])
})

test('edit_file cannot replace redacted placeholders with model supplied content', async () => {
  const fixture = context('prefix opaque-secret-value suffix')
  const edit = createTools().find((tool) => tool.name === 'edit_file')!
  const result = await edit.run({ path: 'secret.txt', search: '[REDACTED]', replace: 'leaked-placeholder' }, fixture.value)
  assert.match(result, /search text not found/)
  assert.deepEqual(fixture.writes, [])
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

test('stopping during checkpoint preparation prevents file writes', async (t) => {
  const cases = [
    { name: 'write_file', args: { path: 'file.txt', content: 'new content' } },
    { name: 'edit_file', args: { path: 'file.txt', search: 'old content', replace: 'new content' } },
    { name: 'propose_memory', args: { content: 'new memory' } }
  ]
  for (const item of cases) {
    await t.test(item.name, async () => {
      const fixture = context('old content')
      const checkpoint = deferred<void>()
      const controller = new AbortController()
      fixture.value.checkpoint = () => checkpoint.promise
      const tool = createTools().find((entry) => entry.name === item.name)!
      const pending = tool.run(item.args, fixture.value, controller.signal)
      await Promise.resolve()
      controller.abort()
      checkpoint.resolve()
      await assert.rejects(pending, /stopped|abort/i)
      assert.deepEqual(fixture.writes, [])
    })
  }
})

test('stopping during an edit read prevents the later write', async () => {
  const fixture = context('old content')
  const read = deferred<string>()
  const controller = new AbortController()
  fixture.value.readFileRaw = () => read.promise
  const edit = createTools().find((tool) => tool.name === 'edit_file')!
  const pending = edit.run({ path: 'file.txt', search: 'old content', replace: 'new content' }, fixture.value, controller.signal)
  await Promise.resolve()
  controller.abort()
  read.resolve('old content')
  await assert.rejects(pending, /stopped|abort/i)
  assert.deepEqual(fixture.writes, [])
})
