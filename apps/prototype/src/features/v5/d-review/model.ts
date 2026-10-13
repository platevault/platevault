/**
 * Review model (slice D): the frames a review shows. The live review is one
 * library session as the session intake Review step reviews it (P-REV2):
 * every live frame, its library quality as it applies to the current bytes
 * (C10), its built-in and imported values and whether a copy can be read.
 * Marks are library-wide (P-REJ2), so no review has a Project scope.
 *
 * The run, run group and Project candidates reviews are deprecated: P-REV2
 * moves review to session intake, and W4 deletes them with their exports in
 * review.tsx. They list their frames the same way and mark the library only.
 *
 * Pure derivation over the store; nothing here writes. Trashed frames are
 * never listed (LIB-FR-18, PIX-AC-19).
 */
import { type FlowGate, frameQuality, type FrameQuality, liveAssetIds, projectCandidates, reviewLockGate, runHref, groupHref, workingContent } from "@/domain/derive"
import { assetAvailability, type AssetAvailability } from "@/domain/library"
import type { Asset, AssetId, MetricKey, Metric, Operation, ProjectId, RunGroupId, RunId, Session, SessionId } from "@/domain/types"
import { m, msg, verbatim } from "@/lib/i18n"
import { builtInMetrics, currentImportedMetrics, frameMeasureState, type FrameMeasureState, latestMeasureOp } from "@/store/actions/measure"
import type { PrototypeState } from "@/store/core"

/**
 * Where a review opens: one library session (the intake Review step). `run`, `group` and `candidates` are deprecated
 * (P-REV2): only the deprecated ReviewStep, GroupReviewStep and CandidateReview open them, and W4 removes them.
 */
export type ReviewContext = { kind: "session"; sessionId: SessionId } | { kind: "run"; runId: RunId } | { kind: "group"; groupId: RunGroupId } | { kind: "candidates"; projectId: ProjectId }

/** The review buckets of library quality (PIX-FR-14): Picked (Usable), Rejected (Unusable) and Unreviewed. */
export type ReviewBucket = "picked" | "rejected" | "unreviewed"
export type QualityFilter = "all" | ReviewBucket

/** Labels are getters, so every read is in the chosen language. `key` is the ⌥ digit that picks the filter. */
export const FILTERS: Array<{ id: QualityFilter; readonly label: string; key: string }> = [
  { id: "all", get label() { return m.review_filter_all() }, key: "1" },
  { id: "picked", get label() { return m.review_picked() }, key: "2" },
  { id: "rejected", get label() { return m.review_rejected() }, key: "3" },
  { id: "unreviewed", get label() { return m.status_unreviewed() }, key: "4" },
]

export const PLOT_METRICS: MetricKey[] = ["fwhm", "hfr", "eccentricity", "star-count", "background"]

export interface ReviewFrame {
  asset: Asset
  session: Session | undefined
  quality: FrameQuality
  bucket: ReviewBucket
  measure: FrameMeasureState
  builtIn: Partial<Record<MetricKey, Metric>>
  imported: Partial<Record<MetricKey, Metric>>
  availability: AssetAvailability
  /** 1-based frame number in its session, by capture time. */
  number: number
  /** Capture order: the default sort and the plots' sequence. */
  order: number
}

export interface ReviewScope {
  /** Key for the frame UI state, the measurement operation and recorded imports: `session:<id>`. */
  key: string
  /** The session a session review shows; null in the deprecated run, group and candidates reviews. */
  session: Session | null
  frames: ReviewFrame[]
  ops: Operation[]
  /** Where a mark, a measurement or an import is recorded from (activity links). */
  href: string
  /** Why marks are refused, and where it resolves: a session an unfinished run's prepared view holds (C10); a closed Project or a trashed run in the deprecated reviews. */
  lock: FlowGate | null
}

function byKey(metrics: Metric[]): Partial<Record<MetricKey, Metric>> {
  return Object.fromEntries(metrics.map((metric) => [metric.key, metric]))
}

export function bucketOf(quality: FrameQuality): ReviewBucket {
  if (quality.library === "unusable") return "rejected"
  if (quality.library === "usable") return "picked"
  // Unreviewed, plus decisions that no longer apply to the current bytes (changed content, verification pending).
  return "unreviewed"
}

