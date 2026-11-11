import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Bot, Check, X } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { AgentKind } from '@ah/protocol'
import { intlLocale, t } from '../lib/i18n'

export const agentLabel = (k: AgentKind): string => (k === 'claude-code' ? 'Claude Code' : k === 'codex' ? 'Codex' : t('agent.builtin'))

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ')
}

export function Avatar({ name, color, size = 28 }: { name: string; color: string; size?: number }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{ width: size, height: size, background: color, fontSize: size * 0.42 }}
    >
      {name.slice(0, 1)}
    </span>
  )
}

export function AgentAvatar({ color, size = 28, online }: { color: string; size?: number; online?: boolean }) {
  return (
    <span className="relative inline-flex shrink-0">
      <span
        className="inline-flex items-center justify-center rounded-[9px] border border-line"
        style={{ width: size, height: size, color, background: `color-mix(in srgb, ${color} 12%, var(--bg))` }}
      >
        <Bot size={size * 0.58} strokeWidth={1.9} />
      </span>
      {online !== undefined && (
        <span className={cx('absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full border-2 border-bg', online ? 'bg-ok' : 'bg-fg-3')} />
      )}
    </span>
  )
}

export function IconButton({
  label,
  onClick,
  children,
  active,
  className,
}: {
  label: string
  onClick?: () => void
  children: ReactNode
  active?: boolean
  className?: string
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cx(
        'inline-flex size-9 items-center justify-center rounded-lg text-fg-2 transition-colors hover:bg-hover hover:text-fg',
        active && 'bg-hover text-fg',
        className,
      )}
    >
      {children}
    </button>
  )
}

export function Button({
  children,
  onClick,
  variant = 'primary',
  disabled,
  className,
  type = 'button',
}: {
  children: ReactNode
  onClick?: () => void
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  disabled?: boolean
  className?: string
  type?: 'button' | 'submit'
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cx(
        'inline-flex h-9 items-center justify-center gap-1.5 rounded-full px-4 text-[14px] font-medium transition-[background,opacity,transform] active:scale-[0.97] disabled:opacity-40 disabled:active:scale-100',
        variant === 'primary' && 'bg-accent text-accent-fg hover:opacity-85',
        variant === 'secondary' && 'border border-line-2 bg-bg text-fg hover:bg-hover',
        variant === 'ghost' && 'text-fg-2 hover:bg-hover hover:text-fg',
        variant === 'danger' && 'text-danger hover:bg-hover',
        className,
      )}
    >
      {children}
    </button>
  )
}

/** 앱 로고: 선 삼태극(apps/desktop/build/icon.svg 와 같은 그림, 바깥 여백만 뺐다). 주황과 흰색만 쓴다. */
export function AppMark({ size = 48 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="100 100 824 824" aria-hidden="true" className="block">
      <rect x="100" y="100" width="824" height="824" rx="185" fill="#F26419" />
      <g fill="none" stroke="#FFFFFF" strokeWidth="30" strokeLinecap="round">
        <circle cx="512" cy="512" r="250" />
        <path d="M 512 512 A 125 125 0 0 0 512 262" />
        <path d="M 512 512 A 125 125 0 0 0 728.5 637" />
        <path d="M 512 512 A 125 125 0 0 0 295.5 637" />
      </g>
    </svg>
  )
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={cx('relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors', on ? 'bg-ok' : 'bg-line-2')}
    >
      <span
        className={cx('absolute top-[3px] left-[3px] size-4 rounded-full bg-white shadow transition-transform', on && 'translate-x-4')}
      />
    </button>
  )
}

// 바깥을 누르거나 Esc 를 누르면 닫히는 팝오버
export function Popover({
  open,
  onClose,
  children,
  className,
}: {
  open: boolean
  onClose: () => void
  children: ReactNode
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const down = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    setTimeout(() => document.addEventListener('mousedown', down))
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('mousedown', down)
      document.removeEventListener('keydown', key)
    }
  }, [open, onClose])
  if (!open) return null
  return (
    <div
      ref={ref}
      className={cx('pop-in absolute z-40 rounded-2xl border border-line bg-menu p-1.5 shadow-[0_8px_30px_rgba(0,0,0,0.12)]', className)}
    >
      {children}
    </div>
  )
}

