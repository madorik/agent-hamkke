#!/usr/bin/env node
// Claude Code 커넥터: Claude Code 가 stdio 로 띄우는 MCP 서버.
// - 답장·문서·보고 도구를 제공하고
// - (channels 가 허용된 세션이면) 채널 메시지를 <channel> 이벤트로 세션에 밀어 넣고(claude/channel)
//   도구 실행 권한 요청을 데스크톱 승인함으로 넘긴다(claude/channel/permission).
// 앱이 직접 돌리는 세션(러너, AH_RUNNER=1)에선 도구만 준다. 이벤트·권한은 러너가 맡는다.
// stdout 은 MCP 프로토콜 전용이라 로그는 전부 stderr 로.
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, extname, join, resolve } from 'node:path'
import type { Artifact, Channel, Decision, Message } from '@ah/protocol'
import { loadConfig, profile, profileDir } from './config.ts'
import { connectRelay, createApi, createFileApi, log } from './relay.ts'
import { createInbox, describeFile, fmtSize, fmtTime, STAGE } from './inbox.ts'
import { M } from './i18n.ts'

const RUNNER = process.env.AH_RUNNER === '1'
// 러너가 띄운 세션에 예전 방식(user 범위 등록)의 커넥터가 같이 붙으면, 에이전트가 다른 프로필의 도구를
// 고를 수 있다. 러너 세션 안에선 러너가 붙인 커넥터만 남긴다.
if (!RUNNER && process.env.AH_RUNNER_SESSION) {
  console.error('[agent-hamkke] inside a runner session; this connector stays off.')
  process.exit(0)
}
const config = loadConfig()
const api = createApi(config)
const files = createFileApi(config)
const inbox = createInbox(api)
const { channels, pendingIds } = inbox

// ── MCP 서버 ──────────────────────────────────────────────────

const INSTRUCTIONS = M.instructions

const mcp = new Server(
  { name: 'agent-hamkke', version: '0.1.0' },
  {
    capabilities: {
      experimental: RUNNER ? {} : { 'claude/channel': {}, 'claude/channel/permission': {} },
      tools: {},
    },
    instructions: INSTRUCTIONS,
  },
)

async function push(content: string, meta: Record<string, string>) {
  try {
    await mcp.notification({ method: 'notifications/claude/channel', params: { content, meta } })
  } catch (e) {
    log('push failed', e)
  }
}

// ── 도구 ──────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'list_channels',
    description: M.tool.list_channels,
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'read_channel',
    description: M.tool.read_channel,
    inputSchema: {
      type: 'object',
      properties: {
        channel_id: { type: 'string' },
        limit: { type: 'number', description: M.tool.read_channel_limit },
      },
      required: ['channel_id'],
    },
  },
  {
    name: 'send_message',
    description: M.tool.send_message,
    inputSchema: {
      type: 'object',
      properties: { channel_id: { type: 'string' }, text: { type: 'string', description: M.tool.send_message_text } },
      required: ['channel_id', 'text'],
    },
  },
  {
    name: 'report_to_master',
    description: M.tool.report_to_master,
    inputSchema: {
      type: 'object',
      properties: { channel_id: { type: 'string' }, text: { type: 'string' } },
      required: ['channel_id', 'text'],
    },
  },
  {
    name: 'propose_document',
    description: M.tool.propose_document,
    inputSchema: {
      type: 'object',
      properties: {
        channel_id: { type: 'string' },
        document_id: { type: 'string', description: M.tool.propose_document_id },
        title: { type: 'string' },
        content: { type: 'string', description: M.tool.propose_document_content },
        note: { type: 'string', description: M.tool.propose_document_note },
      },
      required: ['channel_id', 'content'],
    },
  },
  {
    name: 'share_file',
    description: M.tool.share_file,
    inputSchema: {
      type: 'object',
      properties: {
        channel_id: { type: 'string' },
        path: { type: 'string', description: M.tool.share_file_path },
        note: { type: 'string', description: M.tool.share_file_note },
        to_master: { type: 'boolean', description: M.tool.share_file_to_master },
      },
      required: ['channel_id', 'path'],
    },
  },
  {
    name: 'download_file',
    description: M.tool.download_file,
    inputSchema: {
      type: 'object',
      properties: { file_id: { type: 'string' } },
      required: ['file_id'],
    },
  },
  {
    name: 'read_document',
    description: M.tool.read_document,
    inputSchema: {
      type: 'object',
      properties: { document_id: { type: 'string' }, version: { type: 'number' } },
      required: ['document_id'],
    },
  },
  {
    name: 'request_decision',
    description: M.tool.request_decision,
    inputSchema: {
      type: 'object',
      properties: {
        channel_id: { type: 'string' },
        question: { type: 'string', description: M.tool.request_decision_question },
        options: { type: 'array', items: { type: 'string' }, description: M.tool.request_decision_options },
        context: { type: 'string', description: M.tool.request_decision_context },
        message_id: { type: 'string', description: M.tool.request_decision_message },
      },
      required: ['channel_id', 'question'],
    },
  },
  {
    name: 'close_decision',
    description: M.tool.close_decision,
    inputSchema: {
      type: 'object',
      properties: { decision_id: { type: 'string' }, note: { type: 'string', description: M.tool.close_decision_note } },
      required: ['decision_id', 'note'],
    },
  },
]

