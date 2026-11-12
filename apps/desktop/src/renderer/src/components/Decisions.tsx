// 결정함·자리 비움·돌아왔을 때 요약.
// 사람이 자리에 없어도 그 사람이 정해야 할 일이 쌓여 있다가, 돌아오면 한 번에(선택지 한 번 누르기로) 정한다.
import { useEffect, useRef, useState } from 'react'
import { Moon, Signpost, Sparkles, X } from 'lucide-react'
import type { Decision } from '@ah/protocol'
import { t } from '../lib/i18n'
import { api, catchUp, closeWelcome, decide, dismissDecision, member, openChannel, setAway, setModal, useStore } from '../lib/store'
import { TopBar } from './TopBar'
import { Avatar, Button, Markdown, cx, timeLabel, useAutosize } from './ui'

/** 3분 → '3분', 80분 → '1시간 20분' */
export function fmtDuration(ms: number): string {
  const min = Math.max(1, Math.round(ms / 60_000))
  if (min < 60) return t('dur.min', { n: min })
  const h = Math.floor(min / 60)
  if (h < 24) return t('dur.hour', { h, m: min % 60 })
  return t('dur.day', { d: Math.floor(h / 24) })
}

// ── 결정함 페이지 ────────────────────────────────────────────

export function DecisionsPage() {
  const decisions = useStore((s) => s.decisions)
  const [past, setPast] = useState<Decision[]>([])
  useEffect(() => {
    void api
      .decisions(true)
      .then((all) => setPast(all.filter((d) => d.status !== 'open').slice(0, 20)))
      .catch(() => {})
  }, [decisions.length])
  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <TopBar left={<span className="px-2.5 text-[17px] font-medium">{t('decision.title')}</span>} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[46rem] px-6 py-4">
          {decisions.length === 0 ? (
            <div className="flex flex-col items-center gap-3 pt-[16vh] pb-10 text-center text-fg-3">
              <Signpost size={34} strokeWidth={1.4} />
              <span className="text-[15px]">{t('decision.empty')}</span>
              <span className="max-w-[26rem] text-[13px] leading-relaxed">{t('decision.emptyHint')}</span>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {decisions.map((d) => (
                <DecisionCard key={d.id} d={d} />
              ))}
            </div>
          )}
          {past.length > 0 && (
            <>
              <div className="mt-10 mb-2 text-[13px] font-medium text-fg-3">{t('decision.history')}</div>
              <div className="divide-y divide-line rounded-2xl border border-line">
                {past.map((d) => (
                  <PastDecision key={d.id} d={d} />
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function PastDecision({ d }: { d: Decision }) {
  const channel = useStore((s) => s.channels[d.channelId])
  const label =
    d.status === 'decided' ? t('decision.statusDecided') : d.status === 'resolved' ? t('decision.statusResolved') : t('decision.statusDismissed')
  return (
    <div className="px-4 py-3 text-[14px]">
      <div className="flex items-center gap-2 text-[12.5px] text-fg-3">
        <span>{label}</span>
        {channel && <span>· {channel.title}</span>}
        <span>· {timeLabel(d.decidedAt ?? d.updatedAt)}</span>
      </div>
      <div className="mt-0.5 line-clamp-2 text-fg-2">{d.question}</div>
      {d.answer && <div className="mt-0.5 font-medium">→ {d.answer}</div>}
    </div>
  )
}

// ── 결정 카드(결정함·입력창 위) ───────────────────────────────

export function DecisionCard({ d, compact }: { d: Decision; compact?: boolean }) {
  const channel = useStore((s) => s.channels[d.channelId])
  const requester = d.requesterId ? member(d.channelId, d.requesterId) : null
  const [text, setText] = useState('')
  const [notify, setNotify] = useState(true)
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)
  useAutosize(ref, text, 160)
  const go = async (answer: string) => {
    if (!answer.trim() || busy) return
    setBusy(true)
    const ok = await decide(d.id, answer.trim(), notify)
    setBusy(false)
    if (ok) setText('')
  }
  return (
    <div className={cx('rounded-2xl border border-line bg-bg', compact ? 'p-3.5' : 'p-4')} aria-label={d.question}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-fg-3">
        <Signpost size={13} className="text-amber" aria-hidden />
        {!compact && channel && (
          <button type="button" onClick={() => openChannel(d.channelId)} className="font-medium text-fg-2 hover:underline">
            {channel.title}
          </button>
        )}
        <span>{d.source === 'mention' ? t('decision.fromMention') : t('decision.fromAgent')}</span>
        <span>· {timeLabel(d.createdAt)}</span>
      </div>
      <p className={cx('mt-1.5 font-medium whitespace-pre-wrap', compact ? 'text-[14.5px]' : 'text-[15.5px]')}>{d.question}</p>
      {d.context && (
        <div className="mt-1.5 text-[14px] text-fg-2">
          <Markdown text={d.context} />
        </div>
      )}
      {requester && (
        <div className="mt-2 flex items-center gap-1.5 text-[13px] text-fg-2">
          <Avatar name={requester.name} color={requester.color} size={18} />
          {t('decision.waiting', { name: requester.name })}
        </div>
      )}
      {d.options.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {d.options.map((o) => (
            <Button key={o} variant="secondary" disabled={busy} className="h-8 px-3.5 text-[13.5px]" onClick={() => void go(o)}>
              {o}
            </Button>
          ))}
        </div>
      )}
      <div className="mt-2.5 flex items-end gap-1.5 rounded-xl border border-line-2 px-3 py-1.5 focus-within:border-blue">
        <textarea
          ref={ref}
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              void go(text)
            }
          }}
          placeholder={t('decision.write')}
          aria-label={t('decision.write')}
          className="selectable min-w-0 flex-1 resize-none bg-transparent py-1 text-[14px] leading-[1.5] outline-none placeholder:text-fg-3"
        />
        <Button disabled={busy || !text.trim()} className="h-7 px-3 text-[13px]" onClick={() => void go(text)}>
          {t('decision.decide')}
        </Button>
      </div>
      <div className="mt-2 flex items-center gap-3 text-[13px]">
        <label className="flex cursor-pointer items-center gap-1.5 text-fg-2">
          <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} className="accent-[var(--blue)]" />
          {t('decision.notify')}
        </label>
        <span className="flex-1" />
        <button type="button" disabled={busy} onClick={() => void dismissDecision(d.id)} className="text-fg-3 hover:text-fg-2">
          {t('decision.dismiss')}
        </button>
      </div>
    </div>
  )
}

