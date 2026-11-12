import { useEffect, useMemo, useState } from 'react'
import { Bot, Check, Copy, FolderOpen, Hash, KeyRound, LogIn, Monitor, Moon, RotateCw, ScrollText, Search, Sun, Terminal, UserRound, Unplug } from 'lucide-react'
import {
  api,
  channelList,
  guard,
  joinByCode,
  logout,
  openChannel,
  refreshAgentStatus,
  setAutoApprove,
  setModal,
  setTheme,
  useStore,
  type Theme,
} from '../lib/store'
import type { Channel } from '@ah/protocol'
import { LANGUAGES, setLocale, stageLabel, t, useLocale, type Dict } from '../lib/i18n'
import { Button, IconButton, Modal, ModalHeader, Toggle, cx, useCopy } from './ui'
import { AwayModal } from './Decisions'
import { MeetingImport } from './Meeting'

export function Modals() {
  const modal = useStore((s) => s.modal)
  const close = () => setModal(null)
  return (
    <>
      <Modal open={modal?.kind === 'settings'} onClose={close} width={720}>
        {modal?.kind === 'settings' && <Settings tab={modal.tab} />}
      </Modal>
      <Modal open={modal?.kind === 'invite'} onClose={close} width={420}>
        {modal?.kind === 'invite' && <Invite channelId={modal.channelId} />}
      </Modal>
      <Modal open={modal?.kind === 'join'} onClose={close} width={400}>
        {modal?.kind === 'join' && <Join />}
      </Modal>
      <Modal open={modal?.kind === 'search'} onClose={close} width={560}>
        {modal?.kind === 'search' && <SearchChannels />}
      </Modal>
      <Modal open={modal?.kind === 'away'} onClose={close} width={440}>
        {modal?.kind === 'away' && <AwayModal />}
      </Modal>
      <Modal open={modal?.kind === 'meetingImport'} onClose={close} width={560}>
        {modal?.kind === 'meetingImport' && <MeetingImport channelId={modal.channelId} />}
      </Modal>
    </>
  )
}

// ── 설정 ────────────────────────────────────────────────────

type Tab = 'general' | 'agents' | 'account'
const TABS: { id: Tab; icon: React.ReactNode }[] = [
  { id: 'general', icon: <Monitor size={16} /> },
  { id: 'agents', icon: <Unplug size={16} /> },
  { id: 'account', icon: <UserRound size={16} /> },
]
const tabLabel = (id: Tab) => t(`settings.${id}`)

function Settings({ tab }: { tab: Tab }) {
  return (
    <div className="flex h-[500px]">
      <nav className="w-[190px] shrink-0 border-r border-line bg-sidebar p-2 pt-3">
        <div className="px-2.5 pb-3 text-[17px] font-semibold">{t('settings.title')}</div>
        {TABS.map((x) => (
          <button
            key={x.id}
            type="button"
            onClick={() => setModal({ kind: 'settings', tab: x.id })}
            className={cx(
              'flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-[14px]',
              tab === x.id ? 'bg-active' : 'hover:bg-hover',
            )}
          >
            {x.icon}
            {tabLabel(x.id)}
          </button>
        ))}
      </nav>
      <div className="flex min-w-0 flex-1 flex-col">
        <ModalHeader title={tabLabel(tab)} onClose={() => setModal(null)} />
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
          {tab === 'general' && <GeneralTab />}
          {tab === 'agents' && <AgentsTab />}
          {tab === 'account' && <AccountTab />}
        </div>
      </div>
    </div>
  )
}

function SettingRow({ label, children, sub }: { label: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-14 items-center justify-between gap-4 border-b border-line py-3 last:border-0">
      <div className="min-w-0">
        <div className="text-[14px]">{label}</div>
        {sub && <div className="truncate text-[12.5px] text-fg-3">{sub}</div>}
      </div>
      {children}
    </div>
  )
}

