import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, Copy, Download, File as FileIcon, FileText, Lock, Send, Undo2, X } from 'lucide-react'
import type { FileMeta, Message } from '@ah/protocol'
import { fileKind, fmtSize, isImage, saveFile, useFileUrl } from '../lib/files'
import { systemText, t } from '../lib/i18n'
import { approveDraft, member, rejectDraft, setCanvas, shareMessage, unshareMessage, useStore } from '../lib/store'
import { AgentAvatar, Avatar, Button, Markdown, MentionText, agentLabel, cx, timeLabel, useAutosize, useCopy, type MentionMark } from './ui'

function sameGroup(a: Message | undefined, b: Message) {
  return (
    !!a &&
    a.kind !== 'system' &&
    b.kind !== 'system' &&
    a.authorId === b.authorId &&
    a.authorKind === b.authorKind &&
    a.visibility === b.visibility &&
    a.status === b.status &&
    b.createdAt - a.createdAt < 5 * 60_000
  )
}

/** 이 메시지가 부른 사람들(이름이 바뀌어도 지금 이름으로) */
function marksOf(m: Message, meId: string | undefined): MentionMark[] {
  return (m.mentions ?? []).flatMap((id) => {
    const name = member(m.channelId, id)?.name
    return name ? [{ name, me: id === meId }] : []
  })
}

export function MessageRow({ m, prev }: { m: Message; prev?: Message }) {
  const me = useStore((s) => s.me)
  useStore((s) => s.channels[m.channelId])
  if (m.kind === 'system') {
    // 이벤트가 있으면 내 화면 언어로 다시 그린다(예전 메시지는 저장된 문장 그대로)
    return <div className="py-3 text-center text-[13px] text-fg-3">{m.event ? systemText(m.event) : m.body}</div>
  }
  const grouped = sameGroup(prev, m)
  const mineHuman = m.authorKind === 'human' && m.authorId === me?.id

  if (mineHuman) {
    const priv = m.visibility === 'private'
    return (
      <div className={cx('group flex flex-col items-end', grouped ? 'mt-1.5' : 'mt-6')}>
        {priv && !grouped && (
          <span className="mb-1 inline-flex items-center gap-1 text-[12px] font-medium text-blue">
            <Lock size={11} strokeWidth={2.4} />
            {t('composer.toMyAgent')}
          </span>
        )}
        {m.kind === 'artifact' ? (
          <ArtifactCard m={m} />
        ) : m.kind === 'file' && m.file ? (
          <>
            <FileCard file={m.file} align="end" />
            {m.body && <p className="mt-1.5 max-w-[78%] text-right text-[14px] text-fg-2">{m.body}</p>}
          </>
        ) : (
          <div
            className={cx(
              'max-w-[78%] rounded-[22px] px-4.5 py-2.5 text-[15px] leading-[1.6] whitespace-pre-wrap',
              priv ? 'bg-blue-bg' : 'bg-bubble',
            )}
          >
            <span className="selectable">
              <MentionText text={m.body} marks={marksOf(m, me?.id)} />
            </span>
          </div>
        )}
        <Hover m={m} />
      </div>
    )
  }

  const owner = member(m.channelId, m.authorId)
  const isAgent = m.authorKind === 'agent'
  const mineAgent = isAgent && m.authorId === me?.id
  const color = owner?.color ?? '#888'
  const name = isAgent
    ? mineAgent
      ? t('common.myAgent')
      : t('common.agentOf', { name: owner?.name ?? t('common.unknown') })
    : (owner?.name ?? t('common.unknown'))

  return (
    <div className={cx('group', grouped ? 'mt-2' : 'mt-6')}>
      {!grouped && (
        <div className="mb-1.5 flex items-center gap-2">
          {isAgent ? <AgentAvatar color={color} size={26} /> : <Avatar name={owner?.name ?? '?'} color={color} size={26} />}
          <span className="text-[14px] font-semibold">{name}</span>
          {isAgent && m.agentKind && (
            <span className="rounded-md border border-line px-1.5 text-[11.5px] leading-[18px] text-fg-2">{agentLabel(m.agentKind)}</span>
          )}
          {m.visibility === 'private' && (
            <span className="inline-flex items-center gap-1 rounded-md bg-blue-bg px-1.5 text-[11.5px] leading-[18px] font-medium text-blue">
              <Lock size={10} strokeWidth={2.4} />
              {t('message.onlyMe')}
            </span>
          )}
          {m.status === 'pending' && (
            <span className="rounded-md bg-amber-bg px-1.5 text-[11.5px] leading-[18px] font-medium text-amber">{t('common.pending')}</span>
          )}
          <span className="text-[12px] text-fg-3">{timeLabel(m.createdAt)}</span>
          {m.edited && <span className="text-[12px] text-fg-3">{t('message.edited')}</span>}
        </div>
      )}
      <div className="pl-[34px]">
        {m.status === 'pending' ? (
          <PendingPreview m={m} />
        ) : m.kind === 'artifact' ? (
          <>
            <ArtifactCard m={m} />
            {m.body && <p className="mt-2 text-[14px] text-fg-2">{m.body}</p>}
          </>
        ) : m.kind === 'file' && m.file ? (
          <>
            <FileCard file={m.file} />
            {m.body && <p className="mt-2 text-[14px] text-fg-2">{m.body}</p>}
          </>
        ) : m.visibility === 'private' ? (
          <div className="rounded-2xl bg-sidebar px-4 py-3 text-[15px]">
            <Markdown text={m.body} mentions={marksOf(m, me?.id)} />
          </div>
        ) : (
          <div className="text-[15px]">
            <Markdown text={m.body} mentions={marksOf(m, me?.id)} />
          </div>
        )}
        <Hover m={m} />
      </div>
    </div>
  )
}

