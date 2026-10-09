/**
 * Explainable calibration matching for a run (D13, CAL-FR-01 to CAL-FR-10,
 * D-W5, D-W55). Ported from harness v4's T4 domain: the requirement table
 * behind "Review matches", automatic assignment, and the drift checks of
 * accepted inputs. A run matches only against its own rig (CAL-FR-10): the
 * camera criteria cover darks and bias, the optical train criterion covers
 * flats. Nothing here writes state.
 */
import { correctedExposureS } from "./corrections"
import { preferredCopy } from "./library"
import { fileAt } from "./disk"
import { isUnder } from "./indexing"
import { memberSessions, type MemberSession } from "./membership"
import type {
  Asset,
  AssetId,
  CalibrationAssignment,
  CalibrationInput,
  CalibrationKind,
  CalibrationPolicy,
  Catalog,
  Disk,
  MatchCriterion,
  MembershipContent,
  Run,
  Session,
} from "./types"
import { fileName, formatExposure, formatNight, plural } from "@/lib/format"

export const KINDS: CalibrationKind[] = ["dark", "flat", "bias"]

export const KIND_LABEL: Record<CalibrationKind, string> = { dark: "Dark", flat: "Flat", bias: "Bias", "dark-flat": "Dark flat" }

const IMAGE_TYPE_LABEL: Record<string, string> = {
  dark: "Dark",
  flat: "Flat",
  bias: "Bias",
  "dark-flat": "Dark flat",
  "master-dark": "Master dark",
  "master-flat": "Master flat",
  "master-bias": "Master bias",
}

/** One reusable calibration input: an adopted master or a raw calibration set. */
export interface CalSource {
  input: CalibrationInput
  /** Master id or raw-set session id; also the `/calibration` key. */
  id: string
  kind: CalibrationKind
  isMaster: boolean
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
  imageTypeLabel: string
  /** Master file path, or the folder of a raw set. */
  path: string
  /** Files handed off for this input. */
  files: Array<{ assetId: AssetId | null; path: string; sizeBytes: number; fileName: string }>
}

export function rawSetSource(catalog: Catalog, session: Session): CalSource | null {
  const kind = session.imageType as CalibrationKind
  if (!["dark", "flat", "bias", "dark-flat"].includes(kind)) return null
  const assets = session.assetIds.map((id) => catalog.assets[id]).filter((a): a is Asset => a !== undefined && !a.trashed)
  if (assets.length === 0) return null
  const first = assets[0]
  const train = session.equipment.status === "confirmed" || session.equipment.status === "associated" ? session.equipment.value : null
  return {
    input: { type: "raw-set", sessionId: session.id },
    id: session.id,
    kind,
    isMaster: false,
    name: `${first?.fileName.replace(/_\d+\.\w+$/, "") ?? KIND_LABEL[kind]} · ${formatNight(session.night)}`,
    night: session.night,
    cameraName: session.cameraName,
    telescopeName: session.telescopeName,
    widthPx: first?.observed.widthPx ?? null,
    heightPx: first?.observed.heightPx ?? null,
    binning: session.binning,
    gain: session.gain,
    offset: session.offset,
    exposureS: session.exposureS,
    channel: session.channel,
    opticalTrainId: train,
    ccdTempC: session.ccdTempC,
    frameCount: assets.length,
    imageTypeLabel: IMAGE_TYPE_LABEL[session.imageType] ?? session.imageType,
    path: first?.copies[0]?.path.replace(/\/[^/]+$/, "") ?? "",
    files: assets.map((a) => ({ assetId: a.id, path: a.copies[0]?.path ?? "", sizeBytes: a.sizeBytes, fileName: a.fileName })),
  }
}

export function masterSource(catalog: Catalog, masterId: string): CalSource | null {
  const master = catalog.masters[masterId]
  if (!master) return null
  const asset = Object.values(catalog.assets).find((a) => a.copies.some((c) => c.path === master.path))
  return {
    input: { type: "master", masterId: master.id },
    id: master.id,
    kind: master.kind,
    isMaster: true,
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
    imageTypeLabel: IMAGE_TYPE_LABEL[`master-${master.kind}`] ?? master.kind,
    path: master.path,
    files: [{ assetId: asset?.id ?? null, path: master.path, sizeBytes: asset?.sizeBytes ?? 0, fileName: fileName(master.path) }],
  }
}

