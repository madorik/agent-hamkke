import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } from 'electron'
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, truncateSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'
import { createInterface } from 'node:readline'

// 이름이 Agent Messenger 였을 때의 데이터(로그인·설정, 커넥터 설정)를 새 이름 폴더로 한 번 옮긴다
function moveLegacy(from: string, to: string) {
  try {
    if (existsSync(from) && !existsSync(to)) renameSync(from, to)
  } catch {
    /* 옮기지 못하면 새 폴더로 시작한다 */
  }
}
moveLegacy(join(app.getPath('appData'), 'Agent Messenger'), join(app.getPath('appData'), 'Agent Hamkke'))
moveLegacy(join(homedir(), '.agent-messenger'), join(homedir(), '.agent-hamkke'))

// 한 PC 에서 두 사람을 시험할 수 있게 프로필로 데이터 폴더를 나눈다: AH_PROFILE=b
// 개발 중(pnpm dev, 패키징 안 됨)엔 'dev' 프로필을 쓴다. 설치한 앱과 로그인·서버 주소·에이전트 설정이 섞이지 않게.
const PROFILE = process.env.AH_PROFILE || (app.isPackaged ? 'default' : 'dev')
if (PROFILE !== 'default') app.setPath('userData', join(app.getPath('appData'), 'Agent Hamkke', PROFILE))

// 배포한 앱은 운영 중계 서버(Vercel), 개발 중(pnpm dev)엔 로컬 중계 서버(agent-hamkke-relay 의 npm run dev)
const RELAY_URL = process.env.AH_RELAY_URL || (app.isPackaged ? 'https://hamkke.watalabs.com' : 'http://localhost:8787')
const isMac = process.platform === 'darwin'
const SERVER_NAME = PROFILE === 'default' ? 'agent-hamkke' : `agent-hamkke-${PROFILE}`
const LEGACY_SERVER_NAME = PROFILE === 'default' ? 'agent-messenger' : `agent-messenger-${PROFILE}`

let win: BrowserWindow | null = null

// ── 언어 ────────────────────────────────────────────────────
// 화면 언어는 렌더러가 고르고(설정 > 일반) 여기로 알려 준다. 에이전트도 같은 언어를 쓰게 connector.json 에 적는다.
type Locale = 'ko' | 'en'
const toLocale = (v: unknown): Locale | null => {
  const s = String(v ?? '').toLowerCase()
  return s.startsWith('ko') ? 'ko' : s.startsWith('en') ? 'en' : null
}
let locale: Locale = 'en' // app ready 뒤 connector.json·시스템 언어로 다시 정한다

const TEXT = {
  ko: {
    nodeMissing: 'node 를 찾지 못했어요. Node.js 24 이상을 설치해 주세요.',
    claudeMissing: 'Claude Code(claude 명령)를 찾지 못했어요.',
    claudeMissingInstall: 'Claude Code(claude 명령)를 찾지 못했어요. 먼저 설치해 주세요.',
    runnerCrashed: (sec: number, log: string) => `러너가 멈췄어요. ${sec}초 뒤 다시 시작해요. (로그: ${log})`,
    folderTitle: '에이전트가 일할 폴더',
    folderButton: '이 폴더에서 일하기',
  },
  en: {
    nodeMissing: 'Couldn’t find node. Please install Node.js 24 or later.',
    claudeMissing: 'Couldn’t find Claude Code (the claude command).',
    claudeMissingInstall: 'Couldn’t find Claude Code (the claude command). Please install it first.',
    runnerCrashed: (sec: number, log: string) => `The runner stopped. Restarting in ${sec}s. (Log: ${log})`,
    folderTitle: 'Folder for your agent to work in',
    folderButton: 'Work in this folder',
  },
}
const t = () => TEXT[locale]

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 860,
    minHeight: 560,
    show: false,
    title: 'Agent Hamkke',
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    trafficLightPosition: { x: 18, y: 18 },
    titleBarOverlay: isMac ? undefined : overlayColors(),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#212121' : '#ffffff',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
    },
  })
  win.on('ready-to-show', () => win?.show())
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(__dirname, '../renderer/index.html'))
}

function overlayColors() {
  const dark = nativeTheme.shouldUseDarkColors
  return { color: '#00000000', symbolColor: dark ? '#b4b4b4' : '#5d5d5d', height: 52 }
}

// ── 외부 명령 ────────────────────────────────────────────────

function run(cmd: string, args: string[], opts: { cwd?: string } = {}): Promise<{ code: number; out: string }> {
  return new Promise((done) => {
    execFile(cmd, args, { cwd: opts.cwd, timeout: 20_000, env: process.env }, (err, stdout, stderr) => {
      const exit = (err as { code?: unknown } | null)?.code
      done({ code: err ? (typeof exit === 'number' ? exit : 1) : 0, out: (stdout + stderr).trim() })
    })
  })
}

