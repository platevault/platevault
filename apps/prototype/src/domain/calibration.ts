/**
 * Explainable calibration matching for a run (D13, CAL-FR-01 to CAL-FR-10,
 * D-W5, D-W55). Ported from harness v4's T4 domain: the requirement table
 * behind "Review matches", automatic assignment, and the drift checks of
 * accepted inputs. A run matches only against its own rig (CAL-FR-10): the
 * camera criteria cover darks and bias, the optical train criterion covers
 * flats. Runs are assigned masters only (P-CAL3): raw calibration frames are
 * input to a calibration process (`calibration-process.ts`), never a run
 * input. Nothing here writes state.
 */
import { correctedExposureS } from "./corrections"
import { fileAt } from "./disk"
import { isUnder } from "./indexing"
import { memberSessions, type MemberSession } from "./membership"
import type {
  AssetId,
  CalibrationAssignment,
  CalibrationInput,
  CalibrationKind,
  CalibrationPolicy,
  Catalog,
  Disk,
  IsoDateTime,
  MatchCriterion,
  MembershipContent,
  Run,
  Session,
  SessionId,
} from "./types"
import { fileName, formatExposure } from "@/lib/format"
import { joinRefs, type MessageRef, msg, verbatim } from "@/lib/i18n"

export const KINDS: CalibrationKind[] = ["dark", "flat", "bias"]

/** "Dark", "Flat", "Bias", "Dark flat". */
export const KIND_NAME: Record<CalibrationKind, MessageRef> = {
  dark: msg("calibration_kind_dark"),
  flat: msg("calibration_kind_flat"),
  bias: msg("calibration_kind_bias"),
  "dark-flat": msg("calibration_kind_dark_flat"),
}

/** The kind mid-sentence: "dark", "flat", "bias" ("Dark flat" keeps its capital: a lowercase copy would duplicate its catalogue value). */
export const KIND_NOUN: Record<CalibrationKind, MessageRef> = {
  dark: msg("run_cal_kind_dark"),
  flat: msg("run_cal_kind_flat"),
  bias: msg("run_cal_kind_bias"),
  "dark-flat": msg("calibration_kind_dark_flat"),
}

const MASTER_TYPE_NAME: Record<CalibrationKind, MessageRef> = {
  dark: msg("import_type_master_dark"),
  flat: msg("import_type_master_flat"),
  bias: msg("calibration_caption_bias"),
  "dark-flat": msg("import_type_master_dark_flat"),
}

/** One reusable calibration input: an adopted master. */
export interface CalSource {
  input: CalibrationInput
  /** Master id; also the `/calibration` key. */
  id: string
  kind: CalibrationKind
  name: string
  night: string | null
  cameraName: string | null
  telescopeName: string | null
  widthPx: number | null
  heightPx: number | null
  binning: number
  gain: number | null
  offset: number | null
  exposureS: number | null
  channel: string | null
  /** Optical train evidence; null when unknown. */
  opticalTrainId: string | null
  ccdTempC: number | null
  frameCount: number | null
  imageTypeLabel: MessageRef
  /** Master file path. */
  path: string
  /** Files handed off for this input. */
  files: Array<{ assetId: AssetId | null; path: string; sizeBytes: number; fileName: string }>
}

export function masterSource(catalog: Catalog, masterId: string): CalSource | null {
  const master = catalog.masters[masterId]
  if (!master) return null
  const asset = Object.values(catalog.assets).find((a) => a.copies.some((c) => c.path === master.path))
  return {
    input: { type: "master", masterId: master.id },
    id: master.id,
    kind: master.kind,
    name: fileName(master.path),
    night: master.createdAt.slice(0, 10),
    cameraName: master.cameraName,
    telescopeName: null,
    widthPx: master.widthPx,
    heightPx: master.heightPx,
    binning: master.binning,
    gain: master.gain,
    offset: master.offset,
    exposureS: master.exposureS,
    channel: master.channel,
    opticalTrainId: master.opticalTrainId,
    ccdTempC: master.ccdTempC,
    frameCount: master.frameCount,
    imageTypeLabel: MASTER_TYPE_NAME[master.kind],
    path: master.path,
    files: [{ assetId: asset?.id ?? null, path: master.path, sizeBytes: asset?.sizeBytes ?? 0, fileName: fileName(master.path) }],
  }
}

