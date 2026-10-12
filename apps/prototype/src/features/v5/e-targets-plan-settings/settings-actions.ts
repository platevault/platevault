/**
 * Slice-local Settings writes that the foundation's `store/actions/settings.ts`
 * does not provide (foundation candidates): cameras, telescopes and rigs added
 * by hand (Round 6: gear not yet imaged with is "manual") or edited. Each goes
 * through `commit()`, so a failed write stays unsaved with Retry and the saved
 * value stays in effect.
 */
import type { Camera, CameraId, OpticalTrain, OpticalTrainId, Telescope, TelescopeId } from "@/domain/types"
import { msg, verbatim } from "@/lib/i18n"
import { freshId, MISSING, recordSaved } from "@/store/actions/shared"
import { type CommitResult, commit, store, withCatalog } from "@/store/core"

const HREF = "/settings/equipment"

/** A renamed record keeps its old name as an alias, so headers that carry it still match. */
function aliasesAfterRename(previous: { name: string; aliases: string[] } | undefined, name: string): string[] {
  if (!previous || previous.name === name) return previous?.aliases ?? []
  return [...new Set([...previous.aliases, previous.name])].filter((a) => a !== name)
}

export type CameraInput = Pick<Camera, "name" | "kind" | "widthPx" | "heightPx" | "pixelSizeUm">

/** Add a camera by hand (`id` null; it is Manual) or edit one, detected ones included. */
export function saveCamera(id: CameraId | null, input: CameraInput): CommitResult {
  const previous = id ? store.getState().catalog.cameras[id] : undefined
  if (id && !previous) return MISSING
  const cameraId = id ?? freshId("cam", input.name)
  const camera: Camera = { id: cameraId, source: previous?.source ?? "manual", ...input, aliases: aliasesAfterRename(previous, input.name) }
  const label = previous ? msg("settings_edit_title", { name: previous.name }) : msg("equipment_add_camera")
  const result = commit(label, (s) => withCatalog(s, (c) => ({ ...c, cameras: { ...c.cameras, [cameraId]: camera } })), { href: HREF })
  if (result.ok) recordSaved(msg("equipment_saved_named", { name: camera.name }), null, HREF)
  return result
}

export type TelescopeInput = Pick<Telescope, "name" | "focalLengthMm" | "apertureMm">

/** Add a telescope by hand (`id` null; it is Manual) or edit one, detected ones included. */
export function saveTelescope(id: TelescopeId | null, input: TelescopeInput): CommitResult {
  const previous = id ? store.getState().catalog.telescopes[id] : undefined
  if (id && !previous) return MISSING
  const telescopeId = id ?? freshId("tel", input.name)
  const telescope: Telescope = { id: telescopeId, source: previous?.source ?? "manual", ...input, aliases: aliasesAfterRename(previous, input.name) }
  const label = previous ? msg("settings_edit_title", { name: previous.name }) : msg("equipment_add_telescope")
  const result = commit(label, (s) => withCatalog(s, (c) => ({ ...c, telescopes: { ...c.telescopes, [telescopeId]: telescope } })), { href: HREF })
  if (result.ok) recordSaved(msg("equipment_saved_named", { name: telescope.name }), null, HREF)
  return result
}

export interface RigInput {
  name: string
  cameraId: CameraId
  telescopeId: TelescopeId
  /** The telescope's focal length as used on this rig, before the reducer. */
  focalLengthMm: number
  /** 1 without a reducer; 0.8 for a 0.8× reducer. */
  reducer: number
}

/**
 * Add a rig by hand (`id` null; it is Manual, with no filters yet) or change
 * what an existing rig is made of: its camera, telescope, focal length and
 * reducer. The camera and telescope records themselves never change here.
 */
export function saveRig(id: OpticalTrainId | null, input: RigInput): { result: CommitResult; id: OpticalTrainId } {
  const previous = id ? store.getState().catalog.opticalTrains[id] : undefined
  const rigId = id ?? freshId("rig", input.name)
  if (id && !previous) return { result: MISSING, id: rigId }
  const effectiveFocalLengthMm = Math.round(input.focalLengthMm * input.reducer * 10) / 10
  const composition = { name: input.name, cameraId: input.cameraId, telescopeId: input.telescopeId, effectiveFocalLengthMm, reducer: input.reducer }
  const rig: OpticalTrain = previous ? { ...previous, ...composition } : { id: rigId, source: "manual", notes: "", filters: [], ...composition }
  const href = `${HREF}?rig=${rigId}`
  const result = commit(previous ? msg("settings_edit_title", { name: previous.name }) : msg("project_add_rig"), (s) => withCatalog(s, (c) => ({ ...c, opticalTrains: { ...c.opticalTrains, [rigId]: rig } })), { href })
  if (result.ok) recordSaved(msg("equipment_saved_named", { name: rig.name }), verbatim(`${effectiveFocalLengthMm} mm`), href)
  return { result, id: rigId }
}
