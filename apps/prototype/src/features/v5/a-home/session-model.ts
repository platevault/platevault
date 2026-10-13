/**
 * Slice-local derivations for S1 Home and S12 Sessions: one row model per
 * library light session, the Sessions facet buckets (D-W24, D-W25, D-W43;
 * Unusable, round 6; Needs review is the intake queue, C14), the runs that
 * use a session, the intake Review step's search, and the run a ready
 * candidate can join. The Target and Project buckets come from the
 * foundation `sessionsNeedingWork`, the queue from `reviewQueue` and the
 * Unreviewed count from `sessionUnreviewedFrames`, so Home, the Issues hub,
 * the intake gates and the Sessions facets always agree. Nothing here writes
 * state.
 */
import {
  type Candidate,
  isTrashedSession,
  latestRevision,
  liveAssetIds,
  projectCandidates,
  reviewQueue,
  rigRef,
  runCandidates,
  type SessionReadiness,
  sessionReadiness,
  sessionRigId,
  sessionsNeedingWork,
  sessionTargetId,
  sessionUnreviewedFrames,
} from "@/domain/derive"
import { effectiveExposureS, qualityApplicability } from "@/domain/library"
import type { AssetId, Catalog, Project, ProjectId, Run, Session, SessionId } from "@/domain/types"
import type { MessageRef, Messages } from "@/lib/i18n"
import type { PrototypeState } from "@/store/core"

export type SessionFilter = "all" | "needs-review" | "needs-target" | "not-in-project" | "unusable" | "trashed"

/** The Sessions facet's values after "All", in menu order. */
export const SESSION_FILTERS: Array<Exclude<SessionFilter, "all">> = ["needs-review", "needs-target", "not-in-project", "unusable", "trashed"]

export function filterLabel(m: Messages, filter: SessionFilter): string {
  const label: Record<SessionFilter, () => string> = {
    all: m.sessions_filter_all,
    "needs-review": m.status_needs_review,
    "needs-target": m.sessions_filter_needs_target,
    "not-in-project": m.sessions_filter_not_in_project,
    unusable: m.status_unusable,
    trashed: m.status_trashed,
  }
  return label[filter]()
}

export function parseFilter(value: string | undefined): SessionFilter {
  return SESSION_FILTERS.find((filter) => filter === value) ?? "all"
}

export interface SessionRow {
  session: Session
  targetName: string | null
  rig: MessageRef | null
  /** Frames outside the Trash (all frames for a Trashed session). */
  frames: number
  seconds: number
  unreviewed: number
  /** Live frames whose library quality is Unusable for their current bytes: purge candidates (round 6). */
  unusable: AssetId[]
  candidateOf: Array<{ project: Project; candidate: Candidate }>
  runs: Run[]
  /** Where intake stands (C10): Target, rig, then every frame reviewed. */
  readiness: SessionReadiness
  /** In the review queue (C14): a live session that is not Ready. */
  queued: boolean
  needsTarget: boolean
  notInProject: boolean
  trashed: boolean
}

/** Runs outside the Trash whose latest saved membership or open draft holds the session. */
export function runsUsingSession(catalog: Catalog, sessionId: SessionId): Run[] {
  return Object.values(catalog.runs)
    .filter((run) => !run.trashedAt && [latestRevision(run), run.draft].some((c) => c?.sessions.some((s) => s.sessionId === sessionId)))
    .sort((a, b) => a.name.localeCompare(b.name))
}

function unusableIds(catalog: Catalog, session: Session): AssetId[] {
  return liveAssetIds(catalog, session).filter((id) => {
    const asset = catalog.assets[id]!
    return asset.quality.value === "unusable" && qualityApplicability(asset) === "applicable"
  })
}

/** Every current light session, Trashed ones included (only the Trashed filter shows those). */
export function sessionRows(state: PrototypeState): SessionRow[] {
  const { catalog } = state
  const work = sessionsNeedingWork(catalog)
  const needsTarget = new Set(work.needsTarget.map((s) => s.id))
  const notInProject = new Set(work.notInProject.map((s) => s.id))
  const queued = new Set(reviewQueue(catalog).map((s) => s.id))
  const candidates = new Map<SessionId, Array<{ project: Project; candidate: Candidate }>>()
  for (const project of Object.values(catalog.projects)) {
    for (const candidate of projectCandidates(catalog, project)) {
      candidates.set(candidate.session.id, [...(candidates.get(candidate.session.id) ?? []), { project, candidate }])
    }
  }
  return Object.values(catalog.sessions)
    .filter((s) => s.imageType === "light" && !s.supersededBy)
    .map((session): SessionRow => {
      const trashed = isTrashedSession(catalog, session)
      const ids = trashed ? session.assetIds : liveAssetIds(catalog, session)
      const targetId = sessionTargetId(session)
      const rigId = sessionRigId(session)
      return {
        session,
        targetName: targetId ? (catalog.targets[targetId]?.name ?? targetId) : null,
        rig: rigId ? rigRef(catalog, rigId) : null,
        frames: ids.length,
        seconds: ids.reduce((n, id) => n + (catalog.assets[id] ? effectiveExposureS(catalog, catalog.assets[id]!) : 0), 0),
        unreviewed: trashed ? 0 : sessionUnreviewedFrames(catalog, session),
        unusable: trashed ? [] : unusableIds(catalog, session),
        candidateOf: candidates.get(session.id) ?? [],
        runs: runsUsingSession(catalog, session.id),
        readiness: sessionReadiness(catalog, session),
        queued: queued.has(session.id),
        needsTarget: needsTarget.has(session.id),
        notInProject: notInProject.has(session.id),
        trashed,
      }
    })
    .sort((a, b) => b.session.night.localeCompare(a.session.night) || (a.session.channel ?? "").localeCompare(b.session.channel ?? ""))
}

export function matchesFilter(row: SessionRow, filter: SessionFilter): boolean {
  if (filter === "trashed") return row.trashed
  if (row.trashed) return false
  if (filter === "needs-review") return row.queued
  if (filter === "needs-target") return row.needsTarget
  if (filter === "not-in-project") return row.notInProject
  if (filter === "unusable") return row.unusable.length > 0
  return true
}

export function filterCounts(rows: SessionRow[]): Record<SessionFilter, number> {
  const count = (filter: SessionFilter) => rows.filter((r) => matchesFilter(r, filter)).length
  return {
    all: count("all"),
    "needs-review": count("needs-review"),
    "needs-target": count("needs-target"),
    "not-in-project": count("not-in-project"),
    unusable: count("unusable"),
    trashed: count("trashed"),
  }
}

/** A session in a Project: a candidate of one, or held by one of its runs. Archive… from Sessions refuses it (round 6); Wrap up archives it. */
export function inProject(row: SessionRow): boolean {
  return row.candidateOf.length > 0 || row.runs.length > 0
}

/** The intake Review step (`/sessions/$sessionId?step=review`, C14), opened on Unreviewed while any frame is. */
export function sessionReviewSearch(unreviewed: number): Record<string, string> {
  return unreviewed > 0 ? { step: "review", filter: "unreviewed" } : { step: "review" }
}

/** The open run a "ready to add" candidate can join: same subject, rig and (for a panel run) panel. */
export function runToJoin(catalog: Catalog, projectId: ProjectId, sessionId: SessionId): Run | null {
  return (
    Object.values(catalog.runs)
      .filter((r) => r.projectId === projectId && !r.trashedAt && r.completion === "open")
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .find((r) => runCandidates(catalog, r).some((c) => c.session.id === sessionId)) ?? null
  )
}
