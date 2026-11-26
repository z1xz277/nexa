import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { Attachment, FileNode } from '@shared/types'
import { useNexa } from '../store'
import { bridge } from '../bridge'
import { SPRING } from '../motion'
import { EffortDropdown } from './EffortDropdown'
import { ModelPicker } from './ModelPicker'
import { IconArrowUp, IconClip, IconFolder, IconX } from './Icons'

interface MentionItem {
  kind: 'file' | 'folder' | 'symbol'
  label: string
  path: string
  symbol?: string
}

function flattenTree(nodes: FileNode[], out: MentionItem[] = []): MentionItem[] {
  for (const n of nodes) {
    out.push({ kind: n.kind === 'dir' ? 'folder' : 'file', label: n.path, path: n.path })
    if (n.children) flattenTree(n.children, out)
  }
  return out
}

export function Composer({ variant }: { variant: 'hero' | 'chat' }) {
  const s = useNexa()
  const editRef = useRef<HTMLDivElement>(null)
  const [hasText, setHasText] = useState(false)
  const [mention, setMention] = useState<{ query: string; items: MentionItem[]; index: number } | null>(null)
  const symbolsRef = useRef<MentionItem[] | null>(null)
  const treeItems = useMemo(() => flattenTree(s.tree), [s.tree])

  const running = s.agentStatus === 'running' || s.agentStatus === 'paused'

  const buildSymbols = async () => {
    if (symbolsRef.current) return symbolsRef.current
    const files = treeItems.filter((i) => i.kind === 'file' && /\.(ts|tsx|js|jsx|py|rs|go)$/.test(i.path)).slice(0, 30)
    const out: MentionItem[] = []
    for (const f of files) {
      try {
        const text = await bridge.fs.read(s.activeProjectId!, f.path)
        const re = /(?:function|class|const|def|fn)\s+([A-Za-z_$][\w$]*)/g
        let m: RegExpExecArray | null
        while ((m = re.exec(text)) && out.length < 300) {
          out.push({ kind: 'symbol', label: m[1], path: f.path, symbol: m[1] })
        }
      } catch { /* unreadable */ }
    }
    symbolsRef.current = out
    return out
  }

  const refreshMention = async () => {
    const el = editRef.current
    if (!el) return
    const text = el.textContent ?? ''
    const match = /@([\w./#-]*)$/.exec(text)
    if (!match) { setMention(null); return }
    const query = match[1].toLowerCase()
    const symbols = s.activeProjectId ? await buildSymbols() : []
    const pool = [...treeItems, ...symbols]
    const items = pool
      .filter((i) => !query || i.label.toLowerCase().includes(query) || i.path.toLowerCase().includes(query))
      .slice(0, 8)
    setMention((prev) => ({ query: match[1], items, index: prev?.items.length ? Math.min(prev.index, items.length - 1) : 0 }))
  }

  const insertMention = (item: MentionItem) => {
    const el = editRef.current
    if (!el) return
    el.focus()
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0) return
    const range = sel.getRangeAt(0)
    const node = range.startContainer
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? ''
      const at = text.lastIndexOf('@', range.startOffset - 1)
      if (at >= 0) {
        range.setStart(node, at)
        range.deleteContents()
      }
    }
    const span = document.createElement('span')
    span.className = 'mention'
    span.dataset.path = item.path
    if (item.symbol) span.dataset.symbol = item.symbol
    span.textContent = item.kind === 'symbol' ? `@${item.symbol}` : `@${item.path}`
    range.insertNode(span)
    const space = document.createTextNode('\u00A0')
    span.after(space)
    range.setStartAfter(space)
    range.collapse(true)
    sel.removeAllRanges()
    sel.addRange(range)
    setMention(null)
    setHasText(true)
  }

  const extractContent = (): { text: string; mentions: MentionItem[] } => {
    const el = editRef.current
    if (!el) return { text: '', mentions: [] }
    let text = ''
    const mentions: MentionItem[] = []
    el.childNodes.forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        text += node.textContent
      } else if (node instanceof HTMLElement) {
        if (node.dataset.path) {
          const sym = node.dataset.symbol
          text += sym ? `@${node.dataset.path}#${sym}` : `@${node.dataset.path}`
          mentions.push({ kind: sym ? 'symbol' : 'file', label: node.textContent ?? '', path: node.dataset.path, symbol: sym })
        } else {
          text += node.textContent
        }
      }
    })
    return { text: text.replace(/\u00A0/g, ' ').trim(), mentions }
  }

  const doSend = async () => {
    if (running) return
    const { text, mentions } = extractContent()
    if (!text) return
    const extra: Attachment[] = []
    if (s.activeProjectId) {
      const seen = new Set<string>()
      for (const m of mentions) {
        if (seen.has(m.path)) continue
        seen.add(m.path)
        try {
          const content = await bridge.fs.read(s.activeProjectId, m.path)
          extra.push({ name: m.path, path: m.path, content: content.slice(0, 20000) })
        } catch { /* folder or missing */ }
      }
    }
    try {
      if (extra.length) {
        const existing = useNexa.getState().attachments
        useNexa.setState({ attachments: [...existing, ...extra].slice(0, 5) })
      }
      await useNexa.getState().send(text)
      if (editRef.current) editRef.current.textContent = ''
      setHasText(false)
      setMention(null)
    } catch (error) {
      useNexa.getState().showToast(error instanceof Error ? error.message : 'Could not start the run.', 'error')
      setHasText(true)
    }
  }

  useEffect(() => {
    if (variant === 'hero') editRef.current?.focus()
  }, [variant])

  const project = s.projects.find((p) => p.id === s.activeProjectId)

  return (
    <div className={variant === 'hero' ? 'w-full' : 'px-6 pb-4 pt-3'} style={{ background: 'var(--bg)' }}>
      <div className={variant === 'hero' ? '' : 'mx-auto w-full max-w-[720px]'}>
        <div className={`askbar relative ${variant === 'hero' ? 'askbar-hero' : ''}`}>
          <AnimatePresence>
            {mention && mention.items.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 6, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 4, scale: 0.98 }}
                transition={SPRING}
                className="pop absolute bottom-full left-0 z-40 mb-2 w-[360px] p-1.5"
              >
                <div className="label px-2.5 pb-1 pt-1.5">Mention</div>
                {mention.items.map((item, i) => (
                  <button
                    key={item.kind + item.path + (item.symbol ?? '')}
                    className={`row flex w-full items-center gap-2 px-2.5 py-1.5 text-left ${i === mention.index ? 'row-active' : ''}`}
                    onMouseEnter={() => setMention({ ...mention, index: i })}
                    onClick={() => insertMention(item)}
                  >
                    <span className="meta w-[44px] shrink-0">{item.kind}</span>
                    <span className="min-w-0 flex-1 truncate text-[12px]" style={{ color: 'var(--text-1)' }}>
                      {item.kind === 'symbol' ? `${item.symbol} · ${item.path}` : item.label}
                    </span>
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>

          {s.attachments.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 px-3 pt-3">
              {s.attachments.map((a) => (
                <span key={a.path} className="chip" style={{ padding: '3px 9px', fontSize: 11 }}>
                  <span className="max-w-[180px] truncate" style={{ color: 'var(--text-1)' }}>{a.name}</span>
                  <button className="inline-flex hover:text-[var(--text-1)]" onClick={() => s.removeAttachment(a.path)} title="Remove">
                    <IconX size={9} />
                  </button>
                </span>
              ))}
            </div>
          )}

          <div
            ref={editRef}
            role="textbox"
            aria-multiline="true"
            aria-label={variant === 'hero' ? 'Describe what to build' : 'Message Nexa'}
            aria-disabled={running || undefined}
            contentEditable={!running}
            suppressContentEditableWarning
            data-placeholder={variant === 'hero' ? 'Describe what to build, ask anything, or @mention a file…' : 'Message Nexa… (@ to mention)'}
            className="max-h-[180px] overflow-y-auto px-4 pt-3 outline-none"
            style={{
              fontSize: variant === 'hero' ? 15 : 13,
              lineHeight: 1.6,
              color: 'var(--text-1)',
              minHeight: variant === 'hero' ? 52 : 30
            }}
            onInput={() => {
              setHasText(!!editRef.current?.textContent?.trim())
              void refreshMention()
            }}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return
              if (mention && mention.items.length > 0) {
                if (e.key === 'ArrowDown') { e.preventDefault(); setMention({ ...mention, index: Math.min(mention.items.length - 1, mention.index + 1) }); return }
                if (e.key === 'ArrowUp') { e.preventDefault(); setMention({ ...mention, index: Math.max(0, mention.index - 1) }); return }
                if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); insertMention(mention.items[mention.index]); return }
                if (e.key === 'Escape') { e.preventDefault(); setMention(null); return }
              }
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void doSend()
              }
            }}
            onPaste={(e) => {
              e.preventDefault()
              document.execCommand('insertText', false, e.clipboardData.getData('text/plain'))
            }}
          />

          <div className="flex flex-wrap items-center gap-2 px-3 pb-3 pt-2">
            <button className="chip" onClick={() => s.setQuick(true)} title="Switch project">
              <IconFolder size={12} />
              <span style={{ color: 'var(--text-3)' }}>Project</span>
              <span className="max-w-[110px] truncate" style={{ color: 'var(--text-1)' }}>{project?.name ?? 'None'}</span>
            </button>
            <ModelPicker />
            <EffortDropdown />
            <button className="chip" onClick={() => void s.addAttachments()} title="Attach files">
              <IconClip size={12} />
              <span>Attach{s.attachments.length ? ` (${s.attachments.length})` : ''}</span>
            </button>

            <div className="ml-auto flex items-center gap-2">
              <button
                className="send-button"
                aria-label="Send message"
                disabled={!hasText || running}
                onClick={() => void doSend()}
              >
                <IconArrowUp size={13} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}