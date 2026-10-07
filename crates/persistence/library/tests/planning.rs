// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Planning records in the clean catalog (spec 072): Tier 1 site, default-site,
//! Planned-mark and subscription writes checked against their revisions,
//! refusals that store nothing, durable delivery identities, restart recovery
//! and the schema version. Planning writes never touch a Target row.
#![cfg(unix)]

mod support;

use std::collections::BTreeMap;
use std::path::Path;

use persistence_library::{
    Catalog, DeliveryClaim, DeliveryOutcome, SubscriptionWrite, PLANNING_SETTINGS_ID,
};
use platevault_model::{
    BlockReason, Darkness, DeliveryState, LibraryError, MoonCriterion, ObservingSite, PlanCriteria,
    RecoveryAction, Revision, SiteInput, SubscriptionState, TargetRecord, WindowKey,
};
use sqlx::sqlite::{SqliteConnectOptions, SqliteConnection};
use sqlx::Connection;
use support::{kind, target, Fixture};
use time::macros::{date, datetime};
use uuid::Uuid;

/// Planning tables, children first.
const PLANNING_TABLES: [&str; 5] = [
    "reminder_deliveries",
    "reminder_subscriptions",
    "target_plans",
    "planning_settings",
    "observing_sites",
];

fn backyard_input() -> SiteInput {
    SiteInput {
        name: "Backyard".into(),
        latitude_deg: 52.09,
        longitude_deg: 5.12,
        elevation_m: Some(5.0),
        time_zone: "Europe/Amsterdam".into(),
    }
}

fn athens_input() -> SiteInput {
    SiteInput {
        name: "Athens".into(),
        latitude_deg: 37.98,
        longitude_deg: 23.73,
        elevation_m: Some(100.0),
        time_zone: "Europe/Athens".into(),
    }
}

fn criteria() -> PlanCriteria {
    PlanCriteria {
        min_altitude_deg: 30.0,
        darkness: Darkness::Astronomical,
        moon: MoonCriterion::MinSeparation { min_separation_deg: 30.0 },
        min_duration_minutes: 60,
    }
}

fn conflict_at(error: &LibraryError, id: Uuid, current: Revision) {
    let response = error.response(None, None);
    assert_eq!(
        (response.kind.as_str(), response.identity, response.current_revision),
        ("conflict", Some(id), Some(current)),
        "{error}"
    );
}

async fn raw(db: &Path) -> SqliteConnection {
    SqliteConnection::connect_with(&SqliteConnectOptions::new().filename(db)).await.unwrap()
}

/// Every row of `tables` in rowid order, each value quoted by SQLite.
async fn dump(db: &Path, tables: &[&str]) -> BTreeMap<String, Vec<String>> {
    let mut conn = raw(db).await;
    let mut rows = BTreeMap::new();
    for table in tables {
        let columns: Vec<String> = sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
            "SELECT name FROM pragma_table_info('{table}')"
        )))
        .fetch_all(&mut conn)
        .await
        .unwrap();
        let quoted =
            columns.iter().map(|column| format!("quote(\"{column}\")")).collect::<Vec<_>>();
        let values: Vec<String> = sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
            "SELECT {} FROM {table} ORDER BY rowid",
            quoted.join(" || '|' || ")
        )))
        .fetch_all(&mut conn)
        .await
        .unwrap();
        rows.insert((*table).to_owned(), values);
    }
    conn.close().await.unwrap();
    rows
}

struct Planning {
    fx: Fixture,
    catalog: Catalog,
    ngc: TargetRecord,
    ic: TargetRecord,
    backyard: ObservingSite,
    athens: ObservingSite,
}

/// Two saved Targets and two saved sites, without a default.
async fn planning() -> Planning {
    let fx = Fixture::new();
    let catalog = Catalog::open(&fx.db).await.unwrap();
    let ngc = catalog.save_target(&target("NGC 7000", "ngc 7000"), None).await.unwrap();
    let ic = catalog.save_target(&target("IC 5070", "ic 5070"), None).await.unwrap();
    let backyard = catalog.save_site(None, None, &backyard_input()).await.unwrap().site;
    let athens = catalog.save_site(None, None, &athens_input()).await.unwrap().site;
    Planning { fx, catalog, ngc, ic, backyard, athens }
}

