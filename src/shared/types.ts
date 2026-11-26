export type ProviderId = 'nvidia' | 'openrouter'
export type Effort = 'low' | 'medium' | 'high' | 'max'
export type Mode = 'ask' | 'agent' | 'full'
export type Theme = 'dark' | 'light'
export type MotionLevel = 'full' | 'reduced' | 'off'
export type AgentStatus = 'idle' | 'running' | 'paused' | 'error'
export type ApprovalType = 'write' | 'edit' | 'command' | 'network' | 'memory'

export interface ModelInfo {
  id: string
  provider: ProviderId
  name: string
  context: number
  capabilities: { code: boolean; reasoning: boolean; vision: boolean; tools: boolean }
}

export interface Project {
  id: string
  name: string
  path: string | null
  instructions: string
  defaultModel: string | null
  defaultEffort: Effort
  pinnedFiles: string[]
  createdAt: number
}

export interface Session {
  id: string
  projectId: string | null
  title: string
  createdAt: number
  updatedAt: number
}

export interface Attachment {
  name: string
  path: string
  content: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'tool'
  content: string
  model?: string
  provider?: ProviderId
  attachments?: Attachment[]
  toolName?: string
  usage?: { tokens: number; ms: number }
  createdAt: number
}

export interface PlanStep {
  id: string
  text: string
  status: 'pending' | 'running' | 'done' | 'failed'
}

export interface ApprovalRequest {
  id: string
  sessionId: string
  type: ApprovalType
  toolName: string
  title: string
  path?: string
  command?: string
  diff?: { before: string; after: string }
  warning?: string
  args: Record<string, unknown>
}

export type ApprovalDecision =
  | { action: 'approve' }
  | { action: 'reject' }
  | { action: 'edit'; args: Record<string, unknown> }

export interface ActivityEntry {
  id: string
  ts: number
  sessionId: string
  kind: string
  summary: string
  data?: unknown
}

export interface Checkpoint {
  id: string
  sessionId: string
  ts: number
  label: string
  files: { path: string; existed: boolean }[]
}

export interface FileNode {
  name: string
  path: string
  kind: 'file' | 'dir'
  children?: FileNode[]
}

export interface Settings {
  theme: Theme
  motion: MotionLevel
  sidebarCollapsed: boolean
  rightPanelWidth: number
}

export interface KeyStatus {
  nvidia: boolean
  openrouter: boolean
}

export interface UpdateState {
  phase: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error' | 'unsupported'
  currentVersion: string
  latestVersion?: string
  percent?: number
  message?: string
}

export interface AccessGrant {
  token: string
  expiresAt: number
}

export interface AgentStartRequest {
  sessionId: string
  projectId: string | null
  prompt: string
  model: { id: string; provider: ProviderId } | null
  effort: Effort
  mode: Mode
  attachments: Attachment[]
}

export type AgentEvent =
  | { type: 'status'; sessionId: string; status: AgentStatus }
  | { type: 'chunk'; sessionId: string; messageId: string; text: string }
  | { type: 'message'; sessionId: string; message: ChatMessage }
  | { type: 'plan'; sessionId: string; steps: PlanStep[] }
  | { type: 'tool'; sessionId: string; callId: string; name: string; args: Record<string, unknown>; state: 'call' | 'result'; result?: string; ms?: number; tokens?: number }
  | { type: 'approval'; sessionId: string; request: ApprovalRequest }
  | { type: 'approval_resolved'; sessionId: string; id: string; decision: string }
  | { type: 'checkpoint'; sessionId: string; checkpoint: Checkpoint }
  | { type: 'fallback'; sessionId: string; from: string; to: string; reason: string }
  | { type: 'error'; sessionId: string; message: string }
  | { type: 'done'; sessionId: string; usage: { tokens: number; ms: number } }

export const DEFAULT_SETTINGS: Settings = {
  theme: 'light',
  motion: 'full',
  sidebarCollapsed: false,
  rightPanelWidth: 460
}

export const uid = (): string =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 8)