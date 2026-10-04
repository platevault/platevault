/**
 * Verified transfers: archive (STO-FR-06..08, J28) and reviewed filing
 * (STO-FR-09, D14, J30). The plan is derived from the disk and catalog; the
 * operation journals every item's phase in its payload (D06), so Retry
 * resumes recorded work and never infers progress from file names.
 */
import { fileAt, fileKey, freeBytes, makeFile, removeFile, volumeForPath, writeFiles } from "@/domain/disk"
import { isUnder } from "@/domain/indexing"
import type {
  Asset,
  AssetId,
  Catalog,
  Disk,
  Location,
  Operation,
  OperationItem,
  Session,
  SessionId,
  View,
  ViewId,
  Volume,
  VolumeId,
} from "@/domain/types"
import { formatBytes, formatDateTime, formatNight } from "@/lib/format"
import { nowIso, type PrototypeState } from "@/store/core"
import { patchOperation, settleOperation } from "@/store/operations"
import { baseName, type EntryKind, latestPreparation, parentFolder, preparedEntries } from "./files"

export type TransferKind = "archive" | "filing"
export type ReferenceChoice = "symlink" | "keep-local"

/** Track-local plan draft kept in the T5 slice. */
export interface TransferDraft {
  sessionIds: SessionId[]
  destination: string | null
  /** Volume identity recorded when the destination was chosen (D06, D11). */
  intendedVolumeUuid: string | null
  referenceModes: Record<ViewId, ReferenceChoice>
  stage: "plan" | "review"
  /** Prototype fault (J28 P5): hold this asset after verification, before retirement. */
  holdAssetId: AssetId | null
  /** Source SHA-256 per item, frozen when Review opened. Approval runs against these, so a source changed after review is blocked (STO-AC-15). */
  reviewedShas: Record<AssetId, string> | null
}

export function emptyDraft(): TransferDraft {
  return { sessionIds: [], destination: null, intendedVolumeUuid: null, referenceModes: {}, stage: "plan", holdAssetId: null, reviewedShas: null }
}

export interface PlanItem {
  assetId: AssetId
  sessionId: SessionId
  fileName: string
  sourcePath: string
  sourceVolumeId: VolumeId
  sourceInode: number
  sha256: string
  sizeBytes: number
  destinationPath: string
  /** Why this item cannot be planned right now. */
  problem: string | null
  collision: boolean
}

export interface ReferencePlan {
  viewId: ViewId
  viewName: string
  /** Current mode of the affected entries. */
  mode: EntryKind | "direct-source"
  entries: Array<{ assetId: AssetId; entryPath: string }>
  needsChoice: boolean
  choice: ReferenceChoice | null
  effect: string
}

export type VolumeState = "not-chosen" | "ok" | "offline" | "different-volume" | "read-only" | "unregistered" | "insufficient-space"

export interface TransferPlan {
  kind: TransferKind
  sessions: Session[]
  items: PlanItem[]
  bytes: number
  destination: string | null
  volume: Volume | null
  volumeState: VolumeState
  volumeMessage: string
  location: Location | null
  freeBytes: number | null
  sameVolume: boolean
  references: ReferencePlan[]
  /** Every View whose members the transfer moves (Mark complete waits, D09). */
  affectedViews: View[]
  collisions: PlanItem[]
  blockers: string[]
  expectedReclaimBytes: number
}

const SAFE_SEGMENT = /[/\\:]/g

function sessionTargetName(catalog: Catalog, session: Session): string {
  const targetId = session.target.value
  return (targetId && catalog.targets[targetId]?.name) || session.objectLabel || "Unassigned Target"
}

/** Destination layout: archive keeps night/folder; filing uses Target/night/channel (D14). Basenames never change. */
export function destinationFor(kind: TransferKind, catalog: Catalog, destination: string, session: Session, sourcePath: string): string {
  const name = baseName(sourcePath)
  if (kind === "archive") return `${destination}/${session.night}/${baseName(parentFolder(sourcePath))}/${name}`
  const target = sessionTargetName(catalog, session).replace(SAFE_SEGMENT, "-")
  return `${destination}/${target}/${session.night}/${(session.channel ?? "No filter").replace(SAFE_SEGMENT, "-")}/${name}`
}

