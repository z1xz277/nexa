import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { Mode } from '@shared/types'
import { useNexa } from '../store'
import { SPRING } from '../motion'
import { ModelLogo } from './Logo'
import { displayContextLabel, displayModelLabel } from '../lib/model-label'
import { useDialogFocus } from '../lib/use-dialog-focus'
import { IconAgent, IconAsk, IconCheck, IconChevron, IconRefresh, IconSearch, IconUnlocked } from './Icons'

const MODES: { id: Mode; name: string; summary: string; detail: string }[] = [
  { id: 'ask', name: 'Ask', summary: 'Read only', detail: 'Read, list, and search project files. No writes or commands.' },
  { id: 'agent', name: 'Agent', summary: 'Approve changes', detail: 'Edit project files and run commands after your approval.' },
  { id: 'full', name: 'Full Access', summary: 'Fewer prompts', detail: 'Approve project changes automatically for this run. Shell commands use your Windows account permissions.' }
]

function ModeIcon({ mode, size = 14 }: { mode: Mode; size?: number }) {
  return mode === 'ask' ? <IconAsk size={size} /> : mode === 'agent' ? <IconAgent size={size} /> : <IconUnlocked size={size} />
}

export function ModelPicker() {
  const s = useNexa()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [confirmFull, setConfirmFull] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const goBackRef = useRef<HTMLButtonElement>(null)
  const dialogId = useId()
  const [popoverAnchor, setPopoverAnchor] = useState<'above' | 'below'>('above')
  const [popoverMaxHeight, setPopoverMaxHeight] = useState(360)

  const setInputRef = useCallback((node: HTMLInputElement | null) => {
    inputRef.current = node
    if (node && open) node.focus({ preventScroll: true })
  }, [open])

  const setGoBackRef = useCallback((node: HTMLButtonElement | null) => {
    goBackRef.current = node
    node?.focus({ preventScroll: true })
  }, [])

  const close = useCallback(() => {
    setOpen(false)
    setConfirmFull(false)
    setQuery('')
  }, [])

  useLayoutEffect(() => {
    if (!open) return
    const updatePlacement = () => {
      const trigger = triggerRef.current?.getBoundingClientRect()
      if (!trigger) return
      const above = Math.max(0, trigger.top - 60)
      const below = Math.max(0, window.innerHeight - trigger.bottom - 20)
      const anchor = below > above ? 'below' : 'above'
      setPopoverAnchor(anchor)
      setPopoverMaxHeight(Math.floor(Math.min(460, anchor === 'below' ? below : above)))
    }
    updatePlacement()
    window.addEventListener('resize', updatePlacement)
    return () => window.removeEventListener('resize', updatePlacement)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) close()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open, close])

  const handleEscape = useCallback(() => {
    if (confirmFull) setConfirmFull(false)
    else close()
  }, [confirmFull, close])

  useDialogFocus(open, dialogRef, handleEscape, inputRef, triggerRef)

  const pickMode = (mode: Mode) => {
    if (mode === 'full' && s.mode !== 'full') {
      setConfirmFull(true)
      return
    }
    s.setMode(mode)
    setConfirmFull(false)
  }

  const models = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return s.models
      .filter((model) => model.capabilities.tools && (!normalized || model.id.toLowerCase().includes(normalized) || model.name.toLowerCase().includes(normalized)))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [s.models, query])

  const selected = s.model ? s.models.find((model) => model.id === s.model?.id && model.provider === s.model?.provider) : null
  const mode = MODES.find((item) => item.id === s.mode)!

  return (
    <div className="relative" ref={ref}>
      <button
        ref={triggerRef}
        type="button"
        className={`model-trigger ${open ? 'is-open' : ''} ${s.mode === 'full' ? 'is-full' : ''}`}
        onClick={() => open ? close() : setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={dialogId}
        aria-label={`Model: ${selected ? displayModelLabel(selected.name) : (s.modelsLoading ? 'Loading models' : 'Choose model')}. Access: ${mode.name}, ${mode.summary}`}
      >
        <span className="model-trigger-icon"><ModeIcon mode={s.mode} /></span>
        <span className="model-trigger-copy">
          <span className="model-trigger-mode">{mode.name}</span>
          <span className="model-trigger-model">{selected ? displayModelLabel(selected.name) : (s.modelsLoading ? 'Loading models' : 'Choose model')}</span>
        </span>
        <IconChevron size={12} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            ref={dialogRef}
            id={dialogId}
            role="dialog"
            aria-label={confirmFull ? 'Confirm full access' : 'Model and access'}
            aria-describedby={confirmFull ? 'full-access-description' : undefined}
            tabIndex={-1}
            initial={{ opacity: 0, y: -6, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.985 }}
            transition={{ duration: 0.16, ease: [0.32, 0.72, 0.28, 1] }}
            style={{ maxHeight: popoverMaxHeight }}
            className={`model-popover pop absolute left-0 z-50 flex w-[430px] max-w-[calc(100vw-32px)] flex-col overflow-y-auto ${popoverAnchor === 'above' ? 'bottom-full mb-2' : 'top-full mt-2'}`}
          >
            <AnimatePresence mode="wait" initial={false}>
              {confirmFull ? (
                <motion.div key="confirm" initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} transition={{ duration: 0.14 }} className="p-4">
                  <div className="mb-3 flex items-center gap-2">
                    <span className="access-symbol"><IconUnlocked size={16} /></span>
                    <h3 id="full-access-title" className="text-[14px] font-semibold">Enable Full Access?</h3>
                  </div>
                  <p id="full-access-description" className="text-[12px] leading-6" style={{ color: 'var(--text-2)' }}>
                    For the next run, Nexa can edit files inside this project and run commands without asking each time.
                  </p>
                  <div className="access-warning mt-3">
                    Shell commands are not sandboxed. They use your Windows account permissions and can reach the network or files outside the project.
                  </div>
                  <p className="mt-3 text-[12px] leading-6" style={{ color: 'var(--text-2)' }}>
                    Windows will ask you to confirm when this run starts. Every action is still recorded, and Stop ends active access.
                  </p>
                  <div className="mt-4 flex items-center justify-end gap-2">
                    <button ref={setGoBackRef} type="button" className="btn-outline text-[12px]" onClick={() => setConfirmFull(false)}>Go back</button>
                    <button type="button" className="btn-primary text-[12px]" onClick={() => { s.setMode('full'); setConfirmFull(false) }}>Enable for next run</button>
                  </div>
                </motion.div>
              ) : (
                <motion.div key="picker" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.14 }}>
                  <div className="access-section">
                    <div className="popover-heading">
                      <span>Access</span>
                      <span className="meta">Applies to next run</span>
                    </div>
                    <div className="space-y-1" role="radiogroup" aria-label="Access mode">
                      {MODES.map((item) => (
                        <button
                          key={item.id}
                          role="radio"
                          aria-checked={s.mode === item.id}
                          className={`access-option ${s.mode === item.id ? 'is-selected' : ''}`}
                          onClick={() => pickMode(item.id)}
                        >
                          <span className="access-option-icon"><ModeIcon mode={item.id} size={16} /></span>
                          <span className="min-w-0 flex-1">
                            <span className="access-option-title">{item.name}<span className="access-option-summary">{item.summary}</span></span>
                            <span className="access-option-detail">{item.detail}</span>
                          </span>
                          {s.mode === item.id && <IconCheck size={14} />}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="hairline-t p-3">
                    <div className="popover-heading mb-2">
                      <span>Model</span>
                      <button className="icon-button" title="Refresh models" aria-label="Refresh models" onClick={() => void s.refreshModels(true)}><IconRefresh size={13} /></button>
                    </div>
                    <label className="model-search">
                      <IconSearch size={13} />
                      <input ref={setInputRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search models" aria-label="Search models" />
                    </label>
                    <div className="model-results mt-2">
                      {models.length === 0 && (
                        <p className="px-2 py-5 text-center text-[12px]" style={{ color: 'var(--text-3)' }}>
                          {s.modelsLoading ? 'Loading models…' : 'No matching models.'}
                        </p>
                      )}
                      {models.map((model) => {
                        const isSelected = s.model?.id === model.id && s.model.provider === model.provider
                        return (
                          <button
                            key={model.provider + model.id}
                            className={`model-option ${isSelected ? 'is-selected' : ''}`}
                            aria-pressed={isSelected}
                            onClick={() => { s.setModel({ id: model.id, provider: model.provider }); close() }}
                          >
                            <ModelLogo modelId={model.id} provider={model.provider} size={16} />
                            <span className="min-w-0 flex-1">
                              <span className="model-option-name">{displayModelLabel(model.name)}</span>
                              <span className="model-option-meta">{displayContextLabel(model.context)}</span>
                            </span>
                            {isSelected && <IconCheck size={13} />}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                  <div className="popover-footer">
                    <span>{s.models.filter((model) => model.capabilities.tools).length} available models</span>
                    <span><kbd>esc</kbd> to close</span>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