const Args = {
  read_channel: z.object({ channel_id: z.string(), limit: z.number().optional() }),
  send_message: z.object({ channel_id: z.string(), text: z.string().min(1) }),
  report_to_master: z.object({ channel_id: z.string(), text: z.string().min(1) }),
  propose_document: z.object({
    channel_id: z.string(),
    document_id: z.string().optional(),
    title: z.string().optional(),
    content: z.string().min(1),
    note: z.string().optional(),
  }),
  read_document: z.object({ document_id: z.string(), version: z.number().optional() }),
  share_file: z.object({ channel_id: z.string(), path: z.string().min(1), note: z.string().optional(), to_master: z.boolean().optional() }),
  download_file: z.object({ file_id: z.string().min(1) }),
  request_decision: z.object({
    channel_id: z.string(),
    question: z.string().min(1),
    options: z.array(z.string()).optional(),
    context: z.string().optional(),
    message_id: z.string().optional(),
  }),
  close_decision: z.object({ decision_id: z.string().min(1), note: z.string().min(1) }),
}

// ── 파일 ───────────────────────────────────────────────────────

const MAX_FILE = 25 * 1024 * 1024
const DOWNLOAD_DIR = join(profileDir(), 'files')

// 열쇠·토큰이 든 파일은 마스터가 시켜도 올리지 않는다(승인 화면에서 놓치기 쉬워서).
const SENSITIVE = [
  /\/\.ssh\//,
  /\/\.aws\//,
  /\/\.gnupg\//,
  /\/\.kube\//,
  /\/\.config\/gcloud\//,
  /\/\.docker\/config\.json$/,
  /\/\.agent-(?:hamkke|messenger)\/[^/]+\/connector\.json$/,
  /\/\.claude\.json$/,
  /\/\.claude\/\.credentials/,
  /\/Library\/Keychains\//,
  /\/\.(netrc|npmrc|pypirc|git-credentials)$/,
  /\/\.env(\.[^/]*)?$/,
  /\/id_(rsa|dsa|ecdsa|ed25519)[^/]*$/,
  /\.(pem|key|p12|pfx|keychain|keychain-db|kdbx)$/i,
]

const MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.heic': 'image/heic', '.svg': 'image/svg+xml', '.pdf': 'application/pdf', '.txt': 'text/plain', '.md': 'text/markdown',
  '.csv': 'text/csv', '.json': 'application/json', '.html': 'text/html', '.zip': 'application/zip',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.hwp': 'application/x-hwp', '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
}

