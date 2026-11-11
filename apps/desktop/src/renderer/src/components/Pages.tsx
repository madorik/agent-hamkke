import { useState } from 'react'
import { Globe, Inbox, MessagesSquare, Unplug } from 'lucide-react'
import { LANGUAGES, getLocale, setLocale, t } from '../lib/i18n'
import { answerPermission, openChannel, setModal, signup, startChannel, useStore } from '../lib/store'
import { Composer } from './Composer'
import { DraftCard } from './Message'
import { TopBar } from './TopBar'
import { AgentAvatar, Button, cx, timeLabel } from './ui'

export function Home() {
  const me = useStore((s) => s.me)
  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <TopBar />
      <div className="flex flex-1 flex-col items-center justify-center px-6 pb-[14vh]">
        <h1 className="mb-8 text-center text-[28px] font-medium tracking-[-0.01em]">{t('home.title')}</h1>
        <div className="w-full max-w-[46rem]">
          <Composer autoFocus placeholder={t('home.placeholder')} onSend={(text) => startChannel(text)} />
        </div>
        <div className="mt-4 flex items-center gap-2">
          <Button variant="ghost" className="h-8 text-[13px]" onClick={() => setModal({ kind: 'join' })}>
            {t('join.title')}
          </Button>
          {me && !me.agentKind && (
            <Button variant="ghost" className="h-8 text-[13px]" onClick={() => setModal({ kind: 'settings', tab: 'agents' })}>
              <Unplug size={14} />
              {t('agent.connect')}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

export function Approvals() {
  const drafts = useStore((s) => s.drafts)
  const permissions = useStore((s) => s.permissions)
  const channels = useStore((s) => s.channels)
  const me = useStore((s) => s.me)
  const empty = drafts.length === 0 && permissions.length === 0
  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <TopBar left={<span className="px-2.5 text-[17px] font-medium">{t('nav.approvals')}</span>} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {empty ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 pb-[14vh] text-fg-3">
            <Inbox size={34} strokeWidth={1.4} />
            <span className="text-[15px]">{t('approvals.empty')}</span>
          </div>
        ) : (
          <div className="mx-auto w-full max-w-[46rem] px-6 py-4">
            {permissions.length > 0 && <Section label={t('approvals.tools')} />}
            {permissions.map((p) => (
              <PermissionCard
                key={p.id}
                id={p.id}
                tool={p.toolName}
                description={p.description}
                preview={p.inputPreview}
                at={p.createdAt}
                color={me?.color ?? '#888'}
              />
            ))}
            {drafts.length > 0 && <Section label={t('approvals.drafts')} />}
            {drafts.map((d) => (
              <div key={d.id} className="mb-5">
                <div className="mb-2 flex items-center gap-2 text-[13px]">
                  <AgentAvatar color={me?.color ?? '#888'} size={22} />
                  <button type="button" onClick={() => openChannel(d.channelId)} className="font-medium hover:underline">
                    {channels[d.channelId]?.title ?? t('common.channel')}
                  </button>
                  <span className="text-fg-3">{timeLabel(d.createdAt)}</span>
                </div>
                <DraftCard m={d} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function Section({ label }: { label: string }) {
  return <div className="mt-4 mb-3 text-[13px] font-medium text-fg-3">{label}</div>
}

export function PermissionCard({
  id,
  tool,
  description,
  preview,
  at,
  color,
  compact,
}: {
  id: string
  tool: string
  description: string
  preview: string
  at: number
  color: string
  /** 채널 안 '작업 중' 줄에 넣을 때: 머리줄 없이 */
  compact?: boolean
}) {
  const [busy, setBusy] = useState(false)
  const act = async (b: 'allow' | 'deny') => {
    setBusy(true)
    await answerPermission(id, b)
    setBusy(false)
  }
  return (
    <div className={cx('rounded-2xl border border-line p-4', !compact && 'mb-4')}>
      {compact ? (
        <div className="text-[13px] text-fg-3">{tool}</div>
      ) : (
        <div className="flex items-center gap-2.5">
          <AgentAvatar color={color} size={26} />
          <span className="flex-1 text-[14.5px]">
            <b className="font-semibold">Claude Code</b> · {tool}
          </span>
          <span className="text-[12px] text-fg-3">{timeLabel(at)}</span>
        </div>
      )}
      {description && <p className={cx('text-[14.5px]', compact ? 'mt-1' : 'mt-2')}>{description}</p>}
      {preview && (
        <pre className="selectable mt-2 max-h-48 overflow-auto rounded-xl bg-code px-3 py-2.5 font-mono text-[12.5px] leading-relaxed whitespace-pre-wrap text-fg-2">
          {preview}
        </pre>
      )}
      <div className="mt-3 flex gap-1.5">
        <Button disabled={busy} className="h-8 px-3.5" onClick={() => act('allow')}>
          {t('permission.allow')}
        </Button>
        <Button variant="ghost" disabled={busy} className="h-8 px-3" onClick={() => act('deny')}>
          {t('permission.deny')}
        </Button>
      </div>
    </div>
  )
}

export function Onboarding() {
  const relayUrl = useStore((s) => s.relayUrl)
  const [name, setName] = useState('')
  const [server, setServer] = useState(relayUrl)
  const [showServer, setShowServer] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return (
    <div className="drag flex h-full items-center justify-center">
      <form
        className="no-drag w-full max-w-[360px] px-6 text-center"
        onSubmit={async (e) => {
          e.preventDefault()
          if (!name.trim()) return
          setBusy(true)
          setError('')
          try {
            await signup(name.trim(), server.trim().replace(/\/$/, ''))
          } catch (err) {
            setError(err instanceof Error ? err.message : t('onboarding.failed'))
          }
          setBusy(false)
        }}
      >
        <div className="mx-auto mb-7 flex size-12 items-center justify-center rounded-2xl bg-accent text-accent-fg">
          <MessagesSquare size={24} />
        </div>
        <h1 className="text-[26px] font-semibold tracking-[-0.01em]">{t('onboarding.title')}</h1>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('onboarding.name')}
          maxLength={30}
          className="mt-8 h-[52px] w-full rounded-full border border-line-2 bg-bg px-5 text-[15px] outline-none placeholder:text-fg-3 focus:border-blue"
        />
        {showServer && (
          <input
            value={server}
            onChange={(e) => setServer(e.target.value)}
            placeholder={t('onboarding.server')}
            className="mt-2.5 h-[52px] w-full rounded-full border border-line-2 bg-bg px-5 text-[14px] outline-none focus:border-blue"
          />
        )}
        {error && <p className="mt-3 text-[13px] text-danger">{error}</p>}
        <Button type="submit" disabled={busy || !name.trim()} className="mt-3 h-[52px] w-full text-[15px]">
          {t('onboarding.continue')}
        </Button>
        <button
          type="button"
          onClick={() => setShowServer((v) => !v)}
          className={cx('mt-5 text-[13px] text-fg-3 hover:text-fg-2', showServer && 'invisible')}
        >
          {t('onboarding.changeServer')}
        </button>
        {/* 가입 전에도 언어를 고를 수 있게(처음엔 시스템 언어) */}
        <div className="mt-6 flex items-center justify-center gap-1 text-[13px] text-fg-3">
          <Globe size={14} aria-hidden />
          {LANGUAGES.map((l) => (
            <button
              key={l.id}
              type="button"
              lang={l.id}
              aria-pressed={getLocale() === l.id}
              onClick={() => setLocale(l.id)}
              className={cx('rounded-full px-2 py-0.5 hover:text-fg-2', getLocale() === l.id && 'font-medium text-fg-2')}
            >
              {l.label}
            </button>
          ))}
        </div>
      </form>
    </div>
  )
}