function Hover({ m }: { m: Message }) {
  const [copied, copy] = useCopy()
  const [busy, setBusy] = useState(false)
  const meId = useStore((s) => s.me?.id)
  if (m.kind !== 'text' || m.status === 'pending') return null
  // 내 에이전트 글은 채널에 공유하거나(나에게만 온 답) 공유를 취소할 수 있다(채널에 나간 글)
  const mineAgent = m.authorKind === 'agent' && m.authorId === meId
  const run = async (fn: (id: string) => Promise<void>) => {
    setBusy(true)
    await fn(m.id)
    setBusy(false)
  }
  return (
    <div className="mt-1 flex h-7 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
      <button
        type="button"
        aria-label={t('common.copy')}
        title={t('common.copy')}
        onClick={() => copy(m.body)}
        className="inline-flex size-7 items-center justify-center rounded-md text-fg-3 hover:bg-hover hover:text-fg"
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
      {mineAgent &&
        (m.visibility === 'private' ? (
          <HoverAction icon={<Send size={13} />} label={t('message.share')} hint={t('message.shareHint')} busy={busy} onClick={() => run(shareMessage)} />
        ) : (
          <HoverAction icon={<Undo2 size={13} />} label={t('message.unshare')} hint={t('message.unshareHint')} busy={busy} onClick={() => run(unshareMessage)} />
        ))}
    </div>
  )
}

function HoverAction({ icon, label, hint, busy, onClick }: { icon: React.ReactNode; label: string; hint: string; busy: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      title={hint}
      disabled={busy}
      onClick={onClick}
      className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[12.5px] font-medium text-fg-3 hover:bg-hover hover:text-fg disabled:opacity-40"
    >
      {icon}
      {label}
    </button>
  )
}

export function ArtifactCard({ m }: { m: Message }) {
  const a = useStore((s) => (m.artifactId ? s.artifacts[m.artifactId] : undefined))
  const final = a?.status === 'final' && a.finalVersion === m.artifactVersion
  return (
    <button
      type="button"
      onClick={() => m.artifactId && setCanvas({ mode: 'view', artifactId: m.artifactId, version: m.artifactVersion })}
      className="flex w-full max-w-[400px] items-center gap-3 rounded-2xl border border-line bg-bg px-3 py-2.5 text-left transition-colors hover:bg-sidebar"
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-line bg-sidebar text-fg-2">
        <FileText size={18} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14.5px] font-medium">{a?.title ?? t('doc.untitled')}</span>
        <span className="block text-[12.5px] text-fg-3">
          {t('doc.cardMeta', { version: m.artifactVersion })}
          {final && <span className="text-ok"> · {t('doc.final')}</span>}
        </span>
      </span>
    </button>
  )
}

// 채널 안의 승인 대기 초안: 보기만. 보내기·고치기·버리기는 입력창 위(승인 영역)에서 한다.
function PendingPreview({ m }: { m: Message }) {
  const me = useStore((s) => s.me)
  return (
    <div className="rounded-2xl border border-dashed border-line-2 px-4 py-3">
      <div className="opacity-75">
        {m.kind === 'artifact' ? (
          <ArtifactCard m={m} />
        ) : m.kind === 'file' && m.file ? (
          <FileCard file={m.file} />
        ) : (
          <div className="text-[15px]">
            <Markdown text={m.body} mentions={marksOf(m, me?.id)} />
          </div>
        )}
        {m.kind !== 'text' && m.body && <p className="mt-2 text-[14px] text-fg-2">{m.body}</p>}
      </div>
      <p className="mt-2 text-[12.5px] text-fg-3">{t('dock.hint')}</p>
    </div>
  )
}

