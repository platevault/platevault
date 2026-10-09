/**
 * Capture-time zone policy: every time a session or its frames were captured
 * reads in the session's capture site zone, and every time column names that
 * zone. A session whose headers match no saved site reads in UTC.
 */
import { captureSite } from "@/domain/library"
import type { Catalog, Session } from "@/domain/types"

/** IANA zone a session's capture times read in: its capture site's, else "UTC". */
export function sessionTimeZone(catalog: Catalog, session: Session): string {
  return captureSite(catalog, session)?.timeZone ?? "UTC"
}

/**
 * Header for a capture-time column: "Start (Europe/Amsterdam)". When the rows
 * span zones, "Start (site time)"; each cell then names its own zone.
 */
export function zonedHeader(label: string, zones: Iterable<string>): string {
  const unique = new Set(zones)
  if (unique.size > 1) return `${label} (site time)`
  return `${label} (${unique.values().next().value ?? "UTC"})`
}
