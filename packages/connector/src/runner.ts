#!/usr/bin/env node
// 러너: 데스크톱 앱이 Claude Code 를 직접 돌린다.
//
// Claude Code channels(연구 미리보기)는 Team/Enterprise 계정에선 조직 관리자가 켜야 하고,
// VS Code 확장·`-p` 모드에선 개발용 channel 플래그를 아예 무시한다. 그래서 세션에 이벤트를
// 밀어 넣는 대신, 러너가 중계 서버 이벤트를 받아 `claude -p --input-format stream-json` 세션에
// 사용자 턴으로 넣는다. 세션 id 를 저장해 다시 띄울 때 이어 쓴다.
//
// - 도구(send_message 등)는 같은 세션에 커넥터(AH_RUNNER=1, 도구만)를 MCP 로 붙여 준다.
// - 마스터가 에이전트에게만 보낸 지시의 결과(턴의 마지막 답)는 '나에게만' 메시지로 채팅에 올린다.
// - 지금 무엇을 하는지(생각 중·노션 보는 중·허락 대기)를 마스터 화면에 알린다.
// - 도구 실행 권한 확인(can_use_tool)은 데스크톱 승인함으로 넘기고 마스터의 답을 돌려준다.
// - stdout 엔 앱이 읽는 상태 줄(JSON)만, 로그는 stderr 로.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { homedir } from 'node:os'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import type { AgentActivityState, Message, PermissionRequest } from '@ah/protocol'
import { loadConfig, loadState, profile, profileDir, saveState, type RunnerState } from './config.ts'
import { connectRelay, createApi, log } from './relay.ts'
import { createInbox, renderChannelTag, type Delivery } from './inbox.ts'
import { M, NOTHING_TO_DO } from './i18n.ts'

const config = loadConfig()
if (!config) {
  log('no config file for profile:', profile())
  process.exit(2)
}

const SERVER_NAME = profile() === 'default' ? 'agent-hamkke' : `agent-hamkke-${profile()}`
const CLAUDE = process.env.AH_CLAUDE_BIN || 'claude'
const WORKDIR = config.workdir || homedir()
const CONNECTOR = fileURLToPath(new URL('./claude-channel.ts', import.meta.url))
const DOWNLOAD_DIR = join(profileDir(), 'files') // download_file 이 받는 곳. Read 할 때 묻지 않게 세션에 더한다.
const PERMISSION_TTL = 10 * 60_000 // 중계 서버와 같게
const BATCH_MS = 1500 // 한꺼번에 들어온 이벤트는 한 턴으로
const IDLE_MS = 15 * 60_000 // 한동안 조용하면 내렸다가 다음 이벤트 때 이어서 띄운다
const MAX_FAILS = 5

const TOOL = (name: string) => `mcp__${SERVER_NAME}__${name}`
const MESSENGER_TOOLS = ['send_message', 'report_to_master', 'propose_document', 'share_file', 'download_file', 'read_channel', 'read_document', 'list_channels']
const RUNNER_PROMPT = M.runnerPrompt(MESSENGER_TOOLS.map(TOOL).join(', '), `select:${TOOL('send_message')},${TOOL('report_to_master')}`)

/** 앱(데스크톱 메인 프로세스)이 읽는 상태 줄 */
function status(state: 'connecting' | 'online' | 'starting' | 'working' | 'idle' | 'error' | 'stopped', message?: string) {
  process.stdout.write(JSON.stringify({ state, message, at: Date.now() }) + '\n')
}

/** 앱에 알리는 그 밖의 소식(모델 목록·지금 모델) */
function emit(obj: Record<string, unknown>) {
  process.stdout.write(JSON.stringify({ ...obj, at: Date.now() }) + '\n')
}

// ── 모델 ───────────────────────────────────────────────────────
// 고를 수 있는 모델은 계정·버전마다 다르다. Claude Code 에 직접 물어(initialize) 그대로 쓴다. 토큰은 쓰지 않는다.

export interface AgentModel {
  value: string
  label: string
  description: string
  resolved: string
}

let model = config.model && config.model !== 'default' ? config.model : 'default'
let modelRequest = 0

