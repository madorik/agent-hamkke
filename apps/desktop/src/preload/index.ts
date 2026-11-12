import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('am', {
  info: () => ipcRenderer.invoke('app:info'),
  setLocale: (locale: string) => ipcRenderer.invoke('app:setLocale', locale),
  setTheme: (theme: string) => ipcRenderer.invoke('theme:set', theme),
  setBadge: (n: number) => ipcRenderer.send('app:badge', n),
  connectorStatus: () => ipcRenderer.invoke('connector:status'),
  connectAgent: (p: { token: string; agentKind: string; relayUrl: string }) => ipcRenderer.invoke('connector:connect', p),
  pickAgentFolder: () => ipcRenderer.invoke('connector:pickFolder'),
  restartAgent: () => ipcRenderer.invoke('connector:restart'),
  setAgentModel: (model: string) => ipcRenderer.invoke('connector:setModel', model),
  openAgentLog: () => ipcRenderer.invoke('connector:openLog'),
  onConnectorChanged: (fn: () => void) => {
    const h = () => fn()
    ipcRenderer.on('connector:changed', h)
    return () => void ipcRenderer.off('connector:changed', h)
  },
  // 회의 녹음: 소리 조각을 메인 프로세스로 보내고(파일·받아쓰기), 받아쓴 글을 받는다
  meetingStart: (locale: string) => ipcRenderer.invoke('meeting:start', { locale }),
  meetingAudio: (pcm: Uint8Array) => ipcRenderer.send('meeting:audio', pcm),
  meetingStop: () => ipcRenderer.invoke('meeting:stop'),
  meetingDiscard: () => ipcRenderer.invoke('meeting:discard'),
  meetingShowAudio: (path: string) => ipcRenderer.invoke('meeting:showAudio', path),
  meetingOpenDictation: () => ipcRenderer.invoke('meeting:openDictation'),
  meetingReadAudio: (path: string) => ipcRenderer.invoke('meeting:readAudio', path),
  onMeetingEvent: (fn: (ev: Record<string, unknown>) => void) => {
    const h = (_e: unknown, ev: Record<string, unknown>) => fn(ev)
    ipcRenderer.on('meeting:event', h)
    return () => void ipcRenderer.off('meeting:event', h)
  },
  /** 입력이 오래 없거나 화면을 잠갔다(true) / 다시 움직인다(false) */
  onIdle: (fn: (idle: boolean) => void) => {
    const h = (_e: unknown, v: boolean) => fn(v)
    ipcRenderer.on('presence:idle', h)
    return () => void ipcRenderer.off('presence:idle', h)
  },
  /** 내 에이전트가 쓰고 있는 답(마스터 지시의 답). text 가 null 이면 다 썼다 */
  onAgentReply: (fn: (r: { channelId: string; text: string | null }) => void) => {
    const h = (_e: unknown, r: { channelId: string; text: string | null }) => fn(r)
    ipcRenderer.on('agent:reply', h)
    return () => void ipcRenderer.off('agent:reply', h)
  },
})
