//! Typed enumeration of every `ContractError.code` string produced by the
//! application.
//!
//! ## Purpose
//!
//! `ContractError.code` is currently a plain `String`.  This enum gives the
//! TypeScript surface a discriminated union of the exact wire strings so that
//! client code can exhaustively switch on error codes without string literals.
//!
//! **Wire strings are preserved byte-exactly via explicit `#[serde(rename = "...")]`
//! on every variant.**  `rename_all` is NOT used because most codes contain
//! dots, which `snake_case` / `camelCase` transforms cannot reproduce.
//!
//! ## Scope
//!
//! Covers every code produced by the **central `ContractError` type**.
//! Separate typed sub-enums (`TransitionErrorCode`, `TargetResolveErrorCode`,
//! `LogExportErrorCode`, …) are left in place; their codes do **not** flow
//! through `ContractError.code` in production code and are therefore excluded.
//!
//! ## This task (042-stdlib-adoption T011)
//!
//! This enum is additive scaffolding only.  `ContractError.code` remains a
//! `String` in this task; the type change happens in US2.  `ErrorCode` is
//! registered for specta export so the TypeScript union is emitted immediately.

use serde::{Deserialize, Serialize};
use specta::Type;

/// Exhaustive set of `ContractError.code` wire strings.
///
/// Every variant carries an explicit `#[serde(rename = "exact.wire.string")]`
/// so round-trips are byte-exact regardless of derive rename rules.
///
/// ## Verification
///
/// ```rust
/// use contracts_core::error_code::ErrorCode;
/// assert_eq!(
///     serde_json::to_string(&ErrorCode::InternalDatabase).unwrap(),
///     r#""internal.database""#
/// );
/// assert_eq!(
///     serde_json::to_string(&ErrorCode::PlanNotFound).unwrap(),
///     r#""plan.not_found""#
/// );
/// ```
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Type)]
pub enum ErrorCode {
    // ── Validation ──────────────────────────────────────────────────────────
    #[serde(rename = "validation.request_envelope_invalid")]
    ValidationRequestEnvelopeInvalid,

    // ── Dev-mode ────────────────────────────────────────────────────────────
    #[serde(rename = "dev_mode.disabled")]
    DevModeDisabled,

    // ── Equipment ───────────────────────────────────────────────────────────
    #[serde(rename = "equipment.duplicate")]
    EquipmentDuplicate,
    #[serde(rename = "equipment.not_found")]
    EquipmentNotFound,

    // ── Internal ────────────────────────────────────────────────────────────
    #[serde(rename = "internal.database")]
    InternalDatabase,
    #[serde(rename = "internal.audit")]
    InternalAudit,
    #[serde(rename = "internal.data")]
    InternalData,

    // ── First-run ───────────────────────────────────────────────────────────
    #[serde(rename = "firstrun.incomplete")]
    FirstrunIncomplete,

    // ── Path ────────────────────────────────────────────────────────────────
    #[serde(rename = "path.already_registered")]
    PathAlreadyRegistered,
    #[serde(rename = "path.already_registered.different_kind")]
    PathAlreadyRegisteredDifferentKind,
    #[serde(rename = "path.not_directory")]
    PathNotDirectory,
    #[serde(rename = "path.not_exists")]
    PathNotExists,
    #[serde(rename = "path.permission_denied")]
    PathPermissionDenied,
    #[serde(rename = "path.reserved_name")]
    PathReservedName,
    #[serde(rename = "path.traversal")]
    PathTraversal,
    #[serde(rename = "path.collision")]
    PathCollision,
    #[serde(rename = "path.invalid")]
    PathInvalid,

    // ── Inbox ───────────────────────────────────────────────────────────────
    #[serde(rename = "inbox.item.not_found")]
    InboxItemNotFound,
    #[serde(rename = "inbox.has.open.plan")]
    InboxHasOpenPlan,
    #[serde(rename = "inbox.item.no_plan")]
    InboxItemNoPlan,
    // Destination model (spec 041 destination iteration: US8/US9, FR-025–FR-033).
    #[serde(rename = "inbox.no_destination_root")]
    InboxNoDestinationRoot,
    #[serde(rename = "inbox.destination_root_required")]
    InboxDestinationRootRequired,
    #[serde(rename = "inbox.invalid_destination_root")]
    InboxInvalidDestinationRoot,
    #[serde(rename = "inbox.missing_path_attributes")]
    InboxMissingPathAttributes,

    // ── Metadata / classification ────────────────────────────────────────────
    #[serde(rename = "metadata.unreadable")]
    MetadataUnreadable,
    #[serde(rename = "classification.ambiguous")]
    ClassificationAmbiguous,
    #[serde(rename = "classification.stale")]
    ClassificationStale,