/** The copy to move: online, present, and not already at the destination. */
function sourceCopy(disk: Disk, asset: Asset, destination: string | null) {
  for (const copy of asset.copies) {
    if (copy.presence === "absent" || (destination && isUnder(copy.path, destination))) continue
    const volume = disk.volumes[copy.volumeId]
    if (!volume?.mounted) continue
    const file = disk.files[fileKey(copy.volumeId, copy.path)]
    if (file) return { copy, file }
  }
  return null
}

function locationFor(catalog: Catalog, disk: Disk, path: string): Location | null {
  const volumeId = volumeForPath(disk, path)
  return (
    Object.values(catalog.locations)
      .filter((l) => l.volumeId === volumeId && isUnder(path, l.path))
      .sort((a, b) => b.path.length - a.path.length)[0] ?? null
  )
}

export function transferPlan(disk: Disk, catalog: Catalog, kind: TransferKind, draft: TransferDraft): TransferPlan {
  const sessions = draft.sessionIds.map((id) => catalog.sessions[id]).filter((s): s is Session => s !== undefined)
  const destination = draft.destination
  const volumeId = destination ? volumeForPath(disk, destination) : null
  const volume = volumeId ? (disk.volumes[volumeId] ?? null) : null
  const location = destination ? locationFor(catalog, disk, destination) : null

  const items: PlanItem[] = []
  const seenDestinations = new Set<string>()
  for (const session of sessions) {
    for (const assetId of session.assetIds) {
      const asset = catalog.assets[assetId]
      if (!asset) continue
      const found = sourceCopy(disk, asset, destination)
      const anyCopy = asset.copies[0]
      const sourcePath = found?.copy.path ?? anyCopy?.path ?? asset.fileName
      const destinationPath = destination ? destinationFor(kind, catalog, destination, session, sourcePath) : ""
      let problem: string | null = null
      if (!found) {
        const offline = asset.copies.find((c) => !disk.volumes[c.volumeId]?.mounted)
        problem = offline
          ? `${disk.volumes[offline.volumeId]?.name ?? "Its volume"} is offline: this frame cannot be read now.`
          : "No present copy of this frame was found."
      }
      const occupied = destination && volume?.mounted ? Boolean(disk.files[fileKey(volume.id, destinationPath)]) : false
      const collision = occupied || (destinationPath !== "" && seenDestinations.has(destinationPath))
      if (destinationPath) seenDestinations.add(destinationPath)
      items.push({
        assetId,
        sessionId: session.id,
        fileName: asset.fileName,
        sourcePath,
        sourceVolumeId: found?.file.volumeId ?? anyCopy?.volumeId ?? "",
        sourceInode: found?.file.inode ?? 0,
        sha256: found?.file.sha256 ?? asset.sha256,
        sizeBytes: found?.file.sizeBytes ?? asset.sizeBytes,
        destinationPath,
        problem,
        collision,
      })
    }
  }
  const bytes = items.reduce((sum, i) => sum + i.sizeBytes, 0)
  const sameVolume = Boolean(volume && items.length > 0 && items.every((i) => i.sourceVolumeId === volume.id))

  // Affected Views: every View whose latest membership includes a moved frame.
  const moved = new Set(items.map((i) => i.assetId))
  const affectedViews = Object.values(catalog.views).filter((v) => (v.revisions.at(-1)?.included ?? []).some((id) => moved.has(id)))
  const references: ReferencePlan[] = []
  for (const view of affectedViews) {
    const preparation = latestPreparation(catalog, view.id)
    if (!preparation) continue
    if (preparation.mode === "direct-source") {
      const entries = preparation.preparedAssetIds.filter((id) => moved.has(id)).map((id) => ({ assetId: id, entryPath: `${preparation.viewPath}/platevault-handoff.txt` }))
      if (entries.length > 0) {
        references.push({
          viewId: view.id,
          viewName: view.name,
          mode: "direct-source",
          entries,
          needsChoice: false,
          choice: null,
          effect: "Direct-source configuration paths are updated to the new locations; each reports its own status.",
        })
      }
      continue
    }
    const entries = preparedEntries(disk, catalog, preparation).filter((e) => e.assetId && moved.has(e.assetId))
    if (entries.length === 0) continue
    const kinds = new Set(entries.map((e) => e.kind))
    const mode: EntryKind = kinds.has("hardlink") ? "hardlink" : kinds.has("symlink") ? "symlink" : "copy"
    const crossVolume = !sameVolume
    const needsChoice = mode === "hardlink" && crossVolume
    const choice = needsChoice ? (draft.referenceModes[view.id] ?? null) : null
    const effect =
      mode === "symlink"
        ? "Symlink entries are rebuilt to point at the new paths. Their targets are never followed."
        : mode === "copy"
          ? "Copy entries hold their own bytes and stay unchanged."
          : !crossVolume
            ? "Hardlink entries keep working after a same-volume move and stay unchanged."
            : choice === "symlink"
              ? "Each hardlink entry is replaced by a symlink to the transferred file."
              : choice === "keep-local"
                ? "Hardlink entries stay; their bytes remain on the source volume and are not reclaimed."
                : "A hardlink cannot be rebuilt across volumes. Choose a supported reference mode or keep the local copy."
    references.push({
      viewId: view.id,
      viewName: view.name,
      mode,
      entries: entries.map((e) => ({ assetId: e.assetId!, entryPath: e.file.path })),
      needsChoice,
      choice,
      effect,
    })
  }

  const free = volume?.mounted ? freeBytes(disk, volume.id) : null
  let volumeState: VolumeState = "ok"
  let volumeMessage = ""
  if (!destination) {
    volumeState = "not-chosen"
    volumeMessage = "Choose a destination folder."
  } else if (!volume?.mounted) {
    volumeState = "offline"
    volumeMessage = `No volume is mounted at ${destination}. Connect the destination volume.`
  } else if (draft.intendedVolumeUuid && volume.volumeUuid !== draft.intendedVolumeUuid) {
    volumeState = "different-volume"
    volumeMessage = `Different volume at ${volume.mountPath}: identity ${volume.volumeUuid} does not match ${draft.intendedVolumeUuid}, chosen for this plan. Approval is blocked. Mount the intended volume, or choose the destination again.`
  } else if (!volume.writable || disk.readOnlyPaths.some((p) => isUnder(destination, p))) {
    volumeState = "read-only"
    volumeMessage = `${destination} is not writable.`
  } else if (!location || (kind === "filing" && !location.managed)) {
    volumeState = "unregistered"
    volumeMessage =
      kind === "filing"
        ? `${destination} is not inside a location that accepts reviewed filing. Mark a Captures location "Accepts reviewed filing" in Settings › Locations.`
        : `${destination} is not inside a registered location, so PlateVault could not track the archived copies. Register it in Settings › Locations.`
  } else if (!sameVolume && free !== null && free < bytes) {
    volumeState = "insufficient-space"
    volumeMessage = `${formatBytes(free)} free on ${volume.name}; this transfer needs ${formatBytes(bytes)}.`
  }

  const collisions = items.filter((i) => i.collision)
  const blockers: string[] = []
  if (sessions.length === 0) blockers.push("Choose at least one session.")
  if (volumeState !== "ok") blockers.push(volumeMessage)
  const unavailable = items.filter((i) => i.problem)
  if (unavailable.length > 0) {
    const bySession = new Set(unavailable.map((i) => i.sessionId))
    blockers.push(
      `${unavailable.length} ${unavailable.length === 1 ? "frame is" : "frames are"} unavailable (${[...bySession]
        .map((id) => formatNight(catalog.sessions[id]?.night ?? ""))
        .join(", ")}). Remove ${bySession.size === 1 ? "that session" : "those sessions"} or reconnect the volume.`,
    )
  }
  if (collisions.length > 0) {
    blockers.push(
      `${collisions.length} destination ${collisions.length === 1 ? "path already exists" : "paths already exist"}. Nothing is overwritten: choose another destination or remove the colliding session from this plan.`,
    )
  }
  for (const ref of references) if (ref.needsChoice && !ref.choice) blockers.push(`Choose how ${ref.viewName} references are rebuilt.`)

  const keptLocal = new Set(references.filter((r) => r.choice === "keep-local").flatMap((r) => r.entries.map((e) => e.assetId)))
  const expectedReclaimBytes = sameVolume ? 0 : items.filter((i) => !keptLocal.has(i.assetId)).reduce((sum, i) => sum + i.sizeBytes, 0)

  return {
    kind,
    sessions,
    items,
    bytes,
    destination,
    volume,
    volumeState,
    volumeMessage,
    location,
    freeBytes: free,
    sameVolume,
    references,
    affectedViews,
    collisions,
    blockers,
    expectedReclaimBytes,
  }
}

