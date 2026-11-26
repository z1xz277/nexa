import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import type { FileNode } from '@shared/types'
import { useNexa } from '../store'
import { bridge } from '../bridge'
import { monaco, languageFor } from '../lib/monaco'
import { SPRING, SPRING_SOFT } from '../motion'
import { IconChevron, IconFile, IconRefresh, IconTerminal, IconX } from './Icons'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'

function FileTree() {
  const s = useNexa()
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['src']))

  const toggle = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      next.has(path) ? next.delete(path) : next.add(path)
      return next
    })
  }

  const renderNode = (node: FileNode, depth: number): React.ReactNode => {
    const git = s.gitStatus[node.path]
    const isOpen = s.editor?.path === node.path
    return (
      <div key={node.path}>
        <button
          className={`row flex w-full items-center gap-1.5 py-[3px] pr-2 text-left ${isOpen ? 'row-active' : ''}`}
          style={{ paddingLeft: 8 + depth * 14 }}
          onClick={() => (node.kind === 'dir' ? toggle(node.path) : void s.openFile(node.path))}
        >
          {node.kind === 'dir' ? (
            <span
              className="inline-flex transition-transform duration-150"
              style={{ transform: expanded.has(node.path) ? 'rotate(0deg)' : 'rotate(-90deg)', color: 'var(--text-3)' }}
            >
              <IconChevron size={9} />
            </span>
          ) : (
            <span style={{ color: 'var(--text-3)' }}><IconFile size={10} /></span>
          )}
          <span
            className="min-w-0 flex-1 truncate text-[12px]"
            style={{ color: isOpen ? 'var(--text-1)' : 'var(--text-2)' }}
          >
            {node.name}
          </span>
          {git && (
            <span
              className="meta shrink-0"
              style={{ color: git === 'D' ? 'var(--danger)' : git === 'A' ? 'var(--success)' : 'var(--text-3)' }}
            >
              {git}
            </span>
          )}
        </button>
        {node.kind === 'dir' && expanded.has(node.path) && node.children?.map((c) => renderNode(c, depth + 1))}
      </div>
    )
  }

  return (
    <div className="flex min-h-[120px] flex-col" style={{ height: '38%' }}>
      <div className="flex items-center justify-between px-3 py-2">
        <span className="label">Files</span>
        <button className="btn-text" onClick={() => void s.loadTree()} title="Refresh tree">
          <IconRefresh size={11} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pb-2">
        {s.tree.length === 0 ? (
          <p className="px-3 text-[11px]" style={{ color: 'var(--text-3)' }}>
            {s.activeProjectId ? 'No folder attached to this project.' : 'Open a project to browse files.'}
          </p>
        ) : (
          s.tree.map((n) => renderNode(n, 0))
        )}
      </div>
    </div>
  )
}

function EditorPane() {
  const s = useNexa()
  const holder = useRef<HTMLDivElement>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const applying = useRef(false)
  const pathRef = useRef<string | null>(null)

  useEffect(() => {
    if (!holder.current) return
    const editor = monaco.editor.create(holder.current, {
      value: '',
      language: 'plaintext',
      theme: useNexa.getState().settings.theme === 'dark' ? 'nexa-dark' : 'nexa-light',
      automaticLayout: true,
      minimap: { enabled: false },
      fontSize: 12,
      fontFamily: 'Geist Mono, JetBrains Mono, monospace',
      lineHeight: 20,
      scrollBeyondLastLine: false,
      renderLineHighlight: 'line',
      bracketPairColorization: { enabled: false },
      padding: { top: 10 },
      smoothScrolling: true,
      cursorBlinking: 'smooth',
      fixedOverflowWidgets: true
    })
    editorRef.current = editor
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      void useNexa.getState().saveFile()
    })
    const sub = editor.onDidChangeModelContent(() => {
      if (!applying.current) useNexa.getState().setEditorContent(editor.getValue())
    })
    return () => {
      sub.dispose()
      editor.dispose()
      editorRef.current = null
    }
  }, [])

  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    monaco.editor.setTheme(s.settings.theme === 'dark' ? 'nexa-dark' : 'nexa-light')
  }, [s.settings.theme])

  useEffect(() => {
    const editor = editorRef.current
    if (!editor || !s.editor) return
    if (pathRef.current !== s.editor.path) {
      pathRef.current = s.editor.path
      applying.current = true
      editor.setValue(s.editor.content)
      monaco.editor.setModelLanguage(editor.getModel()!, languageFor(s.editor.path))
      applying.current = false
    }
  }, [s.editor?.path])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {s.editor && (
        <div className="hairline-b flex items-center gap-3 px-3 py-1.5">
          <span className="meta min-w-0 flex-1 truncate" style={{ color: 'var(--text-1)' }}>
            {s.editor.path}{s.editor.dirty ? ' · modified' : ''}
          </span>
          <button className="btn-text text-[11px]" disabled={!s.editor.dirty} onClick={() => void s.saveFile()}>
            Save
          </button>
        </div>
      )}
      <div className="relative min-h-0 flex-1">
        <div ref={holder} className="absolute inset-0" />
        {!s.editor && (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="text-[12px]" style={{ color: 'var(--text-3)' }}>Open a file from the tree.</p>
          </div>
        )}
      </div>
    </div>
  )
}

