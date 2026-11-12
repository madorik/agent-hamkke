import { create } from 'zustand'
import type { AgentActivity, Artifact, Channel, Decision, Message, PermissionRequest, ServerEvent, Task, User } from '@ah/protocol'
import { ApiError, createApi } from './api'
import { applyLocale, getLocale, intlLocale, t } from './i18n'

export type View = { kind: 'home' } | { kind: 'channel'; id: string } | { kind: 'approvals' } | { kind: 'decisions' } | { kind: 'tasks' }
export type Modal =
  | null
  | { kind: 'settings'; tab: 'general' | 'agents' | 'account' }
  | { kind: 'invite'; channelId: string }
  | { kind: 'search' }
  | { kind: 'join' }
  | { kind: 'away' }
  | { kind: 'meetingImport'; channelId: string }
export type Canvas = null | { mode: 'tasks' } | { mode: 'list' } | { mode: 'new' } | { mode: 'view'; artifactId: string; version: number | null }
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
  /** 내 에이전트가 채널별로 지금 쓰고 있는 답(내 지시의 답). 다 쓰면 '나에게만' 메시지로 바뀐다 */
  replies: Record<string, string>
  /** 내가 정해야 할 일(아직 안 정한 결정 요청) */
  decisions: Decision[]
  /** 채널별 할 일(채널을 열 때 불러온다) */
  tasks: Record<string, Task[]>
  /** 내가 맡은 남은 일(모든 채널) */
  myTasks: Task[]
  /** 방금 자리에서 돌아왔다: 비운 동안을 요약해 보여 준다(닫으면 null) */
  welcomeBack: { since: number; at: number } | null
  /** 앱 자동 업데이트(설치한 앱만) */
  update: UpdateStatus | null
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
  replies: {},
  decisions: [],
  welcomeBack: null,
  update: null,
  tasks: {},
  myTasks: [],
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
  const n = get().drafts.length + get().permissions.length + get().decisions.length
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

// 마지막으로 본 내 정보. 서버에 닿지 않을 때도 프로필 메뉴(에이전트 연결·설정·로그아웃)를 그리려고 둔다.
function rememberMe(user: User | null) {
  LS.set('me', user ? JSON.stringify(user) : null)
}
function lastMe(): User | null {
  try {
    return JSON.parse(LS.get('me') ?? 'null') as User | null
  } catch {
    return null
  }
}

export async function boot() {
  if (!agentWatch && window.am) {
    agentWatch = true
    window.am.onConnectorChanged(() => void refreshAgentStatus())
    window.am.onAgentReply?.((r) => setReply(r.channelId, r.text))
    window.am.onIdle?.(onIdle)
    window.am.onUpdate?.((u) => set({ update: { ...get().update, ...u } }))
    void window.am.updateStatus?.().then((u) => set({ update: u })).catch(() => {})
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
  if (me) {
    set({ me: me.user })
    rememberMe(me.user)
  } else {
    // 서버에 닿지 않는다. 마지막 내 정보로 화면을 그리고, 연결은 계속 시도한다(붙으면 hello 때 새로 불러온다).
    const cached = lastMe()
    if (cached) set({ me: cached })
  }
  set({ booted: true })
  await refreshAll().catch(() => {})
  connect()
  // 저절로 켜진 자리 비움이 남아 있는데 앱을 다시 열었다 → 돌아온 것
  if (get().me?.awaySince && autoAway) void setAway(false)
}

export async function signup(name: string, relayUrl?: string) {
  if (relayUrl) {
    LS.set('relay', relayUrl)
    set({ relayUrl })
  }
  const r = await api.signup(name)
  LS.set('token', r.token)
  rememberMe(r.user)
  set({ token: r.token, me: r.user })
  await refreshAll()
  connect()
}

export function logout() {
  LS.set('token', null)
  rememberMe(null)
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
    replies: {},
    decisions: [],
    welcomeBack: null,
    tasks: {},
    myTasks: [],
    view: { kind: 'home' },
    canvas: null,
  })
}