export function sourceFor(catalog: Catalog, input: CalibrationInput): CalSource | null {
  return masterSource(catalog, input.masterId)
}

/**
 * The bytes at a path when they can be read now, else null: missing, on a
 * volume that is not mounted, or denied. Unreadable is unverified, never matched (D19).
 */
function readableSha(disk: Disk, path: string): string | null {
  const file = fileAt(disk, path)
  if (!file || disk.volumes[file.volumeId]?.mounted === false) return null
  if (disk.deniedPaths.some((denied) => isUnder(path, denied))) return null
  return file.sha256
}

/**
 * Why an input's current bytes do not match their basis, or null when they do
 * (CAL-FR-08, D19). An adopted master is checked against its adoption digest,
 * a library master against the SHA-256 recorded when it was indexed. A master
 * that cannot be read is unverified.
 */
export function inputDrift(catalog: Catalog, disk: Disk, input: CalibrationInput): string | null {
  const master = catalog.masters[input.masterId]
  if (!master) return "This master is no longer in the calibration library."
  const source = masterSource(catalog, master.id)
  const assetId = source?.files[0]?.assetId
  const basis = master.adoption?.verifiedSha256 ?? (assetId ? (catalog.assets[assetId]?.sha256 ?? null) : null)
  const current = readableSha(disk, master.path)
  if (current === null) return `Unverified: ${master.path} cannot be read, so its bytes cannot be checked against ${master.adoption ? "its adoption digest" : "its recorded SHA-256"}.`
  if (basis !== null && current !== basis) return master.adoption ? "Drifted: its SHA-256 differs from its adoption digest." : "Drifted: its SHA-256 differs from the digest recorded when it was indexed."
  return null
}

/** The files an input hands off and the SHA-256 each has now: the basis recorded on acceptance (CAL-FR-08). */
export function basisFiles(catalog: Catalog, disk: Disk, input: CalibrationInput): Array<{ path: string; sha256: string }> {
  return (sourceFor(catalog, input)?.files ?? []).flatMap((file) => {
    const sha256 = readableSha(disk, file.path)
    return sha256 === null ? [] : [{ path: file.path, sha256 }]
  })
}

/** A recorded acceptance basis whose file now reads different bytes (D19). */
function basisDrift(disk: Disk, assignment: CalibrationAssignment): string | null {
  const changed = assignment.basis?.files.find((file) => {
    const current = readableSha(disk, file.path)
    return current !== null && current !== file.sha256
  })
  return changed ? `Drifted: ${fileName(changed.path)} changed since this input was accepted (SHA-256 differs).` : null
}

/** Reusable sources only: adopted masters whose bytes match their basis. Candidates never match (CAL-AC-04), nor a dismissed master (P-CAL2). */
export function reusableSources(catalog: Catalog, disk: Disk): CalSource[] {
  const out: CalSource[] = []
  for (const master of Object.values(catalog.masters)) {
    if (master.state !== "adopted" || master.dismissedAt) continue
    if (inputDrift(catalog, disk, { type: "master", masterId: master.id })) continue
    const source = masterSource(catalog, master.id)
    if (source) out.push(source)
  }
  return out
}

export interface LightGeometry {
  cameraName: string | null
  widthPx: number | null
  heightPx: number | null
  binning: number
  gain: number | null
  offset: number | null
  exposureS: number
  channel: string | null
  opticalTrainId: string | null
  ccdTempC: number | null
}

