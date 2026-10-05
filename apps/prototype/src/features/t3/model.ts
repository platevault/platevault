/**
 * T3 pure model: View membership (D02), geometry suggestions (D01), the
 * selection summary, saved criteria and the Refresh comparison (VSEL-FR-12).
 * No store access here; actions.ts writes through `commit()`.
 */
import { correctedExposureS } from "@/domain/corrections"
import {
  assetAvailability,
  type AssetAvailability,
  coverageFraction,
  type Footprint,
  membershipSummary,
  type MembershipSummary,
  MIN_FOOTPRINT_OVERLAP,
  preferredCopy,
  qualityApplicability,
  sessionFootprint,
} from "@/domain/derive"
import { fileKey } from "@/domain/disk"
import { angularSeparationDeg, type FieldOfView, fieldOfView, pixelScaleArcsec } from "@/domain/sky"
import type {
  Asset,
  AssetId,
  Catalog,
  Disk,
  DiskFile,
  MembershipContent,
  MembershipRevision,
  OpticalTrainId,
  Project,
  SelectionCriteria,
  SelectionReason,
  Session,
  SessionId,
  View,
} from "@/domain/types"
import { formatDuration, formatExposure, formatNight, plural } from "@/lib/format"

/** Pointing-only and nearby candidates are listed within this radius of the framing centre. */
export const NEAR_RADIUS_DEG = 5

// ---------------------------------------------------------------------------
// Membership content
// ---------------------------------------------------------------------------

export function emptyContent(): MembershipContent {
  return { sessions: [], included: [], excluded: [], unresolved: [], productInputs: [] }
}

export function latestRevision(view: View): MembershipRevision | null {
  return view.revisions.at(-1) ?? null
}

