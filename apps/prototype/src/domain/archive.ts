/**
 * Archive plans and the Wrap up Trash offers (STO-FR-13, P-ARC1, PRJ-FR-15,
 * D-W43, D-W57), shared by Wrap up and Sessions. Pure: nothing here writes
 * state; the transfer itself starts in `store/actions/archive.ts`. Every OS
 * Trash refusal is the shared `trashBlock` (the disk, then the Views linking
 * the file, P-TRASH2). An Archive that moves originals a Closed Project's
 * kept View links repoints those links and records it (D-W111).
 */
import { fileAt, fileKey, freeBytes } from "./disk"
import { archiveDestination, defaultArchiveLocation, liveAssetIds, sessionNamingValues, type StepLink, type World } from "./derive"
import { qualityApplicability } from "./library"
import { keptCopy, keptViewLinks, type TrashBlock, trashBlock, type TrashItem, viewLinks, type ViewLinks } from "./storage"
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

/** Wrap up's offers (PRJ-FR-14, PRJ-FR-15): Clean up's View, then Trash's rejected frames, Processing files and duplicate copies. */
export type OfferKind = "view-cleanup" | "rejected-frames" | "processing-files" | "duplicate-copies"

export interface OfferEntry {
  key: string
  label: string
  path: string
  detail: string | null
  sizeBytes: number
  /** Ticked when the offer opens: Clean up ticks the View's copies and leaves its symlinks unticked (F1). */
  preselected: boolean
}

export interface OfferRefusal {
  key: string
  label: string
  path: string | null
  /** Where the refusal can be resolved: the Project whose View links the item (P-TRASH2). */
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
  /** Links in kept Views that leave with the items (P-TRASH2). */
  keptLinks: number
}

type OfferCount = { count: number; n: string; size: string }

/** The offer's title: "Move 5 rejected frames to Trash (1.2 GB)", or its "none left" form. */
const OFFER_TITLE: Record<OfferKind, { some: (count: OfferCount) => string; none: () => string }> = {
  "view-cleanup": { some: (c) => m.wrapup_offer_view(c), none: () => m.wrapup_offer_view_none() },
  "rejected-frames": { some: (c) => m.wrapup_offer_rejected(c), none: () => m.wrapup_offer_rejected_none() },
  "processing-files": { some: (c) => m.wrapup_offer_processing(c), none: () => m.wrapup_offer_processing_none() },
  "duplicate-copies": { some: (c) => m.wrapup_offer_duplicates(c), none: () => m.wrapup_offer_duplicates_none() },
}

/** A Trash offer of `kind` over its entries and items: its title, the bytes it reclaims and the kept-View links that leave with it. */
export function trashOffer(kind: OfferKind, disk: Disk, links: ViewLinks, entries: OfferEntry[], refusals: OfferRefusal[], items: TrashItem[]): TrashOffer {
  const paths = items.map((i) => i.path)
  const sizeBytes = reclaimBytes(disk, paths)
  const title = entries.length === 0 ? OFFER_TITLE[kind].none() : OFFER_TITLE[kind].some({ count: entries.length, n: formatCount(entries.length), size: formatBytes(sizeBytes) })
  return { kind, title, count: entries.length, sizeBytes, entries, refusals, items, keptLinks: keptViewLinks(links, paths).length }
}

/**
 * "Move N Unusable frames to Trash" (D-W43, PRJ-FR-15, round 6): of the
 * given frames, those whose applicable library quality is Unusable.
 * ChangedContent and Trashed frames never enter. Every copy moves, and one
 * refused copy refuses the frame (D-W57). Wrap up offers the Project's
 * frames; Sessions' Unusable filter offers any.
 */
export function unusableFramesOffer(state: Pick<World, "catalog" | "disk" | "operations">, assetIds: Iterable<AssetId>): TrashOffer {
  const { catalog, disk } = state
  const links = viewLinks(catalog, disk)
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
      preselected: true,
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
  /** Kept because another open Project holds them (D-W46, STO-FR-13); a suggestion does not count. */
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

/** Checks before a move: the source is readable and nothing else sits at the destination. */
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
 * Archive of a Project at Wrap up (STO-FR-13, P-ARC1): the sessions it
 * holds transfer to the chosen archive location (the Project's own, else
 * the Default) along the naming template. A session another open Project
 * holds stays and is listed as kept (D-W46); being another Project's
 * suggestion does not count, nor being held by a Closed one.
 */
export function archivePlan(state: World, project: Project, destinationId?: string | null): ArchivePlan {
  const { catalog } = state
  const archived = new Set(project.archive?.sessionIds ?? [])
  const usedElsewhere = new Map<SessionId, string[]>()
  for (const other of Object.values(catalog.projects)) {
    if (other.id === project.id || other.state !== "open") continue
    for (const input of other.inputs) usedElsewhere.set(input.sessionId, [...(usedElsewhere.get(input.sessionId) ?? []), other.name])
  }
  const members = project.inputs
    .map((input) => catalog.sessions[input.sessionId])
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