// ---------------------------------------------------------------------------
// Execution journal (operation payload)
// ---------------------------------------------------------------------------

export type TransferPhase = "pending" | "copied" | "written" | "verified" | "referenced" | "retired"

export const PHASE_LABEL: Record<TransferPhase, string> = {
  pending: "Pending",
  copied: "Copied",
  written: "Durably written",
  verified: "Destination verified",
  referenced: "Reference updated",
  retired: "Source retired",
}

export type ReferenceAction = "rebuild-symlink" | "keep-local" | "unchanged" | "update-config"
export type ReferenceStatus = "pending" | "completed" | "blocked" | "uncertain"

export interface ReferenceRecord {
  viewId: ViewId
  entryPath: string
  action: ReferenceAction
  status: ReferenceStatus
  detail: string | null
}

export interface TransferRecord {
  id: string
  assetId: AssetId
  sessionId: SessionId
  fileName: string
  sourcePath: string
  sourceVolumeId: VolumeId
  sourceInode: number
  /** Content identity at review. */
  planSha: string
  /** Snapshot of the source bytes copied to the destination. */
  snapshotSha: string | null
  sizeBytes: number
  destinationPath: string
  phase: TransferPhase
  /** Whether the destination file was written by this transfer (never someone else's file). */
  wroteDestination: boolean
  blocked: { reason: string; kind: "reference" | "drift" | "hash" | "collision" | "source"; at: TransferPhase } | null
  uncertain: string | null
  references: ReferenceRecord[]
}

