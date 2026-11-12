// 할 일: 채널 옆 패널(채널의 할 일), 사이드바 '내 할 일'(내가 맡은 일, 모든 채널).
// 사람도 에이전트도 할 일을 만들고 끝낸다. 내가 맡은 일은 한 번에 내 에이전트에게 맡길 수 있다.
import { useEffect, useState } from 'react'
import { Bot, Check, ListTodo, MoreHorizontal, Trash2, X } from 'lucide-react'
import type { Channel, Task } from '@ah/protocol'
import { intlLocale, t } from '../lib/i18n'
import { addTask, deleteTask, handOffTask, loadTasks, member, openChannel, setCanvas, updateTask, useStore } from '../lib/store'
import { TopBar } from './TopBar'
import { Avatar, Button, IconButton, MenuItem, Popover, cx } from './ui'

const isWin = navigator.userAgent.includes('Windows')

const today = () => new Date().toLocaleDateString('sv-SE') // YYYY-MM-DD(내 시간대)

function dueLabel(due: string): { text: string; tone: 'late' | 'today' | 'normal' } {
  const d = today()
  if (due < d) return { text: t('task.overdue'), tone: 'late' }
  if (due === d) return { text: t('task.today'), tone: 'today' }
  const date = new Date(due + 'T00:00:00')
  return { text: date.toLocaleDateString(intlLocale(), { month: 'numeric', day: 'numeric', weekday: 'short' }), tone: 'normal' }
}

/** 할 일 한 줄 */
export function TaskRow({ task, showChannel }: { task: Task; showChannel?: boolean }) {
  const me = useStore((s) => s.me)
  const channel = useStore((s) => s.channels[task.channelId])
  const [menu, setMenu] = useState(false)
  const assignee = task.assigneeId ? member(task.channelId, task.assigneeId) : null
  const done = task.status === 'done'
  const due = task.due ? dueLabel(task.due) : null
  const creator = task.createdByKind === 'agent' ? member(task.channelId, task.createdBy) : null
  const canHandOff = !done && !!me?.agentKind && (task.assigneeId === me.id || !task.assigneeId)
  return (
    <div className={cx('group flex items-start gap-2.5 rounded-xl px-2.5 py-2 hover:bg-hover', done && 'opacity-60')}>
      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        aria-label={done ? t('task.markOpen') : t('task.markDone')}
        onClick={() => void updateTask(task.id, { status: done ? 'open' : 'done' })}
        className={cx(
          'mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-md border transition-colors',
          done ? 'border-ok bg-ok text-white' : 'border-line-2 hover:border-fg-3',
        )}
      >
        {done && <Check size={12} strokeWidth={3} />}
      </button>
      <div className="min-w-0 flex-1">
        <div className={cx('text-[14.5px] leading-snug', done && 'line-through')}>{task.title}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12.5px] text-fg-3">
          {showChannel && channel && (
            <button type="button" onClick={() => openChannel(task.channelId)} className="font-medium text-fg-2 hover:underline">
              {channel.title}
            </button>
          )}
          {assignee ? (
            <span className="inline-flex items-center gap-1">
              <Avatar name={assignee.name} color={assignee.color} size={15} />
              {assignee.name}
            </span>
          ) : (
            <span>{t('task.nobody')}</span>
          )}
          {due && <span className={cx(due.tone === 'late' && 'font-medium text-danger', due.tone === 'today' && 'font-medium text-amber')}>{due.text}</span>}
          {creator && (
            <span className="inline-flex items-center gap-1">
              <Bot size={12} />
              {t('task.byAgent', { name: creator.name })}
            </span>
          )}
        </div>
      </div>
      {canHandOff && (
        <button
          type="button"
          onClick={() => void handOffTask(task)}
          className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-[12.5px] font-medium text-fg-3 opacity-0 group-hover:opacity-100 focus:opacity-100 hover:bg-bg hover:text-fg"
        >
          <Bot size={13} />
          {t('task.handOff')}
        </button>
      )}
      <div className="relative shrink-0">
        <IconButton label={t('common.more')} className="size-7 opacity-0 group-hover:opacity-100 focus:opacity-100" onClick={() => setMenu((v) => !v)}>
          <MoreHorizontal size={15} />
        </IconButton>
        <Popover open={menu} onClose={() => setMenu(false)} className="top-8 right-0 w-[220px]">
          {channel?.members.map((m) => (
            <MenuItem key={m.id} checked={task.assigneeId === m.id} onClick={() => (setMenu(false), void updateTask(task.id, { assigneeId: m.id }))}>
              {m.name}
            </MenuItem>
          ))}
          <MenuItem checked={!task.assigneeId} onClick={() => (setMenu(false), void updateTask(task.id, { assigneeId: null }))}>
            {t('task.nobody')}
          </MenuItem>
          <div className="my-1 h-px bg-line" />
          <MenuItem icon={<Trash2 size={15} />} onClick={() => (setMenu(false), void deleteTask(task))}>
            {t('task.delete')}
          </MenuItem>
        </Popover>
      </div>
    </div>
  )
}

