// Claude Code 엔진: `claude -p --input-format stream-json` 세션에 사용자 턴을 넣는다.
// - 도구(send_message 등)는 같은 세션에 커넥터(AH_RUNNER=1, 도구만)를 MCP 로 붙여 준다.
// - 도구 실행 권한 확인(can_use_tool)은 러너를 거쳐 데스크톱 승인함으로 넘긴다.
// - 세션 id 를 저장해 다시 띄울 때 --resume 으로 이어 쓴다.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { profile, profileDir } from './config.ts'
import { M } from './i18n.ts'
import { agentEnv, IDLE_MS, MAX_FAILS, type AgentModel, type Engine, type Host } from './engine.ts'

const NAME = 'Claude Code'
const MESSENGER_TOOLS = ['send_message', 'report_to_master', 'propose_document', 'share_file', 'download_file', 'read_channel', 'read_document', 'list_channels']

export function createClaudeEngine(host: Host, bin: string, initialModel: string): Engine {
  const TOOL = (name: string) => `mcp__${host.serverName}__${name}`
  const prompt = M.runnerPrompt(MESSENGER_TOOLS.map(TOOL).join(', '), `select:${TOOL('send_message')},${TOOL('report_to_master')}`)

  let model = initialModel
  let modelRequest = 0
  let child: ChildProcessWithoutNullStreams | null = null
  const inflight: string[] = [] // Claude 에 넣고 result 를 기다리는 턴(보낸 순서대로 끝난다)
  const outbox: string[] = [] // Claude 가 떠 있지 않아 아직 못 넣은 턴
  let initSeen = false
  let stopping = false
  let fails = 0
  let idleTimer: NodeJS.Timeout | undefined
  const stderrTail: string[] = []

  const userLine = (text: string) => JSON.stringify({ type: 'user', message: { role: 'user', content: text } }) + '\n'

  function write(p: ChildProcessWithoutNullStreams | null, obj: unknown) {
    if (p && p.stdin.writable) p.stdin.write(JSON.stringify(obj) + '\n')
  }

  function feed(p: ChildProcessWithoutNullStreams, text: string) {
    inflight.push(text)
    p.stdin.write(userLine(text))
  }

  function start() {
    if (child) return
    const mcpConfig = { mcpServers: { [host.serverName]: { type: 'stdio', ...host.mcp } } }
    const args = [
      '-p',
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      '--verbose',
      '--permission-prompt-tool', 'stdio',
      '--mcp-config', JSON.stringify(mcpConfig),
      '--allowedTools', `mcp__${host.serverName}`,
      '--add-dir', host.downloadDir,
      '--append-system-prompt', prompt,
    ]
    if (model !== 'default') args.push('--model', model)
    const resuming = !!host.state.sessionId
    if (resuming) args.push('--resume', host.state.sessionId!)

    mkdirSync(host.downloadDir, { recursive: true })
    host.log(`Claude start (${host.workdir}${resuming ? `, resuming session ${host.state.sessionId}` : ', new session'})`)
    host.status('starting')
    initSeen = false
    stderrTail.length = 0
    const p = spawn(bin, args, {
      cwd: host.workdir,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: agentEnv({ AH_PROFILE: profile(), AH_RUNNER_SESSION: profile() }),
    })
    child = p
    const startedAt = Date.now()

    p.stdin.on('error', (e) => host.log('Claude stdin error', e.message))
    createInterface({ input: p.stderr }).on('line', (line) => {
      if (!line.trim()) return
      stderrTail.push(line)
      if (stderrTail.length > 20) stderrTail.shift()
    })
    createInterface({ input: p.stdout }).on('line', (line) => onLine(p, line))

    p.on('error', (e) => {
      host.log('could not start Claude:', e.message)
      if (child === p) child = null
      host.failTurns(inflight.splice(0).length, M.agentStartFailed(NAME, e.message))
      host.status('error', M.agentStartFailedBin(NAME, bin, e.message))
    })
    p.on('exit', (code, signal) => {
      if (child === p) child = null
      host.dropPermissions()
      const unfinished = inflight.splice(0)
      const tail = stderrTail.slice(-5).join('\n')
      host.log(`Claude exited (code=${code}${signal ? `, ${signal}` : ''})${code ? '\n' + tail : ''}`)

      if (stopping) return
      // 이어 쓸 세션이 없어졌으면(정리·다른 PC 등) 새 세션으로 바로 다시. 못 끝낸 턴은 그대로 다시 넣는다.
      if (resuming && !initSeen && code !== 0 && /no conversation found|session.*not found/i.test(tail)) {
        host.log('saved session not found; starting a new session.')
        host.state = { workdir: host.workdir, agent: 'claude-code', seen: host.state.seen }
        host.saveState()
        outbox.unshift(...unfinished)
        return start()
      }
      if (code === 0 && !unfinished.length && !outbox.length) return host.status('idle') // 유휴 종료
      fails = Date.now() - startedAt > 60_000 ? 1 : fails + 1
      if (fails > MAX_FAILS) {
        host.status('error', tail || M.agentKeepsExiting(NAME, code))
        host.failTurns(unfinished.length, M.agentStopped(NAME, tail))
        fails = 0
        return // 다음 이벤트 때 다시 시도
      }
      if (unfinished.length) {
        host.mergeTurns(unfinished.length)
        outbox.unshift(M.sessionRestarted)
      }
      setTimeout(() => outbox.length && start(), 1000 * 2 ** (fails - 1))
    })

    for (const text of outbox.splice(0)) feed(p, text)
    if (inflight.length) host.status('working')
  }

  function onLine(p: ChildProcessWithoutNullStreams, line: string) {
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
          if (typeof o.model === 'string') host.emit({ type: 'model', active: o.model })
          if (host.state.sessionId !== o.session_id) {
            host.state = { ...host.state, sessionId: o.session_id, workdir: host.workdir, agent: 'claude-code' }
            host.saveState()
          }
        }
        break
      case 'assistant':
        for (const c of o.message?.content ?? []) {
          if (c.type === 'tool_use') {
            host.log('tool:', c.name)
            host.toolUsed(String(c.name), c.input)
          } else if (c.type === 'text' && c.text?.trim()) host.log('Claude:', c.text.slice(0, 300))
        }
        break
      case 'result': {
        fails = 0
        inflight.shift()
        const ok = !o.is_error && o.subtype === 'success'
        const text = ok ? String(o.result ?? '').trim() : String(o.result || o.subtype || M.unknownError)
        if (!ok) host.log('turn failed:', text)
        host.turnDone({ ok, text })
        armIdle()
        break
      }
      case 'control_request':
        void onControlRequest(p, o)
        break
      case 'control_response': {
        const r = o.response ?? {}
        if (typeof r.request_id === 'string' && r.request_id.startsWith('set_model_')) {
          if (r.subtype === 'success') host.emit({ type: 'model', active: r.response?.model ?? model })
          else {
            host.log('could not switch models:', r.error)
            host.status('error', M.modelChangeFailed(String(r.error ?? M.unknownError)))
          }
        }
        break
      }
    }
  }

  // 도구 실행 권한: Claude → 러너(데스크톱 승인함) → Claude
  async function onControlRequest(p: ChildProcessWithoutNullStreams, o: Record<string, any>) {
    const req = o.request ?? {}
    if (req.subtype !== 'can_use_tool') {
      write(p, { type: 'control_response', response: { subtype: 'error', request_id: o.request_id, error: M.unsupportedRequest(String(req.subtype)) } })
      return
    }
    host.log('permission request:', req.tool_name)
    const { allow, message } = await host.askPermission({
      toolName: String(req.display_name ?? req.tool_name ?? ''),
      rawName: String(req.tool_name ?? ''),
      description: String(req.description ?? req.decision_reason ?? ''),
      input: req.input,
    })
    if (child !== p) return // 그사이 Claude 가 내려갔다
    const response = allow ? { behavior: 'allow', updatedInput: req.input } : { behavior: 'deny', message }
    write(p, { type: 'control_response', response: { subtype: 'success', request_id: o.request_id, response } })
  }

  function armIdle() {
    clearTimeout(idleTimer)
    idleTimer = setTimeout(() => {
      if (child && !inflight.length && !host.waitingPermission() && !outbox.length) {
        host.log('idle for a while; stopping Claude until the next event.')
        child.stdin.end()
      }
    }, IDLE_MS)
  }

  return {
    name: NAME,
    running: () => !!child,
    submit(text) {
      clearTimeout(idleTimer)
      if (child && child.stdin.writable) {
        feed(child, text)
        host.status('working')
      } else {
        outbox.push(text)
        start()
      }
    },
    // 앱이 모델을 바꾸면: 떠 있는 세션엔 바로(set_model), 아니면 다음에 띄울 때 --model 로
    setModel(next) {
      model = next || 'default'
      host.log('model →', model)
      if (child && child.stdin.writable) {
        write(child, { type: 'control_request', request_id: `set_model_${++modelRequest}`, request: { subtype: 'set_model', model } })
      }
    },
    // 고를 수 있는 모델은 계정·버전마다 다르다. Claude Code 에 직접 물어(initialize) 그대로 쓴다. 토큰은 쓰지 않는다.
    discoverModels() {
      const p = spawn(bin, ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--strict-mcp-config', '--tools', ''], {
        cwd: host.workdir,
        stdio: ['pipe', 'pipe', 'ignore'],
        env: agentEnv({ AH_RUNNER_SESSION: profile() }),
      })
      const done = setTimeout(() => p.kill(), 30_000)
      p.on('error', (e) => host.log('could not get the model list:', e.message))
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
        if (list.length) publishModels(host, 'claude-code', list)
        p.stdin.end()
        p.kill()
      })
      p.stdin.write(JSON.stringify({ type: 'control_request', request_id: 'models', request: { subtype: 'initialize' } }) + '\n')
    },
    stop() {
      stopping = true
      const p = child
      if (!p) return Promise.resolve()
      return new Promise((done) => {
        p.on('exit', () => done())
        p.stdin.end()
        setTimeout(() => p.kill('SIGTERM'), 3000).unref()
      })
    },
  }
}

/** 모델 목록을 앱에 알리고 다음 실행을 위해 캐시해 둔다 */
export function publishModels(host: Host, agentKind: string, models: AgentModel[]) {
  host.emit({ type: 'models', agentKind, models })
  try {
    writeFileSync(join(profileDir(), 'models.json'), JSON.stringify({ agentKind, models, at: Date.now() }, null, 2))
  } catch {
    /* 캐시는 없어도 된다 */
  }
}
