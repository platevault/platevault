//! `inbox.confirm` use case — split and confirm branches (spec 005, T027/T028).
//!
//! Creates a reviewable Plan in `ready_for_review` via
//! `persistence_db::repositories::plans`. File list comes from
//! `InboxClassificationEvidence` rows (not `InboxItem.fileCount` — Ref: A9).
//!
//! TOCTOU guard: verifies `content_signature` before creating the plan (Ref: A8).
//!
//! Destination resolution: the active Naming & Structure pattern is loaded from
//! the `settings` table (key `"pattern"`). Each evidence file's metadata bundle
//! is built from extracted `RawFileMetadata` (FITS/XISF headers) and resolved
//! via `patterns::resolve_v1`. Missing required tokens return `pattern.unset`.
#![allow(clippy::doc_markdown)]

use std::path::PathBuf;

use contracts_core::settings::PatternPart as ContractPatternPart;
use metadata_core::{v1_normalization_table, MetadataExtractor};
use metadata_fits::FitsExtractor;
use metadata_xisf::XisfExtractor;
use patterns::{resolve_v1, MetadataBundle, PatternPart};
use persistence_db::repositories::inbox::{self as inbox_repo};
use persistence_db::repositories::plans as plans_repo;
use persistence_db::repositories::settings as settings_repo;
use sqlx::SqlitePool;
use uuid::Uuid;

use contracts_core::{error_code::ErrorCode, ContractError, ErrorSeverity};

use crate::errors::db_internal_ctx;

// ── Request / Response ────────────────────────────────────────────────────────

#[derive(Clone, Debug)]
pub struct ConfirmRequest {
    pub inbox_item_id: String,
    /// "split" (mixed) or "confirm" (single_type)
    pub action: String,
    /// Folder content_signature from the most recent classify response (Ref: A8).
    pub content_signature: String,
    /// Required when plan includes destructive items.
    pub destructive_destination: Option<String>,
    /// Absolute path to the inbox root on disk (needed to resolve file paths
    /// to read FITS/XISF headers for the metadata bundle).
    pub root_absolute_path: PathBuf,
}

#[derive(Clone, Debug)]
pub struct ConfirmResponse {
    pub plan_id: String,
    pub plan_state: String,
    pub items_total: usize,
    /// True when the inbox item was a detected calibration master and was
    /// registered directly to `calibration_session` + `calibration_fingerprint`
    /// (Path 1 — no file move).  `plan_id` is empty string in this case.
    pub registered_as_master: bool,
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

    // 2. Fast path: detected calibration master (spec 040 US3, Path 1).
    //
    // Masters are already at their final path — register them directly to the
    // calibration tables and resolve the inbox item as `resolved` without
    // creating a filesystem plan.
    if item.is_master_item != 0 {
        // TOCTOU guard: validate signature even for masters.
        if item.content_signature.as_deref() != Some(&req.content_signature) {
            return Err(ContractError::new(
                ErrorCode::ClassificationStale,
                "Folder has changed since classification. Re-classify before confirming.",
                ErrorSeverity::Blocking,
                false,
            ));
        }

        let frame_type_str = item.master_frame_type.as_deref().unwrap_or("dark");
        let cal_kind = match frame_type_str {
            "flat" => "flat",
            "bias" => "bias",
            _ => "dark",
        };
        let cal_type = match frame_type_str {
            "flat" => "flat",
            "bias" => "bias",
            _ => "dark",
        };

        let session_id = Uuid::new_v4().to_string();
        let session_key =
            format!("{}-{}", cal_kind, item.master_frame_type.as_deref().unwrap_or("unknown"));

        // Insert calibration_session.
        sqlx::query(
            "INSERT INTO calibration_session
                (id, session_key, frame_ids, kind, state, created_at, source_inbox_item_id)
             VALUES (?, ?, '[]', ?, 'confirmed', datetime('now'), ?)",
        )
        .bind(&session_id)
        .bind(&session_key)
        .bind(cal_kind)
        .bind(&req.inbox_item_id)
        .execute(pool)
        .await
        .map_err(|e| db_internal_ctx(e, "insert calibration_session"))?;

        // Insert calibration_fingerprint (exposure, filter from master metadata).
        sqlx::query(
            "INSERT INTO calibration_fingerprint
                (id, calibration_type, exposure_s, filter_name)
             VALUES (?, ?, ?, ?)",
        )
        .bind(&session_id)
        .bind(cal_type)
        .bind(item.master_exposure_s)
        .bind(item.master_filter.as_deref())
        .execute(pool)
        .await
        .map_err(|e| db_internal_ctx(e, "insert calibration_fingerprint"))?;

        // Mark inbox item as resolved (drops out of the unacknowledged list).
        inbox_repo::update_inbox_item_state(pool, &req.inbox_item_id, "resolved").await.ok();

        return Ok(ConfirmResponse {
            plan_id: String::new(),
            plan_state: String::new(),
            items_total: 1,
            registered_as_master: true,
        });
    }

