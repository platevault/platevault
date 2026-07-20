// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

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
use persistence_db::repositories::q_inbox;
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
    let (mut db_result, mut updated_type, mut single_frame_type) = match frame_types.len() {
        0 => ("unclassified".to_owned(), "unclassified".to_owned(), None),
        1 => ("classified".to_owned(), "single_type".to_owned(), frame_types.into_iter().next()),
        _ => ("unclassified".to_owned(), "mixed".to_owned(), None),
    };

    // issue #711 Instance B: an item still flagged `needs_review` must not be
    // reported classified from frame-type agreement alone. `inbox_confirm`
    // gates on `inbox_items.needs_review` directly, and the frame-type
    // aggregation above
    // only tracks whether overrides agree on ONE type — not whether every
    // mandatory attribute (filter/exposureS/gain/target) is now actually
    // present. Left unchecked, the cached classification (and hence
    // `inbox.classify`/the detail panel) can flip to "single_type" while the
    // list row and `inbox_confirm` still correctly see needs-review,
    // producing the exact list/detail disagreement #711 reports. Re-check
    // against the same mandatory-attribute gate `materialize_sub_items` uses
    // before promoting a row, and downgrade the result when it fails.
    // Scoped to items already flagged needs-review — an unflagged item's
    // reclassify aggregation is unaffected (issue #724 precedent).
    let mut needs_review_resolved_ft: Option<metadata_core::FrameType> = None;
    if item.needs_review != 0 {
        match single_frame_type.as_deref().and_then(metadata_core::FrameType::from_str_ci) {
            Some(ft)
                if mandatory_attrs_present(pool, &req.inbox_item_id, ft, &updated_evidence)
                    .await =>
            {
                needs_review_resolved_ft = Some(ft);
            }
            _ => {
                "unclassified".clone_into(&mut db_result);
                "unclassified".clone_into(&mut updated_type);
                single_frame_type = None;
            }
        }
    }

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

    // 6b. Resolve the item out of needs-review now that the check above
    // (issue #724) confirmed every mandatory attribute is supplied.
    //
    // Spec 058 T006: this goes through the same materialisation upsert every
    // other write path uses, so `frame_type`, `needs_review` and
    // `state = 'classified'` land in ONE statement (FR-029 — no observable
    // moment where the row reports classified without a frame type). The
    // synthetic `type=<ft>·resolved=<id>` key that the old in-place UPDATE
    // wrote is gone rather than replaced: the item keeps its classification
    // identity, and `ON CONFLICT(root_id, relative_path, group_key)` converges
    // it onto any sibling already holding that identity, because two rows
    // sharing a classification identity in one folder ARE the same item.
    if let Some(ft) = needs_review_resolved_ft {
        if let Some(source_group_id) = item.source_group_id.as_deref() {
            inbox_repo::upsert_inbox_sub_item(
                pool,
                &persistence_db::repositories::inbox::UpsertInboxSubItem {
                    id: &item.id,
                    root_id: &item.root_id,
                    relative_path: &item.relative_path,
                    source_group_id,
                    group_key: &item.group_key,
                    group_label: item.group_label.as_deref().unwrap_or_default(),
                    frame_type: Some(ft.as_str()),
                    content_signature: item.content_signature.as_deref().unwrap_or_default(),
                    file_count: item.file_count,
                    lane: &item.lane,
                    needs_review: false,
                },
            )
            .await
            .ok();
        }
    }

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
            let exists = q_inbox::get_source_group_by_id(pool, &sg)
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

    // Evidence now lives on whichever items are CURRENTLY authoritative for
    // this group's files. Once classify has split the group, each
    // materialized single-type sub-item (`group_key != ''`) carries its own
    // evidence/metadata (issue #755 CI fix — `materialize_sub_items` seeds it
    // so a later `inbox.classify(sub_id)` is a cache hit instead of silently
    // re-deriving from the raw header); the placeholder row (`group_key ==
    // ''`) is superseded at that point and its evidence duplicates the same
    // files, which would double-count `file_records` below. Falling back to
    // the full `sub_item_ids` set only matters pre-split (a legacy item, or
    // one that has never been classified yet).
    let materialized_sub_items = inbox_repo::list_inbox_sub_items(pool, &source_group_id)
        .await
        .map_err(|e| db_internal_ctx(e, "list materialized sub-items for source group"))?;
    let evidence_item_ids: Vec<String> = if materialized_sub_items.is_empty() {
        sub_item_ids.clone()
    } else {
        materialized_sub_items.into_iter().map(|row| row.id).collect()
    };

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
    // Evidence rows are keyed by inbox_item_id, so we need to iterate over the
    // group's CURRENT authoritative items (`evidence_item_ids`, see above) to
    // get their file paths without double-counting a superseded placeholder.

    // Build a flat map: relative_file_path → inbox_item_id
    let mut path_to_item: HashMap<String, String> = HashMap::new();
    // File identity (size/mtime) most recently recorded by classify's own
    // `stat` (spec 041 FR-046) — reclassify has no root path to stat files
    // itself, but `inbox_file_metadata` already carries the identity from the
    // classify run that produced this evidence. Threading it through here is
    // what lets `set_file_override` (step 7) persist a real identity instead
    // of `None, None`, which is required for staleness detection to have
    // anything to compare against at the next classify.
    let mut file_identity: HashMap<String, (Option<i64>, Option<String>)> = HashMap::new();
    for item_id in &evidence_item_ids {
        let evidence = inbox_repo::list_evidence(pool, item_id)
            .await
            .map_err(|e| db_internal_ctx(e, "list evidence for sub-item"))?;
        for ev in evidence {
            path_to_item.insert(ev.relative_file_path, item_id.clone());
        }

        let metadata_rows = inbox_repo::list_inbox_file_metadata(pool, item_id)
            .await
            .map_err(|e| db_internal_ctx(e, "list file metadata for sub-item"))?;
        for m in metadata_rows {
            file_identity.insert(m.relative_file_path, (m.file_size_bytes, m.file_mtime));
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

    // Per-file overrides first. `properties`/`value` are `JsonAny` on the wire
    // (T072 — specta cannot inline raw `serde_json::Value`); unwrap to the
    // plain `serde_json::Value` the rest of this pipeline operates on.
    for file_override in &req.overrides {
        for (key, val) in &file_override.properties {
            effective_overrides.push((
                file_override.file_path.clone(),
                key.clone(),
                val.clone().into(),
            ));
        }
    }

    // Bulk entries second (may overwrite per-file values for the same key).
    for bulk in &req.bulk {
        let target_paths: Vec<String> = match &bulk.file_paths {
            None => path_to_item.keys().cloned().collect(),
            Some(fps) => fps.clone(),
        };
        for p in target_paths {
            effective_overrides.push((p, bulk.property.clone(), bulk.value.clone().into()));
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

        // Identity recorded at the last classify for this file, if any (spec
        // 041 FR-046) — `None` for files never classified yet, which leaves
        // the override with no comparison baseline until the next classify.
        let (id_size, id_mtime) =
            file_identity.get(file_path.as_str()).cloned().unwrap_or((None, None));

        if property_key == "frameType" {
            // Frame-type correction: write manual_override on the evidence row.
            let frame_type_str = match json_val {
                serde_json::Value::String(s) if !s.is_empty() => s.as_str(),
                _ => {
                    // Non-string or empty — skip (treat as "no change").
                    continue;
                }
            };
            q_inbox::set_manual_override_reset_stale(
                pool,
                inbox_item_id,
                file_path,
                frame_type_str,
            )
            .await
            .map_err(|e| db_internal_ctx(e, "write frameType manual_override"))?;
            // ALSO persist to the group-keyed overrides table: the evidence
            // row above is wiped and re-inserted by every classify run, and a
            // classify racing this write loses the manual_override entirely
            // (observed as the #854 CI red — the group-keyed exposureS
            // survived while frameType vanished). The group-keyed row
            // survives every evidence rebuild; classify/materialize layer it
            // back on (priority: manual_override → frameType override →
            // extracted header).
            inbox_repo::set_file_override(
                pool,
                &source_group_id,
                file_path,
                "frameType",
                frame_type_str,
                id_size,
                id_mtime.as_deref(),
            )
            .await
            .map_err(|e| db_internal_ctx(e, "write durable frameType override"))?;
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
                id_size,
                id_mtime.as_deref(),
            )
            .await
            .map_err(|e| db_internal_ctx(e, "write generic file override"))?;
        }
    }

    // ── 8. Re-run classification + grouping via materialize_sub_items ─────────
    //
    // We call the T066 pub(crate) API directly. This re-partitions all files in
    // the source group into single-type sub-items (some flagged needs-review)
    // based on their current effective metadata (header + overrides). It upserts
    // inbox_items rows and updates child_count on the source group.
    //
    // We need: source group metadata (root_id, relative_path, lane) + the
    // file_records Vec that materialize_sub_items expects.

    // Fetch source group row for root_id / relative_path / lane.
    let sg_row = q_inbox::get_source_group_by_id(pool, &source_group_id)
        .await
        .map_err(|e| db_internal_ctx(e, "fetch source group for re-split"))?;

    let sg_row = sg_row.ok_or_else(|| {
        ContractError::new(
            ErrorCode::InboxItemNotFound,
            format!("Source group row missing during re-split: {source_group_id}"),
            ErrorSeverity::Blocking,
            false,
        )
    })?;
    let (root_id, relative_path) = (sg_row.root_id, sg_row.relative_path);
    // `inbox_source_groups.lane` is the move-vs-catalogue lane
    // ('move'/'catalogue', set from the root's organization_state at scan
    // time), NOT the fits/video lane that `inbox_items` requires
    // (CHECK(lane IN ('fits','video'))). Deriving the item lane from the
    // group's format mirrors scan's own assignment (video-only folders →
    // 'video', everything else → 'fits'). Passing `sg_row.lane` here made
    // every re-split of an unorganized ('move') group fail the CHECK inside
    // `upsert_inbox_sub_item`, silently dropping the resolved sub-item so
    // Confirm never re-enabled after a bulk reclassify (issue #854).
    let lane = match sg_row.format.as_deref() {
        Some("video") => "video",
        _ => "fits",
    }
    .to_owned();

    // Build file_records from persisted metadata (inbox_file_metadata), then
    // reconstruct the matching absolute paths from the request's root so
    // materialize_sub_items can hash each group's real files.
    //
    // materialize_sub_items uses file_paths only for per-sub-group content
    // signature computation (per-file sha2 hashes), positionally aligned with
    // file_records. Passing no paths does NOT yield an "empty" signature: it
    // yields folder_signature(vec![]) — sha256 of empty input, the fixed
    // constant e3b0c442…b855. Every re-split item in every library would then
    // carry that same value, so confirm.rs's TOCTOU guard would compare equal
    // unconditionally and never fire (spec 058 Q-5).

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

    // Collect all evidence (with overrides) across the group's CURRENT
    // authoritative items (`evidence_item_ids`) — see the doc comment above,
    // avoids re-counting the same file via both a superseded placeholder and
    // its materialized sub-item.
    // We need: (relative_file_path, effective_frame_type, raw_meta_opt)
    let mut file_records: Vec<(
        String,
        Option<metadata_core::FrameType>,
        Option<metadata_core::RawFileMetadata>,
    )> = Vec::new();

    for item_id in &evidence_item_ids {
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

    // Absolute paths positionally aligned with `file_records`, so each group's
    // content_signature hashes its real files. `relative_file_path` is stored
    // root-relative (classify.rs strips the root prefix), so joining the root
    // reconstructs the original absolute path. Files that have moved or been
    // deleted since classify are skipped by `file_signature`, which changes the
    // group signature — exactly the staleness confirm must refuse to plan from.
    let root_abs = std::path::PathBuf::from(&req.root_absolute_path);
    let file_paths: Vec<std::path::PathBuf> =
        file_records.iter().map(|(rel, _, _)| root_abs.join(rel)).collect();

    super::classify::materialize_sub_items(
        pool,
        &source_group_id,
        &root_id,
        &relative_path,
        &lane,
        &file_paths,
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
        let is_needs_review = row.needs_review != 0;
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
            // surface an empty list (or the "needs review" flag).
            missing_mandatory: if is_needs_review { vec!["frameType".to_owned()] } else { vec![] },
        });
    }

    Ok(InboxReclassifyV2Response { source_group_id, sub_items, needs_review_count })
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/// `true` when every evidence row's effective filter/exposure/gain/object
/// (override, else the extracted `inbox_file_metadata` value) satisfies the
/// mandatory-attribute gate (T070/FR-047/FR-048) for `ft`. Shared by the
/// needs-review resolve decision (issue #724) and the classification
/// aggregation's own downgrade (issue #711 Instance B) — both need
/// the identical per-file check.
async fn mandatory_attrs_present(
    pool: &SqlitePool,
    inbox_item_id: &str,
    ft: metadata_core::FrameType,
    evidence: &[persistence_db::repositories::inbox::InboxEvidenceRow],
) -> bool {
    let metadata_rows =
        inbox_repo::list_inbox_file_metadata(pool, inbox_item_id).await.unwrap_or_default();
    let meta_map: HashMap<&str, &persistence_db::repositories::inbox::InboxFileMetadataRow> =
        metadata_rows.iter().map(|m| (m.relative_file_path.as_str(), m)).collect();

    evidence.iter().all(|ev| {
        let meta = meta_map.get(ev.relative_file_path.as_str());
        let raw = metadata_core::RawFileMetadata {
            filter: ev.override_filter.clone().or_else(|| meta.and_then(|m| m.filter.clone())),
            exposure: ev
                .override_exposure_s
                .map(|v| v.to_string())
                .or_else(|| meta.and_then(|m| m.exposure_s.map(|v| v.to_string()))),
            gain: meta.and_then(|m| m.gain.clone()),
            object: meta.and_then(|m| m.object.clone()),
            ..Default::default()
        };
        super::classify::check_mandatory_missing(ft, Some(&raw), false).is_empty()
    })
}

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

    /// Attach `item_id` to a real source group and flag it needs-review.
    ///
    /// Spec 058 FR-028: needs-review is `inbox_items.needs_review`, not a
    /// `group_key` value — `group_key` keeps the item's classification
    /// identity throughout. A source group is required because the resolve
    /// path writes through `upsert_inbox_sub_item` (T006).
    async fn flag_needs_review(db: &Database, item_id: &str, group_key: &str) {
        let sg_id = format!("sg-{item_id}");
        inbox_repo::upsert_inbox_source_group(
            db.pool(),
            &persistence_db::repositories::inbox::UpsertSourceGroup {
                id: &sg_id,
                root_id: "root-1",
                relative_path: "inbox_folder",
                content_signature: Some("sig"),
                format: Some("fits"),
                lane: Some("move"),
                file_count: 1,
            },
        )
        .await
        .unwrap();
        sqlx::query(
            "UPDATE inbox_items
                SET needs_review = 1, source_group_id = ?, group_key = ?
              WHERE id = ?",
        )
        .bind(&sg_id)
        .bind(group_key)
        .bind(item_id)
        .execute(db.pool())
        .await
        .unwrap();
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

    /// Issue #724 + spec 058 T011 (FR-029, SC-003): reclassifying every file
    /// of a needs-review item with all mandatory attributes for the resolved
    /// frame type must resolve it, so `inbox_confirm`'s gate no longer rejects
    /// the item forever.
    ///
    /// The resolve records the frame type, the classification identity, the
    /// `classified` state and `needs_review = 0` in one statement.
    ///
    /// This does NOT establish SC-003 generally: `upsert_inbox_sub_item`
    /// hardcodes `state = 'classified'` (inbox.rs:536,543), so an UNRESOLVED
    /// needs-review row sits at `classified` with a NULL `frame_type` for as
    /// long as it stays unresolved. That is a live SC-003 violation, pinned by
    /// `needs_review_resolves_atomically_onto_its_natural_key_058` and fixed
    /// by T018 — not by this test.
    #[tokio::test]
    async fn reclassify_fully_resolved_clears_needs_review() {
        let db = test_db().await;
        setup_unclassified_item(&db, "item-recl-724").await;
        // A key classify actually produces for a flat missing FILTER: the
        // absent grouping dimension renders as SENTINEL_MISSING. Injecting a
        // bare "type=flat" would only assert that a hand-written constant
        // survives a round trip.
        flag_needs_review(&db, "item-recl-724", "type=flat·filter=∅·exposure=∅").await;

        let resp = reclassify(
            db.pool(),
            ReclassifyRequest {
                inbox_item_id: "item-recl-724".to_owned(),
                overrides: vec![
                    ReclassifyOverride {
                        file_path: "inbox_folder/mystery_001.fits".to_owned(),
                        frame_type: "flat".to_owned(),
                        filter: Some("L".to_owned()),
                        ..Default::default()
                    },
                    ReclassifyOverride {
                        file_path: "inbox_folder/mystery_002.fits".to_owned(),
                        frame_type: "flat".to_owned(),
                        filter: Some("L".to_owned()),
                        ..Default::default()
                    },
                ],
            },
        )
        .await
        .unwrap();

        assert_eq!(resp.updated_type, "single_type");
        assert_eq!(resp.frame_type, Some("flat".to_owned()));

        let (needs_review, frame_type, state, group_key): (i64, Option<String>, String, String) =
            sqlx::query_as(
                "SELECT needs_review, frame_type, state, group_key FROM inbox_items WHERE id = ?",
            )
            .bind("item-recl-724")
            .fetch_one(db.pool())
            .await
            .unwrap();
        assert_eq!(
            needs_review, 0,
            "needs_review must clear once every mandatory attribute is supplied"
        );
        assert_eq!(
            frame_type.as_deref(),
            Some("flat"),
            "resolving must record the frame type in the same statement"
        );
        assert_eq!(state, "classified", "resolving must record the classified state");
        // No synthetic `resolved=<id>` token is appended. KNOWN GAP: the
        // resolve rewrites the row through `upsert_inbox_sub_item` with
        // `group_key` passed through unchanged, so the identity still records
        // the now-supplied FILTER as absent and will never converge with a
        // sibling carrying the real value — defeating T006's ON CONFLICT
        // rationale. Re-keying from override-merged metadata is a re-split
        // decision owned by T012-T016; asserted as-is so it stays visible.
        assert_eq!(
            group_key, "type=flat·filter=∅·exposure=∅",
            "resolve passes group_key through unchanged (stale ∅ identity — T012-T016)"
        );

        // SC-003 as written: unqualified. A `needs_review = 0` qualifier here
        // would exclude exactly the rows that violate it.
        let violations: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM inbox_items
              WHERE state = 'classified' AND frame_type IS NULL",
        )
        .fetch_one(db.pool())
        .await
        .unwrap();
        assert_eq!(violations, 0, "SC-003: no item may be classified with no frame type");
    }

    /// Issue #711 Instance B: overriding every file's frame_type to a single
    /// agreed type is not enough to report "classified" while the item is
    /// still flagged needs-review and a DIFFERENT mandatory attribute for
    /// that type (dark requires exposureS + gain) remains unsupplied.
    /// Without the fix, step 6's frame-type-only aggregation reported
    /// "single_type"/"dark" (matching `inbox_classify`'s cached response and
    /// wrongly enabling the detail panel's Confirm), while `group_key` stayed
    /// `__needs_review__` (matching the list row) — the exact list/detail
    /// disagreement #711 reports.
    ///
    /// Spec 058 T009 changed this test's MECHANISM only: needs-review is read
    /// from `inbox_items.needs_review` (FR-028) instead of the retired
    /// `__needs_review__` `group_key` sentinel. The invariant is unchanged and
    /// not weakened — frame-type agreement alone must still not report the item
    /// classified, and the API response, the item row and the cached
    /// classification must still agree (SC-011).
    #[tokio::test]
    async fn reclassify_type_agreement_without_mandatory_attrs_stays_needs_review() {
        let db = test_db().await;
        setup_unclassified_item(&db, "item-recl-711b").await;
        flag_needs_review(&db, "item-recl-711b", "type=dark").await;

        let resp = reclassify(
            db.pool(),
            ReclassifyRequest {
                inbox_item_id: "item-recl-711b".to_owned(),
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

        assert_eq!(
            resp.updated_type, "unclassified",
            "frame-type agreement alone must not report classified while exposureS/gain \
             are still missing for dark frames"
        );
        assert_eq!(resp.frame_type, None);

        let (needs_review, frame_type): (i64, Option<String>) =
            sqlx::query_as("SELECT needs_review, frame_type FROM inbox_items WHERE id = ?")
                .bind("item-recl-711b")
                .fetch_one(db.pool())
                .await
                .unwrap();
        assert_eq!(
            needs_review, 1,
            "needs_review must stay set — the item is not actually fully resolved"
        );
        assert_eq!(frame_type, None, "an unresolved item must carry no frame type");

        // The cached classification must agree with the DB result above: a
        // subsequent inbox.classify cache-hit reads this row.
        let cached =
            inbox_repo::get_classification(db.pool(), "item-recl-711b").await.unwrap().unwrap();
        assert_eq!(cached.result, "unclassified");
        assert_eq!(cached.frame_type, None);
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
    use persistence_db::repositories::inbox::{upsert_inbox_source_group, UpsertSourceGroup};

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
                file_count: 1,
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
                root_absolute_path: "/nonexistent-root".to_owned(),
                source_group_id: Some("sg-arb".to_owned()),
                inbox_item_id: None,
                overrides: vec![InboxReclassifyFileOverride {
                    file_path: "inbox_folder/frame_001.fits".to_owned(),
                    properties: {
                        let mut m = std::collections::HashMap::new();
                        m.insert("temperatureC".to_owned(), serde_json::json!(-10.0).into());
                        m.insert("gain".to_owned(), serde_json::json!("100").into());
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

    /// spec 041 FR-046: when `inbox_file_metadata` already carries a file's
    /// identity (recorded by a prior classify), `reclassify_v2` must thread it
    /// through to `set_file_override` instead of writing `None, None` — the
    /// baseline required for staleness detection to have anything to compare
    /// against at the next classify.
    #[tokio::test]
    async fn v2_generic_override_persists_known_file_identity() {
        let db = test_db().await;
        setup_source_group(&db, "sg-identity", "item-identity").await;

        inbox_repo::upsert_inbox_file_metadata(
            db.pool(),
            &persistence_db::repositories::inbox::UpsertFileMetadata {
                inbox_item_id: "item-identity",
                relative_file_path: "inbox_folder/frame_001.fits",
                file_size_bytes: Some(4_194_304),
                file_mtime: Some("2025-10-10T22:00:00Z"),
                ..Default::default()
            },
        )
        .await
        .unwrap();

        reclassify_v2(
            db.pool(),
            InboxReclassifyV2Request {
                root_absolute_path: "/nonexistent-root".to_owned(),
                source_group_id: Some("sg-identity".to_owned()),
                inbox_item_id: None,
                overrides: vec![InboxReclassifyFileOverride {
                    file_path: "inbox_folder/frame_001.fits".to_owned(),
                    properties: {
                        let mut m = std::collections::HashMap::new();
                        m.insert("gain".to_owned(), serde_json::json!("100").into());
                        m
                    },
                }],
                bulk: vec![],
            },
        )
        .await
        .unwrap();

        let overrides =
            inbox_repo::list_file_overrides_for_group(db.pool(), "sg-identity").await.unwrap();
        let gain_ov = overrides
            .iter()
            .find(|o| {
                o.property_key == "gain" && o.relative_file_path == "inbox_folder/frame_001.fits"
            })
            .unwrap();
        assert_eq!(gain_ov.file_size_bytes, Some(4_194_304), "identity must be threaded through");
        assert_eq!(gain_ov.file_mtime.as_deref(), Some("2025-10-10T22:00:00Z"));
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
                root_absolute_path: "/nonexistent-root".to_owned(),
                source_group_id: Some("sg-bulk".to_owned()),
                inbox_item_id: None,
                overrides: vec![],
                bulk: vec![InboxReclassifyBulk {
                    property: "gain".to_owned(),
                    value: serde_json::json!(125).into(),
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
                root_absolute_path: "/nonexistent-root".to_owned(),
                source_group_id: Some("sg-ft".to_owned()),
                inbox_item_id: None,
                overrides: vec![
                    InboxReclassifyFileOverride {
                        file_path: "inbox_folder/frame_001.fits".to_owned(),
                        properties: {
                            let mut m = std::collections::HashMap::new();
                            m.insert("frameType".to_owned(), serde_json::json!("dark").into());
                            // darks need exposure + gain to clear the R-14 mandatory gate
                            // (T070) — without them the file routes to needs-review.
                            m.insert("exposureS".to_owned(), serde_json::json!(300.0).into());
                            m.insert("gain".to_owned(), serde_json::json!(100).into());
                            m
                        },
                    },
                    InboxReclassifyFileOverride {
                        file_path: "inbox_folder/frame_002.fits".to_owned(),
                        properties: {
                            let mut m = std::collections::HashMap::new();
                            m.insert("frameType".to_owned(), serde_json::json!("dark").into());
                            // darks need exposure + gain to clear the R-14 mandatory gate
                            // (T070) — without them the file routes to needs-review.
                            m.insert("exposureS".to_owned(), serde_json::json!(300.0).into());
                            m.insert("gain".to_owned(), serde_json::json!(100).into());
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
                root_absolute_path: "/nonexistent-root".to_owned(),
                source_group_id: Some("sg-fmo".to_owned()),
                inbox_item_id: None,
                overrides: vec![InboxReclassifyFileOverride {
                    file_path: "inbox_folder/frame_001.fits".to_owned(),
                    properties: {
                        let mut m = std::collections::HashMap::new();
                        m.insert("exposureS".to_owned(), serde_json::json!(300.0).into());
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
                root_absolute_path: "/nonexistent-root".to_owned(),
                source_group_id: Some("sg-split".to_owned()),
                inbox_item_id: None,
                overrides: vec![
                    InboxReclassifyFileOverride {
                        file_path: "inbox_folder/frame_001.fits".to_owned(),
                        properties: {
                            let mut m = std::collections::HashMap::new();
                            m.insert("frameType".to_owned(), serde_json::json!("dark").into());
                            // darks need exposure + gain to clear the R-14 mandatory gate
                            // (T070) — without them the file routes to needs-review.
                            m.insert("exposureS".to_owned(), serde_json::json!(300.0).into());
                            m.insert("gain".to_owned(), serde_json::json!(100).into());
                            m
                        },
                    },
                    InboxReclassifyFileOverride {
                        file_path: "inbox_folder/frame_002.fits".to_owned(),
                        properties: {
                            let mut m = std::collections::HashMap::new();
                            m.insert("frameType".to_owned(), serde_json::json!("dark").into());
                            // darks need exposure + gain to clear the R-14 mandatory gate
                            // (T070) — without them the file routes to needs-review.
                            m.insert("exposureS".to_owned(), serde_json::json!(300.0).into());
                            m.insert("gain".to_owned(), serde_json::json!(100).into());
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

    /// Issue #755 CI fix (R-14): the real user flow doesn't stop at
    /// `reclassify_v2`'s own response — the frontend immediately selects the
    /// freshly materialized sub-item and calls `inbox.classify` on it AGAIN
    /// (`useInboxClassification`, real `Real-UI` E2E
    /// `inbox_ui_unclassified_gate_bulk_reclassify_unblocks_confirm`). That
    /// second call must not silently re-derive from the on-disk header (which
    /// still says the pre-override, unmapped IMAGETYP) and lose the override.
    #[tokio::test]
    #[allow(clippy::too_many_lines)] // real-pipeline regression test: scan/classify/reclassify/classify
    async fn v2_reclassify_resplit_subitem_classify_stays_single_type() {
        let root = tempfile::tempdir().unwrap();
        // "Frame Unknown" is not a mapped IMAGETYP (classify.rs:
        // v1_normalization_table) — matches the real E2E fixture exactly, and
        // deliberately carries NO EXPTIME/EXPOSURE header (also matching the
        // E2E fixture, which only sets IMAGETYP/OBJECT/FILTER/DATE-OBS) so
        // this test also settles whether `exposureS` genuinely gates a light
        // frame out of the resolved bucket here.
        let fits_path = root.path().join("ambiguous_001.fits");
        {
            let mut data = vec![b' '; 2880];
            let cards = ["IMAGETYP= 'Frame Unknown'", "OBJECT  = 'M42'", "FILTER  = 'Ha'"];
            for (i, c) in cards.iter().enumerate() {
                let card = format!("{c:<80}");
                data[i * 80..i * 80 + 80].copy_from_slice(card.as_bytes());
            }
            data[cards.len() * 80..cards.len() * 80 + 3].copy_from_slice(b"END");
            std::fs::write(&fits_path, &data).unwrap();
        }

        let db = test_db().await;
        let sg_id = "sg-persist";
        let placeholder_id = "item-persist-ph";

        upsert_inbox_source_group(
            db.pool(),
            &UpsertSourceGroup {
                id: sg_id,
                root_id: "root-1",
                relative_path: "",
                content_signature: Some("sig"),
                format: Some("fits"),
                lane: Some("fits"),
                file_count: 1,
            },
        )
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO inbox_items \
             (id, root_id, relative_path, source_group_id, group_key, group_label, \
              frame_type, file_count, discovered_at, last_scanned_at, \
              content_signature, state, lane) \
             VALUES (?, 'root-1', '', ?, '', NULL, NULL, 1, \
                     datetime('now'), datetime('now'), 'sig', 'pending_classification', 'fits')",
        )
        .bind(placeholder_id)
        .bind(sg_id)
        .execute(db.pool())
        .await
        .unwrap();

        // Real classify (not a hand-rolled evidence fixture) so evidence +
        // per-file metadata + the initial needs-review sub-item all come from
        // the SAME real pipeline the E2E journey drives.
        let first = crate::classify::classify(
            db.pool(),
            crate::classify::ClassifyRequest {
                inbox_item_id: placeholder_id.to_owned(),
                root_absolute_path: root.path().to_owned(),
                force_rescan: false,
            },
        )
        .await
        .unwrap();
        assert_eq!(first.classification_type, "unclassified");

        // Bulk reclassify: frameType -> light AND exposureS, exactly what the
        // bulk-apply UI sends once the generic bulk-property editor (issue
        // #755/R-13) also fills the exposure field — `exposureS` is a hard
        // mandatory key for light frames alongside target/filter (spec 041
        // R-14/FR-047), and the fixture's header carries no EXPTIME.
        let resp = reclassify_v2(
            db.pool(),
            InboxReclassifyV2Request {
                root_absolute_path: root.path().to_string_lossy().into_owned(),
                source_group_id: Some(sg_id.to_owned()),
                inbox_item_id: None,
                overrides: vec![],
                bulk: vec![
                    InboxReclassifyBulk {
                        property: "frameType".to_owned(),
                        value: serde_json::json!("light").into(),
                        file_paths: None,
                    },
                    InboxReclassifyBulk {
                        property: "exposureS".to_owned(),
                        value: serde_json::json!(300.0).into(),
                        file_paths: None,
                    },
                ],
            },
        )
        .await
        .unwrap();

        let light_item = resp.sub_items.iter().find(|s| s.frame_type.as_deref() == Some("light"));
        assert!(
            light_item.is_some(),
            "expected a resolved 'light' sub-item after the frameType override: {:?}",
            resp.sub_items
        );
        let light_item = light_item.unwrap();
        assert!(
            light_item.missing_mandatory.is_empty(),
            "resolved sub-item must report no missing mandatory attrs: {light_item:?}"
        );

        // The real regression: select the post-split sub-item and classify it
        // again, exactly like `useInboxClassification` does after the
        // frontend's post-split selection handoff.
        let second = crate::classify::classify(
            db.pool(),
            crate::classify::ClassifyRequest {
                inbox_item_id: light_item.inbox_item_id.clone(),
                root_absolute_path: root.path().to_owned(),
                force_rescan: false,
            },
        )
        .await
        .unwrap();
        assert_eq!(
            second.classification_type, "single_type",
            "re-selecting the post-split sub-item must stay single_type, not regress to \
             unclassified by silently re-deriving from the raw on-disk header"
        );
        assert_eq!(second.frame_type, Some("light".to_owned()));
    }

    /// #854 CI race: a concurrent `classify` wipes and re-inserts evidence
    /// rows, losing the `manual_override` a racing `reclassify_v2` just wrote
    /// (the group-keyed exposureS survived while frameType vanished in the
    /// CI failure dump). The durable group-keyed 'frameType' override must
    /// make ANY later classify converge back to the user's reclassify state —
    /// even a force-rescan that rebuilds evidence from raw headers after the
    /// evidence-row override was destroyed.
    #[tokio::test]
    #[allow(clippy::too_many_lines)] // real-pipeline regression test: scan/classify/reclassify/rescan
    async fn classify_converges_to_durable_frame_type_after_manual_override_lost() {
        let root = tempfile::tempdir().unwrap();
        // Unmapped IMAGETYP + no EXPTIME — the real E2E fixture shape.
        let fits_path = root.path().join("ambiguous_001.fits");
        {
            let mut data = vec![b' '; 2880];
            let cards = ["IMAGETYP= 'Frame Unknown'", "OBJECT  = 'M42'", "FILTER  = 'Ha'"];
            for (i, c) in cards.iter().enumerate() {
                let card = format!("{c:<80}");
                data[i * 80..i * 80 + 80].copy_from_slice(card.as_bytes());
            }
            data[cards.len() * 80..cards.len() * 80 + 3].copy_from_slice(b"END");
            std::fs::write(&fits_path, &data).unwrap();
        }

        let db = test_db().await;
        let sg_id = "sg-durable-ft";
        let placeholder_id = "item-durable-ft";

        upsert_inbox_source_group(
            db.pool(),
            &UpsertSourceGroup {
                id: sg_id,
                root_id: "root-1",
                relative_path: "",
                content_signature: Some("sig"),
                format: Some("fits"),
                lane: Some("fits"),
                file_count: 1,
            },
        )
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO inbox_items \
             (id, root_id, relative_path, source_group_id, group_key, group_label, \
              frame_type, file_count, discovered_at, last_scanned_at, \
              content_signature, state, lane) \
             VALUES (?, 'root-1', '', ?, '', NULL, NULL, 1, \
                     datetime('now'), datetime('now'), 'sig', 'pending_classification', 'fits')",
        )
        .bind(placeholder_id)
        .bind(sg_id)
        .execute(db.pool())
        .await
        .unwrap();

        let first = crate::classify::classify(
            db.pool(),
            crate::classify::ClassifyRequest {
                inbox_item_id: placeholder_id.to_owned(),
                root_absolute_path: root.path().to_owned(),
                force_rescan: false,
            },
        )
        .await
        .unwrap();
        assert_eq!(first.classification_type, "unclassified");

        // User bulk-reclassifies: frameType light + exposureS 300.
        let resp = reclassify_v2(
            db.pool(),
            InboxReclassifyV2Request {
                root_absolute_path: root.path().to_string_lossy().into_owned(),
                source_group_id: Some(sg_id.to_owned()),
                inbox_item_id: None,
                overrides: vec![],
                bulk: vec![
                    InboxReclassifyBulk {
                        property: "frameType".to_owned(),
                        value: serde_json::json!("light").into(),
                        file_paths: None,
                    },
                    InboxReclassifyBulk {
                        property: "exposureS".to_owned(),
                        value: serde_json::json!(300.0).into(),
                        file_paths: None,
                    },
                ],
            },
        )
        .await
        .unwrap();
        let light = resp
            .sub_items
            .iter()
            .find(|s| s.frame_type.as_deref() == Some("light"))
            .expect("re-split must produce a light sub-item")
            .clone();

        // Simulate the racing classify's damage: the evidence-row
        // manual_override is destroyed (wipe + re-insert with the raw header
        // values re-applied from an EMPTY pre-write snapshot).
        sqlx::query("UPDATE inbox_classification_evidence SET manual_override = NULL")
            .execute(db.pool())
            .await
            .unwrap();

        // A full force-rescan re-derives from the raw on-disk header (still
        // the unmapped 'Frame Unknown'); the durable group-keyed frameType
        // override must bring the file back to a resolved light state.
        let after = crate::classify::classify(
            db.pool(),
            crate::classify::ClassifyRequest {
                inbox_item_id: light.inbox_item_id.clone(),
                root_absolute_path: root.path().to_owned(),
                force_rescan: true,
            },
        )
        .await
        .unwrap();
        assert_eq!(
            after.classification_type, "single_type",
            "classify must converge to the durable frameType override, not revert to \
             unclassified after the evidence-row manual_override is lost"
        );
        assert_eq!(after.frame_type, Some("light".to_owned()));
        assert!(
            after.unclassified_files.is_empty(),
            "no needs-review files once the durable overrides are layered: {:?}",
            after.unclassified_files
        );
    }

    /// Real-UI E2E `inbox_ui_unclassified_gate_bulk_reclassify_unblocks_confirm`
    /// regression: the user's FIRST bulk apply sets ONLY frameType=light (the
    /// generic bulk editor's exposure field is left blank). A light frame is
    /// missing its mandatory `exposureS` (the fixture header carries no
    /// EXPTIME), so that first reclassify correctly re-splits the group into a
    /// NEEDS-REVIEW sub-item. The user then supplies the exposure and applies
    /// AGAIN — this SECOND reclassify_v2 must resolve the group to a `light`
    /// sub-item so Confirm can enable. The single-call happy-path tests never
    /// exercise a reclassify whose input is the DB state a PRIOR reclassify's
    /// re-split left behind, which is where `materialize_sub_items`' swallowed
    /// write errors surfaced as an empty `sub_items` (Confirm stuck disabled).
    #[tokio::test]
    #[allow(clippy::too_many_lines)] // real-pipeline regression test: scan/classify/reclassify×2
    async fn v2_second_reclassify_after_needs_review_resplit_resolves_single_type() {
        let root = tempfile::tempdir().unwrap();
        // Unmapped IMAGETYP + no EXPTIME — the real E2E fixture shape.
        let fits_path = root.path().join("ambiguous_001.fits");
        {
            let mut data = vec![b' '; 2880];
            let cards = ["IMAGETYP= 'Frame Unknown'", "OBJECT  = 'M42'", "FILTER  = 'Ha'"];
            for (i, c) in cards.iter().enumerate() {
                let card = format!("{c:<80}");
                data[i * 80..i * 80 + 80].copy_from_slice(card.as_bytes());
            }
            data[cards.len() * 80..cards.len() * 80 + 3].copy_from_slice(b"END");
            std::fs::write(&fits_path, &data).unwrap();
        }

        let db = test_db().await;
        let sg_id = "sg-two-apply";
        let placeholder_id = "item-two-apply";

        upsert_inbox_source_group(
            db.pool(),
            &UpsertSourceGroup {
                id: sg_id,
                root_id: "root-1",
                relative_path: "",
                content_signature: Some("sig"),
                format: Some("fits"),
                lane: Some("fits"),
                file_count: 1,
            },
        )
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO inbox_items \
             (id, root_id, relative_path, source_group_id, group_key, group_label, \
              frame_type, file_count, discovered_at, last_scanned_at, \
              content_signature, state, lane) \
             VALUES (?, 'root-1', '', ?, '', NULL, NULL, 1, \
                     datetime('now'), datetime('now'), 'sig', 'pending_classification', 'fits')",
        )
        .bind(placeholder_id)
        .bind(sg_id)
        .execute(db.pool())
        .await
        .unwrap();

        let first = crate::classify::classify(
            db.pool(),
            crate::classify::ClassifyRequest {
                inbox_item_id: placeholder_id.to_owned(),
                root_absolute_path: root.path().to_owned(),
                force_rescan: false,
            },
        )
        .await
        .unwrap();
        assert_eq!(first.classification_type, "unclassified");

        // Apply #1 — ONLY frameType=light. Light is missing its mandatory
        // exposureS, so this correctly routes to a needs-review sub-item.
        let apply1 = reclassify_v2(
            db.pool(),
            InboxReclassifyV2Request {
                root_absolute_path: root.path().to_string_lossy().into_owned(),
                source_group_id: Some(sg_id.to_owned()),
                inbox_item_id: None,
                overrides: vec![],
                bulk: vec![InboxReclassifyBulk {
                    property: "frameType".to_owned(),
                    value: serde_json::json!("light").into(),
                    file_paths: None,
                }],
            },
        )
        .await
        .unwrap();
        assert_eq!(
            apply1.needs_review_count, 1,
            "light without exposureS must be needs-review after apply #1: {apply1:?}"
        );

        // Apply #2 — frameType=light + exposureS=300. Mandatory now satisfied;
        // the group must resolve to a single `light` sub-item.
        let apply2 = reclassify_v2(
            db.pool(),
            InboxReclassifyV2Request {
                root_absolute_path: root.path().to_string_lossy().into_owned(),
                source_group_id: Some(sg_id.to_owned()),
                inbox_item_id: None,
                overrides: vec![],
                bulk: vec![
                    InboxReclassifyBulk {
                        property: "frameType".to_owned(),
                        value: serde_json::json!("light").into(),
                        file_paths: None,
                    },
                    InboxReclassifyBulk {
                        property: "exposureS".to_owned(),
                        value: serde_json::json!(300.0).into(),
                        file_paths: None,
                    },
                ],
            },
        )
        .await
        .unwrap();

        assert_eq!(
            apply2.needs_review_count, 0,
            "apply #2 supplies exposureS, so nothing is needs-review: {apply2:?}"
        );
        let light = apply2.sub_items.iter().find(|s| s.frame_type.as_deref() == Some("light"));
        assert!(
            light.is_some(),
            "apply #2 must resolve the group to a light sub-item (Confirm gate): {:?}",
            apply2.sub_items
        );
        assert!(
            light.unwrap().missing_mandatory.is_empty(),
            "resolved light sub-item must report no missing mandatory attrs: {light:?}"
        );
    }

    /// Real-UI E2E `inbox_ui_unclassified_gate_bulk_reclassify_unblocks_confirm`
    /// faithful backend replay: the E2E does ONE bulk apply carrying BOTH
    /// frameType=light AND exposureS=300 (two bulk entries, both filePaths:None),
    /// identified by `inboxItemId` = the folder PLACEHOLDER (group_key=''),
    /// after a real `classify()` left it unclassified. The failing CI dump shows
    /// this returns `subItems:[] / needsReviewCount:0` — no light sub-item is
    /// materialized, so Confirm never enables. This replays that exact shape.
    #[tokio::test]
    #[allow(clippy::too_many_lines)] // real-pipeline regression test: scan/classify/reclassify/refetch
    async fn v2_single_combined_apply_on_placeholder_resolves_single_type() {
        let root = tempfile::tempdir().unwrap();
        let fits_path = root.path().join("ambiguous_001.fits");
        {
            let mut data = vec![b' '; 2880];
            let cards = ["IMAGETYP= 'Frame Unknown'", "OBJECT  = 'M42'", "FILTER  = 'Ha'"];
            for (i, c) in cards.iter().enumerate() {
                let card = format!("{c:<80}");
                data[i * 80..i * 80 + 80].copy_from_slice(card.as_bytes());
            }
            data[cards.len() * 80..cards.len() * 80 + 3].copy_from_slice(b"END");
            std::fs::write(&fits_path, &data).unwrap();
        }

        let db = test_db().await;
        let sg_id = "sg-combined";
        let placeholder_id = "item-combined";

        // The source group carries the MOVE-vs-catalogue lane an unorganized
        // root gets at scan time ('move'), NOT the fits/video lane inbox_items
        // requires. reclassify_v2 must not propagate this into the sub-item
        // upsert (issue #854 — 'move' fails CHECK(lane IN ('fits','video')),
        // silently dropping the resolved sub-item so Confirm never re-enables).
        upsert_inbox_source_group(
            db.pool(),
            &UpsertSourceGroup {
                id: sg_id,
                root_id: "root-1",
                relative_path: "",
                content_signature: Some("sig"),
                format: Some("fits"),
                lane: Some("move"),
                file_count: 1,
            },
        )
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO inbox_items \
             (id, root_id, relative_path, source_group_id, group_key, group_label, \
              frame_type, file_count, discovered_at, last_scanned_at, \
              content_signature, state, lane) \
             VALUES (?, 'root-1', '', ?, '', NULL, NULL, 1, \
                     datetime('now'), datetime('now'), 'sig', 'pending_classification', 'fits')",
        )
        .bind(placeholder_id)
        .bind(sg_id)
        .execute(db.pool())
        .await
        .unwrap();

        let first = crate::classify::classify(
            db.pool(),
            crate::classify::ClassifyRequest {
                inbox_item_id: placeholder_id.to_owned(),
                root_absolute_path: root.path().to_owned(),
                force_rescan: false,
            },
        )
        .await
        .unwrap();
        assert_eq!(first.classification_type, "unclassified");

        // ONE apply, both properties, identified by inbox_item_id — the exact
        // E2E shape.
        let apply = reclassify_v2(
            db.pool(),
            InboxReclassifyV2Request {
                root_absolute_path: root.path().to_string_lossy().into_owned(),
                source_group_id: None,
                inbox_item_id: Some(placeholder_id.to_owned()),
                overrides: vec![],
                bulk: vec![
                    InboxReclassifyBulk {
                        property: "frameType".to_owned(),
                        value: serde_json::json!("light").into(),
                        file_paths: None,
                    },
                    InboxReclassifyBulk {
                        property: "exposureS".to_owned(),
                        value: serde_json::json!(300.0).into(),
                        file_paths: None,
                    },
                ],
            },
        )
        .await
        .unwrap();

        assert_eq!(apply.needs_review_count, 0, "first apply must resolve: {apply:?}");
        assert!(
            apply.sub_items.iter().any(|s| s.frame_type.as_deref() == Some("light")),
            "first apply must resolve to a light sub-item: {:?}",
            apply.sub_items
        );

        // The frontend refetches the placeholder's classification after the
        // apply (store.ts invalidates the classify query). This re-runs
        // `materialize_sub_items` for the (now light) group, which is the
        // re-materialization that used to seed the discarded ON-CONFLICT id
        // and strand the real sub-item without evidence (issue #854).
        let _ = crate::classify::classify(
            db.pool(),
            crate::classify::ClassifyRequest {
                inbox_item_id: placeholder_id.to_owned(),
                root_absolute_path: root.path().to_owned(),
                force_rescan: true,
            },
        )
        .await;

        // Second apply — same overrides, still identified by the PLACEHOLDER id,
        // now against the materialized light-sub-item state. This is what the
        // E2E's UI-apply-then-refetch/retry actually exercises.
        let apply2 = reclassify_v2(
            db.pool(),
            InboxReclassifyV2Request {
                root_absolute_path: root.path().to_string_lossy().into_owned(),
                source_group_id: None,
                inbox_item_id: Some(placeholder_id.to_owned()),
                overrides: vec![],
                bulk: vec![
                    InboxReclassifyBulk {
                        property: "frameType".to_owned(),
                        value: serde_json::json!("light").into(),
                        file_paths: None,
                    },
                    InboxReclassifyBulk {
                        property: "exposureS".to_owned(),
                        value: serde_json::json!(300.0).into(),
                        file_paths: None,
                    },
                ],
            },
        )
        .await
        .unwrap();

        assert_eq!(apply2.needs_review_count, 0, "second apply must stay resolved: {apply2:?}");
        let light = apply2.sub_items.iter().find(|s| s.frame_type.as_deref() == Some("light"));
        assert!(
            light.is_some(),
            "second apply must still resolve to a light sub-item: {:?}",
            apply2.sub_items
        );
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
                root_absolute_path: "/nonexistent-root".to_owned(),
                source_group_id: Some("sg-offset-temp".to_owned()),
                inbox_item_id: None,
                overrides: vec![
                    InboxReclassifyFileOverride {
                        file_path: "inbox_folder/frame_001.fits".to_owned(),
                        properties: {
                            let mut m = std::collections::HashMap::new();
                            m.insert("frameType".to_owned(), serde_json::json!("dark").into());
                            m.insert("exposureS".to_owned(), serde_json::json!(300.0).into());
                            m.insert("gain".to_owned(), serde_json::json!(100).into());
                            m.insert("offset".to_owned(), serde_json::json!(50).into());
                            m.insert("temperatureC".to_owned(), serde_json::json!(-10.0).into());
                            m
                        },
                    },
                    InboxReclassifyFileOverride {
                        file_path: "inbox_folder/frame_002.fits".to_owned(),
                        properties: {
                            let mut m = std::collections::HashMap::new();
                            m.insert("frameType".to_owned(), serde_json::json!("dark").into());
                            m.insert("exposureS".to_owned(), serde_json::json!(300.0).into());
                            m.insert("gain".to_owned(), serde_json::json!(100).into());
                            m.insert("offset".to_owned(), serde_json::json!(500).into());
                            m.insert("temperatureC".to_owned(), serde_json::json!(-20.0).into());
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
                root_absolute_path: "/nonexistent-root".to_owned(),
                source_group_id: Some("sg-unk".to_owned()),
                inbox_item_id: None,
                overrides: vec![InboxReclassifyFileOverride {
                    file_path: "inbox_folder/frame_001.fits".to_owned(),
                    properties: {
                        let mut m = std::collections::HashMap::new();
                        m.insert("notARealProperty".to_owned(), serde_json::json!("x").into());
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
                root_absolute_path: "/nonexistent-root".to_owned(),
                source_group_id: Some("sg-noo".to_owned()),
                inbox_item_id: None,
                overrides: vec![InboxReclassifyFileOverride {
                    file_path: "inbox_folder/frame_001.fits".to_owned(),
                    properties: {
                        let mut m = std::collections::HashMap::new();
                        m.insert("skyRotationDeg".to_owned(), serde_json::json!(45.0).into());
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
                root_absolute_path: "/nonexistent-root".to_owned(),
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
                root_absolute_path: "/nonexistent-root".to_owned(),
                source_group_id: Some("sg-bexp".to_owned()),
                inbox_item_id: None,
                overrides: vec![],
                bulk: vec![InboxReclassifyBulk {
                    property: "gain".to_owned(),
                    value: serde_json::json!(100).into(),
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

    // ── Confirm staleness guard: per-item signatures (spec 058 Q-5) ───────────

    /// `folder_signature(vec![])` — sha256 of empty input. The value every
    /// re-split sub-item carried while `reclassify_v2` passed no file paths.
    const EMPTY_SET_SIGNATURE: &str =
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

    /// Minimal FITS header with an unmapped IMAGETYP, so classify yields
    /// `unclassified` and the bulk reclassify below drives the re-split.
    /// `pad` varies the file's byte length to give it distinct content.
    fn write_ambiguous_fits(path: &std::path::Path, object: &str, pad: usize) {
        write_fits_cards(
            path,
            &[
                "IMAGETYP= 'Frame Unknown'".to_owned(),
                format!("OBJECT  = '{object}'"),
                "FILTER  = 'Ha'".to_owned(),
            ],
            pad,
        );
    }

    /// Write a minimal single-block FITS file carrying `cards` in its header.
    /// `pad` varies the file's byte length to give it distinct content.
    fn write_fits_cards(path: &std::path::Path, cards: &[String], pad: usize) {
        let mut data = vec![b' '; 2880 + pad];
        for (i, c) in cards.iter().enumerate() {
            let card = format!("{c:<80}");
            data[i * 80..i * 80 + 80].copy_from_slice(card.as_bytes());
        }
        data[cards.len() * 80..cards.len() * 80 + 3].copy_from_slice(b"END");
        std::fs::write(path, &data).unwrap();
    }

    /// Seed a source group + placeholder item and run the real classify pass.
    async fn seed_and_classify(
        pool: &sqlx::SqlitePool,
        root: &std::path::Path,
        sg_id: &str,
        item_id: &str,
        root_id: &str,
    ) {
        upsert_inbox_source_group(
            pool,
            &UpsertSourceGroup {
                id: sg_id,
                root_id,
                relative_path: "",
                content_signature: Some("sig"),
                format: Some("fits"),
                lane: Some("fits"),
                file_count: 1,
            },
        )
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO inbox_items \
             (id, root_id, relative_path, source_group_id, group_key, group_label, \
              frame_type, file_count, discovered_at, last_scanned_at, \
              content_signature, state, lane) \
             VALUES (?, ?, '', ?, '', NULL, NULL, 1, \
                     datetime('now'), datetime('now'), 'sig', 'pending_classification', 'fits')",
        )
        .bind(item_id)
        .bind(root_id)
        .bind(sg_id)
        .execute(pool)
        .await
        .unwrap();

        crate::classify::classify(
            pool,
            crate::classify::ClassifyRequest {
                inbox_item_id: item_id.to_owned(),
                root_absolute_path: root.to_owned(),
                force_rescan: false,
            },
        )
        .await
        .unwrap();
    }

    /// Run `reclassify_v2` over the whole group and return the re-materialized
    /// sub-items' stored `content_signature`s — the exact values `confirm.rs`
    /// compares the request's signature against.
    async fn resplit_signatures(
        pool: &sqlx::SqlitePool,
        root: &std::path::Path,
        sg_id: &str,
    ) -> Vec<String> {
        reclassify_v2(
            pool,
            InboxReclassifyV2Request {
                root_absolute_path: root.to_string_lossy().into_owned(),
                source_group_id: Some(sg_id.to_owned()),
                inbox_item_id: None,
                overrides: vec![],
                bulk: vec![
                    InboxReclassifyBulk {
                        property: "frameType".to_owned(),
                        value: serde_json::json!("light").into(),
                        file_paths: None,
                    },
                    InboxReclassifyBulk {
                        property: "exposureS".to_owned(),
                        value: serde_json::json!(300.0).into(),
                        file_paths: None,
                    },
                ],
            },
        )
        .await
        .unwrap();

        let mut sigs: Vec<String> = inbox_repo::list_inbox_sub_items(pool, sg_id)
            .await
            .unwrap()
            .into_iter()
            .filter_map(|r| r.content_signature)
            .collect();
        sigs.sort();
        sigs
    }

    /// Two-direction control for the confirm staleness guard (spec 058 Q-5).
    ///
    /// `reclassify_v2` used to call `materialize_sub_items` with an empty
    /// `file_paths` slice, so every re-split sub-item's `content_signature`
    /// became `folder_signature(vec![])` — the fixed constant
    /// [`EMPTY_SET_SIGNATURE`], identical in every folder and every library.
    /// `confirm.rs`'s TOCTOU guard therefore compared equal unconditionally and
    /// could never fire on the reclassify path; it would also have compared
    /// equal between two entirely unrelated items.
    ///
    /// Asserts both properties the guard depends on: signatures distinguish
    /// distinct items, and they track the files' actual bytes on disk.
    #[tokio::test]
    async fn v2_resplit_signatures_are_per_item_and_track_file_content() {
        let db = test_db().await;

        let root_a = tempfile::tempdir().unwrap();
        let file_a = root_a.path().join("frame_a.fits");
        write_ambiguous_fits(&file_a, "M42", 0);
        seed_and_classify(db.pool(), root_a.path(), "sg-sig-a", "item-sig-a", "root-sig-a").await;
        let sigs_a = resplit_signatures(db.pool(), root_a.path(), "sg-sig-a").await;

        let root_b = tempfile::tempdir().unwrap();
        write_ambiguous_fits(&root_b.path().join("frame_b.fits"), "M31", 1024);
        seed_and_classify(db.pool(), root_b.path(), "sg-sig-b", "item-sig-b", "root-sig-b").await;
        let sigs_b = resplit_signatures(db.pool(), root_b.path(), "sg-sig-b").await;

        assert!(!sigs_a.is_empty(), "re-split must materialize at least one sub-item");

        // Direction 1: the empty-set constant is gone — signatures hash real files.
        for sig in sigs_a.iter().chain(&sigs_b) {
            assert_ne!(
                sig, EMPTY_SET_SIGNATURE,
                "re-split sub-item still carries the signature of the empty set — \
                 reclassify_v2 is not hashing its files"
            );
        }

        // Direction 2: two unrelated items no longer collide.
        assert_ne!(
            sigs_a, sigs_b,
            "two items that have both been through reclassify_v2 share an identical \
             signature — the confirm staleness guard cannot distinguish them"
        );

        // Direction 3: a genuine file change is detected. Evidence is served
        // from the DB cache, so only the on-disk bytes move here — precisely
        // the TOCTOU the guard exists to catch.
        write_ambiguous_fits(&file_a, "M42", 2880);
        let sigs_a_after = resplit_signatures(db.pool(), root_a.path(), "sg-sig-a").await;
        assert_ne!(
            sigs_a, sigs_a_after,
            "sub-item signature did not change after its file changed on disk — \
             confirm would build a plan from a stale picture"
        );
    }

    /// Spec 058 T012 blocker, pinned executable: **nothing today can turn a
    /// bare source group into item rows.**
    ///
    /// FR-015 wants scan to create the source group and no inbox item, and
    /// `data-model.md`'s state diagram then has classification materialize the
    /// item rows. But the only two callers of `materialize_sub_items` both
    /// require an item row to already exist:
    ///
    /// - `classify()` is keyed on `inbox_item_id` and fails with
    ///   `InboxItemNotFound` without one (`classify.rs:87`);
    /// - `reclassify_v2()` takes a `sourceGroupId`, but rebuilds its
    ///   `file_records` from persisted `inbox_classification_evidence` /
    ///   `inbox_file_metadata`, which are only ever written against an item id.
    ///
    /// So removing the scan-time placeholder without adding a group-scoped
    /// classification entry point that reads headers from disk leaves the
    /// folder permanently unclassifiable: no item, therefore no evidence,
    /// therefore no item. This test asserts the missing capability from the
    /// outside — real FITS on disk, a real source group, no item row — and
    /// must be INVERTED (into "materializes >= 1 sub-item") by whoever builds
    /// that entry point.
    #[tokio::test]
    async fn source_group_without_items_cannot_be_classified_today_058() {
        let db = test_db().await;
        let root = tempfile::tempdir().unwrap();
        write_ambiguous_fits(&root.path().join("frame.fits"), "M42", 0);

        upsert_inbox_source_group(
            db.pool(),
            &UpsertSourceGroup {
                id: "sg-bare",
                root_id: "root-bare",
                relative_path: "",
                content_signature: Some("sig"),
                format: Some("fits"),
                lane: Some("move"),
                file_count: 1,
            },
        )
        .await
        .unwrap();

        // Deliberately NO inbox_items row — this is the post-FR-015 shape.
        let sigs = resplit_signatures(db.pool(), root.path(), "sg-bare").await;

        assert!(
            sigs.is_empty(),
            "reclassify_v2 materialized sub-items for a source group with no prior \
             item rows — the T012 blocker is gone and this test must be inverted"
        );
    }

    /// Spec 058 SC-003 (T023): **no `inbox_items` row may report
    /// `state = 'classified'` while carrying no frame type.**
    ///
    /// Swept table-wide after running the REAL classify pass over all three
    /// folder shapes 058 names — uniform, mixed, and needs-review — because the
    /// two writers that produced the violation are on different code paths:
    /// the folder aggregate is flipped by `classify()`'s step 9, while a
    /// needs-review sub-item is written by `upsert_inbox_sub_item`. A test
    /// scoped to either one alone passes while the other still lies.
    ///
    /// **Scope**: the SELECT is table-wide, but the fixture is classify-only —
    /// it never confirms an item, opens a plan or cancels one, so the plan
    /// lifecycle writers are out of its reach no matter what the sweep selects.
    /// They are guarded separately by `app_core`'s
    /// `cancel_does_not_report_classified_without_a_frame_type_sc003` and by
    /// `plan_listener`'s
    /// `discarded_plan_does_not_report_classified_without_a_frame_type_sc003`.
    /// Neither can be driven from here: `app_core` depends on this crate, so
    /// SC-003 needs three tests rather than one.
    #[tokio::test]
    async fn no_item_reports_classified_without_a_frame_type_sc003() {
        let db = test_db().await;

        let light = |object: &str| {
            vec![
                "IMAGETYP= 'LIGHT'".to_owned(),
                format!("OBJECT  = '{object}'"),
                "FILTER  = 'Ha'".to_owned(),
                "EXPTIME =            300.0".to_owned(),
                "GAIN    =              100".to_owned(),
            ]
        };
        let dark = || {
            vec![
                "IMAGETYP= 'DARK'".to_owned(),
                "EXPTIME =            300.0".to_owned(),
                "GAIN    =              100".to_owned(),
            ]
        };

        // Uniform — every file the same fully-attributed frame type.
        let uniform = tempfile::tempdir().unwrap();
        write_fits_cards(&uniform.path().join("a.fits"), &light("M42"), 0);
        write_fits_cards(&uniform.path().join("b.fits"), &light("M42"), 80);
        seed_and_classify(db.pool(), uniform.path(), "sg-u", "item-u", "root-u").await;

        // Mixed — two frame types in one folder, so the aggregate resolves to
        // no single frame type at all. This is the #711 shape.
        let mixed = tempfile::tempdir().unwrap();
        write_fits_cards(&mixed.path().join("a.fits"), &light("M31"), 0);
        write_fits_cards(&mixed.path().join("b.fits"), &dark(), 160);
        seed_and_classify(db.pool(), mixed.path(), "sg-m", "item-m", "root-m").await;

        // Needs-review — an unmapped IMAGETYP yields no frame type.
        let review = tempfile::tempdir().unwrap();
        write_ambiguous_fits(&review.path().join("a.fits"), "M13", 240);
        seed_and_classify(db.pool(), review.path(), "sg-r", "item-r", "root-r").await;

        let total: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM inbox_items")
            .fetch_one(db.pool())
            .await
            .unwrap();
        assert!(total >= 3, "fixture is vacuous — classify produced no item rows at all");

        // Positive direction. Without this, a regression that leaves EVERY row
        // at `pending_classification` — classification silently never
        // completing — satisfies the sweep below trivially and stays green.
        let classified: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM inbox_items
             WHERE state = 'classified' AND frame_type IS NOT NULL",
        )
        .fetch_one(db.pool())
        .await
        .unwrap();
        assert!(
            classified >= 1,
            "fixture is vacuous — no row reached `classified` at all, so the sweep below \
             proves nothing"
        );

        let offenders: Vec<(String, String, String)> = sqlx::query_as(
            "SELECT id, state, COALESCE(group_key, '<null>') FROM inbox_items
             WHERE state = 'classified' AND frame_type IS NULL",
        )
        .fetch_all(db.pool())
        .await
        .unwrap();

        assert!(
            offenders.is_empty(),
            "SC-003: {} row(s) report `classified` with no frame type: {offenders:?}",
            offenders.len()
        );
    }
}