fn write(target: &TargetRecord, site: &ObservingSite, settings: Revision) -> SubscriptionWrite {
    SubscriptionWrite {
        target_id: target.candidate.id,
        site_id: site.id,
        site_revision: site.revision,
        settings_revision: settings,
        criteria: criteria(),
        lead_minutes: 60,
        expected: None,
        state: SubscriptionState::Enabled,
        block_reason: None,
    }
}

fn claim(
    target: &TargetRecord,
    site: &ObservingSite,
    start: time::OffsetDateTime,
) -> DeliveryClaim {
    DeliveryClaim {
        key: WindowKey::new(target.candidate.id, site.id, start).unwrap(),
        window_end_utc: start + time::Duration::hours(3),
        night: date!(2026 - 10 - 24),
        due_at: start - time::Duration::hours(1),
    }
}

#[tokio::test]
async fn save_site_creates_revision_one_and_refuses_stale_revisions_and_duplicate_names() {
    let Planning { fx, catalog, backyard, athens, .. } = planning().await;
    assert_eq!((backyard.revision, backyard.name.as_str()), (1, "Backyard"));
    assert_eq!(backyard.time_zone, "Europe/Amsterdam");
    assert_eq!(backyard.elevation_m, Some(5.0));
    let renamed = SiteInput { name: "  Back garden ".into(), ..backyard_input() };
    let saved = catalog.save_site(Some(backyard.id), Some(1), &renamed).await.unwrap();
    assert_eq!((saved.site.revision, saved.site.name.as_str()), (2, "Back garden"));
    assert!(saved.needs_reconfirmation.is_empty());
    assert_eq!(saved.site.created_at, backyard.created_at);

    let before = dump(&fx.db, &PLANNING_TABLES).await;
    let stale = catalog.save_site(Some(backyard.id), Some(1), &backyard_input()).await.unwrap_err();
    conflict_at(&stale, backyard.id, 2);
    let blind = catalog.save_site(Some(backyard.id), None, &backyard_input()).await.unwrap_err();
    conflict_at(&blind, backyard.id, 2);
    let duplicate = SiteInput { name: " Athens ".into(), ..backyard_input() };
    let error = catalog.save_site(None, None, &duplicate).await.unwrap_err();
    assert_eq!(kind(&error), "invalid_input", "{error}");
    assert!(error.to_string().contains("name"), "{error}");
    let error = catalog.save_site(Some(backyard.id), Some(2), &duplicate).await.unwrap_err();
    assert_eq!(kind(&error), "invalid_input", "{error}");
    let invalid = SiteInput { latitude_deg: 90.5, ..backyard_input() };
    assert_eq!(kind(&catalog.save_site(None, None, &invalid).await.unwrap_err()), "invalid_input");
    let unknown =
        catalog.save_site(Some(Uuid::new_v4()), Some(1), &backyard_input()).await.unwrap_err();
    assert_eq!(kind(&unknown), "not_found");
    assert_eq!(dump(&fx.db, &PLANNING_TABLES).await, before);
    assert_eq!(catalog.site(athens.id).await.unwrap(), athens);
    assert_eq!(kind(&catalog.site(Uuid::new_v4()).await.unwrap_err()), "not_found");
}

