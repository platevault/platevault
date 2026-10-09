/**
 * Slice B subject and mosaic writes (D-W17, D-W38, D-W73), composed from the
 * shared actions so each keeps its own refusal: resolving a picked Target,
 * and the mosaic editor's Confirm (the subject's panels, then one run group
 * of the included panels with the user's placements, then the profile).
 */
import type { MosaicPanel, OpticalTrainId, ProjectId, SessionId } from "@/domain/types"
import { m } from "@/lib/i18n"
import { addTarget } from "@/store/actions/library"
import { addSubject, setSubjectMosaic } from "@/store/actions/projects"
import { setGroupSetup, startRun } from "@/store/actions/runs"
import { type CommitResult, store } from "@/store/core"
import type { SubjectPick } from "./parts"

/** Resolves a pick to a Target id, creating the Target record of a new object first. */
export function resolvePick(pick: SubjectPick): { ok: true; targetId: string } | { ok: false; message: string } {
  if (pick.kind === "target") return { ok: true, targetId: pick.targetId }
  const added = addTarget(pick.entry, { resolver: pick.resolver, favourite: false })
  if (!added.result.ok) return { ok: false, message: added.result.message }
  return added.targetId ? { ok: true, targetId: added.targetId } : { ok: false, message: m.project_target_not_added({ name: pick.name }) }
}

export interface MosaicConfirm {
  projectId: ProjectId
  /** The subject to start; null with `pick` for a new mosaic subject. */
  subjectId: string | null
  pick: SubjectPick | null
  name: string
  rigId: OpticalTrainId
  panels: MosaicPanel[]
  /** Panels that get a panel run. */
  includedIds: string[]
  /** The user's placements, overriding pointing; null leaves a session out. */
  placements: Record<SessionId, string | null>
  profileId: string | null
}

const failed = (message: string): CommitResult => ({ ok: false, reason: "write-failed", message })

/**
 * Confirm of the mosaic editor. A picked Target that already is a subject
 * becomes that subject's mosaic; otherwise a new subject is added. A changed
 * panel set is saved first (refused while a run uses a removed panel).
 */
export function confirmMosaic(input: MosaicConfirm): { result: CommitResult; groupId: string | null } {
  const n = input.panels.length
  const centre = { ra: input.panels.reduce((sum, p) => sum + p.ra, 0) / n, dec: input.panels.reduce((sum, p) => sum + p.dec, 0) / n }
  const mosaic = { name: input.name.trim(), centre: { ra: Number(centre.ra.toFixed(3)), dec: Number(centre.dec.toFixed(3)) }, panels: input.panels }
  let subjectId = input.subjectId
  if (!subjectId) {
    if (!input.pick) return { result: failed(m.mosaic_choose_target_first()), groupId: null }
    const resolved = resolvePick(input.pick)
    if (!resolved.ok) return { result: failed(resolved.message), groupId: null }
    const project = store.getState().catalog.projects[input.projectId]
    if (!project) return { result: failed(m.project_gone()), groupId: null }
    subjectId = project.subjects.find((s) => s.targetId === resolved.targetId)?.id ?? null
    if (!subjectId) {
      const added = addSubject(input.projectId, { targetId: resolved.targetId, mosaic }, project.revision)
      if (!added.ok) return { result: added, groupId: null }
      subjectId = store.getState().catalog.projects[input.projectId]?.subjects.find((s) => s.targetId === resolved.targetId)?.id ?? null
      if (!subjectId) return { result: failed(m.mosaic_subject_not_saved()), groupId: null }
    }
  }
  const project = store.getState().catalog.projects[input.projectId]
  const subject = project?.subjects.find((s) => s.id === subjectId)
  if (!project || !subject) return { result: failed(m.project_subject_gone()), groupId: null }
  if (JSON.stringify(subject.mosaic) !== JSON.stringify(mosaic)) {
    const saved = setSubjectMosaic(input.projectId, subject.id, mosaic, project.revision)
    if (!saved.ok) return { result: saved, groupId: null }
  }
  const started = startRun(input.projectId, subject.id, input.rigId, { panelIds: input.includedIds, placements: input.placements })
  if (!started.result.ok || !started.groupId) return { result: started.result, groupId: null }
  if (input.profileId) {
    const setup = setGroupSetup(started.groupId, { profileId: input.profileId })
    if (!setup.ok) return { result: failed(m.mosaic_profile_not_saved({ message: setup.message })), groupId: started.groupId }
  }
  return { result: { ok: true }, groupId: started.groupId }
}
