// 회의 녹음(화면): 마이크 소리를 16kHz·모노·16비트로 바꿔 메인 프로세스로 보내고(파일·받아쓰기),
// 받아쓴 글과 메모를 모아 두었다가 끝나면 채널 문서(녹취록)로 올리고 내 에이전트에게 회의록을 부탁한다.
import { create } from 'zustand'
import { getLocale, intlLocale, t } from './i18n'
import { api, guard, sendMessage, toast, uploadFiles, useStore } from './store'

const RATE = 16000

/** dictation: macOS 받아쓰기(Dictation)가 꺼져 있어 인식이 안 된다(녹음은 계속) */
export type Live = 'starting' | 'on' | 'off' | 'denied' | 'unavailable' | 'dictation'

export interface Line {
  /** 녹음 시작부터 초 */
  start: number
  text: string
}

export interface MeetingState {
  channelId: string
  startedAt: number
  live: Live
  lines: Line[]
  /** 지금 듣는 중인 문장(아직 안 끝남) */
  partial: string
  notes: string
  /** 소리 크기(0~1) */
  level: number
  stopping: boolean
  uploadAudio: boolean
}

export const useMeeting = create<{ meeting: MeetingState | null }>(() => ({ meeting: null }))
const setM = (p: Partial<MeetingState>) => {
  const m = useMeeting.getState().meeting
  if (m) useMeeting.setState({ meeting: { ...m, ...p } })
}

// ── 마이크 ──────────────────────────────────────────────────

let stream: MediaStream | null = null
let ctx: AudioContext | null = null
let node: ScriptProcessorNode | null = null
let lastLevel = 0

/** 기본 샘플레이트(보통 48kHz) → 16kHz. 구간 평균으로 줄인다 */
function downsample(input: Float32Array, rate: number): Int16Array {
  const ratio = rate / RATE
  const n = Math.floor(input.length / ratio)
  const out = new Int16Array(n)
  for (let i = 0; i < n; i++) {
    const from = Math.floor(i * ratio)
    const to = Math.min(input.length, Math.floor((i + 1) * ratio))
    let sum = 0
    for (let j = from; j < to; j++) sum += input[j]
    const v = Math.max(-1, Math.min(1, sum / Math.max(1, to - from)))
    out[i] = v < 0 ? v * 0x8000 : v * 0x7fff
  }
  return out
}

async function openMic() {
  stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  })
  ctx = new AudioContext()
  const src = ctx.createMediaStreamSource(stream)
  node = ctx.createScriptProcessor(4096, 1, 1)
  node.onaudioprocess = (e) => {
    const f = e.inputBuffer.getChannelData(0)
    const pcm = downsample(f, ctx?.sampleRate ?? 48000)
    window.am?.meetingAudio(new Uint8Array(pcm.buffer))
    let sum = 0
    for (let i = 0; i < f.length; i++) sum += f[i] * f[i]
    const level = Math.min(1, Math.sqrt(sum / f.length) * 4)
    // 화면을 너무 자주 다시 그리지 않게 바뀔 때만
    if (Math.abs(level - lastLevel) > 0.04) {
      lastLevel = level
      setM({ level })
    }
  }
  src.connect(node)
  node.connect(ctx.destination) // 이어 놓아야 돈다(출력은 비어 있어 소리가 나지 않는다)
}

function closeMic() {
  node?.disconnect()
  node = null
  stream?.getTracks().forEach((tr) => tr.stop())
  stream = null
  void ctx?.close()
  ctx = null
}

// ── 받아쓰기 이벤트(메인 프로세스) ─────────────────────────────

let listening = false
function listen() {
  if (listening || !window.am?.onMeetingEvent) return
  listening = true
  window.am.onMeetingEvent((ev) => {
    const m = useMeeting.getState().meeting
    if (!m) return
    switch (ev.type) {
      case 'ready':
        setM({ live: 'on' })
        break
      case 'partial':
        setM({ partial: String(ev.text ?? '') })
        break
      case 'final':
        setM({ lines: [...m.lines, { start: Number(ev.start ?? 0), text: String(ev.text ?? '') }], partial: '' })
        break
      case 'error':
        setM({ live: ev.code === 'dictation' ? 'dictation' : ev.code === 'denied' || ev.code === 'restricted' ? 'denied' : 'unavailable' })
        break
      case 'exit':
        // 준비 전에 끝났다(권한·지원 문제)
        if (m.live === 'starting') setM({ live: 'unavailable' })
        break
    }
  })
}

