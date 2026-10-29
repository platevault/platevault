/**
 * The Settings area's shared parts: a read that failed, a read still
 * loading, and a section whose library contract does not exist yet (named,
 * never faked).
 */
import type { UseQueryResult } from "@tanstack/react-query"
import type { ReactNode } from "react"
import { failureOf } from "@/api/ipc"
import { useMessages } from "@/app/preferences"
import { ActionError, Notice, TableSkeleton } from "@/components/app/feedback"
import { failureMessage } from "@/components/app/run-result"
import type { Messages } from "@/lib/i18n"

/** A failed read in the reader's language: the library's code from the catalogue, or the transport failure. */
export function readError(m: Messages, error: unknown): string {
  const failure = failureOf(error)
  return failure ? failureMessage(m, failure) : m.home_read_failed()
}

/** `children` once `query` has data; until then its skeleton, or its failure with Retry. */
export function Read<T>({ query, label, children }: { query: UseQueryResult<T>; label: string; children: (data: T) => ReactNode }) {
  const m = useMessages()
  if (query.data !== undefined) return <>{children(query.data)}</>
  if (query.isError) return <ActionError message={readError(m, query.error)} onRetry={() => void query.refetch()} />
  return <TableSkeleton rows={3} columns={3} label={label} />
}

/** A section the library cannot back yet: what is missing, said plainly; nothing on it pretends to work. */
export function Gap({ what, detail }: { what: string; detail: string }) {
  const m = useMessages()
  return (
    <Notice tone="info" title={m.home_unavailable({ what })}>
      {detail}
    </Notice>
  )
}