function GeneralTab() {
  const theme = useStore((s) => s.theme)
  const relayUrl = useStore((s) => s.relayUrl)
  const locale = useLocale((s) => s.locale)
  const opts: { id: Theme; label: string; icon: React.ReactNode }[] = [
    { id: 'system', label: t('settings.themeSystem'), icon: <Monitor size={14} /> },
    { id: 'light', label: t('settings.themeLight'), icon: <Sun size={14} /> },
    { id: 'dark', label: t('settings.themeDark'), icon: <Moon size={14} /> },
  ]
  return (
    <>
      <SettingRow label={t('settings.language')} sub={t('settings.languageSub')}>
        <div className="flex rounded-full bg-sidebar p-0.5">
          {LANGUAGES.map((l) => (
            <button
              key={l.id}
              type="button"
              lang={l.id}
              aria-pressed={locale === l.id}
              onClick={() => setLocale(l.id)}
              className={cx(
                'inline-flex h-8 items-center rounded-full px-3 text-[13px]',
                locale === l.id ? 'bg-bg font-medium shadow-sm' : 'text-fg-2',
              )}
            >
              {l.label}
            </button>
          ))}
        </div>
      </SettingRow>
      <SettingRow label={t('settings.theme')}>
        <div className="flex rounded-full bg-sidebar p-0.5">
          {opts.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => setTheme(o.id)}
              className={cx(
                'inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px]',
                theme === o.id ? 'bg-bg font-medium shadow-sm' : 'text-fg-2',
              )}
            >
              {o.icon}
              {o.label}
            </button>
          ))}
        </div>
      </SettingRow>
      <SettingRow label={t('settings.server')} sub={relayUrl}>
        <span />
      </SettingRow>
    </>
  )
}

const runnerLabel = (s: RunnerState) => t(`runner.${s}` satisfies keyof Dict)

function shortPath(p: string) {
  return p.replace(/^\/Users\/[^/]+/, '~').replace(/^C:\\Users\\[^\\]+/i, '~')
}

// 연결할 수 있는 에이전트. 한 사람에 하나만 연결된다(다른 걸 연결하면 바뀐다).
const AGENT_ROWS: { kind: 'claude-code' | 'codex'; name: string; icon: React.ReactNode; installed: (s: ConnectorStatus) => boolean }[] = [
  { kind: 'claude-code', name: 'Claude Code', icon: <Terminal size={18} />, installed: (s) => s.claudeInstalled },
  { kind: 'codex', name: 'Codex', icon: <Bot size={18} />, installed: (s) => s.codexInstalled },
]