// 앱을 Finder 에서 열면 셸 PATH 를 못 받는다. 로그인 셸에 한 번 물어 실행 파일 위치를 찾는다.
const whichCache = new Map<string, string | null>()
async function which(bin: string): Promise<string | null> {
  if (whichCache.has(bin)) return whichCache.get(bin)!
  let found: string | null = null
  if (process.platform === 'win32') {
    const r = await run('where', [bin])
    found = r.code === 0 ? r.out.split(/\r?\n/)[0] : null
  } else {
    const shellPath = process.env.SHELL || '/bin/zsh'
    const r = await run(shellPath, ['-ilc', `command -v ${bin}`])
    found = r.code === 0 ? (r.out.split('\n').filter(Boolean).at(-1) ?? null) : null
  }
  whichCache.set(bin, found)
  return found
}

// 앱을 Finder 에서 열면 PATH 가 짧아 Claude 의 훅·MCP 가 node 등을 못 찾는다. 로그인 셸의 PATH 를 한 번 받아 둔다.
let loginPathCache: string | null = null
async function loginPath(): Promise<string> {
  if (loginPathCache !== null) return loginPathCache
  let p = process.env.PATH ?? ''
  if (process.platform !== 'win32') {
    const r = await run(process.env.SHELL || '/bin/zsh', ['-ilc', 'printf "%s" "$PATH"'])
    if (r.code === 0 && r.out) p = r.out.split('\n').filter(Boolean).at(-1) ?? p
  }
  loginPathCache = p
  return p
}

function connectorDir(): string {
  // 개발 중엔 저장소의 TS 파일을 node 24 로 바로 돈다. 배포 때는 번들(.mjs)을 resources 에 넣는다.
  const bundled = join(process.resourcesPath ?? '', 'connector')
  if (app.isPackaged && existsSync(join(bundled, 'runner.mjs'))) return bundled
  return resolve(app.getAppPath(), '../../packages/connector/src')
}

function runnerScript(): string {
  const dir = connectorDir()
  return existsSync(join(dir, 'runner.mjs')) ? join(dir, 'runner.mjs') : join(dir, 'runner.ts')
}

const profileDir = () => join(homedir(), '.agent-hamkke', PROFILE)
const connectorConfigPath = () => join(profileDir(), 'connector.json')
const runnerLogPath = () => join(profileDir(), 'runner.log')

interface ConnectorFile {
  relayUrl: string
  token: string
  agentKind: string
  workdir?: string
  model?: string
  /** 에이전트 지시·러너 문장 언어 */
  locale?: Locale
}

// 에이전트가 알려 준 고를 수 있는 모델(계정·버전마다 다르다). 러너가 띄울 때 받아 오고, 다음 실행을 위해 캐시도 둔다.
interface AgentModel {
  value: string
  label: string
  description: string
  resolved: string
}
let agentModels: AgentModel[] = []
let activeModel = ''

function loadModelCache() {
  try {
    const c = JSON.parse(readFileSync(join(profileDir(), 'models.json'), 'utf8')) as { models?: AgentModel[] }
    if (Array.isArray(c.models)) agentModels = c.models
  } catch {
    /* 아직 없음 */
  }
}

function readConnectorFile(): ConnectorFile | null {
  try {
    return JSON.parse(readFileSync(connectorConfigPath(), 'utf8')) as ConnectorFile
  } catch {
    return null
  }
}

function writeConnectorFile(c: ConnectorFile) {
  mkdirSync(profileDir(), { recursive: true })
  writeFileSync(connectorConfigPath(), JSON.stringify(c, null, 2), { mode: 0o600 })
}

// ── 러너: 앱이 Claude Code 를 직접 돌린다 ───────────────────────
// channels(연구 미리보기)는 Team/Enterprise 에선 조직이 켜야 하고 VS Code 에선 아예 안 돼서,
// 러너가 중계 서버 이벤트를 받아 `claude -p` 세션에 넣는다. 앱이 켜져 있으면 늘 접속돼 있다.

type RunnerState = 'off' | 'connecting' | 'online' | 'starting' | 'working' | 'idle' | 'error' | 'stopped'
let runner: ChildProcess | null = null
let runnerState: { state: RunnerState; message?: string } = { state: 'off' }
let runnerWanted = false
let runnerFails = 0
let runnerRetry: NodeJS.Timeout | undefined

function setRunnerState(next: { state: RunnerState; message?: string }) {
  // 오류는 다음 정상 상태가 올 때까지 메시지를 남겨 둔다
  runnerState = next.state === 'working' || next.state === 'online' || next.state === 'idle' ? { state: next.state } : next
  win?.webContents.send('connector:changed')
}

