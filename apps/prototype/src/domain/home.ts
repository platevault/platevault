/**
 * Home's cross-area state (decision C8): what came in, what needs sorting,
 * what is open and what runs, each row with where its owning page shows it.
 * Every function joins existing derives; the one rule here is the low-space
 * threshold (`LOW_SPACE_SHARE`), pending the owner's decision.
 *
 * - `pendingIngestions`: per Captures location, a running import, a stopped
 *   or failed one, a location never scanned or whose last scan did not
 *   finish, or the image files no copy in the library holds yet (new since
 *   its last scan).
 * - `pendingWork`: sessions that need a Target, wait for review, sit in no
 *   Project or are ready to add to a run, and Finished runs whose prepared
 *   view is still on disk, with the bytes Clean up frees.
 * - `openWork`: open Projects and calibration processes, deadline or season
 *   first, each with its in-context issues.
 * - `homeStatus`: every location's availability and space, and the
 *   background jobs other than imports.
 */
import { calibrationProcesses, type ProcessView } from "./calibration-process"
import {
  goalProgress,
  type NextAction,
  oldMastersInUse,
  planningPriorities,
  projectLink,
  projectMemberSessionIds,
  projectNext,
  projectRuns,
  projectWrapUp,
  runningWork,
  runPipeline,
  runPreparations,
  runStepLink,
  sessionsNeedingWork,
  type StepLink,
  type SubjectPriority,
  wrapUpStepLink,
  type World,
} from "./derive"
import { fileKey, filesUnder, freeBytes } from "./disk"
import { listLocation } from "./indexing"
import { deriveIssues, type Issue } from "./issues"
import { locationAvailability } from "./library"
import { runFootprint } from "./storage"
import type { Availability, Location, NightDate, Operation, Project, ProjectId, Run, Session, SessionId } from "./types"

// ---------------------------------------------------------------------------
// Pending ingestions
// ---------------------------------------------------------------------------

/** The operations that bring files into a location's library: a scan (index) and an import. */
const INGEST_KINDS: ReadonlySet<Operation["kind"]> = new Set(["index", "import"])

export type IngestionState =
  /** A scan or import of the location runs (or is paused): "Importing 142 files · 40%". */
  | { kind: "importing"; operation: Operation; percent: number }
  /** The location's latest scan or import stopped before it finished, or failed: Retry. */
  | { kind: "stopped"; operation: Operation }
  | { kind: "never-scanned" }
  /** The last scan did not finish (it stopped, or some folders could not be read). */
  | { kind: "incomplete" }
  | { kind: "new-files"; count: number }

export interface IngestionRow {
  location: Location
  availability: Availability
  state: IngestionState
}

/** Image files under the location that no copy in the library holds: what arrived since its last scan. Zero while it is offline. */
export function newFileCount(world: Pick<World, "disk" | "catalog">, location: Location): number {
  const listing = listLocation(world.disk, location)
  if (listing.offline || listing.readable.length === 0) return 0
  const held = new Set<string>()
  for (const asset of Object.values(world.catalog.assets)) {
    for (const copy of asset.copies) if (copy.locationId === location.id) held.add(fileKey(copy.volumeId, copy.path))
  }
  return listing.readable.filter((file) => !held.has(fileKey(file.volumeId, file.path))).length
}

/** The latest scan or import that covers the location, newest first. */
function latestIngest(world: Pick<World, "operations">, locationId: string): Operation | null {
  let latest: Operation | null = null
  for (const op of Object.values(world.operations)) {
    if (!INGEST_KINDS.has(op.kind) || !op.scope.locationIds?.includes(locationId)) continue
    if (!latest || op.createdAt > latest.createdAt) latest = op
  }
  return latest
}