async function refreshAll() {
  const [channels, approvals, decisions, myTasks] = await Promise.all([
    api.channels(),
    api.approvals(),
    // 예전 중계 서버엔 결정함이 없다
    api.decisions().catch(() => [] as Decision[]),
    api.myTasks().catch(() => [] as Task[]),
  ])
  set({
    channels: Object.fromEntries(channels.map((c) => [c.id, c])),
    drafts: approvals.messages,
    permissions: approvals.permissions,
    decisions,
    myTasks,
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
let connId: string | null = null
let retry = 0

/**
 * 중계 서버에 붙는다. 서버가 reconnect 를 보내면(Vercel 함수 수명) 옛 연결을 둔 채 ?resume= 로 새 연결을 연다.
 * 서버가 이벤트를 빠짐·겹침 없이 새 연결로 넘기고 옛 연결을 닫으므로, 그때까지 옛 연결의 이벤트도 그대로 받는다.
 */
function connect(resume?: string) {
  const token = get().token
  if (!token) return
  if (!resume) ws?.close()
  const sock = new WebSocket(
    get().relayUrl.replace(/^http/, 'ws') +
      '/ws?token=' +
      encodeURIComponent(token) +
      '&locale=' +
      getLocale() +
      (resume ? '&resume=' + encodeURIComponent(resume) : ''),
  )
  ws = sock
  sock.onmessage = (e) => {
    const ev = JSON.parse(String(e.data)) as ServerEvent
    if (ev.type === 'hello') connId = ev.connId
    if (ev.type === 'reconnect') {
      if (ws === sock && connId) connect(connId)
      return
    }
    onEvent(ev)
  }
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

// ── 내 에이전트가 쓰고 있는 답 ────────────────────────────────

const replyTimers = new Map<string, ReturnType<typeof setTimeout>>()

function dropReply(channelId: string) {
  clearTimeout(replyTimers.get(channelId))
  replyTimers.delete(channelId)
  const { [channelId]: _gone, ...rest } = get().replies
  if (_gone !== undefined) set({ replies: rest })
}

/** 러너가 흘려 보낸 답. null(다 씀)이면 진짜 메시지가 올 때까지 잠깐 그대로 둔다(깜빡이지 않게) */
function setReply(channelId: string, text: string | null) {
  clearTimeout(replyTimers.get(channelId))
  replyTimers.delete(channelId)
  if (text === null) {
    replyTimers.set(
      channelId,
      setTimeout(() => dropReply(channelId), 3000),
    )
    return
  }
  if (!text) return dropReply(channelId)
  set({ replies: { ...get().replies, [channelId]: text } })
}

function upsertMessage(m: Message) {
  // 내 에이전트의 '나에게만' 답이 왔으면 흘려 보이던 글을 그 메시지로 바꾼다
  if (m.authorKind === 'agent' && m.authorId === get().me?.id && m.visibility === 'private') dropReply(m.channelId)
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
      rememberMe(ev.me)
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
    case 'message_removed': {
      // 주인이 에이전트 글의 공유를 취소했다
      const list = s.messages[ev.channelId]
      if (list) set({ messages: { ...s.messages, [ev.channelId]: list.filter((x) => x.id !== ev.messageId) } })
      break
    }
    case 'user':
      if (ev.user.id === s.me?.id) applyMe(ev.user)
      break
    case 'decision': {
      const d = ev.decision
      const had = s.decisions.some((x) => x.id === d.id)
      const rest = s.decisions.filter((x) => x.id !== d.id)
      set({ decisions: d.status === 'open' ? [d, ...rest] : rest })
      badge()
      if (d.status === 'open' && !had) notify(t('notify.decision'), d.question, () => set({ view: { kind: 'decisions' }, canvas: null }))
      break
    }
    case 'task': {
      const task = ev.task
      const wasMine = s.myTasks.some((x) => x.id === task.id)
      upsertTask(task)
      // 남이 나에게 맡겼다
      const mine = task.assigneeId === s.me?.id && task.status === 'open'
      if (mine && !wasMine && task.createdBy !== s.me?.id) {
        notify(t('notify.task'), task.title, () => set({ view: { kind: 'tasks' }, canvas: null }))
      }
      break
    }
    case 'task_removed': {
      const list = s.tasks[ev.channelId]
      set({
        tasks: list ? { ...s.tasks, [ev.channelId]: list.filter((x) => x.id !== ev.taskId) } : s.tasks,
        myTasks: s.myTasks.filter((x) => x.id !== ev.taskId),
      })
      break
    }
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
      // 자리 비움은 새 중계 서버만 보낸다(없으면 그대로 둔다)
      const away = ev.awaySince !== undefined ? { awaySince: ev.awaySince, awayNote: ev.awayNote ?? '' } : {}
      const patch = { agentOnline: ev.agentOnline, agentKind: ev.agentKind, ...away }
      const channels = Object.fromEntries(
        Object.entries(s.channels).map(([id, c]) => [
          id,
          {
            ...c,
            members: c.members.map((m) => (m.id === ev.userId ? { ...m, ...patch } : m)),
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
  const [messages, artifacts, tasks] = await Promise.all([api.messages(id), api.artifacts(id), api.tasks(id).catch(() => [] as Task[])])
  const s = get()
  set({
    messages: { ...s.messages, [id]: messages },
    tasks: { ...s.tasks, [id]: tasks },
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
  set({ channels: { ...get().channels, [c.id]: c }, messages: { ...get().messages, [c.id]: [] }, tasks: { ...get().tasks, [c.id]: [] } })
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

/** 나에게만 온 내 에이전트의 답을 채널에 공유한다 */
export async function shareMessage(id: string) {
  const m = await guard(api.share(id))
  if (!m) return
  upsertMessage(m)
  toast(t('message.shared'))
}

/** 채널에 나간 내 에이전트 글을 다시 나에게만 보이게 한다 */
export async function unshareMessage(id: string) {
  const m = await guard(api.unshare(id))
  if (!m) return
  upsertMessage(m)
  toast(t('message.unshared'))
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

// ── 자리 비움 ────────────────────────────────────────────────
// 입력이 없거나 화면을 잠그면(메인 프로세스가 알려 줌) 자동으로 켜고, 다시 움직이면 끈다.
// 사람이 직접 켠 자리 비움(예: '휴가 중')은 움직여도 그대로 둔다.

let autoAway = LS.get('autoAway') === '1'

/** 내 정보 반영. 자리에서 돌아왔으면 비운 동안을 보여 준다 */
function applyMe(user: User) {
  const from = get().me?.awaySince
  if (from && !user.awaySince) set({ welcomeBack: { since: from, at: Date.now() } })
  if (user.awaySince) set({ welcomeBack: null })
  set({ me: user })
  rememberMe(user)
}

let awaySeq = 0

export async function setAway(on: boolean, note?: string, auto = false) {
  // 저절로 켠 자리 비움의 응답이 사람이 직접 켠 것보다 늦게 와도 '직접 켬'이 남게 마지막 요청만 반영한다
  const seq = ++awaySeq
  const r = await guard(api.setAway(on, on ? note : undefined))
  if (!r) return
  if (seq === awaySeq) {
    autoAway = on && auto
    LS.set('autoAway', autoAway ? '1' : null)
  }
  applyMe(r.user)
}

function onIdle(idle: boolean) {
  const me = get().me
  if (!me || !get().online) return
  if (idle && !me.awaySince) void setAway(true, undefined, true)
  else if (!idle && me.awaySince && autoAway) void setAway(false)
}

// ── 앱 업데이트 ──────────────────────────────────────────────

export async function checkUpdate() {
  const u = await window.am?.updateCheck().catch(() => null)
  if (u) set({ update: u })
  if (u?.state === 'none') toast(t('update.latest'))
}

export async function installUpdate() {
  await window.am?.updateInstall()
}

export function closeWelcome() {
  set({ welcomeBack: null })
}

/** 자리 비운 동안 이 채널에서 있었던 일을 내 에이전트에게 요약받는다(답은 흘려 보인다) */
export async function catchUp(channelId: string, since: number) {
  set({ welcomeBack: null })
  const at = new Date(since).toLocaleString(intlLocale(), { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  await sendMessage(channelId, t('welcome.catchUpPrompt', { since: at }), 'private')
}

// ── 결정함 ──────────────────────────────────────────────────

export async function decide(id: string, answer: string, notify: boolean): Promise<boolean> {
  const r = await guard(api.decide(id, answer, notify))
  if (!r) return false
  set({ decisions: get().decisions.filter((d) => d.id !== id) })
  badge()
  if (r.message) upsertMessage(r.message)
  toast(t('decision.decided'))
  return true
}

export async function dismissDecision(id: string) {
  const r = await guard(api.dismissDecision(id))
  if (!r) return
  set({ decisions: get().decisions.filter((d) => d.id !== id) })
  badge()
}

// ── 할 일 ───────────────────────────────────────────────────

/** 남은 일 먼저(기한 가까운 순), 끝낸 일은 뒤에 */
function sortTasks(list: Task[]): Task[] {
  return [...list].sort((a, b) => {
    if (a.status !== b.status) return a.status === 'open' ? -1 : 1
    if (a.status === 'done') return (b.doneAt ?? 0) - (a.doneAt ?? 0)
    if ((a.due ?? '9') !== (b.due ?? '9')) return (a.due ?? '9') < (b.due ?? '9') ? -1 : 1
    return a.createdAt - b.createdAt
  })
}

function upsertTask(task: Task) {
  const s = get()
  const list = s.tasks[task.channelId]
  const meId = s.me?.id
  set({
    tasks: list ? { ...s.tasks, [task.channelId]: sortTasks([...list.filter((x) => x.id !== task.id), task]) } : s.tasks,
    myTasks: sortTasks([
      ...s.myTasks.filter((x) => x.id !== task.id),
      ...(task.assigneeId === meId && task.status === 'open' ? [task] : []),
    ]),
  })
}

/** 채널의 할 일을 (다시) 불러온다. 할 일 패널을 열 때 */
export async function loadTasks(channelId: string) {
  const list = await api.tasks(channelId).catch(() => null)
  if (list) set({ tasks: { ...get().tasks, [channelId]: sortTasks(list) } })
}

export async function addTask(channelId: string, p: { title: string; assigneeId?: string | null; due?: string | null }) {
  const task = await guard(api.addTask(channelId, p))
  if (task) upsertTask(task)
  return !!task
}

export async function updateTask(id: string, p: { title?: string; assigneeId?: string | null; due?: string | null; status?: 'open' | 'done' }) {
  const task = await guard(api.updateTask(id, p))
  if (task) upsertTask(task)
}

export async function deleteTask(task: Task) {
  if (!(await guard(api.deleteTask(task.id)))) return
  const s = get()
  const list = s.tasks[task.channelId]
  set({
    tasks: list ? { ...s.tasks, [task.channelId]: list.filter((x) => x.id !== task.id) } : s.tasks,
    myTasks: s.myTasks.filter((x) => x.id !== task.id),
  })
}

/** 할 일을 내 에이전트에게 맡긴다(나에게만 지시 → 답은 흘려 보인다) */
export async function handOffTask(task: Task) {
  await sendMessage(task.channelId, t('task.handOffPrompt', { title: task.title, id: task.id, due: task.due ?? '' }), 'private')
  toast(t('handoff.sent'))
}

/** 채널의 메시지 하나를 내 에이전트에게 맡긴다. note 가 없으면 알아서 처리하게 한다 */
export async function handOffMessage(m: Message, note: string) {
  const who = memberName(m.channelId, m.authorId)
  const author = m.authorKind === 'agent' ? t('common.agentOf', { name: who }) : who
  const quote = m.body
    .trim()
    .slice(0, 1500)
    .split('\n')
    .map((l) => '> ' + l)
    .join('\n')
  await sendMessage(m.channelId, t('handoff.prompt', { author, id: m.id, quote, note: note.trim() || t('handoff.default') }), 'private')
  toast(t('handoff.sent'))
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
