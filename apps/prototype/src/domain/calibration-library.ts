/**
 * Calibration library usage (CAL-FR-14, CAL-FR-16, CAL-FR-17): which light
 * sessions pin each master, and which Projects hold those sessions. Hide
 * and Move to Trash act on the whole master (every version) and are refused
 * while an open or Closed Project uses it through its sessions
 * (provisional); otherwise their confirmation lists the sessions it is
 * pinned on, which then need calibration again. Pure; the writes are in
 * `src/store/actions/calibration.ts`.
 */
import { PIN_KINDS } from "./calibration"
import type { Catalog, MasterId, MasterVersionId, PinKind, Project, Session } from "./types"

/** One pin of a master: the session, the kind and the version it pins. */
export interface MasterPin {
  session: Session
  kind: PinKind
  versionId: MasterVersionId
}

/** Every master's pins, by master id. Superseded sessions never count. */
export function masterPins(catalog: Catalog): Map<MasterId, MasterPin[]> {
  const out = new Map<MasterId, MasterPin[]>()
  for (const session of Object.values(catalog.sessions)) {
    if (session.supersededBy || !session.calibration) continue
    for (const kind of PIN_KINDS) {
      const choice = session.calibration[kind]
      if (choice.state !== "pinned" || choice.source.type !== "master") continue
      const list = out.get(choice.source.masterId) ?? []
      list.push({ session, kind, versionId: choice.source.versionId })
      out.set(choice.source.masterId, list)
    }
  }
  return out
}

/** The pins of one dated version: the version's own usage (CAL-FR-14). */
export function versionPins(pins: ReadonlyMap<MasterId, MasterPin[]>, masterId: MasterId, versionId: MasterVersionId): MasterPin[] {
  return (pins.get(masterId) ?? []).filter((p) => p.versionId === versionId)
}

/** Projects, open or Closed, that hold a session this master is pinned on, a Closed Project's frozen snapshot included: Hide and Move to Trash are refused while any exists, naming them (provisional CAL-FR-16/17). */
export function masterProjects(catalog: Catalog, pins: ReadonlyMap<MasterId, MasterPin[]>, masterId: MasterId): Project[] {
  const sessions = new Set((pins.get(masterId) ?? []).map((p) => p.session.id))
  return Object.values(catalog.projects).filter((project) => {
    if (project.inputs.some((i) => sessions.has(i.sessionId))) return true
    const frozen = project.snapshot?.calibration ?? {}
    return Object.values(frozen).some((cal) => PIN_KINDS.some((kind) => cal[kind].state === "pinned" && cal[kind].source.type === "master" && cal[kind].source.masterId === masterId))
  })
}
