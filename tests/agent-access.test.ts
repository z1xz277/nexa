import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import { AgentLoop } from '../src/core/agent.ts'
import { createTools, ToolRegistry } from '../src/core/tools.ts'
import type { AgentStartRequest, ApprovalDecision, AgentEvent, Mode } from '../src/shared/types.ts'
import type { ChatRequest } from '../src/core/providers/types.ts'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

const projectRoot = path.resolve('project-fixture')
const baseRequest = {
  sessionId: 'session-1',
  projectId: 'project-1',
  prompt: 'Update the project.',
  model: { id: 'test/model', provider: 'openrouter' },
  effort: 'low',
  mode: 'agent',
  attachments: []
}

function createHarness(
  turns: { id: string; name: string; arguments: string }[][],
  decision: ApprovalDecision = { action: 'approve' }
) {
  const writes: { path: string; content: string }[] = []
  const approvals: ApprovalDecision[] = []
  const events: AgentEvent[] = []
  let turn = 0
  const registry = {
    async listAll() { return [] },
    async streamWithFallback() {
      const toolCalls = turns[turn++] ?? []
      return { text: '', toolCalls, tokens: 0, model: 'test/model', provider: 'openrouter' }
    }
  }
  const loop = new AgentLoop({
    registry: registry as never,
    tools: new ToolRegistry(createTools()),
    makeContext() {
      return {
        projectPath: projectRoot,
        resolve(rel) {
          const abs = path.resolve(projectRoot, rel)
          return { abs, inside: abs === projectRoot || abs.startsWith(`${projectRoot}${path.sep}`) }
        },
        async readFile() { return 'before' },
        async readFileRaw() { return 'before' },
        async writeFile(rel, content) { writes.push({ path: rel, content }) },
        async listDir() { return [] },
        async search() { return [] },
        async runCommand() { return { output: '', exitCode: 0 } },
        async readMemory() { return '' },
        async checkpoint() {}
      }
    },
    async systemContext() {
      return { instructions: '', memory: '', pinned: [], projectPath: projectRoot }
    },
    async requestApproval() {
      approvals.push(decision)
      return decision
    },
    log() {},
    emit(event) { events.push(event) },
    persist() {},
    async history() { return [] }
  })
  return { loop, writes, approvals, events }
}

const writeTurn = [{
  id: 'call-1',
  name: 'write_file',
  arguments: JSON.stringify({ path: 'hello.txt', content: 'hello' })
}]

test('Full Access advertises the project mutation tools', () => {
  const tools = new ToolRegistry(createTools())
  assert.deepEqual(
    tools.specsFor('full' as Mode).map((tool) => tool.name).sort(),
    ['edit_file', 'list_directory', 'propose_memory', 'read_file', 'read_memory', 'run_command', 'search_code', 'update_plan', 'write_file']
  )
})

test('a trusted Full Access run writes without an approval prompt', async () => {
  const harness = createHarness([writeTurn, []])
  await harness.loop.start({
    ...baseRequest,
    mode: 'full' as Mode,
    access: { mode: 'full', fullAccess: true, autoApprove: ['write', 'edit', 'command', 'memory', 'network'] }
  } as never)
  assert.deepEqual(harness.writes, [{ path: 'hello.txt', content: 'hello' }])
  assert.equal(harness.approvals.length, 0)
})

test('Full Access fails closed without trusted host access', async () => {
  const harness = createHarness([writeTurn, []])
  await assert.rejects(
    harness.loop.start({ ...baseRequest, mode: 'full' as Mode } as never),
    /Full Access.*grant|trusted Full Access/i
  )
  assert.equal(harness.writes.length, 0)
})

test('an approved argument edit cannot redirect a write outside the project', async () => {
  const harness = createHarness(
    [[{ id: 'call-1', name: 'edit_file', arguments: JSON.stringify({ path: 'safe.txt', search: 'before', replace: 'after' }) }], []],
    { action: 'edit', args: { path: '../outside.txt', search: 'before', replace: 'after' } }
  )
  await harness.loop.start({
    ...baseRequest,
    access: { mode: 'agent', fullAccess: false, autoApprove: [] }
  } as never)
  assert.deepEqual(harness.writes, [])
  assert.ok(harness.events.some((event) => event.type === 'tool' && event.state === 'result' && /outside the project/i.test(event.result ?? '')))
})