    // ── Pattern / token ──────────────────────────────────────────────────────
    #[serde(rename = "pattern.unset")]
    PatternUnset,
    #[serde(rename = "pattern.empty")]
    PatternEmpty,
    #[serde(rename = "pattern.invalid")]
    PatternInvalid,
    #[serde(rename = "pattern.invalid.unicode")]
    PatternInvalidUnicode,
    #[serde(rename = "token.unknown")]
    TokenUnknown,

    // ── File ────────────────────────────────────────────────────────────────
    #[serde(rename = "file.not_found")]
    FileNotFound,

    // ── Notes ────────────────────────────────────────────────────────────────
    #[serde(rename = "note.content_too_large")]
    NoteContentTooLarge,

    // ── Session ──────────────────────────────────────────────────────────────
    #[serde(rename = "session.not_found")]
    SessionNotFound,
    #[serde(rename = "session.mixed_state")]
    SessionMixedState,

    // ── Operation ───────────────────────────────────────────────────────────
    #[serde(rename = "operation.handler_duplicate")]
    OperationHandlerDuplicate,
    #[serde(rename = "operation.not_found")]
    OperationNotFound,

    // ── Plan ─────────────────────────────────────────────────────────────────
    /// Plan approval is outstanding (sent as `ContractError`, not `TransitionError`).
    #[serde(rename = "plan.approval_required")]
    PlanApprovalRequired,
    #[serde(rename = "plan.approval.stale")]
    PlanApprovalStale,
    #[serde(rename = "plan.invalid_state")]
    PlanInvalidState,
    #[serde(rename = "plan.not_found")]
    PlanNotFound,
    #[serde(rename = "plan.not_in_apply")]
    PlanNotInApply,
    #[serde(rename = "plan.blocked_by_protection")]
    PlanBlockedByProtection,
    #[serde(rename = "plan.in_progress")]
    PlanInProgress,
    #[serde(rename = "plan.items.empty")]
    PlanItemsEmpty,

    // ── Plan-apply item / run ────────────────────────────────────────────────
    #[serde(rename = "item.not_failed")]
    ItemNotFailed,
    #[serde(rename = "item.not_found")]
    ItemNotFound,
    #[serde(rename = "item.not_pending")]
    ItemNotPending,
    #[serde(rename = "run.not_found")]
    RunNotFound,
    #[serde(rename = "run.not_paused")]
    RunNotPaused,

    // ── Archive ──────────────────────────────────────────────────────────────
    #[serde(rename = "archive.empty")]
    ArchiveEmpty,

    // ── Confirm ──────────────────────────────────────────────────────────────
    #[serde(rename = "confirm.text.mismatch")]
    ConfirmTextMismatch,

    // ── Retry / no-op ────────────────────────────────────────────────────────
    #[serde(rename = "no.items.to.retry")]
    NoItemsToRetry,
    #[serde(rename = "no_op")]
    NoOp,

    // ── Hierarchy ────────────────────────────────────────────────────────────
    #[serde(rename = "parent.not_found")]
    ParentNotFound,
    #[serde(rename = "parent.not_terminal")]
    ParentNotTerminal,

    // ── Lifecycle ────────────────────────────────────────────────────────────
    #[serde(rename = "lifecycle.read_only")]
    LifecycleReadOnly,
    #[serde(rename = "lifecycle.last_confirmed_source")]
    LifecycleLastConfirmedSource,

    // ── Project ──────────────────────────────────────────────────────────────
    #[serde(rename = "project.not_found")]
    ProjectNotFound,
    #[serde(rename = "project.read_only")]
    ProjectReadOnly,

    // ── View ────────────────────────────────────────────────────────────────
    #[serde(rename = "view.mixed_kind")]
    ViewMixedKind,
    #[serde(rename = "view.not_found")]
    ViewNotFound,
    #[serde(rename = "view.unsupported_kind")]
    ViewUnsupportedKind,

    // ── Canonical target ─────────────────────────────────────────────────────
    #[serde(rename = "canonical_target.not_found")]
    CanonicalTargetNotFound,

    // ── Name ─────────────────────────────────────────────────────────────────
    #[serde(rename = "name.duplicate")]
    NameDuplicate,
    #[serde(rename = "name.empty")]
    NameEmpty,
    #[serde(rename = "name.too_long")]
    NameTooLong,

    // ── Source ───────────────────────────────────────────────────────────────
    #[serde(rename = "source.already.linked")]
    SourceAlreadyLinked,
    #[serde(rename = "source.not_found")]
    SourceNotFound,
    #[serde(rename = "source.invalid_organization_state")]
    SourceInvalidOrganizationState,

    // ── Tool ────────────────────────────────────────────────────────────────
    #[serde(rename = "tool.locked")]
    ToolLocked,
    #[serde(rename = "tool.unknown")]
    ToolUnknown,

    // ── Resolver / settings ──────────────────────────────────────────────────
    #[serde(rename = "resolver.endpoint_invalid")]
    ResolverEndpointInvalid,
    #[serde(rename = "key.unknown")]
    KeyUnknown,
    #[serde(rename = "key.unoverridable")]
    KeyUnoverridable,
    #[serde(rename = "value.invalid")]
    ValueInvalid,

