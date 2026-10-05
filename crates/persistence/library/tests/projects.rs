// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Project records in the clean catalog (spec 065): Tier 1 writes checked against
//! the Project revision and every record they reference, refusals that write
//! nothing, no effect on library rows or source files, restart and the schema
//! version. Fixture files are real and only ever read.
#![cfg(unix)]

mod support;

use std::collections::BTreeMap;
use std::path::Path;

use persistence_library::{Catalog, LocationReferences, SessionQuery};
use platevault_model::{
    AssociationState, Availability, CalibrationKind, ChecklistItemInput, ChecklistKind,
    CorrectionInput, Equipment, LibraryError, LinkState, PanelInput, Project, ProjectInput,
    ProjectQuery, Provenance, Quality, Revision, Session, SessionLinkInput, SkyCoordinates,
    TargetFraming, TargetRecord,
};
use sqlx::sqlite::{SqliteConnectOptions, SqliteConnection};
use sqlx::Connection;
use support::*;
use uuid::Uuid;

const FRAMES: [&str; 4] =
    ["night1/Ha_001.fits", "night1/Ha_002.fits", "night1/OIII_001.fits", "night1/OIII_002.fits"];

/// Library rows no Project write may touch.
const LIBRARY_TABLES: [&str; 6] =
    ["assets", "quality_decisions", "sessions", "session_members", "associations", "corrections"];

/// Project tables, children first.
const PROJECT_TABLES: [&str; 7] = [
    "project_rejections",
    "project_session_links",
    "project_checklist",
    "project_equipment",
    "project_panels",
    "project_targets",
    "projects",
];

struct Indexed {
    fx: Fixture,
    catalog: Catalog,
    location: platevault_model::Location,
    target: TargetRecord,
    equipment: Equipment,
    before: BTreeMap<std::path::PathBuf, (u64, String)>,
}

/// Four real frames indexed into one location (an Ha and an OIII session), a
/// saved NGC 7000 Target and saved equipment.
async fn indexed() -> Indexed {
    let fx = Fixture::new();
    for name in FRAMES {
        fx.write(name, name.as_bytes());
    }
    let before = tree(&fx.root);
    let catalog = Catalog::open(&fx.db).await.unwrap();
    let location = catalog.register_location(&fx.registration()).await.unwrap();
    scan(&catalog, &fx, &location, &FRAMES).await;
    let target = catalog.save_target(&target("NGC 7000", "ngc 7000"), None).await.unwrap();
    let equipment = catalog.save_equipment(&redcat(), None).await.unwrap();
    Indexed { fx, catalog, location, target, equipment, before }
}

fn redcat() -> Equipment {
    Equipment {
        id: Uuid::new_v4(),
        name: "RedCat 51 / ASI2600MM".into(),
        camera: Some("ASI2600MM".into()),
        telescope: Some("RedCat 51".into()),
        focal_length_mm: Some(250.0),
        pixel_size_um: Some(3.76),
        decision_revision: 0,
        state: AssociationState::Unresolved,
        provenance: Provenance::User,
    }
}

fn panel(name: &str) -> PanelInput {
    PanelInput {
        id: None,
        name: name.into(),
        ra_deg: 314.75,
        dec_deg: 44.33,
        width_deg: 2.5,
        height_deg: 1.7,
        position_angle_deg: None,
    }
}

fn framing(record: &TargetRecord) -> TargetFraming {
    TargetFraming { target_id: record.candidate.id, expected_revision: record.decision_revision }
}

fn hoo(record: &TargetRecord, equipment: &Equipment) -> ProjectInput {
    ProjectInput {
        name: "NGC 7000 HOO".into(),
        notes: Some("Bicolor".into()),
        targets: vec![framing(record)],
        panels: vec![panel("East")],
        equipment_ids: vec![equipment.id],
    }
}

