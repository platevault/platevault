/**
 * IssueRow (plan §3.3 P14; P-ISS1): one issue of the Issues hub or a status
 * bar popout, as an `<li>` of the host's `<ul>`.
 *
 * - **Open** (default): severity glyph, the terse label, its one action (a
 *   link to where it is fixed) and Dismiss ×. A run's next step
 *   (`run-blocked`, `calibration-review`) has no × (`isDismissable`): it
 *   stays until the run moves on, and an empty slot keeps the columns.
 * - **Dismissed:** the same row, muted, with Restore, for the hub's
 *   Dismissed group (A SH8: one row, two states).
 *
 * The host owns the store calls (`onDismiss`, `onRestore`). The row keeps
 * focus in the list as it leaves (WCAG 2.4.3): on the next row, else the
 * previous one, else wherever `refocus` points.
 */
import { Link } from "@tanstack/react-router"
import { Info, type LucideIcon, OctagonX, TriangleAlert, X } from "lucide-react"
import { useRef } from "react"
import { flushSync } from "react-dom"
import { useMessages } from "@/app/preferences"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { type Issue, type IssueSeverity, isDismissable } from "@/domain/issues"
import { formatBytes } from "@/lib/format"
import { type Messages, say } from "@/lib/i18n"
import { cn } from "@/lib/utils"

export const ISSUE_SEVERITY_ICON: Record<IssueSeverity, LucideIcon> = { danger: OctagonX, warning: TriangleAlert, info: Info }
export const ISSUE_SEVERITY_TEXT: Record<IssueSeverity, string> = { danger: "text-destructive", warning: "text-warning", info: "text-info" }

/**
 * The issue's terse label and its one action, in the chosen language:
 * "2 need a Target", "Assign". The kind decides the wording; drift on an
 * adopted master differs from drift in a session's frames.
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

export type IssueRowState = "open" | "dismissed"

export interface IssueRowProps {
  issue: Issue
  state?: IssueRowState
  /** Open rows: shows × when the kind can be dismissed. */
  onDismiss?: (issue: Issue) => void
  /** Dismissed rows: Restore. */
  onRestore?: (issue: Issue) => void
  /** Runs when the action navigates: the popover holding the row closes. */
  onNavigate?: () => void
  /** Where focus goes when this was the list's last row (the Dismissed trigger; the restored issue's ×). */
  refocus?: (issue: Issue) => HTMLElement | null | undefined
}

export function IssueRow({ issue, state = "open", onDismiss, onRestore, onNavigate, refocus }: IssueRowProps) {
  const m = useMessages()
  const row = useRef<HTMLLIElement>(null)
  const copy = issueCopy(m, issue)
  const Glyph = ISSUE_SEVERITY_ICON[issue.severity]

  // The row leaves the list: focus moves to the next row's control, else the previous one's, else `refocus`.
  const leave = (change: (issue: Issue) => void) => {
    const rows = [...(row.current?.parentElement?.children ?? [])].filter((el): el is HTMLElement => el instanceof HTMLElement && el.dataset.issue !== undefined)
    const at = rows.findIndex((r) => r === row.current)
    const near = rows[at + 1] ?? rows[at - 1]
    flushSync(() => change(issue))
    const target = near?.querySelector<HTMLElement>("[data-issue-focus]") ?? near?.querySelector<HTMLElement>("a") ?? refocus?.(issue)
    target?.focus()
  }

  const dismissed = state === "dismissed"
  return (
    <li ref={row} className={cn("flex min-h-(--row-h) items-center gap-2 py-(--row-py) pr-1.5 pl-3 text-sm", dismissed && "text-muted-foreground")} data-issue={issue.id} data-issue-state={state}>
      <Glyph aria-hidden="true" className={cn("size-3.5 shrink-0", ISSUE_SEVERITY_TEXT[issue.severity])} />
      <span className="min-w-0 flex-1 truncate" title={copy.text}>
        {copy.text}
      </span>
      {dismissed ? (
        onRestore ? (
          <Button variant="outline" size="xs" className="shrink-0" onClick={() => leave(onRestore)} data-issue-focus>
            {m.verb_restore()}
            <span className="sr-only">: {copy.text}</span>
          </Button>
        ) : null
      ) : (
        <>
          <Button
            variant="link"
            size="xs"
            className="shrink-0"
            render={<Link to={issue.link.to as never} params={issue.link.params as never} search={issue.link.search as never} />}
            onClick={onNavigate}
          >
            {copy.action}
            <span className="sr-only">: {copy.text}</span>
          </Button>
          {onDismiss && isDismissable(issue) ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label={`${m.verb_dismiss()}: ${copy.text}`} onClick={() => leave(onDismiss)} data-issue-focus data-dismiss>
                    <X aria-hidden="true" />
                  </Button>
                }
              />
              <TooltipContent>{m.verb_dismiss()}</TooltipContent>
            </Tooltip>
          ) : (
            <span aria-hidden="true" className="size-6 shrink-0" />
          )}
        </>
      )}
    </li>
  )
}
