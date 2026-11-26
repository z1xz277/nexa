import assert from 'node:assert/strict'
import test from 'node:test'
import { TerminalHost } from '../src/main/terminal.ts'
import * as terminalModule from '../src/main/terminal.ts'

async function untilKilled<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Command was not terminated.')), 6_000)
      })
    ])
  } finally {
    clearTimeout(timer)
  }
}

test('killing an agent terminal terminates its tracked command', async (t) => {
  const host = new TerminalHost(() => {})
  t.after(() => host.killAll())
  const command = host.runCommand(process.cwd(), process.platform === 'win32' ? 'Start-Sleep -Seconds 3' : 'sleep 3', 'agent-1')
  host.kill('agent-1')
  const started = Date.now()
  const result = await untilKilled(command)
  assert.ok(Date.now() - started < 2_000)
})

test('agent shell processes do not inherit provider secrets', async (t) => {
  const host = new TerminalHost(() => {})
  t.after(() => host.killAll())
  const previous = process.env.NEXA_OPENROUTER_KEY
  process.env.NEXA_OPENROUTER_KEY = 'test-secret-that-must-not-reach-shells'
  try {
    const command = process.platform === 'win32'
      ? 'Write-Output $env:NEXA_OPENROUTER_KEY'
      : 'printf "%s" "$NEXA_OPENROUTER_KEY"'
    const result = await host.runCommand(process.cwd(), command, 'agent-secrets')
    assert.equal(result.output.trim(), '')
  } finally {
    if (previous === undefined) delete process.env.NEXA_OPENROUTER_KEY
    else process.env.NEXA_OPENROUTER_KEY = previous
  }
})

test('terminal output and agent command results redact provider secrets across chunks', async (t) => {
  const secret = 'sk-or-terminal-secret-value'
  const chunks: string[] = []
  const host = new TerminalHost((_id, data) => chunks.push(data), [secret])
  t.after(() => host.killAll())
  const command = process.platform === 'win32'
    ? "[Console]::Write('sk-or-terminal-'); Start-Sleep -Milliseconds 80; [Console]::Write('secret-value')"
    : "printf '%s' 'sk-or-terminal-'; sleep 0.08; printf '%s' 'secret-value'"
  const result = await host.runCommand(process.cwd(), command, 'agent-redaction')
  assert.equal(result.output.includes(secret), false)
  assert.equal(chunks.join('').includes(secret), false)
  assert.equal(result.output.includes('[REDACTED]'), true)
})

test('child environment keeps runtime variables but drops credentials', () => {
  const previous = process.env.NEXA_NVIDIA_KEY
  process.env.NEXA_NVIDIA_KEY = 'another-test-secret'
  try {
    const env = (terminalModule as unknown as { safeChildEnvironment(): NodeJS.ProcessEnv }).safeChildEnvironment()
    assert.equal(env.NEXA_NVIDIA_KEY, undefined)
    assert.equal(env.NEXA_OPENROUTER_KEY, undefined)
    assert.ok(env.Path || env.PATH)
    assert.ok(process.platform !== 'win32' || Object.keys(env).some((name) => name.toUpperCase() === 'SYSTEMROOT'))
  } finally {
    if (previous === undefined) delete process.env.NEXA_NVIDIA_KEY
    else process.env.NEXA_NVIDIA_KEY = previous
  }
})

test('kill all terminates tracked agent commands', async (t) => {
  const host = new TerminalHost(() => {})
  const command = host.runCommand(process.cwd(), process.platform === 'win32' ? 'Start-Sleep -Seconds 3' : 'sleep 3', 'agent-2')
  host.killAll()
  const started = Date.now()
  await untilKilled(command)
  assert.ok(Date.now() - started < 2_000)
})

test('aborting a run terminates its tracked command', async (t) => {
  const host = new TerminalHost(() => {})
  t.after(() => host.killAll())
  const controller = new AbortController()
  const command = host.runCommand(process.cwd(), process.platform === 'win32' ? 'Start-Sleep -Seconds 3' : 'sleep 3', 'agent-abort', controller.signal)
  controller.abort()
  const started = Date.now()
  await untilKilled(command)
  assert.ok(Date.now() - started < 2_000)
})
