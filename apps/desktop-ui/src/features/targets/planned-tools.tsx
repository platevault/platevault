/**
 * A Target's notifications and calendar export (PLAN-FR-03/04/06/07), both
 * explicit, reviewed opt-ins over the library's own reads.
 *
 * - Enable notifications…: a lead time (minutes, hours or days, over 30
 *   minutes and at most 24 hours), then the library's review of what turning
 *   them on means (`planning_review_reminders`): the default site and its
 *   zone, the criteria, the lead time, the permission, whether reminders
 *   arrive while PlateVault is closed, and the next reminders. Enable sends
 *   exactly the reviewed values and revisions (`planning_enable_reminders`);
 *   the library asks the OS first when the permission is undecided, then
 *   records the subscription enabled or blocked. Reminders always use the
 *   default site, so with none the dialog sends the user to set one.
 * - Notifications: the Target's subscription as the library holds it
 *   (`planning_reminder_status`). Blocked shows why, with Settings (the
 *   platform's notification settings) and Retry, which re-requests with
 *   the values the user confirmed; nothing claims a delivery.
 * - Export calendar…: the library's review of the windows to export (site,
 *   zone, nights, each window in time order and the file name), then the
 *   native save dialog. The export repeats the reviewed digest, so a plan
 *   that moved since is refused as `conflict` and reviewed again. One
 *   Target's windows: an export of every planned night waits for per-night
 *   plans (astro-plan-wre19.14).
 */
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { BellOff, BellRing, CalendarArrowDown, RotateCw, Settings } from "lucide-react"
import type { ReactNode } from "react"
import { useState } from "react"
import {
  type ExportSelection_Deserialize,
  library,
  type PermissionState,
  type PlanCriteria,
  type ReminderInput,
  type ReminderSubscription,
} from "@/api/ipc"
import { useMessages } from "@/app/preferences"
import { ActionBar } from "@/components/app/actions"
import type { Action } from "@/components/app/contracts"
import { KeyValueList } from "@/components/app/data"
import { Notice, toast } from "@/components/app/feedback"
import { NumberField, SelectField } from "@/components/app/fields"
import { FormDialog, useDialogForm } from "@/components/app/form-dialog"
import { fileName, formatDateTime, formatNight, zoneAbbreviation } from "@/lib/format"
import type { Messages } from "@/lib/i18n"
import { windowText } from "./parts"
import { libraryQueryWhen, reminderStatusQuery, sitesQuery, targetsWrite } from "./queries"

type LeadUnit = "minutes" | "hours" | "days"
const UNIT_MINUTES: Record<LeadUnit, number> = { minutes: 1, hours: 60, days: 1440 }
/**
 * The lead time a reminder accepts: over 30 minutes (PLAN-FR-06), and at
 * most what the library stores, 1440 minutes (`MAX_MINUTES`, checked by
 * `ReminderInput::validate` in crates/platevault-model/src/planning.rs).
 * The spec's "up to 7 days" is wider than the library accepts until
 * astro-plan-wre19.19 raises `MAX_MINUTES` to 10080; then LEAD_MAX follows.
 */
const LEAD_MIN = 30
const LEAD_MAX = 1440

/**
 * The lead time a new reminder starts from: 12 hours, the setting's
 * default (PLAN-FR-06); the setting itself waits for astro-plan-wre19.19.
 */
const DEFAULT_LEAD = { amount: 12, unit: "hours" as LeadUnit }

/** The lead time in minutes, or null when it is not a whole amount over 30 minutes and at most 24 hours. */
export function leadMinutes(amount: number | null, unit: LeadUnit): number | null {
  if (amount === null || !Number.isInteger(amount)) return null
  const minutes = amount * UNIT_MINUTES[unit]
  return minutes > LEAD_MIN && minutes <= LEAD_MAX ? minutes : null
}

function leadText(m: Messages, minutes: number): string {
  if (minutes % 1440 === 0) return m.plan_lead_days({ count: minutes / 1440 })
  if (minutes % 60 === 0) return m.plan_lead_hours({ count: minutes / 60 })
  return m.plan_lead_minutes({ count: minutes })
}

/** "18 Sep 2026, 09:40 CEST" in the site's zone. */
function siteDateTime(iso: string, timeZone: string): string {
  return `${formatDateTime(iso, timeZone)} ${zoneAbbreviation(iso, timeZone)}`
}

function criteriaText(m: Messages, c: PlanCriteria): string {
  const darkness = { civil: m.criteria_darkness_civil(), nautical: m.criteria_darkness_nautical(), astronomical: m.criteria_darkness_astronomical() }[c.darkness]
  const parts = [darkness, m.tonight_criteria_duration({ minutes: c.minDurationMinutes })]
  if (c.minAltitudeDeg !== null) parts.unshift(m.tonight_criteria_altitude({ altitude: c.minAltitudeDeg }))
  return parts.join(" · ")
}

