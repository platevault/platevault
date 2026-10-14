/**
 * Archive plans and the Unusable-frames Trash offer (STO-FR-13, P-ARC1,
 * PRJ-FR-15, D-W43, D-W57), shared by Wrap up and Sessions. Pure: nothing
 * here writes state; the transfer itself starts in `store/actions/archive.ts`.
 * Every OS Trash refusal is the shared `trashBlock` (the disk, then run views
 * linking the file, P-TRASH2). Lifted verbatim from features/v5/b-projects/model.ts,
 * taking `World` in place of `PrototypeState` so the domain stays store-free.
 */
import { fileAt, fileKey, freeBytes } from "./disk"
import { archiveDestination, defaultArchiveLocation, liveAssetIds, projectMemberSessionIds, sessionNamingValues, type StepLink, type World } from "./derive"
import { qualityApplicability } from "./library"
import { keptCopy, keptViewLinks, runViewLinks, type RunViewLinks, type TrashBlock, trashBlock, type TrashItem } from "./storage"
import { namingTemplate, resolveNamingTemplate } from "./templates"
import type { Asset, AssetCopy, AssetId, Catalog, Disk, Location, Operation, Project, Session, SessionId, Volume } from "./types"
import { formatBytes, formatCount, formatNight } from "@/lib/format"
import { m, type MessageRef, msg } from "@/lib/i18n"

// ---------------------------------------------------------------------------
// Copies and custody
// ---------------------------------------------------------------------------

/** Bytes a move reclaims: each inode once, and none while another hard link outside the move holds it (STO-FR-14). */
export function reclaimBytes(disk: Disk, paths: string[]): number {
  const moving = new Set<string>()
  const files = paths.map((p) => fileAt(disk, p)).filter((f) => f !== undefined)
  for (const file of files) moving.add(fileKey(file.volumeId, file.path))
  const holders = new Map<string, number>()
  for (const file of Object.values(disk.files)) {
    if (file.linkTarget) continue
    const key = `${file.volumeId}:${file.inode}`
    if (!moving.has(fileKey(file.volumeId, file.path))) holders.set(key, (holders.get(key) ?? 0) + 1)
  }
  const seen = new Set<string>()
  let bytes = 0
  for (const file of files) {
    const key = `${file.volumeId}:${file.inode}`
    if (file.linkTarget || seen.has(key) || holders.has(key)) continue
    seen.add(key)
    bytes += file.sizeBytes
  }
  return bytes
}

/** Sessions a running archive or restore transfer is moving (STO: refused by Move to Trash until it settles). */
export function sessionsInTransfer(operations: Record<string, Operation>): Set<SessionId> {
  const out = new Set<SessionId>()
  for (const op of Object.values(operations)) {
    if (op.kind !== "archive" || (op.status !== "running" && op.status !== "paused")) continue
    for (const item of op.items) if (item.status === "pending" || item.status === "running") out.add(item.id)
  }
  return out
}

function frameLabel(catalog: Catalog, asset: Asset): string {
  const session = asset.sessionId ? catalog.sessions[asset.sessionId] : undefined
  return session ? `${formatNight(session.night)} · ${session.channel ?? m.palette_session_no_filter()}` : m.review_no_session()
}

// ---------------------------------------------------------------------------
// Trash offers
// ---------------------------------------------------------------------------

export type OfferKind = "rejected-frames" | "intermediates" | "duplicate-copies"

export interface OfferEntry {
  key: string
  label: string
  path: string
  detail: string | null
  sizeBytes: number
}

export interface OfferRefusal {
  key: string
  label: string
  path: string | null
  reason: MessageRef
  /** Where the refusal can be resolved: the run whose view links the item (P-TRASH2). */
  link?: StepLink
}

export interface TrashOffer {
  kind: OfferKind
  /** "Move 5 rejected frames to Trash (1.2 GB)". */
  title: string
  count: number
  sizeBytes: number
  entries: OfferEntry[]
  refusals: OfferRefusal[]
  /** What the approval hands to the OS Trash engine. */
  items: TrashItem[]
  /** Links in kept run views that leave with the items (P-TRASH2). */
  keptLinks: number
}

type OfferCount = { count: number; n: string; size: string }

