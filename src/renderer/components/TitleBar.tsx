import { useEffect, useState } from 'react'
import { bridge } from '../bridge'
import { useNexa } from '../store'
import { Wordmark } from './Logo'
import { IconMinus, IconSearch, IconSquare, IconWindowRestore, IconX } from './Icons'

function isWindowMaximized(): boolean {
  if (typeof window === 'undefined') return false
  const availableWidth = window.screen.availWidth
  const availableHeight = window.screen.availHeight
  return availableWidth > 0 && availableHeight > 0
    && Math.abs(window.outerWidth - availableWidth) <= 16
    && Math.abs(window.outerHeight - availableHeight) <= 16
}

export function TitleBar() {
  const setQuick = useNexa((s) => s.setQuick)
  const [maximized, setMaximized] = useState(isWindowMaximized)

  useEffect(() => {
    const update = () => setMaximized(isWindowMaximized())
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  return (
    <header className="drag-region hairline-b flex h-10 shrink-0 items-center justify-between px-4">
      <div className="flex items-center gap-4 min-w-0">
        <Wordmark />
      </div>
      <div className="no-drag flex items-center gap-4">
        <button
          type="button"
          className="btn-text meta flex items-center gap-1.5"
          onClick={() => setQuick(true)}
          title="Quick switcher"
          aria-label="Open quick switcher"
        >
          <IconSearch size={11} />
          <span>Ctrl K</span>
        </button>
        <div className="flex items-center gap-1" style={{ color: 'var(--text-2)' }}>
          <button
            type="button"
            className="window-control"
            onClick={() => bridge.window.minimize()}
            title="Minimize"
            aria-label="Minimize"
          >
            <IconMinus size={11} />
          </button>
          <button
            type="button"
            className="window-control"
            onClick={() => bridge.window.maximize()}
            title={maximized ? 'Restore' : 'Maximize'}
            aria-label={maximized ? 'Restore' : 'Maximize'}
          >
            {maximized ? <IconWindowRestore size={11} /> : <IconSquare size={10} />}
          </button>
          <button
            type="button"
            className="window-control window-control-close"
            onClick={() => bridge.window.close()}
            title="Close"
            aria-label="Close"
          >
            <IconX size={11} />
          </button>
        </div>
      </div>
    </header>
  )
}
