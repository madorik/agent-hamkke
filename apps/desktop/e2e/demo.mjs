// README 데모 영상: 실제 Electron 창을 움직이며 녹화한다(영어 UI, 밝은 테마).
// 사용: env -u ELECTRON_RUN_AS_NODE node e2e/demo.mjs <relayUrl> <out.mp4>   (ffmpeg 필요)
// Playwright 의 recordVideo 는 이 Electron 에서 창이 붙지 않아, DevTools 화면 스트림(Page.startScreencast)으로 프레임을 받는다.
// 내 쪽(Alex)은 화면에서 클릭·입력하고, 상대(Jamie)와 양쪽 에이전트는 중계 서버 API 로 움직인다.
import { _electron as electron } from 'playwright'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const RELAY = process.argv[2] ?? 'http://localhost:8787'
const OUT = process.argv[3] ?? 'demo.mp4'
const SIZE = { width: 1280, height: 800 }

const ME = 'Alex Kim'
const PEER = 'Jamie Park'
const CHANNEL = 'Q3 partnership proposal with Jamie’s team'
const S = {
  hello: 'Hi Alex! My agent will send over our requirements.',
  requirements:
    "This is Jamie's agent. Here are our three requirements:\n\n1. **Co-marketing** budget split 50:50\n2. One pilot within Q3\n3. Data-sharing scope fixed in a contract annex\n\nCould we get a first draft?",
  mine: 'Thanks Jamie! My agent will draft the proposal from our Notion notes.',
  reply: "I've drafted the proposal from Alex's Notion page. It covers #2 and #3; we'll come back on the budget split after an internal check.",
  docTitle: 'Q3 Partnership Proposal',
  doc1: '# Q3 Partnership Proposal\n\n## Goals\n- Run one pilot within Q3\n- Land one joint customer story\n\n## Scope\n| Item | Owner |\n|---|---|\n| Pilot design | Wata Labs |\n| Customer outreach | Partner |\n\n## Data sharing\nTo be fixed in a contract annex.',
  note1: 'First draft covering requirements #2 and #3',
  doc2: '# Q3 Partnership Proposal\n\n## Goals\n- Run one pilot within Q3\n- Land two joint customer stories\n\n## Scope\n| Item | Owner |\n|---|---|\n| Pilot design | Wata Labs |\n| Customer outreach | Partner |\n| Measuring results | Joint |\n\n## Data sharing\nTo be fixed in a contract annex. No personal data is shared.',
  note2: 'Two customer stories; results measured jointly',
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const call = async (method, path, token, body) => {
  const r = await fetch(RELAY + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const j = await r.json()
  if (!r.ok) throw new Error(path + ' ' + j.error)
  return j
}

const frameDir = mkdtempSync(join(tmpdir(), 'ah-demo-'))
const app = await electron.launch({
  args: ['.'],
  cwd: new URL('..', import.meta.url).pathname,
  env: { ...process.env, AH_PROFILE: 'demo-' + Date.now(), AH_RELAY_URL: RELAY },
})
const page = await app.firstWindow()
// 창이 뜬 직후 한 번 더 로드된다. 그 사이에 붙으면 페이지가 꼬이므로 잠깐 기다린다.
await wait(3000)
await page.waitForSelector('input[placeholder]')
await app.evaluate(({ BrowserWindow }, s) => BrowserWindow.getAllWindows()[0].setContentSize(s.width, s.height), SIZE)
await page.evaluate(() => (localStorage.setItem('ah:theme', 'light'), localStorage.setItem('ah:locale', 'en')))
await page.reload()
await page.waitForSelector('input[placeholder="Name"]')

// 화면이 바뀔 때마다 프레임이 온다(간격이 일정하지 않아 시각을 같이 적는다)
const frames = []
const cdp = await page.context().newCDPSession(page)
cdp.on('Page.screencastFrame', (f) => {
  const file = join(frameDir, `${String(frames.length).padStart(5, '0')}.jpg`)
  writeFileSync(file, Buffer.from(f.data, 'base64'))
  frames.push({ file, t: f.metadata.timestamp })
  cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {})
})
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 90, maxWidth: SIZE.width * 2, maxHeight: SIZE.height * 2 })

// 녹화에는 마우스가 안 찍혀서, 누를 곳으로 움직이는 표시를 그린다
await page.evaluate(() => {
  const c = document.createElement('div')
  c.id = 'demo-cursor'
  Object.assign(c.style, {
    position: 'fixed', left: '640px', top: '520px', width: '20px', height: '20px', margin: '-10px 0 0 -10px',
    borderRadius: '50%', background: 'rgba(17,17,17,.28)', border: '2px solid rgba(255,255,255,.95)',
    boxShadow: '0 1px 6px rgba(0,0,0,.35)', zIndex: 2147483647, pointerEvents: 'none',
    transition: 'left .5s cubic-bezier(.3,.7,.4,1), top .5s cubic-bezier(.3,.7,.4,1), transform .15s',
  })
  document.body.appendChild(c)
})
async function clickOn(locator) {
  await locator.waitFor()
  const b = await locator.boundingBox()
  await page.evaluate(([x, y]) => {
    const c = document.getElementById('demo-cursor')
    c.style.left = x + 'px'
    c.style.top = y + 'px'
  }, [b.x + b.width / 2, b.y + b.height / 2])
  await wait(600)
  await page.evaluate(() => {
    const c = document.getElementById('demo-cursor')
    c.style.transform = 'scale(.7)'
    setTimeout(() => (c.style.transform = ''), 160)
  })
  await locator.click()
}
const type = (text) => page.keyboard.type(text, { delay: 38 })

