/**
 * Words Home, Sessions, intake and Import share for library values. No
 * English crosses IPC: each code is worded from the catalogue here, and a
 * library `detail` string is a log diagnostic, never shown.
 */
import type {
  CaptureLayout,
  ImportBlock,
  ImportItem,
  ImportItemPhase,
  ImportDuplicate,
  ReasonCode,
  LayoutMarker,
  NamingFrameType,
  PinState_Serialize,
  RemovableDevice,
  Session,
  SessionAdmission_Serialize,
  SessionReadiness,
} from "@/api/ipc"
import { formatExposure, formatList, formatNight } from "@/lib/format"
import type { Messages } from "@/lib/i18n"

/** The night, filter and exposure a capture key names, each null when the key doesn't name it. */
export function keyParts(key: string): { night: string | null; filter: string | null; exposure: number | null } {
  const part = (name: string) => key.split("|").find((p) => p.startsWith(`${name}=`))?.slice(name.length + 1) ?? null
  const night = part("night")?.match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? null
  const filter = part("filter")
  const exposure = Number(part("exposure_s"))
  return { night, filter: filter && filter !== "?" ? filter : null, exposure: Number.isFinite(exposure) && part("exposure_s") ? exposure : null }
}

/** "18 Sep · Ha · 300 s · framing 2": what a session's capture key and framing say; a dash for an unnamed night. */
export function sessionLabel(m: Messages, session: Session): string {
  const { night, filter, exposure } = keyParts(session.key)
  const nightText = night ? formatNight(night) : "–"
  const ordinal = session.framing?.ordinal ?? 1
  return [
    filter ? `${nightText} · ${filter}` : m.domain_session_no_filter({ night: nightText }),
    ...(exposure !== null ? [formatExposure(exposure)] : []),
    ...(session.framing?.label ? [session.framing.label] : ordinal > 1 ? [m.domain_session_framing({ n: ordinal })] : []),
  ].join(" · ")
}

/** Where a session's intake stands, as the library's admission says: the step it still needs, else Ready. */
export function admissionReadiness(admission: SessionAdmission_Serialize): SessionReadiness {
  for (const blocker of admission.blockers) if (blocker.blocker === "not_ready") return blocker.readiness
  return "ready"
}

// Removable devices (STO-IMP-FR-10) ---------------------------------------------

/** The capture application a device's layout is named by; proper nouns, the same in every language. */
const LAYOUT_NAME: Record<CaptureLayout, (m: Messages) => string> = {
  asiair: (m) => m.import_layout_asiair(),
  nina: (m) => m.import_layout_nina(),
  sharpcap: (m) => m.import_layout_sharpcap(),
  ekos: (m) => m.import_layout_ekos(),
  sgp: (m) => m.import_layout_sgp(),
  voyager: (m) => m.import_layout_voyager(),
}

const MARKER_NAME: Record<LayoutMarker, (m: Messages) => string> = {
  autorun_folder: (m) => m.import_marker_autorun(),
  plan_folder: (m) => m.import_marker_plan(),
  live_folder: (m) => m.import_marker_live(),
  light_folder: (m) => m.import_marker_light(),
  flat_folder: (m) => m.import_marker_flat(),
  dark_folder: (m) => m.import_marker_dark(),
  bias_folder: (m) => m.import_marker_bias(),
  darkflat_folder: (m) => m.import_marker_darkflat(),
  sharpcap_captures_folder: (m) => m.domain_device_evidence_sharpcap(),
  camera_settings_files: (m) => m.import_marker_camera_settings(),
  ekos_sequence_files: (m) => m.import_marker_ekos_sequence(),
  ekos_schedule_files: (m) => m.import_marker_ekos_schedule(),
  ekos_frame_names: (m) => m.import_marker_ekos_names(),
  sgp_sequence_files: (m) => m.import_marker_sgp_sequence(),
  voyager_frame_names: (m) => m.import_marker_voyager_names(),
}

/** What a device reads as: its recognised layout ("ASIAIR"), or "USB device" when no rule recognised one. */
export function deviceKind(m: Messages, device: RemovableDevice): string {
  return device.layout ? LAYOUT_NAME[device.layout.layout](m) : m.import_usb_device()
}

