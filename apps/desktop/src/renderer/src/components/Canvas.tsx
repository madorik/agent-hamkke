import { useMemo, useState } from 'react'
import { diffWords } from 'diff'
import { Check, ChevronLeft, FileText, GitCompare, Pencil, Plus, Send, X } from 'lucide-react'
import type { Artifact, Channel } from '@ah/protocol'
import { t } from '../lib/i18n'
import { api, guard, sendMessage, setCanvas, toast, useStore } from '../lib/store'
import { DraftCard } from './Message'
import { AgentAvatar, Avatar, Button, IconButton, Markdown, cx, timeLabel } from './ui'

const isWin = navigator.userAgent.includes('Windows')

export function Canvas({ channel }: { channel: Channel }) {
  const canvas = useStore((s) => s.canvas)
  const all = useStore((s) => s.artifacts)
  const docs = useMemo(
    () =>
      Object.values(all)
        .filter((a) => a.channelId === channel.id)
        .sort((a, b) => b.updatedAt - a.updatedAt),
    [all, channel.id],
  )
  if (!canvas) return null
  return (
    <section className="fade-in flex h-full w-[min(600px,48%)] min-w-[380px] shrink-0 flex-col border-l border-line bg-bg">
      {canvas.mode === 'list' && <DocList docs={docs} channel={channel} />}
      {canvas.mode === 'new' && <DocEditor channel={channel} />}
      {canvas.mode === 'view' && all[canvas.artifactId] && (
        <DocView key={canvas.artifactId} doc={all[canvas.artifactId]} channel={channel} version={canvas.version} />
      )}
    </section>
  )
}

function Head({ children, back }: { children: React.ReactNode; back?: () => void }) {
  return (
    <div className={cx('drag flex h-[52px] shrink-0 items-center gap-1 border-b border-line px-2', isWin && 'pr-[140px]')}>
      {back && (
        <IconButton label={t('doc.list')} onClick={back}>
          <ChevronLeft size={18} />
        </IconButton>
      )}
      {children}
      <IconButton label={t('common.close')} onClick={() => setCanvas(null)}>
        <X size={18} />
      </IconButton>
    </div>
  )
}

function DocList({ docs, channel }: { docs: Artifact[]; channel: Channel }) {
  return (
    <>
      <Head>
        <span className="flex-1 px-2 text-[15px] font-semibold">{t('doc.title')}</span>
        <Button variant="ghost" className="h-8 rounded-lg px-2.5" onClick={() => setCanvas({ mode: 'new' })}>
          <Plus size={16} />
          {t('doc.new')}
        </Button>
      </Head>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {docs.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-fg-3">
            <FileText size={28} strokeWidth={1.5} />
            <Button variant="secondary" onClick={() => setCanvas({ mode: 'new' })}>
              {t('doc.writeFirst')}
            </Button>
          </div>
        )}
        {docs.map((d) => {
          const latest = d.versions.at(-1)!
          const owner = channel.members.find((m) => m.id === latest.authorId)
          return (
            <button
              key={d.id}
              type="button"
              onClick={() => setCanvas({ mode: 'view', artifactId: d.id, version: null })}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-hover"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-line bg-sidebar text-fg-2">
                <FileText size={16} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14.5px] font-medium">{d.title}</span>
                <span className="block text-[12.5px] text-fg-3">
                  v{latest.version} · {latest.authorKind === 'agent' ? t('common.agentOf', { name: owner?.name ?? '' }) : (owner?.name ?? '')} ·{' '}
                  {timeLabel(latest.createdAt)}
                </span>
              </span>
              {d.status === 'final' && (
                <span className="rounded-md bg-[color-mix(in_srgb,var(--green)_14%,transparent)] px-1.5 text-[12px] leading-5 font-medium text-ok">
                  {t('doc.final')}
                </span>
              )}
              {latest.status === 'pending' && (
                <span className="rounded-md bg-amber-bg px-1.5 text-[12px] leading-5 font-medium text-amber">{t('common.pending')}</span>
              )}
            </button>
          )
        })}
      </div>
    </>
  )
}