export function lightGeometry(catalog: Catalog, session: Session): LightGeometry {
  const first = session.assetIds.map((id) => catalog.assets[id]).find((a) => a !== undefined)
  const train = session.equipment.status === "confirmed" || session.equipment.status === "associated" ? session.equipment.value : null
  return {
    cameraName: session.cameraName,
    widthPx: first?.observed.widthPx ?? null,
    heightPx: first?.observed.heightPx ?? null,
    binning: session.binning,
    gain: session.gain,
    offset: session.offset,
    exposureS: correctedExposureS(session) ?? session.exposureS,
    channel: session.channel,
    opticalTrainId: train,
    ccdTempC: session.ccdTempC,
  }
}

export function trainName(catalog: Catalog, id: string | null): string | null {
  return id ? (catalog.opticalTrains[id]?.name ?? id) : null
}

function criterion(name: MatchCriterion["name"], light: string | null, calibration: string | null): MatchCriterion {
  const result = light === null || calibration === null ? "unknown" : light === calibration ? "compatible" : "incompatible"
  const value = (v: string | null) => (v === null ? msg("domain_not_recorded") : verbatim(v))
  return { name, result, lightValue: value(light), calibrationValue: value(calibration) }
}

const str = (value: number | string | null) => (value === null ? null : String(value))

/** The calibration facts the D13 criteria compare: a master's, or a raw calibration session's before it is stacked. */
export type MatchSource = Pick<CalSource, "kind" | "cameraName" | "widthPx" | "heightPx" | "binning" | "gain" | "offset" | "exposureS" | "channel" | "opticalTrainId" | "imageTypeLabel">

/** D13 criteria for one light session and one calibration source; temperature is never compared. */
export function matchCriteria(catalog: Catalog, light: LightGeometry, source: MatchSource): MatchCriterion[] {
  const lightDims = light.widthPx === null || light.heightPx === null ? null : `${light.widthPx} × ${light.heightPx}`
  const sourceDims = source.widthPx === null || source.heightPx === null ? null : `${source.widthPx} × ${source.heightPx}`
  const list: MatchCriterion[] = [
    criterion("camera", light.cameraName, source.cameraName),
    criterion("dimensions", lightDims, sourceDims),
    criterion("binning", `${light.binning}×${light.binning}`, `${source.binning}×${source.binning}`),
    criterion("gain", str(light.gain), str(source.gain)),
    criterion("offset", str(light.offset), str(source.offset)),
    { name: "image-type", result: "compatible", lightValue: msg("import_type_light"), calibrationValue: source.imageTypeLabel },
  ]
  if (source.kind === "dark") {
    list.push(criterion("exposure", formatExposure(light.exposureS), source.exposureS === null ? null : formatExposure(source.exposureS)))
  }
  if (source.kind === "flat") {
    list.push(criterion("channel", light.channel, source.channel))
    list.push(criterion("optical-train", trainName(catalog, light.opticalTrainId), trainName(catalog, source.opticalTrainId)))
  }
  return list
}

export const CRITERION_NAME: Record<MatchCriterion["name"], MessageRef> = {
  camera: msg("domain_criterion_camera"),
  dimensions: msg("domain_criterion_dimensions"),
  binning: msg("domain_criterion_binning"),
  gain: msg("domain_criterion_gain"),
  offset: msg("domain_criterion_offset"),
  "image-type": msg("domain_criterion_image_type"),
  exposure: msg("domain_criterion_exposure"),
  channel: msg("domain_criterion_channel"),
  "optical-train": msg("domain_criterion_rig"),
  temperature: msg("domain_criterion_temperature"),
}

export interface MatchSummary {
  compatible: number
  incompatible: number
  unknown: number
  allCompatible: boolean
}

export function summarize(criteria: MatchCriterion[]): MatchSummary {
  const compatible = criteria.filter((c) => c.result === "compatible").length
  const incompatible = criteria.filter((c) => c.result === "incompatible").length
  const unknown = criteria.filter((c) => c.result === "unknown").length
  return { compatible, incompatible, unknown, allCompatible: incompatible === 0 && unknown === 0 }
}