/** The offer's title: "Move 5 rejected frames to Trash (1.2 GB)", or its "none left" form. */
const OFFER_TITLE: Record<OfferKind, { some: (count: OfferCount) => string; none: () => string }> = {
  "rejected-frames": { some: (c) => m.wrapup_offer_rejected(c), none: () => m.wrapup_offer_rejected_none() },
  intermediates: { some: (c) => m.wrapup_offer_intermediates(c), none: () => m.wrapup_offer_intermediates_none() },
  "duplicate-copies": { some: (c) => m.wrapup_offer_duplicates(c), none: () => m.wrapup_offer_duplicates_none() },
}

/** A Trash offer of `kind` over its entries and items: its title, the bytes it reclaims and the kept-view links that leave with it. */
export function trashOffer(kind: OfferKind, disk: Disk, links: RunViewLinks, entries: OfferEntry[], refusals: OfferRefusal[], items: TrashItem[]): TrashOffer {
  const paths = items.map((i) => i.path)
  const sizeBytes = reclaimBytes(disk, paths)
  const title = entries.length === 0 ? OFFER_TITLE[kind].none() : OFFER_TITLE[kind].some({ count: entries.length, n: formatCount(entries.length), size: formatBytes(sizeBytes) })
  return { kind, title, count: entries.length, sizeBytes, entries, refusals, items, keptLinks: keptViewLinks(links, paths).length }
}

/** Frames recorded as inputs of a Result: the prepared revision a tool-recorded Result came from. */
function resultInputs(catalog: Catalog): Map<AssetId, string> {
  const out = new Map<AssetId, string>()
  for (const result of Object.values(catalog.results)) {
    if (result.trashed || result.lineage !== "tool-recorded" || !result.runId) continue
    const prep = Object.values(catalog.preparations).find((p) => p.runId === result.runId && p.prepRevision === result.fromPrepRevision)
    const name = result.path.split("/").at(-1) ?? result.path
    for (const id of prep?.preparedAssetIds ?? []) if (!out.has(id)) out.set(id, name)
  }
  return out
}

/**
 * "Move N Unusable frames to Trash" (D-W43, PRJ-FR-15, round 6): of the
 * given frames, those whose applicable library quality is Unusable.
 * Project-only rejects, ChangedContent and Trashed frames never enter. Every
 * copy moves, and one refused copy refuses the frame (D-W57). Wrap up offers
 * the Project's frames; Sessions' Unusable filter offers any.
 */
export function unusableFramesOffer(state: Pick<World, "catalog" | "disk" | "operations">, assetIds: Iterable<AssetId>): TrashOffer {
  const { catalog, disk } = state
  const links = runViewLinks(catalog, disk)
  const inputs = resultInputs(catalog)
  const moving = sessionsInTransfer(state.operations)
  const entries: OfferEntry[] = []
  const refusals: OfferRefusal[] = []
  const items: TrashItem[] = []
  const seen = new Set<AssetId>()
  for (const id of assetIds) {
    const asset = catalog.assets[id]
    if (!asset || asset.trashed || seen.has(id) || asset.quality.value !== "unusable" || qualityApplicability(asset) !== "applicable") continue
    seen.add(id)
    const label = asset.fileName
    const path = asset.copies[0]?.path ?? ""
    const refuse = (block: TrashBlock) => refusals.push({ key: id, label, path, ...block })
    const input = inputs.get(id)
    if (input) {
      refuse({ reason: msg("wrapup_refusal_result_input", { name: input }) })
      continue
    }
    if (asset.sessionId && moving.has(asset.sessionId)) {
      refuse({ reason: msg("wrapup_refusal_archive_moving") })
      continue
    }
    const outside = asset.copies.find((c) => catalog.locations[c.locationId]?.role !== "captures")
    if (outside) {
      refuse({ reason: msg("wrapup_refusal_outside_captures") })
      continue
    }
    const copyBlock = asset.copies.map((c) => trashBlock(disk, links, c.path)).find((b) => b !== null)
    if (copyBlock) {
      refuse(copyBlock)
      continue
    }
    entries.push({
      key: id,
      label,
      path,
      detail: asset.copies.length > 1 ? `${frameLabel(catalog, asset)} · ${m.wrapup_copies({ count: asset.copies.length })}` : frameLabel(catalog, asset),
      sizeBytes: asset.sizeBytes,
    })
    for (const copy of asset.copies) items.push({ path: copy.path, assetId: id })
  }
  return trashOffer("rejected-frames", disk, links, entries, refusals, items)
}

