/**
 * The Planned view's tools (slice E, Round 6): Reminders… and Export
 * calendar…, both covering every upcoming planned night, not just the one
 * shown. Each opens a FormDialog from the page header.
 *
 * - Reminders: on or off, and a lead time (a preset, or any number of
 *   minutes, hours or days; astro-plan-mv2g1). They always use the default
 *   site (PLAN-FR-06); turning them on asks the simulated OS for permission
 *   (Prototype controls › next notification answer). `ReminderScheduler`
 *   delivers each due reminder once, as a "reminder" Activity entry, so it
 *   arrives in the status bar's bell.
 * - Export calendar: the events night by night, then the .ics download; the
 *   export is saved as a snapshot (PLAN-FR-04).
 */
import { useEffect, useMemo, useState } from "react"
import { useMessages } from "@/app/preferences"
import { BoxTable } from "@/components/app/box"
import type { Column } from "@/components/app/contracts"
import { KeyValueList } from "@/components/app/data"
import { EmptyState } from "@/components/app/feedback"
import { NumberField, SelectField, SwitchField } from "@/components/app/fields"
import { FormDialog } from "@/components/app/form-dialog"
import { siteTime, siteTimeRange } from "@/components/domain/sky-lines"
import { CalendarArrowDown } from "lucide-react"
import { planningSite } from "@/domain/derive"
import { calendarFile, downloadText, nightAt, plannedWindows, reminderKey, upcomingNight } from "@/domain/planning"
import type { ObservingWindow } from "@/domain/types"
import { formatNight } from "@/lib/format"
import type { Messages } from "@/lib/i18n"
import { DEFAULT_LEAD_MIN, deliverDueReminders, disableReminders, enableReminders, LEAD_TIMES_MIN, saveCalendarExport, setReminderLead } from "@/store/actions/planning"
import { type CommitResult, nowIso, store, useStore } from "@/store/core"

/** The (simulated) clock in 10-minute buckets, re-read every minute, so schedules re-derive as time moves on. */
function useClockBucket(): number {
  const offset = useStore((s) => s.faults.clockOffsetMs)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])
  return Math.floor((now + offset) / 600_000)
}

/** The next reminder still to come: the first planned window whose lead time has not begun, and when it fires. */
function useNextReminder(): { window: ObservingWindow; at: string } | null {
  const catalog = useStore((s) => s.catalog)
  const bucket = useClockBucket()
  return useMemo(() => {
    const { reminders } = catalog
    const site = reminders.enabled && reminders.siteId ? catalog.sites[reminders.siteId] : undefined
    if (!site || !reminders.leadTimeMin) return null
    const nowMs = Date.parse(nowIso())
    const leadMs = reminders.leadTimeMin * 60_000
    const delivered = new Set(reminders.deliveredWindowKeys)
    const next = plannedWindows(catalog, site, nowMs).find((w) => Date.parse(w.start) - leadMs > nowMs && !delivered.has(reminderKey(w, site)))
    return next ? { window: next, at: new Date(Date.parse(next.start) - leadMs).toISOString() } : null
    // `bucket` re-derives the schedule as the clock moves on.
  }, [catalog, bucket])
}

// ---------------------------------------------------------------------------
// Reminders
// ---------------------------------------------------------------------------

type LeadUnit = "minutes" | "hours" | "days"
const UNIT_MIN: Record<LeadUnit, number> = { minutes: 1, hours: 60, days: 1440 }
const CUSTOM = "custom"
/** The longest lead time: a week. */
const MAX_LEAD_MIN = 7 * 1440

/** "30 min before", "2 h before", "1 day before": a lead time in its largest whole unit. */
export function leadText(m: Messages, minutes: number): string {
  if (minutes % 1440 === 0) return m.plan_lead_days({ count: minutes / 1440 })
  if (minutes % 60 === 0) return m.plan_lead_hours({ count: minutes / 60 })
  return m.plan_lead_minutes({ count: minutes })
}

