//! Inbox Tauri commands (spec 005, spec 041).
//!
//! Provides `inbox.classify`, `inbox.confirm`, `inbox.reclassify`,
//! `inbox.scan.folder`, and the spec 041 plan surface commands:
//! `inbox.plan`, `inbox.plan.apply`, `inbox.plan.apply_all`, `inbox.plan.cancel`.
//!
//! Legacy `inbox.scan` is retained for backward compatibility.

use app_core::inbox::classify::{classify, ClassifyRequest};
use app_core::inbox::confirm::{confirm, ConfirmRequest};
use app_core::inbox::inbox_plan::{
    apply_all_inbox_plans, apply_inbox_plan, apply_selected_inbox_plans, cancel_inbox_plan,
    get_inbox_plan, list_open_inbox_plans,
};
use app_core::inbox::metadata::get_inbox_item_metadata;
use app_core::inbox::reclassify::{reclassify, ReclassifyOverride, ReclassifyRequest};
use app_core::inbox::scan::{scan_root, ScanOptions, ScannedMasterFile};
use app_core::inbox::stats::inbox_stats as inbox_stats_uc;
use contracts_core::inbox::{
    InboxApplyAllResponse, InboxApplySelectedRequest, InboxBreakdownEntry, InboxClassifyRequest,
    InboxClassifyResponse, InboxConfirmRequest, InboxConfirmResponse, InboxFileEntry,
    InboxItemMetadataRequest, InboxItemMetadataResponse, InboxItemSummary, InboxListItem,
    InboxListResponse, InboxOpenPlansResponse, InboxPlanCancelResponse, InboxPlanView,
    InboxReclassifyRequest, InboxReclassifyResponse, InboxScanFolderRequest,
    InboxScanFolderResponse, InboxScanResult, InboxStatsResponse,
};
use contracts_core::plan_apply::PlanApplyResponse;
use persistence_db::repositories::inbox::{
    grouping_keys_for_items, list_unacknowledged_across_roots,
};
use sqlx::SqlitePool;
use std::path::PathBuf;
use uuid::Uuid;

use crate::commands::lifecycle::AppState;

/// Cap on cross-root listing (FR-006 — no unbounded loads).
const INBOX_LIST_LIMIT: i64 = 500;

// ── inbox.classify ────────────────────────────────────────────────────────────

/// `inbox.classify` — classify an Inbox folder using IMAGETYP-only evidence.
/// Idempotent unless `force_rescan: true`. Returns `contentSignature` for use
/// with `inbox.confirm`.
///
/// # Errors
/// `inbox.item.not_found` | `metadata.unreadable`
#[tauri::command]
#[specta::specta]
pub async fn inbox_classify(
    req: InboxClassifyRequest,
    pool: tauri::State<'_, SqlitePool>,
) -> Result<InboxClassifyResponse, String> {
    let use_case_req = ClassifyRequest {
        inbox_item_id: req.inbox_item_id,
        root_absolute_path: PathBuf::from(&req.root_absolute_path),
        force_rescan: req.force_rescan,
    };

    let resp = classify(&pool, use_case_req).await.map_err(|e| e.message)?;

    Ok(InboxClassifyResponse {
        inbox_item_id: resp.inbox_item_id,
        classification_type: resp.classification_type,
        frame_type: resp.frame_type,
        content_signature: resp.content_signature,
        breakdown: resp
            .breakdown
            .into_iter()
            .map(|b| InboxBreakdownEntry {
                kind: b.kind,
                count: u32::try_from(b.count).unwrap_or(u32::MAX),
                destination_preview: b.destination_preview,
                sample_files: b.sample_files,
            })
            .collect(),
        unclassified_files: resp.unclassified_files,
        sample_files: resp.sample_files,
        computed_at: resp.computed_at,
    })
}

// ── inbox.confirm ─────────────────────────────────────────────────────────────