// ---------------------------------------------------------------------------
// Archive (D-W26, D-W46, STO-FR-13)
// ---------------------------------------------------------------------------

export interface CopyRef {
  locationId: string
  volumeId: string
  path: string
}

export interface ArchiveMove {
  assetId: AssetId
  from: CopyRef
  to: CopyRef
  sizeBytes: number
}

export interface ArchiveRow {
  session: Session
  moves: ArchiveMove[]
  sizeBytes: number
  /** Destination folder of the session's frames. */
  folder: string
}

export interface ArchivePlan {
  destination: Location | null
  volume: Volume | null
  freeBytes: number
  rows: ArchiveRow[]
  /** Kept because a run in another Project not marked Done uses them (D-W46). */
  kept: Array<{ session: Session; projects: string[] }>
  refused: Array<{ session: Session; reason: MessageRef }>
  sizeBytes: number
  /** A reason that refuses the whole archive, e.g. no archive location. */
  blocked: MessageRef | null
}

function joinPath(...parts: string[]): string {
  return parts
    .map((p, i) => (i === 0 ? p.replace(/\/+$/, "") : p.replace(/^\/+|\/+$/g, "")))
    .filter((p) => p !== "")
    .join("/")
}

/** The session's folder under a location, laid out by the light naming template (STO-IMP-FR-07). */
function templatedFolder(state: World, root: string, session: Session): string {
  const { path } = resolveNamingTemplate(namingTemplate(state.settings.naming, "light"), sessionNamingValues(state.catalog, session, "light"), state.settings.namingOmit)
  return joinPath(root, path)
}

function sourceCopy(catalog: Catalog, disk: Disk, asset: Asset): AssetCopy | null {
  return keptCopy(catalog, disk, asset) ?? asset.copies[0] ?? null
}

/** Checks shared by archive and restore: the source is readable and nothing else sits at the destination. */
function moveRefusal(state: World, move: ArchiveMove): MessageRef | null {
  const source = state.disk.volumes[move.from.volumeId]
  if (!source?.mounted) return msg("run_cleanup_volume_offline", { name: source?.name ?? msg("wrapup_its_volume") })
  if (!state.disk.files[fileKey(move.from.volumeId, move.from.path)]) return msg("wrapup_refusal_not_found", { path: move.from.path })
  if (state.disk.files[fileKey(move.to.volumeId, move.to.path)]) return msg("wrapup_refusal_file_exists", { path: move.to.path })
  return null
}

function planOver(state: World, sessions: Session[], destinationFor: (session: Session, asset: Asset) => CopyRef | null, destination: Location | null, blocked: MessageRef | null): Omit<ArchivePlan, "kept"> {
  const { catalog, disk } = state
  const volume = destination ? (disk.volumes[destination.volumeId] ?? null) : null
  const rows: ArchiveRow[] = []
  const refused: ArchivePlan["refused"] = []
  for (const session of sessions) {
    const moves: ArchiveMove[] = []
    let reason: MessageRef | null = null
    for (const id of liveAssetIds(catalog, session)) {
      const asset = catalog.assets[id]
      const copy = asset ? sourceCopy(catalog, disk, asset) : null
      if (!asset || !copy) continue
      const to = destinationFor(session, asset)
      if (!to) continue
      if (to.path === copy.path && to.volumeId === copy.volumeId) continue
      const move: ArchiveMove = { assetId: id, from: { locationId: copy.locationId, volumeId: copy.volumeId, path: copy.path }, to, sizeBytes: asset.sizeBytes }
      reason ??= moveRefusal(state, move)
      moves.push(move)
    }
    if (reason) refused.push({ session, reason })
    else if (moves.length > 0) rows.push({ session, moves, sizeBytes: moves.reduce((n, m) => n + m.sizeBytes, 0), folder: moves[0]!.to.path.split("/").slice(0, -1).join("/") })
  }
  const sizeBytes = rows.reduce((n, r) => n + r.sizeBytes, 0)
  const free = volume ? freeBytes(disk, volume.id) : 0
  let block = blocked
  if (!block && volume && !volume.mounted) block = msg("wrapup_refusal_not_mounted", { name: volume.name })
  if (!block && volume && !volume.writable) block = msg("wrapup_refusal_not_writable", { name: volume.name })
  if (!block && volume && sizeBytes > free) block = msg("wrapup_refusal_space", { name: volume.name, free: formatBytes(free), size: formatBytes(sizeBytes) })
  return { destination, volume, freeBytes: free, rows, refused, sizeBytes, blocked: block }
}