function permissionText(m: Messages, permission: PermissionState): string {
  switch (permission.state) {
    case "granted":
      return m.targets_permission_granted()
    case "denied":
      return m.targets_permission_denied()
    case "not_determined":
      return m.targets_permission_ask()
    case "unavailable":
      return m.targets_permission_unavailable()
  }
}

// Enable notifications… ---------------------------------------------------------

export function RemindersDialog({ targetId, criteria, open, onOpenChange, onManageSites }: { targetId: string; criteria: PlanCriteria; open: boolean; onOpenChange: (open: boolean) => void; onManageSites: () => void }) {
  const m = useMessages()
  const client = useQueryClient()
  const { values, set } = useDialogForm(open, () => ({ amount: DEFAULT_LEAD.amount as number | null, unit: DEFAULT_LEAD.unit }))
  const sites = useQuery(sitesQuery())
  const lead = leadMinutes(values.amount, values.unit)
  const noDefaultSite = sites.data ? sites.data.defaultSiteId === null : false
  const reminder: ReminderInput | null = lead !== null && open && sites.data && !noDefaultSite ? { targetId, criteria, leadMinutes: lead } : null
  const review = useQuery(libraryQueryWhen("planningReviewReminders", reminder ? [reminder] : null))
  const reviewed = review.data && reminder && review.data.leadMinutes === reminder.leadMinutes ? review.data : null
  const label = m.targets_enable_notifications()
  const blocked = (reason: string): Action["unavailable"] => ({ action: m.actions_blocked({ action: label }), reason, blockers: [] })
  const unavailable = noDefaultSite
    ? blocked(m.targets_reminders_need_default_site())
    : lead === null
      ? blocked(m.targets_lead_out_of_range())
      : !reviewed
        ? blocked(review.isError ? m.targets_review_failed() : m.common_loading())
        : undefined
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={m.targets_enable_notifications_title()}
      confirm={{
        id: "enable-reminders",
        label,
        kind: "primary",
        unavailable,
        run: () => {
          if (!reviewed || !reminder) return
          return targetsWrite(client, () =>
            library.planningEnableReminders(reminder, reviewed.site.id, reviewed.site.revision, reviewed.settingsRevision, reviewed.subscriptionRevision),
          )
        },
      }}
    >
      {noDefaultSite ? <Notice tone="info" title={m.targets_reminders_need_default_site()} actions={<ActionBar actions={[{ id: "manage-sites", label: m.tonight_add_site(), run: onManageSites }]} />} /> : null}
      <NumberField label={m.plan_lead_amount()} min={1} step={1} value={values.amount} onChange={(amount) => set({ amount })} description={m.targets_lead_range()} error={lead === null ? m.targets_lead_out_of_range() : undefined} />
      <SelectField
        label={m.plan_lead_unit()}
        value={values.unit}
        options={[
          { value: "minutes", label: m.plan_lead_unit_minutes() },
          { value: "hours", label: m.plan_lead_unit_hours() },
          { value: "days", label: m.plan_lead_unit_days() },
        ]}
        onChange={(unit) => set({ unit })}
      />
      {reviewed ? (
        <KeyValueList
          items={[
            { label: m.plan_reminders_site(), value: `${reviewed.site.name} · ${reviewed.timeZone}` },
            { label: m.tonight_criteria(), value: criteriaText(m, reviewed.criteria) },
            { label: m.plan_reminder_lead(), value: leadText(m, reviewed.leadMinutes) },
            { label: m.targets_permission(), value: permissionText(m, reviewed.permission) },
            { label: m.targets_app_closed(), value: reviewed.appClosedDelivery.available ? m.targets_app_closed_yes() : m.plan_reminders_while_open() },
            { label: m.plan_reminders_next(), value: reviewed.upcoming[0] ? siteDateTime(reviewed.upcoming[0].dueAt, reviewed.upcoming[0].timeZone) : m.plan_nothing_upcoming() },
          ]}
        />
      ) : null}
    </FormDialog>
  )
}

// The Target's notifications --------------------------------------------------

