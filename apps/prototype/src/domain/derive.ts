/**
 * Shared derived values. Tracks compute availability, coverage, membership,
 * View status, footprints and Project progress through these so every
 * surface reports the same numbers (spec 063 SC-004, LIB-FR-08, VSEL-FR-08,
 * PRJ-FR-04). Nothing here writes state.
 */
import { correctedExposureS } from "./corrections"
import { deniedAncestor } from "./indexing"
import { fieldOfView } from "./sky"
import type {
  Asset,
  AssetCopy,
  Availability,
  Catalog,
  ChecklistItem,
  Disk,
  FrameMeasurement,
  Location,
  LocationId,
  MembershipContent,
  ObservingSite,
  Project,
  Session,
  SessionId,
  TargetId,
  View,
  ViewStatus,
} from "./types"

export function locationAvailability(disk: Disk, location: Location): Availability {
  return disk.volumes[location.volumeId]?.mounted ? "online" : "offline"
}

/**
 * Whether a copy (or, for an asset, its best copy) can be used as an input now.
 * - offline: its volume is not mounted (last-observed values still count as captured).
 * - unreadable: access is denied.
 * - absent: a complete scan did not find it.
 */
export type AssetAvailability = "available" | "offline" | "unreadable" | "absent"

const AVAILABILITY_ORDER: AssetAvailability[] = ["available", "offline", "unreadable", "absent"]

export function copyAvailability(disk: Disk, catalog: Catalog, copy: AssetCopy): AssetAvailability {
  const location = catalog.locations[copy.locationId]
  if (!location || !disk.volumes[location.volumeId]?.mounted) return "offline"
  if (deniedAncestor(disk, copy.path)) return "unreadable"
  if (copy.presence === "absent") return "absent"
  return "available"
}

/** An asset is as available as its best copy. */
export function assetAvailability(disk: Disk, catalog: Catalog, asset: Asset): AssetAvailability {
  let best = AVAILABILITY_ORDER.length - 1
  for (const copy of asset.copies) best = Math.min(best, AVAILABILITY_ORDER.indexOf(copyAvailability(disk, catalog, copy)))
  return AVAILABILITY_ORDER[best]!
}

/** The copy to read or link: the first available one, else the first recorded. */
export function preferredCopy(disk: Disk, catalog: Catalog, asset: Asset): AssetCopy {
  return asset.copies.find((copy) => copyAvailability(disk, catalog, copy) === "available") ?? asset.copies[0]!
}

/** Locations holding at least one copy of the session's frames, in first-seen order. */
export function sessionLocationIds(catalog: Catalog, session: Session): LocationId[] {
  const ids: LocationId[] = []
  for (const assetId of session.assetIds) {
    for (const copy of catalog.assets[assetId]?.copies ?? []) if (!ids.includes(copy.locationId)) ids.push(copy.locationId)
  }
  return ids
}

/**
 * Capture site from the header coordinates of the session's frames, matched
 * against the saved sites when read, so sites added after indexing apply
 * (J20 S6). Null when the headers carry no site or no saved site matches.
 */
export function captureSite(catalog: Catalog, session: Session): ObservingSite | null {
  for (const assetId of session.assetIds) {
    const header = catalog.assets[assetId]?.observed
    if (!header || header.siteLat === null || header.siteLon === null) continue
    const { siteLat, siteLon } = header
    return Object.values(catalog.sites).find((s) => Math.abs(s.latitude - siteLat) < 0.1 && Math.abs(s.longitude - siteLon) < 0.1) ?? null
  }
  return null
}

/**
 * LIB-FR-09: a decision made against different bytes, or without a recorded
 * basis, is "changed content"; a decision awaiting its rescan rehash is
 * "verification pending". Both leave applicable Usable/Unreviewed totals.
 */
export function qualityApplicability(asset: Asset): "applicable" | "changed-content" | "verification-pending" {
  if (asset.quality.value === "unreviewed") return "applicable"
  if (asset.quality.basisSha256 !== asset.sha256) return "changed-content"
  return asset.quality.verificationPending ? "verification-pending" : "applicable"
}

