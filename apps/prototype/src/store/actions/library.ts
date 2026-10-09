/**
 * Library writes shared by every screen (foundation-owned): the two quality
 * levels (D-W42, D-W54), Confirm Target and Confirm rig (LIB-FR-05) and
 * ★ favourites (D-W60). Catalog only: source headers never change.
 */
import { latestRevision } from "@/domain/derive"
import { type CatalogueEntry, entryKeys, targetFromEntry } from "@/domain/sky"
import { rejectInContent, sessionLabel, unrejectInContent } from "@/domain/membership"
import type { AssetId, CatalogCorrection, Evidence, OpticalTrainId, QualityValue, RunId, Session, SessionId, TargetId } from "@/domain/types"
import { plural } from "@/lib/format"
import { type CommitResult, commit, nowIso, store, withCatalog } from "@/store/core"
import { setProjectRejection } from "./projects"
import { updateRunDraft } from "./runs"
import { freshId, MISSING, recordSaved } from "./shared"

const WORD: Record<QualityValue, string> = { usable: "Usable", unusable: "Unusable", unreviewed: "Unreviewed" }

/**
 * Library quality, the first level (P, X, U; PIX-FR-13). It binds the
 * current bytes and clears Changed content or pending verification. Given an
 * open run, X also removes the frames from that run's draft with the reason
 * "Rejected", and P or U restores them (D-W54); saved revisions never change.
 */
export function markFrames(assetIds: AssetId[], value: QualityValue, runId: RunId | null, href: string): CommitResult {
  if (assetIds.length === 0) return { ok: true }
  const at = nowIso()
  const result = commit(`Mark ${plural(assetIds.length, "frame")} ${WORD[value]}`, (s) =>
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
  recordSaved(`${plural(assetIds.length, "frame")} marked ${WORD[value]}`, "Library scope: every run and Target sees this decision.", href)
  return runId ? applyToDraft(runId, assetIds, value === "unusable") : result
}

function applyToDraft(runId: RunId, assetIds: AssetId[], reject: boolean): CommitResult {
  const { catalog } = store.getState()
  const run = catalog.runs[runId]
  if (!run || run.completion === "complete" || run.trashedAt) return { ok: true }
  const content = run.draft ?? latestRevision(run)
  if (!content) return { ok: true }
  // A frame still rejected in the other scope stays out of the draft (D-W42, D-W54): P on a Project-rejected frame, or
  // clearing the Project reject of a library-Unusable frame, never restores it.
  const rejections = catalog.projects[run.projectId]?.rejections ?? {}
  const ids = reject ? assetIds : assetIds.filter((id) => catalog.assets[id]?.quality.value !== "unusable" && !(id in rejections))
  const touches = reject ? ids.some((id) => !content.rejected.includes(id)) : ids.some((id) => content.rejected.includes(id))
  if (!touches) return { ok: true }
  return updateRunDraft(runId, reject ? "Rejected in Review" : "Un-rejected in Review", (c, s) => (reject ? rejectInContent(c, ids) : unrejectInContent(s.disk, s.catalog, c, ids)))
}

/**
 * "Reject for this Project only", the second level (D-W42, PRJ-FR-13). It
 * leaves library quality, captured and other Projects alone. In an open
 * run's Review step it also removes the frames from that run's draft (D-W54).
 */
export function rejectForProjectOnly(runId: RunId, assetIds: AssetId[], rejected: boolean): CommitResult {
  const run = store.getState().catalog.runs[runId]
  if (!run) return MISSING
  const result = setProjectRejection(run.projectId, assetIds, rejected)
  return result.ok ? applyToDraft(runId, assetIds, rejected) : result
}

/** Observed evidence stays as read; the confirmation is a separate user row. */
function confirmedEvidence(evidence: Evidence[], label: string, value: string): Evidence[] {
  return [...evidence.filter((e) => e.source !== "user"), { source: "user", label, value, agrees: true }]
}

function correction(session: Session, field: CatalogCorrection["field"], observed: string | null, corrected: string): CatalogCorrection[] {
  if (observed === corrected) return []
  return [{ id: freshId("cor", session.id), field, observedValue: observed, correctedValue: corrected, at: nowIso(), revision: session.revision }]
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
    `Target for ${sessionLabel(session)}`,
    (s) =>
      withCatalog(s, (c) => {
        const current = c.sessions[sessionId]!
        const previous = current.target.value ? (c.targets[current.target.value]?.name ?? null) : null
        const next: Session = {
          ...current,
          target: { value: targetId, status: "confirmed", evidence: confirmedEvidence(current.target.evidence, "Confirm Target", target.name), confirmedAt: at },
          corrections: [...current.corrections, ...correction(current, "target", previous, target.name)],
        }
        return { ...c, sessions: { ...c.sessions, [sessionId]: next } }
      }),
    { expect: { collection: "sessions", id: sessionId, revision: expectRevision }, href },
  )
  if (result.ok) recordSaved(`Target confirmed: ${sessionLabel(session)}`, `${target.name}. Catalog only; source headers unchanged.`, href)
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
    `Rig for ${sessionLabel(session)}`,
    (s) =>
      withCatalog(s, (c) => {
        const current = c.sessions[sessionId]!
        const previous = current.equipment.value ? (c.opticalTrains[current.equipment.value]?.name ?? null) : null
        const next: Session = {
          ...current,
          equipment: { value: rigId, status: "confirmed", evidence: confirmedEvidence(current.equipment.evidence, "Confirm rig", rig.name), confirmedAt: at },
          corrections: [...current.corrections, ...correction(current, "equipment", previous, rig.name)],
        }
        const record = c.opticalTrains[rigId]!
        const opticalTrains = record.source === "detected" ? { ...c.opticalTrains, [rigId]: { ...record, source: "manual" as const } } : c.opticalTrains
        return { ...c, opticalTrains, sessions: { ...c.sessions, [sessionId]: next } }
      }),
    { expect: { collection: "sessions", id: sessionId, revision: expectRevision }, href },
  )
  if (result.ok) recordSaved(`Rig confirmed: ${sessionLabel(session)}`, `${rig.name}. Catalog only; source headers unchanged.`, href)
  return result
}

/** ★ toggles My targets membership (D-W60); open-Project subjects stay listed either way. */
export function setFavourite(targetId: TargetId, favourite: boolean): CommitResult {
  const target = store.getState().catalog.targets[targetId]
  if (!target) return MISSING
  const href = `/targets/${targetId}`
  const result = commit(
    favourite ? `Add ${target.name} to My targets` : `Remove ${target.name} from My targets`,
    (s) => withCatalog(s, (c) => ({ ...c, targets: { ...c.targets, [targetId]: { ...c.targets[targetId]!, favourite } } })),
    { expect: { collection: "targets", id: targetId, revision: target.revision }, href },
  )
  if (result.ok) recordSaved(favourite ? `★ ${target.name}` : `☆ ${target.name}`, null, href)
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
  const result = commit(options.favourite ? `Add ${entry.designation} to My targets` : `Add ${entry.designation} to targets`, (s) => withCatalog(s, (c) => ({ ...c, targets: { ...c.targets, [id]: target } })), { href })
  if (result.ok) recordSaved(options.favourite ? `★ ${entry.designation} added to My targets` : `Target added: ${entry.designation}`, options.resolver ? `Coordinates, size and type from ${options.resolver}.` : `From the bundled ${entry.catalogues.join(", ") || "reference"} catalogue.`, href)
  return { result, targetId: result.ok ? id : null }
}
