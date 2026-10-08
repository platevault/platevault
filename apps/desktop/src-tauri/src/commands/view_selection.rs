// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Processing run IPC (spec 066, amended D-W1..D-W74).
//!
//! Registered only by the isolated rebuilt shell ([`crate::library_shell`])
//! under its `runs` block. A run lives in one Project on one subject and one
//! rig, fixed at creation; its picker offers only that subject's candidates on
//! that rig. Edits of a run's unsaved work carry `expectedDraftRevision`, where
//! 0 starts the draft from the latest committed revision, and return the
//! [`ViewRecord`] only after their transaction commits. A Complete run or a run
//! in the Project's Trash refuses every membership change. Failures follow the
//! library [`platevault_core::ErrorResponse`] conventions, naming the run. No
//! command reads or writes an image file except the quality and Review step
//! marks, which hash sources read-only for library decisions.

use std::sync::Arc;

use platevault_core::library::{InventoryProbe, Library};
use platevault_core::view_selection::{CandidatePage, ViewDetail};
use platevault_core::Asset;
use platevault_core::{
    CandidateFilters, CandidateQuery, CandidateSort, DraftEdit, ExpectedAsset, ExpectedSession,
    LibraryError, MemberState, Membership, NewView, ProjectMember, ProjectRejection, Quality,
    QualityAction, QualityScope, RefreshReview, RejectionMark, ReviewMark, ReviewMarkOutcome,
    Revision, RunStage, ViewListing, ViewQuery, ViewRecord, ViewRevision, MAX_CANDIDATE_PAGE,
};
use serde::Serialize;
use tauri::State;
use uuid::Uuid;

use super::library::{fail, Reply};

/// The records a scoped quality action wrote.
#[derive(Clone, Debug, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum QualityOutcome {
    /// Library quality decisions of every expected copy.
    Assets { assets: Vec<Asset> },
    /// The Project-only decisions.
    Rejections { rejections: Vec<ProjectRejection> },
}

async fn edit(
    library: &Library,
    view_id: Uuid,
    expected_draft_revision: Revision,
    edit: DraftEdit,
) -> Reply<ViewRecord> {
    library
        .catalog()
        .edit_view_draft(view_id, expected_draft_revision, &edit)
        .await
        .map_err(fail(Some(view_id)))
}

/// Start a run on one subject and one of the Project's rigs, with every
/// available candidate selected. Writes only run rows.
///
/// # Errors
/// `InvalidInput` for a blank name, a mosaic subject or a rig not on the
/// Project; `NotFound` for an unknown Project or subject.
#[tauri::command]
pub async fn view_create(
    library: State<'_, Arc<Library>>,
    project_id: Uuid,
    subject_id: Uuid,
    rig_id: Uuid,
    name: String,
) -> Reply<ViewDetail> {
    let input = NewView { project_id, subject_id, rig_id, name };
    library.create_view(&input).await.map_err(fail(Some(project_id)))
}

/// Runs outside the Project's Trash by name, optionally of one Project.
///
/// # Errors
/// `PersistenceFailure` when the catalog cannot be read.
#[tauri::command]
pub async fn view_list(
    library: State<'_, Arc<Library>>,
    project_id: Option<Uuid>,
    offset: Option<u32>,
    limit: Option<u32>,
) -> Reply<Vec<ViewListing>> {
    let query = ViewQuery {
        project_id,
        offset: offset.unwrap_or_default(),
        limit: limit.unwrap_or_default(),
    };
    library.catalog().list_views(&query).await.map_err(fail(project_id))
}

/// Headers, session choices, both summaries, unresolved sources, open choices
/// and the 'Add N new sessions' count. Read-only.
///
/// # Errors
/// `NotFound` for an unknown run.
#[tauri::command]
pub async fn view_detail(library: State<'_, Arc<Library>>, view_id: Uuid) -> Reply<ViewDetail> {
    library.view_detail(view_id).await.map_err(fail(Some(view_id)))
}

/// One page of the run's candidates with evidence and selection state.
/// Starts no measurement or rehash and writes nothing.
///
/// # Errors
/// `InvalidInput` for an invalid query; `NotFound` for an unknown run or
/// membership.
#[tauri::command]
pub async fn view_candidates(
    library: State<'_, Arc<Library>>,
    view_id: Uuid,
    membership: Membership,
    filters: Option<CandidateFilters>,
    sort: Option<CandidateSort>,
    selected_only: Option<bool>,
    offset: Option<u32>,
    limit: Option<u32>,
) -> Reply<CandidatePage> {
    let query = CandidateQuery {
        membership,
        filters: filters.unwrap_or_default(),
        sort,
        selected_only: selected_only.unwrap_or_default(),
        offset: offset.unwrap_or_default(),
        limit: limit.unwrap_or(MAX_CANDIDATE_PAGE),
    };
    library.view_candidates(view_id, &query).await.map_err(fail(Some(view_id)))
}

