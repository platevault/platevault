/**
 * Project and library derivations for harness v5 (foundation-owned):
 * associations, rigs and channels; a Project's suggestions and the sessions
 * it holds; goal progress and subject conditions; session readiness; Fit per
 * rig; and the staged-flow vocabulary every StepFlow builder words. Every
 * screen reads these so the numbers agree everywhere (D-W33, D-W36, D-W37).
 * The Project's View, Apply, Output and Wrap up derivations live in
 * `project-view.ts`; library-level totals in `library.ts`. Nothing here
 * writes state. Copy is a `MessageRef` (a catalogue key and its params),
 * worded by the screen with `say(m, …)`, so it follows a language switch;
 * the name helpers that return a string take the caller's `m`.
 */
import { isSettled, sessionPinProblems, unsettledKinds } from "./calibration"
import { CALIBRATION_STEPS, stackRefusals } from "./calibration-process"
import { latestCorrection } from "./corrections"
import { BANDS, GOAL_CHANNELS, isGoalChannel, NARROW_BANDS, numberText } from "./labels"
import { effectiveExposureS, type FrameTotals, measurementApplies, qualityApplicability } from "./library"
import { frameOut, framesRef, sessionExposureS } from "./membership"
import { windowProgress, type WindowProgress } from "./planning"
import { type FieldOfView, fieldOfView } from "./sky"
import { goalMeasure, type GoalMeasure, type GoalUnit, type NamingValues, namingValues, subjectConditions } from "./templates"
import type {
  AppSettings,
  Asset,
  AssetId,
  Band,
  CameraKind,
  ApplicationProfile,
  CalibrationProcess,
  CalibrationProcessId,
  CalibrationStepId,
  Catalog,
  CloseSnapshot,
  CorrectionField,
  Disk,
  Filter,
  FrozenGoal,
  Goal,
  GoalChannel,
  GoalTemplateValue,
  IsoDateTime,
  Location,
  MetadataDecision,
  NightDate,
  ObservingSite,
  Operation,
  OpticalTrain,
  OpticalTrainId,
  PinKind,
  ProfileId,
  Project,
  ProjectGroup,
  ProjectId,
  ProjectInput,
  Session,
  SessionId,
  SimulationFaults,
  Subject,
  SubjectConditions,
  Target,
  TargetId,
} from "./types"
import { formatCount, formatDecimal } from "@/lib/format"
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

