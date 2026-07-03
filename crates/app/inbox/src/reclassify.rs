//! `inbox.reclassify` use case (spec 005, T-ReclassifyImpl).
//!
//! Writes `manual_override` to `InboxClassificationEvidence` rows, re-runs
//! aggregation, and returns the updated classification type plus count of
//! remaining unclassified files.
//!
//! Spec 041 T068 adds `reclassify_v2`: field-agnostic + bulk reclassify
//! operating at source-group scope with re-split via `materialize_sub_items`.
//!
//! Reclassification is NOT permitted while a plan is open (Ref: E1 variant).
#![allow(clippy::doc_markdown)]

use std::collections::HashMap;

use metadata_core;
use persistence_db::repositories::inbox::{self as inbox_repo};
use sqlx::SqlitePool;
use uuid::Uuid;

use app_core_errors::db_internal_ctx;
use contracts_core::error_code::ErrorCode;
use contracts_core::{ContractError, ErrorSeverity};

// ── Request / Response ────────────────────────────────────────────────────────

#[derive(Clone, Debug, Default)]
pub struct ReclassifyOverride {
    pub file_path: String,
    /// Frame-type override.  Empty string means "no type override" and maps to
    /// `None` on the evidence row (leave existing `manual_override` unchanged).
    pub frame_type: String,
    /// Non-type overrides (spec 041 US3 / R-4).  All default to `None`.
    pub filter: Option<String>,
    pub exposure_s: Option<f64>,
    pub binning: Option<String>,
}

#[derive(Clone, Debug)]
pub struct ReclassifyRequest {
    pub inbox_item_id: String,
    pub overrides: Vec<ReclassifyOverride>,
}

#[derive(Clone, Debug)]
pub struct ReclassifyResponse {
    pub inbox_item_id: String,
    pub updated_type: String,
    pub frame_type: Option<String>,
    pub remaining_unclassified: usize,
    pub applied_count: usize,
}

// ── reclassify ────────────────────────────────────────────────────────────────

/// Apply manual frame-type overrides and re-aggregate the classification.
///
/// # Errors
///
/// - `inbox.item.not_found` — item does not exist.
/// - `inbox.has.open.plan` — reclassification blocked by an open plan.
/// - `file.not_found` — one or more file paths don't match evidence rows.
#[allow(clippy::too_many_lines)] // sequential reclassify pipeline reads clearer inline
pub async fn reclassify(
    pool: &SqlitePool,
    req: ReclassifyRequest,
) -> Result<ReclassifyResponse, ContractError> {
    // 1. Verify item exists
    let item = inbox_repo::get_inbox_item(pool, &req.inbox_item_id).await.map_err(|_| {
        ContractError::new(
            ErrorCode::InboxItemNotFound,
            format!("InboxItem not found: {}", req.inbox_item_id),
            ErrorSeverity::Blocking,
            false,
        )
    })?;

    // 2. Block if open plan exists (Ref: E1)
    if inbox_repo::get_plan_link(pool, &req.inbox_item_id).await.unwrap_or(None).is_some() {
        return Err(ContractError::new(
            ErrorCode::InboxHasOpenPlan,
            "Reclassification is not permitted while a plan is open.",
            ErrorSeverity::Blocking,
            false,
        ));
    }

    // 3. Validate file paths exist in evidence
    let evidence = inbox_repo::list_evidence(pool, &req.inbox_item_id)
        .await
        .map_err(|e| db_internal_ctx(e, "list inbox evidence"))?;

    let known_paths: std::collections::HashSet<&str> =
        evidence.iter().map(|ev| ev.relative_file_path.as_str()).collect();

    let missing: Vec<&str> = req
        .overrides
        .iter()
        .map(|o| o.file_path.as_str())
        .filter(|p| !known_paths.contains(p))
        .collect();

    if !missing.is_empty() {
        return Err(ContractError::new(
            ErrorCode::FileNotFound,
            format!("File paths not found in evidence: {missing:?}"),
            ErrorSeverity::Blocking,
            false,
        ));
    }

    // 4. Apply overrides
    let mut applied_count = 0usize;
    for o in &req.overrides {
        // Empty frame_type string = "no type override" → pass None so the
        // existing manual_override column is left unchanged (COALESCE).
        let frame_type_opt =
            if o.frame_type.is_empty() { None } else { Some(o.frame_type.as_str()) };
        let updated = inbox_repo::set_overrides(
            pool,
            &req.inbox_item_id,
            &o.file_path,
            frame_type_opt,
            o.filter.as_deref(),
            o.exposure_s,
            o.binning.as_deref(),
        )
        .await
        .map_err(|e| db_internal_ctx(e, "set evidence overrides"))?;
        if updated {
            applied_count += 1;
        }
    }

    // spec 041 US2/T016: per-file `inbox_file_metadata` rows are NOT rewritten
    // here. Reclassify carries no root path and cannot re-read file headers, so
    // the extracted header values persisted at classify time remain authoritative
    // for the (unchanged) files. Override values (frame type / filter / exposure /
    // binning) live on the evidence row and are assembled into the metadata DTO
    // by `get_inbox_item_metadata`; `override_stale` (size/mtime drift, R-4) is
    // computed there. Clearing the table without re-extraction would destroy
    // valid header data, so we deliberately leave it intact.

    // 5. Re-aggregate: re-load all evidence (overrides now set)
    let updated_evidence = inbox_repo::list_evidence(pool, &req.inbox_item_id)
        .await
        .map_err(|e| db_internal_ctx(e, "list inbox evidence"))?;

    let mut frame_types: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut remaining_unclassified = 0usize;

    for ev in &updated_evidence {
        let effective = ev.manual_override.as_deref().or(ev.frame_type.as_deref());

        if let Some(ft) = effective {
            frame_types.insert(ft.to_owned());
        } else if ev.unclassified != 0 {
            remaining_unclassified += 1;
        }
    }

    // DB values (migration 0048 CHECK): 'classified' / 'unclassified'.
    // API values (stable frontend vocabulary): 'single_type' / 'mixed' / 'unclassified'.
    let (db_result, updated_type, single_frame_type) = match frame_types.len() {
        0 => ("unclassified".to_owned(), "unclassified".to_owned(), None),
        1 => ("classified".to_owned(), "single_type".to_owned(), frame_types.into_iter().next()),
        _ => ("unclassified".to_owned(), "mixed".to_owned(), None),
    };

    // 6. Update persisted classification
    inbox_repo::upsert_classification(
        pool,
        &persistence_db::repositories::inbox::UpsertClassification {
            inbox_item_id: &req.inbox_item_id,
            result: &db_result,
            frame_type: single_frame_type.as_deref(),
            content_signature: item.content_signature.as_deref().unwrap_or(""),
            unclassified_file_count: i64::try_from(remaining_unclassified).unwrap_or(i64::MAX),
        },
    )
    .await
    .ok();

    // 7. Rebuild breakdown rows so the next classify cache hit returns fresh
    //    counts and samples (fixes stale/empty breakdown after override apply).
    //    Group evidence by effective frame type, then upsert one row per type.
    //    destination_preview is left None — computed on the next force-classify.
    {
        let mut groups: HashMap<String, Vec<String>> = HashMap::new();
        for ev in &updated_evidence {
            let effective = ev.manual_override.as_deref().or(ev.frame_type.as_deref());
            if let Some(ft) = effective {
                groups.entry(ft.to_owned()).or_default().push(ev.relative_file_path.clone());
            }
        }

        for (kind, paths) in &groups {
            let count = i64::try_from(paths.len()).unwrap_or(i64::MAX);
            let samples: Vec<&str> = paths.iter().take(10).map(String::as_str).collect();
            let sample_json = serde_json::to_string(&samples).unwrap_or_else(|_| "[]".to_owned());
            let row_id = Uuid::new_v4().to_string();
            inbox_repo::upsert_breakdown_row(
                pool,
                &row_id,
                &req.inbox_item_id,
                kind,
                count,
                None,
                &sample_json,
            )
            .await
            .ok();
        }
    }

    Ok(ReclassifyResponse {
        inbox_item_id: req.inbox_item_id,
        updated_type,
        frame_type: single_frame_type,
        remaining_unclassified,
        applied_count,
    })
}

