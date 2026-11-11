// 중계 서버: 사람·에이전트 메시지 중계, 승인 대기열, 문서 버전·확정, 권한 요청 전달.
// node 24 의 타입 제거 실행으로 바로 돈다: node apps/relay/src/server.ts
import http from 'node:http'
import { randomBytes, randomUUID } from 'node:crypto'
import { createReadStream, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { SQLInputValue } from 'node:sqlite'
import { WebSocketServer, WebSocket } from 'ws'
import type {
  AgentActivity,
  AgentActivityState,
  AgentKind,
  Artifact,
  Channel,
  FileMeta,
  Locale,
  Member,
  Message,
  PermissionRequest,
  ServerEvent,
  Stage,
  SystemEvent,
  User,
  ViewerKind,
} from '@ah/protocol'
import { openDb, type Row } from './db.ts'
import { defaultChannelTitle, errorText, pickLocale, systemText, type ErrorCode } from './i18n.ts'

const PORT = Number(process.env.PORT ?? 8787)
const DB_PATH = process.env.AH_DB ?? fileURLToPath(new URL('../data/relay.db', import.meta.url))
const FILES_DIR = join(dirname(DB_PATH), 'files')
const MAX_FILE = 25 * 1024 * 1024
const PERMISSION_TTL = 10 * 60_000
const COLORS = ['#e8590c', '#2f9e44', '#1971c2', '#9c36b5', '#c2255c', '#0c8599', '#5f3dc4', '#d9480f']
const STAGES: Stage[] = ['request', 'draft', 'review', 'final']
const AGENT_KINDS: AgentKind[] = ['claude-code', 'codex', 'builtin']

const db = openDb(DB_PATH)
mkdirSync(FILES_DIR, { recursive: true })

interface Viewer {
  userId: string
  kind: ViewerKind
  agentKind: AgentKind | null
}

// 문장은 응답할 때 요청의 언어로 만든다(던지는 곳은 언어를 모른다)
class HttpError extends Error {
  status: number
  code: ErrorCode
  params: Record<string, string | number>
  constructor(status: number, code: ErrorCode, params: Record<string, string | number> = {}) {
    super(code)
    this.status = status
    this.code = code
    this.params = params
  }
}

const now = () => Date.now()
const all = (sql: string, ...p: SQLInputValue[]) => db.prepare(sql).all(...p) as Row[]
const one = (sql: string, ...p: SQLInputValue[]) => db.prepare(sql).get(...p) as Row | undefined
const run = (sql: string, ...p: SQLInputValue[]) => db.prepare(sql).run(...p)
const str = (v: unknown) => (typeof v === 'string' ? v : '')

// ── 연결·접속 상태 ──────────────────────────────────────────────

interface Conn {
  ws: WebSocket
  viewer: Viewer
  locale: Locale
}
const conns = new Set<Conn>()
const agentSockets = new Map<string, number>()
// 에이전트 작업 상태: userId → channelId → 상태. 저장하지 않는다(에이전트가 끊기면 지운다).
const activities = new Map<string, Map<string, AgentActivity>>()

function send(conn: Conn, ev: ServerEvent) {
  if (conn.ws.readyState === WebSocket.OPEN) conn.ws.send(JSON.stringify(ev))
}

// ── 행 → 객체 ──────────────────────────────────────────────────

function userOf(r: Row): User {
  const id = r.id as string
  return {
    id,
    name: r.name as string,
    color: r.color as string,
    agentKind: (r.agent_kind as AgentKind | null) ?? null,
    agentOnline: (agentSockets.get(id) ?? 0) > 0,
    autoApprove: !!r.auto_approve,
  }
}

/** 이 사람이 항상 모두 승인을 켰나(에이전트가 올리는 것을 바로 내보낸다) */
function autoApproves(userId: string): boolean {
  return !!one('SELECT auto_approve FROM users WHERE id = ?', userId)?.auto_approve
}

function mentionsOf(r: Row): string[] {
  try {
    const v = JSON.parse((r.mentions as string) || '[]')
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

/** 본문의 @이름 → 채널 참여자 id. 긴 이름부터 찾아 'Jamie' 가 'Jamie Park' 를 가로채지 않게 한다. */
function findMentions(channelId: string, authorId: string, text: string): string[] {
  const members = all('SELECT u.id, u.name FROM members m JOIN users u ON u.id = m.user_id WHERE m.channel_id = ?', channelId)
    .filter((r) => r.id !== authorId)
    .sort((a, b) => (b.name as string).length - (a.name as string).length)
  let rest = text
  const ids: string[] = []
  for (const r of members) {
    const tag = '@' + (r.name as string)
    if (!rest.includes(tag)) continue
    ids.push(r.id as string)
    rest = rest.split(tag).join(' ')
  }
  return ids
}

function eventOf(r: Row): SystemEvent | null {
  if (!r.event) return null
  try {
    return JSON.parse(r.event as string) as SystemEvent
  } catch {
    return null
  }
}

/** 시스템 메시지는 보는 사람 언어로 문장을 다시 만든다 */
function msgOf(r: Row, locale: Locale = 'en'): Message {
  const event = eventOf(r)
  return {
    id: r.id as string,
    channelId: r.channel_id as string,
    authorId: (r.author_id as string | null) ?? null,
    authorKind: r.author_kind as Message['authorKind'],
    agentKind: (r.agent_kind as AgentKind | null) ?? null,
    visibility: r.visibility as Message['visibility'],
    status: r.status as Message['status'],
    kind: r.kind as Message['kind'],
    body: event ? systemText(event, locale) : (r.body as string),
    event,
    mentions: mentionsOf(r),
    artifactId: (r.artifact_id as string | null) ?? null,
    artifactVersion: (r.artifact_version as number | null) ?? null,
    file: r.file_id ? fileOf(r.file_id as string) : null,
    edited: !!r.edited,
    createdAt: r.created_at as number,
  }
}

function fileOf(id: string): FileMeta | null {
  const f = one('SELECT * FROM files WHERE id = ?', id)
  return f ? { id, name: f.name as string, mime: f.mime as string, size: f.size as number } : null
}

function removeFile(id: string) {
  run('DELETE FROM files WHERE id = ?', id)
  rmSync(join(FILES_DIR, id), { force: true })
}

function getUser(userId: string): Row {
  const u = one('SELECT * FROM users WHERE id = ?', userId)
  if (!u) throw new HttpError(404, 'user_not_found')
  return u
}

// ── 권한 ───────────────────────────────────────────────────────

function canSee(m: Row, v: Viewer): boolean {
  if (m.status === 'rejected' || m.status === 'pending') return m.author_id === v.userId
  if (m.visibility === 'private') return m.author_id === v.userId
  return true
}

function membership(channelId: string, v: Viewer): Row | undefined {
  const m = one('SELECT * FROM members WHERE channel_id = ? AND user_id = ?', channelId, v.userId)
  if (!m) return undefined
  if (v.kind === 'agent' && !m.agent_enabled) return undefined
  return m
}

function requireMember(channelId: string, v: Viewer): Row {
  const m = membership(channelId, v)
  if (!m) throw new HttpError(404, 'channel_not_found')
  return m
}

function requireHuman(v: Viewer) {
  if (v.kind !== 'human') throw new HttpError(403, 'humans_only')
}

// ── 뷰 ────────────────────────────────────────────────────────

function channelView(channelId: string, v: Viewer): Channel {
  const c = one('SELECT * FROM channels WHERE id = ?', channelId)
  if (!c) throw new HttpError(404, 'channel_not_found')
  const me = one('SELECT * FROM members WHERE channel_id = ? AND user_id = ?', channelId, v.userId)
  const members: Member[] = all(
    `SELECT u.*, m.agent_enabled, m.joined_at FROM members m JOIN users u ON u.id = m.user_id
     WHERE m.channel_id = ? ORDER BY m.joined_at`,
    channelId,
  ).map((r) => ({ ...userOf(r), agentEnabled: !!r.agent_enabled, joinedAt: r.joined_at as number }))

  const recent = all('SELECT * FROM messages WHERE channel_id = ? ORDER BY created_at DESC LIMIT 30', channelId)
  const last = recent.find((m) => m.kind !== 'system' && m.status === 'sent' && canSee(m, v))
  const lastRead = (me?.last_read_at as number) ?? 0
  const unread = all(
    'SELECT * FROM messages WHERE channel_id = ? AND created_at > ? AND status = ? LIMIT 200',
    channelId,
    lastRead,
    'sent',
  ).filter((m) => canSee(m, v) && !(m.author_id === v.userId && m.author_kind === 'human')).length
  const pending = one(
    `SELECT COUNT(*) AS n FROM messages WHERE channel_id = ? AND author_id = ? AND status = 'pending'`,
    channelId,
    v.userId,
  )
  return {
    id: c.id as string,
    title: c.title as string,
    stage: c.stage as Stage,
    turnLimit: c.turn_limit as number,
    requireApproval: !!c.require_approval,
    createdBy: c.created_by as string,
    createdAt: c.created_at as number,
    updatedAt: c.updated_at as number,
    members,
    lastMessage: last
      ? last.kind === 'artifact'
        ? ((one('SELECT title FROM artifacts WHERE id = ?', last.artifact_id as string)?.title as string | undefined) ?? '')
        : last.kind === 'file'
          ? (fileOf(last.file_id as string)?.name ?? '')
          : (last.body as string).slice(0, 120)
      : null,
    lastMessageKind: last ? (last.kind as 'text' | 'artifact' | 'file') : null,
    pendingCount: (pending?.n as number) ?? 0,
    unread,
  }
}

function artifactView(artifactId: string, v: Viewer): Artifact | null {
  const a = one('SELECT * FROM artifacts WHERE id = ?', artifactId)
  if (!a) return null
  const versions = all('SELECT * FROM artifact_versions WHERE artifact_id = ? ORDER BY version', artifactId)
    .filter((r) => r.status === 'sent' || (r.status === 'pending' && r.author_id === v.userId))
    .map((r) => ({
      version: r.version as number,
      content: r.content as string,
      authorId: r.author_id as string,
      authorKind: r.author_kind as Artifact['versions'][number]['authorKind'],
      agentKind: (r.agent_kind as AgentKind | null) ?? null,
      status: r.status as Artifact['versions'][number]['status'],
      createdAt: r.created_at as number,
    }))
  if (!versions.length) return null
  const finalizations = all('SELECT * FROM finalizations WHERE artifact_id = ? ORDER BY created_at', artifactId).map((r) => ({
    version: r.version as number,
    userId: r.user_id as string,
    createdAt: r.created_at as number,
  }))
  return {
    id: a.id as string,
    channelId: a.channel_id as string,
    title: a.title as string,
    status: a.status as Artifact['status'],
    finalVersion: (a.final_version as number | null) ?? null,
    createdBy: a.created_by as string,
    createdAt: a.created_at as number,
    updatedAt: a.updated_at as number,
    versions,
    finalizations,
  }
}

function permissionOf(r: Row): PermissionRequest {
  const expired = r.status === 'pending' && now() - (r.created_at as number) > PERMISSION_TTL
  return {
    id: r.id as string,
    userId: r.user_id as string,
    requestId: r.request_id as string,
    toolName: r.tool_name as string,
    description: r.description as string,
    inputPreview: r.input_preview as string,
    status: expired ? 'expired' : (r.status as PermissionRequest['status']),
    createdAt: r.created_at as number,
  }
}

// ── 이벤트 내보내기 ─────────────────────────────────────────────

function emitMessage(row: Row) {
  const channelId = row.channel_id as string
  for (const c of conns) if (membership(channelId, c.viewer) && canSee(row, c.viewer)) send(c, { type: 'message', message: msgOf(row, c.locale) })
}

function emitChannel(channelId: string) {
  for (const c of conns) if (membership(channelId, c.viewer)) send(c, { type: 'channel', channel: channelView(channelId, c.viewer) })
}

function emitArtifact(artifactId: string, channelId: string) {
  for (const c of conns) {
    if (!membership(channelId, c.viewer)) continue
    const view = artifactView(artifactId, c.viewer)
    send(c, view ? { type: 'artifact', artifact: view } : { type: 'artifact_removed', artifactId, channelId })
  }
}

function emitPresence(userId: string) {
  const u = getUser(userId)
  const peers = new Set(
    all(
      `SELECT DISTINCT m2.user_id AS id FROM members m1 JOIN members m2 ON m1.channel_id = m2.channel_id WHERE m1.user_id = ?`,
      userId,
    ).map((r) => r.id as string),
  )
  peers.add(userId)
  const ev: ServerEvent = {
    type: 'presence',
    userId,
    agentOnline: (agentSockets.get(userId) ?? 0) > 0,
    agentKind: (u.agent_kind as AgentKind | null) ?? null,
  }
  for (const c of conns) if (peers.has(c.viewer.userId)) send(c, ev)
}

function emitToOwner(userId: string, kind: ViewerKind, ev: ServerEvent) {
  for (const c of conns) if (c.viewer.userId === userId && c.viewer.kind === kind) send(c, ev)
}

// ── 쓰기 도우미 ────────────────────────────────────────────────

function touch(channelId: string) {
  run('UPDATE channels SET updated_at = ? WHERE id = ?', now(), channelId)
}

function insertMessage(m: {
  channelId: string
  authorId: string | null
  authorKind: Message['authorKind']
  agentKind?: AgentKind | null
  visibility?: Message['visibility']
  status?: Message['status']
  kind?: Message['kind']
  body: string
  artifactId?: string | null
  artifactVersion?: number | null
  fileId?: string | null
  event?: SystemEvent | null
  mentions?: string[]
}): Row {
  const id = randomUUID()
  run(
    `INSERT INTO messages (id, channel_id, author_id, author_kind, agent_kind, visibility, status, kind, body, artifact_id, artifact_version, file_id, event, mentions, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    m.channelId,
    m.authorId,
    m.authorKind,
    m.agentKind ?? null,
    m.visibility ?? 'channel',
    m.status ?? 'sent',
    m.kind ?? 'text',
    m.body,
    m.artifactId ?? null,
    m.artifactVersion ?? null,
    m.fileId ?? null,
    m.event ? JSON.stringify(m.event) : null,
    m.mentions?.length ? JSON.stringify(m.mentions) : null,
    now(),
  )
  touch(m.channelId)
  return one('SELECT * FROM messages WHERE id = ?', id)!
}

// body 에는 영어 문장을 남겨 두고(예전 클라이언트용), 보낼 때 받는 사람 언어로 다시 만든다
function systemMessage(channelId: string, event: SystemEvent) {
  emitMessage(insertMessage({ channelId, authorId: null, authorKind: 'system', kind: 'system', body: systemText(event, 'en'), event }))
}

// 사람이 끼어들지 않은 채 에이전트끼리 주고받은 수. 상한을 넘으면 사람 차례.
function agentStreak(channelId: string): number {
  const rows = all(
    `SELECT author_kind FROM messages WHERE channel_id = ? AND visibility = 'channel' AND status = 'sent' AND kind != 'system'
     ORDER BY created_at DESC LIMIT 100`,
    channelId,
  )
  let n = 0
  for (const r of rows) {
    if (r.author_kind !== 'agent') break
    n++
  }
  return n
}

function checkAgentTurn(channelId: string, v: Viewer) {
  if (v.kind !== 'agent') return
  const c = one('SELECT turn_limit FROM channels WHERE id = ?', channelId)!
  if (agentStreak(channelId) >= (c.turn_limit as number)) {
    throw new HttpError(409, 'agent_turn_limit', { limit: c.turn_limit as number })
  }
}

function newCode(): string {
  const abc = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
  const bytes = randomBytes(6)
  return Array.from(bytes, (b) => abc[b % abc.length]).join('')
}

// ── 라우터 ─────────────────────────────────────────────────────

interface Ctx {
  viewer: Viewer
  /** 요청한 쪽 언어(Accept-Language) */
  locale: Locale
  params: string[]
  body: Record<string, unknown>
  query: URLSearchParams
}
type Handler = (ctx: Ctx) => unknown
const routes: { method: string; re: RegExp; auth: boolean; handler: Handler }[] = []
function route(method: string, path: string, handler: Handler, auth = true) {
  routes.push({ method, re: new RegExp('^' + path.replace(/:\w+/g, '([^/]+)') + '$'), auth, handler })
}

function viewerFromToken(token: string | null): Viewer | null {
  if (!token) return null
  const t = one('SELECT * FROM tokens WHERE token = ?', token)
  if (!t) return null
  return { userId: t.user_id as string, kind: t.kind as ViewerKind, agentKind: (t.agent_kind as AgentKind | null) ?? null }
}

// 가입·나
route(
  'POST',
  '/signup',
  ({ body }) => {
    const name = str(body.name).trim().slice(0, 30)
    if (!name) throw new HttpError(400, 'name_required')
    const id = randomUUID()
    run(
      'INSERT INTO users (id, name, color, created_at) VALUES (?, ?, ?, ?)',
      id,
      name,
      COLORS[Math.floor(Math.random() * COLORS.length)],
      now(),
    )
    const token = 'h_' + randomBytes(24).toString('base64url')
    run('INSERT INTO tokens (token, user_id, kind, created_at) VALUES (?, ?, ?, ?)', token, id, 'human', now())
    return { user: userOf(getUser(id)), token }
  },
  false,
)

route('GET', '/me', ({ viewer }) => ({ user: userOf(getUser(viewer.userId)), kind: viewer.kind, agentKind: viewer.agentKind }))

route('PATCH', '/me', ({ viewer, body }) => {
  requireHuman(viewer)
  const name = str(body.name).trim().slice(0, 30)
  if (name) run('UPDATE users SET name = ? WHERE id = ?', name, viewer.userId)
  if (typeof body.autoApprove === 'boolean') run('UPDATE users SET auto_approve = ? WHERE id = ?', Number(body.autoApprove), viewer.userId)
  const user = userOf(getUser(viewer.userId))
  // 내 화면과 내 에이전트가 바로 알도록(에이전트는 요청을 얼마나 조심해 처리할지 정한다)
  for (const c of conns) if (c.viewer.userId === viewer.userId) send(c, { type: 'user', user })
  for (const r of all('SELECT channel_id FROM members WHERE user_id = ?', viewer.userId)) emitChannel(r.channel_id as string)
  return { user }
})

route('POST', '/agent-tokens', ({ viewer, body }) => {
  requireHuman(viewer)
  const agentKind = str(body.agentKind) as AgentKind
  if (!AGENT_KINDS.includes(agentKind)) throw new HttpError(400, 'unsupported_agent')
  run(`DELETE FROM tokens WHERE user_id = ? AND kind = 'agent'`, viewer.userId)
  const token = 'a_' + randomBytes(24).toString('base64url')
  run(
    'INSERT INTO tokens (token, user_id, kind, agent_kind, created_at) VALUES (?, ?, ?, ?, ?)',
    token,
    viewer.userId,
    'agent',
    agentKind,
    now(),
  )
  run('UPDATE users SET agent_kind = ? WHERE id = ?', agentKind, viewer.userId)
  // 예전 토큰으로 붙어 있던 에이전트 연결은 끊는다
  for (const c of conns) if (c.viewer.userId === viewer.userId && c.viewer.kind === 'agent') c.ws.close(4001, 'token rotated')
  emitPresence(viewer.userId)
  return { token, agentKind }
})

// 채널
route('GET', '/channels', ({ viewer }) => {
  const ids = all(
    `SELECT channel_id FROM members WHERE user_id = ? ${viewer.kind === 'agent' ? 'AND agent_enabled = 1' : ''}`,
    viewer.userId,
  ).map((r) => r.channel_id as string)
  return ids.map((id) => channelView(id, viewer)).sort((a, b) => b.updatedAt - a.updatedAt)
})

route('POST', '/channels', ({ viewer, body, locale }) => {
  requireHuman(viewer)
  const title = str(body.title).trim().slice(0, 80) || defaultChannelTitle(locale)
  const id = randomUUID()
  const t = now()
  run('INSERT INTO channels (id, title, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', id, title, viewer.userId, t, t)
  run('INSERT INTO members (channel_id, user_id, joined_at, last_read_at) VALUES (?, ?, ?, ?)', id, viewer.userId, t, t)
  emitChannel(id)
  return channelView(id, viewer)
})

route('GET', '/channels/:id', ({ viewer, params }) => {
  requireMember(params[0], viewer)
  return channelView(params[0], viewer)
})

route('PATCH', '/channels/:id', ({ viewer, params, body }) => {
  requireHuman(viewer)
  const id = params[0]
  requireMember(id, viewer)
  const c = one('SELECT * FROM channels WHERE id = ?', id)!
  const name = getUser(viewer.userId).name as string
  if (typeof body.title === 'string' && body.title.trim()) {
    run('UPDATE channels SET title = ? WHERE id = ?', body.title.trim().slice(0, 80), id)
  }
  if (typeof body.stage === 'string' && STAGES.includes(body.stage as Stage) && body.stage !== c.stage) {
    run('UPDATE channels SET stage = ? WHERE id = ?', body.stage, id)
    systemMessage(id, { type: 'stage_changed', name, stage: body.stage as Stage })
  }
  if (typeof body.requireApproval === 'boolean' && Number(body.requireApproval) !== c.require_approval) {
    run('UPDATE channels SET require_approval = ? WHERE id = ?', Number(body.requireApproval), id)
    systemMessage(id, { type: 'approval_toggled', name, on: body.requireApproval })
  }
  if (typeof body.turnLimit === 'number') {
    const limit = Math.max(1, Math.min(50, Math.round(body.turnLimit)))
    run('UPDATE channels SET turn_limit = ? WHERE id = ?', limit, id)
  }
  emitChannel(id)
  return channelView(id, viewer)
})

route('PATCH', '/channels/:id/me', ({ viewer, params, body }) => {
  requireHuman(viewer)
  const id = params[0]
  const m = requireMember(id, viewer)
  if (typeof body.agentEnabled === 'boolean' && Number(body.agentEnabled) !== m.agent_enabled) {
    run('UPDATE members SET agent_enabled = ? WHERE channel_id = ? AND user_id = ?', Number(body.agentEnabled), id, viewer.userId)
    const name = getUser(viewer.userId).name as string
    systemMessage(id, { type: 'agent_toggled', name, on: body.agentEnabled })
  }
  emitChannel(id)
  return channelView(id, viewer)
})

route('POST', '/channels/:id/read', ({ viewer, params }) => {
  requireHuman(viewer)
  requireMember(params[0], viewer)
  run('UPDATE members SET last_read_at = ? WHERE channel_id = ? AND user_id = ?', now(), params[0], viewer.userId)
  const view = channelView(params[0], viewer)
  emitToOwner(viewer.userId, 'human', { type: 'channel', channel: view })
  return view
})

// 초대
route('POST', '/channels/:id/invites', ({ viewer, params }) => {
  requireHuman(viewer)
  requireMember(params[0], viewer)
  const existing = one('SELECT code FROM invites WHERE channel_id = ? AND created_by = ?', params[0], viewer.userId)
  if (existing) return { code: existing.code }
  const code = newCode()
  run('INSERT INTO invites (code, channel_id, created_by, created_at) VALUES (?, ?, ?, ?)', code, params[0], viewer.userId, now())
  return { code }
})

route('POST', '/invites/:code/accept', ({ viewer, params }) => {
  requireHuman(viewer)
  const inv = one('SELECT * FROM invites WHERE code = ?', params[0].toUpperCase())
  if (!inv) throw new HttpError(404, 'invite_not_found')
  const channelId = inv.channel_id as string
  if (!membership(channelId, viewer)) {
    run('INSERT INTO members (channel_id, user_id, joined_at) VALUES (?, ?, ?)', channelId, viewer.userId, now())
    systemMessage(channelId, { type: 'joined', name: getUser(viewer.userId).name as string })
    emitChannel(channelId)
  }
  return channelView(channelId, viewer)
})

// 메시지
route('GET', '/channels/:id/messages', ({ viewer, params, locale }) => {
  requireMember(params[0], viewer)
  return all('SELECT * FROM messages WHERE channel_id = ? ORDER BY created_at ASC LIMIT 1000', params[0])
    .filter((m) => m.status !== 'rejected' && canSee(m, viewer))
    .map((m) => msgOf(m, locale))
})

route('POST', '/channels/:id/messages', ({ viewer, params, body }) => {
  const channelId = params[0]
  requireMember(channelId, viewer)
  const text = str(body.body).trim()
  if (!text) throw new HttpError(400, 'empty_message')
  if (text.length > 20000) throw new HttpError(400, 'message_too_long')
  const visibility = body.visibility === 'private' ? 'private' : 'channel'
  let status: Message['status'] = 'sent'
  if (viewer.kind === 'agent' && visibility === 'channel') {
    checkAgentTurn(channelId, viewer)
    const c = one('SELECT require_approval FROM channels WHERE id = ?', channelId)!
    if (c.require_approval && !autoApproves(viewer.userId)) status = 'pending'
  }
  const row = insertMessage({
    channelId,
    authorId: viewer.userId,
    authorKind: viewer.kind,
    agentKind: viewer.kind === 'agent' ? viewer.agentKind : null,
    visibility,
    status,
    body: text,
    mentions: visibility === 'channel' ? findMentions(channelId, viewer.userId, text) : [],
  })
  emitMessage(row)
  emitChannel(channelId)
  return msgOf(row)
})

route('POST', '/messages/:id/approve', ({ viewer, params, body }) => {
  requireHuman(viewer)
  const m = one('SELECT * FROM messages WHERE id = ?', params[0])
  if (!m || m.author_id !== viewer.userId || m.status !== 'pending') throw new HttpError(404, 'nothing_to_approve')
  const channelId = m.channel_id as string
  requireMember(channelId, viewer)
  const edited = typeof body.body === 'string' && body.body.trim() && body.body.trim() !== m.body && m.kind === 'text'
  const finalBody = edited ? (body.body as string).trim() : (m.body as string)
  run(
    `UPDATE messages SET status = 'sent', created_at = ?, body = ?, edited = ?, mentions = ? WHERE id = ?`,
    now(),
    finalBody,
    edited ? 1 : (m.edited as number),
    // 고쳐서 보냈으면 지목도 다시 찾는다
    edited && m.visibility === 'channel' ? JSON.stringify(findMentions(channelId, viewer.userId, finalBody)) : ((m.mentions as string | null) ?? null),
    m.id as string,
  )
  touch(channelId)
  if (m.kind === 'artifact' && m.artifact_id) {
    run(`UPDATE artifact_versions SET status = 'sent' WHERE artifact_id = ? AND version = ?`, m.artifact_id, m.artifact_version)
    run(`UPDATE artifacts SET updated_at = ?, status = 'draft' WHERE id = ?`, now(), m.artifact_id)
    emitArtifact(m.artifact_id as string, channelId)
  }
  const row = one('SELECT * FROM messages WHERE id = ?', m.id as string)!
  emitMessage(row)
  emitChannel(channelId)
  return msgOf(row)
})

route('POST', '/messages/:id/reject', ({ viewer, params }) => {
  requireHuman(viewer)
  const m = one('SELECT * FROM messages WHERE id = ?', params[0])
  if (!m || m.author_id !== viewer.userId || m.status !== 'pending') throw new HttpError(404, 'nothing_to_discard')
  const channelId = m.channel_id as string
  run(`UPDATE messages SET status = 'rejected' WHERE id = ?`, m.id as string)
  if (m.kind === 'file' && m.file_id) removeFile(m.file_id as string) // 버린 파일은 서버에 남기지 않는다
  if (m.kind === 'artifact' && m.artifact_id) {
    run('DELETE FROM artifact_versions WHERE artifact_id = ? AND version = ?', m.artifact_id, m.artifact_version)
    const left = one('SELECT COUNT(*) AS n FROM artifact_versions WHERE artifact_id = ?', m.artifact_id)!
    if (!left.n) {
      run('DELETE FROM finalizations WHERE artifact_id = ?', m.artifact_id)
      run('DELETE FROM artifacts WHERE id = ?', m.artifact_id)
    }
    emitArtifact(m.artifact_id as string, channelId)
  }
  emitMessage(one('SELECT * FROM messages WHERE id = ?', m.id as string)!)
  emitChannel(channelId)
  return { ok: true }
})

// 문서
route('GET', '/channels/:id/artifacts', ({ viewer, params }) => {
  requireMember(params[0], viewer)
  return all('SELECT id FROM artifacts WHERE channel_id = ? ORDER BY updated_at DESC', params[0])
    .map((r) => artifactView(r.id as string, viewer))
    .filter(Boolean)
})

route('GET', '/artifacts/:id', ({ viewer, params }) => {
  const a = one('SELECT channel_id FROM artifacts WHERE id = ?', params[0])
  if (!a) throw new HttpError(404, 'document_not_found')
  requireMember(a.channel_id as string, viewer)
  const view = artifactView(params[0], viewer)
  if (!view) throw new HttpError(404, 'document_not_found')
  return view
})

route('POST', '/channels/:id/artifacts', ({ viewer, params, body }) => {
  const channelId = params[0]
  requireMember(channelId, viewer)
  const content = str(body.content)
  if (!content.trim()) throw new HttpError(400, 'empty_document')
  if (content.length > 200_000) throw new HttpError(400, 'document_too_long')
  checkAgentTurn(channelId, viewer)

  let artifactId = str(body.artifactId)
  const t = now()
  if (artifactId) {
    const a = one('SELECT * FROM artifacts WHERE id = ? AND channel_id = ?', artifactId, channelId)
    if (!a) throw new HttpError(404, 'document_not_found')
  } else {
    const title = str(body.title).trim().slice(0, 120)
    if (!title) throw new HttpError(400, 'title_required')
    artifactId = randomUUID()
    run(
      'INSERT INTO artifacts (id, channel_id, title, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      artifactId,
      channelId,
      title,
      viewer.userId,
      t,
      t,
    )
  }
  const max = one('SELECT MAX(version) AS v FROM artifact_versions WHERE artifact_id = ?', artifactId)
  const version = ((max?.v as number | null) ?? 0) + 1
  const c = one('SELECT require_approval FROM channels WHERE id = ?', channelId)!
  const status: Message['status'] = viewer.kind === 'agent' && c.require_approval && !autoApproves(viewer.userId) ? 'pending' : 'sent'
  const agentKind = viewer.kind === 'agent' ? viewer.agentKind : null
  run(
    `INSERT INTO artifact_versions (artifact_id, version, content, author_id, author_kind, agent_kind, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    artifactId,
    version,
    content,
    viewer.userId,
    viewer.kind,
    agentKind,
    status,
    t,
  )
  if (status === 'sent') run(`UPDATE artifacts SET updated_at = ?, status = 'draft' WHERE id = ?`, t, artifactId)
  const msg = insertMessage({
    channelId,
    authorId: viewer.userId,
    authorKind: viewer.kind,
    agentKind,
    status,
    kind: 'artifact',
    body: str(body.note).trim().slice(0, 2000),
    artifactId,
    artifactVersion: version,
  })
  emitArtifact(artifactId, channelId)
  emitMessage(msg)
  emitChannel(channelId)
  return { artifact: artifactView(artifactId, viewer), message: msgOf(msg) }
})

route('POST', '/artifacts/:id/finalize', ({ viewer, params, body }) => {
  requireHuman(viewer)
  const a = one('SELECT * FROM artifacts WHERE id = ?', params[0])
  if (!a) throw new HttpError(404, 'document_not_found')
  const channelId = a.channel_id as string
  requireMember(channelId, viewer)
  const version = Number(body.version)
  const v = one(`SELECT * FROM artifact_versions WHERE artifact_id = ? AND version = ? AND status = 'sent'`, a.id as string, version)
  if (!v) throw new HttpError(400, 'version_not_finalizable')
  run(
    'INSERT OR IGNORE INTO finalizations (artifact_id, version, user_id, created_at) VALUES (?, ?, ?, ?)',
    a.id as string,
    version,
    viewer.userId,
    now(),
  )

  const humans = all('SELECT user_id FROM members WHERE channel_id = ?', channelId).map((r) => r.user_id as string)
  const signed = new Set(
    all('SELECT user_id FROM finalizations WHERE artifact_id = ? AND version = ?', a.id as string, version).map((r) => r.user_id as string),
  )
  const name = getUser(viewer.userId).name as string
  if (humans.every((h) => signed.has(h))) {
    run(`UPDATE artifacts SET status = 'final', final_version = ?, updated_at = ? WHERE id = ?`, version, now(), a.id as string)
    systemMessage(channelId, { type: 'doc_finalized', title: a.title as string, version })
  } else {
    systemMessage(channelId, { type: 'doc_signed', name, title: a.title as string, version, signed: signed.size, total: humans.length })
  }
  emitArtifact(a.id as string, channelId)
  emitChannel(channelId)
  return artifactView(a.id as string, viewer)
})

// 승인함
route('GET', '/approvals', ({ viewer, locale }) => {
  requireHuman(viewer)
  const messages = all(`SELECT * FROM messages WHERE author_id = ? AND status = 'pending' ORDER BY created_at ASC`, viewer.userId)
    .filter((m) => membership(m.channel_id as string, viewer))
    .map((m) => msgOf(m, locale))
  const permissions = all(
    `SELECT * FROM permission_requests WHERE user_id = ? AND status = 'pending' AND created_at > ? ORDER BY created_at ASC`,
    viewer.userId,
    now() - PERMISSION_TTL,
  ).map(permissionOf)
  return { messages, permissions }
})

// Claude Code 도구 실행 권한 요청(커넥터가 올리고, 사람이 데스크톱에서 답한다)
route('POST', '/permission-requests', ({ viewer, body }) => {
  if (viewer.kind !== 'agent') throw new HttpError(403, 'agents_only')
  const id = randomUUID()
  // 항상 모두 승인이면 묻지 않고 허용한다(기록은 남긴다)
  const auto = autoApproves(viewer.userId)
  run(
    `INSERT INTO permission_requests (id, user_id, request_id, tool_name, description, input_preview, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    viewer.userId,
    str(body.requestId).slice(0, 16),
    str(body.toolName).slice(0, 200),
    str(body.description).slice(0, 4000),
    str(body.inputPreview).slice(0, 8000),
    auto ? 'allow' : 'pending',
    now(),
  )
  const request = permissionOf(one('SELECT * FROM permission_requests WHERE id = ?', id)!)
  emitToOwner(viewer.userId, 'human', { type: 'permission', request })
  if (auto) emitToOwner(viewer.userId, 'agent', { type: 'permission_verdict', requestId: request.requestId, behavior: 'allow' })
  return request
})

route('POST', '/permission-requests/:id/verdict', ({ viewer, params, body }) => {
  requireHuman(viewer)
  const r = one('SELECT * FROM permission_requests WHERE id = ? AND user_id = ?', params[0], viewer.userId)
  if (!r) throw new HttpError(404, 'request_not_found')
  const current = permissionOf(r)
  if (current.status !== 'pending') throw new HttpError(410, 'request_closed')
  const behavior = body.behavior === 'allow' ? 'allow' : 'deny'
  run('UPDATE permission_requests SET status = ? WHERE id = ?', behavior, r.id as string)
  emitToOwner(viewer.userId, 'agent', { type: 'permission_verdict', requestId: r.request_id as string, behavior })
  const request = permissionOf(one('SELECT * FROM permission_requests WHERE id = ?', r.id as string)!)
  emitToOwner(viewer.userId, 'human', { type: 'permission', request })
  return request
})

// 에이전트 작업 상태(작업 중·허락 대기·끝). 마스터에게만 보낸다.
const ACTIVITY_STATES: AgentActivityState[] = ['working', 'waiting', 'idle']

function setActivity(userId: string, channelId: string, state: AgentActivityState, detail = '', permissionId: string | null = null) {
  const activity: AgentActivity = { userId, channelId, state, detail, permissionId, at: now() }
  let mine = activities.get(userId)
  if (!mine) activities.set(userId, (mine = new Map()))
  if (state === 'idle') mine.delete(channelId)
  else mine.set(channelId, activity)
  emitToOwner(userId, 'human', { type: 'agent_activity', activity })
}

function clearActivities(userId: string) {
  for (const channelId of [...(activities.get(userId)?.keys() ?? [])]) setActivity(userId, channelId, 'idle')
}

route('POST', '/agent-activity', ({ viewer, body }) => {
  if (viewer.kind !== 'agent') throw new HttpError(403, 'agents_only')
  const state = ACTIVITY_STATES.includes(body.state as AgentActivityState) ? (body.state as AgentActivityState) : 'idle'
  const ids = Array.isArray(body.channelIds) ? body.channelIds.filter((x): x is string => typeof x === 'string').slice(0, 20) : []
  for (const id of ids) {
    if (!membership(id, viewer)) continue
    setActivity(viewer.userId, id, state, str(body.detail).slice(0, 120), state === 'waiting' ? str(body.permissionId) || null : null)
  }
  return { ok: true }
})

route('GET', '/health', () => ({ ok: true }), false)

// ── 파일 (JSON 이 아니라 바이트를 그대로 주고받는다) ───────────────

interface RawCtx {
  req: http.IncomingMessage
  res: http.ServerResponse
  viewer: Viewer
  locale: Locale
  params: string[]
  query: URLSearchParams
}
const rawRoutes: { method: string; re: RegExp; handler: (ctx: RawCtx) => Promise<void> }[] = []
function rawRoute(method: string, path: string, handler: (ctx: RawCtx) => Promise<void>) {
  rawRoutes.push({ method, re: new RegExp('^' + path.replace(/:\w+/g, '([^/]+)') + '$'), handler })
}

async function readRaw(req: http.IncomingMessage, limit: number): Promise<Buffer> {
  const declared = Number(req.headers['content-length'] ?? 0)
  if (declared > limit) throw new HttpError(413, 'file_too_large', { mb: Math.round(limit / 1024 / 1024) })
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > limit) throw new HttpError(413, 'file_too_large', { mb: Math.round(limit / 1024 / 1024) })
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks)
}

function cleanName(raw: string | null): string {
  const name = basename(String(raw ?? '').replace(/\\/g, '/'))
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 200)
  return name || 'file'
}

// 올리기: POST /channels/:id/files?name=...&visibility=channel|private&note=...  (본문 = 파일 바이트)
// 에이전트가 채널에 올리는 파일은 채널 설정과 상관없이 늘 마스터 승인을 거친다(로컬 파일이 새지 않게).
rawRoute('POST', '/channels/:id/files', async ({ req, res, viewer, params, query, locale }) => {
  const channelId = params[0]
  requireMember(channelId, viewer)
  const visibility = query.get('visibility') === 'private' ? 'private' : 'channel'
  if (viewer.kind === 'agent' && visibility === 'channel') checkAgentTurn(channelId, viewer)
  const data = await readRaw(req, MAX_FILE)
  if (!data.length) throw new HttpError(400, 'empty_file')
  const mime = String(req.headers['content-type'] ?? '').split(';')[0].trim().slice(0, 100) || 'application/octet-stream'
  const id = randomUUID()
  writeFileSync(join(FILES_DIR, id), data)
  run(
    'INSERT INTO files (id, channel_id, uploader_id, name, mime, size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    id,
    channelId,
    viewer.userId,
    cleanName(query.get('name')),
    mime,
    data.length,
    now(),
  )
  const row = insertMessage({
    channelId,
    authorId: viewer.userId,
    authorKind: viewer.kind,
    agentKind: viewer.kind === 'agent' ? viewer.agentKind : null,
    visibility,
    // 항상 모두 승인을 켠 사람의 에이전트만 바로 올린다
    status: viewer.kind === 'agent' && visibility === 'channel' && !autoApproves(viewer.userId) ? 'pending' : 'sent',
    kind: 'file',
    body: String(query.get('note') ?? '').trim().slice(0, 4000),
    fileId: id,
  })
  emitMessage(row)
  emitChannel(channelId)
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify(msgOf(row, locale)))
})

// 받기: 그 파일이 든 메시지를 볼 수 있는 사람·에이전트만
rawRoute('GET', '/files/:id', async ({ res, viewer, params, query }) => {
  const f = one('SELECT * FROM files WHERE id = ?', params[0])
  const m = f && one('SELECT * FROM messages WHERE file_id = ?', params[0])
  if (!f || !m || !membership(m.channel_id as string, viewer) || !canSee(m, viewer) || m.status === 'rejected')
    throw new HttpError(404, 'file_not_found')
  const inline = query.get('inline') === '1' && /^image\/(png|jpeg|gif|webp)$/.test(f.mime as string)
  res.writeHead(200, {
    'Content-Type': f.mime as string,
    'Content-Length': String(f.size),
    'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.name as string)}`,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, max-age=86400',
  })
  await new Promise<void>((done, fail) => createReadStream(join(FILES_DIR, f.id as string)).on('error', fail).on('end', done).pipe(res))
})

// ── HTTP ──────────────────────────────────────────────────────

async function readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > 2_000_000) throw new HttpError(413, 'body_too_large')
    chunks.push(chunk as Buffer)
  }
  if (!chunks.length) return {}
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    throw new HttpError(400, 'invalid_json')
  }
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Accept-Language')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS')
  if (req.method === 'OPTIONS') {
    res.writeHead(204).end()
    return
  }
  const url = new URL(req.url ?? '/', 'http://localhost')
  const locale = pickLocale(req.headers['accept-language'])
  try {
    const raw = rawRoutes.filter((r) => r.method === req.method).map((r) => ({ r, m: r.re.exec(url.pathname) })).find((x) => x.m)
    if (raw) {
      const viewer = viewerFromToken(req.headers.authorization?.replace(/^Bearer\s+/i, '') ?? null)
      if (!viewer) throw new HttpError(401, 'login_required')
      await raw.r.handler({ req, res, viewer, locale, params: raw.m!.slice(1).map(decodeURIComponent), query: url.searchParams })
      return
    }
    const match = routes
      .filter((r) => r.method === req.method)
      .map((r) => ({ r, m: r.re.exec(url.pathname) }))
      .find((x) => x.m)
    if (!match) throw new HttpError(404, 'route_not_found')
    const auth = req.headers.authorization?.replace(/^Bearer\s+/i, '') ?? null
    const viewer = viewerFromToken(auth)
    if (match.r.auth && !viewer) throw new HttpError(401, 'login_required')
    const body = req.method === 'GET' ? {} : await readBody(req)
    const result = await match.r.handler({
      viewer: viewer!,
      locale,
      params: match.m!.slice(1).map(decodeURIComponent),
      body,
      query: url.searchParams,
    })
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify(result ?? null))
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500
    if (status === 500) console.error(e)
    if (res.headersSent) return void res.destroy() // 파일을 보내다 실패한 경우
    res
      .writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
      .end(
        JSON.stringify(
          e instanceof HttpError
            ? { error: errorText(locale, e.code, e.params), code: e.code }
            : { error: errorText(locale, 'server_error'), code: 'server_error' },
        ),
      )
  }
})

