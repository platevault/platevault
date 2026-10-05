/**
 * T4 domain logic (pure; T4-owned): explainable calibration matching (D13,
 * CAL-FR-01 to CAL-FR-08), corrected-metadata differences (PREP-FR-03, D15)
 * and the preparation plan with its live checks (PREP-FR-04 to PREP-FR-08).
 * Nothing here writes state.
 */
import { correctedExposureS, latestCorrection } from "@/domain/corrections"
import { assetAvailability, preferredCopy, type AssetAvailability } from "@/domain/derive"
import { fileAt, filesUnder, freeBytes, listFolders, volumeForPath } from "@/domain/disk"
import { isUnder } from "@/domain/indexing"
import type {
  ApplicationProfile,
  Asset,
  AssetId,
  CalibrationAssignment,
  CalibrationInput,
  CalibrationKind,
  Catalog,
  CorrectionField,
  Disk,
  InputMode,
  MatchCriterion,
  MembershipContent,
  MembershipRevision,
  MetadataDecision,
  ResultKind,
  ResultRecord,
  Session,
  SessionId,
  View,
  Volume,
} from "@/domain/types"
import { formatBytes, formatExposure, formatNight, plural } from "@/lib/format"
import type { AssignmentBasis } from "@/store/slices/t4"

// ---------------------------------------------------------------------------
// Membership
// ---------------------------------------------------------------------------

/** The Calibration area reads the draft, else the latest revision (seam 8). */
export function workingMembership(view: View): MembershipContent | null {
  return view.draft ?? view.revisions.at(-1) ?? null
}

/** Review preparation and Prepare need a saved revision and no unsaved draft. */
export function savedMembership(view: View): MembershipRevision | null {
  return view.draft ? null : (view.revisions.at(-1) ?? null)
}

export interface MemberSession {
  session: Session
  /** Included frame identities of this session. */
  included: AssetId[]
  /** View-scoped exclusions of this session. */
  excluded: AssetId[]
}

/** Light sessions with included frames, by the frames' current session, in night order. */
export function memberSessions(catalog: Catalog, content: MembershipContent): MemberSession[] {
  const bySession = new Map<SessionId, MemberSession>()
  const touch = (assetId: AssetId, key: "included" | "excluded") => {
    const asset = catalog.assets[assetId]
    const session = asset?.sessionId ? catalog.sessions[asset.sessionId] : undefined
    if (!asset || !session || session.imageType !== "light") return
    const entry = bySession.get(session.id) ?? { session, included: [], excluded: [] }
    entry[key].push(assetId)
    bySession.set(session.id, entry)
  }
  for (const id of content.included) touch(id, "included")
  for (const id of content.excluded) touch(id, "excluded")
  return [...bySession.values()]
    .filter((m) => m.included.length > 0)
    .sort((a, b) => a.session.night.localeCompare(b.session.night) || (a.session.channel ?? "").localeCompare(b.session.channel ?? ""))
}

export function sessionLabel(session: Session): string {
  return [formatNight(session.night), session.channel ?? "No filter", formatExposure(session.exposureS)].join(" · ")
}

// ---------------------------------------------------------------------------
// Calibration sources and matching (D13)
// ---------------------------------------------------------------------------

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
  /** Master id or raw-set session id; also the `/calibration/$calibrationId` key. */
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

function fileName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1)
}

export function rawSetSource(catalog: Catalog, session: Session): CalSource | null {
  const kind = session.imageType as CalibrationKind
  if (!["dark", "flat", "bias", "dark-flat"].includes(kind)) return null
  const assets = session.assetIds.map((id) => catalog.assets[id]).filter((a): a is Asset => a !== undefined)
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
 * (CAL-FR-08, CAL-AC-10, D19). An adopted master is checked against its
 * adoption digest, a library master and a raw set against the SHA-256
 * recorded when they were indexed. A master that cannot be read is
 * unverified; a raw-set frame that cannot be read is left to Prepare, which
 * names offline and unreadable sources itself.
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
    if (!asset) continue
    const path = preferredCopy(disk, catalog, asset).path
    const current = readableSha(disk, path)
    if (current !== null && current !== asset.sha256) return `Drifted: ${fileName(path)} differs from the digest recorded when it was indexed.`
  }
  return null
}

/** The files an input hands off and the SHA-256 each has now: the basis recorded on acceptance (CAL-FR-08). */
export function basisFiles(catalog: Catalog, disk: Disk, input: CalibrationInput): AssignmentBasis["files"] {
  return (sourceFor(catalog, input)?.files ?? []).flatMap((file) => {
    const sha256 = readableSha(disk, file.path)
    return sha256 === null ? [] : [{ path: file.path, sha256 }]
  })
}

