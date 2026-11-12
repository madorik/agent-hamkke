// 회의 받아쓰기 도우미(native/transcriber.swift)를 resources/transcriber/transcriber 로 빌드한다.
// macOS 에서만 만든다(arm64·x64 를 합친 유니버설). 다른 OS 에선 빈 폴더만 둔다(앱은 받아쓰기 없이 녹음·메모만 한다).
// 소스가 바뀌지 않았으면 다시 빌드하지 않는다.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const src = fileURLToPath(new URL('../native/transcriber.swift', import.meta.url))
const outDir = fileURLToPath(new URL('../resources/transcriber', import.meta.url))
const out = join(outDir, 'transcriber')
mkdirSync(outDir, { recursive: true })

if (process.platform !== 'darwin') {
  writeFileSync(join(outDir, 'README.txt'), 'Live transcription is macOS only.\n')
  console.log('transcriber: skipped (macOS only)')
  process.exit(0)
}
if (existsSync(out) && statSync(out).mtimeMs > statSync(src).mtimeMs) {
  console.log('transcriber: up to date')
  process.exit(0)
}

const tmp = join(tmpdir(), `ah-transcriber-${process.pid}`)
mkdirSync(tmp, { recursive: true })
const parts = []
for (const arch of ['arm64', 'x86_64']) {
  const part = join(tmp, arch)
  execFileSync('xcrun', ['swiftc', '-O', '-swift-version', '5', '-target', `${arch}-apple-macos12`, src, '-o', part], { stdio: 'inherit' })
  parts.push(part)
}
execFileSync('lipo', ['-create', ...parts, '-output', out], { stdio: 'inherit' })
rmSync(tmp, { recursive: true, force: true })
console.log('transcriber: built', out)
