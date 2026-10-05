/**
 * T3 writes. Durable changes go through `commit()` (D08); success is reported
 * only on `{ ok: true }`. Membership edits write `view.draft` without
 * `expect`; Save View is the revisioned commit. UI-only state goes to the T3
 * slice.
 */
import { useSyncExternalStore } from "react"
import { stableHash } from "@/domain/indexing"
import type {
  AssetId,
  Catalog,
  FrameMeasurement,
  MeasurementImport,
  MeasurementImportRow,
  MembershipContent,
  ProfileId,
  ProjectId,
  QualityValue,
  TargetId,
  View,
  ViewId,
  ViewOrigin,
} from "@/domain/types"
import { plural } from "@/lib/format"
import { type CommitResult, commit, nowIso, type PrototypeState, recordActivity, store, updateSlice, withCatalog } from "@/store/core"
import { defaultFrameUi, defaultSessionFilters, type FrameUi, type SessionFilters } from "@/store/slices/t3"
import { type CsvRow, importedMetrics, type MappedRow } from "./csv"
import { historyEntry } from "./measure"
import { contentEquals, contentOf, deriveCriteria, emptyContent, latestRevision, viewContext } from "./model"

const sessionsHref = (viewId: ViewId) => `/views/${viewId}/sessions`

// ---------------------------------------------------------------------------
// Drafts touched in this page session. A draft that survives a reload and is
// not touched yet is a recovered draft (D08, J22 S16): shown separately until
// the user resumes or discards it.
// ---------------------------------------------------------------------------

const touched = new Set<ViewId>()
const touchListeners = new Set<() => void>()
let touchVersion = 0

function markTouched(viewId: ViewId) {
  if (touched.has(viewId)) return
  touched.add(viewId)
  touchVersion += 1
  for (const listener of touchListeners) listener()
}

export function resumeDraft(viewId: ViewId) {
  markTouched(viewId)
}

