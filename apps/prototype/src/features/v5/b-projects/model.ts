/**
 * Slice B derivations over the shared store and types: the Wrap up trash
 * offers (PRJ-FR-14, PRJ-FR-15, STO-FR-14 to STO-FR-16), the archive and
 * restore transfer plans (STO-FR-13, P-ARC1), the copy each frame keeps
 * (D-W74), goal gaps for planning and the goal channels a Project's rigs can
 * capture. Pure: nothing here writes state. Every OS Trash refusal is the
 * shared `trashRefusal`; the offers and plans stay here because only the
 * Project screens read them.
 */
import { fileAt, fileKey, freeBytes, trashRefusal } from "@/domain/disk"
import {
  archiveDestination,
  formatHours,
  goalProgress,
  liveAssetIds,
  projectCandidates,
  projectGroups,
  projectMemberSessionIds,
  projectRuns,
  rigCameraKind,
  sessionNamingValues,
  sessionTargetId,
} from "@/domain/derive"
import { isUnder } from "@/domain/indexing"
import { qualityApplicability } from "@/domain/library"
import { GOAL_CHANNELS, NARROW_BANDS } from "@/domain/labels"
import { namingTemplate, resolveNamingTemplate } from "@/domain/templates"
import type { Asset, AssetCopy, AssetId, Catalog, Disk, GoalChannel, Location, Operation, OpticalTrainId, Project, ResultId, Session, SessionId, Subject, Volume } from "@/domain/types"
import { formatBytes, formatCount, formatNight } from "@/lib/format"
import { joinRefs, m, type MessageRef, msg, say, verbatim } from "@/lib/i18n"
import type { PrototypeState } from "@/store/core"
import type { TrashItem } from "@/store/actions/trash"

// ---------------------------------------------------------------------------
// Copies and custody
// ---------------------------------------------------------------------------

/** Library storage keeps its copy; archived frames live in the archive location after Archive (STO-FR-13). */
const LIBRARY_ROLES = new Set<Location["role"]>(["captures", "calibration", "archive"])

/**
 * The copy a frame keeps (D-W74): a copy in Captures or Calibration library
 * storage, else the earliest-registered location; among equals, the copy
 * indexed first. Only byte-identical copies take part.
 */
export function keptCopy(catalog: Catalog, asset: Asset): AssetCopy | null {
  const identical = asset.copies.filter((c) => c.sha256 === asset.sha256)
  if (identical.length === 0) return null
  const rank = (copy: AssetCopy) => {
    const location = catalog.locations[copy.locationId]
    return { library: location && LIBRARY_ROLES.has(location.role) ? 0 : 1, registered: location?.registeredAt ?? "9999" }
  }
  return [...identical].sort((a, b) => {
    const ra = rank(a)
    const rb = rank(b)
    return ra.library - rb.library || ra.registered.localeCompare(rb.registered) || identical.indexOf(a) - identical.indexOf(b)
  })[0]!
}

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

// ---------------------------------------------------------------------------
// Frames of a Project
// ---------------------------------------------------------------------------

/** Sessions whose frames the Project's offers consider: candidates plus members of its runs outside the Trash. */
function projectSessions(catalog: Catalog, project: Project): Session[] {
  const ids = new Set<SessionId>(projectCandidates(catalog, project).map((c) => c.session.id))
  for (const id of projectMemberSessionIds(catalog, project.id)) ids.add(id)
  return [...ids].map((id) => catalog.sessions[id]).filter((s): s is Session => s !== undefined)
}

function frameLabel(catalog: Catalog, asset: Asset): string {
  const session = asset.sessionId ? catalog.sessions[asset.sessionId] : undefined
  return session ? `${formatNight(session.night)} · ${session.channel ?? m.palette_session_no_filter()}` : m.review_no_session()
}

// ---------------------------------------------------------------------------
// Wrap up trash offers
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
  reason: string
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
}

type OfferCount = { count: number; n: string; size: string }