/** Whether a settled operation left this location short: canceled, failed, interrupted, or its item for the location blocked. */
function stoppedFor(op: Operation, locationId: string): boolean {
  if (op.status === "canceled" || op.status === "failed" || op.status === "interrupted") return true
  if (op.status !== "partial") return false
  return op.kind === "import" || op.items.some((item) => item.id === locationId && item.status === "blocked")
}

function ingestionState(world: Pick<World, "disk" | "catalog" | "operations">, location: Location): IngestionState | null {
  const op = latestIngest(world, location.id)
  if (op && (op.status === "running" || op.status === "paused")) {
    return { kind: "importing", operation: op, percent: op.progress.total > 0 ? Math.min(100, Math.round((op.progress.done / op.progress.total) * 100)) : 0 }
  }
  if (op && stoppedFor(op, location.id)) return { kind: "stopped", operation: op }
  if (location.scanScope === "never") return { kind: "never-scanned" }
  if (location.scanScope === "incomplete") return { kind: "incomplete" }
  const count = newFileCount(world, location)
  return count > 0 ? { kind: "new-files", count } : null
}

const INGESTION_ORDER: IngestionState["kind"][] = ["stopped", "importing", "never-scanned", "incomplete", "new-files"]

/** The Captures locations with something to bring in, problems first, then by name. */
export function pendingIngestions(world: Pick<World, "disk" | "catalog" | "operations">): IngestionRow[] {
  const rows: IngestionRow[] = []
  for (const location of Object.values(world.catalog.locations)) {
    if (location.role !== "captures" || location.retiredAt) continue
    const state = ingestionState(world, location)
    if (state) rows.push({ location, availability: locationAvailability(world.disk, location), state })
  }
  return rows.sort((a, b) => INGESTION_ORDER.indexOf(a.state.kind) - INGESTION_ORDER.indexOf(b.state.kind) || a.location.displayName.localeCompare(b.location.displayName))
}

// ---------------------------------------------------------------------------
// Pending work
// ---------------------------------------------------------------------------

export type PendingWork =
  | { kind: "needs-target"; session: Session }
  | { kind: "unreviewed"; session: Session; projectId: ProjectId; frames: number }
  | { kind: "not-in-project"; session: Session }
  | { kind: "ready-to-add"; session: Session; projectId: ProjectId }
  /** A Finished run whose prepared view is still on disk: Clean up unlinks its links and frees `bytes` of copies. */
  | { kind: "clean-up"; run: Run; project: Project; entries: number; bytes: number }

/** A Finished run's prepared entries still on disk, and the bytes their copies hold (links count zero). */
function preparedOnDisk(world: Pick<World, "disk" | "catalog">, run: Run): { entries: number; bytes: number } {
  const entries = runPreparations(world.catalog, run.id).reduce((n, p) => n + filesUnder(world.disk, p.folderPath).length, 0)
  return { entries, bytes: entries > 0 ? runFootprint(world.disk, world.catalog, run.id).preparedBytes : 0 }
}

/**
 * Pending work in the order it unblocks the rest: a Target, then review,
 * then a Project, then a run, then Clean up; oldest night first within a
 * kind. A session reviewed for several Projects shows once. A session an
 * open run's draft already holds is not ready to add: it waits only for
 * that run's Save.
 */
export function pendingWork(world: Pick<World, "disk" | "catalog">): PendingWork[] {
  const work = sessionsNeedingWork(world.catalog)
  const byNight = (a: { session: Session }, b: { session: Session }) => a.session.night.localeCompare(b.session.night) || a.session.id.localeCompare(b.session.id)
  const unreviewed = [...new Map(work.unreviewed.map((u) => [u.session.id, u])).values()]
  const cleanUp: PendingWork[] = []
  for (const project of Object.values(world.catalog.projects)) {
    if (project.state !== "open") continue
    for (const run of projectRuns(world.catalog, project.id)) {
      if (run.completion !== "complete") continue
      const { entries, bytes } = preparedOnDisk(world, run)
      if (entries > 0) cleanUp.push({ kind: "clean-up", run, project, entries, bytes })
    }
  }
  return [
    ...work.needsTarget.map((session) => ({ session })).sort(byNight).map(({ session }): PendingWork => ({ kind: "needs-target", session })),
    ...unreviewed.sort(byNight).map((u): PendingWork => ({ kind: "unreviewed", ...u })),
    ...work.notInProject.map((session) => ({ session })).sort(byNight).map(({ session }): PendingWork => ({ kind: "not-in-project", session })),
    ...work.readyToAdd
      .filter((r) => !inOpenDraft(world, r.projectId, r.session.id))
      .sort(byNight)
      .map((r): PendingWork => ({ kind: "ready-to-add", ...r })),
    ...cleanUp,
  ]
}