export function DraftCard({ m, compact }: { m: Message; compact?: boolean }) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(m.body)
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)
  useAutosize(ref, text, 360)
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    await fn()
    setBusy(false)
  }
  const isDoc = m.kind === 'artifact'
  const isFile = m.kind === 'file'
  return (
    <div className={cx('rounded-2xl border border-dashed border-line-2', compact ? 'p-3.5' : 'p-4')}>
      {isFile && m.file ? (
        <>
          <p className="mb-2 text-[13px] text-fg-3">{t('draft.fileNotice')}</p>
          <FileCard file={m.file} />
          {m.body && <p className="mt-2 text-[14px] text-fg-2">{m.body}</p>}
        </>
      ) : isDoc ? (
        <>
          <ArtifactCard m={m} />
          {m.body && <p className="mt-2 text-[14px] text-fg-2">{m.body}</p>}
        </>
      ) : editing ? (
        <textarea
          ref={ref}
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="selectable block w-full resize-none bg-transparent text-[15px] leading-[1.6] outline-none"
        />
      ) : (
        <div className="text-[15px]">
          <Markdown text={m.body} />
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {editing ? (
          <>
            <Button disabled={busy || !text.trim()} onClick={() => act(() => approveDraft(m.id, text))} className="h-8 px-3.5">
              {t('draft.sendEdited')}
            </Button>
            <Button variant="ghost" className="h-8 px-3" onClick={() => (setEditing(false), setText(m.body))}>
              {t('common.cancel')}
            </Button>
          </>
        ) : (
          <>
            <Button disabled={busy} onClick={() => act(() => approveDraft(m.id))} className="h-8 px-3.5">
              {t('common.send')}
            </Button>
            {!isDoc && !isFile && (
              <Button variant="secondary" className="h-8 px-3.5" onClick={() => setEditing(true)}>
                {t('draft.edit')}
              </Button>
            )}
            <Button variant="ghost" disabled={busy} className="h-8 px-3" onClick={() => act(() => rejectDraft(m.id))}>
              {t('draft.discard')}
            </Button>
          </>
        )}
      </div>
    </div>
  )
}

// 채널에 올린 파일. 이미지는 미리 보고 눌러서 크게, 나머지는 받기.
export function FileCard({ file, align }: { file: FileMeta; align?: 'end' }) {
  const image = isImage(file)
  const url = useFileUrl(image ? file.id : null)
  const [viewing, setViewing] = useState(false)

  if (image) {
    return (
      <div className={cx('flex max-w-[min(360px,78%)] flex-col', align === 'end' && 'items-end')}>
        <button
          type="button"
          aria-label={t('file.viewLarge', { name: file.name })}
          onClick={() => url && setViewing(true)}
          className="block overflow-hidden rounded-2xl border border-line bg-sidebar"
        >
          {url ? (
            <img src={url} alt={file.name} className="block max-h-[320px] w-auto max-w-full object-contain" />
          ) : (
            <span className="block h-40 w-60 motion-safe:animate-pulse" />
          )}
        </button>
        <div className="mt-1 flex max-w-full items-center gap-1.5 text-[12.5px] text-fg-3">
          <span className="truncate">{file.name}</span>
          <span className="shrink-0">· {fmtSize(file.size)}</span>
          <button
            type="button"
            aria-label={t('common.download')}
            title={t('common.download')}
            onClick={() => void saveFile(file)}
            className="inline-flex size-6 shrink-0 items-center justify-center rounded-md hover:bg-hover hover:text-fg"
          >
            <Download size={13} />
          </button>
        </div>
        {viewing && url && <ImageViewer url={url} file={file} onClose={() => setViewing(false)} />}
      </div>
    )
  }

  return (
    <div className="flex w-full max-w-[400px] items-center gap-3 rounded-2xl border border-line bg-bg px-3 py-2.5">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-line bg-sidebar text-fg-2">
        <FileIcon size={18} />
      </span>
      <span className="min-w-0 flex-1 text-left">
        <span className="selectable block truncate text-[14.5px] font-medium">{file.name}</span>
        <span className="block text-[12.5px] text-fg-3">
          {fileKind(file)} · {fmtSize(file.size)}
        </span>
      </span>
      <button
        type="button"
        aria-label={t('common.download')}
        title={t('common.download')}
        onClick={() => void saveFile(file)}
        className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-fg-2 hover:bg-hover hover:text-fg"
      >
        <Download size={17} />
      </button>
    </div>
  )
}

function ImageViewer({ url, file, onClose }: { url: string; file: FileMeta; onClose: () => void }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [onClose])
  return createPortal(
    <div role="dialog" aria-label={file.name} className="fixed inset-0 z-50 flex flex-col bg-black/85" onClick={onClose}>
      <div className="flex h-14 shrink-0 items-center gap-2 px-4 text-[14px] text-white/85" onClick={(e) => e.stopPropagation()}>
        <span className="min-w-0 flex-1 truncate">{file.name}</span>
        <button
          type="button"
          aria-label={t('common.download')}
          onClick={() => void saveFile(file)}
          className="inline-flex size-9 items-center justify-center rounded-lg hover:bg-white/10"
        >
          <Download size={18} />
        </button>
        <button type="button" aria-label={t('common.close')} onClick={onClose} className="inline-flex size-9 items-center justify-center rounded-lg hover:bg-white/10">
          <X size={19} />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center p-6 pt-0">
        <img src={url} alt={file.name} className="max-h-full max-w-full object-contain" onClick={(e) => e.stopPropagation()} />
      </div>
    </div>,
    document.body,
  )
}