/** The offer's title: "Move 5 rejected frames to Trash (1.2 GB)", or its "none left" form. */
const OFFER_TITLE: Record<OfferKind, { some: (count: OfferCount) => string; none: () => string }> = {
  "rejected-frames": { some: (c) => m.wrapup_offer_rejected(c), none: () => m.wrapup_offer_rejected_none() },
  intermediates: { some: (c) => m.wrapup_offer_intermediates(c), none: () => m.wrapup_offer_intermediates_none() },
  "duplicate-copies": { some: (c) => m.wrapup_offer_duplicates(c), none: () => m.wrapup_offer_duplicates_none() },
}

function offer(kind: OfferKind, disk: Disk, entries: OfferEntry[], refusals: OfferRefusal[], items: TrashItem[]): TrashOffer {
  const sizeBytes = reclaimBytes(
    disk,
    items.map((i) => i.path),
  )
  const title = entries.length === 0 ? OFFER_TITLE[kind].none() : OFFER_TITLE[kind].some({ count: entries.length, n: formatCount(entries.length), size: formatBytes(sizeBytes) })
  return { kind, title, count: entries.length, sizeBytes, entries, refusals, items }
}

/** Frames in a prepared revision of a run that is not Complete, in any Project, with that run's name. */
function preparedInOpenRuns(catalog: Catalog): Map<AssetId, string> {
  const out = new Map<AssetId, string>()
  for (const prep of Object.values(catalog.preparations)) {
    const run = catalog.runs[prep.runId]
    if (!run || run.completion === "complete") continue
    const project = catalog.projects[run.projectId]
    const named = project ? `${run.name} (${project.name})` : run.name
    const where = run.trashedAt ? m.wrapup_where_in_trash({ where: named }) : named
    for (const id of prep.preparedAssetIds) if (!out.has(id)) out.set(id, where)
  }
  return out
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
 * "Move N rejected frames to Trash" (D-W43, PRJ-FR-15): the Project's
 * candidate frames whose applicable library quality is Unusable. Project-only
 * rejects, ChangedContent and Trashed frames never enter. Every copy moves,
 * and one refused copy refuses the frame (D-W57).
 */
export function rejectedFramesOffer(state: PrototypeState, project: Project): TrashOffer {
  const { catalog, disk } = state
  const prepared = preparedInOpenRuns(catalog)
  const inputs = resultInputs(catalog)
  const moving = sessionsInTransfer(state.operations)
  const entries: OfferEntry[] = []
  const refusals: OfferRefusal[] = []
  const items: TrashItem[] = []
  const seen = new Set<AssetId>()
  for (const candidate of projectCandidates(catalog, project)) {
    for (const id of liveAssetIds(catalog, candidate.session)) {
      const asset = catalog.assets[id]
      if (!asset || seen.has(id) || asset.quality.value !== "unusable" || qualityApplicability(asset) !== "applicable") continue
      seen.add(id)
      const label = asset.fileName
      const path = asset.copies[0]?.path ?? ""
      const refuse = (reason: string) => refusals.push({ key: id, label, path, reason })
      const preparedIn = prepared.get(id)
      if (preparedIn) {
        refuse(m.wrapup_refusal_in_open_run({ where: preparedIn }))
        continue
      }
      const input = inputs.get(id)
      if (input) {
        refuse(m.wrapup_refusal_result_input({ name: input }))
        continue
      }
      if (asset.sessionId && moving.has(asset.sessionId)) {
        refuse(m.wrapup_refusal_archive_moving())
        continue
      }
      const outside = asset.copies.find((c) => catalog.locations[c.locationId]?.role !== "captures")
      if (outside) {
        refuse(m.wrapup_refusal_outside_captures())
        continue
      }
      const copyRefusal = asset.copies.map((c) => trashRefusal(disk, c.path)).find((r) => r !== null)
      if (copyRefusal) {
        refuse(copyRefusal)
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
  }
  return offer("rejected-frames", disk, entries, refusals, items)
}

/**
 * "Move N processing intermediates to Trash" (D-W70, STO-FR-16): recognized
 * intermediates in the Results of the Project's runs and run groups, plus an
 * adopted master's generated source as a verified duplicate naming the kept
 * library copy. Accepted Results and library masters are never offered.
 */
export function intermediatesOffer(state: PrototypeState, project: Project): TrashOffer {
  const { catalog, disk } = state
  const runIds = new Set(projectRuns(catalog, project.id).map((r) => r.id))
  const groupIds = new Set(projectGroups(catalog, project.id).map((g) => g.id))
  const entries: OfferEntry[] = []
  const refusals: OfferRefusal[] = []
  const items: TrashItem[] = []
  const seen = new Set<string>()
  for (const result of Object.values(catalog.results)) {
    if (result.trashed || !result.intermediate || result.acceptance === "accepted") continue
    if (!(result.runId ? runIds.has(result.runId) : result.groupId !== null && groupIds.has(result.groupId))) continue
    seen.add(result.path)
    const label = result.path.split("/").at(-1) ?? result.path
    const owner = result.runId ? catalog.runs[result.runId]?.name : result.groupId ? catalog.runGroups[result.groupId]?.name : undefined
    const reason = trashRefusal(disk, result.path)
    if (reason) {
      refusals.push({ key: result.id, label, path: result.path, reason })
      continue
    }
    entries.push({ key: result.id, label, path: result.path, detail: owner ? m.wrapup_intermediate_of({ name: owner }) : m.wrapup_intermediate(), sizeBytes: fileAt(disk, result.path)?.sizeBytes ?? 0 })
    items.push({ path: result.path, resultId: result.id as ResultId })
  }
  for (const master of Object.values(catalog.masters)) {
    if (master.origin.kind !== "generated" || !master.origin.runId || !runIds.has(master.origin.runId) || master.state !== "adopted" || !master.adoption) continue
    const path = master.origin.sourcePath
    if (seen.has(path) || path === master.adoption.destinationPath) continue
    const label = path.split("/").at(-1) ?? path
    const kept = fileAt(disk, master.adoption.destinationPath)
    const reason = !kept || kept.sha256 !== master.adoption.verifiedSha256 ? m.wrapup_refusal_kept_unverifiable({ path: master.adoption.destinationPath }) : trashRefusal(disk, path)
    if (reason) {
      refusals.push({ key: master.id, label, path, reason })
      continue
    }
    entries.push({ key: master.id, label, path, detail: m.wrapup_master_source_duplicate({ path: master.adoption.destinationPath }), sizeBytes: fileAt(disk, path)?.sizeBytes ?? 0 })
    items.push({ path })
  }
  return offer("intermediates", disk, entries, refusals, items)
}

/**
 * "Move N duplicate copies to Trash" (D-W74): byte-identical extra copies of
 * the Project's frames. Each frame keeps one copy (`keptCopy`); its record,
 * quality and memberships stay.
 */
export function duplicatesOffer(state: PrototypeState, project: Project): TrashOffer {
  const { catalog, disk } = state
  const moving = sessionsInTransfer(state.operations)
  const linkedBy = new Map<string, string>()
  for (const prep of Object.values(catalog.preparations)) {
    const run = catalog.runs[prep.runId]
    if (!run || run.completion === "complete") continue
    // A Direct-source run reads its frames where they are; a linked run points at one copy of each.
    const used =
      prep.mode === "direct-source"
        ? prep.preparedAssetIds.flatMap((id) => catalog.assets[id]?.copies.map((c) => c.path) ?? [])
        : Object.values(disk.files).flatMap((f) => (f.linkTarget && isUnder(f.path, prep.folderPath) ? [f.linkTarget] : []))
    for (const path of used) if (!linkedBy.has(path)) linkedBy.set(path, run.name)
  }
  const entries: OfferEntry[] = []
  const refusals: OfferRefusal[] = []
  const items: TrashItem[] = []
  for (const session of projectSessions(catalog, project)) {
    for (const id of liveAssetIds(catalog, session)) {
      const asset = catalog.assets[id]
      if (!asset || asset.copies.length < 2) continue
      const kept = keptCopy(catalog, asset)
      if (!kept) continue
      const keptName = catalog.locations[kept.locationId]?.displayName ?? kept.path
      for (const copy of asset.copies) {
        if (copy === kept || copy.sha256 !== asset.sha256) continue
        const key = `${id}|${copy.path}`
        const label = m.wrapup_copy_on({ name: asset.fileName, location: catalog.locations[copy.locationId]?.displayName ?? m.wrapup_unknown_location() })
        const reason =
          linkedBy.has(copy.path) && copy.path !== kept.path
            ? m.wrapup_refusal_linked_source({ name: linkedBy.get(copy.path) ?? "" })
            : moving.has(session.id)
              ? m.wrapup_refusal_archive_moving()
              : trashRefusal(disk, kept.path)
                ? m.wrapup_refusal_kept_copy_unverified({ name: keptName })
                : trashRefusal(disk, copy.path)
        if (reason) {
          refusals.push({ key, label, path: copy.path, reason })
          continue
        }
        entries.push({ key, label, path: copy.path, detail: m.wrapup_keeps_copy_on({ name: keptName, path: kept.path }), sizeBytes: asset.sizeBytes })
        items.push({ path: copy.path, assetId: id })
      }
    }
  }
  return offer("duplicate-copies", disk, entries, refusals, items)
}

export function trashOffers(state: PrototypeState, project: Project): Record<OfferKind, TrashOffer> {
  return {
    "rejected-frames": rejectedFramesOffer(state, project),
    intermediates: intermediatesOffer(state, project),
    "duplicate-copies": duplicatesOffer(state, project),
  }
}

// ---------------------------------------------------------------------------
// Archive and restore (D-W26, D-W46, D-W69, STO-FR-13)
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
  refused: Array<{ session: Session; reason: string }>
  sizeBytes: number
  /** A reason that refuses the whole archive, e.g. no archive location. */
  blocked: string | null
}

/** "NGC 7000 · 18 Sep · Ha": the session's target (or object), night and channel. */
export function sessionRef(catalog: Catalog, session: Session): MessageRef {
  const targetId = sessionTargetId(session)
  const target = (targetId ? catalog.targets[targetId]?.name : null) ?? session.objectLabel
  return joinRefs([typeof target === "string" ? verbatim(target) : msg("session_no_target"), verbatim(formatNight(session.night)), typeof session.channel === "string" ? verbatim(session.channel) : msg("palette_session_no_filter")], " · ")
}

export function sessionLabel(catalog: Catalog, session: Session): string {
  return say(m, sessionRef(catalog, session))
}

function joinPath(...parts: string[]): string {
  return parts
    .map((p, i) => (i === 0 ? p.replace(/\/+$/, "") : p.replace(/^\/+|\/+$/g, "")))
    .filter((p) => p !== "")
    .join("/")
}

/** The session's folder under a location, laid out by the light naming template (STO-IMP-FR-07). */
function templatedFolder(state: PrototypeState, root: string, session: Session): string {
  const { path } = resolveNamingTemplate(namingTemplate(state.settings.naming, "light"), sessionNamingValues(state.catalog, session, "light"))
  return joinPath(root, path)
}

function sourceCopy(catalog: Catalog, asset: Asset): AssetCopy | null {
  return keptCopy(catalog, asset) ?? asset.copies[0] ?? null
}

/** Checks shared by archive and restore: the source is readable and nothing else sits at the destination. */
function moveRefusal(state: PrototypeState, move: ArchiveMove): string | null {
  const source = state.disk.volumes[move.from.volumeId]
  if (!source?.mounted) return m.run_cleanup_volume_offline({ name: source?.name ?? m.wrapup_its_volume() })
  if (!state.disk.files[fileKey(move.from.volumeId, move.from.path)]) return m.wrapup_refusal_not_found({ path: move.from.path })
  if (state.disk.files[fileKey(move.to.volumeId, move.to.path)]) return m.wrapup_refusal_file_exists({ path: move.to.path })
  return null
}

function planOver(state: PrototypeState, sessions: Session[], destinationFor: (session: Session, asset: Asset) => CopyRef | null, destination: Location | null, blocked: string | null): Omit<ArchivePlan, "kept"> {
  const { catalog, disk } = state
  const volume = destination ? (disk.volumes[destination.volumeId] ?? null) : null
  const rows: ArchiveRow[] = []
  const refused: ArchivePlan["refused"] = []
  for (const session of sessions) {
    const moves: ArchiveMove[] = []
    let reason: string | null = null
    for (const id of liveAssetIds(catalog, session)) {
      const asset = catalog.assets[id]
      const copy = asset ? sourceCopy(catalog, asset) : null
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
  if (!block && volume && !volume.mounted) block = m.wrapup_refusal_not_mounted({ name: volume.name })
  if (!block && volume && !volume.writable) block = m.wrapup_refusal_not_writable({ name: volume.name })
  if (!block && volume && sizeBytes > free) block = m.wrapup_refusal_space({ name: volume.name, free: formatBytes(free), size: formatBytes(sizeBytes) })
  return { destination, volume, freeBytes: free, rows, refused, sizeBytes, blocked: block }
}

/**
 * Archive of a Project at Wrap up (STO-FR-13, P-ARC1): its member sessions
 * transfer to the chosen archive location (the Project's own, else the
 * Default) along the naming template. A session that a run in another
 * Project not marked Done uses stays and is listed as kept (D-W46); being
 * another Project's candidate does not count.
 */
export function archivePlan(state: PrototypeState, project: Project, destinationId?: string | null): ArchivePlan {
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
    destination ? null : m.wrapup_no_archive_location(),
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
export function restorePlan(state: PrototypeState, project: Project, origins: ArchiveOrigins, sessionIds: SessionId[]): ArchivePlan {
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
  return { ...plan, kept: [], blocked: plan.rows.length === 0 && plan.refused.length === 0 ? m.project_nothing_to_restore() : null }
}

// ---------------------------------------------------------------------------
// Goals, channels and planning gaps
// ---------------------------------------------------------------------------

/** Goal channels a rig captures, as `goalChannel` reads them (D-W29, D-W31): a single band, "OSC" or "Dual-band". */
export function rigChannels(catalog: Catalog, rigId: OpticalTrainId): GoalChannel[] {
  const rig = catalog.opticalTrains[rigId]
  if (!rig) return []
  const osc = rigCameraKind(catalog, rig) === "osc"
  const out = new Set<GoalChannel>(osc ? ["OSC"] : [])
  for (const filter of rig.filters) {
    if (filter.bands.filter((b) => NARROW_BANDS.includes(b)).length >= 2) out.add("Dual-band")
    else if (!osc && filter.bands.length === 1) out.add(filter.bands[0]!)
  }
  return GOAL_CHANNELS.filter((c) => out.has(c))
}

/** Channels the Project's rigs capture, in chip order. */
export function projectChannels(catalog: Catalog, rigIds: OpticalTrainId[]): GoalChannel[] {
  const out = new Set(rigIds.flatMap((id) => rigChannels(catalog, id)))
  return GOAL_CHANNELS.filter((c) => out.has(c))
}

export interface GoalGap {
  channel: string
  panelId: string | null
  /** "Ha 3h50 to go in project · 0h45 to go captured". */
  line: string
  /** The pill's words: "Ha 3h50" (still to go in project), or the met line. */
  short: string
  met: boolean
}

/** What each integration goal of a subject still needs, labelled in project / captured (D-W36). */
export function subjectGaps(catalog: Catalog, project: Project, subject: Subject): GoalGap[] {
  return goalProgress(catalog, project)
    .filter((p) => p.goal.subjectId === subject.id && p.goal.integrationS !== null)
    .map((p) => {
      const goal = p.goal.integrationS!
      const inProject = Math.max(0, goal - p.inProject.seconds)
      const captured = Math.max(0, goal - p.captured.seconds)
      const short = `${p.goal.channel} ${formatHours(inProject)}`
      return {
        channel: p.goal.channel,
        panelId: p.goal.panelId,
        met: p.met,
        line: p.met ? m.goal_gap_met({ channel: p.goal.channel }) : m.goal_gap_line({ channel: p.goal.channel, project: formatHours(inProject), captured: formatHours(captured) }),
        short: p.met ? m.goal_gap_met({ channel: p.goal.channel }) : short,
      }
    })
}
