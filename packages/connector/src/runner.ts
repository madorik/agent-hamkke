#!/usr/bin/env node
// 러너: 데스크톱 앱이 에이전트(Claude Code·Codex)를 직접 돌린다.
//
// Claude Code channels(연구 미리보기)는 Team/Enterprise 계정에선 조직 관리자가 켜야 하고,
// VS Code 확장·`-p` 모드에선 개발용 channel 플래그를 아예 무시한다. 그래서 세션에 이벤트를
// 밀어 넣는 대신, 러너가 중계 서버 이벤트를 받아 에이전트 세션에 사용자 턴으로 넣는다.
//
// 여기는 에이전트와 상관없는 일을 한다. 에이전트 프로세스와 주고받는 일은 엔진(engine-*.ts)이 한다.
// - 메신저 이벤트를 모아(1.5초) 한 턴으로 보낸다. 답할 필요 없는 알림은 다음 이벤트에 얹는다.
// - 마스터가 에이전트에게만 보낸 지시의 결과(턴의 마지막 답)는 '나에게만' 메시지로 채팅에 올린다.
// - 맡은 일(마스터의 지시·@요청)을 하는 동안 무엇을 하는지(생각 중·노션 보는 중·허락 대기)를 마스터 화면에 알린다.
//   채널 대화에 반응하는 것은 알리지 않는다(도구 허락 대기만은 늘 알린다).
// - 도구 실행 허락은 데스크톱 승인함으로 넘기고 마스터의 답을 엔진에 돌려준다.
// - stdout 엔 앱이 읽는 상태 줄(JSON)만, 로그는 stderr 로.
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { homedir } from 'node:os'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import type { AgentActivityState, Message, PermissionRequest } from '@ah/protocol'
import { loadConfig, loadState, profile, profileDir, saveState } from './config.ts'
import { connectRelay, createApi, log } from './relay.ts'
import { createInbox, renderChannelTag, type Delivery } from './inbox.ts'
import { M, NOTHING_TO_DO } from './i18n.ts'
import type { Engine, Host, PermissionAsk, RunnerStatus } from './engine.ts'
import { createClaudeEngine } from './engine-claude.ts'
import { createCodexEngine } from './engine-codex.ts'

const config = loadConfig()
if (!config) {
  log('no config file for profile:', profile())
  process.exit(2)
}

const AGENT = config.agentKind === 'codex' ? 'codex' : 'claude-code'
const SERVER_NAME = profile() === 'default' ? 'agent-hamkke' : `agent-hamkke-${profile()}`
const WORKDIR = config.workdir || homedir()
// 배포판은 묶은 runner.mjs 옆의 claude-channel.mjs, 저장소에서 돌 때는 TS 파일
const CONNECTOR = fileURLToPath(new URL(import.meta.url.endsWith('.mjs') ? './claude-channel.mjs' : './claude-channel.ts', import.meta.url))
// 배포판에선 앱(Electron)이 Node 대신 러너를 돌린다(ELECTRON_RUN_AS_NODE). MCP 서버도 같은 실행 파일로 띄운다.
const AS_NODE: Record<string, string> = process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}
const PERMISSION_TTL = 10 * 60_000 // 중계 서버와 같게
const BATCH_MS = 1500 // 한꺼번에 들어온 이벤트는 한 턴으로
// 처음 접속하는 계정은 최근 1시간 안의 @요청까지 받는다
const FIRST_LOOKBACK = 60 * 60_000

/** 앱(데스크톱 메인 프로세스)이 읽는 상태 줄 */
function status(state: RunnerStatus, message?: string) {
  process.stdout.write(JSON.stringify({ state, message, at: Date.now() }) + '\n')
}

/** 앱에 알리는 그 밖의 소식(모델 목록·지금 모델) */
function emit(obj: Record<string, unknown>) {
  process.stdout.write(JSON.stringify({ ...obj, at: Date.now() }) + '\n')
}

const api = createApi(config)
const inbox = createInbox(api)

// ── 턴: 엔진에 보낸 사용자 메시지 하나. 엔진은 보낸 순서대로 끝낸다 ──────

