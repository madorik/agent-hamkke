import { useEffect, useLayoutEffect, useRef, useState, type MutableRefObject, type ReactNode } from 'react'
import { ArrowUp, Check, ChevronDown, FileText, Loader, Lock, Paperclip, Plus } from 'lucide-react'
import { t } from '../lib/i18n'
import { isPinnedModel, modelName, modelNote } from '../lib/store'
import { Avatar, MenuItem, Popover, cx, useAutosize } from './ui'

export type Visibility = 'channel' | 'private'

/** @ 로 부를 수 있는 사람 */
export interface Mentionable {
  id: string
  name: string
  color: string
  awaySince?: number | null
}

export function Composer({
  onSend,
  placeholder,
  allowAgent,
  agentOnline,
  onNewDoc,
  onFiles,
  visibilityRef,
  model,
  mentionables,
  extra,
  autoFocus,
}: {
  onSend: (text: string, visibility: Visibility) => Promise<boolean | void>
  placeholder: string
  allowAgent?: boolean
  agentOnline?: boolean
  onNewDoc?: () => void
  /** 파일을 고르거나 붙여넣으면 바로 올린다 */
  onFiles?: (files: File[], visibility: Visibility) => Promise<void>
  /** 채널에 끌어다 놓은 파일도 지금 고른 대상(채널/내 에이전트)으로 올리려고 바깥에 알려 준다 */
  visibilityRef?: MutableRefObject<Visibility>
  /** 내 에이전트가 쓸 모델 고르기(연결된 에이전트가 알려 준 목록) */
  model?: { models: AgentModel[]; value: string; onChange: (value: string) => void }
  /** @ 를 치면 고를 수 있는 채널 참여자. 부르면 그 사람의 에이전트가 요청으로 받아 처리한다 */
  mentionables?: Mentionable[]
  /** 아래 줄에 더 붙일 것(자동 승인 표시 등) */
  extra?: ReactNode
  autoFocus?: boolean
}) {
  const [text, setText] = useState('')
  const [toAgent, setToAgent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(0)
  const [menu, setMenu] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)
  const picker = useRef<HTMLInputElement>(null)
  // 커서 바로 앞이 '@글자' 면 사람 고르기 목록을 띄운다
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null)
  const [sel, setSel] = useState(0)
  const matches =
    mention && mentionables && !toAgent
      ? mentionables.filter((x) => x.name.toLowerCase().includes(mention.query.toLowerCase())).slice(0, 6)
      : []
  const findMention = (value: string, caret: number) => {
    const m = /(^|\s)@([^\s@]{0,30})$/.exec(value.slice(0, caret))
    setMention(m ? { start: caret - m[2].length - 1, query: m[2] } : null)
    setSel(0)
  }
  const pickMention = (x: Mentionable) => {
    if (!mention) return
    const end = mention.start + 1 + mention.query.length
    const insert = `@${x.name} `
    setText(text.slice(0, mention.start) + insert + text.slice(end))
    setMention(null)
    caretAfter.current = mention.start + insert.length
  }
  // 고른 이름 바로 뒤로 커서를 옮긴다. 새 글이 화면에 들어가는 그 순간에 맞춰야
  // 빨리 이어 친 글자가 커서 이동보다 먼저 들어가 순서가 섞이지 않는다.
  const caretAfter = useRef<number | null>(null)
  useLayoutEffect(() => {
    if (caretAfter.current === null || !ref.current) return
    ref.current.focus()
    ref.current.setSelectionRange(caretAfter.current, caretAfter.current)
    caretAfter.current = null
  }, [text])
  useAutosize(ref, text)
  useEffect(() => {
    if (autoFocus) ref.current?.focus()
  }, [autoFocus])
  useEffect(() => {
    if (visibilityRef) visibilityRef.current = toAgent ? 'private' : 'channel'
  }, [toAgent, visibilityRef])

  const upload = async (files: File[]) => {
    if (!onFiles || !files.length) return
    setUploading((n) => n + files.length)
    await onFiles(files, toAgent ? 'private' : 'channel')
    setUploading((n) => n - files.length)
    ref.current?.focus()
  }

  const submit = async () => {
    const t = text.trim()
    if (!t || busy) return
    setBusy(true)
    const ok = await onSend(t, toAgent ? 'private' : 'channel')
    setBusy(false)
    if (ok !== false) setText('')
    ref.current?.focus()
  }

  return (
    <div
      className={cx(
        'relative rounded-[28px] border bg-composer px-2.5 pt-2.5 pb-2 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_6px_24px_rgba(0,0,0,0.05)] transition-colors',
        toAgent ? 'border-blue/40' : 'border-line focus-within:border-line-2',
      )}
    >
      {matches.length > 0 && (
        <div
          role="listbox"
          aria-label={t('mention.list')}
          className="pop-in absolute bottom-full left-3 z-40 mb-2 w-[260px] rounded-2xl border border-line bg-menu p-1.5 shadow-[0_8px_30px_rgba(0,0,0,0.12)]"
        >
          {matches.map((x, i) => (
            <button
              key={x.id}
              type="button"
              role="option"
              aria-selected={i === sel}
              onMouseEnter={() => setSel(i)}
              onMouseDown={(e) => (e.preventDefault(), pickMention(x))}
              className={cx('flex w-full items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-left text-[14px]', i === sel && 'bg-hover')}
            >
              <Avatar name={x.name} color={x.color} size={22} />
              <span className="min-w-0 flex-1 truncate">{x.name}</span>
              {/* 자리 비운 사람: 그 사람의 에이전트가 받거나 결정함에 남는다 */}
              {x.awaySince && <span className="shrink-0 text-[12px] text-amber">{t('away.title')}</span>}
            </button>
          ))}
        </div>
      )}
      <textarea
        ref={ref}
        rows={1}
        value={text}
        placeholder={toAgent ? t('composer.privatePlaceholder') : placeholder}
        onChange={(e) => {
          setText(e.target.value)
          if (mentionables) findMention(e.target.value, e.target.selectionStart)
        }}
        onBlur={() => setMention(null)}
        onPaste={(e) => {
          const files = Array.from(e.clipboardData.files)
          if (!onFiles || !files.length) return
          e.preventDefault()
          void upload(files)
        }}
        onKeyDown={(e) => {
          if (matches.length > 0 && !e.nativeEvent.isComposing) {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault()
              setSel((s) => (s + (e.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length)
              return
            }
            if (e.key === 'Enter' || e.key === 'Tab') {
              e.preventDefault()
              pickMention(matches[sel] ?? matches[0])
              return
            }
            if (e.key === 'Escape') {
              e.preventDefault()
              setMention(null)
              return
            }
          }
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            void submit()
          }
        }}
        className="selectable block max-h-[220px] min-h-6 w-full resize-none bg-transparent px-2.5 py-1 text-[15px] leading-6 outline-none placeholder:text-fg-3"
      />
      <div className="mt-1.5 flex items-center gap-1">
        {(onNewDoc || onFiles) && (
          <div className="relative">
            <button
              type="button"
              title={t('composer.add')}
              aria-label={t('composer.addAria')}
              aria-expanded={menu}
              onClick={() => (onFiles ? setMenu((v) => !v) : onNewDoc?.())}
              className="inline-flex size-9 items-center justify-center rounded-full text-fg-2 hover:bg-hover hover:text-fg"
            >
              <Plus size={19} />
            </button>
            <Popover open={menu} onClose={() => setMenu(false)} className="bottom-11 left-0 w-[220px]">
              {onFiles && (
                <MenuItem icon={<Paperclip size={16} />} onClick={() => (setMenu(false), picker.current?.click())}>
                  {t('composer.uploadFile')}
                </MenuItem>
              )}
              {onNewDoc && (
                <MenuItem icon={<FileText size={16} />} onClick={() => (setMenu(false), onNewDoc())}>
                  {t('doc.new')}
                </MenuItem>
              )}
            </Popover>
            <input
              ref={picker}
              type="file"
              multiple
              hidden
              onChange={(e) => {
                const files = Array.from(e.target.files ?? [])
                e.target.value = ''
                void upload(files)
              }}
            />
          </div>
        )}
        {allowAgent && (
          <button
            type="button"
            onClick={() => setToAgent((v) => !v)}
            aria-pressed={toAgent}
            className={cx(
              'inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-[13.5px] transition-colors',
              toAgent ? 'border-transparent bg-blue-bg text-blue' : 'border-line text-fg-2 hover:bg-hover',
            )}
          >
            <Lock size={14} strokeWidth={2.2} />
            {t('composer.toMyAgent')}
            <span className={cx('size-1.5 rounded-full', agentOnline ? 'bg-ok' : 'bg-fg-3')} />
          </button>
        )}
        {allowAgent && model && model.models.length > 0 && <ModelChip {...model} />}
        {extra}
        {uploading > 0 && (
          <span className="ml-1.5 inline-flex items-center gap-1.5 text-[13px] text-fg-3" role="status">
            <Loader size={14} className="motion-safe:animate-spin" />
            {t('composer.uploading', { n: uploading })}
          </span>
        )}
        <div className="flex-1" />
        <button
          type="button"
          aria-label={t('common.send')}
          disabled={!text.trim() || busy}
          onClick={() => void submit()}
          className="inline-flex size-9 items-center justify-center rounded-full bg-accent text-accent-fg transition-[opacity,transform] active:scale-95 disabled:opacity-25"
        >
          <ArrowUp size={19} strokeWidth={2.4} />
        </button>
      </div>
    </div>
  )
}