#[tokio::test]
async fn the_default_site_is_explicit_and_changing_it_reconfirms_other_subscriptions() {
    let Planning { fx, catalog, ngc, ic, backyard, athens } = planning().await;
    let fresh = catalog.list_sites().await.unwrap();
    assert_eq!((fresh.default_site_id, fresh.settings_revision), (None, 0));
    let names: Vec<&str> = fresh.sites.iter().map(|site| site.name.as_str()).collect();
    assert_eq!(names, ["Athens", "Backyard"]);

    let set = catalog.set_default_site(Some(backyard.id), 0).await.unwrap();
    assert_eq!((set.settings.default_site_id, set.settings.revision), (Some(backyard.id), 1));
    assert!(set.needs_reconfirmation.is_empty());
    let stale = catalog.set_default_site(Some(athens.id), 0).await.unwrap_err();
    conflict_at(&stale, PLANNING_SETTINGS_ID, 1);
    let missing = catalog.set_default_site(Some(Uuid::new_v4()), 1).await.unwrap_err();
    assert_eq!(kind(&missing), "not_found");

    let on_backyard = catalog.put_reminder_subscription(&write(&ngc, &backyard, 1)).await.unwrap();
    assert_eq!(on_backyard.state, SubscriptionState::Enabled);
    let blocked = SubscriptionWrite {
        state: SubscriptionState::Blocked,
        block_reason: Some(BlockReason::PermissionDenied),
        ..write(&ic, &backyard, 1)
    };
    let blocked = catalog.put_reminder_subscription(&blocked).await.unwrap();
    assert_eq!(blocked.actions, [RecoveryAction::Settings, RecoveryAction::Retry]);

    // Re-saving the same default moves nothing; another default moves both.
    let same = catalog.set_default_site(Some(backyard.id), 1).await.unwrap();
    assert!(same.needs_reconfirmation.is_empty());
    let moved = catalog.set_default_site(Some(athens.id), 2).await.unwrap();
    assert_eq!(moved.settings.revision, 3);
    let mut both = vec![ngc.candidate.id, ic.candidate.id];
    both.sort();
    assert_eq!(moved.needs_reconfirmation, both);
    for target in [&ngc, &ic] {
        let subscription =
            catalog.reminder_subscription(target.candidate.id).await.unwrap().unwrap();
        assert_eq!(subscription.state, SubscriptionState::NeedsReconfirmation);
        assert_eq!((subscription.block_reason, subscription.actions.len()), (None, 0));
    }
    assert!(catalog
        .reminder_subscriptions(Some(SubscriptionState::Enabled))
        .await
        .unwrap()
        .is_empty());

    // Clearing the default reconfirms every subscription, wherever it is.
    let on_athens = SubscriptionWrite { expected: Some(2), ..write(&ngc, &athens, 3) };
    let on_athens = catalog.put_reminder_subscription(&on_athens).await.unwrap();
    assert_eq!(
        (on_athens.state, on_athens.revision, on_athens.site_name.as_str()),
        (SubscriptionState::Enabled, 3, "Athens")
    );
    let cleared = catalog.set_default_site(None, 3).await.unwrap();
    assert_eq!((cleared.settings.default_site_id, cleared.settings.revision), (None, 4));
    assert_eq!(cleared.needs_reconfirmation, [ngc.candidate.id]);
    let reread = catalog.list_sites().await.unwrap();
    assert_eq!((reread.default_site_id, reread.settings_revision), (None, 4));
    drop(fx);
}

#[tokio::test]
async fn editing_a_subscribed_site_moves_its_subscriptions_to_reconfirmation() {
    let Planning { fx: _fx, catalog, ngc, ic, backyard, athens } = planning().await;
    catalog.set_default_site(Some(backyard.id), 0).await.unwrap();
    catalog.put_reminder_subscription(&write(&ngc, &backyard, 1)).await.unwrap();
    let moved_elsewhere =
        catalog.save_site(Some(athens.id), Some(1), &athens_input()).await.unwrap();
    assert!(moved_elsewhere.needs_reconfirmation.is_empty());
    let edited = SiteInput { elevation_m: Some(7.0), ..backyard_input() };
    let saved = catalog.save_site(Some(backyard.id), Some(1), &edited).await.unwrap();
    assert_eq!(saved.needs_reconfirmation, [ngc.candidate.id]);
    let subscription = catalog.reminder_subscription(ngc.candidate.id).await.unwrap().unwrap();
    assert_eq!(
        (subscription.state, subscription.revision),
        (SubscriptionState::NeedsReconfirmation, 2)
    );
    assert_eq!(catalog.reminder_subscription(ic.candidate.id).await.unwrap(), None);
}

