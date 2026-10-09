/**
 * Project and run derivations for harness v5 (foundation-owned). Candidates,
 * goal progress, warnings, the six run step gates and their Next action, the
 * run blockers, the Project Next rule and stage, and Fit per rig. Every
 * screen reads these so the numbers and the next step agree everywhere
 * (D-W33, D-W35, D-W36, D-W37). Library-level totals live in library.ts.
 * Nothing here writes state. Copy is a `MessageRef` (a catalogue key and its
 * params), worded by the screen with `say(m, …)`, so it follows a language
 * switch; the name helpers that return a string take the caller's `m`.
 */
import { calibrationPlan, type CalibrationPlan, candidatesFor, reusableSources } from "./calibration"
import { BANDS, isGoalChannel, NARROW_BANDS, RUN_STEPS, STEP_NAME, WRAP_UP_NAME, WRAP_UP_STEPS } from "./labels"
import {
  assetAvailability,
  effectiveExposureS,
  type FrameTotals,
  measurementApplies,
  qualityApplicability,
} from "./library"
import { runSummary, sessionExposureS } from "./membership"
import { bestWindowTonight, defaultCriteria, filterSuitability, type FilterTonight } from "./planning"
import { type FieldOfView, fieldOfView } from "./sky"
import { type NamingValues, namingValues } from "./templates"
import type {
  AppSettings,
  Asset,
  AssetId,
  Band,
  CameraKind,
  Catalog,
  Disk,
  Goal,
  GoalChannel,
  GoalTemplateValue,
  IsoDateTime,
  Location,
  NightDate,
  ObservingSite,
  WrapUpStepId,
  MembershipContent,
  MembershipRevision,
  MosaicPanel,
  Operation,
  OpticalTrain,
  OpticalTrainId,
  Preparation,
  Project,
  ProjectId,
  ResultRecord,
  Run,
  RunGroup,
  RunId,
  RunSetup,
  RunStep,
  Session,
  SessionId,
  SimulationFaults,
  Subject,
  Target,
} from "./types"
import { formatCount, formatExposure } from "@/lib/format"
import { joinRefs, type MessageRef, type Messages, msg, say, verbatim } from "@/lib/i18n"

/** The read-only slice of the prototype state derivations need; `PrototypeState` satisfies it. */
export interface World {
  disk: Disk
  catalog: Catalog
  operations: Record<string, Operation>
  settings: AppSettings
  faults: SimulationFaults
}

const SETTLED = new Set(["succeeded", "partial", "failed", "canceled"])

function unsettled(op: Operation): boolean {
  return !SETTLED.has(op.status)
}

// ---------------------------------------------------------------------------
// Associations, rigs and channels
// ---------------------------------------------------------------------------

/**
 * The session's Target when the association is settled: confirmed, or
 * associated by agreeing evidence (LIB-FR-05). Needs review and unresolved
 * read as no Target, so the session "needs a Target" (LIB-FR-17).
 */
export function sessionTargetId(session: Session): string | null {
  return session.target.status === "confirmed" || session.target.status === "associated" ? session.target.value : null
}

/**
 * Naming token values of a session (D-W20): its settled Target, corrected
 * channel and exposure, camera and settings. Archive, Restore, review names
 * and the Settings preview lay files out from these; Import, before any
 * association, reads the header (`headerNamingValues`).
 */
export function sessionNamingValues(catalog: Catalog, session: Session, frameType: string = session.imageType): NamingValues {
  const targetId = sessionTargetId(session)
  return namingValues({
    target: targetId ? (catalog.targets[targetId]?.name ?? null) : null,
    filter: session.channel,
    night: session.night,
    frameType,
    camera: session.cameraName,
    exposureS: sessionExposureS(session),
    gain: session.gain,
    binning: session.binning,
    ccdTempC: session.ccdTempC,
  })
}

/** The session's rig under the same rule (Confirm equipment sets it, LIB-FR-05). */
export function sessionRigId(session: Session): OpticalTrainId | null {
  return session.equipment.status === "confirmed" || session.equipment.status === "associated" ? session.equipment.value : null
}

/** Frames of a session that are not Trashed. */
export function liveAssetIds(catalog: Catalog, session: Session): AssetId[] {
  return session.assetIds.filter((id) => {
    const asset = catalog.assets[id]
    return asset !== undefined && !asset.trashed
  })
}

/** Every frame of the session is Trashed: only the Sessions "Trashed" filter shows it (D-W43). */
export function isTrashedSession(catalog: Catalog, session: Session): boolean {
  return session.assetIds.length > 0 && liveAssetIds(catalog, session).length === 0
}

/** Current light sessions with at least one frame outside the Trash. */
export function liveLightSessions(catalog: Catalog): Session[] {
  return Object.values(catalog.sessions).filter((s) => s.imageType === "light" && !s.supersededBy && !isTrashedSession(catalog, s))
}

/** The rig's name: "no rig" without one, "Unknown rig" for one no longer in the catalog. */
export function rigRef(catalog: Catalog, rigId: OpticalTrainId | null): MessageRef {
  if (!rigId) return msg("session_no_rig")
  const rig = catalog.opticalTrains[rigId]
  return rig ? verbatim(rig.name) : msg("domain_rig_unknown")
}

export function rigName(m: Messages, catalog: Catalog, rigId: OpticalTrainId | null): string {
  return say(m, rigRef(catalog, rigId))
}

/** Mono or OSC comes from the rig's camera (D-W31); null when the camera is unknown. */
export function rigCameraKind(catalog: Catalog, rig: OpticalTrain): CameraKind | null {
  const camera = rig.cameraId ? catalog.cameras[rig.cameraId] : undefined
  return camera?.kind ?? null
}

/** Bands a rig can capture: OSC adds R, G and B without a filter; each listed filter adds its bands (PLAN-EQ-FR-02). */
export function rigBands(catalog: Catalog, rig: OpticalTrain): Band[] {
  const bands = new Set<Band>()
  if (rigCameraKind(catalog, rig) === "osc") for (const band of ["R", "G", "B"] as Band[]) bands.add(band)
  for (const filter of rig.filters) for (const band of filter.bands) bands.add(band)
  return BANDS.filter((band) => bands.has(band))
}

/** The union of the bands of several rigs ("this Project's rigs", D-W62). */
export function bandUnion(catalog: Catalog, rigIds: OpticalTrainId[]): Band[] {
  const bands = new Set<Band>()
  for (const id of rigIds) {
    const rig = catalog.opticalTrains[id]
    if (rig) for (const band of rigBands(catalog, rig)) bands.add(band)
  }
  return BANDS.filter((band) => bands.has(band))
}

/** A rig's field of view from its camera and focal length; null when either is unknown (PLAN-EQ-FR-05). */
export function rigFieldOfView(catalog: Catalog, rig: OpticalTrain): FieldOfView | null {
  const camera = rig.cameraId ? catalog.cameras[rig.cameraId] : undefined
  if (!camera || camera.pixelSizeUm <= 0 || rig.effectiveFocalLengthMm <= 0) return null
  return fieldOfView(rig, camera)
}

/** The rig filter a FITS FILTER value matches, case-insensitively. */
export function rigFilterFor(rig: OpticalTrain, value: string | null) {
  if (!value) return null
  const key = value.toLowerCase()
  return rig.filters.find((f) => f.name.toLowerCase() === key || f.matches.some((m) => m.toLowerCase() === key)) ?? null
}

/** FILTER values seen on a rig's sessions that match none of its filters: "Add {value} to {rig}" (PLAN-EQ-FR-04). */
export function unknownFilterValues(catalog: Catalog, rigId: OpticalTrainId): string[] {
  const rig = catalog.opticalTrains[rigId]
  if (!rig) return []
  const values = new Set<string>()
  for (const session of liveLightSessions(catalog)) {
    if (sessionRigId(session) !== rigId || !session.channel) continue
    if (!rigFilterFor(rig, session.channel)) values.add(session.channel)
  }
  return [...values].sort()
}

/**
 * The goal channel a session counts toward (a chip of `GOAL_CHANNELS`): the
 * band of its single-band filter on the rig; "OSC" for an OSC camera with no
 * filter or a broadband filter; "Dual-band" for a filter passing two narrow
 * bands. Null when the filter is not on the rig: such frames meet no goal.
 */
export function goalChannel(catalog: Catalog, session: Session): GoalChannel | null {
  const rigId = sessionRigId(session)
  const rig = rigId ? catalog.opticalTrains[rigId] : undefined
  const osc = rig ? rigCameraKind(catalog, rig) === "osc" : false
  const filter = rig ? rigFilterFor(rig, session.channel) : null
  if (filter) {
    if (filter.bands.filter((b) => NARROW_BANDS.includes(b)).length >= 2) return "Dual-band"
    if (osc && filter.bands.every((b) => !NARROW_BANDS.includes(b))) return "OSC"
    return filter.bands.length === 1 ? filter.bands[0]! : null
  }
  if (osc && !session.channel) return "OSC"
  return session.channel && isGoalChannel(session.channel) ? session.channel : null
}

// ---------------------------------------------------------------------------
// Subjects and panels
// ---------------------------------------------------------------------------

