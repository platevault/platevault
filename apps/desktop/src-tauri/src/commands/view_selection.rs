// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! View IPC (spec 066 `contracts/views.md`, version 1).
//!
//! Registered only by the isolated rebuilt shell ([`crate::library_shell`]) beside
//! the library and Project commands; the legacy `preparedview_*` and
//! `sourceview_*` commands stay unregistered there. Edits of a View's unsaved
//! work carry `expectedDraftRevision`, where 0 starts the draft from the latest
//! committed revision, and return the [`ViewRecord`] only after their transaction
//! commits. Failures follow the library [`platevault_core::ErrorResponse`]
//! conventions, naming the View. No command reads or writes an image file except
//! `view_apply_quality`, which hashes sources read-only for library decisions.

use std::sync::Arc;

use platevault_core::library::{InventoryProbe, Library};
use platevault_core::{
    Asset, CandidateFilters, CandidatePage, CandidateQuery, CandidateSort, CriteriaInput,
    DraftEdit, ExpectedAsset, ExpectedSession, LibraryError, MemberBasis, MemberState, Membership,
    Project, Quality, QualityAction, QualityScope, RefreshReview, Revision, ViewDetail,
    ViewListing, ViewOriginInput, ViewQuery, ViewRecord, ViewRevision, MAX_CANDIDATE_PAGE,
};
use serde::Serialize;
use tauri::State;
use uuid::Uuid;

use super::library::{fail, Reply};

/// One member of a `view_frames` page with its copies' path display.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewFrame {
    #[serde(flatten)]
    pub member: MemberBasis,
    /// Each copy's relative path as displayed, in copy order.
    pub path_display: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewFramesPage {
    pub frames: Vec<ViewFrame>,
    /// Members matching the session and state filters before paging.
    pub total: u64,
}

/// The records a scoped quality action wrote.
#[derive(Clone, Debug, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum QualityOutcome {
    /// Library quality decisions of every expected copy.
    Assets { assets: Vec<Asset> },
    /// The Project after its rejection decisions.
    Project { project: Box<Project> },
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

/// Create a View at revision 0 with draft revision 1. A Project origin
/// preselects; other origins hold only their chosen sessions. Writes only View
/// rows: no Project, folder or quality change.
///
/// # Errors
/// `NotFound` for an unknown Project, Target or session; `Conflict` for a stale
/// Target or session, with successors when superseded.
#[tauri::command]
pub async fn view_create(
    library: State<'_, Arc<Library>>,
    origin: ViewOriginInput,
    name: Option<String>,
) -> Reply<ViewDetail> {
    library.create_view(&origin, name).await.map_err(fail(None))
}

/// View summaries by name, optionally of one Project or Target; no totals.
///
/// # Errors
/// `PersistenceFailure` when the catalog cannot be read.
#[tauri::command]
pub async fn view_list(
    library: State<'_, Arc<Library>>,
    project_id: Option<Uuid>,
    target_id: Option<Uuid>,
    offset: Option<u32>,
    limit: Option<u32>,
) -> Reply<Vec<ViewListing>> {
    let query = ViewQuery {
        project_id,
        target_id,
        offset: offset.unwrap_or_default(),
        limit: limit.unwrap_or_default(),
    };
    library.catalog().list_views(&query).await.map_err(fail(None))
}

/// Headers, session choices, both summaries, unresolved sources, the Project
/// context and open choices. Read-only.
///
/// # Errors
/// `NotFound` for an unknown View.
#[tauri::command]
pub async fn view_detail(library: State<'_, Arc<Library>>, view_id: Uuid) -> Reply<ViewDetail> {
    library.view_detail(view_id).await.map_err(fail(Some(view_id)))
}

/// One page of candidates with evidence and selection state. Starts no
/// measurement or rehash and writes nothing.
///
/// # Errors
/// `InvalidInput` for an invalid query; `NotFound` for an unknown View or
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
    limit: u32,
) -> Reply<CandidatePage> {
    let query = CandidateQuery {
        membership,
        filters: filters.unwrap_or_default(),
        sort,
        selected_only: selected_only.unwrap_or_default(),
        offset: offset.unwrap_or_default(),
        limit,
    };
    library.view_candidates(view_id, &query).await.map_err(fail(Some(view_id)))
}

/// Members of the membership with their copies, live availability, current
/// and chosen quality and changed-since-review flag, optionally of one session
/// or state, paged. Read-only.
///
/// # Errors
/// `InvalidInput` for a limit of 0 or above the page size; `NotFound` for an
/// unknown View or membership.
#[tauri::command]
pub async fn view_frames(
    library: State<'_, Arc<Library>>,
    view_id: Uuid,
    membership: Membership,
    session_id: Option<Uuid>,
    state: Option<MemberState>,
    offset: Option<u32>,
    limit: u32,
) -> Reply<ViewFramesPage> {
    if limit == 0 || limit > MAX_CANDIDATE_PAGE {
        let message = format!("limit {limit} must be in 1..={MAX_CANDIDATE_PAGE}");
        return Err(fail(Some(view_id))(LibraryError::InvalidInput(message)));
    }
    let basis = library
        .catalog()
        .view_membership(view_id, membership)
        .await
        .map_err(fail(Some(view_id)))?;
    let matching: Vec<MemberBasis> = basis
        .members
        .into_iter()
        .filter(|member| session_id.is_none_or(|session| member.member.session_id == session))
        .filter(|member| state.is_none_or(|state| member.member.state == state))
        .collect();
    let total = u64::try_from(matching.len()).unwrap_or(u64::MAX);
    let offset = usize::try_from(offset.unwrap_or_default()).unwrap_or(usize::MAX);
    let limit = usize::try_from(limit).unwrap_or(usize::MAX);
    let frames = matching
        .into_iter()
        .skip(offset)
        .take(limit)
        .map(|member| ViewFrame {
            path_display: member.copies.iter().map(|copy| copy.path.display()).collect(),
            member,
        })
        .collect();
    Ok(ViewFramesPage { frames, total })
}

