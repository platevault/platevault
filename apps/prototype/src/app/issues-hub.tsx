/**
 * The Issues hub (foundation-owned): a toolbar button with a count badge,
 * tinted by the worst severity, opening a panel that lists every issue
 * grouped, each with its one action. `IssueRow` is one issue with its
 * action and × (Dismiss, P-ISS1), shared with the status bar's severity
 * popouts. The hub ends with "Dismissed (N)", where each can be restored.
 */
import { Link } from "@tanstack/react-router"
import { ChevronRight, CircleAlert, CircleCheck, Info, type LucideIcon, OctagonX, TriangleAlert, X } from "lucide-react"
import { useRef, useState } from "react"
import { flushSync } from "react-dom"
import { CountBadge } from "@/components/app/pill"
import type { Tone } from "@/components/app/status"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ISSUE_GROUPS, type Issue, type IssueGroup, type IssueSeverity, isDismissable } from "@/domain/issues"
import { formatBytes } from "@/lib/format"
import { type Messages, say } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { dismissIssue, restoreAllIssues, restoreIssue, useIssues } from "@/store/issues"
import { useMessages } from "./preferences"

const SEVERITY_TONE: Record<IssueSeverity, Tone> = { danger: "danger", warning: "warning", info: "info" }
/** @deprecated Use `ISSUE_SEVERITY_ICON` from `@/components/app/issue-row`; removed in W4. */
export const SEVERITY_ICON: Record<IssueSeverity, LucideIcon> = { danger: OctagonX, warning: TriangleAlert, info: Info }
/** @deprecated Use `ISSUE_SEVERITY_TEXT` from `@/components/app/issue-row`; removed in W4. */
export const SEVERITY_TEXT: Record<IssueSeverity, string> = { danger: "text-destructive", warning: "text-warning", info: "text-info" }

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
 * @deprecated Use `issueCopy` from `@/components/app/issue-row`; removed in W4.
 */
export function issueCopy(m: Messages, issue: Issue): { text: string; action: string } {
  const { count } = issue
  const name = issue.name === null ? "" : typeof issue.name === "string" ? issue.name : say(m, issue.name)
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
    case "master-old":
      return { text: m.issue_master_old({ name, count }), action: m.nav_calibration() }
    case "calibration-waiting":
      return { text: m.issue_to_stack({ count }), action: m.verb_stack() }
    case "calibration-failed":
      return { text: m.issue_failed({ name }), action: m.verb_open() }
    case "drift":
      return issue.id.startsWith("drift:master:")
        ? { text: m.issue_master_changed({ name }), action: m.nav_calibration() }
        : { text: m.issue_frames_changed({ count, name }), action: m.verb_review() }
    case "duplicates":
      return { text: m.issue_duplicates({ count, bytes: formatBytes(issue.bytes ?? 0) }), action: m.verb_review() }
  }
}

/**
 * One issue with its action and, unless it is a run's next step, its ×
 * (Dismiss), as a row of a `[data-issue-list]`. `onNavigate` closes the
 * popover that holds it; `refocus` names where focus goes when the list's
 * last row is dismissed.
 * @deprecated Use `IssueRow` from `@/components/app/issue-row` (open and dismissed states); removed in W4.
 */
export function IssueRow({ issue, onNavigate, refocus }: { issue: Issue; onNavigate: () => void; refocus: (list: Element | null) => HTMLElement | null | undefined }) {
  const m = useMessages()
  const row = useRef<HTMLLIElement>(null)
  const copy = issueCopy(m, issue)
  const Glyph = SEVERITY_ICON[issue.severity]
  // Focus stays in the list as the row goes (WCAG 2.4.3): on the next issue, else the previous one, else where `refocus` says.
  const dismiss = () => {
    const list = row.current?.closest("[data-issue-list]") ?? null
    const rows = [...(list?.querySelectorAll<HTMLElement>("[data-issue]") ?? [])]
    const at = rows.findIndex((r) => r === row.current)
    const near = rows[at + 1] ?? rows[at - 1]
    flushSync(() => dismissIssue(issue))
    const target = near?.querySelector<HTMLElement>("[data-dismiss]") ?? near?.querySelector<HTMLElement>("a") ?? refocus(list)
    target?.focus()
  }
  return (
    <li ref={row} className="flex min-h-(--row-h) items-center gap-2 py-(--row-py) pr-1.5 pl-3 text-sm" data-issue={issue.id}>
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
      {isDismissable(issue) ? (
        <Button variant="ghost" size="icon-xs" className="text-muted-foreground" aria-label={`${m.verb_dismiss()}: ${copy.text}`} title={m.verb_dismiss()} onClick={dismiss} data-dismiss>
          <X aria-hidden="true" />
        </Button>
      ) : (
        <span aria-hidden="true" className="size-6 shrink-0" />
      )}
    </li>
  )
}

