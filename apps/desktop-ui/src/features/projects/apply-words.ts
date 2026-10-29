/**
 * The Apply sheet's and the View tab's words for the library's Apply values:
 * each blocker with the place it is resolved (D-W109: a change from the
 * Library or calibration links to where it is fixed), each way a build
 * stops, and each pending change with its source.
 */
import type { ApplyBlocker, ApplyStop, PendingChange_Serialize, ProjectOperationKind } from "@/api/ipc"
import type { Blocker, StepLink } from "@/components/app/contracts"
import type { Messages } from "@/lib/i18n"
import { kindText, modeText, pathText } from "./words"

const sessionLink = (sessionId: string): StepLink => ({ to: "/sessions/$sessionId", params: { sessionId } })
const LOCATIONS: StepLink = { to: "/settings/locations" }

export function operationText(m: Messages, kind: ProjectOperationKind): string {
  switch (kind) {
    case "apply":
      return m.project_apply()
    case "copy_to_output":
      return m.project_copy_to_output()
    case "clean_up":
      return m.wrapup_clean_up()
    case "trash":
      return m.wrapup_step_trash()
    case "archive":
      return m.wrapup_archive_title()
  }
}

/** One blocker as the sheet lists it, linked to where it is resolved; `sessionName` words a session id. */
export function applyBlocker(m: Messages, blocker: ApplyBlocker, sessionName: (id: string) => string, viewLink: StepLink): Blocker {
  switch (blocker.blocker) {
    case "project_locked":
      return { label: m.apply_refused_locked() }
    case "operation_running":
      return { label: m.apply_blocker_operation_running({ operation: operationText(m, blocker.kind) }) }
    case "no_processing_location":
      return { label: m.apply_refused_no_folder(), link: viewLink }
    case "processing_location_unavailable":
      return { label: m.apply_blocker_location_unavailable({ path: pathText(blocker.path) }), link: viewLink }
    case "project_folder_occupied":
      return { label: m.apply_blocker_folder_occupied({ path: pathText(blocker.path) }), link: viewLink }
    case "symlinks_unavailable":
      return { label: m.apply_refused_developer_mode() }
    case "links_unsupported":
      return { label: m.apply_refused_no_symlinks({ name: pathText(blocker.path) }), link: viewLink }
    case "input_write_risk":
      return { label: m.apply_blocker_input_write_risk(), link: viewLink }
    case "original_offline":
      return { label: m.apply_blocker_original_offline({ path: pathText(blocker.path) }), link: LOCATIONS }
    case "original_changed":
      return { label: m.apply_blocker_original_changed({ path: pathText(blocker.path) }) }
    case "pin_drift": {
      const kind = kindText(m, blocker.kind)
      const label = blocker.health === "missing" ? m.project_pin_missing({ kind }) : m.project_pin_changed({ kind })
      return { label, where: sessionName(blocker.sessionId), link: sessionLink(blocker.sessionId) }
    }
    case "calibration_unsettled":
      return { label: m.view_blocker_unsettled({ name: sessionName(blocker.sessionId) }), link: sessionLink(blocker.sessionId) }
    case "folder_clash":
      return { label: m.apply_blocker_folder_clash() }
    case "entry_name_refused":
      return { label: m.apply_blocker_entry_name({ name: blocker.name }) }
    case "leftovers_pending":
      return { label: m.view_review_previous_first(), where: m.project_previous_title() }
    case "building_occupied":
      return { label: m.apply_blocker_building_occupied({ path: pathText(blocker.path) }) }
    case "correction_undeliverable":
      return { label: m.apply_blocker_correction({ field: blocker.field, path: pathText(blocker.path) }), link: sessionLink(blocker.sessionId) }
    case "view_unreadable":
      return { label: m.apply_blocker_view_unreadable({ path: pathText(blocker.path) }) }
    case "session_not_ready":
      return { label: m.view_blocker_not_ready({ name: sessionName(blocker.sessionId) }), link: sessionLink(blocker.sessionId) }
  }
}