#[tokio::test]
async fn the_planned_mark_commits_its_own_revision_and_leaves_the_target_unchanged() {
    let Planning { fx, catalog, ngc, .. } = planning().await;
    let before = catalog.target(ngc.candidate.id).await.unwrap();
    let unmarked = catalog.target_plan(ngc.candidate.id).await.unwrap();
    assert_eq!((unmarked.planned, unmarked.revision, unmarked.updated_at), (false, 0, None));
    let planned = catalog.set_target_planned(ngc.candidate.id, true, 0).await.unwrap();
    assert_eq!((planned.planned, planned.revision), (true, 1));
    let stale = catalog.set_target_planned(ngc.candidate.id, false, 0).await.unwrap_err();
    conflict_at(&stale, ngc.candidate.id, 1);
    let unknown = catalog.set_target_planned(Uuid::new_v4(), true, 0).await.unwrap_err();
    assert_eq!(kind(&unknown), "not_found");
    assert_eq!(kind(&catalog.target_plan(Uuid::new_v4()).await.unwrap_err()), "not_found");
    let after = catalog.target(ngc.candidate.id).await.unwrap();
    assert_eq!(after, before);
    assert_eq!(after.decision_revision, ngc.decision_revision);
    assert!(catalog.reminder_subscription(ngc.candidate.id).await.unwrap().is_none());
    drop(fx);
}

#[tokio::test]
async fn subscriptions_need_the_current_default_site_and_revisions_or_store_nothing() {
    let Planning { fx, catalog, ngc, backyard, athens, .. } = planning().await;
    let before = dump(&fx.db, &PLANNING_TABLES).await;
    let no_default =
        catalog.put_reminder_subscription(&write(&ngc, &backyard, 0)).await.unwrap_err();
    assert_eq!(kind(&no_default), "invalid_input");
    assert!(no_default.to_string().contains("defaultSite"), "{no_default}");
    assert_eq!(dump(&fx.db, &PLANNING_TABLES).await, before);

    catalog.set_default_site(Some(backyard.id), 0).await.unwrap();
    let before = dump(&fx.db, &PLANNING_TABLES).await;
    let elsewhere = catalog.put_reminder_subscription(&write(&ngc, &athens, 1)).await.unwrap_err();
    conflict_at(&elsewhere, PLANNING_SETTINGS_ID, 1);
    let stale_site = SubscriptionWrite { site_revision: 0, ..write(&ngc, &backyard, 1) };
    let stale_site = catalog.put_reminder_subscription(&stale_site).await.unwrap_err();
    conflict_at(&stale_site, backyard.id, 1);
    let stale_settings =
        catalog.put_reminder_subscription(&write(&ngc, &backyard, 2)).await.unwrap_err();
    conflict_at(&stale_settings, PLANNING_SETTINGS_ID, 1);
    let no_lead = SubscriptionWrite { lead_minutes: 0, ..write(&ngc, &backyard, 1) };
    let no_lead = catalog.put_reminder_subscription(&no_lead).await.unwrap_err();
    assert!(no_lead.to_string().contains("leadMinutes"), "{no_lead}");
    let unexplained =
        SubscriptionWrite { state: SubscriptionState::Blocked, ..write(&ngc, &backyard, 1) };
    assert_eq!(
        kind(&catalog.put_reminder_subscription(&unexplained).await.unwrap_err()),
        "invalid_input"
    );
    let disabled =
        SubscriptionWrite { state: SubscriptionState::Disabled, ..write(&ngc, &backyard, 1) };
    assert_eq!(
        kind(&catalog.put_reminder_subscription(&disabled).await.unwrap_err()),
        "invalid_input"
    );
    let unknown = SubscriptionWrite { target_id: Uuid::new_v4(), ..write(&ngc, &backyard, 1) };
    assert_eq!(kind(&catalog.put_reminder_subscription(&unknown).await.unwrap_err()), "not_found");
    assert_eq!(dump(&fx.db, &PLANNING_TABLES).await, before);

    let enabled = catalog.put_reminder_subscription(&write(&ngc, &backyard, 1)).await.unwrap();
    assert_eq!(
        (enabled.revision, enabled.site_name.as_str(), enabled.lead_minutes),
        (1, "Backyard", 60)
    );
    let again = catalog.put_reminder_subscription(&write(&ngc, &backyard, 1)).await.unwrap_err();
    conflict_at(&again, ngc.candidate.id, 1);
    let disabled = catalog
        .set_subscription_state(ngc.candidate.id, 1, SubscriptionState::Disabled, None)
        .await
        .unwrap();
    assert_eq!((disabled.state, disabled.revision), (SubscriptionState::Disabled, 2));
    let enable = catalog
        .set_subscription_state(ngc.candidate.id, 2, SubscriptionState::Enabled, None)
        .await
        .unwrap_err();
    assert_eq!(kind(&enable), "invalid_input");
    let stale = catalog
        .set_subscription_state(ngc.candidate.id, 1, SubscriptionState::Disabled, None)
        .await
        .unwrap_err();
    conflict_at(&stale, ngc.candidate.id, 2);
    let blocked = catalog
        .set_subscription_state(
            ngc.candidate.id,
            2,
            SubscriptionState::Blocked,
            Some(BlockReason::UnbundledProcess),
        )
        .await
        .unwrap();
    assert_eq!(
        (blocked.block_reason, blocked.actions),
        (Some(BlockReason::UnbundledProcess), vec![RecoveryAction::Retry])
    );
}

