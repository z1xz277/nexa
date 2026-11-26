import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { uid } from '@shared/types'
import { redactText, StreamingRedactor, type SecretSource } from '@shared/redaction'

export type TerminalSink = (id: string, data: string) => void

interface TermSession {
  proc: ChildProcess
  cwd: string
  redactor: StreamingRedactor
}

const isWin = process.platform === 'win32'
const RUNTIME_ENV = new Set([
  'PATH', 'PATHEXT', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP',
  'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'LOCALAPPDATA', 'APPDATA',
  'PROGRAMDATA', 'PROGRAMFILES', 'PROGRAMFILES(X86)', 'COMMONPROGRAMFILES',
  'COMMONPROGRAMFILES(X86)', 'PSMODULEPATH', 'HOME', 'USER', 'LOGNAME',
  'SHELL', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TERM', 'TZ', 'TMPDIR'
])

export function safeChildEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  const allowed = new Set([...RUNTIME_ENV].map((name) => name.toUpperCase()))
  for (const [name, value] of Object.entries(source)) {
    if (value !== undefined && allowed.has(name.toUpperCase()) && !/KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL/i.test(name)) {
      env[name] = value
    }
  }
  return env
}

// PTY-free terminal: the shell runs with piped stdio and its output is rendered
// by xterm.js in the renderer. Interactive line input works; full PTY is v2.
export class TerminalHost {
  private sessions = new Map<string, TermSession>()
  private commands = new Map<string, Set<ChildProcess>>()
  constructor(private sink: TerminalSink, private secrets: SecretSource = []) {}

  private terminate(proc: ChildProcess): void {
    if (isWin && proc.pid) {
      execFile('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { windowsHide: true, timeout: 5000 }, (error) => {
        if (error && !proc.killed) proc.kill()
      })
    } else {
      proc.kill()
    }
  }

  create(cwd: string): string {
    const id = uid()
    const proc = isWin
      ? spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-Command', '-'], { cwd, env: safeChildEnvironment(), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
      : spawn(process.env.SHELL || '/bin/bash', ['-i'], { cwd, env: safeChildEnvironment(), stdio: ['pipe', 'pipe', 'pipe'] })
    const redactor = new StreamingRedactor(this.secrets)
    const writeOutput = (d: Buffer) => this.sink(id, redactor.push(d.toString('utf8')))
    proc.stdout?.on('data', writeOutput)
    proc.stderr?.on('data', writeOutput)
    proc.on('exit', () => {
      this.sink(id, redactor.flush())
      this.sink(id, '\r\n[process exited]\r\n')
      this.sessions.delete(id)
    })
    if (isWin) {
      proc.stdin?.write('[Console]::OutputEncoding=[System.Text.Encoding]::UTF8\n')
    }
    this.sessions.set(id, { proc, cwd, redactor })
    return id
  }

  input(id: string, data: string): void {
    this.sessions.get(id)?.proc.stdin?.write(data)
  }

  kill(id: string): void {
    const session = this.sessions.get(id)
    if (session) {
      this.terminate(session.proc)
      this.sessions.delete(id)
    }
    for (const proc of this.commands.get(id) ?? []) this.terminate(proc)
    this.commands.delete(id)
  }

  // Agent commands run as one-shot shells, streamed live into the agent pane.
  runCommand(cwd: string, command: string, agentTermId: string | null, signal?: AbortSignal): Promise<{ output: string; exitCode: number }> {
    if (signal?.aborted) return Promise.resolve({ output: 'Command canceled.', exitCode: 1 })
    return new Promise((resolve) => {
      const proc = isWin
        ? spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-Command', command], { cwd, env: safeChildEnvironment(), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
        : spawn(process.env.SHELL || '/bin/bash', ['-lc', command], { cwd, env: safeChildEnvironment(), stdio: ['ignore', 'pipe', 'pipe'] })
      const tracked = agentTermId ? this.commands.get(agentTermId) ?? new Set<ChildProcess>() : null
      if (agentTermId && tracked) {
        tracked.add(proc)
        this.commands.set(agentTermId, tracked)
      }
      let output = ''
      const redactor = new StreamingRedactor(this.secrets)
      const secrets = typeof this.secrets === 'function' ? this.secrets() : this.secrets
      const push = (d: Buffer) => {
        const text = redactor.push(d.toString('utf8'))
        output += text
        if (output.length > 200000) output = output.slice(-200000)
        if (agentTermId) this.sink(agentTermId, text)
      }
      proc.stdout?.on('data', push)
      proc.stderr?.on('data', push)
      const timer = setTimeout(() => this.terminate(proc), 120000)
      const onAbort = () => {
        this.terminate(proc)
        if (agentTermId) this.sink(agentTermId, '\r\n[command canceled]\r\n')
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      proc.on('error', (err) => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        resolve({ output: output + '\n' + redactText(err.message, secrets), exitCode: 1 })
      })
      proc.on('close', (code) => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        const remaining = redactor.flush()
        output += remaining
        if (agentTermId) this.sink(agentTermId, remaining)
        tracked?.delete(proc)
        if (agentTermId && this.commands.get(agentTermId)?.size === 0) this.commands.delete(agentTermId)
        if (agentTermId) this.sink(agentTermId, `\r\n[exit ${code ?? 0}]\r\n`)
        resolve({ output, exitCode: code ?? 0 })
      })
    })
  }

  killAll(): void {
    const ids = new Set([...this.sessions.keys(), ...this.commands.keys()])
    for (const id of ids) this.kill(id)
  }
}