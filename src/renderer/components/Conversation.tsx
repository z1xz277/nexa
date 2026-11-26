import { useEffect, useRef, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import type { ChatMessage, PlanStep } from '@shared/types'
import { useNexa, type ToolFeedItem } from '../store'
import { SPRING } from '../motion'
import { displayModelLabel } from '../lib/model-label'
import { ModelLogo } from './Logo'
import { IconRestore } from './Icons'

function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /(`[^`]+`|\*\*[^*]+\*\*|@[\w./#-]+)/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const tok = m[0]
    if (tok.startsWith('`')) {
      out.push(<code key={`${keyBase}-${i}`} className="mono" style={{ color: 'var(--text-1)', fontSize: '0.92em' }}>{tok.slice(1, -1)}</code>)
    } else if (tok.startsWith('**')) {
      out.push(<strong key={`${keyBase}-${i}`} style={{ fontWeight: 500 }}>{tok.slice(2, -2)}</strong>)
    } else {
      out.push(<span key={`${keyBase}-${i}`} className="mention">{tok}</span>)
    }
    last = m.index + tok.length
    i++
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = []
  const parts = text.split(/```/)
  parts.forEach((part, pi) => {
    if (pi % 2 === 1) {
      const nl = part.indexOf('\n')
      const code = nl >= 0 ? part.slice(nl + 1) : part
      blocks.push(
        <pre
          key={`code-${pi}`}
          className="mono hairline-b hairline-t my-3 overflow-x-auto py-3"
          style={{ fontSize: 12, lineHeight: 1.6, color: 'var(--text-1)', whiteSpace: 'pre' }}
        >
          {code.replace(/\n$/, '')}
        </pre>
      )
      return
    }
    const paragraphs = part.split(/\n{2,}/).filter((p) => p.trim())
    paragraphs.forEach((para, i) => {
      const lines = para.split('\n')
      if (lines.every((l) => /^\s*[-*]\s/.test(l) || !l.trim())) {
        blocks.push(
          <ul key={`ul-${pi}-${i}`} className="my-2 flex flex-col gap-1 pl-4">
            {lines.filter((l) => l.trim()).map((l, j) => (
              <li key={j} className="relative">
                <span className="absolute -left-3" style={{ color: 'var(--text-3)' }}>·</span>
                {inline(l.replace(/^\s*[-*]\s/, ''), `li-${pi}-${i}-${j}`)}
              </li>
            ))}
          </ul>
        )
      } else if (/^#{1,3}\s/.test(lines[0])) {
        blocks.push(
          <p key={`h-${pi}-${i}`} className="mb-1 mt-4 text-[14px]" style={{ fontWeight: 500 }}>
            {inline(lines[0].replace(/^#{1,3}\s/, ''), `h-${pi}-${i}`)}
          </p>
        )
      } else {
        blocks.push(
          <p key={`p-${pi}-${i}`} className="my-2" style={{ whiteSpace: 'pre-wrap' }}>
            {inline(para, `p-${pi}-${i}`)}
          </p>
        )
      }
    })
  })
  return <div>{blocks}</div>
}

function PlanTimeline({ steps }: { steps: PlanStep[] }) {
  return (
    <div className="mb-6">
      <div className="label mb-3">Plan</div>
      <div className="relative pl-4">
        <span className="absolute bottom-1 left-[3px] top-1 w-px" style={{ background: 'var(--hairline-2)' }} />
        {steps.map((step) => (
          <div key={step.id} className="relative flex items-baseline gap-3 py-1.5">
            <span
              className="absolute -left-4 top-[9px] h-[7px] w-[7px] rounded-full"
              style={{
                background: step.status === 'done' ? 'var(--success)'
                  : step.status === 'running' ? 'var(--accent)'
                  : step.status === 'failed' ? 'var(--danger)'
                  : 'var(--hairline-2)'
              }}
            />
            <span
              className="text-[12px]"
              style={{
                color: step.status === 'pending' ? 'var(--text-3)' : 'var(--text-1)',
                textDecoration: step.status === 'done' ? 'line-through' : undefined,
                textDecorationColor: 'var(--text-3)'
              }}
            >
              {step.text}
            </span>
            <span className="meta">{step.status}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function ToolRow({ item }: { item: ToolFeedItem }) {
  const argSummary = Object.entries(item.args)
    .filter(([k]) => k !== 'content' && k !== 'steps')
    .map(([k, v]) => `${k}=${String(v).slice(0, 40)}`)
    .join(' ')
  const running = item.state === 'call'
  return (
    <div className="py-1">
      <div className="meta flex flex-wrap items-baseline gap-x-2">
        <span style={{ color: running ? 'var(--accent)' : 'var(--text-2)' }}>{item.name}</span>
        <span className="truncate">{argSummary}</span>
        {item.ms !== undefined && (
          <span>{(item.ms / 1000).toFixed(1)}s · {(item.tokens ?? 0).toLocaleString()} tok</span>
        )}
        {item.state === 'result' && item.result?.startsWith('Error') && (
          <span style={{ color: 'var(--danger)' }}>failed</span>
        )}
      </div>
      {running && <div className="runline mt-1" />}
    </div>
  )
}

function MessageBlock({ message }: { message: ChatMessage }) {
  if (message.role === 'user') {
    return (
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={SPRING} className="mb-6">
        <div className="label mb-1.5">You</div>
        <div style={{ whiteSpace: 'pre-wrap' }}>{inline(message.content, message.id)}</div>
        {message.attachments && message.attachments.length > 0 && (
          <div className="meta mt-1.5 flex flex-wrap gap-x-3">
            {message.attachments.map((a) => <span key={a.path} className="mention">{a.name}</span>)}
          </div>
        )}
      </motion.div>
    )
  }
  if (message.role === 'tool') {
    return (
      <div className="meta mb-1 flex items-baseline gap-2">
        <span style={{ color: 'var(--text-2)' }}>{message.toolName}</span>
        <span className="truncate">{message.content.slice(0, 90).replace(/\n/g, ' ')}</span>
      </div>
    )
  }
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={SPRING} className="mb-6">
      <div className="mb-1.5 flex items-center gap-2">
        {message.model && <ModelLogo modelId={message.model} provider={message.provider} size={14} />}
        <span className="meta" style={{ color: 'var(--text-2)' }}>{message.model ? displayModelLabel(message.model) : 'Nexa'}</span>
      </div>
      <Markdown text={message.content} />
    </motion.div>
  )
}

export function Conversation() {
  const s = useNexa()
  const scrollRef = useRef<HTMLDivElement>(null)
  const stick = useRef(true)

  useEffect(() => {
    const el = scrollRef.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [s.messages, s.streaming, s.toolFeed, s.plan])

  const lastAssistant = [...s.messages].reverse().find((m) => m.role === 'assistant')

  return (
    <div
      ref={scrollRef}
      className="min-h-0 flex-1 overflow-y-auto"
      onScroll={(e) => {
        const el = e.currentTarget
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
      }}
    >
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={SPRING}
        className="mx-auto w-full max-w-[720px] px-6 py-8"
      >
        {s.plan.length > 0 && <PlanTimeline steps={s.plan} />}

        {s.messages.map((m) => <MessageBlock key={m.id} message={m} />)}

        {s.streaming && (
          <div className="mb-6">
            <div className="mb-1.5 flex items-center gap-2">
              <span className="meta" style={{ color: 'var(--accent)' }}>streaming</span>
            </div>
            <div style={{ whiteSpace: 'pre-wrap' }}>
              {s.streaming.pieces.map((piece, i) => (
                <motion.span
                  key={i}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.24 }}
                >
                  {piece}
                </motion.span>
              ))}
            </div>
          </div>
        )}

        {s.toolFeed.length > 0 && (
          <div className="hairline-t mt-2 pt-3">
            <div className="label mb-1.5">Tools</div>
            {s.toolFeed.slice(-12).map((t) => <ToolRow key={t.id} item={t} />)}
          </div>
        )}

        {s.agentStatus === 'running' && !s.streaming && <div className="runline mt-4" />}

        {s.checkpoints.length > 0 && (
          <div className="hairline-t mt-6 pt-3">
            <div className="label mb-2">Checkpoints</div>
            {s.checkpoints.slice(0, 5).map((cp) => (
              <div key={cp.id} className="flex items-baseline gap-3 py-1">
                <span className="meta min-w-0 flex-1 truncate">
                  {new Date(cp.ts).toLocaleTimeString()} · {cp.label}
                </span>
                <button className="btn-text flex items-center gap-1 text-[11px]" onClick={() => void s.restoreCheckpoint(cp.id)}>
                  <IconRestore size={10} /> Restore
                </button>
              </div>
            ))}
          </div>
        )}

        {lastAssistant?.usage && (
          <div className="meta mt-6">
            {(lastAssistant.usage.ms / 1000).toFixed(1)}s · {lastAssistant.usage.tokens.toLocaleString()} tok
          </div>
        )}
      </motion.div>
    </div>
  )
}