function discoverModels() {
  const p = spawn(CLAUDE, ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--strict-mcp-config', '--tools', ''], {
    cwd: WORKDIR,
    stdio: ['pipe', 'pipe', 'ignore'],
    env: { ...process.env, AH_RUNNER_SESSION: profile() },
  })
  const done = setTimeout(() => p.kill(), 30_000)
  p.on('error', (e) => log('could not get the model list:', e.message))
  p.on('exit', () => clearTimeout(done))
  createInterface({ input: p.stdout }).on('line', (line) => {
    let o: Record<string, any>
    try {
      o = JSON.parse(line)
    } catch {
      return
    }
    if (o.type !== 'control_response' || o.response?.request_id !== 'models') return
    const list: AgentModel[] = (o.response.response?.models ?? []).map((m: Record<string, any>) => ({
      value: String(m.value),
      label: String(m.displayName ?? m.value),
      description: String(m.description ?? ''),
      resolved: String(m.resolvedModel ?? m.value),
    }))
    if (list.length) {
      emit({ type: 'models', agentKind: 'claude-code', models: list })
      try {
        writeFileSync(join(profileDir(), 'models.json'), JSON.stringify({ agentKind: 'claude-code', models: list, at: Date.now() }, null, 2))
      } catch {
        /* 캐시는 없어도 된다 */
      }
    }
    p.stdin.end()
    p.kill()
  })
  p.stdin.write(JSON.stringify({ type: 'control_request', request_id: 'models', request: { subtype: 'initialize' } }) + '\n')
}

/** 앱이 모델을 바꾸면: 떠 있는 세션엔 바로(set_model), 아니면 다음에 띄울 때 --model 로 */
function setModel(next: string) {
  model = next || 'default'
  log('model →', model)
  if (child && child.stdin.writable) {
    write(child, { type: 'control_request', request_id: `set_model_${++modelRequest}`, request: { subtype: 'set_model', model } })
  }
}

const api = createApi(config)
const inbox = createInbox(api)

// ── 턴: Claude 에 넣은 사용자 메시지 하나 = result 하나 (보낸 순서대로 끝난다) ──────

interface Turn {
  /** 이 턴이 다루는 채널들(작업 중 표시) */
  channels: Set<string>
  /** 마스터가 에이전트에게만 보낸 지시가 있으면 그 채널. 턴의 마지막 답을 여기에 올린다. */
  masterChannel: string | null
  /** 이 턴에서 report_to_master 로 이미 보고한 채널(중복 방지) */
  reported: Set<string>
}

const turns: Turn[] = [] // 지금 Claude 프로세스에 들어가 결과를 기다리는 턴
const outbox: { line: string; turn: Turn }[] = [] // Claude 가 떠 있지 않아 아직 못 넣은 턴
const sentLines = new WeakMap<Turn, string>() // 저장된 세션을 못 찾아 새로 시작할 때 다시 넣으려고 기억

// ── 작업 중 표시 ───────────────────────────────────────────────

let shown = new Set<string>()
let shownKey = ''

function postActivity(channelIds: string[], state: AgentActivityState, detail = '', permissionId: string | null = null) {
  if (!channelIds.length) return
  api('POST', '/agent-activity', { channelIds, state, detail, permissionId }).catch((e) => log('failed to post activity', e))
}

function showActivity(state: 'working' | 'waiting', detail: string, permissionId: string | null = null) {
  const t = turns[0]
  if (!t) return
  const key = JSON.stringify([state, detail, permissionId, [...t.channels]])
  if (key === shownKey) return
  shownKey = key
  const stale = [...shown].filter((c) => !t.channels.has(c))
  postActivity(stale, 'idle')
  shown = new Set(t.channels)
  postActivity([...t.channels], state, detail, permissionId)
}

