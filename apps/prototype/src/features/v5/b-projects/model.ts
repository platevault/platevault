/**
 * Slice B derivations over the shared store and types (P5 owns this file;
 * the P5↔P6 interface). What only the Project screens read:
 * - Wrap up's Trash offers of a Project (PRJ-FR-14, PRJ-FR-15, STO-FR-14 to
 *   STO-FR-16): the library-Unusable frames of its sessions, the processing
 *   intermediates of its runs, and the duplicate copies of its frames, each
 *   the shared `TrashOffer` (domain/archive.ts). The copy each frame keeps
 *   (D-W74) is the shared `keptCopy`, and every OS Trash refusal the shared
 *   `trashBlock` (P-TRASH2).
 * - The Project's Wrap up as the Next rule reads it (`wrapUpOf`).
 * - The goal channels a Project's rigs capture, and what applying a goal
 *   template changes.
 * Pure: nothing here writes state.
 */
import { kindsLine } from "@/components/domain/goal-fields"
import { sessionsInTransfer, type OfferEntry, type OfferKind, type OfferRefusal, type TrashOffer, trashOffer, unusableFramesOffer } from "@/domain/archive"
import { fileAt, trashRefusal } from "@/domain/disk"
import { liveAssetIds, projectCandidates, projectGroups, projectMemberSessionIds, projectRuns, type ProjectWrapUp, rigCameraKind, rigFilters, type World, wrapUpFlowState } from "@/domain/derive"
import { GOAL_CHANNELS, NARROW_BANDS, WRAP_UP_NAME } from "@/domain/labels"
import { keptCopy, runViewLinks, type TrashBlock, trashBlock, type TrashItem } from "@/domain/storage"
import { BUILT_IN_GOAL_TEMPLATES } from "@/domain/templates"
import type { Catalog, GoalChannel, GoalTemplate, OpticalTrainId, Project, ResultId, Session, SessionId } from "@/domain/types"
import { m, type Messages, msg } from "@/lib/i18n"
import { goalsFromTemplate } from "@/store/actions/projects"

// ---------------------------------------------------------------------------
// Frames of a Project
// ---------------------------------------------------------------------------

/** Sessions whose frames the Project's offers consider: candidates plus members of its runs outside the Trash. */
function projectSessions(catalog: Catalog, project: Project): Session[] {
  const ids = new Set<SessionId>(projectCandidates(catalog, project).map((c) => c.session.id))
  for (const id of projectMemberSessionIds(catalog, project.id)) ids.add(id)
  return [...ids].map((id) => catalog.sessions[id]).filter((s): s is Session => s !== undefined)
}

// ---------------------------------------------------------------------------
// Wrap up trash offers
// ---------------------------------------------------------------------------

type OfferWorld = Pick<World, "catalog" | "disk" | "operations">

/** Wrap up's rejected-frames offer: the library-Unusable frames of the Project's sessions (candidates and run members, as duplicates read them). */
export function rejectedFramesOffer(state: OfferWorld, project: Project): TrashOffer {
  return unusableFramesOffer(
    state,
    projectSessions(state.catalog, project).flatMap((session) => liveAssetIds(state.catalog, session)),
  )
}

/**
 * "Move N processing intermediates to Trash" (D-W70, STO-FR-16): recognized
 * intermediates in the Results of the Project's runs and run groups, plus an
 * adopted master's generated source as a verified duplicate naming the kept
 * library copy. Accepted Results and library masters are never offered.
 */
export function intermediatesOffer(state: OfferWorld, project: Project): TrashOffer {
  const { catalog, disk } = state
  const runIds = new Set(projectRuns(catalog, project.id).map((r) => r.id))
  const groupIds = new Set(projectGroups(catalog, project.id).map((g) => g.id))
  const links = runViewLinks(catalog, disk)
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
    const block = trashBlock(disk, links, result.path)
    if (block) {
      refusals.push({ key: result.id, label, path: result.path, ...block })
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
    const block = !kept || kept.sha256 !== master.adoption.verifiedSha256 ? { reason: msg("wrapup_refusal_kept_unverifiable", { path: master.adoption.destinationPath }) } : trashBlock(disk, links, path)
    if (block) {
      refusals.push({ key: master.id, label, path, ...block })
      continue
    }
    entries.push({ key: master.id, label, path, detail: m.wrapup_master_source_duplicate({ path: master.adoption.destinationPath }), sizeBytes: fileAt(disk, path)?.sizeBytes ?? 0 })
    items.push({ path })
  }
  return trashOffer("intermediates", disk, links, entries, refusals, items)
}

/**
 * "Move N duplicate copies to Trash" (D-W74): byte-identical extra copies of
 * the Project's frames. Each frame keeps one copy (`keptCopy`); its record,
 * quality and memberships stay.
 */