interface Turn {
  /** 이 턴이 다루는 채널들(작업 중 표시) */
  channels: Set<string>
  /** 마스터가 에이전트에게만 보낸 지시가 있으면 그 채널. 턴의 마지막 답을 여기에 올린다. */
  masterChannel: string | null
  /** 맡은 일(마스터의 지시·나를 지목한 @요청)이 있는 채널. '작업 중'은 이 채널에만 보인다. */
  tasks: Set<string>
  /** 이 턴에서 report_to_master 로 이미 보고한 채널(중복 방지) */
  reported: Set<string>
}

let turns: Turn[] = [] // 엔진에 보냈고 아직 안 끝난 턴

// ── 작업 중 표시 ───────────────────────────────────────────────

let shown = new Set<string>()
let shownKey = ''

function postActivity(channelIds: string[], state: AgentActivityState, detail = '', permissionId: string | null = null) {
  if (!channelIds.length) return
  api('POST', '/agent-activity', { channelIds, state, detail, permissionId }).catch((e) => log('failed to post activity', e))
}

// 마스터가 정한 결정(decision)도 마스터의 지시처럼 다룬다
const fromMaster = (d: Delivery) => d.meta.kind === 'master' || d.meta.kind === 'decision'
const isTask = (d: Delivery) => fromMaster(d) || d.meta.kind === 'request'

/** 아직 시작하지 않은(뒤에 줄 선) 맡은 일의 채널. 앞 턴이 끝나도 '작업 중'을 내리지 않는다. */
function queuedTasks(): Set<string> {
  const s = new Set<string>()
  for (const t of turns.slice(1)) for (const c of t.tasks) s.add(c)
  for (const d of batch) if (isTask(d)) s.add(d.meta.channel_id)
  return s
}

// 채널 대화에 반응하는 턴은 '작업 중'을 보이지 않는다(마스터가 시킨 일과 @요청만). 도구 허락 대기는 늘 보인다.
function showActivity(state: 'working' | 'waiting', detail: string, permissionId: string | null = null) {
  const t = turns[0]
  if (!t) return
  const channels = state === 'waiting' ? t.channels : t.tasks
  const key = JSON.stringify([state, detail, permissionId, [...channels]])
  if (key === shownKey) return
  shownKey = key
  const queued = queuedTasks()
  const stale = [...shown].filter((c) => !channels.has(c) && !queued.has(c))
  postActivity(stale, 'idle')
  shown = new Set([...channels, ...[...shown].filter((c) => queued.has(c))])
  postActivity([...channels], state, detail, permissionId)
}

/** keepQueued: 줄 선 일이 있는 채널은 남긴다(턴 사이). 끝낼 때는 모두 내린다. */
function clearActivity(keepQueued = true) {
  const queued = keepQueued ? queuedTasks() : new Set<string>()
  postActivity([...shown].filter((c) => !queued.has(c)), 'idle')
  shown = new Set([...shown].filter((c) => queued.has(c)))
  shownKey = ''
}

const SERVICES: [RegExp, keyof typeof M.services][] = [
  [/notion/i, 'notion'],
  [/atlassian|jira|confluence/i, 'atlassian'],
  [/slack/i, 'slack'],
  [/gmail|outlook|mail/i, 'mail'],
  [/calendar/i, 'calendar'],
  [/drive|docs|sheets/i, 'drive'],
  [/figma/i, 'figma'],
  [/sentry/i, 'sentry'],
  [/linear/i, 'linear'],
  [/github/i, 'github'],
]

/** 도구 이름(Claude 식: Bash, mcp__서버__도구) → 작업 상태 문구 */
function describeTool(name: string): string {
  const own = name.startsWith(`mcp__${SERVER_NAME}__`) ? name.slice(`mcp__${SERVER_NAME}__`.length) : null
  if (own) return M.ownTool[own] ?? M.ownToolOther
  const write = /create|update|edit|add|delete|move|send|post|upload|transition|comment/i.test(name)
  for (const [re, key] of SERVICES) if (re.test(name)) return M.serviceUse(M.services[key], write)
  if (name.startsWith('mcp__')) return M.externalTool(name.split('__')[1])
  return M.builtinTool[name] ?? M.usingTool(name)
}

