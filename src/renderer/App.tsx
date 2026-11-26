import { useEffect } from 'react'
import { AnimatePresence, MotionConfig, motion } from 'framer-motion'
import { useNexa } from './store'
import { SPRING_SOFT } from './motion'
import { bridge } from './bridge'
import { TitleBar } from './components/TitleBar'
import { TopBar } from './components/TopBar'
import { Sidebar } from './components/Sidebar'
import { Hero } from './components/Hero'
import { Conversation } from './components/Conversation'
import { Composer } from './components/Composer'
import { ApprovalPanel } from './components/ApprovalPanel'
import { ActivityDrawer } from './components/ActivityDrawer'
import { SettingsPanel } from './components/Settings'
import { QuickSwitcher } from './components/QuickSwitcher'
import { CodeWorkspace } from './components/CodeWorkspace'
import { UpdateDialog } from './components/UpdateDialog'
import { IconAlert, IconCheck, IconInfo, IconX } from './components/Icons'

export default function App() {
  const s = useNexa()

  useEffect(() => {
    void useNexa.getState().init()
    const offAgent = bridge.onAgentEvent((e) => useNexa.getState().handleEvent(e))
    const offUpdate = bridge.onUpdateState((next) => useNexa.setState({
      update: next,
      updateOpen: next.phase === 'downloaded' ? true : useNexa.getState().updateOpen
    }))
    return () => {
      offAgent()
      offUpdate()
    }
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey
      const state = useNexa.getState()
      if (mod && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        state.setQuick(!state.quickOpen)
      } else if (mod && event.key === ',') {
        event.preventDefault()
        state.setSettings(!state.settingsOpen)
      } else if (event.key === 'Escape') {
        if (state.quickOpen) state.setQuick(false)
        else if (state.settingsOpen) state.setSettings(false)
        else if (state.activityOpen) state.setActivity(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!s.ready) {
    return (
      <div className="flex h-full items-center justify-center" style={{ background: 'var(--bg)' }}>
        <div className="flex items-center gap-2 text-[12px]" style={{ color: 'var(--text-2)' }}><IconCheck size={13} /> Opening workspace</div>
      </div>
    )
  }

  const updateModalOpen = s.updateOpen && s.update.phase !== 'idle'
  const ToastIcon = s.toast?.kind === 'error' ? IconAlert : s.toast?.kind === 'info' ? IconInfo : IconCheck

  return (
    <MotionConfig reducedMotion={s.settings.motion === 'full' ? 'never' : 'always'}>
      <div className="flex h-full flex-col" style={{ background: 'var(--bg)' }}>
        <div
          id="app-background"
          className="flex h-full min-h-0 flex-1 flex-col"
          aria-hidden={updateModalOpen}
          inert={updateModalOpen}
        >
          <TitleBar />
          <QuickSwitcher />
          <TopBar />
          <div className="relative flex min-h-0 flex-1">
            <Sidebar />
            <main className="relative flex min-w-0 flex-1 flex-col">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={s.view}
                  className="flex min-h-0 flex-1 flex-col"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={SPRING_SOFT}
                >
                  {s.view === 'hero' ? <Hero /> : <><Conversation /><Composer variant="chat" /></>}
                </motion.div>
              </AnimatePresence>
              <AnimatePresence>{s.approvals.length > 0 && <ApprovalPanel key="approval" />}</AnimatePresence>
            </main>
            <AnimatePresence>{s.rightOpen && <CodeWorkspace key="workspace" />}</AnimatePresence>
            <ActivityDrawer />
            <SettingsPanel />
          </div>
        </div>
        <UpdateDialog />
        <AnimatePresence>
          {s.toast && (
            <div
              role={s.toast.kind === 'error' ? 'alert' : 'status'}
              aria-live={s.toast.kind === 'error' ? 'assertive' : 'polite'}
              aria-atomic="true"
              className="toast fixed bottom-4 left-4 z-50 flex max-w-[420px] items-center gap-2"
            >
              <ToastIcon size={12} /><span>{s.toast.message}</span>
              <button type="button" className="icon-button ml-2" aria-label="Dismiss notification" onClick={() => useNexa.setState({ toast: null })}><IconX size={11} /></button>
            </div>
          )}
        </AnimatePresence>
      </div>
    </MotionConfig>
  )
}
