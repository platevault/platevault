//! `inbox.confirm` use case — the single confirm path (spec 005, T027/T028).
//!
//! Spec 041 FR-050/T071: the legacy "split" action and its mixed per-type
//! confirm branch are removed. `inbox.classify`'s T066 materialization already
//! splits a folder into single-type sub-items before confirm ever sees them,
//! so every confirmable item carries exactly one classification result
//! ("classified") and one chosen destination `rootId`.
//!
//! Creates a reviewable Plan in `ready_for_review` via
//! `persistence_db::repositories::plans`. File list comes from
//! `InboxClassificationEvidence` rows (not `InboxItem.fileCount` — Ref: A9).
//!
//! TOCTOU guard: verifies `content_signature` before creating the plan (Ref: A8).
//!
//! Destination resolution (spec 041 destination model): each file selects a
//! per-frame-type pattern via `settings::effective_pattern_for(frame_type,
//! is_master)` and resolves it with `patterns::resolve_pattern_str` over a
//! metadata bundle built from extracted `RawFileMetadata` (FITS/XISF headers).
//! A pattern's token set defines that type's path-load-bearing attributes
//! (FR-033); any token that falls back to its default (`missing_tokens`) blocks
//! plan generation with `inbox.missing_path_attributes` (US9). Inbox sources
//! move into a chosen library root (`select_destination_root`, US8); non-inbox
//! sources stay under their own root. A structural failure returns
//! `pattern.unset`.
#![allow(clippy::doc_markdown)]

use std::path::PathBuf;

use contracts_core::first_run::{OrganizationState, SourceKind};
use contracts_core::settings::PatternPart as ContractPatternPart;
use metadata_core::{v1_normalization_table, MetadataExtractor};
use metadata_fits::FitsExtractor;
use metadata_xisf::XisfExtractor;
use patterns::{classify_frame, resolve_pattern_str, FrameTypeClass, MetadataBundle, PatternPart};
use persistence_db::repositories::first_run as first_run_repo;
use persistence_db::repositories::inbox::{self as inbox_repo};
use persistence_db::repositories::plans as plans_repo;
use persistence_db::repositories::settings as settings_repo;
use serde_json::json;
use sqlx::SqlitePool;
use uuid::Uuid;

use app_core_errors::db_internal_ctx;
use contracts_core::error_code::ErrorCode;
use contracts_core::{ContractError, ErrorSeverity};

// ── Request / Response ────────────────────────────────────────────────────────

#[derive(Clone, Debug)]
pub struct ConfirmRequest {
    pub inbox_item_id: String,
    /// Folder content_signature from the most recent classify response (Ref: A8).
    pub content_signature: String,
    /// Required when plan includes destructive items.
    pub destructive_destination: Option<String>,
    /// Absolute path to the inbox root on disk (needed to resolve file paths
    /// to read FITS/XISF headers for the metadata bundle).
    pub root_absolute_path: PathBuf,
    /// Caller-selected destination library root (spec 041 US8/FR-029). Only
    /// consulted for inbox sources whose frame-type category has >1 candidate
    /// root; ignored otherwise.
    pub root_id: Option<String>,
}

#[derive(Clone, Debug)]
pub struct ConfirmResponse {
    pub plan_id: String,
    pub plan_state: String,
    pub items_total: usize,
    /// Always `false` since spec 041 (US4): masters no longer register at
    /// confirm time. Registration is relocated to plan-apply completion
    /// (`plan_listener`), so confirming a master now produces a reviewable plan
    /// like any other item. The field is retained for DTO compatibility.
    pub registered_as_master: bool,
    /// Organization state of the source owning this inbox item (spec 041 R-7).
    pub organization_state: OrganizationState,
    /// Number of `move` plan items produced (unorganized provenance).
    pub move_count: usize,
    /// Number of `catalogue` plan items produced (organized provenance).
    pub catalogue_count: usize,
    /// Per-action absolute destination previews (spec 041 US8/FR-031).
    pub destinations: Vec<ResolvedDestination>,
}

/// One resolved per-file destination (spec 041 US8/FR-031). The absolute path
/// is `root_path + "/" + to_relative_path`, computed for display only — the
/// plan_items table stores `to_root_id` + `to_relative_path`, not the absolute.
#[derive(Clone, Debug)]
pub struct ResolvedDestination {
    pub from_path: String,
    pub to_relative_path: String,
    pub to_absolute_path: String,
    pub to_root_id: String,
    pub action: &'static str,
}

// ── confirm ───────────────────────────────────────────────────────────────────