/** A recorded acceptance basis whose file now reads different bytes (D19). */
function basisDrift(disk: Disk, basis: AssignmentBasis | undefined, input: CalibrationInput): string | null {
  if (!basis || basis.input !== inputKey(input)) return null
  const changed = basis.files.find((file) => {
    const current = readableSha(disk, file.path)
    return current !== null && current !== file.sha256
  })
  return changed ? `Drifted: ${fileName(changed.path)} changed since this input was accepted for View revision ${basis.viewRevision} (SHA-256 differs).` : null
}

/** Reusable sources only: adopted masters whose bytes match their basis, and raw sets. Candidates never match (CAL-AC-04). */
export function reusableSources(catalog: Catalog, disk: Disk): CalSource[] {
  const out: CalSource[] = []
  for (const master of Object.values(catalog.masters)) {
    if (master.state !== "adopted") continue
    // A drifted master is neither suggested nor offered until its adopted bytes return (CAL-AC-10).
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
  "optical-train": "Optical train",
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

/** "All 8 criteria compatible", or the criteria that are not: "Optical train unknown". */
export function summaryText(criteria: MatchCriterion[]): string {
  const bad = criteria.filter((c) => c.result !== "compatible")
  if (bad.length === 0) return `All ${criteria.length} criteria compatible`
  return bad.map((c) => `${CRITERION_LABEL[c.name]} ${c.result}`).join(", ")
}

/** The one phrase every surface uses for the handed-off set: "6 inputs for 15 requirements (1 with an exception)". */
export function handoffCountText(calibration: CalibrationPlan, inputs: number): string {
  const exceptions = calibration.counts.exception
  return `${plural(inputs, "input")} for ${plural(calibration.rows.length, "requirement")}${exceptions ? ` (${exceptions} with an exception)` : ""}`
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

export type RowState = CalibrationAssignment["state"]

export interface RequirementRow {
  key: string
  member: MemberSession
  kind: CalibrationKind
  /** Stored decision for this View, if any. */
  assignment: CalibrationAssignment | null
  /** The preselected compatible candidate (never stored until accepted). */
  suggestion: Candidate | null
  /**
   * On a decided row: a compatible master adopted after the decision, offered
   * as a separate suggestion. The decision stands until it is accepted (J26 S9).
   */
  pending: Candidate | null
  /** Best candidate when nothing is fully compatible; named, not preselected. */
  closest: Candidate | null
  candidates: Candidate[]
  state: RowState
  /** Input handed off (accepted or exception), or the one on offer. */
  input: CalibrationInput | null
  source: CalSource | null
  criteria: MatchCriterion[]
  /** The handed-off input's bytes no longer match its basis; the row blocks (CAL-FR-08). */
  drift: string | null
  /** When this View's decision was recorded, if it was. */
  decidedAt: string | null
  groupKey: string
  groupLabel: string
}

export function assignmentId(viewId: string, sessionId: string, kind: CalibrationKind): string {
  return `cal_${viewId}_${sessionId}_${kind}`
}

function groupOf(catalog: Catalog, session: Session): { key: string; label: string } {
  const g = lightGeometry(catalog, session)
  const train = trainName(catalog, g.opticalTrainId)
  const parts = [
    session.channel ?? "No filter",
    // A train name already names its camera.
    train ?? `Optical train unknown · ${g.cameraName ?? "camera unknown"}`,
    g.widthPx && g.heightPx ? `${g.widthPx}\u00a0×\u00a0${g.heightPx}` : "Dimensions unknown",
    `bin ${g.binning}`,
    `gain ${g.gain ?? "unknown"} / offset ${g.offset ?? "unknown"}`,
  ]
  return { key: parts.join("|"), label: parts.join(" · ") }
}

export interface CalibrationPlan {
  rows: RequirementRow[]
  groups: Array<{ key: string; label: string; rows: RequirementRow[] }>
  counts: Record<RowState, number>
  /** Decided rows whose handed-off input drifted. */
  drifted: number
  /** Rows that block a verified handoff (CAL-AC-06). */
  blocking: RequirementRow[]
}

export function calibrationPlan(catalog: Catalog, disk: Disk, view: View, content: MembershipContent | null, decisions: Record<string, AssignmentBasis>): CalibrationPlan {
  const members = content ? memberSessions(catalog, content) : []
  const sources = reusableSources(catalog, disk)
  const rows: RequirementRow[] = []
  for (const member of members) {
    const group = groupOf(catalog, member.session)
    for (const kind of KINDS) {
      const candidates = candidatesFor(catalog, member.session, kind, sources)
      const suggestion = candidates[0]?.summary.allCompatible ? candidates[0] : null
      const closest = suggestion ? null : (candidates[0] ?? null)
      const assignment = view.calibration.find((a) => a.lightSessionId === member.session.id && a.kind === kind) ?? null
      const basis = assignment ? decisions[assignment.id] : undefined
      const decidedAt = basis?.at ?? assignment?.exception?.at ?? null
      let state: RowState
      let input: CalibrationInput | null
      let criteria: MatchCriterion[]
      let pending: Candidate | null = null
      let drift: string | null = null
      if (assignment) {
        state = assignment.state
        input = assignment.input
        const live = assignment.input ? candidates.find((c) => sameInput(c.source.input, assignment.input)) : undefined
        criteria = assignment.criteria.length > 0 ? assignment.criteria : (live?.criteria ?? [])
        if (assignment.input && (state === "accepted" || state === "exception")) drift = inputDrift(catalog, disk, assignment.input) ?? basisDrift(disk, basis, assignment.input)
        pending =
          candidates.find((c) => {
            if (!c.summary.allCompatible || !c.source.isMaster || sameInput(c.source.input, assignment.input)) return false
            const adoptedAt = catalog.masters[c.source.id]?.adoption?.adoptedAt
            return Boolean(adoptedAt) && (decidedAt === null || adoptedAt! > decidedAt)
          }) ?? null
      } else if (suggestion) {
        state = "suggested"
        input = suggestion.source.input
        criteria = suggestion.criteria
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
        pending,
        closest,
        candidates,
        state,
        input,
        source: input ? sourceFor(catalog, input) : null,
        criteria,
        drift,
        decidedAt,
        groupKey: group.key,
        groupLabel: group.label,
      })
    }
  }
  const groups: CalibrationPlan["groups"] = []
  for (const row of rows) {
    const group = groups.find((g) => g.key === row.groupKey)
    if (group) group.rows.push(row)
    else groups.push({ key: row.groupKey, label: row.groupLabel, rows: [row] })
  }
  const counts: Record<RowState, number> = { suggested: 0, accepted: 0, exception: 0, deferred: 0, unresolved: 0 }
  for (const row of rows) counts[row.state] += 1
  const blocking = rows.filter((r) => r.state === "suggested" || r.state === "deferred" || r.state === "unresolved" || r.drift !== null)
  return { rows, groups, counts, drifted: rows.filter((r) => r.drift !== null).length, blocking }
}

/** Handed-off calibration inputs, deduplicated (one master can serve many sessions). */
export function handoffCalibration(catalog: Catalog, plan: CalibrationPlan): CalSource[] {
  const out: CalSource[] = []
  for (const row of plan.rows) {
    if ((row.state !== "accepted" && row.state !== "exception") || !row.input || row.drift) continue
    if (out.some((s) => sameInput(s.input, row.input))) continue
    const source = sourceFor(catalog, row.input)
    if (source) out.push(source)
  }
  return out
}

// ---------------------------------------------------------------------------
// Corrected metadata (PREP-FR-03, D15)
// ---------------------------------------------------------------------------

export const FIELD_LABEL: Record<CorrectionField, string> = {
  target: "Target",
  equipment: "Equipment",
  filter: "Filter",
  exposure: "Exposure",
  "focal-length": "Focal length",
}

export const FIELD_KEYWORD: Record<CorrectionField, string> = {
  target: "OBJECT",
  equipment: "TELESCOP",
  filter: "FILTER",
  exposure: "EXPTIME",
  "focal-length": "FOCALLEN",
}

export interface MetadataDiff {
  key: string
  session: Session
  field: CorrectionField
  assetIds: AssetId[]
  catalogValue: string
  /** What the application reads from the source files; null when absent. */
  sourceValue: string | null
  basis: string
}

/** Catalog values that differ from what an application reads in the source files. */
export function metadataDiffs(catalog: Catalog, members: MemberSession[]): MetadataDiff[] {
  const out: MetadataDiff[] = []
  for (const member of members) {
    const { session } = member
    const seen = new Set<CorrectionField>()
    for (const field of new Set(session.corrections.map((c) => c.field))) {
      const correction = latestCorrection(session, field)
      if (!correction || correction.observedValue === correction.correctedValue) continue
      seen.add(field)
      out.push({
        key: `${session.id}:${correction.field}`,
        session,
        field: correction.field,
        assetIds: member.included,
        catalogValue: correction.correctedValue,
        sourceValue: correction.observedValue,
        basis: "Catalog correction",
      })
    }
    const confirmed = session.equipment.status === "confirmed" || session.equipment.status === "associated"
    const train = confirmed && session.equipment.value ? catalog.opticalTrains[session.equipment.value] : undefined
    const first = catalog.assets[member.included[0] ?? ""]
    if (train && first && !seen.has("focal-length") && first.observed.focalLengthMm !== train.effectiveFocalLengthMm) {
      out.push({
        key: `${session.id}:focal-length`,
        session,
        field: "focal-length",
        assetIds: member.included,
        catalogValue: `${train.effectiveFocalLengthMm} mm`,
        sourceValue: first.observed.focalLengthMm === null ? null : `${first.observed.focalLengthMm} mm`,
        basis: `${session.equipment.status === "confirmed" ? "Confirmed" : "Associated"} optical train ${train.name}`,
      })
    }
  }
  return out
}

export type MetadataChoice = MetadataDecision["decision"]

export const METADATA_CHOICE_LABEL: Record<MetadataChoice, string> = {
  configuration: "Use application configuration",
  "patched-copy": "Isolated patched copies",
  "accept-source": "Accept the source-header value",
  excluded: "Exclude these inputs",
}

// ---------------------------------------------------------------------------
// Preparation plan (PREP-FR-04 to PREP-FR-08)
// ---------------------------------------------------------------------------

export const MODE_LABEL: Record<InputMode, string> = { linked: "Linked View", "direct-source": "Direct source", copy: "Copy", clone: "Clone" }

/** Plural product-input kinds, as a profile's capability names them. */
export const PRODUCT_KIND_LABEL: Record<ResultKind, string> = {
  "final-image": "final images",
  "linear-integration": "linear integrations",
  "channel-product": "channel products",
  "mosaic-panel": "mosaic panels",
}

export interface PlanChoices {
  mode: InputMode | null
  linkType: "symlink" | "hardlink"
  folderName: string | null
  outputParent: string | null
  metadata: Record<string, MetadataChoice>
}

export function slugName(name: string): string {
  return name
    .trim()
    .replace(/\s+-\s+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/[^A-Za-z0-9._-]/g, "")
}

/** Whether anything exists at `path` on the volume mounted there. */
export function pathOccupied(disk: Disk, path: string): { exists: boolean; items: string[] } {
  if (fileAt(disk, path)) return { exists: true, items: [fileName(path)] }
  const volumeId = volumeForPath(disk, path)
  const explicit = disk.folders.some((f) => f.volumeId === volumeId && isUnder(f.path, path))
  const files = filesUnder(disk, path)
  const children = listFolders(disk, path)
  if (!explicit && files.length === 0) return { exists: false, items: [] }
  const items = [...new Set([...files.map((f) => f.path.slice(path.length + 1).split("/")[0] ?? ""), ...children.map((c) => c.name)])].filter(Boolean)
  return { exists: true, items }
}

/** A name not yet used under `parent`: NAME, then NAME-2, NAME-3… */
export function uniqueName(disk: Disk, parent: string, base: string): string {
  if (!pathOccupied(disk, `${parent}/${base}`).exists) return base
  for (let n = 2; n < 100; n += 1) if (!pathOccupied(disk, `${parent}/${base}-${n}`).exists) return `${base}-${n}`
  return `${base}-${Date.now().toString(36)}`
}

export interface ParentState {
  path: string | null
  /** "chosen" = recorded on the View; "last-used" = suggested from Settings. */
  origin: "chosen" | "last-used" | "none"
  volume: Volume | null
  problem: null | { kind: "offline" | "missing" | "read-only" | "not-writable"; message: string }
}

function folderExists(disk: Disk, path: string): boolean {
  const volumeId = volumeForPath(disk, path)
  const volume = volumeId ? disk.volumes[volumeId] : undefined
  if (!volume) return false
  if (path === volume.mountPath) return true
  return pathOccupied(disk, path).exists
}

export function parentState(disk: Disk, view: View, lastViewParent: string | null): ParentState {
  const path = view.locationParent ?? lastViewParent
  const origin: ParentState["origin"] = view.locationParent ? "chosen" : lastViewParent ? "last-used" : "none"
  if (!path) return { path: null, origin, volume: null, problem: null }
  const volumeId = volumeForPath(disk, path)
  const volume = volumeId ? (disk.volumes[volumeId] ?? null) : null
  if (!volume || !volume.mounted) {
    const name = volume?.name ?? path
    return { path, origin, volume, problem: { kind: "offline", message: `${name} is offline. Choose another location; PlateVault never substitutes another drive.` } }
  }
  if (!folderExists(disk, path)) return { path, origin, volume, problem: { kind: "missing", message: `${path} no longer exists. Choose another location.` } }
  if (!volume.writable || disk.readOnlyPaths.some((p) => isUnder(path, p))) {
    return { path, origin, volume, problem: { kind: "read-only", message: `PlateVault cannot write to ${path}: write permission is removed. Choose another location.` } }
  }
  return { path, origin, volume, problem: null }
}

export interface EntrySource {
  /** Operation item id: `a:<assetId>` for frames, `r:<resultId>` for accepted Results. */
  id: string
  kind: "light" | "calibration" | "product"
  assetId: AssetId | null
  resultId: string | null
  label: string
  fileName: string
  sourcePath: string
  sizeBytes: number
  availability: AssetAvailability
  volumeId: string | null
}

function entryFromAsset(disk: Disk, catalog: Catalog, asset: Asset, kind: EntrySource["kind"]): EntrySource {
  const copy = preferredCopy(disk, catalog, asset)
  return {
    id: `a:${asset.id}`,
    kind,
    assetId: asset.id,
    resultId: null,
    label: kind === "calibration" ? `Calibration: ${asset.fileName}` : asset.fileName,
    fileName: asset.fileName,
    sourcePath: copy.path,
    sizeBytes: asset.sizeBytes,
    availability: assetAvailability(disk, catalog, asset),
    volumeId: copy.volumeId,
  }
}

function entryFromResult(disk: Disk, result: ResultRecord): EntrySource {
  const file = fileAt(disk, result.path)
  return {
    id: `r:${result.id}`,
    kind: "product",
    assetId: null,
    resultId: result.id,
    label: fileName(result.path),
    fileName: fileName(result.path),
    sourcePath: result.path,
    sizeBytes: file?.sizeBytes ?? 0,
    availability: file ? "available" : "absent",
    volumeId: volumeForPath(disk, result.path),
  }
}

export interface ModeOption {
  mode: InputMode
  allowed: boolean
  reasons: string[]
  footprintBytes: number
  semantics: string
}

export interface PlanCheck {
  id: string
  label: string
  ok: boolean
  /** Blocks Prepare when not ok; otherwise a named warning. */
  blocking: boolean
  detail: string
}

export interface PreparationPlan {
  revision: MembershipRevision | null
  members: MemberSession[]
  excludedCount: number
  profile: ApplicationProfile | null
  calibration: CalibrationPlan
  calibrationSources: CalSource[]
  diffs: MetadataDiff[]
  metadata: Record<string, MetadataChoice | null>
  metadataExcluded: Set<AssetId>
  /** Every reviewed correction an isolated entry patches, per asset (D15). */
  patched: Map<AssetId, Array<{ field: CorrectionField; value: string }>>
  entries: EntrySource[]
  calibrationEntries: EntrySource[]
  suggestedMode: InputMode
  mode: InputMode
  modeExplicit: boolean
  linkType: "symlink" | "hardlink" | null
  modes: ModeOption[]
  parent: ParentState
  folderName: string
  suggestedFolderName: string
  viewPath: string | null
  viewFolder: { exists: boolean; items: string[] }
  outputPath: string | null
  outputOverride: boolean
  destinationVolume: Volume | null
  freeBytes: number | null
  footprintBytes: number
  operationCount: number
  checks: PlanCheck[]
  /** Entries that cannot be prepared as planned (named with paths). */
  unavailable: EntrySource[]
  ready: boolean
}

function modeSemantics(mode: InputMode, linkType: "symlink" | "hardlink"): string {
  switch (mode) {
    case "linked":
      return linkType === "symlink"
        ? "A View folder of symbolic links to the originals. References, not backups: an application that writes into a linked input alters the source."
        : "A View folder of hard links. Same volume only; the link and the original are the same file, so a writing application alters the source."
    case "direct-source":
      return "No View folder entries: the profile passes the exact original paths in a file list. Nothing is linked or copied."
    case "copy":
      return "Isolated full copies of every input. Needs storage for every byte; originals are never touched."
    case "clone":
      return "Isolated copy-on-write clones on the same volume. Near-zero storage until either side changes."
  }
}

export interface PlanInput {
  disk: Disk
  catalog: Catalog
  view: View
  lastViewParent: string | null
  choices: PlanChoices
  /** Calibration decision bases from the T4 slice (CAL-FR-08). */
  decisions: Record<string, AssignmentBasis>
}

export function preparationPlan({ disk, catalog, view, lastViewParent, choices, decisions }: PlanInput): PreparationPlan {
  const revision = savedMembership(view)
  const content = revision ?? workingMembership(view)
  const members = content ? memberSessions(catalog, content) : []
  const profile = view.profileId ? (catalog.profiles[view.profileId] ?? null) : null
  const calibration = calibrationPlan(catalog, disk, view, content, decisions)
  const calibrationSources = handoffCalibration(catalog, calibration)
  const diffs = metadataDiffs(catalog, members)

  const metadata: Record<string, MetadataChoice | null> = {}
  const metadataExcluded = new Set<AssetId>()
  const patched = new Map<AssetId, Array<{ field: CorrectionField; value: string }>>()
  for (const diff of diffs) {
    const choice = choices.metadata[diff.key] ?? null
    metadata[diff.key] = choice
    if (choice === "excluded") for (const id of diff.assetIds) metadataExcluded.add(id)
    if (choice === "patched-copy") for (const id of diff.assetIds) patched.set(id, [...(patched.get(id) ?? []), { field: diff.field, value: diff.catalogValue }])
  }

  const included = content?.included ?? []
  const entries: EntrySource[] = []
  for (const id of included) {
    const asset = catalog.assets[id]
    if (asset && !metadataExcluded.has(id)) entries.push(entryFromAsset(disk, catalog, asset, "light"))
  }
  for (const id of content?.productInputs ?? []) {
    const result = catalog.results[id]
    if (result) entries.push(entryFromResult(disk, result))
  }
  const calibrationEntries: EntrySource[] = []
  for (const source of calibrationSources) {
    for (const file of source.files) {
      const asset = file.assetId ? catalog.assets[file.assetId] : undefined
      if (asset) calibrationEntries.push(entryFromAsset(disk, catalog, asset, "calibration"))
      else {
        const onDisk = fileAt(disk, file.path)
        calibrationEntries.push({
          id: `f:${file.path}`,
          kind: "calibration",
          assetId: null,
          resultId: null,
          label: `Calibration: ${file.fileName}`,
          fileName: file.fileName,
          sourcePath: file.path,
          sizeBytes: onDisk?.sizeBytes ?? file.sizeBytes,
          availability: onDisk ? "available" : "absent",
          volumeId: volumeForPath(disk, file.path),
        })
      }
    }
  }
  const all = [...entries, ...calibrationEntries]

  const parent = parentState(disk, view, lastViewParent)
  const suggestedFolderName = slugName(view.name) || "View"
  const folderName = (choices.folderName ?? suggestedFolderName).trim()
  const viewPath = parent.path && folderName ? `${parent.path}/${folderName}` : null
  const viewFolder = viewPath && !parent.problem ? pathOccupied(disk, viewPath) : { exists: false, items: [] }
  const outputOverride = Boolean(choices.outputParent)
  const outputPath = choices.outputParent ? (folderName ? `${choices.outputParent}/${folderName}` : null) : viewPath ? `${viewPath}/output` : null
  const destinationVolume = parent.volume && parent.volume.mounted ? parent.volume : null
  const free = destinationVolume ? freeBytes(disk, destinationVolume.id) : null

  // Linked and Direct source need verified read-only evidence, never a claim alone (D04, PREP-FR-04).
  const readOnlyProfile = profile?.capability.verified === true && profile.capability.inputWrite === "read-only"
  const suggestedMode: InputMode = profile && readOnlyProfile && profile.capability.inputModes.includes("linked") ? "linked" : "copy"
  const mode = choices.mode ?? suggestedMode
  const totalBytes = all.reduce((sum, e) => sum + e.sizeBytes, 0)
  const sourceVolumes = new Set(all.map((e) => e.volumeId))
  const destinationName = destinationVolume?.name ?? "the destination"

  const excludedCount = content?.excluded.length ?? 0
  const modes: ModeOption[] = (["linked", "direct-source", "copy", "clone"] as InputMode[]).map((m) => {
    const reasons: string[] = []
    if (profile && !profile.capability.inputModes.includes(m)) reasons.push(`${profile.name} has no recorded support for ${MODE_LABEL[m]}.`)
    if ((m === "linked" || m === "direct-source") && profile && !readOnlyProfile) {
      reasons.push(
        `${profile.name} has ${profile.capability.inputWrite === "write-prone" ? "write-prone" : "unknown"} input-write behaviour, so it could write into your originals. Use Copy or Clone.`,
      )
    }
    if (m === "linked" && destinationVolume) {
      const can = choices.linkType === "hardlink" ? destinationVolume.links.hardlink : destinationVolume.links.symlink
      if (!can) reasons.push(`Linking is unavailable on ${destinationName}.`)
      else if (choices.linkType === "hardlink" && [...sourceVolumes].some((v) => v !== destinationVolume.id)) {
        reasons.push(`Hard links need every source on ${destinationName}; some sources are on another volume.`)
      }
    }
    if (m === "direct-source" && profile?.capability.directSource === "whole-folder") {
      const mixed = members.find((member) => member.excluded.length > 0)
      reasons.push(
        mixed
          ? `${profile.name} reads whole folders, and ${formatNight(mixed.session.night)} also holds ${plural(mixed.excluded.length, "excluded frame")}. Use a prepared mode.`
          : `${profile.name} reads whole folders, which can hand off files that are not in this View. Use a prepared mode.`,
      )
    }
    if (m === "direct-source" && profile?.capability.directSource === "none" && profile.capability.inputModes.includes("direct-source")) {
      reasons.push(`${profile.name} records no way to pass exact source paths.`)
    }
    if (m === "clone" && destinationVolume) {
      if (!destinationVolume.links.clone) reasons.push(`${destinationName} does not support clones.`)
      else if ([...sourceVolumes].some((v) => v !== destinationVolume.id)) reasons.push(`Clones need every source on ${destinationName}; some sources are on another volume.`)
    }
    if (m === "copy" && free !== null && totalBytes > free) reasons.push(`Copy needs ${formatBytes(totalBytes)}; ${destinationName} has ${formatBytes(free)} free.`)
    const footprintBytes = m === "copy" ? totalBytes : m === "clone" ? Math.round(totalBytes * 0.001) : 0
    return { mode: m, allowed: reasons.length === 0, reasons, footprintBytes, semantics: modeSemantics(m, choices.linkType) }
  })
  const chosen = modes.find((m) => m.mode === mode)!
  const footprintBytes = chosen.footprintBytes

  const unavailable = all.filter((e) => e.availability !== "available")
  const checks: PlanCheck[] = []
  checks.push({
    id: "membership",
    label: "Saved membership",
    ok: revision !== null,
    blocking: true,
    detail: revision ? `Revision ${revision.revision}, saved` : "Save the View first: Review preparation uses a saved revision.",
  })
  const products = (content?.productInputs ?? []).map((id) => catalog.results[id]).filter((r): r is ResultRecord => r !== undefined)
  checks.push({
    id: "calibration",
    label: "Calibration",
    // A View of accepted Results only has no light to calibrate (RES-FR-05).
    ok: calibration.blocking.length === 0 && (members.length > 0 || products.length > 0),
    blocking: true,
    detail:
      members.length === 0
        ? products.length > 0
          ? "No light sessions: product inputs are handed off without calibration."
          : "No light sessions in this View."
        : calibration.blocking.length === 0
          ? handoffCountText(calibration, calibrationSources.length)
          : `${plural(calibration.blocking.length, "requirement")} not resolved: ${calibration.blocking
              .slice(0, 3)
              .map((r) => `${formatNight(r.member.session.night)} ${KIND_LABEL[r.kind].toLowerCase()} ${r.drift ? "drifted" : r.state}`)
              .join(", ")}${calibration.blocking.length > 3 ? "…" : ""}`,
  })
  if (products.length > 0 && profile) {
    // A product input needs recorded capability evidence for its kind; nothing is converted (D04, RES-FR-05, RES-AC-05).
    const unsupported = products.filter((r) => r.kind === null || !profile.capability.productInputKinds.includes(r.kind))
    const kinds = [...new Set(products.map((r) => (r.kind ? PRODUCT_KIND_LABEL[r.kind] : "unknown kind")))]
    checks.push({
      id: "products",
      label: "Product inputs",
      ok: unsupported.length === 0,
      blocking: true,
      detail:
        unsupported.length === 0
          ? `${profile.name} reads ${kinds.join(" and ")}`
          : `Refused: ${profile.name} has no recorded support for ${unsupported.map((r) => `${fileName(r.path)} (${r.kind ? PRODUCT_KIND_LABEL[r.kind] : "unknown kind"})`).join(", ")}. Nothing is converted; choose another application or remove ${unsupported.length === 1 ? "it" : "them"} from the View.`,
    })
  }
  checks.push({ id: "profile", label: "Application", ok: profile !== null, blocking: true, detail: profile ? profile.name : "Choose an application." })
  const undecided = diffs.filter((d) => !metadata[d.key])
  const badPatch = diffs.filter((d) => metadata[d.key] === "patched-copy" && mode !== "copy" && mode !== "clone")
  const badConfig = diffs.filter((d) => metadata[d.key] === "configuration" && profile?.capability.correctedMetadata !== "configuration")
  checks.push({
    id: "metadata",
    label: "Corrected metadata",
    ok: undecided.length === 0 && badPatch.length === 0 && badConfig.length === 0,
    blocking: true,
    detail:
      diffs.length === 0
        ? "No catalog value differs from the source headers."
        : undecided.length > 0
          ? `Choose how ${plural(undecided.length, "correction")} reach${undecided.length === 1 ? "es" : ""} the application.`
          : badPatch.length > 0
            ? `Patched copies need Copy or Clone; the mode is ${MODE_LABEL[mode]}.`
            : badConfig.length > 0
              ? `${profile?.name ?? "This application"} cannot read corrected values through configuration.`
              : `${plural(diffs.length, "decision")} recorded`,
  })
  checks.push({
    id: "mode",
    label: "Input mode",
    ok: chosen.allowed,
    blocking: true,
    detail: chosen.allowed ? `${MODE_LABEL[mode]}${mode === "linked" ? ` (${choices.linkType === "hardlink" ? "hard links" : "symbolic links"})` : ""}` : chosen.reasons.join(" "),
  })
  const destinationProblem = !parent.path
    ? "Choose a location for the View folder."
    : parent.problem
      ? parent.problem.message
      : !folderName
        ? "Enter a folder name."
        : viewFolder.exists
          ? `${viewPath} already exists with ${plural(viewFolder.items.length, "item")}${viewFolder.items.length ? ` (${viewFolder.items.slice(0, 3).join(", ")})` : ""}. Choose another name or location. Nothing in it was changed.`
          : null
  checks.push({ id: "destination", label: "Destination", ok: destinationProblem === null, blocking: true, detail: destinationProblem ?? `${viewPath} is free; write permission checked` })
  if (outputOverride && choices.outputParent && outputPath) {
    const occupied = pathOccupied(disk, outputPath)
    const outVolumeId = volumeForPath(disk, choices.outputParent)
    const outVolume = outVolumeId ? disk.volumes[outVolumeId] : undefined
    const problem = !outVolume?.mounted
      ? `${outVolume?.name ?? choices.outputParent} is offline. Choose another output location.`
      : occupied.exists
        ? `${outputPath} already exists. Choose another output location.`
        : disk.readOnlyPaths.some((p) => isUnder(choices.outputParent!, p))
          ? `PlateVault cannot write to ${choices.outputParent}.`
          : null
    checks.push({ id: "output", label: "Output location", ok: problem === null, blocking: true, detail: problem ?? `${outputPath}/ is free` })
  }
  if (mode === "linked" && choices.linkType === "hardlink") {
    const eligible = Boolean(destinationVolume?.links.hardlink) && [...sourceVolumes].every((v) => v === destinationVolume?.id)
    checks.push({
      id: "hardlink",
      label: "Hardlink eligibility",
      ok: eligible,
      blocking: true,
      detail: eligible ? `Same volume (${destinationName}), hard links supported, write permission checked` : "Not eligible: hard links need every source and the View folder on one volume that supports them.",
    })
  }
  checks.push({
    id: "space",
    label: "Free space",
    ok: free === null || footprintBytes <= free,
    blocking: true,
    detail: free === null ? "Unknown until a location is chosen." : `${formatBytes(footprintBytes)} needed, ${formatBytes(free)} free on ${destinationName}`,
  })
  checks.push({
    id: "sources",
    label: "Source presence",
    ok: unavailable.length === 0,
    blocking: false,
    detail:
      unavailable.length === 0
        ? `${plural(all.length, "source")} available`
        : `${plural(unavailable.length, "source")} cannot be read now; ${unavailable.length === 1 ? "it" : "they"} will be blocked and never counted as prepared.`,
  })
  const operationCount = mode === "direct-source" ? 1 : all.length + 3
  const ready = checks.every((c) => c.ok || !c.blocking)
  return {
    revision,
    members,
    excludedCount,
    profile,
    calibration,
    calibrationSources,
    diffs,
    metadata,
    metadataExcluded,
    patched,
    entries,
    calibrationEntries,
    suggestedMode,
    mode,
    modeExplicit: choices.mode !== null,
    linkType: mode === "linked" ? choices.linkType : null,
    modes,
    parent,
    folderName,
    suggestedFolderName,
    viewPath,
    viewFolder,
    outputPath,
    outputOverride,
    destinationVolume,
    freeBytes: free,
    footprintBytes,
    operationCount,
    checks,
    unavailable,
    ready,
  }
}

/**
 * Where an entry is written inside the View folder. Sessions reuse file
 * names (every night has `_0001`), so the entry keeps its source's last two
 * folders: `lights/2026-09-18/Ha/Light_…_0001.fits`.
 */
export function entryPath(viewPath: string, entry: Pick<EntrySource, "kind" | "sourcePath">): string {
  const folder = entry.kind === "calibration" ? "calibration" : entry.kind === "product" ? "products" : "lights"
  return `${viewPath}/${folder}/${entry.sourcePath.split("/").slice(-3).join("/")}`
}

export const HANDOFF_FILE = "platevault-handoff.txt"