/** The note naming every marker of the layout found on the device, in the library's order (STO-IMP-AC-14); null for a generic device. */
export function deviceNote(m: Messages, device: RemovableDevice): string | null {
  if (!device.layout) return null
  return m.import_device_found({ markers: formatList(device.layout.matched.map((marker) => MARKER_NAME[marker](m))) })
}

// Import items ---------------------------------------------------------------

export function frameTypeText(m: Messages, type: NamingFrameType | null): string {
  switch (type) {
    case "light":
      return m.import_type_light()
    case "flat":
      return m.import_type_flat()
    case "dark":
      return m.import_type_dark()
    case "bias":
      return m.import_type_bias()
    case "master_flat":
      return m.import_type_master_flat()
    case "master_dark":
      return m.import_type_master_dark()
    case "master_bias":
      return m.calibration_caption_bias()
    case null:
      return m.import_type_unclassified()
  }
}

/** The type an item imports as: the user's, else the header's. */
export function itemType(item: ImportItem): NamingFrameType | null {
  return item.userType ?? item.classification
}

export function phaseText(m: Messages, phase: ImportItemPhase): string {
  const words: Record<ImportItemPhase, () => string> = {
    ready: m.import_phase_ready,
    unclassified: m.import_type_unclassified,
    settling: m.import_phase_settling,
    duplicate: m.import_skipped,
    blocked: m.import_held,
    excluded: m.import_phase_excluded,
    pending: m.status_pending,
    landed: m.import_phase_landed,
    copied: m.import_phase_copied,
    moved: m.import_phase_moved,
    source_kept: m.import_phase_source_kept,
    failed: m.status_failed,
    uncertain: m.status_uncertain,
  }
  return words[phase]()
}

/** Why an item is held: worded from the block's kind, never from its diagnostic `detail`. */
export function blockText(m: Messages, block: ImportBlock, locationName: (id: string) => string): string {
  switch (block.kind) {
    case "missing_role":
      return block.role === "captures" ? m.import_no_captures_location() : block.role === "calibration" ? m.import_no_calibration_location() : m.import_no_results_location()
    case "location_not_chosen":
      return m.import_block_choose_location()
    case "destination_unwritable":
      return m.import_no_write_permission({ name: locationName(block.locationId) })
    case "collision":
      return m.import_name_taken_detail()
    case "collides_with_item":
      return m.import_block_same_destination()
    case "naming":
      return m.import_block_naming()
    case "unreadable":
      return m.import_block_unreadable()
    case "source_missing":
      return m.import_block_source_missing()
    case "duplicate_unproven":
      return m.import_block_duplicate_unproven()
  }
}

// Calibration ----------------------------------------------------------------

/** One kind's pin as a short state: pinned, suggested, waiting or No. */
export function pinText(m: Messages, kind: string, pin: PinState_Serialize): string {
  switch (pin.state) {
    case "pinned":
      return m.calibration_summary_pinned({ kind })
    case "suggested":
      return m.calibration_summary_suggested({ kind })
    case "unresolved":
      return m.calibration_summary_waiting({ kind })
    case "declined":
      return m.calibration_summary_declined({ kind })
  }
}

/** Why one item didn't finish, from its stable code; the reason's `detail` is a log diagnostic. */
export function reasonText(m: Messages, code: ReasonCode): string {
  const words: Record<ReasonCode, () => string> = {
    trash_unsupported: m.import_reason_trash_unsupported,
    trash_failed: m.import_reason_trash_failed,
    source_drift: m.import_reason_source_drift,
    source_unavailable: m.import_reason_source_unavailable,
    kept_copy_unproven: m.import_reason_kept_copy_unproven,
    destination_occupied: m.import_reason_destination_occupied,
    destination_mismatch: m.import_reason_destination_mismatch,
    destination_changed: m.import_reason_destination_changed,
    write_failed: m.import_reason_write_failed,
    interrupted: m.import_reason_interrupted,
    protected: m.import_reason_protected,
  }
  return words[code]()
}

/** What a skipped duplicate matches. */
export function duplicateText(m: Messages, duplicate: ImportDuplicate): string {
  switch (duplicate.kind) {
    case "indexed_frame":
      return m.import_match_sha()
    case "same_import":
      return m.import_duplicate_same_import({ path: duplicate.sourcePath.display })
    case "same_source":
      return m.import_skip_imported_detail()
    case "at_destination":
      return m.import_duplicate_at_destination()
  }
}
