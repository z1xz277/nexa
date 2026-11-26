import { create } from 'zustand'
import type {
  ActivityEntry, AgentEvent, AgentStatus, ApprovalDecision, ApprovalRequest,
  ApprovalType, Attachment, ChatMessage, Checkpoint, Effort, FileNode, KeyStatus,
  Mode, ModelInfo, PlanStep, Project, Session, Settings, UpdateState
} from '@shared/types'
import { DEFAULT_SETTINGS, uid } from '@shared/types'
import { bridge } from './bridge'
import { chooseModel } from './model-selection'
import { displayModelLabel } from './lib/model-label'

export interface ToolFeedItem {
  id: string
  name: string
  args: Record<string, unknown>
  state: 'call' | 'result'
  result?: string
  ms?: number
  tokens?: number
  ts: number
}

export interface EditorTarget {
  path: string
  content: string
  dirty: boolean
}

export interface DiffTarget {
  path: string
  before: string
  after: string
}

export interface Toast {
  message: string
  kind: 'success' | 'error' | 'info'
}

interface NexaState {
  ready: boolean
  settings: Settings
  keys: KeyStatus
  models: ModelInfo[]
  modelsLoading: boolean
  cachedAt: number | null
  projects: Project[]
  activeProjectId: string | null
  sessions: Session[]
  activeSessionId: string | null
  messages: ChatMessage[]
  streaming: { messageId: string; text: string; pieces: string[] } | null
  agentStatus: AgentStatus
  plan: PlanStep[]
  toolFeed: ToolFeedItem[]
  approvals: ApprovalRequest[]
  checkpoints: Checkpoint[]
  activity: ActivityEntry[]
  effort: Effort
  mode: Mode
  model: { id: string; provider: 'nvidia' | 'openrouter' } | null
  view: 'hero' | 'chat'
  rightOpen: boolean
  rightTab: 'code' | 'terminal'
  activityOpen: boolean
  settingsOpen: boolean
  quickOpen: boolean
  attachments: Attachment[]
  toast: Toast | null
  tree: FileNode[]
  gitStatus: Record<string, string>
  editor: EditorTarget | null
  diff: DiffTarget | null
  terminalId: string | null
  update: UpdateState
  updateOpen: boolean

  init(): Promise<void>
  handleEvent(e: AgentEvent): void
  patchSettings(patch: Partial<Settings>): Promise<void>
  refreshModels(force?: boolean): Promise<void>
  refreshKeys(): Promise<void>
  openProject(id: string | null): Promise<void>
  createProject(name: string, path: string | null): Promise<void>
  deleteProject(id: string): Promise<void>
  newSession(): Promise<void>
  openSession(id: string): Promise<void>
  deleteSession(id: string): Promise<void>
  send(prompt: string): Promise<void>
  approve(id: string, decision: ApprovalDecision, autoType?: ApprovalType): Promise<void>
  pause(): Promise<void>
  resume(): Promise<void>
  stop(): Promise<void>
  kill(): Promise<void>
  setEffort(e: Effort): void
  setMode(m: Mode): void
  setModel(m: { id: string; provider: 'nvidia' | 'openrouter' } | null): void
  addAttachments(): Promise<void>
  removeAttachment(path: string): void
  setView(v: 'hero' | 'chat'): void
  toggleSidebar(): void
  setRight(open: boolean, tab?: 'code' | 'terminal'): void
  setActivity(open: boolean): void
  setSettings(open: boolean): void
  setQuick(open: boolean): void
  showToast(msg: string, kind?: Toast['kind']): void
  loadTree(): Promise<void>
  openFile(path: string): Promise<void>
  saveFile(): Promise<void>
  setEditorContent(content: string): void
  openDiff(path: string, before: string, after: string): void
  closeDiff(): void
  applyDiffHunk(path: string, after: string): Promise<void>
  loadCheckpoints(): Promise<void>
  restoreCheckpoint(id: string): Promise<void>
  loadActivity(query: string): Promise<void>
  exportActivity(): Promise<void>
  ensureTerminal(): Promise<void>
  checkForUpdates(): Promise<void>
  installUpdate(): Promise<void>
  closeUpdate(): void
}

let toastTimer: ReturnType<typeof setTimeout> | null = null

