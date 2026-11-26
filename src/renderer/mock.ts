import type { NexaBridge } from '@shared/ipc'
import type {
  ActivityEntry, AgentEvent, ApprovalDecision, ApprovalRequest,
  Attachment, ChatMessage, Checkpoint, FileNode, ModelInfo, Project, ProviderId,
  Session, Settings, UpdateState
} from '@shared/types'
import { DEFAULT_SETTINGS, uid } from '@shared/types'
import { AgentLoop, type AgentRunRequest } from '@core/agent'
import { FullAccessGrants, isApprovalType } from '@core/access'
import { resolveVirtualPath } from '@core/virtual-path'
import { createTools, ToolRegistry, type ToolContext } from '@core/tools'
import type { ProviderRegistry } from '@core/providers/registry'
import type { ChatRequest, StreamHandlers, StreamResult } from '@core/providers/types'
import { ActivityLogger, filterEntries } from '@core/logger'
import { createTrustedRunRequest, parseAgentStart, parseApprovalDecision } from '../main/agent-request'

// Browser preview only. Electron never loads this file. The preview is always
// scripted and never accepts, stores, or sends provider credentials.

const load = <T,>(key: string, fallback: T): T => {
  try { return JSON.parse(localStorage.getItem('nexa:' + key) ?? '') as T } catch { return fallback }
}
const save = (key: string, value: unknown) => localStorage.setItem('nexa:' + key, JSON.stringify(value))

const SEED_FILES: Record<string, string> = {
  'README.md': '# Nexa sample\n\nA tiny project used by the Nexa browser preview.\nRun the agent to see approvals, diffs, and the terminal in action.\n',
  'src/app.ts': 'export function greet(name: string) {\n  return `Hello, ${name}`\n}\n',
  'package.json': '{\n  "name": "nexa-sample",\n  "private": true,\n  "scripts": { "test": "node --test" }\n}\n',
  'PROJECT.md': '# Nexa sample\n\n## Stack\nTypeScript, Node.\n\n## Conventions\nSmall pure functions, no default exports.\n'
}

function makeVirtualFs(initial: Record<string, string>) {
  const files = new Map<string, string>(Object.entries(initial))
  const resolve = (rel: string): string => {
    const resolved = resolveVirtualPath(rel)
    if (!resolved.inside) throw new Error('Path is outside the project folder.')
    return resolved.abs.slice(1)
  }
  return {
    files,
    resolve,
    list(): string[] { return [...files.keys()].sort() },
    read(rel: string): string {
      const key = resolve(rel)
      const v = files.get(key)
      if (v === undefined) throw new Error(`File not found: ${rel}`)
      return v
    },
    write(rel: string, content: string): void { files.set(resolve(rel), content) }
  }
}

// Scripted provider used when no API key is present in the browser preview,
// so every UI flow (plan, approval, diff, terminal) stays exercisable offline.
const DEMO_MODEL: ModelInfo = {
  id: 'preview/demo', provider: 'openrouter', name: 'Nexa Preview', context: 128_000,
  capabilities: { code: true, reasoning: false, vision: false, tools: true }
}

