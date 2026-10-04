/**
 * Shared derived values. Tracks compute availability, coverage and membership
 * totals through these so every surface reports the same numbers
 * (spec 063 SC-004, LIB-FR-08, VSEL-FR-08).
 */
import { deniedAncestor } from "./indexing"
import type {
  Asset,
  Availability,
  Catalog,
  Disk,
  Location,
  MembershipContent,
  Session,
  TargetId,
} from "./types"

export function locationAvailability(disk: Disk, location: Location): Availability {
  return disk.volumes[location.volumeId]?.mounted ? "online" : "offline"
}

/**
 * Whether an asset can be used as an input right now.
 * - offline: its volume is not mounted (last-observed values still count as captured).
 * - unreadable: access is denied.
 * - absent: a complete scan did not find it.
 */
export type AssetAvailability = "available" | "offline" | "unreadable" | "absent"

export function assetAvailability(disk: Disk, catalog: Catalog, asset: Asset): AssetAvailability {
  const location = catalog.locations[asset.locationId]
  if (!location || !disk.volumes[location.volumeId]?.mounted) return "offline"
  if (deniedAncestor(disk, asset.path)) return "unreadable"
  if (asset.presence === "absent") return "absent"
  return "available"
}

/**
 * LIB-FR-09: a decision made against different bytes, or without a recorded
 * basis, is "changed content" and leaves applicable Usable/Unreviewed totals.
 */
export function qualityApplicability(asset: Asset): "applicable" | "changed-content" {
  if (asset.quality.value === "unreviewed") return "applicable"
  return asset.quality.basisSha256 === asset.sha256 ? "applicable" : "changed-content"
}

export interface FrameTotals {
  frames: number
  seconds: number
}

const zero = (): FrameTotals => ({ frames: 0, seconds: 0 })

function add(totals: FrameTotals, asset: Asset) {
  totals.frames += 1
  totals.seconds += asset.observed.exposureS
}

export interface QualityBreakdown {
  captured: FrameTotals
  usable: FrameTotals
  unreviewed: FrameTotals
  unusable: FrameTotals
  changedContent: FrameTotals
  /** Captured frames whose location is offline or unreadable right now. */
  unavailable: FrameTotals
}

export function emptyBreakdown(): QualityBreakdown {
  return { captured: zero(), usable: zero(), unreviewed: zero(), unusable: zero(), changedContent: zero(), unavailable: zero() }
}

export function addToBreakdown(breakdown: QualityBreakdown, disk: Disk, catalog: Catalog, asset: Asset) {
  add(breakdown.captured, asset)
  if (assetAvailability(disk, catalog, asset) !== "available") add(breakdown.unavailable, asset)
  if (qualityApplicability(asset) === "changed-content") add(breakdown.changedContent, asset)
  else if (asset.quality.value === "usable") add(breakdown.usable, asset)
  else if (asset.quality.value === "unusable") add(breakdown.unusable, asset)
  else add(breakdown.unreviewed, asset)
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
 * need review are returned separately and never counted.
 */
export function targetCoverage(disk: Disk, catalog: Catalog, targetId: TargetId) {
  const channels = new Map<string, ChannelCoverage>()
  const needsReview: Session[] = []
  for (const session of Object.values(catalog.sessions)) {
    if (session.imageType !== "light" || session.target.value !== targetId) continue
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
    add(totals, asset)
    byChannel.set(channel, totals)
    add(included, asset)
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

/** True when the catalog has nothing registered: first run. */
export function isLibraryEmpty(catalog: Catalog): boolean {
  return Object.keys(catalog.locations).length === 0
}
