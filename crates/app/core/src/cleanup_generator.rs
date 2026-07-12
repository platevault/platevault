//! Spec 017 US1 + spec 030 cleanup candidate generator.
//!
//! Two-step flow (D11):
//!   1. [`scan`] — pure, read-only preview. Enumerates a project's observed
//!      processing artifacts, classifies each into a [`DataType`], applies the
//!      persisted [`CleanupPolicy`], and returns candidate files plus reclaimable
//!      bytes. NO plan row is created and NO filesystem mutation occurs (FR-002).
//!   2. [`generate`] — materialises a reviewable cleanup plan from the same
//!      candidates by building `CleanupPlanItem`s and delegating to the spec-016
//!      persistence tail [`crate::protection::generate_cleanup_plan`], which
//!      resolves per-item protection and gates approval.
//!
//! ## Read path (documented decision)
//!
//! A project's on-disk files are enumerated from the `processing_artifacts`
//! table (spec 012 artifact observation), the ONLY per-project file store that
//! the real pipeline populates: the filesystem watcher observes output files
//! under a project's folder and records `path`, `kind`, `size_bytes`, and a
//! rule/override classification. We call
//! [`persistence_db::repositories::artifacts::list_artifacts_for_project`]
//! directly.
//!
//! Raw sub-frame cleanup (e.g. "light subs now covered by a master") is
//! intentionally OUT OF SCOPE for this pass: acquisition/calibration sessions
//! store `frame_ids = '[]'` and the `file_record` inventory table is never
//! populated by the real pipeline, so per-frame files cannot be enumerated from
//! recorded inventory. Per the constitution we do NOT invent a filesystem
//! walker to bypass recorded inventory; those data types classify as
//! [`DataType::Unclassified`] and are excluded until an inventory read path
//! exists.
//!
//! ## Classification model
//!
//! Grounded strictly in what inventory records: `processing_artifacts.kind` is
//! constrained to `intermediate | master | final` (spec 012's classification
//! pass; masters flow through here via spec 040 detection). We map that 1:1.
//! Anything unrecognised is [`DataType::Unclassified`] and is EXCLUDED from
//! cleanup candidates (safe default).
//!
//! ## Policy storage (D13)
//!
//! The [`CleanupPolicy`] is persisted through the existing generic
//! `protection_defaults` (scope, key, value-JSON) store (migration 0035) under
//! `scope = "cleanup"`, `key = "policy"`. The policy serialises cleanly to JSON,
//! so no new table or migration is required.

#![allow(clippy::doc_markdown)] // domain terminology not appropriate for backticks

use std::collections::HashMap;

use contracts_core::cleanup::{
    CleanupAction, CleanupCandidate, CleanupPolicy, CleanupPolicyEntry, CleanupScanResult,
    GenerateCleanupPlanResult,
};
use contracts_core::{error_code::ErrorCode, ContractError, ErrorSeverity};
use persistence_db::repositories::artifacts as artifacts_repo;
use persistence_db::repositories::projects as projects_repo;
use persistence_db::repositories::source_protection as prot_repo;
use sqlx::SqlitePool;

use crate::errors::db_err;
use crate::protection::{self, CleanupPlanItem, GenerateCleanupPlanRequest};
use domain_core::ids::new_id;

// ── Policy storage keys (D13) ─────────────────────────────────────────────

/// `protection_defaults` scope under which the cleanup policy is stored.
const CLEANUP_SCOPE: &str = "cleanup";
/// `protection_defaults` key holding the whole cleanup policy as JSON.
const CLEANUP_POLICY_KEY: &str = "policy";

// ── Data-type classification model ─────────────────────────────────────────

/// Classification of a project file for cleanup purposes.
///
/// Grounded in `processing_artifacts.kind` (`intermediate | master | final`).
/// Unrecognised inputs are [`DataType::Unclassified`] and are excluded from
/// cleanup candidates.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DataType {
    /// Reproducible processing intermediates (calibrated/registered/drizzle/
    /// debayered frames, cosmetic correction, etc.). The primary safe-to-clean
    /// class.
    Intermediate,
    /// Master calibration frames (spec 040 detection surfaces as `kind=master`).
    Master,
    /// Final science outputs (integrations, finished images).
    Final,
    /// Unknown / not represented in recorded inventory — always excluded.
    Unclassified,
}