/// The current session of each effective filter.
async fn sessions(catalog: &Catalog) -> BTreeMap<String, Session> {
    let mut by_filter = BTreeMap::new();
    for summary in catalog.list_sessions(&SessionQuery::default()).await.unwrap() {
        let asset = catalog.asset(summary.session.asset_ids[0]).await.unwrap();
        by_filter.insert(asset.effective.filter.unwrap(), summary.session);
    }
    by_filter
}

fn link(session: &Session, panel_id: Option<Uuid>) -> SessionLinkInput {
    SessionLinkInput { session: expected_session(session), panel_id }
}

fn every_kind(equipment: &Equipment) -> Vec<ChecklistItemInput> {
    [
        ChecklistKind::Integration { channel: "Ha".into(), goal_seconds: 36_000 },
        ChecklistKind::FrameCount { channel: "Ha".into(), goal_frames: 120 },
        ChecklistKind::ExposurePreference { exposure_seconds: 300.0, channel: Some("Ha".into()) },
        ChecklistKind::PanelCoverage,
        ChecklistKind::Equipment { equipment_id: equipment.id },
        ChecklistKind::MissingCalibration { calibration: CalibrationKind::Flat, channel: None },
    ]
    .into_iter()
    .map(|criterion| ChecklistItemInput { id: None, criterion })
    .collect()
}

/// A Conflict naming `id` at its `current` revision.
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

