/**
 * Helpers the shared store actions use (foundation-owned): ids, the saved
 * Activity record and the standard refusals. Screens call the actions in the
 * sibling modules, not these. Activity copy is a `MessageRef`, worded when it
 * is read; a refusal's returned message is worded now.
 */
import { type FlowGate, isLocked } from "@/domain/derive"
import { stableHash } from "@/domain/indexing"
import type { Project } from "@/domain/types"
import { joinRefs, m, type MessageRef, msg, say } from "@/lib/i18n"
import { type CommitResult, nowIso, recordActivity } from "@/store/core"

let counter = 0

/** A fresh id: `prefix_<hash>`, unique within this page session and across reloads. */
export function freshId(prefix: string, seed: string): string {
  counter += 1
  return `${prefix}_${stableHash(`${seed}|${nowIso()}|${counter}|${Math.random()}`)}`
}

export function recordSaved(title: MessageRef, detail: MessageRef | null, href: string | null) {
  recordActivity({ kind: "saved", title, detail, operationId: null, href })
}

/** A refusal is reported in Activity with its reasons (joined by "; ", which Activity lists one per line), and nothing is written. */
export function refuse(title: MessageRef, reasons: MessageRef[], href: string | null): CommitResult {
  const detail = joinRefs(reasons, "; ")
  recordActivity({ kind: "refusal", title, detail, operationId: null, href })
  return { ok: false, reason: "refused", message: say(m, msg("store_refusal_message", { title, reasons: detail })), reasons: reasons.map((reason) => say(m, reason)) }
}

/** A flow gate as a refusal (F3): one reason per blocker ("Apply or discard the pending changes · View"), or the gate's reason alone. */
export function refuseWithGate(label: MessageRef, gate: FlowGate, href: string | null): CommitResult {
  const reasons = gate.blockers.length > 0 ? gate.blockers.map((b) => joinRefs([gate.reason, b.label], " · ")) : [gate.reason]
  return refuse(msg("store_refused", { label }), reasons, href)
}

/**
 * A Closed or Archived Project is locked for good (PRJ-FR-25; no Reopen,
 * provisional): every write to it is refused, naming it. Null while it is
 * open. To go on with its work, the user duplicates it.
 */
export function closedRefusal(project: Project | undefined, label: MessageRef): CommitResult | null {
  if (!project || !isLocked(project)) return null
  return refuse(msg("store_refused", { label }), [msg("store_reason_project_closed", { project: project.name })], `/projects/${project.id}`)
}

export const MISSING: CommitResult = {
  ok: false,
  reason: "stale",
  get message() {
    return m.store_record_missing()
  },
}