impl DataType {
    /// Canonical policy string for this data type.
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            DataType::Intermediate => "intermediate",
            DataType::Master => "master",
            DataType::Final => "final",
            DataType::Unclassified => "unclassified",
        }
    }

    /// Map a `processing_artifacts.kind` value to a [`DataType`]. Unknown kinds
    /// become [`DataType::Unclassified`].
    #[must_use]
    pub fn from_artifact_kind(kind: &str) -> Self {
        match kind {
            "intermediate" => DataType::Intermediate,
            "master" => DataType::Master,
            "final" => DataType::Final,
            _ => DataType::Unclassified,
        }
    }

    /// Parse a canonical policy string back into a [`DataType`].
    #[must_use]
    pub fn from_policy_str(s: &str) -> Self {
        match s {
            "intermediate" => DataType::Intermediate,
            "master" => DataType::Master,
            "final" => DataType::Final,
            _ => DataType::Unclassified,
        }
    }

    /// Protected-category name used for protection resolution. Master and Final
    /// map to the default protected categories (`masters`, `finals`) so they
    /// gate approval; intermediates map to a non-protected category.
    #[must_use]
    pub fn protection_category(self) -> &'static str {
        match self {
            DataType::Intermediate => "intermediate",
            DataType::Master => "masters",
            DataType::Final => "finals",
            DataType::Unclassified => "unclassified",
        }
    }
}

// ── Policy persistence (D13) ────────────────────────────────────────────────

/// The default cleanup policy: every known data type is `Keep` (safe default —
/// nothing is proposed for cleanup until the user opts a type in), and cleanup
/// does not run automatically on project completion.
#[must_use]
pub fn default_cleanup_policy() -> CleanupPolicy {
    let entries = [DataType::Intermediate, DataType::Master, DataType::Final]
        .into_iter()
        .map(|dt| CleanupPolicyEntry {
            data_type: dt.as_str().to_owned(),
            action: CleanupAction::Keep,
        })
        .collect();
    CleanupPolicy { entries, auto_on_completion: false }
}

/// Read the persisted cleanup policy, falling back to [`default_cleanup_policy`]
/// when none is stored or the stored value cannot be decoded.
///
/// # Errors
///
/// Returns `ContractError` on database failure.
pub async fn get_policy(pool: &SqlitePool) -> Result<CleanupPolicy, ContractError> {
    let stored = prot_repo::get_protection_default(pool, CLEANUP_SCOPE, CLEANUP_POLICY_KEY)
        .await
        .map_err(db_err)?;

    match stored {
        Some(value) => match serde_json::from_value(value) {
            Ok(policy) => Ok(policy),
            Err(e) => {
                // A stored-but-undecodable policy means the row was corrupted
                // or written by an incompatible version — worth noticing, not
                // hiding. Fall back to the all-Keep default (safe: nothing is
                // proposed for cleanup), leaving the stored row untouched.
                tracing::warn!(
                    "stored cleanup policy is corrupted ({e}); \
                     falling back to the all-Keep default policy"
                );
                Ok(default_cleanup_policy())
            }
        },
        None => Ok(default_cleanup_policy()),
    }
}

/// Persist the cleanup policy and return the stored value.
///
/// # Errors
///
/// Returns `ContractError` on serialisation or database failure.
pub async fn set_policy(
    pool: &SqlitePool,
    policy: &CleanupPolicy,
) -> Result<CleanupPolicy, ContractError> {
    let value = serde_json::to_value(policy).map_err(|e| {
        ContractError::new(
            ErrorCode::InternalData,
            format!("serialise cleanup policy: {e}"),
            ErrorSeverity::Fatal,
            false,
        )
    })?;
    prot_repo::set_protection_default(pool, CLEANUP_SCOPE, CLEANUP_POLICY_KEY, &value)
        .await
        .map_err(db_err)?;
    Ok(policy.clone())
}

// ── Scan (preview) ──────────────────────────────────────────────────────────

/// Build a `data_type -> action` lookup from a policy.
fn action_map(policy: &CleanupPolicy) -> HashMap<String, CleanupAction> {
    policy.entries.iter().map(|e| (e.data_type.clone(), e.action)).collect()
}

/// Human label for a cleanup action.
fn action_label(action: CleanupAction) -> &'static str {
    match action {
        CleanupAction::Keep => "keep",
        CleanupAction::Archive => "archive",
        CleanupAction::Delete => "delete",
    }
}