interface Hunk {
  index: number
  oStart: number
  oEnd: number
  mStart: number
  mEnd: number
}

function buildResult(before: string, after: string, hunks: Hunk[], accepted: Set<number>): string {
  const a = before.split('\n')
  const b = after.split('\n')
  const out: string[] = []
  let cursor = 0
  for (const h of hunks) {
    const oStart = h.oStart - 1
    const oEnd = Math.max(oStart, h.oEnd)
    while (cursor < Math.min(oStart, a.length)) out.push(a[cursor++])
    if (accepted.has(h.index)) {
      const mStart = h.mStart - 1
      const mEnd = Math.max(mStart, h.mEnd)
      for (let i = mStart; i < mEnd && i < b.length; i++) out.push(b[i])
    } else {
      for (let i = oStart; i < oEnd && i < a.length; i++) out.push(a[i])
    }
    cursor = Math.max(cursor, Math.min(oEnd, a.length))
  }
  while (cursor < a.length) out.push(a[cursor++])
  return out.join('\n')
}

function DiffView() {
  const s = useNexa()
  const diff = s.diff!
  const holder = useRef<HTMLDivElement>(null)
  const editorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null)
  const [hunks, setHunks] = useState<Hunk[]>([])
  const [accepted, setAccepted] = useState<Set<number>>(new Set())
  const [rejected, setRejected] = useState<Set<number>>(new Set())
  const [sideBySide, setSideBySide] = useState(true)

  useEffect(() => {
    if (!holder.current) return
    const editor = monaco.editor.createDiffEditor(holder.current, {
      theme: useNexa.getState().settings.theme === 'dark' ? 'nexa-dark' : 'nexa-light',
      automaticLayout: true,
      minimap: { enabled: false },
      fontSize: 12,
      fontFamily: 'Geist Mono, JetBrains Mono, monospace',
      lineHeight: 20,
      renderSideBySide: true,
      scrollBeyondLastLine: false,
      padding: { top: 10 }
    })
    editorRef.current = editor
    const original = monaco.editor.createModel(diff.before, languageFor(diff.path))
    const modified = monaco.editor.createModel(diff.after, languageFor(diff.path))
    editor.setModel({ original, modified })
    const sub = editor.onDidUpdateDiff(() => {
      const changes = editor.getLineChanges() ?? []
      setHunks(changes.map((c, index) => ({
        index,
        oStart: c.originalStartLineNumber,
        oEnd: c.originalEndLineNumber,
        mStart: c.modifiedStartLineNumber,
        mEnd: c.modifiedEndLineNumber
      })))
    })
    return () => {
      sub.dispose()
      original.dispose()
      modified.dispose()
      editor.dispose()
      editorRef.current = null
    }
  }, [diff.path, diff.before, diff.after])

  useEffect(() => {
    editorRef.current?.updateOptions({ renderSideBySide: sideBySide })
  }, [sideBySide])

  useEffect(() => {
    monaco.editor.setTheme(s.settings.theme === 'dark' ? 'nexa-dark' : 'nexa-light')
  }, [s.settings.theme])

  const decide = (index: number, accept: boolean) => {
    setAccepted((prev) => {
      const next = new Set(prev)
      accept ? next.add(index) : next.delete(index)
      return next
    })
    setRejected((prev) => {
      const next = new Set(prev)
      accept ? next.delete(index) : next.add(index)
      return next
    })
  }

  const apply = async () => {
    const result = buildResult(diff.before, diff.after, hunks, accepted)
    await s.applyDiffHunk(diff.path, result)
  }

  const edit = () => {
    useNexa.setState({ editor: { path: diff.path, content: diff.after, dirty: true }, diff: null })
  }

  const decided = accepted.size + rejected.size

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="hairline-b flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-1.5">
        <span className="meta min-w-0 flex-1 truncate" style={{ color: 'var(--text-1)' }}>Diff · {diff.path}</span>
        <button className="btn-text text-[11px]" onClick={() => setSideBySide(!sideBySide)}>
          {sideBySide ? 'Inline' : 'Side by side'}
        </button>
        <button className="btn-text text-[11px]" onClick={edit}>Edit</button>
        <button className="btn-text text-[11px]" onClick={() => s.closeDiff()}>Discard</button>
        <button className="btn-primary text-[11px]" onClick={() => void apply()}>
          Apply accepted ({accepted.size})
        </button>
      </div>
      {hunks.length > 0 && (
        <div className="hairline-b max-h-[96px] overflow-y-auto px-3 py-1">
          {hunks.map((h) => {
            const state = accepted.has(h.index) ? 'accepted' : rejected.has(h.index) ? 'rejected' : 'pending'
            return (
              <div key={h.index} className="flex items-center gap-3 py-0.5">
                <span className="meta w-[110px] shrink-0">
                  hunk {h.index + 1} · {h.oStart}-{Math.max(h.oStart, h.oEnd)}
                </span>
                <span className="meta w-[64px] shrink-0" style={{
                  color: state === 'accepted' ? 'var(--success)' : state === 'rejected' ? 'var(--danger)' : 'var(--text-3)'
                }}>
                  {state}
                </span>
                <button className="btn-text text-[11px]" onClick={() => decide(h.index, true)}>Accept</button>
                <button className="btn-text text-[11px]" style={{ color: 'var(--danger)' }} onClick={() => decide(h.index, false)}>Reject</button>
              </div>
            )
          })}
        </div>
      )}
      <div ref={holder} className="min-h-0 flex-1" />
      {hunks.length === 0 && (
        <div className="hairline-t px-3 py-1.5">
          <span className="meta">No differences. {decided > 0 ? '' : 'Files are identical.'}</span>
        </div>
      )}
    </div>
  )
}