export function subjectTarget(catalog: Catalog, subject: Subject): Target | undefined {
  return catalog.targets[subject.targetId]
}

/** A mosaic reads by its own name; a Target subject by the Target's name. */
export function subjectRef(catalog: Catalog, subject: Subject): MessageRef {
  const name = subject.mosaic?.name ?? subjectTarget(catalog, subject)?.name
  return name === undefined ? msg("plan_unknown_target") : verbatim(name)
}

export function subjectName(m: Messages, catalog: Catalog, subject: Subject): string {
  return say(m, subjectRef(catalog, subject))
}

export function findSubject(project: Project, subjectId: string): Subject | undefined {
  return project.subjects.find((s) => s.id === subjectId)
}

export function findPanel(subject: Subject | undefined, panelId: string | null): MosaicPanel | undefined {
  return panelId ? subject?.mosaic?.panels.find((p) => p.id === panelId) : undefined
}

/** "Panel 2". */
export function panelRef(panel: MosaicPanel): MessageRef {
  return msg("review_panel_n", { n: panel.n })
}

export function panelLabel(m: Messages, panel: MosaicPanel): string {
  return say(m, panelRef(panel))
}

/** Centre the Planner uses: a mosaic's centre, else the Target's coordinates (D-W63). */
export function subjectCentre(catalog: Catalog, subject: Subject): { ra: number; dec: number } | null {
  if (subject.mosaic) return subject.mosaic.centre
  const target = subjectTarget(catalog, subject)
  return target && target.ra !== null && target.dec !== null ? { ra: target.ra, dec: target.dec } : null
}

export type PanelFlag = "ambiguous" | "off-panel" | "no-pointing" | "fov-unknown"

export const PANEL_FLAG_NAME: Record<PanelFlag, MessageRef> = {
  ambiguous: msg("domain_panel_flag_ambiguous"),
  "off-panel": msg("domain_panel_flag_off_panel"),
  "no-pointing": msg("project_placement_no_pointing"),
  "fov-unknown": msg("domain_fov_unknown"),
}

/**
 * The panel a session belongs to by its pointing, checked against each
 * panel's centre and rotation with the rig's field of view (D-W38). A session
 * in more than one panel, in none, or without pointing is flagged; nothing is
 * assigned silently.
 */
export function panelForSession(catalog: Catalog, subject: Subject, session: Session, rigId: OpticalTrainId): { panelId: string | null; flag: PanelFlag | null; detail: MessageRef } {
  const panels = subject.mosaic?.panels ?? []
  if (!session.pointing) return { panelId: null, flag: "no-pointing", detail: PANEL_FLAG_NAME["no-pointing"] }
  const rig = catalog.opticalTrains[rigId]
  const fov = rig ? rigFieldOfView(catalog, rig) : null
  if (!fov) return { panelId: null, flag: "fov-unknown", detail: PANEL_FLAG_NAME["fov-unknown"] }
  const { ra, dec } = session.pointing
  const inside = panels.filter((panel) => {
    const cos = Math.cos((panel.dec * Math.PI) / 180)
    let dRa = ra - panel.ra
    if (dRa > 180) dRa -= 360
    if (dRa < -180) dRa += 360
    const x = dRa * cos
    const y = dec - panel.dec
    const r = (panel.rotationDeg * Math.PI) / 180
    const u = x * Math.cos(r) + y * Math.sin(r)
    const v = -x * Math.sin(r) + y * Math.cos(r)
    return Math.abs(u) <= fov.widthDeg / 2 && Math.abs(v) <= fov.heightDeg / 2
  })
  if (inside.length === 1) return { panelId: inside[0]!.id, flag: null, detail: msg("domain_panel_pointing_inside", { panel: panelRef(inside[0]!) }) }
  if (inside.length > 1) return { panelId: null, flag: "ambiguous", detail: joinRefs([PANEL_FLAG_NAME.ambiguous, joinRefs(inside.map(panelRef), ", ")], ": ") }
  return { panelId: null, flag: "off-panel", detail: PANEL_FLAG_NAME["off-panel"] }
}

// ---------------------------------------------------------------------------
// Projects: state, runs, candidates and members (D-W33, D-W34, D-W37)
// ---------------------------------------------------------------------------

export type ProjectStatus = "open" | "done" | "archived"

/** Header state: Open, Done, or Archived (Done with an Archive). A Reopened Project reads Open. */
export function projectStatus(project: Project): ProjectStatus {
  if (project.state === "open") return "open"
  return project.archive ? "archived" : "done"
}

