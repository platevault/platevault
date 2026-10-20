/**
 * Library writes shared by every screen (foundation-owned): library quality
 * (P/X/U, library-wide, P-REJ2; D-W54), Confirm Target and Confirm rig
 * (LIB-FR-05), File into Target for a session imported as Unclassified
 * (P-IMP2), a regrouping correction that may re-split a session (LIB-FR-12),
 * Finish review on a session a re-split reset (D-W100), a session's Edit…
 * (its name and notes, D-W76) and ★ favourites
 * (D-W60). Catalog only, except File into Target, which moves the session's
 * frames: source headers never change. A Project reads these writes as
 * pending changes from the Library on its next Apply (VSEL-FR-12); a Closed
 * Project reads its Close snapshot and never changes.
 */
import { calibrateSessions } from "@/domain/calibration"
import { correctedExposureS } from "@/domain/corrections"
import { isLocked, isTrashedSession, liveAssetIds, sessionNamingValues, unreviewedAssetIds } from "@/domain/derive"
import { fileKey, removeFile, writeFiles } from "@/domain/disk"
import { capturedRigVersionId, confirmedEvidence, isUnder, type RegroupField, resplitSession } from "@/domain/indexing"
import { type CatalogueEntry, entryKeys, targetFromEntry } from "@/domain/sky"
import { sessionDefaultRef, sessionRef } from "@/domain/membership"
import { namingTemplate, type NamingValues, resolveNamingTemplate } from "@/domain/templates"
import type { Asset, AssetCopy, AssetId, Catalog, CatalogCorrection, IsoDateTime, Location, OpticalTrainId, QualityValue, Session, SessionId, Target, TargetId } from "@/domain/types"
import { type MessageRef, msg, verbatim } from "@/lib/i18n"
import { type CommitResult, commit, nowIso, type PrototypeState, store, withCatalog } from "@/store/core"
import { freshId, MISSING, recordSaved, refuse } from "./shared"

const QUALITY_NAME: Record<QualityValue, MessageRef> = { usable: msg("status_usable"), unusable: msg("status_unusable"), unreviewed: msg("status_unreviewed") }

/**
 * Library quality (P, X, U; PIX-FR-13), the one quality level (P-REJ2). It
 * binds the current bytes and clears Changed content or pending
 * verification. The mark is library-wide (round 6): an open Project that
 * holds the frame shows the change as pending from the Library until its
 * next Apply (VSEL-FR-12, D-W54).
 */
export function markFrames(assetIds: AssetId[], value: QualityValue, href: string): CommitResult {
  if (assetIds.length === 0) return { ok: true }
  const at = nowIso()
  const count = assetIds.length
  const label = msg("store_label_mark_frames", { count, n: { count: count }, quality: QUALITY_NAME[value] })
  const result = commit(
    label,
    (s) =>
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
  if (result.ok) recordSaved(msg("store_saved_frames_marked", { count, n: { count: count }, quality: QUALITY_NAME[value] }), null, href)
  return result
}

/** Mark rest usable (C10): every frame of the session still without a decision becomes Usable, so its review can finish. */
export function markRestUsable(sessionId: SessionId): CommitResult {
  const { catalog } = store.getState()
  const session = catalog.sessions[sessionId]
  if (!session) return MISSING
  return markFrames(unreviewedAssetIds(catalog, session), "usable", `/sessions/${sessionId}?step=review`)
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

/**
 * Edit… on a session: its name and notes, and nothing else (D-W76, the one
 * Edit… verb; owner's answer, 2026-10-20). Target, rig and calibration stay
 * with intake and calibration (LIB-FR-20, LIB-FR-25). An empty name restores
 * the derived one (LIB-FR-04). Refused only for a session whose frames are
 * in the OS Trash (C10). A Closed or Archived Project holding the session
 * does not refuse it: a name is a label, so those Projects show the current
 * name and notes while their frozen frames, calibration and Output stay
 * untouched (owner's answer, 2026-10-20). A stale revision is refused and
 * nothing is saved (LIB-AC-08, LIB-FR-11). Catalog only.
 */
export function editSessionDetails(sessionId: SessionId, details: { name: string; notes: string }, expectRevision: number): CommitResult {
  const { catalog } = store.getState()
  const session = catalog.sessions[sessionId]
  if (!session) return MISSING
  const label = msg("store_label_session_details")
  const href = `/sessions/${sessionId}`
  if (isTrashedSession(catalog, session)) return refuse(msg("store_refused", { label }), [msg("store_reason_session_trashed")], href)
  const name = details.name.trim() || null
  const result = commit(label, (s) => withCatalog(s, (c) => ({ ...c, sessions: { ...c.sessions, [sessionId]: { ...c.sessions[sessionId]!, name, notes: details.notes } } })), {
    expect: { collection: "sessions", id: sessionId, revision: expectRevision },
    href,
  })
  if (result.ok) recordSaved(msg("store_saved_label_name", { label, name: name ? verbatim(name) : sessionDefaultRef(session) }), null, href)
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
  const { path } = resolveNamingTemplate(namingTemplate(state.settings.naming, "light"), values, state.settings.namingOmit)
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
 * does. Every frame moves or none does; View links to them follow (STO-FR-06).
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
  if (result.ok) recordSaved(msg("session_filed_into", { session: sessionRef(session), target: target.name }), msg("session_frames_moved", { count: moves.length, n: { count: moves.length } }), href)
  return result
}

/**
 * Confirm rig (Confirm equipment, LIB-FR-05): a detected rig becomes a
 * manual record (D11), and the session records the rig version it was
 * captured with (LIB-FR-26): kept when it already belongs to this rig, else
 * the version in effect on its night. Matching then runs (CAL-FR-02): kinds
 * still waiting or suggested take their best match, pins and Nos stay.
 */
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
        const confirmed: Session = {
          ...current,
          equipment: { value: rigId, status: "confirmed", evidence: confirmedEvidence(current.equipment.evidence, msg("session_confirm_rig"), verbatim(rig.name)), confirmedAt: at },
          corrections: [...current.corrections, ...correction(current, "equipment", previous, rig.name)],
        }
        const record = c.opticalTrains[rigId]!
        const opticalTrains = record.source === "detected" ? { ...c.opticalTrains, [rigId]: { ...record, source: "manual" as const } } : c.opticalTrains
        const withRig: Catalog = { ...c, opticalTrains }
        const next: Session = { ...confirmed, rigVersionId: capturedRigVersionId(withRig, confirmed) }
        return calibrateSessions({ ...withRig, sessions: { ...c.sessions, [sessionId]: next } }, s.disk, s.settings, at)
      }),
    { expect: { collection: "sessions", id: sessionId, revision: expectRevision }, href },
  )
  if (result.ok) recordSaved(msg("session_rig_confirmed", { name: sessionRef(session) }), msg("store_catalog_only_detail", { name: rig.name }), href)
  return result
}

