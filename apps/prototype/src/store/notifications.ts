/**
 * Notifications (foundation-owned): the status bar's last notification and
 * its history popover, read from Activity, newest first. An operation reads
 * terse with its count, "Import finished · 54 frames"; Activity keeps the
 * full record.
 */
import type { ActivityEvent, Operation } from "@/domain/types"
import { formatCount } from "@/lib/format"
import { type PrototypeState, useStore } from "./core"
import { isSettled, SETTLED_WORD } from "./operations"

export type NoticeTone = "success" | "warning" | "danger" | "neutral"

export interface Notice {
  id: string
  at: string
  /** "Import finished · 54 frames". */
  text: string
  detail: string | null
  tone: NoticeTone
  /** Hash route of the surface that owns the outcome. */
  href: string | null
}

const WORD_TONE: Record<string, NoticeTone> = { finished: "success", partial: "warning", failed: "danger", canceled: "neutral" }

/** "1 frame", "54 frames", "1 entry": the unit an operation counts in, agreeing with `n`. */
function countOf(n: number, unit: string): string {
  const one = unit.endsWith("ies") ? `${unit.slice(0, -3)}y` : unit.replace(/s$/, "")
  return `${formatCount(n)} ${n === 1 ? one : unit}`
}

export function noticeOf(event: ActivityEvent, operations: Record<string, Operation>): Notice {
  const base = { id: event.id, at: event.at, detail: event.detail, href: event.href }
  if (event.kind === "write-failed") return { ...base, text: event.title, tone: "danger" }
  if (event.kind === "write-refused" || event.kind === "refusal") return { ...base, text: event.title, tone: "warning" }
  if (event.kind === "saved") return { ...base, text: event.title, tone: "success" }
  const op = event.operationId ? operations[event.operationId] : undefined
  if (op && isSettled(op.status)) {
    const word = SETTLED_WORD[op.status as keyof typeof SETTLED_WORD]
    const count = op.progress.done > 0 ? ` · ${countOf(op.progress.done, op.progress.unit)}` : ""
    return { ...base, text: `${op.title} ${word}${count}`, tone: WORD_TONE[word] ?? "neutral" }
  }
  // An outcome without its operation record reads "<title> <word>" too.
  const match = event.title.match(/^(.*): (finished|partial|failed|canceled)$/)
  return match ? { ...base, text: `${match[1]} ${match[2]}`, tone: WORD_TONE[match[2]!] ?? "neutral" } : { ...base, text: event.title, tone: "neutral" }
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