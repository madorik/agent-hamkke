import type { Approvals, Artifact, Channel, Message, PermissionRequest, Stage, UploadTicket, User } from '@ah/protocol'
import { getLocale, t } from './i18n'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export function createApi(base: () => string, token: () => string | null) {
  async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
    let r: Response
    try {
      r = await fetch(base() + path, {
        method,
        headers: {
          'Content-Type': 'application/json',
          // 오류·시스템 메시지를 화면 언어로 받는다
          'Accept-Language': getLocale(),
          ...(token() ? { Authorization: 'Bearer ' + token() } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    } catch {
      throw new ApiError(0, t('api.offline'))
    }
    const j = (await r.json().catch(() => ({}))) as T & { error?: string }
    if (!r.ok) throw new ApiError(r.status, j.error ?? t('api.error', { status: r.status }))
    return j
  }

  // 파일 받기는 JSON 이 아니라 바이트를 그대로 받는다
  async function raw(method: string, path: string, init: { body?: BodyInit; type?: string } = {}): Promise<Response> {
    let r: Response
    try {
      r = await fetch(base() + path, {
        method,
        headers: {
          ...(init.type ? { 'Content-Type': init.type } : {}),
          'Accept-Language': getLocale(),
          ...(token() ? { Authorization: 'Bearer ' + token() } : {}),
        },
        body: init.body,
      })
    } catch {
      throw new ApiError(0, t('api.offline'))
    }
    if (!r.ok) {
      const j = (await r.json().catch(() => ({}))) as { error?: string }
      throw new ApiError(r.status, j.error ?? t('api.error', { status: r.status }))
    }
    return r
  }

  return {
    signup: (name: string) => req<{ user: User; token: string }>('POST', '/signup', { name }),
    me: () => req<{ user: User }>('GET', '/me'),
    rename: (name: string) => req<{ user: User }>('PATCH', '/me', { name }),
    /** 항상 모두 승인 켜고 끄기 */
    setAutoApprove: (autoApprove: boolean) => req<{ user: User }>('PATCH', '/me', { autoApprove }),
    agentToken: (agentKind: string) => req<{ token: string }>('POST', '/agent-tokens', { agentKind }),

    channels: () => req<Channel[]>('GET', '/channels'),
    createChannel: (title: string) => req<Channel>('POST', '/channels', { title }),
    patchChannel: (id: string, p: Partial<{ title: string; stage: Stage; requireApproval: boolean; turnLimit: number }>) =>
      req<Channel>('PATCH', `/channels/${id}`, p),
    patchMembership: (id: string, p: { agentEnabled: boolean }) => req<Channel>('PATCH', `/channels/${id}/me`, p),
    markRead: (id: string) => req<Channel>('POST', `/channels/${id}/read`),
    invite: (id: string) => req<{ code: string }>('POST', `/channels/${id}/invites`),
    join: (code: string) => req<Channel>('POST', `/invites/${encodeURIComponent(code.trim().toUpperCase())}/accept`),

    messages: (id: string) => req<Message[]>('GET', `/channels/${id}/messages`),
    send: (id: string, body: string, visibility: 'channel' | 'private') =>
      req<Message>('POST', `/channels/${id}/messages`, { body, visibility }),
    approve: (messageId: string, body?: string) => req<Message>('POST', `/messages/${messageId}/approve`, { body }),
    reject: (messageId: string) => req<{ ok: true }>('POST', `/messages/${messageId}/reject`),

    artifacts: (channelId: string) => req<Artifact[]>('GET', `/channels/${channelId}/artifacts`),
    saveArtifact: (channelId: string, p: { artifactId?: string; title?: string; content: string; note?: string }) =>
      req<{ artifact: Artifact; message: Message }>('POST', `/channels/${channelId}/artifacts`, p),
    finalize: (artifactId: string, version: number) => req<Artifact>('POST', `/artifacts/${artifactId}/finalize`, { version }),

    // 올리기 허가를 받아 바이트를 그 주소(Vercel Blob)에 바로 PUT 한 뒤 채널에 낸다
    uploadFile: async (channelId: string, file: File, visibility: 'channel' | 'private', note = '') => {
      const mime = file.type || 'application/octet-stream'
      const ticket = await req<UploadTicket>('POST', `/channels/${channelId}/uploads`, { name: file.name, mime, size: file.size, visibility })
      let put: Response
      try {
        put = await fetch(ticket.url, { method: 'PUT', headers: { 'Content-Type': mime }, body: file })
      } catch {
        throw new ApiError(0, t('api.offline'))
      }
      if (!put.ok) throw new ApiError(put.status, t('api.error', { status: put.status }))
      return req<Message>('POST', `/channels/${channelId}/files`, { uploadId: ticket.uploadId, visibility, note })
    },
    fileBlob: async (fileId: string) => (await raw('GET', `/files/${encodeURIComponent(fileId)}`)).blob(),

    approvals: () => req<Approvals>('GET', '/approvals'),
    verdict: (id: string, behavior: 'allow' | 'deny') => req<PermissionRequest>('POST', `/permission-requests/${id}/verdict`, { behavior }),
  }
}
