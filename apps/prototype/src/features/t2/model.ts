/**
 * T2 read model: pure derivations over the shared catalog for the library
 * surfaces (Targets, Sessions, Projects, Activity). Totals always come from
 * the shared `src/domain/derive.ts` so every track reports the same numbers;
 * this module only arranges them for T2's screens.
 */
import {
  addToBreakdown,
  assetAvailability,
  type AssetAvailability,
  emptyBreakdown,
  locationAvailability,
  type QualityBreakdown,
  qualityApplicability,
  sessionLocationIds,
  targetCoverage,
} from "@/domain/derive"
import { angularSeparationDeg, normalizeName } from "@/domain/sky"
import type {
  Asset,
  Catalog,
  ChecklistItem,
  Location,
  LocationId,
  LocationRole,
  Operation,
  Project,
  Session,
  SessionId,
  Target,
  TargetId,
  View,
} from "@/domain/types"
import { formatCount, formatDuration, formatExposure, formatNight } from "@/lib/format"
import type { PrototypeState } from "@/store/core"

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export type SessionKind = "light" | "calibration"

export function sessionKind(session: Session): SessionKind {
  return session.imageType === "light" ? "light" : "calibration"
}

/** Current (not superseded) sessions of one kind. */
export function currentSessions(catalog: Catalog, kind: SessionKind): Session[] {
  return Object.values(catalog.sessions).filter((s) => !s.supersededBy && sessionKind(s) === kind && s.imageType !== "unknown")
}

export const IMAGE_TYPE_LABEL: Record<Session["imageType"], string> = {
  light: "Light",
  dark: "Dark",
  flat: "Flat",
  bias: "Bias",
  "dark-flat": "Dark flat",
  "master-dark": "Master dark",
  "master-flat": "Master flat",
  "master-bias": "Master bias",
  unknown: "Unknown type",
}

/** "18 Sep · Ha · 300 s". Calibration sets lead with their type: "Flat · 2 Sep · L · 0.8 s". */
export function baseSessionLabel(session: Session): string {
  const parts = [formatNight(session.night), session.channel ?? "No filter", formatExposure(session.exposureS)]
  return session.imageType === "light" ? parts.join(" · ") : [IMAGE_TYPE_LABEL[session.imageType], ...parts].join(" · ")
}

/** Label with the camera added when another current session would read the same. */
export function sessionLabel(catalog: Catalog, session: Session): string {
  const base = baseSessionLabel(session)
  const clash = Object.values(catalog.sessions).some(
    (other) => other.id !== session.id && !other.supersededBy && baseSessionLabel(other) === base && other.cameraName !== session.cameraName,
  )
  return clash && session.cameraName ? `${base} · ${session.cameraName}` : base
}

/**
 * Grouping revision of a session (D15): 1 as indexed, and one more than the
 * sessions it replaced after a regrouping correction. It is not the record
 * revision that every revision-checked save bumps (D08).
 */
export function groupingRevision(catalog: Catalog, session: Session): number {
  let replaced = 0
  for (const id of session.previousSessionIds) {
    const previous = catalog.sessions[id]
    replaced = Math.max(replaced, previous ? groupingRevision(catalog, previous) : 1)
  }
  return replaced + 1
}

export interface LocationPresence {
  location: Location
  availability: "online" | "offline"
  /** Frames of this session with a copy in this location. */
  frames: number
}

export interface SessionRow {
  session: Session
  label: string
  breakdown: QualityBreakdown
  locations: LocationPresence[]
  /** Frames with more than one physical copy (counted once). */
  multiCopyFrames: number
  availability: Record<AssetAvailability, number>
  /** Most recent observation of any copy. */
  lastObservedAt: string | null
  targetName: string | null
  trainName: string | null
}

