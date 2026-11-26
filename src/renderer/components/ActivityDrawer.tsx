import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useNexa } from '../store'
import { SPRING_SOFT } from '../motion'
import { IconSearch, IconX } from './Icons'

export function ActivityDrawer() {
  const s = useNexa()
  const [query, setQuery] = useState('')

  return (
    <AnimatePresence>
      {s.activityOpen && (
        <motion.aside
          initial={{ x: 400, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 400, opacity: 0 }}
          transition={SPRING_SOFT}
          className="absolute bottom-0 right-0 top-0 z-30 flex w-[380px] flex-col"
          style={{
            background: 'var(--elevated)',
            borderLeft: '1px solid var(--hairline-2)',
            borderRadius: 'var(--r-lg) 0 0 var(--r-lg)',
            boxShadow: 'var(--shadow-pop)'
          }}
        >
          <div className="hairline-b flex items-center gap-3 px-4 py-3">
            <span className="label flex-1">Activity</span>
            <button className="btn-text text-[11px]" onClick={() => void s.exportActivity()}>Export JSON</button>
            <button className="btn-text" onClick={() => s.setActivity(false)} title="Close">
              <IconX size={11} />
            </button>
          </div>
          <div className="hairline-b flex items-center gap-2 px-4 py-2">
            <IconSearch size={12} />
            <input
              className="min-w-0 flex-1 bg-transparent text-[12px] outline-none"
              style={{ color: 'var(--text-1)' }}
              placeholder="Search log (secrets redacted)"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                void s.loadActivity(e.target.value)
              }}
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-2">
            {s.activity.length === 0 && (
              <p className="py-6 text-[12px]" style={{ color: 'var(--text-3)' }}>No activity recorded yet.</p>
            )}
            {s.activity.map((entry) => (
              <div key={entry.id} className="hairline-b py-2">
                <div className="meta flex items-baseline gap-2">
                  <span>{new Date(entry.ts).toLocaleTimeString()}</span>
                  <span className="label" style={{ fontSize: 10, color: 'var(--text-2)' }}>{entry.kind}</span>
                </div>
                <p className="mt-0.5 text-[12px]" style={{ color: 'var(--text-2)', wordBreak: 'break-word' }}>
                  {entry.summary}
                </p>
              </div>
            ))}
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  )
}