#[tokio::test]
async fn create_snapshots_the_saved_target_and_refuses_stale_unsaved_or_unknown_records() {
    let lib = indexed().await;
    let catalog = &lib.catalog;
    let project = catalog.create_project(&hoo(&lib.target, &lib.equipment)).await.unwrap();
    assert_eq!((project.revision, project.name.as_str()), (1, "NGC 7000 HOO"));
    let framed = &project.targets[0];
    assert_eq!(
        (framed.target_id, framed.confirmed_revision, framed.current_revision),
        (lib.target.candidate.id, 1, 1)
    );
    assert!(!framed.framing_changed);
    assert_eq!(framed.designation, "NGC 7000");
    assert_eq!(framed.coordinates, lib.target.candidate.coordinates);
    assert_eq!(framed.provenance, Provenance::User);
    assert_eq!(project.equipment_ids, vec![lib.equipment.id]);
    assert_eq!(
        (project.panels[0].name.as_str(), project.panels[0].position_angle_deg),
        ("East", None)
    );
    assert!(project.links.is_empty() && project.checklist.is_empty());
    assert!(project.rejections.is_empty());
    assert_eq!(catalog.project(project.id).await.unwrap(), project);

    // The Target changes after the Project framed it: the framing keeps its snapshot.
    let mut moved = lib.target.candidate.clone();
    moved.coordinates = Some(SkyCoordinates { ra_deg: 312.0, dec_deg: 44.5, frame: "ICRS".into() });
    let revised = catalog.save_target(&moved, Some(1)).await.unwrap();
    let read = catalog.project(project.id).await.unwrap();
    assert_eq!((read.targets[0].current_revision, read.targets[0].framing_changed), (2, true));
    assert_eq!(read.targets[0].coordinates, lib.target.candidate.coordinates, "snapshot stands");
    assert_eq!(read.revision, 1, "a Target edit writes no Project row");

    // Refusals write no row.
    let rows = dump(&lib.fx.db, &PROJECT_TABLES).await;
    let stale = catalog.create_project(&hoo(&lib.target, &lib.equipment)).await.unwrap_err();
    conflict_at(&stale, lib.target.candidate.id, 2);
    let mut unsaved = hoo(&revised, &lib.equipment);
    unsaved.targets = vec![TargetFraming { target_id: Uuid::new_v4(), expected_revision: 1 }];
    assert_eq!(kind(&catalog.create_project(&unsaved).await.unwrap_err()), "not_found");
    let mut unknown = hoo(&revised, &lib.equipment);
    unknown.equipment_ids.push(Uuid::new_v4());
    assert_eq!(kind(&catalog.create_project(&unknown).await.unwrap_err()), "not_found");
    let blank = ProjectInput { name: " ".into(), ..hoo(&revised, &lib.equipment) };
    assert_eq!(kind(&catalog.create_project(&blank).await.unwrap_err()), "invalid_input");
    assert_eq!(dump(&lib.fx.db, &PROJECT_TABLES).await, rows);

    // An update keeps a confirmed snapshot until the new Target revision is confirmed.
    let kept = catalog.update_project(project.id, 1, &hoo(&lib.target, &lib.equipment)).await;
    let kept = kept.unwrap();
    assert_eq!((kept.revision, kept.targets[0].confirmed_revision), (2, 1));
    assert!(kept.targets[0].framing_changed);
    let confirmed = catalog.update_project(project.id, 2, &hoo(&revised, &lib.equipment)).await;
    let confirmed = confirmed.unwrap();
    assert_eq!((confirmed.revision, confirmed.targets[0].confirmed_revision), (3, 2));
    assert!(!confirmed.targets[0].framing_changed);
    assert_eq!(confirmed.targets[0].coordinates, revised.candidate.coordinates);
    assert_ne!(confirmed.panels[0].id, project.panels[0].id, "a panel without id is a new one");

    // Listing computes no progress; a Target filter lists the Projects framing it.
    let other = catalog.save_target(&target("IC 5070", "ic 5070"), None).await.unwrap();
    let pelican = ProjectInput {
        name: "Pelican".into(),
        notes: None,
        targets: vec![framing(&other)],
        panels: Vec::new(),
        equipment_ids: Vec::new(),
    };
    let pelican = catalog.create_project(&pelican).await.unwrap();
    let query = |target_id, offset, limit| ProjectQuery { target_id, offset, limit };
    let all = catalog.list_projects(&query(None, 0, 10)).await.unwrap();
    let names: Vec<&str> = all.iter().map(|summary| summary.name.as_str()).collect();
    assert_eq!(names, ["NGC 7000 HOO", "Pelican"]);
    let first = &all[0];
    assert_eq!(
        (first.revision, first.panel_count, first.linked_session_count, first.checklist_item_count),
        (3, 1, 0, 0)
    );
    assert_eq!(first.target_designations, ["NGC 7000"]);
    let framing_ic = catalog.list_projects(&query(Some(other.candidate.id), 0, 10)).await.unwrap();
    assert_eq!(framing_ic.iter().map(|summary| summary.id).collect::<Vec<_>>(), [pelican.id]);
    let page = catalog.list_projects(&query(None, 1, 1)).await.unwrap();
    assert_eq!(page.iter().map(|summary| summary.id).collect::<Vec<_>>(), [pelican.id]);
    assert_eq!(kind(&catalog.project(Uuid::new_v4()).await.unwrap_err()), "not_found");
    assert_eq!(tree(&lib.fx.root), lib.before, "no file changed");
}