/** A cached measurement applies only to the bytes it measured (PIX-AC-10). */
export function measurementApplies(asset: Asset, measurement: FrameMeasurement): boolean {
  return measurement.state === "valid" && measurement.inputSha256 === asset.sha256
}

export interface FrameTotals {
  frames: number
  seconds: number
}

const zero = (): FrameTotals => ({ frames: 0, seconds: 0 })

function add(totals: FrameTotals, seconds: number) {
  totals.frames += 1
  totals.seconds += seconds
}

/**
 * Exposure that counts for an asset: its session's latest exposure correction,
 * else the observed EXPTIME. Every total reads this; the header never changes
 * (LIB-FR-05, LIB-FR-12).
 */
export function effectiveExposureS(catalog: Catalog, asset: Asset): number {
  const session = asset.sessionId ? catalog.sessions[asset.sessionId] : undefined
  return (session && correctedExposureS(session)) ?? asset.observed.exposureS
}

export interface QualityBreakdown {
  captured: FrameTotals
  usable: FrameTotals
  unreviewed: FrameTotals
  unusable: FrameTotals
  changedContent: FrameTotals
  /** Decided frames whose rescan rehash has not finished (LIB-AC-14). */
  verificationPending: FrameTotals
  /** Captured frames with no available copy right now (offline, unreadable or absent). */
  unavailable: FrameTotals
}

export function emptyBreakdown(): QualityBreakdown {
  return {
    captured: zero(),
    usable: zero(),
    unreviewed: zero(),
    unusable: zero(),
    changedContent: zero(),
    verificationPending: zero(),
    unavailable: zero(),
  }
}

/** Adds one logical asset. Copies never count twice. */
export function addToBreakdown(breakdown: QualityBreakdown, disk: Disk, catalog: Catalog, asset: Asset) {
  const seconds = effectiveExposureS(catalog, asset)
  add(breakdown.captured, seconds)
  if (assetAvailability(disk, catalog, asset) !== "available") add(breakdown.unavailable, seconds)
  const applicability = qualityApplicability(asset)
  if (applicability === "changed-content") add(breakdown.changedContent, seconds)
  else if (applicability === "verification-pending") add(breakdown.verificationPending, seconds)
  else if (asset.quality.value === "usable") add(breakdown.usable, seconds)
  else if (asset.quality.value === "unusable") add(breakdown.unusable, seconds)
  else add(breakdown.unreviewed, seconds)
}

export function sessionBreakdown(disk: Disk, catalog: Catalog, session: Session): QualityBreakdown {
  const breakdown = emptyBreakdown()
  for (const id of session.assetIds) {
    const asset = catalog.assets[id]
    if (asset) addToBreakdown(breakdown, disk, catalog, asset)
  }
  return breakdown
}

export interface ChannelCoverage {
  channel: string
  breakdown: QualityBreakdown
  sessionIds: string[]
}

/**
 * Target coverage by channel (LIB-FR-08). Counts light sessions whose Target
 * association is confirmed or associated by agreeing evidence; sessions that
 * need review are returned separately and never counted. Superseded sessions
 * (replaced by a regrouping revision) never count.
 */
export function targetCoverage(disk: Disk, catalog: Catalog, targetId: TargetId) {
  const channels = new Map<string, ChannelCoverage>()
  const needsReview: Session[] = []
  for (const session of Object.values(catalog.sessions)) {
    if (session.supersededBy || session.imageType !== "light" || session.target.value !== targetId) continue
    if (session.target.status === "needs-review") {
      needsReview.push(session)
      continue
    }
    if (session.target.status === "unresolved") continue
    const channel = session.channel ?? "No filter"
    const entry = channels.get(channel) ?? { channel, breakdown: emptyBreakdown(), sessionIds: [] }
    entry.sessionIds.push(session.id)
    for (const id of session.assetIds) {
      const asset = catalog.assets[id]
      if (asset) addToBreakdown(entry.breakdown, disk, catalog, asset)
    }
    channels.set(channel, entry)
  }
  return { channels: [...channels.values()].sort((a, b) => a.channel.localeCompare(b.channel)), needsReview }
}

