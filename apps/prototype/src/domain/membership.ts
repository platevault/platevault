/**
 * Run membership (D-W34, VSEL-FR-06 to VSEL-FR-16): pure transforms of one
 * run's membership content and the summaries Select, Review and Prepare
 * share. No store access here; the store actions write through `commit()`.
 */
import { correctedExposureS } from "./corrections"
import {
  assetAvailability,
  type AssetAvailability,
  copyAvailability,
  membershipSummary,
  type MembershipSummary,
  preferredCopy,
  qualityApplicability,
} from "./library"
import { fileKey } from "./disk"
import { pixelScaleArcsec } from "./sky"
import type {
  Asset,
  AssetId,
  Catalog,
  Disk,
  DiskFile,
  LocationId,
  MembershipContent,
  Metric,
  SelectionReason,
  Session,
  SessionId,
} from "./types"
import { formatCount, formatDuration, formatExposure, formatNight } from "@/lib/format"
import { joinRefs, type MessageRef, type Messages, msg, say, verbatim } from "@/lib/i18n"

export function emptyContent(): MembershipContent {
  return { sessions: [], included: [], excluded: [], rejected: [], unresolved: [], productInputs: [] }
}

/** The content fields only, without revision or draft bookkeeping. */
export function contentOf(content: MembershipContent): MembershipContent {
  return {
    sessions: content.sessions,
    included: content.included,
    excluded: content.excluded,
    rejected: content.rejected,
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
    sameSet(a.rejected, b.rejected) &&
    sameSet(a.unresolved, b.unresolved) &&
    sameSet(a.productInputs, b.productInputs)
  )
}

export type MemberState = "included" | "excluded" | "rejected" | "unresolved"

export function memberState(content: MembershipContent, assetId: AssetId): MemberState | null {
  if (content.included.includes(assetId)) return "included"
  if (content.excluded.includes(assetId)) return "excluded"
  if (content.rejected.includes(assetId)) return "rejected"
  if (content.unresolved.includes(assetId)) return "unresolved"
  return null
}

/**
 * Initial membership of one session (VSEL-FR-15): available Unreviewed and
 * Usable frames are included, library-Unusable frames start visibly
 * excluded, unavailable frames stay named unresolved. A decision made against
 * other bytes (changed content) no longer applies, so that frame is treated
 * as unreviewed. Trashed frames never enter a membership (D-W43).
 */
export function initialMembers(disk: Disk, catalog: Catalog, session: Session) {
  const included: AssetId[] = []
  const excluded: AssetId[] = []
  const unresolved: AssetId[] = []
  for (const id of session.assetIds) {
    const asset = catalog.assets[id]
    if (!asset || asset.trashed) continue
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
      rejected: without(next.rejected, ids),
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
    rejected: without(content.rejected, remove),
    unresolved: without(content.unresolved, remove),
  }
}

/** Exclude from run: run scope only; files and library quality are unchanged (VSEL-FR-10). */
export function excludeFrames(content: MembershipContent, assetIds: AssetId[]): MembershipContent {
  const ids = new Set(assetIds.filter((id) => content.included.includes(id) || content.unresolved.includes(id)))
  if (ids.size === 0) return content
  return { ...content, included: without(content.included, ids), unresolved: without(content.unresolved, ids), excluded: [...content.excluded, ...ids] }
}

/** Restore excluded frames to the run; unavailable ones return as unresolved, never as verified inputs. */
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

/** A frame rejected in Review leaves the draft with the reason "Rejected" (D-W54). */
export function rejectInContent(content: MembershipContent, assetIds: AssetId[]): MembershipContent {
  const ids = new Set(assetIds.filter((id) => content.included.includes(id) || content.unresolved.includes(id) || content.excluded.includes(id)))
  if (ids.size === 0) return content
  return {
    ...content,
    included: without(content.included, ids),
    unresolved: without(content.unresolved, ids),
    excluded: without(content.excluded, ids),
    rejected: [...without(content.rejected, ids), ...ids],
  }
}

/** Un-rejecting restores the frame to the draft (D-W54); an unavailable frame returns unresolved. */
export function unrejectInContent(disk: Disk, catalog: Catalog, content: MembershipContent, assetIds: AssetId[]): MembershipContent {
  const ids = assetIds.filter((id) => content.rejected.includes(id))
  if (ids.length === 0) return content
  const available = ids.filter((id) => {
    const asset = catalog.assets[id]
    return asset ? assetAvailability(disk, catalog, asset) === "available" : false
  })
  return {
    ...content,
    rejected: without(content.rejected, new Set(ids)),
    included: [...content.included, ...available],
    unresolved: [...content.unresolved, ...ids.filter((id) => !available.includes(id))],
  }
}