// ── 마스터에게 결과 올리기 ─────────────────────────────────────

async function replyToMaster(channelId: string, body: string) {
  try {
    await api<Message>('POST', `/channels/${channelId}/messages`, { body, visibility: 'private' })
  } catch (e) {
    log('failed to post the result to the master', e)
  }
}

function afterTurns() {
  if (turns.length) showActivity('working', M.thinking)
  else clearActivity()
}

// ── 답 흘려 보내기 ────────────────────────────────────────────
// 마스터 지시의 답을 에이전트가 쓰는 대로 앱에 보낸다(stdout 줄, 앱이 바로 그린다). 중계 서버는 거치지 않는다.
// 다 쓰면 러너가 답을 '나에게만' 메시지로 올리고, 앱은 그 메시지로 바꿔 그린다.

const STREAM_MS = 60 // 이보다 자주 보내지 않는다
let streamChannel: string | null = null
let streamText = ''
let streamTimer: NodeJS.Timeout | undefined

function flushStream() {
  streamTimer = undefined
  if (streamChannel) emit({ type: 'reply_stream', channelId: streamChannel, text: streamText })
}

function onReplyText(text: string) {
  const t = turns[0]
  const channel = t?.masterChannel && !t.reported.has(t.masterChannel) ? t.masterChannel : null
  if (!channel) return
  streamChannel = channel
  streamText = text
  if (!streamTimer) streamTimer = setTimeout(flushStream, STREAM_MS)
}

/** 흘려 보내기를 멈춘다(앱에는 아직 안 알림). 흘려 보내던 채널을 돌려준다 */
function stopStream(): string | null {
  clearTimeout(streamTimer)
  streamTimer = undefined
  const channel = streamChannel
  streamChannel = null
  streamText = ''
  return channel
}

/** 앱에 그 채널의 흘려 보내기가 끝났다고 알린다(그새 같은 채널에서 다음 답을 쓰기 시작했으면 두고) */
function endStream(channel: string | null) {
  if (channel && channel !== streamChannel) emit({ type: 'reply_stream', channelId: channel, text: null })
}

// ── 도구 실행 허락: 엔진 → 데스크톱 승인함 → 엔진 ─────────────

interface PendingPermission {
  label: string
  timer: NodeJS.Timeout
  resolve: (r: { allow: boolean; message: string }) => void
}
const permissions = new Map<string, PendingPermission>()

function preview(input: unknown): string {
  if (input && typeof input === 'object' && 'command' in input) return String((input as { command: unknown }).command)
  try {
    return JSON.stringify(input, null, 2)
  } catch {
    return String(input)
  }
}

function askPermission(p: PermissionAsk): Promise<{ allow: boolean; message: string }> {
  return new Promise((resolve) => {
    const id = randomBytes(6).toString('base64url') // 중계 서버는 16자까지 받는다
    const label = describeTool(p.rawName)
    const timer = setTimeout(() => decide(id, 'deny', M.permissionTimeout), PERMISSION_TTL)
    permissions.set(id, { label, timer, resolve })
    api<PermissionRequest>('POST', '/permission-requests', {
      requestId: id,
      toolName: p.toolName,
      description: p.description,
      inputPreview: preview(p.input).slice(0, 8000),
    })
      .then((r) => {
        // 마스터가 항상 모두 승인을 켜 두었으면 중계 서버가 바로 허용해 돌려준다
        if (r.status === 'allow') return decide(id, 'allow')
        if (permissions.has(id)) showActivity('waiting', M.waitingPermission(label), r.id)
      })
      .catch((e) => decide(id, 'deny', M.permissionPostFailed(e instanceof Error ? e.message : String(e))))
  })
}

function decide(id: string, behavior: 'allow' | 'deny', message = M.permissionDenied) {
  const perm = permissions.get(id)
  if (!perm) return
  permissions.delete(id)
  clearTimeout(perm.timer)
  perm.resolve({ allow: behavior === 'allow', message })
  if (turns.length) showActivity('working', behavior === 'allow' ? perm.label : M.thinking)
}