/**
 * Archive… from Sessions (round 6): sessions in no Project transfer to the
 * Default archive location along the naming template, the same reviewed
 * transfer as Wrap up's. The caller offers only sessions in no Project.
 */
export function sessionsArchivePlan(state: World, sessions: Session[]): ArchivePlan {
  const destination = defaultArchiveLocation(state)
  const plan = planOver(
    state,
    [...sessions].sort((a, b) => a.night.localeCompare(b.night)),
    (session, asset) => (destination ? { locationId: destination.id, volumeId: destination.volumeId, path: joinPath(templatedFolder(state, destination.path, session), asset.fileName) } : null),
    destination,
    destination ? null : msg("wrapup_no_archive_location"),
  )
  return { ...plan, kept: [] }
}

/**
 * Archive of a Project at Wrap up (STO-FR-13, P-ARC1): its member sessions
 * transfer to the chosen archive location (the Project's own, else the
 * Default) along the naming template. A session that a run in another
 * Project not marked Done uses stays and is listed as kept (D-W46); being
 * another Project's candidate does not count.
 */
export function archivePlan(state: World, project: Project, destinationId?: string | null): ArchivePlan {
  const { catalog } = state
  const archived = new Set(project.archive?.sessionIds ?? [])
  const usedElsewhere = new Map<SessionId, string[]>()
  for (const other of Object.values(catalog.projects)) {
    if (other.id === project.id || other.state === "done") continue
    for (const id of projectMemberSessionIds(catalog, other.id)) usedElsewhere.set(id, [...(usedElsewhere.get(id) ?? []), other.name])
  }
  const members = [...projectMemberSessionIds(catalog, project.id)]
    .map((id) => catalog.sessions[id])
    .filter((s): s is Session => s !== undefined && !archived.has(s.id))
    .sort((a, b) => a.night.localeCompare(b.night))
  const kept = members.filter((s) => usedElsewhere.has(s.id)).map((session) => ({ session, projects: usedElsewhere.get(session.id)! }))
  const chosen = destinationId ? catalog.locations[destinationId] : undefined
  const destination = chosen && chosen.role === "archive" && !chosen.retiredAt ? chosen : archiveDestination(state, project)
  const plan = planOver(
    state,
    members.filter((s) => !usedElsewhere.has(s.id)),
    (session, asset) => (destination ? { locationId: destination.id, volumeId: destination.volumeId, path: joinPath(templatedFolder(state, destination.path, session), asset.fileName) } : null),
    destination,
    destination ? null : msg("wrapup_no_archive_location"),
  )
  return { ...plan, kept }
}

/** Where each archived frame came from, recorded by the archive transfer so Restore puts it back. */
export type ArchiveOrigins = Record<AssetId, CopyRef>

/**
 * Restore archived sessions of a Reopened Project (D-W69, STO-AC-22): a
 * reviewed transfer back to where Archive found them; a frame without a
 * recorded origin goes to the first Captures location along the template.
 */
export function restorePlan(state: World, project: Project, origins: ArchiveOrigins, sessionIds: SessionId[]): ArchivePlan {
  const { catalog } = state
  const captures = Object.values(catalog.locations).find((l) => l.role === "captures" && !l.retiredAt) ?? null
  const sessions = sessionIds.map((id) => catalog.sessions[id]).filter((s): s is Session => s !== undefined && (project.archive?.sessionIds ?? []).includes(s.id))
  const plan = planOver(
    state,
    sessions,
    (session, asset) =>
      origins[asset.id] ?? (captures ? { locationId: captures.id, volumeId: captures.volumeId, path: joinPath(templatedFolder(state, captures.path, session), asset.fileName) } : null),
    captures,
    null,
  )
  // Restore writes back to each origin's own volume; the free-space check above uses the Captures fallback only.
  return { ...plan, kept: [], blocked: plan.rows.length === 0 && plan.refused.length === 0 ? msg("project_nothing_to_restore") : null }
}