// 내 에이전트의 모델을 고르는 곳(여기 한 곳). 연결된 에이전트가 알려 준 목록에서 별칭을 먼저, 버전 고정 모델은 접어 둔다.
function ModelChip({ models, value, onChange }: { models: AgentModel[]; value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false)
  const pinned = models.filter(isPinnedModel)
  const [more, setMore] = useState(() => pinned.some((m) => m.value === value))
  const current = models.find((m) => m.value === value) ?? models.find((m) => m.value === 'default')
  // 칩엔 실제 모델 이름만 짧게 (기본이면 그게 무엇인지)
  const short = current
    ? current.value === 'default'
      ? (models.find((m) => m.value !== 'default' && m.resolved === current.resolved)?.label ?? t('model.defaultShort'))
      : current.label
    : t('model.label')
  const row = (m: AgentModel) => (
    <button
      key={m.value}
      type="button"
      role="menuitemradio"
      aria-checked={m.value === value}
      onClick={() => {
        setOpen(false)
        if (m.value !== value) onChange(m.value)
      }}
      className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left hover:bg-hover"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-[14px]">{modelName(m, models)}</span>
        <span className="block truncate text-[12px] text-fg-3">{modelNote(m)}</span>
      </span>
      <Check size={16} className={m.value === value ? 'shrink-0 text-fg' : 'invisible shrink-0'} />
    </button>
  )
  return (
    <div className="relative">
      <button
        type="button"
        aria-label={t('model.aria', { name: short })}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-9 items-center gap-1 rounded-full px-2.5 text-[13.5px] text-fg-2 hover:bg-hover hover:text-fg"
      >
        {short}
        <ChevronDown size={14} className="text-fg-3" />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} className="bottom-11 left-0 max-h-[min(520px,70vh)] w-[290px] overflow-y-auto">
        <div className="px-2.5 pt-1.5 pb-1 text-[12.5px] text-fg-3">{t('model.header')}</div>
        <div role="menu" aria-label={t('model.menu')}>
          {models.filter((m) => !isPinnedModel(m)).map(row)}
          {pinned.length > 0 && (
            <>
              <div className="my-1 h-px bg-line" />
              <button
                type="button"
                aria-expanded={more}
                onClick={() => setMore((v) => !v)}
                className="flex w-full items-center gap-1.5 rounded-xl px-2.5 py-2 text-[13px] text-fg-3 hover:bg-hover"
              >
                <ChevronDown size={14} className={cx('transition-transform', more && 'rotate-180')} />
                {t('model.pinned', { n: pinned.length })}
              </button>
              {more && pinned.map(row)}
            </>
          )}
        </div>
      </Popover>
    </div>
  )
}