class DemoRegistry {
  async listAll(): Promise<ModelInfo[]> { return [DEMO_MODEL] }
  async streamWithFallback(req: ChatRequest, handlers: StreamHandlers): Promise<StreamResult & { model: string; provider: ProviderId }> {
    const turn = req.messages.filter((m) => m.role === 'assistant').length
    const script: { text: string; tools: { id: string; name: string; arguments: string }[] }[] = [
      {
        text: 'Working in preview mode (no API key). I will inspect the project, make a small change, and verify it.',
        tools: [
          { id: 'c1', name: 'update_plan', arguments: JSON.stringify({ steps: [{ text: 'Read the project files', status: 'running' }, { text: 'Add a greeting module', status: 'pending' }, { text: 'Verify with a command', status: 'pending' }] }) },
          { id: 'c2', name: 'read_file', arguments: JSON.stringify({ path: 'src/app.ts' }) }
        ]
      },
      {
        text: 'The entry point is clear. I will add a small module beside it.',
        tools: [
          { id: 'c3', name: 'update_plan', arguments: JSON.stringify({ steps: [{ text: 'Read the project files', status: 'done' }, { text: 'Add a greeting module', status: 'running' }, { text: 'Verify with a command', status: 'pending' }] }) },
          { id: 'c4', name: 'write_file', arguments: JSON.stringify({ path: 'src/farewell.ts', content: 'export function farewell(name: string) {\n  return `Goodbye, ${name}`\n}\n' }) }
        ]
      },
      {
        text: 'Module written. Let me verify the project still responds.',
        tools: [
          { id: 'c5', name: 'update_plan', arguments: JSON.stringify({ steps: [{ text: 'Read the project files', status: 'done' }, { text: 'Add a greeting module', status: 'done' }, { text: 'Verify with a command', status: 'running' }] }) },
          { id: 'c6', name: 'run_command', arguments: JSON.stringify({ command: 'echo hello from nexa' }) }
        ]
      },
      {
        text: 'Done. Added src/farewell.ts with a single pure function, verified the shell responds, and kept the change inside the project folder. Configure a model connection locally to run real models.',
        tools: []
      }
    ]
    let step = script[Math.min(turn, script.length - 1)]
    const last = req.messages.at(-1)
    if (last?.role === 'user' && last.content.startsWith('Self-review pass:')) {
      step = { text: 'Verified. No further changes.', tools: [] }
    }
    const words = step.text.split(' ')
    let text = ''
    for (const w of words) {
      if (req.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      const piece = (text ? ' ' : '') + w
      text += piece
      handlers.onChunk(piece)
      await new Promise((r) => setTimeout(r, 22))
    }
    return { text, toolCalls: step.tools, tokens: Math.ceil(text.length / 4), model: 'preview/demo', provider: 'openrouter' }
  }
}

export function createMockBridge(): NexaBridge {
  let settings = load<Settings>('settings', DEFAULT_SETTINGS)
  let projects = load<Project[]>('projects', [])
  let sessions = load<Session[]>('sessions', [])
  const vfs = makeVirtualFs(SEED_FILES)
  const activity: ActivityEntry[] = []
  const checkpoints: Checkpoint[] = []
  const checkpointSnapshots = new Map<string, { path: string; before: string | null }[]>()
  const agentListeners = new Set<(e: AgentEvent) => void>()
  const termListeners = new Set<(id: string, data: string) => void>()
  const updateListeners = new Set<(state: UpdateState) => void>()
  let updateState: UpdateState = { phase: 'unsupported', currentVersion: '1.0.0', message: 'Automatic updates are available in the installed Windows app.' }
  const pending = new Map<string, { sessionId: string; resolve(d: ApprovalDecision): void }>()
  const fullAccessGrants = new FullAccessGrants()
  const logger = new ActivityLogger((e) => { activity.unshift(e) })
  const emit = (e: AgentEvent) => agentListeners.forEach((cb) => cb(e))
  const termSink = (id: string, data: string) => termListeners.forEach((cb) => cb(id, data))

  if (projects.length === 0) {
    projects = [{
      id: 'demo', name: 'nexa-sample', path: null, instructions: 'Keep changes small and typed.',
      defaultModel: null, defaultEffort: 'medium', pinnedFiles: ['README.md'], createdAt: Date.now()
    }]
    save('projects', projects)
  }

  const messagesKey = (id: string) => 'messages:' + id
  const getMessages = (id: string): ChatMessage[] => load<ChatMessage[]>(messagesKey(id), [])
  const appendMessage = (id: string, m: ChatMessage) => {
    const all = getMessages(id)
    all.push(m)
    save(messagesKey(id), all)
    const s = sessions.find((x) => x.id === id)
    if (s) {
      s.updatedAt = Date.now()
      if (s.title === 'New session' && m.role === 'user') s.title = m.content.slice(0, 60)
      save('sessions', sessions)
    }
  }

  const demoRegistry = new DemoRegistry()
  const previewRegistry = demoRegistry as unknown as ProviderRegistry
  const rejectPending = (sessionId: string) => {
    for (const [id, pendingApproval] of pending) {
      if (pendingApproval.sessionId === sessionId) {
        pending.delete(id)
        pendingApproval.resolve({ action: 'reject' })
      }
    }
  }

  const makeContext = (req: AgentRunRequest): ToolContext => ({
    projectPath: '/nexa-sample',
    resolve: (rel) => {
      const resolved = resolveVirtualPath(rel)
      return { abs: `/nexa-sample${resolved.abs}`, inside: resolved.inside }
    },
    readFile: async (rel) => vfs.read(rel),
    readFileRaw: async (rel) => vfs.read(rel),
    writeFile: async (rel, content) => { vfs.write(rel, content) },
    listDir: async (rel) => {
      const resolved = resolveVirtualPath(rel)
      if (!resolved.inside) throw new Error('Path is outside the project folder.')
      const prefix = rel === '.' ? '' : resolved.abs.slice(1).replace(/\/$/, '') + '/'
      const names = new Set<string>()
      for (const f of vfs.list()) {
        if (!f.startsWith(prefix)) continue
        const rest = f.slice(prefix.length)
        const head = rest.split('/')[0]
        if (head) names.add(head + (rest.includes('/') ? '|' : ''))
      }
      return [...names].map((n) => n.endsWith('|')
        ? { name: n.slice(0, -1), kind: 'dir' as const }
        : { name: n, kind: 'file' as const })
    },
    search: async (query) => {
      const hits: { path: string; line: number; text: string }[] = []
      for (const [path, text] of vfs.files) {
        text.split('\n').forEach((line, i) => {
          if (line.includes(query) && hits.length < 100) hits.push({ path, line: i + 1, text: line.trim() })
        })
      }
      return hits
    },
    runCommand: async (command) => {
      termSink('agent', `\r\n$ ${command}\r\n`)
      await new Promise((r) => setTimeout(r, 350))
      let out: string
      if (/^echo\s/i.test(command)) out = command.replace(/^echo\s+/i, '') + '\r\n'
      else if (/^(ls|dir)/i.test(command)) out = vfs.list().join('\r\n') + '\r\n'
      else if (/npm (test|run)/i.test(command)) out = '> nexa-sample test\r\n2 passed, 0 failed\r\n'
      else out = `[preview] simulated output for: ${command}\r\n`
      termSink('agent', out)
      return { output: out.replace(/\r\n/g, '\n'), exitCode: 0 }
    },
    readMemory: async () => vfs.files.get('PROJECT.md') ?? '',
    checkpoint: async (paths) => {
      const files = paths.map((p) => ({ path: p, before: vfs.files.get(vfs.resolve(p)) ?? null }))
      const cp: Checkpoint = {
        id: uid(), sessionId: req.sessionId, ts: Date.now(), label: paths.join(', '),
        files: files.map((file) => ({ path: file.path, existed: file.before !== null }))
      }
      checkpointSnapshots.set(cp.id, files)
      checkpoints.unshift(cp)
      emit({ type: 'checkpoint', sessionId: req.sessionId, checkpoint: cp })
    }
  })

  const agent = new AgentLoop({
    registry: previewRegistry,
    tools: new ToolRegistry(createTools()),
    makeContext,
    systemContext: async (req) => {
      const p = projects.find((x) => x.id === req.projectId)
      return {
        instructions: p?.instructions ?? '',
        memory: vfs.files.get('PROJECT.md') ?? '',
        pinned: [],
        projectPath: '/nexa-sample'
      }
    },
    requestApproval: (req: ApprovalRequest) => new Promise<ApprovalDecision>((resolve) => {
      pending.set(req.id, { sessionId: req.sessionId, resolve })
    }),
    log: (sid, kind, summary, data) => logger.log(sid, kind, summary, data),
    emit,
    persist: appendMessage,
    history: async (sid) => getMessages(sid)
  })

  const tree = (): FileNode[] => {
    const root: FileNode[] = []
    for (const f of vfs.list()) {
      const parts = f.split('/')
      let level = root
      let acc = ''
      parts.forEach((part, i) => {
        acc = acc ? acc + '/' + part : part
        let node = level.find((n) => n.name === part)
        if (!node) {
          node = { name: part, path: acc, kind: i === parts.length - 1 ? 'file' : 'dir', children: i === parts.length - 1 ? undefined : [] }
          level.push(node)
        }
        if (node.children) level = node.children
      })
    }
    return root
  }

  return {
    window: { minimize: () => {}, maximize: () => {}, close: () => {} },
    settings: {
      get: async () => settings,
      set: async (patch) => { settings = { ...settings, ...patch }; save('settings', settings); return settings }
    },
    keys: {
      set: async () => { throw new Error('Provider credentials are configured in the desktop app.') },
      status: async () => ({ nvidia: false, openrouter: false }),
      clear: async () => {}
    },
    models: {
      list: async () => demoRegistry.listAll(),
      cachedAt: async () => null
    },
    projects: {
      list: async () => projects,
      create: async (input) => {
        const p: Project = { id: uid(), name: input.name, path: input.path, instructions: '', defaultModel: null, defaultEffort: 'medium', pinnedFiles: [], createdAt: Date.now() }
        projects = [...projects, p]
        save('projects', projects)
        return p
      },
      update: async (id, patch) => {
        projects = projects.map((p) => (p.id === id ? { ...p, ...patch } : p))
        save('projects', projects)
        return projects.find((p) => p.id === id)!
      },
      remove: async (id) => {
        projects = projects.filter((p) => p.id !== id)
        sessions = sessions.filter((s) => s.projectId !== id)
        save('projects', projects); save('sessions', sessions)
      },
      pickFolder: async () => null,
      memory: async () => vfs.files.get('PROJECT.md') ?? ''
    },
    sessions: {
      list: async (projectId) => sessions.filter((s) => s.projectId === projectId).sort((a, b) => b.updatedAt - a.updatedAt),
      create: async (projectId, title) => {
        const s: Session = { id: uid(), projectId, title: title || 'New session', createdAt: Date.now(), updatedAt: Date.now() }
        sessions = [...sessions, s]
        save('sessions', sessions)
        return s
      },
      messages: async (sid) => getMessages(sid),
      rename: async (id, title) => {
        sessions = sessions.map((s) => (s.id === id ? { ...s, title } : s))
        save('sessions', sessions)
      },
      remove: async (id) => {
        sessions = sessions.filter((s) => s.id !== id)
        save('sessions', sessions)
        localStorage.removeItem('nexa:' + messagesKey(id))
      }
    },
    fs: {
      tree: async () => tree(),
      read: async (_pid, path) => vfs.read(path),
      write: async (_pid, path, content) => { vfs.write(path, content) },
      gitStatus: async () => ({})
    },
    agent: {
      start: async (value) => {
        const req = parseAgentStart(value)
        const session = sessions.find((s) => s.id === req.sessionId)
        if (!session) throw new Error('Agent session not found.')
        const trusted = createTrustedRunRequest(req, session, fullAccessGrants, true)
        rejectPending(req.sessionId)
        logger.log(req.sessionId, 'demo', 'Preview run: scripted provider')
        void agent.start(trusted)
      },
      approve: async (id, value, autoType) => {
        if (autoType !== undefined && !isApprovalType(autoType)) throw new Error('Invalid approval request.')
        const decision = parseApprovalDecision(value)
        const approval = pending.get(id)
        if (!approval) return
        pending.delete(id)
        if (autoType) agent.autoApprove(approval.sessionId, autoType)
        approval.resolve(decision)
      },
      pause: async (sid) => agent.pause(sid),
      resume: async (sid) => agent.resume(sid),
      stop: async (sid) => {
        agent.stop(sid)
        rejectPending(sid)
      },
      kill: async () => {
        agent.killAll()
        fullAccessGrants.revokeAll()
        for (const sessionId of new Set([...pending.values()].map((approval) => approval.sessionId))) rejectPending(sessionId)
      }
    },
    terminal: {
      create: async () => 'manual',
      input: async (id, data) => {
        if (data === '\r') {
          termSink(id, '\r\n[preview] interactive shell is available in the desktop app\r\n$ ')
        } else if (data === '\u007f') {
          termSink(id, '\b \b')
        } else {
          termSink(id, data)
        }
      },
      kill: async () => {}
    },
    checkpoints: {
      list: async (sid) => checkpoints.filter((c) => c.sessionId === sid),
      restore: async (id) => {
        const cp = checkpoints.find((c) => c.id === id)
        const files = checkpointSnapshots.get(id)
        if (!cp || !files) throw new Error('Checkpoint snapshot is missing.')
        const resolved = files.map((file) => ({ ...file, path: vfs.resolve(file.path) }))
        for (const file of resolved) {
          if (file.before === null) vfs.files.delete(file.path)
          else vfs.files.set(file.path, file.before)
        }
      }
    },
    activity: {
      list: async (sid, query) => filterEntries(sid ? activity.filter((a) => a.sessionId === sid) : activity, query),
      export: async (sid) => {
        const entries = sid ? activity.filter((a) => a.sessionId === sid) : activity
        const blob = new Blob([JSON.stringify(entries, null, 2)], { type: 'application/json' })
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = 'nexa-activity.json'
        a.click()
        URL.revokeObjectURL(a.href)
        return 'nexa-activity.json'
      }
    },
    updates: {
      status: async () => updateState,
      check: async () => updateState,
      install: async () => {}
    },
    attach: {
      pick: () => new Promise<Attachment[]>((resolve) => {
        const input = document.createElement('input')
        input.type = 'file'
        input.multiple = true
        input.onchange = async () => {
          const out: Attachment[] = []
          for (const file of [...(input.files ?? [])].slice(0, 5)) {
            if (file.size > 200 * 1024) continue
            out.push({ name: file.name, path: file.name, content: await file.text() })
          }
          resolve(out)
        }
        input.click()
      })
    },
    onAgentEvent: (cb) => { agentListeners.add(cb); return () => agentListeners.delete(cb) },
    onTerminalData: (cb) => { termListeners.add(cb); return () => termListeners.delete(cb) },
    onUpdateState: (cb) => { updateListeners.add(cb); return () => updateListeners.delete(cb) }
  }
}