export function unsettled(op: Operation): boolean {
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
 * channel and exposure, camera and settings. Archive, review names and the
 * Settings preview lay files out from these; Import, before any
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

/** The filter records a rig carries, in its order; an id no longer in the catalog is skipped. */
export function rigFilters(catalog: Catalog, rig: OpticalTrain): Filter[] {
  return rig.filterIds.flatMap((id) => catalog.filters[id] ?? [])
}

/** Bands a rig can capture: OSC adds R, G and B without a filter; each of its filters adds its bands (PLAN-EQ-FR-02). */
export function rigBands(catalog: Catalog, rig: OpticalTrain): Band[] {
  const bands = new Set<Band>()
  if (rigCameraKind(catalog, rig) === "osc") for (const band of ["R", "G", "B"] as Band[]) bands.add(band)
  for (const filter of rigFilters(catalog, rig)) for (const band of filter.bands) bands.add(band)
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

/** The rig's filter a FITS FILTER value matches, by name or by one of its matches, case-insensitively. */
export function rigFilterFor(catalog: Catalog, rig: OpticalTrain, value: string | null): Filter | null {
  if (!value) return null
  const key = value.toLowerCase()
  return rigFilters(catalog, rig).find((f) => f.name.toLowerCase() === key || f.matches.some((m) => m.toLowerCase() === key)) ?? null
}

/** FILTER values seen on a rig's sessions that match none of its filters: "Add {value} to {rig}" (PLAN-EQ-FR-04). */
export function unknownFilterValues(catalog: Catalog, rigId: OpticalTrainId): string[] {
  const rig = catalog.opticalTrains[rigId]
  if (!rig) return []
  const values = new Set<string>()
  for (const session of liveLightSessions(catalog)) {
    if (sessionRigId(session) !== rigId || !session.channel) continue
    if (!rigFilterFor(catalog, rig, session.channel)) values.add(session.channel)
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
  const filter = rig ? rigFilterFor(catalog, rig, session.channel) : null
  if (filter) {
    if (filter.bands.filter((b) => NARROW_BANDS.includes(b)).length >= 2) return "Dual-band"
    if (osc && filter.bands.every((b) => !NARROW_BANDS.includes(b))) return "OSC"
    return filter.bands.length === 1 ? filter.bands[0]! : null
  }
  if (osc && !session.channel) return "OSC"
  return session.channel && isGoalChannel(session.channel) ? session.channel : null
}

// ---------------------------------------------------------------------------
// Subjects and panel groups
// ---------------------------------------------------------------------------

export function subjectTarget(catalog: Catalog, subject: Subject): Target | undefined {
  return catalog.targets[subject.targetId]
}

/** A subject reads by its Target's name. */
export function subjectRef(catalog: Catalog, subject: Subject): MessageRef {
  const name = subjectTarget(catalog, subject)?.name
  return name === undefined ? msg("plan_unknown_target") : verbatim(name)
}

export function subjectName(m: Messages, catalog: Catalog, subject: Subject): string {
  return say(m, subjectRef(catalog, subject))
}

export function findSubject(project: Project, subjectId: string): Subject | undefined {
  return project.subjects.find((s) => s.id === subjectId)
}

export function findGroup(project: Project, groupId: string | null): ProjectGroup | undefined {
  return groupId ? project.groups.find((g) => g.id === groupId) : undefined
}

/** A Project is a mosaic once one of its groups is marked a panel (PRJ-FR-29); there is no mosaic mode up front. */
export function isMosaic(project: Pick<Project, "groups">): boolean {
  return project.groups.some((g) => g.panel)
}

/** The Project's panel groups, in group order. */
export function panelGroups(project: Pick<Project, "groups">): ProjectGroup[] {
  return project.groups.filter((g) => g.panel)
}

/** A group as a list names it: its own name, data in every language. */
export function groupRef(group: ProjectGroup): MessageRef {
  return verbatim(group.name)
}

/** Centre the Planner uses: the Target's coordinates (D-W63). */
export function subjectCentre(catalog: Catalog, subject: Subject): { ra: number; dec: number } | null {
  const target = subjectTarget(catalog, subject)
  return target && target.ra !== null && target.dec !== null ? { ra: target.ra, dec: target.dec } : null
}

// ---------------------------------------------------------------------------
// Projects: state, suggestions and held sessions (D-W33, D-W37, PRJ-FR-08)
// ---------------------------------------------------------------------------

/**
 * Closed and Archived Projects are locked: no edits, no Apply, no incoming
 * pending changes (PRJ-FR-25). Provisional (decision record §2): there is no
 * Reopen, so the lock is for good. This predicate is the one place that
 * decides it; every writer refuses through it (`closedRefusal`).
 */
export function isLocked(project: Pick<Project, "state">): boolean {
  return project.state !== "open"
}

/** The sessions a Project holds (its desired inputs). */
export function projectSessionIds(project: Pick<Project, "inputs">): Set<SessionId> {
  return new Set(project.inputs.map((i) => i.sessionId))
}

export function findInput(project: Pick<Project, "inputs">, sessionId: SessionId): ProjectInput | undefined {
  return project.inputs.find((i) => i.sessionId === sessionId)
}

/**
 * Suggestion rule (D-W33, D-W37, PRJ-FR-09): the session's confirmed Target
 * is a subject of the Project and its rig is one of the Project's rigs.
 * Trashed sessions never match. Returns the matching subject.
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
 * Sessions the suggestion rule matches, reviewed or not, held or not: what a
 * goal's "captured" counts and what a Project's review queue draws on.
 */
export function projectMatches(catalog: Catalog, project: Project): Candidate[] {
  const out: Candidate[] = []
  for (const session of liveLightSessions(catalog)) {
    const subject = candidateSubject(catalog, project, session)
    if (!subject) continue
    const rigId = sessionRigId(session)!
    out.push({ session, subject, rigId, reason: msg("domain_candidate_reason", { target: subjectRef(catalog, subject), rig: rigRef(catalog, rigId) }) })
  }
  return out.sort((a, b) => a.session.night.localeCompare(b.session.night) || (a.session.channel ?? "").localeCompare(b.session.channel ?? "") || a.session.framing - b.session.framing)
}

/** Why a session cannot be added to a Project yet (PRJ-FR-08): "Review 12 frames first", "Choose its flats first". Null when it can. */
export function joinBlocker(catalog: Catalog, session: Session): MessageRef | null {
  const readiness = sessionReadiness(catalog, session)
  if (readiness === "needs-target") return msg("domain_join_needs_target")
  if (readiness === "needs-rig") return msg("domain_join_needs_rig")
  if (readiness === "needs-review") return msg("domain_join_needs_review", { count: sessionUnreviewedFrames(catalog, session) })
  const kinds = unsettledKinds(session.calibration)
  return kinds.length > 0 ? CHOOSE_FIRST[kinds[0]!] : null
}

const CHOOSE_FIRST: Record<PinKind, MessageRef> = {
  dark: msg("domain_join_choose_darks"),
  flat: msg("domain_join_choose_flats"),
  bias: msg("domain_join_choose_bias"),
}

/** Ready and settled: the only sessions a Project can add (PRJ-FR-08, LIB-FR-23). */
export function canJoinProject(catalog: Catalog, session: Session): boolean {
  return sessionReadiness(catalog, session) === "ready" && isSettled(session.calibration)
}

export interface Suggestion extends Candidate {
  /** Why Add is not offered yet ("Choose its flats first"); null when it can be added. */
  blocked: MessageRef | null
}

/**
 * Suggestions (PRJ-FR-09, D-W96): Ready matching sessions the Project does
 * not hold. They are never added by themselves; one whose calibration is not
 * settled shows "Choose its flats first" instead of Add.
 */
export function projectSuggestions(catalog: Catalog, project: Project): Suggestion[] {
  const held = projectSessionIds(project)
  return projectMatches(catalog, project)
    .filter((c) => !held.has(c.session.id) && sessionReadiness(catalog, c.session) === "ready")
    .map((c) => ({ ...c, blocked: joinBlocker(catalog, c.session) }))
}

/** Matching sessions that still need review before they can be suggested: "3 sessions need review ▸" (C14). */
export function projectSessionsNeedingReview(catalog: Catalog, project: Project): Candidate[] {
  const held = projectSessionIds(project)
  return projectMatches(catalog, project).filter((c) => !held.has(c.session.id) && sessionReadiness(catalog, c.session) !== "ready")
}

// ---------------------------------------------------------------------------
// Library quality (P-REJ2: one level, library-wide)
// ---------------------------------------------------------------------------

export interface FrameQuality {
  /** Library P/X/U, as it applies to the current bytes. */
  library: "unreviewed" | "usable" | "unusable" | "changed-content" | "verification-pending"
  trashed: boolean
}

/** Library quality as it applies to the frame's current bytes. */
export function frameQuality(asset: Asset): FrameQuality {
  const applicability = qualityApplicability(asset)
  return { library: applicability === "applicable" ? asset.quality.value : applicability, trashed: asset.trashed !== null }
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
  /** Frames in project the goal's quality bar cannot judge (no applicable measurement); they do not count (PRJ-FR-03). */
  unknownQuality: number
  /** Usable frames in project that the bar's FWHM limit leaves out (C7); zero without a limit. */
  belowBar: FrameTotals
  met: boolean
  /** The goal's one unit, its amount and what remains, in that unit (C7, `goalMeasure` in templates.ts). */
  measure: GoalMeasure
  /** "Ha 6h10 in project · 9h15 captured · goal 10h" ("in project" never above "captured", PRJ-FR-21). */
  line: MessageRef
  /** The line without its channel: "6h10 in project · 9h15 captured · goal 10h", beside a channel chip. */
  amounts: MessageRef
  /** "+2h10 below bar" (or "+12 frames below bar" for a frame goal) beside the line (C7); null when nothing is below the bar. */
  belowBarLine: MessageRef | null
  /** The figures are the ones frozen when the Project closed (C7), not the live library's. */
  frozen: boolean
}

/** What a goal's quality bar makes of one frame in project (C7). */
type FrameVerdict = "counted" | "below-bar" | "unmeasured" | "not-counted"

function frameVerdict(catalog: Catalog, asset: Asset, bar: Goal["qualityBar"]): FrameVerdict {
  if (!bar) return "counted"
  const usable = asset.quality.value === "usable" && qualityApplicability(asset) === "applicable"
  if (bar.kind === "usable-only") return usable ? "counted" : "not-counted"
  if (bar.kind === "usable-max-fwhm" && !usable) return "not-counted"
  const record = catalog.measurements[asset.id]
  const fwhm = record && measurementApplies(asset, record) ? record.metrics.find((m) => m.key === "fwhm" && m.unit === "arcsec") : undefined
  if (!fwhm || fwhm.value === null) return "unmeasured"
  return fwhm.value <= bar.maxArcsec ? "counted" : "below-bar"
}

/** One goal's counted totals: the live library's, or the ones Close froze (`FrozenGoal`). */
type GoalCounts = Omit<FrozenGoal, "goalId">

/**
 * Counts each goal against the live library (PRJ-FR-04). "in project"
 * counts the frames of the sessions this Project holds that are in (not
 * excluded by the Project, not rejected in the Library, not Trashed) and
 * that the quality bar admits; a panel goal counts its panel group only.
 * Those the bar's FWHM limit leaves out count as below the bar. "captured"
 * adds every frame of the matching sessions the Project does not hold, so
 * "in project" never exceeds "captured" (D-W66). Each Project counts its
 * own sessions; a frame counts once per Project.
 */
function liveCounter(catalog: Catalog, project: Project): (goal: Goal) => GoalCounts {
  const matches = projectMatches(catalog, project)
  const held = projectSessionIds(project)
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
  return (goal) => {
    const inProjectIds = new Set<AssetId>()
    const capturedIds = new Set<AssetId>()
    const belowBarIds = new Set<AssetId>()
    const unmeasuredIds = new Set<AssetId>()
    const subject = findSubject(project, goal.subjectId)
    if (subject) {
      for (const input of project.inputs) {
        if (goal.groupId && input.groupId !== goal.groupId) continue
        const session = catalog.sessions[input.sessionId]
        if (!session || candidateSubject(catalog, project, session)?.id !== subject.id || goalChannel(catalog, session) !== goal.channel) continue
        for (const id of session.assetIds) {
          const asset = catalog.assets[id]
          if (!asset || asset.trashed) continue
          capturedIds.add(id)
          if (frameOut(catalog, input, id) !== null) continue
          const verdict = frameVerdict(catalog, asset, goal.qualityBar)
          if (verdict === "counted") inProjectIds.add(id)
          else if (verdict === "below-bar") belowBarIds.add(id)
          else if (verdict === "unmeasured") unmeasuredIds.add(id)
        }
      }
      if (!goal.groupId) {
        for (const candidate of matches) {
          if (held.has(candidate.session.id) || candidate.subject.id !== subject.id || goalChannel(catalog, candidate.session) !== goal.channel) continue
          for (const id of liveAssetIds(catalog, candidate.session)) capturedIds.add(id)
        }
      }
    }
    return { inProject: total(inProjectIds), captured: total(capturedIds), belowBar: total(belowBarIds), unknownQuality: unmeasuredIds.size }
  }
}

function progressOf(goal: Goal, counts: GoalCounts, frozen: boolean): GoalProgress {
  const { inProject, captured, belowBar, unknownQuality } = counts
  const measure = goalMeasure(goal, inProject, captured)
  const count = (n: number) => (measure.unit === "time" ? verbatim(formatHours(n)) : framesRef(n))
  const amounts =
    measure.target !== null
      ? msg("domain_goal_amounts", { inProject: count(measure.inProject), captured: count(measure.captured), target: count(measure.target) })
      : msg("domain_goal_amounts_no_target", { inProject: count(measure.inProject), captured: count(measure.captured) })
  return {
    goal,
    inProject,
    captured,
    unknownQuality,
    belowBar,
    met: measure.met,
    measure,
    line: msg("domain_goal_line", { channel: goal.channel, amounts }),
    amounts,
    belowBarLine: belowBar.frames > 0 ? msg("domain_goal_below_bar", { amount: count(measure.unit === "time" ? belowBar.seconds : belowBar.frames) }) : null,
    frozen,
  }
}

/**
 * Progress of every goal (`liveCounter` says what counts). A Closed or
 * Archived Project reads the figures frozen at Close (C7, PRJ-FR-25), so
 * later library changes leave them as they were; an open one reads the
 * live library.
 */
export function goalProgress(catalog: Catalog, project: Project): GoalProgress[] {
  const frozen = new Map((isLocked(project) ? (project.snapshot?.goals ?? []) : []).map((g) => [g.goalId, g]))
  let live: ((goal: Goal) => GoalCounts) | null = null
  return project.goals.map((goal) => {
    const held = frozen.get(goal.id)
    if (held) return progressOf(goal, held, true)
    live ??= liveCounter(catalog, project)
    return progressOf(goal, live(goal), false)
  })
}

/**
 * What Close freezes (PRJ-FR-25): every goal counted against the live
 * library at `at`, and the calibration each held session has now, so a
 * later reassignment never changes a Closed Project.
 */
export function closeSnapshot(catalog: Catalog, project: Project, at: IsoDateTime): CloseSnapshot {
  const count = liveCounter(catalog, project)
  const calibration: CloseSnapshot["calibration"] = {}
  for (const input of project.inputs) {
    const cal = catalog.sessions[input.sessionId]?.calibration
    if (cal) calibration[input.sessionId] = cal
  }
  return { at, goals: project.goals.map((goal) => ({ goalId: goal.id, ...count(goal) })), calibration }
}

/** The calibration a held session reads for this Project: a Closed Project's frozen snapshot, else the session's current pins. */
export function heldCalibration(catalog: Catalog, project: Project, sessionId: SessionId): Session["calibration"] {
  return (isLocked(project) ? project.snapshot?.calibration[sessionId] : undefined) ?? catalog.sessions[sessionId]?.calibration ?? null
}

// ---------------------------------------------------------------------------
// Subject progress (C7): panel balance, channel ratio and the deadline or
// season window
// ---------------------------------------------------------------------------

/** One panel group's counted amount on a channel, against the panels' mean (`panelBalance`). */
export interface PanelShare {
  panel: ProjectGroup
  /** Counted in project, in the balance's unit: seconds of Usable frames inside the bar, or frames. */
  counted: number
  /** Signed percent from the panels' mean; 0 while nothing is counted. */
  deviationPct: number
  within: boolean
}

/** Mosaic panel balance on one channel (C7). */
export interface PanelBalance {
  channel: GoalChannel
  unit: GoalUnit
  tolerancePct: number
  /** The panels' mean counted amount, in `unit`. */
  mean: number
  /** In group order. */
  panels: PanelShare[]
  balanced: boolean
  /** Out of balance: the panel furthest from the mean, the one below it on a tie (it is the one to image); null when balanced. */
  furthest: PanelShare | null
  /** "Panels within ±10%", "Panel 3 100% below average · limit ±10%". */
  line: MessageRef
}

/**
 * Panel balance on one channel (C7): each panel's counted amount stays within
 * ±`tolerancePct` of the panels' mean. The user's "within ±N % of each other"
 * is read as a band around the mean, so each panel has one signed deviation
 * to show and the panel furthest behind is the one to image next; a
 * max-minus-min spread was the alternative, but it names no panel. Revisit
 * if the user means the spread. While nothing is counted the panels are even.
 */
export function panelBalance(channel: GoalChannel, unit: GoalUnit, counted: Array<{ panel: ProjectGroup; counted: number }>, tolerancePct: number): PanelBalance {
  const mean = counted.length === 0 ? 0 : counted.reduce((sum, p) => sum + p.counted, 0) / counted.length
  const panels = counted.map(({ panel, counted: amount }): PanelShare => {
    const deviationPct = mean > 0 ? ((amount - mean) / mean) * 100 : 0
    // A hair of slack, so an amount exactly on the limit reads as within despite float rounding.
    return { panel, counted: amount, deviationPct, within: Math.abs(deviationPct) <= tolerancePct + 1e-9 }
  })
  const balanced = panels.every((p) => p.within)
  const furthest = balanced ? null : panels.reduce((a, b) => (Math.abs(b.deviationPct) > Math.abs(a.deviationPct) || (Math.abs(b.deviationPct) === Math.abs(a.deviationPct) && b.deviationPct < a.deviationPct) ? b : a))
  const pct = numberText(tolerancePct)
  const line = !furthest
    ? msg("domain_balance_within", { pct })
    : msg(furthest.deviationPct < 0 ? "domain_balance_below" : "domain_balance_above", { panel: groupRef(furthest.panel), deviation: Math.round(Math.abs(furthest.deviationPct)), pct })
  return { channel, unit, tolerancePct, mean, panels, balanced, furthest, line }
}

/** One channel's share of a ratio (`channelRatio`). */
export interface RatioPart {
  channel: GoalChannel
  /** In the ratio's unit. */
  amount: number
  /** `amount` over the smallest non-zero amount; null while every amount is zero. */
  part: number | null
}

/** A subject's channel ratio: counted, next to the ratio its goals imply (C7: a display, never a goal). */
export interface ChannelRatio {
  unit: GoalUnit
  counted: RatioPart[]
  /** Null when the goals mix time and frames, or one has no amount: they imply no ratio. */
  implied: RatioPart[] | null
  /** "Ha 1.8 : OIII 1.0 counted · goals Ha 1.0 : OIII 1.0". */
  line: MessageRef
}

function ratioParts(amounts: Array<{ channel: GoalChannel; amount: number }>): RatioPart[] {
  const smallest = Math.min(...amounts.map((a) => a.amount).filter((a) => a > 0))
  return amounts.map(({ channel, amount }) => ({ channel, amount, part: Number.isFinite(smallest) ? amount / smallest : null }))
}

function ratioRef(parts: RatioPart[]): MessageRef {
  if (parts.every((p) => p.part === null)) return verbatim("–")
  return joinRefs(
    parts.map((p) => msg("domain_ratio_part", { channel: p.channel, part: formatDecimal(p.part ?? 0, 1) })),
    " : ",
  )
}

/**
 * A subject's channel ratio (C7): its counted time per channel, Usable
 * frames inside each goal's bar, next to the ratio its goals imply; in frames
 * when every goal counts frames. A mosaic's panels add up per channel.
 * Channels follow `GOAL_CHANNELS`. Null below two channels: one channel has
 * no ratio.
 */
export function channelRatio(progress: GoalProgress[]): ChannelRatio | null {
  const channels = GOAL_CHANNELS.filter((c) => progress.some((p) => p.goal.channel === c))
  if (channels.length < 2) return null
  const unit: GoalUnit = progress.every((p) => p.measure.unit === "frames") ? "frames" : "time"
  const sum = (channel: GoalChannel, of: (p: GoalProgress) => number) => progress.filter((p) => p.goal.channel === channel).reduce((n, p) => n + of(p), 0)
  const counted = ratioParts(channels.map((channel) => ({ channel, amount: sum(channel, (p) => (unit === "time" ? p.inProject.seconds : p.inProject.frames)) })))
  const implies = progress.every((p) => p.measure.amount !== null && p.measure.unit === unit)
  const implied = implies ? ratioParts(channels.map((channel) => ({ channel, amount: sum(channel, (p) => p.measure.target ?? 0) }))) : null
  const line = implied ? msg("domain_ratio_line", { counted: ratioRef(counted), implied: ratioRef(implied) }) : msg("domain_ratio_counted", { counted: ratioRef(counted) })
  return { unit, counted, implied, line }
}

/** One channel of a subject: a plain subject's goal, or a mosaic's goal per panel group (C7). */
export interface ChannelProgress {
  channel: GoalChannel
  /** In panel order for a mosaic. */
  goals: GoalProgress[]
  /** The least complete goal: what the channel's progress shows (C7). */
  weakest: GoalProgress
  /** Mosaic panel balance; null for a plain Project or with fewer than two panels holding a goal. */
  balance: PanelBalance | null
}

/** A subject's goals and conditions together (C7, `subjectProgress`). */
export interface SubjectProgress {
  subject: Subject
  conditions: SubjectConditions
  goals: GoalProgress[]
  /** In `GOAL_CHANNELS` order. */
  channels: ChannelProgress[]
  /** Share of the goals met, 0 to 1: a plain subject's mean over its goals, a mosaic's weakest panel's. Null without an amount. */
  fraction: number | null
  /** A mosaic's least complete panel group, which `fraction` shows; null for a plain Project. */
  weakestPanel: ProjectGroup | null
  /** Every goal met, every panel's for a mosaic (C7); a subject without goals never is. Panel balance is shown beside it, never holds it. */
  complete: boolean
  /** Every channel's panels within the panel balance; true for a plain Project. */
  balanced: boolean
  ratio: ChannelRatio | null
  /** Nights left and the planning priority; null without a window or a planning night. */
  window: WindowProgress | null
  /** "Panel 3 · 21%" for a mosaic, "62%" for a plain subject; null without an amount. */
  line: MessageRef | null
}

const average = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / values.length

function summary(subject: Subject, panels: ProjectGroup[], goals: GoalProgress[], tonight: NightDate | null): SubjectProgress {
  const conditions = subjectConditions(subject)
  const panelOrder = (p: GoalProgress) => panels.findIndex((panel) => panel.id === p.goal.groupId)
  const channels = GOAL_CHANNELS.flatMap((channel): ChannelProgress[] => {
    const own = goals.filter((p) => p.goal.channel === channel).sort((a, b) => panelOrder(a) - panelOrder(b))
    if (own.length === 0) return []
    const weakest = own.reduce((a, b) => ((b.measure.fraction ?? 0) < (a.measure.fraction ?? 0) ? b : a))
    const onPanels = panels.flatMap((panel) => {
      const held = own.filter((p) => p.goal.groupId === panel.id)
      return held.length > 0 ? [{ panel, held }] : []
    })
    if (onPanels.length < 2) return [{ channel, goals: own, weakest, balance: null }]
    const unit: GoalUnit = onPanels.every(({ held }) => held.every((p) => p.measure.unit === "frames")) ? "frames" : "time"
    const counted = onPanels.map(({ panel, held }) => ({ panel, counted: held.reduce((n, p) => n + (unit === "time" ? p.inProject.seconds : p.inProject.frames), 0) }))
    return [{ channel, goals: own, weakest, balance: panelBalance(channel, unit, counted, conditions.panelBalancePct) }]
  })
  const fractions = (of: GoalProgress[]) => of.map((p) => p.measure.fraction).filter((f): f is number => f !== null)
  let fraction: number | null = null
  let weakestPanel: ProjectGroup | null = null
  if (panels.length > 0) {
    for (const panel of panels) {
      const own = fractions(goals.filter((p) => p.goal.groupId === panel.id))
      if (own.length === 0) continue
      const share = average(own)
      if (fraction === null || share < fraction) {
        fraction = share
        weakestPanel = panel
      }
    }
  }
  if (weakestPanel === null) {
    const own = fractions(goals)
    fraction = own.length > 0 ? average(own) : null
  }
  const percent = fraction === null ? null : formatCount(Math.floor(fraction * 100))
  return {
    subject,
    conditions,
    goals,
    channels,
    fraction,
    weakestPanel,
    complete: goals.length > 0 && goals.every((p) => p.met),
    balanced: channels.every((c) => c.balance?.balanced ?? true),
    ratio: channelRatio(goals),
    window: conditions.window && tonight ? windowProgress(conditions.window, tonight) : null,
    line: percent === null ? null : weakestPanel ? msg("domain_subject_weakest_panel", { panel: groupRef(weakestPanel), percent }) : msg("domain_subject_percent", { percent }),
  }
}

/**
 * Each subject's goals with its conditions (C7): a mosaic completes when
 * every panel group meets its goals and its progress shows the weakest
 * panel; per channel, the panels' balance; the channel ratio; and, from
 * `tonight` (the planning night, `upcomingNight`), the nights left in its
 * window.
 */
export function subjectProgress(catalog: Catalog, project: Project, tonight: NightDate | null): SubjectProgress[] {
  const progress = goalProgress(catalog, project)
  const panels = panelGroups(project)
  return project.subjects.map((subject) => summary(subject, panels, progress.filter((p) => p.goal.subjectId === subject.id), tonight))
}

/** One subject in Planning's deadline order (`planningPriorities`). */
export interface SubjectPriority {
  project: Project
  subject: Subject
  window: WindowProgress
  /** `deadlinePriority` (planning.ts): rises from 0 to 1 over the window's last nights. */
  priority: number
}

/**
 * Planning's order for subjects with a window (C7): the incomplete subjects
 * of open Projects whose window has not passed, highest priority first, then
 * fewest nights left. Planning raises a subject as its date nears.
 */
export function planningPriorities(catalog: Catalog, tonight: NightDate): SubjectPriority[] {
  const out: SubjectPriority[] = []
  for (const project of Object.values(catalog.projects)) {
    if (project.state !== "open" || !project.subjects.some((s) => subjectConditions(s).window)) continue
    for (const progress of subjectProgress(catalog, project, tonight)) {
      if (progress.complete || !progress.window || progress.window.state === "passed") continue
      out.push({ project, subject: progress.subject, window: progress.window, priority: progress.window.priority })
    }
  }
  return out.sort((a, b) => b.priority - a.priority || a.window.nightsLeft - b.window.nightsLeft)
}

// ---------------------------------------------------------------------------
// Gate vocabulary and links
// ---------------------------------------------------------------------------

/**
 * Gate vocabulary: each state has its own glyph shape (`StepGlyph`), so
 * colour only reinforces. The review gate says what it waits for, "Needs
 * review", so it does not read as the Review step's name.
 */
export type GateState = "done" | "ready" | "review" | "blocked" | "running" | "partial" | "idle"

/** The gate word for a state (`gateWord` words it). */
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

/** A Project's one Next action (PRJ-FR-18): what to do, why, and where. */
export interface NextAction {
  label: MessageRef
  reason: MessageRef
  link: StepLink
}

export function projectLink(projectId: ProjectId, search?: Record<string, string>): StepLink {
  return { to: "/projects/$projectId", params: { projectId }, search }
}

/** The hash path of a Project page, for Activity entries and operation links. */
export function projectHref(projectId: ProjectId, search?: Record<string, string>): string {
  const query = search ? `?${new URLSearchParams(search).toString()}` : ""
  return `/projects/${projectId}${query}`
}

/** An unsettled operation that holds a step back: "Apply · M 31 is running". */
export function operationHolds(op: Operation): MessageRef {
  if (op.status === "paused") return msg("domain_operation_paused", { title: op.title })
  if (op.status === "interrupted") return msg("domain_operation_interrupted", { title: op.title })
  return msg("domain_operation_running", { title: op.title })
}

// ---------------------------------------------------------------------------
// Home (D-W35, D-W39, D-W48, PRJ-FR-17 to PRJ-FR-19)
// ---------------------------------------------------------------------------

/** Sessions that match or are held by at least one Project (any state), reviewed or not. */
function sessionsInProjects(catalog: Catalog): Set<SessionId> {
  const ids = new Set<SessionId>()
  for (const project of Object.values(catalog.projects)) {
    for (const c of projectMatches(catalog, project)) ids.add(c.session.id)
    for (const input of project.inputs) ids.add(input.sessionId)
  }
  return ids
}

export interface SessionsNeedingWork {
  /** No confirmed Target (LIB-FR-17). */
  needsTarget: Session[]
  /** A confirmed Target but no Project's suggestion or input. */
  notInProject: Session[]
  /** Sessions open Projects match that still have Unreviewed frames: they wait in the review queue (P-REV2). */
  unreviewed: Array<{ session: Session; projectId: ProjectId; frames: number }>
  /** Light sessions that need calibration (`needsCalibration`), reviewed or not (Import never waits): the Library's "Needs calibration" queue (LIB-FR-23), which Home counts. */
  needsCalibration: Session[]
  /** Suggestions of an open Project that it can add now (PRJ-FR-19): Ready and settled. */
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

/** A light session's intake state (§5.7, P-REV2): it can join a Project only once Ready (and settled). */
export type SessionReadiness = "needs-target" | "needs-rig" | "needs-review" | "ready"

/** Ready means a settled Target, a settled rig and every live frame Usable or Unusable (C10). Calibration settles separately (`isSettled`). */
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

/**
 * Whether a light session waits in the Library's "Needs calibration" queue
 * (LIB-FR-23, D-W113): a kind still waiting or only suggested, or a pinned
 * file that changed or went missing. The pin stays; the user reassigns it
 * there. A pinned file on a volume that is not mounted is offline, not drift.
 */
export function needsCalibration(disk: Disk, session: Session): boolean {
  return !isSettled(session.calibration) || sessionPinProblems(disk, session.calibration).some((p) => p.state !== "unreadable")
}

/** The Library's "Needs calibration" queue (`needsCalibration`), oldest night first. */
export function calibrationQueue(catalog: Catalog, disk: Disk): Session[] {
  return liveLightSessions(catalog)
    .filter((s) => needsCalibration(disk, s))
    .sort((a, b) => a.night.localeCompare(b.night) || a.startedAt.localeCompare(b.startedAt) || a.id.localeCompare(b.id))
}

/** The session intake step page: `/sessions/$sessionId?step=` (C14). */
export function sessionIntakeLink(sessionId: SessionId, step: SessionIntakeStepId): StepLink {
  return { to: "/sessions/$sessionId", params: { sessionId }, search: { step } }
}

export function sessionsNeedingWork(catalog: Catalog, disk: Disk): SessionsNeedingWork {
  const live = liveLightSessions(catalog)
  const inProjects = sessionsInProjects(catalog)
  const out: SessionsNeedingWork = { needsTarget: [], notInProject: [], unreviewed: [], needsCalibration: [], readyToAdd: [] }
  for (const session of live) {
    if (!sessionTargetId(session)) out.needsTarget.push(session)
    else if (!inProjects.has(session.id)) out.notInProject.push(session)
    if (needsCalibration(disk, session)) out.needsCalibration.push(session)
  }
  for (const project of Object.values(catalog.projects)) {
    if (project.state !== "open") continue
    for (const { session } of projectSessionsNeedingReview(catalog, project)) {
      const frames = sessionUnreviewedFrames(catalog, session)
      if (frames > 0) out.unreviewed.push({ session, projectId: project.id, frames })
    }
    for (const suggestion of projectSuggestions(catalog, project)) {
      if (!suggestion.blocked) out.readyToAdd.push({ session: suggestion.session, projectId: project.id })
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

// ---------------------------------------------------------------------------
// Archive destinations (P-ARC1)
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

/** Live (not Trashed) light sessions per confirmed or associated Target (PLAN-TGT-FR-08); a Target only suggested for a session counts none (D-W124). */
export function sessionCountsByTarget(catalog: Catalog): Map<TargetId, number> {
  const counts = new Map<TargetId, number>()
  for (const session of liveLightSessions(catalog)) {
    const id = sessionTargetId(session)
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  return counts
}

export interface MyTarget {
  target: Target
  /** Open Projects that have it as a subject (the D-W60 badges). */
  projects: Project[]
  /** Its sessions, counted as `sessionCountsByTarget` counts them. */
  sessions: number
}

/**
 * My targets (D-W60, D-W125): ★ favourites, every subject of an open
 * Project, and every Target with at least one session
 * (`sessionCountsByTarget`), so a Target appears as soon as its sessions
 * are indexed.
 */
export function myTargets(catalog: Catalog): MyTarget[] {
  const sessions = sessionCountsByTarget(catalog)
  const out = new Map<TargetId, MyTarget>()
  const entryOf = (target: Target) => out.get(target.id) ?? { target, projects: [], sessions: sessions.get(target.id) ?? 0 }
  for (const target of Object.values(catalog.targets)) if (target.favourite || sessions.has(target.id)) out.set(target.id, entryOf(target))
  for (const project of Object.values(catalog.projects)) {
    if (project.state !== "open") continue
    for (const subject of project.subjects) {
      const target = catalog.targets[subject.targetId]
      if (!target) continue
      const entry = entryOf(target)
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
export function openStepState(isCurrent: boolean, gate: FlowGate | null, settledBefore: boolean): FlowStepState {
  if (isCurrent) return gate ? "blocked" : "current"
  return settledBefore ? "redo" : "todo"
}

/** Proceed waits while an operation affecting the step runs: "Apply · M 31 is running". */
export function runningGate(operations: Operation[]): FlowGate | null {
  return operations.length > 0 ? { reason: joinRefs(operations.map(operationHolds), "; "), blockers: [] } : null
}

/** "Finished 12 Oct": when a step or flow settled. */
export function finishedOn(at: IsoDateTime): MessageRef {
  return msg("stepflow_finished_on", { date: nightRef(at.slice(0, 10)) })
}

// --- Corrected metadata at Apply (PREP-FR-03, C15, D11) --------------------

/** One corrected value of a held session: the recorded header value and the catalog's correction, set at intake. */
export interface CorrectedValue {
  session: Session
  field: CorrectionField
  recorded: string | null
  corrected: string
}

export interface ViewCorrections {
  /** Each session × field whose correction differs from the recorded value: the Apply sheet shows "N corrected values". */
  values: CorrectedValue[]
  /** How each frame in the View gets each value: through the profile's configuration when it reads corrected values, else as an isolated patched copy. */
  decisions: MetadataDecision[]
}

/**
 * The corrections the Project's frames carry (PREP-FR-03). Corrections are
 * made at intake, not at Apply (C15): Apply applies every one, with no
 * per-field choice, and reports the count. Originals and links are never
 * patched.
 */
export function viewCorrections(catalog: Catalog, inputs: ProjectInput[], profile: ApplicationProfile | null): ViewCorrections {
  const out: ViewCorrections = { values: [], decisions: [] }
  const decision: MetadataDecision["decision"] = profile?.capability.correctedMetadata === "configuration" ? "configuration" : "patched-copy"
  for (const input of inputs) {
    const session = catalog.sessions[input.sessionId]
    if (!session) continue
    for (const field of new Set(session.corrections.map((c) => c.field))) {
      const correction = latestCorrection(session, field)
      if (!correction || correction.observedValue === correction.correctedValue) continue
      out.values.push({ session, field, recorded: correction.observedValue, corrected: correction.correctedValue })
      for (const assetId of session.assetIds) {
        if (frameOut(catalog, input, assetId) !== null) continue
        out.decisions.push({ assetId, field, observed: correction.observedValue, corrected: correction.correctedValue, decision })
      }
    }
  }
  return out
}

// --- Session intake (P-REV2, C10, C14, C15) --------------------------------

export type SessionIntakeStepId = "target" | "rig" | "review"

export const SESSION_INTAKE_STEPS: SessionIntakeStepId[] = ["target", "rig", "review"]

/** "Target", "Rig", "Review". */
export const SESSION_INTAKE_NAME: Record<SessionIntakeStepId, MessageRef> = { target: msg("sessions_column_target"), rig: msg("sessions_column_rig"), review: msg("step_review") }

export interface SessionIntakeState {
  steps: Array<DerivedStep<SessionIntakeStepId>>
  /** The first step not settled; Review once the session is Ready. */
  current: SessionIntakeStepId
  readiness: SessionReadiness
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
 * gates them on that choice. Review is always allowed: a Project that holds
 * the session gets the change as a pending change, labelled as the
 * Library's (VSEL-FR-12). A Ready session stays on Review, whose Finish
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
  const summaries: Record<SessionIntakeStepId, MessageRef> = {
    target: target ? verbatim(target.name) : msg("sessions_filter_needs_target"),
    rig: rigId ? rigRef(catalog, rigId) : msg("sessions_rig_needs_review"),
    review: unreviewed > 0 ? msg("flow_frames_unreviewed", { count: unreviewed }) : msg("status_ready"),
  }
  const current = SESSION_INTAKE_STEPS.find((id) => !settled[id]) ?? "review"
  const steps = SESSION_INTAKE_STEPS.map((id): DerivedStep<SessionIntakeStepId> => {
    if (settled[id]) return { id, state: "finished", gate: null, summary: summaries[id] }
    const gate = id === current && id === "review" ? reviewGate : null
    return { id, state: openStepState(id === current, gate, false), gate, summary: summaries[id] }
  })
  const corrections = SESSION_CORRECTION_FIELDS.flatMap((field): CorrectedValue[] => {
    const correction = latestCorrection(session, field)
    return correction && correction.observedValue !== correction.correctedValue ? [{ session, field, recorded: correction.observedValue, corrected: correction.correctedValue }] : []
  })
  return { steps, current, readiness: sessionReadiness(catalog, session), next: nextInReviewQueue(catalog, session), corrections }
}

const SESSION_CORRECTION_FIELDS: CorrectionField[] = ["target", "equipment", "filter", "exposure", "focal-length"]

// --- Calibration process (P-CAL3) ------------------------------------------

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
    return { id, state: openStepState(id === current, gate, false), gate, summary }
  })
  return { steps, current, finished }
}

export function calibrationStepLink(processId: CalibrationProcessId, step: CalibrationStepId): StepLink {
  return { to: "/calibration/processes/$processId/$step", params: { processId, step } }
}
