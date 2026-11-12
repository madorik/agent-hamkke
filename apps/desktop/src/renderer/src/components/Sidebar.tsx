import { useState } from 'react'
import { ArrowUpCircle, Inbox, ListTodo, LogOut, Moon, PanelLeft, Search, Settings, Signpost, SquarePen, Sun, Unplug } from 'lucide-react'
import { t } from '../lib/i18n'
import { channelList, goHome, installUpdate, logout, openChannel, setAway, setModal, toggleSidebar, useStore } from '../lib/store'
import { AwayLine } from './Decisions'
import { Avatar, IconButton, MenuItem, Popover, agentLabel, cx } from './ui'

export const isMac = navigator.userAgent.includes('Mac')

export function Sidebar() {
  const open = useStore((s) => s.sidebarOpen)
  const view = useStore((s) => s.view)
  const me = useStore((s) => s.me)
  const online = useStore((s) => s.online)
  const pending = useStore((s) => s.drafts.length + s.permissions.length)
  const decisions = useStore((s) => s.decisions.length)
  const myTasks = useStore((s) => s.myTasks.length)
  useStore((s) => s.channels)
  const channels = channelList()
  const [menu, setMenu] = useState(false)

  return (
    <aside
      className={cx(
        'flex h-full shrink-0 flex-col overflow-hidden bg-sidebar transition-[width] duration-200 ease-out',
        open ? 'w-[260px] border-r border-line' : 'w-0',
      )}
    >
      <div className="flex h-full w-[260px] flex-col">
        <div className={cx('drag flex h-[52px] shrink-0 items-center justify-end px-2', isMac && 'pl-[78px]')}>
          <IconButton label={t('nav.closeSidebar')} onClick={toggleSidebar}>
            <PanelLeft size={18} />
          </IconButton>
        </div>

        <nav className="flex flex-col gap-px px-2">
          <NavItem icon={<SquarePen size={17} />} label={t('nav.newChannel')} active={view.kind === 'home'} onClick={goHome} />
          <NavItem
            icon={<Search size={17} />}
            label={t('nav.search')}
            hint={isMac ? '⌘K' : 'Ctrl K'}
            onClick={() => setModal({ kind: 'search' })}
          />
          <NavItem
            icon={<Inbox size={17} />}
            label={t('nav.approvals')}
            active={view.kind === 'approvals'}
            onClick={() => useStore.setState({ view: { kind: 'approvals' }, canvas: null })}
            count={pending}
          />
          <NavItem
            icon={<Signpost size={17} />}
            label={t('nav.decisions')}
            active={view.kind === 'decisions'}
            onClick={() => useStore.setState({ view: { kind: 'decisions' }, canvas: null })}
            count={decisions}
          />
          <NavItem
            icon={<ListTodo size={17} />}
            label={t('nav.tasks')}
            active={view.kind === 'tasks'}
            onClick={() => useStore.setState({ view: { kind: 'tasks' }, canvas: null })}
            count={myTasks}
            quiet
          />
        </nav>

        <div className="mt-5 min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {channels.length > 0 && <div className="px-2.5 pb-1 text-[13px] text-fg-3">{t('nav.channels')}</div>}
          {channels.map((c) => {
            const active = view.kind === 'channel' && view.id === c.id
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => openChannel(c.id)}
                className={cx(
                  'group flex h-9 w-full items-center gap-2 rounded-lg px-2.5 text-left text-[14px]',
                  active ? 'bg-active' : 'hover:bg-hover',
                )}
              >
                <span className={cx('min-w-0 flex-1 truncate', c.unread > 0 && !active && 'font-semibold')}>{c.title}</span>
                {c.pendingCount > 0 && (
                  <span className="rounded-full bg-amber-bg px-1.5 text-[11px] leading-[18px] font-semibold text-amber">
                    {c.pendingCount}
                  </span>
                )}
                {c.unread > 0 && !active && c.pendingCount === 0 && <span className="size-2 rounded-full bg-blue" />}
              </button>
            )
          })}
        </div>

        <UpdateNotice />

        {me && (
          <div className="relative border-t border-line p-2">
            <Popover open={menu} onClose={() => setMenu(false)} className="bottom-[60px] left-2 w-[244px]">
              {me.awaySince ? (
                <MenuItem icon={<Sun size={16} />} onClick={() => (setMenu(false), void setAway(false))}>
                  {t('away.back')}
                </MenuItem>
              ) : (
                <MenuItem icon={<Moon size={16} />} onClick={() => (setMenu(false), setModal({ kind: 'away' }))}>
                  {t('away.set')}
                </MenuItem>
              )}
              <div className="my-1 h-px bg-line" />
              <MenuItem icon={<Unplug size={16} />} onClick={() => (setMenu(false), setModal({ kind: 'settings', tab: 'agents' }))}>
                {t('agent.connect')}
              </MenuItem>
              <MenuItem icon={<Settings size={16} />} onClick={() => (setMenu(false), setModal({ kind: 'settings', tab: 'general' }))}>
                {t('nav.settings')}
              </MenuItem>
              <div className="my-1 h-px bg-line" />
              <MenuItem icon={<LogOut size={16} />} onClick={() => (setMenu(false), logout())}>
                {t('nav.logout')}
              </MenuItem>
            </Popover>
            <button
              type="button"
              onClick={() => setMenu((v) => !v)}
              className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-hover"
            >
              <Avatar name={me.name} color={me.color} size={30} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] leading-5 font-medium">{me.name}</span>
                {me.awaySince && <AwayLine since={me.awaySince} note={me.awayNote} className="flex text-[12px] leading-4" />}
                <span className="flex items-center gap-1.5 text-[12px] leading-4 text-fg-3">
                  <span className={cx('size-1.5 rounded-full', !online ? 'bg-danger' : me.agentOnline ? 'bg-ok' : 'bg-fg-3')} />
                  {!online
                    ? t('nav.offline')
                    : me.agentKind
                      ? t('nav.agentState', { agent: agentLabel(me.agentKind), online: me.agentOnline })
                      : t('common.noAgent')}
                </span>
              </span>
            </button>
          </div>
        )}
      </div>
    </aside>
  )
}