function clearActivity() {
  postActivity([...shown], 'idle')
  shown = new Set()
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

function finishTurn(o: Record<string, any>) {
  const t = turns.shift()
  if (t?.masterChannel && !t.reported.has(t.masterChannel)) {
    const failed = o.is_error || o.subtype !== 'success'
    const text = String(o.result ?? '').trim()
    if (failed) void replyToMaster(t.masterChannel, M.turnFailed(text || String(o.subtype ?? M.unknownError)))
    else if (text && !NOTHING_TO_DO.test(text)) void replyToMaster(t.masterChannel, text)
  }
  if (turns.length) showActivity('working', M.thinking)
  else clearActivity()
}

// ── Claude 세션 ─────────────────────────────────────────────────

let state: RunnerState = loadState()
if (state.workdir !== WORKDIR) state = { workdir: WORKDIR } // 폴더가 바뀌면 이전 세션을 이어 쓸 수 없다

let child: ChildProcessWithoutNullStreams | null = null
let initSeen = false
let stopping = false
let fails = 0
let idleTimer: NodeJS.Timeout | undefined
const stderrTail: string[] = []

interface PendingPermission {
  owner: ChildProcessWithoutNullStreams
  claudeRequestId: string
  input: unknown
  label: string
  timer: NodeJS.Timeout
}
const permissions = new Map<string, PendingPermission>()

function write(p: ChildProcessWithoutNullStreams | null, obj: unknown) {
  if (p && p.stdin.writable) p.stdin.write(JSON.stringify(obj) + '\n')
}

function feed(p: ChildProcessWithoutNullStreams, entry: { line: string; turn: Turn }) {
  turns.push(entry.turn)
  p.stdin.write(entry.line)
  if (turns.length === 1) showActivity('working', M.thinking)
}

function startClaude() {
  if (child) return
  const mcpConfig = {
    mcpServers: {
      [SERVER_NAME]: {
        type: 'stdio',
        command: process.execPath,
        args: ['--disable-warning=ExperimentalWarning', CONNECTOR],
        env: { AH_PROFILE: profile(), AH_RUNNER: '1' },
      },
    },
  }
  const args = [
    '-p',
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--verbose',
    '--permission-prompt-tool', 'stdio',
    '--mcp-config', JSON.stringify(mcpConfig),
    '--allowedTools', `mcp__${SERVER_NAME}`,
    '--add-dir', DOWNLOAD_DIR,
    '--append-system-prompt', RUNNER_PROMPT,
  ]
  if (model !== 'default') args.push('--model', model)
  const resuming = !!state.sessionId
  if (resuming) args.push('--resume', state.sessionId!)

  mkdirSync(DOWNLOAD_DIR, { recursive: true })
  log(`Claude start (${WORKDIR}${resuming ? `, resuming session ${state.sessionId}` : ', new session'})`)
  status('starting')
  initSeen = false
  stderrTail.length = 0
  const p = spawn(CLAUDE, args, {
    cwd: WORKDIR,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, AH_PROFILE: profile(), AH_RUNNER_SESSION: profile() },
  })
  child = p
  const startedAt = Date.now()

  p.stdin.on('error', (e) => log('Claude stdin error', e.message))
  createInterface({ input: p.stderr }).on('line', (line) => {
    if (!line.trim()) return
    stderrTail.push(line)
    if (stderrTail.length > 20) stderrTail.shift()
  })
  createInterface({ input: p.stdout }).on('line', (line) => onClaudeLine(p, line))

  p.on('error', (e) => {
    log('could not start Claude:', e.message)
    if (child === p) child = null
    const lost = turns.splice(0)
    clearActivity()
    for (const t of lost) if (t.masterChannel) void replyToMaster(t.masterChannel, M.claudeStartFailed(e.message))
    status('error', M.claudeStartFailedBin(CLAUDE, e.message))
  })
  p.on('exit', (code, signal) => {
    if (child === p) child = null
    for (const [id, perm] of permissions) if (perm.owner === p) (clearTimeout(perm.timer), permissions.delete(id))
    const unfinished = turns.splice(0)
    clearActivity()
    const tail = stderrTail.slice(-5).join('\n')
    log(`Claude exited (code=${code}${signal ? `, ${signal}` : ''})${code ? '\n' + tail : ''}`)

    if (stopping) return
    // 이어 쓸 세션이 없어졌으면(정리·다른 PC 등) 새 세션으로 바로 다시. 못 끝낸 턴은 그대로 다시 넣는다.
    if (resuming && !initSeen && code !== 0 && /no conversation found|session.*not found/i.test(tail)) {
      log('saved session not found; starting a new session.')
      state = { workdir: WORKDIR }
      saveState(state)
      for (const turn of unfinished.reverse()) {
        const line = sentLines.get(turn)
        if (line) outbox.unshift({ line, turn: { ...turn, reported: new Set() } })
      }
      return startClaude()
    }
    if (code === 0 && !unfinished.length && !outbox.length) return status('idle') // 유휴 종료
    fails = Date.now() - startedAt > 60_000 ? 1 : fails + 1
    if (fails > MAX_FAILS) {
      status('error', tail || M.claudeKeepsExiting(code))
      for (const t of unfinished) if (t.masterChannel) void replyToMaster(t.masterChannel, M.claudeStopped(tail))
      fails = 0
      return // 다음 이벤트 때 다시 시도
    }
    if (unfinished.length) {
      const merged: Turn = {
        channels: new Set(unfinished.flatMap((t) => [...t.channels])),
        masterChannel: unfinished.findLast((t) => t.masterChannel)?.masterChannel ?? null,
        reported: new Set(),
      }
      outbox.unshift({
        line: userLine(M.sessionRestarted),
        turn: merged,
      })
    }
    setTimeout(() => outbox.length && startClaude(), 1000 * 2 ** (fails - 1))
  })

  for (const entry of outbox.splice(0)) feed(p, entry)
  if (turns.length) status('working')
}