/** "All 8 criteria compatible", or the criteria that are not: "Rig unknown". */
export function summaryRef(criteria: MatchCriterion[]): MessageRef {
  const bad = criteria.filter((c) => c.result !== "compatible")
  if (bad.length === 0) return msg("domain_criteria_all_compatible", { count: criteria.length })
  return joinRefs(
    bad.map((c) => msg(c.result === "unknown" ? "domain_criterion_unknown" : "domain_criterion_incompatible", { criterion: CRITERION_NAME[c.name] })),
    ", ",
  )
}

export interface Candidate {
  source: CalSource
  criteria: MatchCriterion[]
  summary: MatchSummary
}

function nightDistance(a: string, b: string | null): number {
  if (!b) return Number.POSITIVE_INFINITY
  return Math.abs(new Date(a).getTime() - new Date(b).getTime())
}

/**
 * The matching rule's order: compatible first, then fewer incompatible and
 * unknown criteria, then the nearest night, then more frames. Night and frame
 * count only order; neither is ever a criterion. Negative when `a` ranks first.
 */
export function compareCandidates(night: string, a: Candidate, b: Candidate): number {
  return (
    Number(b.summary.allCompatible) - Number(a.summary.allCompatible) ||
    a.summary.incompatible - b.summary.incompatible ||
    a.summary.unknown - b.summary.unknown ||
    nightDistance(night, a.source.night) - nightDistance(night, b.source.night) ||
    (b.source.frameCount ?? 0) - (a.source.frameCount ?? 0)
  )
}

/** Candidates for one requirement, in the matching rule's order (`compareCandidates`). */
export function candidatesFor(catalog: Catalog, session: Session, kind: CalibrationKind, sources: CalSource[]): Candidate[] {
  const light = lightGeometry(catalog, session)
  return sources
    .filter((s) => s.kind === kind)
    .map((source) => {
      const criteria = matchCriteria(catalog, light, source)
      return { source, criteria, summary: summarize(criteria) }
    })
    .sort((a, b) => compareCandidates(session.night, a, b))
}

export function sameInput(a: CalibrationInput | null, b: CalibrationInput | null): boolean {
  return a !== null && b !== null && a.masterId === b.masterId
}

export function inputKey(input: CalibrationInput): string {
  return input.masterId
}

/**
 * Row state. "automatic" is a compatible master the automatic policy assigns
 * without a click (D-W5, D-W55); once stored it stays the run's choice. With
 * the policy off a compatible master is "suggested" and waits for Accept.
 */
export type RowState = CalibrationAssignment["state"]

export interface RequirementRow {
  key: string
  /** The first light session the row covers: its facts and night rank the candidates. */
  member: MemberSession
  /** Every light session the row covers, in run order (`requirementKey`). */
  members: MemberSession[]
  kind: CalibrationKind
  /** Stored decision for this run, if any. */
  assignment: CalibrationAssignment | null
  /** The best compatible candidate. */
  suggestion: Candidate | null
  /** Best candidate when nothing is fully compatible; named, not preselected. */
  closest: Candidate | null
  candidates: Candidate[]
  state: RowState
  /** Input handed off (automatic, accepted or exception), or the one on offer. */
  input: CalibrationInput | null
  source: CalSource | null
  criteria: MatchCriterion[]
  /** The handed-off input's bytes no longer match its basis; the row needs review (CAL-FR-08). */
  drift: string | null
  /** A compatible master the matching rule ranks above the assigned one: offered as "Better match available", never switched to by itself. */
  better: Candidate | null
  /** Identifies the setup group: the covered lights' channels, rig, size, binning, gain and offset. */
  groupKey: string
  /** The group's setup, one ref per part, in the order of `groupKey`. */
  groupParts: MessageRef[]
}

/** The light sessions a row's decision is stored for. */
export function sessionIdsOf(row: RequirementRow): SessionId[] {
  return row.members.map((m) => m.session.id)
}

export function assignmentId(runId: string, sessionId: string, kind: CalibrationKind): string {
  return `cal_${runId}_${sessionId}_${kind}`
}

/**
 * Light sessions with the same key share one requirement row. Darks and bias
 * do not depend on the filter or the night (P-CAL3 files them per camera,
 * exposure, gain and offset), so they key on the light facts their criteria
 * compare (`matchCriteria`): one dark and one bias row across a run's
 * channels. Flats and dark flats stay per light session (filter and night).
 */