export const useNexa = create<NexaState>((set, get) => ({
  ready: false,
  settings: DEFAULT_SETTINGS,
  keys: { nvidia: false, openrouter: false },
  models: [],
  modelsLoading: false,
  cachedAt: null,
  projects: [],
  activeProjectId: null,
  sessions: [],
  activeSessionId: null,
  messages: [],
  streaming: null,
  agentStatus: 'idle',
  plan: [],
  toolFeed: [],
  approvals: [],
  checkpoints: [],
  activity: [],
  effort: 'medium',
  mode: 'agent',
  model: null,
  view: 'hero',
  rightOpen: false,
  rightTab: 'code',
  activityOpen: false,
  settingsOpen: false,
  quickOpen: false,
  attachments: [],
  toast: null,
  tree: [],
  gitStatus: {},
  editor: null,
  diff: null,
  terminalId: null,
  update: { phase: 'idle', currentVersion: '1.0.0' },
  updateOpen: false,

  async init() {
    const [settings, keys, projects, update] = await Promise.all([
      bridge.settings.get(),
      bridge.keys.status(),
      bridge.projects.list(),
      bridge.updates.status()
    ])
    const activeProjectId = projects[0]?.id ?? null
    const sessions = activeProjectId ? await bridge.sessions.list(activeProjectId) : []
    set({
      settings, keys, projects, activeProjectId, sessions, update,
      effort: projects[0]?.defaultEffort ?? 'medium',
      ready: true
    })
    document.documentElement.dataset.theme = settings.theme
    document.documentElement.dataset.motion = settings.motion
    void get().loadTree()
    void get().refreshModels(false)
  },

  handleEvent(e) {
    const s = get()
    if (e.sessionId !== s.activeSessionId && e.type !== 'status') return
    switch (e.type) {
      case 'status':
        if (e.sessionId === s.activeSessionId) set({ agentStatus: e.status })
        break
      case 'chunk':
        set((st) => ({
          streaming: st.streaming?.messageId === e.messageId
            ? { messageId: e.messageId, text: st.streaming.text + e.text, pieces: [...st.streaming.pieces, e.text] }
            : { messageId: e.messageId, text: e.text, pieces: [e.text] }
        }))
        break
      case 'message': {
        set((st) => {
          const exists = st.messages.some((m) => m.id === e.message.id)
          const messages = exists
            ? st.messages.map((m) => (m.id === e.message.id ? e.message : m))
            : [...st.messages, e.message]
          return {
            messages,
            streaming: st.streaming?.messageId === e.message.id ? null : st.streaming
          }
        })
        break
      }
      case 'plan':
        set({ plan: e.steps })
        break
      case 'tool':
        set((st) => {
          const item: ToolFeedItem = {
            id: e.callId, name: e.name, args: e.args, state: e.state,
            result: e.result, ms: e.ms, tokens: e.tokens, ts: Date.now()
          }
          const exists = st.toolFeed.some((entry) => entry.id === e.callId)
          return {
            toolFeed: exists
              ? st.toolFeed.map((entry) => entry.id === e.callId ? item : entry)
              : [...st.toolFeed.slice(-40), item]
          }
        })
        break
      case 'approval':
        set((st) => ({ approvals: [...st.approvals, e.request] }))
        break
      case 'approval_resolved':
        set((st) => ({ approvals: st.approvals.filter((a) => a.id !== e.id) }))
        break
      case 'checkpoint':
        set((st) => ({ checkpoints: [e.checkpoint, ...st.checkpoints.filter((c) => c.id !== e.checkpoint.id)] }))
        break
      case 'fallback':
        get().showToast(`Switched to ${displayModelLabel(e.to.split('/').pop() ?? e.to)} after a provider interruption.`, 'info')
        break
      case 'error':
        set((st) => ({
          messages: [...st.messages, { id: uid(), role: 'assistant', content: `Error: ${e.message}`, createdAt: Date.now() }],
          streaming: null
        }))
        break
      case 'done':
        set({ streaming: null, agentStatus: 'idle' })
        if (s.activeProjectId !== undefined) {
          void bridge.sessions.list(s.activeProjectId).then((sessions) => set({ sessions }))
        }
        void get().loadTree()
        break
    }
  },

  async patchSettings(patch) {
    const settings = await bridge.settings.set(patch)
    document.documentElement.dataset.theme = settings.theme
    document.documentElement.dataset.motion = settings.motion
    set({ settings })
  },

  async refreshModels(force) {
    set({ modelsLoading: true })
    try {
      const models = await bridge.models.list(force)
      const cachedAt = await bridge.models.cachedAt()
      set((st) => {
        const project = st.projects.find((p) => p.id === st.activeProjectId)
        const model = chooseModel(models, st.model, project?.defaultModel)
        return { models, cachedAt, modelsLoading: false, model }
      })
    } catch {
      set({ modelsLoading: false })
      get().showToast('Could not load models. Check your connection or keys.', 'error')
    }
  },

  async refreshKeys() {
    set({ keys: await bridge.keys.status() })
  },

  async openProject(id) {
    const sessions = id ? await bridge.sessions.list(id) : []
    const project = get().projects.find((p) => p.id === id)
    set({
      activeProjectId: id, sessions, activeSessionId: null, messages: [],
      view: 'hero', plan: [], toolFeed: [], approvals: [], streaming: null,
      effort: project?.defaultEffort ?? get().effort,
      editor: null, diff: null, tree: [], checkpoints: []
    })
    if (project?.defaultModel) {
      const m = get().models.find((x) => x.id === project.defaultModel)
      if (m) set({ model: { id: m.id, provider: m.provider } })
    }
    void get().loadTree()
    void get().loadCheckpoints()
  },

  async createProject(name, path) {
    const project = await bridge.projects.create({ name, path })
    set((st) => ({ projects: [...st.projects, project] }))
    await get().openProject(project.id)
    get().showToast(`Project ${name} created`)
  },

  async deleteProject(id) {
    await bridge.projects.remove(id)
    set((st) => ({ projects: st.projects.filter((p) => p.id !== id) }))
    if (get().activeProjectId === id) await get().openProject(get().projects[0]?.id ?? null)
  },

  async newSession() {
    const session = await bridge.sessions.create(get().activeProjectId, 'New session')
    set((st) => ({
      sessions: [session, ...st.sessions],
      activeSessionId: session.id,
      messages: [], view: 'chat', plan: [], toolFeed: [], streaming: null, approvals: []
    }))
  },

  async openSession(id) {
    const messages = await bridge.sessions.messages(id)
    set({ activeSessionId: id, messages, view: 'chat', plan: [], toolFeed: [], streaming: null, approvals: [], agentStatus: 'idle' })
    void get().loadCheckpoints()
  },

  async deleteSession(id) {
    await bridge.sessions.remove(id)
    set((st) => ({ sessions: st.sessions.filter((s) => s.id !== id) }))
    if (get().activeSessionId === id) set({ activeSessionId: null, messages: [], view: 'hero' })
  },

  async send(prompt) {
    const s = get()
    const trimmed = prompt.trim()
    if (!trimmed || s.agentStatus === 'running') return
    let sessionId = s.activeSessionId
    if (!sessionId) {
      const session = await bridge.sessions.create(s.activeProjectId, trimmed.slice(0, 60))
      sessionId = session.id
      set((st) => ({ sessions: [session, ...st.sessions], activeSessionId: sessionId }))
    }
    set({ view: 'chat' })
    try {
      await bridge.agent.start({
        sessionId,
        projectId: s.activeProjectId,
        prompt: trimmed,
        model: s.model,
        effort: s.effort,
        mode: s.mode,
        attachments: s.attachments
      })
      set({ attachments: [] })
    } finally {
      set((st) => st.mode === 'full' ? { mode: 'agent' } : {})
    }
  },

  async approve(id, decision, autoType) {
    await bridge.agent.approve(id, decision, autoType)
  },

  async pause() {
    const id = get().activeSessionId
    if (id) await bridge.agent.pause(id)
  },
  async resume() {
    const id = get().activeSessionId
    if (id) await bridge.agent.resume(id)
  },
  async stop() {
    const id = get().activeSessionId
    if (id) await bridge.agent.stop(id)
  },
  async kill() {
    await bridge.agent.kill()
    set({ agentStatus: 'idle', approvals: [], streaming: null })
    get().showToast('Kill switch: all runs and terminals stopped')
  },

  setEffort(effort) { set({ effort }) },
  setMode(mode) { set({ mode }) },
  setModel(model) { set({ model }) },

  async addAttachments() {
    const picked = await bridge.attach.pick()
    if (picked.length) set((st) => ({ attachments: [...st.attachments, ...picked].slice(0, 5) }))
  },
  removeAttachment(path) {
    set((st) => ({ attachments: st.attachments.filter((a) => a.path !== path) }))
  },

  setView(view) { set({ view }) },
  toggleSidebar() { void get().patchSettings({ sidebarCollapsed: !get().settings.sidebarCollapsed }) },
  setRight(rightOpen, tab) { set({ rightOpen, ...(tab ? { rightTab: tab } : {}) }) },
  setActivity(activityOpen) {
    set({ activityOpen })
    if (activityOpen) void get().loadActivity('')
  },
  setSettings(settingsOpen) { set({ settingsOpen }) },
  setQuick(quickOpen) { set({ quickOpen }) },

  showToast(msg, kind = 'success') {
    if (toastTimer) clearTimeout(toastTimer)
    set({ toast: { message: msg, kind } })
    toastTimer = setTimeout(() => set({ toast: null }), 3200)
  },

  async loadTree() {
    const id = get().activeProjectId
    if (!id) return
    try {
      const [tree, gitStatus] = await Promise.all([bridge.fs.tree(id), bridge.fs.gitStatus(id)])
      set({ tree, gitStatus })
    } catch { /* project without folder */ }
  },

  async openFile(path) {
    const id = get().activeProjectId
    if (!id) return
    try {
      const content = await bridge.fs.read(id, path)
      set({ editor: { path, content, dirty: false }, rightOpen: true, rightTab: 'code', diff: null })
    } catch (err) {
      get().showToast(err instanceof Error ? err.message : 'Could not open file', 'error')
    }
  },

  async saveFile() {
    const { editor, activeProjectId } = get()
    if (!editor || !activeProjectId) return
    await bridge.fs.write(activeProjectId, editor.path, editor.content)
    set({ editor: { ...editor, dirty: false } })
    get().showToast(`Saved ${editor.path}`)
    void get().loadTree()
  },

  setEditorContent(content) {
    set((st) => (st.editor ? { editor: { ...st.editor, content, dirty: true } } : {}))
  },

  openDiff(path, before, after) {
    set({ diff: { path, before, after }, rightOpen: true, rightTab: 'code' })
  },
  closeDiff() { set({ diff: null }) },

  async applyDiffHunk(path, after) {
    const id = get().activeProjectId
    if (!id) return
    await bridge.fs.write(id, path, after)
    set({ diff: null })
    get().showToast(`Applied change to ${path}`)
    void get().loadTree()
  },

  async loadCheckpoints() {
    const id = get().activeSessionId
    if (!id) return
    set({ checkpoints: await bridge.checkpoints.list(id) })
  },

  async restoreCheckpoint(id) {
    await bridge.checkpoints.restore(id)
    get().showToast('Checkpoint restored')
    void get().loadTree()
    const sid = get().activeSessionId
    if (sid) set({ messages: await bridge.sessions.messages(sid) })
  },

  async loadActivity(query) {
    set({ activity: await bridge.activity.list(get().activeSessionId, query) })
  },

  async exportActivity() {
    const file = await bridge.activity.export(get().activeSessionId)
    if (file) get().showToast('Activity exported (secrets redacted)')
  },

  async ensureTerminal() {
    if (get().terminalId) return
    const id = await bridge.terminal.create(get().activeProjectId)
    set({ terminalId: id })
  },

  async checkForUpdates() {
    set({ updateOpen: true })
    try {
      const update = await bridge.updates.check()
      set({ update })
    } catch (error) {
      get().showToast(error instanceof Error ? error.message : 'Could not check for updates.', 'error')
    }
  },

  async installUpdate() {
    try {
      await bridge.updates.install()
    } catch (error) {
      set((st) => ({
        update: { ...st.update, phase: 'error', message: error instanceof Error ? error.message : 'Could not install the update.' },
        updateOpen: true
      }))
    }
  },

  closeUpdate() { set({ updateOpen: false }) }
}))