export function sourceFor(catalog: Catalog, input: CalibrationInput): CalSource | null {
  if (input.type === "master") return masterSource(catalog, input.masterId)
  const session = catalog.sessions[input.sessionId]
  return session ? rawSetSource(catalog, session) : null
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
 * a library master and a raw set against the SHA-256 recorded when they were
 * indexed. A master that cannot be read is unverified.
 */
export function inputDrift(catalog: Catalog, disk: Disk, input: CalibrationInput): string | null {
  if (input.type === "master") {
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
  const session = catalog.sessions[input.sessionId]
  if (!session) return "This calibration set is no longer in the catalog."
  for (const id of session.assetIds) {
    const asset = catalog.assets[id]
    if (!asset || asset.trashed) continue
    const path = preferredCopy(disk, catalog, asset).path
    const current = readableSha(disk, path)
    if (current !== null && current !== asset.sha256) return `Drifted: ${fileName(path)} differs from the digest recorded when it was indexed.`
  }
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

/** Reusable sources only: adopted masters whose bytes match their basis, and raw sets. Candidates never match (CAL-AC-04). */
export function reusableSources(catalog: Catalog, disk: Disk): CalSource[] {
  const out: CalSource[] = []
  for (const master of Object.values(catalog.masters)) {
    if (master.state !== "adopted") continue
    if (inputDrift(catalog, disk, { type: "master", masterId: master.id })) continue
    const source = masterSource(catalog, master.id)
    if (source) out.push(source)
  }
  for (const session of Object.values(catalog.sessions)) {
    if (session.supersededBy) continue
    const source = rawSetSource(catalog, session)
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
  return { name, result, lightValue: light ?? "Not recorded", calibrationValue: calibration ?? "Not recorded" }
}

const str = (value: number | string | null) => (value === null ? null : String(value))

/** D13 criteria for one light session and one calibration source; temperature is never compared. */
export function matchCriteria(catalog: Catalog, light: LightGeometry, source: CalSource): MatchCriterion[] {
  const lightDims = light.widthPx === null || light.heightPx === null ? null : `${light.widthPx} × ${light.heightPx}`
  const sourceDims = source.widthPx === null || source.heightPx === null ? null : `${source.widthPx} × ${source.heightPx}`
  const list: MatchCriterion[] = [
    criterion("camera", light.cameraName, source.cameraName),
    criterion("dimensions", lightDims, sourceDims),
    criterion("binning", `${light.binning}×${light.binning}`, `${source.binning}×${source.binning}`),
    criterion("gain", str(light.gain), str(source.gain)),
    criterion("offset", str(light.offset), str(source.offset)),
    { name: "image-type", result: "compatible", lightValue: "Light", calibrationValue: source.imageTypeLabel },
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

export const CRITERION_LABEL: Record<MatchCriterion["name"], string> = {
  camera: "Camera",
  dimensions: "Dimensions",
  binning: "Binning",
  gain: "Gain",
  offset: "Offset",
  "image-type": "Image type",
  exposure: "Exposure",
  channel: "Channel",
  "optical-train": "Rig",
  temperature: "Temperature",
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
export function summaryText(criteria: MatchCriterion[]): string {
  const bad = criteria.filter((c) => c.result !== "compatible")
  if (bad.length === 0) return `All ${criteria.length} criteria compatible`
  return bad.map((c) => `${CRITERION_LABEL[c.name]} ${c.result}`).join(", ")
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
 * Candidates for one requirement: compatible first, then masters before raw
 * sets, then the nearest night. Night orders only; it is never a criterion.
 */
export function candidatesFor(catalog: Catalog, session: Session, kind: CalibrationKind, sources: CalSource[]): Candidate[] {
  const light = lightGeometry(catalog, session)
  return sources
    .filter((s) => s.kind === kind)
    .map((source) => {
      const criteria = matchCriteria(catalog, light, source)
      return { source, criteria, summary: summarize(criteria) }
    })
    .sort(
      (a, b) =>
        Number(b.summary.allCompatible) - Number(a.summary.allCompatible) ||
        a.summary.incompatible - b.summary.incompatible ||
        a.summary.unknown - b.summary.unknown ||
        Number(b.source.isMaster) - Number(a.source.isMaster) ||
        nightDistance(session.night, a.source.night) - nightDistance(session.night, b.source.night),
    )
}

export function sameInput(a: CalibrationInput | null, b: CalibrationInput | null): boolean {
  if (!a || !b) return false
  return a.type === "master" ? b.type === "master" && a.masterId === b.masterId : b.type === "raw-set" && a.sessionId === b.sessionId
}

export function inputKey(input: CalibrationInput): string {
  return input.type === "master" ? input.masterId : input.sessionId
}

/**
 * Row state. "automatic" is a compatible suggestion the automatic policy
 * assigns without a click (D-W5, D-W55); the stored states override it.
 */
export type RowState = CalibrationAssignment["state"] | "automatic"

export interface RequirementRow {
  key: string
  member: MemberSession
  kind: CalibrationKind
  /** Stored decision for this run, if any. */
  assignment: CalibrationAssignment | null
  /** The best compatible candidate (never stored until accepted). */
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
  groupKey: string
  groupLabel: string
}

export function assignmentId(runId: string, sessionId: string, kind: CalibrationKind): string {
  return `cal_${runId}_${sessionId}_${kind}`
}

function groupOf(catalog: Catalog, session: Session): { key: string; label: string } {
  const g = lightGeometry(catalog, session)
  const train = trainName(catalog, g.opticalTrainId)
  const parts = [
    session.channel ?? "No filter",
    train ?? `Rig unknown · ${g.cameraName ?? "camera unknown"}`,
    g.widthPx && g.heightPx ? `${g.widthPx}\u00a0×\u00a0${g.heightPx}` : "Dimensions unknown",
    `bin ${g.binning}`,
    `gain ${g.gain ?? "unknown"} / offset ${g.offset ?? "unknown"}`,
  ]
  return { key: parts.join("|"), label: parts.join(" · ") }
}

export interface CalibrationPlan {
  policy: CalibrationPolicy
  rows: RequirementRow[]
  groups: Array<{ key: string; label: string; rows: RequirementRow[] }>
  counts: Record<RowState, number>
  /** Rows that need the user: no compatible input, deferred, or a drifted input (CAL-AC-06). */
  needsReview: RequirementRow[]
}

/**
 * The run's calibration requirements. With the automatic policy every row
 * with a compatible candidate is assigned without a click; only rows with no
 * compatible input, deferred rows and drifted inputs need review. With the
 * policy off nothing is handed off and nothing needs review (D-W55).
 */
export function calibrationPlan(catalog: Catalog, disk: Disk, run: Run, policy: CalibrationPolicy, content: MembershipContent | null): CalibrationPlan {
  const counts: Record<RowState, number> = { automatic: 0, suggested: 0, accepted: 0, exception: 0, deferred: 0, unresolved: 0 }
  if (policy === "off") return { policy, rows: [], groups: [], counts, needsReview: [] }
  const members = content ? memberSessions(catalog, content) : []
  const sources = reusableSources(catalog, disk)
  const rows: RequirementRow[] = []
  for (const member of members) {
    const group = groupOf(catalog, member.session)
    for (const kind of KINDS) {
      const candidates = candidatesFor(catalog, member.session, kind, sources)
      const suggestion = candidates[0]?.summary.allCompatible ? candidates[0] : null
      const closest = suggestion ? null : (candidates[0] ?? null)
      const assignment = run.calibration.find((a) => a.lightSessionId === member.session.id && a.kind === kind) ?? null
      let state: RowState
      let input: CalibrationInput | null
      let criteria: MatchCriterion[]
      let drift: string | null = null
      if (assignment) {
        state = assignment.state
        input = assignment.input
        const live = assignment.input ? candidates.find((c) => sameInput(c.source.input, assignment.input)) : undefined
        criteria = assignment.criteria.length > 0 ? assignment.criteria : (live?.criteria ?? [])
        if (assignment.input && (state === "accepted" || state === "exception")) drift = inputDrift(catalog, disk, assignment.input) ?? basisDrift(disk, assignment)
      } else if (suggestion) {
        state = "automatic"
        input = suggestion.source.input
        criteria = suggestion.criteria
        drift = inputDrift(catalog, disk, suggestion.source.input)
      } else {
        state = "unresolved"
        input = null
        criteria = closest?.criteria ?? []
      }
      rows.push({
        key: `${member.session.id}:${kind}`,
        member,
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
        groupKey: group.key,
        groupLabel: group.label,
      })
    }
  }
  const groups: CalibrationPlan["groups"] = []
  for (const row of rows) {
    const g = groups.find((x) => x.key === row.groupKey)
    if (g) g.rows.push(row)
    else groups.push({ key: row.groupKey, label: row.groupLabel, rows: [row] })
  }
  for (const row of rows) counts[row.state] += 1
  const needsReview = rows.filter((r) => r.state === "suggested" || r.state === "deferred" || r.state === "unresolved" || r.drift !== null)
  return { policy, rows, groups, counts, needsReview }
}

/** The Calibrate readiness line: "15 of 15 matched automatically" or "3 of 15 need review". */
export function readinessLine(plan: CalibrationPlan): string {
  if (plan.policy === "off") return "Calibration off: no calibration is handed off"
  if (plan.rows.length === 0) return "Select sessions first"
  if (plan.needsReview.length > 0) return `${plan.needsReview.length} of ${plural(plan.rows.length, "requirement")} need review`
  const automatic = plan.counts.automatic
  return automatic === plan.rows.length ? `${plan.rows.length} of ${plan.rows.length} matched automatically` : `${plural(plan.rows.length, "requirement")} matched`
}

/** Handed-off calibration inputs, deduplicated (one master can serve many sessions). */
export function handoffCalibration(catalog: Catalog, plan: CalibrationPlan): CalSource[] {
  const out: CalSource[] = []
  for (const row of plan.rows) {
    if ((row.state !== "automatic" && row.state !== "accepted" && row.state !== "exception") || !row.input || row.drift) continue
    if (out.some((s) => sameInput(s.input, row.input))) continue
    const source = sourceFor(catalog, row.input)
    if (source) out.push(source)
  }
  return out
}
