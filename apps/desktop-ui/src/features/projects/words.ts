/**
 * Words the Project tabs share for library values: paths, calibration
 * kinds, View modes and the reason codes an operation names per item. No
 * English crosses IPC: each code is worded from the catalogue, and an
 * `ItemReason.detail` is a log diagnostic, never shown.
 */
import type { InputKind, NativePathWire, ReasonCode, ViewMode } from "@/api/ipc"
import type { Messages } from "@/lib/i18n"

/** A native path as the OS shows it. */
export function pathText(path: NativePathWire): string {
  return path.display
}

export function kindText(m: Messages, kind: InputKind): string {
  return kind === "dark" ? m.calibration_kind_dark() : kind === "flat" ? m.calibration_kind_flat() : m.calibration_kind_bias()
}

export function modeText(m: Messages, mode: ViewMode): string {
  return mode === "symlinks" ? m.domain_mode_symlink() : m.session_column_copies()
}

const REASON: Record<ReasonCode, (m: Messages) => string> = {
  trash_unsupported: (m) => m.reason_trash_unsupported(),
  trash_failed: (m) => m.reason_trash_failed(),
  source_drift: (m) => m.reason_source_drift(),
  source_unavailable: (m) => m.reason_source_unavailable(),
  kept_copy_unproven: (m) => m.reason_kept_copy_unproven(),
  destination_occupied: (m) => m.reason_destination_occupied(),
  destination_mismatch: (m) => m.reason_destination_mismatch(),
  destination_changed: (m) => m.reason_destination_changed(),
  write_failed: (m) => m.reason_write_failed(),
  interrupted: (m) => m.reason_interrupted(),
  protected: (m) => m.reason_protected(),
}

/** Why one item stayed where it is, from its reason code. */
export function reasonText(m: Messages, code: ReasonCode): string {
  return REASON[code](m)
}