export interface TransferPayload {
  kind: TransferKind
  destination: string
  destinationVolumeId: VolumeId
  destinationVolumeUuid: string
  destinationLocationId: string
  sameVolume: boolean
  records: TransferRecord[]
  holdAssetId: AssetId | null
  held: boolean
  expectedReclaimBytes: number
  observedReclaimBytes: number
  lastStepAt: string | null
  revalidated: string | null
}

export function buildPayload(plan: TransferPlan, draft: TransferDraft): TransferPayload {
  const refsByAsset = new Map<AssetId, ReferenceRecord[]>()
  for (const ref of plan.references) {
    const action: ReferenceAction =
      ref.mode === "direct-source"
        ? "update-config"
        : ref.mode === "symlink"
          ? "rebuild-symlink"
          : ref.mode === "hardlink" && !plan.sameVolume
            ? ref.choice === "symlink"
              ? "rebuild-symlink"
              : "keep-local"
            : "unchanged"
    for (const entry of ref.entries) {
      const list = refsByAsset.get(entry.assetId) ?? []
      list.push({ viewId: ref.viewId, entryPath: entry.entryPath, action, status: "pending", detail: null })
      refsByAsset.set(entry.assetId, list)
    }
  }
  return {
    kind: plan.kind,
    destination: plan.destination!,
    destinationVolumeId: plan.volume!.id,
    destinationVolumeUuid: plan.volume!.volumeUuid,
    destinationLocationId: plan.location!.id,
    sameVolume: plan.sameVolume,
    records: plan.items.map((item) => ({
      id: item.assetId,
      assetId: item.assetId,
      sessionId: item.sessionId,
      fileName: item.fileName,
      sourcePath: item.sourcePath,
      sourceVolumeId: item.sourceVolumeId,
      sourceInode: item.sourceInode,
      planSha: draft.reviewedShas?.[item.assetId] ?? item.sha256,
      snapshotSha: null,
      sizeBytes: item.sizeBytes,
      destinationPath: item.destinationPath,
      phase: "pending",
      wroteDestination: false,
      blocked: null,
      uncertain: null,
      references: refsByAsset.get(item.assetId) ?? [],
    })),
    holdAssetId: draft.holdAssetId,
    held: false,
    expectedReclaimBytes: plan.expectedReclaimBytes,
    observedReclaimBytes: 0,
    lastStepAt: null,
    revalidated: null,
  }
}