/** Unresolved members whose copies are readable again join the run once the user resolves them. */
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
  framesRejected: number
  framesAdded: number
  framesRemoved: number
}

export function diffContent(base: MembershipContent | null, next: MembershipContent): ContentDiff {
  const from = base ?? emptyContent()
  const fromSessions = from.sessions.map((s) => s.sessionId)
  const toSessions = next.sessions.map((s) => s.sessionId)
  const inFrom = new Set([...from.included, ...from.unresolved])
  const inTo = new Set([...next.included, ...next.unresolved])
  const setAside = (content: MembershipContent) => new Set([...content.excluded, ...content.rejected])
  const asideFrom = setAside(from)
  const asideTo = setAside(next)
  return {
    sessionsAdded: toSessions.filter((id) => !fromSessions.includes(id)),
    sessionsRemoved: fromSessions.filter((id) => !toSessions.includes(id)),
    framesExcluded: next.excluded.filter((id) => !from.excluded.includes(id) && inFrom.has(id)).length,
    framesRejected: next.rejected.filter((id) => !from.rejected.includes(id)).length,
    framesRestored: [...asideFrom].filter((id) => !asideTo.has(id) && inTo.has(id)).length,
    framesAdded: [...inTo].filter((id) => !inFrom.has(id) && !asideFrom.has(id)).length,
    framesRemoved: [...inFrom].filter((id) => !inTo.has(id) && !asideTo.has(id)).length,
  }
}

/** The changes a save accepts, in words; stored with the revision (VSEL-FR-16). */
export function describeDiff(catalog: Catalog, diff: ContentDiff): MessageRef[] {
  const names = (ids: SessionId[]) =>
    joinRefs(
      ids.map((id) => {
        const s = catalog.sessions[id]
        return s ? sessionRef(s) : msg("domain_diff_session_missing")
      }),
      ", ",
    )
  const frames = (count: number) => ({ count, n: formatCount(count) })
  const lines: MessageRef[] = []
  if (diff.sessionsAdded.length > 0) lines.push(msg("domain_diff_added", { sessions: names(diff.sessionsAdded) }))
  if (diff.sessionsRemoved.length > 0) lines.push(msg("domain_diff_removed", { sessions: names(diff.sessionsRemoved) }))
  if (diff.framesExcluded > 0) lines.push(msg("domain_diff_excluded", frames(diff.framesExcluded)))
  if (diff.framesRejected > 0) lines.push(msg("domain_diff_rejected", frames(diff.framesRejected)))
  if (diff.framesRestored > 0) lines.push(msg("domain_diff_restored", frames(diff.framesRestored)))
  if (lines.length === 0 && (diff.framesAdded > 0 || diff.framesRemoved > 0)) lines.push(msg("domain_diff_frames", { added: diff.framesAdded, removed: diff.framesRemoved }))
  return lines.length > 0 ? lines : [msg("domain_diff_none")]
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

/** "18 Sep Ha"; "18 Sep no filter" without a filter. */
export function sessionRef(session: Session): MessageRef {
  const night = formatNight(session.night)
  return session.channel ? verbatim(`${night} ${session.channel}`) : msg("domain_session_no_filter", { night })
}

export function sessionLabel(m: Messages, session: Session): string {
  return say(m, sessionRef(session))
}

/** "18 Sep · Ha · 300 s", the label calibration and preparation lists use. */
export function sessionLongRef(session: Session): MessageRef {
  const channel = session.channel ? verbatim(session.channel) : msg("palette_session_no_filter")
  return joinRefs([verbatim(formatNight(session.night)), channel, verbatim(formatExposure(sessionExposureS(session)))], " · ")
}

export function sessionLongLabel(m: Messages, session: Session): string {
  return say(m, sessionLongRef(session))
}

/** The session's exposure as the catalog counts it: the latest correction, else the observed EXPTIME. */
export function sessionExposureS(session: Session): number {
  return correctedExposureS(session) ?? session.exposureS
}

/** Why a session is in a run, beside its detail. */
export const REASON_NAME: Record<SelectionReason["kind"], MessageRef> = {
  candidate: msg("status_candidate"),
  "panel-pointing": msg("domain_reason_panel_pointing"),
  "panel-assigned": msg("domain_reason_panel_assigned"),
  "refresh-added": msg("domain_reason_refresh_added"),
  manual: msg("domain_reason_manual"),
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
    if (asset && !asset.trashed) counts[assetAvailability(disk, catalog, asset)] += 1
  }
  const unavailable = counts.offline + counts.unreadable + counts.absent + counts.retired
  const worst: AssetAvailability =
    counts.retired > 0 ? "retired" : counts.offline > 0 ? "offline" : counts.unreadable > 0 ? "unreadable" : counts.absent > 0 ? "absent" : "available"
  return { state: unavailable === 0 ? "available" : worst, unavailable, total: session.assetIds.length }
}

