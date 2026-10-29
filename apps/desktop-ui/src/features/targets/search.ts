/**
 * Acting on a search or Browse result (PLAN-TGT-FR-03, D-W152, D-W164).
 * `targets_search_result_action` opens a Target already in My targets
 * unchanged and adds any other result to My targets as a favourite. Result
 * rows carry no Add button: the row's click is the action. The search stays
 * open after an add, and a failed add stays visible with Retry until the
 * next attempt or a new search. While one result's action runs, its row
 * shows a spinner and every other click is ignored.
 */
import { useQueryClient } from "@tanstack/react-query"
import { useEffect, useRef, useState } from "react"
import { type LibraryFailure, library, type TargetsSearchResult } from "@/api/ipc"
import { useMessages } from "@/app/preferences"
import { toast } from "@/components/app/feedback"
import { targetsWrite } from "./queries"

export interface ResultAction {
  /** Open or add `result`. */
  act: (result: TargetsSearchResult) => Promise<void>
  /** The result being acted on. */
  pending: string | null
  /** The last add that failed, with the library's reason. */
  failed: { result: TargetsSearchResult; failure: LibraryFailure } | null
  dismiss: () => void
}

/** `query` is the search text: a new search drops the last failure, which named an earlier result. */
export function useResultAction(open: (targetId: string) => void, query: string): ResultAction {
  const m = useMessages()
  const client = useQueryClient()
  const [pending, setPending] = useState<string | null>(null)
  const [failed, setFailed] = useState<ResultAction["failed"]>(null)
  // A ref as well as the state, so a second click before the re-render is ignored too.
  const running = useRef(false)
  useEffect(() => setFailed(null), [query])
  async function act(result: TargetsSearchResult) {
    if (running.current) return
    running.current = true
    setPending(result.target.id)
    setFailed(null)
    const outcome = await targetsWrite(client, () => library.targetsSearchResultAction(result))
    running.current = false
    setPending(null)
    if (!outcome.ok) {
      setFailed({ result, failure: outcome.failure })
      return
    }
    if (outcome.data.action === "open") open(outcome.data.target.candidate.id)
    else toast({ message: m.store_saved_added_to_my_targets({ name: outcome.data.target.candidate.designation }) })
  }
  return { act, pending, failed, dismiss: () => setFailed(null) }
}
