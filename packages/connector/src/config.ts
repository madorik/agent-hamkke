import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export interface ConnectorConfig {
  relayUrl: string
  token: string
  agentKind: string
  /** 러너가 Claude Code 를 띄울 폴더. 없으면 홈 폴더. */
  workdir?: string
  /** 에이전트가 쓸 모델(에이전트가 알려 준 목록의 value). 없거나 'default' 면 에이전트 기본값. */
  model?: string
  /** 에이전트에게 주는 지시·도구 설명과 러너가 화면에 띄우는 문장의 언어(ko | en). 데스크톱 앱이 화면 언어로 적어 둔다. */
  locale?: string
}

export const profile = () => process.env.AH_PROFILE || 'default'

// 이름이 Agent Messenger 였을 때의 폴더(~/.agent-messenger)를 한 번 옮긴다. 보통은 데스크톱 앱이 먼저 옮긴다.
try {
  const legacy = join(homedir(), '.agent-messenger')
  if (existsSync(legacy) && !existsSync(join(homedir(), '.agent-hamkke'))) renameSync(legacy, join(homedir(), '.agent-hamkke'))
} catch {
  /* 옮기지 못하면 새로 연결해야 한다 */
}

// 데스크톱 앱이 "Claude Code 연결" 때 쓰는 파일. 프로필별로 나눠 한 PC 에서 두 사람을 시험할 수 있다.
export function profileDir(p = profile()): string {
  return join(homedir(), '.agent-hamkke', p)
}

export function configPath(p = profile()): string {
  return join(profileDir(p), 'connector.json')
}

export function loadConfig(): ConnectorConfig | null {
  const p = configPath()
  if (!existsSync(p)) return null
  try {
    const c = JSON.parse(readFileSync(p, 'utf8')) as ConnectorConfig
    return c.relayUrl && c.token ? c : null
  } catch {
    return null
  }
}

// 러너가 이어 쓸 Claude 세션. 작업 폴더가 바뀌면 세션을 이어 쓸 수 없어 함께 적어 둔다.
export interface RunnerState {
  /** 이어 쓸 세션(Claude Code) 또는 스레드(Codex) id */
  sessionId?: string
  /** 그 세션을 만든 에이전트. 에이전트를 바꾸면 이어 쓰지 않는다 */
  agent?: string
  workdir?: string
  /** 계정(user id)별로 마지막에 받은 메시지 시각. 다시 접속하면 그 뒤에 온 @요청을 받아 처리한다 */
  seen?: Record<string, number>
}

const statePath = () => join(profileDir(), 'runner-state.json')

export function loadState(): RunnerState {
  try {
    return JSON.parse(readFileSync(statePath(), 'utf8')) as RunnerState
  } catch {
    return {}
  }
}

export function saveState(s: RunnerState) {
  mkdirSync(dirname(statePath()), { recursive: true })
  writeFileSync(statePath(), JSON.stringify(s, null, 2), { mode: 0o600 })
}
