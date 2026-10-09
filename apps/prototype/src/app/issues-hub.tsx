/**
 * The Issues hub (foundation-owned): a toolbar button with a count badge,
 * tinted by the worst severity, opening a panel that lists every issue
 * grouped, each with its one action. `IssuePill` renders one issue as a
 * clickable pill, so Home's top line shows the same issues; `IssueRow` is
 * one issue with its action, shared with the status bar's chip popovers.
 */
import { Link } from "@tanstack/react-router"
import { CircleAlert, CircleCheck, Info, type LucideIcon, OctagonX, TriangleAlert } from "lucide-react"
import { useState } from "react"
import { CountBadge, Pill } from "@/components/app/pill"
import type { Tone } from "@/components/app/status"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ISSUE_GROUPS, type Issue, type IssueGroup, type IssueSeverity } from "@/domain/issues"
import type { Messages } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { useIssues } from "@/store/issues"
import { useMessages } from "./preferences"

export const SEVERITY_TONE: Record<IssueSeverity, Tone> = { danger: "danger", warning: "warning", info: "info" }
export const SEVERITY_ICON: Record<IssueSeverity, LucideIcon> = { danger: OctagonX, warning: TriangleAlert, info: Info }
const SEVERITY_TEXT: Record<IssueSeverity, string> = { danger: "text-destructive", warning: "text-warning", info: "text-info" }

function groupName(m: Messages, group: IssueGroup): string {
  const name: Record<IssueGroup, () => string> = {
    sessions: m.nav_sessions,
    storage: m.common_locations,
    work: m.issues_group_work,
    runs: m.common_runs,
    calibration: m.nav_calibration,
    drift: m.issues_group_drift,
  }
  return name[group]()
}

/**
 * The issue's terse label and its one action, in the chosen language:
 * "2 need a Target", "Assign". The kind decides the wording; drift on an
 * adopted master differs from drift in a session's frames.
 */
export function issueCopy(m: Messages, issue: Issue): { text: string; action: string } {
  const { count } = issue
  const name = issue.name ?? ""
  switch (issue.kind) {
    case "needs-target":
      return { text: m.issue_needs_target({ count }), action: m.verb_assign() }
    case "not-in-project":
      return { text: m.issue_not_in_project({ count }), action: m.verb_add() }
    case "location-denied":
      return { text: m.issue_location_unreadable({ name }), action: m.verb_fix() }
    case "location-offline":
      return { text: m.issue_location_offline({ name }), action: m.common_locations() }
    case "work-failed":
      return { text: m.issue_failed({ name }), action: m.nav_activity() }
    case "work-interrupted":
      return { text: m.issue_interrupted({ name }), action: m.nav_activity() }
    case "calibration-review":
      return { text: m.issue_to_review({ name, count }), action: m.verb_review() }
    case "run-blocked":
      return { text: m.issue_blocked({ name }), action: m.verb_open() }
    case "master-offer":
      return { text: m.issue_master_offered({ count }), action: m.verb_review() }
    case "calibration-waiting":
      return { text: m.issue_to_stack({ count }), action: m.verb_stack() }
    case "calibration-failed":
      return { text: m.issue_failed({ name }), action: m.verb_open() }
    case "drift":
      return issue.id.startsWith("drift:master:")
        ? { text: m.issue_master_changed({ name }), action: m.nav_calibration() }
        : { text: m.issue_frames_changed({ count, name }), action: m.verb_review() }
  }
}

/** One issue as a clickable pill (Home's top line). */
export function IssuePill({ issue }: { issue: Issue }) {
  const m = useMessages()
  const copy = issueCopy(m, issue)
  return (
    <Pill tone={SEVERITY_TONE[issue.severity]} icon={SEVERITY_ICON[issue.severity]} link={issue.link} title={`${copy.text} · ${copy.action}`}>
      {copy.text}
    </Pill>
  )
}

/** One issue with its action, as a list row; `onNavigate` closes the popover that holds it. */
export function IssueRow({ issue, onNavigate }: { issue: Issue; onNavigate: () => void }) {
  const m = useMessages()
  const copy = issueCopy(m, issue)
  const Glyph = SEVERITY_ICON[issue.severity]
  return (
    <li className="flex min-h-(--row-h) items-center gap-2 px-3 py-0.5 text-sm" data-issue={issue.id}>
      <Glyph aria-hidden="true" className={cn("size-3.5 shrink-0", SEVERITY_TEXT[issue.severity])} />
      <span className="min-w-0 flex-1 truncate" title={copy.text}>
        {copy.text}
      </span>
      <Button
        variant="ghost"
        size="xs"
        className="shrink-0 text-link"
        render={<Link to={issue.link.to as never} params={issue.link.params as never} search={issue.link.search as never} />}
        onClick={onNavigate}
      >
        {copy.action}
        <span className="sr-only">: {copy.text}</span>
      </Button>
    </li>
  )
}

export function IssuesButton() {
  const m = useMessages()
  const { issues, worst } = useIssues()
  const [open, setOpen] = useState(false)
  const Icon = worst ? CircleAlert : CircleCheck
  const label = issues.length === 0 ? m.issues_none() : m.issues_count({ count: issues.length })
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={<Button variant="ghost" size="sm" className={cn("shrink-0 gap-1 px-1.5", worst ? SEVERITY_TEXT[worst] : "text-muted-foreground")} aria-label={`${m.issues_title()}: ${label}`} title={m.issues_title()} data-issues={worst ?? "none"} />}
      >
        <Icon aria-hidden="true" />
        {issues.length > 0 ? <CountBadge count={issues.length} tone={worst ? SEVERITY_TONE[worst] : "neutral"} /> : null}
      </PopoverTrigger>
      <PopoverContent align="end" className="max-h-[min(32rem,var(--available-height))] w-88 gap-0 overflow-y-auto p-0" aria-label={m.issues_title()}>
        <div data-chrome className="flex items-center gap-2 border-b border-border px-3 py-2">
          <h2 className="flex-1 text-sm font-semibold">{m.issues_title()}</h2>
          <span className="text-xs text-muted-foreground tabular-nums">{label}</span>
        </div>
        {issues.length === 0 ? (
          <p className="px-3 py-4 text-sm text-muted-foreground">{m.issues_none()}</p>
        ) : (
          ISSUE_GROUPS.map((group) => {
            const rows = issues.filter((i) => i.group === group)
            if (rows.length === 0) return null
            return (
              <section key={group} aria-label={groupName(m, group)} className="border-b border-border py-1 last:border-0">
                <h3 data-chrome className="px-3 py-1 text-[0.6875rem] font-semibold text-muted-foreground">
                  {groupName(m, group)}
                </h3>
                <ul>
                  {rows.map((issue) => (
                    <IssueRow key={issue.id} issue={issue} onNavigate={() => setOpen(false)} />
                  ))}
                </ul>
              </section>
            )
          })
        )}
      </PopoverContent>
    </Popover>
  )
}
