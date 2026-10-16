/**
 * Planning writes (foundation-owned): each night's plan of Targets (Round 6:
 * Add to plan adds to the chosen night only), the reminders before planned
 * windows (the simulated OS notification is a "reminder" Activity entry, so
 * it lands in the status bar's bell; a missed window is a "reminder-missed"
 * entry, Activity only) and calendar exports of every upcoming planned night.
 */
import { defaultCriteria, isLeadTime, nightAt, noticeNames, plannedWindows, reminderCheckOf, type ReminderDelivery, reminderDelivery, reminderKey, reminderLookbackMs, upcomingNight } from "@/domain/planning"
import { planningSite } from "@/domain/derive"
import type { CalendarExport, NightDate, ObservingSite, ObservingWindow, ReminderNotice, TargetId } from "@/domain/types"
import { joinRefs, type MessageRef, msg, nightRef, verbatim } from "@/lib/i18n"
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

/** Lead time presets the Planned view offers, in minutes: each over 30 min (D-W88), with the 12 h default among them. */
export const LEAD_TIMES_MIN = [60, 120, 240, 720, 1440] as const

/** A lead time outside `isLeadTime` is refused on every path, not only in the dialog. */
function refuseLead(label: MessageRef): CommitResult {
  return refuse(msg("store_refused", { label }), [msg("plan_reason_lead_out_of_range")], "/targets?view=planned")
}

/**
 * Turn reminders on at the default site. Asks the (simulated) OS for
 * permission (`faults.notificationResponse`); a denial is recorded and
 * refused, and nothing is scheduled.
 */
export function enableReminders(leadTimeMin: number): CommitResult {
  const state = store.getState()
  const siteId = state.settings.defaultSiteId
  const label = msg("plan_reminders")
  if (!isLeadTime(leadTimeMin)) return refuseLead(label)
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
  const label = msg("plan_reminder_lead")
  if (!isLeadTime(leadTimeMin)) return refuseLead(label)
  return commit(label, (s) => withCatalog(s, (c) => ({ ...c, reminders: { ...c.reminders, leadTimeMin } })), { href: "/targets?view=planned" })
}

/** The reminder site while reminders are on and allowed; null otherwise. */
export function activeReminderSite(): ObservingSite | null {
  const { catalog } = store.getState()
  const { reminders } = catalog
  if (!reminders.enabled || reminders.permission !== "granted" || !reminders.siteId || !reminders.leadTimeMin) return null
  return catalog.sites[reminders.siteId] ?? null
}

/** The windows a notice covers, as Activity keeps them. */
function noticeWindows(windows: readonly ObservingWindow[]): ReminderNotice["windows"] {
  return windows.map(({ key, targetId, siteId, start, end }) => ({ key, targetId, siteId, start, end }))
}

/** "M 31 window in 40 min", or in hours once it is an hour or more away. */
function singleTitle(name: string, minutes: number): MessageRef {
  return minutes < 60 ? msg("plan_reminder_notice", { name, minutes }) : msg("plan_reminder_notice_hours", { name, hours: Math.round(minutes / 60) })
}

/**
 * Check the planned windows at the reminder site (PLAN-FR-06, PLAN-AC-15).
 * `launch` marks the first check after PlateVault starts; a later check
 * after a gap longer than `RESUME_GAP_MS` is a resume. At start-up or resume,
 * each window that ended since the last check is recorded in Activity as
 * missed, with no notification, and every unended window whose lead time has
 * begun is gathered into one notice that names at most three Targets and
 * opens Targets for tonight. On a tick, each window entering its lead time
 * is notified on its own. Every identity covered is recorded as delivered
 * and the check time saved, both persisted with the catalog, so none is
 * notified again after a restart. Null while reminders are off.
 */
export function checkReminders(launch = false): ReminderDelivery | null {
  const site = activeReminderSite()
  if (!site) return null
  const { catalog } = store.getState()
  const { reminders, targets } = catalog
  const nowMs = Date.parse(nowIso())
  const check = reminderCheckOf(launch, reminders.checkedAt === null ? null : Date.parse(reminders.checkedAt), nowMs)
  const fromMs = check === "tick" ? nowMs : reminderLookbackMs(reminders, nowMs)
  const keyOf = (w: ObservingWindow) => reminderKey(w, site)
  const delivery = reminderDelivery(plannedWindows(catalog, site, fromMs), keyOf, { check, nowMs, leadMs: reminders.leadTimeMin * 60_000, delivered: new Set(reminders.deliveredWindowKeys) })
  const keys = [...delivery.missed, ...delivery.gathered, ...delivery.due].map(keyOf)
  const checkedAt = new Date(nowMs).toISOString()
  store.setState((s) => withCatalog(s, (c) => ({ ...c, reminders: { ...c.reminders, checkedAt, deliveredWindowKeys: [...c.reminders.deliveredWindowKeys, ...keys] } })))

  const nameOf = (w: ObservingWindow) => targets[w.targetId]?.name ?? w.targetId
  const nightOf = (w: ObservingWindow) => nightAt(Date.parse(w.start), site)
  for (const w of delivery.missed) {
    const href = plannedHref(nightOf(w))
    recordActivity({
      kind: "reminder-missed",
      title: msg(check === "startup" ? "plan_reminder_missed_closed" : "plan_reminder_missed_suspended"),
      detail: msg("plan_reminder_target_detail", { name: nameOf(w), night: nightRef(nightOf(w)), site: site.name }),
      operationId: null,
      href,
      reminder: { delivery: "missed", windows: noticeWindows([w]), names: [nameOf(w)], more: 0, href },
    })
  }
  if (delivery.gathered.length > 0) {
    const { names, more } = noticeNames(delivery.gathered.map(nameOf))
    const listed = joinRefs(names.map(verbatim), ", ")
    const href = "/targets?view=planned"
    recordActivity({
      kind: "reminder",
      title: more > 0 ? msg("plan_reminders_gathered_more", { names: listed, count: more }) : msg("plan_reminders_gathered", { names: listed }),
      detail: msg("plan_reminder_detail", { night: nightRef(upcomingNight(site, nowMs)), site: site.name }),
      operationId: null,
      href,
      reminder: { delivery: "coalesced", windows: noticeWindows(delivery.gathered), names, more, href },
    })
  }
  for (const w of delivery.due) {
    const href = plannedHref(nightOf(w))
    recordActivity({
      kind: "reminder",
      title: singleTitle(nameOf(w), Math.max(1, Math.round((Date.parse(w.start) - nowMs) / 60_000))),
      detail: msg("plan_reminder_detail", { night: nightRef(nightOf(w)), site: site.name }),
      operationId: null,
      href,
      reminder: { delivery: "single", windows: noticeWindows([w]), names: [nameOf(w)], more: 0, href },
    })
  }
  return delivery
}

/** Save a calendar export snapshot (PLAN-FR-04); the .ics is generated from it, so a later change never alters the saved file. */
export function saveCalendarExport(record: Omit<CalendarExport, "id" | "at">): { result: CommitResult; record: CalendarExport } {
  const full: CalendarExport = { ...record, id: `ics_${Date.parse(nowIso()).toString(36)}`, at: nowIso() }
  const label = msg("plan_export_calendar")
  const result = commit(label, (s) => withCatalog(s, (c) => ({ ...c, calendarExports: [full, ...c.calendarExports] })), { href: "/targets?view=planned" })
  if (result.ok) recordSaved(msg("plan_exported_calendar", { file: record.fileName }), null, "/targets?view=planned")
  return { result, record: full }
}
