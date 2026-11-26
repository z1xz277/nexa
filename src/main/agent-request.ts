import { z } from 'zod'
import type { AgentRunRequest } from '@core/agent'
import { FullAccessGrants, isApprovalType, type RunAccess } from '@core/access'
import type { AgentStartRequest, ApprovalDecision, ApprovalType, Session } from '@shared/types'

const requestSchema = z.object({
  sessionId: z.string().min(1).max(120),
  projectId: z.string().min(1).max(120).nullable(),
  prompt: z.string().min(1).max(100_000),
  model: z.object({
    id: z.string().min(1).max(240),
    provider: z.enum(['nvidia', 'openrouter'])
  }).strict().nullable(),
  effort: z.enum(['low', 'medium', 'high', 'max']),
  mode: z.enum(['ask', 'agent', 'full']),
  attachments: z.array(z.object({
    name: z.string().min(1).max(240),
    path: z.string().min(1).max(1000),
    content: z.string().max(220_000)
  }).strict()).max(5)
}).strict()

const approvalSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('approve') }).strict(),
  z.object({ action: z.literal('reject') }).strict(),
  z.object({ action: z.literal('edit'), args: z.record(z.unknown()) }).strict()
])

export function parseAgentStart(value: unknown): AgentStartRequest {
  const parsed = requestSchema.safeParse(value)
  if (!parsed.success) throw new Error('Invalid agent request.')
  return parsed.data
}

export function createTrustedRunRequest(
  req: AgentStartRequest,
  session: Session,
  grants: FullAccessGrants,
  hostConfirmed = false
): AgentRunRequest {
  if (req.sessionId !== session.id) throw new Error('Agent session does not match.')
  let access: RunAccess
  if (req.mode === 'full') {
    if (!hostConfirmed) throw new Error('Full Access requires host confirmation.')
    const grant = grants.issue(session.id, session.projectId)
    access = grants.consume(grant.token, session.id, session.projectId)
  } else {
    access = { mode: req.mode, fullAccess: false, autoApprove: [] }
  }
  return { ...req, projectId: session.projectId, access }
}

export function parseApprovalDecision(value: unknown): ApprovalDecision {
  const parsed = approvalSchema.safeParse(value)
  if (!parsed.success) throw new Error('Invalid approval decision.')
  return parsed.data
}

export function approvalAutoType(
  decision: ApprovalDecision,
  pendingType: ApprovalType,
  requestedType: unknown
): ApprovalType | null {
  if (!isApprovalType(requestedType) || requestedType !== pendingType) return null
  return decision.action === 'approve' || decision.action === 'edit' ? requestedType : null
}
