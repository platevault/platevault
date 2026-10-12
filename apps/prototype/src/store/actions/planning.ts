/**
 * Planning writes (foundation-owned): each night's plan of Targets (Round 6:
 * Add to plan adds to the chosen night only), the reminders before planned
 * windows (the simulated OS notification is a "reminder" Activity entry, so
 * it lands in the status bar's bell) and calendar exports of every upcoming
 * planned night.
 */
import { defaultCriteria, nightAt, plannedWindows, reminderKey } from "@/domain/planning"
import { planningSite } from "@/domain/derive"
import type { CalendarExport, NightDate, ObservingSite, ObservingWindow, TargetId } from "@/domain/types"
import { msg, nightRef } from "@/lib/i18n"
import { type CommitResult, commit, nowIso, recordActivity, store, withCatalog } from "@/store/core"
import { MISSING, recordSaved, refuse } from "./shared"

/** Where planning outcomes link: the Planned view of the night. */
export function plannedHref(night: NightDate): string {
  return `/targets?view=planned&night=${night}`
}

function setPlanned(targetId: TargetId, night: NightDate, planned: boolean): CommitResult {
  const state = store.getState()
  const target = state.catalog.targets[targetId]
  if (!target) return MISSING
  const nights = state.catalog.plans[targetId]?.nights ?? []
  if (nights.includes(night) === planned) return { ok: true }
  const label = planned ? msg("plan_add_night_named", { name: target.name, night: nightRef(night) }) : msg("plan_remove_night_named", { name: target.name, night: nightRef(night) })
  const href = plannedHref(night)
  const result = commit(
    label,
    (s) =>
      withCatalog(s, (c) => {
        const existing = c.plans[targetId]
        const next = planned ? [...nights, night].sort() : nights.filter((n) => n !== night)
        const plan = existing ? { ...existing, nights: next, updatedAt: nowIso() } : { targetId, nights: next, criteria: defaultCriteria(planningSite(s)), updatedAt: nowIso() }
        return { ...c, plans: { ...c.plans, [targetId]: plan } }
      }),
    { href },
  )
  if (result.ok) recordSaved(label, null, href)
  return result
}

/** Put a Target on one night's plan; other nights keep theirs. */
export function addToPlan(targetId: TargetId, night: NightDate): CommitResult {
  return setPlanned(targetId, night, true)
}

/** Take a Target off one night's plan. */
export function removeFromPlan(targetId: TargetId, night: NightDate): CommitResult {
  return setPlanned(targetId, night, false)
}

// ---------------------------------------------------------------------------
// Reminders (PLAN-FR-06): always at the default site, before each planned window
// ---------------------------------------------------------------------------

/** Lead times the Planned view offers, in minutes. */
export const LEAD_TIMES_MIN = [15, 30, 60, 120] as const
export const DEFAULT_LEAD_MIN = 30

/**
 * Turn reminders on at the default site. Asks the (simulated) OS for
 * permission (`faults.notificationResponse`); a denial is recorded and
 * refused, and nothing is scheduled.
 */
export function enableReminders(leadTimeMin: number): CommitResult {
  const state = store.getState()
  const siteId = state.settings.defaultSiteId
  const label = msg("plan_reminders")
  if (!siteId || !state.catalog.sites[siteId]) return refuse(msg("store_refused", { label }), [msg("site_no_default")], "/settings/sites")
  if (state.faults.notificationResponse === "deny") {
    store.setState((s) => withCatalog(s, (c) => ({ ...c, reminders: { ...c.reminders, enabled: false, permission: "denied" } })))
    return refuse(msg("store_refused", { label }), [msg("plan_reason_notifications_denied")], "/targets?view=planned")
  }
  return commit(label, (s) => withCatalog(s, (c) => ({ ...c, reminders: { ...c.reminders, enabled: true, siteId, leadTimeMin, permission: "granted", enabledAt: nowIso() } })), { href: "/targets?view=planned" })
}

export function disableReminders(): CommitResult {
  return commit(msg("plan_reminders"), (s) => withCatalog(s, (c) => ({ ...c, reminders: { ...c.reminders, enabled: false, enabledAt: null } })), { href: "/targets?view=planned" })
}

export function setReminderLead(leadTimeMin: number): CommitResult {
  return commit(msg("plan_reminder_lead"), (s) => withCatalog(s, (c) => ({ ...c, reminders: { ...c.reminders, leadTimeMin } })), { href: "/targets?view=planned" })
}

/** The reminder site while reminders are on and allowed; null otherwise. */
export function activeReminderSite(): ObservingSite | null {
  const { catalog } = store.getState()
  const { reminders } = catalog
  if (!reminders.enabled || reminders.permission !== "granted" || !reminders.siteId || !reminders.leadTimeMin) return null
  return catalog.sites[reminders.siteId] ?? null
}

/**
 * Deliver every reminder that is due: a planned window whose lead time has
 * begun and that has not started yet. Each Target, site and night is
 * notified once (`reminderKey`, PLAN-AC-07), across restarts. Returns the
 * number delivered.
 */
export function deliverDueReminders(): number {
  const site = activeReminderSite()
  if (!site) return 0
  const state = store.getState()
  const { reminders, targets } = state.catalog
  const nowMs = Date.parse(nowIso())
  const leadMs = (reminders.leadTimeMin ?? 0) * 60_000
  const delivered = new Set(reminders.deliveredWindowKeys)
  const due = new Map<string, ObservingWindow>()
  for (const w of plannedWindows(state.catalog, site, nowMs)) {
    const key = reminderKey(w, site)
    const start = Date.parse(w.start)
    if (delivered.has(key) || due.has(key) || nowMs < start - leadMs || nowMs >= start) continue
    due.set(key, w)
  }
  if (due.size === 0) return 0
  store.setState((s) => withCatalog(s, (c) => ({ ...c, reminders: { ...c.reminders, deliveredWindowKeys: [...c.reminders.deliveredWindowKeys, ...due.keys()] } })))
  for (const w of due.values()) {
    const night = nightAt(Date.parse(w.start), site)
    recordActivity({
      kind: "reminder",
      title: msg("plan_reminder_notice", { name: targets[w.targetId]?.name ?? w.targetId, minutes: Math.max(1, Math.round((Date.parse(w.start) - nowMs) / 60_000)) }),
      detail: msg("plan_reminder_detail", { night: nightRef(night), site: site.name }),
      operationId: null,
      href: plannedHref(night),
    })
  }
  return due.size
}

/** Save a calendar export snapshot (PLAN-FR-04); the .ics is generated from it, so a later change never alters the saved file. */
export function saveCalendarExport(record: Omit<CalendarExport, "id" | "at">): { result: CommitResult; record: CalendarExport } {
  const full: CalendarExport = { ...record, id: `ics_${Date.parse(nowIso()).toString(36)}`, at: nowIso() }
  const label = msg("plan_export_calendar")
  const result = commit(label, (s) => withCatalog(s, (c) => ({ ...c, calendarExports: [full, ...c.calendarExports] })), { href: "/targets?view=planned" })
  if (result.ok) recordSaved(msg("plan_exported_calendar", { file: record.fileName }), null, "/targets?view=planned")
  return { result, record: full }
}
