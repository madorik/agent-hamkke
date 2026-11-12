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
  /** 내 에이전트가 쓰고 있는 답(마스터 지시의 답). text 가 null 이면 다 썼다 */
  onAgentReply: (fn: (r: { channelId: string; text: string | null }) => void) => {
    const h = (_e: unknown, r: { channelId: string; text: string | null }) => fn(r)
    ipcRenderer.on('agent:reply', h)
    return () => void ipcRenderer.off('agent:reply', h)
  },
})