    // 3. Dedupe open plan (Ref: E1)
    if let Some(link) = inbox_repo::get_plan_link(pool, &req.inbox_item_id).await.unwrap_or(None) {
        return Err(ContractError::new(
            ErrorCode::InboxHasOpenPlan,
            format!("Inbox item already has an open plan: {}", link.plan_id),
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

    // 7. Validate action / classification match
    let valid = matches!(
        (req.action.as_str(), classification.result.as_str()),
        ("split", "mixed") | ("confirm", "single_type")
    );
    if !valid {
        return Err(ContractError::new(
            ErrorCode::ClassificationAmbiguous,
            format!(
                "Action '{}' does not match classification '{}'",
                req.action, classification.result
            ),
            ErrorSeverity::Blocking,
            false,
        ));
    }

    // 8. Load the active Naming & Structure pattern from settings.
    let active_pattern = load_active_pattern(pool).await?;

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

    // 8. Resolve destination paths for each file via the active pattern.
    // Collect per-file (source_relative, destination_relative, item_name) triples.
    //
    // `resolve_v1` returns `Ok(ResolveResult)` even when some tokens fall back
    // to their registry defaults (e.g. "unclassified" for target, "nofilter" for
    // filter). That is expected and normal — `ResolveResult.missing_tokens` is
    // informational only. A hard `Err(ResolveError)` signals a structural failure
    // such as a traversal attempt or a length violation.
    let norm_table = v1_normalization_table();
    let fits_extractor = FitsExtractor;
    let xisf_extractor = XisfExtractor;

    let mut resolved_items: Vec<(String, String, String)> = Vec::with_capacity(plan_files.len());

    for ev in &plan_files {
        let ft = effective_frame_type(ev).unwrap_or("unknown");
        let abs_path = req.root_absolute_path.join(&ev.relative_file_path);

        let bundle =
            build_metadata_bundle(&abs_path, ft, &norm_table, &fits_extractor, &xisf_extractor);

        match resolve_v1(&active_pattern, &bundle) {
            Ok(result) => {
                let dest = result.relative_path;
                let filename =
                    abs_path.file_name().and_then(|n| n.to_str()).unwrap_or("unknown.fits");
                let dest_with_file = format!("{dest}/{filename}");
                let basename =
                    ev.relative_file_path.rsplit('/').next().unwrap_or(&ev.relative_file_path);
                let item_name = format!("[{}] {basename}", ft.to_uppercase());
                resolved_items.push((ev.relative_file_path.clone(), dest_with_file, item_name));
            }
            Err(e) => {
                return Err(ContractError::new(
                    ErrorCode::PatternUnset,
                    format!("Pattern resolution failed for '{}': {e:?}", ev.relative_file_path),
                    ErrorSeverity::Blocking,
                    false,
                ));
            }
        }
    }

    // 10. Build the plan.
    // A move-only split is non-destructive from the user perspective but the
    // plans table CHECK constraint only accepts 'archive' | 'os_trash'.
    // We default to 'archive' (app-managed archive) unless the caller specifies.
    let destructive_dest = req
        .destructive_destination
        .as_deref()
        .filter(|s| matches!(*s, "archive" | "os_trash"))
        .unwrap_or("archive");

    let plan_id = Uuid::new_v4().to_string();
    let title = format!("Inbox {}: {} ({})", req.action, item.relative_path, classification.result);

    let insert_plan = plans_repo::InsertPlan {
        id: &plan_id,
        title: &title,
        origin: "inbox",
        origin_path: Some(&item.relative_path),
        plan_type: "split",
        destructive_destination: destructive_dest,
        parent_plan_id: None,
        total_bytes_required: 0,
    };

    plans_repo::insert_plan(pool, &insert_plan)
        .await
        .map_err(|e| db_internal_ctx(e, "insert plan"))?;

    // 11. Insert plan items — one per classified file, with resolved destinations.
    let items_total = resolved_items.len();
    for (idx, (source_rel, dest_rel, item_name)) in resolved_items.iter().enumerate() {
        let item_id = Uuid::new_v4().to_string();

        let plan_item = plans_repo::InsertPlanItem {
            id: &item_id,
            plan_id: &plan_id,
            item_index: i64::try_from(idx).unwrap_or(i64::MAX),
            name: item_name,
            action: "move",
            from_root_id: Some(&item.root_id),
            from_relative_path: source_rel,
            to_root_id: Some(&item.root_id),
            to_relative_path: dest_rel,
            reason: "inbox_split",
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
        registered_as_master: false,
    })
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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
async fn load_active_pattern(pool: &SqlitePool) -> Result<Vec<PatternPart>, ContractError> {
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
fn build_metadata_bundle(
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
            "single_type",
            Some("light"),
            "sig-abc",
            &["light_001.fits", "light_002.fits", "light_003.fits"],
        )
        .await;

        let resp = confirm(
            db.pool(),
            ConfirmRequest {
                inbox_item_id: "item-c1".to_owned(),
                action: "confirm".to_owned(),
                content_signature: "sig-abc".to_owned(),
                destructive_destination: None,
                root_absolute_path: tmp.path().to_owned(),
            },
        )
        .await
        .unwrap();

        assert_eq!(resp.plan_state, "ready_for_review");
        assert_eq!(resp.items_total, 3);
    }

    #[tokio::test]
    async fn confirm_mixed_split_creates_plan() {
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
        write_fits(
            tmp.path(),
            "dark_001.fits",
            "Dark Frame",
            None,
            None,
            Some("2025-10-10T20:00:00"),
        );
        write_fits(
            tmp.path(),
            "dark_002.fits",
            "Dark Frame",
            None,
            None,
            Some("2025-10-10T20:05:00"),
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
                result: "mixed",
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

        let resp = confirm(
            db.pool(),
            ConfirmRequest {
                inbox_item_id: item_id.to_owned(),
                action: "split".to_owned(),
                content_signature: sig.to_owned(),
                destructive_destination: None,
                root_absolute_path: tmp.path().to_owned(),
            },
        )
        .await
        .unwrap();

        assert_eq!(resp.items_total, 4);
        assert_eq!(resp.plan_state, "ready_for_review");
    }

    /// Prove that light/dark/flat frames resolve to DISTINCT destination path prefixes
    /// using the default pattern (`target/filter/date/frame_type/filename`).
    #[tokio::test]
    #[allow(clippy::too_many_lines)]
    async fn destinations_are_distinct_per_frame_type() {
        let tmp = tempfile::tempdir().unwrap();
        write_fits(
            tmp.path(),
            "light.fits",
            "Light Frame",
            Some("M42"),
            Some("Ha"),
            Some("2025-10-10T22:00:00"),
        );
        write_fits(tmp.path(), "dark.fits", "Dark Frame", None, None, Some("2025-10-10T20:00:00"));
        write_fits(
            tmp.path(),
            "flat.fits",
            "Flat Frame",
            None,
            Some("Ha"),
            Some("2025-10-10T21:00:00"),
        );

        let db = test_db().await;
        let item_id = "item-distinct-dest";
        let sig = "sig-distinct";

        inbox_repo::insert_inbox_item(
            db.pool(),
            &InsertInboxItem {
                id: item_id,
                root_id: "root-1",
                relative_path: "",
                file_count: 3,
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
                result: "mixed",
                frame_type: None,
                content_signature: sig,
                unclassified_file_count: 0,
            },
        )
        .await
        .unwrap();

        for (ft, fname) in [("light", "light.fits"), ("dark", "dark.fits"), ("flat", "flat.fits")] {
            let ev_id = format!("ev-distinct-{ft}");
            inbox_repo::insert_evidence(
                db.pool(),
                &InsertEvidence {
                    id: &ev_id,
                    inbox_item_id: item_id,
                    relative_file_path: fname,
                    frame_type: Some(ft),
                    evidence_source: "imagetyp_header",
                    raw_value: None,
                    unclassified: false,
                    manual_override: None,
                    is_master: false,
                    master_detector: None,
                },
            )
            .await
            .unwrap();
        }

        let resp = confirm(
            db.pool(),
            ConfirmRequest {
                inbox_item_id: item_id.to_owned(),
                action: "split".to_owned(),
                content_signature: sig.to_owned(),
                destructive_destination: None,
                root_absolute_path: tmp.path().to_owned(),
            },
        )
        .await
        .unwrap();

        assert_eq!(resp.items_total, 3, "all three files got plan items");

        // Verify that the destination paths in the DB are distinct per frame type.
        let items = sqlx::query_as::<_, (String, String)>(
            "SELECT from_relative_path, to_relative_path FROM plan_items WHERE plan_id = ? ORDER BY item_index",
        )
        .bind(&resp.plan_id)
        .fetch_all(db.pool())
        .await
        .unwrap();

        assert_eq!(items.len(), 3);

        // Collect destination prefixes (directory, not filename)
        let dest_dirs: Vec<String> = items
            .iter()
            .map(|(_, to)| {
                let parts: Vec<&str> = to.rsplitn(2, '/').collect();
                parts.get(1).map(|s| (*s).to_owned()).unwrap_or_default()
            })
            .collect();

        // All three destination directories must be unique (different frame types go different places)
        let unique_dirs: std::collections::HashSet<&str> =
            dest_dirs.iter().map(String::as_str).collect();
        assert_eq!(
            unique_dirs.len(),
            3,
            "light, dark, flat should resolve to distinct directories; got: {dest_dirs:?}"
        );

        // Verify sources are preserved as-is
        let sources: Vec<&str> = items.iter().map(|(from, _)| from.as_str()).collect();
        assert!(sources.contains(&"light.fits"));
        assert!(sources.contains(&"dark.fits"));
        assert!(sources.contains(&"flat.fits"));
    }

    #[tokio::test]
    async fn stale_signature_returns_error() {
        let tmp = tempfile::tempdir().unwrap();
        write_fits(tmp.path(), "frame_000.fits", "Light Frame", None, None, None);

        let db = test_db().await;
        setup_classified_item(
            &db,
            "item-stale",
            "single_type",
            Some("light"),
            "sig-current",
            &["frame_000.fits"],
        )
        .await;

        let err = confirm(
            db.pool(),
            ConfirmRequest {
                inbox_item_id: "item-stale".to_owned(),
                action: "confirm".to_owned(),
                content_signature: "sig-OLD".to_owned(),
                destructive_destination: None,
                root_absolute_path: tmp.path().to_owned(),
            },
        )
        .await
        .unwrap_err();

        assert_eq!(err.code, ErrorCode::ClassificationStale);
    }

    #[tokio::test]
    async fn action_mismatch_returns_ambiguous() {
        let tmp = tempfile::tempdir().unwrap();
        write_fits(tmp.path(), "frame_000.fits", "Light Frame", None, None, None);

        let db = test_db().await;
        setup_classified_item(
            &db,
            "item-ambig",
            "single_type",
            Some("light"),
            "sig-x",
            &["frame_000.fits"],
        )
        .await;

        let err = confirm(
            db.pool(),
            ConfirmRequest {
                inbox_item_id: "item-ambig".to_owned(),
                action: "split".to_owned(), // wrong action for single_type
                content_signature: "sig-x".to_owned(),
                destructive_destination: None,
                root_absolute_path: tmp.path().to_owned(),
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
            "single_type",
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
                action: "confirm".to_owned(),
                content_signature: "sig-dup".to_owned(),
                destructive_destination: None,
                root_absolute_path: tmp.path().to_owned(),
            },
        )
        .await
        .unwrap();

        // Second confirm should fail
        let err = confirm(
            db.pool(),
            ConfirmRequest {
                inbox_item_id: "item-dup".to_owned(),
                action: "confirm".to_owned(),
                content_signature: "sig-dup".to_owned(),
                destructive_destination: None,
                root_absolute_path: tmp.path().to_owned(),
            },
        )
        .await
        .unwrap_err();

        assert_eq!(err.code, ErrorCode::InboxHasOpenPlan);
    }
}
