import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ChevronDown, FileText, Lock, Minus, Paperclip, Pencil, Plus, UserPlus, Zap } from 'lucide-react'
import type { Channel, Stage } from '@ah/protocol'
import { stageLabel, t } from '../lib/i18n'
import { api, guard, sendMessage, setAgentModel, setAutoApprove, setCanvas, setModal, uploadFiles, useStore } from '../lib/store'
import { ApprovalDock } from './ApprovalDock'
import { Canvas } from './Canvas'
import { Composer, type Visibility } from './Composer'
import { MessageRow } from './Message'
import { TopBar } from './TopBar'
import { AgentAvatar, Avatar, Button, IconButton, MenuItem, Popover, Toggle, agentLabel, cx } from './ui'

const STAGES: Stage[] = ['request', 'draft', 'review', 'final']

export function ChannelView({ id }: { id: string }) {
  const channel = useStore((s) => s.channels[id])
  const messages = useStore((s) => s.messages[id])
  const canvas = useStore((s) => s.canvas)
  const me = useStore((s) => s.me)
  const agentStatus = useStore((s) => s.agentStatus)
  const docCount = useStore((s) => Object.values(s.artifacts).filter((a) => a.channelId === id).length)
  const scroller = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)
  const visibility = useRef<Visibility>('channel')
  const [dragging, setDragging] = useState(false)
  const dragDepth = useRef(0)
  const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes('Files')

  // 새 메시지가 오면 바닥에 있을 때만 따라 내려간다
  useLayoutEffect(() => {
    const el = scroller.current
    if (el && atBottom.current) el.scrollTop = el.scrollHeight
  }, [messages, id])
  useEffect(() => {
    atBottom.current = true
  }, [id])
  // 캔버스를 열어 폭이 줄면 글이 길어진다. 바닥에 있었다면 계속 바닥에 붙여 둔다.
  const content = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = scroller.current
    if (!el || !content.current) return
    const ro = new ResizeObserver(() => {
      if (atBottom.current) el.scrollTop = el.scrollHeight
    })
    ro.observe(content.current)
    ro.observe(el)
    return () => ro.disconnect()
  }, [id])
  useEffect(() => {
    if (!messages?.length || !document.hasFocus()) return
    const t = setTimeout(() => void guard(api.markRead(id)), 600)
    return () => clearTimeout(t)
  }, [messages?.length, id])

  if (!channel) return null
  const myMember = channel.members.find((m) => m.id === me?.id)
  const onFiles = (files: File[], v: Visibility) => {
    atBottom.current = true
    return uploadFiles(id, files, v)
  }

  return (
    <div className="flex h-full min-w-0 flex-1">
      <div
        className="relative flex min-w-0 flex-1 flex-col"
        onDragEnter={(e) => {
          if (!hasFiles(e)) return
          dragDepth.current++
          setDragging(true)
        }}
        onDragOver={(e) => {
          if (!hasFiles(e)) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
        }}
        onDragLeave={(e) => {
          if (!hasFiles(e)) return
          if (--dragDepth.current <= 0) (dragDepth.current = 0), setDragging(false)
        }}
        onDrop={(e) => {
          if (!hasFiles(e)) return
          e.preventDefault()
          dragDepth.current = 0
          setDragging(false)
          void onFiles(Array.from(e.dataTransfer.files), visibility.current)
        }}
      >
        {dragging && <DropOverlay toAgent={visibility.current === 'private'} />}
        <TopBar
          flush={!!canvas}
          left={<ChannelMenu channel={channel} />}
          right={
            <>
              <Members channel={channel} />
              <Button variant="ghost" className="h-9 gap-1.5 rounded-lg px-2.5" onClick={() => setModal({ kind: 'invite', channelId: id })}>
                <UserPlus size={17} />
                {t('channel.invite')}
              </Button>
              <IconButton label={t('channel.docs')} active={!!canvas} onClick={() => setCanvas(canvas ? null : { mode: 'list' })}>
                <span className="relative">
                  <FileText size={18} />
                  {docCount > 0 && (
                    <span className="absolute -top-1.5 -right-2 min-w-4 rounded-full bg-accent px-1 text-center text-[10px] leading-4 font-semibold text-accent-fg">
                      {docCount}
                    </span>
                  )}
                </span>
              </IconButton>
            </>
          }
        />
        <div
          ref={scroller}
          onScroll={(e) => {
            const el = e.currentTarget
            atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
          }}
          className="min-h-0 flex-1 overflow-y-auto"
        >
          <div ref={content} className="mx-auto w-full max-w-[46rem] px-6 pt-2 pb-8">
            {messages && messages.length === 0 && <EmptyChannel channel={channel} />}
            {messages?.map((m, i) => (
              <MessageRow key={m.id} m={m} prev={messages[i - 1]} />
            ))}
            <AgentActivityRow channelId={id} />
          </div>
        </div>
        <div className="mx-auto w-full max-w-[46rem] px-6 pb-5">
          <ApprovalDock channelId={id} />
          <Composer
            key={id}
            autoFocus
            placeholder={t('channel.placeholder')}
            mentionables={channel.members.filter((m) => m.id !== me?.id)}
            extra={
              me?.autoApprove && (
                <button
                  type="button"
                  title={t('auto.chipHint')}
                  onClick={() => void setAutoApprove(false)}
                  className="inline-flex h-9 items-center gap-1 rounded-full bg-amber-bg px-3 text-[13px] font-medium text-amber hover:opacity-80"
                >
                  <Zap size={13} />
                  {t('auto.chip')}
                </button>
              )
            }
            allowAgent={!!me?.agentKind && myMember?.agentEnabled}
            agentOnline={me?.agentOnline}
            onNewDoc={() => setCanvas({ mode: 'new' })}
            onFiles={onFiles}
            visibilityRef={visibility}
            model={
              agentStatus?.configured && agentStatus.agentKind === me?.agentKind
                ? {
                    models: agentStatus.models,
                    value: agentStatus.model,
                    onChange: (v) => void setAgentModel(v),
                  }
                : undefined
            }
            onSend={(text, visibility) => {
              atBottom.current = true
              return sendMessage(id, text, visibility)
            }}
          />
        </div>
      </div>
      {canvas && <Canvas channel={channel} />}
    </div>
  )
}