#[tokio::test]
async fn every_write_refuses_a_stale_project_revision_and_adds_exactly_one() {
    let lib = indexed().await;
    let catalog = &lib.catalog;
    let ha = sessions(catalog).await["Ha"].clone();
    let project = catalog.create_project(&hoo(&lib.target, &lib.equipment)).await.unwrap();
    let id = project.id;
    let frame = catalog.asset(ha.asset_ids[0]).await.unwrap();
    let renamed =
        ProjectInput { name: "NGC 7000 bicolor".into(), ..hoo(&lib.target, &lib.equipment) };
    let items = every_kind(&lib.equipment);

    let error = catalog.update_project(id, 0, &renamed).await.unwrap_err();
    conflict_at(&error, id, 1);
    assert_eq!(catalog.project(id).await.unwrap(), project, "a refusal changes nothing");
    let updated = catalog.update_project(id, 1, &renamed).await.unwrap();
    assert_eq!((updated.revision, updated.name.as_str()), (2, "NGC 7000 bicolor"));

    conflict_at(&catalog.set_checklist(id, 1, &items).await.unwrap_err(), id, 2);
    assert_eq!(catalog.project(id).await.unwrap(), updated);
    let listed = catalog.set_checklist(id, 2, &items).await.unwrap();
    assert_eq!((listed.revision, listed.checklist.len()), (3, items.len()));

    conflict_at(&catalog.link_sessions(id, 2, &[link(&ha, None)]).await.unwrap_err(), id, 3);
    assert_eq!(catalog.project(id).await.unwrap(), listed);
    let linked = catalog.link_sessions(id, 3, &[link(&ha, None)]).await.unwrap();
    assert_eq!((linked.revision, linked.links.len()), (4, 1));

    let rejected = catalog.set_project_rejection(id, 3, &[expected(&frame)], true).await;
    conflict_at(&rejected.unwrap_err(), id, 4);
    assert_eq!(catalog.project(id).await.unwrap(), linked);
    let rejected = catalog.set_project_rejection(id, 4, &[expected(&frame)], true).await.unwrap();
    assert_eq!((rejected.revision, rejected.rejections.len()), (5, 1));

    conflict_at(&catalog.unlink_sessions(id, 4, &[ha.id]).await.unwrap_err(), id, 5);
    assert_eq!(catalog.project(id).await.unwrap(), rejected);
    let unlinked = catalog.unlink_sessions(id, 5, &[ha.id]).await.unwrap();
    assert_eq!((unlinked.revision, unlinked.links.len()), (6, 0));
    let missing = catalog.update_project(Uuid::new_v4(), 1, &renamed).await.unwrap_err();
    assert_eq!(kind(&missing), "not_found");
}

#[tokio::test]
async fn links_refuse_stale_or_superseded_sessions_and_a_correction_makes_a_link_need_review() {
    let lib = indexed().await;
    let catalog = &lib.catalog;
    let by_filter = sessions(catalog).await;
    let (ha, oiii) = (&by_filter["Ha"], &by_filter["OIII"]);
    let project = catalog.create_project(&hoo(&lib.target, &lib.equipment)).await.unwrap();
    let east = project.panels[0].id;

    let mut stale = link(ha, Some(east));
    stale.session.grouping_revision += 1;
    let error = catalog.link_sessions(project.id, 1, &[stale]).await.unwrap_err();
    assert_eq!(
        (kind(&error), error.response(None, None).identity),
        ("conflict".into(), Some(ha.id))
    );
    let unknown = catalog.link_sessions(project.id, 1, &[link(ha, Some(Uuid::new_v4()))]).await;
    assert_eq!(kind(&unknown.unwrap_err()), "not_found");
    assert_eq!(catalog.project(project.id).await.unwrap(), project);

    let linked =
        catalog.link_sessions(project.id, 1, &[link(ha, Some(east)), link(oiii, None)]).await;
    let linked = linked.unwrap();
    assert_eq!(linked.revision, 2);
    let states: Vec<_> = linked
        .links
        .iter()
        .map(|link| (link.session_id, link.panel_id, link.state, link.grouping_revision))
        .collect();
    let mut expected_links = vec![
        (ha.id, Some(east), LinkState::Current, ha.grouping_revision),
        (oiii.id, None, LinkState::Current, oiii.grouping_revision),
    ];
    expected_links.sort_by_key(|link| link.0);
    assert_eq!(states, expected_links);
    // Linking a linked session reassigns its panel.
    let reassigned = catalog.link_sessions(project.id, 2, &[link(oiii, Some(east))]).await.unwrap();
    assert!(reassigned.links.iter().all(|link| link.panel_id == Some(east)));

    // A panel that holds links is never removed silently.
    let without = ProjectInput { panels: Vec::new(), ..hoo(&lib.target, &lib.equipment) };
    let refused = catalog.update_project(project.id, 3, &without).await.unwrap_err();
    assert_eq!(kind(&refused), "invalid_input");
    assert!(refused.to_string().contains(&east.to_string()), "{refused}");
    assert_eq!(catalog.project(project.id).await.unwrap(), reassigned);

    // Unlinking keeps the Project's rejection decisions.
    let frame = catalog.asset(ha.asset_ids[0]).await.unwrap();
    let rejected = catalog.set_project_rejection(project.id, 3, &[expected(&frame)], true).await;
    let rejected = rejected.unwrap();
    let unlinked = catalog.unlink_sessions(project.id, 4, &[oiii.id]).await.unwrap();
    assert_eq!(unlinked.links.iter().map(|link| link.session_id).collect::<Vec<_>>(), [ha.id]);
    assert_eq!(unlinked.rejections, rejected.rejections);
    let again = catalog.unlink_sessions(project.id, 5, &[oiii.id]).await.unwrap_err();
    assert_eq!(kind(&again), "not_found");

    // A FILTER correction supersedes the Ha session: the link stays, needs review
    // and names the successors; linking the superseded session is refused.
    let corrected = catalog.asset(ha.asset_ids[1]).await.unwrap();
    let correction = CorrectionInput {
        asset_id: corrected.id,
        field: "filter".into(),
        value: serde_json::json!("OIII"),
    };
    let outcome = catalog
        .apply_correction_and_regroup(&[expected(&corrected)], &[correction], group)
        .await
        .unwrap();
    let successors = outcome.lineage.unwrap().successors;
    let review = catalog.project(project.id).await.unwrap();
    assert_eq!(review.revision, 5, "a library correction writes no Project row");
    assert_eq!(
        (review.links[0].state, &review.links[0].successors),
        (LinkState::NeedsReview, &successors)
    );
    let error = catalog.link_sessions(project.id, 5, &[link(ha, None)]).await.unwrap_err();
    let response = error.response(None, None);
    assert_eq!((response.kind.as_str(), response.identity), ("conflict", Some(ha.id)));
    assert_eq!(response.successors, successors);
    assert_eq!(tree(&lib.fx.root), lib.before);
}

