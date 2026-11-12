// 회의 녹음(메인 프로세스): 화면이 마이크에서 받은 소리(16kHz·모노·16비트 PCM)를 받아
// - 이 PC 의 프로필 폴더(meetings/)에 WAV 로 쓰고(끝나면 macOS 는 m4a 로 줄인다)
// - macOS 면 받아쓰기 도우미(transcriber, Speech 프레임워크·기기 안 인식)에 흘려 넣어 글을 화면에 돌려준다.
// 소리는 이 PC 밖으로 나가지 않는다. 채널에 올리는 건 사람이 고를 때만(화면이 한다).
import { app, ipcMain, shell, systemPreferences, type BrowserWindow } from 'electron'
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { createInterface } from 'node:readline'

const RATE = 16000
const MAX_UPLOAD = 25 * 1024 * 1024

interface Recording {
  dir: string
  wav: string
  fd: number
  bytes: number
  helper: ChildProcess | null
  exited: Promise<void> | null
}
let rec: Recording | null = null

/** 회의를 녹음하는 중(말만 하고 입력이 없어도 자리 비움으로 보지 않는다) */
export const isRecording = () => rec !== null

/** 받아쓰기 도우미. 시험용으로 AH_TRANSCRIBER 를 주면 그걸 쓴다 */
function transcriberPath(): string | null {
  if (process.env.AH_TRANSCRIBER) return process.env.AH_TRANSCRIBER
  if (process.platform !== 'darwin') return null
  const path = app.isPackaged
    ? join(process.resourcesPath ?? '', 'transcriber', 'transcriber')
    : resolve(app.getAppPath(), 'resources/transcriber/transcriber')
  return existsSync(path) ? path : null
}

function wavHeader(dataBytes: number): Buffer {
  const h = Buffer.alloc(44)
  h.write('RIFF', 0)
  h.writeUInt32LE(36 + dataBytes, 4)
  h.write('WAVE', 8)
  h.write('fmt ', 12)
  h.writeUInt32LE(16, 16) // fmt 크기
  h.writeUInt16LE(1, 20) // PCM
  h.writeUInt16LE(1, 22) // 모노
  h.writeUInt32LE(RATE, 24)
  h.writeUInt32LE(RATE * 2, 28) // 초당 바이트
  h.writeUInt16LE(2, 32) // 블록 정렬
  h.writeUInt16LE(16, 34) // 비트
  h.write('data', 36)
  h.writeUInt32LE(dataBytes, 40)
  return h
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

function run(cmd: string, args: string[]): Promise<boolean> {
  return new Promise((done) => execFile(cmd, args, { timeout: 120_000 }, (err) => done(!err)))
}

export function registerMeeting(getWin: () => BrowserWindow | null, baseDir: () => string) {
  const meetingsDir = () => join(baseDir(), 'meetings')
  const send = (ev: Record<string, unknown>) => getWin()?.webContents.send('meeting:event', ev)

  function startHelper(r: Recording, bin: string, locale: string) {
    const h = spawn(bin, [locale], { stdio: ['pipe', 'pipe', 'pipe'] })
    r.helper = h
    h.stdin?.on('error', () => {})
    h.on('error', (e) => send({ type: 'error', code: 'unavailable', message: e.message }))
    r.exited = new Promise((done) =>
      h.on('exit', (code, signal) => {
        send({ type: 'exit', code, signal })
        done()
      }),
    )
    createInterface({ input: h.stdout! }).on('line', (line) => {
      try {
        send(JSON.parse(line) as Record<string, unknown>)
      } catch {
        /* JSON 이 아닌 줄은 버린다 */
      }
    })
  }

  ipcMain.handle('meeting:start', async (_e, p: { locale: string }) => {
    if (rec) return { ok: false, error: 'busy' }
    // macOS: 마이크 권한(처음이면 묻는다). 시험(AH_E2E)에선 가짜 마이크를 쓰므로 묻지 않는다
    if (process.platform === 'darwin' && !process.env.AH_E2E) {
      const status = systemPreferences.getMediaAccessStatus('microphone')
      if (status !== 'granted' && !(await systemPreferences.askForMediaAccess('microphone'))) return { ok: false, error: 'mic' }
    }
    const dir = join(meetingsDir(), new Date().toISOString().replace(/[:.]/g, '-'))
    mkdirSync(dir, { recursive: true })
    const wav = join(dir, 'meeting.wav')
    const fd = openSync(wav, 'w')
    writeSync(fd, wavHeader(0))
    rec = { dir, wav, fd, bytes: 0, helper: null, exited: null }
    const bin = transcriberPath()
    if (bin) startHelper(rec, bin, p.locale === 'ko' ? 'ko-KR' : 'en-US')
    return { ok: true, live: bin ? 'starting' : 'off' }
  })

  ipcMain.on('meeting:audio', (_e, chunk: Uint8Array | ArrayBuffer) => {
    if (!rec) return
    const buf = chunk instanceof ArrayBuffer ? Buffer.from(chunk) : Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)
    if (!buf.length) return
    writeSync(rec.fd, buf)
    rec.bytes += buf.length
    if (rec.helper?.stdin?.writable) rec.helper.stdin.write(buf)
  })

  ipcMain.handle('meeting:stop', async () => {
    const r = rec
    if (!r) return null
    rec = null
    writeSync(r.fd, wavHeader(r.bytes), 0, 44, 0)
    closeSync(r.fd)
    // 받아쓰기가 남은 소리를 마저 글로 바꿀 때까지 기다린다
    r.helper?.stdin?.end()
    if (r.exited) await Promise.race([r.exited, wait(25_000)])
    r.helper?.kill()
    let audio = r.wav
    // macOS: 내장 afconvert 로 AAC(m4a)로 줄인다(1시간에 20MB 남짓)
    if (process.platform === 'darwin' && r.bytes > 0) {
      const m4a = join(r.dir, 'meeting.m4a')
      if ((await run('afconvert', ['-f', 'm4af', '-d', 'aac', '-b', '40000', r.wav, m4a])) && existsSync(m4a)) {
        rmSync(r.wav, { force: true })
        audio = m4a
      }
    }
    return { audio, size: existsSync(audio) ? statSync(audio).size : 0, seconds: r.bytes / 2 / RATE }
  })

  ipcMain.handle('meeting:discard', async () => {
    const r = rec
    if (!r) return
    rec = null
    r.helper?.kill()
    closeSync(r.fd)
    rmSync(r.dir, { recursive: true, force: true })
  })

  // 녹음 파일은 회의 폴더 안의 것만 다룬다
  const inside = (path: string) => resolve(path).startsWith(resolve(meetingsDir()) + sep)

  // macOS 음성 인식은 시스템 설정의 받아쓰기(Dictation)가 켜져 있어야 된다
  ipcMain.handle('meeting:openDictation', async () => {
    await shell.openExternal('x-apple.systempreferences:com.apple.Keyboard-Settings.extension').catch(() => {})
  })

  ipcMain.handle('meeting:showAudio', (_e, path: string) => {
    if (inside(path) && existsSync(path)) shell.showItemInFolder(path)
  })

  ipcMain.handle('meeting:readAudio', (_e, path: string) => {
    if (!inside(path) || !existsSync(path) || statSync(path).size > MAX_UPLOAD) return null
    return readFileSync(path)
  })

  app.on('before-quit', () => {
    if (!rec) return
    rec.helper?.kill()
    try {
      writeSync(rec.fd, wavHeader(rec.bytes), 0, 44, 0)
      closeSync(rec.fd)
    } catch {
      /* 남은 파일은 그대로 둔다 */
    }
    rec = null
  })
}
