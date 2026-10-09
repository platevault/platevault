/**
 * Calibration library view helpers (slice E), shared by the Calibration
 * library and Settings › Naming's preview. Nothing here writes state.
 */
import type { CalibrationMaster, Catalog } from "@/domain/types"

/** The observing night of a master: its raw session's, else the night in its stored name, else the day it was written. */
export function masterNight(catalog: Catalog, master: CalibrationMaster): string {
  const session = master.origin.sessionId ? catalog.sessions[master.origin.sessionId] : undefined
  return session?.night ?? /_(\d{4}-\d{2}-\d{2})\.[^./]+$/.exec(master.path)?.[1] ?? master.createdAt.slice(0, 10)
}