/// *Edit.* Set the name, Project association and criteria settings. Selects nothing.
///
/// # Errors
/// `Conflict` for a stale draft revision; `InvalidInput` for invalid criteria;
/// `NotFound` for an unknown View or Project.
#[tauri::command]
pub async fn view_update_details(
    library: State<'_, Arc<Library>>,
    view_id: Uuid,
    expected_draft_revision: Revision,
    name: String,
    project_id: Option<Uuid>,
    criteria: CriteriaInput,
) -> Reply<ViewRecord> {
    let details = DraftEdit::Details { name, project_id, criteria };
    edit(&library, view_id, expected_draft_revision, details).await
}

/// *Edit.* Choose sessions as `manual`, with their members under D02.
///
/// # Errors
/// `Conflict` for a stale draft revision or a stale or superseded session, with
/// successors; `InvalidInput` for empty or repeated sessions.
#[tauri::command]
pub async fn view_select_sessions(
    library: State<'_, Arc<Library>>,
    view_id: Uuid,
    expected_draft_revision: Revision,
    sessions: Vec<ExpectedSession>,
) -> Reply<ViewRecord> {
    edit(&library, view_id, expected_draft_revision, DraftEdit::SelectSessions { sessions }).await
}

/// *Edit.* Choose every candidate matching `filters` as `select_matching`,
/// recording the filters.
///
/// # Errors
/// `InvalidInput` for invalid filters or no match; `Conflict` for a stale draft
/// revision or session.
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

/// *Edit.* Remove these choices and their members; a criteria-based choice
/// becomes a session exclusion.
///
/// # Errors
/// `Conflict` for a stale draft revision; `InvalidInput` for an unselected,
/// empty or repeated session.
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

/// *Edit.* Leave no selected session; criteria-based choices become exclusions.
///
/// # Errors
/// `Conflict` for a stale draft revision; `NotFound` for an unknown View.
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
/// `Conflict` for a stale draft revision; `InvalidInput` for a non-member or
/// empty or repeated keys.
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

/// Commit the draft as revision n+1 when its base is n. Changes no quality and
/// creates no folder.
///
/// # Errors
/// `Conflict` carrying the current committed or draft revision; `InvalidInput`
/// for a blank name.
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

/// Remove the draft; a View at revision 0 is removed with it (`null`).
///
/// # Errors
/// `Conflict` for a stale draft revision; `NotFound` for an unknown View.
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

/// Record a durable refresh review against the latest revision. Changes no
/// membership.
///
/// # Errors
/// `NotFound` for an unknown or never-saved View.
#[tauri::command]
pub async fn view_refresh(library: State<'_, Arc<Library>>, view_id: Uuid) -> Reply<RefreshReview> {
    library.refresh_view(view_id).await.map_err(fail(Some(view_id)))
}

/// *Edit.* Apply accepted refresh items and exclude declined additions.
///
/// # Errors
/// `Conflict` for a stale review, revision, draft or item; `InvalidInput` for
/// listed-only, repeated or foreign items.
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

/// The named scope of a quality action before confirmation. Read-only.
///
/// # Errors
/// `InvalidInput` for no keys or Reject for Project without a Project.
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

/// Write the scoped decision: library quality after read-only hashing, or the
/// 065 Project rejection. Membership stays unchanged.
///
/// # Errors
/// `InvalidInput` for a Retired copy, a member outside the scope or Reject for
/// Project without `expectedProjectRevision`; `Conflict` for a stale draft,
/// Project or asset.
#[tauri::command]
pub async fn view_apply_quality(
    library: State<'_, Arc<Library>>,
    view_id: Uuid,
    membership: Membership,
    expected_draft_revision: Option<Revision>,
    action: QualityAction,
    expected: Vec<ExpectedAsset>,
    expected_project_revision: Option<Revision>,
) -> Reply<QualityOutcome> {
    let catalog = library.catalog();
    let quality = match action {
        QualityAction::MarkUsable => Quality::Usable,
        QualityAction::MarkUnusable => Quality::Unusable,
        QualityAction::RejectForProject => {
            let Some(expected_project) = expected_project_revision else {
                let message = "expectedProjectRevision is required for reject_for_project";
                return Err(fail(Some(view_id))(LibraryError::InvalidInput(message.into())));
            };
            return catalog
                .reject_view_members(
                    view_id,
                    membership,
                    expected_draft_revision,
                    expected_project,
                    &expected,
                )
                .await
                .map(|project| QualityOutcome::Project { project: Box::new(project) })
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

/// An immutable committed revision with every member, copy and review basis.
///
/// # Errors
/// `NotFound` for an unknown View or revision.
#[tauri::command]
pub async fn view_revision(
    library: State<'_, Arc<Library>>,
    view_id: Uuid,
    revision: Revision,
) -> Reply<ViewRevision> {
    library.catalog().view_revision(view_id, revision).await.map_err(fail(Some(view_id)))
}
