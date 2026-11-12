// 자동 업데이트(설치한 앱만): GitHub 릴리스의 Latest 에서 새 버전을 확인해 뒤에서 받아 두고 화면에 알린다.
// 사람이 '다시 시작'을 누르면 바로 설치하고, 누르지 않아도 앱을 끌 때 설치한다.
// macOS 는 같은 Developer ID 로 서명된 새 버전만 받아들인다(Squirrel). Windows 설치 파일은 아직 서명하지 않는다.
import { app, ipcMain, type BrowserWindow } from 'electron'
import electronUpdater from 'electron-updater'

const { autoUpdater } = electronUpdater

export type UpdateState = 'idle' | 'checking' | 'none' | 'downloading' | 'ready' | 'error'
export interface UpdateStatus {
  state: UpdateState
  /** 새 버전(받는 중·준비됨) */
  version?: string
  percent?: number
  message?: string
}

const CHECK_EVERY = 4 * 60 * 60_000

export function registerUpdater(getWin: () => BrowserWindow | null, beforeInstall: () => Promise<void>) {
  let status: UpdateStatus = { state: 'idle' }
  const set = (next: UpdateStatus) => {
    status = next
    getWin()?.webContents.send('update:status', status)
  }
  // 개발 중(pnpm dev)엔 확인하지 않는다
  const enabled = app.isPackaged

  ipcMain.handle('update:status', () => ({ ...status, current: app.getVersion(), enabled }))
  ipcMain.handle('update:check', async () => {
    if (enabled) await check()
    return { ...status, current: app.getVersion(), enabled }
  })
  ipcMain.handle('update:install', async () => {
    if (status.state !== 'ready') return
    await beforeInstall() // 에이전트(러너)를 먼저 내린다
    setImmediate(() => autoUpdater.quitAndInstall(false, true))
  })

  if (!enabled) return

  autoUpdater.setFeedURL({ provider: 'github', owner: 'madorik', repo: 'agent-hamkke' })
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.logger = null
  autoUpdater.on('checking-for-update', () => {
    if (status.state !== 'downloading' && status.state !== 'ready') set({ state: 'checking' })
  })
  autoUpdater.on('update-not-available', () => set({ state: 'none' }))
  autoUpdater.on('update-available', (info) => set({ state: 'downloading', version: info.version, percent: 0 }))
  autoUpdater.on('download-progress', (p) => set({ ...status, state: 'downloading', percent: Math.round(p.percent) }))
  autoUpdater.on('update-downloaded', (info) => set({ state: 'ready', version: info.version }))
  autoUpdater.on('error', (e) => {
    // 받아 둔 업데이트가 있으면 그대로 둔다
    if (status.state !== 'ready') set({ state: 'error', message: e?.message ?? String(e) })
  })

  async function check() {
    if (status.state === 'downloading' || status.state === 'ready') return
    await autoUpdater.checkForUpdates().catch((e: unknown) => set({ state: 'error', message: e instanceof Error ? e.message : String(e) }))
  }

  app.whenReady().then(() => {
    setTimeout(() => void check(), 15_000)
    setInterval(() => void check(), CHECK_EVERY)
  })
}