export interface MembershipSummary {
  byChannel: Array<{ channel: string; included: FrameTotals }>
  included: FrameTotals
  excluded: number
  unresolved: number
  unreviewed: number
  unusable: number
}

/** Intended included frames and integration by channel (VSEL-FR-08). */
export function membershipSummary(catalog: Catalog, content: MembershipContent): MembershipSummary {
  const byChannel = new Map<string, FrameTotals>()
  const included = zero()
  let unreviewed = 0
  let unusable = 0
  for (const id of content.included) {
    const asset = catalog.assets[id]
    if (!asset) continue
    const session = asset.sessionId ? catalog.sessions[asset.sessionId] : undefined
    const channel = session?.channel ?? asset.observed.filter ?? "No filter"
    const totals = byChannel.get(channel) ?? zero()
    const seconds = effectiveExposureS(catalog, asset)
    add(totals, seconds)
    byChannel.set(channel, totals)
    add(included, seconds)
    if (asset.quality.value === "unreviewed") unreviewed += 1
    if (asset.quality.value === "unusable") unusable += 1
  }
  return {
    byChannel: [...byChannel.entries()]
      .map(([channel, totals]) => ({ channel, included: totals }))
      .sort((a, b) => a.channel.localeCompare(b.channel)),
    included,
    excluded: content.excluded.length,
    unresolved: content.unresolved.length,
    unreviewed,
    unusable,
  }
}

/**
 * View status, derived so no track has to keep it in step:
 * complete (Mark complete) > prepared (the latest preparation of the latest
 * revision is verified) > saved (a committed revision exists) > draft.
 * Saving a new revision therefore returns a prepared View to saved.
 */
export function viewStatus(catalog: Catalog, view: View): ViewStatus {
  if (view.completedAt) return "complete"
  const latest = view.revisions.at(-1)
  if (!latest) return "draft"
  const preparations = Object.values(catalog.preparations)
    .filter((p) => p.viewId === view.id && p.membershipRevision === latest.revision)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  return preparations.at(-1)?.state === "prepared" ? "prepared" : "saved"
}

// ---------------------------------------------------------------------------
// Footprints and coverage (D01, D12)
// ---------------------------------------------------------------------------

/** A rectangle on the sky: centre, size and rotation in degrees. */
export interface Footprint {
  ra: number
  dec: number
  widthDeg: number
  heightDeg: number
  rotationDeg: number
}

/**
 * Prototype value for the footprint-overlap rule (J21 G2): a footprint
 * "covers" a framing or panel when at least this fraction of the region lies
 * inside it. D01 qualifies geometry; the threshold itself is a prototype choice.
 */
export const MIN_FOOTPRINT_OVERLAP = 0.5

/**
 * Session footprint from qualified geometry only (D01): pointing with
 * orientation, plus a confirmed or associated optical train with a known
 * camera. Null otherwise; unknown is never treated as zero distance.
 */
export function sessionFootprint(catalog: Catalog, session: Session): Footprint | null {
  const pointing = session.pointing
  if (!pointing || pointing.rotationDeg === null) return null
  if (session.equipment.status !== "confirmed" && session.equipment.status !== "associated") return null
  const train = session.equipment.value ? catalog.opticalTrains[session.equipment.value] : undefined
  const camera = train?.cameraId ? catalog.cameras[train.cameraId] : undefined
  const fov = fieldOfView(train ?? null, camera ?? null, session.binning)
  if (!fov) return null
  return { ra: pointing.ra, dec: pointing.dec, widthDeg: fov.widthDeg, heightDeg: fov.heightDeg, rotationDeg: pointing.rotationDeg }
}

const RAD = Math.PI / 180

