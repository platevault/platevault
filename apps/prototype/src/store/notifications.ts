/**
 * Notifications (foundation-owned): the status bar's unread notifications and
 * the history popover, read from Activity, newest first. An operation reads
 * terse with its count, "Import finished · 54 frames" (`noticeText`);
 * Activity keeps the full record.
 *
 * Read state (P-SB2): `noticesRead` in the persisted state holds the ids of
 * the notices the user has seen. Opening the history marks every notice in it
 * read; following one inline marks that one. A reset to a seed starts with
 * every notice unread.
 */
import { unitCount } from "@/domain/labels"
import type { ActivityEvent, Operation, OperationUnit, SettledStatus } from "@/domain/types"
import { type MessageRef, type Messages, say } from "@/lib/i18n"
import { type PrototypeState, store, useStore } from "./core"
import { isSettled } from "./operations"

export type NoticeTone = "success" | "warning" | "danger" | "neutral"

/** How a settled operation ended. */
export type NoticeOutcome = SettledStatus

/** Copy is a `MessageRef` as Activity recorded it, worded by `noticeText`. */
export interface Notice {
  id: string
  at: string
  /** The operation or event title: "Import from ASIAIR". */
  title: MessageRef
  /** A settled operation's outcome; null for a write failure, refusal or save. */
  outcome: NoticeOutcome | null
  /** What the operation got through: 54 frames. */
  done: { count: number; unit: OperationUnit } | null
  detail: MessageRef | null
  tone: NoticeTone
  /** Hash route of the surface that owns the outcome. */
  href: string | null
}

const OUTCOME_TONE: Record<NoticeOutcome, NoticeTone> = { succeeded: "success", partial: "warning", failed: "danger", canceled: "neutral" }

export function noticeOf(event: ActivityEvent, operations: Record<string, Operation>): Notice {
  const base = { id: event.id, at: event.at, detail: event.detail, href: event.href, title: event.title, outcome: null, done: null }
  if (event.kind === "write-failed") return { ...base, tone: "danger" }
  if (event.kind === "write-refused" || event.kind === "refusal") return { ...base, tone: "warning" }
  if (event.kind === "saved") return { ...base, tone: "success" }
  const op = event.operationId ? operations[event.operationId] : undefined
  if (op && isSettled(op.status)) {
    const outcome = op.status as NoticeOutcome
    const done = op.progress.done > 0 ? { count: op.progress.done, unit: op.progress.unit } : null
    return { ...base, title: op.title, outcome, done, tone: OUTCOME_TONE[outcome] }
  }
  // An outcome whose operation record is gone keeps its status on the Activity entry.
  return event.status ? { ...base, outcome: event.status, tone: OUTCOME_TONE[event.status] } : { ...base, tone: "neutral" }
}

const OUTCOME_TEXT: Record<NoticeOutcome, (m: Messages, name: string) => string> = {
  succeeded: (m, name) => m.notice_finished({ name }),
  partial: (m, name) => m.notice_partial({ name }),
  failed: (m, name) => m.issue_failed({ name }),
  canceled: (m, name) => m.notice_canceled({ name }),
}

/** The notice's words in the chosen language: "Import finished · 54 frames". */
export function noticeText(m: Messages, notice: Notice): string {
  const title = say(m, notice.title)
  if (!notice.outcome) return title
  const text = OUTCOME_TEXT[notice.outcome](m, title)
  return notice.done ? `${text} · ${say(m, unitCount(notice.done.unit, notice.done.count))}` : text
}

const HISTORY = 12

let cached: { activity: ActivityEvent[]; notices: Notice[] } | null = null

/** Recomputed only when Activity changes; a settled operation's record no longer changes. */
function selectNotices(s: PrototypeState): Notice[] {
  if (cached?.activity === s.activity) return cached.notices
  const notices = [...s.activity]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, HISTORY)
    .map((event) => noticeOf(event, s.operations))
  cached = { activity: s.activity, notices }
  return notices
}

let cachedUnread: { notices: Notice[]; read: string[] | undefined; unread: Notice[] } | null = null

function selectUnread(s: PrototypeState): Notice[] {
  const notices = selectNotices(s)
  if (cachedUnread?.notices === notices && cachedUnread.read === s.noticesRead) return cachedUnread.unread
  const read = new Set(s.noticesRead)
  const unread = notices.filter((n) => !read.has(n.id))
  cachedUnread = { notices, read: s.noticesRead, unread }
  return unread
}

/** The latest notifications, newest first, and the ones not yet seen. */
export function useNotices(): { notices: Notice[]; unread: Notice[] } {
  return { notices: useStore(selectNotices), unread: useStore(selectUnread) }
}

/** Mark the history read: every notice in it, or only `id`. Ids that left the history are dropped. */
export function markNoticesRead(id?: string) {
  store.setState((s) => {
    const read = new Set(s.noticesRead)
    const ids = selectNotices(s)
      .map((n) => n.id)
      .filter((n) => id === undefined || n === id || read.has(n))
    return ids.length === read.size && ids.every((n) => read.has(n)) ? s : { ...s, noticesRead: ids }
  })
}