/**
 * A regrouping correction (LIB-FR-12, D15): `field` of the named frames of a
 * session reads `value`, the 064 contract's library_confirm_metadata.
 * Correcting every frame corrects the session in place. Correcting some
 * re-splits it into successors (`resplitSession`), and every open Project
 * holding it holds each successor in the session's group, with its frames
 * left out or included as before, so no frame leaves the Project; each reads
 * as the Library's pending change and Apply waits until every successor is
 * Ready (D-W100; owner's answer, 2026-10-19). A Closed or Archived Project
 * keeps the session it froze. Catalog only: source headers never change. A
 * stale revision is refused and nothing is saved (LIB-FR-11).
 */
export function confirmMetadata(sessionId: SessionId, assetIds: AssetId[], field: RegroupField, value: string, expectRevision: number): CommitResult {
  const { catalog } = store.getState()
  const session = catalog.sessions[sessionId]
  if (!session || session.supersededBy) return MISSING
  const label = msg("store_label_correct_frames", { name: sessionRef(session) })
  const href = `/sessions/${sessionId}`
  if (isTrashedSession(catalog, session)) return refuse(msg("store_refused", { label }), [msg("store_reason_session_trashed")], href)
  const corrected = new Set(assetIds.filter((id) => session.assetIds.includes(id)))
  const observed = field === "exposure" ? String(correctedExposureS(session) ?? session.exposureS) : session.channel
  if (corrected.size === 0 || observed === value) return { ok: true }
  const at = nowIso()
  const entry = { id: freshId("cor", session.id), field, observedValue: observed, correctedValue: value, at }
  const whole = corrected.size === session.assetIds.length
  const result = commit(
    label,
    (s) =>
      withCatalog(s, (c) => {
        const current = c.sessions[sessionId]!
        if (whole) {
          const next: Session = { ...current, channel: field === "filter" ? value : current.channel, corrections: [...current.corrections, { ...entry, revision: current.revision }] }
          return { ...c, sessions: { ...c.sessions, [sessionId]: next } }
        }
        const next: Catalog = { ...c, sessions: { ...c.sessions }, assets: { ...c.assets }, projects: { ...c.projects } }
        const successors = resplitSession(next, sessionId, corrected, entry, at)
        for (const project of Object.values(c.projects)) {
          if (isLocked(project) || !project.inputs.some((i) => i.sessionId === sessionId)) continue
          const inputs = project.inputs.flatMap((input) =>
            input.sessionId === sessionId
              ? successors.map((successor) => ({ ...input, sessionId: successor.id, excluded: input.excluded.filter((id) => successor.assetIds.includes(id)), included: input.included.filter((id) => successor.assetIds.includes(id)) }))
              : [input],
          )
          next.projects[project.id] = { ...project, inputs }
        }
        return next
      }),
    { expect: { collection: "sessions", id: sessionId, revision: expectRevision }, href },
  )
  if (result.ok) recordSaved(whole ? msg("store_saved_frames_corrected", { name: sessionRef(session) }) : msg("store_saved_session_resplit", { name: sessionRef(session) }), null, href)
  return result
}

/**
 * Finish review on a session a re-split reset (LIB-FR-12, D-W100): its
 * frames keep their marks, so it needs no re-marking, and the session is
 * Ready again. Refused while a frame is Unreviewed (C10); a session with
 * nothing reset writes nothing.
 */
export function finishReview(sessionId: SessionId, expectRevision: number): CommitResult {
  const { catalog } = store.getState()
  const session = catalog.sessions[sessionId]
  if (!session) return MISSING
  const label = msg("stepflow_finish_review")
  const href = `/sessions/${sessionId}?step=review`
  const unreviewed = unreviewedAssetIds(catalog, session).length
  if (unreviewed > 0) return refuse(msg("store_refused", { label }), [msg("flow_frames_unreviewed", { count: unreviewed })], href)
  if (!session.reviewReset) return { ok: true }
  const result = commit(label, (s) => withCatalog(s, (c) => ({ ...c, sessions: { ...c.sessions, [sessionId]: { ...c.sessions[sessionId]!, reviewReset: false } } })), {
    expect: { collection: "sessions", id: sessionId, revision: expectRevision },
    href,
  })
  if (result.ok) recordSaved(msg("store_saved_review_finished", { name: sessionRef(session) }), null, href)
  return result
}

/** ★ toggles My targets membership (D-W60); open-Project subjects and Targets with a session stay listed either way (D-W125). */
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
