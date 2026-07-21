// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Pure action → filesystem-op dispatch (no async, no callbacks): resolves
//! item paths against their roots and calls the matching `ops::*` primitive.

use camino::{Utf8Path, Utf8PathBuf};

use crate::failure::{FailureCode, PlanItemFailure, RollbackOutcome};
use crate::ops::archive_op;
use crate::ops::catalogue_op;
use crate::ops::delete_op;
use crate::ops::link_op;
use crate::ops::mkdir_op;
use crate::ops::move_op;
use crate::ops::path_gate;
use crate::ops::trash_op;
use crate::ops::write_manifest_op;

use super::{ExecutorItem, ExecutorItemAction};

pub(super) type OpError = (PlanItemFailure, bool, RollbackOutcome, Option<String>);

pub(super) fn execute_item(item: &ExecutorItem) -> Result<(), OpError> {
    // Resolve the source and destination paths against the library root (if set).
    // The path gate has already validated them earlier in the loop; this is the
    // absolute-path computation for the actual filesystem operation.
    let resolved_src: Option<Utf8PathBuf> =
        resolve_item_path(item.source_path.as_deref(), item.library_root.as_deref());
    // #765: destination_root (picked destination root) takes precedence over
    // library_root (source root) for the destination join. Falls back to
    // library_root when destination_root is unset, preserving same-root
    // behavior for archive/trash/catalogue/legacy items.
    let resolved_dst: Option<Utf8PathBuf> = resolve_item_path(
        item.destination_path.as_deref(),
        item.destination_root.as_deref().or(item.library_root.as_deref()),
    );

    match &item.action {
        ExecutorItemAction::NoOp => Ok(()),

        ExecutorItemAction::Move => {
            let src = require_resolved_path(resolved_src.as_deref(), "source")?;
            let dst = require_resolved_path(resolved_dst.as_deref(), "destination")?;
            move_op::move_file(src, dst)
                .map_err(|(f, r)| (f, r.rollback_attempted, r.rollback_outcome, r.rollback_message))
        }

        ExecutorItemAction::Archive { archive_destination } => {
            let src = require_resolved_path(resolved_src.as_deref(), "source")?;
            // archive_destination is already absolute (pre-computed at plan generation).
            archive_op::archive_file(src, archive_destination)
                .map_err(|(f, r)| (f, r.rollback_attempted, r.rollback_outcome, r.rollback_message))
        }

        ExecutorItemAction::Trash { fallback_archive_destination } => {
            let src = require_resolved_path(resolved_src.as_deref(), "source")?;
            trash_op::trash_file(src, fallback_archive_destination.as_deref())
                .map(|_| ()) // discard TrashResult (audit_reason recorded by caller)
                .map_err(|(f, r)| (f, r.rollback_attempted, r.rollback_outcome, r.rollback_message))
        }

        ExecutorItemAction::Delete => {
            let src = require_resolved_path(resolved_src.as_deref(), "source")?;
            // T020: use `destructive_confirmed`, not `is_protected`.
            delete_op::delete_file(src, item.destructive_confirmed)
                .map_err(|(f, r)| (f, r.rollback_attempted, r.rollback_outcome, None))
        }

        ExecutorItemAction::Catalogue => {
            // No filesystem I/O — record-in-place (spec 041, T007).
            catalogue_op::catalogue_noop()
                .map_err(|e| (e, false, RollbackOutcome::NotApplicable, None))
        }

        ExecutorItemAction::Mkdir => {
            let dst = require_resolved_path(resolved_dst.as_deref(), "destination")?;
            mkdir_op::make_dir(dst).map_err(|f| (f, false, RollbackOutcome::NotApplicable, None))
        }

        ExecutorItemAction::Link { kind } => {
            let src = require_resolved_path(resolved_src.as_deref(), "source")?;
            let dst = require_resolved_path(resolved_dst.as_deref(), "destination")?;
            link_op::create_link(src, dst, *kind)
                .map_err(|f| (f, false, RollbackOutcome::NotApplicable, None))
        }

        ExecutorItemAction::WriteManifest { project_id } => {
            let dst = require_resolved_path(resolved_dst.as_deref(), "destination")?;
            write_manifest_op::write_marker(dst, project_id)
                .map_err(|f| (f, false, RollbackOutcome::NotApplicable, None))
        }
    }
}

/// Resolve a relative path against an optional library root.
/// Returns `None` if either argument is `None`.
fn resolve_item_path(relative: Option<&Utf8Path>, root: Option<&Utf8Path>) -> Option<Utf8PathBuf> {
    match (relative, root) {
        (Some(rel), Some(r)) => {
            // Use the validated lexical normalization (path_gate already checked safety).
            Some(path_gate::lexical_normalize(&r.join(rel)))
        }
        (Some(rel), None) => {
            // Legacy: no root — use path as-is.
            Some(rel.to_path_buf())
        }
        _ => None,
    }
}

fn require_resolved_path<'a>(
    p: Option<&'a Utf8Path>,
    label: &str,
) -> Result<&'a Utf8Path, OpError> {
    p.ok_or_else(|| {
        (
            PlanItemFailure::with_code(
                FailureCode::PathInvalid,
                format!("{label} path is not set on this plan item"),
            ),
            false,
            RollbackOutcome::NotApplicable,
            None,
        )
    })
}
