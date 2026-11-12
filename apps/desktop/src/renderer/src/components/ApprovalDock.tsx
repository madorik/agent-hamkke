import { Signpost, Zap } from 'lucide-react'
import type { Message, PermissionRequest } from '@ah/protocol'
import { t } from '../lib/i18n'
import { approveAllIn, setAutoApprove, useStore } from '../lib/store'
import { DecisionCard } from './Decisions'
import { DraftCard } from './Message'
import { PermissionCard } from './Pages'
import { Button } from './ui'

// 입력창 바로 위: 이 채널에서 내 에이전트가 기다리는 초안·도구 허락을 그 자리에서 처리한다.
// (승인함까지 가지 않아도 되게. 승인함은 모든 채널을 모아 보는 곳으로 남는다)
export function ApprovalDock({ channelId }: { channelId: string }) {
  const allDrafts = useStore((s) => s.drafts)
  const permissions = useStore((s) => s.permissions)
  const activity = useStore((s) => s.activity[channelId])
  const allDecisions = useStore((s) => s.decisions)
  const me = useStore((s) => s.me)
  const drafts = allDrafts.filter((d) => d.channelId === channelId)
  const decisions = allDecisions.filter((d) => d.channelId === channelId)
  const perm = activity?.permissionId ? permissions.find((p) => p.id === activity.permissionId) : undefined
  const count = drafts.length + (perm ? 1 : 0)
  if (!me) return null

  return (
    <>
      {decisions.length > 0 && (
        <div
          className="pop-in mb-2 overflow-hidden rounded-[22px] border border-amber/40 bg-bg shadow-[0_6px_24px_rgba(0,0,0,0.06)]"
          role="region"
          aria-label={t('decision.dockTitle', { n: decisions.length })}
        >
          <div className="flex items-center gap-2 px-4 pt-2.5 pb-1.5">
            <Signpost size={13} className="shrink-0 text-amber" aria-hidden />
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{t('decision.dockTitle', { n: decisions.length })}</span>
          </div>
          <div className="flex max-h-[38vh] flex-col gap-2 overflow-y-auto px-2.5 pb-2.5">
            {decisions.map((d) => (
              <DecisionCard key={d.id} d={d} compact />
            ))}
          </div>
        </div>
      )}
      {count > 0 && <Dock channelId={channelId} drafts={drafts} perm={perm} count={count} color={me.color} />}
    </>
  )
}

function Dock({
  channelId,
  drafts,
  perm,
  count,
  color,
}: {
  channelId: string
  drafts: Message[]
  perm: PermissionRequest | undefined
  count: number
  color: string
}) {
  return (
    <div className="pop-in mb-2 overflow-hidden rounded-[22px] border border-amber/40 bg-bg shadow-[0_6px_24px_rgba(0,0,0,0.06)]" role="region" aria-label={t('dock.title', { n: count })}>
      <div className="flex items-center gap-2 px-4 pt-2.5 pb-1.5">
        <span className="size-1.5 shrink-0 rounded-full bg-amber" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{t('dock.title', { n: count })}</span>
        {count > 1 && (
          <Button variant="ghost" className="h-7 px-2.5 text-[12.5px]" onClick={() => void approveAllIn(channelId)}>
            {t('dock.approveAll')}
          </Button>
        )}
        <Button variant="secondary" className="h-7 gap-1 px-2.5 text-[12.5px]" onClick={() => void setAutoApprove(true)}>
          <Zap size={13} />
          {t('dock.always')}
        </Button>
      </div>
      <div className="flex max-h-[38vh] flex-col gap-2 overflow-y-auto px-2.5 pb-2.5">
        {perm && (
          <PermissionCard
            compact
            id={perm.id}
            tool={perm.toolName}
            description={perm.description}
            preview={perm.inputPreview}
            at={perm.createdAt}
            color={color}
          />
        )}
        {drafts.map((d) => (
          <DraftCard key={d.id} m={d} compact />
        ))}
      </div>
    </div>
  )
}
