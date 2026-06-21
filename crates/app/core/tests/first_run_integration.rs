#![allow(clippy::doc_markdown)]
//! First-run integration tests — feature 037 (Layer-1 real-backend).
//!
//! Covers:
//! - US#1 first-run source setup: register a source root and assert it persists + reads back.
//! - US#2 native filesystem controls: duplicate-root and invalid-path handling.
//! - US#16 source protection defaults: seed_source_protection wires the correct level.
//!
//! Uses a real in-memory `SQLite` DB via the shared harness in `support::setup()`.
//! Filesystem paths use `tempfile::tempdir()` — never real user paths.

mod support;

use app_core::first_run;
use app_core::protection;
use contracts_core::first_run::{OrganizationState, RegisterSourceRequest, ScanDepth, SourceKind};
use contracts_core::protection::SourceProtectionGetRequest;
use tempfile::tempdir;

// ── US#1: register a source root and read it back ────────────────────────────

#[tokio::test]
async fn register_source_persists_and_reads_back() {
    let (db, _repo, _bus) = support::setup().await;

    let dir = tempdir().expect("tempdir");
    let path = dir.path().to_str().expect("utf8 path").to_owned();

    let req = RegisterSourceRequest {
        kind: SourceKind::LightFrames,
        path: path.clone(),
        kind_subtype: None,
        scan_depth: ScanDepth::Recursive,
        organization_state: OrganizationState::Organized,
    };

    let resp = first_run::register_source(db.pool(), &req)
        .await
        .expect("register_source should succeed for a valid temp dir");

    // Response carries back the path and kind.
    assert_eq!(resp.path, path, "returned path must match the registered path");
    assert_eq!(resp.kind, SourceKind::LightFrames, "returned kind must match");
    assert!(!resp.source_id.is_empty(), "source_id must be non-empty");

    // list_sources must contain the newly registered root.
    let sources = first_run::list_sources(db.pool()).await.expect("list_sources should succeed");

    assert_eq!(sources.len(), 1, "expected exactly 1 source after register, got {}", sources.len());
    assert_eq!(sources[0].source_id, resp.source_id, "listed source_id must match");
    assert_eq!(sources[0].path, path, "listed path must match");
}

// ── US#2: duplicate root is rejected ─────────────────────────────────────────

#[tokio::test]
async fn register_source_rejects_duplicate_same_kind() {
    let (db, _repo, _bus) = support::setup().await;

    let dir = tempdir().expect("tempdir");
    let path = dir.path().to_str().expect("utf8 path").to_owned();

    let req = RegisterSourceRequest {
        kind: SourceKind::Calibration,
        path: path.clone(),
        kind_subtype: None,
        scan_depth: ScanDepth::Single,
        organization_state: OrganizationState::Organized,
    };

    // First registration must succeed.
    first_run::register_source(db.pool(), &req).await.expect("first register should succeed");

    // Second registration of the same path + kind must fail.
    let err = first_run::register_source(db.pool(), &req)
        .await
        .expect_err("duplicate registration must be rejected");

    assert!(
        err.code.contains("duplicate") || err.code.contains("path"),
        "error code should indicate a duplicate/path conflict, got: {}",
        err.code,
    );
}

// ── US#2: invalid (non-existent) path is rejected ────────────────────────────

#[tokio::test]
async fn register_source_rejects_nonexistent_path() {
    let (db, _repo, _bus) = support::setup().await;

    let req = RegisterSourceRequest {
        kind: SourceKind::Calibration,
        // A path that is almost certainly absent on any CI machine.
        path: "/tmp/__astro_plan_037_nonexistent_source_path_xyzzy__".to_owned(),
        kind_subtype: None,
        scan_depth: ScanDepth::Recursive,
        organization_state: OrganizationState::Organized,
    };

    let err = first_run::register_source(db.pool(), &req)
        .await
        .expect_err("register with non-existent path must fail");

    assert!(
        err.code.contains("not_exists") || err.code.contains("path"),
        "error code should indicate path-not-found, got: {}",
        err.code,
    );
}

// ── US#16: source protection defaults ────────────────────────────────────────

#[tokio::test]
async fn seed_source_protection_sets_protected_for_non_inbox() {
    let (db, _repo, _bus) = support::setup().await;

    let dir = tempdir().expect("tempdir");
    let path = dir.path().to_str().expect("utf8 path").to_owned();

    // Register a light-frames source so a valid source_id row exists.
    let req = RegisterSourceRequest {
        kind: SourceKind::LightFrames,
        path,
        kind_subtype: None,
        scan_depth: ScanDepth::Recursive,
        organization_state: OrganizationState::Organized,
    };
    let resp = first_run::register_source(db.pool(), &req).await.expect("register should succeed");

    // Seed the default protection for this (non-inbox) source.
    protection::seed_source_protection(db.pool(), &resp.source_id, "light_frames")
        .await
        .expect("seed_source_protection should succeed");

    // Read the protection back via the use-case layer.
    let get_req = SourceProtectionGetRequest { source_id: Some(resp.source_id.clone()) };
    let protection_resp = protection::get_source_protection(db.pool(), &get_req)
        .await
        .expect("get_source_protection should succeed");

    // Non-inbox sources must default to the "protected" level (US#16 / FR-016).
    assert_eq!(
        protection_resp.level.as_str(),
        "protected",
        "non-inbox source protection level must default to 'protected', got: {}",
        protection_resp.level.as_str(),
    );
}