/** 새 버전을 받아 두었으면 다시 시작해 업데이트할 수 있게 */
function UpdateNotice() {
  const u = useStore((s) => s.update)
  if (!u?.enabled || u.state !== 'ready') return null
  return (
    <div className="pop-in mx-2 mb-2 rounded-xl border border-line bg-bg p-2.5 text-[13px]" role="status">
      <div className="flex items-center gap-1.5 font-medium">
        <ArrowUpCircle size={15} className="text-blue" />
        {t('update.ready', { version: u.version ?? '' })}
      </div>
      <button
        type="button"
        onClick={() => void installUpdate()}
        className="mt-2 h-8 w-full rounded-full bg-accent text-[13px] font-medium text-accent-fg hover:opacity-85"
      >
        {t('update.restart')}
      </button>
    </div>
  )
}

function NavItem({
  icon,
  label,
  onClick,
  active,
  hint,
  count,
  quiet,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  active?: boolean
  hint?: string
  count?: number
  /** 숫자를 눈에 덜 띄게(처리할 것이 아니라 남은 개수) */
  quiet?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx('group flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-[14px]', active ? 'bg-active' : 'hover:bg-hover')}
    >
      <span className="text-fg">{icon}</span>
      <span className="flex-1 text-left">{label}</span>
      {hint && <span className="text-[12px] text-fg-3 opacity-0 group-hover:opacity-100">{hint}</span>}
      {!!count &&
        (quiet ? (
          <span className="min-w-5 text-center text-[12px] text-fg-3">{count}</span>
        ) : (
          <span className="min-w-5 rounded-full bg-amber px-1.5 text-center text-[11px] leading-5 font-semibold text-white dark:text-black">
            {count}
          </span>
        ))}
    </button>
  )
}