#[tokio::test]
async fn rejection_refuses_retired_copies_and_a_withdrawal_appends_the_effective_decision() {
    let lib = indexed().await;
    let catalog = &lib.catalog;
    let project = catalog.create_project(&hoo(&lib.target, &lib.equipment)).await.unwrap();
    let assets = catalog.location_assets(lib.location.id).await.unwrap();
    let frame = by_name(&assets, "Ha_001.fits");

    let rejected = catalog.set_project_rejection(project.id, 1, &[expected(frame)], true).await;
    let rejected = rejected.unwrap();
    let decision = &rejected.rejections[0];
    assert_eq!(
        (decision.asset_id, decision.rejected, decision.project_revision),
        (frame.id, true, 2)
    );
    assert_eq!(decision.fingerprint, frame.fingerprint);
    let mut stale = expected(frame);
    stale.decision_revision += 1;
    let error = catalog.set_project_rejection(project.id, 2, &[stale], true).await.unwrap_err();
    assert_eq!(
        (kind(&error), error.response(None, None).identity),
        ("conflict".into(), Some(frame.id))
    );

    let withdrawn = catalog.set_project_rejection(project.id, 2, &[expected(frame)], false).await;
    let withdrawn = withdrawn.unwrap();
    let decision = &withdrawn.rejections[0];
    assert_eq!(
        (decision.asset_id, decision.rejected, decision.project_revision),
        (frame.id, false, 3)
    );
    let mut conn = raw(&lib.fx.db).await;
    let history: Vec<i64> = sqlx::query_scalar(
        "SELECT rejected FROM project_rejections WHERE project_id = ?1 AND asset_id = ?2 ORDER BY id",
    )
    .bind(project.id.to_string())
    .bind(frame.id.to_string())
    .fetch_all(&mut conn)
    .await
    .unwrap();
    conn.close().await.unwrap();
    assert_eq!(history, [1, 0], "append-only decisions; the latest is effective");
    assert_eq!(&catalog.asset(frame.id).await.unwrap(), frame, "library quality is untouched");

    // The location leaves through a reviewed Retire: its copies take no decision.
    let unplugged = lib.fx.root.with_extension("unplugged");
    std::fs::rename(&lib.fx.root, &unplugged).unwrap();
    let location = catalog
        .mark_location_unavailable(lib.location.id, Availability::Offline, "unplugged")
        .await
        .unwrap();
    let references = LocationReferences {
        assets: assets.iter().map(|asset| asset.id).collect(),
        references: Vec::new(),
        consulted: Vec::new(),
    };
    let review = catalog.review_retire_location(location.id, &references).await.unwrap();
    catalog
        .retire_location(review.id, location.id, review.expected_revision, &references)
        .await
        .unwrap();
    let retired = catalog.asset(frame.id).await.unwrap();
    assert_eq!(retired.availability, Availability::Retired);
    let error = catalog.set_project_rejection(project.id, 3, &[expected(&retired)], true).await;
    assert_eq!(kind(&error.unwrap_err()), "invalid_input");
    assert_eq!(catalog.project(project.id).await.unwrap(), withdrawn);
    assert_eq!(tree(&unplugged), lib.before, "no file changed");
}

