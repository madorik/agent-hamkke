import { create } from 'zustand'
import type { AgentActivity, Artifact, Channel, Message, PermissionRequest, ServerEvent, User } from '@ah/protocol'
import { ApiError, createApi } from './api'
import { applyLocale, getLocale, t } from './i18n'

export type View = { kind: 'home' } | { kind: 'channel'; id: string } | { kind: 'approvals' }
export type Modal =
  | null
  | { kind: 'settings'; tab: 'general' | 'agents' | 'account' }
  | { kind: 'invite'; channelId: string }
  | { kind: 'search' }
  | { kind: 'join' }
export type Canvas = null | { mode: 'list' } | { mode: 'new' } | { mode: 'view'; artifactId: string; version: number | null }
export type Theme = 'system' | 'light' | 'dark'

const LS = {
  get: (k: string) => {
    try {
      return localStorage.getItem('ah:' + k)
    } catch {
      return null
    }
  },
  set: (k: string, v: string | null) => {
    try {
      if (v === null) localStorage.removeItem('ah:' + k)
      else localStorage.setItem('ah:' + k, v)
    } catch {
      /* 저장소를 못 쓰면 이번 실행에서만 기억 */
    }
  },
}

interface State {
  relayUrl: string
  token: string | null
  me: User | null
  online: boolean
  booted: boolean
  channels: Record<string, Channel>
  messages: Record<string, Message[]>
  artifacts: Record<string, Artifact>
  drafts: Message[]
  permissions: PermissionRequest[]
  /** 내 에이전트가 채널별로 지금 하는 일(작업 중·허락 대기) */
  activity: Record<string, AgentActivity>
  /** 이 PC 에 연결된 에이전트(러너) 상태와 고를 수 있는 모델 — 데스크톱 앱에서만 */
  agentStatus: ConnectorStatus | null
  view: View
  modal: Modal
  canvas: Canvas
  sidebarOpen: boolean
  theme: Theme
  toast: string | null
}

export const useStore = create<State>(() => ({
  relayUrl: LS.get('relay') ?? 'http://localhost:8787',
  token: LS.get('token'),
  me: null,
  online: false,
  booted: false,
  channels: {},
  messages: {},
  artifacts: {},
  drafts: [],
  permissions: [],
  activity: {},
  agentStatus: null,
  view: { kind: 'home' },
  modal: null,
  canvas: null,
  sidebarOpen: LS.get('sidebar') !== '0',
  theme: (LS.get('theme') as Theme) ?? 'system',
  toast: null,
}))

const set = useStore.setState
const get = useStore.getState

export const api = createApi(
  () => get().relayUrl,
  () => get().token,
)

// ── 공통 ────────────────────────────────────────────────────

let toastTimer: ReturnType<typeof setTimeout> | undefined
export function toast(text: string) {
  clearTimeout(toastTimer)
  set({ toast: text })
  toastTimer = setTimeout(() => set({ toast: null }), 2600)
}

export async function guard<T>(p: Promise<T>): Promise<T | undefined> {
  try {
    return await p
  } catch (e) {
    toast(e instanceof Error ? e.message : t('common.error'))
    if (e instanceof ApiError && e.status === 401) logout()
    return undefined
  }
}

export function channelList(): Channel[] {
  return Object.values(get().channels).sort((a, b) => b.updatedAt - a.updatedAt)
}

export function memberName(channelId: string, userId: string | null): string {
  if (!userId) return ''
  const me = get().me
  if (userId === me?.id) return me.name
  return get().channels[channelId]?.members.find((m) => m.id === userId)?.name ?? t('common.unknown')
}

export function member(channelId: string, userId: string | null) {
  if (!userId) return null
  return get().channels[channelId]?.members.find((m) => m.id === userId) ?? null
}

function badge() {
  const n = get().drafts.length + get().permissions.length
  window.am?.setBadge(n)
}

// ── 테마·레이아웃 ───────────────────────────────────────────

export function applyTheme(theme: Theme = get().theme) {
  const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', dark)
}
export function setTheme(theme: Theme) {
  LS.set('theme', theme)
  set({ theme })
  applyTheme(theme)
  window.am?.setTheme(theme)
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme())

export function toggleSidebar() {
  const open = !get().sidebarOpen
  LS.set('sidebar', open ? '1' : '0')
  set({ sidebarOpen: open })
}

// ── 세션 ────────────────────────────────────────────────────

