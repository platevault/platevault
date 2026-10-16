/**
 * The Issues hub (foundation-owned): the toolbar's Issues, a glyph with a
 * count badge tinted by the worst severity, opening a panel that lists every
 * issue grouped, each as an `IssueRow` with its one action and Dismiss ×
 * (P-ISS1). The panel ends with "Dismissed (N)": the same rows, each with
 * Restore, plus Restore all. The look lives in `@/components/app/status-bar`
 * (ListPopover) and `@/components/app/issue-row`.
 */
import { CircleAlert, CircleCheck } from "lucide-react"
import { useRef, useState } from "react"
import { flushSync } from "react-dom"
import { IssueRow } from "@/components/app/issue-row"
import { CountBadge } from "@/components/app/pill"
import type { Tone } from "@/components/app/status"
import { ListEmpty, ListFold, ListPopover, ListSection } from "@/components/app/status-bar"
import { ISSUE_GROUPS, type IssueGroup, type IssueSeverity } from "@/domain/issues"
import type { Messages } from "@/lib/i18n"
import { dismissIssue, restoreAllIssues, restoreIssue, useIssues } from "@/store/issues"
import { useMessages } from "./preferences"

const SEVERITY_TONE: Record<IssueSeverity, Tone> = { danger: "danger", warning: "warning", info: "info" }

function groupName(m: Messages, group: IssueGroup): string {
  const name: Record<IssueGroup, () => string> = {
    sessions: m.nav_sessions,
    storage: m.common_locations,
    work: m.issues_group_work,
    projects: m.nav_projects,
    calibration: m.nav_calibration,
    drift: m.issues_group_drift,
  }
  return name[group]()
}

export function IssuesHub() {
  const m = useMessages()
  const { issues, dismissed, worst } = useIssues()
  const [open, setOpen] = useState(false)
  const fold = useRef<HTMLDivElement>(null)
  const label = issues.length === 0 ? m.issues_none() : m.issues_count({ count: issues.length })
  // A dismissed row that was the panel's last open issue hands focus to "Dismissed (N)" (WCAG 2.4.3).
  const toFold = () => fold.current?.querySelector<HTMLElement>("[data-list-fold-trigger]")
  // A restored row that was the last dismissed one hands focus to its own × in the open list.
  const toRestored = (issue: { id: string }) => document.querySelector<HTMLElement>(`[data-issue-list] [data-issue="${CSS.escape(issue.id)}"][data-issue-state="open"] [data-dismiss]`)
  const restoreAll = () => {
    flushSync(restoreAllIssues)
    document.querySelector<HTMLElement>('[data-issue-list] [data-issue-state="open"] [data-dismiss]')?.focus()
  }
  return (
    <ListPopover
      open={open}
      onOpenChange={setOpen}
      side="bottom"
      title={m.issues_title()}
      meta={label}
      trigger={{
        label: `${m.issues_title()}: ${label}`,
        icon: worst ? CircleAlert : CircleCheck,
        tone: worst ?? "muted",
        size: "sm",
        content: issues.length > 0 ? <CountBadge count={issues.length} tone={worst ? SEVERITY_TONE[worst] : "neutral"} /> : null,
        "data-issues": worst ?? "none",
      }}
      data-issue-list=""
    >
      {issues.length === 0 ? (
        <ListEmpty>{m.issues_none()}</ListEmpty>
      ) : (
        ISSUE_GROUPS.map((group) => {
          const rows = issues.filter((i) => i.group === group)
          if (rows.length === 0) return null
          return (
            <ListSection key={group} label={groupName(m, group)}>
              {rows.map((issue) => (
                <IssueRow key={issue.id} issue={issue} onDismiss={dismissIssue} onNavigate={() => setOpen(false)} refocus={toFold} />
              ))}
            </ListSection>
          )
        })
      )}
      {dismissed.length > 0 ? (
        <ListFold ref={fold} label={m.issues_dismissed({ count: dismissed.length })} action={{ label: m.issues_restore_all(), onRun: restoreAll }}>
          {dismissed.map((issue) => (
            <IssueRow key={issue.id} issue={issue} state="dismissed" onRestore={restoreIssue} refocus={toRestored} />
          ))}
        </ListFold>
      ) : null}
    </ListPopover>
  )
}
