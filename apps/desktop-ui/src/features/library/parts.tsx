/**
 * Shared parts of the Home area's pages.
 */
import { failureOf } from "@/api/ipc"
import { useMessages } from "@/app/preferences"
import { Notice } from "@/components/app/feedback"
import { failureMessage } from "@/components/app/run-result"
import type { Messages } from "@/lib/i18n"

/**
 * A surface the library cannot serve yet, named in place: it never reads as
 * empty, so missing data is never mistaken for none. Each call site names
 * the bead that brings it in a comment, for the switch-over.
 */
export function Unavailable({ what }: { what: string }) {
  const m = useMessages()
  return <Notice tone="info" title={m.home_unavailable({ what })} />
}

/** A failed read, worded for a table's error row: the library's code from the catalogue, or the transport failure. */
export function readError(m: Messages, error: unknown): string {
  const failure = failureOf(error)
  return failure ? failureMessage(m, failure) : m.home_read_failed()
}
