/**
 * Slice-local derivations for S1 Home and S12 Sessions: one row model per
 * library light session, the Sessions facet buckets (D-W24, D-W25, D-W43;
 * Unusable, round 6; Needs review is the intake queue, C14; Needs
 * calibration is the Library's calibration queue, LIB-FR-23; Duplicates is
 * F5's, SHA-256-confirmed live extra copies), the Projects that hold a
 * session, and the intake Review step's search. The Target, Project and
 * calibration buckets come from the foundation `sessionsNeedingWork`, the
 * queue from `reviewQueue`, the Unreviewed count from
 * `sessionUnreviewedFrames` and the duplicates from `sessionDuplicateCopies`,
 * so Home, the intake gates and the Sessions facets always agree. Nothing
 * here writes state.
 */
import {
  findInput,
  isTrashedSession,
  liveAssetIds,
  reviewQueue,
  rigRef,
  type SessionReadiness,
  sessionReadiness,
  sessionRigId,
  sessionsNeedingWork,
  sessionTargetId,
  sessionUnreviewedFrames,
} from "@/domain/derive"
import { effectiveExposureS, qualityApplicability } from "@/domain/library"
import { sessionDuplicateCopies } from "@/domain/storage"
import type { AssetId, Catalog, Project, Session, SessionId } from "@/domain/types"
import type { MessageRef, Messages } from "@/lib/i18n"
import type { PrototypeState } from "@/store/core"

export type SessionFilter = "all" | "needs-review" | "needs-target" | "needs-calibration" | "not-in-project" | "duplicates" | "unusable" | "trashed"

/** The Sessions facet's values after "All", in menu order. */
export const SESSION_FILTERS: Array<Exclude<SessionFilter, "all">> = ["needs-review", "needs-target", "needs-calibration", "not-in-project", "duplicates", "unusable", "trashed"]

export function filterLabel(m: Messages, filter: SessionFilter): string {
  const label: Record<SessionFilter, () => string> = {
    all: m.sessions_filter_all,
    "needs-review": m.status_needs_review,
    "needs-target": m.sessions_filter_needs_target,
    "needs-calibration": m.sessions_filter_needs_calibration,
    "not-in-project": m.sessions_filter_not_in_project,
    duplicates: m.sessions_filter_duplicates,
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
  /** The Projects that hold the session (PRJ-FR-08), open or Closed, by name; a suggestion does not count. */
  projects: Project[]
  /** Where intake stands (C10): Target, rig, then every frame reviewed. */
  readiness: SessionReadiness
  /** In the review queue (C14): a live session that is not Ready. */
  queued: boolean
  needsTarget: boolean
  /** In the Library's Needs calibration queue (LIB-FR-23): a kind not settled, or a pinned file changed or missing. */
  needsCalibration: boolean
  notInProject: boolean
  /** F5: extra live copies of its frames the latest duplicate scan found (0 for none, and for a Trashed session). */
  duplicates: number
  trashed: boolean
}

/** The Projects that hold the session, open or Closed, by name. */
export function projectsHolding(catalog: Catalog, sessionId: SessionId): Project[] {
  return Object.values(catalog.projects)
    .filter((project) => findInput(project, sessionId) !== undefined)
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
  const { catalog, disk } = state
  const work = sessionsNeedingWork(catalog, disk)
  const needsTarget = new Set(work.needsTarget.map((s) => s.id))
  const needsCalibration = new Set(work.needsCalibration.map((s) => s.id))
  const notInProject = new Set(work.notInProject.map((s) => s.id))
  const queued = new Set(reviewQueue(catalog).map((s) => s.id))
  const duplicates = sessionDuplicateCopies(state)
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
        projects: projectsHolding(catalog, session.id),
        readiness: sessionReadiness(catalog, session),
        queued: queued.has(session.id),
        needsTarget: needsTarget.has(session.id),
        needsCalibration: needsCalibration.has(session.id),
        notInProject: notInProject.has(session.id),
        duplicates: trashed ? 0 : (duplicates.get(session.id) ?? 0),
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
  if (filter === "needs-calibration") return row.needsCalibration
  if (filter === "not-in-project") return row.notInProject
  if (filter === "duplicates") return row.duplicates > 0
  if (filter === "unusable") return row.unusable.length > 0
  return true
}

export function filterCounts(rows: SessionRow[]): Record<SessionFilter, number> {
  const count = (filter: SessionFilter) => rows.filter((r) => matchesFilter(r, filter)).length
  return {
    all: count("all"),
    "needs-review": count("needs-review"),
    "needs-target": count("needs-target"),
    "needs-calibration": count("needs-calibration"),
    "not-in-project": count("not-in-project"),
    duplicates: count("duplicates"),
    unusable: count("unusable"),
    trashed: count("trashed"),
  }
}

/** The open Project holding the session, if any: Archive… from Sessions refuses it (STO-FR-13); a Closed holder's kept View is repointed instead. */
export function openHolder(row: SessionRow): Project | undefined {
  return row.projects.find((p) => p.state === "open")
}

/** The intake Review step (`/sessions/$sessionId?step=review`, C14), opened on Unreviewed while any frame is. */
export function sessionReviewSearch(unreviewed: number): Record<string, string> {
  return unreviewed > 0 ? { step: "review", filter: "unreviewed" } : { step: "review" }
}
