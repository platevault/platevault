/**
 * Library writes shared by every screen (foundation-owned): library quality
 * (P/X/U, library-wide, P-REJ2; D-W54), Confirm Target and Confirm rig
 * (LIB-FR-05), File into Target for a session imported as Unclassified
 * (P-IMP2) and ★ favourites (D-W60). Catalog only, except File into Target,
 * which moves the session's frames: source headers never change. A session
 * whose frames an unfinished run's prepared view holds keeps its marks (C10).
 */
import { latestRevision, reviewLockGate, sessionNamingValues, unreviewedAssetIds } from "@/domain/derive"
import { fileKey, removeFile, writeFiles } from "@/domain/disk"
import { confirmedEvidence, isUnder } from "@/domain/indexing"
import { type CatalogueEntry, entryKeys, targetFromEntry } from "@/domain/sky"
import { memberState, rejectInContent, sessionRef, unrejectInContent } from "@/domain/membership"
import { namingTemplate, type NamingValues, resolveNamingTemplate } from "@/domain/templates"
import type { Asset, AssetCopy, AssetId, Catalog, CatalogCorrection, IsoDateTime, Location, OpticalTrainId, QualityValue, RunId, Session, SessionId, Target, TargetId } from "@/domain/types"
import { formatCount } from "@/lib/format"
import { type MessageRef, msg, verbatim } from "@/lib/i18n"
import { type CommitResult, commit, nowIso, type PrototypeState, store, withCatalog } from "@/store/core"
import { setProjectRejection } from "./projects"
import { updateRunDraft } from "./runs"
import { freshId, MISSING, recordSaved, refuse, refuseWithGate } from "./shared"

const QUALITY_NAME: Record<QualityValue, MessageRef> = { usable: msg("status_usable"), unusable: msg("status_unusable"), unreviewed: msg("status_unreviewed") }

/**
 * Library quality (P, X, U; PIX-FR-13), the one quality level (P-REJ2). It
 * binds the current bytes and clears Changed content or pending
 * verification. The mark is library-wide (round 6): X takes the frames out of
 * every open run's draft with the reason "Rejected", and P or U restores
 * them (D-W54); saved revisions never change, so a run not yet prepared
 * reads "Inputs changed". Refused for frames of a session an unfinished
 * run's prepared view holds (C10).
 */
export function markFrames(assetIds: AssetId[], value: QualityValue, href: string): CommitResult {
  if (assetIds.length === 0) return { ok: true }
  const at = nowIso()
  const count = assetIds.length
  const label = msg("store_label_mark_frames", { count, n: formatCount(count), quality: QUALITY_NAME[value] })
  const state = store.getState()
  const sessionIds = new Set(assetIds.flatMap((id) => state.catalog.assets[id]?.sessionId ?? []))
  for (const sessionId of sessionIds) {
    const locked = reviewLockGate(state, sessionId)
    if (locked) return refuseWithGate(label, locked, href)
  }
  const result = commit(label, (s) =>
    withCatalog(s, (c) => {
      const assets = { ...c.assets }
      for (const id of assetIds) {
        const asset = assets[id]
        if (asset) assets[id] = { ...asset, quality: { value, decidedAt: value === "unreviewed" ? null : at, basisSha256: value === "unreviewed" ? null : asset.sha256 } }
      }
      return { ...c, assets }
    }),
    { href },
  )
  if (!result.ok) return result
  recordSaved(msg("store_saved_frames_marked", { count, n: formatCount(count), quality: QUALITY_NAME[value] }), msg("store_library_scope_detail"), href)
  const drafts = Object.keys(store.getState().catalog.runs).map((runId) => applyToDraft(runId, assetIds, value === "unusable"))
  return drafts.find((r) => !r.ok) ?? result
}

/** Mark rest usable (C10): every frame of the session still without a decision becomes Usable, so its review can finish. */
export function markRestUsable(sessionId: SessionId): CommitResult {
  const { catalog } = store.getState()
  const session = catalog.sessions[sessionId]
  if (!session) return MISSING
  return markFrames(unreviewedAssetIds(catalog, session), "usable", `/sessions/${sessionId}?step=review`)
}

