/**
 * The sessions a Project names, worded for its tables: each held session,
 * suggestion and blocker reads `library_session` once (TanStack shares the
 * read), and its row reads "18 Sep · Ha". The capture key carries the night
 * and the filter (`capture-v1|type=light|night=2026-09-12@…|filter=Ha`);
 * the label never invents either.
 */
import { useQueries } from "@tanstack/react-query"
import type { SessionSummary } from "@/api/ipc"
import { formatNight } from "@/lib/format"
import { sessionQuery } from "./queries"

/** The night and filter a capture key names, each null when it names none. */
export function keyParts(key: string): { night: string | null; filter: string | null } {
  const part = (name: string) => key.split("|").find((p) => p.startsWith(`${name}=`))?.slice(name.length + 1) ?? null
  const night = part("night")?.match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? null
  return { night, filter: part("filter") }
}

/** "18 Sep · Ha", "18 Sep · Ha · framing 2"; a dash for what the key doesn't name. */
export function sessionLabel(summary: SessionSummary): string {
  const { night, filter } = keyParts(summary.session.key)
  const framing = summary.session.framing?.label ?? null
  return [night ? formatNight(night) : "–", filter ?? "–", ...(framing ? [framing] : [])].join(" · ")
}

/** Each of `ids` with its summary once read; a session still loading or unreadable is absent. */
export function useSessionSummaries(ids: readonly string[]): Map<string, SessionSummary> {
  const unique = [...new Set(ids)]
  const reads = useQueries({ queries: unique.map((id) => sessionQuery(id)) })
  const out = new Map<string, SessionSummary>()
  reads.forEach((read, i) => {
    if (read.data) out.set(unique[i]!, read.data.detail.summary)
  })
  return out
}

/** A session's label, or a dash while it is unread. */
export function labelOf(summaries: Map<string, SessionSummary>, sessionId: string): string {
  const summary = summaries.get(sessionId)
  return summary ? sessionLabel(summary) : "–"
}