    // ── Filesystem (plan-apply item error codes) ─────────────────────────────
    /// Used in `ContractError` tests in lib.rs; also may appear via plan-apply.
    #[serde(rename = "filesystem.destination_exists")]
    FilesystemDestinationExists,

    // ── Transition codes that flow through ContractError in some paths ────────
    /// `transition.refused` appears in `ContractError` payloads in
    /// `transition_use_case.rs` (passed as a String literal alongside
    /// `TransitionErrorCode`).  Included here for completeness.
    #[serde(rename = "transition.refused")]
    TransitionRefused,
    /// `plan.required` appears in `ContractError` in `transition_use_case.rs`.
    #[serde(rename = "plan.required")]
    PlanRequired,

    // ── Target / alias codes that flow through ContractError in some paths ────
    /// Appears in `TargetOpError.code: String` (`target_management.rs`).
    /// Included per task instruction ("include when unsure — superset is safe").
    #[serde(rename = "alias.duplicate")]
    AliasDuplicate,
    #[serde(rename = "alias.blank")]
    AliasBlank,
    #[serde(rename = "alias.not_found")]
    AliasNotFound,
    #[serde(rename = "alias.not_removable")]
    AliasNotRemovable,
    #[serde(rename = "target.not_found")]
    TargetNotFound,
    #[serde(rename = "target.invalid_id")]
    TargetInvalidId,

    // ── Launch ───────────────────────────────────────────────────────────────
    /// Appears in `ToolLaunchError.code: String` (`tool_launch.rs`).
    /// Included per task instruction.
    #[serde(rename = "launch.failed")]
    LaunchFailed,
    #[serde(rename = "macos.quarantine.detected")]
    MacosQuarantineDetected,

    // ── Native filesystem / picker ───────────────────────────────────────────
    #[serde(rename = "filters.invalid")]
    FiltersInvalid,
    #[serde(rename = "os.command_failed")]
    OsCommandFailed,
    #[serde(rename = "picker.unavailable")]
    PickerUnavailable,

    // ── Log export ───────────────────────────────────────────────────────────
    #[serde(rename = "format.unsupported")]
    FormatUnsupported,
    #[serde(rename = "range.invalid")]
    RangeInvalid,
    #[serde(rename = "path.write.denied")]
    PathWriteDenied,
    #[serde(rename = "path.parent.missing")]
    PathParentMissing,
    #[serde(rename = "database.error")]
    DatabaseError,
    #[serde(rename = "serialise.error")]
    SerialiseError,
    #[serde(rename = "io.error")]
    IoError,

    // ── Generic fallback ─────────────────────────────────────────────────────
    /// Used when a legacy `String` error is wrapped into `ContractError`.
    #[serde(rename = "internal.error")]
    InternalError,
}

#[cfg(test)]
mod tests {
    use super::ErrorCode;

    fn wire(v: ErrorCode) -> String {
        serde_json::to_string(&v).expect("serialize")
    }

    fn round_trip(v: ErrorCode) {
        let s = wire(v);
        let back: ErrorCode = serde_json::from_str(&s).expect("deserialize");
        assert_eq!(back, v, "round-trip failed for {s}");
    }

    #[test]
    fn exact_wire_strings_for_required_subset() {
        // The task mandates these exact strings.
        assert_eq!(wire(ErrorCode::InternalDatabase), r#""internal.database""#);
        assert_eq!(wire(ErrorCode::InternalAudit), r#""internal.audit""#);
        assert_eq!(wire(ErrorCode::PlanRequired), r#""plan.required""#);
        assert_eq!(wire(ErrorCode::PlanNotFound), r#""plan.not_found""#);
        assert_eq!(wire(ErrorCode::TransitionRefused), r#""transition.refused""#);
        assert_eq!(wire(ErrorCode::AliasDuplicate), r#""alias.duplicate""#);
        assert_eq!(wire(ErrorCode::TargetNotFound), r#""target.not_found""#);
        assert_eq!(wire(ErrorCode::LaunchFailed), r#""launch.failed""#);
        assert_eq!(wire(ErrorCode::ProjectNotFound), r#""project.not_found""#);
        assert_eq!(wire(ErrorCode::ViewNotFound), r#""view.not_found""#);
    }

    #[test]
    fn all_required_variants_round_trip() {
        for v in [
            ErrorCode::InternalDatabase,
            ErrorCode::InternalAudit,
            ErrorCode::PlanRequired,
            ErrorCode::PlanNotFound,
            ErrorCode::TransitionRefused,
            ErrorCode::AliasDuplicate,
            ErrorCode::TargetNotFound,
            ErrorCode::LaunchFailed,
            ErrorCode::ProjectNotFound,
            ErrorCode::ViewNotFound,
        ] {
            round_trip(v);
        }
    }
}