function AgentsTab() {
  const me = useStore((s) => s.me)
  const relayUrl = useStore((s) => s.relayUrl)
  const status = useStore((s) => s.agentStatus)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ kind: string; message: string } | null>(null)
  const desktop = !!window.am

  useEffect(() => {
    void refreshAgentStatus()
  }, [])

  const act = async (kind: string, fn: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError({ kind, message: e instanceof Error ? e.message : t('agents.connectFailed') })
    }
    await refreshAgentStatus()
    setBusy(false)
  }

  const connect = (kind: string) =>
    act(kind, async () => {
      const { token } = await api.agentToken(kind)
      const r = await window.am!.connectAgent({ token, agentKind: kind, relayUrl })
      if (!r.ok) throw new Error(r.error ?? t('agents.connectFailed'))
    })

  return (
    <div className="flex flex-col gap-3 pt-1">
      {AGENT_ROWS.map((a) => {
        const connected = !!status?.configured && status.agentKind === a.kind && me?.agentKind === a.kind
        const online = connected && !!me?.agentOnline && status?.runner !== 'error'
        const installed = status ? a.installed(status) : false
        const state = !desktop
          ? t('agents.desktopOnly')
          : !status
            ? t('agents.checking')
            : !installed
              ? t('agents.missing', { name: a.name })
              : connected
                ? runnerLabel(status.runner)
                : t('agents.notConnected')
        const message = error?.kind === a.kind ? error.message : connected && status?.runner === 'error' ? status.message : ''
        return (
          <div key={a.kind} className="rounded-2xl border border-line p-4">
            <div className="flex items-center gap-3">
              <AgentIcon>{a.icon}</AgentIcon>
              <div className="min-w-0 flex-1">
                <div className="text-[14.5px] font-medium">{a.name}</div>
                <div className="flex items-center gap-1.5 text-[12.5px] text-fg-3">
                  {connected && <span className={cx('size-1.5 rounded-full', online ? 'bg-ok' : status?.runner === 'error' ? 'bg-danger' : 'bg-fg-3')} />}
                  {state}
                </div>
              </div>
              <Button variant={connected ? 'secondary' : 'primary'} disabled={!desktop || busy || !installed} onClick={() => connect(a.kind)}>
                {connected ? t('agents.reconnect') : t('agents.connect')}
              </Button>
            </div>
            {message && <p className="selectable mt-3 text-[13px] break-words whitespace-pre-wrap text-danger">{message}</p>}
            {connected && status && (
              <div className="mt-4 flex flex-col gap-3">
                <p className="text-[13px] leading-relaxed text-fg-2">{t('agents.about', { name: a.name })}</p>
                <div className="flex items-center gap-2 rounded-xl bg-code py-1.5 pr-1.5 pl-3">
                  <FolderOpen size={15} className="shrink-0 text-fg-3" />
                  <span className="selectable min-w-0 flex-1 truncate font-mono text-[12.5px] text-fg-2" title={status.workdir}>
                    {shortPath(status.workdir)}
                  </span>
                  <Button variant="ghost" className="h-8 px-3 text-[13px]" disabled={busy} onClick={() => act(a.kind, () => window.am!.pickAgentFolder())}>
                    {t('agents.changeFolder')}
                  </Button>
                </div>
                <p className="text-[13px] text-fg-3">{t('agents.modelHint')}</p>
                <div className="flex gap-2">
                  <Button variant="secondary" disabled={busy} onClick={() => act(a.kind, () => window.am!.restartAgent())}>
                    <RotateCw size={15} />
                    {t('agents.restart')}
                  </Button>
                  <Button variant="ghost" onClick={() => void window.am!.openAgentLog()}>
                    <ScrollText size={15} />
                    {t('agents.log')}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )
      })}
      {/* 항상 모두 승인: 에이전트가 보내는 것과 도구 실행을 묻지 않고 처리 */}
      <div className="flex items-center gap-3 rounded-2xl border border-line p-4">
        <div className="min-w-0 flex-1">
          <div className="text-[14.5px] font-medium">{t('auto.title')}</div>
          <div className="text-[12.5px] text-fg-3">{t('auto.desc')}</div>
        </div>
        <Toggle label={t('auto.title')} on={!!me?.autoApprove} onChange={(v) => void setAutoApprove(v)} />
      </div>
      <Soon name={t('agents.apiKey')} icon={<KeyRound size={18} />} />
    </div>
  )
}

function AgentIcon({ children }: { children: React.ReactNode }) {
  return <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-line bg-sidebar text-fg-2">{children}</span>
}

function Soon({ name, icon }: { name: string; icon: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-line p-4 opacity-60">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-line bg-sidebar text-fg-2">{icon}</span>
      <div className="flex-1 text-[14.5px] font-medium">{name}</div>
      <span className="text-[13px] text-fg-3">{t('agents.soon')}</span>
    </div>
  )
}

function AccountTab() {
  const me = useStore((s) => s.me)
  const [name, setName] = useState(me?.name ?? '')
  return (
    <>
      <SettingRow label={t('settings.name')}>
        <form
          className="flex items-center gap-2"
          onSubmit={async (e) => {
            e.preventDefault()
            const r = await guard(api.rename(name.trim()))
            if (r) useStore.setState({ me: r.user })
          }}
        >
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={30}
            className="h-9 w-44 rounded-full border border-line-2 bg-bg px-4 text-[14px] outline-none focus:border-blue"
          />
          <Button type="submit" variant="secondary" disabled={!name.trim() || name.trim() === me?.name}>
            {t('common.save')}
          </Button>
        </form>
      </SettingRow>
      <SettingRow label={t('nav.logout')}>
        <Button variant="secondary" onClick={() => (setModal(null), logout())}>
          {t('nav.logout')}
        </Button>
      </SettingRow>
    </>
  )
}

// ── 초대·참여 ───────────────────────────────────────────────

function Invite({ channelId }: { channelId: string }) {
  const [code, setCode] = useState<string | null>(null)
  const [copied, copy] = useCopy()
  useEffect(() => {
    void guard(api.invite(channelId)).then((r) => r && setCode(r.code))
  }, [channelId])
  return (
    <div className="pb-6">
      <ModalHeader title={t('invite.title')} onClose={() => setModal(null)} />
      <div className="px-5">
        <div className="mt-2 flex items-center justify-between rounded-2xl bg-sidebar px-5 py-4">
          <span className="selectable font-mono text-[28px] font-semibold tracking-[0.22em]">{code ?? '······'}</span>
          <Button variant="secondary" disabled={!code} onClick={() => code && copy(code)}>
            {copied ? <Check size={15} /> : <Copy size={15} />}
            {copied ? t('common.copied') : t('common.copy')}
          </Button>
        </div>
        <p className="mt-3 text-[13px] text-fg-3">{t('invite.hint')}</p>
      </div>
    </div>
  )
}

function Join() {
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <form
      className="pb-5"
      onSubmit={async (e) => {
        e.preventDefault()
        setBusy(true)
        setError('')
        try {
          await joinByCode(code)
          setModal(null)
        } catch (err) {
          setError(err instanceof Error ? err.message : t('join.failed'))
        }
        setBusy(false)
      }}
    >
      <ModalHeader title={t('join.title')} onClose={() => setModal(null)} />
      <div className="px-5">
        <input
          autoFocus
          value={code}
          onChange={(e) =>
            setCode(
              e.target.value
                .toUpperCase()
                .replace(/[^A-Z0-9]/g, '')
                .slice(0, 6),
            )
          }
          placeholder="ABC123"
          className="mt-2 h-14 w-full rounded-2xl border border-line-2 bg-bg text-center font-mono text-[24px] font-semibold tracking-[0.3em] outline-none placeholder:text-fg-3/50 focus:border-blue"
        />
        {error && <p className="mt-2 text-[13px] text-danger">{error}</p>}
        <Button type="submit" disabled={busy || code.length < 6} className="mt-3 h-11 w-full">
          <LogIn size={16} />
          {t('join.button')}
        </Button>
      </div>
    </form>
  )
}

