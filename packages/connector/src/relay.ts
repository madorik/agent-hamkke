// 중계 서버 호출과 실시간 연결. 커넥터(MCP 서버)와 러너가 같이 쓴다.
import type { ServerEvent, UploadTicket } from '@ah/protocol'
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
    /** 올리기 허가를 받아 바이트를 그 주소(Vercel Blob)에 바로 PUT 한 뒤 채널에 낸다 */
    async upload<T>(channelId: string, p: { name: string; mime: string; data: Uint8Array<ArrayBuffer>; visibility: 'channel' | 'private'; note?: string }): Promise<T> {
      const api = createApi(need())
      const ticket = await api<UploadTicket>('POST', `/channels/${channelId}/uploads`, {
        name: p.name,
        mime: p.mime,
        size: p.data.byteLength,
        visibility: p.visibility,
      })
      const put = await fetch(ticket.url, { method: 'PUT', headers: { 'Content-Type': p.mime }, body: p.data })
      if (!put.ok) throw new Error(M.relayError(put.status))
      return api<T>('POST', `/channels/${channelId}/files`, { uploadId: ticket.uploadId, visibility: p.visibility, note: p.note ?? '' })
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
 * 서버가 reconnect 를 보내면(Vercel 함수 수명) 옛 연결을 둔 채 ?resume= 로 새 연결을 연다.
 * 서버가 이벤트를 빠짐·겹침 없이 새 연결로 넘기고 옛 연결을 닫는다.
 */
export function connectRelay(config: ConnectorConfig, onEvent: (ev: ServerEvent) => Promise<void>, onRevoked?: () => void) {
  let attempt = 0
  let current: WebSocket | null = null
  let connId: string | null = null
  // 옛 연결과 새 연결의 이벤트를 한 줄로 처리한다
  let queue = Promise.resolve()
  const open = (resume?: string) => {
    // 시스템 메시지를 에이전트 언어로 받는다
    const ws = new WebSocket(
      config.relayUrl.replace(/^http/, 'ws') +
        '/ws?token=' +
        encodeURIComponent(config.token) +
        '&locale=' +
        locale +
        (resume ? '&resume=' + encodeURIComponent(resume) : ''),
    )
    current = ws
    ws.onopen = () => {
      attempt = 0
    }
    ws.onmessage = (e) => {
      const ev = JSON.parse(String(e.data)) as ServerEvent
      if (ev.type === 'hello') connId = ev.connId
      if (ev.type === 'reconnect') {
        if (current === ws && connId) open(connId)
        return
      }
      queue = queue.then(() => onEvent(ev)).catch((err) => log(err))
    }
    ws.onclose = (e) => {
      if (current !== ws) return // 새 연결로 넘어갔다
      if (e.code === 4001) {
        log('A new token was issued elsewhere; closing this connection.')
        onRevoked?.()
        return
      }
      const wait = Math.min(30_000, 1000 * 2 ** attempt++)
      setTimeout(() => open(), wait)
    }
    ws.onerror = () => {}
  }
  open()
}
