/**
 * Slice-local Settings writes that the foundation's `store/actions/settings.ts`
 * does not provide (foundation candidates): a rig's optics, and cameras,
 * telescopes and rigs added by hand (Round 6: gear not yet imaged with is
 * "manual") or edited. Each goes through `commit()`, so a failed write stays
 * unsaved with Retry and the saved value stays in effect.
 */
import type { Camera, CameraId, CameraKind, OpticalTrainId, Telescope, TelescopeId } from "@/domain/types"
import { joinRefs, msg, verbatim } from "@/lib/i18n"
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

/** Add a rig by hand: a camera on a telescope, with a focal length and reducer. It is Manual and has no filters yet. */
export function addRig(input: RigInput): { result: CommitResult; id: OpticalTrainId } {
  const id = freshId("rig", input.name)
  const effectiveFocalLengthMm = Math.round(input.focalLengthMm * input.reducer * 10) / 10
  const result = commit(
    msg("project_add_rig"),
    (s) =>
      withCatalog(s, (c) => ({
        ...c,
        opticalTrains: { ...c.opticalTrains, [id]: { id, name: input.name, source: "manual", cameraId: input.cameraId, telescopeId: input.telescopeId, effectiveFocalLengthMm, reducer: input.reducer, notes: "", filters: [] } },
      })),
    { href: `${HREF}?rig=${id}` },
  )
  if (result.ok) recordSaved(msg("equipment_saved_named", { name: input.name }), verbatim(`${effectiveFocalLengthMm} mm`), `${HREF}?rig=${id}`)
  return { result, id }
}

export interface OpticsInput {
  focalLengthMm: number
  /** Camera values; they apply to every rig that uses the camera. Null when the rig has no camera. */
  camera: { kind: CameraKind; widthPx: number; heightPx: number; pixelSizeUm: number } | null
}

/** Edit a rig's optics (PLAN-EQ-FR-05): its effective focal length and its camera's kind, sensor and pixel size. */
export function updateRigOptics(rigId: OpticalTrainId, input: OpticsInput): CommitResult {
  const { catalog } = store.getState()
  const rig = catalog.opticalTrains[rigId]
  if (!rig) return MISSING
  const cameraId = rig.cameraId
  const href = HREF
  const result = commit(
    msg("equipment_optics_title", { name: rig.name }),
    (s) =>
      withCatalog(s, (c) => {
        const cameras = cameraId && input.camera && c.cameras[cameraId] ? { ...c.cameras, [cameraId]: { ...c.cameras[cameraId]!, ...input.camera } } : c.cameras
        return { ...c, cameras, opticalTrains: { ...c.opticalTrains, [rigId]: { ...c.opticalTrains[rigId]!, effectiveFocalLengthMm: input.focalLengthMm } } }
      }),
    { href },
  )
  if (result.ok) {
    const camera = input.camera ? msg("store_optics_camera", { kind: input.camera.kind === "osc" ? msg("equipment_osc") : msg("equipment_mono"), width: input.camera.widthPx, height: input.camera.heightPx, pixel: input.camera.pixelSizeUm }) : null
    recordSaved(msg("store_saved_optics", { name: rig.name }), joinRefs([verbatim(`${input.focalLengthMm} mm`), ...(camera ? [camera] : [])], " · "), href)
  }
  return result
}