/** The Target's subscription and its recovery, as the library records it. */
export function NotificationsPanel({ targetId, onEnable }: { targetId: string; onEnable: () => void }) {
  const m = useMessages()
  const client = useQueryClient()
  const status = useQuery(reminderStatusQuery())
  const [settingsRefused, setSettingsRefused] = useState(false)
  if (!status.data) return null
  const sub = status.data.subscriptions.find((s) => s.targetId === targetId) ?? null
  const enable: Action = { id: "enable-notifications", label: m.targets_enable_notifications(), icon: BellRing, opensDialog: true, run: onEnable }
  if (!sub || sub.state === "disabled") return <ActionBar actions={[enable]} />
  const disable: Action = { id: "disable-notifications", label: m.targets_disable_notifications(), icon: BellOff, run: () => targetsWrite(client, () => library.planningDisableReminders(targetId, sub.revision)) }
  const summary = `${sub.siteName} · ${leadText(m, sub.leadMinutes)}`
  if (sub.state === "enabled") {
    const next = status.data.upcoming.find((u) => u.targetId === targetId)
    return (
      <Notice tone="info" title={m.targets_notifications_on({ summary })} actions={<ActionBar actions={[disable]} />}>
        {next ? m.plan_reminder_detail({ night: formatNight(next.night), site: next.siteName }) : m.plan_nothing_upcoming()}
      </Notice>
    )
  }
  if (sub.state === "needs_reconfirmation") {
    return <Notice tone="warning" title={m.targets_notifications_reconfirm({ summary })} actions={<ActionBar actions={[{ ...enable, label: m.view_apply_review_again() }, disable]} />} />
  }
  const retry: Action = { id: "retry-notifications", label: m.verb_retry(), icon: RotateCw, run: () => targetsWrite(client, () => retryEnable(sub)) }
  const openSettings: Action = {
    id: "notification-settings",
    label: m.targets_notification_settings(),
    icon: Settings,
    run: async () => {
      const result = await library.planningOpenNotificationSettings()
      setSettingsRefused(result.ok && !result.data.opened)
      return result
    },
  }
  const actions = sub.actions.map((a) => (a === "settings" ? openSettings : retry))
  return (
    <Notice tone="warning" title={m.targets_notifications_blocked({ reason: blockText(m, sub) })} actions={<ActionBar actions={[...actions, disable]} />}>
      {settingsRefused ? m.targets_settings_not_opened() : null}
    </Notice>
  )
}

/** Retry: the same request with the values and revisions the user confirmed; the library asks the OS again. */
function retryEnable(sub: ReminderSubscription) {
  return library.planningEnableReminders({ targetId: sub.targetId, criteria: sub.criteria, leadMinutes: sub.leadMinutes }, sub.siteId, sub.siteRevision, sub.settingsRevision, sub.revision)
}

function blockText(m: Messages, sub: ReminderSubscription): string {
  switch (sub.blockReason) {
    case "permission_denied":
      return m.plan_reason_notifications_denied()
    case "permission_not_determined":
      return m.targets_block_undecided()
    default:
      return m.targets_permission_unavailable()
  }
}

// Export calendar… -------------------------------------------------------------

export function ExportCalendarDialog({ selection, open, onOpenChange }: { selection: ExportSelection_Deserialize; open: boolean; onOpenChange: (open: boolean) => void }) {
  const m = useMessages()
  const client = useQueryClient()
  const review = useQuery(libraryQueryWhen("planningReviewCalendarExport", open ? [selection] : null))
  const reviewed = review.data ?? null
  const label = m.plan_export_calendar()
  let body: ReactNode = null
  if (reviewed) {
    const nights = reviewed.firstNight === reviewed.lastNight ? formatNight(reviewed.firstNight, true) : `${formatNight(reviewed.firstNight)}–${formatNight(reviewed.lastNight, true)}`
    body = (
      <>
        <KeyValueList
          items={[
            { label: m.plan_reminders_site(), value: `${reviewed.site.name} · ${reviewed.timeZone}` },
            { label: m.tonight_night(), value: nights },
            { label: m.tonight_criteria(), value: criteriaText(m, reviewed.criteria) },
            { label: m.review_name_file(), value: reviewed.suggestedFileName },
          ]}
        />
        {reviewed.windows.length > 0 ? <KeyValueList items={reviewed.windows.map((w) => ({ label: formatNight(w.night), value: windowText(m, w) }))} /> : null}
      </>
    )
  }
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={m.targets_export_calendar_title({ name: reviewed?.designation ?? "" })}
      size="lg"
      confirm={{
        id: "export-calendar",
        label,
        icon: CalendarArrowDown,
        kind: "primary",
        unavailable: !reviewed
          ? { action: m.actions_blocked({ action: label }), reason: review.isError ? m.targets_review_failed() : m.common_loading(), blockers: [] }
          : reviewed.windows.length === 0
            ? { action: m.actions_blocked({ action: label }), reason: m.plan_nothing_upcoming(), blockers: [] }
            : undefined,
        run: async () => {
          if (!reviewed) return
          const result = await targetsWrite(client, () => library.planningExportCalendar(selection, reviewed.snapshotDigest))
          if (result.ok && result.data?.saved) toast({ message: m.plan_exported_calendar({ file: fileName(result.data.path.display) }) })
          return result
        },
      }}
    >
      {body}
    </FormDialog>
  )
}