/** Gnomonic projection of (ra, dec) onto the tangent plane at (ra0, dec0), in degrees. */
function project(ra: number, dec: number, ra0: number, dec0: number): [number, number] {
  const d = dec * RAD
  const d0 = dec0 * RAD
  const dRa = (ra - ra0) * RAD
  const cosC = Math.sin(d0) * Math.sin(d) + Math.cos(d0) * Math.cos(d) * Math.cos(dRa)
  return [(Math.cos(d) * Math.sin(dRa)) / cosC / RAD, (Math.cos(d0) * Math.sin(d) - Math.sin(d0) * Math.cos(d) * Math.cos(dRa)) / cosC / RAD]
}

const SAMPLES = 40

/**
 * Fraction (0-1) of `region` covered by the union of `footprints`, sampled on
 * a grid in the region's tangent plane. Rotations are treated as plane
 * rotations, which holds for fields of a few degrees.
 */
export function coverageFraction(region: Footprint, footprints: Footprint[]): number {
  if (footprints.length === 0) return 0
  const rects = footprints.map((f) => {
    const [cx, cy] = project(f.ra, f.dec, region.ra, region.dec)
    return { cx, cy, halfW: f.widthDeg / 2, halfH: f.heightDeg / 2, cos: Math.cos(f.rotationDeg * RAD), sin: Math.sin(f.rotationDeg * RAD) }
  })
  const cos = Math.cos(region.rotationDeg * RAD)
  const sin = Math.sin(region.rotationDeg * RAD)
  let covered = 0
  for (let i = 0; i < SAMPLES; i += 1) {
    for (let j = 0; j < SAMPLES; j += 1) {
      const u = ((i + 0.5) / SAMPLES - 0.5) * region.widthDeg
      const v = ((j + 0.5) / SAMPLES - 0.5) * region.heightDeg
      const x = u * cos - v * sin
      const y = u * sin + v * cos
      const inside = rects.some((r) => {
        const dx = x - r.cx
        const dy = y - r.cy
        return Math.abs(dx * r.cos + dy * r.sin) <= r.halfW && Math.abs(-dx * r.sin + dy * r.cos) <= r.halfH
      })
      if (inside) covered += 1
    }
  }
  return covered / (SAMPLES * SAMPLES)
}

// ---------------------------------------------------------------------------
// Project progress (PRJ-FR-03, PRJ-FR-04, PLAN-FR-02)
// ---------------------------------------------------------------------------

export type ChecklistState = "met" | "partial" | "missing" | "unknown"

export interface ChecklistProgress {
  item: ChecklistItem
  state: ChecklistState
  /**
   * Integration and frame-count items: captured, library-usable and
   * Project-accepted totals, always labelled separately. Project-accepted
   * (library-Usable, not rejected for this Project) is the met-goal basis.
   */
  totals: { captured: FrameTotals; libraryUsable: FrameTotals; projectAccepted: FrameTotals } | null
  /** Panel-coverage items: covered fraction 0-1; null when no linked session has qualified geometry. */
  coverage: number | null
  /** Linked sessions that are evidence for the item. */
  evidenceSessionIds: SessionId[]
  /** Why the state is unknown or missing; null when met. */
  reason: string | null
}

function linkedLights(catalog: Catalog, project: Project): Session[] {
  return project.linkedSessionIds
    .map((id) => catalog.sessions[id])
    .filter((s): s is Session => s !== undefined && !s.supersededBy && s.imageType === "light")
}

function channelTotals(catalog: Catalog, project: Project, sessions: Session[]) {
  const totals = { captured: zero(), libraryUsable: zero(), projectAccepted: zero() }
  for (const session of sessions) {
    for (const id of session.assetIds) {
      const asset = catalog.assets[id]
      if (!asset) continue
      const seconds = effectiveExposureS(catalog, asset)
      add(totals.captured, seconds)
      if (asset.quality.value !== "usable" || qualityApplicability(asset) !== "applicable") continue
      add(totals.libraryUsable, seconds)
      if (!project.rejections[asset.id]) add(totals.projectAccepted, seconds)
    }
  }
  return totals
}