export function sessionRow(state: PrototypeState, session: Session): SessionRow {
  const { disk, catalog } = state
  const breakdown = emptyBreakdown()
  const availability: Record<AssetAvailability, number> = { available: 0, offline: 0, unreadable: 0, absent: 0 }
  const framesPerLocation = new Map<LocationId, number>()
  let multiCopyFrames = 0
  let lastObservedAt: string | null = null
  for (const id of session.assetIds) {
    const asset = catalog.assets[id]
    if (!asset) continue
    addToBreakdown(breakdown, disk, catalog, asset)
    availability[assetAvailability(disk, catalog, asset)] += 1
    if (asset.copies.length > 1) multiCopyFrames += 1
    const seen = new Set<LocationId>()
    for (const copy of asset.copies) {
      if (!lastObservedAt || copy.lastObservedAt > lastObservedAt) lastObservedAt = copy.lastObservedAt
      if (seen.has(copy.locationId)) continue
      seen.add(copy.locationId)
      framesPerLocation.set(copy.locationId, (framesPerLocation.get(copy.locationId) ?? 0) + 1)
    }
  }
  const locations = sessionLocationIds(catalog, session)
    .map((id) => catalog.locations[id])
    .filter((l): l is Location => l !== undefined)
    .map((location) => ({ location, availability: locationAvailability(disk, location), frames: framesPerLocation.get(location.id) ?? 0 }))
  const target = session.target.value ? catalog.targets[session.target.value] : undefined
  const train = session.equipment.value ? catalog.opticalTrains[session.equipment.value] : undefined
  return {
    session,
    label: sessionLabel(catalog, session),
    breakdown,
    locations,
    multiCopyFrames,
    availability,
    lastObservedAt,
    targetName: target?.name ?? null,
    trainName: train?.name ?? null,
  }
}

/** Frame quality as shown per frame: the decision, or its applicability when that differs. */
export type FrameQuality = "unreviewed" | "usable" | "unusable" | "changed-content" | "verification-pending"

export function frameQuality(asset: Asset): FrameQuality {
  const applicability = qualityApplicability(asset)
  return applicability === "applicable" ? asset.quality.value : applicability
}

export function sumBreakdowns(breakdowns: QualityBreakdown[]): QualityBreakdown {
  const total = emptyBreakdown()
  for (const b of breakdowns) {
    for (const key of Object.keys(total) as Array<keyof QualityBreakdown>) {
      total[key].frames += b[key].frames
      total[key].seconds += b[key].seconds
    }
  }
  return total
}

// ---------------------------------------------------------------------------
// Library scope (LIB-FR-03, LIB-FR-06, LIB-FR-07)
// ---------------------------------------------------------------------------

export type ScopeState = "never" | "complete" | "incomplete" | "provisional"

export interface LocationScopeRow {
  location: Location
  availability: "online" | "offline"
  state: ScopeState
  /** The index operation currently reading or queued for this location. */
  activeOperation: Operation | null
  /** "reading", "queued" while an index operation includes it. */
  activity: "reading" | "queued" | null
}

const SCOPE_ROLES: Record<SessionKind, LocationRole[]> = {
  light: ["captures", "archive"],
  calibration: ["calibration"],
}

export function activeIndexOperations(state: PrototypeState): Operation[] {
  return Object.values(state.operations).filter((op) => op.kind === "index" && (op.status === "running" || op.status === "paused"))
}

export function interruptedIndexOperations(state: PrototypeState): Operation[] {
  return Object.values(state.operations).filter((op) => op.kind === "index" && op.status === "interrupted")
}

/** Locations whose totals a library surface reports, with their scope right now. */
export function libraryScope(state: PrototypeState, kind: SessionKind): LocationScopeRow[] {
  const active = activeIndexOperations(state)
  const holding = new Set<LocationId>()
  for (const session of Object.values(state.catalog.sessions)) {
    if (session.supersededBy || sessionKind(session) !== kind) continue
    for (const id of sessionLocationIds(state.catalog, session)) holding.add(id)
  }
  return Object.values(state.catalog.locations)
    .filter((l) => SCOPE_ROLES[kind].includes(l.role) || holding.has(l.id))
    .sort((a, b) => a.displayName.localeCompare(b.displayName))
    .map((location) => {
      let activeOperation: Operation | null = null
      let activity: LocationScopeRow["activity"] = null
      for (const op of active) {
        const item = op.items.find((i) => i.id === location.id)
        if (item && (item.status === "running" || item.status === "pending")) {
          activeOperation = op
          activity = item.status === "running" ? "reading" : "queued"
        }
      }
      const scope: ScopeState = activity ? "provisional" : location.scanScope
      return { location, availability: locationAvailability(state.disk, location), state: scope, activeOperation, activity }
    })
}

// ---------------------------------------------------------------------------
// Targets (LIB-FR-08, LIB-FR-13)
// ---------------------------------------------------------------------------

export interface TargetSummary {
  target: Target
  channels: string[]
  breakdown: QualityBreakdown
  needsReview: number
  projects: number
  planned: boolean
  /** Separation from a coordinate search, in degrees. */
  separationDeg: number | null
}

