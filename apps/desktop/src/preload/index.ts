import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('am', {
  info: () => ipcRenderer.invoke('app:info'),
  setLocale: (locale: string) => ipcRenderer.invoke('app:setLocale', locale),
  setTheme: (theme: string) => ipcRenderer.invoke('theme:set', theme),
  setBadge: (n: number) => ipcRenderer.send('app:badge', n),
  connectorStatus: () => ipcRenderer.invoke('connector:status'),
  connectClaude: (p: { token: string; agentKind: string; relayUrl: string }) => ipcRenderer.invoke('connector:connect', p),
  pickAgentFolder: () => ipcRenderer.invoke('connector:pickFolder'),
  restartAgent: () => ipcRenderer.invoke('connector:restart'),
  setAgentModel: (model: string) => ipcRenderer.invoke('connector:setModel', model),
  openAgentLog: () => ipcRenderer.invoke('connector:openLog'),
  onConnectorChanged: (fn: () => void) => {
    const h = () => fn()
    ipcRenderer.on('connector:changed', h)
    return () => void ipcRenderer.off('connector:changed', h)
  },
})