/** A lead time as an amount in its largest whole unit, for the custom fields. */
function asAmount(minutes: number): { amount: number; unit: LeadUnit } {
  if (minutes % 1440 === 0) return { amount: minutes / 1440, unit: "days" }
  if (minutes % 60 === 0) return { amount: minutes / 60, unit: "hours" }
  return { amount: minutes, unit: "minutes" }
}

interface ReminderDraft {
  on: boolean
  choice: string
  amount: number | null
  unit: LeadUnit
}

function draftOf(on: boolean, lead: number): ReminderDraft {
  const preset = (LEAD_TIMES_MIN as readonly number[]).includes(lead)
  return { on, choice: preset ? String(lead) : CUSTOM, ...asAmount(lead) }
}

/** The lead time a draft asks for, in minutes; null while the custom amount is missing or out of range. */
function draftMinutes(draft: ReminderDraft): number | null {
  if (draft.choice !== CUSTOM) return Number(draft.choice)
  if (draft.amount === null || !Number.isInteger(draft.amount) || draft.amount < 1) return null
  const minutes = draft.amount * UNIT_MIN[draft.unit]
  return minutes <= MAX_LEAD_MIN ? minutes : null
}

export function RemindersDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const m = useMessages()
  const reminders = useStore((s) => s.catalog.reminders)
  const sites = useStore((s) => s.catalog.sites)
  const defaultSiteId = useStore((s) => s.settings.defaultSiteId)
  const targets = useStore((s) => s.catalog.targets)
  const next = useNextReminder()
  const on = reminders.enabled && reminders.permission === "granted"
  const lead = reminders.leadTimeMin ?? DEFAULT_LEAD_MIN
  const [draft, setDraft] = useState<ReminderDraft>(() => draftOf(on, lead))
  const [tried, setTried] = useState(false)
  useEffect(() => {
    if (!open) return
    setDraft(draftOf(on, lead))
    setTried(false)
  }, [open])

  const minutes = draftMinutes(draft)
  const reminderSite = reminders.siteId ? sites[reminders.siteId] : defaultSiteId ? sites[defaultSiteId] : undefined
  const options = [...LEAD_TIMES_MIN.map((value) => ({ value: String(value), label: leadText(m, value) })), { value: CUSTOM, label: m.plan_lead_custom() }]
  const units: { value: LeadUnit; label: string }[] = [
    { value: "minutes", label: m.plan_lead_unit_minutes() },
    { value: "hours", label: m.plan_lead_unit_hours() },
    { value: "days", label: m.plan_lead_unit_days() },
  ]

  function save(): CommitResult | void {
    setTried(true)
    if (minutes === null) return { ok: false, reason: "refused", message: m.plan_lead_invalid(), reasons: [] }
    if (!draft.on) return on ? disableReminders() : undefined
    if (!on) return enableReminders(minutes)
    if (minutes !== lead) return setReminderLead(minutes)
  }

  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title={m.plan_reminders()} size="sm" confirm={{ id: "reminders-save", label: m.settings_save(), kind: "primary", run: save }}>
      <SwitchField label={m.plan_reminders()} checked={draft.on} onChange={(checked) => setDraft((d) => ({ ...d, on: checked }))} />
      <SelectField label={m.plan_reminder_lead()} value={draft.choice} options={options} onChange={(choice) => setDraft((d) => ({ ...d, choice }))} />
      {draft.choice === CUSTOM ? (
        <>
          <NumberField
            label={m.plan_lead_amount()}
            min={1}
            step={1}
            value={draft.amount}
            onChange={(amount) => setDraft((d) => ({ ...d, amount }))}
            error={tried && minutes === null ? m.plan_lead_invalid() : undefined}
          />
          <SelectField label={m.plan_lead_unit()} value={draft.unit} options={units} onChange={(unit) => setDraft((d) => ({ ...d, unit }))} />
        </>
      ) : null}
      <KeyValueList
        items={[
          { label: m.plan_reminders_site(), value: reminderSite?.name ?? m.site_no_default() },
          {
            label: m.plan_reminders_next(),
            value: on && next && reminderSite ? `${siteTime(next.at, reminderSite.timeZone)} · ${targets[next.window.targetId]?.name ?? "–"} · ${formatNight(nightAt(Date.parse(next.window.start), reminderSite))}` : "–",
          },
        ]}
      />
    </FormDialog>
  )
}