function requirementKey(catalog: Catalog, session: Session, kind: CalibrationKind): string {
  if (kind !== "dark" && kind !== "bias") return `${kind}|${session.id}`
  const g = lightGeometry(catalog, session)
  return [kind, g.cameraName, g.widthPx, g.heightPx, g.binning, g.gain, g.offset, ...(kind === "dark" ? [g.exposureS] : [])].join("|")
}

/** The setup group of the light sessions one row covers: their channels, then the rig and camera settings they share. */
function groupOf(catalog: Catalog, sessions: Session[]): { key: string; parts: MessageRef[] } {
  const session = sessions[0]!
  const g = lightGeometry(catalog, session)
  const train = trainName(catalog, g.opticalTrainId)
  const unknown = msg("status_unknown")
  const channels = [...new Set(sessions.map((s) => s.channel))]
  const values = [channels.join(","), train ?? g.cameraName, g.widthPx && g.heightPx ? `${g.widthPx}\u00a0×\u00a0${g.heightPx}` : null, String(g.binning), `${g.gain ?? "?"}/${g.offset ?? "?"}`]
  const parts = [
    joinRefs(
      channels.map((channel) => (channel ? verbatim(channel) : msg("palette_session_no_filter"))),
      ", ",
    ),
    train ? verbatim(train) : msg("domain_cal_group_rig_unknown", { camera: g.cameraName ? verbatim(g.cameraName) : msg("newproject_camera_unknown") }),
    g.widthPx && g.heightPx ? verbatim(`${g.widthPx}\u00a0×\u00a0${g.heightPx}`) : msg("domain_cal_group_size_unknown"),
    msg("run_cal_bin", { binning: g.binning }),
    msg("domain_cal_group_gain_offset", { gain: g.gain ?? unknown, offset: g.offset ?? unknown }),
  ]
  return { key: values.join("|"), parts }
}

export interface CalibrationPlan {
  policy: CalibrationPolicy
  rows: RequirementRow[]
  groups: Array<{ key: string; parts: MessageRef[]; rows: RequirementRow[] }>
  counts: Record<RowState, number>
  /** Rows that need the user: no compatible input, deferred, or a drifted input (CAL-AC-06). With the policy off, drifted inputs only; a Complete run's, none. */
  needsReview: RequirementRow[]
}

const HANDED_OFF = new Set<RowState>(["automatic", "accepted", "exception"])

/**
 * The run's calibration requirements. With the automatic policy every row
 * with a compatible candidate is assigned without a click, and a stored
 * assignment keeps its master when a better one appears (no silent re-rank);
 * rows with no compatible input, deferred rows and drifted inputs need
 * review. With the policy off compatible masters are Suggested and nothing is
 * handed off until accepted (D-W55, round 6). A Complete run's calibration is
 * what it recorded (Complete records its automatic choices, `automaticAssignments`):
 * nothing is matched or judged again, and nothing needs review, until Reopen.
 */