/// Pure, read-only cleanup preview for a project (D11 step 1).
///
/// Enumerates the project's `present` processing artifacts, classifies each,
/// applies the persisted policy, and returns candidate files (those whose data
/// type is policy-actioned to Archive/Delete) plus the total reclaimable bytes.
/// [`DataType::Unclassified`] files are always excluded. No plan is created.
///
/// Each candidate's `reason` carries the classification rationale (source +
/// confidence) and the resolved protection status so users can see protection
/// BEFORE generating a plan (constitution II).
///
/// # Errors
///
/// Returns `ContractError` on database failure.
pub async fn scan(pool: &SqlitePool, project_id: &str) -> Result<CleanupScanResult, ContractError> {
    let policy = get_policy(pool).await?;
    scan_with_policy(pool, project_id, &policy).await
}

/// [`scan`] against an already-loaded policy. [`generate`] uses this to avoid
/// reading the policy twice (and to guarantee scan + item-building see the
/// same policy snapshot).
async fn scan_with_policy(
    pool: &SqlitePool,
    project_id: &str,
    policy: &CleanupPolicy,
) -> Result<CleanupScanResult, ContractError> {
    let actions = action_map(policy);

    // Load global protection once so we can surface protection status per file.
    let global = protection::load_global_protection(pool).await?;

    let rows = artifacts_repo::list_artifacts_for_project(pool, project_id, &["present"])
        .await
        .map_err(db_err)?;

    let mut candidates: Vec<CleanupCandidate> = Vec::new();
    let mut total_reclaimable_bytes: u64 = 0;

    for row in rows {
        let data_type = DataType::from_artifact_kind(&row.kind);
        // Safe default: never propose files we cannot classify.
        if data_type == DataType::Unclassified {
            continue;
        }

        let action = actions.get(data_type.as_str()).copied().unwrap_or(CleanupAction::Keep);
        if action == CleanupAction::Keep {
            continue;
        }

        let size = u64::try_from(row.size_bytes).unwrap_or(0);
        total_reclaimable_bytes = total_reclaimable_bytes.saturating_add(size);

        // Resolve protection so the preview surfaces it (constitution II).
        //
        // DECISION NOTE (constitution IV — pinned by test
        // `project_level_unprotected_override_blankets_protected_categories`):
        // the generator keys protection off the PROJECT id as the source id
        // for every item, and `resolve_protection` gives a per-source override
        // row unconditional precedence — the item's category is NOT consulted
        // in the override branch. Consequence: a project-level `unprotected`
        // override would also un-gate master/final items in that project. No
        // shipped path creates project-level overrides today; if project
        // wiring lands (see SourceProtectionOverride.tsx), revisit whether
        // protected-category elevation should survive an override before
        // relying on it here. Do not change resolver semantics silently.
        let resolved = prot_repo::resolve_protection(
            pool,
            project_id,
            Some(data_type.protection_category()),
            &global.level,
            global.block_permanent_delete,
            &global.categories,
        )
        .await
        .map_err(db_err)?;

        let reason = format!(
            "{} artifact (classified by {}, {:.0}% confidence); protection: {}; policy: {}",
            data_type.as_str(),
            row.classification_source,
            row.classification_confidence * 100.0,
            resolved.level,
            action_label(action),
        );

        candidates.push(CleanupCandidate {
            file_path: row.path,
            data_type: data_type.as_str().to_owned(),
            size_bytes: size,
            reason,
        });
    }

    Ok(CleanupScanResult { project_id: project_id.to_owned(), candidates, total_reclaimable_bytes })
}

// ── Generate (reviewable plan) ─────────────────────────────────────────────

/// Take the tail of a project-relative path (the file name) for display.
fn file_name(path: &str) -> &str {
    path.rsplit(['/', '\\']).next().unwrap_or(path)
}

