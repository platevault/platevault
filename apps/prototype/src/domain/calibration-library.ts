/**
 * The Calibration library outside Projects (P-CAL1, P-CAL2; foundation-owned).
 * Index and Import file calibration frames as calibration sessions (dark,
 * flat, bias and dark-flat groups); a Project only assigns them through run
 * calibration. A master is integrated from a calibration session by a tool
 * profile (`integrate-master` operation) and registered on finish. Dismissed
 * master offers stay listed so they can be restored. Nothing here writes state.
 */
import { type CalSource, KIND_LABEL, rawSetSource } from "./calibration"
import type { ApplicationProfile, CalibrationKind, CalibrationMaster, Catalog, MasterOffer, ProfileId, Run, Session, SessionId } from "./types"

const CALIBRATION_TYPES = new Set<string>(["dark", "flat", "bias", "dark-flat"])

export interface CalibrationSession {
  session: Session
  kind: CalibrationKind
  /** The raw set as a calibration input, as run calibration assigns it. */
  source: CalSource
  /** The master integrated from this session, if one is registered. */
  master: CalibrationMaster | null
}

/** Current calibration sessions (not superseded, frames outside the Trash), newest night first. */
export function calibrationSessions(catalog: Catalog): CalibrationSession[] {
  const byOrigin = new Map<SessionId, CalibrationMaster>()
  for (const master of Object.values(catalog.masters)) if (master.origin.sessionId) byOrigin.set(master.origin.sessionId, master)
  const out: CalibrationSession[] = []
  for (const session of Object.values(catalog.sessions)) {
    if (!CALIBRATION_TYPES.has(session.imageType) || session.supersededBy) continue
    const source = rawSetSource(catalog, session)
    if (!source) continue
    out.push({ session, kind: source.kind, source, master: byOrigin.get(session.id) ?? null })
  }
  return out.sort((a, b) => b.session.night.localeCompare(a.session.night) || KIND_LABEL[a.kind].localeCompare(KIND_LABEL[b.kind]))
}

/** Profiles that can integrate a master (Siril, PixInsight), configured or not. */
export function integrationProfiles(catalog: Catalog): ApplicationProfile[] {
  return Object.values(catalog.profiles).filter((p) => p.capability.masterIntegration)
}

/** Why Integrate master is refused for a session and profile; empty when it can start. */
export function integrateRefusals(catalog: Catalog, sessionId: SessionId, profileId: ProfileId | null, running: boolean): string[] {
  const reasons: string[] = []
  const session = catalog.sessions[sessionId]
  if (!session || !CALIBRATION_TYPES.has(session.imageType)) return ["not a calibration session"]
  if (running) reasons.push("already integrating")
  const profile = profileId ? catalog.profiles[profileId] : undefined
  if (!profile) reasons.push("no tool profile")
  else if (!profile.capability.masterIntegration) reasons.push(`${profile.name} cannot integrate masters`)
  else if (profile.executableState !== "found") reasons.push(`${profile.name} is not set up`)
  if (!rawSetSource(catalog, session)) reasons.push("no frames outside the Trash")
  return reasons
}

export interface DismissedOffer {
  run: Run
  offer: MasterOffer
  master: CalibrationMaster
}

/** Master offers the user dismissed (P-CAL2): the Calibration library's Dismissed filter, each with Restore offer. */
export function dismissedOffers(catalog: Catalog): DismissedOffer[] {
  const out: DismissedOffer[] = []
  for (const run of Object.values(catalog.runs)) {
    for (const offer of run.masterOffers) {
      const master = catalog.masters[offer.masterId]
      if (offer.state === "dismissed" && master) out.push({ run, offer, master })
    }
  }
  return out.sort((a, b) => b.offer.at.localeCompare(a.offer.at))
}
