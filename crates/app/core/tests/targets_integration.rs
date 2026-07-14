#![allow(clippy::doc_markdown)]

// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Layer-1 integration tests for target identity (US #12 / US #13) — feature
//! 037 (T008).
//!
//! Uses the real in-memory SQLite backend (all migrations applied) via the
//! shared `support::setup()` harness. No mocks.
//!
//! **Note on spec-036 API change**: The gen-2 `target_identity` / `target_lookup`
//! modules were retired by spec-036. These tests have been updated to use the
//! gen-3 surface (`app_core::target_management`, `app_core::target_resolve`,
//! `app_core::target_search`) and the `targeting_resolver::cache` seed helper.

mod support;

use app_core::target_management;
use app_core::target_resolve::resolve;
use contracts_core::targets::{
    TargetAliasAddRequest, TargetAliasRemoveRequest, TargetGetRequest, TargetResolveSimbadRequest,
    TargetResolveStatus,
};
use targeting_resolver::{
    cache, AliasKind, FakeResolver, ObjectType, ResolvedAlias, ResolvedIdentity, TargetSource,
};
use uuid::Uuid;

// ── Seed helpers ──────────────────────────────────────────────────────────────

/// Seed a canonical target into the gen-3 `canonical_target` table via
/// `cache::upsert_resolved`. Returns the stable `target_id` UUID string.
async fn seed_target(
    pool: &sqlx::SqlitePool,
    primary_designation: &str,
    extra_aliases: &[(&str, targeting_resolver::AliasKind)],
) -> String {
    let mut aliases = vec![ResolvedAlias::new(primary_designation, AliasKind::Designation)];
    for (alias, kind) in extra_aliases {
        aliases.push(ResolvedAlias::new(*alias, *kind));
    }
    let identity = ResolvedIdentity {
        simbad_oid: None,
        primary_designation: primary_designation.to_owned(),
        common_name: None,
        object_type: ObjectType::Galaxy,
        ra_deg: 0.0,
        dec_deg: 0.0,
        v_mag: None,
        aliases,
        source: TargetSource::Seed,
    };
    let (id, _outcome) =
        cache::upsert_resolved(pool, &identity).await.expect("seed_target: upsert_resolved failed");
    id.to_string()
}

// ── US #12: target lookup / resolve ──────────────────────────────────────────

/// TC-12.1: `target.resolve` resolves an exact query to a seeded target and
/// returns `Resolved` status when the resolver returns the identity.
#[tokio::test]
async fn resolve_exact_query_returns_resolved() {
    let (db, _repo, _bus) = support::setup().await;

    // Seed M31 via FakeResolver so the resolve call populates the cache.
    let resolver = FakeResolver::new().with_response(
        "M 31",
        ResolvedIdentity {
            simbad_oid: Some(1_575_544),
            primary_designation: "M 31".to_owned(),
            common_name: Some("Andromeda Galaxy".to_owned()),
            object_type: ObjectType::Galaxy,
            ra_deg: 10.684_708,
            dec_deg: 41.268_75,
            v_mag: None,
            aliases: vec![
                ResolvedAlias::new("M 31", AliasKind::Designation),
                ResolvedAlias::new("NGC 224", AliasKind::Designation),
            ],
            source: TargetSource::Resolved,
        },
    );

    let req = TargetResolveSimbadRequest {
        contract_version: "1.0".to_owned(),
        request_id: Uuid::new_v4().to_string(),
        query: "M 31".to_owned(),
        override_target: None,
    };

    let resp = resolve(db.pool(), &resolver, &req).await.unwrap();

    assert_eq!(
        resp.status,
        TargetResolveStatus::Resolved,
        "expected Resolved, got {:?}; unresolved_reason: {:?}",
        resp.status,
        resp.unresolved_reason
    );
    let target = resp.target.expect("Resolved response must carry a target");
    assert_eq!(target.primary_designation, "M 31");
    assert_eq!(target.simbad_oid, Some(1_575_544));
}