/// `inbox.confirm` — generate a reviewable plan from a classified Inbox item.
///
/// # Errors
/// `inbox.item.not_found` | `inbox.has.open.plan` | `classification.ambiguous`
/// | `classification.stale` | `pattern.unset`
#[tauri::command]
#[specta::specta]
pub async fn inbox_confirm(
    req: InboxConfirmRequest,
    pool: tauri::State<'_, SqlitePool>,
) -> Result<InboxConfirmResponse, String> {
    let use_case_req = ConfirmRequest {
        inbox_item_id: req.inbox_item_id,
        action: req.action,
        content_signature: req.content_signature,
        destructive_destination: req.destructive_destination,
        root_absolute_path: PathBuf::from(&req.root_absolute_path),
    };

    let resp = confirm(&pool, use_case_req).await.map_err(|e| e.message)?;

    let organization_state = match resp.organization_state {
        contracts_core::first_run::OrganizationState::Organized => "organized",
        contracts_core::first_run::OrganizationState::Unorganized => "unorganized",
    };

    Ok(InboxConfirmResponse {
        plan_id: resp.plan_id,
        plan_state: resp.plan_state,
        items_total: u32::try_from(resp.items_total).unwrap_or(u32::MAX),
        registered_as_master: resp.registered_as_master,
        // spec 041 US4: per-source move-vs-catalogue breakdown.
        actions_summary: Some(contracts_core::inbox::InboxConfirmActionsSummary {
            move_count: u32::try_from(resp.move_count).unwrap_or(u32::MAX),
            catalogue_count: u32::try_from(resp.catalogue_count).unwrap_or(u32::MAX),
        }),
        organization_state: Some(organization_state.to_owned()),
    })
}

// ── inbox.reclassify ──────────────────────────────────────────────────────────

/// `inbox.reclassify` — write manual frame-type overrides and re-aggregate.
///
/// # Errors
/// Returns `"inbox.item.not_found"`, `"inbox.has.open.plan"`, or `"file.not_found"`.
#[tauri::command]
#[specta::specta]
pub async fn inbox_reclassify(
    req: InboxReclassifyRequest,
    pool: tauri::State<'_, SqlitePool>,
) -> Result<InboxReclassifyResponse, String> {
    let use_case_req = ReclassifyRequest {
        inbox_item_id: req.inbox_item_id,
        overrides: req
            .overrides
            .into_iter()
            .map(|o| ReclassifyOverride {
                file_path: o.file_path,
                frame_type: o.frame_type.unwrap_or_default(),
                // spec 041 US3/T026 (R-3): carry the non-type overrides through to
                // the use case instead of dropping them.
                filter: o.filter,
                exposure_s: o.exposure_s,
                binning: o.binning,
            })
            .collect(),
    };

    let resp = reclassify(&pool, use_case_req).await.map_err(|e| e.message)?;

    Ok(InboxReclassifyResponse {
        inbox_item_id: resp.inbox_item_id,
        updated_type: resp.updated_type,
        frame_type: resp.frame_type,
        remaining_unclassified: u32::try_from(resp.remaining_unclassified).unwrap_or(u32::MAX),
        applied_count: u32::try_from(resp.applied_count).unwrap_or(u32::MAX),
        // spec 041 — breakdown populated in phase 3+ when use case returns it
        breakdown: vec![],
    })
}

// ── inbox.item.metadata ───────────────────────────────────────────────────────

/// `inbox.item.metadata` — assemble per-file extracted metadata for an inbox
/// item (spec 041 US2/FR-010).
///
/// # Errors
/// Returns a string error if the item is missing or a query fails.
#[tauri::command]
#[specta::specta]
pub async fn inbox_item_metadata(
    req: InboxItemMetadataRequest,
    pool: tauri::State<'_, SqlitePool>,
) -> Result<InboxItemMetadataResponse, String> {
    let files = get_inbox_item_metadata(&pool, &req.inbox_item_id).await.map_err(|e| e.message)?;
    Ok(InboxItemMetadataResponse { inbox_item_id: req.inbox_item_id, files })
}

// ── inbox.scan.folder ─────────────────────────────────────────────────────────

