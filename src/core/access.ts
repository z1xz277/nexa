import type { AccessGrant, ApprovalType, Mode } from '@shared/types'

export const APPROVAL_TYPES: readonly ApprovalType[] = ['write', 'edit', 'command', 'network', 'memory']
export const FULL_ACCESS_APPROVALS: readonly ApprovalType[] = ['write', 'edit', 'command', 'network', 'memory']

export interface RunAccess {
  mode: Mode
  fullAccess: boolean
  autoApprove: readonly ApprovalType[]
}

interface StoredGrant {
  sessionId: string
  projectId: string | null
  expiresAt: number
}

interface GrantOptions {
  now?: () => number
  ttlMs?: number
}

export function isApprovalType(value: unknown): value is ApprovalType {
  return typeof value === 'string' && APPROVAL_TYPES.includes(value as ApprovalType)
}

export function parseRunAccess(value: unknown): RunAccess {
  if (!value || typeof value !== 'object') throw new Error('Trusted run access is required.')
  const input = value as Record<string, unknown>
  const mode = input.mode
  if (mode !== 'ask' && mode !== 'agent' && mode !== 'full') throw new Error('Trusted run access has an invalid mode.')
  if (typeof input.fullAccess !== 'boolean') throw new Error('Trusted run access is incomplete.')
  if (!Array.isArray(input.autoApprove) || !input.autoApprove.every(isApprovalType)) {
    throw new Error('Trusted run access has invalid approval capabilities.')
  }
  const autoApprove = [...new Set(input.autoApprove)]
  if (mode === 'ask' && (input.fullAccess || autoApprove.length > 0)) {
    throw new Error('Ask mode cannot grant Full Access or auto-approval.')
  }
  if (mode !== 'full' && input.fullAccess) throw new Error('Full Access requires full mode.')
  if (mode === 'full' && (!input.fullAccess || !FULL_ACCESS_APPROVALS.every((type) => autoApprove.includes(type)))) {
    throw new Error('Full Access requires a complete trusted grant.')
  }
  return { mode, fullAccess: input.fullAccess, autoApprove }
}

export class FullAccessGrants {
  private grants = new Map<string, StoredGrant>()
  private readonly now: () => number
  private readonly ttlMs: number

  constructor(options: GrantOptions = {}) {
    this.now = options.now ?? Date.now
    this.ttlMs = options.ttlMs ?? 120_000
  }

  issue(sessionId: string, projectId: string | null): AccessGrant {
    const now = this.now()
    for (const [token, grant] of this.grants) {
      if (grant.expiresAt <= now) this.grants.delete(token)
    }
    const token = globalThis.crypto.randomUUID()
    const expiresAt = now + this.ttlMs
    this.grants.set(token, { sessionId, projectId, expiresAt })
    return { token, expiresAt }
  }

  revokeAll(): void {
    this.grants.clear()
  }

  consume(token: string, sessionId: string, projectId: string | null): RunAccess {
    const grant = this.grants.get(token)
    this.grants.delete(token)
    if (!grant || grant.expiresAt <= this.now() || grant.sessionId !== sessionId || grant.projectId !== projectId) {
      throw new Error('Full Access grant is invalid or expired.')
    }
    return { mode: 'full', fullAccess: true, autoApprove: [...FULL_ACCESS_APPROVALS] }
  }
}
