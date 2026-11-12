// 회의: 채널 위 회의 버튼, 녹음 중 막대(받아쓰기·메모), 녹취록으로 회의록 만들기.
import { useEffect, useRef, useState } from 'react'
import { FileAudio, Mic, NotebookPen, Square, Trash2, Upload } from 'lucide-react'
import { t } from '../lib/i18n'
import {
  discardMeeting,
  meetingClock,
  publishTranscript,
  setNotes,
  setUploadAudio,
  startMeeting,
  stopMeeting,
  useMeeting,
} from '../lib/meeting'
import { openChannel, setModal, useStore } from '../lib/store'
import { fmtDuration } from './Decisions'
import { Button, IconButton, MenuItem, Popover, cx, useAutosize } from './ui'

const canRecord = () => !!window.am?.meetingStart

/** 채널 위쪽 회의 버튼: 녹음 시작 / 녹취록으로 회의록 */
export function MeetingButton({ channelId }: { channelId: string }) {
  const meeting = useMeeting((s) => s.meeting)
  const [open, setOpen] = useState(false)
  if (meeting && meeting.channelId !== channelId) {
    // 다른 채널에서 녹음 중: 그 채널로 가는 표시
    return (
      <button
        type="button"
        onClick={() => openChannel(meeting.channelId)}
        className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium text-danger hover:bg-hover"
      >
        <span className="size-2 rounded-full bg-danger motion-safe:animate-pulse" />
        {t('meeting.recording')}
      </button>
    )
  }
  return (
    <div className="relative">
      <IconButton label={t('meeting.menu')} active={open || !!meeting} onClick={() => setOpen((v) => !v)}>
        <Mic size={18} className={cx(meeting && 'text-danger')} />
      </IconButton>
      <Popover open={open} onClose={() => setOpen(false)} className="top-11 right-0 w-[280px]">
        {canRecord() && (
          <MenuItem icon={<Mic size={16} />} onClick={() => (setOpen(false), void startMeeting(channelId))}>
            <span className="block">{t('meeting.start')}</span>
            <span className="block text-[12px] whitespace-normal text-fg-3">{t('meeting.startHint')}</span>
          </MenuItem>
        )}
        <MenuItem icon={<NotebookPen size={16} />} onClick={() => (setOpen(false), setModal({ kind: 'meetingImport', channelId }))}>
          <span className="block">{t('meeting.import')}</span>
        </MenuItem>
      </Popover>
    </div>
  )
}