/** Whether an open run of the Project outside its Trash holds the session in its unsaved draft. */
function inOpenDraft(world: Pick<World, "catalog">, projectId: ProjectId, sessionId: SessionId): boolean {
  return projectRuns(world.catalog, projectId).some((run) => run.completion === "open" && (run.draft?.sessions.some((s) => s.sessionId === sessionId) ?? false))
}

/** Where a Finished run's Clean up happens: Wrap up's first step once every run is Finished, else the run's Results step. */
export function cleanUpLink(world: Pick<World, "catalog">, run: Run, project: Project): StepLink {
  return projectWrapUp(world.catalog, project).available ? wrapUpStepLink(project.id, "cleanup") : runStepLink(run, "results")
}

// ---------------------------------------------------------------------------
// Open work
// ---------------------------------------------------------------------------

interface Ranked {
  /** The deadline or season that ranks the row; null without one. */
  window: SubjectPriority["window"] | null
  /** `deadlinePriority` of that window: 0 without one. */
  priority: number
  /** Problems on the row, in Issues order (C8: each problem shows on the row it affects). */
  issues: Issue[]
}

export type OpenWork =
  | (Ranked & { kind: "project"; project: Project; next: NextAction | null; goals: { met: number; total: number }; openRuns: number })
  | (Ranked & { kind: "calibration"; view: ProcessView })

/** Issues about one of the Project's runs, an old master its unfinished runs hand off, or a session its runs hold. */
function projectIssues(world: World, project: Project, issues: Issue[], oldMasterRuns: Map<string, Run[]>): Issue[] {
  const runs = new Set(projectRuns(world.catalog, project.id).map((r) => r.id))
  const sessions = projectMemberSessionIds(world.catalog, project.id)
  return issues.filter((issue) => {
    if (!issue.about) return false
    if (issue.kind === "run-blocked" || issue.kind === "calibration-review" || issue.kind === "master-offer") return runs.has(issue.about)
    if (issue.kind === "master-old") return (oldMasterRuns.get(issue.about) ?? []).some((r) => runs.has(r.id))
    if (issue.kind === "drift") return sessions.has(issue.about)
    return false
  })
}

/** Issues about a calibration process: its failure, or drift on the master it made. */
function processIssues(view: ProcessView, issues: Issue[]): Issue[] {
  return issues.filter((issue) => (issue.kind === "calibration-failed" && issue.about === view.process.id) || (issue.kind === "drift" && view.master !== null && issue.about === view.master.id))
}

/**
 * Open Projects and calibration processes still to finish. A deadline or a
 * season ranks first (`planningPriorities`), then a row with a problem, then
 * Projects (by name) before calibration (in Calibration's order).
 */
