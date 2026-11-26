import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useNexa } from '../store'
import { SPRING } from '../motion'
import { IconSearch } from './Icons'

interface Item {
  group: string
  label: string
  hint: string
  run: () => void
}

function fuzzyScore(query: string, target: string): number {
  const q = query.toLowerCase()
  const t = target.toLowerCase()
  if (!q) return 1
  if (t.includes(q)) return 100 - t.indexOf(q)
  let qi = 0
  let score = 0
  let streak = 0
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      qi++
      streak++
      score += 2 + streak
    } else {
      streak = 0
    }
  }
  return qi === q.length ? score : -1
}

export function QuickSwitcher() {
  const s = useNexa()
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (s.quickOpen) {
      setQuery('')
      setIndex(0)
      setTimeout(() => inputRef.current?.focus(), 30)
    }
  }, [s.quickOpen])

  const items = useMemo<Item[]>(() => {
    const all: Item[] = [
      { group: 'Commands', label: 'New chat', hint: 'start a session', run: () => void s.newSession() },
      { group: 'Commands', label: 'Toggle theme', hint: 'dark / light', run: () => void s.patchSettings({ theme: s.settings.theme === 'dark' ? 'light' : 'dark' }) },
      { group: 'Commands', label: 'Toggle code panel', hint: 'editor and terminal', run: () => s.setRight(!s.rightOpen) },
      { group: 'Commands', label: 'Open activity log', hint: 'searchable, exportable', run: () => s.setActivity(true) },
      { group: 'Commands', label: 'Open settings', hint: 'keys, theme, motion', run: () => s.setSettings(true) },
      { group: 'Commands', label: 'Refresh models', hint: 'bypass cache', run: () => void s.refreshModels(true) },
      ...s.projects.map((p) => ({
        group: 'Projects',
        label: p.name,
        hint: p.path ?? 'scratch project',
        run: () => void s.openProject(p.id)
      })),
      ...s.sessions.map((session) => ({
        group: 'Sessions',
        label: session.title,
        hint: new Date(session.updatedAt).toLocaleString(),
        run: () => void s.openSession(session.id)
      }))
    ]
    if (!query.trim()) return all.slice(0, 12)
    return all
      .map((item) => ({ item, score: fuzzyScore(query, item.label) + fuzzyScore(query, item.hint) * 0.3 }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 12)
      .map((x) => x.item)
  }, [query, s.projects, s.sessions, s.settings.theme, s.rightOpen])

  const pick = (item: Item) => {
    s.setQuick(false)
    item.run()
  }

  let lastGroup = ''

  return (
    <AnimatePresence>
      {s.quickOpen && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={SPRING}
          className="hairline-b relative z-40 shrink-0 overflow-hidden"
          style={{ background: 'var(--bg)' }}
        >
          <div className="flex items-center gap-3 px-4 py-2.5">
            <IconSearch size={13} />
            <input
              ref={inputRef}
              className="min-w-0 flex-1 bg-transparent text-[14px] outline-none"
              style={{ color: 'var(--text-1)' }}
              placeholder="Jump to a project, session, or command…"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setIndex(0) }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') { e.preventDefault(); setIndex((i) => Math.min(items.length - 1, i + 1)) }
                if (e.key === 'ArrowUp') { e.preventDefault(); setIndex((i) => Math.max(0, i - 1)) }
                if (e.key === 'Enter' && items[index]) pick(items[index])
                if (e.key === 'Escape') s.setQuick(false)
              }}
            />
            <span className="meta shrink-0">esc to close</span>
          </div>
          {items.length > 0 && (
            <div className="hairline-t max-h-[280px] overflow-y-auto py-1">
              {items.map((item, i) => {
                const showGroup = item.group !== lastGroup
                lastGroup = item.group
                return (
                  <div key={item.group + item.label + i}>
                    {showGroup && <div className="label px-4 pb-0.5 pt-2">{item.group}</div>}
                    <button
                      className={`row flex w-full items-baseline gap-3 px-4 py-1.5 text-left ${i === index ? 'row-active' : ''}`}
                      onMouseEnter={() => setIndex(i)}
                      onClick={() => pick(item)}
                    >
                      <span className="min-w-0 flex-1 truncate text-[13px]" style={{ color: i === index ? 'var(--text-1)' : 'var(--text-2)' }}>
                        {item.label}
                      </span>
                      <span className="meta shrink-0 truncate" style={{ maxWidth: 260 }}>{item.hint}</span>
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  )
}