function logRunner(line: string) {
  try {
    const p = runnerLogPath()
    if (existsSync(p) && statSync(p).size > 5_000_000) truncateSync(p, 0)
    appendFileSync(p, `${new Date().toISOString()} ${line}\n`)
  } catch {
    /* 로그 실패는 무시 */
  }
}

// 예전 방식(모든 Claude Code 세션에 커넥터를 붙이던 user 범위 MCP 등록)을 지운다.
// 남아 있으면 아무 세션이나 열 때마다 '접속 중'으로 보이지만 메시지는 받지 못한다.
// 이름을 바꾸기 전(agent-messenger)의 등록도 같이 지운다.
async function removeLegacyRegistration(claude: string) {
  let servers: Record<string, unknown> = {}
  try {
    servers = (JSON.parse(readFileSync(join(homedir(), '.claude.json'), 'utf8')) as { mcpServers?: Record<string, unknown> }).mcpServers ?? {}
  } catch {
    return
  }
  for (const name of [SERVER_NAME, LEGACY_SERVER_NAME]) {
    if (!servers[name]) continue
    const r = await run(claude, ['mcp', 'remove', name, '--scope', 'user'])
    logRunner(`removed legacy MCP registration (${name}): ${r.code === 0 ? 'ok' : r.out}`)
  }
}

async function startRunner() {
  runnerWanted = true
  clearTimeout(runnerRetry)
  if (runner) return
  if (!existsSync(connectorConfigPath())) return setRunnerState({ state: 'off' })
  // 배포판은 묶은 runner.mjs 를 앱 자신(Electron)을 Node 로 써서 돌린다. 사용자가 Node 를 깔 필요가 없다.
  // 개발 중엔 저장소의 TS 를 시스템 node 24 로 돌린다.
  const bundled = runnerScript().endsWith('.mjs')
  const node = bundled ? process.execPath : await which('node')
  const claude = await which('claude')
  if (!node) return setRunnerState({ state: 'error', message: t().nodeMissing })
  if (!claude) return setRunnerState({ state: 'error', message: t().claudeMissing })
  await removeLegacyRegistration(claude)
  if (runner || !runnerWanted) return // 기다리는 동안 다른 호출이 먼저 띄웠거나 멈췄다
  const PATH = [...(bundled ? [] : [dirname(node)]), dirname(claude), await loginPath()].join(delimiter)
  const env: NodeJS.ProcessEnv = { ...process.env, PATH, AH_PROFILE: PROFILE, AH_CLAUDE_BIN: claude, AH_EXIT_WITH_PARENT: '1' }
  if (bundled) env.ELECTRON_RUN_AS_NODE = '1'
  else delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_RENDERER_URL

  const p = spawn(node, ['--disable-warning=ExperimentalWarning', runnerScript()], { env, stdio: ['pipe', 'pipe', 'pipe'] })
  runner = p
  const startedAt = Date.now()
  setRunnerState({ state: 'connecting' })
  logRunner(`── runner start (pid ${p.pid})`)

  createInterface({ input: p.stdout! }).on('line', (line) => {
    try {
      const s = JSON.parse(line) as { type?: string; state?: RunnerState; message?: string; models?: AgentModel[]; active?: string }
      if (s.type === 'models' && Array.isArray(s.models)) {
        agentModels = s.models
        win?.webContents.send('connector:changed')
      } else if (s.type === 'model' && s.active) {
        activeModel = s.active
        win?.webContents.send('connector:changed')
      } else if (s.state) {
        if (runner === p) setRunnerState({ state: s.state, message: s.message })
        if (s.message) logRunner(`[${s.state}] ${s.message}`)
      }
    } catch {
      logRunner(line)
    }
  })
  createInterface({ input: p.stderr! }).on('line', logRunner)
  p.on('error', (e) => logRunner(`runner failed to start: ${e.message}`))
  p.on('exit', (code, signal) => {
    if (runner === p) runner = null
    logRunner(`── runner exit (code=${code}${signal ? `, ${signal}` : ''})`)
    if (!runnerWanted) return setRunnerState({ state: 'off' })
    if (code === 0 || code === 2) return setRunnerState({ state: code === 2 ? 'off' : 'stopped' }) // 토큰 교체·설정 없음
    runnerFails = Date.now() - startedAt > 60_000 ? 1 : runnerFails + 1
    const wait = Math.min(60_000, 2000 * 2 ** (runnerFails - 1))
    setRunnerState({ state: 'error', message: t().runnerCrashed(Math.round(wait / 1000), runnerLogPath()) })
    runnerRetry = setTimeout(() => void startRunner(), wait)
  })
}

