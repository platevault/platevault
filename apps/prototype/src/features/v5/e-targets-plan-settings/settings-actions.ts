/**
 * Slice-local Settings writes that the foundation's `store/actions/settings.ts`
 * does not provide (foundation candidates). Each goes through `commit()`, so a
 * failed write stays unsaved with Retry and the saved value stays in effect.
 */
import type { CameraKind, OpticalTrainId } from "@/domain/types"
import { joinRefs, msg, verbatim } from "@/lib/i18n"
import { MISSING, recordSaved } from "@/store/actions/shared"
import { type CommitResult, commit, store, withCatalog } from "@/store/core"

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
  const href = "/settings/equipment"
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