export function duplicatesOffer(state: OfferWorld, project: Project): TrashOffer {
  const { catalog, disk } = state
  const moving = sessionsInTransfer(state.operations)
  const links = runViewLinks(catalog, disk)
  const entries: OfferEntry[] = []
  const refusals: OfferRefusal[] = []
  const items: TrashItem[] = []
  for (const session of projectSessions(catalog, project)) {
    for (const id of liveAssetIds(catalog, session)) {
      const asset = catalog.assets[id]
      if (!asset || asset.copies.length < 2) continue
      const kept = keptCopy(catalog, disk, asset)
      if (!kept) continue
      const keptName = catalog.locations[kept.locationId]?.displayName ?? kept.path
      for (const copy of asset.copies) {
        if (copy === kept || copy.sha256 !== asset.sha256) continue
        const key = `${id}|${copy.path}`
        const label = m.wrapup_copy_on({ name: asset.fileName, location: catalog.locations[copy.locationId]?.displayName ?? m.wrapup_unknown_location() })
        const block: TrashBlock | null = moving.has(session.id)
          ? { reason: msg("wrapup_refusal_archive_moving") }
          : trashRefusal(disk, kept.path)
            ? { reason: msg("wrapup_refusal_kept_copy_unverified", { name: keptName }) }
            : trashBlock(disk, links, copy.path)
        if (block) {
          refusals.push({ key, label, path: copy.path, ...block })
          continue
        }
        entries.push({ key, label, path: copy.path, detail: m.wrapup_keeps_copy_on({ name: keptName, path: kept.path }), sizeBytes: asset.sizeBytes })
        items.push({ path: copy.path, assetId: id })
      }
    }
  }
  return trashOffer("duplicate-copies", disk, links, entries, refusals, items)
}

/** The order Wrap up lists its trash offers in. */
export const OFFER_KINDS: OfferKind[] = ["rejected-frames", "intermediates", "duplicate-copies"]

export function trashOffers(state: OfferWorld, project: Project): Record<OfferKind, TrashOffer> {
  return {
    "rejected-frames": rejectedFramesOffer(state, project),
    intermediates: intermediatesOffer(state, project),
    "duplicate-copies": duplicatesOffer(state, project),
  }
}

/** The paths one offered entry hands to the OS Trash: every copy of a frame (they move together), or the one file. */
export function entryItems(offer: TrashOffer, entry: OfferEntry): TrashItem[] {
  return offer.items.filter((item) => (item.assetId !== undefined && item.assetId === entry.key) || item.path === entry.path)
}

// ---------------------------------------------------------------------------
// Wrap up as the Next rule reads it
// ---------------------------------------------------------------------------

/** The Project's Wrap up from its flow (`wrapUpFlowState`): what the Projects list, Home and the Next rule read. */
export function wrapUpOf(state: World, project: Project): ProjectWrapUp {
  const flow = wrapUpFlowState(state, project)
  return {
    available: flow.available && !flow.closed,
    waitingOn: flow.waitingOn,
    steps: flow.steps.map((step) => ({
      id: step.id,
      label: WRAP_UP_NAME[step.id],
      state: step.state === "finished" ? "done" : step.state === "skipped" ? "skipped" : "todo",
      at: project.wrapUp[step.id]?.at ?? null,
    })),
    current: flow.closed ? null : flow.current,
  }
}

// ---------------------------------------------------------------------------
// Goals and channels
// ---------------------------------------------------------------------------

/** Goal channels a rig captures, as `goalChannel` reads them (D-W29, D-W31): a single band, "OSC" or "Dual-band". */
export function rigChannels(catalog: Catalog, rigId: OpticalTrainId): GoalChannel[] {
  const rig = catalog.opticalTrains[rigId]
  if (!rig) return []
  const osc = rigCameraKind(catalog, rig) === "osc"
  const out = new Set<GoalChannel>(osc ? ["OSC"] : [])
  for (const filter of rigFilters(catalog, rig)) {
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

/** The built-in goal templates, then the user's. */
export function goalTemplates(catalog: Catalog): GoalTemplate[] {
  return [...BUILT_IN_GOAL_TEMPLATES, ...Object.values(catalog.goalTemplates)]
}

/**
 * What applying a template changes, one line per channel and change: "5 h →
 * 10 h · 4 goals", "New: 10 h · 2 goals", "Removed: 120 frames". Unchanged
 * goals are not listed (B: the preview shows the goal changes only).
 */
export function templateChanges(msgs: Messages, project: Project, template: GoalTemplate): Array<{ label: GoalChannel; value: string }> {
  const key = (g: { subjectId: string; panelId: string | null; channel: string }) => `${g.subjectId}|${g.panelId ?? ""}|${g.channel}`
  const next = project.subjects.flatMap((subject) => goalsFromTemplate(template, subject))
  const before = new Map(project.goals.map((g) => [key(g), g]))
  const after = new Map(next.map((g) => [key(g), g]))
  const counts = new Map<string, { channel: GoalChannel; line: string; count: number }>()
  const bump = (channel: GoalChannel, line: string) => {
    const id = `${channel}\u0000${line}`
    const found = counts.get(id)
    counts.set(id, { channel, line, count: (found?.count ?? 0) + 1 })
  }
  for (const [k, goal] of after) {
    const old = before.get(k)
    if (!old) bump(goal.channel, msgs.goal_change_new({ line: kindsLine(msgs, goal) }))
    else if (kindsLine(msgs, old) !== kindsLine(msgs, goal)) bump(goal.channel, msgs.goal_change_from_to({ from: kindsLine(msgs, old), to: kindsLine(msgs, goal) }))
  }
  for (const [k, goal] of before) if (!after.has(k)) bump(goal.channel, msgs.goal_change_removed({ line: kindsLine(msgs, goal) }))
  return [...counts.values()].map(({ channel, line, count }) => ({ label: channel, value: count > 1 ? `${line} · ${msgs.project_goals_count({ count })}` : line }))
}
