import type { Effort, ModelInfo, ProviderId } from '@shared/types'

export interface ToolCall {
  id: string
  name: string
  arguments: string
}

export interface ToolSpec {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export interface ProviderMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[]
  tool_call_id?: string
}

export interface ChatRequest {
  model: string
  messages: ProviderMessage[]
  tools?: ToolSpec[]
  effort: Effort
  signal?: AbortSignal
}

export interface StreamHandlers {
  onChunk(text: string): void
}

export interface StreamResult {
  text: string
  toolCalls: ToolCall[]
  tokens: number
}

export class ProviderError extends Error {
  constructor(message: string, public status: number, public retryable: boolean) {
    super(message)
  }
}

export interface ModelCache {
  get(provider: ProviderId): { ts: number; models: ModelInfo[] } | null
  set(provider: ProviderId, models: ModelInfo[]): void
  delete?(provider: ProviderId): void
}

export interface Provider {
  id: ProviderId
  listModels(force: boolean): Promise<ModelInfo[]>
  stream(req: ChatRequest, handlers: StreamHandlers): Promise<StreamResult>
}