test('automatic approval applies only to the active pending request', async () => {
  const approvalStarted = deferred<void>()
  const decision = deferred<ApprovalDecision>()
  let approvalRequest: { id: string; type: string } | undefined
  let approvalCalls = 0
  let turn = 0
  const writes: string[] = []
  const secondWriteTurn = [{
    id: 'call-2',
    name: 'write_file',
    arguments: JSON.stringify({ path: 'second.txt', content: 'second' })
  }]
  const loop = new AgentLoop({
    registry: {
      async listAll() { return [] },
      async streamWithFallback() {
        const toolCalls = [writeTurn, secondWriteTurn, []][turn++] ?? []
        return { text: '', toolCalls, tokens: 0, model: 'test/model', provider: 'openrouter' }
      }
    } as never,
    tools: new ToolRegistry(createTools()),
    makeContext() {
      return {
        projectPath: projectRoot,
        resolve: (rel) => ({ abs: path.resolve(projectRoot, rel), inside: true }),
        async readFile() { return 'before' },
        async readFileRaw() { return 'before' },
        async writeFile(rel) { writes.push(rel) },
        async listDir() { return [] },
        async search() { return [] },
        async runCommand() { return { output: '', exitCode: 0 } },
        async readMemory() { return '' },
        async checkpoint() {}
      }
    },
    async systemContext() { return { instructions: '', memory: '', pinned: [], projectPath: projectRoot } },
    async requestApproval(request) {
      approvalCalls++
      approvalRequest = request
      approvalStarted.resolve()
      return decision.promise
    },
    log() {},
    emit() {},
    persist() {},
    async history() { return [] }
  })
  const run = loop.start({ ...baseRequest, access: { mode: 'agent', fullAccess: false, autoApprove: [] } } as never)
  await approvalStarted.promise
  assert.ok(approvalRequest)
  loop.autoApprove('unknown-approval', 'write')
  loop.autoApprove(approvalRequest.id, 'command')
  assert.equal(approvalCalls, 1)
  loop.autoApprove(approvalRequest.id, 'write')
  decision.resolve({ action: 'approve' })
  await run
  assert.equal(approvalCalls, 1)
  assert.deepEqual(writes, ['hello.txt', 'second.txt'])
})

test('stopping during approval preparation cannot register or execute the write', async () => {
  const readStarted = deferred<void>()
  const releaseRead = deferred<string>()
  let approvalCalls = 0
  const writes: string[] = []
  const loop = new AgentLoop({
    registry: {
      async listAll() { return [] },
      async streamWithFallback() {
        return { text: '', toolCalls: writeTurn, tokens: 0, model: 'test/model', provider: 'openrouter' }
      }
    } as never,
    tools: new ToolRegistry(createTools()),
    makeContext() {
      return {
        projectPath: projectRoot,
        resolve(rel) { return { abs: path.resolve(projectRoot, rel), inside: true } },
        async readFile() {
          readStarted.resolve()
          return releaseRead.promise
        },
        async readFileRaw() {
          readStarted.resolve()
          return releaseRead.promise
        },
        async writeFile(rel) { writes.push(rel) },
        async listDir() { return [] },
        async search() { return [] },
        async runCommand() { return { output: '', exitCode: 0 } },
        async readMemory() { return '' },
        async checkpoint() {}
      }
    },
    async systemContext() { return { instructions: '', memory: '', pinned: [], projectPath: projectRoot } },
    async requestApproval() {
      approvalCalls++
      return { action: 'approve' }
    },
    log() {},
    emit() {},
    persist() {},
    async history() { return [] }
  })
  const run = loop.start({ ...baseRequest, access: { mode: 'agent', fullAccess: false, autoApprove: [] } } as never)
  await readStarted.promise
  loop.stop(baseRequest.sessionId)
  releaseRead.resolve('before')
  await run
  assert.equal(approvalCalls, 0)
  assert.deepEqual(writes, [])
})