/// The count 'Add N new sessions' offers. Read-only.
///
/// # Errors
/// `NotFound` for an unknown run.
#[tauri::command]
pub async fn view_new_candidate_count(
    library: State<'_, Arc<Library>>,
    view_id: Uuid,
) -> Reply<u64> {
    library.catalog().view_new_candidate_count(view_id).await.map_err(fail(Some(view_id)))
}

/// Move the run to another pipeline step. Changes no membership.
///
/// # Errors
/// `InvalidInput` for a run in the Trash or a step its completion forbids.
#[tauri::command]
pub async fn view_set_stage(
    library: State<'_, Arc<Library>>,
    view_id: Uuid,
    stage: RunStage,
) -> Reply<ViewRecord> {
    library.catalog().set_view_stage(view_id, stage).await.map_err(fail(Some(view_id)))
}

/// *Edit.* Rename the run.
///
/// # Errors
/// `Conflict` for a stale draft revision; `InvalidInput` for a blank name.
#[tauri::command]
pub async fn view_rename(
    library: State<'_, Arc<Library>>,
    view_id: Uuid,
    expected_draft_revision: Revision,
    name: String,
) -> Reply<ViewRecord> {
    edit(&library, view_id, expected_draft_revision, DraftEdit::Details { name }).await
}

/// *Edit.* Choose candidates as `manual`, with their members under D02.
///
/// # Errors
/// `Conflict` for a stale draft or session; `InvalidInput` for a session that
/// is not one of the run's candidates.
#[tauri::command]
pub async fn view_select_sessions(
    library: State<'_, Arc<Library>>,
    view_id: Uuid,
    expected_draft_revision: Revision,
    sessions: Vec<ExpectedSession>,
) -> Reply<ViewRecord> {
    edit(&library, view_id, expected_draft_revision, DraftEdit::SelectSessions { sessions }).await
}

/// *Edit.* Choose every candidate matching `filters` as `select_matching`.
///
/// # Errors
/// `InvalidInput` for invalid filters or no match; `Conflict` for a stale draft.
#[tauri::command]
pub async fn view_select_matching(
    library: State<'_, Arc<Library>>,
    view_id: Uuid,
    expected_draft_revision: Revision,
    filters: CandidateFilters,
) -> Reply<ViewRecord> {
    library
        .view_select_matching(view_id, expected_draft_revision, &filters)
        .await
        .map_err(fail(Some(view_id)))
}

/// *Edit.* Remove choices and their members; a criteria-based choice becomes a
/// session exclusion.
///
/// # Errors
/// `Conflict` for a stale draft; `InvalidInput` for an unselected session.
#[tauri::command]
pub async fn view_deselect_sessions(
    library: State<'_, Arc<Library>>,
    view_id: Uuid,
    expected_draft_revision: Revision,
    session_ids: Vec<Uuid>,
) -> Reply<ViewRecord> {
    let deselect = DraftEdit::DeselectSessions { session_ids };
    edit(&library, view_id, expected_draft_revision, deselect).await
}

/// *Edit.* Leave no selected session.
///
/// # Errors
/// `Conflict` for a stale draft revision.
#[tauri::command]
pub async fn view_clear_selection(
    library: State<'_, Arc<Library>>,
    view_id: Uuid,
    expected_draft_revision: Revision,
) -> Reply<ViewRecord> {
    edit(&library, view_id, expected_draft_revision, DraftEdit::ClearSelection).await
}

/// *Edit.* Set members included or excluded. Files and library quality stay.
///
/// # Errors
/// `Conflict` for a stale draft; `InvalidInput` for a non-member key.
#[tauri::command]
pub async fn view_set_frames(
    library: State<'_, Arc<Library>>,
    view_id: Uuid,
    expected_draft_revision: Revision,
    member_keys: Vec<Uuid>,
    state: MemberState,
) -> Reply<ViewRecord> {
    let frames = DraftEdit::SetFrames { member_keys, state };
    edit(&library, view_id, expected_draft_revision, frames).await
}

/// Commit the draft as revision n+1. Changes no quality and creates no folder.
///
/// # Errors
/// `Conflict` for a stale revision or draft; `InvalidInput` for a Complete or
/// trashed run.
#[tauri::command]
pub async fn view_save(
    library: State<'_, Arc<Library>>,
    view_id: Uuid,
    expected_revision: Revision,
    expected_draft_revision: Revision,
) -> Reply<ViewRecord> {
    library
        .catalog()
        .save_view(view_id, expected_revision, expected_draft_revision)
        .await
        .map_err(fail(Some(view_id)))
}

/// Remove the draft; a run never saved is removed with it (`null`).
///
/// # Errors
/// `Conflict` for a stale draft revision.
#[tauri::command]
pub async fn view_discard_draft(
    library: State<'_, Arc<Library>>,
    view_id: Uuid,
    expected_draft_revision: Revision,
) -> Reply<Option<ViewRecord>> {
    library
        .catalog()
        .discard_view_draft(view_id, expected_draft_revision)
        .await
        .map_err(fail(Some(view_id)))
}