#[tokio::test]
async fn a_delivery_identity_is_claimed_once_and_a_sending_row_reopens_uncertain() {
    let Planning { fx, catalog, ngc, ic, backyard, athens } = planning().await;
    catalog.set_default_site(Some(backyard.id), 0).await.unwrap();
    catalog.put_reminder_subscription(&write(&ngc, &backyard, 1)).await.unwrap();
    let start = datetime!(2026-10-24 22:01 UTC);
    let first = claim(&ngc, &backyard, start);
    assert!(catalog.claim_reminder_delivery(&first).await.unwrap());
    assert!(!catalog.claim_reminder_delivery(&first).await.unwrap());
    // Only an enabled subscription at its own site claims anything.
    assert!(!catalog.claim_reminder_delivery(&claim(&ngc, &athens, start)).await.unwrap());
    assert!(!catalog.claim_reminder_delivery(&claim(&ic, &backyard, start)).await.unwrap());

    let later = claim(&ngc, &backyard, start + time::Duration::days(1));
    assert!(catalog.claim_reminder_delivery(&later).await.unwrap());
    let submitted =
        catalog.finish_reminder_delivery(&later.key, &DeliveryOutcome::Submitted).await.unwrap();
    assert_eq!((submitted.state, submitted.reason.clone()), (DeliveryState::Submitted, None));
    let refinish = catalog
        .finish_reminder_delivery(&later.key, &DeliveryOutcome::Submitted)
        .await
        .unwrap_err();
    assert_eq!(kind(&refinish), "invalid_input");
    let failed = claim(&ngc, &backyard, start + time::Duration::days(2));
    assert!(catalog.claim_reminder_delivery(&failed).await.unwrap());
    let failure = DeliveryOutcome::Failed { reason: "the notification center refused".into() };
    let failed_row = catalog.finish_reminder_delivery(&failed.key, &failure).await.unwrap();
    assert_eq!(failed_row.state, DeliveryState::Failed);
    assert_eq!(failed_row.reason.as_deref(), Some("the notification center refused"));
    assert!(
        !catalog.claim_reminder_delivery(&failed).await.unwrap(),
        "a failed identity is never retried"
    );

    let listed = catalog.reminder_deliveries(0, 10).await.unwrap();
    let states: Vec<DeliveryState> = listed.iter().map(|row| row.state).collect();
    assert_eq!(states, [DeliveryState::Failed, DeliveryState::Submitted, DeliveryState::Sending]);
    assert_eq!(listed[2].window_key, first.key);
    assert_eq!(
        (listed[2].site_name.as_str(), listed[2].night, listed[2].due_at),
        ("Backyard", first.night, first.due_at)
    );
    assert_eq!(catalog.reminder_deliveries(1, 1).await.unwrap(), listed[1..2]);
    catalog.close().await.unwrap();

    let reopened = Catalog::open(&fx.db).await.unwrap();
    let restored = reopened.reminder_deliveries(0, 10).await.unwrap();
    assert_eq!(restored[2].state, DeliveryState::Uncertain);
    assert_eq!(restored[..2], listed[..2]);
    assert!(
        !reopened.claim_reminder_delivery(&first).await.unwrap(),
        "an uncertain identity stays claimed"
    );
    let unfinished = reopened
        .finish_reminder_delivery(&first.key, &DeliveryOutcome::Submitted)
        .await
        .unwrap_err();
    assert_eq!(kind(&unfinished), "invalid_input");
}