/** 할 일 추가: 제목 + 맡은 사람 + 기한 */
function AddTask({ channel }: { channel: Channel }) {
  const me = useStore((s) => s.me)
  const [title, setTitle] = useState('')
  const [assignee, setAssignee] = useState<string>(me?.id ?? '')
  const [due, setDue] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    if (!title.trim() || busy) return
    setBusy(true)
    const ok = await addTask(channel.id, { title: title.trim(), assigneeId: assignee || null, due: due || null })
    setBusy(false)
    if (ok) {
      setTitle('')
      setDue('')
    }
  }
  return (
    <form
      className="m-2 rounded-xl border border-line-2 px-3 py-2 focus-within:border-blue"
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={t('task.placeholder')}
        aria-label={t('task.placeholder')}
        maxLength={300}
        className="w-full bg-transparent text-[14.5px] outline-none placeholder:text-fg-3"
      />
      <div className="mt-1.5 flex items-center gap-2 text-[12.5px] text-fg-2">
        <select
          value={assignee}
          onChange={(e) => setAssignee(e.target.value)}
          aria-label={t('task.assignee')}
          className="h-7 rounded-md border border-line bg-bg px-1.5 outline-none"
        >
          <option value="">{t('task.nobody')}</option>
          {channel.members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        <input
          type="date"
          value={due}
          onChange={(e) => setDue(e.target.value)}
          aria-label={t('task.due')}
          className="h-7 rounded-md border border-line bg-bg px-1.5 outline-none"
        />
        <span className="flex-1" />
        <Button type="submit" disabled={busy || !title.trim()} className="h-7 px-3 text-[12.5px]">
          {t('task.add')}
        </Button>
      </div>
    </form>
  )
}

/** 채널 옆 패널 */
export function TasksPanel({ channel }: { channel: Channel }) {
  const tasks = useStore((s) => s.tasks[channel.id]) ?? []
  // 열 때마다 새로 불러온다(채널을 만든 직후처럼 아직 안 불러온 경우도)
  useEffect(() => {
    void loadTasks(channel.id)
  }, [channel.id])
  const open = tasks.filter((x) => x.status === 'open')
  const done = tasks.filter((x) => x.status === 'done')
  return (
    <section className="fade-in flex h-full w-[min(460px,42%)] min-w-[340px] shrink-0 flex-col border-l border-line bg-bg" aria-label={t('task.title')}>
      <div className={cx('drag flex h-[52px] shrink-0 items-center gap-1 border-b border-line px-2', isWin && 'pr-[140px]')}>
        <span className="flex-1 px-2 text-[15px] font-semibold">{t('task.title')}</span>
        <IconButton label={t('common.close')} onClick={() => setCanvas(null)}>
          <X size={18} />
        </IconButton>
      </div>
      <AddTask channel={channel} />
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {open.length === 0 ? (
          <div className="px-3 py-8 text-center text-[13px] text-fg-3">
            <div>{t('task.empty')}</div>
            <div className="mt-1 leading-relaxed">{t('task.emptyHint')}</div>
          </div>
        ) : (
          open.map((x) => <TaskRow key={x.id} task={x} />)
        )}
        {done.length > 0 && (
          <>
            <div className="mt-4 mb-1 px-2.5 text-[12.5px] font-medium text-fg-3">{t('task.done')}</div>
            {done.map((x) => (
              <TaskRow key={x.id} task={x} />
            ))}
          </>
        )}
      </div>
    </section>
  )
}

/** 사이드바 '내 할 일': 내가 맡은 남은 일(모든 채널) */
export function MyTasksPage() {
  const tasks = useStore((s) => s.myTasks)
  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <TopBar left={<span className="px-2.5 text-[17px] font-medium">{t('task.mine')}</span>} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[46rem] px-6 py-4">
          {tasks.length === 0 ? (
            <div className="flex flex-col items-center gap-3 pt-[16vh] text-center text-fg-3">
              <ListTodo size={34} strokeWidth={1.4} />
              <span className="text-[15px]">{t('task.emptyMine')}</span>
              <span className="max-w-[26rem] text-[13px] leading-relaxed">{t('task.emptyHint')}</span>
            </div>
          ) : (
            <div className="rounded-2xl border border-line p-1.5">
              {tasks.map((x) => (
                <TaskRow key={x.id} task={x} showChannel />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