function TerminalPane() {
  const holder = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const theme = useNexa((st) => st.settings.theme)

  useEffect(() => {
    const holderEl = holder.current
    if (!holderEl) return
    void useNexa.getState().ensureTerminal()
    let term: Terminal | null = null
    let ro: ResizeObserver | null = null
    let offData: (() => void) | null = null
    let offInput: { dispose(): void } | null = null
    let raf = 0
    // The panel animates its width from 0. Opening xterm before the holder has
    // real size makes its render service read undefined dimensions and throw
    // asynchronously, so wait for layout before mounting the terminal.
    const start = () => {
      if (holderEl.clientWidth === 0 || holderEl.clientHeight === 0) { raf = requestAnimationFrame(start); return }
      const dark = useNexa.getState().settings.theme === 'dark'
      term = new Terminal({
        fontFamily: 'Geist Mono, JetBrains Mono, monospace',
        fontSize: 12,
        lineHeight: 1.5,
        cursorBlink: true,
        cursorStyle: 'bar',
        convertEol: true,
        theme: dark
          ? { background: '#000000', foreground: '#F5F5F5', cursor: '#FFFFFF', selectionBackground: '#505050' }
          : { background: '#FFFFFF', foreground: '#000000', cursor: '#000000', selectionBackground: '#D4D4D4' }
      })
      const fit = new FitAddon()
      term.loadAddon(fit)
      term.open(holderEl)
      const safeFit = () => {
        try {
          if (holderEl.clientHeight > 0 && holderEl.clientWidth > 0) fit.fit()
        } catch { /* not laid out yet */ }
      }
      safeFit()
      term.writeln('Nexa terminal. Agent commands appear here according to the selected access mode.')
      term.write('$ ')
      termRef.current = term
      fitRef.current = fit
      offData = bridge.onTerminalData((_id, data) => term?.write(data))
      offInput = term.onData((data) => {
        const id = useNexa.getState().terminalId
        if (id) void bridge.terminal.input(id, data)
      })
      ro = new ResizeObserver(safeFit)
      ro.observe(holderEl)
    }
    raf = requestAnimationFrame(start)
    return () => {
      cancelAnimationFrame(raf)
      offData?.()
      offInput?.dispose()
      ro?.disconnect()
      term?.dispose()
      termRef.current = null
    }
  }, [])

  useEffect(() => {
    const term = termRef.current
    if (!term) return
    const dark = theme === 'dark'
    term.options.theme = dark
      ? { background: '#000000', foreground: '#F5F5F5', cursor: '#FFFFFF', selectionBackground: '#505050' }
      : { background: '#FFFFFF', foreground: '#000000', cursor: '#000000', selectionBackground: '#D4D4D4' }
  }, [theme])

  return <div ref={holder} className="min-h-0 flex-1 px-2 py-2" />
}