// 1. 시작: 이름만 넣으면 된다
await wait(900)
await clickOn(page.locator('input[placeholder="Name"]'))
await type(ME)
await clickOn(page.locator('button[type=submit]'))
await page.waitForSelector('text=What should we work on together?')
await wait(900)

// 2. 할 일을 적으면 채널이 열리고 초대 코드가 나온다
await clickOn(page.locator('textarea'))
await type(CHANNEL)
await wait(300)
await page.keyboard.press('Enter')
await page.waitForFunction(() => /^[A-Z0-9]{6}$/.test(document.querySelector('.font-mono')?.textContent ?? ''))
const code = await page.textContent('.font-mono')
await wait(1800)
await page.keyboard.press('Escape')

// 3. 상대가 코드로 들어오고, 상대 에이전트가 요구사항을 보낸다
const me = await page.evaluate(() => localStorage.getItem('ah:token'))
const jamie = await call('POST', '/signup', null, { name: PEER })
const ch = await call('POST', `/invites/${code}/accept`, jamie.token)
await call('PATCH', '/me', jamie.token, { autoApprove: true })
const { token: myAgent } = await call('POST', '/agent-tokens', me, { agentKind: 'claude-code' })
const { token: jamieAgent } = await call('POST', '/agent-tokens', jamie.token, { agentKind: 'claude-code' })
const live = [myAgent, jamieAgent].map((t) => new WebSocket(RELAY.replace(/^http/, 'ws') + '/ws?token=' + t))
await wait(1200)
await call('POST', `/channels/${ch.id}/messages`, jamie.token, { body: S.hello })
await wait(1400)
await call('POST', `/channels/${ch.id}/messages`, jamieAgent, { body: S.requirements })
await wait(2600)

// 4. 내가 채널에 말하고, 내 에이전트의 답과 문서 초안은 입력창 위에서 승인을 기다린다
await clickOn(page.locator('textarea[placeholder^="Message the channel"]'))
await type(S.mine)
await page.keyboard.press('Enter')
await wait(1500)
await call('POST', `/channels/${ch.id}/messages`, myAgent, { body: S.reply })
const doc = await call('POST', `/channels/${ch.id}/artifacts`, myAgent, { title: S.docTitle, content: S.doc1, note: S.note1 })
await wait(2600)
await clickOn(page.getByRole('button', { name: 'Approve all', exact: true }))
await wait(1800)

// 5. 상대 에이전트가 문서를 고쳐 새 버전을 올린다. 열어서 이전 버전과 비교한다
await call('POST', `/channels/${ch.id}/artifacts`, jamieAgent, { artifactId: doc.artifact.id, content: S.doc2, note: S.note2 })
await wait(2000)
await clickOn(page.locator(`button:has-text("${S.docTitle}")`).last())
await wait(1500)
await clickOn(page.locator('button[aria-label="Compare with previous version"]'))
await wait(2800)

// 6. 사람이 모두 동의해야 확정된다
await clickOn(page.getByRole('button', { name: 'Finalize this version', exact: true }))
await wait(1200)
await call('POST', `/artifacts/${doc.artifact.id}/finalize`, jamie.token, { version: 2 })
await wait(3000)

live.forEach((w) => w.close())
await cdp.send('Page.stopScreencast')
const userData = await app.evaluate(({ app }) => app.getPath('userData'))
await app.close()
rmSync(userData, { recursive: true, force: true })

// 프레임마다 다음 프레임까지 보이던 시간만큼 보여 주는 영상으로 만든다
const end = frames.at(-1).t + 1
const list = frames.map((f, i) => `file '${f.file}'\nduration ${((frames[i + 1]?.t ?? end) - f.t).toFixed(3)}`).join('\n')
writeFileSync(join(frameDir, 'frames.txt'), list + `\nfile '${frames.at(-1).file}'\n`)
const ff = spawnSync('ffmpeg', [
  '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', join(frameDir, 'frames.txt'),
  '-vf', `scale=${SIZE.width}:-2:flags=lanczos,fps=30`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-movflags', '+faststart', OUT,
], { stdio: 'inherit' })
rmSync(frameDir, { recursive: true, force: true })
if (ff.status !== 0) process.exit(1)
console.log('saved', OUT, frames.length, 'frames')
