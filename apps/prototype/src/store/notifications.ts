/**
 * Notifications (foundation-owned): the status bar's last notification and
 * its history popover, read from Activity, newest first. An operation reads
 * terse with its count, "Import finished · 54 frames"; Activity keeps the
 * full record.
 */
import { unitCount } from "@/domain/labels"
import type { ActivityEvent, Operation, SettledStatus } from "@/domain/types"
import { joinRefs, type MessageRef } from "@/lib/i18n"
import { type PrototypeState, useStore } from "./core"
import { activityTitle, isSettled } from "./operations"

export type NoticeTone = "success" | "warning" | "danger" | "neutral"

/** Copy is a `MessageRef`, worded by the status bar with `say`. */
export interface Notice {
  id: string
  at: string
  /** "Import: finished · 54 frames". */
  text: MessageRef
  detail: MessageRef | null
  tone: NoticeTone
  /** Hash route of the surface that owns the outcome. */
  href: string | null
}

const STATUS_TONE: Record<SettledStatus, NoticeTone> = { succeeded: "success", partial: "warning", failed: "danger", canceled: "neutral" }

export function noticeOf(event: ActivityEvent, operations: Record<string, Operation>): Notice {
  const base = { id: event.id, at: event.at, detail: event.detail, href: event.href }
  if (event.kind === "write-failed") return { ...base, text: event.title, tone: "danger" }
  if (event.kind === "write-refused" || event.kind === "refusal") return { ...base, text: event.title, tone: "warning" }
  if (event.kind === "saved") return { ...base, text: event.title, tone: "success" }
  const op = event.operationId ? operations[event.operationId] : undefined
  const status = op && isSettled(op.status) ? (op.status as SettledStatus) : event.status
  if (!status) return { ...base, text: event.title, tone: "neutral" }
  const title = activityTitle({ title: event.title, status })
  const text = op && op.progress.done > 0 ? joinRefs([title, unitCount(op.progress.unit, op.progress.done)], " · ") : title
  return { ...base, text, tone: STATUS_TONE[status] }
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

/** The latest notifications, newest first: the status bar shows the first, its popover the rest. */
export function useNotices(): Notice[] {
  return useStore(selectNotices)
}