#[tokio::test]
async fn reopen_restores_every_planning_record_unchanged() {
    let Planning { fx, catalog, ngc, backyard, .. } = planning().await;
    catalog.set_default_site(Some(backyard.id), 0).await.unwrap();
    catalog.set_target_planned(ngc.candidate.id, true, 0).await.unwrap();
    catalog.put_reminder_subscription(&write(&ngc, &backyard, 1)).await.unwrap();
    let start = datetime!(2026-10-24 22:01 UTC);
    let delivery = claim(&ngc, &backyard, start);
    catalog.claim_reminder_delivery(&delivery).await.unwrap();
    catalog.finish_reminder_delivery(&delivery.key, &DeliveryOutcome::Submitted).await.unwrap();
    let sites = catalog.list_sites().await.unwrap();
    let plan = catalog.target_plan(ngc.candidate.id).await.unwrap();
    let subscriptions = catalog.reminder_subscriptions(None).await.unwrap();
    let deliveries = catalog.reminder_deliveries(0, 10).await.unwrap();
    let rows = dump(&fx.db, &PLANNING_TABLES).await;
    catalog.close().await.unwrap();

    let reopened = Catalog::open(&fx.db).await.unwrap();
    assert_eq!(reopened.list_sites().await.unwrap(), sites);
    assert_eq!(reopened.target_plan(ngc.candidate.id).await.unwrap(), plan);
    assert_eq!(reopened.reminder_subscriptions(None).await.unwrap(), subscriptions);
    assert_eq!(reopened.reminder_deliveries(0, 10).await.unwrap(), deliveries);
    reopened.close().await.unwrap();
    assert_eq!(dump(&fx.db, &PLANNING_TABLES).await, rows);
}

#[tokio::test]
async fn a_catalog_recorded_at_schema_version_7_is_refused_before_any_ddl() {
    let fx = Fixture::new();
    Catalog::open(&fx.db).await.unwrap().close().await.unwrap();
    // The version 7 shape: every library and Project table and no planning table.
    let mut conn = raw(&fx.db).await;
    let drops = PLANNING_TABLES.map(|table| format!("DROP TABLE {table};")).join(" ");
    sqlx::raw_sql(sqlx::AssertSqlSafe(format!(
        "{drops} UPDATE catalog_meta SET value = 7 WHERE key = 'schema_version';"
    )))
    .execute(&mut conn)
    .await
    .unwrap();
    conn.close().await.unwrap();

    let error = Catalog::open(&fx.db).await.err().expect("a version 7 catalog is refused");
    assert_eq!(error.to_string(), "invalid input: unsupported catalog schema version 7");
    let mut conn = raw(&fx.db).await;
    let tables: Vec<String> = sqlx::query_scalar(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN \
         ('observing_sites', 'planning_settings', 'target_plans', 'reminder_subscriptions', \
          'reminder_deliveries')",
    )
    .fetch_all(&mut conn)
    .await
    .unwrap();
    conn.close().await.unwrap();
    assert!(tables.is_empty(), "no DDL of this version ran: {tables:?}");
}