/// Materialise a reviewable cleanup plan for a project (D11 step 2).
///
/// Runs [`scan`] to collect candidates, maps each to a [`CleanupPlanItem`]
/// (with the project id as its source and the data type's protected-category as
/// its category), then delegates to [`crate::protection::generate_cleanup_plan`]
/// which persists the plan + items and resolves per-item protection. The
/// returned counts let the caller show how many items will gate approval.
///
/// Generating a plan performs NO filesystem mutation (FR-002).
///
/// # Errors
///
/// Returns `ContractError` on database failure.
pub async fn generate(
    pool: &SqlitePool,
    project_id: &str,
    title: Option<&str>,
    destructive_destination: Option<&str>,
) -> Result<GenerateCleanupPlanResult, ContractError> {
    // Load the policy once and reuse the snapshot for both the scan and the
    // item-building action map, so a concurrent policy update cannot make the
    // candidate set and the per-item actions disagree.
    let policy = get_policy(pool).await?;
    let scan_result = scan_with_policy(pool, project_id, &policy).await?;
    let actions = action_map(&policy);

    let plan_id = new_id();

    // Derive a title from the project when the caller did not supply one.
    let resolved_title = match title {
        Some(t) => t.to_owned(),
        None => match projects_repo::get_project(pool, project_id).await {
            Ok(p) => format!("Cleanup: {}", p.name),
            Err(_) => "Cleanup plan".to_owned(),
        },
    };

    let destination = destructive_destination.unwrap_or("archive").to_owned();

    let items: Vec<CleanupPlanItem> = scan_result
        .candidates
        .iter()
        .enumerate()
        .map(|(idx, candidate)| {
            let data_type = DataType::from_policy_str(&candidate.data_type);
            let action = actions.get(data_type.as_str()).copied().unwrap_or(CleanupAction::Keep);
            let action_str = match action {
                CleanupAction::Delete => "delete",
                // Keep should not occur (scan already filtered it), but default
                // to the non-destructive archive action if it somehow does.
                CleanupAction::Archive | CleanupAction::Keep => "archive",
            };
            CleanupPlanItem {
                id: format!("{plan_id}-item-{idx}"),
                name: file_name(&candidate.file_path).to_owned(),
                action: action_str.to_owned(),
                source_id: project_id.to_owned(),
                category: data_type.protection_category().to_owned(),
                from_relative_path: candidate.file_path.clone(),
                from_root_id: None,
                to_relative_path: String::new(),
            }
        })
        .collect();

    let item_count = u32::try_from(items.len()).unwrap_or(u32::MAX);

    // Real destination byte requirement (FR-012 / spec 025 D17): only
    // archive-action items occupy space in the app-managed archive folder;
    // delete/trash items need none. Sum the sizes of the archive-action
    // candidates so the apply executor's free-space pre-flight has data.
    let total_bytes_required: i64 = scan_result
        .candidates
        .iter()
        .zip(items.iter())
        .filter(|(_, item)| item.action == "archive")
        .map(|(candidate, _)| i64::try_from(candidate.size_bytes).unwrap_or(i64::MAX))
        .fold(0_i64, i64::saturating_add);

    let gen_req = GenerateCleanupPlanRequest {
        plan_id: plan_id.clone(),
        title: resolved_title,
        destructive_destination: destination,
        total_bytes_required,
        items,
    };

    let resp = protection::generate_cleanup_plan(pool, &gen_req).await?;

    Ok(GenerateCleanupPlanResult {
        plan_id: resp.plan_id,
        item_count,
        protected_item_count: u32::try_from(resp.protected_item_count).unwrap_or(u32::MAX),
    })
}

