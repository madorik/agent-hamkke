// 러너가 에이전트(Claude Code·Codex)를 돌리는 방식.
// 공통 일(중계 서버, 이벤트 묶기, 작업 상태, 허락 중계, 마스터에게 결과 올리기)은 runner.ts 가 하고,
// 에이전트 프로세스와 주고받는 일만 엔진이 한다.
import type { RunnerState } from './config.ts'

export type RunnerStatus = 'connecting' | 'online' | 'starting' | 'working' | 'idle' | 'error' | 'stopped'

/** 에이전트가 알려 준 고를 수 있는 모델(앱의 모델 버튼) */
export interface AgentModel {
  value: string
  label: string
  description: string
  resolved: string
}

export interface PermissionAsk {
  /** 승인함에 보일 이름 */
  toolName: string
  /** 작업 상태 문구를 고르는 이름(Claude 식: Bash, Edit, mcp__서버__도구) */
  rawName: string
  description: string
  input: unknown
}

/** 러너(runner.ts)가 엔진에 주는 것 */
export interface Host {
  readonly workdir: string
  /** download_file 이 받는 곳 */
  readonly downloadDir: string
  /** 메신저 MCP 서버 이름(mcp__이름__도구) */
  readonly serverName: string
  /** 메신저 MCP 서버(claude-channel)를 띄우는 방법 */
  readonly mcp: { command: string; args: string[]; env: Record<string, string> }
  /** 이어 쓸 세션 등. 바꾸면 saveState() */
  state: RunnerState
  saveState(): void
  log(...a: unknown[]): void
  status(s: RunnerStatus, message?: string): void
  /** 앱에 알리는 그 밖의 소식(모델 목록·지금 모델) */
  emit(obj: Record<string, unknown>): void
  /** 지금 턴에서 도구를 쓰기 시작했다(작업 상태 표시) */
  toolUsed(rawName: string, input: unknown): void
  /** 가장 오래된 턴이 끝났다. 엔진은 받은 순서대로 턴을 끝낸다 */
  turnDone(r: { ok: boolean; text: string }): void
  /** 진행 중이던 앞쪽 n 개 턴을 잃었다. 다시 보낼 거면 하나로 합친다(엔진이 sessionRestarted 를 그 자리에 넣는다) */
  mergeTurns(n: number): void
  /** 진행 중이던 앞쪽 n 개 턴을 포기한다. 마스터 지시였으면 message 를 마스터에게 알린다 */
  failTurns(n: number, message: string): void
  /** 마스터에게 허락을 묻는다(데스크톱 승인함). 항상 모두 승인이면 바로 허용된다 */
  askPermission(p: PermissionAsk): Promise<{ allow: boolean; message: string }>
  /** 마스터 답을 기다리는 허락이 있나(그동안은 유휴로 내리지 않는다) */
  waitingPermission(): boolean
  /** 프로세스가 죽어 묻던 허락이 의미 없어졌다 */
  dropPermissions(): void
}

export interface Engine {
  /** 앱에 보이는 에이전트 이름 */
  readonly name: string
  /** 턴을 보낸다. 떠 있지 않으면 띄운다. 턴마다 host.turnDone(또는 mergeTurns/failTurns)이 불린다 */
  submit(text: string): void
  setModel(model: string): void
  discoverModels(): void
  /** 앱 종료: 프로세스를 내린다 */
  stop(): Promise<void>
  running(): boolean
}

/** 에이전트와 그 도구에는 ELECTRON_RUN_AS_NODE 를 넘기지 않는다(다른 Electron 앱이 안 뜬다) */
export function agentEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extra }
  delete env.ELECTRON_RUN_AS_NODE
  return env
}

export const IDLE_MS = 15 * 60_000 // 한동안 조용하면 내렸다가 다음 이벤트 때 이어서 띄운다
export const MAX_FAILS = 5