test('stopping a run aborts its active tool command', async () => {
  const commandStarted = deferred<void>()
  let commandSignal: AbortSignal | undefined
  const loop = new AgentLoop({
    registry: {
      async listAll() { return [] },
      async streamWithFallback() {
        return { text: '', toolCalls: [{ id: 'command-1', name: 'run_command', arguments: JSON.stringify({ command: 'Start-Sleep -Seconds 30' }) }], tokens: 0, model: 'test/model', provider: 'openrouter' }
      }
    } as never,
    tools: new ToolRegistry(createTools()),
    makeContext() {
      return {
        projectPath: projectRoot,
        resolve: (rel) => ({ abs: path.resolve(projectRoot, rel), inside: true }),
        async readFile() { return '' },
        async readFileRaw() { return '' },
        async writeFile() {},
        async listDir() { return [] },
        async search() { return [] },
        runCommand(_command, signal) {
          commandSignal = signal
          commandStarted.resolve()
          return new Promise((resolve) => {
            if (signal?.aborted) resolve({ output: 'Command canceled.', exitCode: 1 })
            else signal?.addEventListener('abort', () => resolve({ output: 'Command canceled.', exitCode: 1 }), { once: true })
          })
        },
        async readMemory() { return '' },
        async checkpoint() {}
      }
    },
    async systemContext() { return { instructions: '', memory: '', pinned: [], projectPath: projectRoot } },
    async requestApproval() { return { action: 'approve' } },
    log() {},
    emit() {},
    persist() {},
    async history() { return [] }
  })
  const request = { ...baseRequest, mode: 'full', access: { mode: 'full', fullAccess: true, autoApprove: ['write', 'edit', 'command', 'memory', 'network'] } } as never
  const run = loop.start(request)
  await commandStarted.promise
  assert.ok(commandSignal)
  loop.stop(baseRequest.sessionId)
  await run
  assert.equal(commandSignal.aborted, true)
})

test('a replaced run cannot be deleted by the previous run finishing', async () => {
  const firstStarted = deferred<void>()
  const secondStarted = deferred<void>()
  const secondResult = deferred<{ text: string; toolCalls: []; tokens: number; model: string; provider: 'openrouter' }>()
  const events: AgentEvent[] = []
  let calls = 0
  const loop = new AgentLoop({
    registry: {
      async listAll() { return [] },
      streamWithFallback(request: ChatRequest) {
        calls++
        if (calls === 1) {
          firstStarted.resolve()
          return new Promise((_resolve, reject) => {
            request.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
          })
        }
        secondStarted.resolve()
        return secondResult.promise
      }
    } as never,
    tools: new ToolRegistry(createTools()),
    makeContext() {
      return {
        projectPath: projectRoot,
        resolve: (rel) => ({ abs: path.resolve(projectRoot, rel), inside: true }),
        async readFile() { return '' },
        async readFileRaw() { return '' },
        async writeFile() {},
        async listDir() { return [] },
        async search() { return [] },
        async runCommand() { return { output: '', exitCode: 0 } },
        async readMemory() { return '' },
        async checkpoint() {}
      }
    },
    async systemContext() { return { instructions: '', memory: '', pinned: [], projectPath: projectRoot } },
    async requestApproval() { return { action: 'reject' } },
    log() {},
    emit(event) { events.push(event) },
    persist() {},
    async history() { return [] }
  })
  const request = { ...baseRequest, access: { mode: 'agent', fullAccess: false, autoApprove: [] } } as never
  const firstRun = loop.start(request)
  await firstStarted.promise
  const secondRun = loop.start(request)
  await secondStarted.promise
  try {
    await firstRun
    assert.equal(loop.status(baseRequest.sessionId), 'running')
    assert.equal(events.some((event) => event.type === 'done'), false)
  } finally {
    secondResult.resolve({ text: '', toolCalls: [], tokens: 0, model: 'test/model', provider: 'openrouter' })
    await secondRun
  }
})