export function targetSummary(state: PrototypeState, target: Target): TargetSummary {
  const coverage = targetCoverage(state.disk, state.catalog, target.id)
  return {
    target,
    channels: coverage.channels.map((c) => c.channel),
    breakdown: sumBreakdowns(coverage.channels.map((c) => c.breakdown)),
    needsReview: coverage.needsReview.length,
    projects: Object.values(state.catalog.projects).filter((p) => p.targetIds.includes(target.id)).length,
    planned: Boolean(state.catalog.plans[target.id]?.planned),
    separationDeg: null,
  }
}

/** Two numbers in degrees, e.g. "314.7 44.5" or "314.7, +44.5". */
export function parseCoordinates(query: string): { ra: number; dec: number } | null {
  const match = query.trim().match(/^(-?\d+(?:\.\d+)?)[\s,]+([+-]?\d+(?:\.\d+)?)$/)
  if (!match) return null
  const ra = Number(match[1])
  const dec = Number(match[2])
  if (ra < 0 || ra >= 360 || dec < -90 || dec > 90) return null
  return { ra, dec }
}

/** Coordinate searches list Targets within this radius. */
export const COORDINATE_SEARCH_RADIUS_DEG = 5

/** Local Target search by name, alias or coordinates. Never uses the network. */
export function searchTargets(summaries: TargetSummary[], query: string): TargetSummary[] {
  const trimmed = query.trim()
  if (!trimmed) return summaries
  const coords = parseCoordinates(trimmed)
  if (coords) {
    return summaries
      .filter((s) => s.target.ra !== null && s.target.dec !== null)
      .map((s) => ({ ...s, separationDeg: angularSeparationDeg(coords.ra, coords.dec, s.target.ra!, s.target.dec!) }))
      .filter((s) => s.separationDeg! <= COORDINATE_SEARCH_RADIUS_DEG)
      .sort((a, b) => a.separationDeg! - b.separationDeg!)
  }
  const needle = normalizeName(trimmed)
  return summaries.filter((s) => [s.target.name, ...s.target.aliases].some((name) => normalizeName(name).includes(needle)))
}

export function findTargetByName(catalog: Catalog, name: string, exceptId?: TargetId): Target | undefined {
  const needle = normalizeName(name)
  return Object.values(catalog.targets).find((t) => t.id !== exceptId && [t.name, ...t.aliases].some((n) => normalizeName(n) === needle))
}

/** Views that belong to a Target directly or through one of its Projects. */
export function viewsForTarget(catalog: Catalog, targetId: TargetId): View[] {
  return Object.values(catalog.views).filter((v) => v.targetId === targetId || (v.projectId && catalog.projects[v.projectId]?.targetIds.includes(targetId)))
}

export function acceptedResultsForViews(catalog: Catalog, views: View[]) {
  const ids = new Set(views.map((v) => v.id))
  return Object.values(catalog.results).filter((r) => r.acceptance === "accepted" && ids.has(r.viewId))
}

// ---------------------------------------------------------------------------
// Projects (PRJ-FR-03, PRJ-FR-04)
// ---------------------------------------------------------------------------

export function checklistCriterion(catalog: Catalog, project: Pick<Project, "panels">, item: ChecklistItem): string {
  switch (item.kind) {
    case "integration":
      return `${item.channel} integration · goal ${formatDuration(item.goalS)}`
    case "frame-count":
      return `${item.channel} frames · goal ${formatCount(item.goalFrames)}`
    case "exposure":
      return `Exposure · ${formatExposure(item.exposureS)} (${item.channel ?? "any channel"})`
    case "panel-coverage":
      return `Panel coverage · ${project.panels.find((p) => p.id === item.panelId)?.name ?? "removed panel"}`
    case "equipment":
      return `Equipment · ${catalog.opticalTrains[item.opticalTrainId]?.name ?? "removed optical train"}`
    case "calibration": {
      const kind = { dark: "Dark", flat: "Flat", bias: "Bias", "dark-flat": "Dark flat" }[item.calibrationKind]
      return `Calibration · ${kind} master or raw set${item.channel ? ` (${item.channel})` : ""}`
    }
  }
}

/** Channels known to the library: catalog filters plus channels seen on sessions. */
export function knownChannels(catalog: Catalog): string[] {
  const names = new Set(Object.values(catalog.filters).map((f) => f.name))
  for (const s of Object.values(catalog.sessions)) if (s.channel) names.add(s.channel)
  return [...names].sort((a, b) => a.localeCompare(b))
}

export function projectsLinking(catalog: Catalog, sessionId: SessionId): Project[] {
  return Object.values(catalog.projects).filter((p) => p.linkedSessionIds.includes(sessionId))
}