function applyToDraft(runId: RunId, assetIds: AssetId[], reject: boolean): CommitResult {
  const { catalog } = store.getState()
  const run = catalog.runs[runId]
  if (!run || run.completion === "complete" || run.trashedAt) return { ok: true }
  const content = run.draft ?? latestRevision(run)
  if (!content) return { ok: true }
  // A frame P or U restores only when the library no longer rejects it (D-W54).
  const ids = reject ? assetIds : assetIds.filter((id) => catalog.assets[id]?.quality.value !== "unusable")
  const touches = reject ? ids.some((id) => memberState(content, id) !== null && memberState(content, id) !== "rejected") : ids.some((id) => content.rejected.includes(id))
  if (!touches) return { ok: true }
  return updateRunDraft(runId, reject ? msg("store_label_rejected_in_review") : msg("store_label_unrejected_in_review"), (c, s) => (reject ? rejectInContent(c, ids) : unrejectInContent(s.disk, s.catalog, c, ids)))
}

/**
 * @deprecated P-REJ2 dropped "Reject for this Project only": Reject is
 * library-wide (`markFrames` with "unusable"). Refused, writing nothing; W3
 * removes the caller (d-review/marks.ts) and W4 this function.
 */
export function rejectForProjectOnly(runId: RunId, _assetIds: AssetId[], _rejected: boolean): CommitResult {
  const run = store.getState().catalog.runs[runId]
  if (!run) return MISSING
  return setProjectRejection(run.projectId, _assetIds, _rejected)
}

function correction(session: Session, field: CatalogCorrection["field"], observed: string | null, corrected: string): CatalogCorrection[] {
  if (observed === corrected) return []
  return [{ id: freshId("cor", session.id), field, observedValue: observed, correctedValue: corrected, at: nowIso(), revision: session.revision }]
}

/**
 * The session with `target` confirmed (LIB-FR-05): a user evidence row beside
 * the observed ones, and a correction when it differs from the association.
 * Confirm Target, Import (P-IMP2) and File into Target write it the same way.
 */
export function sessionWithTarget(catalog: Catalog, session: Session, target: Target, at: IsoDateTime): Session {
  const previous = session.target.value ? (catalog.targets[session.target.value]?.name ?? null) : null
  return {
    ...session,
    target: { value: target.id, status: "confirmed", evidence: confirmedEvidence(session.target.evidence, msg("session_confirm_target"), verbatim(target.name)), confirmedAt: at },
    corrections: [...session.corrections, ...correction(session, "target", previous, target.name)],
  }
}

/** Confirm Target (LIB-FR-05): moves the session out of "Needs a Target" (LIB-AC-18). */
export function confirmTarget(sessionId: SessionId, targetId: TargetId, expectRevision: number): CommitResult {
  const { catalog } = store.getState()
  const session = catalog.sessions[sessionId]
  const target = catalog.targets[targetId]
  if (!session || !target) return MISSING
  const href = `/sessions/${sessionId}`
  const at = nowIso()
  const result = commit(
    msg("session_target_for", { name: sessionRef(session) }),
    (s) => withCatalog(s, (c) => ({ ...c, sessions: { ...c.sessions, [sessionId]: sessionWithTarget(c, c.sessions[sessionId]!, target, at) } })),
    { expect: { collection: "sessions", id: sessionId, revision: expectRevision }, href },
  )
  if (result.ok) recordSaved(msg("session_target_confirmed", { name: sessionRef(session) }), msg("store_catalog_only_detail", { name: target.name }), href)
  return result
}

/** One frame copy File into Target moves: from the Unclassified folder to the Target's. */
export interface FilingMove {
  assetId: AssetId
  from: AssetCopy
  to: string
  sizeBytes: number
}

/** The light template's folder under a location for these token values, without a trailing slash. */
function lightFolder(state: PrototypeState, location: Location, values: NamingValues): string {
  const { path } = resolveNamingTemplate(namingTemplate(state.settings.naming, "light"), values)
  return `${location.path.replace(/\/+$/, "")}/${path.replace(/^\/+|\/+$/g, "")}`
}

/**
 * The session's frame copies filed under the Unclassified folder (P-IMP2):
 * live copies in a Captures location whose folder is the light template
 * resolved without a Target, where Import files an Unclassified session.
 */
function unclassifiedCopies(state: PrototypeState, session: Session): Array<{ asset: Asset; copy: AssetCopy; location: Location }> {
  const { catalog } = state
  const folder = (location: Location) => lightFolder(state, location, { ...sessionNamingValues(catalog, session, "light"), target: null })
  return liveAssetIds(catalog, session).flatMap((id) => {
    const asset = catalog.assets[id]!
    return asset.copies.flatMap((copy) => {
      const location = catalog.locations[copy.locationId]
      if (!location || location.role !== "captures" || location.retiredAt) return []
      return copy.path.slice(0, copy.path.lastIndexOf("/")) === folder(location) ? [{ asset, copy, location }] : []
    })
  })
}

