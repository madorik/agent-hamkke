// 실제 Electron 창을 띄워 주요 화면을 찍는다.
// 사용: node e2e/shots.mjs <relayUrl> <outDir> [light|dark] [ko|en]
import { _electron as electron } from 'playwright'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const RELAY = process.argv[2] ?? 'http://localhost:8791'
const OUT = process.argv[3] ?? 'shots'
const THEME = process.argv[4] ?? 'light'
const LOCALE = process.argv[5] === 'en' ? 'en' : 'ko'
mkdirSync(OUT, { recursive: true })

// 화면 문구(찾을 때 쓰는 것)와 예시 대화를 언어별로
const UI = {
  ko: {
    name: '이름',
    home: '어떤 일을 같이 할까요?',
    invite: '초대 코드',
    compare: '이전 버전과 비교',
    approvals: '승인함',
    connect: '에이전트 연결',
    settings: '설정',
    draft: '초안',
  },
  en: {
    name: 'Name',
    home: 'What should we work on together?',
    invite: 'Invite code',
    compare: 'Compare with previous version',
    approvals: 'Approvals',
    connect: 'Connect agent',
    settings: 'Settings',
    draft: 'Draft',
  },
}[LOCALE]
const C = {
  ko: {
    me: '박서연',
    peer: '김지수',
    channel: '3분기 파트너십 제안서를 같이 다듬어요',
    hello: '반가워요! 저희 쪽 요구사항은 제 에이전트가 정리해서 드릴게요.',
    peerAgent:
      '김지수님 에이전트입니다. 요구사항 3가지를 정리했어요.\n\n1. **공동 마케팅** 예산은 각사 50:50\n2. 3분기 안에 파일럿 1건\n3. 데이터 공유 범위는 계약서 부속서로 확정\n\n초안을 받아볼 수 있을까요?',
    order: '내 노션 「파트너십 2025」 페이지 기준으로 초안 써줘. 예산 비율은 아직 말하지 마.',
    report:
      '노션 「파트너십 2025」를 읽었어요. 상대 요구 중 **예산 50:50**은 지시대로 언급하지 않고 초안을 올릴게요. 데이터 공유 범위는 노션에 근거가 없어 확인이 필요해요.',
    reply: '정리 감사합니다. 2·3번은 반영해서 초안을 올리겠습니다. 1번 예산 비율은 내부 확인 후 답드릴게요.',
    docTitle: '3분기 파트너십 제안서',
    doc1: '# 3분기 파트너십 제안서\n\n## 목표\n- 3분기 안에 파일럿 1건 진행\n- 공동 고객 사례 1건 확보\n\n## 범위\n| 항목 | 담당 |\n|---|---|\n| 파일럿 설계 | 와타랩스 |\n| 고객 섭외 | 파트너사 |\n\n## 데이터 공유\n계약서 부속서로 확정합니다.',
    note1: '요구사항 2·3번 반영한 첫 초안',
    doc2: '# 3분기 파트너십 제안서\n\n## 목표\n- 3분기 안에 파일럿 1건 진행\n- 공동 고객 사례 2건 확보\n\n## 범위\n| 항목 | 담당 |\n|---|---|\n| 파일럿 설계 | 와타랩스 |\n| 고객 섭외 | 파트너사 |\n| 성과 측정 | 공동 |\n\n## 데이터 공유\n계약서 부속서로 확정합니다. 개인정보는 공유하지 않습니다.',
    note2: '고객 사례 목표를 2건으로, 성과 측정 공동으로',
    agree: '수정본 확인했어요. 성과 측정을 공동으로 두는 건 좋습니다. 이 버전으로 확정 요청드려요.',
    permission: '노션 「파트너십 2025」 페이지에 확정본 붙여넣기',
  },
  en: {
    me: 'Alex Kim',
    peer: 'Jamie Park',
    channel: "Let's refine the Q3 partnership proposal",
    hello: "Hi! My agent will put together our requirements for you.",
    peerAgent:
      "This is Jamie's agent. Here are our three requirements.\n\n1. **Co-marketing** budget split 50:50\n2. One pilot within Q3\n3. Data-sharing scope fixed in a contract annex\n\nCould we get a first draft?",
    order: "Draft it from my Notion page \"Partnerships 2025\". Don't mention the budget split yet.",
    report:
      'I read "Partnerships 2025" in Notion. As instructed, the draft won\'t mention the **50:50 budget**. Notion has nothing on data-sharing scope, so that needs checking.',
    reply: "Thanks for the summary. I'll post a draft covering #2 and #3. We'll get back to you on the budget split after an internal check.",
    docTitle: 'Q3 Partnership Proposal',
    doc1: '# Q3 Partnership Proposal\n\n## Goals\n- Run one pilot within Q3\n- Land one joint customer story\n\n## Scope\n| Item | Owner |\n|---|---|\n| Pilot design | Wata Labs |\n| Customer outreach | Partner |\n\n## Data sharing\nTo be fixed in a contract annex.',
    note1: 'First draft covering requirements #2 and #3',
    doc2: '# Q3 Partnership Proposal\n\n## Goals\n- Run one pilot within Q3\n- Land two joint customer stories\n\n## Scope\n| Item | Owner |\n|---|---|\n| Pilot design | Wata Labs |\n| Customer outreach | Partner |\n| Measuring results | Joint |\n\n## Data sharing\nTo be fixed in a contract annex. No personal data is shared.',
    note2: 'Two customer stories; results measured jointly',
    agree: 'Reviewed the revision. Measuring results jointly works for us. Requesting sign-off on this version.',
    permission: 'Paste the finalized proposal into the Notion page "Partnerships 2025"',
  },
}[LOCALE]

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
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