#[tokio::test]
async fn project_writes_leave_library_rows_and_source_files_byte_identical() {
    let lib = indexed().await;
    let catalog = &lib.catalog;
    let assets = catalog.location_assets(lib.location.id).await.unwrap();
    let by_filter = sessions(catalog).await;
    // Library decisions of every kind exist before the Project does.
    let decided = by_name(&assets, "Ha_001.fits");
    catalog.set_quality(&[expected(decided)], Quality::Usable, DiskProbe).await.unwrap();
    let (ha, oiii) = (expected_session(&by_filter["Ha"]), expected_session(&by_filter["OIII"]));
    catalog.associate_target(&[ha], lib.target.candidate.id).await.unwrap();
    catalog.confirm_equipment(&[oiii], lib.equipment.id).await.unwrap();
    let labelled = by_name(&assets, "OIII_001.fits");
    let object = CorrectionInput {
        asset_id: labelled.id,
        field: "object".into(),
        value: serde_json::json!("NGC 7000"),
    };
    catalog.apply_correction_and_regroup(&[expected(labelled)], &[object], group).await.unwrap();
    let by_filter = sessions(catalog).await;
    let library = dump(&lib.fx.db, &LIBRARY_TABLES).await;
    let count = |table: &str| library[table].len();
    assert_eq!(
        (count("quality_decisions"), count("associations"), count("corrections")),
        (1, 2, 1)
    );

    let project = catalog.create_project(&hoo(&lib.target, &lib.equipment)).await.unwrap();
    let mut wider = hoo(&lib.target, &lib.equipment);
    wider.panels.push(panel("West"));
    wider.panels[0].id = Some(project.panels[0].id);
    let project = catalog.update_project(project.id, 1, &wider).await.unwrap();
    let project = catalog.set_checklist(project.id, 2, &every_kind(&lib.equipment)).await.unwrap();
    let links =
        [link(&by_filter["Ha"], Some(project.panels[1].id)), link(&by_filter["OIII"], None)];
    let project = catalog.link_sessions(project.id, 3, &links).await.unwrap();
    let decided = catalog.asset(decided.id).await.unwrap();
    let project = catalog.set_project_rejection(project.id, 4, &[expected(&decided)], true).await;
    let project = project.unwrap();
    let project = catalog.set_project_rejection(project.id, 5, &[expected(&decided)], false).await;
    let project = project.unwrap();
    let project = catalog.unlink_sessions(project.id, 6, &[by_filter["OIII"].id]).await.unwrap();
    assert_eq!(project.revision, 7);

    assert_eq!(dump(&lib.fx.db, &LIBRARY_TABLES).await, library, "library rows unchanged");
    assert_eq!(tree(&lib.fx.root), lib.before, "no file changed");
}

