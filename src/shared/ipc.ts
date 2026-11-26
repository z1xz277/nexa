import type {
  ActivityEntry, AgentEvent, AgentStartRequest, ApprovalDecision, ApprovalType,
  Attachment, ChatMessage, Checkpoint, FileNode, KeyStatus, ModelInfo, Project,
  ProviderId, Session, Settings, UpdateState
} from './types'

// Single typed contract between renderer and host. The preload bridge and the
// browser dev mock both implement NexaBridge, so the UI never knows the host.
export interface NexaBridge {
  window: {
    minimize(): void
    maximize(): void
    close(): void
  }
  settings: {
    get(): Promise<Settings>
    set(patch: Partial<Settings>): Promise<Settings>
  }
  keys: {
    set(provider: ProviderId, key: string): Promise<void>
    status(): Promise<KeyStatus>
    clear(provider: ProviderId): Promise<void>
  }
  models: {
    list(force?: boolean): Promise<ModelInfo[]>
    cachedAt(): Promise<number | null>
  }
  projects: {
    list(): Promise<Project[]>
    create(input: { name: string; path: string | null }): Promise<Project>
    update(id: string, patch: Partial<Project>): Promise<Project>
    remove(id: string): Promise<void>
    pickFolder(): Promise<string | null>
    memory(id: string): Promise<string>
  }
  sessions: {
    list(projectId: string | null): Promise<Session[]>
    create(projectId: string | null, title: string): Promise<Session>
    messages(sessionId: string): Promise<ChatMessage[]>
    rename(id: string, title: string): Promise<void>
    remove(id: string): Promise<void>
  }
  fs: {
    tree(projectId: string): Promise<FileNode[]>
    read(projectId: string, path: string): Promise<string>
    write(projectId: string, path: string, content: string): Promise<void>
    gitStatus(projectId: string): Promise<Record<string, string>>
  }
  agent: {
    start(req: AgentStartRequest): Promise<void>
    approve(id: string, decision: ApprovalDecision, autoType?: ApprovalType): Promise<void>
    pause(sessionId: string): Promise<void>
    resume(sessionId: string): Promise<void>
    stop(sessionId: string): Promise<void>
    kill(): Promise<void>
  }
  terminal: {
    create(projectId: string | null): Promise<string>
    input(id: string, data: string): Promise<void>
    kill(id: string): Promise<void>
  }
  checkpoints: {
    list(sessionId: string): Promise<Checkpoint[]>
    restore(id: string): Promise<void>
  }
  activity: {
    list(sessionId: string | null, query: string): Promise<ActivityEntry[]>
    export(sessionId: string | null): Promise<string | null>
  }
  updates: {
    status(): Promise<UpdateState>
    check(): Promise<UpdateState>
    install(): Promise<void>
  }
  attach: {
    pick(): Promise<Attachment[]>
  }
  onAgentEvent(cb: (e: AgentEvent) => void): () => void
  onTerminalData(cb: (id: string, data: string) => void): () => void
  onUpdateState(cb: (state: UpdateState) => void): () => void
}

export const CH = {
  agentEvent: 'nexa:agent-event',
  terminalData: 'nexa:terminal-data',
  updateState: 'nexa:update-state'
} as const