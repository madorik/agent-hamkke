// 화면 언어. 처음엔 시스템 언어(한국어면 한국어, 그 밖엔 영어)를 따르고, 설정 > 일반에서 바꾼다.
// 바꾸면 App 이 화면 트리를 다시 그린다(t() 는 그릴 때마다 지금 언어로 읽는다).
import { create } from 'zustand'
import type { Locale, Stage, SystemEvent } from '@ah/protocol'
import { en } from './locales/en'
import { ko } from './locales/ko'

export type Dict = typeof ko
type Key = keyof Dict
type Args<K extends Key> = Dict[K] extends (p: infer P) => string ? [params: P] : []

const DICTS: Record<Locale, Dict> = { ko, en }

/** 언어 이름은 늘 그 언어로 쓴다 */
export const LANGUAGES: { id: Locale; label: string }[] = [
  { id: 'ko', label: '한국어' },
  { id: 'en', label: 'English' },
]

const KEY = 'ah:locale'

function detect(): Locale {
  try {
    const saved = localStorage.getItem(KEY)
    if (saved === 'ko' || saved === 'en') return saved
  } catch {
    /* 저장소를 못 쓰면 시스템 언어 */
  }
  return (navigator.languages?.[0] ?? navigator.language ?? '').toLowerCase().startsWith('ko') ? 'ko' : 'en'
}

export const useLocale = create<{ locale: Locale }>(() => ({ locale: detect() }))

export const getLocale = (): Locale => useLocale.getState().locale

/** 날짜·시각 표시용 */
export const intlLocale = () => (getLocale() === 'ko' ? 'ko-KR' : 'en-US')

export function t<K extends Key>(key: K, ...args: Args<K>): string {
  const v = DICTS[getLocale()][key] as string | ((p: unknown) => string)
  return typeof v === 'function' ? v(args[0]) : v
}

export const stageLabel = (s: Stage) => t(`stage.${s}`)

/** <html lang> 와 데스크톱(에이전트 언어)에 지금 언어를 알린다 */
export function applyLocale() {
  document.documentElement.lang = getLocale()
  void window.am?.setLocale(getLocale())
}

export function setLocale(locale: Locale) {
  try {
    localStorage.setItem(KEY, locale)
  } catch {
    /* 이번 실행에서만 기억 */
  }
  useLocale.setState({ locale })
  applyLocale()
}

/** 시스템 메시지를 보는 사람 언어로 */
export function systemText(ev: SystemEvent): string {
  switch (ev.type) {
    case 'joined':
      return t('system.joined', { name: ev.name })
    case 'stage_changed':
      return t('system.stageChanged', { name: ev.name, stage: stageLabel(ev.stage) })
    case 'approval_toggled':
      return t('system.approvalToggled', { name: ev.name, on: ev.on })
    case 'agent_toggled':
      return t('system.agentToggled', { name: ev.name, on: ev.on })
    case 'doc_signed':
      return t('system.docSigned', ev)
    case 'doc_finalized':
      return t('system.docFinalized', ev)
  }
}
