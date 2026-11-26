import { useEffect, useId, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { Effort } from '@shared/types'
import { EFFORT_META, EFFORT_ORDER } from '@core/effort'
import { useNexa } from '../store'
import { SPRING } from '../motion'
import { IconChevron } from './Icons'

export function EffortMeter({ level, size = 10 }: { level: number; size?: number }) {
  return (
    <span className="inline-flex items-end gap-[2px]" style={{ height: size }}>
      {[0, 1, 2, 3].map((i) => (
        <span
          key={i}
          style={{
            width: 2,
            height: size * (0.4 + 0.2 * i),
            background: i < level ? 'currentColor' : 'var(--hairline-2)',
            transition: 'background 150ms'
          }}
        />
      ))}
    </span>
  )
}

const ROW_H = 52

export function EffortDropdown() {
  const effort = useNexa((s) => s.effort)
  const setEffort = useNexa((s) => s.setEffort)
  const [open, setOpen] = useState(false)
  const [index, setIndex] = useState(() => Math.max(0, EFFORT_ORDER.indexOf(effort)))
  const ref = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([])
  const listboxId = useId()

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  useEffect(() => {
    if (open) optionRefs.current[index]?.focus({ preventScroll: true })
  }, [open, index])

  const close = (restoreFocus = false) => {
    setOpen(false)
    if (restoreFocus) triggerRef.current?.focus({ preventScroll: true })
  }

  const choose = (value: Effort) => {
    setEffort(value)
    close(true)
  }

  return (
    <div className="relative" ref={ref}>
      <button
        ref={triggerRef}
        type="button"
        className="chip"
        onClick={() => {
          if (open) close()
          else {
            setIndex(Math.max(0, EFFORT_ORDER.indexOf(effort)))
            setOpen(true)
          }
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            if (!open) {
              setIndex(Math.max(0, EFFORT_ORDER.indexOf(effort)))
              setOpen(true)
            }
          } else if (event.key === 'Escape' && open) {
            event.preventDefault()
            close(true)
          }
        }}
        title="Reasoning effort"
        aria-label={`Reasoning effort: ${EFFORT_META[effort].label}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
      >
        <span style={{ color: 'var(--text-3)' }}>Effort</span>
        <span style={{ color: 'var(--text-1)' }}>{EFFORT_META[effort].label}</span>
        <EffortMeter level={EFFORT_META[effort].bars} />
        <IconChevron size={10} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            id={listboxId}
            role="listbox"
            aria-label="Reasoning effort"
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={SPRING}
            className="pop absolute bottom-full left-0 z-40 mb-2 w-[300px] p-1.5"
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setIndex((current) => Math.min(EFFORT_ORDER.length - 1, current + 1))
              } else if (event.key === 'ArrowUp') {
                event.preventDefault()
                setIndex((current) => Math.max(0, current - 1))
              } else if (event.key === 'Home') {
                event.preventDefault()
                setIndex(0)
              } else if (event.key === 'End') {
                event.preventDefault()
                setIndex(EFFORT_ORDER.length - 1)
              } else if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                choose(EFFORT_ORDER[index])
              } else if (event.key === 'Escape') {
                event.preventDefault()
                close(true)
              } else if (event.key === 'Tab') {
                event.preventDefault()
                close(true)
              }
            }}
            tabIndex={-1}
          >
            <div className="relative">
              <motion.div
                className="absolute left-1 right-1"
                style={{ top: 4, height: ROW_H - 8, background: 'var(--hover)', borderRadius: 'var(--r-md)', boxShadow: 'inset 0 0 0 1px var(--hairline)' }}
                animate={{ y: index * ROW_H }}
                transition={SPRING}
              />
              {EFFORT_ORDER.map((value, optionIndex) => (
                <button
                  key={value}
                  ref={(node) => { optionRefs.current[optionIndex] = node }}
                  type="button"
                  role="option"
                  aria-selected={value === effort}
                  tabIndex={optionIndex === index ? 0 : -1}
                  className="relative flex w-full items-center gap-3 px-3 text-left"
                  style={{ height: ROW_H, color: optionIndex === index ? 'var(--text-1)' : 'var(--text-2)' }}
                  onMouseEnter={() => setIndex(optionIndex)}
                  onClick={() => choose(value)}
                >
                  <span className="w-[52px] shrink-0 text-[13px]">{EFFORT_META[value].label}</span>
                  <span className="min-w-0 flex-1 text-[11px] leading-tight" style={{ color: 'var(--text-3)' }}>
                    {EFFORT_META[value].description}
                  </span>
                  <span style={{ color: value === effort ? 'var(--accent)' : 'var(--text-2)' }}>
                    <EffortMeter level={EFFORT_META[value].bars} />
                  </span>
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