/** Why a build ended without installing the new View. */
export function stopText(m: Messages, stop: ApplyStop): string {
  switch (stop.code) {
    case "canceled":
      return m.apply_stop_canceled()
    case "interrupted":
      return m.apply_stop_interrupted()
    case "catalog_moved":
      return m.apply_stop_catalog_moved()
    case "originals_unverified":
      return m.apply_stop_originals_unverified({ count: stop.count })
    case "building_not_cleared":
      return m.apply_stop_building_not_cleared({ count: stop.count })
    case "entry_not_placed":
      return m.apply_stop_entry_not_placed()
    case "build_unverified":
      return m.apply_stop_build_unverified({ count: stop.count })
    case "view_unreadable":
      return m.apply_stop_view_unreadable({ count: stop.count })
    case "previous_unreadable":
      return m.apply_stop_previous_unreadable({ count: stop.count })
    case "kept_not_moved":
      return m.apply_stop_kept_not_moved({ count: stop.count })
    case "project_folder_replaced":
      return m.apply_stop_project_folder_replaced()
    case "view_replaced":
      return m.apply_stop_view_replaced()
    case "previous_appeared":
      return m.apply_stop_previous_appeared()
    case "aside_failed":
      return m.apply_stop_aside_failed()
    case "not_installed":
      return m.apply_stop_not_installed()
  }
}

/** Where a pending change came from: this Project's own edit, the Library, or calibration. */
export type ChangeSource = "project" | "library" | "calibration"

export function changeSource(change: PendingChange_Serialize): ChangeSource {
  switch (change.change) {
    case "library_rejected":
    case "library_restored":
    case "session_not_ready":
    case "session_regrouped":
      return "library"
    case "calibration_changed":
      return "calibration"
    default:
      return "project"
  }
}

export function sourceText(m: Messages, source: ChangeSource): string {
  return source === "project" ? m.project_change_source_project() : source === "calibration" ? m.project_change_source_calibration() : m.project_change_source_library()
}

/** The session a change concerns, when it names one. */
export function changeSession(change: PendingChange_Serialize): string | null {
  return "sessionId" in change && typeof change.sessionId === "string" ? change.sessionId : null
}

/** One pending change in words; `groupName` words a group id. */
export function changeText(m: Messages, change: PendingChange_Serialize, sessionName: (id: string) => string, groupName: (id: string) => string): string {
  switch (change.change) {
    case "session_added":
      return m.pending_session_added({ session: sessionName(change.sessionId), group: groupName(change.groupId) })
    case "session_removed":
      return m.project_change_session_removed({ session: sessionName(change.sessionId) })
    case "session_moved":
      return m.project_change_session_moved({ session: sessionName(change.sessionId), from: groupName(change.fromGroup), to: groupName(change.toGroup) })
    case "frames_included":
      return m.project_change_frames_included({ frames: framesText(m, change.captureKeys.length), session: sessionName(change.sessionId) })
    case "frames_excluded":
      return m.project_change_frames_excluded({ frames: framesText(m, change.captureKeys.length), session: sessionName(change.sessionId) })
    case "group_added":
      return m.pending_group_added({ name: change.name })
    case "group_removed":
      return m.pending_group_removed({ name: change.name })
    case "group_renamed":
      return m.project_change_group_renamed({ from: change.from, to: change.to })
    case "group_panel_changed":
      return change.panel ? m.pending_group_panel({ name: groupName(change.groupId) }) : m.pending_group_not_panel({ name: groupName(change.groupId) })
    case "mode_switched":
      return m.project_change_mode({ mode: modeText(m, change.to) })
    case "keywords_changed":
      return m.project_change_keywords()
    case "library_rejected":
      return m.project_change_frames_rejected({ frames: framesText(m, change.captureKeys.length), session: sessionName(change.sessionId) })
    case "library_restored":
      return m.project_change_frames_restored({ frames: framesText(m, change.captureKeys.length), session: sessionName(change.sessionId) })
    case "calibration_changed":
      return change.to ? m.project_change_calibration({ kind: kindText(m, change.kind), session: sessionName(change.sessionId) }) : m.pending_calibration_unsettled({ kind: kindText(m, change.kind), session: sessionName(change.sessionId) })
    case "session_not_ready":
      return m.view_blocker_not_ready({ name: sessionName(change.sessionId) })
    case "session_regrouped":
      return m.pending_session_regrouped({ session: sessionName(change.sessionId), count: change.successors.length })
  }
}

function framesText(m: Messages, count: number): string {
  return m.project_frames_count({ count, n: count })
}