#[tokio::test]
async fn close_and_reopen_returns_every_project_record_unchanged() {
    let Indexed { fx, catalog, target, equipment, before, .. } = indexed().await;
    let by_filter = sessions(&catalog).await;
    let mut input = hoo(&target, &equipment);
    input.panels.push(PanelInput { position_angle_deg: Some(90.0), ..panel("West") });
    let project = catalog.create_project(&input).await.unwrap();
    let project = catalog.set_checklist(project.id, 1, &every_kind(&equipment)).await.unwrap();
    let west = project.panels[1].id;
    let links = [link(&by_filter["Ha"], Some(west)), link(&by_filter["OIII"], None)];
    let project = catalog.link_sessions(project.id, 2, &links).await.unwrap();
    let frame = catalog.asset(by_filter["Ha"].asset_ids[0]).await.unwrap();
    catalog.set_project_rejection(project.id, 3, &[expected(&frame)], true).await.unwrap();
    let committed = catalog.project(project.id).await.unwrap();
    let query = ProjectQuery { target_id: None, offset: 0, limit: 10 };
    let listed = catalog.list_projects(&query).await.unwrap();
    assert_eq!((committed.revision, committed.checklist.len(), committed.links.len()), (4, 6, 2));
    catalog.close().await.unwrap();

    let reopened = Catalog::open(&fx.db).await.unwrap();
    let restored: Project = reopened.project(project.id).await.unwrap();
    assert_eq!(restored, committed);
    assert_eq!(reopened.list_projects(&query).await.unwrap(), listed);

    // Item ids survive an edit: kept items keep theirs in the new order, omitted ones go.
    let reordered: Vec<ChecklistItemInput> = [3, 0]
        .into_iter()
        .map(|index| ChecklistItemInput {
            id: Some(restored.checklist[index].id),
            criterion: restored.checklist[index].criterion.clone(),
        })
        .collect();
    let edited = reopened.set_checklist(project.id, 4, &reordered).await.unwrap();
    let ids: Vec<Uuid> = edited.checklist.iter().map(|item| item.id).collect();
    assert_eq!(ids, [restored.checklist[3].id, restored.checklist[0].id]);
    let foreign = ChecklistItemInput { id: Some(Uuid::new_v4()), ..reordered[0].clone() };
    let error = reopened.set_checklist(project.id, 5, &[foreign]).await.unwrap_err();
    assert_eq!(kind(&error), "not_found");
    assert_eq!(tree(&fx.root), before);
}

#[tokio::test]
async fn a_catalog_recorded_at_schema_version_6_is_refused_before_any_ddl() {
    let fx = Fixture::new();
    Catalog::open(&fx.db).await.unwrap().close().await.unwrap();
    // The version 6 shape: every library table and no Project table.
    let mut conn = raw(&fx.db).await;
    let drops = PROJECT_TABLES.map(|table| format!("DROP TABLE {table};")).join(" ");
    sqlx::raw_sql(sqlx::AssertSqlSafe(format!(
        "{drops} UPDATE catalog_meta SET value = 6 WHERE key = 'schema_version';"
    )))
    .execute(&mut conn)
    .await
    .unwrap();
    conn.close().await.unwrap();

    let error = Catalog::open(&fx.db).await.err().expect("a version 6 catalog is refused");
    assert_eq!(kind(&error), "invalid_input");
    assert_eq!(error.to_string(), "invalid input: unsupported catalog schema version 6");
    let mut conn = raw(&fx.db).await;
    let tables: Vec<String> = sqlx::query_scalar(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'project%'",
    )
    .fetch_all(&mut conn)
    .await
    .unwrap();
    conn.close().await.unwrap();
    assert!(tables.is_empty(), "no DDL of this version ran: {tables:?}");
}
