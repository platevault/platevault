/**
 * Calibration library writes (foundation-owned; P-CAL1, P-CAL2).
 *
 * - Integrate master: a calibration session is handed off to a tool profile
 *   (Siril, PixInsight) as an `integrate-master` operation; on finish the
 *   master file is written into the session's calibration location and
 *   registered as an adopted master whose origin names the session.
 * - Restore offer: a dismissed master offer becomes pending again. Dismiss
 *   itself is the run's Calibrate step answer (`answerMasterOffer`).
 */
import { KIND_LABEL } from "@/domain/calibration"
import { calibrationSessions, integrateRefusals } from "@/domain/calibration-library"
import { fakeSha256, makeFile, volumeForPath, writeFiles } from "@/domain/disk"
import { stableHash } from "@/domain/indexing"
import type { CalibrationMaster, MasterId, OperationId, ProfileId, RunId, SessionId } from "@/domain/types"
import { fileName, formatExposure, plural } from "@/lib/format"
import { type CommitResult, nowIso, type PrototypeState, store } from "@/store/core"
import { type OperationHandler, patchOperation, settleOperation, startOperation } from "@/store/operations"
import { editRun } from "./runs"
import { refuse } from "./shared"

interface IntegratePayload {
  sessionId: SessionId
  profileId: ProfileId
  frames: number
  done: number
}

/** Frames the simulated tool stacks per tick. */
const FRAMES_PER_TICK = 6

function integrating(state: PrototypeState, sessionId: SessionId): boolean {
  return Object.values(state.operations).some((op) => op.kind === "integrate-master" && (op.status === "running" || op.status === "paused") && (op.payload as unknown as IntegratePayload).sessionId === sessionId)
}

/** Integrate master (P-CAL1): refused with reasons when the profile cannot run it. Returns the operation id when started. */
export function integrateMaster(sessionId: SessionId, profileId: ProfileId | null): { result: CommitResult; operationId: OperationId | null } {
  const state = store.getState()
  const reasons = integrateRefusals(state.catalog, sessionId, profileId, integrating(state, sessionId))
  if (reasons.length > 0 || !profileId) return { result: refuse("Integrate master refused", reasons, "/calibration"), operationId: null }
  const entry = calibrationSessions(state.catalog).find((c) => c.session.id === sessionId)!
  const profile = state.catalog.profiles[profileId]!
  const payload: IntegratePayload = { sessionId, profileId, frames: entry.source.frameCount ?? 0, done: 0 }
  const operationId = startOperation({
    kind: "integrate-master",
    title: `Integrate ${KIND_LABEL[entry.kind].toLowerCase()} master with ${profile.name}`,
    scope: { sessionIds: [sessionId] },
    total: payload.frames,
    unit: "frames",
    payload: payload as unknown as Record<string, unknown>,
    canCancel: true,
  })
  return { result: { ok: true }, operationId }
}

function masterFileName(kind: CalibrationMaster["kind"], exposureS: number | null, channel: string | null, gain: number | null): string {
  const parts = [`Master${KIND_LABEL[kind].replace(" ", "")}`, exposureS && kind !== "bias" ? formatExposure(exposureS).replace(/\s/g, "") : null, channel, gain !== null ? `G${gain}` : null]
  return `${parts.filter(Boolean).join("_")}.xisf`
}

const integrateStep: OperationHandler = {
  kind: "integrate-master",
  step: (state, op) => {
    const payload = op.payload as unknown as IntegratePayload
    const profile = state.catalog.profiles[payload.profileId]
    if (!profile || profile.executableState !== "found") {
      return settleOperation(state, op.id, "failed", `${profile?.name ?? "The tool profile"} could not be launched; no master was written.`, "/calibration")
    }
    const done = Math.min(payload.frames, payload.done + FRAMES_PER_TICK)
    if (done < payload.frames) {
      return patchOperation(state, op.id, { payload: { ...payload, done } as unknown as Record<string, unknown>, progress: { ...op.progress, done } })
    }
    const entry = calibrationSessions(state.catalog).find((c) => c.session.id === payload.sessionId)
    if (!entry) return settleOperation(state, op.id, "failed", "The calibration session is no longer in the library; no master was written.", "/calibration")
    const { source, kind } = entry
    const folder = `${source.path.split("/").slice(0, -1).join("/")}/Masters`
    const path = `${folder}/${masterFileName(kind, source.exposureS, source.channel, source.gain)}`
    const volumeId = volumeForPath(state.disk, path)
    if (!volumeId || !state.disk.volumes[volumeId]?.mounted) return settleOperation(state, op.id, "failed", `${folder} is offline; no master was written.`, "/calibration")
    const at = nowIso()
    const sha256 = fakeSha256(path, Date.parse(at))
    const file = makeFile({ path, volumeId, sizeBytes: 120_000_000, kind: "xisf", sha256, modifiedAt: at })
    const id: MasterId = `mst_${stableHash(path)}`
    const master: CalibrationMaster = {
      id,
      kind,
      path,
      cameraName: source.cameraName,
      widthPx: source.widthPx ?? 0,
      heightPx: source.heightPx ?? 0,
      binning: source.binning,
      gain: source.gain,
      offset: source.offset,
      exposureS: source.exposureS,
      channel: source.channel,
      opticalTrainId: kind === "flat" ? source.opticalTrainId : null,
      ccdTempC: source.ccdTempC,
      frameCount: source.frameCount,
      createdAt: at,
      state: "adopted",
      origin: { kind: "integrated", runId: null, sourcePath: source.path, sessionId: payload.sessionId },
      adoption: { destinationPath: path, verifiedSha256: sha256, adoptedAt: at },
    }
    const next: PrototypeState = { ...state, disk: writeFiles(state.disk, [file]), catalog: { ...state.catalog, masters: { ...state.catalog.masters, [id]: master } } }
    const settled = patchOperation(next, op.id, { progress: { ...op.progress, done } })
    return settleOperation(settled, op.id, "succeeded", `${fileName(path)} registered from ${plural(payload.frames, "frame")}.`, "/calibration")
  },
}

/** Restore offer (P-CAL2): a dismissed master offer is offered again on the run's Calibrate step. */
export function restoreMasterOffer(runId: RunId, masterId: MasterId): CommitResult {
  const run = store.getState().catalog.runs[runId]
  const offer = run?.masterOffers.find((o) => o.masterId === masterId)
  if (!run || !offer) return refuse("Restore offer refused", ["the offer is no longer recorded"], "/calibration")
  if (offer.state !== "dismissed") return { ok: true }
  return editRun(runId, "Restore master offer", (r) => ({ ...r, masterOffers: r.masterOffers.map((o) => (o.masterId === masterId ? { ...o, state: "pending", at: nowIso() } : o)) }), { step: "calibrate" })
}

export const CALIBRATION_HANDLERS: OperationHandler[] = [integrateStep]