function DropOverlay({ toAgent }: { toAgent: boolean }) {
  return (
    <div className="pointer-events-none absolute inset-3 z-30 flex items-center justify-center rounded-3xl border-2 border-dashed border-blue/50 bg-bg/85">
      <div className="flex flex-col items-center gap-2 text-center">
        <Paperclip size={26} className="text-blue" />
        <div className="text-[16px] font-medium">{t('channel.dropTitle')}</div>
        <div className="flex items-center gap-1 text-[13.5px] text-fg-2">
          {toAgent ? (
            <>
              <Lock size={13} />
              {t('channel.dropPrivate')}
            </>
          ) : (
            t('channel.dropPublic')
          )}
        </div>
      </div>
    </div>
  )
}

// 내 에이전트가 이 채널 일로 지금 무엇을 하는지. 허락을 기다리면 그 자리에서 허용·거부한다.
function AgentActivityRow({ channelId }: { channelId: string }) {
  const a = useStore((s) => s.activity[channelId])
  const me = useStore((s) => s.me)
  const perm = useStore((s) => (a?.permissionId ? s.permissions.find((p) => p.id === a.permissionId) : undefined))
  if (!a || !me) return null
  const waiting = a.state === 'waiting' && !!perm
  return (
    <div className="mt-6" role="status" aria-live="polite">
      <div className="mb-1.5 flex items-center gap-2">
        <AgentAvatar color={me.color} size={26} online />
        <span className="text-[14px] font-semibold">{t('common.myAgent')}</span>
        <span
          className={cx(
            'rounded-md px-1.5 text-[11.5px] leading-[18px] font-medium',
            waiting ? 'bg-amber-bg text-amber' : 'bg-blue-bg text-blue',
          )}
        >
          {waiting ? t('channel.needsPermission') : t('channel.working')}
        </span>
      </div>
      <div className="pl-[34px]">
        {waiting ? (
          // 허용·거부는 입력창 위 승인 영역에서
          <p className="text-[14px] text-fg-2">
            {a.detail} · <span className="text-fg-3">{t('channel.waitingHint')}</span>
          </p>
        ) : (
          <div className="flex items-center gap-2.5 text-[14px] text-fg-2">
            <span className="inline-flex gap-1" aria-hidden>
              {[0, 180, 360].map((d) => (
                <span key={d} className="size-1.5 rounded-full bg-fg-3 motion-safe:animate-pulse" style={{ animationDelay: `${d}ms` }} />
              ))}
            </span>
            <span>{a.detail || t('channel.thinking')}</span>
          </div>
        )}
      </div>
    </div>
  )
}

function EmptyChannel({ channel }: { channel: Channel }) {
  return (
    <div className="flex flex-col items-center pt-[18vh] text-center">
      <div className="mb-4 flex -space-x-2">
        {channel.members.map((m) => (
          <span key={m.id} className="rounded-full ring-4 ring-bg">
            <Avatar name={m.name} color={m.color} size={40} />
          </span>
        ))}
      </div>
      <h2 className="text-[22px] font-semibold">{channel.title}</h2>
      {channel.members.length < 2 && (
        <Button variant="secondary" className="mt-5" onClick={() => setModal({ kind: 'invite', channelId: channel.id })}>
          <UserPlus size={16} />
          {t('channel.invitePeople')}
        </Button>
      )}
    </div>
  )
}

