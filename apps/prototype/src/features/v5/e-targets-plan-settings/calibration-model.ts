/**
 * Calibration library view helpers (slice E), shared by the Calibration
 * library and Settings › Naming's preview. Nothing here writes state.
 */
import { fileAt } from "@/domain/disk"
import type { CalibrationMaster, Catalog, Disk } from "@/domain/types"

/** The observing night of a master: its raw session's, else the night in its stored name, else the day it was written. */
export function masterNight(catalog: Catalog, master: CalibrationMaster): string {
  const session = master.origin.sessionId ? catalog.sessions[master.origin.sessionId] : undefined
  return session?.night ?? /_(\d{4}-\d{2}-\d{2})\.[^./]+$/.exec(master.path)?.[1] ?? master.createdAt.slice(0, 10)
}

/** The master's content digest: its library frame's, else the one verified at adoption, else the file's own; null when none is known. */
export function masterSha256(catalog: Catalog, disk: Disk, master: CalibrationMaster): string | null {
  const asset = Object.values(catalog.assets).find((a) => a.copies.some((c) => c.path === master.path))
  return asset?.sha256 ?? master.adoption?.verifiedSha256 ?? fileAt(disk, master.path)?.sha256 ?? null
}
