/**
 * User-facing error messages, keyed by the generated `ErrorCode` union and
 * resolved through the message catalog (spec 046 US2).
 *
 * EXHAUSTIVE by design: `Record<ErrorCode, () => string>`. When the backend adds
 * an `ErrorCode` variant, the regenerated TS union gains a member and this map
 * fails to type-check until a catalog message is added — so an untranslated code
 * is caught at build time, never shipped as a blank or a raw code (FR-007, SC-003).
 *
 * Values are catalog message functions (`m.err_*`), never inline literals, so all
 * error wording lives in `messages/en.json` like every other user-facing string
 * (FR-008, FR-001).
 */
import type { ErrorCode } from '@/bindings/index';
import { m } from '@/lib/i18n';

export const ERROR_MESSAGES: Record<ErrorCode, () => string> = {
  "validation.request_envelope_invalid": m.err_validation_request_envelope_invalid,
  "dev_mode.disabled": m.err_dev_mode_disabled,
  "equipment.duplicate": m.err_equipment_duplicate,
  "equipment.not_found": m.err_equipment_not_found,
  "internal.database": m.err_internal_database,
  "internal.audit": m.err_internal_audit,
  "internal.data": m.err_internal_data,
  "firstrun.incomplete": m.err_firstrun_incomplete,
  "path.already_registered": m.err_path_already_registered,
  "path.already_registered.different_kind": m.err_path_already_registered_different_kind,
  "path.not_directory": m.err_path_not_directory,
  "path.not_exists": m.err_path_not_exists,
  "path.permission_denied": m.err_path_permission_denied,
  "path.reserved_name": m.err_path_reserved_name,
  "path.traversal": m.err_path_traversal,
  "path.collision": m.err_path_collision,
  "path.invalid": m.err_path_invalid,
  "inbox.item.not_found": m.err_inbox_item_not_found,
  "inbox.has.open.plan": m.err_inbox_has_open_plan,
  "inbox.item.no_plan": m.err_inbox_item_no_plan,
  "inbox.no_destination_root": m.err_inbox_no_destination_root,
  "inbox.destination_root_required": m.err_inbox_destination_root_required,
  "inbox.invalid_destination_root": m.err_inbox_invalid_destination_root,
  "inbox.missing_path_attributes": m.err_inbox_missing_path_attributes,
  "metadata.unreadable": m.err_metadata_unreadable,
  "classification.ambiguous": m.err_classification_ambiguous,
  "classification.stale": m.err_classification_stale,
  "pattern.unset": m.err_pattern_unset,
  "pattern.empty": m.err_pattern_empty,
  "pattern.invalid": m.err_pattern_invalid,
  "pattern.invalid.unicode": m.err_pattern_invalid_unicode,
  "token.unknown": m.err_token_unknown,
  "file.not_found": m.err_file_not_found,
  "note.content_too_large": m.err_note_content_too_large,
  "session.not_found": m.err_session_not_found,
  "session.mixed_state": m.err_session_mixed_state,
  "operation.handler_duplicate": m.err_operation_handler_duplicate,
  "operation.not_found": m.err_operation_not_found,
  "plan.approval_required": m.err_plan_approval_required,
  "plan.approval.stale": m.err_plan_approval_stale,
  "plan.conflict.overlap": m.err_plan_conflict_overlap,
  "plan.invalid_state": m.err_plan_invalid_state,
  "plan.not_found": m.err_plan_not_found,
  "plan.not_in_apply": m.err_plan_not_in_apply,
  "plan.blocked_by_protection": m.err_plan_blocked_by_protection,
  "plan.in_progress": m.err_plan_in_progress,
  "plan.items.empty": m.err_plan_items_empty,
  "item.not_failed": m.err_item_not_failed,
  "item.not_found": m.err_item_not_found,
  "item.not_pending": m.err_item_not_pending,
  "run.not_found": m.err_run_not_found,
  "run.not_paused": m.err_run_not_paused,
  "archive.empty": m.err_archive_empty,
  "confirm.text.mismatch": m.err_confirm_text_mismatch,
  "no.items.to.retry": m.err_no_items_to_retry,
  "no_op": m.err_no_op,
  "parent.not_found": m.err_parent_not_found,
  "parent.not_terminal": m.err_parent_not_terminal,
  "lifecycle.read_only": m.err_lifecycle_read_only,
  "lifecycle.last_confirmed_source": m.err_lifecycle_last_confirmed_source,
  "project.not_found": m.err_project_not_found,
  "project.read_only": m.err_project_read_only,
  "view.mixed_kind": m.err_view_mixed_kind,
  "view.not_found": m.err_view_not_found,
  "view.unsupported_kind": m.err_view_unsupported_kind,
  // Same user-facing meaning as target.not_found — share one catalog key (no
  // duplicated catalog values; spec 046 FR-013).
  "canonical_target.not_found": m.err_target_not_found,
  "name.duplicate": m.err_name_duplicate,
  "name.empty": m.err_name_empty,
  "name.too_long": m.err_name_too_long,
  "source.already.linked": m.err_source_already_linked,
  "source.not_found": m.err_source_not_found,
  "source.invalid_organization_state": m.err_source_invalid_organization_state,
  "root.has_dependents": m.err_root_has_dependents,
  "tool.locked": m.err_tool_locked,
  "tool.unknown": m.err_tool_unknown,
  "resolver.endpoint_invalid": m.err_resolver_endpoint_invalid,
  "key.unknown": m.err_key_unknown,
  "key.unoverridable": m.err_key_unoverridable,
  "value.invalid": m.err_value_invalid,
  "filesystem.destination_exists": m.err_filesystem_destination_exists,
  "transition.refused": m.err_transition_refused,
  "plan.required": m.err_plan_required,
  "alias.duplicate": m.err_alias_duplicate,
  "alias.blank": m.err_alias_blank,
  "alias.not_found": m.err_alias_not_found,
  "alias.not_removable": m.err_alias_not_removable,
  "target.not_found": m.err_target_not_found,
  "target.invalid_id": m.err_target_invalid_id,
  "launch.failed": m.err_launch_failed,
  "macos.quarantine.detected": m.err_macos_quarantine_detected,
  "filters.invalid": m.err_filters_invalid,
  "os.command_failed": m.err_os_command_failed,
  "picker.unavailable": m.err_picker_unavailable,
  "format.unsupported": m.err_format_unsupported,
  "range.invalid": m.err_range_invalid,
  "path.write.denied": m.err_path_write_denied,
  "path.parent.missing": m.err_path_parent_missing,
  "database.error": m.err_database_error,
  "serialise.error": m.err_serialise_error,
  "io.error": m.err_io_error,
  // The generic wrap code maps to the shared generic fallback message (no
  // duplicated catalog values; spec 046 FR-013).
  "internal.error": m.err_generic_fallback,
};

/** Safe generic fallback shown when a code has no mapping (FR-011, SC-005). */
export function errorFallback(): string {
  return m.err_generic_fallback();
}
