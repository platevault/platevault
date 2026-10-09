/**
 * Helpers the shared store actions use (foundation-owned): ids, the saved
 * Activity record and the standard refusals. Screens call the actions in the
 * sibling modules, not these.
 */
import { stableHash } from "@/domain/indexing"
import { type CommitResult, nowIso, recordActivity } from "@/store/core"

let counter = 0

/** A fresh id: `prefix_<hash>`, unique within this page session and across reloads. */
export function freshId(prefix: string, seed: string): string {
  counter += 1
  return `${prefix}_${stableHash(`${seed}|${nowIso()}|${counter}|${Math.random()}`)}`
}

export function recordSaved(title: string, detail: string | null, href: string | null) {
  recordActivity({ kind: "saved", title, detail, operationId: null, href })
}

/** A refusal is reported in Activity with its reasons, and nothing is written. */
export function refuse(title: string, reasons: string[], href: string | null): CommitResult {
  const message = `${title}: ${reasons.join("; ")}.`
  recordActivity({ kind: "refusal", title, detail: reasons.join("; "), operationId: null, href })
  return { ok: false, reason: "refused", message, reasons }
}

export const MISSING: CommitResult = {
  ok: false,
  reason: "stale",
  message: "This record no longer exists in the catalog. Reload the page to see the current library.",
}