// ── 시작·끝 ────────────────────────────────────────────────

export async function startMeeting(channelId: string) {
  if (useMeeting.getState().meeting || !window.am?.meetingStart) return
  listen()
  const r = await window.am.meetingStart(getLocale())
  if (!r.ok) {
    if (r.error === 'mic') toast(t('meeting.micDenied'))
    return
  }
  useMeeting.setState({
    meeting: { channelId, startedAt: Date.now(), live: r.live, lines: [], partial: '', notes: '', level: 0, stopping: false, uploadAudio: false },
  })
  try {
    await openMic()
  } catch {
    closeMic()
    await window.am.meetingDiscard()
    useMeeting.setState({ meeting: null })
    toast(t('meeting.micDenied'))
  }
}

export function setNotes(notes: string) {
  setM({ notes })
}

export function setUploadAudio(on: boolean) {
  setM({ uploadAudio: on })
}

export async function discardMeeting() {
  closeMic()
  await window.am?.meetingDiscard()
  useMeeting.setState({ meeting: null })
}

const clock = (sec: number) => {
  const s = Math.max(0, Math.round(sec))
  const h = Math.floor(s / 3600)
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0')
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}
export { clock as meetingClock }

/** 녹취록 문서 내용 */
export function transcriptDoc(m: Pick<MeetingState, 'startedAt' | 'lines' | 'partial' | 'notes'>, seconds: number, who: string, durText: string) {
  const when = new Date(m.startedAt).toLocaleString(intlLocale(), { month: 'long', day: 'numeric', weekday: 'short', hour: 'numeric', minute: '2-digit' })
  const lines = [...m.lines]
  if (m.partial.trim()) lines.push({ start: seconds, text: m.partial.trim() })
  const body = [
    t('meeting.transcriptHead', { when, dur: durText, who }),
    '',
    `## ${t('meeting.transcriptSection')}`,
    '',
    lines.length ? lines.map((l) => `[${clock(l.start)}] ${l.text}`).join('\n\n') : '-',
  ]
  if (m.notes.trim()) body.push('', `## ${t('meeting.notesSection')}`, '', m.notes.trim())
  return { title: t('meeting.transcriptTitle', { when }), content: body.join('\n').slice(0, 190_000), hasText: lines.length > 0 || !!m.notes.trim() }
}

/** 녹취록을 채널 문서로 올리고 내 에이전트에게 회의록을 부탁한다 */
export async function publishTranscript(channelId: string, title: string, content: string) {
  const r = await guard(api.saveArtifact(channelId, { title, content }))
  if (!r) return false
  const me = useStore.getState().me
  if (me?.agentKind) await sendMessage(channelId, t('meeting.minutesPrompt', { title: r.artifact.title, id: r.artifact.id }), 'private')
  toast(me?.agentKind ? t('meeting.done') : t('meeting.doneNoAgent'))
  return true
}

export async function stopMeeting(durText: (ms: number) => string) {
  const m = useMeeting.getState().meeting
  if (!m || m.stopping) return
  setM({ stopping: true, level: 0 })
  closeMic()
  const res = await window.am?.meetingStop()
  const done = useMeeting.getState().meeting ?? m
  const seconds = res?.seconds ?? (Date.now() - m.startedAt) / 1000
  const who = useStore.getState().me?.name ?? ''
  const doc = transcriptDoc(done, seconds, who, durText(seconds * 1000))
  if (!doc.hasText) {
    toast(t('meeting.empty'))
  } else {
    await publishTranscript(m.channelId, doc.title, doc.content)
  }
  // 녹음 파일도 채널에(25MB 까지)
  if (done.uploadAudio && res?.audio) {
    const bytes = await window.am?.meetingReadAudio(res.audio)
    if (bytes) {
      const ext = res.audio.split('.').pop() ?? 'wav'
      const file = new File([bytes as BlobPart], `${doc.title}.${ext}`, { type: ext === 'm4a' ? 'audio/mp4' : 'audio/wav' })
      await uploadFiles(m.channelId, [file], 'channel')
    } else toast(t('file.tooBig', { name: res.audio.split(/[\\/]/).pop() ?? '' }))
  }
  useMeeting.setState({ meeting: null })
  return res
}