function onClaudeLine(p: ChildProcessWithoutNullStreams, line: string) {
  let o: Record<string, any>
  try {
    o = JSON.parse(line)
  } catch {
    return
  }
  switch (o.type) {
    case 'system':
      if (o.subtype === 'init' && typeof o.session_id === 'string') {
        initSeen = true
        if (typeof o.model === 'string') emit({ type: 'model', active: o.model })
        if (state.sessionId !== o.session_id) {
          state = { sessionId: o.session_id, workdir: WORKDIR }
          saveState(state)
        }
      }
      break
    case 'assistant':
      for (const c of o.message?.content ?? []) {
        if (c.type === 'tool_use') {
          log('tool:', c.name)
          if (c.name === TOOL('report_to_master') && typeof c.input?.channel_id === 'string') turns[0]?.reported.add(c.input.channel_id)
          if (!permissions.size) showActivity('working', describeTool(c.name))
        } else if (c.type === 'text' && c.text?.trim()) log('Claude:', c.text.slice(0, 300))
      }
      break
    case 'result':
      fails = 0
      if (o.is_error || o.subtype !== 'success') {
        const msg = String(o.result ?? o.subtype ?? M.unknownError)
        log('turn failed:', msg)
        status('error', msg)
      } else status(turns.length > 1 ? 'working' : 'online')
      finishTurn(o)
      armIdle()
      break
    case 'control_request':
      void onControlRequest(p, o)
      break
    case 'control_response': {
      const r = o.response ?? {}
      if (typeof r.request_id === 'string' && r.request_id.startsWith('set_model_')) {
        if (r.subtype === 'success') emit({ type: 'model', active: r.response?.model ?? model })
        else {
          log('could not switch models:', r.error)
          status('error', M.modelChangeFailed(String(r.error ?? M.unknownError)))
        }
      }
      break
    }
  }
}

function armIdle() {
  clearTimeout(idleTimer)
  idleTimer = setTimeout(() => {
    if (child && !turns.length && !permissions.size && !outbox.length) {
      log('idle for a while; stopping Claude until the next event.')
      child.stdin.end()
    }
  }, IDLE_MS)
}

function userLine(text: string) {
  return JSON.stringify({ type: 'user', message: { role: 'user', content: text } }) + '\n'
}

function sendTurn(text: string, turn: Turn) {
  clearTimeout(idleTimer)
  const entry = { line: userLine(text), turn }
  sentLines.set(turn, entry.line)
  if (child && child.stdin.writable) {
    feed(child, entry)
    status('working')
  } else {
    outbox.push(entry)
    startClaude()
  }
}

// ── 도구 실행 권한: Claude → 데스크톱 승인함 → Claude ─────────────

function preview(input: unknown): string {
  if (input && typeof input === 'object' && 'command' in input) return String((input as { command: unknown }).command)
  try {
    return JSON.stringify(input, null, 2)
  } catch {
    return String(input)
  }
}

