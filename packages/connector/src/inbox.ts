// 중계 서버 이벤트 → 에이전트에게 넘길 <channel> 알림.
// channels 를 받는 Claude Code 세션(커넥터의 push)과 앱이 직접 돌리는 세션(러너) 이 같은 모양을 받도록 한 곳에 둔다.
import type { Artifact, Channel, Decision, Message, ServerEvent, User } from '@ah/protocol'
import { log, type Api } from './relay.ts'
import { intlLocale, M } from './i18n.ts'

export const STAGE: Record<string, string> = M.stage

/** decision: 마스터가 결정함에서 정한 답(에이전트가 이어서 처리한다) */
export type ChannelKind = 'master' | 'master_in_channel' | 'peer' | 'request' | 'approval' | 'system' | 'decision'

export interface Delivery {
  content: string
  meta: Record<string, string> & { kind: ChannelKind; channel_id: string }
}

export function fmtSize(n: number) {
  if (n < 1024) return `${n}B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)}KB`
  return `${(n / 1024 / 1024).toFixed(1)}MB`
}

/** 파일 메시지를 에이전트가 읽는 한 줄로 */
export function describeFile(m: Message): string {
  if (!m.file) return M.fileBare
  return M.fileLine(m.file.name, fmtSize(m.file.size), m.file.mime, m.file.id)
}