/** The hub's footer: "Dismissed (N)", opening the dismissed issues, each with Restore; and Restore all. */
function DismissedIssues({ issues }: { issues: Issue[] }) {
  const m = useMessages()
  const root = useRef<HTMLDivElement>(null)
  if (issues.length === 0) return null
  // Focus moves before a restored row leaves (WCAG 2.4.3): to the next dismissed issue, else the restored issue's ×.
  const restore = (issue: Issue) => {
    const rows = [...(root.current?.querySelectorAll<HTMLElement>("[data-issue-dismissed]") ?? [])]
    const at = rows.findIndex((r) => r.dataset.issueDismissed === issue.id)
    const near = rows[at + 1] ?? rows[at - 1]
    const list = root.current?.closest("[data-issue-list]")
    flushSync(() => restoreIssue(issue))
    const target = near?.querySelector<HTMLElement>("button") ?? list?.querySelector<HTMLElement>(`[data-issue="${CSS.escape(issue.id)}"] [data-dismiss]`)
    target?.focus()
  }
  const restoreAll = () => {
    const list = root.current?.closest("[data-issue-list]")
    flushSync(restoreAllIssues)
    list?.querySelector<HTMLElement>("[data-issue] [data-dismiss]")?.focus()
  }
  return (
    <Collapsible ref={root} className="border-t border-border" data-issues-dismissed={issues.length}>
      <div data-chrome className="flex items-center gap-2 px-1.5 py-1">
        <CollapsibleTrigger render={<Button variant="ghost" size="xs" className="text-muted-foreground" />} data-issues-dismissed-trigger>
          <ChevronRight aria-hidden="true" className="transition-transform group-data-panel-open/button:rotate-90 motion-reduce:transition-none" />
          {m.issues_dismissed({ count: issues.length })}
        </CollapsibleTrigger>
        <Button variant="ghost" size="xs" className="ml-auto text-link" onClick={restoreAll} data-restore-all>
          {m.issues_restore_all()}
        </Button>
      </div>
      <CollapsibleContent>
        <ul className="pb-1">
          {issues.map((issue) => {
            const copy = issueCopy(m, issue)
            const Glyph = SEVERITY_ICON[issue.severity]
            return (
              <li key={issue.id} className="flex min-h-(--row-h) items-center gap-2 py-(--row-py) pr-1.5 pl-3 text-sm text-muted-foreground" data-issue-dismissed={issue.id}>
                <Glyph aria-hidden="true" className={cn("size-3.5 shrink-0", SEVERITY_TEXT[issue.severity])} />
                <span className="min-w-0 flex-1 truncate" title={copy.text}>
                  {copy.text}
                </span>
                <Button variant="ghost" size="xs" className="shrink-0 text-link" onClick={() => restore(issue)}>
                  {m.verb_restore()}
                  <span className="sr-only">: {copy.text}</span>
                </Button>
              </li>
            )
          })}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  )
}

export function IssuesButton() {
  const m = useMessages()
  const { issues, dismissed, worst } = useIssues()
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
      <PopoverContent align="end" className="max-h-[min(32rem,var(--available-height))] w-88 gap-0 overflow-y-auto p-0" aria-label={m.issues_title()} data-issue-list>
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
              <section key={group} aria-label={groupName(m, group)} className="border-b border-border py-1 last-of-type:border-0">
                <h3 data-chrome className="px-3 py-1 text-[0.6875rem] font-semibold text-muted-foreground">
                  {groupName(m, group)}
                </h3>
                <ul>
                  {rows.map((issue) => (
                    <IssueRow key={issue.id} issue={issue} onNavigate={() => setOpen(false)} refocus={(list) => list?.querySelector<HTMLElement>("[data-issues-dismissed-trigger]")} />
                  ))}
                </ul>
              </section>
            )
          })
        )}
        <DismissedIssues issues={dismissed} />
      </PopoverContent>
    </Popover>
  )
}
