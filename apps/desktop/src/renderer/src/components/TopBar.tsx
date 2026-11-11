import type { ReactNode } from 'react'
import { PanelLeft, SquarePen } from 'lucide-react'
import { t } from '../lib/i18n'
import { goHome, toggleSidebar, useStore } from '../lib/store'
import { isMac } from './Sidebar'
import { IconButton, cx } from './ui'

const isWin = navigator.userAgent.includes('Windows')

// 본문 위 52px 막대. 창 끌기 영역이고, 사이드바를 닫으면 여기에 열기·새 채널 버튼이 나온다.
export function TopBar({ left, right, flush }: { left?: ReactNode; right?: ReactNode; flush?: boolean }) {
  const sidebarOpen = useStore((s) => s.sidebarOpen)
  return (
    <header
      className={cx(
        'drag flex h-[52px] shrink-0 items-center gap-1 px-2',
        !sidebarOpen && isMac && 'pl-[78px]',
        isWin && !flush && 'pr-[140px]',
      )}
    >
      {!sidebarOpen && (
        <>
          <IconButton label={t('nav.openSidebar')} onClick={toggleSidebar}>
            <PanelLeft size={18} />
          </IconButton>
          <IconButton label={t('nav.newChannel')} onClick={goHome}>
            <SquarePen size={18} />
          </IconButton>
        </>
      )}
      <div className="flex min-w-0 flex-1 items-center">{left}</div>
      <div className="flex items-center gap-1">{right}</div>
    </header>
  )
}