export async function refreshAgentStatus() {
  const s = await window.am?.connectorStatus().catch(() => null)
  if (s) set({ agentStatus: s })
}

export async function setAgentModel(value: string) {
  const r = await window.am?.setAgentModel(value).catch(() => null)
  await refreshAgentStatus()
  if (!r?.ok) return toast(t('model.changeFailed'))
  const s = get().agentStatus
  const m = s?.models.find((x) => x.value === r.model)
  if (m && s) toast(t('model.changed', { name: modelName(m, s.models) }))
}

/** 'default' 는 실제로 어떤 모델인지 붙여 보여 준다 */
export function modelName(m: AgentModel, all: AgentModel[]): string {
  if (m.value !== 'default') return m.label
  const real = all.find((x) => x.value !== 'default' && x.resolved === m.resolved)
  return t('model.default', { name: real?.label ?? m.resolved })
}

const NOTED_MODELS = ['default', 'opus', 'fable', 'sonnet', 'haiku'] as const
// 버전 고정 모델은 설명이 영어로 와서, 대신 정확한 모델 id 를 보여 준다
export const modelNote = (m: AgentModel) =>
  (NOTED_MODELS as readonly string[]).includes(m.value)
    ? t(`model.note.${m.value as (typeof NOTED_MODELS)[number]}`)
    : isPinnedModel(m)
      ? m.resolved
      : m.description
/** 별칭(기본·Opus·Sonnet…)과 버전 고정 모델(claude-…)을 나눈다 */
export const isPinnedModel = (m: AgentModel) => m.value.startsWith('claude-')

let agentWatch = false

export async function boot() {
  if (!agentWatch && window.am) {
    agentWatch = true
    window.am.onConnectorChanged(() => void refreshAgentStatus())
  }
  void refreshAgentStatus()
  const info = await window.am?.info().catch(() => null)
  if (info && !LS.get('relay')) set({ relayUrl: info.relayUrl })
  applyTheme()
  applyLocale()
  if (!get().token) return set({ booted: true })
  const me = await api.me().catch((e) => (e instanceof ApiError && e.status === 401 ? null : undefined))
  if (me === null) {
    logout()
    return set({ booted: true })
  }
  if (me) set({ me: me.user })
  set({ booted: true })
  await refreshAll()
  connect()
}

export async function signup(name: string, relayUrl?: string) {
  if (relayUrl) {
    LS.set('relay', relayUrl)
    set({ relayUrl })
  }
  const r = await api.signup(name)
  LS.set('token', r.token)
  set({ token: r.token, me: r.user })
  await refreshAll()
  connect()
}

export function logout() {
  LS.set('token', null)
  ws?.close()
  ws = null
  set({
    token: null,
    me: null,
    channels: {},
    messages: {},
    artifacts: {},
    drafts: [],
    permissions: [],
    activity: {},
    view: { kind: 'home' },
    canvas: null,
  })
}

async function refreshAll() {
  const [channels, approvals] = await Promise.all([api.channels(), api.approvals()])
  set({
    channels: Object.fromEntries(channels.map((c) => [c.id, c])),
    drafts: approvals.messages,
    permissions: approvals.permissions,
  })
  badge()
  const v = get().view
  if (v.kind === 'channel') {
    if (!get().channels[v.id]) set({ view: { kind: 'home' } })
    else await loadChannel(v.id)
  }
}

// ── 실시간 ─────────────────────────────────────────────────

let ws: WebSocket | null = null
let retry = 0

function connect() {
  const token = get().token
  if (!token) return
  ws?.close()
  const sock = new WebSocket(get().relayUrl.replace(/^http/, 'ws') + '/ws?token=' + encodeURIComponent(token) + '&locale=' + getLocale())
  ws = sock
  sock.onmessage = (e) => onEvent(JSON.parse(String(e.data)) as ServerEvent)
  sock.onclose = () => {
    if (ws !== sock) return
    set({ online: false })
    const wait = Math.min(15_000, 800 * 2 ** retry++)
    setTimeout(() => {
      if (ws === sock && get().token) {
        connect()
      }
    }, wait)
  }
}

function sortMessages(list: Message[]) {
  return list.sort((a, b) => a.createdAt - b.createdAt)
}

function upsertMessage(m: Message) {
  const s = get()
  const list = s.messages[m.channelId]
  if (list) {
    const rest = list.filter((x) => x.id !== m.id)
    set({ messages: { ...s.messages, [m.channelId]: m.status === 'rejected' ? rest : sortMessages([...rest, m]) } })
  }
  const mine = m.authorKind === 'agent' && m.authorId === s.me?.id
  if (mine) {
    const drafts = s.drafts.filter((d) => d.id !== m.id)
    set({ drafts: m.status === 'pending' ? [...drafts, m] : drafts })
    badge()
  }
}