function DocEditor({ channel, doc, base, onDone }: { channel: Channel; doc?: Artifact; base?: string; onDone?: () => void }) {
  const [title, setTitle] = useState(doc?.title ?? '')
  const [content, setContent] = useState(base ?? '')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const save = async () => {
    if (!content.trim() || (!doc && !title.trim())) return
    setBusy(true)
    const r = await guard(
      api.saveArtifact(channel.id, { artifactId: doc?.id, title: doc ? undefined : title.trim(), content, note: note.trim() || undefined }),
    )
    setBusy(false)
    if (!r) return
    useStore.setState((s) => ({ artifacts: { ...s.artifacts, [r.artifact!.id]: r.artifact! } }))
    onDone?.()
    setCanvas({ mode: 'view', artifactId: r.artifact!.id, version: r.message.artifactVersion })
  }
  return (
    <>
      <Head back={doc ? onDone : () => setCanvas({ mode: 'list' })}>
        {doc ? (
          <span className="min-w-0 flex-1 truncate px-1 text-[15px] font-semibold">{t('doc.newVersionOf', { title: doc.title })}</span>
        ) : (
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t('doc.titlePlaceholder')}
            className="min-w-0 flex-1 bg-transparent px-2 text-[15px] font-semibold outline-none placeholder:text-fg-3"
          />
        )}
      </Head>
      <textarea
        autoFocus={!!doc}
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder={t('doc.bodyPlaceholder')}
        className="selectable min-h-0 flex-1 resize-none bg-transparent px-8 py-7 text-[14.5px] leading-[1.8] outline-none placeholder:text-fg-3"
      />
      <div className="flex items-center gap-2 border-t border-line px-4 py-3">
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t('doc.notePlaceholder')}
          className="h-9 min-w-0 flex-1 rounded-full border border-line px-4 text-[14px] outline-none placeholder:text-fg-3 focus:border-line-2"
        />
        <Button disabled={busy || !content.trim() || (!doc && !title.trim())} onClick={save}>
          <Send size={15} />
          {t('doc.post')}
        </Button>
      </div>
    </>
  )
}