// ── reclassify_v2 (T068 — field-agnostic + bulk + re-split) ──────────────────

/// Apply field-agnostic reclassify at source-group scope (spec 041 T068 / R-13).
///
/// # Overview
///
/// 1. Resolves the source group from `source_group_id` or `inbox_item_id`.
/// 2. Validates all property keys against the registry — rejects unknown or
///    non-overridable keys.
/// 3. Expands bulk entries (omitted `file_paths` = all files in the group).
/// 4. Applies per-file overrides: for each property,
///    - If the property is `frameType` (the one explicit-correction exception):
///      writes `manual_override` on the evidence row (always accepted, R-13).
///    - Otherwise (fill-missing-only): writes to `inbox_file_overrides` via
///      `set_file_override`. Header-present values in `inbox_file_metadata` are
///      NOT overwritten — index-only, never writes to files.
/// 5. Re-runs classification + grouping by calling `materialize_sub_items`
///    (the T066 stable API) to re-partition files and upsert sub-items.
/// 6. Returns the re-materialized sub-item list + `needs_review_count`.
///
/// # Errors
///
/// - `inbox.item.not_found` — neither source group nor item found.
/// - `inbox.has.open.plan` — one or more sub-items in the group have an open
///   plan (block all reclassify on the group, same as the v1 item-scope block).
/// - `file.not_found` — a path in `overrides` or `bulk.file_paths` is not
///   present in the group's evidence.
/// - `inbox.reclassify.unknown_property` — a property key is not in the registry.
/// - `inbox.reclassify.non_overridable_property` — a property key exists in the
///   registry but `overridable = false`.
#[allow(clippy::too_many_lines)] // sequential reclassify-v2 pipeline; splitting degrades clarity
pub async fn reclassify_v2(
    pool: &SqlitePool,
    req: contracts_core::inbox::InboxReclassifyV2Request,
) -> Result<contracts_core::inbox::InboxReclassifyV2Response, ContractError> {
    use contracts_core::inbox::{InboxReclassifyV2Response, InboxSubItemSummary};

    // ── 1. Resolve source group ───────────────────────────────────────────────

    let source_group_id = match (req.source_group_id, req.inbox_item_id) {
        (Some(sg), _) => {
            // Verify the source group exists.
            let exists: Option<(String,)> =
                sqlx::query_as("SELECT id FROM inbox_source_groups WHERE id = ?")
                    .bind(&sg)
                    .fetch_optional(pool)
                    .await
                    .map_err(|e| db_internal_ctx(e, "look up source group"))?;
            if exists.is_none() {
                return Err(ContractError::new(
                    ErrorCode::InboxItemNotFound,
                    format!("Source group not found: {sg}"),
                    ErrorSeverity::Blocking,
                    false,
                ));
            }
            sg
        }
        (None, Some(item_id)) => inbox_repo::get_source_group_id_for_item(pool, &item_id)
            .await
            .map_err(|e| db_internal_ctx(e, "look up source_group_id for item"))?
            .ok_or_else(|| {
                ContractError::new(
                    ErrorCode::InboxItemNotFound,
                    format!("InboxItem not found or has no source group: {item_id}"),
                    ErrorSeverity::Blocking,
                    false,
                )
            })?,
        (None, None) => {
            return Err(ContractError::new(
                ErrorCode::InboxItemNotFound,
                "Either sourceGroupId or inboxItemId must be provided",
                ErrorSeverity::Blocking,
                false,
            ));
        }
    };

    // ── 2. Block if any sub-item in the group has an open plan ────────────────

    let sub_item_ids = inbox_repo::list_item_ids_for_source_group(pool, &source_group_id)
        .await
        .map_err(|e| db_internal_ctx(e, "list sub-items for source group"))?;

    for item_id in &sub_item_ids {
        if inbox_repo::get_plan_link(pool, item_id).await.unwrap_or(None).is_some() {
            return Err(ContractError::new(
                ErrorCode::InboxHasOpenPlan,
                "Reclassification is not permitted while a plan is open for any sub-item in this group.",
                ErrorSeverity::Blocking,
                false,
            ));
        }
    }

    // ── 3. Build the property registry lookup map ─────────────────────────────

    let registry = super::property_registry::property_registry();
    // key → overridable
    let registry_map: HashMap<&str, bool> =
        registry.iter().map(|e| (e.key.as_str(), e.overridable)).collect();

    // Helper: validate a single property key.
    let validate_key = |key: &str| -> Result<(), ContractError> {
        match registry_map.get(key) {
            None => Err(ContractError::new(
                ErrorCode::ValidationRequestEnvelopeInvalid,
                format!("Unknown property key: '{key}' — not in property registry"),
                ErrorSeverity::Blocking,
                false,
            )),
            Some(false) => Err(ContractError::new(
                ErrorCode::ValidationRequestEnvelopeInvalid,
                format!(
                    "Property '{key}' is informational/derived and cannot be overridden (overridable=false)"
                ),
                ErrorSeverity::Blocking,
                false,
            )),
            Some(true) => Ok(()),
        }
    };

    // Validate all keys upfront so we reject the whole request before writing.
    for file_override in &req.overrides {
        for key in file_override.properties.keys() {
            validate_key(key)?;
        }
    }
    for bulk in &req.bulk {
        validate_key(&bulk.property)?;
    }

    // ── 4. Gather all evidence paths for the group ────────────────────────────
    //
    // Evidence rows are keyed by inbox_item_id, so we need to iterate over all
    // sub-items in the group to get their file paths.

    // Build a flat map: relative_file_path → inbox_item_id
    let mut path_to_item: HashMap<String, String> = HashMap::new();
    for item_id in &sub_item_ids {
        let evidence = inbox_repo::list_evidence(pool, item_id)
            .await
            .map_err(|e| db_internal_ctx(e, "list evidence for sub-item"))?;
        for ev in evidence {
            path_to_item.insert(ev.relative_file_path, item_id.clone());
        }
    }
    let all_paths: std::collections::HashSet<&str> =
        path_to_item.keys().map(String::as_str).collect();

    // ── 5. Validate that all requested file paths exist in the group ──────────

    for file_override in &req.overrides {
        if !all_paths.contains(file_override.file_path.as_str()) {
            return Err(ContractError::new(
                ErrorCode::FileNotFound,
                format!(
                    "File path '{}' not found in evidence for source group '{source_group_id}'",
                    file_override.file_path
                ),
                ErrorSeverity::Blocking,
                false,
            ));
        }
    }
    for bulk in &req.bulk {
        if let Some(paths) = &bulk.file_paths {
            for p in paths {
                if !all_paths.contains(p.as_str()) {
                    return Err(ContractError::new(
                        ErrorCode::FileNotFound,
                        format!(
                            "Bulk file path '{p}' not found in evidence for source group '{source_group_id}'"
                        ),
                        ErrorSeverity::Blocking,
                        false,
                    ));
                }
            }
        }
    }

    // ── 6. Expand bulk entries into per-file overrides ────────────────────────
    //
    // Bulk entries are appended AFTER per-file overrides; later entries
    // overwrite earlier ones for the same (file, key) pair. We collect into a
    // Vec<(file_path, property_key, json_value)> and process in order.

    let mut effective_overrides: Vec<(String, String, serde_json::Value)> = Vec::new();

    // Per-file overrides first.
    for file_override in &req.overrides {
        for (key, val) in &file_override.properties {
            effective_overrides.push((file_override.file_path.clone(), key.clone(), val.clone()));
        }
    }

    // Bulk entries second (may overwrite per-file values for the same key).
    for bulk in &req.bulk {
        let target_paths: Vec<String> = match &bulk.file_paths {
            None => path_to_item.keys().cloned().collect(),
            Some(fps) => fps.clone(),
        };
        for p in target_paths {
            effective_overrides.push((p, bulk.property.clone(), bulk.value.clone()));
        }
    }

    // ── 7. Persist overrides ──────────────────────────────────────────────────
    //
    // For `frameType`: write `manual_override` on the evidence row (the one
    // explicit-correction exception, R-13).
    //
    // For all other overridable properties: persist to `inbox_file_overrides`
    // via `set_file_override`. Fill-missing-only semantics: the UI enforces this
    // by not sending overrides for header-present values; we do NOT re-read
    // headers here (no root path available). The contract states: "fills only
    // MISSING/unreadable properties — values present in the header are read-only"
    // (R-13 editing semantics). Index-only — never writes to user files.

    for (file_path, property_key, json_val) in &effective_overrides {
        let inbox_item_id = path_to_item.get(file_path.as_str()).ok_or_else(|| {
            ContractError::new(
                ErrorCode::FileNotFound,
                format!("File path '{file_path}' not found in group during write phase"),
                ErrorSeverity::Blocking,
                false,
            )
        })?;

        if property_key == "frameType" {
            // Frame-type correction: write manual_override on the evidence row.
            let frame_type_str = match json_val {
                serde_json::Value::String(s) if !s.is_empty() => s.as_str(),
                _ => {
                    // Non-string or empty — skip (treat as "no change").
                    continue;
                }
            };
            sqlx::query(
                "UPDATE inbox_classification_evidence
                 SET manual_override = ?,
                     override_stale  = 0,
                     evidence_source = 'manual_override'
                 WHERE inbox_item_id = ? AND relative_file_path = ?",
            )
            .bind(frame_type_str)
            .bind(inbox_item_id)
            .bind(file_path)
            .execute(pool)
            .await
            .map_err(|e| db_internal_ctx(e, "write frameType manual_override"))?;
        } else {
            // Generic property: write to inbox_file_overrides (index-only).
            let value_str = match json_val {
                serde_json::Value::String(s) => s.clone(),
                other => other.to_string(),
            };
            inbox_repo::set_file_override(
                pool,
                &source_group_id,
                file_path,
                property_key,
                &value_str,
                None, // size: caller doesn't stat files; staleness detected at classify time
                None, // mtime: same
            )
            .await
            .map_err(|e| db_internal_ctx(e, "write generic file override"))?;
        }
    }

    // ── 8. Re-run classification + grouping via materialize_sub_items ─────────
    //
    // We call the T066 pub(crate) API directly. This re-partitions all files in
    // the source group into single-type sub-items (and the needs-review sentinel)
    // based on their current effective metadata (header + overrides). It upserts
    // inbox_items rows and updates child_count on the source group.
    //
    // We need: source group metadata (root_id, relative_path, lane) + the
    // file_records Vec that materialize_sub_items expects.

    // Fetch source group row for root_id / relative_path / lane.
    let sg_row: Option<(String, String, Option<String>)> =
        sqlx::query_as("SELECT root_id, relative_path, lane FROM inbox_source_groups WHERE id = ?")
            .bind(&source_group_id)
            .fetch_optional(pool)
            .await
            .map_err(|e| db_internal_ctx(e, "fetch source group for re-split"))?;

    let (root_id, relative_path, lane_opt) = sg_row.ok_or_else(|| {
        ContractError::new(
            ErrorCode::InboxItemNotFound,
            format!("Source group row missing during re-split: {source_group_id}"),
            ErrorSeverity::Blocking,
            false,
        )
    })?;
    let lane = lane_opt.unwrap_or_else(|| "fits".to_owned());

    // Build file_records from persisted metadata. We have no abs paths here
    // (reclassify carries no root path), so we pass an empty file_paths slice
    // and build minimal file_records from inbox_file_metadata.
    //
    // materialize_sub_items uses file_paths only for per-sub-group content
    // signature computation (per-file sha2 hashes). Since we have no abs paths,
    // the signatures will be zero-length (no hashes), yielding an empty
    // sub-group sig. This is acceptable: the sub-item identity
    // (root_id, relative_path, group_key) is stable regardless of the sig, and
    // the sig is refreshed on the next full classify (when files are accessible).

    // Load ALL generic overrides for the group once and index them by
    // (relative_file_path, property_key) → value. This covers every property
    // written via set_file_override (frameType, exposureS, gain, filter,
    // binning, temperatureC, offset, etc.) so they reach the grouping engine
    // even when no inbox_file_metadata row exists for a file.
    let all_overrides = inbox_repo::list_file_overrides_for_group(pool, &source_group_id)
        .await
        .map_err(|e| db_internal_ctx(e, "list file overrides for re-split"))?;

    // Index: (relative_file_path, property_key) → value string.
    // Values are stored as bare strings (numbers unquoted, strings unquoted)
    // because set_file_override / the reclassify_v2 pipeline strips JSON
    // quoting before writing: serde_json::Value::String(s) → s.clone(),
    // other → other.to_string() (so numbers like 300.0 and 100 are bare).
    let overrides_index: HashMap<(&str, &str), &str> = all_overrides
        .iter()
        .map(|o| ((o.relative_file_path.as_str(), o.property_key.as_str()), o.value.as_str()))
        .collect();

    // Collect all evidence (with overrides) across all sub-items in this group.
    // We need: (relative_file_path, effective_frame_type, raw_meta_opt)
    let mut file_records: Vec<(
        String,
        Option<metadata_core::FrameType>,
        Option<metadata_core::RawFileMetadata>,
    )> = Vec::new();

    for item_id in &sub_item_ids {
        let evidence = inbox_repo::list_evidence(pool, item_id)
            .await
            .map_err(|e| db_internal_ctx(e, "list evidence for re-split"))?;

        let metadata_rows = inbox_repo::list_inbox_file_metadata(pool, item_id)
            .await
            .map_err(|e| db_internal_ctx(e, "list metadata for re-split"))?;

        // Build a map from relative_file_path → metadata row.
        let meta_map: HashMap<&str, &persistence_db::repositories::inbox::InboxFileMetadataRow> =
            metadata_rows.iter().map(|m| (m.relative_file_path.as_str(), m)).collect();

        for ev in &evidence {
            let fp = ev.relative_file_path.as_str();

            // Effective frame type:
            //   priority 1 — manual_override on the evidence row (set by set_overrides)
            //   priority 2 — generic override table (property_key = 'frameType')
            //   priority 3 — frame_type extracted from the file header
            let eff_ft_str = ev
                .manual_override
                .as_deref()
                .or_else(|| overrides_index.get(&(fp, "frameType")).copied())
                .or(ev.frame_type.as_deref());
            let eff_ft = eff_ft_str.and_then(metadata_core::FrameType::from_str_ci);

            // Build RawFileMetadata for EVERY file, even those with no
            // inbox_file_metadata row. Start from the metadata row when present
            // (gives us header-extracted values), otherwise start from Default.
            // Then layer ALL persisted overrides on top so that mandatory
            // attributes (exposureS, gain, filter, …) that were set via
            // reclassify_v2 reach the grouping engine and T070 mandatory gate.
            //
            // Precedence per field:
            //   generic override table > evidence-JOIN override columns > metadata row
            //
            // The evidence-JOIN columns (override_filter, override_exposure_s,
            // override_binning) are sourced from inbox_file_overrides via a
            // LEFT JOIN in list_evidence — they are consistent with the overrides
            // index for those three keys, so using either path is equivalent.
            // We use the overrides_index uniformly for all keys to keep the
            // logic simple.

            // Base values from the metadata row (may be None if row absent).
            let base_filter: Option<String> = meta_map.get(fp).and_then(|m| m.filter.clone());
            let base_exposure: Option<String> =
                meta_map.get(fp).and_then(|m| m.exposure_s.map(|v| v.to_string()));
            let base_gain: Option<String> = meta_map.get(fp).and_then(|m| m.gain.clone());
            let base_binning_x: Option<i64> = meta_map.get(fp).and_then(|m| m.binning_x);
            let base_binning_y: Option<i64> = meta_map.get(fp).and_then(|m| m.binning_y);
            let base_object: Option<String> = meta_map.get(fp).and_then(|m| m.object.clone());
            let base_date_obs: Option<String> = meta_map.get(fp).and_then(|m| m.date_obs.clone());
            let base_instrume: Option<String> = meta_map.get(fp).and_then(|m| m.instrume.clone());
            let base_telescop: Option<String> = meta_map.get(fp).and_then(|m| m.telescop.clone());
            let base_naxis1: Option<String> =
                meta_map.get(fp).and_then(|m| m.naxis1.map(|v| v.to_string()));
            let base_naxis2: Option<String> =
                meta_map.get(fp).and_then(|m| m.naxis2.map(|v| v.to_string()));
            let base_stack_count: Option<u32> =
                meta_map.get(fp).and_then(|m| m.stack_count.and_then(|v| u32::try_from(v).ok()));
            // SET-TEMP is the only temperature persisted to inbox_file_metadata
            // (R-18 default dark-grouping source); CCD-TEMP has no base column.
            let base_set_temp_c: Option<f64> = meta_map.get(fp).and_then(|m| m.temperature_c);

            // Apply overrides on top: generic override table wins.
            // image_typ: manual_override > 'frameType' override > header frame_type.
            let effective_image_typ = ev
                .manual_override
                .clone()
                .or_else(|| overrides_index.get(&(fp, "frameType")).copied().map(str::to_owned))
                .or_else(|| ev.frame_type.clone());
            // filter: 'filter' override > metadata row
            let effective_filter =
                overrides_index.get(&(fp, "filter")).copied().map(str::to_owned).or(base_filter);
            // exposure: 'exposureS' override (bare f64 string) > metadata row
            let effective_exposure = overrides_index
                .get(&(fp, "exposureS"))
                .copied()
                .map(str::to_owned)
                .or(base_exposure);
            // gain: 'gain' override > metadata row
            let effective_gain =
                overrides_index.get(&(fp, "gain")).copied().map(str::to_owned).or(base_gain);
            // binning: 'binning' override (e.g. "2x2") > metadata row
            let effective_binning_x = overrides_index
                .get(&(fp, "binning"))
                .copied()
                .and_then(parse_binning_x)
                .or(base_binning_x);
            let effective_binning_y = overrides_index
                .get(&(fp, "binning"))
                .copied()
                .and_then(parse_binning_y)
                .or(base_binning_y);
            // object (target): 'target' override > metadata row
            let effective_object =
                overrides_index.get(&(fp, "target")).copied().map(str::to_owned).or(base_object);
            // offset (T081/R-13): 'offset' override; no base column exists yet
            // (inbox_file_metadata does not persist OFFSET), so an override is
            // the only way this reaches the grouping engine via reclassify.
            let effective_offset: Option<i64> =
                overrides_index.get(&(fp, "offset")).and_then(|v| v.trim().parse::<i64>().ok());
            // temperatureC (T081/R-13/R-18): 'temperatureC' override > metadata
            // row (SET-TEMP). Governs the dark-grouping temperature dimension
            // (grouping::TempSource::SetTemp is the default source).
            let effective_set_temp_c: Option<f64> = overrides_index
                .get(&(fp, "temperatureC"))
                .and_then(|v| v.trim().parse::<f64>().ok())
                .or(base_set_temp_c);

            let raw_meta = metadata_core::RawFileMetadata {
                image_typ: effective_image_typ,
                filter: effective_filter,
                exposure: effective_exposure,
                gain: effective_gain,
                x_binning: effective_binning_x.map(|v| v.to_string()),
                y_binning: effective_binning_y.map(|v| v.to_string()),
                object: effective_object,
                date_obs: base_date_obs,
                instrume: base_instrume,
                telescop: base_telescop,
                naxis1: base_naxis1,
                naxis2: base_naxis2,
                stack_count: base_stack_count,
                offset: effective_offset,
                set_temp_c: effective_set_temp_c,
                ..Default::default()
            };

            // Always pass Some(raw_meta) — even when the metadata row is absent
            // the struct carries the user's overrides and the mandatory-attr gate
            // can evaluate them correctly.
            file_records.push((ev.relative_file_path.clone(), eff_ft, Some(raw_meta)));
        }
    }

    // Call materialize_sub_items with an empty file_paths (no abs paths available).
    // Signatures will be empty (no file I/O); refreshed on next full classify.
    super::classify::materialize_sub_items(
        pool,
        &source_group_id,
        &root_id,
        &relative_path,
        &lane,
        &[], // no abs paths — sigs left empty until next classify
        &file_records,
    )
    .await;

    // ── 9. Read back the re-materialized sub-items and build response ──────────

    let sub_item_rows = inbox_repo::list_inbox_sub_items(pool, &source_group_id)
        .await
        .map_err(|e| db_internal_ctx(e, "list re-materialized sub-items"))?;

    let mut needs_review_count = 0u32;
    let mut sub_items: Vec<InboxSubItemSummary> = Vec::new();

    for row in &sub_item_rows {
        let is_needs_review = row.group_key == super::classify::SENTINEL_NEEDS_REVIEW;
        if is_needs_review {
            needs_review_count = needs_review_count
                .saturating_add(u32::try_from(row.file_count).unwrap_or(u32::MAX));
        }
        sub_items.push(InboxSubItemSummary {
            inbox_item_id: row.id.clone(),
            group_key: row.group_key.clone(),
            group_label: row.group_label.clone().unwrap_or_default(),
            frame_type: row.frame_type.clone(),
            file_count: u32::try_from(row.file_count).unwrap_or(u32::MAX),
            // missing_mandatory population is T070's responsibility; here we
            // surface an empty list (or "needs review" flag via the sentinel).
            missing_mandatory: if is_needs_review { vec!["frameType".to_owned()] } else { vec![] },
        });
    }

    Ok(InboxReclassifyV2Response { source_group_id, sub_items, needs_review_count })
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Parse the X component from a binning string like "2x2".
fn parse_binning_x(s: &str) -> Option<i64> {
    s.split('x').next().and_then(|p| p.trim().parse::<i64>().ok())
}

/// Parse the Y component from a binning string like "2x2".
fn parse_binning_y(s: &str) -> Option<i64> {
    s.split('x').nth(1).and_then(|p| p.trim().parse::<i64>().ok())
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use persistence_db::repositories::inbox::{
        InsertEvidence, InsertInboxItem, UpsertClassification,
    };
    use persistence_db::Database;

    async fn test_db() -> Database {
        let db = Database::in_memory().await.unwrap();
        db.migrate().await.unwrap();
        db
    }

    async fn setup_unclassified_item(db: &Database, item_id: &str) {
        inbox_repo::insert_inbox_item(
            db.pool(),
            &InsertInboxItem {
                id: item_id,
                root_id: "root-1",
                relative_path: "inbox_folder",
                file_count: 2,
                content_signature: Some("sig"),
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
                content_signature: "sig",
                unclassified_file_count: 2,
            },
        )
        .await
        .unwrap();

        inbox_repo::insert_evidence(
            db.pool(),
            &InsertEvidence {
                id: &format!("{item_id}-ev-1"),
                inbox_item_id: item_id,
                relative_file_path: "inbox_folder/mystery_001.fits",
                frame_type: None,
                evidence_source: "none",
                raw_value: None,
                unclassified: true,
                manual_override: None,
                is_master: false,
                master_detector: None,
            },
        )
        .await
        .unwrap();

        inbox_repo::insert_evidence(
            db.pool(),
            &InsertEvidence {
                id: &format!("{item_id}-ev-2"),
                inbox_item_id: item_id,
                relative_file_path: "inbox_folder/mystery_002.fits",
                frame_type: None,
                evidence_source: "none",
                raw_value: None,
                unclassified: true,
                manual_override: None,
                is_master: false,
                master_detector: None,
            },
        )
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn reclassify_two_files_to_dark() {
        let db = test_db().await;
        setup_unclassified_item(&db, "item-recl-1").await;

        let resp = reclassify(
            db.pool(),
            ReclassifyRequest {
                inbox_item_id: "item-recl-1".to_owned(),
                overrides: vec![
                    ReclassifyOverride {
                        file_path: "inbox_folder/mystery_001.fits".to_owned(),
                        frame_type: "dark".to_owned(),
                        ..Default::default()
                    },
                    ReclassifyOverride {
                        file_path: "inbox_folder/mystery_002.fits".to_owned(),
                        frame_type: "dark".to_owned(),
                        ..Default::default()
                    },
                ],
            },
        )
        .await
        .unwrap();

        assert_eq!(resp.updated_type, "single_type");
        assert_eq!(resp.frame_type, Some("dark".to_owned()));
        assert_eq!(resp.remaining_unclassified, 0);
        assert_eq!(resp.applied_count, 2);
    }

    #[tokio::test]
    async fn partial_reclassify_leaves_remaining_unclassified() {
        let db = test_db().await;
        setup_unclassified_item(&db, "item-recl-2").await;

        let resp = reclassify(
            db.pool(),
            ReclassifyRequest {
                inbox_item_id: "item-recl-2".to_owned(),
                overrides: vec![ReclassifyOverride {
                    file_path: "inbox_folder/mystery_001.fits".to_owned(),
                    frame_type: "light".to_owned(),
                    ..Default::default()
                }],
            },
        )
        .await
        .unwrap();

        assert_eq!(resp.remaining_unclassified, 1);
        assert_eq!(resp.applied_count, 1);
    }

    /// After applying overrides, `inbox_classification_breakdown` rows must be
    /// written so that a subsequent `classify` cache-hit returns a non-empty
    /// breakdown (regression guard for bug 2b).
    #[tokio::test]
    async fn reclassify_rebuilds_breakdown_rows() {
        let db = test_db().await;
        setup_unclassified_item(&db, "item-recl-bd").await;

        // Apply overrides to both files.
        reclassify(
            db.pool(),
            ReclassifyRequest {
                inbox_item_id: "item-recl-bd".to_owned(),
                overrides: vec![
                    ReclassifyOverride {
                        file_path: "inbox_folder/mystery_001.fits".to_owned(),
                        frame_type: "light".to_owned(),
                        ..Default::default()
                    },
                    ReclassifyOverride {
                        file_path: "inbox_folder/mystery_002.fits".to_owned(),
                        frame_type: "dark".to_owned(),
                        ..Default::default()
                    },
                ],
            },
        )
        .await
        .unwrap();

        // Breakdown rows must now exist and reflect the overrides.
        let rows = inbox_repo::list_breakdown(db.pool(), "item-recl-bd").await.unwrap();
        assert_eq!(rows.len(), 2, "one breakdown row per distinct frame type");

        let mut kinds: Vec<&str> = rows.iter().map(|r| r.kind.as_str()).collect();
        kinds.sort_unstable();
        assert_eq!(kinds, ["dark", "light"]);

        let light_row = rows.iter().find(|r| r.kind == "light").unwrap();
        assert_eq!(light_row.count, 1);

        let dark_row = rows.iter().find(|r| r.kind == "dark").unwrap();
        assert_eq!(dark_row.count, 1);
    }

    /// Applying a non-type override (filter/exposure/binning) persists the
    /// override columns and the effective metadata DTO reflects them.
    #[tokio::test]
    async fn non_type_override_persists_filter_exposure_binning() {
        let db = test_db().await;
        setup_unclassified_item(&db, "item-recl-nontype").await;

        // Apply a non-type override: only filter/exposure/binning, no frame_type.
        let resp = reclassify(
            db.pool(),
            ReclassifyRequest {
                inbox_item_id: "item-recl-nontype".to_owned(),
                overrides: vec![ReclassifyOverride {
                    file_path: "inbox_folder/mystery_001.fits".to_owned(),
                    frame_type: String::new(), // no type override
                    filter: Some("Ha".to_owned()),
                    exposure_s: Some(300.0),
                    binning: Some("2x2".to_owned()),
                }],
            },
        )
        .await
        .unwrap();

        // Type aggregation: mystery_001 has no frame_type and no manual_override
        // (frame_type_opt was None), so unclassified count includes it.
        assert_eq!(resp.applied_count, 1);

        // Verify the evidence row has the override columns written.
        let evidence = inbox_repo::list_evidence(db.pool(), "item-recl-nontype").await.unwrap();
        let ev001 = evidence
            .iter()
            .find(|e| e.relative_file_path == "inbox_folder/mystery_001.fits")
            .unwrap();
        assert_eq!(ev001.override_filter.as_deref(), Some("Ha"));
        assert_eq!(ev001.override_exposure_s, Some(300.0));
        assert_eq!(ev001.override_binning.as_deref(), Some("2x2"));
        assert_eq!(ev001.override_stale, 0, "freshly-set override is not stale");
        assert_eq!(ev001.evidence_source, "manual_override");
    }

    #[tokio::test]
    async fn missing_file_path_returns_error() {
        let db = test_db().await;
        setup_unclassified_item(&db, "item-recl-3").await;

        let err = reclassify(
            db.pool(),
            ReclassifyRequest {
                inbox_item_id: "item-recl-3".to_owned(),
                overrides: vec![ReclassifyOverride {
                    file_path: "nonexistent/path.fits".to_owned(),
                    frame_type: "dark".to_owned(),
                    ..Default::default()
                }],
            },
        )
        .await
        .unwrap_err();

        assert_eq!(err.code, ErrorCode::FileNotFound);
    }

    // ── reclassify_v2 tests (T068) ────────────────────────────────────────────

    use contracts_core::inbox::{
        InboxReclassifyBulk, InboxReclassifyFileOverride, InboxReclassifyV2Request,
    };
    use persistence_db::repositories::inbox::{
        upsert_inbox_source_group, upsert_inbox_sub_item, UpsertInboxSubItem, UpsertSourceGroup,
    };

    /// Set up a minimal source group with two evidence files (both unclassified).
    /// Returns (source_group_id, item_id).
    async fn setup_source_group(db: &Database, sg_id: &str, item_id: &str) -> (String, String) {
        // Insert source group
        upsert_inbox_source_group(
            db.pool(),
            &UpsertSourceGroup {
                id: sg_id,
                root_id: "root-1",
                relative_path: "inbox_folder",
                content_signature: Some("sig"),
                format: Some("fits"),
                lane: Some("fits"),
            },
        )
        .await
        .unwrap();

        // Insert inbox item linked to the source group
        sqlx::query(
            "INSERT INTO inbox_items \
             (id, root_id, relative_path, source_group_id, group_key, group_label, \
              frame_type, file_count, discovered_at, last_scanned_at, \
              content_signature, state, lane) \
             VALUES (?, 'root-1', 'inbox_folder', ?, '', NULL, NULL, 2, \
                     datetime('now'), datetime('now'), 'sig', 'pending_classification', 'fits')",
        )
        .bind(item_id)
        .bind(sg_id)
        .execute(db.pool())
        .await
        .unwrap();

        // Insert two evidence rows
        inbox_repo::insert_evidence(
            db.pool(),
            &InsertEvidence {
                id: &format!("{item_id}-ev-1"),
                inbox_item_id: item_id,
                relative_file_path: "inbox_folder/frame_001.fits",
                frame_type: None,
                evidence_source: "none",
                raw_value: None,
                unclassified: true,
                manual_override: None,
                is_master: false,
                master_detector: None,
            },
        )
        .await
        .unwrap();

        inbox_repo::insert_evidence(
            db.pool(),
            &InsertEvidence {
                id: &format!("{item_id}-ev-2"),
                inbox_item_id: item_id,
                relative_file_path: "inbox_folder/frame_002.fits",
                frame_type: None,
                evidence_source: "none",
                raw_value: None,
                unclassified: true,
                manual_override: None,
                is_master: false,
                master_detector: None,
            },
        )
        .await
        .unwrap();

        (sg_id.to_owned(), item_id.to_owned())
    }

    /// T068: set an arbitrary registry property (temperatureC) — persisted in
    /// inbox_file_overrides and NOT written to any file bytes (index-only).
    #[tokio::test]
    async fn v2_arbitrary_property_persisted_in_overrides_table() {
        let db = test_db().await;
        setup_source_group(&db, "sg-arb", "item-arb").await;

        let resp = reclassify_v2(
            db.pool(),
            InboxReclassifyV2Request {
                source_group_id: Some("sg-arb".to_owned()),
                inbox_item_id: None,
                overrides: vec![InboxReclassifyFileOverride {
                    file_path: "inbox_folder/frame_001.fits".to_owned(),
                    properties: {
                        let mut m = std::collections::HashMap::new();
                        m.insert("temperatureC".to_owned(), serde_json::json!(-10.0));
                        m.insert("gain".to_owned(), serde_json::json!("100"));
                        m
                    },
                }],
                bulk: vec![],
            },
        )
        .await
        .unwrap();

        // The source group is returned.
        assert_eq!(resp.source_group_id, "sg-arb");

        // Overrides must be recorded in inbox_file_overrides.
        let overrides =
            inbox_repo::list_file_overrides_for_group(db.pool(), "sg-arb").await.unwrap();
        let temp_ov = overrides.iter().find(|o| {
            o.property_key == "temperatureC"
                && o.relative_file_path == "inbox_folder/frame_001.fits"
        });
        assert!(temp_ov.is_some(), "temperatureC override must be persisted");
        // serde_json serialises -10.0 as "-10.0" via Display on Number.
        assert_eq!(temp_ov.unwrap().value, "-10.0");

        let gain_ov = overrides.iter().find(|o| {
            o.property_key == "gain" && o.relative_file_path == "inbox_folder/frame_001.fits"
        });
        assert!(gain_ov.is_some(), "gain override must be persisted");
        // String JSON values: the implementation stores the inner string (unwrapped from quotes).
        assert_eq!(gain_ov.unwrap().value, "100");
    }

    /// T068: bulk set-all — apply one value across all files in the group when
    /// file_paths is omitted.
    #[tokio::test]
    async fn v2_bulk_set_all_applies_to_every_file() {
        let db = test_db().await;
        setup_source_group(&db, "sg-bulk", "item-bulk").await;

        reclassify_v2(
            db.pool(),
            InboxReclassifyV2Request {
                source_group_id: Some("sg-bulk".to_owned()),
                inbox_item_id: None,
                overrides: vec![],
                bulk: vec![InboxReclassifyBulk {
                    property: "gain".to_owned(),
                    value: serde_json::json!(125),
                    file_paths: None, // all files
                }],
            },
        )
        .await
        .unwrap();

        let overrides =
            inbox_repo::list_file_overrides_for_group(db.pool(), "sg-bulk").await.unwrap();
        // Both files must have gain overrides.
        let gain_overrides: Vec<_> =
            overrides.iter().filter(|o| o.property_key == "gain").collect();
        assert_eq!(gain_overrides.len(), 2, "bulk set-all must apply to both files");
        for ov in &gain_overrides {
            assert_eq!(
                ov.value, "125",
                "gain value must be 125 for file {}",
                ov.relative_file_path
            );
        }
    }

    /// T068: frameType correction (the one exception to fill-missing-only) —
    /// writes manual_override on the evidence row.
    #[tokio::test]
    async fn v2_frame_type_correction_writes_manual_override() {
        let db = test_db().await;
        setup_source_group(&db, "sg-ft", "item-ft").await;

        reclassify_v2(
            db.pool(),
            InboxReclassifyV2Request {
                source_group_id: Some("sg-ft".to_owned()),
                inbox_item_id: None,
                overrides: vec![
                    InboxReclassifyFileOverride {
                        file_path: "inbox_folder/frame_001.fits".to_owned(),
                        properties: {
                            let mut m = std::collections::HashMap::new();
                            m.insert("frameType".to_owned(), serde_json::json!("dark"));
                            // darks need exposure + gain to clear the R-14 mandatory gate
                            // (T070) — without them the file routes to needs-review.
                            m.insert("exposureS".to_owned(), serde_json::json!(300.0));
                            m.insert("gain".to_owned(), serde_json::json!(100));
                            m
                        },
                    },
                    InboxReclassifyFileOverride {
                        file_path: "inbox_folder/frame_002.fits".to_owned(),
                        properties: {
                            let mut m = std::collections::HashMap::new();
                            m.insert("frameType".to_owned(), serde_json::json!("dark"));
                            // darks need exposure + gain to clear the R-14 mandatory gate
                            // (T070) — without them the file routes to needs-review.
                            m.insert("exposureS".to_owned(), serde_json::json!(300.0));
                            m.insert("gain".to_owned(), serde_json::json!(100));
                            m
                        },
                    },
                ],
                bulk: vec![],
            },
        )
        .await
        .unwrap();

        // manual_override must be written on both evidence rows.
        let evidence = inbox_repo::list_evidence(db.pool(), "item-ft").await.unwrap();
        for ev in &evidence {
            assert_eq!(
                ev.manual_override.as_deref(),
                Some("dark"),
                "manual_override must be 'dark' for {}",
                ev.relative_file_path
            );
        }
    }

    /// T068: fill-missing-only — a property set via override is persisted; the
    /// file bytes are never touched (index-only). No filesystem mutation test
    /// is needed (we use in-memory DB only and there are no real files).
    #[tokio::test]
    async fn v2_fill_missing_only_index_not_file_bytes() {
        let db = test_db().await;
        setup_source_group(&db, "sg-fmo", "item-fmo").await;

        // Set exposureS via per-file override.
        reclassify_v2(
            db.pool(),
            InboxReclassifyV2Request {
                source_group_id: Some("sg-fmo".to_owned()),
                inbox_item_id: None,
                overrides: vec![InboxReclassifyFileOverride {
                    file_path: "inbox_folder/frame_001.fits".to_owned(),
                    properties: {
                        let mut m = std::collections::HashMap::new();
                        m.insert("exposureS".to_owned(), serde_json::json!(300.0));
                        m
                    },
                }],
                bulk: vec![],
            },
        )
        .await
        .unwrap();

        // Override is in the overrides table — not in inbox_file_metadata
        // (metadata is only written by classify which reads real file headers).
        let overrides =
            inbox_repo::list_file_overrides_for_group(db.pool(), "sg-fmo").await.unwrap();
        let exp_ov = overrides.iter().find(|o| {
            o.property_key == "exposureS" && o.relative_file_path == "inbox_folder/frame_001.fits"
        });
        assert!(exp_ov.is_some(), "exposureS override must be in overrides table");
        // serde_json serialises 300.0 as "300.0" via Value::to_string().
        assert_eq!(exp_ov.unwrap().value, "300.0");

        // inbox_file_metadata row must NOT exist (no classify was run with real files).
        let metadata = inbox_repo::list_inbox_file_metadata(db.pool(), "item-fmo").await.unwrap();
        assert!(
            metadata.is_empty(),
            "inbox_file_metadata must be empty — reclassify does not write file bytes"
        );
    }

    /// T068: reclassify triggers re-split — after applying a frameType override
    /// materialize_sub_items is called and the sub-items are re-materialized.
    #[tokio::test]
    async fn v2_reclassify_triggers_resplit_into_sub_items() {
        let db = test_db().await;
        setup_source_group(&db, "sg-split", "item-split").await;

        let resp = reclassify_v2(
            db.pool(),
            InboxReclassifyV2Request {
                source_group_id: Some("sg-split".to_owned()),
                inbox_item_id: None,
                overrides: vec![
                    InboxReclassifyFileOverride {
                        file_path: "inbox_folder/frame_001.fits".to_owned(),
                        properties: {
                            let mut m = std::collections::HashMap::new();
                            m.insert("frameType".to_owned(), serde_json::json!("dark"));
                            // darks need exposure + gain to clear the R-14 mandatory gate
                            // (T070) — without them the file routes to needs-review.
                            m.insert("exposureS".to_owned(), serde_json::json!(300.0));
                            m.insert("gain".to_owned(), serde_json::json!(100));
                            m
                        },
                    },
                    InboxReclassifyFileOverride {
                        file_path: "inbox_folder/frame_002.fits".to_owned(),
                        properties: {
                            let mut m = std::collections::HashMap::new();
                            m.insert("frameType".to_owned(), serde_json::json!("dark"));
                            // darks need exposure + gain to clear the R-14 mandatory gate
                            // (T070) — without them the file routes to needs-review.
                            m.insert("exposureS".to_owned(), serde_json::json!(300.0));
                            m.insert("gain".to_owned(), serde_json::json!(100));
                            m
                        },
                    },
                ],
                bulk: vec![],
            },
        )
        .await
        .unwrap();

        // Both files are dark → should produce one sub-item with frame_type=dark.
        // (Grouping uses available metadata; with no extracted metadata all darks
        //  share the same unknown-dimension sentinel bucket = one group.)
        assert!(!resp.sub_items.is_empty(), "re-split must produce at least one sub-item");
        let dark_item = resp.sub_items.iter().find(|s| s.frame_type.as_deref() == Some("dark"));
        assert!(dark_item.is_some(), "must have a dark sub-item after re-split");
        assert_eq!(resp.needs_review_count, 0, "no needs-review files after full override");
    }

    /// T081 (spec 041 FR-035–FR-040): `offset` and `temperatureC` overrides
    /// must reach the grouping engine on re-split, not just get persisted to
    /// `inbox_file_overrides`. Two dark files with identical header-derived
    /// metadata but different `offset`/`temperatureC` overrides must land in
    /// two distinct sub-items (Offset and SetTemp are both default dark
    /// grouping dimensions — see `grouping::GroupingConfig::default_for`).
    #[tokio::test]
    async fn v2_offset_and_temperature_overrides_reach_grouping() {
        let db = test_db().await;
        setup_source_group(&db, "sg-offset-temp", "item-offset-temp").await;

        let resp = reclassify_v2(
            db.pool(),
            InboxReclassifyV2Request {
                source_group_id: Some("sg-offset-temp".to_owned()),
                inbox_item_id: None,
                overrides: vec![
                    InboxReclassifyFileOverride {
                        file_path: "inbox_folder/frame_001.fits".to_owned(),
                        properties: {
                            let mut m = std::collections::HashMap::new();
                            m.insert("frameType".to_owned(), serde_json::json!("dark"));
                            m.insert("exposureS".to_owned(), serde_json::json!(300.0));
                            m.insert("gain".to_owned(), serde_json::json!(100));
                            m.insert("offset".to_owned(), serde_json::json!(50));
                            m.insert("temperatureC".to_owned(), serde_json::json!(-10.0));
                            m
                        },
                    },
                    InboxReclassifyFileOverride {
                        file_path: "inbox_folder/frame_002.fits".to_owned(),
                        properties: {
                            let mut m = std::collections::HashMap::new();
                            m.insert("frameType".to_owned(), serde_json::json!("dark"));
                            m.insert("exposureS".to_owned(), serde_json::json!(300.0));
                            m.insert("gain".to_owned(), serde_json::json!(100));
                            m.insert("offset".to_owned(), serde_json::json!(500));
                            m.insert("temperatureC".to_owned(), serde_json::json!(-20.0));
                            m
                        },
                    },
                ],
                bulk: vec![],
            },
        )
        .await
        .unwrap();

        assert_eq!(resp.needs_review_count, 0, "no needs-review files after full override");
        assert_eq!(
            resp.sub_items.len(),
            2,
            "offset/temperatureC overrides must split into two distinct sub-items: {:?}",
            resp.sub_items
        );
        let keys: std::collections::HashSet<_> =
            resp.sub_items.iter().map(|s| s.group_key.as_str()).collect();
        assert_eq!(
            keys.len(),
            2,
            "group_key must differ between the two offset/temperature overrides: {:?}",
            resp.sub_items
        );
        for si in &resp.sub_items {
            assert!(
                si.group_key.contains("offset=") && si.group_key.contains("set_temp="),
                "group_key must embed both offset and set_temp dimensions: {}",
                si.group_key
            );
        }
    }

    /// T068: unknown property key is rejected.
    #[tokio::test]
    async fn v2_unknown_property_key_rejected() {
        let db = test_db().await;
        setup_source_group(&db, "sg-unk", "item-unk").await;

        let err = reclassify_v2(
            db.pool(),
            InboxReclassifyV2Request {
                source_group_id: Some("sg-unk".to_owned()),
                inbox_item_id: None,
                overrides: vec![InboxReclassifyFileOverride {
                    file_path: "inbox_folder/frame_001.fits".to_owned(),
                    properties: {
                        let mut m = std::collections::HashMap::new();
                        m.insert("notARealProperty".to_owned(), serde_json::json!("x"));
                        m
                    },
                }],
                bulk: vec![],
            },
        )
        .await
        .unwrap_err();

        assert_eq!(err.code, ErrorCode::ValidationRequestEnvelopeInvalid);
        assert!(
            err.message.contains("notARealProperty"),
            "error message must name the bad key: {}",
            err.message
        );
    }

    /// T068: non-overridable property key (skyRotationDeg) is rejected.
    #[tokio::test]
    async fn v2_non_overridable_property_rejected() {
        let db = test_db().await;
        setup_source_group(&db, "sg-noo", "item-noo").await;

        let err = reclassify_v2(
            db.pool(),
            InboxReclassifyV2Request {
                source_group_id: Some("sg-noo".to_owned()),
                inbox_item_id: None,
                overrides: vec![InboxReclassifyFileOverride {
                    file_path: "inbox_folder/frame_001.fits".to_owned(),
                    properties: {
                        let mut m = std::collections::HashMap::new();
                        m.insert("skyRotationDeg".to_owned(), serde_json::json!(45.0));
                        m
                    },
                }],
                bulk: vec![],
            },
        )
        .await
        .unwrap_err();

        assert_eq!(err.code, ErrorCode::ValidationRequestEnvelopeInvalid);
    }

    /// T068: lookup by inboxItemId resolves to the owning source group.
    #[tokio::test]
    async fn v2_lookup_by_inbox_item_id() {
        let db = test_db().await;
        setup_source_group(&db, "sg-lkup", "item-lkup").await;

        // Use inbox_item_id instead of source_group_id.
        let resp = reclassify_v2(
            db.pool(),
            InboxReclassifyV2Request {
                source_group_id: None,
                inbox_item_id: Some("item-lkup".to_owned()),
                overrides: vec![],
                bulk: vec![],
            },
        )
        .await
        .unwrap();

        // The response must reference the owning source group.
        assert_eq!(resp.source_group_id, "sg-lkup");
    }

    /// T068: bulk with explicit file_paths applies only to named files.
    #[tokio::test]
    async fn v2_bulk_with_explicit_paths_applies_only_to_named_files() {
        let db = test_db().await;
        setup_source_group(&db, "sg-bexp", "item-bexp").await;

        reclassify_v2(
            db.pool(),
            InboxReclassifyV2Request {
                source_group_id: Some("sg-bexp".to_owned()),
                inbox_item_id: None,
                overrides: vec![],
                bulk: vec![InboxReclassifyBulk {
                    property: "gain".to_owned(),
                    value: serde_json::json!(100),
                    file_paths: Some(vec!["inbox_folder/frame_001.fits".to_owned()]),
                }],
            },
        )
        .await
        .unwrap();

        let overrides =
            inbox_repo::list_file_overrides_for_group(db.pool(), "sg-bexp").await.unwrap();
        let gain_overrides: Vec<_> =
            overrides.iter().filter(|o| o.property_key == "gain").collect();
        // Only frame_001.fits must have a gain override.
        assert_eq!(gain_overrides.len(), 1, "only the named file must have a gain override");
        assert_eq!(gain_overrides[0].relative_file_path, "inbox_folder/frame_001.fits");
    }
}