// ── Tests ─────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    // See the matching allow in `protection::tests`: `setup()`'s test-lock
    // guard is deliberately held across every `.await` in each test body, and
    // that's safe under `#[tokio::test]`'s current-thread runtime default.
    #![allow(clippy::await_holding_lock)]

    use super::*;
    use audit::bus::EventBus;
    use contracts_core::protection::{
        PlanProtectionCheckRequest, ProtectionLevel, SourceProtectionSetRequest,
    };
    use persistence_db::repositories::artifacts::{insert_artifact, InsertArtifact};
    use persistence_db::repositories::plans as plans_repo;
    use persistence_db::repositories::projects::{insert_project, InsertProject};
    use persistence_db::Database;

    async fn setup() -> (Database, EventBus, std::sync::MutexGuard<'static, ()>) {
        // `scan_with_policy` unconditionally calls `protection::load_global_protection`,
        // which read-throughs the process-global `protection_defaults` cache
        // (a single unkeyed slot shared by every in-memory DB in this test
        // binary — see `protection::PROTECTION_DEFAULTS_TEST_LOCK`). Serialize
        // against `protection.rs`'s tests (e.g. `t041_...`, which mutates the
        // default to `"unprotected"`) so a value-sensitive assertion here
        // (e.g. `generate_protected_final_gates_approval` expecting the
        // default `"protected"`) can't race it.
        let lock = crate::protection::PROTECTION_DEFAULTS_TEST_LOCK
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let db = Database::in_memory().await.expect("in-memory DB");
        db.migrate().await.expect("migrations");
        let bus = EventBus::with_pool(db.pool().clone());
        (db, bus, lock)
    }

    async fn seed_project(db: &Database, id: &str) {
        insert_project(
            db.pool(),
            &InsertProject {
                id,
                name: "M31 LRGB",
                tool: "PixInsight",
                lifecycle: "processing",
                path: "projects/M31_LRGB",
                notes: None,
                canonical_target_id: None,
            },
        )
        .await
        .unwrap();
    }

    #[allow(clippy::too_many_arguments)]
    async fn seed_artifact(
        db: &Database,
        id: &str,
        project_id: &str,
        path: &str,
        kind: &str,
        size: i64,
    ) {
        insert_artifact(
            db.pool(),
            InsertArtifact {
                id,
                project_id,
                tool_launch_id: None,
                path,
                kind,
                tool: "PixInsight",
                detected_at: "2026-07-01T00:00:00Z",
                state: "present",
                classification_confidence: 0.9,
                classification_source: "rule",
                size_bytes: size,
                file_mtime: "2026-07-01T00:00:00Z",
                content_hash: None,
            },
        )
        .await
        .unwrap();
    }

    // ── Classification unit tests ─────────────────────────────────────────

    #[test]
    fn classify_maps_every_known_kind() {
        assert_eq!(DataType::from_artifact_kind("intermediate"), DataType::Intermediate);
        assert_eq!(DataType::from_artifact_kind("master"), DataType::Master);
        assert_eq!(DataType::from_artifact_kind("final"), DataType::Final);
    }

    #[test]
    fn classify_unknown_kind_is_unclassified() {
        assert_eq!(DataType::from_artifact_kind("something_else"), DataType::Unclassified);
        assert_eq!(DataType::from_artifact_kind(""), DataType::Unclassified);
    }

    #[test]
    fn protection_category_maps_protected_types() {
        assert_eq!(DataType::Master.protection_category(), "masters");
        assert_eq!(DataType::Final.protection_category(), "finals");
        assert_eq!(DataType::Intermediate.protection_category(), "intermediate");
    }

    // ── Policy persistence round-trip (D13) ───────────────────────────────

    #[tokio::test]
    async fn policy_defaults_when_unset() {
        let (db, _bus, _lock) = setup().await;
        let policy = get_policy(db.pool()).await.unwrap();
        assert_eq!(policy.entries.len(), 3);
        assert!(!policy.auto_on_completion);
        assert!(policy.entries.iter().all(|e| e.action == CleanupAction::Keep));
    }

    #[tokio::test]
    async fn policy_round_trip_persists() {
        let (db, _bus, _lock) = setup().await;
        let updated = CleanupPolicy {
            entries: vec![
                CleanupPolicyEntry {
                    data_type: "intermediate".to_owned(),
                    action: CleanupAction::Delete,
                },
                CleanupPolicyEntry { data_type: "master".to_owned(), action: CleanupAction::Keep },
                CleanupPolicyEntry { data_type: "final".to_owned(), action: CleanupAction::Keep },
            ],
            auto_on_completion: true,
        };
        set_policy(db.pool(), &updated).await.unwrap();

        let reloaded = get_policy(db.pool()).await.unwrap();
        assert!(reloaded.auto_on_completion);
        let intermediate = reloaded
            .entries
            .iter()
            .find(|e| e.data_type == "intermediate")
            .expect("intermediate entry");
        assert_eq!(intermediate.action, CleanupAction::Delete);
    }

    // ── Scan preview ──────────────────────────────────────────────────────

    #[tokio::test]
    async fn scan_empty_project_has_no_candidates() {
        let (db, _bus, _lock) = setup().await;
        seed_project(&db, "p-empty").await;
        let result = scan(db.pool(), "p-empty").await.unwrap();
        assert!(result.candidates.is_empty());
        assert_eq!(result.total_reclaimable_bytes, 0);
    }

    #[tokio::test]
    async fn scan_default_policy_proposes_nothing() {
        // Default policy is all-Keep: even with artifacts present, no candidates.
        let (db, _bus, _lock) = setup().await;
        seed_project(&db, "p1").await;
        seed_artifact(&db, "a1", "p1", "calibrated/light_001.xisf", "intermediate", 1000).await;
        let result = scan(db.pool(), "p1").await.unwrap();
        assert!(result.candidates.is_empty(), "all-Keep policy must propose nothing");
    }

    #[tokio::test]
    async fn scan_actioned_type_becomes_candidate_and_sums_bytes() {
        let (db, _bus, _lock) = setup().await;
        seed_project(&db, "p1").await;
        seed_artifact(&db, "a1", "p1", "calibrated/light_001.xisf", "intermediate", 1000).await;
        seed_artifact(&db, "a2", "p1", "calibrated/light_002.xisf", "intermediate", 2000).await;
        seed_artifact(&db, "a3", "p1", "final/M31.xisf", "final", 5000).await;

        // Opt intermediates in for archiving; keep finals.
        set_policy(
            db.pool(),
            &CleanupPolicy {
                entries: vec![
                    CleanupPolicyEntry {
                        data_type: "intermediate".to_owned(),
                        action: CleanupAction::Archive,
                    },
                    CleanupPolicyEntry {
                        data_type: "final".to_owned(),
                        action: CleanupAction::Keep,
                    },
                ],
                auto_on_completion: false,
            },
        )
        .await
        .unwrap();

        let result = scan(db.pool(), "p1").await.unwrap();
        assert_eq!(result.candidates.len(), 2, "only the two intermediates are candidates");
        assert_eq!(result.total_reclaimable_bytes, 3000);
        assert!(result.candidates.iter().all(|c| c.data_type == "intermediate"));
    }

    #[tokio::test]
    async fn scan_excludes_unclassified() {
        let (db, _bus, _lock) = setup().await;
        seed_project(&db, "p1").await;
        // A present artifact whose kind is not intermediate/master/final cannot
        // exist under the CHECK constraint; simulate the exclusion path by
        // asserting a would-be-actioned unknown data_type in the policy has no
        // effect. Here we just confirm masters aren't cleaned under an
        // intermediate-only policy.
        seed_artifact(&db, "a1", "p1", "masters/master_dark.xisf", "master", 4000).await;
        set_policy(
            db.pool(),
            &CleanupPolicy {
                entries: vec![CleanupPolicyEntry {
                    data_type: "intermediate".to_owned(),
                    action: CleanupAction::Delete,
                }],
                auto_on_completion: false,
            },
        )
        .await
        .unwrap();
        let result = scan(db.pool(), "p1").await.unwrap();
        assert!(result.candidates.is_empty(), "master not covered by policy → Keep default");
    }

    // ── Generate vs scan separation ───────────────────────────────────────

    #[tokio::test]
    async fn scan_creates_no_plan() {
        let (db, _bus, _lock) = setup().await;
        seed_project(&db, "p1").await;
        seed_artifact(&db, "a1", "p1", "calibrated/light_001.xisf", "intermediate", 1000).await;
        set_policy(
            db.pool(),
            &CleanupPolicy {
                entries: vec![CleanupPolicyEntry {
                    data_type: "intermediate".to_owned(),
                    action: CleanupAction::Archive,
                }],
                auto_on_completion: false,
            },
        )
        .await
        .unwrap();

        scan(db.pool(), "p1").await.unwrap();

        // No plan rows exist after a pure scan.
        let plans = plans_repo::list_plans(db.pool(), &[], &[], None, 100).await.unwrap();
        assert!(plans.is_empty(), "scan must not create a plan (D11 step 1)");
    }

    #[tokio::test]
    async fn generate_creates_plan_with_items() {
        let (db, _bus, _lock) = setup().await;
        seed_project(&db, "p1").await;
        seed_artifact(&db, "a1", "p1", "calibrated/light_001.xisf", "intermediate", 1000).await;
        seed_artifact(&db, "a2", "p1", "calibrated/light_002.xisf", "intermediate", 2000).await;
        set_policy(
            db.pool(),
            &CleanupPolicy {
                entries: vec![CleanupPolicyEntry {
                    data_type: "intermediate".to_owned(),
                    action: CleanupAction::Archive,
                }],
                auto_on_completion: false,
            },
        )
        .await
        .unwrap();

        let resp = generate(db.pool(), "p1", Some("My cleanup"), Some("archive")).await.unwrap();
        assert_eq!(resp.item_count, 2);
        // Safe default: the global default protection level is "protected", so
        // with no per-source override every item resolves protected and gates
        // approval (constitution II).
        assert_eq!(resp.protected_item_count, 2);

        let items = plans_repo::list_plan_items(db.pool(), &resp.plan_id).await.unwrap();
        assert_eq!(items.len(), 2);

        // FR-012 / D17: the plan carries a real destination byte requirement —
        // the sum of the two archive-action item sizes (1000 + 2000).
        let plan = plans_repo::get_plan(db.pool(), &resp.plan_id, false).await.unwrap();
        assert_eq!(plan.total_bytes_required, 3000);
    }

    #[tokio::test]
    async fn generate_delete_items_require_no_destination_bytes() {
        // Delete-action items are removed, not archived, so they contribute
        // zero to the plan's destination byte requirement (D17).
        let (db, _bus, _lock) = setup().await;
        seed_project(&db, "p1").await;
        seed_artifact(&db, "a1", "p1", "calibrated/light_001.xisf", "intermediate", 1000).await;
        set_policy(
            db.pool(),
            &CleanupPolicy {
                entries: vec![CleanupPolicyEntry {
                    data_type: "intermediate".to_owned(),
                    action: CleanupAction::Delete,
                }],
                auto_on_completion: false,
            },
        )
        .await
        .unwrap();

        let resp = generate(db.pool(), "p1", None, None).await.unwrap();
        assert_eq!(resp.item_count, 1);

        let plan = plans_repo::get_plan(db.pool(), &resp.plan_id, false).await.unwrap();
        assert_eq!(plan.total_bytes_required, 0, "delete items need no destination space");
    }

    // ── Protected-category exclusion end-to-end ───────────────────────────

    #[tokio::test]
    async fn generate_protected_final_gates_approval() {
        let (db, _bus, _lock) = setup().await;
        seed_project(&db, "p1").await;
        // A final output — default protected categories include "finals".
        seed_artifact(&db, "a1", "p1", "final/M31.xisf", "final", 9000).await;
        // Opt finals in for archiving so it becomes a candidate.
        set_policy(
            db.pool(),
            &CleanupPolicy {
                entries: vec![CleanupPolicyEntry {
                    data_type: "final".to_owned(),
                    action: CleanupAction::Archive,
                }],
                auto_on_completion: false,
            },
        )
        .await
        .unwrap();

        let resp = generate(db.pool(), "p1", None, None).await.unwrap();
        assert_eq!(resp.item_count, 1);
        assert_eq!(resp.protected_item_count, 1, "final maps to protected category 'finals'");

        // The protection gate fires on the generated plan.
        let check = protection::plan_protection_check(
            db.pool(),
            &PlanProtectionCheckRequest { plan_id: resp.plan_id.clone() },
        )
        .await
        .unwrap();
        assert!(check.has_protected_items);
        assert_eq!(check.protected_items.len(), 1);
        assert_eq!(check.protected_items[0].source_id.as_deref(), Some("p1"));
    }

    #[tokio::test]
    async fn generate_respects_per_source_protection_override() {
        // The global default level is "protected", so without an override an
        // intermediate item would gate approval. A per-source "unprotected"
        // override must flow through and downgrade it — proving the override
        // path is live, not inert.
        let (db, bus, _lock) = setup().await;
        seed_project(&db, "p1").await;
        seed_artifact(&db, "a1", "p1", "calibrated/light_001.xisf", "intermediate", 1000).await;
        set_policy(
            db.pool(),
            &CleanupPolicy {
                entries: vec![CleanupPolicyEntry {
                    data_type: "intermediate".to_owned(),
                    action: CleanupAction::Archive,
                }],
                auto_on_completion: false,
            },
        )
        .await
        .unwrap();

        protection::set_source_protection(
            db.pool(),
            &bus,
            &SourceProtectionSetRequest {
                source_id: "p1".to_owned(),
                level: ProtectionLevel::Unprotected,
                block_permanent_delete: Some(false),
                categories: None,
            },
        )
        .await
        .unwrap();

        let resp = generate(db.pool(), "p1", None, None).await.unwrap();
        assert_eq!(
            resp.protected_item_count, 0,
            "per-source unprotected override downgrades the item from the protected default"
        );
    }
}
