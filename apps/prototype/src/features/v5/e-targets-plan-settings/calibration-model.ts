/**
 * Calibration library view helpers (slice E), shared by the Calibration
 * library, its process pages, its dialogs and Settings › Naming's preview.
 * Nothing here writes state.
 */
import type { Tone } from "@/components/app/status"
import { type CalSource, camerasOfModel, KIND_NAME, KINDS, masterRecordRef, newestVersion, PIN_KINDS, rawSource } from "@/domain/calibration"
import { type ProcessStatus, type ProcessView, processForSession, processView } from "@/domain/calibration-process"
import type { World } from "@/domain/derive"
import { nightOf } from "@/domain/indexing"
import { generatedMasters, type ProcessingMaster } from "@/domain/project-view"
import type { CalibrationMaster, Camera, Catalog, Disk, MasterVersion, Project, Session, SessionId } from "@/domain/types"
import { formatExposure, formatNight } from "@/lib/format"
import { type MessageRef, type Messages, msg, say } from "@/lib/i18n"

/** The observing night of a master version: its raw session's, else the night of its capture time (CAL-FR-21). */
export function versionNight(catalog: Catalog, version: MasterVersion): string {
  const session = version.origin.sessionId ? catalog.sessions[version.origin.sessionId] : undefined
  return session?.night ?? nightOf(version.capturedAt)
}

/** The night of a master's newest version: what the library lists and sorts it by. Every master holds at least one version. */
export function masterNight(catalog: Catalog, master: CalibrationMaster): string {
  return versionNight(catalog, newestVersion(master)!)
}

/** "Dark 300 s · 2600MM #1", "Flat Ha · RedCat 51": what a master is, in one line, by its linked camera's alias where it has one. */
export function masterLabel(m: Messages, catalog: Catalog, master: CalibrationMaster): string {
  return say(m, masterRecordRef(catalog, master))
}

/** The camera a master belongs to as the library names it: the linked camera's alias, else the header's model. */
export function masterCamera(catalog: Catalog, master: Pick<CalibrationMaster, "cameraId" | "cameraName">): string | null {
  const linked = master.cameraId ? catalog.cameras[master.cameraId] : undefined
  return linked ? (linked.physicalAlias ?? linked.name) : master.cameraName
}

/** The library's masters: the kinds it lists (dark flats are never matched, CAL-FR-01), hidden ones apart (CAL-FR-16). */
export function libraryMasters(catalog: Catalog): { listed: CalibrationMaster[]; hidden: CalibrationMaster[] } {
  const masters = Object.values(catalog.masters).filter((master) => KINDS.includes(master.kind))
  return { listed: masters.filter((master) => !master.hiddenAt), hidden: masters.filter((master) => master.hiddenAt) }
}

/**
 * The cameras a master file of `model` may be linked to at import, when it
 * must be (LIB-FR-26): two or more cameras of that model in the rigs. Empty
 * when the model matches by itself.
 */
export function aliasChoices(catalog: Pick<Catalog, "cameras">, model: string | null): Camera[] {
  const cameras = camerasOfModel(catalog, model)
  return cameras.length > 1 ? cameras : []
}

/** One raw calibration set (CAL-FR-01, CAL-FR-04): a raw session as a source, its stacking process and the light sessions that pin it. */
export interface RawSet {
  session: Session
  source: CalSource
  process: ProcessView | null
  /** Light sessions with a pin on this raw set, once each. */
  pinnedOn: Session[]
}

/** Every raw dark, flat and bias set with live frames, newest night first. */
export function rawSets(catalog: Catalog, disk: Disk): RawSet[] {
  const pinnedOn = new Map<SessionId, Session[]>()
  for (const session of Object.values(catalog.sessions)) {
    if (session.supersededBy || !session.calibration) continue
    const raws = new Set(PIN_KINDS.flatMap((kind) => {
      const choice = session.calibration![kind]
      return choice.state === "pinned" && choice.source.type === "raw" ? [choice.source.sessionId] : []
    }))
    for (const raw of raws) pinnedOn.set(raw, [...(pinnedOn.get(raw) ?? []), session])
  }
  return Object.values(catalog.sessions)
    .flatMap((session): RawSet[] => {
      const source = rawSource(catalog, disk, session)
      if (!source) return []
      const process = processForSession(catalog, session.id)
      return [{ session, source, process: process ? processView(catalog, process) : null, pinnedOn: pinnedOn.get(session.id) ?? [] }]
    })
    .sort((a, b) => b.session.night.localeCompare(a.session.night))
}

/** "Flat Ha · 19 Sep", "Dark 300 s · 8 Sep", "Bias · 8 Sep": a raw set by its kind, filter or exposure, and night. */
export function rawSetName(m: Messages, set: Pick<RawSet, "session" | "source">): string {
  const kind = say(m, KIND_NAME[set.source.kind])
  const detail = set.source.kind === "flat" ? set.session.channel : set.source.kind === "dark" && set.source.exposureS !== null ? formatExposure(set.source.exposureS) : null
  return `${detail ? `${kind} ${detail}` : kind} · ${formatNight(set.session.night)}`
}

/** A generated master in a Project's `Processing/` folder that the library does not hold: a candidate Calibration lists (CAL-FR-06, CAL-AC-12). */
export interface MasterCandidate {
  project: Project
  master: ProcessingMaster
}

/** Every Project's candidates, offered on its Output step or hidden there; adopting one is still possible here. */
export function masterCandidates(world: Pick<World, "catalog" | "disk" | "settings">): MasterCandidate[] {
  return Object.values(world.catalog.projects).flatMap((project) => generatedMasters(world, project).map((master) => ({ project, master })))
}

/** A calibration process's state as a display tag: its word and tone. */
export const PROCESS_STATUS: Record<ProcessStatus, { tone: Tone; word: MessageRef }> = {
  "awaiting-stack": { tone: "info", word: msg("calibration_status_to_stack") },
  stacking: { tone: "info", word: msg("calibration_status_stacking") },
  importing: { tone: "info", word: msg("calibration_status_importing") },
  "trashing-raws": { tone: "info", word: msg("session_process_trashing") },
  failed: { tone: "danger", word: msg("status_failed") },
  done: { tone: "success", word: msg("status_done") },
}