export function contextKey(context: ReviewContext): string {
  switch (context.kind) {
    case "session":
      return `session:${context.sessionId}`
    case "run":
      return context.runId
    case "group":
      return `group:${context.groupId}`
    case "candidates":
      return `candidates:${context.projectId}`
  }
}

interface Listed {
  assets: AssetId[]
  session: Session | null
  href: string
  lock: FlowGate | null
}

function listed(state: PrototypeState, context: ReviewContext): Listed | null {
  const { catalog } = state
  if (context.kind === "session") {
    const session = catalog.sessions[context.sessionId]
    if (!session) return null
    return { assets: liveAssetIds(catalog, session), session, href: `/sessions/${session.id}?step=review`, lock: reviewLockGate(state, session.id) }
  }
  const runAssets = (runId: RunId) => {
    const content = catalog.runs[runId] ? workingContent(catalog.runs[runId]!) : null
    return content ? [...content.included, ...content.rejected, ...content.excluded, ...content.unresolved] : []
  }
  const closed = (projectId: ProjectId): FlowGate | null => {
    const project = catalog.projects[projectId]
    return project && project.state !== "open" ? { reason: msg("startrun_blocker_done", { name: project.name }), blockers: [{ label: verbatim(project.name), link: { to: "/projects/$projectId", params: { projectId: project.id } } }] } : null
  }
  if (context.kind === "run") {
    const run = catalog.runs[context.runId]
    if (!run) return null
    const trashed: FlowGate | null = run.trashedAt ? { reason: msg("review_run_in_trash"), blockers: [{ label: msg("activity_destination_trash"), link: { to: "/projects/$projectId/trash", params: { projectId: run.projectId } } }] } : null
    return { assets: runAssets(run.id), session: null, href: runHref(run, "review"), lock: closed(run.projectId) ?? trashed }
  }
  if (context.kind === "group") {
    const group = catalog.runGroups[context.groupId]
    if (!group) return null
    const assets = group.runIds.filter((id) => catalog.runs[id] && !catalog.runs[id]!.trashedAt).flatMap(runAssets)
    return { assets, session: null, href: groupHref(group, "review"), lock: closed(group.projectId) }
  }
  const project = catalog.projects[context.projectId]
  if (!project) return null
  const assets = projectCandidates(catalog, project).flatMap((candidate) => liveAssetIds(catalog, candidate.session))
  return { assets, session: null, href: `/projects/${project.id}?candidates=unreviewed`, lock: closed(project.id) }
}

export function reviewScope(state: PrototypeState, context: ReviewContext): ReviewScope | null {
  const { catalog, disk } = state
  const source = listed(state, context)
  if (!source) return null
  const key = contextKey(context)
  const op = latestMeasureOp(state, key)
  const assets = [...new Set(source.assets)]
    .map((id) => catalog.assets[id])
    .filter((asset): asset is Asset => asset !== undefined && !asset.trashed)
    .sort((a, b) => a.observed.dateObs.localeCompare(b.observed.dateObs) || a.fileName.localeCompare(b.fileName))
  // The frame number counts within each session, by capture time.
  const perSession = new Map<string, number>()
  const frames = assets.map((asset, order): ReviewFrame => {
    const quality = frameQuality(asset)
    const record = catalog.measurements[asset.id]
    const measure = frameMeasureState(catalog, asset.id, op)
    const sessionKey = asset.sessionId ?? ""
    const number = (perSession.get(sessionKey) ?? 0) + 1
    perSession.set(sessionKey, number)
    return {
      asset,
      session: asset.sessionId ? catalog.sessions[asset.sessionId] : undefined,
      quality,
      bucket: bucketOf(quality),
      measure,
      builtIn: measure === "measured" ? byKey(builtInMetrics(record)) : {},
      imported: byKey(currentImportedMetrics(record, asset.sha256)),
      availability: assetAvailability(disk, catalog, asset),
      number,
      order,
    }
  })
  return { key, session: source.session, frames, ops: op ? [op] : [], href: source.href, lock: source.lock }
}

/** The bucket a frame lands in after a library mark. */
export function bucketAfterMark(value: "usable" | "unusable" | "unreviewed"): ReviewBucket {
  return value === "unusable" ? "rejected" : value === "usable" ? "picked" : "unreviewed"
}
