/**
 * Calibration library view helpers (slice E), shared by the Calibration
 * library, its process pages and Settings › Naming's preview. Nothing here
 * writes state.
 */
import type { Tone } from "@/components/app/status"
import { KIND_NAME, newestVersion } from "@/domain/calibration"
import type { ProcessStatus } from "@/domain/calibration-process"
import { nightOf } from "@/domain/indexing"
import type { CalibrationMaster, Catalog, MasterVersion } from "@/domain/types"
import { formatExposure } from "@/lib/format"
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
