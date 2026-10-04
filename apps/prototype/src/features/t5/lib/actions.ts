/**
 * T5 durable catalog writes. Every write goes through `commit()` so failed and
 * stale writes stay visibly unsaved (D08); callers report success only on
 * `{ ok: true }`.
 */
import type { CalendarExport, PlanCriteria, ResultKind, ResultRecord, SiteId, TargetId, View, ViewId } from "@/domain/types"
import { commit, type CommitResult, nowIso, store, withCatalog } from "@/store/core"
import { unsettledOperationsForView } from "@/store/operations"
import { type ResultRow, resultIdFor } from "./files"

const viewHref = (viewId: ViewId, area: string) => `/views/${viewId}/${area}`

/** Accept products after inspection (RES-FR-04): records each SHA-256; lineage is never upgraded. */
export function acceptResults(view: View, rows: ResultRow[]): CommitResult {
  const now = nowIso()
  return commit(
    `Accept ${rows.length === 1 ? "Result" : `${rows.length} Results`}`,
    (s) =>
      withCatalog(s, (catalog) => {
        const results = { ...catalog.results }
        for (const row of rows) {
          const sha = row.currentSha ?? row.record?.sha256 ?? ""
          const base: ResultRecord = row.record ?? {
            id: row.id,
            viewId: row.viewId,
            path: row.path,
            kind: row.kind,
            channel: row.channel,
            discovered: row.discovered,
            processingState: "written",
            association: row.association,
            lineage: row.lineage,
            acceptance: "candidate",
            acceptedAt: null,
            sha256: sha,
            contentState: "unchanged",
          }
          results[row.id] = { ...base, processingState: "written", acceptance: "accepted", acceptedAt: now, sha256: sha, contentState: "unchanged" }
        }
        return { ...catalog, results }
      }),
    { href: viewHref(view.id, "results") },
  )
}

export interface AttachInput {
  path: string
  kind: ResultKind
  channel: string | null
  viewId: ViewId
  sha256: string
  growing: boolean
}

/** Attach a file saved elsewhere (RES-FR-02, RES-AC-02): User-linked, lineage Unknown. */
export function attachResult(input: AttachInput): CommitResult {
  return commit(
    "Attach Result",
    (s) =>
      withCatalog(s, (catalog) => {
        const id = resultIdFor(input.viewId, input.path)
        const record: ResultRecord = {
          id,
          viewId: input.viewId,
          path: input.path,
          kind: input.kind,
          channel: input.channel,
          discovered: "attached",
          processingState: input.growing ? "pending" : "written",
          association: "user-linked",
          lineage: "unknown",
          acceptance: "candidate",
          acceptedAt: null,
          sha256: input.sha256,
          contentState: "unchanged",
        }
        return { ...catalog, results: { ...catalog.results, [id]: record } }
      }),
    { href: viewHref(input.viewId, "results") },
  )
}

export type CompleteOutcome = CommitResult | { ok: false; reason: "blocked"; message: string }

/** Mark processing complete (RES-FR-06/07): removes nothing, blocked only by this View's running app-owned work. */
export function markComplete(view: View): CompleteOutcome {
  const blocking = unsettledOperationsForView(store.getState(), view.id)
  if (blocking.length > 0) {
    return {
      ok: false,
      reason: "blocked",
      message: `Mark processing complete refused: ${blocking.map((op) => op.title).join(", ")} ${blocking.length === 1 ? "is" : "are"} not settled for this View. Complete waits until ${blocking.length === 1 ? "it settles" : "they settle"}.`,
    }
  }
  const now = nowIso()
  return commit(
    "Mark processing complete",
    (s) => withCatalog(s, (catalog) => ({ ...catalog, views: { ...catalog.views, [view.id]: { ...catalog.views[view.id]!, completedAt: now } } })),
    { expect: { collection: "views", id: view.id, revision: view.revision }, href: viewHref(view.id, "results") },
  )
}

/** View notes are annotations: allowed while Complete and never a membership change (D09). */
export function saveViewNotes(view: View, notes: string): CommitResult {
  return commit(
    "View notes",
    (s) => withCatalog(s, (catalog) => ({ ...catalog, views: { ...catalog.views, [view.id]: { ...catalog.views[view.id]!, notes } } })),
    { expect: { collection: "views", id: view.id, revision: view.revision }, href: viewHref(view.id, "results") },
  )
}

/**
 * Record a rehash outcome for accepted products (RES-AC-09). This is an
 * observation of the disk, like indexing, not a user decision, so it does
 * not go through commit's write faults.
 */
