/**
 * The frames of a Project's sessions (PRJ-FR-08, VSEL-FR-10, VSEL-FR-15)
 * and the session labels every list shares. Pure: no store access here; the
 * store actions write through `commit()`.
 *
 * A Project holds whole sessions (`ProjectInput`). Which of a session's
 * frames it uses is derived, never stored as a revision: Usable frames are
 * in; library-Unusable frames stay out unless the Project includes them
 * explicitly; the Project's own exclusions stay out; Trashed frames never
 * count; frames with no readable copy are named unresolved.
 */
import { correctedExposureS } from "./corrections"
import { assetAvailability, type AssetAvailability, copyAvailability, membershipSummary, type MembershipSummary, preferredCopy, qualityApplicability } from "./library"
import { fileKey } from "./disk"
import { pixelScaleArcsec } from "./sky"
import type { Asset, AssetId, Catalog, Disk, DiskFile, LocationId, Metric, ProjectInput, Session, SessionId } from "./types"
import { formatCount, formatDecimal, formatDuration, formatExposure } from "@/lib/format"
import { joinRefs, type MessageRef, type Messages, msg, nightRef, say, verbatim } from "@/lib/i18n"

// ---------------------------------------------------------------------------
// Input frames
// ---------------------------------------------------------------------------

/** Why a frame of a held session is out of the View, and who decided it (VSEL-FR-12 source labels). */
export type FrameOut = "project-excluded" | "library-rejected" | "trashed"

/** A held session's frames, sorted by what happens to them. */
export interface InputFrames {
  /** In the View: readable now. */
  included: AssetId[]
  /** In by the Project's choice or quality, but no copy is readable now: named, never silently dropped. */
  unresolved: AssetId[]
  /** Left out by the Project (`ProjectInput.excluded`). */
  excluded: AssetId[]
  /** Library-Unusable and not included by the Project: out, labelled as the Library's (VSEL-FR-15). */
  rejected: AssetId[]
  trashed: AssetId[]
}

/** Whether the library's decision keeps this frame out: Unusable, decided against its current bytes. */
function libraryRejects(asset: Asset): boolean {
  return asset.quality.value === "unusable" && qualityApplicability(asset) !== "changed-content"
}

/** Why a frame of a held session is out, or null when it is in (`included` or `unresolved`). */
export function frameOut(catalog: Catalog, input: Pick<ProjectInput, "excluded" | "included">, assetId: AssetId): FrameOut | null {
  const asset = catalog.assets[assetId]
  if (!asset || asset.trashed) return "trashed"
  if (input.excluded.includes(assetId)) return "project-excluded"
  if (libraryRejects(asset) && !input.included.includes(assetId)) return "library-rejected"
  return null
}

export function inputFrames(disk: Disk, catalog: Catalog, input: Pick<ProjectInput, "sessionId" | "excluded" | "included">): InputFrames {
  const out: InputFrames = { included: [], unresolved: [], excluded: [], rejected: [], trashed: [] }
  for (const id of catalog.sessions[input.sessionId]?.assetIds ?? []) {
    const why = frameOut(catalog, input, id)
    if (why === "trashed") out.trashed.push(id)
    else if (why === "project-excluded") out.excluded.push(id)
    else if (why === "library-rejected") out.rejected.push(id)
    else if (assetAvailability(disk, catalog, catalog.assets[id]!) === "available") out.included.push(id)
    else out.unresolved.push(id)
  }
  return out
}