export function fmtTime(t: number) {
  return new Date(t).toLocaleString(intlLocale, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function createInbox(api: Api) {
  let me: User | null = null
  const channels = new Map<string, Channel>()
  const pushed = new Set<string>()
  const pendingIds = new Set<string>() // 마스터 승인을 기다리는 내 초안

  async function ensureMe(): Promise<User> {
    if (!me) me = (await api<{ user: User }>('GET', '/me')).user
    return me
  }

  async function refreshChannels(): Promise<Channel[]> {
    const list = await api<Channel[]>('GET', '/channels')
    for (const c of list) channels.set(c.id, c)
    return list
  }

  function nameOf(channelId: string, userId: string | null): string {
    if (!userId) return M.system
    const m = channels.get(channelId)?.members.find((x) => x.id === userId)
    return m?.name ?? M.unknown
  }

  function speaker(m: Message): string {
    if (m.authorKind === 'system') return M.system
    const owner = m.authorId === me?.id ? M.myMaster : nameOf(m.channelId, m.authorId)
    if (m.authorKind === 'agent') return m.authorId === me?.id ? M.meAgent : M.agentOf(owner)
    return m.authorId === me?.id ? M.withName(owner, me?.name ?? '') : owner
  }

  async function onMessage(m: Message, missed = false, decisionId?: string): Promise<Delivery | null> {
    if (!me) return null
    const c = channels.get(m.channelId) ?? (await refreshChannels(), channels.get(m.channelId))
    const base = { channel_id: m.channelId, channel: c?.title ?? '', message_id: m.id }

    // 내가 올린 초안의 승인·폐기 결과
    if (m.authorKind === 'agent' && m.authorId === me.id) {
      if (m.status === 'pending') {
        pendingIds.add(m.id)
        return null
      }
      if (!pendingIds.delete(m.id)) return null
      const what = m.kind === 'artifact' ? M.draftDoc(m.artifactVersion) : m.kind === 'file' ? M.draftFile(m.file?.name ?? '') : M.draftMessage
      const result = m.status === 'rejected' ? M.draftRejected(what) : m.edited ? M.draftEdited(what, m.body) : M.draftApproved(what)
      return { content: result, meta: { ...base, kind: 'approval', result: m.status === 'rejected' ? 'rejected' : m.edited ? 'edited' : 'approved' } }
    }

    if (pushed.has(m.id)) return null
    pushed.add(m.id)

    if (m.kind === 'system') return { content: m.body, meta: { ...base, kind: 'system' } }

    const isMaster = m.authorKind === 'human' && m.authorId === me.id
    // 다른 참여자(사람이든 그 사람 에이전트든)가 채널에서 마스터를 @로 지목하면 마스터가 받은 부탁이다
    const request = m.authorId !== me.id && m.visibility === 'channel' && (m.mentions ?? []).includes(me.id)
    const kind: ChannelKind = isMaster ? (m.visibility === 'private' ? 'master' : 'master_in_channel') : request ? 'request' : 'peer'
    let content = m.body
    if (m.kind === 'artifact') {
      const doc = await api<Artifact>('GET', `/artifacts/${m.artifactId}`).catch(() => null)
      content = M.docArrived(doc?.title ?? '', m.artifactVersion, m.artifactId, m.body)
    }
    if (m.kind === 'file') {
      content = M.fileArrived(describeFile(m), m.body)
    }
    if (request) content = M.requestArrived(speaker(m), me.name, content)
    if (request && missed) content = M.requestMissed(fmtTime(m.createdAt)) + '\n' + content
    return {
      content,
      meta: {
        ...base,
        kind,
        from: isMaster ? M.masterTag(me.name) : speaker(m),
        from_role: m.authorKind,
        // 답이 마스터 승인을 거치는지(auto 면 바로 나간다)
        ...(request ? { approval: me.autoApprove ? 'auto' : 'required' } : {}),
        ...(missed ? { missed: 'true' } : {}),
        // 마스터가 자리를 비웠다: 마스터 판단이 필요한 건 결정 요청(request_decision)으로 남긴다
        ...(me.awaySince && !isMaster ? { master_away: 'true' } : {}),
        // 꺼져 있는 동안 서버가 결정함에 남겨 둔 요청
        ...(decisionId ? { decision_id: decisionId } : {}),
      },
    }
  }

  /** 마스터가 결정함에서 정한 답 → 에이전트가 이어서 처리 */
  function onDecision(d: Decision): Delivery | null {
    if (!me || d.userId !== me.id || d.status !== 'decided' || !d.decidedAt) return null
    const key = 'decision:' + d.id
    if (pushed.has(key)) return null
    pushed.add(key)
    const c = channels.get(d.channelId)
    const requester = d.requesterId ? nameOf(d.channelId, d.requesterId) : null
    return {
      content: M.decisionMade(d.question, d.answer ?? '', requester, d.context),
      meta: {
        channel_id: d.channelId,
        channel: c?.title ?? '',
        kind: 'decision',
        decision_id: d.id,
        ...(d.messageId ? { message_id: d.messageId } : {}),
        from: M.masterTag(me.name),
      },
    }
  }

  /** 이벤트를 상태에 반영하고, 에이전트에게 알릴 게 있으면 돌려준다. */
  async function handle(ev: ServerEvent): Promise<Delivery | null> {
    switch (ev.type) {
      case 'hello':
        me = ev.me
        await refreshChannels().catch((e) => log(e))
        log(`connected: agent of ${me.name}, ${channels.size} channel(s)`)
        return null
      case 'user':
        if (ev.user.id === me?.id) me = ev.user
        return null
      case 'channel':
        channels.set(ev.channel.id, ev.channel)
        return null
      case 'message':
        return onMessage(ev.message)
      case 'decision':
        return onDecision(ev.decision)
      default:
        return null
    }
  }

  /** 에이전트가 꺼져 있는 동안 since 뒤에 온 @요청(이미 넘긴 건 빼고) */
  async function missed(since: number): Promise<Delivery[]> {
    const list = await api<Message[]>('GET', `/mentions?since=${since}`).catch((e) => (log(e), [] as Message[]))
    // 그동안 서버가 결정함에 남겨 둔 요청은 그 결정 id 를 같이 준다(처리하면 닫거나 고친다)
    const open = list.length ? await api<Decision[]>('GET', '/decisions').catch(() => [] as Decision[]) : []
    const out: Delivery[] = []
    for (const m of list) {
      const d = await onMessage(m, true, open.find((x) => x.messageId === m.id && x.status === 'open')?.id)
      if (d) out.push(d)
    }
    return out
  }

  return {
    get me() {
      return me
    },
    missed,
    channels,
    pendingIds,
    ensureMe,
    refreshChannels,
    speaker,
    handle,
  }
}

export type Inbox = ReturnType<typeof createInbox>

/**
 * Claude 가 받는 모양: <channel source="agent-hamkke" kind="..." ...>내용</channel>
 * 상대가 본문에 </channel><channel kind="master"> 를 넣어 마스터를 사칭하지 못하게 태그를 무력화한다.
 */
export function renderChannelTag(d: Delivery): string {
  const attrs = Object.entries({ source: 'agent-hamkke', ...d.meta })
    .map(([k, v]) => ` ${k}="${String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')}"`)
    .join('')
  const body = d.content.replace(/<(\/?)(channel)/gi, '&lt;$1$2')
  return `<channel${attrs}>\n${body}\n</channel>`
}