export function isTerminal(record: TransferRecord): boolean {
  return record.phase === "retired" || record.blocked !== null
}

/** `live` is false while the transfer is paused, interrupted or settled: an unfinished item is then waiting, not running. */
export function recordStatus(record: TransferRecord, live: boolean): OperationItem["status"] {
  if (record.blocked) return "blocked"
  if (record.phase === "retired") return "done"
  if (record.uncertain) return "uncertain"
  if (record.phase === "pending" || !live) return "pending"
  return "running"
}

function toItems(records: TransferRecord[], live: boolean): OperationItem[] {
  return records.map((r) => ({
    id: r.id,
    label: r.fileName,
    path: r.sourcePath,
    status: recordStatus(r, live),
    phase: PHASE_LABEL[r.phase],
    detail: r.blocked?.reason ?? r.uncertain ?? null,
  }))
}

const PARTIAL_PREFIX = "partial"

function patchAsset(state: PrototypeState, assetId: AssetId, update: (asset: Asset) => Asset): PrototypeState {
  const asset = state.catalog.assets[assetId]
  if (!asset) return state
  return { ...state, catalog: { ...state.catalog, assets: { ...state.catalog.assets, [assetId]: update(asset) } } }
}

function writeDisk(state: PrototypeState, disk: Disk): PrototypeState {
  return { ...state, disk }
}

function readOnly(disk: Disk, path: string): boolean {
  return disk.readOnlyPaths.some((p) => isUnder(path, p))
}

/** Rebuild or check the references of one record; returns the next state and the updated record. */
function updateReferences(state: PrototypeState, record: TransferRecord): { state: PrototypeState; record: TransferRecord } {
  let next = state
  const references = record.references.map((ref): ReferenceRecord => {
    if (ref.status === "completed") return ref
    if (ref.action === "keep-local") return { ...ref, status: "completed", detail: "Local hardlink kept; its bytes are not reclaimed." }
    if (ref.action === "unchanged") return { ...ref, status: "completed", detail: "Unchanged: this entry keeps working after the move." }
    const entryVolume = volumeForPath(next.disk, ref.entryPath)
    if (!entryVolume || !next.disk.volumes[entryVolume]?.mounted) {
      return { ...ref, status: "uncertain", detail: "The View folder is offline; this reference could not be checked." }
    }
    if (readOnly(next.disk, ref.entryPath)) {
      return { ...ref, status: "blocked", detail: `Write permission removed at ${ref.entryPath}; the reference cannot be rebuilt.` }
    }
    if (ref.action === "update-config") return { ...ref, status: "completed", detail: "Configuration path updated." }
    const existing = fileAt(next.disk, ref.entryPath)
    let disk = existing ? removeFile(next.disk, existing.volumeId, ref.entryPath) : next.disk
    disk = writeFiles(disk, [
      makeFile({ path: ref.entryPath, volumeId: entryVolume, sizeBytes: 0, kind: existing?.kind ?? "fits", linkTarget: record.destinationPath, modifiedAt: nowIso() }),
    ])
    next = writeDisk(next, disk)
    return { ...ref, status: "completed", detail: `Rebuilt as a symlink to ${record.destinationPath}.` }
  })
  return { state: next, record: { ...record, references } }
}

/** References still pass immediately before retirement (D06). */
function referencesPass(disk: Disk, record: TransferRecord): boolean {
  return record.references.every((ref) => {
    if (ref.action !== "rebuild-symlink") return ref.status === "completed"
    const entry = fileAt(disk, ref.entryPath)
    return ref.status === "completed" && entry?.linkTarget === record.destinationPath
  })
}

