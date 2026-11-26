import { useEffect, useRef } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { MotionLevel, Theme } from '@shared/types'
import { useNexa } from '../store'
import { SPRING_SOFT } from '../motion'
import { IconRefresh, IconX } from './Icons'

export function SettingsPanel() {
  const s = useNexa()
  const panelRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (!s.settingsOpen) return
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const frame = requestAnimationFrame(() => panelRef.current?.focus({ preventScroll: true }))
    return () => {
      cancelAnimationFrame(frame)
      const active = document.activeElement
      if (previousFocus?.isConnected && (active === document.body || panelRef.current?.contains(active))) {
        previousFocus.focus({ preventScroll: true })
      }
    }
  }, [s.settingsOpen])

  const Choice = <T extends string,>({ id, value, options, onPick }: {
    id: string
    value: T
    options: { id: T; label: string }[]
    onPick: (value: T) => void
  }) => (
    <div className="seg" role="radiogroup" aria-label={id}>
      {options.map((option) => (
        <button
          key={option.id}
          role="radio"
          aria-checked={value === option.id}
          onClick={() => onPick(option.id)}
          style={{ color: value === option.id ? 'var(--text-1)' : 'var(--text-3)', background: value === option.id ? 'var(--selected)' : undefined, boxShadow: value === option.id ? 'inset 0 0 0 1px var(--hairline)' : undefined }}
        >
          {option.label}
        </button>
      ))}
    </div>
  )

  const updateMessage = s.update.phase === 'downloaded' && s.update.latestVersion
    ? `Version ${s.update.latestVersion} is ready to install`
    : s.update.phase === 'downloading'
      ? `Downloading ${s.update.percent ?? 0}%`
      : s.update.phase === 'checking'
        ? 'Checking for updates'
        : s.update.phase === 'error'
          ? s.update.message
          : s.update.phase === 'unsupported'
            ? s.update.message
            : 'Automatic updates are enabled'

  return (
    <AnimatePresence>
      {s.settingsOpen && (
        <motion.aside
          ref={panelRef}
          role="dialog"
          aria-label="Settings"
          tabIndex={-1}
          initial={{ x: 420, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 420, opacity: 0 }}
          transition={SPRING_SOFT}
          className="absolute bottom-0 right-0 top-0 z-30 flex w-[420px] max-w-full flex-col outline-none"
          style={{ background: 'var(--bg)', borderLeft: '1px solid var(--hairline-2)', boxShadow: 'var(--shadow-pop)' }}
        >
          <div className="hairline-b flex items-center justify-between px-5 py-4">
            <h2 className="text-[14px] font-semibold">Settings</h2>
            <button className="icon-button" onClick={() => s.setSettings(false)} title="Close settings" aria-label="Close settings"><IconX size={13} /></button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
            <section className="mb-7">
              <h3 className="label mb-3">Appearance</h3>
              <div className="hairline-b flex items-center justify-between gap-4 pb-4">
                <div><div className="text-[12px] font-medium">Theme</div><div className="meta mt-0.5">Use the same monochrome palette everywhere.</div></div>
                <Choice<Theme> id="theme" value={s.settings.theme} options={[{ id: 'light', label: 'Light' }, { id: 'dark', label: 'Dark' }]} onPick={(theme) => void s.patchSettings({ theme })} />
              </div>
              <div className="flex items-center justify-between gap-4 pt-4">
                <div><div className="text-[12px] font-medium">Motion</div><div className="meta mt-0.5">Control interface transitions.</div></div>
                <Choice<MotionLevel> id="motion" value={s.settings.motion} options={[{ id: 'full', label: 'Full' }, { id: 'reduced', label: 'Reduced' }, { id: 'off', label: 'Off' }]} onPick={(motion) => void s.patchSettings({ motion })} />
              </div>
            </section>

            <section className="mb-7">
              <h3 className="label mb-3">Models</h3>
              <div className="flex items-center justify-between gap-3">
                <div><div className="text-[12px] font-medium">{s.models.length} models available</div><div className="meta mt-0.5">{s.cachedAt ? `Last refreshed ${new Date(s.cachedAt).toLocaleTimeString()}` : 'Model list has not been cached'}</div></div>
                <button className="btn-outline flex shrink-0 items-center gap-1.5" disabled={s.modelsLoading} onClick={() => void s.refreshModels(true)}><IconRefresh size={11} /> Refresh</button>
              </div>
            </section>

            <section className="mb-7">
              <h3 className="label mb-3">Updates</h3>
              <div className="hairline-b pb-4">
                <div className="flex items-center justify-between gap-3">
                  <div><div className="text-[12px] font-medium">Nexa {s.update.currentVersion}</div><div className="meta mt-1 max-w-[240px]">{updateMessage}</div></div>
                  {s.update.phase === 'downloaded' ? (
                    <button className="btn-primary shrink-0" onClick={() => void s.installUpdate()}>Restart and update</button>
                  ) : (
                    <button className="btn-outline flex shrink-0 items-center gap-1.5" disabled={s.update.phase === 'checking' || s.update.phase === 'downloading'} onClick={() => void s.checkForUpdates()}><IconRefresh size={11} /> Check</button>
                  )}
                </div>
                {s.update.phase === 'downloading' && (
                  <div className="mt-3 h-1 overflow-hidden" style={{ background: 'var(--hairline)', borderRadius: 'var(--r-full)' }}>
                    <motion.div className="h-full" style={{ background: 'var(--accent)', borderRadius: 'var(--r-full)' }} animate={{ width: `${s.update.percent ?? 0}%` }} />
                  </div>
                )}
              </div>
            </section>

            <section>
              <h3 className="label mb-3">About</h3>
              <p className="text-[12px] leading-6" style={{ color: 'var(--text-2)' }}>Nexa is a focused desktop workspace for writing code, inspecting changes, and controlling agent runs.</p>
              <p className="meta mt-2">Version {s.update.currentVersion} · Windows 11</p>
            </section>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  )
}