/// Record a durable refresh review against the latest revision.
///
/// # Errors
/// `NotFound` for a never-saved run; `InvalidInput` for a Complete run, which
/// needs Reopen first.
#[tauri::command]
pub async fn view_refresh(library: State<'_, Arc<Library>>, view_id: Uuid) -> Reply<RefreshReview> {
    library.refresh_view(view_id).await.map_err(fail(Some(view_id)))
}

/// *Edit.* Apply accepted refresh items and exclude declined additions.
///
/// # Errors
/// `Conflict` for a stale review, revision, draft or item; `InvalidInput` for
/// listed-only, repeated or foreign items, or a Complete run.
#[tauri::command]
pub async fn view_apply_refresh(
    library: State<'_, Arc<Library>>,
    review_id: Uuid,
    view_id: Uuid,
    expected_revision: Revision,
    expected_draft_revision: Revision,
    accept: Vec<Uuid>,
    decline: Vec<Uuid>,
) -> Reply<ViewRecord> {
    library
        .catalog()
        .apply_refresh(
            review_id,
            view_id,
            expected_revision,
            expected_draft_revision,
            &accept,
            &decline,
        )
        .await
        .map_err(fail(Some(view_id)))
}

/// The named scope of a bulk quality action before confirmation. Read-only.
///
/// # Errors
/// `InvalidInput` for no keys; `NotFound` for an unknown run or membership.
#[tauri::command]
pub async fn view_quality_scope(
    library: State<'_, Arc<Library>>,
    view_id: Uuid,
    membership: Membership,
    action: QualityAction,
    member_keys: Vec<Uuid>,
) -> Reply<QualityScope> {
    library
        .view_quality_scope(view_id, membership, action, &member_keys)
        .await
        .map_err(fail(Some(view_id)))
}

/// Write a confirmed bulk scope: library quality after read-only hashing, or
/// the Project-only rejection. Membership stays unchanged.
///
/// # Errors
/// `InvalidInput` for a member outside the scope, a Retired copy or missing
/// marks; `Conflict` for a stale draft or asset.
#[tauri::command]
pub async fn view_apply_quality(
    library: State<'_, Arc<Library>>,
    view_id: Uuid,
    membership: Membership,
    expected_draft_revision: Option<Revision>,
    action: QualityAction,
    expected: Vec<ExpectedAsset>,
    marks: Vec<RejectionMark>,
) -> Reply<QualityOutcome> {
    let catalog = library.catalog();
    let quality = match action {
        QualityAction::MarkUsable => Quality::Usable,
        QualityAction::MarkUnusable => Quality::Unusable,
        QualityAction::RejectForProject => {
            if marks.is_empty() {
                let message = "marks are required for Reject for this Project only";
                return Err(fail(Some(view_id))(LibraryError::InvalidInput(message.into())));
            }
            return catalog
                .reject_view_members(view_id, membership, expected_draft_revision, &marks)
                .await
                .map(|rejections| QualityOutcome::Rejections { rejections })
                .map_err(fail(Some(view_id)));
        }
    };
    catalog
        .set_view_quality(
            view_id,
            membership,
            expected_draft_revision,
            &expected,
            quality,
            InventoryProbe,
        )
        .await
        .map(|assets| QualityOutcome::Assets { assets })
        .map_err(fail(Some(view_id)))
}

/// One Review step mark (P, X, U, Reject for this Project only or its
/// withdrawal): the decision and the draft member move in one transaction.
///
/// # Errors
/// `InvalidInput` for a Complete or trashed run or a non-member frame;
/// `Conflict` for a stale draft, asset or Project-only decision.
#[tauri::command]
pub async fn view_review_mark(
    library: State<'_, Arc<Library>>,
    view_id: Uuid,
    expected_draft_revision: Revision,
    mark: ReviewMark,
) -> Reply<ReviewMarkOutcome> {
    library
        .catalog()
        .view_review_mark(view_id, expected_draft_revision, &mark, InventoryProbe)
        .await
        .map_err(fail(Some(view_id)))
}

/// An immutable committed revision with every member, copy and review basis.
///
/// # Errors
/// `NotFound` for an unknown run or revision.
#[tauri::command]
pub async fn view_revision(
    library: State<'_, Arc<Library>>,
    view_id: Uuid,
    revision: Revision,
) -> Reply<ViewRevision> {
    library.catalog().view_revision(view_id, revision).await.map_err(fail(Some(view_id)))
}

/// The Project's members: sessions in the latest revision of any of its runs
/// outside the Trash. Read-only.
///
/// # Errors
/// `NotFound` for an unknown Project.
#[tauri::command]
pub async fn project_members(
    library: State<'_, Arc<Library>>,
    project_id: Uuid,
) -> Reply<Vec<ProjectMember>> {
    library.catalog().project_members(project_id).await.map_err(fail(Some(project_id)))
}
