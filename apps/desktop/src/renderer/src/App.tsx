import { Fragment, useEffect } from 'react'
import { useLocale } from './lib/i18n'
import { boot, goHome, setModal, toggleSidebar, useStore } from './lib/store'
import { ChannelView } from './components/ChannelView'
import { DecisionsPage } from './components/Decisions'
import { MyTasksPage } from './components/Tasks'
import { Modals } from './components/Modals'
import { Approvals, Home, Onboarding } from './components/Pages'
import { Sidebar } from './components/Sidebar'

export function App() {
  const booted = useStore((s) => s.booted)
  const token = useStore((s) => s.token)
  const view = useStore((s) => s.view)
  const toast = useStore((s) => s.toast)
  // 언어를 바꾸면 화면 트리를 새로 그린다(연결·상태는 store 에 있어 그대로)
  const locale = useLocale((s) => s.locale)

  useEffect(() => {
    void boot()
    if ('Notification' in window && Notification.permission === 'default') void Notification.requestPermission()
  }, [])

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (!mod || !useStore.getState().token) return
      if (e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setModal({ kind: 'search' })
      } else if (e.shiftKey && e.key.toLowerCase() === 'o') {
        e.preventDefault()
        goHome()
      } else if (e.shiftKey && e.key.toLowerCase() === 's') {
        e.preventDefault()
        toggleSidebar()
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [])

  if (!booted) return <div className="drag h-full" />
  if (!token) return <Onboarding key={locale} />

  return (
    <div key={locale} className="flex h-full">
      <Sidebar />
      <main className="flex min-w-0 flex-1">
        {view.kind === 'home' && <Home />}
        {view.kind === 'channel' && <ChannelView key={view.id} id={view.id} />}
        {view.kind === 'approvals' && <Approvals />}
        {view.kind === 'decisions' && <DecisionsPage />}
        {view.kind === 'tasks' && <MyTasksPage />}
      </main>
      <Modals />
      {toast && (
        <div
          className="pop-in pointer-events-none fixed bottom-24 left-1/2 z-[60] -translate-x-1/2 rounded-full bg-accent px-4 py-2 text-[13.5px] text-accent-fg shadow-lg"
          style={{ transformOrigin: 'center' }}
        >
          {toast}
        </div>
      )}
    </div>
  )
}
