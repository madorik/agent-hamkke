// Codex 엔진: `codex app-server`(Codex 데스크톱 앱·VS Code 확장이 쓰는 JSON-RPC)를 띄워 스레드에 턴을 넣는다.
// - 메신저 MCP 서버는 thread/start 의 config 로 붙인다(사용자의 ~/.codex/config.toml MCP 도 그대로 쓴다).
// - 명령 실행·파일 변경·추가 권한·다른 MCP 도구 실행 허락은 러너를 거쳐 데스크톱 승인함으로 넘긴다.
//   메신저 도구는 묻지 않는다(채널에 나가는 건 어차피 발언 승인을 거친다).
// - 스레드 id 를 저장해 다시 띄울 때 thread/resume 으로 이어 쓴다. 턴은 한 번에 하나씩.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { profile } from './config.ts'
import { M } from './i18n.ts'
import { agentEnv, IDLE_MS, MAX_FAILS, type AgentModel, type Engine, type Host } from './engine.ts'
import { publishModels } from './engine-claude.ts'

const NAME = 'Codex'
const VERSION = process.env.AH_APP_VERSION || '0'
const errText = (e: unknown) => (e instanceof Error ? e.message : String((e as { message?: unknown })?.message ?? e))
// Codex 로그는 색 코드가 섞여 온다
const plain = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '')

type Json = Record<string, any>

/** app-server 와 줄 단위 JSON-RPC 로 주고받는다 */
function rpc(p: ChildProcessWithoutNullStreams, on: { request(m: Json): void; notification(method: string, params: Json): void }) {
  let nextId = 0
  const calls = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>()
  const send = (obj: Json) => {
    if (p.stdin.writable) p.stdin.write(JSON.stringify(obj) + '\n')
  }
  createInterface({ input: p.stdout }).on('line', (line) => {
    let m: Json
    try {
      m = JSON.parse(line)
    } catch {
      return
    }
    if (m.id != null && m.method === undefined) {
      const c = calls.get(m.id)
      calls.delete(m.id)
      if (m.error) c?.reject(new Error(String(m.error.message ?? JSON.stringify(m.error))))
      else c?.resolve(m.result)
    } else if (m.id != null) on.request(m)
    else if (typeof m.method === 'string') on.notification(m.method, m.params ?? {})
  })
  p.on('exit', () => {
    for (const c of calls.values()) c.reject(new Error('codex app-server exited'))
    calls.clear()
  })
  return {
    call<T = Json>(method: string, params: unknown): Promise<T> {
      const id = ++nextId
      return new Promise<T>((resolve, reject) => {
        calls.set(id, { resolve, reject })
        send({ id, method, params })
      })
    },
    notify: (method: string) => send({ method }),
    reply: (id: unknown, result: unknown) => send({ id, result }),
    replyError: (id: unknown, message: string) => send({ id, error: { code: -32601, message } }),
  }
}

async function initialize(r: ReturnType<typeof rpc>) {
  await r.call('initialize', { clientInfo: { name: 'agent-hamkke', title: 'Agent Hamkke', version: VERSION }, capabilities: null })
  r.notify('initialized')
}

