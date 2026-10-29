/**
 * The Targets area's library host for tests: realistic planning answers by
 * command, every call recorded with its arguments, so a test states what
 * the user sees and what each write sends.
 */
import type { PlanCriteria, TargetCandidate, TargetRow_Serialize, TargetsBasis_Serialize, TargetsPage_Serialize } from "@/api/ipc"

export const CRITERIA: PlanCriteria = { minAltitudeDeg: 30, darkness: "astronomical", moon: { kind: "none" }, minDurationMinutes: 60 }
export const SITE = { id: "site-1", name: "Backyard", revision: 2, latitudeDeg: 52.1, longitudeDeg: 5.1, elevationM: 10 }
export const NIGHT = "2026-10-29"

export function candidate(id: string, designation: string, over: Partial<TargetCandidate> = {}): TargetCandidate {
  return { id, designation, aliases: [], commonName: null, objectType: "Galaxy", coordinates: { raDeg: 10.68, decDeg: 41.27, frame: "icrs" }, provenance: { source: "seed", dataset: "messier" }, providerId: null, ...over }
}

export function row(target: TargetCandidate, over: Partial<TargetRow_Serialize> = {}): TargetRow_Serialize {
  return {
    target,
    saved: true,
    favourite: true,
    projects: [],
    maxAltitudeDeg: 71.4,
    lunarSeparationDeg: 88,
    imgTimeMinutes: 130,
    imgTimeZeroReason: null,
    bands: [
      { band: "L", viable: true },
      { band: "Ha", viable: true },
      { band: "OIII", viable: false },
    ],
    recommendation: "broadband_ok",
    nextOpposition: "2026-11-02",
    unknownReason: null,
    sessions: 3,
    captured: [{ channel: "L", seconds: 7200, frames: 24 }],
    fit: [],
    ...over,
  }
}

export const BASIS: TargetsBasis_Serialize = { site: SITE, timeZone: "Europe/Amsterdam", night: NIGHT, criteria: CRITERIA, method: "skymath" }

export function targetsPage(rows: TargetRow_Serialize[], over: Partial<TargetsPage_Serialize> = {}): TargetsPage_Serialize {
  return {
    basis: BASIS,
    moon: { illumination: 0.42, phase: "waxing_crescent", riseUtc: "2026-10-29T12:10:00Z", setUtc: "2026-10-29T21:40:00Z" },
    planningUnavailable: null,
    needsCatalogueOrPreset: false,
    total: rows.length,
    rows,
    rigs: [],
    bands: ["L", "R", "G", "B", "Ha", "SII", "OIII"],
    ...over,
  }
}

export type Answer = (args: Record<string, unknown>) => unknown
/** A failed command: the library's structured answer, which the generated client resolves as an error. */
export const refuse = (code: string, retry = "retry") => {
  throw { code, identity: null, scope: null, retry, currentRevision: null, successors: [], window: null, correction: null }
}

/** The library host: `answers` by command, then quiet defaults. A test installs `handler` with `mockIPC`. */
export function host(answers: Record<string, Answer> = {}) {
  const calls: { command: string; args: Record<string, unknown> }[] = []
  const handler = (command: string, args?: unknown): unknown => {
    const fields = (args ?? {}) as Record<string, unknown>
    if (command === "plugin:event|listen") return fields.handler
    if (command === "plugin:event|unlisten") return null
    calls.push({ command, args: fields })
    const answer = answers[command]
    if (answer) return answer(fields)
    switch (command) {
      case "library_issues":
        return { issues: [], dismissed: [], counts: { danger: 0, warning: 0, info: 0 }, pages: [] }
      case "planning_home_criteria":
        return { criteria: CRITERIA, revision: 3 }
      case "planning_list_sites":
        return { sites: [{ ...SITE, timeZone: "Europe/Amsterdam", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" }], defaultSiteId: SITE.id, settingsRevision: 5 }
      case "targets_presets_list":
        return { builtin: [{ preset: "best_tonight_broadband", name: "English name", definition: "English definition" }], saved: [] }
      case "library_list_equipment":
      case "library_list_locations":
      case "planning_target_gaps":
        return []
      case "planning_reminder_status":
        return { schedulerRunning: false, permission: { state: "not_determined" }, appClosedDelivery: { available: false, reason: "no_installed_scheduler" }, subscriptions: [], upcoming: [], deliveries: [] }
      default:
        return null
    }
  }
  return { handler, calls, sent: (command: string) => calls.filter((c) => c.command === command) }
}
