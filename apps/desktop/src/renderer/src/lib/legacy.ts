// 이름이 Agent Messenger 였을 때 저장한 값(am:…)을 새 키(ah:…)로 한 번 옮긴다.
// main.tsx 가 다른 모듈보다 먼저 불러야 한다(i18n·store 가 불러올 때 바로 읽는다).
try {
  const old: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (k?.startsWith('am:')) old.push(k)
  }
  for (const k of old) {
    const next = 'ah:' + k.slice(3)
    const v = localStorage.getItem(k)
    if (v !== null && localStorage.getItem(next) === null) localStorage.setItem(next, v)
    localStorage.removeItem(k)
  }
} catch {
  /* 저장소를 못 쓰면 넘어간다 */
}

export {}