export function contentOf(content: MembershipContent): MembershipContent {
  return {
    sessions: content.sessions,
    included: content.included,
    excluded: content.excluded,
    unresolved: content.unresolved,
    productInputs: content.productInputs,
  }
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((id) => b.includes(id))

export function contentEquals(a: MembershipContent, b: MembershipContent): boolean {
  return (
    sameSet(
      a.sessions.map((s) => s.sessionId),
      b.sessions.map((s) => s.sessionId),
    ) &&
    sameSet(a.included, b.included) &&
    sameSet(a.excluded, b.excluded) &&
    sameSet(a.unresolved, b.unresolved) &&
    sameSet(a.productInputs, b.productInputs)
  )
}

export type MemberState = "included" | "excluded" | "unresolved"

export function memberState(content: MembershipContent, assetId: AssetId): MemberState | null {
  if (content.included.includes(assetId)) return "included"
  if (content.excluded.includes(assetId)) return "excluded"
  if (content.unresolved.includes(assetId)) return "unresolved"
  return null
}

/**
 * D02 initial membership of one session: available Unreviewed/Usable frames
 * are included, library-Unusable frames start visibly excluded, unavailable
 * frames stay named unresolved. A decision made against other bytes (changed
 * content) no longer applies, so that frame is treated as unreviewed.
 */
export function initialMembers(disk: Disk, catalog: Catalog, session: Session) {
  const included: AssetId[] = []
  const excluded: AssetId[] = []
  const unresolved: AssetId[] = []
  for (const id of session.assetIds) {
    const asset = catalog.assets[id]
    if (!asset) continue
    if (assetAvailability(disk, catalog, asset) !== "available") unresolved.push(id)
    else if (asset.quality.value === "unusable" && qualityApplicability(asset) !== "changed-content") excluded.push(id)
    else included.push(id)
  }
  return { included, excluded, unresolved }
}

const without = (list: string[], remove: Set<string>) => list.filter((id) => !remove.has(id))

export function addSessions(
  content: MembershipContent,
  disk: Disk,
  catalog: Catalog,
  additions: Array<{ session: Session; reason: SelectionReason }>,
): MembershipContent {
  let next = content
  for (const { session, reason } of additions) {
    if (next.sessions.some((s) => s.sessionId === session.id)) continue
    const members = initialMembers(disk, catalog, session)
    const ids = new Set(session.assetIds)
    next = {
      ...next,
      sessions: [...next.sessions, { sessionId: session.id, reason }],
      included: [...without(next.included, ids), ...members.included],
      excluded: [...without(next.excluded, ids), ...members.excluded],
      unresolved: [...without(next.unresolved, ids), ...members.unresolved],
    }
  }
  return next
}

export function removeSessions(content: MembershipContent, catalog: Catalog, sessionIds: SessionId[]): MembershipContent {
  const remove = new Set<string>()
  for (const id of sessionIds) for (const assetId of catalog.sessions[id]?.assetIds ?? []) remove.add(assetId)
  // Assets of a session no longer in the catalog are matched through their sessionId.
  for (const asset of Object.values(catalog.assets)) if (asset.sessionId && sessionIds.includes(asset.sessionId)) remove.add(asset.id)
  return {
    ...content,
    sessions: content.sessions.filter((s) => !sessionIds.includes(s.sessionId)),
    included: without(content.included, remove),
    excluded: without(content.excluded, remove),
    unresolved: without(content.unresolved, remove),
  }
}

/** Exclude from View: View scope only; files and library quality are unchanged (VSEL-FR-10). */
export function excludeFrames(content: MembershipContent, assetIds: AssetId[]): MembershipContent {
  const ids = new Set(assetIds.filter((id) => content.included.includes(id) || content.unresolved.includes(id)))
  if (ids.size === 0) return content
  return { ...content, included: without(content.included, ids), unresolved: without(content.unresolved, ids), excluded: [...content.excluded, ...ids] }
}

/** Restore excluded frames to the View; unavailable ones return as unresolved, never as verified inputs. */
export function restoreFrames(disk: Disk, catalog: Catalog, content: MembershipContent, assetIds: AssetId[]): MembershipContent {
  const ids = assetIds.filter((id) => content.excluded.includes(id))
  if (ids.length === 0) return content
  const available = ids.filter((id) => {
    const asset = catalog.assets[id]
    return asset ? assetAvailability(disk, catalog, asset) === "available" : false
  })
  const unavailable = ids.filter((id) => !available.includes(id))
  return {
    ...content,
    excluded: without(content.excluded, new Set(ids)),
    included: [...content.included, ...available],
    unresolved: [...content.unresolved, ...unavailable],
  }
}

/** Unresolved members whose copies are readable again join the View once the user resolves them. */
export function resolveAvailable(disk: Disk, catalog: Catalog, content: MembershipContent): MembershipContent {
  const ready = content.unresolved.filter((id) => {
    const asset = catalog.assets[id]
    return asset ? assetAvailability(disk, catalog, asset) === "available" : false
  })
  if (ready.length === 0) return content
  return { ...content, unresolved: without(content.unresolved, new Set(ready)), included: [...content.included, ...ready] }
}

export interface ContentDiff {
  sessionsAdded: SessionId[]
  sessionsRemoved: SessionId[]
  framesExcluded: number
  framesRestored: number
  framesAdded: number
  framesRemoved: number
}

export function diffContent(base: MembershipContent | null, next: MembershipContent): ContentDiff {
  const from = base ?? emptyContent()
  const fromSessions = from.sessions.map((s) => s.sessionId)
  const toSessions = next.sessions.map((s) => s.sessionId)
  const inFrom = new Set([...from.included, ...from.unresolved])
  const inTo = new Set([...next.included, ...next.unresolved])
  return {
    sessionsAdded: toSessions.filter((id) => !fromSessions.includes(id)),
    sessionsRemoved: fromSessions.filter((id) => !toSessions.includes(id)),
    framesExcluded: next.excluded.filter((id) => !from.excluded.includes(id) && inFrom.has(id)).length,
    framesRestored: from.excluded.filter((id) => !next.excluded.includes(id) && inTo.has(id)).length,
    framesAdded: [...inTo].filter((id) => !inFrom.has(id) && !from.excluded.includes(id)).length,
    framesRemoved: [...inFrom].filter((id) => !inTo.has(id) && !next.excluded.includes(id)).length,
  }
}

export function describeDiff(catalog: Catalog, diff: ContentDiff): string[] {
  const name = (id: SessionId) => {
    const s = catalog.sessions[id]
    return s ? sessionLabel(s) : "a session no longer in the library"
  }
  const lines: string[] = []
  if (diff.sessionsAdded.length > 0) lines.push(`Added ${diff.sessionsAdded.map(name).join(", ")}`)
  if (diff.sessionsRemoved.length > 0) lines.push(`Removed ${diff.sessionsRemoved.map(name).join(", ")}`)
  if (diff.framesExcluded > 0) lines.push(`${plural(diff.framesExcluded, "frame")} excluded from the View`)
  if (diff.framesRestored > 0) lines.push(`${plural(diff.framesRestored, "frame")} restored to the View`)
  if (lines.length === 0 && (diff.framesAdded > 0 || diff.framesRemoved > 0)) {
    lines.push(`${diff.framesAdded} frames added, ${diff.framesRemoved} removed`)
  }
  return lines.length > 0 ? lines : ["No membership change; details only"]
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

export function sessionLabel(session: Session): string {
  return `${formatNight(session.night)} ${session.channel ?? "no filter"}`
}

export function trainName(catalog: Catalog, session: Session): string | null {
  return session.equipment.value ? (catalog.opticalTrains[session.equipment.value]?.name ?? null) : null
}

/** The session's exposure as the catalog counts it: the latest correction, else the observed EXPTIME. */
export function sessionExposureS(session: Session): number {
  return correctedExposureS(session) ?? session.exposureS
}

export const REASON_LABEL: Record<SelectionReason["kind"], string> = {
  geometry: "Geometry suggestion",
  pointing: "Pointing suggestion",
  "project-equipment": "Project equipment",
  manual: "Manual inclusion",
  "refresh-added": "Refresh: added",
}

// ---------------------------------------------------------------------------
// Availability and summary
// ---------------------------------------------------------------------------

export interface SessionAvailability {
  state: AssetAvailability
  unavailable: number
  total: number
}

export function sessionAvailability(disk: Disk, catalog: Catalog, session: Session): SessionAvailability {
  const counts: Record<AssetAvailability, number> = { available: 0, offline: 0, unreadable: 0, absent: 0, retired: 0 }
  for (const id of session.assetIds) {
    const asset = catalog.assets[id]
    if (asset) counts[assetAvailability(disk, catalog, asset)] += 1
  }
  const unavailable = counts.offline + counts.unreadable + counts.absent + counts.retired
  const worst: AssetAvailability =
    counts.retired > 0 ? "retired" : counts.offline > 0 ? "offline" : counts.unreadable > 0 ? "unreadable" : counts.absent > 0 ? "absent" : "available"
  return { state: unavailable === 0 ? "available" : worst, unavailable, total: session.assetIds.length }
}

export interface ViewSummary extends MembershipSummary {
  /** Included frames with no available copy right now: last-observed, not verified. */
  includedUnavailable: number
  /** Excluded members whose library quality is Unusable (they start excluded, D02); `unusable` counts included ones. */
  excludedUnusable: number
  /** Sessions with unresolved or unavailable members, for naming them. */
  unavailableSessions: Array<{ session: Session; members: number; state: AssetAvailability }>
}

export function viewSummary(disk: Disk, catalog: Catalog, content: MembershipContent): ViewSummary {
  const base = membershipSummary(catalog, content)
  let includedUnavailable = 0
  const bySession = new Map<SessionId, { members: number; state: AssetAvailability }>()
  for (const id of [...content.included, ...content.unresolved]) {
    const asset = catalog.assets[id]
    if (!asset) continue
    const state = assetAvailability(disk, catalog, asset)
    if (state === "available") continue
    if (content.included.includes(id)) includedUnavailable += 1
    if (!asset.sessionId) continue
    const entry = bySession.get(asset.sessionId) ?? { members: 0, state }
    entry.members += 1
    bySession.set(asset.sessionId, entry)
  }
  const unavailableSessions = [...bySession.entries()]
    .map(([id, entry]) => ({ session: catalog.sessions[id], ...entry }))
    .filter((e): e is { session: Session; members: number; state: AssetAvailability } => e.session !== undefined)
  const excludedUnusable = content.excluded.filter((id) => catalog.assets[id]?.quality.value === "unusable").length
  return { ...base, includedUnavailable, excludedUnusable, unavailableSessions }
}

export function totalsLine(frames: number, seconds: number) {
  return `${frames} / ${formatDuration(seconds)}`
}

// ---------------------------------------------------------------------------
// Geometry (D01) and suggestions (VSEL-FR-03, VSEL-FR-04)
// ---------------------------------------------------------------------------

export interface Region extends Footprint {
  name: string
}

export interface ViewContext {
  project: Project | null
  targetName: string | null
  /** Framing or mosaic panels to suggest against; empty when no position is known. */
  regions: Region[]
  equipmentId: OpticalTrainId | null
  equipmentName: string | null
}

export function viewContext(catalog: Catalog, view: Pick<View, "projectId" | "targetId">): ViewContext {
  const project = view.projectId ? (catalog.projects[view.projectId] ?? null) : null
  const targetId = view.targetId ?? project?.targetIds[0] ?? null
  const target = targetId ? catalog.targets[targetId] : undefined
  const targetName = target?.name ?? null
  let regions: Region[] = []
  if (project && project.panels.length > 0) {
    regions = project.panels.map((p) => ({ ra: p.ra, dec: p.dec, widthDeg: p.widthDeg, heightDeg: p.heightDeg, rotationDeg: p.rotationDeg, name: p.name }))
  } else if (project?.framing) {
    const f = project.framing
    regions = [{ ra: f.ra, dec: f.dec, widthDeg: f.widthDeg, heightDeg: f.heightDeg, rotationDeg: f.rotationDeg ?? 0, name: `${targetName ?? project.name} framing` }]
  } else if (target && target.ra !== null && target.dec !== null) {
    regions = [
      { ra: target.ra, dec: target.dec, widthDeg: target.sizeDeg?.width ?? 1, heightDeg: target.sizeDeg?.height ?? 1, rotationDeg: 0, name: `${target.name} extent` },
    ]
  }
  const equipmentId = project?.equipmentId ?? null
  return { project, targetName, regions, equipmentId, equipmentName: equipmentId ? (catalog.opticalTrains[equipmentId]?.name ?? null) : null }
}

export interface SessionGeometry {
  kind: "footprint" | "pointing-only" | "position-unknown"
  footprint: Footprint | null
  fov: FieldOfView | null
  /** "confirmed" when FOV comes from confirmed equipment (C3). */
  fovSource: "confirmed" | "associated" | null
  /** Separation from the nearest region centre; null when position is unknown (never 0). */
  distanceDeg: number | null
  /** Best covered fraction of any region; null without a footprint. */
  coverage: number | null
  coveredRegion: string | null
}

export function sessionGeometry(catalog: Catalog, session: Session, regions: Region[]): SessionGeometry {
  const train = session.equipment.value ? catalog.opticalTrains[session.equipment.value] : undefined
  const camera = train?.cameraId ? catalog.cameras[train.cameraId] : undefined
  const usable = session.equipment.status === "confirmed" || session.equipment.status === "associated"
  const fov = usable ? fieldOfView(train ?? null, camera ?? null, session.binning) : null
  const fovSource = fov ? (session.equipment.status === "confirmed" ? "confirmed" : "associated") : null
  if (!session.pointing) return { kind: "position-unknown", footprint: null, fov, fovSource, distanceDeg: null, coverage: null, coveredRegion: null }
  const { ra, dec } = session.pointing
  const distanceDeg = regions.length > 0 ? Math.min(...regions.map((r) => angularSeparationDeg(ra, dec, r.ra, r.dec))) : null
  const footprint = sessionFootprint(catalog, session)
  if (!footprint) return { kind: "pointing-only", footprint: null, fov, fovSource, distanceDeg, coverage: null, coveredRegion: null }
  let coverage: number | null = null
  let coveredRegion: string | null = null
  for (const region of regions) {
    const fraction = coverageFraction(region, [footprint])
    if (coverage === null || fraction > coverage) {
      coverage = fraction
      coveredRegion = region.name
    }
  }
  return { kind: "footprint", footprint, fov, fovSource, distanceDeg, coverage, coveredRegion }
}

export type SuggestionKind =
  | "geometry"
  | "geometry-other-equipment"
  | "geometry-unconfirmed-equipment"
  | "pointing-only"
  | "position-unknown"
  | "outside"
  | "no-framing"

export interface Suggestion {
  kind: SuggestionKind
  /** Only geometry with confirmed Project equipment is preselected, and only for Project Views. */
  preselect: boolean
  label: string
  detail: string
}

export function suggestionFor(catalog: Catalog, session: Session, geometry: SessionGeometry, ctx: ViewContext): Suggestion {
  if (ctx.regions.length === 0) return { kind: "no-framing", preselect: false, label: "No framing", detail: "This View has no Target position, so there are no geometry suggestions." }
  if (geometry.kind === "position-unknown") {
    return { kind: "position-unknown", preselect: false, label: "Position unknown", detail: "No pointing in the headers. OBJECT is a label and never stands in for coordinates; include it by hand if it belongs." }
  }
  if (geometry.kind === "pointing-only") {
    return {
      kind: "pointing-only",
      preselect: false,
      label: "Pointing only",
      detail: `Listed by radius: ${geometry.distanceDeg?.toFixed(2)}° from the framing centre. No footprint without orientation${geometry.fov ? "" : " and confirmed equipment"}, so it is never preselected.`,
    }
  }
  const coverage = geometry.coverage ?? 0
  if (coverage < MIN_FOOTPRINT_OVERLAP) {
    return { kind: "outside", preselect: false, label: "Outside framing", detail: `Footprint covers ${pct(coverage)} of ${geometry.coveredRegion}; suggestions need ${pct(MIN_FOOTPRINT_OVERLAP)}.` }
  }
  const train = trainName(catalog, session) ?? "unknown equipment"
  const covers = `Footprint covers ${pct(coverage)} of ${geometry.coveredRegion}`
  if (ctx.equipmentId && session.equipment.value === ctx.equipmentId && session.equipment.status === "confirmed") {
    return { kind: "geometry", preselect: ctx.project !== null, label: "Geometry suggestion", detail: `${covers}; confirmed Project equipment ${train}.` }
  }
  if (ctx.equipmentId && session.equipment.value === ctx.equipmentId) {
    return {
      kind: "geometry-unconfirmed-equipment",
      preselect: false,
      label: "Equipment not confirmed",
      detail: `${covers}; ${train} is observed in the headers but not confirmed, so it is not preselected.`,
    }
  }
  return {
    kind: ctx.equipmentId ? "geometry-other-equipment" : "geometry",
    preselect: false,
    label: ctx.equipmentId ? "Other equipment" : "Geometry suggestion",
    detail: ctx.equipmentId ? `${covers}; ${train} is not the Project's equipment. Include it by hand if you want it.` : `${covers}; ${train}.`,
  }
}

export function pct(fraction: number) {
  return `${Math.round(fraction * 100)}%`
}

/**
 * Candidate light sessions for the workspace table. "near" lists sessions
 * within NEAR_RADIUS_DEG of the framing, sessions associated with the View's
 * Target, sessions whose position is unknown (so they stay selectable by
 * hand) and every selected session. Superseded sessions never appear.
 */
export function candidateSessions(catalog: Catalog, view: Pick<View, "targetId">, ctx: ViewContext, selected: SessionId[], scope: "near" | "all"): Session[] {
  const targetIds = new Set([view.targetId, ...(ctx.project?.targetIds ?? [])].filter((id): id is string => Boolean(id)))
  return Object.values(catalog.sessions).filter((session) => {
    if (selected.includes(session.id)) return true
    if (session.supersededBy || session.imageType !== "light") return false
    if (scope === "all" || ctx.regions.length === 0) return true
    if (!session.pointing) return true
    if (session.target.value && targetIds.has(session.target.value)) return true
    return ctx.regions.some((r) => angularSeparationDeg(session.pointing!.ra, session.pointing!.dec, r.ra, r.dec) <= NEAR_RADIUS_DEG)
  })
}

/** Preselected sessions for a View created from a Project (VSEL-AC-01). */
export function preselectedSessions(catalog: Catalog, ctx: ViewContext): Array<{ session: Session; reason: SelectionReason }> {
  if (!ctx.project) return []
  const out: Array<{ session: Session; reason: SelectionReason }> = []
  for (const session of candidateSessions(catalog, { targetId: null }, ctx, [], "near")) {
    const suggestion = suggestionFor(catalog, session, sessionGeometry(catalog, session, ctx.regions), ctx)
    if (suggestion.preselect) out.push({ session, reason: { kind: "geometry", detail: suggestion.detail } })
  }
  return out.sort((a, b) => a.session.startedAt.localeCompare(b.session.startedAt))
}

// ---------------------------------------------------------------------------
// Saved criteria and Refresh selection (VSEL-FR-12, VSEL-AC-06)
// ---------------------------------------------------------------------------

const CRITERIA_REASONS: SelectionReason["kind"][] = ["geometry", "project-equipment", "refresh-added"]

/** Criteria saved with a revision: the evidence behind criteria-based selections, never manual ones. */
export function deriveCriteria(catalog: Catalog, view: View, content: MembershipContent, ctx: ViewContext): SelectionCriteria {
  const basis = content.sessions
    .filter((s) => CRITERIA_REASONS.includes(s.reason.kind))
    .map((s) => catalog.sessions[s.sessionId])
    .filter((s): s is Session => s !== undefined)
  const trains = new Set<OpticalTrainId>()
  for (const s of basis) if (s.equipment.value) trains.add(s.equipment.value)
  if (trains.size === 0 && ctx.equipmentId) trains.add(ctx.equipmentId)
  return {
    targetId: view.targetId ?? ctx.project?.targetIds[0] ?? null,
    projectId: view.projectId,
    opticalTrainIds: [...trains],
    channels: [...new Set(basis.map((s) => s.channel).filter((c): c is string => c !== null))].sort(),
    exposureS: [...new Set(basis.map(sessionExposureS))].sort((a, b) => a - b),
  }
}

export function describeCriteria(catalog: Catalog, criteria: SelectionCriteria) {
  const target = criteria.targetId ? (catalog.targets[criteria.targetId]?.name ?? "Unknown Target") : "None"
  const trains = criteria.opticalTrainIds.map((id) => catalog.opticalTrains[id]?.name ?? "Unknown equipment")
  return {
    target,
    geometry: `Footprint covers at least ${pct(MIN_FOOTPRINT_OVERLAP)} of the framing (prototype value)`,
    equipment: trains.length > 0 ? `${trains.join(", ")}, confirmed` : "Any confirmed equipment",
    channels: criteria.channels.length > 0 ? criteria.channels.join(", ") : "Any channel",
    exposures: criteria.exposureS.length > 0 ? criteria.exposureS.map(formatExposure).join(", ") : "Any exposure",
  }
}

export function matchesCriteria(catalog: Catalog, session: Session, criteria: SelectionCriteria, regions: Region[]): { match: boolean; detail: string } {
  if (session.supersededBy || session.imageType !== "light") return { match: false, detail: "Not a current light session" }
  if (criteria.channels.length > 0 && !criteria.channels.includes(session.channel ?? "")) return { match: false, detail: "Channel outside the criteria" }
  if (criteria.exposureS.length > 0 && !criteria.exposureS.includes(sessionExposureS(session))) return { match: false, detail: "Exposure outside the criteria" }
  if (session.equipment.status !== "confirmed" || (criteria.opticalTrainIds.length > 0 && !criteria.opticalTrainIds.includes(session.equipment.value ?? ""))) {
    return { match: false, detail: "Equipment is not the confirmed criteria equipment" }
  }
  const geometry = sessionGeometry(catalog, session, regions)
  if (geometry.kind !== "footprint" || (geometry.coverage ?? 0) < MIN_FOOTPRINT_OVERLAP) return { match: false, detail: "No qualifying footprint" }
  return {
    match: true,
    detail: `Matches saved criteria: footprint covers ${pct(geometry.coverage ?? 0)} of ${geometry.coveredRegion}, ${trainName(catalog, session)} confirmed, ${session.channel}, ${formatExposure(sessionExposureS(session))}`,
  }
}

export type RefreshChange =
  | { id: string; kind: "add-session"; sessionId: SessionId; detail: string }
  | { id: string; kind: "remove-session"; sessionId: SessionId; detail: string }
  | { id: string; kind: "add-frames"; sessionId: SessionId; assetIds: AssetId[]; detail: string }

export interface RefreshComparison {
  baseRevision: MembershipRevision
  criteria: SelectionCriteria
  changes: RefreshChange[]
  /** Members selected by hand or outside the saved criteria; kept as recorded. */
  manual: Array<{ session: Session; reason: SelectionReason }>
  exclusions: Array<{ session: Session; count: number }>
  /** Members that cannot be observed now: Unavailable, never removed. */
  unavailable: Array<{ session: Session; members: number; state: AssetAvailability }>
}

export function refreshComparison(disk: Disk, catalog: Catalog, view: View, ctx: ViewContext): RefreshComparison | null {
  const base = latestRevision(view)
  if (!base) return null
  const criteria = view.criteria ?? deriveCriteria(catalog, view, base, ctx)
  const memberIds = base.sessions.map((s) => s.sessionId)
  const changes: RefreshChange[] = []
  for (const session of Object.values(catalog.sessions)) {
    if (memberIds.includes(session.id)) continue
    const result = matchesCriteria(catalog, session, criteria, ctx.regions)
    if (result.match) changes.push({ id: `add:${session.id}`, kind: "add-session", sessionId: session.id, detail: result.detail })
  }
  const known = new Set([...base.included, ...base.excluded, ...base.unresolved])
  for (const { sessionId } of base.sessions) {
    const session = catalog.sessions[sessionId]
    if (!session) continue
    if (session.supersededBy) {
      const replacement = catalog.sessions[session.supersededBy]
      changes.push({
        id: `remove:${sessionId}`,
        kind: "remove-session",
        sessionId,
        detail: `Replaced by a regrouping revision${replacement ? ` (${sessionLabel(replacement)})` : ""}. Its frames stay in the library.`,
      })
      continue
    }
    const fresh = session.assetIds.filter((id) => !known.has(id))
    if (fresh.length > 0) {
      changes.push({ id: `frames:${sessionId}`, kind: "add-frames", sessionId, assetIds: fresh, detail: `${plural(fresh.length, "frame")} indexed in this session after revision ${base.revision}` })
    }
  }
  const manual = base.sessions
    .map((s) => ({ session: catalog.sessions[s.sessionId], reason: s.reason }))
    .filter((e): e is { session: Session; reason: SelectionReason } => e.session !== undefined && !e.session.supersededBy)
    .filter((e) => !CRITERIA_REASONS.includes(e.reason.kind) || !matchesCriteria(catalog, e.session, criteria, ctx.regions).match)
  const exclusionCounts = new Map<SessionId, number>()
  for (const id of base.excluded) {
    const sessionId = catalog.assets[id]?.sessionId
    if (sessionId) exclusionCounts.set(sessionId, (exclusionCounts.get(sessionId) ?? 0) + 1)
  }
  const exclusions = [...exclusionCounts.entries()]
    .map(([id, count]) => ({ session: catalog.sessions[id], count }))
    .filter((e): e is { session: Session; count: number } => e.session !== undefined)
  return { baseRevision: base, criteria, changes, manual, exclusions, unavailable: viewSummary(disk, catalog, base).unavailableSessions }
}

export function applyRefreshChanges(disk: Disk, catalog: Catalog, content: MembershipContent, changes: RefreshChange[], when: string): MembershipContent {
  let next = content
  for (const change of changes) {
    const session = catalog.sessions[change.sessionId]
    if (change.kind === "add-session" && session) {
      next = addSessions(next, disk, catalog, [{ session, reason: { kind: "refresh-added", detail: `Accepted in Refresh selection on ${when}. ${change.detail}.` } }])
    } else if (change.kind === "remove-session") {
      next = removeSessions(next, catalog, [change.sessionId])
    } else if (change.kind === "add-frames" && session) {
      const members = initialMembers(disk, catalog, { ...session, assetIds: change.assetIds })
      next = {
        ...next,
        included: [...next.included, ...members.included],
        excluded: [...next.excluded, ...members.excluded],
        unresolved: [...next.unresolved, ...members.unresolved],
      }
    }
  }
  return next
}

/** Frames in `content` missing from the newest prepared revision: they need frame and calibration review (J25 S5). */
export function framesSincePrepared(catalog: Catalog, view: View, content: MembershipContent): { preparedRevision: number; entryCount: number; added: number } | null {
  const prepared = Object.values(catalog.preparations)
    .filter((p) => p.viewId === view.id && (p.state === "prepared" || p.state === "partial"))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .at(-1)
  if (!prepared) return null
  const revision = view.revisions.find((r) => r.revision === prepared.membershipRevision)
  if (!revision) return null
  const before = new Set(revision.included)
  const added = content.included.filter((id) => !before.has(id)).length
  return { preparedRevision: prepared.membershipRevision, entryCount: prepared.entryCount, added }
}

// ---------------------------------------------------------------------------
// Files and scale
// ---------------------------------------------------------------------------

/** The file holding the asset's current bytes, read from the copy PlateVault would use. */
export function currentFile(disk: Disk, catalog: Catalog, asset: Asset): DiskFile | undefined {
  const copy = preferredCopy(disk, catalog, asset)
  if (!disk.volumes[copy.volumeId]?.mounted) return undefined
  return disk.files[fileKey(copy.volumeId, copy.path)]
}

/** Pixel scale in arcsec/px from the session's confirmed or associated equipment; null when unknown. */
export function pixelScaleFor(catalog: Catalog, session: Session | undefined): number | null {
  if (!session || (session.equipment.status !== "confirmed" && session.equipment.status !== "associated")) return null
  const train = session.equipment.value ? catalog.opticalTrains[session.equipment.value] : undefined
  const camera = train?.cameraId ? catalog.cameras[train.cameraId] : undefined
  if (!train || !camera) return null
  return pixelScaleArcsec(camera.pixelSizeUm, train.effectiveFocalLengthMm, session.binning)
}
