/**
 * Calibration library view helpers (slice E), shared by the Calibration
 * library, its process pages and Settings › Naming's preview. Nothing here
 * writes state.
 */
import type { Tone } from "@/components/app/status"
import { KIND_NAME } from "@/domain/calibration"
import type { ProcessStatus } from "@/domain/calibration-process"
import { fileAt } from "@/domain/disk"
import type { CalibrationMaster, Catalog, Disk } from "@/domain/types"
import { formatExposure } from "@/lib/format"
import { type MessageRef, type Messages, msg, say } from "@/lib/i18n"

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

/** "Dark 120 s · ZWO ASI2600MM Pro", "Flat Ha · RedCat 51": what a master is, in one line. */
export function masterLabel(m: Messages, master: CalibrationMaster): string {
  const detail = master.kind === "flat" ? master.channel : master.kind === "bias" || master.exposureS === null ? null : formatExposure(master.exposureS)
  const kind = say(m, KIND_NAME[master.kind])
  return [detail ? `${kind} ${detail}` : kind, master.cameraName].filter(Boolean).join(" · ")
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
