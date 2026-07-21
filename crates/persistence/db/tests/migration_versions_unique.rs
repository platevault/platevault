// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Two migrations must never share a numeric version.
//!
//! `sqlx::migrate!` keys on the leading number, not the filename. Two files at
//! one version — `0075_a.sql` and `0075_b.sql` — merge cleanly in git, because
//! the *names* differ and neither branch touches the other's file. Nothing
//! conflicts, nothing fails review, and both branches pass CI in isolation.
//! `migrate()` then aborts on a **fresh** database.
//!
//! The failure is invisible in normal development: an existing dev DB has the
//! first migration already applied, so it never re-runs the pair and never
//! sees the duplicate. It surfaces on a new contributor's first checkout, in a
//! fresh CI container, or for a user installing the app for the first time.
//!
//! This has now happened repeatedly on this repository. PR #1048 renumbered
//! its pair several times as main advanced, including an interim `0076`/`0077`
//! assignment before main reached 0079. That is the lesson
//! worth encoding: **renumbering by hand to dodge a collision is itself how
//! the next collision gets made**, because every branch picks its number
//! against a `main` that does not yet contain the others. A guard converts a
//! silent fresh-DB abort into a named CI failure naming both files, which is
//! the only point at which the conflict is actually visible.
//!
//! Deliberately a filesystem check, not a database one — it must fail for a
//! collision between two *unmerged* branches the moment they meet, which is
//! before any database exists to migrate.

use std::collections::{BTreeMap, BTreeSet};

const LOCKED_MIGRATIONS_THROUGH_0079: &[&str] = &[
    "0001_operation_state.sql",
    "0002_lifecycle.sql",
    "0003_events.sql",
    "0004_ledger_view.sql",
    "0005_session_snapshot.sql",
    "0006_first_run.sql",
    "0007_equipment.sql",
    "0008_cleanup_calibration_tolerances.sql",
    "0009_ingestion_settings.sql",
    "0010_expand_source_folder_types.sql",
    "0011_remove_prepared_lifecycle.sql",
    "0012_simplify_source_view_strategy.sql",
    "0013_settings.sql",
    "0014_plans.sql",
    "0015_plan_apply.sql",
    "0016_catalogs.sql",
    "0018_projects.sql",
    "0019_plan_type_project_create.sql",
    "0020_inbox.sql",
    "0021_session_root.sql",
    "0022_calibration_assignments.sql",
    "0023_calibration_fingerprints.sql",
    "0024_tool_launches.sql",
    "0025_artifacts.sql",
    "0026_source_protection.sql",
    "0028_manifests_notes.sql",
    "0029_prepared_source_views.sql",
    "0030_guided_flow.sql",
    "0031_target_resolution.sql",
    "0032_unify_calibration_source_kind.sql",
    "0033_project_canonical_target.sql",
    "0034_ingestion_fks.sql",
    "0035_protection_defaults.sql",
    "0036_project_lifecycle_reconcile.sql",
    "0037_project_lifecycle_blocked_reason.sql",
    "0039_plan_item_safety_fields.sql",
    "0040_destructive_destination_normalize.sql",
    "0041_calibration_fingerprint_indices.sql",
    "0042_inbox_is_master.sql",
    "0043_inbox_format_and_master_item.sql",
    "0044_calibration_session_source_inbox.sql",
    "0045_inbox_plan_surface.sql",
    "0046_session_canonical_target.sql",
    "0047_target_constellation_magnitude.sql",
    "0048_target_notes.sql",
    "0049_inbox_single_type.sql",
    "0050_session_lifecycle_drop.sql",
    "0051_calibration_tolerances_offset.sql",
    "0052_registered_sources_active.sql",
    "0053_project_archived_via_plan.sql",
    "0054_source_view_generation_origin.sql",
    "0060_project_path_anchor.sql",
    "0061_target_favourites.sql",
    "0062_inbox_wcs_pointing.sql",
    "0063_audit_log_reason_code.sql",
    "0064_framing.sql",
    "0065_calibration_master_view_null_size.sql",
    "0066_session_notes.sql",
    "0067_camera_sensor_type.sql",
    "0068_framing_attribution.sql",
    "0069_fix_processing_artifact_project_fk.sql",
    "0070_protection_two_level.sql",
    "0071_restore_plan_origin.sql",
    "0072_calibration_master_path.sql",
    "0073_calibration_master_archive.sql",
    "0074_inbox_needs_review.sql",
    "0075_source_group_file_count.sql",
    "0078_drop_session_snapshot.sql",
    "0079_camera_sensor_geometry.sql",
];

fn migration_filenames() -> Vec<String> {
    let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/migrations");
    std::fs::read_dir(dir)
        .expect("migrations directory must exist")
        .filter_map(|entry| {
            let path = entry.expect("readable dir entry").path();
            (path.extension().and_then(|extension| extension.to_str()) == Some("sql")).then(|| {
                path.file_name()
                    .and_then(|name| name.to_str())
                    .expect("migration filename must be UTF-8")
                    .to_owned()
            })
        })
        .collect()
}

#[test]
fn every_migration_has_a_unique_version() {
    let mut by_version: BTreeMap<String, Vec<String>> = BTreeMap::new();

    for name in migration_filenames() {
        // `sqlx` takes the version as the digits before the first `_`.
        let version = name
            .split('_')
            .next()
            .filter(|v| !v.is_empty() && v.chars().all(|c| c.is_ascii_digit()))
            .unwrap_or_else(|| panic!("migration {name} does not start with a numeric version"))
            .to_owned();

        by_version.entry(version).or_default().push(name);
    }

    // Anti-vacuity: a typo in the path would make this pass over zero files.
    assert!(
        by_version.len() > 50,
        "expected the full migration set, found only {} version(s) — is the \
         migrations path wrong?",
        by_version.len()
    );

    let collisions: Vec<_> = by_version
        .iter()
        .filter(|(_, files)| files.len() > 1)
        .map(|(version, files)| {
            let mut sorted = files.clone();
            sorted.sort();
            format!("  {version}: {}", sorted.join(", "))
        })
        .collect();

    assert!(
        collisions.is_empty(),
        "two or more migrations share a numeric version. `sqlx::migrate!` keys \
         on that number, so `migrate()` will abort on a FRESH database while \
         every existing dev DB keeps working:\n{}\n\nRenumber the one that has \
         not merged yet, to a version above every other in-flight branch — not \
         merely above `main`.",
        collisions.join("\n")
    );
}

#[test]
fn landed_migration_filenames_are_locked_through_0079() {
    let actual: BTreeSet<String> = migration_filenames()
        .into_iter()
        .filter(|name| {
            name.split('_')
                .next()
                .and_then(|version| version.parse::<i64>().ok())
                .is_some_and(|version| version <= 79)
        })
        .collect();
    let expected: BTreeSet<String> =
        LOCKED_MIGRATIONS_THROUGH_0079.iter().map(|name| (*name).to_owned()).collect();

    assert_eq!(
        actual, expected,
        "migration filenames through 0079 are landed history; add new migrations above 0079"
    );
}