/// TC-12.2: Cross-catalog resolve — "NGC 224" maps to the same target as
/// "M 31" because `FakeResolver` returns the same `simbad_oid`.
#[tokio::test]
async fn resolve_cross_catalog_alias_returns_same_target() {
    let (db, _repo, _bus) = support::setup().await;

    let m31_identity = ResolvedIdentity {
        simbad_oid: Some(1_575_544),
        primary_designation: "M 31".to_owned(),
        common_name: Some("Andromeda Galaxy".to_owned()),
        object_type: ObjectType::Galaxy,
        ra_deg: 10.684_708,
        dec_deg: 41.268_75,
        v_mag: None,
        aliases: vec![
            ResolvedAlias::new("M 31", AliasKind::Designation),
            ResolvedAlias::new("NGC 224", AliasKind::Designation),
        ],
        source: TargetSource::Resolved,
    };

    let resolver = FakeResolver::new()
        .with_response("M 31", m31_identity.clone())
        .with_response("NGC 224", m31_identity);

    let m31_resp = resolve(
        db.pool(),
        &resolver,
        &TargetResolveSimbadRequest {
            contract_version: "1.0".to_owned(),
            request_id: Uuid::new_v4().to_string(),
            query: "M 31".to_owned(),
            override_target: None,
        },
    )
    .await
    .unwrap();

    let ngc_resp = resolve(
        db.pool(),
        &resolver,
        &TargetResolveSimbadRequest {
            contract_version: "1.0".to_owned(),
            request_id: Uuid::new_v4().to_string(),
            query: "NGC 224".to_owned(),
            override_target: None,
        },
    )
    .await
    .unwrap();

    assert_eq!(m31_resp.status, TargetResolveStatus::Resolved, "M31 must resolve");
    assert_eq!(ngc_resp.status, TargetResolveStatus::Resolved, "NGC 224 must resolve");
    assert_eq!(
        m31_resp.target.unwrap().target_id,
        ngc_resp.target.unwrap().target_id,
        "M31 and NGC 224 resolved to different target IDs; expected the same target"
    );
}

/// TC-12.3: An unknown query returns `Unresolved` status (non-blocking).
#[tokio::test]
async fn resolve_unknown_query_returns_unresolved() {
    let (db, _repo, _bus) = support::setup().await;
    let resolver = FakeResolver::new(); // default: NotFound for everything

    let resp = resolve(
        db.pool(),
        &resolver,
        &TargetResolveSimbadRequest {
            contract_version: "1.0".to_owned(),
            request_id: Uuid::new_v4().to_string(),
            query: "XYZZY-UNKNOWN-9999".to_owned(),
            override_target: None,
        },
    )
    .await
    .unwrap();

    assert_eq!(
        resp.status,
        TargetResolveStatus::Unresolved,
        "junk query must yield Unresolved, got {:?}",
        resp.status
    );
    assert!(resp.target.is_none(), "Unresolved response must not carry a target");
}

// ── US #13: target identity / alias management ────────────────────────────────

/// TC-13.1: `target.get` returns full identity (id, primary_designation,
/// aliases) after seeding the target and adding two user aliases.
#[tokio::test]
async fn target_get_returns_identity_with_aliases() {
    let (db, _repo, _bus) = support::setup().await;

    let tid = seed_target(db.pool(), "M 31", &[]).await;

    // Add two aliases via the use case.
    target_management::alias_add(
        db.pool(),
        &TargetAliasAddRequest { target_id: tid.clone(), alias: "Andromeda Galaxy".to_owned() },
    )
    .await
    .expect("alias_add Andromeda Galaxy failed");

    target_management::alias_add(
        db.pool(),
        &TargetAliasAddRequest { target_id: tid.clone(), alias: "NGC 224".to_owned() },
    )
    .await
    .expect("alias_add NGC 224 failed");

    let result = target_management::get(db.pool(), &TargetGetRequest { target_id: tid.clone() })
        .await
        .expect("target_get failed");

    assert_eq!(result.id, tid, "id mismatch");
    assert_eq!(result.primary_designation, "M 31");

    let alias_texts: Vec<&str> = result.aliases.iter().map(|a| a.alias.as_str()).collect();
    assert!(
        alias_texts.contains(&"Andromeda Galaxy"),
        "missing 'Andromeda Galaxy' in aliases: {alias_texts:?}"
    );
    assert!(alias_texts.contains(&"NGC 224"), "missing 'NGC 224' in aliases: {alias_texts:?}");
}

