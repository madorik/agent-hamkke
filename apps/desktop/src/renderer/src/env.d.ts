type RunnerState = 'off' | 'connecting' | 'online' | 'starting' | 'working' | 'idle' | 'error' | 'stopped'

/** 에이전트가 알려 준 고를 수 있는 모델 */
interface AgentModel {
  value: string
  label: string
  description: string
  resolved: string
}

interface ConnectorStatus {
  claudeInstalled: boolean
  codexInstalled: boolean
  configured: boolean
  workdir: string
  runner: RunnerState
  message: string
  logPath: string
  agentKind: string | null
  models: AgentModel[]
  /** 고른 모델(value). 'default' 면 에이전트 기본값 */
  model: string
  /** 세션이 지금 실제로 쓰는 모델 id (세션이 떠 있을 때만) */
  activeModel: string
}

interface AmBridge {
  info(): Promise<{ platform: string; profile: string; relayUrl: string }>
  /** 화면 언어를 알려 준다(에이전트도 같은 언어로) */
  setLocale(locale: 'ko' | 'en'): Promise<void>
  setTheme(theme: 'system' | 'light' | 'dark'): Promise<void>
  setBadge(n: number): void
  connectorStatus(): Promise<ConnectorStatus>
  connectAgent(p: { token: string; agentKind: string; relayUrl: string }): Promise<{ ok: boolean; error?: string }>
  pickAgentFolder(): Promise<{ ok: boolean; workdir?: string }>
  restartAgent(): Promise<{ ok: boolean }>
  setAgentModel(model: string): Promise<{ ok: boolean; model?: string }>
  openAgentLog(): Promise<void>
  onConnectorChanged(fn: () => void): () => void
  /** 내 에이전트가 쓰고 있는 답(마스터 지시의 답). text 가 null 이면 다 썼다 */
  onAgentReply(fn: (r: { channelId: string; text: string | null }) => void): () => void
}

interface Window {
  am?: AmBridge
}