/** The session was imported as Unclassified and still waits there: File into Target applies. */
export function filedUnclassified(state: PrototypeState, session: Session): boolean {
  return unclassifiedCopies(state, session).length > 0
}

/** File into Target's moves: each Unclassified copy to the same light template under `targetName`. */
export function filingMoves(state: PrototypeState, session: Session, targetName: string): FilingMove[] {
  const values: NamingValues = { ...sessionNamingValues(state.catalog, session, "light"), target: targetName }
  return unclassifiedCopies(state, session).map(({ asset, copy, location }) => ({ assetId: asset.id, from: copy, to: `${lightFolder(state, location, values)}/${asset.fileName}`, sizeBytes: asset.sizeBytes }))
}

/** Why a move cannot run now, re-checked as it is approved (D19): the source must read as reviewed and the name must be free. */
function filingRefusal(state: PrototypeState, move: FilingMove): MessageRef | null {
  const { disk, catalog } = state
  const volume = disk.volumes[move.from.volumeId]
  if (!volume?.mounted) return msg("run_cleanup_volume_offline", { name: volume?.name ?? msg("wrapup_its_volume") })
  const file = disk.files[fileKey(move.from.volumeId, move.from.path)]
  if (!file) return msg("wrapup_refusal_not_found", { path: move.from.path })
  if (file.sha256 !== catalog.assets[move.assetId]?.sha256) return msg("op_archive_changed", { path: move.from.path })
  if (!volume.writable || disk.readOnlyPaths.some((p) => isUnder(move.from.path, p))) return msg("wrapup_refusal_not_writable", { name: volume.name })
  if (disk.files[fileKey(move.from.volumeId, move.to)]) return msg("wrapup_refusal_file_exists", { path: move.to })
  return null
}

/**
 * File into Target (P-IMP2): one reviewed move of a session imported as
 * Unclassified into `{target}/…`, confirming the Target as Confirm Target
 * does. Every frame moves or none does; prepared links follow (STO-FR-06).
 */
export function fileIntoTarget(sessionId: SessionId, targetId: TargetId, expectRevision: number): CommitResult {
  const state = store.getState()
  const session = state.catalog.sessions[sessionId]
  const target = state.catalog.targets[targetId]
  if (!session || !target) return MISSING
  const href = `/sessions/${sessionId}`
  const label = msg("session_file_into", { name: target.name })
  const moves = filingMoves(state, session, target.name)
  const reasons = moves.map((move) => filingRefusal(state, move)).filter((r): r is MessageRef => r !== null)
  if (reasons.length > 0) return refuse(msg("store_refused", { label }), reasons, href)
  const at = nowIso()
  const result = commit(
    label,
    (s) => {
      let disk = s.disk
      const assets = { ...s.catalog.assets }
      const moved = new Map<string, string>()
      for (const move of moves) {
        const file = disk.files[fileKey(move.from.volumeId, move.from.path)]!
        disk = writeFiles(removeFile(disk, move.from.volumeId, move.from.path), [{ ...file, path: move.to }])
        const asset = assets[move.assetId]!
        assets[move.assetId] = { ...asset, copies: asset.copies.map((c) => (c.volumeId === move.from.volumeId && c.path === move.from.path ? { ...c, path: move.to, lastObservedAt: at } : c)) }
        moved.set(move.from.path, move.to)
      }
      const relinked = Object.values(disk.files).flatMap((f) => (f.linkTarget && moved.has(f.linkTarget) ? [{ ...f, linkTarget: moved.get(f.linkTarget)! }] : []))
      if (relinked.length > 0) disk = writeFiles(disk, relinked)
      const catalog = { ...s.catalog, assets, sessions: { ...s.catalog.sessions, [sessionId]: sessionWithTarget(s.catalog, s.catalog.sessions[sessionId]!, target, at) } }
      return { ...s, disk, catalog }
    },
    { expect: { collection: "sessions", id: sessionId, revision: expectRevision }, href },
  )
  if (result.ok) recordSaved(msg("session_filed_into", { session: sessionRef(session), target: target.name }), msg("session_frames_moved", { count: moves.length, n: formatCount(moves.length) }), href)
  return result
}