function ChannelMenu({ channel }: { channel: Channel }) {
  const [open, setOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [title, setTitle] = useState(channel.title)
  const me = useStore((s) => s.me)
  const myMember = channel.members.find((m) => m.id === me?.id)
  const patch = (p: Parameters<typeof api.patchChannel>[1]) => guard(api.patchChannel(channel.id, p))

  return (
    <div className="relative min-w-0">
      {renaming ? (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (title.trim()) void patch({ title: title.trim() })
            setRenaming(false)
          }}
        >
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => setRenaming(false)}
            className="h-9 w-[320px] rounded-lg border border-line-2 bg-bg px-2.5 text-[16px] outline-none"
          />
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex h-9 max-w-full items-center gap-1.5 rounded-lg px-2.5 hover:bg-hover"
        >
          <span className="truncate text-[17px] font-medium">{channel.title}</span>
          <span className="shrink-0 text-[15px] text-fg-3">{stageLabel(channel.stage)}</span>
          <ChevronDown size={16} className="shrink-0 text-fg-3" />
        </button>
      )}
      <Popover open={open} onClose={() => setOpen(false)} className="top-11 left-0 w-[300px]">
        <div className="px-2.5 pt-1.5 pb-1 text-[12.5px] text-fg-3">{t('channel.stage')}</div>
        {STAGES.map((s) => (
          <MenuItem key={s} checked={channel.stage === s} onClick={() => (patch({ stage: s }), setOpen(false))}>
            {stageLabel(s)}
          </MenuItem>
        ))}
        <div className="my-1.5 h-px bg-line" />
        <Row label={t('channel.requireApproval')}>
          <Toggle label={t('channel.requireApprovalToggle')} on={channel.requireApproval} onChange={(v) => patch({ requireApproval: v })} />
        </Row>
        <Row label={t('channel.turnLimit')}>
          <div className="flex items-center gap-0.5">
            <IconButton label={t('channel.decrease')} className="size-7" onClick={() => patch({ turnLimit: channel.turnLimit - 1 })}>
              <Minus size={14} />
            </IconButton>
            <span className="w-6 text-center text-[14px] tabular-nums">{channel.turnLimit}</span>
            <IconButton label={t('channel.increase')} className="size-7" onClick={() => patch({ turnLimit: channel.turnLimit + 1 })}>
              <Plus size={14} />
            </IconButton>
          </div>
        </Row>
        <Row label={t('channel.myAgentJoins')}>
          <Toggle
            label={t('channel.myAgentJoins')}
            on={!!myMember?.agentEnabled}
            onChange={(v) => guard(api.patchMembership(channel.id, { agentEnabled: v }))}
          />
        </Row>
        <div className="my-1.5 h-px bg-line" />
        <MenuItem icon={<Pencil size={15} />} onClick={() => (setOpen(false), setTitle(channel.title), setRenaming(true))}>
          {t('channel.rename')}
        </MenuItem>
      </Popover>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-10 items-center justify-between gap-3 px-2.5 text-[14px]">
      <span>{label}</span>
      {children}
    </div>
  )
}

function Members({ channel }: { channel: Channel }) {
  const [open, setOpen] = useState(false)
  const me = useStore((s) => s.me)
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex h-9 items-center rounded-lg px-1.5 hover:bg-hover">
        <span className="flex -space-x-1.5">
          {channel.members.slice(0, 4).map((m) => (
            <span key={m.id} className="rounded-full ring-2 ring-bg">
              <Avatar name={m.name} color={m.color} size={24} />
            </span>
          ))}
        </span>
      </button>
      <Popover open={open} onClose={() => setOpen(false)} className="top-11 right-0 w-[280px]">
        {channel.members.map((m) => (
          <div key={m.id} className="rounded-xl px-2.5 py-2">
            <div className="flex items-center gap-2.5">
              <Avatar name={m.name} color={m.color} size={28} />
              <span className="flex-1 truncate text-[14px] font-medium">
                {m.name}
                {m.id === me?.id && <span className="font-normal text-fg-3">{t('channel.you')}</span>}
              </span>
            </div>
            <div className="mt-1.5 flex items-center gap-2.5 pl-[2px]">
              <AgentAvatar color={m.color} size={24} online={m.agentKind ? m.agentOnline && m.agentEnabled : undefined} />
              <span className={cx('text-[13px]', m.agentKind && m.agentEnabled ? 'text-fg-2' : 'text-fg-3')}>
                {!m.agentKind
                  ? t('common.noAgent')
                  : !m.agentEnabled
                    ? t('channel.agentOff', { agent: agentLabel(m.agentKind) })
                    : t('channel.agentState', { agent: agentLabel(m.agentKind), online: m.agentOnline })}
              </span>
            </div>
          </div>
        ))}
      </Popover>
    </div>
  )
}