// ── 엔진 ──────────────────────────────────────────────────────

let state = loadState()
// 폴더나 에이전트가 바뀌면 이전 세션을 이어 쓸 수 없다
if (state.workdir !== WORKDIR || (state.agent ?? 'claude-code') !== AGENT) state = { workdir: WORKDIR, agent: AGENT, seen: state.seen }

const host: Host = {
  workdir: WORKDIR,
  downloadDir: join(profileDir(), 'files'),
  serverName: SERVER_NAME,
  mcp: {
    command: process.execPath,
    args: ['--disable-warning=ExperimentalWarning', CONNECTOR],
    env: { AH_PROFILE: profile(), AH_RUNNER: '1', ...AS_NODE },
  },
  get state() {
    return state
  },
  set state(next) {
    state = next
  },
  saveState: () => saveState(state),
  log,
  status,
  emit,
  toolUsed(rawName, input) {
    const channelId = (input as { channel_id?: unknown } | null)?.channel_id
    if (rawName === `mcp__${SERVER_NAME}__report_to_master` && typeof channelId === 'string') {
      turns[0]?.reported.add(channelId)
      // 도구로 이미 보고했으니 그 뒤에 쓰는 글은 흘려 보이지 않는다
      if (channelId === streamChannel) endStream(stopStream())
    }
    if (!permissions.size) showActivity('working', describeTool(rawName))
  },
  replyText: onReplyText,
  turnDone({ ok, text }) {
    if (!ok) status('error', text)
    else status(turns.length > 1 ? 'working' : 'online')
    const t = turns.shift()
    const streamed = stopStream()
    let posted: Promise<void> = Promise.resolve()
    if (t?.masterChannel && !t.reported.has(t.masterChannel)) {
      if (!ok) posted = replyToMaster(t.masterChannel, M.turnFailed(text || M.unknownError))
      else if (text && !NOTHING_TO_DO.test(text)) posted = replyToMaster(t.masterChannel, text)
    }
    // 답이 채팅에 뜬 뒤에 흘려 보이던 글과 '작업 중'을 내린다(사이에 아무것도 없는 순간이 없게)
    void posted.then(() => {
      endStream(streamed)
      afterTurns()
    })
  },
  mergeTurns(n) {
    if (n <= 1) return
    const lost = turns.splice(0, n)
    turns.unshift({
      channels: new Set(lost.flatMap((t) => [...t.channels])),
      masterChannel: lost.findLast((t) => t.masterChannel)?.masterChannel ?? null,
      tasks: new Set(lost.flatMap((t) => [...t.tasks])),
      reported: new Set(),
    })
  },
  failTurns(n, message) {
    endStream(stopStream())
    for (const t of turns.splice(0, n)) if (t.masterChannel) void replyToMaster(t.masterChannel, message)
    afterTurns()
  },
  askPermission,
  waitingPermission: () => permissions.size > 0,
  dropPermissions() {
    for (const [id, perm] of permissions) {
      clearTimeout(perm.timer)
      permissions.delete(id)
      perm.resolve({ allow: false, message: M.permissionDenied })
    }
  },
}

const BIN = process.env.AH_AGENT_BIN || process.env.AH_CLAUDE_BIN || (AGENT === 'codex' ? 'codex' : 'claude')
const MODEL = config.model && config.model !== 'default' ? config.model : 'default'
const engine: Engine = AGENT === 'codex' ? createCodexEngine(host, BIN, MODEL) : createClaudeEngine(host, BIN, MODEL)

// 마지막에 받은 메시지 시각(계정별). 자주 오니 모아서 적는다.
let seenTimer: NodeJS.Timeout | undefined
function markSeen(userId: string, at: number) {
  if ((state.seen?.[userId] ?? 0) >= at) return
  state.seen = { ...state.seen, [userId]: at }
  clearTimeout(seenTimer)
  seenTimer = setTimeout(() => saveState(state), 2000)
}