/** Confirm rig (Confirm equipment, LIB-FR-05): a detected rig becomes a manual record (D11). */
export function confirmRig(sessionId: SessionId, rigId: OpticalTrainId, expectRevision: number): CommitResult {
  const { catalog } = store.getState()
  const session = catalog.sessions[sessionId]
  const rig = catalog.opticalTrains[rigId]
  if (!session || !rig) return MISSING
  const href = `/sessions/${sessionId}`
  const at = nowIso()
  const result = commit(
    msg("session_rig_for", { name: sessionRef(session) }),
    (s) =>
      withCatalog(s, (c) => {
        const current = c.sessions[sessionId]!
        const previous = current.equipment.value ? (c.opticalTrains[current.equipment.value]?.name ?? null) : null
        const next: Session = {
          ...current,
          equipment: { value: rigId, status: "confirmed", evidence: confirmedEvidence(current.equipment.evidence, msg("session_confirm_rig"), verbatim(rig.name)), confirmedAt: at },
          corrections: [...current.corrections, ...correction(current, "equipment", previous, rig.name)],
        }
        const record = c.opticalTrains[rigId]!
        const opticalTrains = record.source === "detected" ? { ...c.opticalTrains, [rigId]: { ...record, source: "manual" as const } } : c.opticalTrains
        return { ...c, opticalTrains, sessions: { ...c.sessions, [sessionId]: next } }
      }),
    { expect: { collection: "sessions", id: sessionId, revision: expectRevision }, href },
  )
  if (result.ok) recordSaved(msg("session_rig_confirmed", { name: sessionRef(session) }), msg("store_catalog_only_detail", { name: rig.name }), href)
  return result
}

/** ★ toggles My targets membership (D-W60); open-Project subjects stay listed either way. */
export function setFavourite(targetId: TargetId, favourite: boolean): CommitResult {
  const target = store.getState().catalog.targets[targetId]
  if (!target) return MISSING
  const href = `/targets/${targetId}`
  const result = commit(
    favourite ? msg("store_label_add_to_my_targets", { name: target.name }) : msg("store_label_remove_from_my_targets", { name: target.name }),
    (s) => withCatalog(s, (c) => ({ ...c, targets: { ...c.targets, [targetId]: { ...c.targets[targetId]!, favourite } } })),
    { expect: { collection: "targets", id: targetId, revision: target.revision }, href },
  )
  if (result.ok) recordSaved(verbatim(favourite ? `★ ${target.name}` : `☆ ${target.name}`), null, href)
  return result
}

/**
 * Add a catalogue or resolver entry to the library as a Target (PRJ-FR-05,
 * PLAN-TGT-FR-03): an existing Target with one of its names is reused (and
 * starred when `favourite`), else a new record is written. New Project's
 * subject search and the Targets screen both add Targets through here.
 */
export function addTarget(entry: CatalogueEntry, options: { resolver: string | null; favourite: boolean }): { result: CommitResult; targetId: TargetId | null } {
  const keys = new Set(entryKeys(entry))
  const existing = Object.values(store.getState().catalog.targets).find((t) => entryKeys({ designation: t.name, aliases: t.aliases }).some((k) => keys.has(k)))
  if (existing) return { result: options.favourite && !existing.favourite ? setFavourite(existing.id, true) : { ok: true }, targetId: existing.id }
  const id = freshId("tgt", entry.designation)
  const target = targetFromEntry(entry, { id, at: nowIso(), resolver: options.resolver, favourite: options.favourite })
  const href = `/targets/${id}`
  const result = commit(
    options.favourite ? msg("store_label_add_to_my_targets", { name: entry.designation }) : msg("targets_add_named", { name: entry.designation }),
    (s) => withCatalog(s, (c) => ({ ...c, targets: { ...c.targets, [id]: target } })),
    { href },
  )
  if (result.ok) {
    const source = options.resolver
      ? msg("store_target_from_resolver", { resolver: options.resolver })
      : entry.catalogues.length > 0
        ? msg("store_target_from_bundled", { catalogues: entry.catalogues.join(", ") })
        : msg("store_target_from_reference")
    recordSaved(options.favourite ? msg("store_saved_added_to_my_targets", { name: entry.designation }) : msg("store_saved_target_added", { name: entry.designation }), source, href)
  }
  return { result, targetId: result.ok ? id : null }
}
