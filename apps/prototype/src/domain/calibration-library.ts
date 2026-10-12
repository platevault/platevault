/**
 * The Calibration library outside Projects (P-CAL2, P-CAL3; foundation-owned).
 * It holds masters only; runs are assigned masters only. Raw calibration
 * frames are input to a calibration process (`calibration-process.ts`).
 * Dismiss is reversible (P-CAL2): a dismissed master, and a master offer a
 * run dismissed, stay listed under the library's Dismissed filter so they can
 * be restored. Nothing here writes state.
 */
import { calibrationPlan, inputKey } from "./calibration"
import { runSetup, savedContent, workingContent } from "./derive"
import type { CalibrationMaster, Catalog, Disk, IsoDateTime, MasterId, MasterOffer, Run } from "./types"

export interface MasterUse {
  run: Run
  /** Light sessions of the run this master calibrates. */
  sessions: number
}

/** Which runs hand off each master, keyed by master id: the library's Used by. */
export function masterUsage(catalog: Catalog, disk: Disk): Map<MasterId, MasterUse[]> {
  const out = new Map<MasterId, MasterUse[]>()
  for (const run of Object.values(catalog.runs)) {
    if (run.trashedAt) continue
    const plan = calibrationPlan(catalog, disk, run, runSetup(catalog, run).calibrationPolicy, savedContent(run) ?? workingContent(run))
    for (const row of plan.rows) {
      if (!row.input || (row.state !== "automatic" && row.state !== "accepted" && row.state !== "exception")) continue
      const key = inputKey(row.input)
      const list = out.get(key) ?? []
      const use = list.find((u) => u.run.id === run.id)
      if (use) use.sessions += row.members.length
      else list.push({ run, sessions: row.members.length })
      out.set(key, list)
    }
  }
  return out
}

/**
 * Runs that keep a master from being dismissed: they use it, or offer it on
 * their Calibrate step, where that offer is answered. A dismissed master is
 * never matched again, so dismissing one in use would pull it from a run.
 */
export function dismissBlockers(catalog: Catalog, usage: ReadonlyMap<MasterId, MasterUse[]>, masterId: MasterId): Run[] {
  const runs = new Map((usage.get(masterId) ?? []).map((u) => [u.run.id, u.run]))
  for (const run of Object.values(catalog.runs)) {
    if (!run.trashedAt && run.masterOffers.some((o) => o.masterId === masterId && o.state === "pending")) runs.set(run.id, run)
  }
  return [...runs.values()]
}

/** One row of the Dismissed filter: a master dismissed in the library, or a master offer a run dismissed. */
export type Dismissal = { kind: "master"; master: CalibrationMaster; at: IsoDateTime } | { kind: "offer"; master: CalibrationMaster; run: Run; offer: MasterOffer; at: IsoDateTime }

/** Every dismissal (P-CAL2), newest first: the Calibration library's Dismissed filter, each with Restore. */
export function dismissals(catalog: Catalog): Dismissal[] {
  const out: Dismissal[] = []
  for (const master of Object.values(catalog.masters)) {
    if (master.dismissedAt) out.push({ kind: "master", master, at: master.dismissedAt })
  }
  for (const run of Object.values(catalog.runs)) {
    for (const offer of run.masterOffers) {
      const master = catalog.masters[offer.masterId]
      if (offer.state === "dismissed" && master) out.push({ kind: "offer", master, run, offer, at: offer.at })
    }
  }
  return out.sort((a, b) => b.at.localeCompare(a.at))
}
