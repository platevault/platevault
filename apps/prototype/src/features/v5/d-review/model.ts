/**
 * S6 Review model (slice D): the one frame list that the table, filmstrip and
 * grid share (D-W40), built for a run, a run group's Review all (D-W41) or a
 * Project's candidate sessions (PIX-FR-18). Pure derivation over the store;
 * nothing here writes. Trashed frames are never listed (LIB-FR-18, PIX-AC-19).
 */
import { findPanel, findSubject, frameQuality, type FrameQuality, groupHref, liveAssetIds, projectCandidates, runHref, type StepLink, subjectName, workingContent } from "@/domain/derive"
import { assetAvailability, type AssetAvailability } from "@/domain/library"
import { type MemberState, memberState } from "@/domain/membership"
import type { Asset, AssetId, MetricKey, Metric, MosaicPanel, Operation, Project, ProjectId, Run, RunGroupId, RunId, Session, SessionId } from "@/domain/types"
import { m } from "@/lib/i18n"
import type { PrototypeState } from "@/store/core"
import { builtInMetrics, currentImportedMetrics, frameMeasureState, type FrameMeasureState, latestMeasureOp } from "@/features/t3/measure"

/** Where a review opens: a run's Review step, a group's Review all, a Project's candidates, or one library session (marks are library-level only). */
export type ReviewContext = { kind: "run"; runId: RunId } | { kind: "group"; groupId: RunGroupId } | { kind: "candidates"; projectId: ProjectId } | { kind: "session"; sessionId: SessionId }

/** The review buckets of the two quality levels (PIX-FR-14): Picked, Rejected (either scope) and Unreviewed. */
export type ReviewBucket = "picked" | "rejected" | "unreviewed"
export type QualityFilter = "all" | ReviewBucket

/** Labels are getters, so every read is in the chosen language. */
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
  /** The run whose draft holds the frame: the run, the panel run of a group, or null for candidates. */
  run: Run | null
  panel: MosaicPanel | null
  /** The Project subject a candidate session matches (candidates context). */
  subject: string | null
  member: MemberState | null
  quality: FrameQuality
  bucket: ReviewBucket
  /** Which scopes reject it: the library mark, this Project only, or both. */
  rejectedBy: { library: boolean; project: boolean }
  measure: FrameMeasureState
  builtIn: Partial<Record<MetricKey, Metric>>
  imported: Partial<Record<MetricKey, Metric>>
  availability: AssetAvailability
  /** 1-based frame number in its session, by capture time. */
  number: number
  /** Capture order across the list: the default sort. */
  order: number
}

export interface ReviewScope {
  /** Key for frame UI state and measurement: the run id, or a group, candidates or session key. */
  key: string
  /** Null in a session context: no Project, so no Project-only reject. */
  project: Project | null
  frames: ReviewFrame[]
  /** Runs whose drafts this review edits, in panel order. */
  runs: Run[]
  /** Measurement operations, one per run (or one for candidates and a session). */
  measureKeys: string[]
  ops: Operation[]
  /** Marks are refused here, with this terse reason (a trashed run) and where to resolve it. Read in the chosen language. */
  readonly readOnlyReason: string | null
  readOnlyLink: StepLink | null
  /** Marks still apply to the library, but run membership stays (a Complete run): a pill and its help. */
  readonly membershipNote: { label: string; help: string } | null
  /** A group's panel runs in the Trash: listed by name, their frames never counted (D-W75). */
  readonly trashedPanels: string[]
  /** Trashed frames this scope leaves out (LIB-FR-18). */
  trashedHidden: number
  href: string
  panels: MosaicPanel[]
}

function byKey(metrics: Metric[]): Partial<Record<MetricKey, Metric>> {
  return Object.fromEntries(metrics.map((m) => [m.key, m]))
}

export function bucketOf(quality: FrameQuality): ReviewBucket {
  if (quality.library === "unusable" || quality.projectRejected) return "rejected"
  if (quality.library === "usable") return "picked"
  // Unreviewed, plus decisions that no longer apply to the current bytes (changed content, verification pending).
  return "unreviewed"
}

export function contextKey(context: ReviewContext): string {
  switch (context.kind) {
    case "run":
      return context.runId
    case "group":
      return `group:${context.groupId}`
    case "candidates":
      return `candidates:${context.projectId}`
    case "session":
      return `session:${context.sessionId}`
  }
}

interface Source {
  assetId: AssetId
  run: Run | null
  panel: MosaicPanel | null
  subject: string | null
}

function frameNumbers(state: PrototypeState, sessions: Iterable<Session>): Map<AssetId, number> {
  const out = new Map<AssetId, number>()
  for (const session of sessions) {
    const assets = session.assetIds.map((id) => state.catalog.assets[id]).filter((a): a is Asset => a !== undefined)
    assets.sort((a, b) => a.observed.dateObs.localeCompare(b.observed.dateObs))
    assets.forEach((a, i) => out.set(a.id, i + 1))
  }
  return out
}