function onEvent(ev: ServerEvent) {
  const s = get()
  switch (ev.type) {
    case 'hello': {
      const wasOffline = !s.online && s.booted
      retry = 0
      // 중계 서버가 hello 바로 뒤에 지금 진행 중인 작업 상태를 다시 보내 준다
      set({ me: ev.me, online: true, activity: {} })
      if (wasOffline) void refreshAll()
      break
    }
    case 'message': {
      const m = ev.message
      const isNew = !s.messages[m.channelId]?.some((x) => x.id === m.id && x.status === m.status)
      upsertMessage(m)
      if (isNew) notifyMessage(m)
      break
    }
    case 'user':
      if (ev.user.id === s.me?.id) set({ me: ev.user })
      break
    case 'channel':
      set({ channels: { ...s.channels, [ev.channel.id]: ev.channel } })
      break
    case 'artifact':
      set({ artifacts: { ...s.artifacts, [ev.artifact.id]: ev.artifact } })
      break
    case 'artifact_removed': {
      const { [ev.artifactId]: _gone, ...rest } = s.artifacts
      const c = s.canvas
      set({ artifacts: rest, canvas: c?.mode === 'view' && c.artifactId === ev.artifactId ? { mode: 'list' } : c })
      break
    }
    case 'presence': {
      const channels = Object.fromEntries(
        Object.entries(s.channels).map(([id, c]) => [
          id,
          {
            ...c,
            members: c.members.map((m) => (m.id === ev.userId ? { ...m, agentOnline: ev.agentOnline, agentKind: ev.agentKind } : m)),
          },
        ]),
      )
      set({
        channels,
        me: s.me && s.me.id === ev.userId ? { ...s.me, agentOnline: ev.agentOnline, agentKind: ev.agentKind } : s.me,
      })
      break
    }
    case 'agent_activity': {
      const a = ev.activity
      if (a.userId !== s.me?.id) break
      const { [a.channelId]: _prev, ...rest } = s.activity
      set({ activity: a.state === 'idle' ? rest : { ...rest, [a.channelId]: a } })
      break
    }
    case 'permission': {
      const rest = s.permissions.filter((p) => p.id !== ev.request.id)
      set({ permissions: ev.request.status === 'pending' ? [...rest, ev.request] : rest })
      badge()
      if (ev.request.status === 'pending')
        notify(t('notify.permission'), `${ev.request.toolName} · ${ev.request.description}`, () =>
          set({ view: { kind: 'approvals' } }),
        )
      break
    }
  }
}

// ── 알림 ────────────────────────────────────────────────────

function notify(title: string, body: string, onClick: () => void) {
  if (document.hasFocus()) return
  try {
    const n = new Notification(title, { body: body.slice(0, 140), silent: false })
    n.onclick = () => {
      window.focus()
      onClick()
    }
  } catch {
    /* 알림 권한이 없으면 조용히 넘어간다 */
  }
}

function notifyMessage(m: Message) {
  const s = get()
  if (!s.me || m.kind === 'system' || m.status === 'rejected') return
  const c = s.channels[m.channelId]
  const open = () => openChannel(m.channelId)
  if (m.authorKind === 'agent' && m.authorId === s.me.id) {
    if (m.status === 'pending') notify(t('notify.draftPending'), m.body || t('notify.docDraft'), () => set({ view: { kind: 'approvals' } }))
    else if (m.visibility === 'private') notify(t('notify.myAgent', { title: c?.title ?? '' }), m.body, open)
    return
  }
  if (m.authorId === s.me.id) return
  const who = m.authorKind === 'agent' ? t('common.agentOf', { name: memberName(m.channelId, m.authorId) }) : memberName(m.channelId, m.authorId)
  // 나를 @로 부른 메시지는 따로 알린다(내 에이전트가 이미 처리를 시작한다)
  if (m.mentions?.includes(s.me.id)) return notify(t('notify.mentioned', { who, title: c?.title ?? '' }), m.body, open)
  notify(`${who} · ${c?.title ?? ''}`, m.kind === 'artifact' ? t('notify.docPosted') : m.kind === 'file' ? (m.file?.name ?? '') : m.body, open)
}