/** True while the View's draft came from before a restart and the user has not resumed it. */
export function useRecoveredDraft(view: View | undefined): boolean {
  useSyncExternalStore(
    (listener) => {
      touchListeners.add(listener)
      return () => touchListeners.delete(listener)
    },
    () => touchVersion,
  )
  return Boolean(view?.draft) && !touched.has(view!.id)
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

export interface NewViewInput {
  name: string
  projectId: ProjectId | null
  targetId: TargetId | null
  origin: ViewOrigin
  content: MembershipContent
}

let viewCounter = 0

export function createView(input: NewViewInput): { result: CommitResult; viewId: ViewId } {
  viewCounter += 1
  const now = nowIso()
  const viewId = `view_${stableHash(`${input.name}|${now}|${viewCounter}`)}`
  const view: View = {
    id: viewId,
    name: input.name,
    projectId: input.projectId,
    targetId: input.targetId,
    origin: input.origin,
    profileId: null,
    revisions: [],
    draft: { ...input.content, baseRevision: null, updatedAt: now },
    criteria: null,
    calibration: [],
    locationParent: null,
    outputPath: null,
    notes: "",
    completedAt: null,
    createdAt: now,
    revision: 1,
  }
  const result = commit("Create View", (s) => withCatalog(s, (c) => ({ ...c, views: { ...c.views, [viewId]: view } })), { href: "/views" })
  if (result.ok) markTouched(viewId)
  return { result, viewId }
}

/**
 * Edit the working membership. The draft starts from the latest revision; a
 * draft that ends up equal to it is dropped, so "no unsaved changes" is true
 * state for every reader (T4 gates preparation on `draft === null`). Every
 * entry point is refused on a Complete View and on a recovered draft the user
 * has not resumed (wireframe D09, D08), whatever control called it.
 */
export function updateDraft(
  viewId: ViewId,
  label: string,
  change: (content: MembershipContent, state: PrototypeState) => MembershipContent,
): CommitResult {
  const view = store.getState().catalog.views[viewId]
  if (view?.completedAt) return { ok: false, reason: "write-failed", message: `${label} was refused: this View is Complete. Reopen it to change membership.` }
  if (view?.draft && !touched.has(viewId)) return { ok: false, reason: "write-failed", message: `${label} was refused: resume or discard the recovered changes first.` }
  const result = commit(
    label,
    (s) => {
      const view = s.catalog.views[viewId]
      if (!view) return s
      const base = latestRevision(view)
      const current = contentOf(view.draft ?? base ?? emptyContent())
      const next = contentOf(change(current, s))
      const draft = base && contentEquals(next, base) ? null : { ...next, baseRevision: view.draft?.baseRevision ?? base?.revision ?? null, updatedAt: nowIso() }
      return withCatalog(s, (c) => ({ ...c, views: { ...c.views, [viewId]: { ...view, draft } } }))
    },
    { href: sessionsHref(viewId) },
  )
  if (result.ok) markTouched(viewId)
  return result
}

/** Save View: commit the draft as the next reviewed revision with its criteria (VSEL-FR-12, VSEL-FR-13). */
export function saveView(viewId: ViewId): CommitResult {
  const view = store.getState().catalog.views[viewId]
  if (!view) return { ok: false, reason: "write-failed", message: "Save View was refused: this View no longer exists." }
  const result = commit(
    "Save View",
    (s) => {
      const current = s.catalog.views[viewId]
      if (!current?.draft) return s
      const content = contentOf(current.draft)
      const revision = (latestRevision(current)?.revision ?? 0) + 1
      const criteria = deriveCriteria(s.catalog, current, content, viewContext(s.catalog, current))
      const saved: View = { ...current, revisions: [...current.revisions, { ...content, revision, savedAt: nowIso() }], draft: null, criteria }
      return withCatalog(s, (c) => ({ ...c, views: { ...c.views, [viewId]: saved } }))
    },
    { expect: { collection: "views", id: viewId, revision: view.revision }, href: sessionsHref(viewId) },
  )
  if (result.ok) {
    markTouched(viewId)
    const latest = store.getState().catalog.views[viewId]
    recordActivity({
      kind: "saved",
      title: `View saved: ${view.name}`,
      detail: `Revision ${latestRevision(latest!)?.revision ?? 1} committed. No quality decision changed.`,
      operationId: null,
      href: sessionsHref(viewId),
    })
  }
  return result
}

/** Discard the draft: back to the latest revision, or remove a View that was never saved. */
export function discardDraft(viewId: ViewId): CommitResult {
  const view = store.getState().catalog.views[viewId]
  if (!view) return { ok: true }
  const neverSaved = view.revisions.length === 0
  const result = commit(
    neverSaved ? "Discard draft View" : "Discard unsaved changes",
    (s) =>
      withCatalog(s, (c) => {
        if (!neverSaved) return { ...c, views: { ...c.views, [viewId]: { ...c.views[viewId]!, draft: null } } }
        const { [viewId]: _removed, ...views } = c.views
        return { ...c, views }
      }),
    { href: neverSaved ? "/views" : sessionsHref(viewId) },
  )
  if (result.ok) markTouched(viewId)
  return result
}

export interface ViewDetails {
  name: string
  projectId: ProjectId | null
  profileId: ProfileId | null
}

/** Name, optional Project and optional profile (C1). Membership is unchanged (VSEL-AC-10). */
export function editViewDetails(viewId: ViewId, details: ViewDetails, expectRevision: number): CommitResult {
  return commit(
    "View details",
    (s) =>
      withCatalog(s, (c) => {
        const view = c.views[viewId]
        if (!view) return c
        const project = details.projectId ? c.projects[details.projectId] : undefined
        const targetId = project && details.projectId !== view.projectId ? (project.targetIds[0] ?? view.targetId) : view.targetId
        return { ...c, views: { ...c.views, [viewId]: { ...view, ...details, targetId } } }
      }),
    { expect: { collection: "views", id: viewId, revision: expectRevision }, href: sessionsHref(viewId) },
  )
}

/** Reopen clears Complete (T5 sets it); Results, cleanup records and preparations stay as they are. */
export function reopenView(viewId: ViewId, expectRevision: number): CommitResult {
  return commit(
    "Reopen View",
    (s) => withCatalog(s, (c) => ({ ...c, views: { ...c.views, [viewId]: { ...c.views[viewId]!, completedAt: null } } })),
    { expect: { collection: "views", id: viewId, revision: expectRevision }, href: sessionsHref(viewId) },
  )
}

// ---------------------------------------------------------------------------
// Scoped quality decisions (VSEL-FR-11, D10)
// ---------------------------------------------------------------------------

/** Library scope: changes only these frames' quality; View membership stays as it is. */
export function setLibraryQuality(assetIds: AssetId[], value: Exclude<QualityValue, "unreviewed">, href: string): CommitResult {
  const word = value === "usable" ? "Usable" : "Unusable"
  return commit(
    `Mark ${plural(assetIds.length, "frame")} ${word}`,
    (s) =>
      withCatalog(s, (c) => {
        const assets = { ...c.assets }
        const now = nowIso()
        for (const id of assetIds) {
          const asset = assets[id]
          if (asset) assets[id] = { ...asset, quality: { value, decidedAt: now, basisSha256: asset.sha256, verificationPending: false } }
        }
        return { ...c, assets }
      }),
    { href },
  )
}

/** Project scope: a rejection record only; library quality and Target totals are unchanged. */
export function rejectForProject(projectId: ProjectId, assetIds: AssetId[], href: string): CommitResult {
  const project = store.getState().catalog.projects[projectId]
  if (!project) return { ok: false, reason: "write-failed", message: "Reject for Project was refused: the Project no longer exists." }
  return commit(
    `Reject ${plural(assetIds.length, "frame")} for Project`,
    (s) =>
      withCatalog(s, (c) => {
        const current = c.projects[projectId]!
        const at = nowIso()
        const rejections = { ...current.rejections }
        for (const id of assetIds) rejections[id] = { at }
        return { ...c, projects: { ...c.projects, [projectId]: { ...current, rejections } } }
      }),
    { expect: { collection: "projects", id: projectId, revision: project.revision }, href },
  )
}

// ---------------------------------------------------------------------------
// Imported measurements (PIX-FR-06, PIX-FR-07)
// ---------------------------------------------------------------------------

/**
 * Add imported metrics next to built-in ones; an earlier import of the same metric is replaced, a built-in value never.
 * The import is stamped with the frame's current digest when the mapping is confirmed (PIX-FR-06): a record of other
 * bytes moves to history with its values, and the import starts a record of the current bytes.
 */
function withImported(catalog: Catalog, assetId: AssetId, row: Pick<CsvRow, "index" | "file" | "values">, path: string): FrameMeasurement {
  const record = catalog.measurements[assetId]
  const sha256 = catalog.assets[assetId]?.sha256 ?? null
  const metrics = importedMetrics({ ...row, approved: true, psfSignalWeight: 0 }, path)
  const keys = new Set(metrics.map((m) => m.key))
  if (record && record.inputSha256 === sha256) return { ...record, metrics: [...record.metrics.filter((m) => m.source === "built-in" || !keys.has(m.key)), ...metrics] }
  const earlier = record ? historyEntry(record) : null
  return { assetId, state: "unavailable", inputSha256: sha256, metrics, computedAt: nowIso(), history: [...(earlier ? [earlier] : []), ...(record?.history ?? [])] }
}

export function importMeasurements(viewId: ViewId, path: string, mapped: MappedRow[], viewAssetIds: Set<AssetId>): CommitResult {
  const attach = mapped.filter((m) => m.assetId !== null)
  const rows: MeasurementImportRow[] = mapped
    .filter((m) => m.status === "ambiguous" || m.status === "unmatched")
    .map((m) => ({ index: m.row.index, file: m.row.file, status: m.status as "ambiguous" | "unmatched", candidates: m.candidates, assetId: null, values: m.row.values }))
  const record: MeasurementImport = {
    id: `imp_${stableHash(`${path}|${nowIso()}`)}`,
    viewId,
    path,
    importedAt: nowIso(),
    matched: attach.length,
    outsideView: attach.filter((m) => !viewAssetIds.has(m.assetId!)).length,
    rows,
  }
  // Matched values and the rows left to review are one durable write.
  const result = commit(
    "Import measurements",
    (s) =>
      withCatalog(s, (c) => {
        const measurements = { ...c.measurements }
        for (const m of attach) measurements[m.assetId!] = withImported({ ...c, measurements }, m.assetId!, m.row, path)
        return { ...c, measurements, measurementImports: { ...c.measurementImports, [record.id]: record } }
      }),
    { href: `/views/${viewId}/frames` },
  )
  if (!result.ok) return result
  recordActivity({
    kind: "saved",
    title: "Measurements imported",
    detail: `${plural(attach.length, "row")} attached as imported values from ${path}. ${rows.length} rows attach to no frame until reviewed. No frame was excluded and no quality changed.`,
    operationId: null,
    href: `/views/${viewId}/frames`,
  })
  return result
}

/** Attach an ambiguous row to the frame the user chose. */
export function resolveImportRow(importId: string, rowIndex: number, assetId: AssetId): CommitResult {
  const record = store.getState().catalog.measurementImports[importId]
  const row = record?.rows.find((r) => r.index === rowIndex)
  if (!record || !row) return { ok: false, reason: "write-failed", message: "The import row was not found; open Import measurements again." }
  const rows = record.rows.map((r) => (r.index === rowIndex ? { ...r, status: "resolved" as const, assetId } : r))
  return commit(
    "Attach imported row",
    (s) =>
      withCatalog(s, (c) => ({
        ...c,
        measurements: { ...c.measurements, [assetId]: withImported(c, assetId, row, record.path) },
        measurementImports: { ...c.measurementImports, [importId]: { ...record, rows } },
      })),
    { href: `/views/${record.viewId}/frames` },
  )
}

// ---------------------------------------------------------------------------
// Slice UI state
// ---------------------------------------------------------------------------

export function setSessionFilters(viewId: ViewId, patch: Partial<SessionFilters> | null) {
  updateSlice("t3", (slice) => ({
    ...slice,
    sessionFilters: { ...slice.sessionFilters, [viewId]: patch === null ? defaultSessionFilters() : { ...(slice.sessionFilters[viewId] ?? defaultSessionFilters()), ...patch } },
  }))
}

export function setActiveSession(viewId: ViewId, sessionId: string | null) {
  updateSlice("t3", (slice) => ({ ...slice, activeSession: { ...slice.activeSession, [viewId]: sessionId } }))
}

export function setSky(viewId: ViewId, on: boolean) {
  updateSlice("t3", (slice) => ({ ...slice, sky: { ...slice.sky, [viewId]: on } }))
}

export function setFrameUi(viewId: ViewId, patch: Partial<FrameUi>) {
  updateSlice("t3", (slice) => ({ ...slice, frames: { ...slice.frames, [viewId]: { ...(slice.frames[viewId] ?? defaultFrameUi()), ...patch } } }))
}

export function setRefreshDecision(viewId: ViewId, changeId: string, decision: "accept" | "decline") {
  updateSlice("t3", (slice) => {
    const current = slice.refresh[viewId] ?? { decisions: {}, declined: [] }
    return { ...slice, refresh: { ...slice.refresh, [viewId]: { ...current, decisions: { ...current.decisions, [changeId]: decision } } } }
  })
}

/** Keep the View unchanged: forget pending decisions; nothing is written (J25 S4). */
export function clearRefreshDecisions(viewId: ViewId, declined: string[] = []) {
  updateSlice("t3", (slice) => {
    const current = slice.refresh[viewId] ?? { decisions: {}, declined: [] }
    return { ...slice, refresh: { ...slice.refresh, [viewId]: { decisions: {}, declined: [...new Set([...current.declined, ...declined])] } } }
  })
}