const profile = 'e2e-' + Date.now()
const app = await electron.launch({
  args: ['.'],
  cwd: new URL('..', import.meta.url).pathname,
  env: { ...process.env, AH_PROFILE: profile, AH_RELAY_URL: RELAY },
})
const page = await app.firstWindow()
await page.setViewportSize({ width: 1280, height: 800 }).catch(() => {})
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 800))
await page.evaluate(([t, l]) => (localStorage.setItem('ah:theme', t), localStorage.setItem('ah:locale', l)), [THEME, LOCALE])
await page.reload()
await page.waitForSelector(`input[placeholder="${UI.name}"]`)
const shot = async (name) => {
  await wait(350)
  await page.screenshot({ path: join(OUT, `${name}.png`) })
  console.log('shot', name)
}

await shot('01-onboarding')
await page.fill(`input[placeholder="${UI.name}"]`, C.me)
await page.click('button[type=submit]')
await page.waitForSelector(`text=${UI.home}`)
await shot('02-home')

// 채널 만들기
await page.fill('textarea', C.channel)
await page.keyboard.press('Enter')
await page.waitForSelector(`text=${UI.invite}`)
await page.waitForFunction(() => /^[A-Z0-9]{6}$/.test(document.querySelector('.font-mono')?.textContent ?? ''))
const code = await page.textContent('.font-mono')
await shot('03-invite')
await page.keyboard.press('Escape')

// 상대(지수)와 양쪽 에이전트를 API 로 등장시킨다
const me = await page.evaluate(() => localStorage.getItem('ah:token'))
const jisu = await call('POST', '/signup', null, { name: C.peer })
const ch = await call('POST', `/invites/${code}/accept`, jisu.token)
const { token: myAgent } = await call('POST', '/agent-tokens', me, { agentKind: 'claude-code' })
const { token: jisuAgent } = await call('POST', '/agent-tokens', jisu.token, { agentKind: 'codex' })
const live = [myAgent, jisuAgent].map((t) => new WebSocket(RELAY.replace('http', 'ws') + '/ws?token=' + t))
await wait(400)

await call('POST', `/channels/${ch.id}/messages`, jisu.token, { body: C.hello })
await call('PATCH', `/channels/${ch.id}`, jisu.token, { requireApproval: false })
await call('POST', `/channels/${ch.id}/messages`, jisuAgent, { body: C.peerAgent })
await call('PATCH', `/channels/${ch.id}`, jisu.token, { requireApproval: true, stage: 'draft' })
await call('POST', `/channels/${ch.id}/messages`, me, { body: C.order, visibility: 'private' })
await call('POST', `/channels/${ch.id}/messages`, myAgent, { body: C.report, visibility: 'private' })
await call('POST', `/channels/${ch.id}/messages`, myAgent, { body: C.reply })
const doc = await call('POST', `/channels/${ch.id}/artifacts`, myAgent, { title: C.docTitle, content: C.doc1, note: C.note1 })
await page.click(`text=${C.channel}`)
await wait(600)
await shot('04-channel')

// 승인: 메시지·문서 보내기
const ap = await call('GET', '/approvals', me)
for (const m of ap.messages) await call('POST', `/messages/${m.id}/approve`, me, {})
await call('POST', `/channels/${ch.id}/artifacts`, jisuAgent, { artifactId: doc.artifact.id, content: C.doc2, note: C.note2 }).catch(async () => {
  // 상대 쪽 승인이 켜져 있으면 지수가 승인
  const a2 = await call('GET', '/approvals', jisu.token)
  for (const m of a2.messages) await call('POST', `/messages/${m.id}/approve`, jisu.token, {})
})
const a2 = await call('GET', '/approvals', jisu.token)
for (const m of a2.messages) await call('POST', `/messages/${m.id}/approve`, jisu.token, {})
await call('POST', `/channels/${ch.id}/messages`, myAgent, { body: C.agree })
await call('POST', '/permission-requests', myAgent, {
  requestId: 'abcde',
  toolName: 'mcp__notion__update_page',
  description: C.permission,
  inputPreview: `{"page_id":"2a1f…","content":"# ${C.docTitle} …"}`,
})
await wait(500)
await shot('05-channel-after')

// 문서 캔버스 + 비교
await page.locator(`button:has-text("${C.docTitle}")`).last().click()
await wait(400)
await shot('06-canvas')
await page.click(`button[aria-label="${UI.compare}"]`)
await shot('07-canvas-diff')
await page.click(`button[aria-label="${UI.compare}"]`)

// 승인함
await page.click(`nav >> text=${UI.approvals}`)
await shot('08-approvals')

// 에이전트 설정
await page.keyboard.press('Escape')
await page.click(`aside button:has-text("${C.me}")`)
await page.click(`text=${UI.connect}`)
await shot('09-settings-agents')
await page.keyboard.press('Escape')

// 채널 메뉴
await page.click(`text=${C.channel}`)
await page.click(`header button:has-text("${UI.draft}")`)
await shot('10-channel-menu')
await page.keyboard.press('Escape')

// 채널 맨 위: 시스템 메시지(들어옴·단계·승인 설정)가 보는 사람 언어로
await page.evaluate(() => document.querySelector('main .overflow-y-auto')?.scrollTo(0, 0))
await shot('11-channel-top')

// 설정 > 일반(언어)
await page.click(`aside button:has-text("${C.me}")`)
await page.click(`text=${UI.settings}`)
await shot('12-settings-general')

// 언어를 바꾸면 그 자리에서 화면이 바뀐다
await page.click(`button[lang="${LOCALE === 'ko' ? 'en' : 'ko'}"]`)
await shot('13-language-switched')

live.forEach((w) => w.close())
const userData = await app.evaluate(({ app }) => app.getPath('userData'))
await app.close()
rmSync(userData, { recursive: true, force: true })