const STEP_BUDGET = 10

/** One tick of an archive or filing transfer. */
export function stepTransfer(state: PrototypeState, op: Operation): PrototypeState {
  const payload = op.payload as unknown as TransferPayload
  const now = nowIso()
  let next = state
  let records = payload.records.map((r) => ({ ...r }))
  let { held, observedReclaimBytes, revalidated } = payload
  const resumed = !payload.lastStepAt || Date.parse(now) - Date.parse(payload.lastStepAt) > 1_500
  const destVolume = next.disk.volumes[payload.destinationVolumeId]
  const mountedId = volumeForPath(next.disk, payload.destination)
  const mounted = mountedId ? next.disk.volumes[mountedId] : undefined
  const href = `/storage/transfers/${op.id}`

  const persist = (patch: Partial<TransferPayload>, opPatch: Partial<Operation> = {}) => {
    const done = records.filter(isTerminal).length
    return patchOperation(next, op.id, {
      ...opPatch,
      items: toItems(records, (opPatch.status ?? op.status) === "running"),
      progress: { done, total: records.length, unit: "files" },
      payload: { ...payload, records, held, observedReclaimBytes, revalidated, lastStepAt: now, ...patch } as unknown as Record<string, unknown>,
    })
  }

  // The destination must be the volume chosen at review (D06, D11).
  if (!destVolume?.mounted || (mounted && mounted.volumeUuid !== payload.destinationVolumeUuid)) {
    records = records.map((r) =>
      !isTerminal(r) && (r.phase === "copied" || r.phase === "written")
        ? { ...r, uncertain: "Destination not verified. On Retry it is copied and verified again; its name alone proves nothing." }
        : r,
    )
    const retained = records.filter((r) => r.phase !== "retired").length
    const verified = records.filter((r) => !r.blocked && (r.phase === "verified" || r.phase === "referenced")).length
    // A Retry that finds the volume still missing says so, instead of silently re-reading the same summary.
    const retried = resumed && payload.lastStepAt !== null ? `Retry at ${formatDateTime(now)} found the destination still unavailable. ` : ""
    const why =
      mounted && mounted.volumeUuid !== payload.destinationVolumeUuid
        ? `${retried}A different volume is mounted at ${mounted.mountPath} (identity ${mounted.volumeUuid}, expected ${payload.destinationVolumeUuid}).`
        : `${retried}${destVolume?.name ?? "The destination"} ${retried ? "is still disconnected" : "disconnected during the transfer"}.`
    return persist({}, {
      status: "interrupted",
      summary: `${why} ${verified} ${verified === 1 ? "item keeps" : "items keep"} a verified destination; ${retained} ${retained === 1 ? "source is" : "sources are"} retained. Retry revalidates the volume identity and each recorded item before resuming.`,
    })
  }

  // After a pause, an interruption or a restart: revalidate the recorded items before continuing.
  if (resumed) {
    records = records.map((r) => {
      if (isTerminal(r)) return r
      if (r.phase === "copied" || r.phase === "written") return { ...r, phase: "pending", uncertain: null, snapshotSha: null }
      if (r.phase === "pending") {
        const source = fileAt(next.disk, r.sourcePath)
        if (!source || source.sha256 !== r.planSha) {
          return { ...r, blocked: { reason: "Source changed or missing since review; it is retained for review.", kind: "source", at: "pending" } }
        }
      }
      return r
    })
    revalidated = `Revalidated ${destVolume.name} identity ${destVolume.volumeUuid} and ${records.filter((r) => !isTerminal(r)).length} recorded items at ${formatDateTime(now)}.`
  }

  let budget = STEP_BUDGET
  for (let index = 0; index < records.length && budget > 0; index += 1) {
    let record = records[index]!
    if (isTerminal(record)) continue
    budget -= 1
    const disk = next.disk
    if (record.phase === "pending") {
      const source = fileAt(disk, record.sourcePath)
      if (!source || source.sha256 !== record.planSha) {
        record = { ...record, blocked: { reason: "Source changed or missing since review; it is retained for review.", kind: "source", at: "pending" } }
      } else {
        const existing = disk.files[fileKey(payload.destinationVolumeId, record.destinationPath)]
        if (existing && !record.wroteDestination) {
          record = {
            ...record,
            blocked: { reason: `${record.destinationPath} already exists. Nothing was overwritten; the source is retained.`, kind: "collision", at: "pending" },
          }
        } else if (readOnly(disk, record.destinationPath)) {
          record = { ...record, blocked: { reason: `Cannot write ${record.destinationPath}: write permission removed. Source retained.`, kind: "collision", at: "pending" } }
        } else {
          // Copy a snapshot of the source; the bytes are not final until durably written.
          const copy = makeFile({
            path: record.destinationPath,
            volumeId: payload.destinationVolumeId,
            sizeBytes: source.sizeBytes,
            kind: source.kind,
            header: source.header,
            pixelTruth: source.pixelTruth,
            sha256: `${PARTIAL_PREFIX}${source.sha256.slice(PARTIAL_PREFIX.length)}`,
            inode: payload.sameVolume ? source.inode : undefined,
            modifiedAt: now,
          })
          next = writeDisk(next, writeFiles(disk, [copy]))
          record = { ...record, phase: "copied", snapshotSha: source.sha256, wroteDestination: true, uncertain: null }
        }
      }
    } else if (record.phase === "copied") {
      const written = fileAt(disk, record.destinationPath)
      if (written) next = writeDisk(next, writeFiles(disk, [{ ...written, sha256: record.snapshotSha! }]))
      record = { ...record, phase: "written" }
    } else if (record.phase === "written") {
      const written = disk.files[fileKey(payload.destinationVolumeId, record.destinationPath)]
      if (next.faults.failNextHashVerification) {
        next = { ...next, faults: { ...next.faults, failNextHashVerification: false } }
        record = { ...record, blocked: { reason: "Destination hash does not match the source snapshot. The source is retained.", kind: "hash", at: "pending" } }
      } else if (!written || written.sha256 !== record.snapshotSha) {
        record = { ...record, blocked: { reason: "Destination re-read did not match the source snapshot. The source is retained.", kind: "hash", at: "pending" } }
      } else {
        const location = next.catalog.locations[payload.destinationLocationId]
        next = patchAsset(next, record.assetId, (asset) =>
          asset.copies.some((c) => c.volumeId === payload.destinationVolumeId && c.path === record.destinationPath)
            ? asset
            : {
                ...asset,
                copies: [
                  ...asset.copies,
                  {
                    locationId: location?.id ?? payload.destinationLocationId,
                    volumeId: payload.destinationVolumeId,
                    path: record.destinationPath,
                    sha256: record.snapshotSha!,
                    presence: "observed",
                    lastObservedAt: now,
                  },
                ],
              },
        )
        record = { ...record, phase: "verified" }
      }
    } else if (record.phase === "verified") {
      const updated = updateReferences(next, record)
      next = updated.state
      record = updated.record
      const blocked = record.references.find((r) => r.status === "blocked")
      const uncertain = record.references.find((r) => r.status === "uncertain")
      if (blocked) record = { ...record, blocked: { reason: `Reference blocked: ${blocked.detail} Source retained.`, kind: "reference", at: "verified" } }
      else if (uncertain) record = { ...record, blocked: { reason: `Reference uncertain: ${uncertain.detail} Source retained.`, kind: "reference", at: "verified" } }
      else record = { ...record, phase: "referenced" }
    } else if (record.phase === "referenced") {
      if (payload.holdAssetId === record.assetId && !held) {
        held = true
        records[index] = record
        return persist({}, {
          status: "paused",
          summary: `Held by the prototype control: ${record.fileName} is destination-verified and awaiting source retirement. Change its source in Prototype controls if you want, then Resume.`,
        })
      }
      // Immediately before retirement: source still the snapshot, destination and references re-verify (D06).
      const source = fileAt(disk, record.sourcePath)
      const destination = disk.files[fileKey(payload.destinationVolumeId, record.destinationPath)]
      if (!source || source.sha256 !== record.snapshotSha || source.inode !== record.sourceInode) {
        record = {
          ...record,
          blocked: {
            reason: `Source drift: ${record.sourcePath} no longer matches the snapshot copied and verified at ${record.destinationPath}. Both versions are kept for review; neither is retired.`,
            kind: "drift",
            at: "referenced",
          },
        }
      } else if (!destination || destination.sha256 !== record.snapshotSha) {
        record = { ...record, blocked: { reason: "Destination re-verification failed before retirement. The source is retained.", kind: "hash", at: "verified" } }
      } else if (!referencesPass(disk, record)) {
        record = { ...record, blocked: { reason: "A rebuilt reference no longer points at the transferred file. The source is retained.", kind: "reference", at: "verified" } }
      } else {
        const nextDisk = removeFile(disk, source.volumeId, source.path)
        const stillHeld = Object.values(nextDisk.files).some((f) => f.volumeId === source.volumeId && f.inode === source.inode && !f.linkTarget)
        if (!stillHeld && !payload.sameVolume) observedReclaimBytes += source.sizeBytes
        next = writeDisk(next, nextDisk)
        next = patchAsset(next, record.assetId, (asset) => ({
          ...asset,
          copies: asset.copies.map((c) => (c.volumeId === source.volumeId && c.path === source.path ? { ...c, presence: "absent", lastObservedAt: now } : c)),
        }))
        record = { ...record, phase: "retired" }
      }
    }
    records[index] = record
  }

  if (records.every(isTerminal)) {
    const retired = records.filter((r) => r.phase === "retired").length
    const blocked = records.filter((r) => r.blocked)
    const reasons = (["reference", "drift", "hash", "collision", "source"] as const)
      .map((kind) => ({ kind, count: blocked.filter((r) => r.blocked!.kind === kind).length }))
      .filter((x) => x.count > 0)
      .map((x) => `${x.count} ${{ reference: "reference blocked", drift: "source drift", hash: "hash mismatch", collision: "collision", source: "source changed" }[x.kind]}`)
    const verb = payload.kind === "archive" ? "sources retired after verification" : "files filed after verification"
    const reclaim = payload.sameVolume
      ? "Same-volume move: no space is reclaimed."
      : `Expected reclaim ${formatBytes(payload.expectedReclaimBytes)}; observed ${formatBytes(observedReclaimBytes)}.`
    const summary =
      blocked.length === 0
        ? `All ${retired} ${verb}. ${reclaim}`
        : `${retired > 0 ? "Partial" : "Blocked"}: ${retired} ${verb}, ${blocked.length} blocked (${reasons.join(", ")}). Blocked sources are retained. ${reclaim}`
    next = persist({})
    return settleOperation(next, op.id, blocked.length === 0 ? "succeeded" : retired > 0 ? "partial" : "failed", summary, href)
  }
  return persist({}, resumed && revalidated ? { summary: revalidated } : {})
}

/** Retry blocked items from their recorded phase (S9, S9a). Drift items re-check the current source. */
export function retryRecords(state: PrototypeState, opId: string, ids: string[]): PrototypeState {
  const op = state.operations[opId]
  if (!op) return state
  const payload = op.payload as unknown as TransferPayload
  const records = payload.records.map((r) =>
    ids.includes(r.id) && r.blocked
      ? {
          ...r,
          phase: r.blocked.at,
          blocked: null,
          uncertain: null,
          references: r.references.map((ref) => (ref.status === "completed" ? ref : { ...ref, status: "pending" as const, detail: null })),
        }
      : r,
  )
  return patchOperation(state, opId, {
    status: "running",
    summary: null,
    settledAt: null,
    items: toItems(records, true),
    payload: { ...payload, records, lastStepAt: null } as unknown as Record<string, unknown>,
  })
}

export function transferTitle(kind: TransferKind, plan: TransferPlan): string {
  const nights = plan.sessions.map((s) => formatNight(s.night)).join(", ")
  return kind === "archive" ? `Archive ${nights} to ${plan.destination}` : `File ${nights} into ${plan.destination}`
}