function useTick(on: boolean) {
  const [, set] = useState(0)
  useEffect(() => {
    if (!on) return
    const id = setInterval(() => set((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [on])
}

/** 녹음 중 막대(입력창 위). 받아쓰는 글이 바로 보이고, 메모를 남길 수 있다 */
export function MeetingBar({ channelId }: { channelId: string }) {
  const m = useMeeting((s) => s.meeting)
  const [showNotes, setShowNotes] = useState(false)
  const notesRef = useRef<HTMLTextAreaElement>(null)
  const lines = useRef<HTMLDivElement>(null)
  useAutosize(notesRef, m?.notes ?? '', 140)
  useTick(!!m && !m.stopping)
  useEffect(() => {
    lines.current?.scrollTo({ top: lines.current.scrollHeight })
  }, [m?.lines.length, m?.partial])
  if (!m || m.channelId !== channelId) return null
  const elapsed = (Date.now() - m.startedAt) / 1000
  const recent = m.lines.slice(-6)
  const liveHint =
    m.live === 'off' || m.live === 'unavailable' ? t('meeting.liveOff') : m.live === 'denied' ? t('meeting.liveDenied') : null
  return (
    <div className="pop-in mb-2 overflow-hidden rounded-[22px] border border-danger/30 bg-bg shadow-[0_6px_24px_rgba(0,0,0,0.06)]" role="region" aria-label={t('meeting.recording')}>
      <div className="flex items-center gap-2.5 px-4 pt-2.5 pb-2">
        <span className={cx('size-2.5 shrink-0 rounded-full bg-danger', !m.stopping && 'motion-safe:animate-pulse')} aria-hidden />
        <span className="text-[13.5px] font-medium">{m.stopping ? t('meeting.saving') : t('meeting.recording')}</span>
        <span className="font-mono text-[13px] text-fg-2 tabular-nums">{meetingClock(elapsed)}</span>
        {/* 소리 크기 */}
        <span className="flex h-3 items-end gap-0.5" aria-hidden>
          {[0.15, 0.35, 0.55, 0.75].map((th) => (
            <span key={th} className={cx('w-1 rounded-sm transition-colors', m.level > th ? 'bg-ok' : 'bg-line-2')} style={{ height: `${4 + th * 10}px` }} />
          ))}
        </span>
        <span className="flex-1" />
        <IconButton label={t('meeting.notes')} active={showNotes} className="size-8" onClick={() => setShowNotes((v) => !v)}>
          <NotebookPen size={15} />
        </IconButton>
        <IconButton
          label={t('meeting.discard')}
          className="size-8"
          onClick={() => {
            if (window.confirm(t('meeting.discardConfirm'))) void discardMeeting()
          }}
        >
          <Trash2 size={15} />
        </IconButton>
        <Button disabled={m.stopping} className="h-8 gap-1.5 px-3 text-[13px]" onClick={() => void stopMeeting(fmtDuration)}>
          <Square size={11} fill="currentColor" />
          {t('meeting.stop')}
        </Button>
      </div>
      {(m.live === 'on' || m.live === 'starting' || recent.length > 0) && (
        <div ref={lines} className="max-h-[132px] overflow-y-auto border-t border-line px-4 py-2 text-[13.5px] leading-relaxed" aria-label={t('meeting.live')}>
          {recent.map((l, i) => (
            <p key={m.lines.length - recent.length + i} className="text-fg-2">
              <span className="mr-2 font-mono text-[11.5px] text-fg-3">{meetingClock(l.start)}</span>
              {l.text}
            </p>
          ))}
          {m.partial ? <p className="text-fg">{m.partial}</p> : !recent.length && <p className="text-fg-3">{t('meeting.listening')}</p>}
        </div>
      )}
      {liveHint && <p className="border-t border-line px-4 py-2 text-[12.5px] text-fg-3">{liveHint}</p>}
      {m.live === 'dictation' && (
        <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-2 text-[12.5px] text-fg-3">
          <span className="min-w-0 flex-1">{t('meeting.dictationOff')}</span>
          <Button variant="secondary" className="h-7 px-2.5 text-[12.5px]" onClick={() => void window.am?.meetingOpenDictation()}>
            {t('meeting.openDictation')}
          </Button>
        </div>
      )}
      {showNotes && (
        <div className="border-t border-line px-4 py-2">
          <textarea
            ref={notesRef}
            autoFocus
            rows={2}
            value={m.notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={t('meeting.notesPlaceholder')}
            aria-label={t('meeting.notes')}
            className="selectable block w-full resize-none bg-transparent text-[14px] leading-[1.55] outline-none placeholder:text-fg-3"
          />
        </div>
      )}
      <label className="flex cursor-pointer items-center gap-1.5 border-t border-line px-4 py-2 text-[12.5px] text-fg-2">
        <input type="checkbox" checked={m.uploadAudio} onChange={(e) => setUploadAudio(e.target.checked)} className="accent-[var(--blue)]" />
        <FileAudio size={13} />
        {t('meeting.uploadAudio')}
      </label>
    </div>
  )
}

// ── 녹취록으로 회의록 만들기 ──────────────────────────────────

/** VTT·SRT 의 머리말·번호·시간 줄을 걷어 '[00:12] 말' 꼴로 */
export function cleanTranscript(raw: string): string {
  const text = raw.replace(/\r/g, '').replace(/^﻿/, '')
  if (!/-->/.test(text)) return text.trim()
  const out: string[] = []
  let stamp = ''
  for (const line of text.split('\n')) {
    const s = line.trim()
    if (!s || /^WEBVTT/i.test(s) || /^NOTE\b/.test(s) || /^\d+$/.test(s)) continue
    const m = s.match(/^(?:(\d{1,2}):)?(\d{2}):(\d{2})[.,]\d{3}\s*-->/)
    if (m) {
      // 1시간이 안 되면 시는 뺀다: 00:01:10 → 01:10
      stamp = `${m[1] && Number(m[1]) > 0 ? `${Number(m[1])}:` : ''}${m[2]}:${m[3]}`
      continue
    }
    // <v 이름>말 → 이름: 말 (말한 사람을 남긴다), 그 밖의 꾸밈 태그는 뺀다
    const said = s.replace(/<v\s+([^>]+)>/g, '$1: ').replace(/<[^>]+>/g, '')
    out.push(stamp ? `[${stamp}] ${said}` : said)
    stamp = ''
  }
  return out.join('\n')
}

export function MeetingImport({ channelId }: { channelId: string }) {
  const [text, setText] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const file = useRef<HTMLInputElement>(null)
  const channel = useStore((s) => s.channels[channelId])
  const go = async () => {
    const content = cleanTranscript(text)
    if (!content || busy) return
    setBusy(true)
    const label = name.replace(/\.[^.]+$/, '') || channel?.title || ''
    const ok = await publishTranscript(channelId, t('meeting.importTitle', { name: label }), content.slice(0, 190_000))
    setBusy(false)
    if (ok) setModal(null)
  }
  return (
    <div className="p-5">
      <h2 className="flex items-center gap-2 text-[17px] font-semibold">
        <NotebookPen size={17} />
        {t('meeting.import')}
      </h2>
      <p className="mt-2 text-[13.5px] leading-relaxed text-fg-2">{t('meeting.importHint')}</p>
      <input
        ref={file}
        type="file"
        accept=".txt,.vtt,.srt,.md,text/plain,text/vtt,text/markdown"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0]
          if (!f) return
          setName(f.name)
          setText(await f.text())
        }}
      />
      <Button variant="secondary" className="mt-4 h-9 gap-1.5" onClick={() => file.current?.click()}>
        <Upload size={15} />
        {name || t('meeting.importPick')}
      </Button>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t('meeting.importPaste')}
        aria-label={t('meeting.importPaste')}
        className="selectable mt-3 block h-48 w-full resize-none rounded-xl border border-line-2 bg-bg px-3.5 py-2.5 text-[13.5px] leading-relaxed outline-none focus:border-blue"
      />
      <div className="mt-4 flex justify-end gap-1.5">
        <Button variant="ghost" onClick={() => setModal(null)}>
          {t('common.cancel')}
        </Button>
        <Button disabled={busy || !text.trim()} onClick={() => void go()}>
          {t('meeting.importGo')}
        </Button>
      </div>
    </div>
  )
}