export function recordRehash(outcomes: Array<{ id: string; state: ResultRecord["contentState"] }>) {
  store.setState((s) => {
    let changed = false
    const results = { ...s.catalog.results }
    for (const { id, state } of outcomes) {
      const record = results[id]
      if (record && record.contentState !== state) {
        results[id] = { ...record, contentState: state }
        changed = true
      }
    }
    return changed ? { ...s, catalog: { ...s.catalog, results } } : s
  })
}

// ---------------------------------------------------------------------------
// Plans and reminders (spec 072)
// ---------------------------------------------------------------------------

const planHref = (targetId: TargetId) => `/targets/${targetId}/plan`

export function savePlan(targetId: TargetId, patch: { planned?: boolean; criteria?: PlanCriteria }, fallbackCriteria: PlanCriteria): CommitResult {
  const now = nowIso()
  const label = patch.planned === undefined ? "Plan criteria" : patch.planned ? "Mark Planned" : "Remove Planned"
  return commit(
    label,
    (s) =>
      withCatalog(s, (catalog) => {
        const current = catalog.plans[targetId] ?? { targetId, planned: false, criteria: fallbackCriteria, updatedAt: now }
        return { ...catalog, plans: { ...catalog.plans, [targetId]: { ...current, ...patch, updatedAt: now } } }
      }),
    { href: planHref(targetId) },
  )
}

/** The planning site is a view choice only: never Project membership or capture sites (PLAN-FR-01). */
export function setPlanningSite(siteId: SiteId, targetId: TargetId): CommitResult {
  return commit("Planning site", (s) => ({ ...s, settings: { ...s.settings, planningSiteId: siteId } }), { href: planHref(targetId) })
}

export type EnableOutcome =
  | { ok: true }
  | { ok: false; reason: "no-default-site" | "no-lead-time" | "denied" | "write-failed" | "stale"; message: string }

/**
 * Enable reminders (PLAN-FR-03/06/07, D07). Needs the default site and a
 * lead time; asks the (simulated) OS for permission. Scheduling is not
 * delivery, and nothing here starts indexing or processing.
 */
export function enableNotifications(leadTimeMin: number | null, targetId: TargetId): EnableOutcome {
  const state = store.getState()
  const siteId = state.settings.defaultSiteId
  if (!siteId || !state.catalog.sites[siteId]) {
    return { ok: false, reason: "no-default-site", message: "Set a default site first. Reminders use the default site only, so none were scheduled." }
  }
  if (!leadTimeMin) return { ok: false, reason: "no-lead-time", message: "Lead time: choose how long before a window the reminder arrives." }
  const granted = state.faults.notificationResponse === "grant"
  const result = commit(
    granted ? "Enable notifications" : "Notification permission",
    (s) =>
      withCatalog(s, (catalog) => ({
        ...catalog,
        reminders: granted
          ? { ...catalog.reminders, enabled: true, siteId, leadTimeMin, permission: "granted", enabledAt: nowIso() }
          : { ...catalog.reminders, enabled: false, permission: "denied" },
      })),
    { href: planHref(targetId) },
  )
  if (!result.ok) return result
  if (!granted) {
    return {
      ok: false,
      reason: "denied",
      message: "Notification permission denied. PlateVault cannot show reminders until notifications are allowed in System Settings.",
    }
  }
  return { ok: true }
}

export function disableNotifications(): CommitResult {
  return commit("Turn off notifications", (s) => withCatalog(s, (catalog) => ({ ...catalog, reminders: { ...catalog.reminders, enabled: false, enabledAt: null } })), {
    href: "/plans",
  })
}

/** Record a delivered reminder identity so restarts never repeat it (PLAN-AC-07). */
export function recordDelivered(keys: string[]) {
  store.setState((s) => {
    const known = new Set(s.catalog.reminders.deliveredWindowKeys)
    const added = keys.filter((k) => !known.has(k))
    if (added.length === 0) return s
    return withCatalog(s, (catalog) => ({ ...catalog, reminders: { ...catalog.reminders, deliveredWindowKeys: [...catalog.reminders.deliveredWindowKeys, ...added] } }))
  })
}

export function saveCalendarExport(record: Omit<CalendarExport, "id" | "at">, targetId: TargetId): { result: CommitResult; record: CalendarExport } {
  const full: CalendarExport = { ...record, id: `ics_${Date.now().toString(36)}`, at: nowIso() }
  const result = commit("Export calendar", (s) => withCatalog(s, (catalog) => ({ ...catalog, calendarExports: [full, ...catalog.calendarExports] })), {
    href: planHref(targetId),
  })
  return { result, record: full }
}