/// `inbox.scan.folder` — recursively scan a root directory, discover leaf
/// FITS/video folders, upsert `InboxItem`s, and return a summary list.
///
/// # Errors
/// Returns a string error if the root is not accessible.
#[tauri::command]
#[specta::specta]
pub async fn inbox_scan_folder(
    req: InboxScanFolderRequest,
    pool: tauri::State<'_, SqlitePool>,
) -> Result<InboxScanFolderResponse, String> {
    let root_path = PathBuf::from(&req.root_absolute_path);
    let opts = ScanOptions { follow_symlinks: req.follow_symlinks };
    let scanned = scan_root(&root_path, &opts)?;

    let mut items: Vec<InboxItemSummary> = Vec::new();

    for scanned_item in &scanned {
        // ── A. Individual rows for detected calibration masters ────────────────
        for master in &scanned_item.masters {
            if let Some(summary) =
                persist_master_item(&pool, &req.root_id, scanned_item.lane.as_str(), master).await?
            {
                items.push(summary);
            }
        }

        // ── B. Grouped row for the remaining sub-frames in the folder ─────────
        //
        // If ALL files in this folder are masters, skip the grouped row — there
        // are no remaining subs.
        let master_count = scanned_item.masters.len();
        let total_image_count = scanned_item.fits_files.len() + scanned_item.xisf_files.len();
        let sub_count =
            total_image_count.saturating_sub(master_count) + scanned_item.video_files.len();

        if sub_count == 0 && !scanned_item.masters.is_empty() {
            // Every file in this folder was a master — no grouped sub row.
            continue;
        }

        let item_id = Uuid::new_v4().to_string();
        let folder_format_str = scanned_item.format.as_str();

        // For sub-count: use total minus masters for FITS-lane items.
        let persist_file_count = if scanned_item.masters.is_empty() {
            total_image_count + scanned_item.video_files.len()
        } else {
            sub_count
        };

        sqlx::query(
            "INSERT OR IGNORE INTO inbox_items
                (id, root_id, relative_path, file_count, discovered_at, last_scanned_at,
                 content_signature, state, lane, format, is_master_item)
             VALUES (?, ?, ?, ?, datetime('now'), datetime('now'), ?, 'pending_classification', ?, ?, 0)",
        )
        .bind(&item_id)
        .bind(&req.root_id)
        .bind(&scanned_item.relative_path)
        .bind(i64::try_from(persist_file_count).unwrap_or(i64::MAX))
        .bind(&scanned_item.content_signature)
        .bind(scanned_item.lane.as_str())
        .bind(folder_format_str)
        .execute(&*pool)
        .await
        .map_err(|e| e.to_string())?;

        // Fetch the authoritative row (may have existed before).
        let row: Option<(String, String, i64, String, Option<String>, Option<String>)> =
            sqlx::query_as(
                "SELECT id, state, file_count, lane, content_signature, format
                 FROM inbox_items WHERE root_id = ? AND relative_path = ?",
            )
            .bind(&req.root_id)
            .bind(&scanned_item.relative_path)
            .fetch_optional(&*pool)
            .await
            .map_err(|e| e.to_string())?;

        if let Some((id, state, fc, lane, sig, fmt)) = row {
            items.push(InboxItemSummary {
                inbox_item_id: id,
                relative_path: scanned_item.relative_path.clone(),
                file_count: u32::try_from(fc).unwrap_or(u32::MAX),
                lane,
                format: fmt.unwrap_or_else(|| folder_format_str.to_owned()),
                state,
                content_signature: sig.unwrap_or_default(),
                is_master: false,
                master_frame_type: None,
                master_filter: None,
                master_exposure_s: None,
            });
        }
    }

    Ok(InboxScanFolderResponse { root_id: req.root_id, items })
}

/// Row shape for an individual master `inbox_items` lookup: `(id, state,
/// file_count, lane, content_signature, is_master_item, master_frame_type,
/// master_filter, master_exposure_s)`.
type MasterItemRow =
    (String, String, i64, String, Option<String>, i64, Option<String>, Option<String>, Option<f64>);

/// Insert (or reuse) the individual `inbox_items` row for a single detected
/// calibration master and return its summary, if the row is present.
async fn persist_master_item(
    pool: &SqlitePool,
    root_id: &str,
    lane: &str,
    master: &ScannedMasterFile,
) -> Result<Option<InboxItemSummary>, String> {
    let master_item_id = Uuid::new_v4().to_string();
    let frame_type_str = format!("{:?}", master.detection.frame_type).to_ascii_lowercase();
    let format_str = master.format.as_str();

    sqlx::query(
        "INSERT OR IGNORE INTO inbox_items
            (id, root_id, relative_path, file_count, discovered_at, last_scanned_at,
             content_signature, state, lane, format, is_master_item,
             master_frame_type, master_filter, master_exposure_s)
         VALUES (?, ?, ?, 1, datetime('now'), datetime('now'), '', 'pending_classification',
                 ?, ?, 1, ?, ?, ?)",
    )
    .bind(&master_item_id)
    .bind(root_id)
    .bind(&master.relative_path)
    .bind(lane)
    .bind(format_str)
    .bind(&frame_type_str)
    .bind(&master.filter)
    .bind(master.exposure_s)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    // Fetch authoritative row (may have existed from a prior scan).
    let row: Option<MasterItemRow> = sqlx::query_as(
        "SELECT id, state, file_count, lane, content_signature,
                    is_master_item, master_frame_type, master_filter, master_exposure_s
             FROM inbox_items WHERE root_id = ? AND relative_path = ?",
    )
    .bind(root_id)
    .bind(&master.relative_path)
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(row.map(|(id, state, fc, lane, sig, _is_m, mft, mfilt, mexp)| InboxItemSummary {
        inbox_item_id: id,
        relative_path: master.relative_path.clone(),
        file_count: u32::try_from(fc).unwrap_or(u32::MAX),
        lane,
        format: format_str.to_owned(),
        state,
        content_signature: sig.unwrap_or_default(),
        is_master: true,
        master_frame_type: mft,
        master_filter: mfilt,
        master_exposure_s: mexp,
    }))
}

