/**
 * Slice B subject writes (D-W17, D-W38): resolving a picked Target,
 * creating the Target record of a new object first, so each subject write
 * keeps its own refusal.
 */
import { m } from "@/lib/i18n"
import { addTarget } from "@/store/actions/library"
import type { SubjectPick } from "./parts"

/** Resolves a pick to a Target id, creating the Target record of a new object first. */
export function resolvePick(pick: SubjectPick): { ok: true; targetId: string } | { ok: false; message: string } {
  if (pick.kind === "target") return { ok: true, targetId: pick.targetId }
  const added = addTarget(pick.entry, { resolver: pick.resolver, favourite: false })
  if (!added.result.ok) return { ok: false, message: added.result.message }
  return added.targetId ? { ok: true, targetId: added.targetId } : { ok: false, message: m.project_target_not_added({ name: pick.name }) }
}