/** Progress for every checklist item. An unmet item never blocks a View; a met list never closes the Project. */
export function projectProgress(catalog: Catalog, project: Project): ChecklistProgress[] {
  const lights = linkedLights(catalog, project)
  return project.checklist.map((item): ChecklistProgress => {
    const base = { item, totals: null, coverage: null, evidenceSessionIds: [] as SessionId[], reason: null }
    switch (item.kind) {
      case "integration":
      case "frame-count": {
        const sessions = lights.filter((s) => s.channel === item.channel)
        const totals = channelTotals(catalog, project, sessions)
        const done = item.kind === "integration" ? totals.projectAccepted.seconds >= item.goalS : totals.projectAccepted.frames >= item.goalFrames
        const started = totals.projectAccepted.frames > 0
        return {
          ...base,
          totals,
          evidenceSessionIds: sessions.map((s) => s.id),
          state: done ? "met" : started ? "partial" : "missing",
          reason: done ? null : sessions.length === 0 ? `No linked ${item.channel} session` : "Project-accepted total is below the goal",
        }
      }
      case "exposure": {
        const sessions = lights.filter((s) => (correctedExposureS(s) ?? s.exposureS) === item.exposureS && (item.channel === null || s.channel === item.channel))
        return { ...base, evidenceSessionIds: sessions.map((s) => s.id), state: sessions.length > 0 ? "met" : "missing", reason: sessions.length > 0 ? null : "No linked session uses this exposure" }
      }
      case "panel-coverage": {
        const panel = project.panels.find((p) => p.id === item.panelId)
        if (!panel) return { ...base, state: "unknown", reason: "The panel no longer exists" }
        const withGeometry = lights.map((s) => ({ s, f: sessionFootprint(catalog, s) })).filter((x): x is { s: Session; f: Footprint } => x.f !== null)
        if (withGeometry.length === 0) return { ...base, state: "unknown", reason: "No linked session has pointing, orientation and confirmed equipment" }
        const coverage = coverageFraction(panel, withGeometry.map((x) => x.f))
        const evidence = withGeometry.filter((x) => coverageFraction(panel, [x.f]) > 0).map((x) => x.s.id)
        const state: ChecklistState = coverage >= MIN_FOOTPRINT_OVERLAP ? "met" : coverage > 0 ? "partial" : "missing"
        return { ...base, coverage, evidenceSessionIds: evidence, state, reason: state === "met" ? null : "Linked footprints cover too little of this panel" }
      }
      case "equipment": {
        const confirmed = lights.filter((s) => s.equipment.value === item.opticalTrainId && s.equipment.status === "confirmed")
        if (confirmed.length > 0) return { ...base, evidenceSessionIds: confirmed.map((s) => s.id), state: "met" }
        const pending = lights.filter((s) => s.equipment.status === "needs-review" || s.equipment.status === "unresolved")
        return pending.length > 0
          ? { ...base, evidenceSessionIds: pending.map((s) => s.id), state: "unknown", reason: "Linked sessions have equipment that needs review" }
          : { ...base, state: "missing", reason: "No linked session uses this optical train" }
      }
      case "calibration": {
        const cameras = new Set(lights.map((s) => s.cameraName))
        // Only flats are channel-specific.
        const channel = item.calibrationKind === "flat" ? item.channel : null
        const master = Object.values(catalog.masters).some(
          (m) => m.state === "adopted" && m.kind === item.calibrationKind && cameras.has(m.cameraName) && (channel === null || m.channel === channel),
        )
        const rawSets = Object.values(catalog.sessions).filter(
          (s) => !s.supersededBy && s.imageType === item.calibrationKind && cameras.has(s.cameraName) && (channel === null || s.channel === channel),
        )
        const found = master || rawSets.length > 0
        return { ...base, evidenceSessionIds: rawSets.map((s) => s.id), state: found ? "met" : "missing", reason: found ? null : "No library master or raw set for the linked cameras" }
      }
    }
  })
}

/** True when the catalog has nothing registered: first run. */
export function isLibraryEmpty(catalog: Catalog): boolean {
  return Object.keys(catalog.locations).length === 0
}
