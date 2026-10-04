/**
 * T5 shell contribution (T5-owned): the reminder scheduler with its simulated
 * OS notifications (overlay), and palette commands for storage and plans.
 * See src/app/shell-contract.ts.
 */
import { Bell, X } from "lucide-react"
import { useEffect, useMemo, useRef } from "react"
import type { PaletteCommand, ShellContribution } from "@/app/shell-contract"
import { Button } from "@/components/ui/button"
import { formatDateTime, formatNight, formatTime } from "@/lib/format"
import { updateSlice, useStore } from "@/store/core"
import { recordDelivered } from "./lib/actions"
import { computeWindows, nightAt, reminderKey, zoneAbbreviation } from "./lib/planning"
import { usePlateVaultNow } from "./plans"

/**
 * Delivers each due reminder once per Target/site/night identity while
 * PlateVault is open (PLAN-FR-06, PLAN-AC-07). Nothing runs unless the user
 * enabled reminders and the OS allowed notifications (PLAN-AC-05).
 */
function useReminderScheduler() {
  const reminders = useStore((s) => s.catalog.reminders)
  const plans = useStore((s) => s.catalog.plans)
  const targets = useStore((s) => s.catalog.targets)
  const sites = useStore((s) => s.catalog.sites)
  const now = usePlateVaultNow()
  useEffect(() => {
    if (!reminders.enabled || reminders.permission !== "granted" || !reminders.siteId || !reminders.leadTimeMin) return
    const site = sites[reminders.siteId]
    if (!site) return
    const leadMs = reminders.leadTimeMin * 60_000
    const due: Array<{ key: string; title: string; body: string }> = []
    for (const plan of Object.values(plans)) {
      const target = targets[plan.targetId]
      if (!plan.planned || !target) continue
      for (const w of computeWindows(target, site, plan.criteria, now, 2)) {
        const start = Date.parse(w.start)
        const key = reminderKey(w, site)
        if (reminders.deliveredWindowKeys.includes(key) || due.some((d) => d.key === key) || now < start - leadMs || now >= start) continue
        due.push({
          key,
          title: `${target.name} window at ${site.name}`,
          body: `${formatNight(nightAt(start, site))}, ${formatTime(w.start, site.timeZone)}–${formatTime(w.end, site.timeZone)} ${zoneAbbreviation(w.start, site.timeZone)}. Starts in ${Math.max(1, Math.round((start - now) / 60_000))} min.`,
        })
      }
    }
    if (due.length === 0) return
    recordDelivered(due.map((d) => d.key))
    const at = new Date(now).toISOString()
    updateSlice("t5", (s) => {
      const known = new Set(s.notifications.map((n) => n.windowKey))
      const fresh = due.filter((d) => !known.has(d.key)).map((d) => ({ id: `ntf_${d.key}`, windowKey: d.key, title: d.title, body: d.body, at, dismissed: false }))
      return fresh.length > 0 ? { ...s, notifications: [...s.notifications, ...fresh] } : s
    })
  }, [now, reminders, plans, targets, sites])
}

/**
 * Stand-in for OS notifications: a manual popover in the top layer that stays
 * until closed (modern-web-guidance: persistent-toast-notifications).
 */
function ReminderOverlay() {
  useReminderScheduler()
  const notifications = useStore((s) => s.slices.t5.notifications)
  const visible = notifications.filter((n) => !n.dismissed)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el?.showPopover) return
    const open = el.matches(":popover-open")
    if (visible.length > 0 && !open) el.showPopover()
    if (visible.length === 0 && open) el.hidePopover()
  }, [visible.length])
  useEffect(() => {
    if (visible.length === 0) return
    // WCAG 2.4.11: Escape hides the stack without moving focus, so a focused control is never left covered.
    // A dialog's own Escape wins: while one is open the stack stays.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || document.querySelector('[role="dialog"], [role="alertdialog"]')) return
      updateSlice("t5", (s) => ({ ...s, notifications: s.notifications.map((x) => (x.dismissed ? x : { ...x, dismissed: true })) }))
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [visible.length])
  return (
    <div
      ref={ref}
      popover="manual"
      aria-label="Simulated OS notifications"
      className="inset-auto right-4 bottom-4 m-0 w-80 overflow-visible border-0 bg-transparent p-0 text-foreground"
    >
      <ul aria-live="polite" className="space-y-2">
        {visible.map((n) => (
          <li key={n.id} className="space-y-1 rounded-lg border bg-popover p-3 text-sm shadow-md">
            <div className="flex items-start gap-2">
              <Bell aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1 space-y-0.5">
                <p className="text-xs text-muted-foreground">Simulated OS notification · PlateVault · {formatDateTime(n.at)} · Esc hides</p>
                <p className="font-medium text-pretty">{n.title}</p>
                <p className="text-pretty text-muted-foreground">{n.body}</p>
              </div>
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label={`Close notification: ${n.title}`}
                onClick={() => updateSlice("t5", (s) => ({ ...s, notifications: s.notifications.map((x) => (x.id === n.id ? { ...x, dismissed: true } : x)) }))}
              >
                <X aria-hidden="true" />
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

function useT5Commands(): PaletteCommand[] {
  const views = useStore((s) => s.catalog.views)
  const targets = useStore((s) => s.catalog.targets)
  return useMemo(
    () => [
      { id: "t5:archive", label: "Archive sessions", group: "Actions", keywords: "storage transfer verified", to: "/storage/archive" },
      { id: "t5:filing", label: "File into library", group: "Actions", keywords: "storage organize sessions", to: "/storage/filing" },
      ...Object.values(views)
        .filter((v) => v.completedAt)
        .map((v) => ({ id: `t5:cleanup:${v.id}`, label: `Clean up View ${v.name}`, group: "Views", keywords: "trash storage", to: `/views/${v.id}/cleanup` })),
      ...Object.values(targets).map((t) => ({ id: `t5:plan:${t.id}`, label: `Plan ${t.name}`, group: "Targets", keywords: "observing windows reminders calendar", to: `/targets/${t.id}/plan` })),
    ],
    [views, targets],
  )
}

export const t5Shell: ShellContribution = {
  Overlay: ReminderOverlay,
  useCommands: useT5Commands,
}