/** Runs of a Project outside its Trash, oldest first. */
export function projectRuns(catalog: Catalog, projectId: ProjectId): Run[] {
  return Object.values(catalog.runs)
    .filter((r) => r.projectId === projectId && !r.trashedAt)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

/** The Project's Trash: trashed runs, newest first (D-W72). */
export function projectTrash(catalog: Catalog, projectId: ProjectId): Run[] {
  return Object.values(catalog.runs)
    .filter((r) => r.projectId === projectId && r.trashedAt)
    .sort((a, b) => (b.trashedAt ?? "").localeCompare(a.trashedAt ?? ""))
}

export function projectGroups(catalog: Catalog, projectId: ProjectId): RunGroup[] {
  return Object.values(catalog.runGroups)
    .filter((g) => g.projectId === projectId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

/**
 * Candidate rule (D-W33, D-W37, PRJ-FR-09): the session's confirmed Target is
 * a subject of the Project and its rig is one of the Project's rigs.
 * Trashed sessions are never candidates. Returns the matching subject.
 */
export function candidateSubject(catalog: Catalog, project: Project, session: Session): Subject | null {
  if (session.imageType !== "light" || session.supersededBy || isTrashedSession(catalog, session)) return null
  const targetId = sessionTargetId(session)
  const rigId = sessionRigId(session)
  if (!targetId || !rigId || !project.rigIds.includes(rigId)) return null
  return project.subjects.find((s) => s.targetId === targetId) ?? null
}

export interface Candidate {
  session: Session
  subject: Subject
  rigId: OpticalTrainId
  /** "Target NGC 7000 on RedCat 51 / ASI2600MM" (D-W49). */
  reason: MessageRef
}

export function projectCandidates(catalog: Catalog, project: Project): Candidate[] {
  const out: Candidate[] = []
  for (const session of liveLightSessions(catalog)) {
    const subject = candidateSubject(catalog, project, session)
    if (!subject) continue
    const rigId = sessionRigId(session)!
    out.push({ session, subject, rigId, reason: msg("domain_candidate_reason", { target: subjectRef(catalog, subject), rig: rigRef(catalog, rigId) }) })
  }
  return out.sort((a, b) => a.session.night.localeCompare(b.session.night) || (a.session.channel ?? "").localeCompare(b.session.channel ?? ""))
}

/** The latest saved membership revision of a run, if any. */
export function latestRevision(run: Run): MembershipRevision | null {
  return run.revisions.at(-1) ?? null
}

/** What Select and Review edit: the draft, else the latest revision. */
export function workingContent(run: Run): MembershipContent | null {
  return run.draft ?? latestRevision(run)
}

/** Calibrate and Prepare need a saved revision and no unsaved draft. */
export function savedContent(run: Run): MembershipRevision | null {
  return run.draft ? null : latestRevision(run)
}

/** Members: sessions in the latest saved membership of a Project's runs outside its Trash (D-W34). */
export function projectMemberSessionIds(catalog: Catalog, projectId: ProjectId): Set<SessionId> {
  const ids = new Set<SessionId>()
  for (const run of projectRuns(catalog, projectId)) for (const s of latestRevision(run)?.sessions ?? []) ids.add(s.sessionId)
  return ids
}

/** The run's candidates: the subject's candidates on the run's rig; a panel run's, by pointing (D-W49, D-W38). */
export function runCandidates(catalog: Catalog, run: Run): Candidate[] {
  const project = catalog.projects[run.projectId]
  if (!project) return []
  return projectCandidates(catalog, project).filter((c) => {
    if (c.subject.id !== run.subjectId || c.rigId !== run.rigId) return false
    if (!run.panelId) return true
    return panelForSession(catalog, c.subject, c.session, run.rigId).panelId === run.panelId
  })
}

export interface RunRefresh {
  /** Candidates not yet in the run: "Add N new sessions" (VSEL-FR-12). */
  newCandidates: Candidate[]
  /** Members that stopped being candidates: "no longer matches subject" (D-W45). */
  noLongerMatching: SessionId[]
}

export function runRefresh(catalog: Catalog, run: Run): RunRefresh {
  const content = workingContent(run)
  const memberIds = new Set((content?.sessions ?? []).map((s) => s.sessionId))
  const candidates = runCandidates(catalog, run)
  const subject = catalog.projects[run.projectId] ? findSubject(catalog.projects[run.projectId]!, run.subjectId) : undefined
  return {
    newCandidates: candidates.filter((c) => !memberIds.has(c.session.id)),
    noLongerMatching: [...memberIds].filter((id) => {
      const session = catalog.sessions[id]
      return !session || !subject || sessionTargetId(session) !== subject.targetId || sessionRigId(session) !== run.rigId
    }),
  }
}

/** Panel assignment of a run group's candidates: per panel, plus the flagged sessions the user must place (D-W38). */
export function groupCandidates(catalog: Catalog, group: RunGroup): { byPanel: Record<string, Candidate[]>; flagged: Array<{ candidate: Candidate; flag: PanelFlag; detail: MessageRef }> } {
  const project = catalog.projects[group.projectId]
  const subject = project ? findSubject(project, group.subjectId) : undefined
  const byPanel: Record<string, Candidate[]> = {}
  const flagged: Array<{ candidate: Candidate; flag: PanelFlag; detail: MessageRef }> = []
  if (!project || !subject) return { byPanel, flagged }
  for (const panel of subject.mosaic?.panels ?? []) byPanel[panel.id] = []
  for (const candidate of projectCandidates(catalog, project)) {
    if (candidate.subject.id !== subject.id || candidate.rigId !== group.rigId) continue
    const placed = panelForSession(catalog, subject, candidate.session, group.rigId)
    if (placed.panelId) byPanel[placed.panelId]?.push(candidate)
    else flagged.push({ candidate, flag: placed.flag!, detail: placed.detail })
  }
  return { byPanel, flagged }
}

// ---------------------------------------------------------------------------
// Two-level quality (D-W42)
// ---------------------------------------------------------------------------

export interface FrameQuality {
  /** First level: library P/X/U, as it applies to the current bytes. */
  library: "unreviewed" | "usable" | "unusable" | "changed-content" | "verification-pending"
  /** Second level: "Reject for this Project only". */
  projectRejected: boolean
  trashed: boolean
}

export function frameQuality(asset: Asset, project: Project | null): FrameQuality {
  const applicability = qualityApplicability(asset)
  return {
    library: applicability === "applicable" ? asset.quality.value : applicability,
    projectRejected: project ? asset.id in project.rejections : false,
    trashed: asset.trashed !== null,
  }
}

// ---------------------------------------------------------------------------
// Goals: "in project" and "captured" (D-W36, D-W44, D-W66, PRJ-FR-04)
// ---------------------------------------------------------------------------

function zero(): FrameTotals {
  return { frames: 0, seconds: 0 }
}

/** "6h10", "10h", "45m": goal progress reads in compact hours (D-W36). */
export function formatHours(seconds: number): string {
  const totalMinutes = Math.round(seconds / 60)
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  if (h === 0) return `${m}m`
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, "0")}`
}

export interface GoalProgress {
  goal: Goal
  inProject: FrameTotals
  captured: FrameTotals
  /** Members the goal's quality bar cannot judge (no applicable measurement); they do not count (PRJ-FR-03). */
  unknownQuality: number
  met: boolean
  /** Integration still needed in project; null without an integration goal. */
  remainingS: number | null
  /** "Ha 6h10 in project · 9h15 captured · goal 10h" ("in project" never above "captured", PRJ-FR-21). */
  line: MessageRef
  /** The line without its channel: "6h10 in project · 9h15 captured · goal 10h", beside a channel chip. */
  amounts: MessageRef
}

function admitsQuality(catalog: Catalog, asset: Asset, bar: Goal["qualityBar"]): boolean | null {
  if (!bar) return true
  const usable = asset.quality.value === "usable" && qualityApplicability(asset) === "applicable"
  if (bar.kind === "usable-only") return usable
  if (bar.kind === "usable-max-fwhm" && !usable) return false
  const record = catalog.measurements[asset.id]
  const fwhm = record && measurementApplies(asset, record) ? record.metrics.find((m) => m.key === "fwhm" && m.unit === "arcsec") : undefined
  if (!fwhm || fwhm.value === null) return null
  return fwhm.value <= bar.maxArcsec
}

function goalMatches(catalog: Catalog, goal: Goal, session: Session, subject: Subject, rigId: OpticalTrainId): boolean {
  if (goalChannel(catalog, session) !== goal.channel) return false
  if (!goal.panelId) return true
  return panelForSession(catalog, subject, session, rigId).panelId === goal.panelId
}

/**
 * Progress of every goal. "in project" counts frames in the latest saved
 * memberships of the Project's runs outside its Trash (each frame once),
 * leaving out run exclusions and rejections, Project-only rejects, Trashed
 * frames and frames the quality bar does not admit. "captured" counts every
 * candidate frame plus those members, Trashed frames aside, so "in project"
 * never exceeds "captured" (D-W66).
 */
export function goalProgress(catalog: Catalog, project: Project): GoalProgress[] {
  const runs = projectRuns(catalog, project.id)
  const candidates = projectCandidates(catalog, project)
  return project.goals.map((goal): GoalProgress => {
    const subject = findSubject(project, goal.subjectId)
    const inProjectIds = new Set<AssetId>()
    const capturedIds = new Set<AssetId>()
    let unknownQuality = 0
    if (subject) {
      for (const run of runs) {
        if (run.subjectId !== subject.id || (goal.panelId && run.panelId !== goal.panelId)) continue
        const revision = latestRevision(run)
        if (!revision) continue
        for (const id of [...revision.included, ...revision.excluded, ...revision.rejected, ...revision.unresolved]) {
          const asset = catalog.assets[id]
          const session = asset?.sessionId ? catalog.sessions[asset.sessionId] : undefined
          if (!asset || asset.trashed || !session || goalChannel(catalog, session) !== goal.channel) continue
          capturedIds.add(id)
          if (!revision.included.includes(id) || id in project.rejections) continue
          const admitted = admitsQuality(catalog, asset, goal.qualityBar)
          if (admitted === null) unknownQuality += 1
          else if (admitted) inProjectIds.add(id)
        }
      }
      for (const candidate of candidates) {
        if (candidate.subject.id !== subject.id || !goalMatches(catalog, goal, candidate.session, subject, candidate.rigId)) continue
        for (const id of liveAssetIds(catalog, candidate.session)) capturedIds.add(id)
      }
    }
    const total = (ids: Set<AssetId>) => {
      const totals = zero()
      for (const id of ids) {
        const asset = catalog.assets[id]
        if (!asset) continue
        totals.frames += 1
        totals.seconds += effectiveExposureS(catalog, asset)
      }
      return totals
    }
    const inProject = total(inProjectIds)
    const captured = total(capturedIds)
    const hasGoal = goal.integrationS !== null || goal.frameCount !== null
    const met = hasGoal && (goal.integrationS === null || inProject.seconds >= goal.integrationS) && (goal.frameCount === null || inProject.frames >= goal.frameCount)
    const hours = goal.integrationS !== null ? verbatim(formatHours(goal.integrationS)) : null
    const frames = goal.frameCount !== null ? framesRef(goal.frameCount) : null
    const target = hours && frames ? msg("domain_goal_target_both", { hours, frames }) : (hours ?? frames)
    const amount = (t: FrameTotals) => (goal.integrationS !== null ? verbatim(formatHours(t.seconds)) : framesRef(t.frames))
    const amounts = target
      ? msg("domain_goal_amounts", { inProject: amount(inProject), captured: amount(captured), target })
      : msg("domain_goal_amounts_no_target", { inProject: amount(inProject), captured: amount(captured) })
    return {
      goal,
      inProject,
      captured,
      unknownQuality,
      met,
      remainingS: goal.integrationS === null ? null : Math.max(0, goal.integrationS - inProject.seconds),
      line: msg("domain_goal_line", { channel: goal.channel, amounts }),
      amounts,
    }
  })
}

/** "1 frame", "1,200 frames". */
function framesRef(count: number): MessageRef {
  return msg("project_frames_count", { count, n: formatCount(count) })
}

export interface ProjectWarning {
  /** Stable per rig, subject, channel and kind of gap. */
  id: string
  kind: "exposure-mismatch" | "missing-calibration"
  rigId: OpticalTrainId
  subjectId: string
  /** The goal channel, or the raw filter when it meets no goal; null without a filter. */
  channel: string | null
  message: MessageRef
}

/**
 * Automatic warnings per rig, subject and channel, from calibration-matching
 * evidence (PRJ-FR-11): an exposure with no compatible dark while darks of
 * other exposures exist (exposure mismatch), or no compatible flat or dark at
 * all (missing calibration). They are not goals and never block a run.
 */
export function projectWarnings(disk: Disk, catalog: Catalog, project: Project): ProjectWarning[] {
  const sources = reusableSources(catalog, disk)
  const seen = new Set<string>()
  const out: ProjectWarning[] = []
  for (const candidate of projectCandidates(catalog, project)) {
    const { session, subject, rigId } = candidate
    // A warning names the goal channel, or the raw filter when it meets no goal.
    const channel = goalChannel(catalog, session) ?? session.channel ?? null
    const channelName = channel === null ? msg("palette_session_no_filter") : verbatim(channel)
    const exposure = sessionExposureS(session)
    const key = `${rigId}|${subject.id}|${channel}|${exposure}`
    if (seen.has(key)) continue
    seen.add(key)
    const darks = candidatesFor(catalog, session, "dark", sources)
    const flats = candidatesFor(catalog, session, "flat", sources)
    const rig = rigRef(catalog, rigId)
    const base = { rigId, subjectId: subject.id, channel }
    if (!darks.some((d) => d.summary.allCompatible)) {
      const sameCamera = darks.filter((d) => d.criteria.every((c) => c.name === "exposure" || c.result === "compatible"))
      if (sameCamera.length > 0) {
        const others = [...new Set(sameCamera.map((d) => d.source.exposureS).filter((e): e is number => e !== null))].sort((a, b) => a - b)
        out.push({
          ...base,
          id: `${key}|dark`,
          kind: "exposure-mismatch",
          message: msg("warning_exposure_mismatch", { rig, channel: channelName, exposure: formatExposure(exposure), others: others.map(formatExposure).join(", ") }),
        })
      } else {
        out.push({ ...base, id: `${key}|dark`, kind: "missing-calibration", message: msg("warning_missing_dark", { rig, channel: channelName, exposure: formatExposure(exposure) }) })
      }
    }
    if (!flats.some((f) => f.summary.allCompatible)) {
      const flatKey = `${rigId}|${subject.id}|${channel}|flat`
      if (!seen.has(flatKey)) {
        seen.add(flatKey)
        out.push({ ...base, id: flatKey, kind: "missing-calibration", message: msg("warning_missing_flat", { rig, channel: channelName }) })
      }
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Run pipeline: six steps, gates and Next (v4's rule, D-W3)
// ---------------------------------------------------------------------------

/**
 * Gate vocabulary: each state has its own glyph shape (`StepGlyph`), so colour only reinforces. The review gate
 * says what it waits for, "Needs review", so it does not read as the Review step's name.
 */
export type GateState = "done" | "ready" | "review" | "blocked" | "running" | "partial" | "idle"

/** The gate word for a state (`gateWord` in app/run-ui words it). */
export const GATE_WORD: Record<GateState, MessageRef> = {
  done: msg("status_done"),
  ready: msg("status_ready"),
  review: msg("status_needs_review"),
  blocked: msg("status_blocked"),
  running: msg("status_running"),
  partial: msg("status_partial"),
  idle: msg("status_not_started"),
}

export interface GateItem {
  label: MessageRef
  /** true met, false blocks, "advisory" informs without blocking. */
  met: boolean | "advisory"
  detail: MessageRef
}

/** A route link a screen can follow; `to` is a registered route pattern. */
export interface StepLink {
  to: string
  params?: Record<string, string>
  search?: Record<string, string>
  /** Element focused after the navigation. */
  focusId?: string
}

/** A run step's gate; its name is `stepName(m, id)`. */
export interface RunStepState {
  id: RunStep
  n: number
  state: GateState
  /** Short status beside the step name, e.g. "Saved r2" or "94 of 208". */
  status: MessageRef
  items: GateItem[]
  link: StepLink
  /** Verb phrase used when this step holds the Next action. */
  nextLabel: MessageRef
}

export interface NextAction {
  label: MessageRef
  reason: MessageRef
  link: StepLink
  step: RunStepState | null
}

/** A run that waits on the user (D-W35, PRJ-FR-18). A run in the Trash is never blocked. */
export interface RunBlocker {
  kind: "unresolved-inputs" | "calibration-review" | "preparation-failed"
  step: RunStep
  message: MessageRef
}

export interface RunPipeline {
  runId: RunId
  status: "open" | "complete" | "trashed"
  steps: RunStepState[]
  current: RunStepState
  next: NextAction | null
  blocker: RunBlocker | null
  calibration: CalibrationPlan
}

export function runStepLink(run: Pick<Run, "id" | "projectId">, step: RunStep, search?: Record<string, string>): StepLink {
  return { to: "/projects/$projectId/runs/$runId/$step", params: { projectId: run.projectId, runId: run.id, step }, search }
}

export function groupStepLink(group: Pick<RunGroup, "id" | "projectId">, step: RunStep): StepLink {
  return { to: "/projects/$projectId/groups/$groupId/$step", params: { projectId: group.projectId, groupId: group.id, step } }
}

export function projectLink(projectId: ProjectId, search?: Record<string, string>): StepLink {
  return { to: "/projects/$projectId", params: { projectId }, search }
}

/** The hash path of a run step, for Activity entries and operation links (the string form of `runStepLink`). */
export function runHref(run: Pick<Run, "id" | "projectId">, step: RunStep = "select"): string {
  return `/projects/${run.projectId}/runs/${run.id}/${step}`
}

/** The hash path of a run group step (the string form of `groupStepLink`). */
export function groupHref(group: Pick<RunGroup, "id" | "projectId">, step: RunStep = "select"): string {
  return `/projects/${group.projectId}/groups/${group.id}/${step}`
}

/** The setup a run uses: its own, or its group's shared setup (D-W38). */
export function runSetup(catalog: Catalog, run: Run): RunSetup {
  if (run.groupId) {
    const group = catalog.runGroups[run.groupId]
    if (group) return group.setup
  }
  return run.setup ?? { profileId: null, inputMode: null, calibrationPolicy: "automatic" }
}

export function runPreparations(catalog: Catalog, runId: RunId): Preparation[] {
  return Object.values(catalog.preparations)
    .filter((p) => p.runId === runId)
    .sort((a, b) => a.prepRevision - b.prepRevision || a.createdAt.localeCompare(b.createdAt))
}

/** Results of a run outside the Trash: candidates and accepted products, intermediates apart. */
export function runResults(catalog: Catalog, runId: RunId): { products: ResultRecord[]; intermediates: ResultRecord[] } {
  const all = Object.values(catalog.results).filter((r) => r.runId === runId && !r.trashed)
  return { products: all.filter((r) => !r.intermediate), intermediates: all.filter((r) => r.intermediate) }
}

/** Unsettled operations that affect a run; Complete and Move to Trash wait for them (RES-FR-07, RES-FR-10). */
export function runOperations(operations: Record<string, Operation>, runId: RunId): Operation[] {
  return Object.values(operations).filter((op) => op.scope.runIds?.includes(runId) && unsettled(op))
}

const blocks = (items: GateItem[]) => items.some((i) => i.met === false)

export function runPipeline(world: World, run: Run): RunPipeline {
  const { catalog, disk, operations } = world
  const content = workingContent(run)
  const latest = latestRevision(run)
  const summary = content ? runSummary(disk, catalog, content) : null
  const included = summary?.included.frames ?? 0
  const unresolved = summary?.unresolved ?? 0
  const selected = content?.sessions.length ?? 0
  const saved = run.draft === null && latest !== null
  const complete = run.completion === "complete"
  const setup = runSetup(catalog, run)
  const refresh = runRefresh(catalog, run)
  const link = (step: RunStep, focusId?: string): StepLink => ({ ...runStepLink(run, step), focusId })
  const STEP = (id: RunStep) => ({ id, n: RUN_STEPS.indexOf(id) + 1 })
  const DASH = verbatim("–")

  // 1 Select: the subject's candidates on the run's rig, saved as a revision.
  // A draft made in Review (frames rejected or restored there) belongs to Review: Select keeps its saved state,
  // and Review reads "2 rejected, unsaved" with Save run in its footer.
  const owner = draftOwner(run)
  const selectSaved = saved || owner === "review"
  const addNew = msg("domain_next_add_new_sessions", { count: refresh.newCandidates.length })
  const selectItems: GateItem[] = [
    {
      label: msg("domain_gate_sessions_selected"),
      met: selected > 0,
      detail: selected > 0 ? joinRefs([msg("location_sessions_count", { count: selected, n: formatCount(selected) }), framesRef(included)], " · ") : msg("domain_gate_no_sessions"),
    },
    {
      label: msg("domain_gate_no_unresolved"),
      met: unresolved === 0,
      detail: unresolved === 0 ? msg("domain_gate_all_readable") : msg("domain_gate_members_unreadable", { count: unresolved, n: formatCount(unresolved) }),
    },
    {
      label: msg("domain_gate_membership_saved"),
      met: owner === "review" ? "advisory" : saved,
      detail: saved
        ? msg("domain_gate_revision_saved", { revision: latest!.revision })
        : owner === "review"
          ? msg("domain_gate_review_unsaved")
          : latest
            ? msg("domain_gate_unsaved_on_revision", { revision: latest.revision })
            : msg("domain_gate_not_saved_yet"),
    },
  ]
  if (refresh.newCandidates.length > 0) selectItems.push({ label: msg("domain_gate_new_candidates"), met: "advisory", detail: addNew })
  if (refresh.noLongerMatching.length > 0) {
    selectItems.push({ label: msg("domain_gate_no_longer_matches"), met: "advisory", detail: msg("domain_gate_members_flagged", { count: refresh.noLongerMatching.length }) })
  }
  const select: RunStepState = {
    ...STEP("select"),
    state: selected === 0 ? (complete ? "done" : "ready") : unresolved > 0 ? "blocked" : !selectSaved ? "review" : "done",
    status:
      selected === 0
        ? msg("run_cal_no_sessions")
        : unresolved > 0
          ? msg("domain_status_unresolved", { count: unresolved })
          : selectSaved && latest
            ? msg("domain_status_saved_revision", { revision: latest.revision })
            : msg("domain_status_unsaved"),
    items: selectItems,
    link: link("select", selected > 0 && !selectSaved && !complete ? "save-run" : undefined),
    nextLabel:
      selected === 0
        ? msg("domain_next_select_sessions")
        : unresolved > 0
          ? msg("domain_next_resolve_inputs")
          : !selectSaved
            ? msg("domain_next_save_run")
            : refresh.newCandidates.length > 0
              ? addNew
              : msg("domain_next_edit_selection"),
  }

  // 2 Review: quality is advisory; measurements inform, never decide. Counts cover the frames Review lists
  // (included, rejected, excluded and unresolved members), so they match its All / Picked / Rejected / Unreviewed filters.
  const decision = runReviewCounts(catalog, run)
  const draftNote = owner === "review" ? reviewDraftNote(run) : null
  const decided = { done: decision.total - decision.unreviewed, total: decision.total }
  const review: RunStepState = {
    ...STEP("review"),
    state: decision.total === 0 ? "idle" : draftNote ? "review" : decision.unreviewed === 0 ? "done" : "review",
    status: decision.total === 0 ? DASH : (draftNote ?? msg("setup_stat_complete_value", decided)),
    items: [
      ...(draftNote ? [{ label: msg("domain_gate_review_saved"), met: false, detail: msg("domain_gate_review_save_detail", { note: draftNote }) } satisfies GateItem] : []),
      { label: msg("domain_gate_frames_reviewed"), met: "advisory", detail: decision.total === 0 ? msg("domain_gate_no_frames") : msg("domain_gate_frames_decided", decided) },
    ],
    link: link("review", draftNote && !complete ? "review-save" : undefined),
    nextLabel: draftNote ? msg("domain_next_save_run") : msg("session_review_frames"),
  }

  // 3 Calibrate: automatic by default; only unmatched or drifted rows need review (D-W5, D-W55).
  const calibration = calibrationPlan(catalog, disk, run, setup.calibrationPolicy, savedContent(run) ?? content)
  const offers = run.masterOffers.filter((o) => o.state === "pending").length
  const needReview = calibration.needsReview.length
  const calibrateItems: GateItem[] = [
    {
      label: msg("domain_gate_calibration_matched"),
      met: setup.calibrationPolicy === "off" || (calibration.rows.length > 0 && needReview === 0),
      detail:
        setup.calibrationPolicy === "off"
          ? msg("domain_gate_policy_off")
          : calibration.rows.length === 0
            ? msg("domain_gate_select_first")
            : needReview === 0
              ? msg("domain_gate_requirements_matched", { count: calibration.rows.length })
              : msg("domain_gate_requirements_need_review", { count: needReview }),
    },
  ]
  if (offers > 0) calibrateItems.push({ label: msg("domain_gate_master_found"), met: "advisory", detail: msg("domain_gate_masters_offered", { count: offers }) })
  const calibrate: RunStepState = {
    ...STEP("calibrate"),
    state: setup.calibrationPolicy === "off" ? "done" : calibration.rows.length === 0 ? "idle" : needReview > 0 ? "blocked" : "done",
    status:
      setup.calibrationPolicy === "off"
        ? msg("run_cal_off")
        : calibration.rows.length === 0
          ? DASH
          : needReview > 0
            ? msg("domain_status_need_review", { count: needReview })
            : msg("run_cal_automatic"),
    items: calibrateItems,
    link: link("calibrate"),
    nextLabel: msg("domain_next_review_matches"),
  }

  // 4 Prepare: the latest preparation revision of the latest membership revision.
  const preparations = runPreparations(catalog, run.id)
  const prep = preparations.at(-1) ?? null
  const prepCurrent = prep && latest && prep.membershipRevision === latest.revision ? prep : null
  const profile = setup.profileId ? catalog.profiles[setup.profileId] : undefined
  const prepareItems: GateItem[] = [
    { label: msg("domain_gate_membership_saved"), met: saved, detail: saved ? msg("domain_gate_revision", { revision: latest!.revision }) : msg("domain_gate_save_first") },
    {
      label: msg("domain_gate_calibration_matched"),
      met: calibrate.state === "done",
      detail: calibrate.state === "done" ? msg("domain_gate_handoff_settled") : msg("domain_gate_requirements_need_review", { count: needReview }),
    },
    { label: msg("domain_gate_profile_chosen"), met: Boolean(profile), detail: profile ? verbatim(profile.name) : msg("domain_gate_choose_profile") },
  ]
  let prepState: GateState
  let prepStatus: MessageRef
  if (prepCurrent?.state === "running" || prepCurrent?.state === "paused") {
    prepState = "running"
    prepStatus = msg("setup_stat_complete_value", { done: prepCurrent.preparedAssetIds.length, total: prepCurrent.entryCount })
  } else if (prepCurrent?.state === "prepared") {
    prepState = prepCurrent.unverified ? "review" : "done"
    prepStatus = prepCurrent.unverified ? msg("status_unverified") : prepCurrent.prepRevision > 1 ? msg("domain_status_prepared_revision", { revision: prepCurrent.prepRevision }) : msg("status_prepared")
  } else if (prepCurrent?.state === "partial") {
    prepState = "partial"
    prepStatus = msg("run_partial_count", { done: prepCurrent.preparedAssetIds.length, total: prepCurrent.entryCount })
    prepareItems.push({ label: msg("domain_gate_all_prepared"), met: false, detail: msg("domain_gate_inputs_not_prepared", { count: prepCurrent.blocked.length, n: formatCount(prepCurrent.blocked.length) }) })
  } else if (prepCurrent?.state === "failed") {
    prepState = "blocked"
    prepStatus = msg("status_failed")
    prepareItems.push({ label: msg("domain_gate_preparation_succeeded"), met: false, detail: msg("domain_gate_last_preparation_failed") })
  } else if (prep && !prepCurrent) {
    prepState = "review"
    prepStatus = msg("domain_status_revision_only", { revision: prep.membershipRevision })
  } else {
    prepState = blocks(prepareItems) ? "idle" : "ready"
    prepStatus = blocks(prepareItems) ? msg("domain_status_to_do", { count: prepareItems.filter((i) => i.met === false).length }) : msg("status_ready")
  }
  if (complete && prepState !== "done") prepState = "done"
  const prepare: RunStepState = {
    ...STEP("prepare"),
    state: prepState,
    status: prepStatus,
    items:
      prepState === "done"
        ? [
            {
              label: msg("domain_gate_run_prepared"),
              met: true,
              detail: prepCurrent ? msg("domain_gate_entries_at", { count: prepCurrent.entryCount, n: formatCount(prepCurrent.entryCount), path: prepCurrent.folderPath }) : msg("domain_gate_complete"),
            },
          ]
        : prepareItems,
    link: link("prepare"),
    nextLabel:
      prepState === "done"
        ? msg("domain_next_open_in_application")
        : prepState === "partial" || prepState === "blocked"
          ? msg("domain_next_resolve_preparation")
          : prepState === "running"
            ? msg("domain_next_watch_preparation")
            : msg("domain_next_review_preparation"),
  }

  // 5 Results: discovered in the recorded Results folder, then accepted (D-W4).
  const { products } = runResults(catalog, run.id)
  const accepted = products.filter((r) => r.acceptance === "accepted").length
  const candidates = products.length - accepted
  const results: RunStepState = {
    ...STEP("results"),
    state: complete ? "done" : prepState !== "done" ? "idle" : candidates > 0 ? "review" : accepted > 0 ? "done" : "ready",
    status: products.length === 0 ? (prepState === "done" ? msg("domain_status_awaiting_outputs") : DASH) : msg("domain_status_accepted_of", { accepted, total: products.length }),
    items: [
      { label: msg("domain_gate_run_prepared"), met: prepState === "done", detail: prepState === "done" ? msg("domain_gate_results_folder") : msg("domain_gate_prepare_first") },
      {
        label: msg("domain_gate_results_accepted"),
        met: "advisory",
        detail: products.length === 0 ? msg("domain_gate_no_outputs") : joinRefs([msg("rungroup_accepted_count", { count: accepted }), msg("rungroup_candidates_count", { count: candidates })], " · "),
      },
    ],
    link: link("results"),
    nextLabel: candidates > 0 ? msg("domain_next_accept_results") : msg("domain_next_look_for_results"),
  }

  // 6 Done: Complete, then Clean up (prepared entries only, D-W26).
  const cleanups = Object.values(operations)
    .filter((op) => op.kind === "cleanup" && op.scope.runIds?.includes(run.id))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const lastCleanup = cleanups[0]
  const cleaning = lastCleanup ? unsettled(lastCleanup) : false
  const cleanedUp = lastCleanup?.status === "succeeded"
  const done: RunStepState = {
    ...STEP("done"),
    state: !complete ? (results.state === "done" ? "ready" : "idle") : cleaning ? "running" : cleanedUp ? "done" : "ready",
    status: !complete ? msg("status_open") : cleaning ? msg("wrapup_cleaning_up") : cleanedUp ? msg("domain_status_cleaned_up") : msg("domain_status_cleanup_available"),
    items: [
      { label: msg("review_run_complete"), met: complete, detail: complete ? msg("domain_gate_cleanup_reviewable") : msg("domain_gate_complete_when_done") },
      { label: msg("domain_gate_cleanup_reviewed"), met: "advisory", detail: cleanedUp ? (lastCleanup?.summary ?? msg("domain_gate_finished")) : msg("domain_gate_cleanup_lists") },
    ],
    link: link("done"),
    nextLabel: !complete ? msg("project_run_complete") : msg("domain_next_clean_up_run"),
  }

  const steps = [select, review, calibrate, prepare, results, done]
  const trashed = run.trashedAt !== null
  // A step that has not started (its prerequisites are missing) never captures Next ahead of an earlier open step.
  // Once Complete, only the Done step (Clean up) can hold Next: earlier gates no longer wait on the user.
  const blocking = complete ? undefined : steps.find((s) => s.state !== "done" && s.state !== "idle" && blocks(s.items))
  const open = complete ? (done.state === "done" ? undefined : done) : (blocking ?? steps.find((s) => s.state !== "done" && s.state !== "idle") ?? steps.find((s) => s.state !== "done"))
  const current = open ?? done
  const next: NextAction | null = trashed || !open ? null : stepAction(open)
  const blocker = trashed || complete ? null : runBlocker(prepare.state, needReview, unresolved, prepCurrent?.state === "partial" ? prepCurrent.blocked.length : 0)
  return { runId: run.id, status: trashed ? "trashed" : complete ? "complete" : "open", steps, current, next, blocker, calibration }
}

function stepReason(step: RunStepState): MessageRef {
  return step.items.find((i) => i.met === false)?.detail ?? step.items.find((i) => i.met === "advisory")?.detail ?? step.status
}

function stepAction(step: RunStepState): NextAction {
  return { step, label: step.nextLabel, reason: stepReason(step), link: step.link }
}

/**
 * The toolbar's Next while the user is on `here`. A Next on another step stands. A Next on this step that
 * focuses a control (Save run) stands too. Otherwise Next never points at the screen it is on: a step whose
 * gate blocks is resolved here, so Next is null (the caption names what blocks); an advisory step (Review)
 * moves on to the first later step that is not done; null when nothing later waits.
 */
export function nextFrom(steps: RunStepState[], next: NextAction | null, here: RunStep | null): NextAction | null {
  if (!next?.step || next.step.id !== here || next.link.focusId) return next
  if (blocks(next.step.items)) return null
  const later = steps.slice(steps.findIndex((s) => s.id === here) + 1).filter((s) => s.state !== "done")
  const following = later.find((s) => s.state !== "idle") ?? later[0]
  return following ? stepAction(following) : null
}

/** Which step made a run's unsaved draft: Review when only its rejections changed (D-W54), else Select. */
function draftOwner(run: Run): "select" | "review" | null {
  if (!run.draft) return null
  const latest = latestRevision(run)
  if (!latest) return "select"
  const same = (a: string[], b: string[]) => a.length === b.length && a.every((id) => b.includes(id))
  const d = run.draft
  const sessionsSame = same(
    d.sessions.map((s) => s.sessionId),
    latest.sessions.map((s) => s.sessionId),
  )
  return sessionsSame && same(d.excluded, latest.excluded) && same(d.unresolved, latest.unresolved) && same(d.productInputs, latest.productInputs) ? "review" : "select"
}

/** "2 rejected, unsaved": what a Review draft changed against the latest revision. */
function reviewDraftNote(run: Run): MessageRef | null {
  const latest = latestRevision(run)
  if (!run.draft || !latest) return null
  const rejected = run.draft.rejected.filter((id) => !latest.rejected.includes(id)).length
  const restored = latest.rejected.filter((id) => !run.draft!.rejected.includes(id)).length
  if (rejected === 0 && restored === 0) return null
  const changes = [rejected > 0 ? msg("domain_review_rejected", { count: rejected }) : null, restored > 0 ? msg("domain_review_restored", { count: restored }) : null].filter((c) => c !== null)
  return msg("domain_review_unsaved", { changes: joinRefs(changes, ", ") })
}

/** Frames a run's Review lists and how many still have no quality decision (Review's Unreviewed filter). */
export function runReviewCounts(catalog: Catalog, run: Run): { total: number; unreviewed: number } {
  const content = workingContent(run)
  const project = catalog.projects[run.projectId] ?? null
  if (!content) return { total: 0, unreviewed: 0 }
  const seen = new Set<AssetId>()
  let unreviewed = 0
  for (const id of [...content.included, ...content.rejected, ...content.excluded, ...content.unresolved]) {
    const asset = catalog.assets[id]
    if (!asset || asset.trashed || seen.has(id)) continue
    seen.add(id)
    const q = frameQuality(asset, project)
    if (q.library !== "usable" && q.library !== "unusable" && !q.projectRejected) unreviewed += 1
  }
  return { total: seen.size, unreviewed }
}

function runBlocker(prepare: GateState, needReview: number, unresolved: number, unprepared: number): RunBlocker | null {
  if (unresolved > 0) return { kind: "unresolved-inputs", step: "select", message: msg("blocker_unreadable_inputs", { count: unresolved, n: formatCount(unresolved) }) }
  if (needReview > 0) return { kind: "calibration-review", step: "calibrate", message: msg("blocker_calibration_review", { count: needReview }) }
  if (prepare === "blocked") return { kind: "preparation-failed", step: "prepare", message: msg("blocker_preparation_failed") }
  if (prepare === "partial") return { kind: "unresolved-inputs", step: "prepare", message: msg("blocker_inputs_not_prepared", { count: unprepared, n: formatCount(unprepared) }) }
  return null
}

/** An unsettled operation that holds a run back: "Prepare M 31 is running". */
function operationHolds(op: Operation): MessageRef {
  if (op.status === "paused") return msg("domain_operation_paused", { title: op.title })
  if (op.status === "interrupted") return msg("domain_operation_interrupted", { title: op.title })
  return msg("domain_operation_running", { title: op.title })
}

/** Why Move to Trash is refused (RES-FR-10): running operations and runs that use one of its accepted Results. */
export function trashRefusals(world: World, run: Run): MessageRef[] {
  const reasons = runOperations(world.operations, run.id).map(operationHolds)
  const accepted = new Set(runResults(world.catalog, run.id).products.filter((r) => r.acceptance === "accepted").map((r) => r.id))
  for (const other of Object.values(world.catalog.runs)) {
    if (other.id === run.id || other.trashedAt) continue
    const inputs = workingContent(other)?.productInputs ?? []
    if (inputs.some((id) => accepted.has(id))) reasons.push(msg("domain_refusal_uses_result", { name: other.name }))
  }
  return reasons
}

/** Why Complete is refused (RES-FR-07): a running preparation or storage operation affecting the run. */
export function completeRefusals(world: World, run: Run): MessageRef[] {
  return runOperations(world.operations, run.id).map(operationHolds)
}

/** Mark Done names each run outside the Trash that is not Complete (PRJ-FR-14). */
export function markDoneBlockers(catalog: Catalog, project: Project): Run[] {
  return projectRuns(catalog, project.id).filter((r) => r.completion !== "complete")
}

// ---------------------------------------------------------------------------
// Run groups (D-W38, D-W41, D-W73, D-W75)
// ---------------------------------------------------------------------------

export interface GroupPanelState {
  panel: MosaicPanel
  run: Run
  /** A trashed panel run stays listed as Trashed; its frames leave every group count (D-W75). */
  trashed: boolean
  pipeline: RunPipeline
}

export interface GroupPipeline {
  group: RunGroup
  panels: GroupPanelState[]
  /** Group steps: each the worst gate over the panels outside the Trash. */
  steps: RunStepState[]
  /** Open on the group folder only when every live panel is prepared and verified (PREP-FR-13). */
  allVerified: boolean
  next: NextAction | null
}

const GATE_ORDER: GateState[] = ["blocked", "partial", "review", "running", "ready", "idle", "done"]

export function groupPipeline(world: World, group: RunGroup): GroupPipeline {
  const { catalog } = world
  const project = catalog.projects[group.projectId]
  const subject = project ? findSubject(project, group.subjectId) : undefined
  const panels: GroupPanelState[] = []
  for (const runId of group.runIds) {
    const run = catalog.runs[runId]
    const panel = findPanel(subject, run?.panelId ?? null)
    if (!run || !panel) continue
    panels.push({ panel, run, trashed: run.trashedAt !== null, pipeline: runPipeline(world, run) })
  }
  const live = panels.filter((p) => !p.trashed)
  const steps = RUN_STEPS.map((id, index): RunStepState => {
    const states = live.map((p) => p.pipeline.steps[index]!)
    const state = live.length === 0 ? "idle" : states.every((s) => s.state === "done") ? "done" : (GATE_ORDER.find((g) => g !== "done" && states.some((s) => s.state === g)) ?? "idle")
    const doneCount = states.filter((s) => s.state === "done").length
    return {
      id,
      n: index + 1,
      state,
      status: live.length === 0 ? verbatim("–") : msg("domain_panels_done", { done: doneCount, count: live.length }),
      items: states.flatMap((s, i) => s.items.map((item) => ({ ...item, label: joinRefs([panelRef(live[i]!.panel), item.label], ": ") }))),
      link: groupStepLink(group, id),
      nextLabel: id === "review" ? msg("rungroup_review_all") : id === "prepare" ? msg("domain_next_prepare_all") : (states.find((s) => s.state !== "done")?.nextLabel ?? STEP_NAME[id]),
    }
  })
  const allVerified = live.length > 0 && live.every((p) => p.pipeline.steps[3]!.state === "done")
  const blocking = steps.find((s) => s.state === "blocked" || s.state === "partial")
  const open = blocking ?? steps.find((s) => s.state !== "done" && s.state !== "idle") ?? steps.find((s) => s.state !== "done")
  // The reason names the first panel that holds the step back, e.g. "Panel 2: 30 inputs could not be prepared."
  const holder = open ? live.find((p) => p.pipeline.steps[open.n - 1]!.state === open.state) : undefined
  const next = open ? { step: open, label: open.nextLabel, reason: holder ? joinRefs([panelRef(holder.panel), stepReason(holder.pipeline.steps[open.n - 1]!)], ": ") : open.status, link: open.link } : null
  return { group, panels, steps, allVerified, next }
}

// ---------------------------------------------------------------------------
// Home (D-W35, D-W39, D-W48, PRJ-FR-17 to PRJ-FR-19)
// ---------------------------------------------------------------------------

/** Sessions that are candidates or members of at least one Project (any state). */
function sessionsInProjects(catalog: Catalog): Set<SessionId> {
  const ids = new Set<SessionId>()
  for (const project of Object.values(catalog.projects)) {
    for (const c of projectCandidates(catalog, project)) ids.add(c.session.id)
    for (const id of projectMemberSessionIds(catalog, project.id)) ids.add(id)
  }
  return ids
}

export interface SessionsNeedingWork {
  /** No confirmed Target (LIB-FR-17). */
  needsTarget: Session[]
  /** A confirmed Target but no Project's candidate or member. */
  notInProject: Session[]
  /** Candidates of open Projects with Unreviewed frames. */
  unreviewed: Array<{ session: Session; projectId: ProjectId; frames: number }>
  /** Candidates of a Project that are members of none of its runs (PRJ-FR-19). */
  readyToAdd: Array<{ session: Session; projectId: ProjectId }>
}

function unreviewedFrames(catalog: Catalog, session: Session): number {
  return liveAssetIds(catalog, session).filter((id) => {
    const asset = catalog.assets[id]!
    return asset.quality.value === "unreviewed" || qualityApplicability(asset) !== "applicable"
  }).length
}

export function sessionsNeedingWork(catalog: Catalog): SessionsNeedingWork {
  const live = liveLightSessions(catalog)
  const inProjects = sessionsInProjects(catalog)
  const out: SessionsNeedingWork = { needsTarget: [], notInProject: [], unreviewed: [], readyToAdd: [] }
  for (const session of live) {
    if (!sessionTargetId(session)) out.needsTarget.push(session)
    else if (!inProjects.has(session.id)) out.notInProject.push(session)
  }
  for (const project of Object.values(catalog.projects)) {
    if (project.state !== "open") continue
    const members = projectMemberSessionIds(catalog, project.id)
    for (const { session } of projectCandidates(catalog, project)) {
      const frames = unreviewedFrames(catalog, session)
      if (frames > 0) out.unreviewed.push({ session, projectId: project.id, frames })
      if (!members.has(session.id)) out.readyToAdd.push({ session, projectId: project.id })
    }
  }
  return out
}

/** The one default site (Settings › Sites); null with no sites. */
export function defaultSite(world: Pick<World, "catalog" | "settings">): ObservingSite | null {
  const id = world.settings.defaultSiteId
  return id ? (world.catalog.sites[id] ?? null) : null
}

/** Planning site for Plan and Tonight: the one picked there, else the default; null (or the "no site" prototype toggle) shows "Add an observing site in Settings". */
export function planningSite(world: Pick<World, "catalog" | "settings" | "faults">): ObservingSite | null {
  if (world.faults.noSite) return null
  const picked = world.settings.planningSiteId ? world.catalog.sites[world.settings.planningSiteId] : undefined
  return picked ?? defaultSite(world)
}

/**
 * A Project's one Next action, the first rule that applies (D-W35, PRJ-FR-18):
 * 1. its candidates have Unreviewed frames: "Review N new frames";
 * 2. one of its runs is blocked: that run at its blocked step;
 * 3. every run is Complete: "Wrap up" (P-WRAP1), until its steps are done or skipped;
 * 4. a goal is unmet in project and tonight has a window for that subject: "Plan tonight";
 * 5. otherwise "Start a processing run".
 * A Done Project has no Next.
 */
export function projectNext(world: World, project: Project, nowMs: number): NextAction | null {
  const { catalog } = world
  if (project.state === "done") return null
  const candidates = projectCandidates(catalog, project)
  const unreviewed = candidates.reduce((n, c) => n + unreviewedFrames(catalog, c.session), 0)
  const runs = projectRuns(catalog, project.id)
  if (unreviewed > 0) {
    // A run's Review lists only its members, so new candidates are reviewed in the Project's candidate review (PIX-FR-18).
    return {
      label: msg("domain_next_review_new_frames", { count: unreviewed, n: formatCount(unreviewed) }),
      reason: msg("domain_reason_candidates_unreviewed"),
      link: projectLink(project.id, { candidates: "unreviewed" }),
      step: null,
    }
  }
  for (const run of runs) {
    const { blocker, steps } = runPipeline(world, run)
    if (blocker) {
      return {
        label: msg("activity_open_destination", { name: run.name }),
        reason: msg("domain_reason_step_blocker", { step: STEP_NAME[blocker.step], message: blocker.message }),
        link: runStepLink(run, blocker.step),
        step: steps.find((s) => s.id === blocker.step) ?? null,
      }
    }
  }
  const wrapUp = projectWrapUp(catalog, project)
  if (wrapUp.available) {
    const step = wrapUp.steps.find((s) => s.id === wrapUp.current)
    return {
      label: msg("wrapup_action"),
      reason: step ? msg("domain_reason_wrap_up_next", { step: step.label }) : msg("domain_reason_wrap_up_settled"),
      link: projectLink(project.id, { stage: "wrap-up" }),
      step: null,
    }
  }
  const site = planningSite(world)
  if (site) {
    const unmet = goalProgress(catalog, project).filter((g) => !g.met)
    for (const progress of unmet) {
      const subject = findSubject(project, progress.goal.subjectId)
      const centre = subject ? subjectCentre(catalog, subject) : null
      const target = subject ? subjectTarget(catalog, subject) : undefined
      if (!centre || !target) continue
      if (bestWindowTonight({ ...target, ...centre }, site, defaultCriteria(site), nowMs)) {
        return {
          label: msg("target_plan_tonight"),
          reason: msg("domain_reason_window_tonight", { line: progress.line, subject: subjectRef(catalog, subject!) }),
          link: { to: "/plan", search: { project: project.id } },
          step: null,
        }
      }
    }
  }
  return { label: msg("domain_next_start_run"), reason: msg("domain_reason_choose_subject_rig"), link: projectLink(project.id, { start: "run" }), step: null }
}

/** Stage for Home and the Projects list: a held-up run first ("Partial at Prepare", the rail's gate word), else the least advanced open run. */
export function projectStage(world: World, project: Project): { label: MessageRef; step: RunStep | null; state: GateState } {
  if (project.state === "done") return { label: project.archive ? msg("status_archived") : msg("status_done"), step: null, state: "done" }
  const runs = projectRuns(world.catalog, project.id)
  if (runs.length === 0) return { label: msg("project_no_runs"), step: null, state: "idle" }
  const pipelines = runs.map((run) => runPipeline(world, run))
  const blocked = pipelines.find((p) => p.blocker)
  const held = blocked?.blocker ? blocked.steps.find((s) => s.id === blocked.blocker!.step) : undefined
  if (held) return { label: msg("domain_stage_held_at", { gate: GATE_WORD[held.state], step: STEP_NAME[held.id] }), step: held.id, state: held.state }
  const open = pipelines.filter((p) => p.status === "open").sort((a, b) => a.current.n - b.current.n)[0]
  if (open) return { label: STEP_NAME[open.current.id], step: open.current.id, state: open.current.state }
  return { label: msg("wrapup_action"), step: null, state: "ready" }
}

// ---------------------------------------------------------------------------
// Wrap up and archive destinations (P-WRAP1, P-ARC1)
// ---------------------------------------------------------------------------

/** Archive locations that can take an archive: role Archive and not retired, the Default first. */
export function archiveLocations(world: Pick<World, "catalog" | "settings">): Location[] {
  const def = world.settings.defaultArchiveLocationId
  return Object.values(world.catalog.locations)
    .filter((l) => l.role === "archive" && !l.retiredAt)
    .sort((a, b) => Number(b.id === def) - Number(a.id === def) || a.displayName.localeCompare(b.displayName))
}

/** The Default archive location: the one Settings marks, else the first archive location. */
export function defaultArchiveLocation(world: Pick<World, "catalog" | "settings">): Location | null {
  return archiveLocations(world)[0] ?? null
}

/** Where a Project archives to (P-ARC1): its own choice while that location can take an archive, else the Default. */
export function archiveDestination(world: Pick<World, "catalog" | "settings">, project: Project): Location | null {
  const own = project.archiveLocationId ? world.catalog.locations[project.archiveLocationId] : undefined
  if (own && own.role === "archive" && !own.retiredAt) return own
  return defaultArchiveLocation(world)
}

export interface WrapUpStep {
  id: WrapUpStepId
  label: MessageRef
  state: "todo" | "done" | "skipped"
  at: IsoDateTime | null
}

export interface ProjectWrapUp {
  /** Every run outside the Trash is Complete and the Project is open (P-WRAP1). */
  available: boolean
  /** Runs that keep Wrap up unavailable: those not Complete. */
  waitingOn: Run[]
  steps: WrapUpStep[]
  /** The first step still to do; null once each is done or skipped (Done is next). */
  current: WrapUpStepId | null
}

/**
 * The Project's Wrap up stage: Clean up runs, Trash (rejects, intermediates,
 * duplicates) and Archive, each optional and skippable, then Done. A run's own
 * Clean up stays on its Done step; sizes come from `preparationFootprint`
 * (storage.ts) and the slice's trash and archive plans.
 */
export function projectWrapUp(catalog: Catalog, project: Project): ProjectWrapUp {
  const runs = projectRuns(catalog, project.id)
  const waitingOn = runs.filter((r) => r.completion !== "complete")
  const steps = WRAP_UP_STEPS.map((id): WrapUpStep => {
    const record = project.wrapUp[id]
    return { id, label: WRAP_UP_NAME[id], state: record?.state ?? "todo", at: record?.at ?? null }
  })
  return {
    available: project.state === "open" && runs.length > 0 && waitingOn.length === 0,
    waitingOn,
    steps,
    current: steps.find((s) => s.state === "todo")?.id ?? null,
  }
}

export type ProjectStageId = "open" | "runs" | "wrap-up" | "done" | "archived"

/**
 * The Project header's stage strip: Open → Runs → Wrap up → Done (or
 * Archived). Earlier stages read done, the current one current.
 */
export function projectStageStrip(catalog: Catalog, project: Project): { current: ProjectStageId; stages: Array<{ id: ProjectStageId; label: MessageRef; state: "done" | "current" | "todo" }> } {
  const runs = projectRuns(catalog, project.id)
  const current: ProjectStageId =
    project.state === "done" ? (project.archive ? "archived" : "done") : runs.length === 0 ? "open" : projectWrapUp(catalog, project).available ? "wrap-up" : "runs"
  const order: ProjectStageId[] = ["open", "runs", "wrap-up", current === "archived" ? "archived" : "done"]
  const label: Record<ProjectStageId, MessageRef> = { open: msg("status_open"), runs: msg("common_runs"), "wrap-up": msg("wrapup_action"), done: msg("status_done"), archived: msg("status_archived") }
  const at = order.indexOf(current)
  return { current, stages: order.map((id, i) => ({ id, label: label[id], state: i < at ? "done" : i === at ? "current" : "todo" })) }
}

/** Home's Target status: unmet goals of open Projects and what each channel still needs in project. */
export function targetStatus(catalog: Catalog): Array<{ project: Project; subject: Subject; progress: GoalProgress }> {
  const out: Array<{ project: Project; subject: Subject; progress: GoalProgress }> = []
  for (const project of Object.values(catalog.projects)) {
    if (project.state !== "open") continue
    for (const progress of goalProgress(catalog, project)) {
      const subject = findSubject(project, progress.goal.subjectId)
      if (subject && !progress.met) out.push({ project, subject, progress })
    }
  }
  return out
}

/** Home's running work: every unsettled operation, newest first. */
export function runningWork(operations: Record<string, Operation>): Operation[] {
  return Object.values(operations)
    .filter(unsettled)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

// ---------------------------------------------------------------------------
// Targets: My targets, Fit and the band strip (D-W18, D-W23, D-W60 to D-W62)
// ---------------------------------------------------------------------------

/** My targets: ★ favourites plus every subject of an open Project, with its Project badges (D-W60). */
export function myTargets(catalog: Catalog): Array<{ target: Target; projects: Project[] }> {
  const out = new Map<string, { target: Target; projects: Project[] }>()
  for (const target of Object.values(catalog.targets)) if (target.favourite) out.set(target.id, { target, projects: [] })
  for (const project of Object.values(catalog.projects)) {
    if (project.state !== "open") continue
    for (const subject of project.subjects) {
      const target = catalog.targets[subject.targetId]
      if (!target) continue
      const entry = out.get(target.id) ?? { target, projects: [] }
      if (!entry.projects.includes(project)) entry.projects.push(project)
      out.set(target.id, entry)
    }
  }
  return [...out.values()].sort((a, b) => a.target.name.localeCompare(b.target.name))
}

export interface Fit {
  kind: "fits" | "panels" | "tiny" | "unknown"
  /** Fields needed; 1 when it fits. */
  panels: number
  /** The Target's major axis as a share of the field's shorter side. */
  coverage: number | null
  /** "fits (60%)", "3 panels", "tiny" or "–". */
  label: MessageRef
  /** Why Fit is unknown: "Size unknown" or "Field of view unknown". */
  reason: MessageRef | null
}

/** Fit of a Target on one rig (PLAN-TGT-FR-11). */
export function targetFit(catalog: Catalog, target: Target, rigId: OpticalTrainId): Fit {
  const rig = catalog.opticalTrains[rigId]
  const fov = rig ? rigFieldOfView(catalog, rig) : null
  if (!target.sizeDeg) return { kind: "unknown", panels: 0, coverage: null, label: verbatim("–"), reason: msg("target_size_unknown") }
  if (!fov) return { kind: "unknown", panels: 0, coverage: null, label: verbatim("–"), reason: msg("domain_fov_unknown") }
  const major = Math.max(target.sizeDeg.width, target.sizeDeg.height)
  const minor = Math.min(target.sizeDeg.width, target.sizeDeg.height)
  const long = Math.max(fov.widthDeg, fov.heightDeg)
  const short = Math.min(fov.widthDeg, fov.heightDeg)
  const coverage = major / short
  const panels = Math.ceil(major / long) * Math.ceil(minor / short)
  if (panels > 1) return { kind: "panels", panels, coverage, label: msg("project_panels", { count: panels }), reason: null }
  if (coverage < 0.25) return { kind: "tiny", panels: 1, coverage, label: msg("fit_tiny"), reason: null }
  return { kind: "fits", panels: 1, coverage, label: msg("fit_fits", { percent: Math.round(coverage * 100) }), reason: null }
}

/** Fits nicely: coverage of 25% to 90% of the field (PLAN-TGT-FR-12). */
export function fitsNicely(fit: Fit): boolean {
  return fit.kind === "fits" && fit.coverage !== null && fit.coverage >= 0.25 && fit.coverage <= 0.9
}

/** Mosaic candidates: Targets that need 2 or more panels (PLAN-TGT-FR-12). */
export function isMosaicCandidate(fit: Fit): boolean {
  return fit.kind === "panels" && fit.panels >= 2
}

/** The Plan list (Planning): Targets the user added, by name. "Show all" lists My targets instead. */
export function planList(catalog: Catalog): Target[] {
  return Object.values(catalog.plans)
    .filter((p) => p.planned)
    .map((p) => catalog.targets[p.targetId])
    .filter((t): t is Target => t !== undefined)
    .sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Which filters are good for a Target on a night ("good tonight"): per band,
 * whether a window of the minimum duration meets that band's Moon constraint
 * (`settings.moonConstraints`), with the Moon separation and illumination at
 * the Target's best sample. `bands` defaults to the seven-band strip; pass a
 * rig's bands (`rigBands`) for its filters. Empty without a planning site.
 */
export function goodTonight(world: Pick<World, "catalog" | "settings" | "faults">, target: Target, night: NightDate, bands: Band[] = BANDS): FilterTonight[] {
  const site = planningSite(world)
  if (!site) return []
  return filterSuitability(target, site, night, defaultCriteria(site), world.settings.moonConstraints, bands)
}

/**
 * A Project's goal set: one value per channel (its first goal for that
 * channel), the shape a newly added subject copies. Replaces the stored
 * template attribution ("Applied in" is gone; templates are only copied).
 */
export function projectGoalSet(project: Project): GoalTemplateValue[] {
  const seen = new Map<GoalChannel, GoalTemplateValue>()
  for (const goal of project.goals) {
    if (!seen.has(goal.channel)) seen.set(goal.channel, { channel: goal.channel, integrationS: goal.integrationS, frameCount: goal.frameCount, qualityBar: goal.qualityBar })
  }
  return [...seen.values()]
}

// ---------------------------------------------------------------------------
// Availability shorthand used by run steps
// ---------------------------------------------------------------------------

/** Frames of a content that cannot be read now, by asset id. */
export function unavailableMembers(disk: Disk, catalog: Catalog, content: MembershipContent): AssetId[] {
  return [...content.included, ...content.unresolved].filter((id) => {
    const asset = catalog.assets[id]
    return asset ? assetAvailability(disk, catalog, asset) !== "available" : true
  })
}