export function CodeWorkspace() {
  const s = useNexa()
  const [width, setWidth] = useState(s.settings.rightPanelWidth)
  const drag = useRef<{ x: number; w: number } | null>(null)

  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (!drag.current) return
      const next = Math.min(760, Math.max(320, drag.current.w + (drag.current.x - e.clientX)))
      setWidth(next)
    }
    const up = () => {
      if (drag.current) {
        drag.current = null
        document.body.style.cursor = ''
        void useNexa.getState().patchSettings({ rightPanelWidth: width })
      }
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
  }, [width])

  return (
    <motion.div
      initial={{ width: 0, opacity: 0 }}
      animate={{ width, opacity: 1 }}
      exit={{ width: 0, opacity: 0 }}
      transition={SPRING_SOFT}
      className="relative flex shrink-0 overflow-hidden"
      style={{ minWidth: 0 }}
    >
      <div
        className="absolute bottom-0 left-0 top-0 z-10 w-[5px] cursor-col-resize"
        onMouseDown={(e) => {
          drag.current = { x: e.clientX, w: width }
          document.body.style.cursor = 'col-resize'
        }}
      >
        <div className="h-full w-px" style={{ background: 'var(--hairline-2)' }} />
      </div>
      <div className="flex h-full flex-col pl-[5px]" style={{ width: width - 5, minWidth: 0 }}>
        <div className="hairline-b flex items-center gap-4 px-3 py-2">
          <div className="seg">
            {(['code', 'terminal'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => s.setRight(true, tab)}
                style={{ color: s.rightTab === tab ? 'var(--accent)' : 'var(--text-3)' }}
              >
                {s.rightTab === tab && (
                  <motion.span
                    layoutId="workspace-tab"
                    className="absolute inset-0"
                    style={{ background: 'var(--selected)', borderRadius: 'var(--r-full)' }}
                    transition={SPRING}
                  />
                )}
                <span className="relative z-10 inline-flex items-center gap-1.5">
                  {tab === 'terminal' && <IconTerminal size={11} />}
                  {tab === 'code' ? 'Code' : 'Terminal'}
                </span>
              </button>
            ))}
          </div>
          <button className="btn-text ml-auto" onClick={() => s.setRight(false)} title="Close panel">
            <IconX size={11} />
          </button>
        </div>
        {s.rightTab === 'code' ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <FileTree />
            <div className="hairline-t flex min-h-0 flex-1 flex-col">
              {s.diff ? <DiffView /> : <EditorPane />}
            </div>
          </div>
        ) : (
          <TerminalPane />
        )}
      </div>
    </motion.div>
  )
}