/** Every held session's frames together; each frame once (a session is held once per Project). */
export function projectFrames(disk: Disk, catalog: Catalog, inputs: ReadonlyArray<Pick<ProjectInput, "sessionId" | "excluded" | "included">>): InputFrames {
  const out: InputFrames = { included: [], unresolved: [], excluded: [], rejected: [], trashed: [] }
  for (const input of inputs) {
    const frames = inputFrames(disk, catalog, input)
    out.included.push(...frames.included)
    out.unresolved.push(...frames.unresolved)
    out.excluded.push(...frames.excluded)
    out.rejected.push(...frames.rejected)
    out.trashed.push(...frames.trashed)
  }
  return out
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

/** " · framing 2" after a second or later framing of its night (D-W107), " · framing unknown" for the night's frames with no pointing split off as their own session; nothing for the first. */
function framingSuffix(session: Session): MessageRef[] {
  if (session.framing <= 1) return []
  return [session.pointing ? msg("domain_session_framing", { n: session.framing }) : msg("domain_session_framing_unknown")]
}

/** "18 Sep Ha"; "18 Sep no filter" without a filter; "18 Sep Ha · framing 2" for a second framing; the user's name instead once Edit… gave one. */
export function sessionRef(session: Session): MessageRef {
  if (session.name) return verbatim(session.name)
  const night = nightRef(session.night)
  const base = session.channel ? joinRefs([night, verbatim(session.channel)], " ") : msg("domain_session_no_filter", { night })
  return session.framing > 1 ? joinRefs([base, ...framingSuffix(session)], " · ") : base
}

export function sessionLabel(m: Messages, session: Session): string {
  return say(m, sessionRef(session))
}

/** "18 Sep · Ha · 300 s", the label calibration and View lists use; "· framing 2" follows a second framing; the user's name instead once Edit… gave one. */
export function sessionLongRef(session: Session): MessageRef {
  return session.name ? verbatim(session.name) : sessionDefaultRef(session)
}

/** The name a session has until the user gives it one (LIB-FR-04): "18 Sep · Ha · 300 s · framing 2". */
export function sessionDefaultRef(session: Session): MessageRef {
  const channel = session.channel ? verbatim(session.channel) : msg("palette_session_no_filter")
  return joinRefs([nightRef(session.night), channel, verbatim(formatExposure(sessionExposureS(session))), ...framingSuffix(session)], " · ")
}

export function sessionLongLabel(m: Messages, session: Session): string {
  return say(m, sessionLongRef(session))
}

/** The session's exposure as the catalog counts it: the latest correction, else the observed EXPTIME. */
export function sessionExposureS(session: Session): number {
  return correctedExposureS(session) ?? session.exposureS
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

/** Why a frame cannot be read now. */
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

export interface FramesSummary extends MembershipSummary {
  /** Unresolved frames by why they cannot be read, for naming them ("208 Offline", "208 Retired"). */
  unresolvedBy: Array<{ state: UnavailableState; frames: number }>
  /** Library-Unusable frames left out (they start out, VSEL-FR-15). */
  rejected: number
  /** Sessions with unresolved frames, for naming them; `locationId` holds the copies in that state. */
  unavailableSessions: Array<{ session: Session; frames: number; state: UnavailableState; locationId: LocationId | null }>
}

/** What a Project's frames add up to (VSEL-FR-08): included per channel, and what is out or unreadable and why. */
export function framesSummary(disk: Disk, catalog: Catalog, frames: InputFrames): FramesSummary {
  const base = membershipSummary(catalog, frames)
  const byState = new Map<UnavailableState, number>()
  const bySession = new Map<SessionId, { frames: number; state: UnavailableState; locationId: LocationId | null }>()
  for (const id of frames.unresolved) {
    const asset = catalog.assets[id]
    if (!asset) continue
    const state = assetAvailability(disk, catalog, asset)
    if (state === "available") continue
    byState.set(state, (byState.get(state) ?? 0) + 1)
    if (!asset.sessionId) continue
    const locationId = asset.copies.find((copy) => copyAvailability(disk, catalog, copy) === state)?.locationId ?? null
    const entry = bySession.get(asset.sessionId) ?? { frames: 0, state, locationId }
    entry.frames += 1
    bySession.set(asset.sessionId, entry)
  }
  const unavailableSessions = [...bySession.entries()]
    .map(([id, entry]) => ({ session: catalog.sessions[id], ...entry }))
    .filter((e): e is { session: Session; frames: number; state: UnavailableState; locationId: LocationId | null } => e.session !== undefined)
  return { ...base, unresolvedBy: [...byState.entries()].map(([state, count]) => ({ state, frames: count })), rejected: frames.rejected.length, unavailableSessions }
}

export function totalsLine(frames: number, seconds: number) {
  return `${frames} / ${formatDuration(seconds)}`
}

/** "12 frames", the count a pending change or a summary names. */
export function framesRef(count: number): MessageRef {
  return msg("project_frames_count", { count, n: { count } })
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
  if (metric.unit === "stars") return m.measure_value_stars({ value: formatCount(Math.round(metric.value)) })
  if (metric.unit === "ADU") return `${formatCount(Math.round(metric.value))} ADU`
  const value = formatDecimal(metric.value, 2)
  if (metric.unit === "arcsec") return `${value}″`
  return metric.unit === "ratio" || metric.unit === "" ? value : `${value} ${metric.unit}`
}
