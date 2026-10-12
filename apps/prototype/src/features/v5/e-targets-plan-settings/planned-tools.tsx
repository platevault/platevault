/**
 * The Planned view's header tools (slice E, Round 6): Reminders and Export
 * calendar…, both covering every upcoming planned night, not just the one
 * shown.
 *
 * - Reminders: a toggle and a lead time. They always use the default site
 *   (PLAN-FR-06); turning them on asks the simulated OS for permission
 *   (Prototype controls › next notification answer). `ReminderScheduler`
 *   delivers each due reminder once, as a "reminder" Activity entry, so it
 *   arrives in the status bar's bell. Prototype: the flask button moves
 *   PlateVault's clock into the next reminder's lead time.
 * - Export calendar…: a preview of the events, night by night, then the .ics
 *   download; the export is saved as a snapshot (PLAN-FR-04).
 */
import { CalendarArrowDown, FlaskConical } from "lucide-react"
import { useEffect, useId, useMemo, useState } from "react"
import { useMessages } from "@/app/preferences"
import { ActionError, EmptyState } from "@/components/app/feedback"
import { Refusal, type RefusalProps, refusalFrom } from "@/components/app/refusal"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { planningSite } from "@/domain/derive"
import { calendarFile, downloadText, nightAt, plannedWindows, reminderKey, upcomingNight } from "@/domain/planning"
import type { ObservingWindow } from "@/domain/types"
import { formatNight } from "@/lib/format"
import { type CommitResult, nowIso, store, useStore } from "@/store/core"
import { DEFAULT_LEAD_MIN, deliverDueReminders, disableReminders, enableReminders, LEAD_TIMES_MIN, saveCalendarExport, setReminderLead } from "@/store/actions/planning"
import { setClockTo } from "@/store/simulation"
import { siteTime, siteTimeRange } from "./parts"

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

export function RemindersControl() {
  const m = useMessages()
  const reminders = useStore((s) => s.catalog.reminders)
  const reminderSite = useStore((s) => (s.catalog.reminders.siteId ? s.catalog.sites[s.catalog.reminders.siteId] : undefined))
  const targets = useStore((s) => s.catalog.targets)
  const next = useNextReminder()
  const [refused, setRefused] = useState<RefusalProps | null>(null)
  const [failure, setFailure] = useState<{ message: string; retry: () => void } | null>(null)
  const switchId = useId()
  const on = reminders.enabled && reminders.permission === "granted"
  const lead = reminders.leadTimeMin ?? DEFAULT_LEAD_MIN
  const leadItems = LEAD_TIMES_MIN.map((minutes) => ({ value: String(minutes), label: m.plan_lead_option({ minutes }) }))

  function run(action: () => CommitResult, refusedAction: string) {
    const result = action()
    setRefused(refusalFrom(result, refusedAction, { [m.site_no_default()]: { to: "/settings/sites" } }))
    setFailure(result.ok || result.reason === "refused" ? null : { message: result.message, retry: () => run(action, refusedAction) })
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1" data-reminders={on ? "on" : "off"}>
      <span className="inline-flex items-center gap-1.5">
        <Switch id={switchId} size="sm" checked={on} onCheckedChange={(checked) => run(() => (checked ? enableReminders(lead) : disableReminders()), m.plan_cant_turn_on_reminders())} />
        <Label htmlFor={switchId} className="text-sm font-normal">
          {m.plan_reminders()}
        </Label>
      </span>
      <Select items={leadItems} value={String(lead)} onValueChange={(value) => run(() => setReminderLead(Number(value)), m.plan_reminder_lead())}>
        <SelectTrigger size="sm" aria-label={m.plan_reminder_lead()} className="w-36">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {leadItems.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {on && next && reminderSite ? (
        <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground tabular-nums" data-next-reminder>
          <span title={`${targets[next.window.targetId]?.name ?? ""} · ${formatNight(nightAt(Date.parse(next.window.start), reminderSite))}`}>{m.plan_next_reminder({ time: siteTime(next.at, reminderSite) })}</span>
          <Button size="icon-xs" variant="ghost" aria-label={m.plan_proto_next_reminder()} title={m.plan_proto_next_reminder()} onClick={() => setClockTo(new Date(Date.parse(next.at) + 60_000).toISOString())} data-proto-reminder>
            <FlaskConical aria-hidden="true" />
          </Button>
        </span>
      ) : null}
      {refused ? <Refusal {...refused} className="basis-full" /> : null}
      {failure ? <ActionError message={failure.message} onRetry={failure.retry} className="basis-full" /> : null}
    </span>
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

/** Export calendar…: every upcoming planned night at the planning site, previewed, then downloaded as .ics. */
export function ExportCalendarButton() {
  const m = useMessages()
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)} data-export-calendar>
        <CalendarArrowDown aria-hidden="true" data-icon="inline-start" />
        {m.plan_export_calendar_open()}
      </Button>
      <ExportCalendarDialog open={open} onOpenChange={setOpen} />
    </>
  )
}

function ExportCalendarDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const m = useMessages()
  const site = useStore((s) => planningSite(s))
  const catalog = useStore((s) => s.catalog)
  const [failure, setFailure] = useState<string | null>(null)
  const bucket = useClockBucket()
  // Recomputed each time the dialog opens, so the preview is what the file holds.
  const windows = useMemo(() => (open && site ? plannedWindows(catalog, site, Date.parse(nowIso())) : []), [open, site, catalog, bucket])
  const nights = useMemo(() => {
    const out = new Map<string, ObservingWindow[]>()
    if (!site) return out
    for (const w of windows) {
      const night = nightAt(Date.parse(w.start), site)
      out.set(night, [...(out.get(night) ?? []), w])
    }
    return out
  }, [windows, site])

  useEffect(() => {
    if (open) setFailure(null)
  }, [open])

  function download() {
    if (!site || windows.length === 0) return
    const first = [...nights.keys()][0] ?? upcomingNight(site, Date.parse(nowIso()))
    const last = [...nights.keys()].at(-1) ?? first
    const fileName = `platevault-plan-${first}${last !== first ? `-to-${last}` : ""}.ics`
    const { result, record } = saveCalendarExport({ siteId: site.id, timeZone: site.timeZone, from: first, to: last, fileName, windows })
    if (!result.ok) return setFailure(result.message)
    const names = Object.fromEntries(Object.values(store.getState().catalog.targets).map((t) => [t.id, t.name]))
    downloadText(fileName, calendarFile(record, site.name, names))
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" data-export-dialog>
        <DialogHeader>
          <DialogTitle>{m.plan_export_calendar()}</DialogTitle>
          <DialogDescription>{site ? m.plan_export_summary({ events: m.plan_events_count({ count: windows.length }), nights: m.plan_nights_count({ count: nights.size }), site: site.name }) : m.project_no_site()}</DialogDescription>
        </DialogHeader>
        {windows.length === 0 ? (
          <EmptyState icon={CalendarArrowDown} title={m.plan_nothing_upcoming()} description={null} action={null} />
        ) : (
          <div className="max-h-80 space-y-2 overflow-y-auto rounded-md border px-3 py-2 text-sm" data-ics-preview>
            {[...nights.entries()].map(([night, list]) => (
              <section key={night} aria-label={formatNight(night, true)}>
                <h3 className="text-xs font-semibold text-muted-foreground">{formatNight(night, true)}</h3>
                <ul className="divide-y divide-border/50">
                  {list.map((w) => (
                    <li key={w.key} className="flex min-h-(--row-h) items-center justify-between gap-3 py-(--row-py)" data-ics-event>
                      <span className="truncate font-medium">{catalog.targets[w.targetId]?.name ?? w.targetId}</span>
                      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                        {site ? siteTimeRange(w.start, w.end, site) : null} · {m.plan_event_max_alt({ altitude: Math.round(w.maxAltitudeDeg) })}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
        {failure ? <ActionError message={failure} onRetry={download} /> : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {m.verb_cancel()}
          </Button>
          <Button disabled={windows.length === 0} onClick={download} data-ics-download>
            {m.plan_download_ics()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