function localPath(p: string): string {
  const expanded = p.startsWith('~') ? join(homedir(), p.slice(1)) : p
  return resolve(process.cwd(), expanded)
}

function safeName(name: string) {
  return basename(name).replace(/[\u0000-\u001f\u007f/\\:]/g, '_') || 'file'
}

async function runTool(name: string, raw: unknown): Promise<string> {
  const me = await inbox.ensureMe()
  switch (name) {
    case 'list_channels': {
      const list = await inbox.refreshChannels()
      if (!list.length) return M.noChannels
      return list
        .map((c) => {
          const members = c.members
            .map((m) => `${m.name}${m.id === me.id ? M.masterSuffix : ''}${m.agentEnabled && m.agentOnline ? M.agentSuffix : ''}`)
            .join(', ')
          return M.channelLine(c.title, STAGE[c.stage], c.id, members, c.requireApproval)
        })
        .join('\n')
    }
    case 'read_channel': {
      const a = Args.read_channel.parse(raw)
      const c = await api<Channel>('GET', `/channels/${a.channel_id}`)
      channels.set(c.id, c)
      const msgs = await api<Message[]>('GET', `/channels/${a.channel_id}/messages`)
      const docs = await api<Artifact[]>('GET', `/channels/${a.channel_id}/artifacts`)
      const lines = msgs.slice(-(a.limit ?? 40)).map((m) => {
        const tag = m.status === 'pending' ? M.tagPending : m.visibility === 'private' ? M.tagPrivate : ''
        const body =
          m.kind === 'artifact'
            ? `${M.docInline(docs.find((d) => d.id === m.artifactId)?.title ?? '', m.artifactVersion)} ${m.body}`
            : m.kind === 'file'
              ? `${describeFile(m)} ${m.body}`
              : m.body
        return `[${fmtTime(m.createdAt)}] ${inbox.speaker(m)}${tag}: ${body}`
      })
      const docLines = docs.map((d) => M.docListLine(d.title, d.id, d.versions.at(-1)?.version, d.status === 'final' ? d.finalVersion : null))
      return [
        M.channelHeader(c.title, STAGE[c.stage], c.turnLimit),
        M.membersLine(c.members.map((m) => m.name).join(', ')),
        docLines.length ? M.docsBlock(docLines.join('\n')) : M.docsNone,
        '',
        ...lines,
      ].join('\n')
    }
    case 'send_message': {
      const a = Args.send_message.parse(raw)
      const m = await api<Message>('POST', `/channels/${a.channel_id}/messages`, { body: a.text })
      if (m.status === 'pending') pendingIds.add(m.id)
      return m.status === 'pending' ? M.sentPending : M.sent
    }
    case 'report_to_master': {
      const a = Args.report_to_master.parse(raw)
      await api<Message>('POST', `/channels/${a.channel_id}/messages`, { body: a.text, visibility: 'private' })
      return M.reported
    }
    case 'propose_document': {
      const a = Args.propose_document.parse(raw)
      if (!a.document_id && !a.title) throw new Error(M.titleRequired)
      const r = await api<{ artifact: Artifact; message: Message }>('POST', `/channels/${a.channel_id}/artifacts`, {
        artifactId: a.document_id,
        title: a.title,
        content: a.content,
        note: a.note,
      })
      if (r.message.status === 'pending') pendingIds.add(r.message.id)
      const v = r.message.artifactVersion
      return M.docPosted(r.artifact.title, v, r.artifact.id, r.message.status === 'pending')
    }
    case 'share_file': {
      const a = Args.share_file.parse(raw)
      const target = localPath(a.path)
      let real: string
      try {
        real = realpathSync(target)
      } catch {
        throw new Error(M.fileNotFound(target))
      }
      const st = statSync(real)
      if (!st.isFile()) throw new Error(M.notAFile(real))
      if (st.size === 0) throw new Error(M.emptyFile)
      if (st.size > MAX_FILE) throw new Error(M.fileTooBig(fmtSize(st.size)))
      if (SENSITIVE.some((re) => re.test(real))) throw new Error(M.sensitiveFile)
      const visibility = a.to_master ? 'private' : 'channel'
      const m = await files.upload<Message>(a.channel_id, {
        name: basename(real),
        mime: MIME[extname(real).toLowerCase()] ?? 'application/octet-stream',
        data: readFileSync(real),
        visibility,
        note: a.note,
      })
      if (m.status === 'pending') pendingIds.add(m.id)
      return M.fileShared(basename(real), fmtSize(st.size), m.file?.id, visibility === 'private')
    }
    case 'download_file': {
      const a = Args.download_file.parse(raw)
      const f = await files.download(a.file_id)
      const dir = join(DOWNLOAD_DIR, safeName(a.file_id))
      mkdirSync(dir, { recursive: true })
      const path = join(dir, safeName(f.name))
      writeFileSync(path, f.data)
      return M.fileSaved(path, f.name, fmtSize(f.data.length), f.mime)
    }
    case 'read_document': {
      const a = Args.read_document.parse(raw)
      const d = await api<Artifact>('GET', `/artifacts/${a.document_id}`)
      const v = a.version ? d.versions.find((x) => x.version === a.version) : d.versions.at(-1)
      if (!v) throw new Error(M.noSuchVersion)
      const signed = d.finalizations.filter((f) => f.version === v.version).length
      return [
        M.docHeader(d.title, v.version, v.status === 'pending'),
        M.docVersions(d.versions.map((x) => 'v' + x.version).join(', '), d.status === 'final' ? d.finalVersion : null, signed),
        '',
        v.content,
      ].join('\n')
    }
    case 'request_decision': {
      const a = Args.request_decision.parse(raw)
      const d = await api<Decision>('POST', '/decisions', {
        channelId: a.channel_id,
        question: a.question,
        options: a.options,
        context: a.context,
        messageId: a.message_id,
      })
      return M.decisionRecorded(d.id)
    }
    case 'close_decision': {
      const a = Args.close_decision.parse(raw)
      await api<Decision>('POST', `/decisions/${a.decision_id}/resolve`, { note: a.note })
      return M.decisionClosed
    }
  }
  throw new Error(M.unknownTool(name))
}

