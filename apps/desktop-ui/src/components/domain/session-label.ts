/**
 * A session's name where rows show it (Sessions, Home, intake, a Project's
 * tables): what its capture key and framing say, "18 Sep · Ha · 300 s ·
 * framing 2". The capture key carries the night, the filter and the
 * exposure (`capture-v1|type=light|night=2026-09-12@…|filter=Ha|exposure_s=300`);
 * the label never invents one the key doesn't name. One place, so every
 * area names a session alike.
 */
import { useQueries } from "@tanstack/react-query"
import type { Session, SessionSummary } from "@/api/ipc"
import { libraryQuery } from "@/api/query"
import { formatExposure, formatNight } from "@/lib/format"
import type { Messages } from "@/lib/i18n"

/** The night, filter and exposure a capture key names, each null when the key doesn't name it (`?` names nothing). */
export function keyParts(key: string): { night: string | null; filter: string | null; exposure: number | null } {
  const part = (name: string) => key.split("|").find((p) => p.startsWith(`${name}=`))?.slice(name.length + 1) ?? null
  const night = part("night")?.match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? null
  const filter = part("filter")
  const exposureText = part("exposure_s")
  const exposure = exposureText ? Number(exposureText) : Number.NaN
  return { night, filter: filter && filter !== "?" ? filter : null, exposure: Number.isFinite(exposure) ? exposure : null }
}

/** "18 Sep · Ha · 300 s · framing 2"; a dash for an unnamed night, "{night} no filter" without a filter. */
export function sessionLabel(m: Messages, session: Session): string {
  const { night, filter, exposure } = keyParts(session.key)
  const nightText = night ? formatNight(night) : "–"
  const ordinal = session.framing?.ordinal ?? 1
  return [
    filter ? `${nightText} · ${filter}` : m.domain_session_no_filter({ night: nightText }),
    ...(exposure !== null ? [formatExposure(exposure)] : []),
    ...(session.framing?.label ? [session.framing.label] : ordinal > 1 ? [m.domain_session_framing({ n: ordinal })] : []),
  ].join(" · ")
}

/** Each of `ids` with its summary once read (`library_session`, shared by every reader); one still loading or unreadable is absent. */
export function useSessionSummaries(ids: readonly string[]): Map<string, SessionSummary> {
  const unique = [...new Set(ids)]
  const reads = useQueries({ queries: unique.map((id) => libraryQuery("librarySession", id)) })
  const out = new Map<string, SessionSummary>()
  reads.forEach((read, i) => {
    if (read.data) out.set(unique[i]!, read.data.detail.summary)
  })
  return out
}

/** A session's label from `summaries`, or a dash while it is unread. */
export function labelOf(m: Messages, summaries: ReadonlyMap<string, SessionSummary>, sessionId: string): string {
  const summary = summaries.get(sessionId)
  return summary ? sessionLabel(m, summary.session) : "–"
}
