/**
 * The Calibration library outside Projects (P-CAL2, P-CAL3; foundation-owned).
 * It holds masters only; runs are assigned masters only. Raw calibration
 * frames are input to a calibration process (`calibration-process.ts`).
 * Dismissed master offers stay listed so they can be restored. Nothing here
 * writes state.
 */
import type { CalibrationMaster, Catalog, MasterOffer, Run } from "./types"

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