async function onControlRequest(p: ChildProcessWithoutNullStreams, o: Record<string, any>) {
  const req = o.request ?? {}
  if (req.subtype !== 'can_use_tool') {
    write(p, { type: 'control_response', response: { subtype: 'error', request_id: o.request_id, error: M.unsupportedRequest(String(req.subtype)) } })
    return
  }
  const id = randomBytes(6).toString('base64url') // 중계 서버는 16자까지 받는다
  const label = describeTool(String(req.tool_name ?? ''))
  const timer = setTimeout(() => decide(id, 'deny', M.permissionTimeout), PERMISSION_TTL)
  permissions.set(id, { owner: p, claudeRequestId: o.request_id, input: req.input, label, timer })
  log('permission request:', req.tool_name)
  try {
    const r = await api<PermissionRequest>('POST', '/permission-requests', {
      requestId: id,
      toolName: req.display_name ?? req.tool_name,
      description: req.description ?? req.decision_reason ?? '',
      inputPreview: preview(req.input).slice(0, 8000),
    })
    // 마스터가 항상 모두 승인을 켜 두었으면 중계 서버가 바로 허용해 돌려준다
    if (r.status === 'allow') return decide(id, 'allow')
    if (permissions.has(id)) showActivity('waiting', M.waitingPermission(label), r.id)
  } catch (e) {
    decide(id, 'deny', M.permissionPostFailed(e instanceof Error ? e.message : String(e)))
  }
}

function decide(id: string, behavior: 'allow' | 'deny', message = M.permissionDenied) {
  const perm = permissions.get(id)
  if (!perm) return
  permissions.delete(id)
  clearTimeout(perm.timer)
  const response = behavior === 'allow' ? { behavior: 'allow', updatedInput: perm.input } : { behavior: 'deny', message }
  write(perm.owner, { type: 'control_response', response: { subtype: 'success', request_id: perm.claudeRequestId, response } })
  if (turns.length) showActivity('working', behavior === 'allow' ? perm.label : M.thinking)
}

// ── 메신저 이벤트 → Claude 턴 ──────────────────────────────────

let batch: Delivery[] = []
let held: Delivery[] = [] // 답할 필요 없는 알림은 다음 이벤트에 얹어 보낸다(턴 낭비 방지)
let batchTimer: NodeJS.Timeout | undefined

const passive = (d: Delivery) => d.meta.kind === 'system' || (d.meta.kind === 'approval' && d.meta.result === 'approved')

function enqueue(d: Delivery) {
  if (passive(d)) {
    held.push(d)
    if (held.length > 30) held.shift()
    return
  }
  batch.push(d)
  // 마스터 지시는 바로 '작업 중'을 보여 준다(묶는 1.5초 동안에도)
  if (d.meta.kind === 'master') postActivity([d.meta.channel_id], 'working', M.readingInstruction)
  if (d.meta.kind === 'request') postActivity([d.meta.channel_id], 'working', M.readingRequest)
  clearTimeout(batchTimer)
  batchTimer = setTimeout(flush, BATCH_MS)
}

function flush() {
  const all = [...held, ...batch]
  const active = batch
  held = []
  batch = []
  if (!active.length) return
  log(`${all.length} event(s) → Claude`)
  const turn: Turn = {
    channels: new Set(active.map((d) => d.meta.channel_id)),
    masterChannel: active.findLast((d) => d.meta.kind === 'master')?.meta.channel_id ?? null,
    reported: new Set(),
  }
  sendTurn(all.map(renderChannelTag).join('\n\n'), turn)
}

status('connecting')
connectRelay(
  config,
  async (ev) => {
    if (ev.type === 'hello') status(child ? 'online' : 'idle')
    if (ev.type === 'permission_verdict') return decide(ev.requestId, ev.behavior)
    const d = await inbox.handle(ev)
    if (d) enqueue(d)
  },
  () => shutdown(0),
)

function shutdown(code: number) {
  stopping = true
  status('stopped')
  for (const id of [...permissions.keys()]) decide(id, 'deny', M.appQuit)
  clearActivity()
  if (!child) setTimeout(() => process.exit(code), 300) // 마지막 상태 전달을 잠깐 기다린다
  else {
    child.stdin.end()
    const p = child
    setTimeout(() => p.kill('SIGTERM'), 3000).unref()
    p.on('exit', () => process.exit(code))
  }
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
        if (c.cmd === 'set_model' && typeof c.model === 'string') setModel(c.model)
      } catch {
        /* 모르는 줄은 무시 */
      }
    })
    .on('close', () => shutdown(0))
}

discoverModels()
