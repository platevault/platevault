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
import { calibrationPlan, type CalibrationPlan, handoffCalibration, handsOff, KIND_NAME, masterAge } from "./calibration"
import { CALIBRATION_STEPS, stackRefusals } from "./calibration-process"
import { latestCorrection } from "./corrections"
import { filesUnder, volumeForPath } from "./disk"
import { BANDS, isGoalChannel, NARROW_BANDS, RUN_STEPS, STEP_NAME, WRAP_UP_NAME, WRAP_UP_STEPS } from "./labels"
import {
  assetAvailability,
  coverageFraction,
  effectiveExposureS,
  type Footprint,
  type FrameTotals,
  measurementApplies,
  qualityApplicability,
  sessionFootprint,
} from "./library"
import { memberSessions, runSummary, sessionExposureS, sessionRef } from "./membership"
import { bestWindowTonight, defaultCriteria, filterSuitability, type FilterTonight } from "./planning"
import { angularSeparationDeg, type FieldOfView, fieldOfView } from "./sky"
import { goalMeasure, type GoalMeasure, type NamingValues, namingValues } from "./templates"
import type {
  AppSettings,
  Asset,
  AssetId,
  Band,
  CameraKind,
  ApplicationProfile,
  CalibrationMaster,
  CalibrationProcess,
  CalibrationProcessId,
  CalibrationStepId,
  Catalog,
  CorrectionField,
  MasterId,
  MetadataDecision,
  ProfileId,
  RunFlowStepId,
  WrapUpStepRecord,
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
import { fileName, formatCount } from "@/lib/format"
import { joinRefs, type MessageRef, type Messages, msg, nightRef, say, verbatim } from "@/lib/i18n"

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

/** The header's StatusBadge word (C2, D10): Open, Closed, or Archived (Closed with an Archive). */
export const PROJECT_STATUS_NAME: Record<ProjectStatus, MessageRef> = { open: msg("status_open"), done: msg("status_closed"), archived: msg("status_archived") }

export type ProjectTabId = "runs" | "wrap-up"

export interface ProjectTabs {
  status: ProjectStatus
  tabs: Array<{ id: ProjectTabId; label: MessageRef; count: number | null }>
  /** Wrap up's EmptyState until every run is Finished or Trashed (§5.5); null once Wrap up is available or the Project is closed. */
  wrapUpUnavailable: FlowGate | null
}

/**
 * The Project page's StatusBadge and its two tabs, Runs and Wrap up (D10, §5.7),
 * in place of the stage strip (`projectStageStrip`). Runs counts the runs
 * outside the Trash; Wrap up reads its one line until it is available.
 */
export function projectTabs(world: World, project: Project): ProjectTabs {
  const wrapUp = wrapUpFlowState(world, project)
  return {
    status: projectStatus(project),
    tabs: [
      { id: "runs", label: msg("common_runs"), count: projectRuns(world.catalog, project.id).length },
      { id: "wrap-up", label: msg("wrapup_action"), count: null },
    ],
    wrapUpUnavailable: wrapUp.unavailable,
  }
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

/**
 * Sessions the candidate rule matches, reviewed or not: what a goal's
 * "captured" counts and what a Project's review queue draws on. Only the
 * Ready ones are candidates (`projectCandidates`, P-REV2).
 */
export function projectMatches(catalog: Catalog, project: Project): Candidate[] {
  const out: Candidate[] = []
  for (const session of liveLightSessions(catalog)) {
    const subject = candidateSubject(catalog, project, session)
    if (!subject) continue
    const rigId = sessionRigId(session)!
    out.push({ session, subject, rigId, reason: msg("domain_candidate_reason", { target: subjectRef(catalog, subject), rig: rigRef(catalog, rigId) }) })
  }
  return out.sort((a, b) => a.session.night.localeCompare(b.session.night) || (a.session.channel ?? "").localeCompare(b.session.channel ?? ""))
}

/** Candidates (D2, P-REV2): matching sessions that are fully reviewed. Only they join a run; the rest wait in the review queue. */
export function projectCandidates(catalog: Catalog, project: Project): Candidate[] {
  return projectMatches(catalog, project).filter((c) => sessionReadiness(catalog, c.session) === "ready")
}

/** Matching sessions that still need review before they can join a run: "3 sessions need review ▸" (C14). */
export function projectSessionsNeedingReview(catalog: Catalog, project: Project): Candidate[] {
  return projectMatches(catalog, project).filter((c) => sessionReadiness(catalog, c.session) !== "ready")
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

/** Matches of the run's subject on the run's rig; a panel run's, by pointing (D-W49, D-W38). */
function forRun(catalog: Catalog, run: Run, matches: Candidate[]): Candidate[] {
  return matches.filter((c) => {
    if (c.subject.id !== run.subjectId || c.rigId !== run.rigId) return false
    if (!run.panelId) return true
    return panelForSession(catalog, c.subject, c.session, run.rigId).panelId === run.panelId
  })
}

/** The run's candidates: the subject's Ready candidates on the run's rig; a panel run's, by pointing (D-W49, D-W38, D2). */
export function runCandidates(catalog: Catalog, run: Run): Candidate[] {
  const project = catalog.projects[run.projectId]
  return project ? forRun(catalog, run, projectCandidates(catalog, project)) : []
}

/** Sessions that would be the run's candidates once reviewed: Select's "N sessions need review ▸" (C14). */
export function runSessionsNeedingReview(catalog: Catalog, run: Run): Candidate[] {
  const project = catalog.projects[run.projectId]
  return project ? forRun(catalog, run, projectSessionsNeedingReview(catalog, project)) : []
}

export interface SessionGeometry {
  /** Separation of the session's pointing from the Target (a panel run: its panel's centre); null without pointing. */
  distanceDeg: number | null
  /** Fraction (0-1) of the framing the session's footprint covers: the panel, else the Target's extent, else the rig's field centred on the Target. Null without a qualified footprint (D01). */
  coverage: number | null
}

/** Select's sky tools (spec 066): distance from the Target and footprint coverage, from qualified geometry only. */
export function runSessionGeometry(catalog: Catalog, run: Run, session: Session): SessionGeometry {
  const project = catalog.projects[run.projectId]
  const subject = project ? findSubject(project, run.subjectId) : undefined
  const panel = findPanel(subject, run.panelId)
  const centre = panel ?? (subject ? subjectCentre(catalog, subject) : null)
  if (!centre || !session.pointing) return { distanceDeg: null, coverage: null }
  const distanceDeg = angularSeparationDeg(session.pointing.ra, session.pointing.dec, centre.ra, centre.dec)
  const rig = catalog.opticalTrains[run.rigId]
  const fov = rig ? rigFieldOfView(catalog, rig) : null
  const target = subject ? subjectTarget(catalog, subject) : undefined
  const region: Footprint | null = panel
    ? fov && { ra: panel.ra, dec: panel.dec, widthDeg: fov.widthDeg, heightDeg: fov.heightDeg, rotationDeg: panel.rotationDeg }
    : target?.sizeDeg
      ? { ra: centre.ra, dec: centre.dec, widthDeg: target.sizeDeg.width, heightDeg: target.sizeDeg.height, rotationDeg: 0 }
      : fov && { ra: centre.ra, dec: centre.dec, widthDeg: fov.widthDeg, heightDeg: fov.heightDeg, rotationDeg: 0 }
  const footprint = sessionFootprint(catalog, session)
  return { distanceDeg, coverage: region && footprint ? coverageFraction(region, [footprint]) : null }
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
  /** @deprecated P-REJ2 dropped Project-only rejects: always false. W3 removes the readers (d-review), W4 the field. */
  projectRejected: false
  trashed: boolean
}

/** Library quality as it applies to the frame's current bytes. Reject is library-wide (P-REJ2); `project` is unused and goes in W4. */
export function frameQuality(asset: Asset, _project?: Project | null): FrameQuality {
  const applicability = qualityApplicability(asset)
  return {
    library: applicability === "applicable" ? asset.quality.value : applicability,
    projectRejected: false,
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
  /** The goal's one unit, its amount and what remains, in that unit (C7, `goalMeasure` in templates.ts). */
  measure: GoalMeasure
  /**
   * Integration still needed in project; null without an integration goal.
   * @deprecated Use `measure.remaining`, counted in `measure.unit`, so frame goals have one too (C7); W3 pages migrate.
   */
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
 * leaving out run exclusions and rejections, Trashed
 * frames and frames the quality bar does not admit. "captured" counts every
 * candidate frame plus those members, Trashed frames aside, so "in project"
 * never exceeds "captured" (D-W66).
 */
export function goalProgress(catalog: Catalog, project: Project): GoalProgress[] {
  const runs = projectRuns(catalog, project.id)
  const candidates = projectMatches(catalog, project)
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
          if (!revision.included.includes(id)) continue
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
    const measure = goalMeasure(goal, inProject, captured)
    const amount = (n: number) => (measure.unit === "time" ? verbatim(formatHours(n)) : framesRef(n))
    const amounts =
      measure.target !== null
        ? msg("domain_goal_amounts", { inProject: amount(measure.inProject), captured: amount(measure.captured), target: amount(measure.target) })
        : msg("domain_goal_amounts_no_target", { inProject: amount(measure.inProject), captured: amount(measure.captured) })
    return {
      goal,
      inProject,
      captured,
      unknownQuality,
      met: measure.met,
      measure,
      remainingS: measure.unit === "time" ? measure.remaining : null,
      line: msg("domain_goal_line", { channel: goal.channel, amounts }),
      amounts,
    }
  })
}

/** "1 frame", "1,200 frames". */
function framesRef(count: number): MessageRef {
  return msg("project_frames_count", { count, n: formatCount(count) })
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

/** The Prepare step's Prepare… button, which a ready run's Next focuses. */
export const PREPARE_BUTTON_ID = "prepare-start"

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

/**
 * A run's status in the one run vocabulary (round 5): Trashed or Complete,
 * else the gate word of the step it is at ("Blocked", "Partial"). The run
 * header, a group's panels and the Project's Runs table all show it, so the
 * same run reads the same everywhere.
 */
export type RunState = GateState | "complete" | "trashed"

export interface RunStatus {
  state: RunState
  /** The step it is at: where it is held, else its first step not done; Restore and Reopen return there. */
  step: RunStep
}

export function runStatus(pipeline: Pick<RunPipeline, "status" | "current">): RunStatus {
  return { state: pipeline.status === "open" ? pipeline.current.state : pipeline.status, step: pipeline.current.id }
}

/** When a run last changed: created, edited, saved, prepared, a Result accepted, Completed or Trashed. */
export function runUpdatedAt(catalog: Catalog, run: Run): IsoDateTime {
  const times = [
    run.draft?.updatedAt,
    run.completedAt,
    run.trashedAt,
    ...run.revisions.map((r) => r.savedAt),
    ...runPreparations(catalog, run.id).flatMap((p) => [p.createdAt, p.settledAt]),
    ...Object.values(catalog.results).flatMap((r) => (r.runId === run.id ? [r.acceptedAt] : [])),
  ]
  return times.reduce<IsoDateTime>((latest, t) => (t && t > latest ? t : latest), run.createdAt)
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

/** Results of a run outside the Trash: candidate, accepted and rejected products, intermediates apart. */
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

  // 3 Calibrate: automatic by default; only unmatched or drifted rows need review (D-W5, D-W55). With the
  // policy off compatible masters wait as Suggested and hold nothing back; a drifted accepted input still does.
  const calibration = calibrationPlan(catalog, disk, run, setup.calibrationPolicy, savedContent(run) ?? content)
  const off = setup.calibrationPolicy === "off"
  const offers = run.masterOffers.filter((o) => o.state === "pending").length
  const needReview = calibration.needsReview.length
  const calibrateItems: GateItem[] = [
    {
      label: msg("domain_gate_calibration_matched"),
      met: needReview === 0 && (off || calibration.rows.length > 0),
      detail:
        needReview > 0
          ? msg("domain_gate_requirements_need_review", { count: needReview })
          : off
            ? msg("domain_gate_policy_off")
            : calibration.rows.length === 0
              ? msg("domain_gate_select_first")
              : msg("domain_gate_requirements_matched", { count: calibration.rows.length }),
    },
  ]
  if (offers > 0) calibrateItems.push({ label: msg("domain_gate_master_found"), met: "advisory", detail: msg("domain_gate_masters_offered", { count: offers }) })
  // A Complete run's calibration is what it recorded (`calibrationPlan`): none of it needs review.
  const calibrate: RunStepState = {
    ...STEP("calibrate"),
    state: needReview > 0 ? "blocked" : off ? "done" : calibration.rows.length === 0 ? "idle" : "done",
    status:
      needReview > 0
        ? msg("domain_status_need_review", { count: needReview })
        : off
          ? msg("run_cal_off")
          : calibration.rows.length === 0
            ? DASH
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
    // Ready: the step's own Prepare… button is the action, so Next focuses it on every page (the same Next everywhere).
    link: link("prepare", prepState === "ready" ? PREPARE_BUTTON_ID : undefined),
    nextLabel:
      prepState === "done"
        ? msg("domain_next_open_in_application")
        : prepState === "partial" || prepState === "blocked"
          ? msg("domain_next_resolve_preparation")
          : prepState === "running"
            ? msg("domain_next_watch_preparation")
            : prepState === "ready"
              ? msg("domain_next_prepare_run")
              : msg("domain_next_review_preparation"),
  }

  // 5 Results: discovered in the recorded Results folder, then accepted or rejected (D-W4).
  const { products } = runResults(catalog, run.id)
  const accepted = products.filter((r) => r.acceptance === "accepted").length
  const rejected = products.filter((r) => r.acceptance === "rejected").length
  const candidates = products.length - accepted - rejected
  const results: RunStepState = {
    ...STEP("results"),
    state: complete ? "done" : prepState !== "done" ? "idle" : candidates > 0 ? "review" : accepted + rejected > 0 ? "done" : "ready",
    status: products.length === 0 ? (prepState === "done" ? msg("domain_status_awaiting_outputs") : DASH) : msg("domain_status_accepted_of", { accepted, total: products.length }),
    items: [
      { label: msg("domain_gate_run_prepared"), met: prepState === "done", detail: prepState === "done" ? msg("domain_gate_results_folder") : msg("domain_gate_prepare_first") },
      {
        label: msg("domain_gate_results_accepted"),
        met: "advisory",
        detail:
          products.length === 0
            ? msg("domain_gate_no_outputs")
            : joinRefs([msg("rungroup_accepted_count", { count: accepted }), ...(rejected > 0 ? [msg("rungroup_rejected_count", { count: rejected })] : []), msg("rungroup_candidates_count", { count: candidates })], " · "),
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
 * focuses a control (Save run, Prepare…) stands too. Otherwise Next never points at the screen it is on: a step
 * whose gate blocks, or whose own action is still to do (no advisory item to move past), is resolved here, so
 * Next is null (the caption names the gate); an advisory step (Review) moves on to the first later step that is
 * not done; null when nothing later waits.
 */
export function nextFrom(steps: RunStepState[], next: NextAction | null, here: RunStep | null): NextAction | null {
  if (!next?.step || next.step.id !== here || next.link.focusId) return next
  if (blocks(next.step.items) || !next.step.items.some((i) => i.met === "advisory")) return null
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
  return sessionsSame && same(d.excluded, latest.excluded) && same(d.unresolved, latest.unresolved) ? "review" : "select"
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
  if (!content) return { total: 0, unreviewed: 0 }
  const seen = new Set<AssetId>()
  let unreviewed = 0
  for (const id of [...content.included, ...content.rejected, ...content.excluded, ...content.unresolved]) {
    const asset = catalog.assets[id]
    if (!asset || asset.trashed || seen.has(id)) continue
    seen.add(id)
    const q = frameQuality(asset)
    if (q.library !== "usable" && q.library !== "unusable") unreviewed += 1
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

/** Why Move to Trash is refused (RES-FR-10): running operations affecting the run. */
export function trashRefusals(world: World, run: Run): MessageRef[] {
  return runOperations(world.operations, run.id).map(operationHolds)
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

/** A group's overall status: the worst run status over its live panels, at the earliest step one of them holds it; `at` of `of` live panels are at that step. */
export interface GroupStatus extends RunStatus {
  at: number
  of: number
}

export interface GroupPipeline {
  group: RunGroup
  panels: GroupPanelState[]
  /** Group steps: each the worst gate over the panels outside the Trash. */
  steps: RunStepState[]
  status: GroupStatus
  /** Open on the group folder only when every live panel is prepared and verified (PREP-FR-13). */
  allVerified: boolean
  next: NextAction | null
}

const GATE_ORDER: GateState[] = ["blocked", "partial", "review", "running", "ready", "idle", "done"]
/** Worst first: a held or waiting panel outranks a Complete one. */
const RUN_STATE_ORDER: RunState[] = [...GATE_ORDER, "complete"]

/** "Partial · 1 of 2 panels at Prepare". With every panel trashed the group reads Trashed. */
function groupStatus(panels: GroupPanelState[]): GroupStatus {
  const live = panels.filter((p) => !p.trashed).map((p) => runStatus(p.pipeline))
  const state = RUN_STATE_ORDER.find((s) => live.some((x) => x.state === s))
  if (!state) return { state: "trashed", step: panels[0] ? runStatus(panels[0].pipeline).step : "select", at: 0, of: 0 }
  const step = RUN_STEPS.find((id) => live.some((x) => x.state === state && x.step === id))!
  return { state, step, at: live.filter((x) => x.step === step).length, of: live.length }
}

/** When a group last changed: its own record, any panel run (`runUpdatedAt`) or its group Result. */
export function groupUpdatedAt(catalog: Catalog, group: RunGroup): IsoDateTime {
  const times = [
    ...group.runIds.flatMap((id) => {
      const run = catalog.runs[id]
      return run ? [runUpdatedAt(catalog, run)] : []
    }),
    ...Object.values(catalog.results).flatMap((r) => (r.runId === null && r.groupId === group.id ? [r.acceptedAt] : [])),
  ]
  return times.reduce<IsoDateTime>((latest, t) => (t && t > latest ? t : latest), group.createdAt)
}

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
  return { group, panels, steps, status: groupStatus(panels), allVerified, next }
}

// ---------------------------------------------------------------------------
// Home (D-W35, D-W39, D-W48, PRJ-FR-17 to PRJ-FR-19)
// ---------------------------------------------------------------------------

/** Sessions that match or are members of at least one Project (any state), reviewed or not. */
function sessionsInProjects(catalog: Catalog): Set<SessionId> {
  const ids = new Set<SessionId>()
  for (const project of Object.values(catalog.projects)) {
    for (const c of projectMatches(catalog, project)) ids.add(c.session.id)
    for (const id of projectMemberSessionIds(catalog, project.id)) ids.add(id)
  }
  return ids
}

export interface SessionsNeedingWork {
  /** No confirmed Target (LIB-FR-17). */
  needsTarget: Session[]
  /** A confirmed Target but no Project's candidate or member. */
  notInProject: Session[]
  /** Sessions open Projects match that still have Unreviewed frames: they wait in the review queue (P-REV2). */
  unreviewed: Array<{ session: Session; projectId: ProjectId; frames: number }>
  /** Candidates of a Project that are members of none of its runs (PRJ-FR-19). */
  readyToAdd: Array<{ session: Session; projectId: ProjectId }>
}

/** Live frames with no quality decision, or one that does not apply to their current bytes: what Review still needs (C10). */
export function unreviewedAssetIds(catalog: Catalog, session: Session): AssetId[] {
  return liveAssetIds(catalog, session).filter((id) => {
    const asset = catalog.assets[id]!
    return asset.quality.value === "unreviewed" || qualityApplicability(asset) !== "applicable"
  })
}

export function sessionUnreviewedFrames(catalog: Catalog, session: Session): number {
  return unreviewedAssetIds(catalog, session).length
}

/** A light session's intake state (§5.7, P-REV2): it joins a Project's runs only once Ready. */
export type SessionReadiness = "needs-target" | "needs-rig" | "needs-review" | "ready"

/** Ready means a settled Target, a settled rig and every live frame Usable or Unusable (C10). */
export function sessionReadiness(catalog: Catalog, session: Session): SessionReadiness {
  if (!sessionTargetId(session)) return "needs-target"
  if (!sessionRigId(session)) return "needs-rig"
  return sessionUnreviewedFrames(catalog, session) > 0 ? "needs-review" : "ready"
}

/** The Sessions list's "Needs review" facet, which is the review queue (C14): live light sessions that are not Ready, oldest night first. */
export function reviewQueue(catalog: Catalog): Session[] {
  return liveLightSessions(catalog)
    .filter((s) => sessionReadiness(catalog, s) !== "ready")
    .sort((a, b) => a.night.localeCompare(b.night) || a.startedAt.localeCompare(b.startedAt) || a.id.localeCompare(b.id))
}

/** The session intake step page: `/sessions/$sessionId?step=` (C14). */
export function sessionIntakeLink(sessionId: SessionId, step: SessionIntakeStepId): StepLink {
  return { to: "/sessions/$sessionId", params: { sessionId }, search: { step } }
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
    for (const { session } of projectSessionsNeedingReview(catalog, project)) {
      const frames = sessionUnreviewedFrames(catalog, session)
      if (frames > 0) out.unreviewed.push({ session, projectId: project.id, frames })
    }
    for (const { session } of projectCandidates(catalog, project)) {
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
 * 1. sessions it matches have Unreviewed frames: "Review N new frames", at the first one's review step (P-REV2, C14);
 * 2. one of its runs is blocked: that run at its blocked step;
 * 3. every run is Complete: "Wrap up" (P-WRAP1), until its steps are done or skipped;
 * 4. a goal is unmet in project and tonight has a window for that subject: "Plan tonight";
 * 5. otherwise "Start a processing run".
 * A Done Project has no Next. `wrapUpOf` gives the Project's Wrap up (slice
 * B's `wrapUpOf`, whose Trash step is derived from what is left to trash).
 */
export function projectNext(world: World, project: Project, nowMs: number, wrapUpOf: (project: Project) => ProjectWrapUp): NextAction | null {
  const { catalog } = world
  if (project.state === "done") return null
  const waiting = projectSessionsNeedingReview(catalog, project)
  const unreviewed = waiting.reduce((n, c) => n + sessionUnreviewedFrames(catalog, c.session), 0)
  const runs = projectRuns(catalog, project.id)
  if (unreviewed > 0) {
    // Review happens at ingestion (P-REV2): the first waiting session's review step, then Finish review opens the next (C14).
    const first = waiting.find((c) => sessionUnreviewedFrames(catalog, c.session) > 0)!
    return {
      label: msg("domain_next_review_new_frames", { count: unreviewed, n: formatCount(unreviewed) }),
      reason: msg("flow_reason_sessions_need_review"),
      link: sessionIntakeLink(first.session.id, "review"),
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
  const wrapUp = wrapUpOf(project)
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

/**
 * Stage for Home and the Projects list: a held-up run first ("Partial at Prepare", the rail's gate word), else the least advanced open run.
 * @deprecated D10: the StatusBadge (`projectTabs`, `PROJECT_STATUS_NAME`) and Up next (`projectNext`) replace stages; W3 migrates Home and the Projects list, W4 removes this.
 */
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
 * (storage.ts) and the slice's trash and archive plans. `derived` holds the
 * states a caller derives from what is left (the Trash step, from slice B's
 * offers: `wrapUpOf`); the other steps read their record.
 */
export function projectWrapUp(catalog: Catalog, project: Project, derived: Partial<Record<WrapUpStepId, WrapUpStep["state"]>> = {}): ProjectWrapUp {
  const runs = projectRuns(catalog, project.id)
  const waitingOn = runs.filter((r) => r.completion !== "complete")
  const steps = WRAP_UP_STEPS.map((id): WrapUpStep => {
    const record = project.wrapUp[id]
    const state = derived[id]
    return state ? { id, label: WRAP_UP_NAME[id], state, at: null } : { id, label: WRAP_UP_NAME[id], state: record?.state ?? "todo", at: record?.at ?? null }
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
 * @deprecated D10: tabs Runs · Wrap up and a StatusBadge (`projectTabs`) replace the strip; P5 migrates the Project page, W4 removes this.
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

// ---------------------------------------------------------------------------
// Staged flows (round 10, plan §5): the step states every StepFlow builder
// words (store/actions/flows.ts). One rule per flow, derived from the
// records, so the strip, the footer and every list agree.
// ---------------------------------------------------------------------------

/** A step's state on the StepStrip (contracts.ts `FlowStep`). */
export type FlowStepState = "todo" | "current" | "finished" | "skipped" | "blocked" | "redo"

/** What keeps Proceed from running (F3): the reason and each blocker, with where it is resolved. */
export interface FlowGate {
  reason: MessageRef
  blockers: Array<{ label: MessageRef; link?: StepLink }>
}

/** One derived step. Only the current step carries a gate; it reads Blocked while that gate is unmet. */
export interface DerivedStep<Id extends string> {
  id: Id
  state: FlowStepState
  gate: FlowGate | null
  summary: MessageRef | null
}

/** The state of a step that is not finished or skipped: Blocked or Current when it is the flow's position, else Redo when it was settled before, else To do. */
function openState(isCurrent: boolean, gate: FlowGate | null, settledBefore: boolean): FlowStepState {
  if (isCurrent) return gate ? "blocked" : "current"
  return settledBefore ? "redo" : "todo"
}

/** Proceed waits while an operation affecting the step runs: "Prepare M 31 is running". */
function runningGate(operations: Operation[]): FlowGate | null {
  return operations.length > 0 ? { reason: joinRefs(operations.map(operationHolds), "; "), blockers: [] } : null
}

/** "Finished 12 Oct": when a run, step or flow settled. */
function finishedOn(at: IsoDateTime): MessageRef {
  return msg("stepflow_finished_on", { date: nightRef(at.slice(0, 10)) })
}

// --- Corrected metadata at Prepare (C15, D11) ------------------------------

/** One corrected value of a run input's session: the recorded header value and the catalog's correction, set at intake. */
export interface CorrectedValue {
  session: Session
  field: CorrectionField
  recorded: string | null
  corrected: string
}

export interface RunCorrections {
  /** Each session × field whose correction differs from the recorded value: Prepare shows "N corrected values". */
  values: CorrectedValue[]
  /** How each included frame gets each value: through the profile's configuration when it reads corrected values, else as a patched copy. */
  decisions: MetadataDecision[]
}

/**
 * The corrections a run's inputs carry. Corrections are made at intake, not
 * at Prepare (C15): Prepare applies every one, with no per-field choice, and
 * reports the count. Source headers never change.
 */
export function runCorrections(catalog: Catalog, content: MembershipContent | null, profile: ApplicationProfile | null): RunCorrections {
  const out: RunCorrections = { values: [], decisions: [] }
  const decision: MetadataDecision["decision"] = profile?.capability.correctedMetadata === "configuration" ? "configuration" : "patched-copy"
  for (const member of content ? memberSessions(catalog, content) : []) {
    for (const field of new Set(member.session.corrections.map((c) => c.field))) {
      const correction = latestCorrection(member.session, field)
      if (!correction || correction.observedValue === correction.correctedValue) continue
      out.values.push({ session: member.session, field, recorded: correction.observedValue, corrected: correction.correctedValue })
      for (const assetId of member.included) out.decisions.push({ assetId, field, observed: correction.observedValue, corrected: correction.correctedValue, decision })
    }
  }
  return out
}

// --- Review lock (C10) ------------------------------------------------------

/**
 * The prepared view that holds a run's inputs: the latest preparation of a
 * run that is neither Finished nor Trashed, unless it failed, was canceled or
 * its view was removed. An offline view still counts: a tool may be using it.
 */
function heldView(world: World, run: Run): Preparation | null {
  if (run.completion === "complete" || run.trashedAt) return null
  const prep = runPreparations(world.catalog, run.id).at(-1)
  if (!prep || prep.state === "failed" || prep.state === "canceled") return null
  const volumeId = volumeForPath(world.disk, prep.folderPath)
  const online = Boolean(volumeId && world.disk.volumes[volumeId]?.mounted)
  return !online || filesUnder(world.disk, prep.folderPath).length > 0 ? prep : null
}

/** Runs whose prepared view uses the session: its review stays locked until each finishes or its view is removed (C10). */
export function sessionReviewLock(world: World, sessionId: SessionId): Run[] {
  return Object.values(world.catalog.runs).filter((run) => {
    const prep = heldView(world, run)
    const revision = prep ? run.revisions.find((r) => r.revision === prep.membershipRevision) : undefined
    return revision?.sessions.some((s) => s.sessionId === sessionId) ?? false
  })
}

/** Why the session's review marks cannot change now: "Locked by a prepared run view", naming each run. Null when they can. */
export function reviewLockGate(world: World, sessionId: SessionId): FlowGate | null {
  const runs = sessionReviewLock(world, sessionId)
  if (runs.length === 0) return null
  return { reason: msg("flow_review_locked"), blockers: runs.map((run) => ({ label: verbatim(run.name), link: runStepLink(run, "results") })) }
}

// --- Run flow (D1, D5, C2, C10) ---------------------------------------------

export const RUN_FLOW_STEPS: RunFlowStepId[] = ["select", "calibrate", "prepare", "results"]

export interface RunFlowState {
  steps: Array<DerivedStep<RunFlowStepId>>
  /** The first step that is not finished; Results once the run is Finished. */
  current: RunFlowStepId
  /** Set once the run is Finished (C2): every step is read-only and Run ▾ offers Reopen run. */
  finishedAt: IsoDateTime | null
  trashed: boolean
  /** Matched against the saved revision; a Finished run's is what it recorded (D5). */
  calibration: CalibrationPlan
  /** What Prepare applies (C15). */
  corrections: RunCorrections
}

/**
 * The run flow: Select → Calibrate → Prepare → Results, with Finish run as
 * Results' Proceed (D1, C2). There is no Review step (review happens at
 * intake, P-REV2) and no Done step. A step is finished only when every step
 * before it is; one that was settled before but no longer holds reads Redo.
 * - Select: a saved revision with no draft, whose sessions are all Ready.
 *   Library marks that change the membership of a run not yet prepared
 *   leave a draft: Select is current again and Select and Prepare read
 *   "Inputs changed · Refresh" until Proceed saves it (C10).
 * - Calibrate: every row has a master or No calibration, recorded.
 * - Prepare: the latest revision is prepared and verified.
 * - Results: finished by Finish run, once nothing is still being written.
 */
export function runFlowState(world: World, run: Run): RunFlowState {
  const { catalog, disk } = world
  const latest = latestRevision(run)
  const working = workingContent(run)
  const inputsChanged = draftOwner(run) === "review"
  const finishedRun = run.completion === "complete"
  const link = (step: RunFlowStepId) => runStepLink(run, step)
  const stepLabel = (step: RunFlowStepId) => STEP_NAME[step]
  const running = runOperations(world.operations, run.id)

  // 1 Select
  const members = (working?.sessions ?? []).map((s) => catalog.sessions[s.sessionId]).filter((s): s is Session => s !== undefined)
  const notReady = members.filter((s) => sessionReadiness(catalog, s) !== "ready")
  const selectGate: FlowGate | null =
    members.length === 0
      ? { reason: msg("flow_select_one_session"), blockers: [] }
      : notReady.length > 0
        ? { reason: msg("flow_sessions_need_review", { count: notReady.length }), blockers: notReady.map((s) => ({ label: sessionRef(s), link: sessionIntakeLink(s.id, "review") })) }
        : null
  const selectDone = latest !== null && run.draft === null && selectGate === null
  const selectSummary = inputsChanged ? msg("flow_inputs_changed") : run.draft ? msg("status_unsaved_changes") : latest ? msg("domain_status_saved_revision", { revision: latest.revision }) : msg("status_not_saved")

  // 2 Calibrate
  const setup = runSetup(catalog, run)
  const calibration = calibrationPlan(catalog, disk, run, setup.calibrationPolicy, selectDone || finishedRun ? latest : null)
  const open = calibration.needsReview
  const recorded = calibration.policy === "off" || calibration.rows.every((r) => r.assignment !== null)
  const calibrateDone = selectDone && open.length === 0 && recorded
  const calibrateGate: FlowGate | null = !selectDone
    ? { reason: msg("domain_gate_save_first"), blockers: [{ label: stepLabel("select"), link: link("select") }] }
    : open.length > 0
      ? { reason: msg("blocker_calibration_review", { count: open.length }), blockers: open.map((row) => ({ label: joinRefs([KIND_NAME[row.kind], sessionRef(row.member.session)], " · "), link: link("calibrate") })) }
      : null
  // Without a saved selection there is nothing to match yet: the gate says so, and no count is shown.
  const calibrateSummary: MessageRef | null = !selectDone && !finishedRun
    ? null
    : calibration.policy === "off"
      ? msg("run_cal_off")
      : open.length > 0
        ? msg("domain_status_need_review", { count: open.length })
        : msg("run_cal_masters_count", { count: handoffCalibration(catalog, calibration).length })

  // 3 Prepare
  const preparations = runPreparations(catalog, run.id)
  const prep = preparations.at(-1) ?? null
  const prepCurrent = prep && latest && prep.membershipRevision === latest.revision ? prep : null
  const profile = setup.profileId ? (catalog.profiles[setup.profileId] ?? null) : null
  const corrections = runCorrections(catalog, latest, profile)
  const prepared = prepCurrent?.state === "prepared" && !prepCurrent.unverified
  const prepareDone = calibrateDone && prepared
  const prepareGate: FlowGate | null = !selectDone
    ? { reason: msg("domain_gate_save_first"), blockers: [{ label: stepLabel("select"), link: link("select") }] }
    : !calibrateDone
      ? { reason: msg("flow_resolve_calibration_first"), blockers: [{ label: stepLabel("calibrate"), link: link("calibrate") }] }
      : !profile
        ? { reason: msg("flow_choose_profile"), blockers: [] }
        : runningGate(running)
  const prepState: MessageRef = !prepCurrent
    ? msg("status_not_started")
    : prepCurrent.state === "running" || prepCurrent.state === "paused"
      ? msg("setup_stat_complete_value", { done: prepCurrent.preparedAssetIds.length, total: prepCurrent.entryCount })
      : prepCurrent.state === "partial"
        ? msg("run_partial_count", { done: prepCurrent.preparedAssetIds.length, total: prepCurrent.entryCount })
        : prepCurrent.state === "prepared"
          ? prepCurrent.unverified
            ? msg("status_unverified")
            : msg("status_prepared")
          : msg("status_failed")
  const prepareSummary = inputsChanged
    ? msg("flow_inputs_changed")
    : corrections.values.length > 0
      ? joinRefs([prepState, msg("flow_corrected_values", { count: corrections.values.length })], " · ")
      : prepState

  // 4 Results
  const { products } = runResults(catalog, run.id)
  const writing = products.filter((r) => r.processingState === "pending")
  const accepted = products.filter((r) => r.acceptance === "accepted").length
  const resultsGate: FlowGate | null = !prepareDone
    ? { reason: msg("domain_gate_prepare_first"), blockers: [{ label: stepLabel("prepare"), link: link("prepare") }] }
    : writing.length > 0
      ? { reason: msg("flow_files_being_written", { count: writing.length }), blockers: writing.map((r) => ({ label: verbatim(fileName(r.path)), link: link("results") })) }
      : runningGate(running)
  const resultsSummary = finishedRun && run.completedAt ? finishedOn(run.completedAt) : products.length === 0 ? msg("domain_status_awaiting_outputs") : msg("domain_status_accepted_of", { accepted, total: products.length })

  const done: Record<RunFlowStepId, boolean> = finishedRun
    ? { select: true, calibrate: true, prepare: true, results: true }
    : { select: selectDone, calibrate: calibrateDone, prepare: prepareDone, results: false }
  const settledBefore: Record<RunFlowStepId, boolean> = { select: latest !== null, calibrate: run.calibration.length > 0, prepare: prep !== null, results: false }
  const gates: Record<RunFlowStepId, FlowGate | null> = { select: selectGate, calibrate: calibrateGate, prepare: prepareGate, results: resultsGate }
  const summaries: Record<RunFlowStepId, MessageRef | null> = { select: selectSummary, calibrate: calibrateSummary, prepare: prepareSummary, results: resultsSummary }
  const current = finishedRun ? "results" : RUN_FLOW_STEPS.find((id) => !done[id])!
  const steps = RUN_FLOW_STEPS.map((id): DerivedStep<RunFlowStepId> => {
    if (done[id]) return { id, state: "finished", gate: null, summary: summaries[id] }
    const gate = id === current && !run.trashedAt ? gates[id] : null
    return { id, state: openState(id === current, gate, settledBefore[id]), gate, summary: run.trashedAt && id === current ? msg("status_trashed") : summaries[id] }
  })
  return { steps, current, finishedAt: finishedRun ? run.completedAt : null, trashed: run.trashedAt !== null, calibration, corrections }
}

// --- Session intake (P-REV2, C10, C14, C15) ---------------------------------

export type SessionIntakeStepId = "target" | "rig" | "review"

export const SESSION_INTAKE_STEPS: SessionIntakeStepId[] = ["target", "rig", "review"]

/** "Target", "Rig", "Review". */
export const SESSION_INTAKE_NAME: Record<SessionIntakeStepId, MessageRef> = { target: msg("sessions_column_target"), rig: msg("sessions_column_rig"), review: msg("step_review") }

export interface SessionIntakeState {
  steps: Array<DerivedStep<SessionIntakeStepId>>
  /** The first step not settled; Review once the session is Ready. */
  current: SessionIntakeStepId
  readiness: SessionReadiness
  /** Unfinished runs whose prepared view holds the session's review (C10). */
  lockedBy: Run[]
  /** The next session in the review queue (C14): where Finish review goes. */
  next: Session | null
  /** The corrections intake recorded, recorded beside corrected (C15). */
  corrections: CorrectedValue[]
}

/** The next session the review queue holds after `session`, wrapping to the first; null when no other waits (C14). */
export function nextInReviewQueue(catalog: Catalog, session: Session): Session | null {
  const queue = reviewQueue(catalog).filter((s) => s.id !== session.id)
  const after = queue.find((s) => s.night > session.night || (s.night === session.night && s.startedAt > session.startedAt))
  return after ?? queue[0] ?? null
}

/** Where intake opens a session: its first step that is not settled, else Review (C14). */
export function sessionIntakeEntry(catalog: Catalog, session: Session): StepLink {
  const readiness = sessionReadiness(catalog, session)
  return sessionIntakeLink(session.id, readiness === "needs-target" ? "target" : readiness === "needs-rig" ? "rig" : "review")
}

/** Where Import ends (C14): the first imported session the review queue holds, at its first open step; null when every one is Ready. */
export function importReviewLink(catalog: Catalog, sessionIds: SessionId[]): StepLink | null {
  const imported = new Set(sessionIds)
  const first = reviewQueue(catalog).find((s) => imported.has(s.id))
  return first ? sessionIntakeEntry(catalog, first) : null
}

/**
 * Session intake: Target → Rig → Review, Finish review on the last step
 * (§5.3). Each step's data is the session's own, so a step reads finished
 * whenever it holds: a settled Target, a settled rig, 0 Unreviewed. Only
 * Review has a domain gate (every frame Usable or Unusable, C10); Target's
 * and Rig's Proceed confirm what the page's picker holds, so the builder
 * gates them on that choice. A Ready session stays on Review, whose Finish
 * review opens the next session the queue holds (C14).
 */
export function sessionIntakeState(world: World, session: Session): SessionIntakeState {
  const { catalog } = world
  const targetId = sessionTargetId(session)
  const rigId = sessionRigId(session)
  const unreviewed = sessionUnreviewedFrames(catalog, session)
  const target = targetId ? catalog.targets[targetId] : undefined
  const settled: Record<SessionIntakeStepId, boolean> = { target: targetId !== null, rig: rigId !== null, review: unreviewed === 0 }
  const reviewGate: FlowGate | null = unreviewed > 0 ? { reason: msg("flow_frames_unreviewed", { count: unreviewed }), blockers: [] } : null
  const lockedBy = sessionReviewLock(world, session.id)
  const summaries: Record<SessionIntakeStepId, MessageRef> = {
    target: target ? verbatim(target.name) : msg("sessions_filter_needs_target"),
    rig: rigId ? rigRef(catalog, rigId) : msg("sessions_rig_needs_review"),
    review: lockedBy.length > 0 ? msg("flow_review_locked") : unreviewed > 0 ? msg("flow_frames_unreviewed", { count: unreviewed }) : msg("status_ready"),
  }
  const current = SESSION_INTAKE_STEPS.find((id) => !settled[id]) ?? "review"
  const steps = SESSION_INTAKE_STEPS.map((id): DerivedStep<SessionIntakeStepId> => {
    if (settled[id]) return { id, state: "finished", gate: null, summary: summaries[id] }
    const gate = id === current && id === "review" ? reviewGate : null
    return { id, state: openState(id === current, gate, false), gate, summary: summaries[id] }
  })
  const corrections = SESSION_CORRECTION_FIELDS.flatMap((field): CorrectedValue[] => {
    const correction = latestCorrection(session, field)
    return correction && correction.observedValue !== correction.correctedValue ? [{ session, field, recorded: correction.observedValue, corrected: correction.correctedValue }] : []
  })
  return { steps, current, readiness: sessionReadiness(catalog, session), lockedBy, next: nextInReviewQueue(catalog, session), corrections }
}

const SESSION_CORRECTION_FIELDS: CorrectionField[] = ["target", "equipment", "filter", "exposure", "focal-length"]

// --- Wrap up (C3, D4, F2) ---------------------------------------------------

/** Where Wrap up's StepPage lives: the Project's Wrap up tab, one step at a time. */
export function wrapUpStepLink(projectId: ProjectId, step: WrapUpStepId): StepLink {
  return projectLink(projectId, { stage: "wrap-up", step })
}

/** A step record's state from its operations (F2): Finished only once every one succeeded. */
export type WrapUpRecordState = "todo" | "running" | "finished" | "skipped" | "redo"

export function wrapUpRecordState(operations: Record<string, Operation>, record: WrapUpStepRecord | undefined): { state: WrapUpRecordState; failed: Operation | null; running: Operation[] } {
  if (!record) return { state: "todo", failed: null, running: [] }
  if (record.redo) return { state: "redo", failed: null, running: [] }
  if (record.state === "skipped") return { state: "skipped", failed: null, running: [] }
  const ops = record.operationIds.map((id) => operations[id]).filter((op): op is Operation => op !== undefined)
  const unsettledOps = ops.filter(unsettled)
  if (unsettledOps.length > 0) return { state: "running", failed: null, running: unsettledOps }
  const failed = ops.find((op) => op.status !== "succeeded") ?? null
  return { state: failed ? "todo" : "finished", failed, running: [] }
}

export interface WrapUpFlowState {
  /** Every run outside the Trash is Finished: before then the tab shows "Finish every run first" (§5.5). */
  available: boolean
  /** Until it is available (and the Project is open), the tab's one line: "Finish every run first · 2 open ▸" or "No runs yet". */
  unavailable: FlowGate | null
  waitingOn: Run[]
  steps: Array<DerivedStep<WrapUpStepId>>
  /** The first step not finished or skipped, in the strict order (C3); Archive once the Project is closed. */
  current: WrapUpStepId
  /** Close project succeeded: the record is read-only until Reopen. */
  closed: boolean
  /** Close project's Archive transfer while it runs ("Closing"). */
  closing: Operation[]
}

/**
 * Wrap up: Clean up runs → Trash → Archive, strictly in that order (C3). A
 * later step is read-only until the earlier ones are finished or skipped;
 * an earlier one reopens until Close, and the steps after it read Redo. A
 * step finishes when its operations succeed, not when they start (F2).
 * Archive's Proceed is Close project: the Project closes when its transfer
 * succeeds (§5.5).
 */
export function wrapUpFlowState(world: World, project: Project): WrapUpFlowState {
  const runs = projectRuns(world.catalog, project.id)
  const waitingOn = runs.filter((r) => r.completion !== "complete")
  const closed = project.state === "done"
  const available = runs.length > 0 && waitingOn.length === 0
  const unavailable = available || closed ? null : wrapUpUnavailable(runs, waitingOn)
  const records = WRAP_UP_STEPS.map((id) => ({ id, record: project.wrapUp[id], ...wrapUpRecordState(world.operations, project.wrapUp[id]) }))
  const settled = (s: WrapUpRecordState) => s === "finished" || s === "skipped"
  const firstOpen = records.find((r) => !settled(r.state))
  const current: WrapUpStepId = closed || !firstOpen ? "archive" : firstOpen.id
  const position = WRAP_UP_STEPS.indexOf(current)
  const steps = records.map(({ id, record, state, failed, running }, index): DerivedStep<WrapUpStepId> => {
    const summary =
      state === "finished" && record ? finishedOn(record.at) : state === "skipped" ? msg("status_skipped") : state === "running" ? msg("status_running") : failed?.summary ?? null
    if ((closed || index < position) && settled(state)) return { id, state, gate: null, summary }
    if (index > position) return { id, state: record ? "redo" : "todo", gate: null, summary: null }
    const gate: FlowGate | null = closed ? null : (unavailable ?? runningGate(running))
    return { id, state: openState(true, gate, false), gate, summary }
  })
  const archive = records.find((r) => r.id === "archive")!
  return { available, unavailable, waitingOn, steps, current, closed, closing: closed ? [] : archive.running }
}

/** Why Wrap up is not available yet: "Finish every run first · 2 open", naming each open run, or "No runs yet" (§5.5). */
function wrapUpUnavailable(runs: Run[], waitingOn: Run[]): FlowGate {
  if (runs.length === 0) return { reason: msg("project_no_runs"), blockers: [] }
  return { reason: msg("flow_finish_every_run", { count: waitingOn.length }), blockers: waitingOn.map((run) => ({ label: verbatim(run.name), link: runStepLink(run, "results") })) }
}

// --- Calibration process (P-CAL3) -------------------------------------------

export interface CalibrationFlowState {
  steps: Array<DerivedStep<CalibrationStepId>>
  /** The first step not done or skipped; Raws once every step is. */
  current: CalibrationStepId
  finished: boolean
}

/** The calibration process as a flow: Stack → Detect → Import → Register → Raws, each step's own record and gate (P-CAL3). */
export function calibrationFlowState(world: World, process: CalibrationProcess, profileId: ProfileId | null): CalibrationFlowState {
  const settled = (id: CalibrationStepId) => process.steps[id].state === "done" || process.steps[id].state === "skipped"
  const current = CALIBRATION_STEPS.find((id) => !settled(id)) ?? "raws"
  const finished = CALIBRATION_STEPS.every(settled)
  const op = process.operationId ? world.operations[process.operationId] : undefined
  const gateFor = (id: CalibrationStepId): FlowGate | null => {
    if (id === "stack" && process.sessionId) {
      const reasons = stackRefusals(world.catalog, world.settings, process.sessionId, profileId)
      if (reasons.length > 0) return { reason: reasons[0]!, blockers: reasons.map((label) => ({ label })) }
      if (!profileId) return { reason: msg("flow_choose_profile"), blockers: [] }
    }
    if (id === "raws" && process.steps.raws.state === "running" && op && unsettled(op)) return runningGate([op])
    return null
  }
  const steps = CALIBRATION_STEPS.map((id): DerivedStep<CalibrationStepId> => {
    const record = process.steps[id]
    const summary = record.state === "done" && record.at ? finishedOn(record.at) : record.state === "skipped" ? msg("status_skipped") : record.state === "running" ? msg("status_running") : record.reason
    if (settled(id)) return { id, state: record.state === "skipped" ? "skipped" : "finished", gate: null, summary }
    const gate = id === current ? gateFor(id) : null
    return { id, state: openState(id === current, gate, false), gate, summary }
  })
  return { steps, current, finished }
}

export function calibrationStepLink(processId: CalibrationProcessId, step: CalibrationStepId): StepLink {
  return { to: "/calibration/processes/$processId/$step", params: { processId, step } }
}

// --- Master age and Replace (C9, D9) ----------------------------------------

/** The calibration a run hands off now: against its saved revision, else its working content (the library's Used by). */
function handedOffPlan(world: World, run: Run): CalibrationPlan {
  return calibrationPlan(world.catalog, world.disk, run, runSetup(world.catalog, run).calibrationPolicy, savedContent(run) ?? workingContent(run))
}

/** Unfinished runs Replace… re-points from `masterId`, listed in its confirm (C9). Finished runs keep what they recorded. */
export function masterReplacementRuns(world: World, masterId: MasterId): Run[] {
  return Object.values(world.catalog.runs).filter((run) => {
    if (run.completion === "complete" || run.trashedAt) return false
    return handedOffPlan(world, run).rows.some((row) => handsOff(row) && row.input?.masterId === masterId)
  })
}

/** Unfinished runs that hand off an old master, per master: the only case that raises an issue (C9). */
export function oldMastersInUse(world: World, nowMs: number): Array<{ master: CalibrationMaster; runs: Run[] }> {
  const out = new Map<MasterId, { master: CalibrationMaster; runs: Run[] }>()
  for (const run of Object.values(world.catalog.runs)) {
    if (run.completion === "complete" || run.trashedAt) continue
    const plan = handedOffPlan(world, run)
    for (const master of handoffCalibration(world.catalog, plan).map((s) => world.catalog.masters[s.input.masterId])) {
      if (!master || masterAge(master, world.settings, nowMs) === null) continue
      const entry = out.get(master.id) ?? { master, runs: [] }
      if (!entry.runs.includes(run)) entry.runs.push(run)
      out.set(master.id, entry)
    }
  }
  return [...out.values()]
}