export function openWork(world: World, nowMs: number, tonight: NightDate): OpenWork[] {
  const issues = deriveIssues(world, nowMs)
  const oldMasterRuns = new Map(oldMastersInUse(world, nowMs).map(({ master, runs }) => [master.id, runs]))
  const priorities = planningPriorities(world.catalog, tonight)
  const projects: OpenWork[] = []
  for (const project of Object.values(world.catalog.projects)) {
    if (project.state !== "open") continue
    const top = priorities.find((p) => p.project.id === project.id) ?? null
    const progress = goalProgress(world.catalog, project)
    projects.push({
      kind: "project",
      project,
      next: projectNext(world, project, nowMs, (p) => projectWrapUp(world.catalog, p)),
      goals: { met: progress.filter((p) => p.met).length, total: progress.length },
      openRuns: projectRuns(world.catalog, project.id).filter((r) => r.completion === "open").length,
      window: top?.window ?? null,
      priority: top?.priority ?? 0,
      issues: projectIssues(world, project, issues, oldMasterRuns),
    })
  }
  projects.sort((a, b) => (a.kind === "project" && b.kind === "project" ? a.project.name.localeCompare(b.project.name) : 0))
  const processes = calibrationProcesses(world.catalog)
    .filter((view) => view.status !== "done")
    .map((view): OpenWork => ({ kind: "calibration", view, window: null, priority: 0, issues: processIssues(view, issues) }))
  // A stable sort keeps the name and Calibration orders within equal ranks.
  return [...projects, ...processes].sort(
    (a, b) =>
      b.priority - a.priority ||
      (a.window?.nightsLeft ?? Infinity) - (b.window?.nightsLeft ?? Infinity) ||
      Number(b.issues.length > 0) - Number(a.issues.length > 0) ||
      Number(a.kind === "calibration") - Number(b.kind === "calibration"),
  )
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

/**
 * A volume reads low on space below this share of its capacity free.
 * Pending owner decision (2026-10-13): the threshold, or a fixed free amount
 * instead of a share, is the owner's call; 10 % stands in until then.
 */
const LOW_SPACE_SHARE = 0.1

export interface LocationStatus {
  location: Location
  availability: Availability
  /** Null while the volume is not mounted. */
  space: { freeBytes: number; capacityBytes: number; low: boolean } | null
  /** Offline or denied: the location's issue from Issues. */
  issue: Issue | null
}

export interface HomeStatus {
  locations: LocationStatus[]
  /** Unsettled operations other than imports and scans (they show in Pending ingestions), newest first. */
  jobs: Operation[]
}

export function homeStatus(world: World, nowMs: number): HomeStatus {
  const issues = deriveIssues(world, nowMs)
  const locations = Object.values(world.catalog.locations)
    .filter((l) => !l.retiredAt)
    .map((location): LocationStatus => {
      const volume = world.disk.volumes[location.volumeId]
      const free = volume?.mounted ? freeBytes(world.disk, volume.id) : null
      return {
        location,
        availability: locationAvailability(world.disk, location),
        space: volume && free !== null ? { freeBytes: free, capacityBytes: volume.capacityBytes, low: free < volume.capacityBytes * LOW_SPACE_SHARE } : null,
        issue: issues.find((i) => (i.kind === "location-offline" || i.kind === "location-denied") && i.about === location.id) ?? null,
      }
    })
    // Problems first: denied, then offline, then low on space; then by name.
    .sort((a, b) => rankLocation(a) - rankLocation(b) || a.location.displayName.localeCompare(b.location.displayName))
  return { locations, jobs: runningWork(world.operations).filter((op) => !INGEST_KINDS.has(op.kind)) }
}

function rankLocation(row: LocationStatus): number {
  if (row.issue?.kind === "location-denied") return 0
  if (row.availability === "offline") return 1
  if (row.space?.low) return 2
  return 3
}

/** Where a background job's work lives: its run's current step, its Project, Calibration, or Activity. */
export function operationLink(world: World, op: Operation): StepLink {
  if (op.kind === "stack-master") return { to: "/calibration" }
  const runId = op.scope.runIds?.[0]
  const run = runId ? world.catalog.runs[runId] : undefined
  if (run) return runStepLink(run, runPipeline(world, run).current.id)
  if (op.scope.projectId) return projectLink(op.scope.projectId)
  return { to: "/activity" }
}