/** 채널 마지막 메시지 미리보기(문서·파일은 종류를 붙여서) */
function previewText(c: Channel): string {
  const text = c.lastMessage ?? ''
  if (c.lastMessageKind === 'artifact') return t('preview.doc', { title: text })
  if (c.lastMessageKind === 'file') return t('preview.file', { name: text })
  return text
}

function SearchChannels() {
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  useStore((s) => s.channels)
  const results = useMemo(() => {
    const list = channelList()
    const t = q.trim().toLowerCase()
    return t ? list.filter((c) => c.title.toLowerCase().includes(t) || c.members.some((m) => m.name.includes(t))) : list
  }, [q])
  const pick = (id: string) => {
    setModal(null)
    void openChannel(id)
  }
  return (
    <div>
      <div className="flex items-center gap-2.5 border-b border-line px-4">
        <Search size={18} className="text-fg-3" />
        <input
          autoFocus
          value={q}
          onChange={(e) => (setQ(e.target.value), setSel(0))}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') (e.preventDefault(), setSel((s) => Math.min(results.length - 1, s + 1)))
            if (e.key === 'ArrowUp') (e.preventDefault(), setSel((s) => Math.max(0, s - 1)))
            if (e.key === 'Enter' && results[sel] && !e.nativeEvent.isComposing) pick(results[sel].id)
          }}
          placeholder={t('search.placeholder')}
          className="h-14 flex-1 bg-transparent text-[15px] outline-none placeholder:text-fg-3"
        />
      </div>
      <div className="max-h-[360px] overflow-y-auto p-2">
        {results.map((c, i) => (
          <button
            key={c.id}
            type="button"
            onMouseEnter={() => setSel(i)}
            onClick={() => pick(c.id)}
            className={cx('flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left', i === sel && 'bg-hover')}
          >
            <Hash size={16} className="shrink-0 text-fg-3" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14.5px]">{c.title}</span>
              {c.lastMessage && <span className="block truncate text-[12.5px] text-fg-3">{previewText(c)}</span>}
            </span>
            <span className="shrink-0 text-[12px] text-fg-3">{stageLabel(c.stage)}</span>
          </button>
        ))}
        <button
          type="button"
          onClick={() => setModal({ kind: 'join' })}
          className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[14.5px] text-fg-2 hover:bg-hover"
        >
          <LogIn size={16} className="shrink-0" />
          {t('join.title')}
        </button>
      </div>
    </div>
  )
}