// ── inbox.list (spec 039) ─────────────────────────────────────────────────────

/// `inbox.list` — return all unacknowledged inbox items across all registered
/// roots (states `pending_classification` and `classified`).
///
/// Results are capped at 500 items (FR-006). Each item carries its root's
/// absolute path so the UI can group/label by root without a second call.
///
/// # Errors
/// Returns a string error on database failure.
#[tauri::command]
#[specta::specta]
pub async fn inbox_list(pool: tauri::State<'_, SqlitePool>) -> Result<InboxListResponse, String> {
    let rows = list_unacknowledged_across_roots(&pool, INBOX_LIST_LIMIT)
        .await
        .map_err(|e| e.to_string())?;

    let total = rows.len();
    let capped = total >= usize::try_from(INBOX_LIST_LIMIT).unwrap_or(usize::MAX);

    // Per-item grouping aggregates for the multi-level grouping UI (spec 041).
    // Single GROUP BY pass over the items we're about to return — no N+1.
    let item_ids: Vec<String> = rows.iter().map(|r| r.id.clone()).collect();
    let mut grouping =
        grouping_keys_for_items(&pool, &item_ids).await.map_err(|e| e.to_string())?;

    let items = rows
        .into_iter()
        .map(|r| {
            let g = grouping.remove(&r.id).unwrap_or_default();
            InboxListItem {
                inbox_item_id: r.id,
                root_id: r.root_id,
                root_absolute_path: r.root_path,
                relative_path: r.relative_path,
                file_count: u32::try_from(r.file_count).unwrap_or(u32::MAX),
                lane: r.lane,
                format: r.format.unwrap_or_else(|| "fits".to_owned()),
                state: r.state,
                content_signature: r.content_signature.unwrap_or_default(),
                is_master: r.is_master != 0,
                master_frame_type: r.master_frame_type,
                master_filter: r.master_filter,
                master_exposure_s: r.master_exposure_s,
                // spec 041 — real org-state from the owning registered source,
                // joined in list_unacknowledged_across_roots (no N+1).
                organization_state: r.organization_state,
                group_target: g.group_target,
                group_frame_type: g.group_frame_type,
                group_date: g.group_date,
                group_filter: g.group_filter,
                group_exposure: g.group_exposure,
                group_instrument: g.group_instrument,
            }
        })
        .collect();

    Ok(InboxListResponse {
        items,
        capped,
        limit: u32::try_from(INBOX_LIST_LIMIT).unwrap_or(u32::MAX),
    })
}

// ── Legacy inbox.scan (retained for spec 030 compatibility) ──────────────────

/// `inbox.scan` — legacy stub returning fixture data.
///
/// Kept for backward compat; real scanning uses `inbox.scan.folder`.
///
/// # Errors
/// Never fails; always returns `Ok`.
#[tauri::command]
#[specta::specta]
pub async fn inbox_scan(root_id: Option<String>) -> Result<InboxScanResult, String> {
    let root = root_id.unwrap_or_else(|| "root-inbox-001".to_owned());
    tracing::debug!("stub: inbox.scan root_id={root}");
    Ok(InboxScanResult {
        root_id: root,
        entries: vec![
            InboxFileEntry {
                path: "/astro/inbox/NGC7000_Ha_001.fits".to_owned(),
                file_name: "NGC7000_Ha_001.fits".to_owned(),
                size_bytes: 67_108_864,
                extension: "fits".to_owned(),
            },
            InboxFileEntry {
                path: "/astro/inbox/M31_L_001.fits".to_owned(),
                file_name: "M31_L_001.fits".to_owned(),
                size_bytes: 67_108_864,
                extension: "fits".to_owned(),
            },
            InboxFileEntry {
                path: "/astro/inbox/IC1396_SII_001.xisf".to_owned(),
                file_name: "IC1396_SII_001.xisf".to_owned(),
                size_bytes: 134_217_728,
                extension: "xisf".to_owned(),
            },
        ],
        total_count: 3,
        total_size_bytes: 268_435_456,
    })
}

// ── spec 041: inbox plan surface ──────────────────────────────────────────────

