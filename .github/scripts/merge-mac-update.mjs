// macOS 자동 업데이트 정보(latest-mac.yml) 합치기.
// arm64·x64 를 따로 빌드해서 각자 자기 파일만 적힌 latest-mac.yml 을 만든다. 앱(electron-updater)은
// 한 파일의 files 목록에서 자기 아키텍처 것(이름에 arm64 가 있는지)을 고르므로 두 목록을 하나로 합친다.
// 사용: node merge-mac-update.mjs <arm64.yml> <x64.yml> <out.yml>
import { readFileSync, writeFileSync } from 'node:fs'

const [arm, intel, out] = process.argv.slice(2)
if (!arm || !intel || !out) {
  console.error('usage: merge-mac-update.mjs <arm64.yml> <x64.yml> <out.yml>')
  process.exit(2)
}

/** electron-builder 가 쓰는 모양: 맨 위 키들 + files: 아래 '  - url: …' 항목들 */
function split(text) {
  const lines = text.replace(/\r/g, '').split('\n')
  const head = []
  const files = []
  const tail = []
  let section = 'head'
  for (const line of lines) {
    if (section === 'head' && line === 'files:') {
      section = 'files'
      continue
    }
    if (section === 'files' && line && !line.startsWith(' ')) section = 'tail'
    if (section === 'head') head.push(line)
    else if (section === 'files') files.push(line)
    else tail.push(line)
  }
  return { head, files: files.filter((l) => l.trim()), tail }
}

const a = split(readFileSync(arm, 'utf8'))
const b = split(readFileSync(intel, 'utf8'))
const version = (s) => s.head.find((l) => l.startsWith('version:'))
if (version(a) !== version(b)) {
  console.error(`versions differ: ${version(a)} / ${version(b)}`)
  process.exit(1)
}
/** '  - url: …' 로 시작하는 항목 묶음 */
function entries(lines) {
  const out = []
  for (const l of lines) {
    if (l.startsWith('  - ')) out.push([l])
    else out.at(-1)?.push(l)
  }
  return out
}
const urlOf = (e) => (e[0].match(/url:\s*(\S+)/) ?? [])[1] ?? ''
// arm64 파일에선 arm64 것만, x64 파일에선 나머지만(같은 파일이 두 번 들어가지 않게)
const files = [...entries(a.files).filter((e) => urlOf(e).includes('arm64')), ...entries(b.files).filter((e) => !urlOf(e).includes('arm64'))]
if (!files.some((e) => urlOf(e).includes('arm64')) || !files.some((e) => !urlOf(e).includes('arm64'))) {
  console.error('expected both arm64 and x64 files')
  process.exit(1)
}
const merged = [...a.head, 'files:', ...files.flat(), ...a.tail].join('\n').replace(/\n*$/, '\n')
writeFileSync(out, merged)
console.log(merged)