function sendTurn(text: string, turn: Turn) {
  turns.push(turn)
  if (turns.length === 1) showActivity('working', M.thinking)
  engine.submit(text)
}

// ── 메신저 이벤트 → 에이전트 턴 ──────────────────────────────

let batch: Delivery[] = []
let held: Delivery[] = [] // 답할 필요 없는 알림은 다음 이벤트에 얹어 보낸다(턴 낭비 방지)
let batchTimer: NodeJS.Timeout | undefined

const passive = (d: Delivery) => d.meta.kind === 'system' || d.meta.kind === 'task' || (d.meta.kind === 'approval' && d.meta.result === 'approved')

function enqueue(d: Delivery) {
  if (passive(d)) {
    held.push(d)
    if (held.length > 30) held.shift()
    return
  }
  batch.push(d)
  // 맡은 일(마스터 지시·@요청)은 바로 '작업 중'을 보여 준다(묶는 1.5초 동안에도, 앞 턴이 일하는 동안에도)
  if (isTask(d)) {
    postActivity([d.meta.channel_id], 'working', fromMaster(d) ? M.readingInstruction : M.readingRequest)
    shown.add(d.meta.channel_id)
  }
  clearTimeout(batchTimer)
  batchTimer = setTimeout(flush, BATCH_MS)
}

function flush() {
  const all = [...held, ...batch]
  const active = batch
  held = []
  batch = []
  if (!active.length) return
  log(`${all.length} event(s) → ${engine.name}`)
  sendTurn(all.map(renderChannelTag).join('\n\n'), {
    channels: new Set(active.map((d) => d.meta.channel_id)),
    masterChannel: active.findLast(fromMaster)?.meta.channel_id ?? null,
    tasks: new Set(active.filter(isTask).map((d) => d.meta.channel_id)),
    reported: new Set(),
  })
}

status('connecting')
connectRelay(
  config,
  async (ev) => {
    if (ev.type === 'hello') status(engine.running() ? 'online' : 'idle')
    if (ev.type === 'permission_verdict') return decide(ev.requestId, ev.behavior)
    const d = await inbox.handle(ev)
    if (d) enqueue(d)
    const me = inbox.me
    if (!me) return
    if (ev.type === 'message') markSeen(me.id, ev.message.createdAt)
    // 이어 받은 연결(resumed)은 놓친 이벤트가 없다
    if (ev.type === 'hello' && !ev.resumed) {
      // 꺼져 있는 동안 나(마스터)를 지목한 요청
      const missed = await inbox.missed(state.seen?.[me.id] ?? Date.now() - FIRST_LOOKBACK)
      if (missed.length) log(`${missed.length} missed request(s) while offline`)
      for (const m of missed) enqueue(m)
      markSeen(me.id, Date.now())
    }
  },
  () => shutdown(0),
)

function shutdown(code: number) {
  status('stopped')
  for (const id of [...permissions.keys()]) decide(id, 'deny', M.appQuit)
  endStream(stopStream())
  clearActivity(false)
  if (!engine.running()) setTimeout(() => process.exit(code), 300) // 마지막 상태 전달을 잠깐 기다린다
  else void engine.stop().then(() => process.exit(code))
}

process.on('SIGTERM', () => shutdown(0))
process.on('SIGINT', () => shutdown(0))
// 앱이 강제 종료돼도 러너가 홀로 남아 '접속 중'으로 보이지 않게, 앱이 쥔 파이프가 닫히면 같이 내려간다.
// 앱이 같은 파이프로 명령도 보낸다: {"cmd":"set_model","model":"sonnet"}
if (process.env.AH_EXIT_WITH_PARENT === '1') {
  process.stdin.on('error', () => shutdown(0))
  createInterface({ input: process.stdin })
    .on('line', (line) => {
      try {
        const c = JSON.parse(line) as { cmd?: string; model?: string }
        if (c.cmd === 'set_model' && typeof c.model === 'string') engine.setModel(c.model)
      } catch {
        /* 모르는 줄은 무시 */
      }
    })
    .on('close', () => shutdown(0))
}

engine.discoverModels()