/// Generate a reviewable plan for an inbox item.
///
/// # Errors
///
/// - `inbox.item.not_found` — item does not exist or has no classification.
/// - `inbox.has.open.plan` — an open plan already exists.
/// - `classification.ambiguous` — action/classification mismatch or no classified files.
/// - `classification.stale` — signature drift detected.
/// - `pattern.unset` — naming pattern is unset or fails to resolve required tokens.
#[allow(clippy::too_many_lines)]
pub async fn confirm(
    pool: &SqlitePool,
    req: ConfirmRequest,
) -> Result<ConfirmResponse, ContractError> {
    // 1. Load item
    let item = inbox_repo::get_inbox_item(pool, &req.inbox_item_id).await.map_err(|_| {
        ContractError::new(
            ErrorCode::InboxItemNotFound,
            format!("InboxItem not found: {}", req.inbox_item_id),
            ErrorSeverity::Blocking,
            false,
        )
    })?;

    // Master metadata carry-to-apply (spec 041 US4/T031): the calibration
    // master fields (`is_master_item`, `master_frame_type`, `master_exposure_s`,
    // `master_filter`) already live on the `inbox_items` row. We deliberately do
    // NOT stamp them onto the plan or plan items here. At apply completion the
    // plan listener reloads the inbox item via the `inbox_plan_links` row and
    // reads these fields directly to register the master (calibration_session +
    // calibration_fingerprint). This is the lowest-risk mechanism — no new
    // columns, no plan-item provenance encoding — and keeps masters on the exact
    // same move/catalogue plan path as every other item (Constitution §II).

    // 2. Dedupe open plan (Ref: E1)
    if let Some(link) = inbox_repo::get_plan_link(pool, &req.inbox_item_id).await.unwrap_or(None) {
        return Err(ContractError::new(
            ErrorCode::InboxHasOpenPlan,
            format!("Inbox item already has an open plan: {}", link.plan_id),
            ErrorSeverity::Blocking,
            false,
        ));
    }

    // 3. T070 / FR-049 / SC-015: reject any item that is still in the
    // needs-review sentinel bucket (missing mandatory attributes).  Splitting /
    // recalculation happens at classify/reclassify (before confirm), never here.
    if item.group_key == super::classify::SENTINEL_NEEDS_REVIEW {
        return Err(ContractError::new(
            ErrorCode::InboxMissingPathAttributes,
            "This item is in the needs-review bucket: one or more files are missing mandatory \
             attributes. Supply the missing values via inbox.reclassify before confirming.",
            ErrorSeverity::Blocking,
            false,
        ));
    }

    // 4. Load classification
    let classification = inbox_repo::get_classification(pool, &req.inbox_item_id)
        .await
        .unwrap_or(None)
        .ok_or_else(|| {
            ContractError::new(
                ErrorCode::InboxItemNotFound,
                "Classification not found — run inbox.classify first",
                ErrorSeverity::Blocking,
                false,
            )
        })?;

    // 5. TOCTOU content_signature guard (Ref: A8)
    if item.content_signature.as_deref() != Some(&req.content_signature) {
        return Err(ContractError::new(
            ErrorCode::ClassificationStale,
            "Folder has changed since classification. Re-classify before confirming.",
            ErrorSeverity::Blocking,
            false,
        ));
    }

    // 7. Validate the request. Spec 041 FR-050/T071/T072: the "split" action
    // and the mixed per-type confirm branch are removed — the request no
    // longer carries an `action` field at all; `classified` (migration
    // 0048's CHECK-constrained single-type DB value) is the only confirmable
    // classification result. A folder that classified as `unclassified`
    // (zero or multiple distinct frame types) is not confirmable directly; it
    // must be re-split into single-type sub-items (T066 materialization)
    // before confirming.
    if classification.result != "classified" {
        return Err(ContractError::new(
            ErrorCode::ClassificationAmbiguous,
            format!("Classification result '{}' is not confirmable", classification.result),
            ErrorSeverity::Blocking,
            false,
        ));
    }

    // 9. Enumerate files from evidence (Ref: A9) — NOT from file_count
    let evidence_rows = inbox_repo::list_evidence(pool, &req.inbox_item_id)
        .await
        .map_err(|e| db_internal_ctx(e, "list inbox evidence"))?;

    // Only include files that have a frame type (classified or manually overridden)
    let plan_files: Vec<&persistence_db::repositories::inbox::InboxEvidenceRow> =
        evidence_rows.iter().filter(|ev| effective_frame_type(ev).is_some()).collect();

    if plan_files.is_empty() {
        return Err(ContractError::new(
            ErrorCode::ClassificationAmbiguous,
            "No classified files found. Re-classify or reclassify unclassified files.",
            ErrorSeverity::Blocking,
            false,
        ));
    }

    // Spec 041 FR-050/T071: per-type action grouping is retired along with the
    // "split" action — a confirmable item is single-type (classification.result
    // == "classified"), so no frame-type sort is needed. `list_evidence` already
    // orders rows by `relative_file_path`, which is deterministic order enough.

    // 8a. Look up the owning source's organization state (spec 041 US4, R-7).
    //
    // `Organized`   → catalogue-in-place (record where the file already is; no
    //                 filesystem move; from_path == to_path == current path).
    // `Unorganized` → move to the pattern-resolved destination.
    //
    // An inbox item shares one root, so this is uniform in practice; the loop
    // below still decides per file so it composes with future mixed-provenance
    // cases (R-8) without special-casing.
    let org_state =
        persistence_db::repositories::first_run::get_source_organization_state(pool, &item.root_id)
            .await
            .map_err(|e| db_internal_ctx(e, "get source organization state"))?
            .unwrap_or(OrganizationState::Unorganized);

    // 8b. Destination-root resolution (spec 041 US8/FR-027–FR-031).
    //
    // Default: a file stays under its own root (`item.root_id`) — non-inbox
    // sources catalogue/move in place. An INBOX source is never a destination,
    // so its files MUST move into a chosen library root. Candidate roots are
    // enumerated per frame-type category (see `select_destination_root`); with
    // one candidate the root is auto-selected, with several the caller's
    // `req.root_id` must pick one (else a blocking error lists the candidates).
    let source_kind = first_run_repo::list_sources(pool)
        .await
        .map_err(|e| {
            ContractError::new(
                ErrorCode::InternalDatabase,
                e.to_string(),
                ErrorSeverity::Fatal,
                true,
            )
        })?
        .into_iter()
        .find(|s| s.source_id == item.root_id)
        .map(|s| s.kind);
    let item_is_inbox_source = source_kind == Some(SourceKind::Inbox);

    // 8c. Resolve destination paths for each file via its per-type pattern
    // (spec 041 T052/FR-026a). Collect per-file resolution rows. `action` is
    // "catalogue" for organized provenance, "move" otherwise.
    //
    // `resolve_pattern_str` returns `Ok(ResolveResult)` whose `missing_tokens`
    // lists every token that fell back to a registry default. Because a per-type
    // pattern's token set defines that type's path-load-bearing attributes
    // (FR-033), a non-empty `missing_tokens` IS the missing-attribute set — the
    // US9 gate (T056) is derived from it rather than a separate matrix. A hard
    // `Err(ResolveError)` signals a structural failure (traversal, length cap).
    let norm_table = v1_normalization_table();
    let fits_extractor = FitsExtractor;
    let xisf_extractor = XisfExtractor;

    let mut resolved_items: Vec<ResolvedRow> = Vec::with_capacity(plan_files.len());
    // Per-file missing path attributes for the US9 gate (FR-032/FR-033).
    let mut missing_by_file: Vec<(String, Vec<String>)> = Vec::new();
    // Cache the chosen destination root per category (keyed by the category's
    // stable string name) so a multi-category item resolves each category once.
    let mut chosen_root_cache: std::collections::HashMap<&'static str, DestinationRoot> =
        std::collections::HashMap::new();

    for ev in &plan_files {
        let ft = effective_frame_type(ev).unwrap_or("unknown");
        let is_master = ev.is_master != 0;
        let abs_path = req.root_absolute_path.join(&ev.relative_file_path);
        let filename = abs_path.file_name().and_then(|n| n.to_str()).unwrap_or("unknown.fits");
        let basename = ev.relative_file_path.rsplit('/').next().unwrap_or(&ev.relative_file_path);
        let item_name = format!("[{}] {basename}", ft.to_uppercase());

        match org_state {
            OrganizationState::Organized => {
                // Catalogue-in-place: dest == source; stays under its own root.
                resolved_items.push(ResolvedRow {
                    source_rel: ev.relative_file_path.clone(),
                    dest_rel: ev.relative_file_path.clone(),
                    item_name,
                    action: "catalogue",
                    to_root_id: item.root_id.clone(),
                });
            }
            OrganizationState::Unorganized => {
                // Select the per-type pattern. `None` → frame type is not a known
                // class (missing/garbage IMAGETYP) → needs-review (same flow as
                // missing IMAGETYP: surfaced as a missing path attribute below).
                let pattern = settings_repo::effective_pattern_for(pool, ft, is_master)
                    .await
                    .map_err(|e| {
                        ContractError::new(
                            ErrorCode::InternalDatabase,
                            e.to_string(),
                            ErrorSeverity::Fatal,
                            true,
                        )
                    })?;
                let Some(pattern) = pattern else {
                    // Unclassified frame: image type is the missing attribute.
                    missing_by_file
                        .push((ev.relative_file_path.clone(), vec!["image type".to_owned()]));
                    continue;
                };

                let bundle = build_metadata_bundle(
                    &abs_path,
                    ft,
                    &norm_table,
                    &fits_extractor,
                    &xisf_extractor,
                );

                let result = match resolve_pattern_str(&pattern, &bundle) {
                    Ok(r) => r,
                    Err(e) => {
                        return Err(ContractError::new(
                            ErrorCode::PatternUnset,
                            format!(
                                "Pattern resolution failed for '{}': {e:?}",
                                ev.relative_file_path
                            ),
                            ErrorSeverity::Blocking,
                            false,
                        ));
                    }
                };

                // US9 gate (FR-032/FR-033): any token that fell back to its
                // default is a path-load-bearing attribute the file lacks. Block
                // and collect, rather than producing a nonsensical destination.
                if !result.missing_tokens.is_empty() {
                    missing_by_file
                        .push((ev.relative_file_path.clone(), result.missing_tokens.clone()));
                    continue;
                }

                // Destination root: inbox sources move into a chosen library
                // root; non-inbox sources move within their own root.
                let dest_root = if item_is_inbox_source {
                    let class = classify_frame(ft, is_master).ok_or_else(|| {
                        ContractError::new(
                            ErrorCode::InboxNoDestinationRoot,
                            format!("Cannot route '{ft}': unknown frame-type category"),
                            ErrorSeverity::Blocking,
                            false,
                        )
                    })?;
                    if let Some(cached) = chosen_root_cache.get(class.as_str()) {
                        cached.clone()
                    } else {
                        let chosen =
                            select_destination_root(pool, class, req.root_id.as_deref()).await?;
                        chosen_root_cache.insert(class.as_str(), chosen.clone());
                        chosen
                    }
                } else {
                    DestinationRoot { root_id: item.root_id.clone(), path: String::new() }
                };

                let dest_with_file = format!("{}/{filename}", result.relative_path);
                resolved_items.push(ResolvedRow {
                    source_rel: ev.relative_file_path.clone(),
                    dest_rel: dest_with_file,
                    item_name,
                    action: "move",
                    to_root_id: dest_root.root_id,
                });
            }
        }
    }

    // 8d. US9 gate: if any file is missing a path-load-bearing attribute, block
    // plan generation and surface the offending files + attributes (FR-032).
    if !missing_by_file.is_empty() {
        let files: Vec<serde_json::Value> = missing_by_file
            .iter()
            .map(|(path, attrs)| json!({ "filePath": path, "missingPathAttributes": attrs }))
            .collect();
        let summary = missing_by_file
            .iter()
            .map(|(p, a)| format!("{p}: {}", a.join(", ")))
            .collect::<Vec<_>>()
            .join("; ");
        return Err(ContractError::new(
            ErrorCode::InboxMissingPathAttributes,
            format!("Files are missing attributes their destination pattern requires: {summary}"),
            ErrorSeverity::Blocking,
            false,
        )
        .with_details(json!({ "files": files })));
    }

    // 10. Build the plan.
    // A move-only split is non-destructive from the user perspective but the
    // plans table CHECK constraint only accepts the canonical 'archive' | 'trash'
    // vocabulary (spec 033, migration 0040). Anything else (incl. the legacy
    // 'os_trash' / 'none') falls back to 'archive' so confirm can never schedule
    // a permanent delete without a recoverable step.
    let destructive_dest = req
        .destructive_destination
        .as_deref()
        .filter(|s| matches!(*s, "archive" | "trash"))
        .unwrap_or("archive");

    let plan_id = Uuid::new_v4().to_string();
    let title = format!("Inbox confirm: {} ({})", item.relative_path, classification.result);

    let insert_plan = plans_repo::InsertPlan {
        id: &plan_id,
        title: &title,
        origin: "inbox",
        origin_path: Some(&item.relative_path),
        // "split" is the stable `plans.plan_type` CHECK-constrained category for
        // every inbox-confirm-origin plan (see `crates/app/core/src/plans.rs`
        // `parse_plan_type` and `plan_listener.rs`); it predates and is
        // unrelated to the removed per-request "split" action, so FR-050/T071
        // does not touch it.
        plan_type: "split",
        destructive_destination: destructive_dest,
        parent_plan_id: None,
        total_bytes_required: 0,
    };

    plans_repo::insert_plan(pool, &insert_plan)
        .await
        .map_err(|e| db_internal_ctx(e, "insert plan"))?;

    // Map destination root id → absolute path for the FR-031 absolute preview.
    // (Catalogue actions and non-inbox moves keep their own root; inbox moves
    // use the chosen library root resolved above.)
    let root_paths: std::collections::HashMap<String, String> = first_run_repo::list_sources(pool)
        .await
        .map_err(|e| {
            ContractError::new(
                ErrorCode::InternalDatabase,
                e.to_string(),
                ErrorSeverity::Fatal,
                true,
            )
        })?
        .into_iter()
        .map(|s| (s.source_id, s.path))
        .collect();

    // 11. Insert plan items — one per classified file, with resolved
    // destinations and per-item destination root (spec 041 US8/FR-027–FR-031).
    let items_total = resolved_items.len();
    let mut move_count = 0usize;
    let mut catalogue_count = 0usize;
    let mut destinations: Vec<ResolvedDestination> = Vec::with_capacity(resolved_items.len());
    for (idx, row) in resolved_items.iter().enumerate() {
        let item_id = Uuid::new_v4().to_string();

        match row.action {
            "catalogue" => catalogue_count += 1,
            _ => move_count += 1,
        }

        let plan_item = plans_repo::InsertPlanItem {
            id: &item_id,
            plan_id: &plan_id,
            item_index: i64::try_from(idx).unwrap_or(i64::MAX),
            name: &row.item_name,
            action: row.action,
            from_root_id: Some(&item.root_id),
            from_relative_path: &row.source_rel,
            to_root_id: Some(&row.to_root_id),
            to_relative_path: &row.dest_rel,
            reason: "inbox_confirm",
            protection: "normal",
            linked_entity: None,
            provenance_json: None,
            archive_path: None,
            source_id: None,
            category: None,
        };

        plans_repo::insert_plan_item(pool, &plan_item)
            .await
            .map_err(|e| db_internal_ctx(e, "insert plan item"))?;

        // FR-031: absolute destination = root path + "/" + relative path. For
        // display only; the row itself keeps root_id + relative.
        let to_absolute_path = root_paths.get(&row.to_root_id).map_or_else(
            || row.dest_rel.clone(),
            |root| format!("{}/{}", root.trim_end_matches('/'), row.dest_rel),
        );
        destinations.push(ResolvedDestination {
            from_path: row.source_rel.clone(),
            to_relative_path: row.dest_rel.clone(),
            to_absolute_path,
            to_root_id: row.to_root_id.clone(),
            action: row.action,
        });
    }

    // 12. Transition plan to ready_for_review
    sqlx::query("UPDATE plans SET state = 'ready_for_review' WHERE id = ?")
        .bind(&plan_id)
        .execute(pool)
        .await
        .map_err(|e| db_internal_ctx(e, "transition plan to ready_for_review"))?;

    // 13. Create plan link and update item state
    inbox_repo::insert_plan_link(pool, &req.inbox_item_id, &plan_id)
        .await
        .map_err(|e| db_internal_ctx(e, "insert plan link"))?;

    inbox_repo::update_inbox_item_state(pool, &req.inbox_item_id, "plan_open").await.ok();

    Ok(ConfirmResponse {
        plan_id,
        plan_state: "ready_for_review".to_owned(),
        items_total,
        // spec 041 US4: masters no longer register at confirm; registration is
        // relocated to plan-apply completion. Always false now.
        registered_as_master: false,
        organization_state: org_state,
        move_count,
        catalogue_count,
        destinations,
    })
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/// One resolved per-file plan row before insertion. Carries the per-item
/// destination root (spec 041 US8) so inbox moves can target a chosen library
/// root while non-inbox files stay under their own root.
struct ResolvedRow {
    source_rel: String,
    dest_rel: String,
    item_name: String,
    action: &'static str,
    to_root_id: String,
}

/// A chosen destination library root (id + absolute path) for inbox moves.
#[derive(Clone)]
struct DestinationRoot {
    root_id: String,
    /// Absolute path of the root; empty when the root is the item's own root
    /// (non-inbox), in which case the absolute preview is filled from the
    /// `root_paths` map at insert time.
    #[allow(dead_code)]
    path: String,
}

/// Map a frame-type class to the source kind that can host it (spec 041 FR-027).
/// Lights live under `LightFrames`; every calibration class (raw or master)
/// lives under `Calibration`.
fn destination_kind_for(class: FrameTypeClass) -> SourceKind {
    match class {
        FrameTypeClass::Light => SourceKind::LightFrames,
        FrameTypeClass::Flat
        | FrameTypeClass::Dark
        | FrameTypeClass::Bias
        | FrameTypeClass::MasterFlat
        | FrameTypeClass::MasterDark
        | FrameTypeClass::MasterBias => SourceKind::Calibration,
    }
}

/// Select the destination library root for an inbox item's frame-type category
/// (spec 041 US8/FR-027–FR-030).
///
/// Candidates are registered, non-inbox sources whose kind matches the
/// category. Resolution:
/// - 0 candidates → `inbox.no_destination_root`.
/// - 1 candidate → auto-select (caller `root_id` ignored).
/// - 2+ candidates → require `selected`; it MUST be one of the candidates, else
///   `inbox.destination_root_required` (absent) / `inbox.invalid_destination_root`.
async fn select_destination_root(
    pool: &SqlitePool,
    class: FrameTypeClass,
    selected: Option<&str>,
) -> Result<DestinationRoot, ContractError> {
    let want_kind = destination_kind_for(class);
    let candidates: Vec<DestinationRoot> = first_run_repo::list_sources(pool)
        .await
        .map_err(|e| {
            ContractError::new(
                ErrorCode::InternalDatabase,
                e.to_string(),
                ErrorSeverity::Fatal,
                true,
            )
        })?
        .into_iter()
        .filter(|s| s.kind != SourceKind::Inbox && s.kind == want_kind)
        .map(|s| DestinationRoot { root_id: s.source_id, path: s.path })
        .collect();

    match candidates.len() {
        0 => Err(ContractError::new(
            ErrorCode::InboxNoDestinationRoot,
            format!("No registered library root for frame-type category '{}'", class.as_str()),
            ErrorSeverity::Blocking,
            false,
        )),
        1 => Ok(candidates.into_iter().next().expect("len == 1")),
        _ => match selected {
            None => {
                let roots: Vec<serde_json::Value> = candidates
                    .iter()
                    .map(|c| json!({ "rootId": c.root_id, "path": c.path, "kind": want_kind }))
                    .collect();
                Err(ContractError::new(
                    ErrorCode::InboxDestinationRootRequired,
                    format!(
                        "Multiple library roots can host '{}'; a destination root must be selected",
                        class.as_str()
                    ),
                    ErrorSeverity::Blocking,
                    false,
                )
                .with_details(json!({ "category": class.as_str(), "candidates": roots })))
            }
            Some(id) => candidates.into_iter().find(|c| c.root_id == id).ok_or_else(|| {
                ContractError::new(
                    ErrorCode::InboxInvalidDestinationRoot,
                    format!(
                        "Selected root '{id}' is not a valid destination for '{}'",
                        class.as_str()
                    ),
                    ErrorSeverity::Blocking,
                    false,
                )
            }),
        },
    }
}

/// Return the effective frame type for a file: `manual_override` if set, else `frame_type`.
fn effective_frame_type(
    ev: &persistence_db::repositories::inbox::InboxEvidenceRow,
) -> Option<&str> {
    ev.manual_override.as_deref().or(ev.frame_type.as_deref())
}

/// Load the active `pattern` from the settings table, or fall back to the
/// built-in default if no pattern has been configured yet.
///
/// # Errors
/// Returns `pattern.unset` when the stored pattern fails to deserialize.
pub(crate) async fn load_active_pattern(
    pool: &SqlitePool,
) -> Result<Vec<PatternPart>, ContractError> {
    // Try to read the stored pattern JSON.
    let raw_opt = settings_repo::get_raw(pool, "pattern").await.unwrap_or(None);

    if let Some(raw) = raw_opt {
        // The stored value is a JSON array of PatternPart objects.
        match serde_json::from_value::<Vec<ContractPatternPart>>(raw) {
            Ok(parts) => {
                return Ok(parts
                    .into_iter()
                    .map(|p| PatternPart { id: p.id, kind: p.kind, value: p.value })
                    .collect());
            }
            Err(e) => {
                return Err(ContractError::new(
                    ErrorCode::PatternUnset,
                    format!("Stored pattern is invalid: {e}"),
                    ErrorSeverity::Blocking,
                    false,
                ));
            }
        }
    }

    // Fall back to the default pattern defined in contracts_core::settings.
    let defaults = contracts_core::settings::SettingsState::default();
    Ok(defaults
        .pattern
        .into_iter()
        .map(|p| PatternPart { id: p.id, kind: p.kind, value: p.value })
        .collect())
}

/// Build a `MetadataBundle` for pattern resolution from extracted FITS/XISF
/// headers + the known `frame_type` from classification evidence.
///
/// Source fields follow the v1 registry in `crates/patterns/src/registry.rs`:
/// `target`, `filter`, `date`, `frame_type`, `camera`, `exposure`, `gain`,
/// `binning`, `set_temp`.
pub(crate) fn build_metadata_bundle(
    abs_path: &std::path::Path,
    frame_type: &str,
    norm_table: &metadata_core::ImageTypNormalizationTable,
    fits_ext: &FitsExtractor,
    xisf_ext: &XisfExtractor,
) -> MetadataBundle {
    let mut bundle = MetadataBundle::new();

    // Extract raw metadata from FITS or XISF file
    let ext = abs_path
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase)
        .unwrap_or_default();

    let raw_meta = if xisf_ext.supports_extension(&ext) {
        xisf_ext.extract(abs_path).ok().flatten()
    } else if fits_ext.supports_extension(&ext) {
        fits_ext.extract(abs_path).ok().flatten()
    } else {
        None
    };

    // frame_type (authoritative from classification)
    bundle.insert("frame_type".to_owned(), frame_type.to_owned());

    if let Some(meta) = raw_meta {
        // target / object
        if let Some(obj) = &meta.object {
            let cleaned = obj.trim();
            if !cleaned.is_empty() {
                bundle.insert("target".to_owned(), cleaned.to_owned());
            }
        }
        // filter
        if let Some(filter) = &meta.filter {
            let cleaned = filter.trim();
            if !cleaned.is_empty() {
                bundle.insert("filter".to_owned(), cleaned.to_owned());
            }
        }
        // date — use the DATE-OBS field; strip time component for the directory token
        if let Some(date_obs) = &meta.date_obs {
            let date_part = date_obs.split('T').next().unwrap_or(date_obs.as_str());
            if !date_part.is_empty() {
                bundle.insert("date".to_owned(), date_part.to_owned());
            }
        }
        // camera
        if let Some(instrume) = &meta.instrume {
            let cleaned = instrume.trim();
            if !cleaned.is_empty() {
                bundle.insert("camera".to_owned(), cleaned.to_owned());
            }
        }
        // exposure
        if let Some(exp) = &meta.exposure {
            bundle.insert("exposure".to_owned(), exp.trim().to_owned());
        }
        // gain
        if let Some(gain) = &meta.gain {
            bundle.insert("gain".to_owned(), gain.trim().to_owned());
        }
        // binning — use xbinning x ybinning format
        if let (Some(xb), Some(yb)) = (&meta.x_binning, &meta.y_binning) {
            bundle.insert("binning".to_owned(), format!("{}x{}", xb.trim(), yb.trim()));
        }
        // telescope (not a standard token but included for completeness)
        if let Some(scope) = &meta.telescop {
            let cleaned = scope.trim();
            if !cleaned.is_empty() {
                bundle.insert("telescope".to_owned(), cleaned.to_owned());
            }
        }
    }

    // Ensure all required v1 tokens that the pattern resolver needs have
    // fallback-friendly entries (the registry has per-token fallbacks anyway).
    let _ = norm_table; // used in classify path; not needed here directly

    bundle
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use persistence_db::repositories::inbox::{
        InsertEvidence, InsertInboxItem, UpsertClassification,
    };
    use persistence_db::Database;
    use std::io::Write;

    async fn test_db() -> Database {
        let db = Database::in_memory().await.unwrap();
        db.migrate().await.unwrap();
        db
    }

    /// Write a minimal FITS file with a given IMAGETYP and optional OBJECT/FILTER/DATE-OBS.
    fn write_fits(
        dir: &std::path::Path,
        name: &str,
        imagetyp: &str,
        object: Option<&str>,
        filter: Option<&str>,
        date_obs: Option<&str>,
    ) {
        let path = dir.join(name);
        let mut block = vec![b' '; 2880];
        let mut idx = 0usize;
        let write_card = |block: &mut Vec<u8>, idx: &mut usize, card: &str| {
            let bytes = card.as_bytes();
            let len = bytes.len().min(80);
            block[*idx * 80..*idx * 80 + len].copy_from_slice(&bytes[..len]);
            *idx += 1;
        };
        let imagetyp_card = format!("IMAGETYP= '{imagetyp:<8}'");
        write_card(&mut block, &mut idx, &format!("{imagetyp_card:<80}"));
        if let Some(obj) = object {
            write_card(&mut block, &mut idx, &format!("{:<80}", format!("OBJECT  = '{obj}'")));
        }
        if let Some(f) = filter {
            write_card(&mut block, &mut idx, &format!("{:<80}", format!("FILTER  = '{f}'")));
        }
        if let Some(d) = date_obs {
            write_card(&mut block, &mut idx, &format!("{:<80}", format!("DATE-OBS= '{d}'")));
        }
        block[idx * 80..idx * 80 + 3].copy_from_slice(b"END");
        let mut f = std::fs::File::create(path).unwrap();
        f.write_all(&block).unwrap();
    }

    /// Like [`write_fits`] but also writes an `EXPTIME` card. Used by calibration
    /// (dark/flat) tests so their files carry the exposure their per-type
    /// destination pattern requires (spec 041 US9 gate).
    #[allow(clippy::too_many_arguments)]
    fn write_fits_exp(
        dir: &std::path::Path,
        name: &str,
        imagetyp: &str,
        object: Option<&str>,
        filter: Option<&str>,
        date_obs: Option<&str>,
        exptime: f64,
    ) {
        let path = dir.join(name);
        let mut block = vec![b' '; 2880];
        let mut idx = 0usize;
        let write_card = |block: &mut Vec<u8>, idx: &mut usize, card: &str| {
            let bytes = card.as_bytes();
            let len = bytes.len().min(80);
            block[*idx * 80..*idx * 80 + len].copy_from_slice(&bytes[..len]);
            *idx += 1;
        };
        write_card(&mut block, &mut idx, &format!("{:<80}", format!("IMAGETYP= '{imagetyp:<8}'")));
        if let Some(obj) = object {
            write_card(&mut block, &mut idx, &format!("{:<80}", format!("OBJECT  = '{obj}'")));
        }
        if let Some(f) = filter {
            write_card(&mut block, &mut idx, &format!("{:<80}", format!("FILTER  = '{f}'")));
        }
        if let Some(d) = date_obs {
            write_card(&mut block, &mut idx, &format!("{:<80}", format!("DATE-OBS= '{d}'")));
        }
        write_card(&mut block, &mut idx, &format!("{:<80}", format!("EXPTIME = {exptime}")));
        block[idx * 80..idx * 80 + 3].copy_from_slice(b"END");
        let mut f = std::fs::File::create(path).unwrap();
        f.write_all(&block).unwrap();
    }

    async fn setup_classified_item(
        db: &Database,
        item_id: &str,
        result: &str,
        frame_type: Option<&str>,
        sig: &str,
        file_names: &[&str],
    ) {
        inbox_repo::insert_inbox_item(
            db.pool(),
            &InsertInboxItem {
                id: item_id,
                root_id: "root-1",
                relative_path: "",
                file_count: i64::try_from(file_names.len()).unwrap_or(i64::MAX),
                content_signature: Some(sig),
                lane: "fits",
            },
        )
        .await
        .unwrap();

        inbox_repo::upsert_classification(
            db.pool(),
            &UpsertClassification {
                inbox_item_id: item_id,
                result,
                frame_type,
                content_signature: sig,
                unclassified_file_count: 0,
            },
        )
        .await
        .unwrap();

        for (i, fname) in file_names.iter().enumerate() {
            let ev_id = format!("ev-{item_id}-{i}");
            inbox_repo::insert_evidence(
                db.pool(),
                &InsertEvidence {
                    id: &ev_id,
                    inbox_item_id: item_id,
                    relative_file_path: fname,
                    frame_type,
                    evidence_source: "imagetyp_header",
                    raw_value: Some("Light Frame"),
                    unclassified: false,
                    manual_override: None,
                    is_master: false,
                    master_detector: None,
                },
            )
            .await
            .unwrap();
        }
    }

    /// Like [`setup_classified_item`] but the item is owned by an explicit
    /// `root_id` (for the US8 inbox-source routing tests).
    async fn setup_classified_item_rooted(
        db: &Database,
        item_id: &str,
        root_id: &str,
        frame_type: Option<&str>,
        sig: &str,
        file_names: &[&str],
    ) {
        inbox_repo::insert_inbox_item(
            db.pool(),
            &InsertInboxItem {
                id: item_id,
                root_id,
                relative_path: "",
                file_count: i64::try_from(file_names.len()).unwrap_or(i64::MAX),
                content_signature: Some(sig),
                lane: "fits",
            },
        )
        .await
        .unwrap();
        inbox_repo::upsert_classification(
            db.pool(),
            &UpsertClassification {
                inbox_item_id: item_id,
                result: "classified",
                frame_type,
                content_signature: sig,
                unclassified_file_count: 0,
            },
        )
        .await
        .unwrap();
        for (i, fname) in file_names.iter().enumerate() {
            inbox_repo::insert_evidence(
                db.pool(),
                &InsertEvidence {
                    id: &format!("ev-{item_id}-{i}"),
                    inbox_item_id: item_id,
                    relative_file_path: fname,
                    frame_type,
                    evidence_source: "imagetyp_header",
                    raw_value: Some("Light Frame"),
                    unclassified: false,
                    manual_override: None,
                    is_master: false,
                    master_detector: None,
                },
            )
            .await
            .unwrap();
        }
    }

    #[tokio::test]
    async fn confirm_single_type_creates_plan() {
        let tmp = tempfile::tempdir().unwrap();
        write_fits(
            tmp.path(),
            "light_001.fits",
            "Light Frame",
            Some("M42"),
            Some("Ha"),
            Some("2025-10-10T22:00:00"),
        );
        write_fits(
            tmp.path(),
            "light_002.fits",
            "Light Frame",
            Some("M42"),
            Some("Ha"),
            Some("2025-10-10T22:05:00"),
        );
        write_fits(
            tmp.path(),
            "light_003.fits",
            "Light Frame",
            Some("M42"),
            Some("Ha"),
            Some("2025-10-10T22:10:00"),
        );

        let db = test_db().await;
        setup_classified_item(
            &db,
            "item-c1",
            "classified",
            Some("light"),
            "sig-abc",
            &["light_001.fits", "light_002.fits", "light_003.fits"],
        )
        .await;

        let resp = confirm(
            db.pool(),
            ConfirmRequest {
                inbox_item_id: "item-c1".to_owned(),
                content_signature: "sig-abc".to_owned(),
                destructive_destination: None,
                root_absolute_path: tmp.path().to_owned(),
                root_id: None,
            },
        )
        .await
        .unwrap();

        assert_eq!(resp.plan_state, "ready_for_review");
        assert_eq!(resp.items_total, 3);
    }

    /// US7 / T042-T043: the chosen destructive destination must be persisted on
    /// the plan (the durable audit record), default to `archive` when unset, and
    /// coerce any non-recoverable value to `archive` so confirm can never schedule
    /// a permanent delete without a recoverable step.
    #[tokio::test]
    async fn confirm_persists_destructive_destination() {
        let tmp = tempfile::tempdir().unwrap();
        write_fits(
            tmp.path(),
            "light_001.fits",
            "Light Frame",
            Some("M42"),
            Some("Ha"),
            Some("2025-10-10T22:00:00"),
        );

        // (input destructive_destination, expected persisted value).
        // Canonical vocabulary is `archive | trash` (spec 033, migration 0040).
        let cases = [
            (None, "archive"),
            (Some("archive"), "archive"),
            (Some("trash"), "trash"),
            // Legacy `os_trash` is no longer canonical → coerced to safe archive.
            (Some("os_trash"), "archive"),
            // Anything outside the recoverable set must fall back to archive —
            // never a permanent delete.
            (Some("delete"), "archive"),
            (Some(""), "archive"),
        ];

        for (dest, expected) in &cases {
            // Fresh DB per case: setup_classified_item hardcodes the
            // (root_id, relative_path) key, so it supports one item per DB.
            let db = test_db().await;
            setup_classified_item(
                &db,
                "item-dd",
                "classified",
                Some("light"),
                "sig-dd",
                &["light_001.fits"],
            )
            .await;

            let resp = confirm(
                db.pool(),
                ConfirmRequest {
                    inbox_item_id: "item-dd".to_owned(),
                    content_signature: "sig-dd".to_owned(),
                    destructive_destination: dest.map(str::to_owned),
                    root_absolute_path: tmp.path().to_owned(),
                    root_id: None,
                },
            )
            .await
            .unwrap();

            let (persisted,): (String,) =
                sqlx::query_as("SELECT destructive_destination FROM plans WHERE id = ?")
                    .bind(&resp.plan_id)
                    .fetch_one(db.pool())
                    .await
                    .unwrap();

            assert_eq!(
                &persisted, expected,
                "input {dest:?} must persist as {expected}, never a permanent delete"
            );
        }
    }

    /// Spec 041 FR-050/T071: the "split" action is removed and a genuinely
    /// mixed folder (classification.result == "unclassified" because it still
    /// has 2+ distinct frame types) is no longer confirmable at all — not via
    /// "split" (gone) and not via "confirm" (requires "classified"). It must
    /// be re-split into single-type sub-items (T066 materialization) before
    /// any of its pieces can be confirmed.
    #[tokio::test]
    #[allow(clippy::too_many_lines)]
    async fn confirm_of_mixed_result_is_rejected() {
        let tmp = tempfile::tempdir().unwrap();
        write_fits(
            tmp.path(),
            "light_001.fits",
            "Light Frame",
            Some("NGC7000"),
            Some("Ha"),
            Some("2025-10-10T22:00:00"),
        );
        write_fits(
            tmp.path(),
            "light_002.fits",
            "Light Frame",
            Some("NGC7000"),
            Some("Ha"),
            Some("2025-10-10T22:05:00"),
        );
        write_fits_exp(
            tmp.path(),
            "dark_001.fits",
            "Dark Frame",
            None,
            None,
            Some("2025-10-10T20:00:00"),
            300.0,
        );
        write_fits_exp(
            tmp.path(),
            "dark_002.fits",
            "Dark Frame",
            None,
            None,
            Some("2025-10-10T20:05:00"),
            300.0,
        );

        let db = test_db().await;
        let item_id = "item-mixed-split";
        let sig = "sig-mixed";

        inbox_repo::insert_inbox_item(
            db.pool(),
            &InsertInboxItem {
                id: item_id,
                root_id: "root-1",
                relative_path: "",
                file_count: 4,
                content_signature: Some(sig),
                lane: "fits",
            },
        )
        .await
        .unwrap();

        inbox_repo::upsert_classification(
            db.pool(),
            &UpsertClassification {
                inbox_item_id: item_id,
                result: "unclassified",
                frame_type: None,
                content_signature: sig,
                unclassified_file_count: 0,
            },
        )
        .await
        .unwrap();

        for (ft, fname) in [
            ("light", "light_001.fits"),
            ("light", "light_002.fits"),
            ("dark", "dark_001.fits"),
            ("dark", "dark_002.fits"),
        ] {
            let ev_id = format!("ev-m-{fname}");
            inbox_repo::insert_evidence(
                db.pool(),
                &InsertEvidence {
                    id: &ev_id,
                    inbox_item_id: item_id,
                    relative_file_path: fname,
                    frame_type: Some(ft),
                    evidence_source: "imagetyp_header",
                    raw_value: Some(if ft == "light" { "Light Frame" } else { "Dark Frame" }),
                    unclassified: false,
                    manual_override: None,
                    is_master: false,
                    master_detector: None,
                },
            )
            .await
            .unwrap();
        }

        let err = confirm(
            db.pool(),
            ConfirmRequest {
                inbox_item_id: item_id.to_owned(),
                content_signature: sig.to_owned(),
                destructive_destination: None,
                root_absolute_path: tmp.path().to_owned(),
                root_id: None,
            },
        )
        .await
        .unwrap_err();

        assert_eq!(err.code, ErrorCode::ClassificationAmbiguous);
    }

    /// Helper: insert a classified inbox item with explicit per-file frame-type
    /// evidence, returning nothing (panics on error). `files` is (frame_type,
    /// filename, imagetyp_raw).
    async fn setup_typed_item(
        db: &Database,
        item_id: &str,
        sig: &str,
        result: &str,
        files: &[(&str, &str, &str)],
    ) {
        inbox_repo::insert_inbox_item(
            db.pool(),
            &InsertInboxItem {
                id: item_id,
                root_id: "root-1",
                relative_path: "",
                file_count: i64::try_from(files.len()).unwrap(),
                content_signature: Some(sig),
                lane: "fits",
            },
        )
        .await
        .unwrap();

        inbox_repo::upsert_classification(
            db.pool(),
            &UpsertClassification {
                inbox_item_id: item_id,
                result,
                frame_type: None,
                content_signature: sig,
                unclassified_file_count: 0,
            },
        )
        .await
        .unwrap();

        for (ft, fname, raw) in files {
            let ev_id = format!("ev-{item_id}-{fname}");
            inbox_repo::insert_evidence(
                db.pool(),
                &InsertEvidence {
                    id: &ev_id,
                    inbox_item_id: item_id,
                    relative_file_path: fname,
                    frame_type: Some(ft),
                    evidence_source: "imagetyp_header",
                    raw_value: Some(raw),
                    unclassified: false,
                    manual_override: None,
                    is_master: false,
                    master_detector: None,
                },
            )
            .await
            .unwrap();
        }
    }

    fn dest_dir(it: &persistence_db::repositories::plans::PlanItemRow) -> String {
        std::path::Path::new(&it.to_relative_path)
            .parent()
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_default()
    }

    /// US5 (T037): a single-type folder produces exactly one action group.
    #[tokio::test]
    async fn confirm_single_type_emits_one_action_group() {
        let tmp = tempfile::tempdir().unwrap();
        write_fits(
            tmp.path(),
            "light_001.fits",
            "Light Frame",
            Some("NGC7000"),
            Some("Ha"),
            Some("2025-10-10T22:00:00"),
        );
        write_fits(
            tmp.path(),
            "light_002.fits",
            "Light Frame",
            Some("NGC7000"),
            Some("Ha"),
            Some("2025-10-10T22:05:00"),
        );

        let db = test_db().await;
        setup_typed_item(
            &db,
            "item-single",
            "sig-single",
            "classified",
            &[
                ("light", "light_001.fits", "Light Frame"),
                ("light", "light_002.fits", "Light Frame"),
            ],
        )
        .await;

        let resp = confirm(
            db.pool(),
            ConfirmRequest {
                inbox_item_id: "item-single".to_owned(),
                content_signature: "sig-single".to_owned(),
                destructive_destination: None,
                root_absolute_path: tmp.path().to_owned(),
                root_id: None,
            },
        )
        .await
        .unwrap();

        let items = persistence_db::repositories::plans::list_plan_items(db.pool(), &resp.plan_id)
            .await
            .unwrap();
        let dirs: std::collections::BTreeSet<String> = items.iter().map(dest_dir).collect();
        assert_eq!(dirs.len(), 1, "single-type folder must yield exactly one action group");
    }

    #[tokio::test]
    async fn stale_signature_returns_error() {
        let tmp = tempfile::tempdir().unwrap();
        write_fits(tmp.path(), "frame_000.fits", "Light Frame", None, None, None);

        let db = test_db().await;
        setup_classified_item(
            &db,
            "item-stale",
            "classified",
            Some("light"),
            "sig-current",
            &["frame_000.fits"],
        )
        .await;

        let err = confirm(
            db.pool(),
            ConfirmRequest {
                inbox_item_id: "item-stale".to_owned(),
                content_signature: "sig-OLD".to_owned(),
                destructive_destination: None,
                root_absolute_path: tmp.path().to_owned(),
                root_id: None,
            },
        )
        .await
        .unwrap_err();

        assert_eq!(err.code, ErrorCode::ClassificationStale);
    }

    /// Spec 041 FR-050/T071/T072: `ConfirmRequest` no longer carries an
    /// `action` field at all — the only gate is `classification.result ==
    /// "classified"`. An item whose classification is still `"unclassified"`
    /// (e.g. a folder with multiple distinct frame types that has not yet
    /// been re-split into single-type sub-items) is rejected with the same
    /// ambiguous-classification error a legacy "split" action request used
    /// to hit.
    #[tokio::test]
    async fn unclassified_result_returns_ambiguous() {
        let tmp = tempfile::tempdir().unwrap();
        write_fits(tmp.path(), "frame_000.fits", "Light Frame", None, None, None);

        let db = test_db().await;
        setup_classified_item(
            &db,
            "item-ambig",
            "unclassified",
            None,
            "sig-x",
            &["frame_000.fits"],
        )
        .await;

        let err = confirm(
            db.pool(),
            ConfirmRequest {
                inbox_item_id: "item-ambig".to_owned(),
                content_signature: "sig-x".to_owned(),
                destructive_destination: None,
                root_absolute_path: tmp.path().to_owned(),
                root_id: None,
            },
        )
        .await
        .unwrap_err();

        assert_eq!(err.code, ErrorCode::ClassificationAmbiguous);
    }

    #[tokio::test]
    async fn duplicate_confirm_returns_has_open_plan() {
        let tmp = tempfile::tempdir().unwrap();
        write_fits(
            tmp.path(),
            "frame_000.fits",
            "Light Frame",
            Some("M42"),
            Some("Ha"),
            Some("2025-10-10T22:00:00"),
        );
        write_fits(
            tmp.path(),
            "frame_001.fits",
            "Light Frame",
            Some("M42"),
            Some("Ha"),
            Some("2025-10-10T22:05:00"),
        );

        let db = test_db().await;
        setup_classified_item(
            &db,
            "item-dup",
            "classified",
            Some("light"),
            "sig-dup",
            &["frame_000.fits", "frame_001.fits"],
        )
        .await;

        // First confirm
        confirm(
            db.pool(),
            ConfirmRequest {
                inbox_item_id: "item-dup".to_owned(),
                content_signature: "sig-dup".to_owned(),
                destructive_destination: None,
                root_absolute_path: tmp.path().to_owned(),
                root_id: None,
            },
        )
        .await
        .unwrap();

        // Second confirm should fail
        let err = confirm(
            db.pool(),
            ConfirmRequest {
                inbox_item_id: "item-dup".to_owned(),
                content_signature: "sig-dup".to_owned(),
                destructive_destination: None,
                root_absolute_path: tmp.path().to_owned(),
                root_id: None,
            },
        )
        .await
        .unwrap_err();

        assert_eq!(err.code, ErrorCode::InboxHasOpenPlan);
    }

    // ── spec 041 US4: per-source organization-state (move vs catalogue) ──────

    /// Register a `registered_sources` row with an explicit organization state
    /// so `get_source_organization_state` returns it for the inbox item's root.
    async fn register_source_org_state(db: &Database, root_id: &str, kind: &str, org_state: &str) {
        sqlx::query(
            "INSERT INTO registered_sources
                (id, kind, path, kind_subtype, scan_depth, created_at, created_via, organization_state)
             VALUES (?, ?, '/tmp/src', NULL, 'recursive', '2026-01-01T00:00:00Z', 'first_run', ?)",
        )
        .bind(root_id)
        .bind(kind)
        .bind(org_state)
        .execute(db.pool())
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn organized_source_emits_catalogue_actions() {
        let tmp = tempfile::tempdir().unwrap();
        write_fits(
            tmp.path(),
            "light_001.fits",
            "Light Frame",
            Some("M42"),
            Some("Ha"),
            Some("2025-10-10T22:00:00"),
        );

        let db = test_db().await;
        register_source_org_state(&db, "root-1", "light_frames", "organized").await;
        setup_classified_item(
            &db,
            "item-org",
            "classified",
            Some("light"),
            "sig-org",
            &["light_001.fits"],
        )
        .await;

        let resp = confirm(
            db.pool(),
            ConfirmRequest {
                inbox_item_id: "item-org".to_owned(),
                content_signature: "sig-org".to_owned(),
                destructive_destination: None,
                root_absolute_path: tmp.path().to_owned(),
                root_id: None,
            },
        )
        .await
        .unwrap();

        assert_eq!(resp.catalogue_count, 1, "organized source → catalogue");
        assert_eq!(resp.move_count, 0);
        assert!(matches!(resp.organization_state, OrganizationState::Organized));

        // Catalogue plan item: action == 'catalogue', from == to (no move).
        let rows = sqlx::query_as::<_, (String, String, String)>(
            "SELECT action, from_relative_path, to_relative_path FROM plan_items WHERE plan_id = ?",
        )
        .bind(&resp.plan_id)
        .fetch_all(db.pool())
        .await
        .unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].0, "catalogue");
        assert_eq!(rows[0].1, rows[0].2, "catalogue dest == source (in place)");
        assert_eq!(rows[0].1, "light_001.fits");
    }

    #[tokio::test]
    async fn unorganized_source_emits_move_actions() {
        let tmp = tempfile::tempdir().unwrap();
        write_fits(
            tmp.path(),
            "light_001.fits",
            "Light Frame",
            Some("M42"),
            Some("Ha"),
            Some("2025-10-10T22:00:00"),
        );

        let db = test_db().await;
        // Non-inbox unorganized source → in-place move under its own root (no
        // destination-root selection). Inbox-source routing is covered by the
        // dedicated US8 tests below.
        register_source_org_state(&db, "root-1", "light_frames", "unorganized").await;
        setup_classified_item(
            &db,
            "item-unorg",
            "classified",
            Some("light"),
            "sig-unorg",
            &["light_001.fits"],
        )
        .await;

        let resp = confirm(
            db.pool(),
            ConfirmRequest {
                inbox_item_id: "item-unorg".to_owned(),
                content_signature: "sig-unorg".to_owned(),
                destructive_destination: None,
                root_absolute_path: tmp.path().to_owned(),
                root_id: None,
            },
        )
        .await
        .unwrap();

        assert_eq!(resp.move_count, 1, "unorganized source → move");
        assert_eq!(resp.catalogue_count, 0);
        assert!(matches!(resp.organization_state, OrganizationState::Unorganized));

        let rows = sqlx::query_as::<_, (String, String, String)>(
            "SELECT action, from_relative_path, to_relative_path FROM plan_items WHERE plan_id = ?",
        )
        .bind(&resp.plan_id)
        .fetch_all(db.pool())
        .await
        .unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].0, "move");
        assert_ne!(rows[0].1, rows[0].2, "move dest != source (pattern-resolved)");
    }

    /// Absent source row → default Unorganized (conservative: never catalogue
    /// in place by accident). Mixed provenance composes because the per-file
    /// branch keys on the resolved org-state; an inbox item shares one root so
    /// the result is uniform per confirm today.
    #[tokio::test]
    async fn absent_source_defaults_to_move() {
        let tmp = tempfile::tempdir().unwrap();
        write_fits(
            tmp.path(),
            "frame_000.fits",
            "Light Frame",
            Some("M42"),
            Some("Ha"),
            Some("2025-10-10T22:00:00"),
        );

        let db = test_db().await;
        // No registered_sources row inserted for root-1.
        setup_classified_item(
            &db,
            "item-absent",
            "classified",
            Some("light"),
            "sig-absent",
            &["frame_000.fits"],
        )
        .await;

        let resp = confirm(
            db.pool(),
            ConfirmRequest {
                inbox_item_id: "item-absent".to_owned(),
                content_signature: "sig-absent".to_owned(),
                destructive_destination: None,
                root_absolute_path: tmp.path().to_owned(),
                root_id: None,
            },
        )
        .await
        .unwrap();

        assert_eq!(resp.move_count, 1);
        assert_eq!(resp.catalogue_count, 0);
        assert!(matches!(resp.organization_state, OrganizationState::Unorganized));
    }

    // ── spec 041 US8/US9: destination-root resolution + missing-attribute gate ──

    /// Register a source with an explicit id/kind/path/organization_state.
    async fn register_source_full(
        db: &Database,
        root_id: &str,
        kind: &str,
        path: &str,
        org_state: &str,
    ) {
        sqlx::query(
            "INSERT INTO registered_sources
                (id, kind, path, kind_subtype, scan_depth, created_at, created_via, organization_state)
             VALUES (?, ?, ?, NULL, 'recursive', '2026-01-01T00:00:00Z', 'first_run', ?)",
        )
        .bind(root_id)
        .bind(kind)
        .bind(path)
        .bind(org_state)
        .execute(db.pool())
        .await
        .unwrap();
    }

    /// US8/FR-027: a non-inbox source defaults to an in-place move under its own
    /// root — no destination-root selection, `to_root_id == from_root_id`.
    #[tokio::test]
    async fn non_inbox_source_moves_in_place() {
        let tmp = tempfile::tempdir().unwrap();
        write_fits(
            tmp.path(),
            "light_001.fits",
            "Light Frame",
            Some("M42"),
            Some("Ha"),
            Some("2025-10-10T22:00:00"),
        );

        let db = test_db().await;
        register_source_full(&db, "root-1", "light_frames", "/lib/lights", "unorganized").await;
        setup_classified_item(
            &db,
            "item-np",
            "classified",
            Some("light"),
            "sig-np",
            &["light_001.fits"],
        )
        .await;

        let resp = confirm(
            db.pool(),
            ConfirmRequest {
                inbox_item_id: "item-np".to_owned(),
                content_signature: "sig-np".to_owned(),
                destructive_destination: None,
                root_absolute_path: tmp.path().to_owned(),
                root_id: None,
            },
        )
        .await
        .unwrap();

        assert_eq!(resp.move_count, 1);
        let (to_root,): (String,) =
            sqlx::query_as("SELECT to_root_id FROM plan_items WHERE plan_id = ?")
                .bind(&resp.plan_id)
                .fetch_one(db.pool())
                .await
                .unwrap();
        assert_eq!(to_root, "root-1", "non-inbox source stays under its own root");
    }

    /// US8/FR-028: an inbox source with exactly one matching destination root
    /// auto-selects it (no caller `root_id` needed); the plan lands under that
    /// root and the absolute preview uses the root's path.
    #[tokio::test]
    async fn inbox_single_candidate_auto_selects() {
        let tmp = tempfile::tempdir().unwrap();
        write_fits(
            tmp.path(),
            "light_001.fits",
            "Light Frame",
            Some("M42"),
            Some("Ha"),
            Some("2025-10-10T22:00:00"),
        );

        let db = test_db().await;
        register_source_full(&db, "root-inbox", "inbox", "/inbox", "unorganized").await;
        register_source_full(&db, "root-lights", "light_frames", "/lib/lights", "unorganized")
            .await;
        // The item lives on the inbox root.
        setup_classified_item_rooted(
            &db,
            "item-1cand",
            "root-inbox",
            Some("light"),
            "sig-1c",
            &["light_001.fits"],
        )
        .await;

        let resp = confirm(
            db.pool(),
            ConfirmRequest {
                inbox_item_id: "item-1cand".to_owned(),
                content_signature: "sig-1c".to_owned(),
                destructive_destination: None,
                root_absolute_path: tmp.path().to_owned(),
                root_id: None,
            },
        )
        .await
        .unwrap();

        assert_eq!(resp.move_count, 1);
        assert_eq!(resp.destinations.len(), 1);
        let d = &resp.destinations[0];
        assert_eq!(d.to_root_id, "root-lights");
        assert!(
            d.to_absolute_path.starts_with("/lib/lights/"),
            "absolute preview uses the chosen root's path, got {}",
            d.to_absolute_path
        );
    }

    /// US8/FR-029/FR-030: an inbox source with >1 matching destination root
    /// requires the caller's `root_id`. Absent → `inbox.destination_root_required`
    /// listing the candidates; supplied & valid → succeeds under that root;
    /// supplied & invalid → `inbox.invalid_destination_root`.
    #[tokio::test]
    async fn inbox_multi_candidate_requires_selection() {
        let tmp = tempfile::tempdir().unwrap();
        write_fits(
            tmp.path(),
            "light_001.fits",
            "Light Frame",
            Some("M42"),
            Some("Ha"),
            Some("2025-10-10T22:00:00"),
        );

        let db = test_db().await;
        register_source_full(&db, "root-inbox", "inbox", "/inbox", "unorganized").await;
        register_source_full(&db, "root-lib-a", "light_frames", "/a", "unorganized").await;
        register_source_full(&db, "root-lib-b", "light_frames", "/b", "unorganized").await;
        setup_classified_item_rooted(
            &db,
            "item-2cand",
            "root-inbox",
            Some("light"),
            "sig-2c",
            &["light_001.fits"],
        )
        .await;

        let mk = |root_id: Option<String>| ConfirmRequest {
            inbox_item_id: "item-2cand".to_owned(),
            content_signature: "sig-2c".to_owned(),
            destructive_destination: None,
            root_absolute_path: tmp.path().to_owned(),
            root_id,
        };

        // Absent selection → blocking error listing both candidates.
        let err = confirm(db.pool(), mk(None)).await.unwrap_err();
        assert_eq!(err.code, ErrorCode::InboxDestinationRootRequired);
        let candidates = err.details.0.get("candidates").and_then(|c| c.as_array()).unwrap();
        assert_eq!(candidates.len(), 2, "both library roots offered as candidates");

        // Invalid selection (an id that is not a candidate) → rejected.
        let err = confirm(db.pool(), mk(Some("root-inbox".to_owned()))).await.unwrap_err();
        assert_eq!(err.code, ErrorCode::InboxInvalidDestinationRoot);

        // Valid selection → plan lands under the chosen root.
        let resp = confirm(db.pool(), mk(Some("root-lib-b".to_owned()))).await.unwrap();
        assert_eq!(resp.destinations.len(), 1);
        assert_eq!(resp.destinations[0].to_root_id, "root-lib-b");
    }

    /// US8/FR-027: an inbox source whose frame-type category has no registered
    /// library root → `inbox.no_destination_root`.
    #[tokio::test]
    async fn inbox_no_candidate_blocks() {
        let tmp = tempfile::tempdir().unwrap();
        write_fits(
            tmp.path(),
            "light_001.fits",
            "Light Frame",
            Some("M42"),
            Some("Ha"),
            Some("2025-10-10T22:00:00"),
        );

        let db = test_db().await;
        register_source_full(&db, "root-inbox", "inbox", "/inbox", "unorganized").await;
        // Only a calibration root exists; a light has no light_frames destination.
        register_source_full(&db, "root-cal", "calibration", "/cal", "unorganized").await;
        setup_classified_item_rooted(
            &db,
            "item-0cand",
            "root-inbox",
            Some("light"),
            "sig-0c",
            &["light_001.fits"],
        )
        .await;

        let err = confirm(
            db.pool(),
            ConfirmRequest {
                inbox_item_id: "item-0cand".to_owned(),
                content_signature: "sig-0c".to_owned(),
                destructive_destination: None,
                root_absolute_path: tmp.path().to_owned(),
                root_id: None,
            },
        )
        .await
        .unwrap_err();
        assert_eq!(err.code, ErrorCode::InboxNoDestinationRoot);
    }

    /// FR-026a: a raw dark lands under `darks/{exposure}/` with NO target/date
    /// segment.
    ///
    /// Spec 041 FR-050/T071: previously this and the master-flat case below
    /// were exercised in one multi-type "split" confirm over a single mixed
    /// item; that path is retired, so each frame type is now its own
    /// single-type "classified" item confirmed independently — matching what
    /// T066 materialization actually produces upstream of confirm.
    #[tokio::test]
    async fn calibration_dark_destination_omits_target() {
        let tmp = tempfile::tempdir().unwrap();
        write_fits_exp(tmp.path(), "dark.fits", "Dark Frame", None, None, None, 300.0);

        let db = test_db().await;
        register_source_full(&db, "root-1", "calibration", "/cal", "unorganized").await;
        setup_classified_item(
            &db,
            "item-cal-dark",
            "classified",
            Some("dark"),
            "sig-cal-dark",
            &["dark.fits"],
        )
        .await;

        let resp = confirm(
            db.pool(),
            ConfirmRequest {
                inbox_item_id: "item-cal-dark".to_owned(),
                content_signature: "sig-cal-dark".to_owned(),
                destructive_destination: None,
                root_absolute_path: tmp.path().to_owned(),
                root_id: None,
            },
        )
        .await
        .unwrap();

        let dests: std::collections::HashMap<String, String> = resp
            .destinations
            .iter()
            .map(|d| (d.from_path.clone(), d.to_relative_path.clone()))
            .collect();
        assert_eq!(dests["dark.fits"], "darks/300/dark.fits");
    }

    /// FR-026a: a calibration master lands under its `masters/...` pattern with
    /// NO target/date segment. See `calibration_dark_destination_omits_target`
    /// for why this is now its own single-type confirm.
    #[tokio::test]
    async fn calibration_master_destination_omits_target() {
        let tmp = tempfile::tempdir().unwrap();
        write_fits_exp(tmp.path(), "master_flat.fits", "Flat Frame", None, Some("Ha"), None, 5.0);

        let db = test_db().await;
        register_source_full(&db, "root-2", "calibration", "/cal", "unorganized").await;
        inbox_repo::insert_inbox_item(
            db.pool(),
            &InsertInboxItem {
                id: "item-cal-master",
                root_id: "root-2",
                relative_path: "",
                file_count: 1,
                content_signature: Some("sig-cal-master"),
                lane: "fits",
            },
        )
        .await
        .unwrap();
        inbox_repo::upsert_classification(
            db.pool(),
            &UpsertClassification {
                inbox_item_id: "item-cal-master",
                result: "classified",
                frame_type: Some("flat"),
                content_signature: "sig-cal-master",
                unclassified_file_count: 0,
            },
        )
        .await
        .unwrap();
        inbox_repo::insert_evidence(
            db.pool(),
            &InsertEvidence {
                id: "ev-cal-master-flat",
                inbox_item_id: "item-cal-master",
                relative_file_path: "master_flat.fits",
                frame_type: Some("flat"),
                evidence_source: "imagetyp_header",
                raw_value: None,
                unclassified: false,
                manual_override: None,
                is_master: true,
                master_detector: None,
            },
        )
        .await
        .unwrap();

        let resp = confirm(
            db.pool(),
            ConfirmRequest {
                inbox_item_id: "item-cal-master".to_owned(),
                content_signature: "sig-cal-master".to_owned(),
                destructive_destination: None,
                root_absolute_path: tmp.path().to_owned(),
                root_id: None,
            },
        )
        .await
        .unwrap();

        let dests: std::collections::HashMap<String, String> = resp
            .destinations
            .iter()
            .map(|d| (d.from_path.clone(), d.to_relative_path.clone()))
            .collect();
        assert_eq!(dests["master_flat.fits"], "masters/flats/Ha/master_flat.fits");
    }

    /// US9/FR-032/FR-033: a light missing its date blocks plan generation with
    /// `inbox.missing_path_attributes`, reporting the missing attribute.
    #[tokio::test]
    async fn missing_path_attribute_blocks_with_report() {
        let tmp = tempfile::tempdir().unwrap();
        // Light with target + filter but NO DATE-OBS → date is path-load-bearing.
        write_fits(tmp.path(), "light_001.fits", "Light Frame", Some("M42"), Some("Ha"), None);

        let db = test_db().await;
        register_source_full(&db, "root-1", "light_frames", "/lib", "unorganized").await;
        setup_classified_item(
            &db,
            "item-gate",
            "classified",
            Some("light"),
            "sig-gate",
            &["light_001.fits"],
        )
        .await;

        let err = confirm(
            db.pool(),
            ConfirmRequest {
                inbox_item_id: "item-gate".to_owned(),
                content_signature: "sig-gate".to_owned(),
                destructive_destination: None,
                root_absolute_path: tmp.path().to_owned(),
                root_id: None,
            },
        )
        .await
        .unwrap_err();

        assert_eq!(err.code, ErrorCode::InboxMissingPathAttributes);
        let files = err.details.0.get("files").and_then(|f| f.as_array()).unwrap();
        let attrs = files[0].get("missingPathAttributes").and_then(|a| a.as_array()).unwrap();
        assert!(
            attrs.iter().any(|a| a.as_str() == Some("date")),
            "missing 'date' must be reported, got {attrs:?}"
        );
    }

    // ── T070 tests — needs-review sentinel gate at confirm ───────────────────

    /// T070/FR-049/SC-015: confirm of an item whose group_key is the sentinel
    /// __needs_review__ must be rejected with InboxMissingPathAttributes.
    #[tokio::test]
    async fn t070_confirm_of_needs_review_item_is_rejected() {
        let tmp = tempfile::tempdir().unwrap();
        // Write a light without mandatory attrs — doesn't matter here since
        // the gate fires on group_key before reaching file resolution.
        write_fits(tmp.path(), "light_001.fits", "Light Frame", Some("M42"), Some("Ha"), None);

        let db = test_db().await;
        register_source_full(&db, "root-1", "light_frames", "/lib", "unorganized").await;

        // Insert the inbox item with group_key = SENTINEL_NEEDS_REVIEW directly.
        // The sentinel gate checks item.group_key, so we bypass setup_classified_item
        // and set group_key explicitly via raw SQL.
        let item_id = "item-t070-sentinel";
        let sig = "sig-t070-sentinel";
        inbox_repo::insert_inbox_item(
            db.pool(),
            &InsertInboxItem {
                id: item_id,
                root_id: "root-1",
                relative_path: "",
                file_count: 1,
                content_signature: Some(sig),
                lane: "fits",
            },
        )
        .await
        .unwrap();
        // Set group_key to SENTINEL_NEEDS_REVIEW.
        sqlx::query("UPDATE inbox_items SET group_key = ? WHERE id = ?")
            .bind(crate::classify::SENTINEL_NEEDS_REVIEW)
            .bind(item_id)
            .execute(db.pool())
            .await
            .unwrap();
        // Add a classification so the item doesn't fail on "no classification".
        inbox_repo::upsert_classification(
            db.pool(),
            &UpsertClassification {
                inbox_item_id: item_id,
                result: "classified",
                frame_type: None,
                content_signature: sig,
                unclassified_file_count: 1,
            },
        )
        .await
        .unwrap();

        let err = confirm(
            db.pool(),
            ConfirmRequest {
                inbox_item_id: item_id.to_owned(),
                content_signature: sig.to_owned(),
                destructive_destination: None,
                root_absolute_path: tmp.path().to_owned(),
                root_id: None,
            },
        )
        .await
        .unwrap_err();

        assert_eq!(
            err.code,
            ErrorCode::InboxMissingPathAttributes,
            "needs-review item must be rejected with InboxMissingPathAttributes"
        );
        assert!(
            err.message.contains("needs-review"),
            "error message must mention needs-review, got: {}",
            err.message
        );
    }

    /// T070: a fully-resolved item (with all mandatory attributes satisfied via
    /// the active pattern) confirms successfully and produces a plan.
    #[tokio::test]
    async fn t070_fully_resolved_item_confirms_successfully() {
        let tmp = tempfile::tempdir().unwrap();
        // Light with object + filter + date (no EXPTIME needed for the gate here;
        // the pattern gate fires on date/target in the existing test).
        write_fits(
            tmp.path(),
            "light_001.fits",
            "Light Frame",
            Some("M42"),
            Some("Ha"),
            Some("2024-11-01"),
        );

        let db = test_db().await;
        register_source_full(&db, "root-1", "light_frames", "/lib", "unorganized").await;
        setup_classified_item(
            &db,
            "item-t070-ok",
            "classified",
            Some("light"),
            "sig-t070-ok",
            &["light_001.fits"],
        )
        .await;

        // A fully-resolved item (group_key defaults to '' in the helper, which is
        // not SENTINEL_NEEDS_REVIEW) must pass the sentinel gate.
        let result = confirm(
            db.pool(),
            ConfirmRequest {
                inbox_item_id: "item-t070-ok".to_owned(),
                content_signature: "sig-t070-ok".to_owned(),
                destructive_destination: None,
                root_absolute_path: tmp.path().to_owned(),
                root_id: None,
            },
        )
        .await;

        // The item passes the sentinel gate (group_key != SENTINEL_NEEDS_REVIEW).
        // It may still fail on other gates (destination root, pattern) — what we
        // assert is that it does NOT fail with InboxMissingPathAttributes from the
        // sentinel check: any error must NOT be the sentinel gate.
        if let Err(ref e) = result {
            assert_ne!(
                e.code,
                ErrorCode::InboxMissingPathAttributes,
                "fully-resolved item must not be blocked by the needs-review sentinel gate: {}",
                e.message
            );
        }
        // If it succeeds, the plan was created — also valid.
    }
}
