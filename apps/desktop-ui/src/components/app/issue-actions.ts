/**
 * Dismiss, Restore and Show dismissed on the rows and pages that own issues
 * (F7, P-ISS1). There is no Issues hub: the row an issue is on (`rowIssues`)
 * offers Dismiss in its ⋯ and context menu, and a Library count ("2 need a
 * Target", no row) is the page's own, offered in the object menu of the page
 * its link opens. A dismissed issue offers Restore in the same place. The
 * Issues facet (With issues · Dismissed) is a table's Show dismissed: it
 * narrows the rows to those holding an issue that counts, or a dismissed
 * one. Dismissing hides the issue from every count until it changes; the
 * state behind it is unchanged, so the row stays where it is. The owner
 * records a dismissal through `IssueCallbacks`.
 */
import { EyeOff, RotateCcw } from "lucide-react"
import type { Messages } from "@/lib/i18n"
import type { Facet, MenuItem } from "./contracts"
import { type Issue, type IssueOwner, issueCopy } from "./issue-copy"

/** Every issue across the app: those that count, and those dismissed. */
export interface IssueView {
  issues: readonly Issue[]
  dismissed: readonly Issue[]
}

/** The issues one row or page owns: those that count, and those dismissed. */
export interface OwnIssues {
  live: readonly Issue[]
  dismissed: readonly Issue[]
}

/** How the owner records a dismissal: hide `issue` until it changes, or bring it back. */
export interface IssueCallbacks {
  onDismiss: (issue: Issue) => void
  onRestore: (issue: Issue) => void
}

/** A row no issue can be on. */
export const NO_ISSUES: OwnIssues = { live: [], dismissed: [] }

const ownedBy = (owner: IssueOwner) => (issue: Issue) => issue.owner.kind === owner.kind && ("id" in owner ? "id" in issue.owner && issue.owner.id === owner.id : true)

/** A row's issues: every issue its owner is, counting or dismissed. */
export function rowIssues(view: IssueView, owner: IssueOwner): OwnIssues {
  const own = ownedBy(owner)
  return { live: view.issues.filter(own), dismissed: view.dismissed.filter(own) }
}

/** A page's own issues: the Library counts whose link opens that page (`/sessions`, `/calibration`). */
export function pageIssues(view: IssueView, to: string): OwnIssues {
  const own = (issue: Issue) => issue.owner.kind === "library" && issue.to === to
  return { live: view.issues.filter(own), dismissed: view.dismissed.filter(own) }
}

/** `items`, then Dismiss for each issue that can be dismissed and Restore for each dismissed one, after a separator. */
export function withIssueItems(m: Messages, items: MenuItem[], own: OwnIssues, { onDismiss, onRestore }: IssueCallbacks): MenuItem[] {
  const issueItems: MenuItem[] = [
    ...own.live
      .filter((issue) => issue.dismissable)
      .map((issue): MenuItem => ({ id: `dismiss-${issue.id}`, label: m.issue_row_dismiss({ issue: issueCopy(m, issue).text }), icon: EyeOff, run: () => onDismiss(issue) })),
    ...own.dismissed.map((issue): MenuItem => ({ id: `restore-${issue.id}`, label: m.issue_row_restore({ issue: issueCopy(m, issue).text }), icon: RotateCcw, run: () => onRestore(issue) })),
  ]
  if (issueItems.length === 0) return items
  return items.length > 0 ? [...items, { separator: true }, ...issueItems] : issueItems
}

/** The Issues facet's values: rows with an issue that counts, rows with a dismissed one (Show dismissed). */
export type IssueFilter = "with-issues" | "dismissed"

const ISSUE_FILTERS: readonly IssueFilter[] = ["with-issues", "dismissed"]

/** "" for none: every row passes. */
export function parseIssueFilter(value: unknown): IssueFilter | "" {
  return ISSUE_FILTERS.find((filter) => filter === value) ?? ""
}

export function matchesIssueFilter(own: OwnIssues, filter: IssueFilter | ""): boolean {
  if (filter === "with-issues") return own.live.length > 0
  if (filter === "dismissed") return own.dismissed.length > 0
  return true
}

/** The Issues facet for a table's filter row, each value counted over `rows` (the issues of every row, before this facet). */
export function issuesFacet(m: Messages, rows: readonly OwnIssues[], value: IssueFilter | ""): Facet {
  return {
    id: "issues",
    label: m.issues_title(),
    kind: "single",
    value,
    options: [
      { value: "with-issues", label: m.issues_filter_with_issues(), count: rows.filter((own) => matchesIssueFilter(own, "with-issues")).length },
      { value: "dismissed", label: m.issues_filter_dismissed(), count: rows.filter((own) => matchesIssueFilter(own, "dismissed")).length },
    ],
  }
}