function DocView({ doc, channel, version }: { doc: Artifact; channel: Channel; version: number | null }) {
  const me = useStore((s) => s.me)
  const drafts = useStore((s) => s.drafts)
  const [compare, setCompare] = useState(false)
  const [editing, setEditing] = useState(false)
  const v = doc.versions.find((x) => x.version === version) ?? doc.versions.at(-1)!
  const idx = doc.versions.indexOf(v)
  const prev = idx > 0 ? doc.versions[idx - 1] : null
  const humans = channel.members
  const signed = new Set(doc.finalizations.filter((f) => f.version === v.version).map((f) => f.userId))
  const isFinal = doc.status === 'final' && doc.finalVersion === v.version
  const draft = v.status === 'pending' ? drafts.find((d) => d.artifactId === doc.id && d.artifactVersion === v.version) : undefined
  const author = channel.members.find((m) => m.id === v.authorId)

  if (editing) return <DocEditor channel={channel} doc={doc} base={v.content} onDone={() => setEditing(false)} />

  return (
    <>
      <Head back={() => setCanvas({ mode: 'list' })}>
        <span className="min-w-0 flex-1 truncate px-1 text-[15px] font-semibold">{doc.title}</span>
        {prev && (
          <IconButton label={t('doc.compare')} active={compare} onClick={() => setCompare((c) => !c)}>
            <GitCompare size={17} />
          </IconButton>
        )}
        {v.status === 'sent' && (
          <IconButton label={t('doc.editAsNew')} onClick={() => setEditing(true)}>
            <Pencil size={16} />
          </IconButton>
        )}
      </Head>

      <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-line px-3 py-2">
        {doc.versions.map((x) => (
          <button
            key={x.version}
            type="button"
            onClick={() => setCanvas({ mode: 'view', artifactId: doc.id, version: x.version })}
            className={cx(
              'h-7 shrink-0 rounded-full px-2.5 text-[12.5px] font-medium',
              x.version === v.version ? 'bg-accent text-accent-fg' : 'text-fg-2 hover:bg-hover',
              x.status === 'pending' && x.version !== v.version && 'text-amber',
            )}
          >
            v{x.version}
            {doc.finalVersion === x.version && doc.status === 'final' ? ' ✓' : ''}
          </button>
        ))}
        <span className="ml-auto flex shrink-0 items-center gap-1.5 pl-3 text-[12.5px] text-fg-3">
          {v.authorKind === 'agent' ? (
            <AgentAvatar color={author?.color ?? '#888'} size={18} />
          ) : (
            <Avatar name={author?.name ?? '?'} color={author?.color ?? '#888'} size={18} />
          )}
          {v.authorKind === 'agent' ? t('common.agentOf', { name: author?.name ?? '' }) : author?.name} · {timeLabel(v.createdAt)}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-8 py-7 text-[15px]">
        {compare && prev ? <Diff before={prev.content} after={v.content} /> : <Markdown text={v.content} />}
      </div>

      <div className="border-t border-line px-4 py-3">
        {draft ? (
          <DraftCard m={draft} compact />
        ) : v.status === 'pending' ? (
          <p className="text-[13px] text-fg-3">{t('doc.pendingOther')}</p>
        ) : (
          <div className="flex items-center gap-3">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <span className="flex -space-x-1">
                {humans.map((h) => (
                  <span
                    key={h.id}
                    className="relative rounded-full ring-2 ring-bg"
                    title={t('doc.signState', { name: h.name, signed: signed.has(h.id) })}
                  >
                    <span className={signed.has(h.id) ? '' : 'opacity-35'}>
                      <Avatar name={h.name} color={h.color} size={26} />
                    </span>
                    {signed.has(h.id) && (
                      <span className="absolute -right-0.5 -bottom-0.5 flex size-3.5 items-center justify-center rounded-full bg-ok text-white ring-2 ring-bg">
                        <Check size={9} strokeWidth={3.5} />
                      </span>
                    )}
                  </span>
                ))}
              </span>
              <span className={cx('truncate text-[13px]', isFinal ? 'font-medium text-ok' : 'text-fg-3')}>
                {isFinal ? t('doc.allFinal') : t('doc.signCount', { signed: signed.size, total: humans.length })}
              </span>
            </div>
            {isFinal ? (
              <Button
                variant="secondary"
                disabled={!me?.agentKind}
                onClick={async () => {
                  const ok = await sendMessage(
                    channel.id,
                    t('doc.applyInstruction', { title: doc.title, version: v.version, id: doc.id }),
                    'private',
                  )
                  if (ok) toast(t('doc.applyRequested'))
                }}
              >
                {t('doc.applyRequest')}
              </Button>
            ) : signed.has(me?.id ?? '') ? (
              <Button variant="secondary" disabled>
                <Check size={15} />
                {t('doc.signed')}
              </Button>
            ) : (
              <Button onClick={() => guard(api.finalize(doc.id, v.version))}>{t('doc.finalize')}</Button>
            )}
          </div>
        )}
      </div>
    </>
  )
}

function Diff({ before, after }: { before: string; after: string }) {
  const parts = useMemo(() => diffWords(before, after), [before, after])
  return (
    <div className="selectable text-[14.5px] leading-[1.8] whitespace-pre-wrap">
      {parts.map((p, i) => (
        <span key={i} className={p.added ? 'diff-add' : p.removed ? 'diff-del' : undefined}>
          {p.value}
        </span>
      ))}
    </div>
  )
}