/// `inbox.plan` — fetch the open plan for an inbox item.
///
/// Returns the [`InboxPlanView`] when a plan link exists for this item, or an
/// error with code `inbox.item.no_plan` when the item has no open plan.
///
/// # Errors
/// - `inbox.item.not_found` — item does not exist.
/// - `inbox.item.no_plan`   — item exists but has no linked plan.
/// - `plan.not_found`       — link is present but plan row missing.
#[tauri::command]
#[specta::specta]
pub async fn inbox_plan(
    inbox_item_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<InboxPlanView, String> {
    get_inbox_plan(state.repo.pool(), &inbox_item_id).await.map_err(|e| e.message)
}

/// `inbox.plan.apply` — approve + apply the plan for a single inbox item.
///
/// The use-case auto-approves the plan (which `inbox.confirm` leaves at
/// `ready_for_review`) before calling `apply_plan`.  The plan listener
/// transitions the inbox item state once the executor completes.
///
/// # Errors
/// Returns a string error on failure, including `plan.stale` when per-item
/// CAS detects a file changed since the plan was created.
#[tauri::command]
#[specta::specta]
pub async fn inbox_plan_apply(
    inbox_item_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<PlanApplyResponse, String> {
    apply_inbox_plan(state.repo.pool(), &state.bus, &inbox_item_id).await.map_err(|e| e.message)
}

/// `inbox.plan.apply_all` — apply all plans currently in `plan_open` state.
///
/// Iterates items in `plan_open` state and applies each sequentially.
/// Returns a per-item result list so the UI can report partial failures.
///
/// # Errors
/// Returns a string error only if the list query itself fails; per-plan
/// errors are captured inside `InboxApplyAllResponse.results`.
#[tauri::command]
#[specta::specta]
pub async fn inbox_plan_apply_all(
    state: tauri::State<'_, AppState>,
) -> Result<InboxApplyAllResponse, String> {
    apply_all_inbox_plans(state.repo.pool(), &state.bus).await.map_err(|e| e.message)
}

/// `inbox.plan.list_open` — return every open plan across all roots (spec 041, US2).
///
/// Aggregate surface so the UI can show every active planned action at once,
/// each with its actions, without selecting inbox items one at a time.
///
/// # Errors
/// Returns a string error only if the underlying list/plan queries fail.
#[tauri::command]
#[specta::specta]
pub async fn inbox_plan_list_open(
    state: tauri::State<'_, AppState>,
) -> Result<InboxOpenPlansResponse, String> {
    list_open_inbox_plans(state.repo.pool()).await.map_err(|e| e.message)
}

/// `inbox.plan.apply_selected` — apply a caller-chosen subset of inbox plans
/// (spec 041, US2).
///
/// Selection is plan-level (per inbox item / ingestion group). Returns a
/// per-item result list so the UI can report partial failures; ids that are not
/// in `plan_open` state are reported as per-item errors rather than failing the
/// whole call.
///
/// # Errors
/// Returns a string error only if the membership query itself fails; per-plan
/// errors are captured inside `InboxApplyAllResponse.results`.
#[tauri::command]
#[specta::specta]
pub async fn inbox_plan_apply_selected(
    request: InboxApplySelectedRequest,
    state: tauri::State<'_, AppState>,
) -> Result<InboxApplyAllResponse, String> {
    apply_selected_inbox_plans(state.repo.pool(), &state.bus, &request.inbox_item_ids)
        .await
        .map_err(|e| e.message)
}

/// `inbox.plan.cancel` — discard the open plan and reset the item to `classified`.
///
/// The plan listener handles async cleanup; the use-case also eagerly resets
/// the inbox item state so the UI can reflect the change immediately.
///
/// # Errors
/// Returns a string error on database failure.
#[tauri::command]
#[specta::specta]
pub async fn inbox_plan_cancel(
    inbox_item_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<InboxPlanCancelResponse, String> {
    cancel_inbox_plan(state.repo.pool(), &state.bus, &inbox_item_id).await.map_err(|e| e.message)
}

/// `inbox.stats` — aggregate per-type frame counts across all active inbox items
/// (spec 041, US6 T038).
///
/// Returns counts of folders, masters, and images broken down by effective frame
/// type. The effective type is `manual_override` when set, otherwise
/// `frame_type` from classification evidence.
///
/// # Errors
/// Returns a string error on database failure.
#[tauri::command]
#[specta::specta]
pub async fn inbox_stats(pool: tauri::State<'_, SqlitePool>) -> Result<InboxStatsResponse, String> {
    inbox_stats_uc(&pool).await.map_err(|e| e.message)
}