// ── 화면 이동 ──────────────────────────────────────────────

export async function loadChannel(id: string) {
  const [messages, artifacts] = await Promise.all([api.messages(id), api.artifacts(id)])
  const s = get()
  set({
    messages: { ...s.messages, [id]: messages },
    artifacts: { ...s.artifacts, ...Object.fromEntries(artifacts.map((a) => [a.id, a])) },
  })
}

export async function openChannel(id: string) {
  const prev = get().view
  set({ view: { kind: 'channel', id }, canvas: prev.kind === 'channel' && prev.id === id ? get().canvas : null })
  if (!get().messages[id]) await guard(loadChannel(id))
  void guard(api.markRead(id))
}

export function goHome() {
  set({ view: { kind: 'home' }, canvas: null })
}

export function setModal(modal: Modal) {
  set({ modal })
}

export function setCanvas(canvas: Canvas) {
  set({ canvas })
}

// ── 행동 ────────────────────────────────────────────────────

export async function startChannel(firstMessage: string) {
  const title = firstMessage.split('\n')[0].slice(0, 40)
  const c = await guard(api.createChannel(title))
  if (!c) return
  set({ channels: { ...get().channels, [c.id]: c }, messages: { ...get().messages, [c.id]: [] } })
  await openChannel(c.id)
  await guard(api.send(c.id, firstMessage, 'channel'))
  set({ modal: { kind: 'invite', channelId: c.id } })
}

export async function sendMessage(channelId: string, body: string, visibility: 'channel' | 'private') {
  const m = await guard(api.send(channelId, body, visibility))
  if (m) upsertMessage(m)
  return !!m
}

export const MAX_FILE = 25 * 1024 * 1024

export async function uploadFiles(channelId: string, files: File[], visibility: 'channel' | 'private') {
  for (const f of files) {
    if (f.size === 0) {
      toast(t('file.empty', { name: f.name }))
      continue
    }
    if (f.size > MAX_FILE) {
      toast(t('file.tooBig', { name: f.name }))
      continue
    }
    // 붙여넣은 이미지는 이름이 다 image.png 라 구분되게 바꾼다
    const named = /^image\.(png|jpe?g|gif|webp)$/i.test(f.name)
      ? new File([f], `${t('file.pastedImage', { stamp: new Date().toLocaleString('sv-SE').replace(/[: ]/g, '-') })}.${f.name.split('.').pop()}`, {
          type: f.type,
        })
      : f
    const m = await guard(api.uploadFile(channelId, named, visibility))
    if (m) upsertMessage(m)
  }
}

export async function approveDraft(id: string, body?: string) {
  const m = await guard(api.approve(id, body))
  if (m) upsertMessage(m)
}

export async function rejectDraft(id: string) {
  const r = await guard(api.reject(id))
  if (!r) return
  const s = get()
  const d = s.drafts.find((x) => x.id === id)
  set({ drafts: s.drafts.filter((x) => x.id !== id) })
  if (d) {
    const list = s.messages[d.channelId]
    if (list) set({ messages: { ...get().messages, [d.channelId]: list.filter((x) => x.id !== id) } })
  }
  badge()
}

/** 이 채널에서 내 에이전트가 기다리는 초안과 도구 허락을 한 번에 보낸다 */
export async function approveAllIn(channelId: string) {
  const s = get()
  const permId = s.activity[channelId]?.permissionId
  for (const p of s.permissions.filter((x) => x.id === permId)) await answerPermission(p.id, 'allow')
  for (const d of s.drafts.filter((x) => x.channelId === channelId)) await approveDraft(d.id)
}

/** 항상 모두 승인. 켜면 지금 쌓여 있는 것도 모두 보낸다. */
export async function setAutoApprove(on: boolean) {
  const r = await guard(api.setAutoApprove(on))
  if (!r) return
  set({ me: r.user })
  if (on) {
    for (const p of [...get().permissions]) await answerPermission(p.id, 'allow')
    for (const d of [...get().drafts]) await approveDraft(d.id)
  }
  toast(t(on ? 'auto.enabled' : 'auto.disabled'))
}

export async function answerPermission(id: string, behavior: 'allow' | 'deny') {
  const r = await guard(api.verdict(id, behavior))
  set({ permissions: get().permissions.filter((p) => p.id !== id) })
  badge()
  return r
}

export async function joinByCode(code: string) {
  const c = await api.join(code)
  set({ channels: { ...get().channels, [c.id]: c } })
  await openChannel(c.id)
}
