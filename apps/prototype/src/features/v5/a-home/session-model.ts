/**
 * Slice-local derivations for S1 Home and S12 Sessions: one row model per
 * library light session, the filter buckets (D-W24, D-W25, D-W43), the runs
 * that use a session, the session review's search, and the run a ready
 * candidate can join. Every bucket comes from the foundation
 * `sessionsNeedingWork`, so Home, the Issues hub and the Sessions filters
 * always agree. Nothing here writes state.
 */
import {
  type Candidate,
  latestRevision,
  liveAssetIds,
  isTrashedSession,
  projectCandidates,
  rigName,
  runCandidates,
  sessionRigId,
  sessionsNeedingWork,
  sessionTargetId,
} from "@/domain/derive"
import { effectiveExposureS, qualityApplicability } from "@/domain/library"
import type { Catalog, Project, ProjectId, Run, Session, SessionId } from "@/domain/types"
import type { Messages } from "@/lib/i18n"
import type { PrototypeState } from "@/store/core"

export type SessionFilter = "all" | "needs-target" | "not-in-project" | "trashed"

export function filterLabel(m: Messages, filter: SessionFilter): string {
  const label: Record<SessionFilter, () => string> = {
    all: m.sessions_filter_all,
    "needs-target": m.sessions_filter_needs_target,
    "not-in-project": m.sessions_filter_not_in_project,
    trashed: m.status_trashed,
  }
  return label[filter]()
}

export function parseFilter(value: string | undefined): SessionFilter {
  return value === "needs-target" || value === "not-in-project" || value === "trashed" ? value : "all"
}

export interface SessionRow {
  session: Session
  targetName: string | null
  rigName: string | null
  /** Frames outside the Trash (all frames for a Trashed session). */
  frames: number
  seconds: number
  unreviewed: number
  candidateOf: Array<{ project: Project; candidate: Candidate }>
  runs: Run[]
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

function unreviewedCount(catalog: Catalog, session: Session): number {
  return liveAssetIds(catalog, session).filter((id) => {
    const asset = catalog.assets[id]!
    return asset.quality.value === "unreviewed" || qualityApplicability(asset) !== "applicable"
  }).length
}

/** Every current light session, Trashed ones included (only the Trashed filter shows those). */
export function sessionRows(state: PrototypeState): SessionRow[] {
  const { catalog } = state
  const work = sessionsNeedingWork(catalog)
  const needsTarget = new Set(work.needsTarget.map((s) => s.id))
  const notInProject = new Set(work.notInProject.map((s) => s.id))
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
        rigName: rigId ? rigName(catalog, rigId) : null,
        frames: ids.length,
        seconds: ids.reduce((n, id) => n + (catalog.assets[id] ? effectiveExposureS(catalog, catalog.assets[id]!) : 0), 0),
        unreviewed: trashed ? 0 : unreviewedCount(catalog, session),
        candidateOf: candidates.get(session.id) ?? [],
        runs: runsUsingSession(catalog, session.id),
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
  if (filter === "needs-target") return row.needsTarget
  if (filter === "not-in-project") return row.notInProject
  return true
}

export function filterCounts(rows: SessionRow[]): Record<SessionFilter, number> {
  return {
    all: rows.filter((r) => matchesFilter(r, "all")).length,
    "needs-target": rows.filter((r) => matchesFilter(r, "needs-target")).length,
    "not-in-project": rows.filter((r) => matchesFilter(r, "not-in-project")).length,
    trashed: rows.filter((r) => matchesFilter(r, "trashed")).length,
  }
}

/** The session detail's review region (`/sessions/$sessionId?view=review`), opened on Unreviewed while any frame is. */
export function sessionReviewSearch(unreviewed: number): Record<string, string> {
  return unreviewed > 0 ? { view: "review", filter: "unreviewed" } : { view: "review" }
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
