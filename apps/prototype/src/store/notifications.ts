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
import type { ActivityEvent, Operation, OperationStatus } from "@/domain/types"
import { formatCount } from "@/lib/format"
import type { Messages } from "@/lib/i18n"
import { type PrototypeState, store, useStore } from "./core"
import { isSettled } from "./operations"

export type NoticeTone = "success" | "warning" | "danger" | "neutral"

/** How a settled operation ended. */
export type NoticeOutcome = Exclude<OperationStatus, "running" | "paused" | "interrupted">

export interface Notice {
  id: string
  at: string
  /** The operation or event title as recorded: "Import from ASIAIR". */
  title: string
  /** A settled operation's outcome; null for a write failure, refusal or save. */
  outcome: NoticeOutcome | null
  /** What the operation got through: 54 frames. */
  done: { count: number; unit: string } | null
  detail: string | null
  tone: NoticeTone
  /** Hash route of the surface that owns the outcome. */
  href: string | null
}

const OUTCOME_TONE: Record<NoticeOutcome, NoticeTone> = { succeeded: "success", partial: "warning", failed: "danger", canceled: "neutral" }

/** The word an outcome's Activity title ends in ("Import: finished"), for an outcome whose operation record is gone. */
const TITLE_WORD_OUTCOME: Record<string, NoticeOutcome> = { finished: "succeeded", partial: "partial", failed: "failed", canceled: "canceled" }

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
  // An outcome without its operation record reads "<title> <word>" too.
  const match = event.title.match(/^(.*): (finished|partial|failed|canceled)$/)
  if (!match) return { ...base, tone: "neutral" }
  const outcome = TITLE_WORD_OUTCOME[match[2]!]!
  return { ...base, title: match[1]!, outcome, tone: OUTCOME_TONE[outcome] }
}

const OUTCOME_TEXT: Record<NoticeOutcome, (m: Messages, name: string) => string> = {
  succeeded: (m, name) => m.notice_finished({ name }),
  partial: (m, name) => m.notice_partial({ name }),
  failed: (m, name) => m.issue_failed({ name }),
  canceled: (m, name) => m.notice_canceled({ name }),
}

/** The units operations count in, keyed by `progress.unit`. */
const UNIT_COUNT: Record<string, (m: Messages, count: number) => string> = {
  frames: (m, count) => m.notice_frames({ count, frames: formatCount(count) }),
  files: (m, count) => m.notice_files({ count, files: formatCount(count) }),
  entries: (m, count) => m.notice_entries({ count, entries: formatCount(count) }),
  sessions: (m, count) => m.notice_sessions({ count, sessions: formatCount(count) }),
}

/**
 * A unit a caller names itself (a Trash move's noun, "prepared entries"):
 * the recorded English noun, singular for one, until operations record
 * typed units.
 */
function recordedCount(count: number, unit: string): string {
  const one = unit.endsWith("ies") ? `${unit.slice(0, -3)}y` : unit.replace(/s$/, "")
  return `${formatCount(count)} ${count === 1 ? one : unit}`
}

/** The notice's words in the chosen language: "Import finished · 54 frames". */
export function noticeText(m: Messages, notice: Notice): string {
  if (!notice.outcome) return notice.title
  const text = OUTCOME_TEXT[notice.outcome](m, notice.title)
  if (!notice.done) return text
  const { count, unit } = notice.done
  return `${text} · ${UNIT_COUNT[unit]?.(m, count) ?? recordedCount(count, unit)}`
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
