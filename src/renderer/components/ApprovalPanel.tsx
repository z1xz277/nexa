import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import type { ApprovalRequest } from '@shared/types'
import { useNexa } from '../store'
import { SPRING } from '../motion'
import { IconCheck, IconEdit, IconX } from './Icons'

function DiffPreview({ before, after }: { before: string; after: string }) {
  const rows = useMemo(() => {
    const a = before.split('\n')
    const b = after.split('\n')
    let start = 0
    while (start < a.length && start < b.length && a[start] === b[start]) start++
    let endA = a.length, endB = b.length
    while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB-- }
    const out: { kind: 'ctx' | 'del' | 'add'; text: string }[] = []
    for (let i = Math.max(0, start - 2); i < start; i++) out.push({ kind: 'ctx', text: a[i] })
    for (let i = start; i < Math.min(endA, start + 24); i++) out.push({ kind: 'del', text: a[i] })
    for (let i = start; i < Math.min(endB, start + 24); i++) out.push({ kind: 'add', text: b[i] })
    for (let i = endA; i < Math.min(a.length, endA + 2); i++) out.push({ kind: 'ctx', text: a[i] })
    if (endA - start > 24 || endB - start > 24) out.push({ kind: 'ctx', text: '… truncated …' })
    return out
  }, [before, after])

  return (
    <pre
      className="mono max-h-[220px] overflow-auto px-3 py-2.5"
      style={{ fontSize: 12, lineHeight: 1.6, background: 'var(--surface)', border: '1px solid var(--hairline)', borderRadius: 'var(--r-md)' }}
    >
      {rows.map((r, i) => (
        <div
          key={i}
          style={{
            color: r.kind === 'del' ? 'var(--danger)' : r.kind === 'add' ? 'var(--success)' : 'var(--text-3)',
            whiteSpace: 'pre-wrap'
          }}
        >
          {r.kind === 'del' ? '- ' : r.kind === 'add' ? '+ ' : '  '}{r.text || ' '}
        </div>
      ))}
    </pre>
  )
}

export function ApprovalPanel() {
  const approvals = useNexa((s) => s.approvals)
  const approve = useNexa((s) => s.approve)
  const request = approvals[0]
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [auto, setAuto] = useState(false)

  useEffect(() => {
    setEditing(false)
    setDraft('')
    setAuto(false)
  }, [request?.id])

  if (!request) return null

  const startEdit = (req: ApprovalRequest) => {
    setEditing(true)
    setDraft(req.type === 'command' ? String(req.args.command ?? '') : String(req.args.content ?? JSON.stringify(req.args, null, 2)))
  }

  const submitEdit = () => {
    const args = { ...request.args }
    if (request.type === 'command') args.command = draft
    else if (request.type === 'edit') {
      try {
        const parsed = JSON.parse(draft)
        Object.assign(args, parsed)
      } catch {
        args.replace = draft
      }
    } else args.content = draft
    void approve(request.id, { action: 'edit', args }, auto ? request.type : undefined)
    setEditing(false)
    setAuto(false)
  }

  const decide = (action: 'approve' | 'reject') => {
    void approve(request.id, { action }, auto ? request.type : undefined)
    setEditing(false)
    setAuto(false)
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 12 }}
      transition={SPRING}
      className="hairline-t shrink-0 px-6 py-4"
      style={{ background: 'var(--bg)' }}
    >
      <div className="mx-auto w-full max-w-[860px]">
        <div className="mb-2 flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <span className="label" style={{ color: 'var(--accent)' }}>Approval required</span>
          <span className="text-[13px]" style={{ fontWeight: 500 }}>{request.title}</span>
          {approvals.length > 1 && <span className="meta">+{approvals.length - 1} queued</span>}
          {request.warning && (
            <span className="meta" style={{ color: 'var(--danger)' }}>{request.warning}</span>
          )}
        </div>

        {request.type === 'command' ? (
          <pre
            className="mono overflow-x-auto px-3 py-2.5"
            style={{ fontSize: 12, color: 'var(--text-1)', background: 'var(--surface)', border: '1px solid var(--hairline)', borderRadius: 'var(--r-md)' }}
          >
            $ {request.command}
          </pre>
        ) : request.diff ? (
          <DiffPreview before={request.diff.before} after={request.diff.after} />
        ) : null}

        {editing && (
          <textarea
            autoFocus
            className="field mono mt-2 resize-y"
            style={{ minHeight: 90, fontSize: 12 }}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
        )}

        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
          {editing ? (
            <>
              <button className="btn-primary text-[12px]" onClick={submitEdit}>Apply edit</button>
              <button className="btn-text text-[12px]" onClick={() => setEditing(false)}>Cancel</button>
            </>
          ) : (
            <>
              <button className="btn-primary flex items-center gap-1.5 text-[12px]" onClick={() => decide('approve')}>
                <IconCheck size={11} /> Approve
              </button>
              <button className="btn-outline flex items-center gap-1.5 text-[12px]" onClick={() => startEdit(request)}>
                <IconEdit size={11} /> Edit
              </button>
              <button className="btn-text flex items-center gap-1.5 text-[12px]" style={{ color: 'var(--danger)' }} onClick={() => decide('reject')}>
                <IconX size={11} /> Reject
              </button>
            </>
          )}
          <button
            className="btn-text ml-auto text-[11px]"
            style={{ color: auto ? 'var(--accent)' : 'var(--text-3)', textDecorationColor: auto ? 'var(--accent)' : undefined }}
            onClick={() => setAuto(!auto)}
          >
            <span className="inline-flex items-center gap-1.5">
              {auto && <IconCheck size={10} />}
              Auto-approve {request.type} for this run
            </span>
          </button>
        </div>
      </div>
    </motion.div>
  )
}