/// TC-13.2: `target.alias.add` is idempotent — adding the same alias twice
/// returns the existing row on the second call without error.
#[tokio::test]
async fn alias_add_is_idempotent() {
    let (db, _repo, _bus) = support::setup().await;

    let tid = seed_target(db.pool(), "M 101", &[]).await;

    let first = target_management::alias_add(
        db.pool(),
        &TargetAliasAddRequest { target_id: tid.clone(), alias: "Pinwheel Galaxy".to_owned() },
    )
    .await
    .expect("first alias_add failed");

    let second = target_management::alias_add(
        db.pool(),
        &TargetAliasAddRequest { target_id: tid.clone(), alias: "Pinwheel Galaxy".to_owned() },
    )
    .await
    .expect("second alias_add (idempotent) failed");

    // Both calls must return the same stable alias id.
    assert_eq!(first.alias.id, second.alias.id, "idempotent add must return the same alias id");
}

/// TC-13.3: `target.alias.add` + `target.alias.remove` round-trip: alias is
/// present after add and absent after remove.
#[tokio::test]
async fn alias_add_remove_round_trip() {
    let (db, _repo, _bus) = support::setup().await;

    let tid = seed_target(db.pool(), "NGC 7000", &[]).await;

    // Add alias.
    let add_result = target_management::alias_add(
        db.pool(),
        &TargetAliasAddRequest { target_id: tid.clone(), alias: "North America Nebula".to_owned() },
    )
    .await
    .expect("alias_add failed");
    let alias_id = add_result.alias.id.clone();
    assert!(!alias_id.is_empty(), "alias_add must return a non-empty alias id");

    // Confirm alias visible via target_get.
    let detail = target_management::get(db.pool(), &TargetGetRequest { target_id: tid.clone() })
        .await
        .unwrap();
    assert!(
        detail.aliases.iter().any(|a| a.alias == "North America Nebula"),
        "alias missing after add: {:?}",
        detail.aliases
    );

    // Remove alias by its id.
    target_management::alias_remove(
        db.pool(),
        &TargetAliasRemoveRequest { target_id: tid.clone(), alias_id },
    )
    .await
    .expect("alias_remove failed");

    // Confirm alias gone.
    let after_remove =
        target_management::get(db.pool(), &TargetGetRequest { target_id: tid.clone() })
            .await
            .unwrap();
    assert!(
        !after_remove.aliases.iter().any(|a| a.alias == "North America Nebula"),
        "alias still present after remove: {:?}",
        after_remove.aliases
    );
}

/// TC-13.4: `target.display_alias.set` persists a display alias; `.clear`
/// removes it. `effective_label` tracks the display alias when set.
#[tokio::test]
async fn display_alias_set_and_clear() {
    use contracts_core::targets::{TargetDisplayAliasClearRequest, TargetDisplayAliasSetRequest};

    let (db, _repo, _bus) = support::setup().await;
    let tid = seed_target(db.pool(), "IC 1396", &[]).await;

    // Set display alias.
    let after_set = target_management::display_alias_set(
        db.pool(),
        &TargetDisplayAliasSetRequest {
            target_id: tid.clone(),
            display_alias: "Elephant Trunk Nebula".to_owned(),
        },
    )
    .await
    .expect("display_alias_set failed");

    assert_eq!(
        after_set.effective_label, "Elephant Trunk Nebula",
        "effective_label must reflect display_alias after set"
    );
    assert_eq!(after_set.display_alias.as_deref(), Some("Elephant Trunk Nebula"));

    // Clear display alias.
    let after_clear = target_management::display_alias_clear(
        db.pool(),
        &TargetDisplayAliasClearRequest { target_id: tid.clone() },
    )
    .await
    .expect("display_alias_clear failed");

    assert!(
        after_clear.display_alias.is_none(),
        "display_alias must be None after clear, got {:?}",
        after_clear.display_alias
    );
    assert_eq!(
        after_clear.effective_label, "IC 1396",
        "effective_label must fall back to primary_designation after clear"
    );
}
