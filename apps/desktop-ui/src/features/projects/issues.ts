/**
 * The issues Projects own (F7, P-ISS1), from `library_issues`: a Project row
 * and the Project page offer Dismiss for each dismissable issue and Restore
 * for each dismissed one, through the library's fingerprints. A Project's
 * own waiting work (View (previous) to review) can't be dismissed.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { type ActionResult, type Issue as LibraryIssue, library } from "@/api/ipc"
import { libraryKey, libraryQuery } from "@/api/query"
import { useMessages } from "@/app/preferences"
import { issuePageLink } from "@/app/status-bar"
import { toast } from "@/components/app/feedback"
import type { Issue } from "@/components/app/issue-copy"
import { failureMessage } from "@/components/app/run-result"
import { type IssueCallbacks, type IssueView, NO_ISSUES, type OwnIssues, rowIssues } from "@/components/app/issue-actions"

function clientIssue(issue: LibraryIssue): Issue {
  return { id: issue.id, kind: issue.kind, severity: issue.severity, count: issue.count, bytes: issue.bytes ?? undefined, name: issue.name, owner: issue.owner, to: issuePageLink(issue.page).to, dismissable: issue.dismissable }
}

export interface ProjectIssues {
  /** One Project's issues, counting and dismissed. */
  of: (projectId: string) => OwnIssues
  callbacks: IssueCallbacks
}

export function useProjectIssues(): ProjectIssues {
  const m = useMessages()
  const client = useQueryClient()
  const read = useQuery(libraryQuery("libraryIssues"))
  const data = read.data
  const view: IssueView | null = data ? { issues: data.issues.map(clientIssue), dismissed: data.dismissed.map(clientIssue) } : null
  const fingerprint = (issue: Issue) => [...(data?.issues ?? []), ...(data?.dismissed ?? [])].find((i) => i.id === issue.id)?.fingerprint
  // The menu item can't hold a refusal, so a failed dismissal says why in a toast; the issue stays as it was.
  const settle = async (pending: Promise<ActionResult<null>>) => {
    const result = await pending
    if (result.ok) await client.invalidateQueries({ queryKey: libraryKey("libraryIssues") })
    else toast({ message: failureMessage(m, result.failure) })
  }
  return {
    of: (projectId) => (view ? rowIssues(view, { kind: "project", id: projectId }) : NO_ISSUES),
    callbacks: {
      onDismiss: (issue) => {
        const print = fingerprint(issue)
        if (print) void settle(library.libraryDismissIssue(print))
      },
      onRestore: (issue) => {
        const print = fingerprint(issue)
        if (print) void settle(library.libraryRestoreIssue(print))
      },
    },
  }
}