function stopRunner(): Promise<void> {
  runnerWanted = false
  clearTimeout(runnerRetry)
  const p = runner
  if (!p) return Promise.resolve()
  return new Promise((done) => {
    const t = setTimeout(() => p.kill('SIGKILL'), 5000)
    p.once('exit', () => {
      clearTimeout(t)
      done()
    })
    p.kill('SIGTERM')
  })
}

async function restartRunner() {
  await stopRunner()
  runnerFails = 0
  await startRunner()
}

// ── IPC ─────────────────────────────────────────────────────

ipcMain.handle('app:info', () => ({ platform: process.platform, profile: PROFILE, relayUrl: RELAY_URL }))

// 화면 언어가 정해지거나 바뀌면 에이전트도 그 언어로(지시문·도구 설명은 세션을 띄울 때 정해져서 러너를 다시 띄운다)
ipcMain.handle('app:setLocale', async (_e, next: string) => {
  const l = toLocale(next)
  if (!l) return
  locale = l
  const file = readConnectorFile()
  if (!file || file.locale === l) return
  writeConnectorFile({ ...file, locale: l })
  if (runnerWanted) await restartRunner()
})

ipcMain.handle('theme:set', (_e, theme: 'system' | 'light' | 'dark') => {
  nativeTheme.themeSource = theme
  if (!isMac && win) win.setTitleBarOverlay(overlayColors())
})

ipcMain.on('app:badge', (_e, n: number) => {
  if (isMac) app.dock?.setBadge(n > 0 ? String(n) : '')
  else app.setBadgeCount(n)
})

ipcMain.handle('connector:status', async () => {
  const claude = await which('claude')
  const file = readConnectorFile()
  return {
    claudeInstalled: !!claude,
    configured: !!file?.token,
    workdir: file?.workdir || homedir(),
    runner: runnerState.state,
    message: runnerState.message ?? '',
    logPath: runnerLogPath(),
    agentKind: file?.agentKind ?? null,
    models: agentModels,
    model: file?.model || 'default',
    activeModel,
  }
})

// 모델 바꾸기: 파일에 적어 두고(다음 실행), 떠 있는 러너엔 바로 알린다(세션은 그대로)
ipcMain.handle('connector:setModel', async (_e, model: string) => {
  const file = readConnectorFile()
  if (!file) return { ok: false }
  const value = agentModels.length && !agentModels.some((m) => m.value === model) ? 'default' : model || 'default'
  writeConnectorFile({ ...file, model: value })
  if (runner?.stdin?.writable) runner.stdin.write(JSON.stringify({ cmd: 'set_model', model: value }) + '\n')
  win?.webContents.send('connector:changed')
  return { ok: true, model: value }
})

ipcMain.handle('connector:connect', async (_e, p: { token: string; agentKind: string; relayUrl: string }) => {
  const claude = await which('claude')
  if (!claude) return { ok: false, error: t().claudeMissingInstall }
  const prev = readConnectorFile()
  writeConnectorFile({ relayUrl: p.relayUrl, token: p.token, agentKind: p.agentKind, workdir: prev?.workdir, model: prev?.model, locale })
  await restartRunner()
  return { ok: true }
})

ipcMain.handle('connector:pickFolder', async () => {
  const file = readConnectorFile()
  if (!file) return { ok: false }
  const pick = await dialog.showOpenDialog(win!, {
    title: t().folderTitle,
    buttonLabel: t().folderButton,
    properties: ['openDirectory', 'createDirectory'],
    defaultPath: file.workdir || homedir(),
  })
  if (pick.canceled || !pick.filePaths[0]) return { ok: false }
  writeConnectorFile({ ...file, workdir: pick.filePaths[0] })
  await restartRunner()
  return { ok: true, workdir: pick.filePaths[0] }
})

ipcMain.handle('connector:restart', async () => {
  await restartRunner()
  return { ok: true }
})

ipcMain.handle('connector:openLog', async () => {
  if (existsSync(runnerLogPath())) await shell.openPath(runnerLogPath())
})

app.whenReady().then(() => {
  locale = readConnectorFile()?.locale ?? toLocale(app.getLocale()) ?? 'en'
  // 개발 모드에서도 Dock 에 앱 아이콘이 보이게(배포판은 번들의 아이콘을 쓴다)
  if (isMac && !app.isPackaged) {
    const icon = join(__dirname, '../../build/icon.png')
    if (existsSync(icon)) app.dock?.setIcon(icon)
  }
  createWindow()
  loadModelCache()
  void startRunner() // 연결해 둔 적이 있으면 앱을 켤 때 에이전트도 같이 켠다
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (!isMac) app.quit()
})

let quitting = false
app.on('before-quit', (e) => {
  if (quitting || !runner) return
  e.preventDefault()
  quitting = true
  void stopRunner().finally(() => app.quit())
})