/** Why a member cannot be read now. */
export type UnavailableState = Exclude<AssetAvailability, "available">

const PREVIEW_UNAVAILABLE: Record<UnavailableState, MessageRef> = {
  retired: msg("domain_preview_retired"),
  offline: msg("domain_preview_offline"),
  unreadable: msg("domain_preview_unreadable"),
  absent: msg("domain_preview_absent"),
}

/**
 * Why the current frame's preview cannot be drawn. A retired copy reads
 * Retired, never "not found": it is never read again or offered as an input (D11, LIB-FR-15).
 */
export function previewUnavailableReason(state: UnavailableState): MessageRef {
  return PREVIEW_UNAVAILABLE[state]
}

export interface RunSummary extends MembershipSummary {
  /** Included frames with no available copy right now: last-observed, not verified. */
  includedUnavailable: number
  /** The same frames by why they cannot be read, for naming them ("208 Offline", "208 Retired"). */
  includedUnavailableBy: Array<{ state: UnavailableState; frames: number }>
  /** Excluded members whose library quality is Unusable (they start excluded, VSEL-FR-15); `unusable` counts included ones. */
  excludedUnusable: number
  rejected: number
  /** Sessions with unresolved or unavailable members, for naming them; `locationId` holds the copies in that state. */
  unavailableSessions: Array<{ session: Session; members: number; state: UnavailableState; locationId: LocationId | null }>
}

export function runSummary(disk: Disk, catalog: Catalog, content: MembershipContent): RunSummary {
  const base = membershipSummary(catalog, content)
  let includedUnavailable = 0
  const byState = new Map<UnavailableState, number>()
  const bySession = new Map<SessionId, { members: number; state: UnavailableState; locationId: LocationId | null }>()
  for (const id of [...content.included, ...content.unresolved]) {
    const asset = catalog.assets[id]
    if (!asset) continue
    const state = assetAvailability(disk, catalog, asset)
    if (state === "available") continue
    if (content.included.includes(id)) {
      includedUnavailable += 1
      byState.set(state, (byState.get(state) ?? 0) + 1)
    }
    if (!asset.sessionId) continue
    const locationId = asset.copies.find((copy) => copyAvailability(disk, catalog, copy) === state)?.locationId ?? null
    const entry = bySession.get(asset.sessionId) ?? { members: 0, state, locationId }
    entry.members += 1
    bySession.set(asset.sessionId, entry)
  }
  const unavailableSessions = [...bySession.entries()]
    .map(([id, entry]) => ({ session: catalog.sessions[id], ...entry }))
    .filter((e): e is { session: Session; members: number; state: UnavailableState; locationId: LocationId | null } => e.session !== undefined)
  const excludedUnusable = content.excluded.filter((id) => catalog.assets[id]?.quality.value === "unusable").length
  const includedUnavailableBy = [...byState.entries()].map(([state, frames]) => ({ state, frames }))
  return { ...base, includedUnavailable, includedUnavailableBy, excludedUnusable, rejected: content.rejected.length, unavailableSessions }
}

export function totalsLine(frames: number, seconds: number) {
  return `${frames} / ${formatDuration(seconds)}`
}

export interface MemberSession {
  session: Session
  /** Included frame identities of this session. */
  included: AssetId[]
  /** Run-scoped exclusions of this session. */
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

/**
 * A metric at one precision per unit, so values in a column line up and
 * compare (tabular figures): widths and ratios at two decimals ("8.70″",
 * "0.43"), star counts and background as whole numbers.
 */
export function formatMetricFixed(m: Messages, metric: Pick<Metric, "value" | "unit">): string {
  if (metric.value === null) return "–"
  if (metric.unit === "stars") return m.measure_value_stars({ value: Math.round(metric.value).toLocaleString("en-GB") })
  if (metric.unit === "ADU") return `${Math.round(metric.value).toLocaleString("en-GB")} ADU`
  const value = metric.value.toFixed(2)
  if (metric.unit === "arcsec") return `${value}″`
  return metric.unit === "ratio" || metric.unit === "" ? value : `${value} ${metric.unit}`
}
