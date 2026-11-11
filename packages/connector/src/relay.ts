// 중계 서버 호출과 실시간 연결. 커넥터(MCP 서버)와 러너가 같이 쓴다.
import type { ServerEvent } from '@ah/protocol'
import type { ConnectorConfig } from './config.ts'
import { locale, M } from './i18n.ts'

export const log = (...a: unknown[]) => console.error('[agent-hamkke]', ...a)

export type Api = <T>(method: string, path: string, body?: unknown) => Promise<T>

export function createApi(config: ConnectorConfig | null): Api {
  return async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    if (!config) throw new Error(M.noConfig)
    const r = await fetch(config.relayUrl + path, {
      method,
      headers: { 'Content-Type': 'application/json', 'Accept-Language': locale, Authorization: 'Bearer ' + config.token },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const j = (await r.json().catch(() => ({}))) as T & { error?: string }
    if (!r.ok) throw new Error(j.error ?? M.relayError(r.status))
    return j
  }
}

/** 파일 올리기·받기는 JSON 이 아니라 바이트로 주고받는다. */
export function createFileApi(config: ConnectorConfig | null) {
  const need = () => {
    if (!config) throw new Error(M.noConfig)
    return config
  }
  return {
    async upload<T>(channelId: string, p: { name: string; mime: string; data: Uint8Array<ArrayBuffer>; visibility: 'channel' | 'private'; note?: string }): Promise<T> {
      const c = need()
      const q = new URLSearchParams({ name: p.name, visibility: p.visibility, note: p.note ?? '' })
      const r = await fetch(`${c.relayUrl}/channels/${channelId}/files?${q}`, {
        method: 'POST',
        headers: { 'Content-Type': p.mime, 'Accept-Language': locale, Authorization: 'Bearer ' + c.token },
        body: p.data,
      })
      const j = (await r.json().catch(() => ({}))) as T & { error?: string }
      if (!r.ok) throw new Error(j.error ?? M.relayError(r.status))
      return j
    },
    async download(fileId: string): Promise<{ name: string; mime: string; data: Uint8Array }> {
      const c = need()
      const r = await fetch(`${c.relayUrl}/files/${encodeURIComponent(fileId)}`, {
        headers: { 'Accept-Language': locale, Authorization: 'Bearer ' + c.token },
      })
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string }
        throw new Error(j.error ?? M.relayError(r.status))
      }
      const cd = r.headers.get('content-disposition') ?? ''
      const m = /filename\*=UTF-8''([^;]+)/i.exec(cd)
      return {
        name: m ? decodeURIComponent(m[1]) : fileId,
        mime: r.headers.get('content-type') ?? 'application/octet-stream',
        data: new Uint8Array(await r.arrayBuffer()),
      }
    },
  }
}

/**
 * 중계 서버에 붙어 이벤트를 순서대로 넘긴다. 끊기면 점점 길게 기다렸다 다시 붙는다.
 * 토큰이 새로 발급돼 끊긴 경우(4001)엔 onRevoked 를 부르고 멈춘다.
 */
export function connectRelay(config: ConnectorConfig, onEvent: (ev: ServerEvent) => Promise<void>, onRevoked?: () => void) {
  let attempt = 0
  const open = () => {
    // 시스템 메시지를 에이전트 언어로 받는다
    const ws = new WebSocket(config.relayUrl.replace(/^http/, 'ws') + '/ws?token=' + encodeURIComponent(config.token) + '&locale=' + locale)
    let queue = Promise.resolve()
    ws.onopen = () => {
      attempt = 0
    }
    ws.onmessage = (e) => {
      const ev = JSON.parse(String(e.data)) as ServerEvent
      queue = queue.then(() => onEvent(ev)).catch((err) => log(err))
    }
    ws.onclose = (e) => {
      if (e.code === 4001) {
        log('A new token was issued elsewhere; closing this connection.')
        onRevoked?.()
        return
      }
      const wait = Math.min(30_000, 1000 * 2 ** attempt++)
      setTimeout(open, wait)
    }
    ws.onerror = () => {}
  }
  open()
}