export function reviewScope(state: PrototypeState, context: ReviewContext): ReviewScope | null {
  const { catalog, disk } = state
  const sources: Source[] = []
  let project: Project | null = null
  let runs: Run[] = []
  let runTrashed = false
  let readOnlyLink: StepLink | null = null
  let membership: "run-complete" | "panel-complete" | null = null
  /** A trashed panel run reads by its panel number, else by its run name. */
  const trashed: Array<{ n: number } | { name: string }> = []
  let href = "/"
  let panels: MosaicPanel[] = []
  const membersOf = (run: Run, panel: MosaicPanel | null) => {
    const content = workingContent(run)
    if (!content) return
    for (const assetId of [...content.included, ...content.rejected, ...content.excluded, ...content.unresolved]) sources.push({ assetId, run, panel, subject: null })
  }
  if (context.kind === "run") {
    const run = catalog.runs[context.runId]
    project = run ? (catalog.projects[run.projectId] ?? null) : null
    if (!run || !project) return null
    runs = [run]
    const subject = findSubject(project, run.subjectId)
    membersOf(run, findPanel(subject, run.panelId) ?? null)
    if (run.trashedAt) {
      runTrashed = true
      readOnlyLink = { to: "/projects/$projectId/trash", params: { projectId: project.id } }
    }
    membership = run.completion === "complete" ? "run-complete" : null
    href = runHref(run, "review")
  } else if (context.kind === "group") {
    const group = catalog.runGroups[context.groupId]
    project = group ? (catalog.projects[group.projectId] ?? null) : null
    if (!group || !project) return null
    const subject = findSubject(project, group.subjectId)
    for (const runId of group.runIds) {
      const run = catalog.runs[runId]
      if (!run) continue
      const panel = findPanel(subject, run.panelId) ?? null
      if (run.trashedAt) {
        trashed.push(panel ? { n: panel.n } : { name: run.name })
        continue
      }
      runs.push(run)
      if (panel) panels.push(panel)
      membersOf(run, panel)
    }
    membership = runs.some((r) => r.completion === "complete") ? "panel-complete" : null
    href = groupHref(group, "review")
  } else if (context.kind === "candidates") {
    project = catalog.projects[context.projectId] ?? null
    if (!project) return null
    for (const candidate of projectCandidates(catalog, project)) {
      const label = subjectName(m, catalog, candidate.subject)
      for (const assetId of liveAssetIds(catalog, candidate.session)) sources.push({ assetId, run: null, panel: null, subject: label })
    }
    href = `/projects/${project.id}?candidates=unreviewed`
  } else {
    const session = catalog.sessions[context.sessionId]
    if (!session) return null
    for (const assetId of liveAssetIds(catalog, session)) sources.push({ assetId, run: null, panel: null, subject: null })
    href = `/sessions/${session.id}`
  }
  const key = contextKey(context)
  const measureKeys = context.kind === "candidates" || context.kind === "session" ? [key] : runs.map((r) => r.id)
  const ops = measureKeys.map((k) => latestMeasureOp(state, k)).filter((op): op is Operation => op !== undefined)
  const opFor = (s: Source) => latestMeasureOp(state, s.run?.id ?? key)
  const seen = new Set<AssetId>()
  let trashedHidden = 0
  const sessions = new Map<string, Session>()
  const live: Array<Source & { asset: Asset }> = []
  for (const s of sources) {
    const asset = catalog.assets[s.assetId]
    if (!asset || seen.has(asset.id)) continue
    seen.add(asset.id)
    if (asset.trashed) {
      trashedHidden += 1
      continue
    }
    const session = asset.sessionId ? catalog.sessions[asset.sessionId] : undefined
    if (session) sessions.set(session.id, session)
    live.push({ ...s, asset })
  }
  const numbers = frameNumbers(state, sessions.values())
  live.sort((a, b) => a.asset.observed.dateObs.localeCompare(b.asset.observed.dateObs) || a.asset.fileName.localeCompare(b.asset.fileName))
  const frames = live.map((s, order): ReviewFrame => {
    const quality = frameQuality(s.asset, project)
    const record = catalog.measurements[s.asset.id]
    const measure = frameMeasureState(catalog, s.asset.id, opFor(s))
    const content = s.run ? workingContent(s.run) : null
    return {
      asset: s.asset,
      session: s.asset.sessionId ? catalog.sessions[s.asset.sessionId] : undefined,
      run: s.run,
      panel: s.panel,
      subject: s.subject,
      member: content ? memberState(content, s.asset.id) : null,
      quality,
      bucket: bucketOf(quality),
      rejectedBy: { library: quality.library === "unusable", project: quality.projectRejected },
      measure,
      builtIn: measure === "measured" ? byKey(builtInMetrics(record)) : {},
      imported: byKey(currentImportedMetrics(record, s.asset.sha256)),
      availability: assetAvailability(disk, catalog, s.asset),
      number: numbers.get(s.asset.id) ?? 0,
      order,
    }
  })
  return {
    key,
    project,
    frames,
    runs,
    measureKeys,
    ops,
    readOnlyLink,
    trashedHidden,
    href,
    panels,
    get readOnlyReason() {
      return runTrashed ? m.review_run_in_trash() : null
    },
    get membershipNote() {
      if (membership === "run-complete") return { label: m.review_run_complete(), help: m.review_run_complete_help() }
      if (membership === "panel-complete") return { label: m.review_panel_complete(), help: m.review_panel_complete_help() }
      return null
    },
    get trashedPanels() {
      return trashed.map((t) => ("n" in t ? m.review_panel_n({ n: t.n }) : t.name))
    },
  }
}

/** The bucket a frame lands in after a library mark; a Project-only reject keeps it Rejected (D-W42). */
export function bucketAfterMark(frame: ReviewFrame, value: "usable" | "unusable" | "unreviewed"): ReviewBucket {
  if (value === "unusable" || frame.quality.projectRejected) return "rejected"
  return value === "usable" ? "picked" : "unreviewed"
}