// ── WebSocket ────────────────────────────────────────────────

const wss = new WebSocketServer({ noServer: true })

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const viewer = url.pathname === '/ws' ? viewerFromToken(url.searchParams.get('token')) : null
  if (!viewer) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
    socket.destroy()
    return
  }
  const locale = pickLocale(url.searchParams.get('locale') ?? req.headers['accept-language'])
  wss.handleUpgrade(req, socket, head, (ws) => {
    const conn: Conn = { ws, viewer, locale }
    conns.add(conn)
    let alive = true
    ws.on('pong', () => (alive = true))
    const ping = setInterval(() => {
      if (!alive) return ws.terminate()
      alive = false
      ws.ping()
    }, 30_000)
    if (viewer.kind === 'agent') {
      agentSockets.set(viewer.userId, (agentSockets.get(viewer.userId) ?? 0) + 1)
      emitPresence(viewer.userId)
    }
    send(conn, { type: 'hello', me: userOf(getUser(viewer.userId)), kind: viewer.kind })
    if (viewer.kind === 'human') for (const activity of activities.get(viewer.userId)?.values() ?? []) send(conn, { type: 'agent_activity', activity })
    ws.on('close', () => {
      clearInterval(ping)
      conns.delete(conn)
      if (viewer.kind === 'agent') {
        const left = Math.max(0, (agentSockets.get(viewer.userId) ?? 1) - 1)
        agentSockets.set(viewer.userId, left)
        if (left === 0) clearActivities(viewer.userId) // 에이전트가 끊기면 '작업 중'이 남지 않게
        emitPresence(viewer.userId)
      }
    })
  })
})

server.listen(PORT, () => console.log(`relay listening on http://localhost:${PORT} (db ${DB_PATH})`))