export function createCodexEngine(host: Host, bin: string, initialModel: string): Engine {
  let model = initialModel
  let proc: ChildProcessWithoutNullStreams | null = null
  let conn: ReturnType<typeof rpc> | null = null
  let thread: Promise<string> | null = null
  const queue: string[] = [] // 아직 시작하지 않은 턴
  let active: { lastMessage: string } | null = null // 진행 중인 턴(한 번에 하나)
  const fileChanges = new Map<string, string[]>() // 파일 변경 허락을 물을 때 보여 줄 경로(item id → 경로)
  let stopping = false
  let fails = 0
  let idleTimer: NodeJS.Timeout | undefined
  const stderrTail: string[] = []

  const spawnServer = () =>
    spawn(bin, ['app-server'], {
      cwd: host.workdir,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: agentEnv({ AH_PROFILE: profile(), AH_RUNNER_SESSION: profile() }),
    })

  const threadParams = () => ({
    cwd: host.workdir,
    approvalPolicy: 'on-request',
    sandbox: 'workspace-write',
    // Claude 는 MCP 서버 instructions 를 읽지만 Codex 는 따로 넣어 준다
    developerInstructions: `${M.instructions}\n\n${M.runnerPromptCodex(host.serverName)}`,
    config: { mcp_servers: { [host.serverName]: host.mcp } },
  })

  async function openThread(r: ReturnType<typeof rpc>): Promise<string> {
    await initialize(r)
    const params = threadParams()
    const saved = host.state.sessionId
    if (saved) {
      try {
        const res = await r.call('thread/resume', { threadId: saved, ...params })
        if (res.model) host.emit({ type: 'model', active: res.model })
        return res.thread.id
      } catch (e) {
        host.log('saved thread not found; starting a new thread.', errText(e))
      }
    }
    const res = await r.call('thread/start', params)
    host.state = { ...host.state, sessionId: res.thread.id, workdir: host.workdir, agent: 'codex' }
    host.saveState()
    if (res.model) host.emit({ type: 'model', active: res.model })
    return res.thread.id
  }

  function start() {
    if (proc) return
    const resuming = !!host.state.sessionId
    host.log(`Codex start (${host.workdir}${resuming ? `, resuming thread ${host.state.sessionId}` : ', new thread'})`)
    host.status('starting')
    mkdirSync(host.downloadDir, { recursive: true })
    stderrTail.length = 0
    const p = spawnServer()
    proc = p
    const startedAt = Date.now()
    const r = rpc(p, { request: (m) => void onServerRequest(p, m), notification: onNotification })
    conn = r

    p.stdin.on('error', (e) => host.log('Codex stdin error', e.message))
    createInterface({ input: p.stderr }).on('line', (line) => {
      if (!line.trim()) return
      stderrTail.push(plain(line))
      if (stderrTail.length > 20) stderrTail.shift()
    })
    p.on('error', (e) => {
      host.log('could not start Codex:', e.message)
      if (proc === p) (proc = null), (conn = null), (thread = null)
      host.failTurns((active ? 1 : 0) + queue.splice(0).length, M.agentStartFailed(NAME, e.message))
      active = null
      host.status('error', M.agentStartFailedBin(NAME, bin, e.message))
    })
    p.on('exit', (code, signal) => {
      if (proc === p) (proc = null), (conn = null), (thread = null)
      host.dropPermissions()
      const lost = active ? 1 : 0
      active = null
      const tail = stderrTail.slice(-5).join('\n')
      host.log(`Codex exited (code=${code}${signal ? `, ${signal}` : ''})${code ? '\n' + tail : ''}`)
      if (stopping) return
      if (!lost && !queue.length) return host.status('idle') // 유휴 종료
      fails = Date.now() - startedAt > 60_000 ? 1 : fails + 1
      if (fails > MAX_FAILS) {
        host.status('error', tail || M.agentKeepsExiting(NAME, code))
        host.failTurns(lost, M.agentStopped(NAME, tail))
        fails = 0
        return // 다음 이벤트 때 다시 시도
      }
      if (lost) {
        host.mergeTurns(lost)
        queue.unshift(M.sessionRestarted)
      }
      setTimeout(() => queue.length && start(), 1000 * 2 ** (fails - 1))
    })

    thread = openThread(r)
    thread.then(
      () => void pump(),
      (e) => {
        // 로그인이 안 됐거나 설정이 잘못됐다. 프로세스를 내려 다시 시도(실패가 쌓이면 멈춘다).
        host.log('could not open a Codex thread:', errText(e))
        host.status('error', M.agentStartFailed(NAME, errText(e)))
        p.kill()
      },
    )
  }

  async function pump() {
    if (active || !queue.length || !thread || !conn) return
    const r = conn
    const threadId = await thread
    if (active || !queue.length || conn !== r) return
    const text = queue.shift()!
    active = { lastMessage: '' }
    host.status('working')
    try {
      await r.call('turn/start', {
        threadId,
        input: [{ type: 'text', text, text_elements: [] }],
        ...(model !== 'default' ? { model } : {}),
      })
    } catch (e) {
      if (conn === r) finish(false, errText(e)) // 프로세스가 죽은 경우는 exit 가 처리한다
    }
  }

  function finish(ok: boolean, text: string) {
    if (!active) return
    active = null
    if (ok) fails = 0
    host.turnDone({ ok, text })
    armIdle()
    void pump()
  }

  function onNotification(method: string, p: Json) {
    switch (method) {
      case 'item/started': {
        const it = p.item ?? {}
        if (it.type === 'mcpToolCall') {
          host.log('tool:', `${it.server}/${it.tool}`)
          host.toolUsed(`mcp__${it.server}__${it.tool}`, it.arguments)
        } else if (it.type === 'commandExecution') {
          host.log('command:', String(it.command ?? '').slice(0, 200))
          host.toolUsed('Bash', { command: it.command })
        } else if (it.type === 'fileChange') {
          fileChanges.set(String(it.id), (it.changes ?? []).map((c: Json) => String(c.path ?? '')).filter(Boolean))
          host.toolUsed('Edit', null)
        } else if (it.type === 'webSearch') host.toolUsed('WebSearch', null)
        break
      }
      case 'item/completed': {
        const it = p.item ?? {}
        if (it.type === 'agentMessage' && active && typeof it.text === 'string' && it.text.trim()) {
          active.lastMessage = it.text.trim()
          host.log('Codex:', it.text.slice(0, 300))
        }
        if (it.type === 'fileChange') fileChanges.delete(String(it.id))
        break
      }
      case 'turn/completed': {
        const t = p.turn ?? {}
        const ok = t.status === 'completed'
        const text = ok ? (active?.lastMessage ?? '') : String(t.error?.message ?? t.status ?? M.unknownError)
        if (!ok) host.log('turn failed:', text)
        finish(ok, text)
        break
      }
      case 'mcpServer/startupStatus/updated':
        if (p.name === host.serverName && p.status === 'failed') host.log('messenger MCP server failed to start:', p.error)
        break
      case 'error':
        host.log('Codex error:', JSON.stringify(p).slice(0, 300))
        break
    }
  }

  // 허락: Codex → 러너(데스크톱 승인함) → Codex
  async function onServerRequest(owner: ChildProcessWithoutNullStreams, m: Json) {
    const r = conn
    if (!r) return
    const p = m.params ?? {}
    const ask = (toolName: string, rawName: string, description: string, input: unknown) => {
      host.log('permission request:', rawName)
      return host.askPermission({ toolName, rawName, description, input })
    }
    const reply = (result: unknown) => proc === owner && r.reply(m.id, result)
    try {
      switch (m.method) {
        case 'mcpServer/elicitation/request': {
          const meta: Json = p._meta ?? {}
          // 사람에게 값을 입력받는 폼은 지원하지 않는다
          if (meta.codex_approval_kind !== 'mcp_tool_call') return reply({ action: 'decline', content: null, _meta: null })
          if (p.serverName === host.serverName) return reply({ action: 'accept', content: {}, _meta: null })
          const tool = String(meta.tool_name ?? '')
          const { allow } = await ask(`${p.serverName} · ${tool}`, `mcp__${p.serverName}__${tool}`, String(meta.tool_description ?? p.message ?? ''), meta.tool_params ?? null)
          return reply({ action: allow ? 'accept' : 'decline', content: allow ? {} : null, _meta: null })
        }
        case 'item/commandExecution/requestApproval': {
          const { allow } = await ask(M.codexCommand, 'Bash', String(p.reason ?? ''), { command: p.command ?? '', cwd: p.cwd ?? '' })
          return reply({ decision: allow ? 'accept' : 'decline' })
        }
        case 'item/fileChange/requestApproval': {
          const files = fileChanges.get(String(p.itemId)) ?? []
          const { allow } = await ask(M.codexFileChange, 'Edit', String(p.reason ?? ''), { files, ...(p.grantRoot ? { grantRoot: p.grantRoot } : {}) })
          return reply({ decision: allow ? 'accept' : 'decline' })
        }
        case 'item/permissions/requestApproval': {
          const { allow } = await ask(M.codexPermissions, 'Permissions', String(p.reason ?? ''), p.permissions)
          const granted = allow ? Object.fromEntries(Object.entries(p.permissions ?? {}).filter(([, v]) => v != null)) : {}
          return reply({ permissions: granted, scope: 'turn' })
        }
        default:
          if (proc === owner) r.replyError(m.id, M.unsupportedRequest(String(m.method)))
      }
    } catch (e) {
      if (proc === owner) r.replyError(m.id, errText(e))
    }
  }

  function armIdle() {
    clearTimeout(idleTimer)
    idleTimer = setTimeout(() => {
      if (proc && !active && !queue.length && !host.waitingPermission()) {
        host.log('idle for a while; stopping Codex until the next event.')
        const p = proc
        p.stdin.end()
        setTimeout(() => p.kill('SIGTERM'), 3000).unref()
      }
    }, IDLE_MS)
  }

  return {
    name: NAME,
    running: () => !!proc,
    submit(text) {
      clearTimeout(idleTimer)
      queue.push(text)
      if (proc) void pump()
      else start()
    },
    setModel(next) {
      model = next || 'default'
      host.log('model →', model, '(from the next turn)')
      if (model !== 'default') host.emit({ type: 'model', active: model })
    },
    // 고를 수 있는 모델은 계정마다 다르다. app-server 에 물어(model/list) 그대로 쓴다. 토큰은 쓰지 않는다.
    discoverModels() {
      const p = spawnServer()
      const r = rpc(p, { request: (m) => r.replyError(m.id, 'unsupported'), notification: () => {} })
      const done = setTimeout(() => p.kill(), 30_000)
      p.on('error', (e) => host.log('could not get the model list:', e.message))
      p.on('exit', () => clearTimeout(done))
      void (async () => {
        try {
          await initialize(r)
          const res = await r.call<{ data: Json[] }>('model/list', {})
          const list = (res.data ?? []).filter((m) => !m.hidden)
          const def = list.find((m) => m.isDefault) ?? list[0]
          const models: AgentModel[] = list.map((m) => ({
            value: String(m.model),
            label: String(m.displayName || m.model),
            description: String(m.description ?? ''),
            resolved: String(m.model),
          }))
          if (def) models.unshift({ value: 'default', label: 'Default', description: '', resolved: String(def.model) })
          if (models.length) publishModels(host, 'codex', models)
        } catch (e) {
          host.log('could not get the model list:', errText(e))
        } finally {
          p.kill()
        }
      })()
    },
    stop() {
      stopping = true
      const p = proc
      if (!p) return Promise.resolve()
      return new Promise((done) => {
        p.on('exit', () => done())
        p.stdin.end()
        setTimeout(() => p.kill('SIGTERM'), 3000).unref()
      })
    },
  }
}