export function calibrationPlan(catalog: Catalog, disk: Disk, run: Run, policy: CalibrationPolicy, content: MembershipContent | null): CalibrationPlan {
  const counts: Record<RowState, number> = { automatic: 0, suggested: 0, accepted: 0, exception: 0, deferred: 0, unresolved: 0 }
  const frozen = run.completion === "complete"
  const sources = frozen ? [] : reusableSources(catalog, disk)
  const requirements = new Map<string, { kind: CalibrationKind; members: MemberSession[] }>()
  for (const member of content ? memberSessions(catalog, content) : []) {
    for (const kind of KINDS) {
      const key = requirementKey(catalog, member.session, kind)
      const requirement = requirements.get(key)
      if (requirement) requirement.members.push(member)
      else requirements.set(key, { kind, members: [member] })
    }
  }
  const rows: RequirementRow[] = []
  for (const [key, { kind, members }] of requirements) {
    const member = members[0]!
    const group = groupOf(catalog, members.map((m) => m.session))
    const candidates = candidatesFor(catalog, member.session, kind, sources)
    const suggestion = candidates[0]?.summary.allCompatible ? candidates[0] : null
    const closest = suggestion ? null : (candidates[0] ?? null)
    // Decisions are stored per light session, for every session the row covers; the first one found decides.
    const stored = members.map((m) => run.calibration.find((a) => a.lightSessionId === m.session.id && a.kind === kind)).find((a) => a !== undefined) ?? null
    // Off assigns nothing by itself: a stored automatic choice waits for Accept like any suggestion.
    const assignment = policy === "off" && stored?.state === "automatic" ? null : stored
    let state: RowState
    let input: CalibrationInput | null
    let criteria: MatchCriterion[]
    let drift: string | null = null
    let better: Candidate | null = null
    if (assignment) {
      state = assignment.state
      input = assignment.input
      const live = assignment.input ? candidates.find((c) => sameInput(c.source.input, assignment.input)) : undefined
      criteria = assignment.criteria.length > 0 ? assignment.criteria : (live?.criteria ?? [])
      if (!frozen && assignment.input && HANDED_OFF.has(state)) {
        drift = inputDrift(catalog, disk, assignment.input) ?? basisDrift(disk, assignment)
        if (suggestion && !sameInput(suggestion.source.input, assignment.input) && (!live || compareCandidates(member.session.night, suggestion, live) < 0)) better = suggestion
      }
    } else if (suggestion) {
      state = policy === "automatic" ? "automatic" : "suggested"
      input = suggestion.source.input
      criteria = suggestion.criteria
      if (policy === "automatic") drift = inputDrift(catalog, disk, suggestion.source.input)
    } else {
      state = "unresolved"
      input = null
      criteria = closest?.criteria ?? []
    }
    rows.push({
      key,
      member,
      members,
      kind,
      assignment,
      suggestion,
      closest,
      candidates,
      state,
      input,
      source: input ? sourceFor(catalog, input) : null,
      criteria,
      drift,
      better,
      groupKey: group.key,
      groupParts: group.parts,
    })
  }
  const groups: CalibrationPlan["groups"] = []
  for (const row of rows) {
    const g = groups.find((x) => x.key === row.groupKey)
    if (g) g.rows.push(row)
    else groups.push({ key: row.groupKey, parts: row.groupParts, rows: [row] })
  }
  for (const row of rows) counts[row.state] += 1
  const needsReview = frozen ? [] : rows.filter((r) => r.drift !== null || (policy === "automatic" && (r.state === "suggested" || r.state === "deferred" || r.state === "unresolved")))
  return { policy, rows, groups, counts, needsReview }
}

/**
 * The plan's automatic choices as stored assignments, each with the SHA-256
 * its files have now: recorded before a master joins the matched set (no
 * silent re-rank) and on Complete, which freezes what the run handed off.
 */
export function automaticAssignments(catalog: Catalog, disk: Disk, runId: string, plan: CalibrationPlan, at: IsoDateTime): CalibrationAssignment[] {
  return plan.rows.flatMap((row): CalibrationAssignment[] => {
    const input = row.input
    if (row.state !== "automatic" || row.assignment !== null || !input) return []
    const basis = { at, files: basisFiles(catalog, disk, input) }
    return row.members.map(({ session }) => ({ id: assignmentId(runId, session.id, row.kind), lightSessionId: session.id, kind: row.kind, input, state: "automatic", criteria: row.criteria, exception: null, basis }))
  })
}

/** Handed-off calibration inputs, deduplicated (one master can serve many sessions). */
export function handoffCalibration(catalog: Catalog, plan: CalibrationPlan): CalSource[] {
  const out: CalSource[] = []
  for (const row of plan.rows) {
    if (!HANDED_OFF.has(row.state) || !row.input || row.drift) continue
    if (out.some((s) => sameInput(s.input, row.input))) continue
    const source = sourceFor(catalog, row.input)
    if (source) out.push(source)
  }
  return out
}