/**
 * Delivers due reminders while PlateVault is open: on every change of the
 * catalog or the clock, and once a minute (PLAN-AC-07: each Target, site and
 * night once). Rendered once at the app root (slice E's shell Overlay).
 */
export function ReminderScheduler() {
  const reminders = useStore((s) => s.catalog.reminders)
  const plans = useStore((s) => s.catalog.plans)
  const offset = useStore((s) => s.faults.clockOffsetMs)
  useEffect(() => {
    deliverDueReminders()
    const timer = window.setInterval(deliverDueReminders, 30_000)
    return () => window.clearInterval(timer)
  }, [reminders, plans, offset])
  return null
}

// ---------------------------------------------------------------------------
// Export calendar
// ---------------------------------------------------------------------------

interface CalendarEvent {
  window: ObservingWindow
  night: string
  target: string
}

/** Export calendar: every upcoming planned night at the planning site, listed, then downloaded as .ics. */
export function ExportCalendarDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const m = useMessages()
  const site = useStore((s) => planningSite(s))
  const catalog = useStore((s) => s.catalog)
  const bucket = useClockBucket()
  // Recomputed each time the dialog opens, so the list is what the file holds.
  const windows = useMemo(() => (open && site ? plannedWindows(catalog, site, Date.parse(nowIso())) : []), [open, site, catalog, bucket])
  const events = useMemo<CalendarEvent[]>(
    () => (site ? windows.map((w) => ({ window: w, night: nightAt(Date.parse(w.start), site), target: catalog.targets[w.targetId]?.name ?? w.targetId })) : []),
    [windows, site, catalog],
  )
  const nights = [...new Set(events.map((e) => e.night))]

  function download(): CommitResult | void {
    if (!site || windows.length === 0) return { ok: false, reason: "refused", message: m.plan_nothing_upcoming(), reasons: [] }
    const first = nights[0] ?? upcomingNight(site, Date.parse(nowIso()))
    const last = nights.at(-1) ?? first
    const fileName = `platevault-plan-${first}${last !== first ? `-to-${last}` : ""}.ics`
    const { result, record } = saveCalendarExport({ siteId: site.id, timeZone: site.timeZone, from: first, to: last, fileName, windows })
    if (!result.ok) return result
    const names = Object.fromEntries(Object.values(store.getState().catalog.targets).map((t) => [t.id, t.name]))
    downloadText(fileName, calendarFile(record, site.name, names))
  }

  const columns: Column<CalendarEvent>[] = site
    ? [
        { id: "target", header: m.targets_designation(), rowHeader: true, sortValue: (e) => e.target, cell: (e) => e.target },
        { id: "window", header: m.tonight_window(), sortValue: (e) => e.window.start, cell: (e) => siteTimeRange(e.window.start, e.window.end, site.timeZone) },
        { id: "altitude", header: m.tonight_altitude(), align: "right", sortValue: (e) => e.window.maxAltitudeDeg, cell: (e) => m.plan_event_max_alt({ altitude: Math.round(e.window.maxAltitudeDeg) }) },
      ]
    : []

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={m.plan_export_calendar()}
      size="lg"
      confirm={{ id: "export-ics", label: m.plan_download_ics(), kind: "primary", run: download }}
    >
      <KeyValueList
        items={[
          { label: m.plan_site(), value: site?.name ?? m.project_no_site() },
          { label: m.plan_export_events(), value: m.plan_export_summary({ events: m.plan_events_count({ count: events.length }), nights: m.plan_nights_count({ count: nights.length }), site: site?.name ?? "–" }) },
        ]}
      />
      {events.length === 0 ? (
        <EmptyState icon={CalendarArrowDown} title={m.plan_nothing_upcoming()} action={null} />
      ) : (
        <BoxTable
          label={m.plan_export_calendar()}
          rows={events}
          columns={columns}
          getRowId={(e) => e.window.key}
          groups={{ key: (e) => e.night, label: (night) => formatNight(night, true) }}
        />
      )}
    </FormDialog>
  )
}