// ── 돌아왔을 때 ──────────────────────────────────────────────

/** 자리에서 돌아오면 비운 동안을 한 줄로 보여 준다. channelId 가 있으면 그 채널 요약을 받을 수 있다 */
export function WelcomeBack({ channelId }: { channelId?: string }) {
  const w = useStore((s) => s.welcomeBack)
  const decisions = useStore((s) => s.decisions.length)
  const drafts = useStore((s) => s.drafts.length)
  const unread = useStore((s) => Object.values(s.channels).filter((c) => c.unread > 0).length)
  const canAsk = useStore((s) => !!s.me?.agentKind)
  if (!w) return null
  const parts = [
    decisions > 0 && t('welcome.decisions', { n: decisions }),
    drafts > 0 && t('welcome.drafts', { n: drafts }),
    unread > 0 && t('welcome.unread', { n: unread }),
  ].filter(Boolean) as string[]
  return (
    <div className="pop-in mx-auto mt-2 w-full max-w-[46rem] px-6" role="status">
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-sidebar px-4 py-2.5 text-[13.5px]">
        <span className="font-medium">{t('welcome.title', { dur: fmtDuration(w.at - w.since) })}</span>
        <span className="text-fg-2">{parts.length ? parts.join(' · ') : t('welcome.quiet')}</span>
        <span className="flex-1" />
        {decisions > 0 && (
          <Button variant="ghost" className="h-7 px-2.5 text-[13px]" onClick={() => (closeWelcome(), useStore.setState({ view: { kind: 'decisions' }, canvas: null }))}>
            {t('welcome.open')}
          </Button>
        )}
        {channelId && canAsk && (
          <Button variant="secondary" className="h-7 gap-1 px-2.5 text-[13px]" onClick={() => void catchUp(channelId, w.since)}>
            <Sparkles size={13} />
            {t('welcome.catchUp')}
          </Button>
        )}
        <button type="button" aria-label={t('common.close')} onClick={closeWelcome} className="rounded-md p-1 text-fg-3 hover:bg-hover hover:text-fg">
          <X size={14} />
        </button>
      </div>
    </div>
  )
}

// ── 자리 비움 ────────────────────────────────────────────────

export function AwayModal() {
  const me = useStore((s) => s.me)
  const [note, setNote] = useState(me?.awayNote ?? '')
  const presets = [t('away.p1'), t('away.p2'), t('away.p3'), t('away.p4')]
  const save = async () => {
    await setAway(true, note)
    setModal(null)
  }
  return (
    <form
      className="p-5"
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
    >
      <h2 className="flex items-center gap-2 text-[17px] font-semibold">
        <Moon size={17} />
        {t('away.title')}
      </h2>
      <p className="mt-2 text-[13.5px] leading-relaxed text-fg-2">{t('away.hint')}</p>
      <input
        autoFocus
        value={note}
        maxLength={60}
        onChange={(e) => setNote(e.target.value)}
        placeholder={t('away.notePlaceholder')}
        className="mt-4 h-11 w-full rounded-xl border border-line-2 bg-bg px-3.5 text-[14.5px] outline-none focus:border-blue"
      />
      <div className="mt-2 flex flex-wrap gap-1.5">
        {presets.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setNote(p)}
            className={cx('rounded-full border px-3 py-1 text-[13px]', note === p ? 'border-blue text-blue' : 'border-line-2 text-fg-2 hover:bg-hover')}
          >
            {p}
          </button>
        ))}
      </div>
      <div className="mt-5 flex justify-end gap-1.5">
        <Button variant="ghost" onClick={() => setModal(null)}>
          {t('common.cancel')}
        </Button>
        <Button type="submit">{t('away.save')}</Button>
      </div>
    </form>
  )
}

/** '자리 비움 · 회의 중 · 20분 전부터' 한 줄(사이드바 내 상태·참여자 목록) */
export function AwayLine({ since, note, className }: { since: number; note?: string; className?: string }) {
  return (
    <span className={cx('inline-flex min-w-0 items-center gap-1 text-amber', className)}>
      <Moon size={11} className="shrink-0" aria-hidden />
      <span className="truncate">
        {t('away.status', { note: note ?? '' })} · {t('away.since', { dur: fmtDuration(Date.now() - since) })}
      </span>
    </span>
  )
}
