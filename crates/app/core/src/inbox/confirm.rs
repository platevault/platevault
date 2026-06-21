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

use contracts_core::first_run::OrganizationState;
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

use contracts_core::{ContractError, ErrorSeverity};

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
            "inbox.item.not_found",
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
            "inbox.has.open.plan",
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
                "inbox.item.not_found",
                "Classification not found — run inbox.classify first",
                ErrorSeverity::Blocking,
                false,
            )
        })?;

    // 5. TOCTOU content_signature guard (Ref: A8)
    if item.content_signature.as_deref() != Some(&req.content_signature) {
        return Err(ContractError::new(
            "classification.stale",
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
            "classification.ambiguous",
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
    let evidence_rows = inbox_repo::list_evidence(pool, &req.inbox_item_id).await.map_err(|e| {
        ContractError::new("internal.database", e.to_string(), ErrorSeverity::Fatal, true)
    })?;

    // Only include files that have a frame type (classified or manually overridden)
    let mut plan_files: Vec<&persistence_db::repositories::inbox::InboxEvidenceRow> =
        evidence_rows.iter().filter(|ev| effective_frame_type(ev).is_some()).collect();

    if plan_files.is_empty() {
        return Err(ContractError::new(
            "classification.ambiguous",
            "No classified files found. Re-classify or reclassify unclassified files.",
            ErrorSeverity::Blocking,
            false,
        ));
    }

    // US5 (T036): order files by effective frame type so confirm emits one
    // contiguous action group per type within a single plan (each type resolves
    // to its own pattern-derived destination). A multi-type folder therefore
    // auto-splits on confirm — there is no separate "split" command path; the
    // `split` action just labels a confirm whose classification is `mixed`.
    plan_files.sort_by(|a, b| {
        effective_frame_type(a)
            .unwrap_or("")
            .cmp(effective_frame_type(b).unwrap_or(""))
            .then_with(|| a.relative_file_path.cmp(&b.relative_file_path))
    });

    // 8a. Look up the owning source's organization state (spec 041 US4, R-7).
    //
    // `Organized`   → catalogue-in-place (record where the file already is; no
    //                 filesystem move; from_path == to_path == current path).
    // `Unorganized` → move to the pattern-resolved destination.
    //
    // An inbox item shares one root, so this is uniform in practice; the loop
    // below still decides per file so it composes with future mixed-provenance
    // cases (R-8) without special-casing.
    let org_state = crate::first_run::get_source_organization_state(pool, &item.root_id).await?;

    // 8b. Resolve destination paths for each file via the active pattern.
    // Collect per-file (source_relative, destination_relative, item_name, action)
    // tuples. `action` is "catalogue" for organized provenance, "move" otherwise.
    //
    // `resolve_v1` returns `Ok(ResolveResult)` even when some tokens fall back
    // to their registry defaults (e.g. "unclassified" for target, "nofilter" for
    // filter). That is expected and normal — `ResolveResult.missing_tokens` is
    // informational only. A hard `Err(ResolveError)` signals a structural failure
    // such as a traversal attempt or a length violation.
    let norm_table = v1_normalization_table();
    let fits_extractor = FitsExtractor;
    let xisf_extractor = XisfExtractor;

    let mut resolved_items: Vec<(String, String, String, &'static str)> =
        Vec::with_capacity(plan_files.len());

    for ev in &plan_files {
        let ft = effective_frame_type(ev).unwrap_or("unknown");
        let abs_path = req.root_absolute_path.join(&ev.relative_file_path);

        let bundle =
            build_metadata_bundle(&abs_path, ft, &norm_table, &fits_extractor, &xisf_extractor);

        // Per-file move-vs-catalogue decision (spec 041 US4). Organized sources
        // never move; the destination is the file's current location.
        let file_org_state = org_state; // uniform per root today; per-file hook for R-8.

        match file_org_state {
            OrganizationState::Organized => {
                // Catalogue-in-place: dest == source; no pattern resolution needed.
                let basename =
                    ev.relative_file_path.rsplit('/').next().unwrap_or(&ev.relative_file_path);
                let item_name = format!("[{}] {basename}", ft.to_uppercase());
                resolved_items.push((
                    ev.relative_file_path.clone(),
                    ev.relative_file_path.clone(),
                    item_name,
                    "catalogue",
                ));
            }
            OrganizationState::Unorganized => match resolve_v1(&active_pattern, &bundle) {
                Ok(result) => {
                    let dest = result.relative_path;
                    let filename =
                        abs_path.file_name().and_then(|n| n.to_str()).unwrap_or("unknown.fits");
                    // Trim any trailing slash on the resolved directory so the
                    // joined path is `dir/file`, not `dir//file` (cosmetic in the
                    // plan preview; the OS normalises it on the actual move).
                    let dest_with_file = format!("{}/{filename}", dest.trim_end_matches('/'));
                    let basename =
                        ev.relative_file_path.rsplit('/').next().unwrap_or(&ev.relative_file_path);
                    let item_name = format!("[{}] {basename}", ft.to_uppercase());
                    resolved_items.push((
                        ev.relative_file_path.clone(),
                        dest_with_file,
                        item_name,
                        "move",
                    ));
                }
                Err(e) => {
                    return Err(ContractError::new(
                        "pattern.unset",
                        format!("Pattern resolution failed for '{}': {e:?}", ev.relative_file_path),
                        ErrorSeverity::Blocking,
                        false,
                    ));
                }
            },
        }
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

    plans_repo::insert_plan(pool, &insert_plan).await.map_err(|e| {
        ContractError::new("internal.database", e.to_string(), ErrorSeverity::Fatal, true)
    })?;

    // 11. Insert plan items — one per classified file, with resolved destinations.
    let items_total = resolved_items.len();
    let mut move_count = 0usize;
    let mut catalogue_count = 0usize;
    for (idx, (source_rel, dest_rel, item_name, action)) in resolved_items.iter().enumerate() {
        let item_id = Uuid::new_v4().to_string();

        match *action {
            "catalogue" => catalogue_count += 1,
            _ => move_count += 1,
        }

        let plan_item = plans_repo::InsertPlanItem {
            id: &item_id,
            plan_id: &plan_id,
            item_index: i64::try_from(idx).unwrap_or(i64::MAX),
            name: item_name,
            action,
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

        plans_repo::insert_plan_item(pool, &plan_item).await.map_err(|e| {
            ContractError::new("internal.database", e.to_string(), ErrorSeverity::Fatal, true)
        })?;
    }

    // 12. Transition plan to ready_for_review
    sqlx::query("UPDATE plans SET state = 'ready_for_review' WHERE id = ?")
        .bind(&plan_id)
        .execute(pool)
        .await
        .map_err(|e| {
            ContractError::new("internal.database", e.to_string(), ErrorSeverity::Fatal, true)
        })?;

    // 13. Create plan link and update item state
    inbox_repo::insert_plan_link(pool, &req.inbox_item_id, &plan_id).await.map_err(|e| {
        ContractError::new("internal.database", e.to_string(), ErrorSeverity::Fatal, true)
    })?;

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
                    "pattern.unset",
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
                "single_type",
                Some("light"),
                "sig-dd",
                &["light_001.fits"],
            )
            .await;

            let resp = confirm(
                db.pool(),
                ConfirmRequest {
                    inbox_item_id: "item-dd".to_owned(),
                    action: "confirm".to_owned(),
                    content_signature: "sig-dd".to_owned(),
                    destructive_destination: dest.map(str::to_owned),
                    root_absolute_path: tmp.path().to_owned(),
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

    /// US5 (T036/T037): confirming a multi-type folder auto-produces one
    /// contiguous action group per frame type, each with its own pattern-resolved
    /// destination — in a single confirm, no separate split step.
    #[tokio::test]
    async fn confirm_mixed_emits_per_type_action_groups() {
        let tmp = tempfile::tempdir().unwrap();
        for (fname, imagetyp, date) in [
            ("light_001.fits", "Light Frame", "2025-10-10T22:00:00"),
            ("light_002.fits", "Light Frame", "2025-10-10T22:05:00"),
            ("dark_001.fits", "Dark Frame", "2025-10-10T20:00:00"),
            ("dark_002.fits", "Dark Frame", "2025-10-10T20:05:00"),
        ] {
            let (object, filter) = if imagetyp == "Light Frame" {
                (Some("NGC7000"), Some("Ha"))
            } else {
                (None, None)
            };
            write_fits(tmp.path(), fname, imagetyp, object, filter, Some(date));
        }

        let db = test_db().await;
        setup_typed_item(
            &db,
            "item-pertype",
            "sig-pertype",
            "mixed",
            &[
                ("light", "light_001.fits", "Light Frame"),
                ("light", "light_002.fits", "Light Frame"),
                ("dark", "dark_001.fits", "Dark Frame"),
                ("dark", "dark_002.fits", "Dark Frame"),
            ],
        )
        .await;

        let resp = confirm(
            db.pool(),
            ConfirmRequest {
                inbox_item_id: "item-pertype".to_owned(),
                action: "split".to_owned(),
                content_signature: "sig-pertype".to_owned(),
                destructive_destination: None,
                root_absolute_path: tmp.path().to_owned(),
            },
        )
        .await
        .unwrap();

        let mut items =
            persistence_db::repositories::plans::list_plan_items(db.pool(), &resp.plan_id)
                .await
                .unwrap();
        assert_eq!(items.len(), 4);

        // One destination group per frame type.
        let dirs: std::collections::BTreeSet<String> = items.iter().map(dest_dir).collect();
        assert_eq!(
            dirs.len(),
            2,
            "mixed folder must resolve to one destination group per frame type, got {dirs:?}"
        );

        // Groups are contiguous (AABB, not ABAB): exactly one dir transition in
        // item_index order proves confirm emitted grouped per-type actions.
        items.sort_by_key(|it| it.item_index);
        let seq: Vec<String> = items.iter().map(dest_dir).collect();
        let transitions = seq.windows(2).filter(|w| w[0] != w[1]).count();
        assert_eq!(
            transitions, 1,
            "per-type actions must be grouped contiguously, got sequence {seq:?}"
        );
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
            "single_type",
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
                action: "confirm".to_owned(),
                content_signature: "sig-single".to_owned(),
                destructive_destination: None,
                root_absolute_path: tmp.path().to_owned(),
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

        assert_eq!(err.code, "classification.stale");
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

        assert_eq!(err.code, "classification.ambiguous");
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

        assert_eq!(err.code, "inbox.has.open.plan");
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
            "single_type",
            Some("light"),
            "sig-org",
            &["light_001.fits"],
        )
        .await;

        let resp = confirm(
            db.pool(),
            ConfirmRequest {
                inbox_item_id: "item-org".to_owned(),
                action: "confirm".to_owned(),
                content_signature: "sig-org".to_owned(),
                destructive_destination: None,
                root_absolute_path: tmp.path().to_owned(),
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
        register_source_org_state(&db, "root-1", "inbox", "unorganized").await;
        setup_classified_item(
            &db,
            "item-unorg",
            "single_type",
            Some("light"),
            "sig-unorg",
            &["light_001.fits"],
        )
        .await;

        let resp = confirm(
            db.pool(),
            ConfirmRequest {
                inbox_item_id: "item-unorg".to_owned(),
                action: "confirm".to_owned(),
                content_signature: "sig-unorg".to_owned(),
                destructive_destination: None,
                root_absolute_path: tmp.path().to_owned(),
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
        write_fits(tmp.path(), "frame_000.fits", "Light Frame", None, None, None);

        let db = test_db().await;
        // No registered_sources row inserted for root-1.
        setup_classified_item(
            &db,
            "item-absent",
            "single_type",
            Some("light"),
            "sig-absent",
            &["frame_000.fits"],
        )
        .await;

        let resp = confirm(
            db.pool(),
            ConfirmRequest {
                inbox_item_id: "item-absent".to_owned(),
                action: "confirm".to_owned(),
                content_signature: "sig-absent".to_owned(),
                destructive_destination: None,
                root_absolute_path: tmp.path().to_owned(),
            },
        )
        .await
        .unwrap();

        assert_eq!(resp.move_count, 1);
        assert_eq!(resp.catalogue_count, 0);
        assert!(matches!(resp.organization_state, OrganizationState::Unorganized));
    }
}