export function MenuItem({
  children,
  onClick,
  checked,
  icon,
  right,
}: {
  children: ReactNode
  onClick?: () => void
  checked?: boolean
  icon?: ReactNode
  right?: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-[14px] hover:bg-hover"
    >
      {icon && <span className="text-fg-2">{icon}</span>}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {right}
      {checked !== undefined && <Check size={16} className={checked ? 'text-fg' : 'invisible'} />}
    </button>
  )
}

export function Modal({
  open,
  onClose,
  children,
  width = 440,
}: {
  open: boolean
  onClose: () => void
  children: ReactNode
  width?: number
}) {
  useEffect(() => {
    if (!open) return
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fade-in fixed inset-0 z-50 flex items-center justify-center bg-[var(--scrim)] p-6" onMouseDown={onClose}>
      <div
        className="pop-in max-h-full w-full overflow-hidden rounded-[20px] border border-line bg-bg shadow-2xl"
        style={{ maxWidth: width, transformOrigin: 'center' }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )
}

export function ModalHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="flex items-center justify-between px-5 pt-4 pb-2">
      <h2 className="text-[17px] font-semibold">{title}</h2>
      <IconButton label={t('common.close')} onClick={onClose}>
        <X size={18} />
      </IconButton>
    </div>
  )
}

/** 본문에서 강조할 @이름(나를 부른 건 따로) */
export type MentionMark = { name: string; me: boolean }

export const mentionClass = (me: boolean) =>
  cx('rounded px-0.5 font-medium', me ? 'bg-amber-bg text-amber' : 'bg-blue-bg text-blue')

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** 긴 이름부터 맞춰 '@Jamie' 가 '@Jamie Park' 를 가로채지 않게 한다 */
export function mentionPattern(marks: MentionMark[]): RegExp | null {
  if (!marks.length) return null
  const names = [...marks].sort((a, b) => b.name.length - a.name.length).map((x) => '@' + escapeRe(x.name))
  return new RegExp('(' + names.join('|') + ')', 'g')
}

export function MentionText({ text, marks }: { text: string; marks: MentionMark[] }) {
  const re = mentionPattern(marks)
  if (!re) return <>{text}</>
  return (
    <>
      {text.split(re).map((part, i) => {
        const hit = marks.find((x) => '@' + x.name === part)
        return hit ? (
          <span key={i} className={mentionClass(hit.me)}>
            {part}
          </span>
        ) : (
          part
        )
      })}
    </>
  )
}

// 마크다운에선 @이름 을 '#mention' 링크로 바꿔 그리고, 링크 자리에 강조를 그린다
function withMentionLinks(text: string, marks: MentionMark[]): string {
  const re = mentionPattern(marks)
  if (!re) return text
  return text.replace(re, (tag) => {
    const me = marks.find((x) => '@' + x.name === tag)?.me
    return `[${tag.replace(/[[\]]/g, '\\$&')}](#mention${me ? '-me' : ''})`
  })
}

const markdownParts = {
  a: ({ href, children, node: _node, ...rest }: React.ComponentProps<'a'> & { node?: unknown }) =>
    href === '#mention' || href === '#mention-me' ? (
      <span className={mentionClass(href === '#mention-me')}>{children}</span>
    ) : (
      <a href={href} {...rest}>
        {children}
      </a>
    ),
}

export function Markdown({ text, mentions }: { text: string; mentions?: MentionMark[] }) {
  return (
    <div className="md selectable break-words">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={mentions?.length ? markdownParts : undefined}>
        {mentions?.length ? withMentionLinks(text, mentions) : text}
      </ReactMarkdown>
    </div>
  )
}

export function timeLabel(t: number) {
  const d = new Date(t)
  const today = new Date()
  const sameDay = d.toDateString() === today.toDateString()
  const loc = intlLocale()
  return sameDay
    ? d.toLocaleTimeString(loc, { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString(loc, { month: loc === 'ko-KR' ? 'numeric' : 'short', day: 'numeric' }) +
        ' ' +
        d.toLocaleTimeString(loc, { hour: 'numeric', minute: '2-digit' })
}

export function useAutosize(ref: React.RefObject<HTMLTextAreaElement | null>, value: string, max = 220) {
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(max, el.scrollHeight) + 'px'
  }, [ref, value, max])
}

export function useCopy(): [boolean, (text: string) => void] {
  const [copied, setCopied] = useState(false)
  return [
    copied,
    (text: string) => {
      void navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
    },
  ]
}