mcp.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }))
mcp.setRequestHandler(CallToolRequestSchema, async (req) => {
  try {
    const text = await runTool(req.params.name, req.params.arguments ?? {})
    return { content: [{ type: 'text', text }] }
  } catch (e) {
    return { content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }], isError: true }
  }
})

// Claude Code 의 도구 실행 권한 요청 → 데스크톱 승인함
const PermissionRequestSchema = z.object({
  method: z.literal('notifications/claude/channel/permission_request'),
  params: z.object({
    request_id: z.string(),
    tool_name: z.string(),
    description: z.string(),
    input_preview: z.string(),
  }),
})
mcp.setNotificationHandler(PermissionRequestSchema, async ({ params }) => {
  try {
    await api('POST', '/permission-requests', {
      requestId: params.request_id,
      toolName: params.tool_name,
      description: params.description,
      inputPreview: params.input_preview,
    })
  } catch (e) {
    log('failed to forward permission request', e)
  }
})

// ── 들어오는 이벤트 → 세션 (channels 가 허용된 세션만) ─────────────

await mcp.connect(new StdioServerTransport())
if (!config) log('no config file for profile:', profile())
else if (!RUNNER)
  connectRelay(config, async (ev) => {
    if (ev.type === 'permission_verdict') {
      await mcp
        .notification({
          method: 'notifications/claude/channel/permission',
          params: { request_id: ev.requestId, behavior: ev.behavior },
        })
        .catch((e) => log(e))
      return
    }
    const d = await inbox.handle(ev)
    if (d) await push(d.content, d.meta)
  })
