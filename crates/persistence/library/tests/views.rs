// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! View records in the clean catalog (spec 066): creation from each origin,
//! draft edits checked against the draft revision, explicit Save into immutable
//! revisions, D16 members with their D02 starting state, and refusals that
//! write nothing. Library rows and fixture files are never changed.
#![cfg(unix)]

mod support;

use std::collections::{BTreeMap, BTreeSet};

use persistence_library::{Catalog, LocationReferences, LocationRegistration, SessionQuery};
use platevault_model::{
    ApplicableQuality, AssessedMembers, Asset, AssetReference, AssociationState, Availability,
    CorrectionInput, CriteriaInput, DraftEdit, Equipment, GeometryClass, GeometryEvidence,
    LibraryError, LocationRole, MemberReason, MemberState, Membership, NativePath, NewView,
    Project, ProjectInput, Provenance, Quality, ReferenceKind, RefreshItem, RefreshItemKind,
    RefreshReview, RefreshState, Revision, SelectionReason, Session, SessionChoice,
    SessionChoiceState, SuggestedChoice, TargetFraming, TargetRecord, ViewMember, ViewOriginInput,
    ViewRecord,
};
use sqlx::Connection;
use support::*;
use uuid::Uuid;

fn json<T: serde::Serialize>(value: &T) -> serde_json::Value {
    serde_json::to_value(value).unwrap()
}

const FRAMES: [&str; 5] = [
    "night1/Ha_001.fits",
    "night1/Ha_002.fits",
    "night1/Ha_003.fits",
    "night1/OIII_001.fits",
    "night1/OIII_002.fits",
];

/// Library rows no View write may touch.
const LIBRARY_TABLES: [&str; 8] = [
    "assets",
    "quality_decisions",
    "sessions",
    "session_members",
    "associations",
    "corrections",
    "targets",
    "projects",
];

/// View tables, children first.
const VIEW_TABLES: [&str; 6] = [
    "view_member_copies",
    "view_members",
    "view_session_choices",
    "view_revisions",
    "view_refresh_reviews",
    "views",
];

struct Indexed {
    fx: Fixture,
    catalog: Catalog,
    location: platevault_model::Location,
    target: TargetRecord,
    equipment: Equipment,
    before: BTreeMap<std::path::PathBuf, (u64, String)>,
}

/// Five real frames indexed into one location (an Ha and an OIII session), a
/// saved NGC 7000 Target and saved equipment.
async fn indexed() -> Indexed {
    indexed_with(&[]).await
}

/// [`indexed`] with `extra` frames in the same location.
async fn indexed_with(extra: &[&str]) -> Indexed {
    let fx = Fixture::new();
    let names: Vec<&str> = FRAMES.iter().chain(extra).copied().collect();
    for name in &names {
        fx.write(name, name.as_bytes());
    }
    let before = tree(&fx.root);
    let catalog = Catalog::open(&fx.db).await.unwrap();
    let location = catalog.register_location(&fx.registration()).await.unwrap();
    scan(&catalog, &fx, &location, &names).await;
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

async fn hoo(lib: &Indexed) -> Project {
    let input = ProjectInput {
        name: "NGC 7000 HOO".into(),
        notes: None,
        targets: vec![TargetFraming {
            target_id: lib.target.candidate.id,
            expected_revision: lib.target.decision_revision,
        }],
        panels: Vec::new(),
        equipment_ids: vec![lib.equipment.id],
    };
    lib.catalog.create_project(&input).await.unwrap()
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

fn origin_sessions(sessions: &[&Session]) -> NewView {
    NewView {
        origin: ViewOriginInput::Sessions {
            sessions: sessions.iter().map(|session| expected_session(session)).collect(),
        },
        name: Some("NGC7000 HOO - Siril".into()),
        criteria: CriteriaInput::default(),
        framing_revision: None,
        suggestions: Vec::new(),
    }
}

fn geometry() -> GeometryEvidence {
    GeometryEvidence {
        class: GeometryClass::Footprint,
        unknown: Vec::new(),
        light_frames: 3,
        frames_with_pointing: 3,
        frames_without_pointing: 0,
        mean_pointing: None,
        distance_deg: Some(0.1),
        nearest: None,
        pointing_spread_deg: Some(0.05),
        fov: None,
        footprint: None,
        matched: None,
        coverage: None,
        within_radius: false,
    }
}

fn assessed(assets: &[Asset]) -> AssessedMembers {
    AssessedMembers {
        observations: assets.iter().map(|a| (a.id, a.fingerprint.clone())).collect(),
        decisions: assets.iter().map(|a| (a.id, a.decision_revision)).collect(),
        observation_revisions: assets.iter().map(|a| (a.id, a.observation_revision)).collect(),
    }
}

async fn suggestion(catalog: &Catalog, session: &Session) -> SuggestedChoice {
    let detail = catalog.session(session.id).await.unwrap();
    SuggestedChoice {
        session: expected_session(session),
        reason: SelectionReason::GeometrySuggestion,
        evidence: geometry(),
        assessed: assessed(&detail.assets),
    }
}

async fn project_view(
    catalog: &Catalog,
    project: &Project,
    suggestions: Vec<SuggestedChoice>,
) -> ViewRecord {
    let input = NewView {
        origin: ViewOriginInput::Project { project_id: project.id },
        name: None,
        criteria: CriteriaInput::default(),
        framing_revision: Some(project.revision),
        suggestions,
    };
    catalog.create_view(&input).await.unwrap()
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

/// The stored choices and members of a View's draft, or of committed `revision`.
async fn stored(
    db: &std::path::Path,
    view: Uuid,
    revision: Option<Revision>,
) -> (Vec<SessionChoice>, Vec<ViewMember>) {
    let mut conn = raw(db).await;
    let row: i64 = sqlx::query_scalar(
        "SELECT id FROM view_revisions WHERE view_id = ?1 AND \
         (CASE WHEN ?2 IS NULL THEN state = 'draft' ELSE revision = ?2 END)",
    )
    .bind(view.to_string())
    .bind(revision.map(|revision| i64::try_from(revision).unwrap()))
    .fetch_one(&mut conn)
    .await
    .unwrap();
    let choices: Vec<String> = sqlx::query_scalar(
        "SELECT json_object('sessionId', session_id, 'groupingRevision', grouping_revision, \
         'state', state, 'reason', json(reason), 'evidence', json(evidence)) \
         FROM view_session_choices WHERE revision_row = ?1 ORDER BY session_id",
    )
    .bind(row)
    .fetch_all(&mut conn)
    .await
    .unwrap();
    let members: Vec<String> = sqlx::query_scalar(
        "SELECT json_object('memberKey', m.member_key, 'sessionId', m.session_id, 'state', m.state, \
         'reason', json(m.reason), 'qualityWhenChosen', json(m.quality_when_chosen), \
         'addedInRevision', m.added_in_revision, 'copies', json((SELECT json_group_array( \
         json_object('assetId', c.asset_id, 'decisionRevision', c.decision_revision, \
         'fingerprint', json(c.fingerprint))) FROM (SELECT * FROM view_member_copies c \
         WHERE c.revision_row = m.revision_row AND c.member_key = m.member_key \
         ORDER BY c.asset_id) c))) FROM view_members m WHERE m.revision_row = ?1 \
         ORDER BY m.member_key",
    )
    .bind(row)
    .fetch_all(&mut conn)
    .await
    .unwrap();
    conn.close().await.unwrap();
    (
        choices.iter().map(|text| serde_json::from_str(text).unwrap()).collect(),
        members.iter().map(|text| serde_json::from_str(text).unwrap()).collect(),
    )
}

/// Committed View rows and the rows they own, quoted by SQLite.
async fn committed_rows(db: &std::path::Path) -> Vec<Vec<String>> {
    let owned = "WHERE revision_row IN (SELECT id FROM view_revisions WHERE state = 'committed')";
    vec![
        dump_where(db, "view_revisions", "WHERE state = 'committed'").await,
        dump_where(db, "view_session_choices", owned).await,
        dump_where(db, "view_members", owned).await,
        dump_where(db, "view_member_copies", owned).await,
    ]
}

fn selected(choices: &[SessionChoice]) -> Vec<Uuid> {
    choices
        .iter()
        .filter(|choice| choice.state == SessionChoiceState::Selected)
        .map(|choice| choice.session_id)
        .collect()
}

fn sorted(mut ids: Vec<Uuid>) -> Vec<Uuid> {
    ids.sort_unstable();
    ids
}

#[tokio::test]
async fn create_holds_exactly_its_origin_sessions_and_refuses_stale_or_unknown_origins() {
    let lib = indexed().await;
    let catalog = &lib.catalog;
    let by_filter = sessions(catalog).await;
    let (ha, oiii) = (&by_filter["Ha"], &by_filter["OIII"]);

    let record = catalog.create_view(&origin_sessions(&[ha, oiii])).await.unwrap();
    assert_eq!(record.view.revision, 0);
    assert!(record.revision.is_none());
    let draft = record.draft.as_ref().expect("unsaved work");
    assert_eq!((draft.draft_revision, draft.base_revision, draft.stale), (1, 0, false));
    assert_eq!(draft.project_id, None, "a Sessions origin creates no Project");
    let (choices, members) = stored(&lib.fx.db, record.view.id, None).await;
    assert_eq!(selected(&choices), sorted(vec![ha.id, oiii.id]));
    assert!(choices.iter().all(|choice| choice.reason == SelectionReason::OriginSessions));
    assert_eq!(members.len(), FRAMES.len());
    assert_eq!(catalog.view(record.view.id).await.unwrap(), record);

    // Stale or unknown origins write nothing.
    let views = dump_tables(&lib.fx.db, &VIEW_TABLES).await;
    let mut stale = origin_sessions(&[ha]);
    let ViewOriginInput::Sessions { sessions: chosen } = &mut stale.origin else { unreachable!() };
    chosen[0].grouping_revision += 1;
    let error = catalog.create_view(&stale).await.unwrap_err();
    assert_eq!(
        (kind(&error), error.response(None, None).identity),
        ("conflict".into(), Some(ha.id))
    );
    let unknown_project = NewView {
        origin: ViewOriginInput::Project { project_id: Uuid::new_v4() },
        ..origin_sessions(&[])
    };
    assert_eq!(kind(&catalog.create_view(&unknown_project).await.unwrap_err()), "not_found");
    let unknown_target = NewView {
        origin: ViewOriginInput::Target { target_id: Uuid::new_v4(), expected_revision: 1 },
        ..origin_sessions(&[])
    };
    assert_eq!(kind(&catalog.create_view(&unknown_target).await.unwrap_err()), "not_found");
    let stale_target = NewView {
        origin: ViewOriginInput::Target {
            target_id: lib.target.candidate.id,
            expected_revision: lib.target.decision_revision + 1,
        },
        ..origin_sessions(&[])
    };
    let error = catalog.create_view(&stale_target).await.unwrap_err();
    conflict_at(&error, lib.target.candidate.id, lib.target.decision_revision);
    assert_eq!(dump_tables(&lib.fx.db, &VIEW_TABLES).await, views);

    // A Target origin snapshots the saved Target and selects nothing.
    let target_view = NewView {
        origin: ViewOriginInput::Target {
            target_id: lib.target.candidate.id,
            expected_revision: lib.target.decision_revision,
        },
        ..origin_sessions(&[])
    };
    let record = catalog.create_view(&target_view).await.unwrap();
    assert_eq!(record.view.origin_target_id, Some(lib.target.candidate.id));
    let criteria = &record.draft.as_ref().unwrap().criteria;
    assert_eq!(criteria.framing.targets[0].target_id, lib.target.candidate.id);
    assert_eq!(criteria.framing.targets[0].revision, lib.target.decision_revision);
    assert!(stored(&lib.fx.db, record.view.id, None).await.0.is_empty());
    assert!(dump_where(&lib.fx.db, "projects", "").await.is_empty(), "no Project row");

    // A superseded session is Conflict naming its successors.
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
    let error = catalog.create_view(&origin_sessions(&[ha])).await.unwrap_err();
    let response = error.response(None, None);
    assert_eq!((response.kind.as_str(), response.identity), ("conflict", Some(ha.id)));
    assert_eq!(response.successors, successors);
    assert_eq!(tree(&lib.fx.root), lib.before);
}

#[tokio::test]
async fn a_selected_session_stores_each_logical_capture_once_with_its_d02_state() {
    let lib = indexed().await;
    let catalog = &lib.catalog;
    // Cold-1 holds a byte-identical copy of Ha_001 and an Ha_004 only it has.
    let cold = lib.fx.temp.path().join("Cold-1");
    std::fs::create_dir_all(cold.join("night1")).unwrap();
    std::fs::copy(lib.fx.root.join(FRAMES[0]), cold.join(FRAMES[0])).unwrap();
    std::fs::write(cold.join("night1/Ha_004.fits"), b"night1/Ha_004.fits").unwrap();
    let cold_location = catalog
        .register_location(&LocationRegistration {
            name: "Cold-1/Captures".into(),
            path: NativePath::from_path(&cold),
            role: LocationRole::Captures,
            identity: folder_identity(&cold).unwrap(),
        })
        .await
        .unwrap();
    let cold_fx =
        Fixture { temp: tempfile::tempdir().unwrap(), db: lib.fx.db.clone(), root: cold.clone() };
    scan(catalog, &cold_fx, &cold_location, &[FRAMES[0], "night1/Ha_004.fits"]).await;
    let cold_before = tree(&cold);
    let mut copies: Vec<Asset> = Vec::new();
    for location in [lib.location.id, cold_location.id] {
        let assets = catalog.location_assets(location).await.unwrap();
        copies.push(by_name(&assets, "Ha_001.fits").clone());
    }
    for copy in &copies {
        catalog.verify_digest(copy.id, DiskProbe).await.unwrap();
    }
    let assets = catalog.location_assets(lib.location.id).await.unwrap();
    let unusable = by_name(&assets, "Ha_002.fits").clone();
    catalog.set_quality(&[expected(&unusable)], Quality::Unusable, DiskProbe).await.unwrap();
    let only_cold =
        by_name(&catalog.location_assets(cold_location.id).await.unwrap(), "Ha_004.fits").clone();
    std::fs::rename(&cold, cold.with_extension("unplugged")).unwrap();
    catalog
        .mark_location_unavailable(cold_location.id, Availability::Offline, "unplugged")
        .await
        .unwrap();

    let ha = sessions(catalog).await["Ha"].clone();
    let record = catalog.create_view(&origin_sessions(&[&ha])).await.unwrap();
    let (_, members) = stored(&lib.fx.db, record.view.id, None).await;
    assert_eq!(members.len(), 4, "the Ha_001 copy pair is one member: {members:?}");
    let member = |asset: Uuid| {
        members
            .iter()
            .find(|member| member.copies.iter().any(|copy| copy.asset_id == asset))
            .unwrap_or_else(|| panic!("member of {asset}"))
    };
    let pair = member(copies[0].id);
    let mut pair_ids = vec![copies[0].id, copies[1].id];
    pair_ids.sort_unstable();
    assert_eq!(pair.copies.iter().map(|copy| copy.asset_id).collect::<Vec<_>>(), pair_ids);
    assert_eq!(pair.member_key, pair_ids[0], "the key is the smallest copy id");
    for copy in &pair.copies {
        let current = catalog.asset(copy.asset_id).await.unwrap();
        assert_eq!(copy.decision_revision, current.decision_revision);
        assert_eq!(copy.fingerprint, current.fingerprint);
    }
    assert_eq!((pair.state, &pair.reason), (MemberState::Included, &MemberReason::Initial));
    let excluded = member(unusable.id);
    assert_eq!(
        (excluded.state, &excluded.reason),
        (MemberState::Excluded, &MemberReason::LibraryUnusable)
    );
    assert_eq!(excluded.quality_when_chosen, ApplicableQuality::Unusable);
    let offline = member(only_cold.id);
    assert_eq!(offline.state, MemberState::Included, "an Offline-only capture stays a member");
    assert!(members.iter().all(|member| member.added_in_revision.is_none()));

    // A later library decision changes no stored member.
    let rows = dump_tables(&lib.fx.db, &VIEW_TABLES).await;
    let usable = by_name(&assets, "Ha_003.fits").clone();
    catalog.set_quality(&[expected(&usable)], Quality::Usable, DiskProbe).await.unwrap();
    assert_eq!(dump_tables(&lib.fx.db, &VIEW_TABLES).await, rows);
    assert_eq!(tree(&lib.fx.root), lib.before);
    assert_eq!(tree(&cold.with_extension("unplugged")), cold_before);
}

#[tokio::test]
async fn a_criteria_choice_needs_its_assessed_members_and_project_revision_unchanged() {
    let lib = indexed().await;
    let catalog = &lib.catalog;
    let by_filter = sessions(catalog).await;
    let project = hoo(&lib).await;
    let views = dump_tables(&lib.fx.db, &VIEW_TABLES).await;

    let mut changed = suggestion(catalog, &by_filter["Ha"]).await;
    let first = *changed.assessed.decisions.keys().next().unwrap();
    *changed.assessed.decisions.get_mut(&first).unwrap() += 1;
    let input = NewView {
        origin: ViewOriginInput::Project { project_id: project.id },
        name: None,
        criteria: CriteriaInput::default(),
        framing_revision: Some(project.revision),
        suggestions: vec![changed],
    };
    let error = catalog.create_view(&input).await.unwrap_err();
    assert_eq!(
        (kind(&error), error.response(None, None).identity),
        ("conflict".into(), Some(by_filter["Ha"].id))
    );
    let mut observed = suggestion(catalog, &by_filter["Ha"]).await;
    observed.assessed.observation_revisions.insert(first, 99);
    let error =
        catalog.create_view(&NewView { suggestions: vec![observed], ..input.clone() }).await;
    assert_eq!(kind(&error.unwrap_err()), "conflict");
    let stale = NewView {
        framing_revision: Some(project.revision + 1),
        suggestions: vec![suggestion(catalog, &by_filter["Ha"]).await],
        ..input.clone()
    };
    conflict_at(&catalog.create_view(&stale).await.unwrap_err(), project.id, project.revision);
    assert_eq!(dump_tables(&lib.fx.db, &VIEW_TABLES).await, views, "nothing written");

    let record =
        project_view(catalog, &project, vec![suggestion(catalog, &by_filter["Ha"]).await]).await;
    let draft = record.draft.unwrap();
    assert_eq!(draft.project_id, Some(project.id));
    assert_eq!(draft.criteria.equipment_ids, vec![lib.equipment.id]);
    assert_eq!(draft.criteria.framing.project_revision, Some(project.revision));
    let (choices, _) = stored(&lib.fx.db, record.view.id, None).await;
    assert_eq!(choices.len(), 1);
    assert_eq!(choices[0].reason, SelectionReason::GeometrySuggestion);
    assert_eq!(choices[0].evidence, Some(geometry()), "the qualifying evidence is recorded");
    assert_eq!(catalog.project(project.id).await.unwrap(), project, "no Project revision");
}

#[tokio::test]
async fn draft_edits_check_the_draft_revision_and_add_exactly_one() {
    let lib = indexed().await;
    let catalog = &lib.catalog;
    let by_filter = sessions(catalog).await;
    let id = catalog.create_view(&origin_sessions(&[&by_filter["Ha"]])).await.unwrap().view.id;
    let details = |name: &str| DraftEdit::Details {
        name: name.into(),
        project_id: None,
        criteria: CriteriaInput { min_footprint_coverage: 0.9, suggestion_radius_deg: 1.0 },
    };

    conflict_at(&catalog.edit_view_draft(id, 2, &details("x")).await.unwrap_err(), id, 1);
    let edited = catalog.edit_view_draft(id, 1, &details("Siril")).await.unwrap();
    let draft = edited.draft.as_ref().unwrap();
    assert_eq!((draft.draft_revision, draft.name.as_str()), (2, "Siril"));
    assert_eq!(
        draft.criteria.input(),
        CriteriaInput { min_footprint_coverage: 0.9, suggestion_radius_deg: 1.0 }
    );
    assert!(draft.criteria.framing.targets.is_empty(), "criteria settings select nothing");
    let invalid = DraftEdit::Details {
        name: "x".into(),
        project_id: None,
        criteria: CriteriaInput { min_footprint_coverage: 0.0, suggestion_radius_deg: 1.0 },
    };
    assert_eq!(kind(&catalog.edit_view_draft(id, 2, &invalid).await.unwrap_err()), "invalid_input");
    let unknown = DraftEdit::Details {
        name: "x".into(),
        project_id: Some(Uuid::new_v4()),
        criteria: CriteriaInput::default(),
    };
    assert_eq!(kind(&catalog.edit_view_draft(id, 2, &unknown).await.unwrap_err()), "not_found");

    let saved = catalog.save_view(id, 0, 2).await.unwrap();
    assert_eq!((saved.view.revision, saved.draft.is_none()), (1, true));
    let committed = stored(&lib.fx.db, id, Some(1)).await;
    conflict_at(&catalog.edit_view_draft(id, 1, &details("y")).await.unwrap_err(), id, 0);
    let copied = catalog.edit_view_draft(id, 0, &details("Siril")).await.unwrap();
    let draft = copied.draft.as_ref().unwrap();
    assert_eq!((draft.draft_revision, draft.base_revision, draft.stale), (1, 1, false));
    let (choices, members) = stored(&lib.fx.db, id, None).await;
    assert_eq!(
        serde_json::to_value(&choices).unwrap(),
        serde_json::to_value(&committed.0).unwrap()
    );
    assert_eq!(
        serde_json::to_value(&members).unwrap(),
        serde_json::to_value(&committed.1).unwrap()
    );
    let oiii = DraftEdit::SelectSessions { sessions: vec![expected_session(&by_filter["OIII"])] };
    let next = catalog.edit_view_draft(id, 1, &oiii).await.unwrap();
    assert_eq!(next.draft.unwrap().draft_revision, 2);
    assert_eq!(catalog.view(id).await.unwrap().revision, saved.revision, "the revision stands");
}

#[tokio::test]
async fn frames_exclude_restore_and_include_while_deselection_keeps_criteria_exclusions() {
    let lib = indexed().await;
    let catalog = &lib.catalog;
    let by_filter = sessions(catalog).await;
    let (ha, oiii) = (&by_filter["Ha"], &by_filter["OIII"]);
    let assets = catalog.location_assets(lib.location.id).await.unwrap();
    let unusable = by_name(&assets, "Ha_002.fits").clone();
    catalog.set_quality(&[expected(&unusable)], Quality::Unusable, DiskProbe).await.unwrap();
    let project = hoo(&lib).await;
    let record = project_view(catalog, &project, vec![suggestion(catalog, ha).await]).await;
    let id = record.view.id;
    let other = catalog.create_view(&origin_sessions(&[ha, oiii])).await.unwrap().view.id;
    let other_rows = stored(&lib.fx.db, other, None).await;
    let frame = by_name(&assets, "Ha_003.fits").id;
    let set = |keys: Vec<Uuid>, state| DraftEdit::SetFrames { member_keys: keys, state };

    catalog.edit_view_draft(id, 1, &set(vec![frame], MemberState::Excluded)).await.unwrap();
    let state = |members: &[ViewMember], key: Uuid| {
        let member = members.iter().find(|member| member.member_key == key).unwrap();
        (member.state, member.reason.clone())
    };
    let (_, members) = stored(&lib.fx.db, id, None).await;
    assert_eq!(state(&members, frame), (MemberState::Excluded, MemberReason::ViewExclusion));
    catalog.edit_view_draft(id, 2, &set(vec![frame], MemberState::Included)).await.unwrap();
    catalog.edit_view_draft(id, 3, &set(vec![unusable.id], MemberState::Included)).await.unwrap();
    let (_, members) = stored(&lib.fx.db, id, None).await;
    assert_eq!(state(&members, frame), (MemberState::Included, MemberReason::Restored));
    assert_eq!(
        state(&members, unusable.id),
        (MemberState::Included, MemberReason::ExplicitInclusion)
    );
    let foreign = by_name(&assets, "OIII_001.fits").id;
    let error = catalog.edit_view_draft(id, 4, &set(vec![foreign], MemberState::Excluded)).await;
    assert_eq!(kind(&error.unwrap_err()), "invalid_input");
    assert_eq!(
        catalog.asset(unusable.id).await.unwrap().quality,
        Quality::Unusable,
        "library unchanged"
    );

    // A manual choice is removed; a criteria-based choice becomes an exclusion.
    let manual = DraftEdit::SelectSessions { sessions: vec![expected_session(oiii)] };
    catalog.edit_view_draft(id, 4, &manual).await.unwrap();
    let deselect = |ids: Vec<Uuid>| DraftEdit::DeselectSessions { session_ids: ids };
    catalog.edit_view_draft(id, 5, &deselect(vec![oiii.id, ha.id])).await.unwrap();
    let (choices, members) = stored(&lib.fx.db, id, None).await;
    assert_eq!(choices.len(), 1);
    assert_eq!((choices[0].session_id, choices[0].state), (ha.id, SessionChoiceState::Excluded));
    assert_eq!(choices[0].reason, SelectionReason::GeometrySuggestion, "names what it declined");
    assert!(members.is_empty());
    let error = catalog.edit_view_draft(id, 6, &deselect(vec![ha.id])).await.unwrap_err();
    assert_eq!(kind(&error), "invalid_input", "an excluded session is not selected");

    // Clear selection leaves no selected session and leaves other Views alone.
    catalog.edit_view_draft(id, 6, &manual).await.unwrap();
    let cleared = catalog.edit_view_draft(id, 7, &DraftEdit::ClearSelection).await.unwrap();
    assert_eq!(cleared.draft.unwrap().draft_revision, 8);
    let (choices, members) = stored(&lib.fx.db, id, None).await;
    assert!(selected(&choices).is_empty() && members.is_empty());
    assert_eq!(choices.len(), 1, "the criteria exclusion stays");
    let after = stored(&lib.fx.db, other, None).await;
    assert_eq!(
        serde_json::to_value(&after.1).unwrap(),
        serde_json::to_value(&other_rows.1).unwrap()
    );
    assert_eq!(after.0, other_rows.0);
    assert_eq!(tree(&lib.fx.root), lib.before);
}

#[tokio::test]
async fn save_commits_the_next_revision_and_discarding_an_unsaved_view_removes_it() {
    let lib = indexed().await;
    let catalog = &lib.catalog;
    let by_filter = sessions(catalog).await;
    let blank = NewView { name: Some("   ".into()), ..origin_sessions(&[&by_filter["Ha"]]) };
    let id = catalog.create_view(&blank).await.unwrap().view.id;
    let error = catalog.save_view(id, 0, 1).await.unwrap_err();
    assert_eq!(kind(&error), "invalid_input");
    assert!(error.to_string().contains("name"), "{error}");
    let named = DraftEdit::Details {
        name: "  Siril  ".into(),
        project_id: None,
        criteria: CriteriaInput::default(),
    };
    catalog.edit_view_draft(id, 1, &named).await.unwrap();
    conflict_at(&catalog.save_view(id, 0, 1).await.unwrap_err(), id, 2);
    let saved = catalog.save_view(id, 0, 2).await.unwrap();
    let revision = saved.revision.as_ref().unwrap();
    assert_eq!((revision.revision, revision.based_on, revision.name.as_str()), (1, 0, "Siril"));
    let (_, members) = stored(&lib.fx.db, id, Some(1)).await;
    assert!(members.iter().all(|member| member.added_in_revision == Some(1)));

    // A stale expected revision or a stale draft base is Conflict at the committed revision.
    catalog.edit_view_draft(id, 0, &named).await.unwrap();
    conflict_at(&catalog.save_view(id, 0, 1).await.unwrap_err(), id, 1);
    let mut conn = raw(&lib.fx.db).await;
    sqlx::query("UPDATE view_revisions SET base_revision = 0 WHERE state = 'draft'")
        .execute(&mut conn)
        .await
        .unwrap();
    conn.close().await.unwrap();
    assert!(catalog.view(id).await.unwrap().draft.unwrap().stale);
    conflict_at(&catalog.save_view(id, 1, 1).await.unwrap_err(), id, 1);
    let kept = catalog.discard_view_draft(id, 1).await.unwrap().expect("a saved View stays");
    assert_eq!((kept.view.revision, kept.draft.is_none()), (1, true));

    // Discarding the draft of a never-saved View removes the View.
    let unsaved =
        catalog.create_view(&origin_sessions(&[&by_filter["OIII"]])).await.unwrap().view.id;
    conflict_at(&catalog.discard_view_draft(unsaved, 2).await.unwrap_err(), unsaved, 1);
    assert!(catalog.discard_view_draft(unsaved, 1).await.unwrap().is_none());
    assert_eq!(kind(&catalog.view(unsaved).await.unwrap_err()), "not_found");
    let left = dump_where(&lib.fx.db, "views", "").await;
    assert_eq!(left.len(), 1, "only the saved View remains: {left:?}");
}

#[tokio::test]
async fn committed_rows_are_immutable_and_byte_identical_after_later_writes() {
    let lib = indexed().await;
    let catalog = &lib.catalog;
    let by_filter = sessions(catalog).await;
    let project = hoo(&lib).await;
    let record =
        project_view(catalog, &project, vec![suggestion(catalog, &by_filter["Ha"]).await]).await;
    let id = record.view.id;
    let named = DraftEdit::Details {
        name: "Siril".into(),
        project_id: Some(project.id),
        criteria: CriteriaInput::default(),
    };
    catalog.edit_view_draft(id, 1, &named).await.unwrap();
    catalog.save_view(id, 0, 2).await.unwrap();
    let rows = committed_rows(&lib.fx.db).await;
    assert!(rows.iter().all(|table| !table.is_empty()), "{rows:?}");

    let mut conn = raw(&lib.fx.db).await;
    for statement in [
        "UPDATE view_revisions SET name = 'x' WHERE state = 'committed'",
        "DELETE FROM view_revisions WHERE state = 'committed'",
        "UPDATE view_session_choices SET state = 'excluded'",
        "DELETE FROM view_session_choices",
        "UPDATE view_members SET state = 'excluded'",
        "DELETE FROM view_members",
        "UPDATE view_member_copies SET decision_revision = 99",
        "DELETE FROM view_member_copies",
        "INSERT INTO view_session_choices SELECT revision_row, session_id, grouping_revision, \
         'excluded', reason, evidence FROM view_session_choices LIMIT 1",
    ] {
        let error = sqlx::query(statement).execute(&mut conn).await.unwrap_err();
        assert!(error.to_string().contains("immutable"), "{statement}: {error}");
    }
    conn.close().await.unwrap();

    let manual = DraftEdit::SelectSessions { sessions: vec![expected_session(&by_filter["OIII"])] };
    catalog.edit_view_draft(id, 0, &manual).await.unwrap();
    catalog.edit_view_draft(id, 1, &DraftEdit::ClearSelection).await.unwrap();
    catalog.save_view(id, 1, 2).await.unwrap();
    let update = ProjectInput {
        name: "NGC 7000 bicolor".into(),
        notes: None,
        targets: Vec::new(),
        panels: Vec::new(),
        equipment_ids: Vec::new(),
    };
    let update = ProjectInput {
        targets: vec![TargetFraming {
            target_id: lib.target.candidate.id,
            expected_revision: lib.target.decision_revision,
        }],
        ..update
    };
    catalog.update_project(project.id, project.revision, &update).await.unwrap();
    let after = committed_rows(&lib.fx.db).await;
    for (before, after) in rows.iter().zip(&after) {
        assert!(after.starts_with(before), "revision 1 rows unchanged: {before:?} vs {after:?}");
    }
    assert_eq!(catalog.view_revision(id, 1).await.unwrap().header.revision, 1);
}

#[tokio::test]
async fn view_writes_leave_library_rows_and_source_files_byte_identical() {
    let lib = indexed().await;
    let catalog = &lib.catalog;
    let by_filter = sessions(catalog).await;
    let (ha, oiii) = (&by_filter["Ha"], &by_filter["OIII"]);
    let project = hoo(&lib).await;
    let library = dump_tables(&lib.fx.db, &LIBRARY_TABLES).await;

    let record = project_view(catalog, &project, vec![suggestion(catalog, ha).await]).await;
    let id = record.view.id;
    let frame = catalog.location_assets(lib.location.id).await.unwrap();
    let frame = by_name(&frame, "Ha_001.fits").id;
    let edits = [
        DraftEdit::SelectSessions { sessions: vec![expected_session(oiii)] },
        DraftEdit::SetFrames { member_keys: vec![frame], state: MemberState::Excluded },
        DraftEdit::SetFrames { member_keys: vec![frame], state: MemberState::Included },
        DraftEdit::DeselectSessions { session_ids: vec![oiii.id] },
        DraftEdit::Details {
            name: "Siril".into(),
            project_id: Some(project.id),
            criteria: CriteriaInput::default(),
        },
    ];
    for (revision, edit) in (1..).zip(&edits) {
        catalog.edit_view_draft(id, revision, edit).await.unwrap();
    }
    catalog.save_view(id, 0, 6).await.unwrap();
    catalog.edit_view_draft(id, 0, &DraftEdit::ClearSelection).await.unwrap();
    catalog.discard_view_draft(id, 1).await.unwrap();
    let other = catalog.create_view(&origin_sessions(&[ha, oiii])).await.unwrap();
    catalog.discard_view_draft(other.view.id, 1).await.unwrap();

    assert_eq!(dump_tables(&lib.fx.db, &LIBRARY_TABLES).await, library, "library rows unchanged");
    assert_eq!(tree(&lib.fx.root), lib.before, "no file changed");
}

#[tokio::test]
async fn close_and_reopen_returns_committed_revisions_and_the_draft_separately() {
    let Indexed { fx, catalog, before, .. } = indexed().await;
    let by_filter = sessions(&catalog).await;
    let id = catalog.create_view(&origin_sessions(&[&by_filter["Ha"]])).await.unwrap().view.id;
    catalog.save_view(id, 0, 1).await.unwrap();
    let manual = DraftEdit::SelectSessions { sessions: vec![expected_session(&by_filter["OIII"])] };
    catalog.edit_view_draft(id, 0, &manual).await.unwrap();
    let record = catalog.view(id).await.unwrap();
    let revision = serde_json::to_value(catalog.view_revision(id, 1).await.unwrap()).unwrap();
    let draft = stored(&fx.db, id, None).await;
    let listed = catalog.list_views(&platevault_model::ViewQuery::default()).await.unwrap();
    assert_eq!(listed.len(), 1);
    assert!(listed[0].has_draft && !listed[0].draft_stale);
    catalog.close().await.unwrap();

    let reopened = Catalog::open(&fx.db).await.unwrap();
    let restored = reopened.view(id).await.unwrap();
    assert_eq!(restored, record);
    assert_eq!(
        restored.draft.as_ref().map(|draft| (draft.base_revision, draft.stale)),
        Some((1, false))
    );
    assert_eq!(
        serde_json::to_value(reopened.view_revision(id, 1).await.unwrap()).unwrap(),
        revision
    );
    let again = stored(&fx.db, id, None).await;
    assert_eq!(serde_json::to_value(&again).unwrap(), serde_json::to_value(&draft).unwrap());
    assert_eq!(reopened.list_views(&platevault_model::ViewQuery::default()).await.unwrap(), listed);
    assert_eq!(tree(&fx.root), before);
}

#[tokio::test]
async fn a_catalog_recorded_at_schema_version_7_is_refused_before_any_ddl() {
    let fx = Fixture::new();
    Catalog::open(&fx.db).await.unwrap().close().await.unwrap();
    // The version 7 shape: every library and Project table and no View table.
    let mut conn = raw(&fx.db).await;
    let drops = VIEW_TABLES.map(|table| format!("DROP TABLE {table};")).join(" ");
    sqlx::raw_sql(sqlx::AssertSqlSafe(format!(
        "{drops} UPDATE catalog_meta SET value = 7 WHERE key = 'schema_version';"
    )))
    .execute(&mut conn)
    .await
    .unwrap();
    conn.close().await.unwrap();

    let error = Catalog::open(&fx.db).await.err().expect("a version 7 catalog is refused");
    assert_eq!(kind(&error), "invalid_input");
    assert_eq!(error.to_string(), "invalid input: unsupported catalog schema version 7");
    let mut conn = raw(&fx.db).await;
    let tables: Vec<String> = sqlx::query_scalar(
        "SELECT name FROM sqlite_master WHERE type IN ('table', 'trigger') AND name LIKE 'view%'",
    )
    .fetch_all(&mut conn)
    .await
    .unwrap();
    conn.close().await.unwrap();
    assert!(tables.is_empty(), "no DDL of this version ran: {tables:?}");
}

// ---------------------------------------------------------------------------
// Candidate and membership reads, revisions and references (T005)
// ---------------------------------------------------------------------------

/// The current session holding `asset`.
async fn session_holding(catalog: &Catalog, asset: Uuid) -> Session {
    let summaries = catalog.list_sessions(&SessionQuery::default()).await.unwrap();
    summaries.into_iter().find(|s| s.session.asset_ids.contains(&asset)).unwrap().session
}

/// Cold-1: a second location holding a byte-identical copy of `Ha_001` and an
/// `Ha_004` only it has; both `Ha_001` copies are hashed so they join (D16).
async fn cold_copy(lib: &Indexed) -> platevault_model::Location {
    let catalog = &lib.catalog;
    let cold = lib.fx.temp.path().join("Cold-1");
    std::fs::create_dir_all(cold.join("night1")).unwrap();
    std::fs::copy(lib.fx.root.join(FRAMES[0]), cold.join(FRAMES[0])).unwrap();
    std::fs::write(cold.join("night1/Ha_004.fits"), b"night1/Ha_004.fits").unwrap();
    let location = catalog
        .register_location(&LocationRegistration {
            name: "Cold-1/Captures".into(),
            path: NativePath::from_path(&cold),
            role: LocationRole::Captures,
            identity: folder_identity(&cold).unwrap(),
        })
        .await
        .unwrap();
    let cold_fx = Fixture { temp: tempfile::tempdir().unwrap(), db: lib.fx.db.clone(), root: cold };
    scan(catalog, &cold_fx, &location, &[FRAMES[0], "night1/Ha_004.fits"]).await;
    for id in [lib.location.id, location.id] {
        let assets = catalog.location_assets(id).await.unwrap();
        catalog.verify_digest(by_name(&assets, "Ha_001.fits").id, DiskProbe).await.unwrap();
    }
    location
}

#[tokio::test]
async fn candidate_basis_lists_current_light_and_unknown_sessions_without_hashing() {
    let lib = indexed_with(&["night1/Dark_001.fits", "night1/Unknown_001.fits"]).await;
    let catalog = &lib.catalog;
    let cold = cold_copy(&lib).await;
    let assets = catalog.location_assets(lib.location.id).await.unwrap();
    let dark = session_holding(catalog, by_name(&assets, "Dark_001.fits").id).await;
    // The unknown-type session is superseded by a filter correction.
    let unknown = by_name(&assets, "Unknown_001.fits").clone();
    let superseded = session_holding(catalog, unknown.id).await;
    let correction = CorrectionInput {
        asset_id: unknown.id,
        field: "filter".into(),
        value: serde_json::json!("SII"),
    };
    catalog
        .apply_correction_and_regroup(&[expected(&unknown)], &[correction], group)
        .await
        .unwrap();
    let unknown_now = session_holding(catalog, unknown.id).await;
    assert_ne!(unknown_now.id, superseded.id);
    let unusable = by_name(&assets, "Ha_003.fits").clone();
    catalog.set_quality(&[expected(&unusable)], Quality::Unusable, DiskProbe).await.unwrap();
    let ha = session_holding(catalog, by_name(&assets, "Ha_001.fits").id).await;
    catalog.confirm_equipment(&[expected_session(&ha)], lib.equipment.id).await.unwrap();
    let ha = session_holding(catalog, by_name(&assets, "Ha_001.fits").id).await;
    let oiii = session_holding(catalog, by_name(&assets, "OIII_001.fits").id).await;
    let cold_assets = catalog.location_assets(cold.id).await.unwrap();
    assert!(ha.asset_ids.contains(&by_name(&cold_assets, "Ha_004.fits").id), "Ha spans Cold-1");
    let library = dump_tables(&lib.fx.db, &LIBRARY_TABLES).await;

    let basis = catalog.candidate_basis().await.unwrap();
    let ids: Vec<Uuid> = basis.sessions.iter().map(|s| s.summary.session.id).collect();
    assert_eq!(
        sorted(ids),
        sorted(vec![ha.id, oiii.id, unknown_now.id]),
        "current light and unknown-type sessions; never the dark {} or superseded {}",
        dark.id,
        superseded.id
    );
    let candidate = |id: Uuid| basis.sessions.iter().find(|s| s.summary.session.id == id).unwrap();

    // The Ha session: D16 captures with their copies, live state and quality.
    let ha_candidate = candidate(ha.id);
    assert_eq!(ha_candidate.summary.session.decision_revision, ha.decision_revision);
    assert_eq!(ha_candidate.captures.len(), 4, "the Ha_001 copy pair is one capture");
    assert_eq!(ha_candidate.summary.location_ids, sorted(vec![lib.location.id, cold.id]));
    let main_ha1 = by_name(&assets, "Ha_001.fits").id;
    let pair = ha_candidate
        .captures
        .iter()
        .find(|c| c.copies.iter().any(|copy| copy.asset_id == main_ha1))
        .unwrap();
    let pair_ids: Vec<Uuid> = pair.copies.iter().map(|copy| copy.asset_id).collect();
    let cold_ha1 = by_name(&cold_assets, "Ha_001.fits").id;
    assert_eq!(pair_ids, sorted(vec![main_ha1, cold_ha1]), "one capture, both copies");
    assert_eq!(pair.member_key, pair_ids[0], "the key is the smallest copy");
    for copy in &pair.copies {
        let current = catalog.asset(copy.asset_id).await.unwrap();
        assert_eq!(
            (copy.location_id, copy.availability, copy.decision_revision, &copy.fingerprint),
            (
                current.location_id,
                Availability::Available,
                current.decision_revision,
                &current.fingerprint
            )
        );
    }
    let quality_of = |id: Uuid| {
        let capture = ha_candidate.captures.iter().find(|c| c.member_key == id).unwrap();
        capture.quality
    };
    assert_eq!(quality_of(unusable.id), ApplicableQuality::Unusable);
    assert_eq!(quality_of(pair.member_key), ApplicableQuality::Unreviewed);
    for capture in &ha_candidate.captures {
        let frame = &capture.frame;
        assert!(ha.asset_ids.contains(&frame.asset_id), "evidence of the session's own copy");
        assert_eq!(
            (frame.light, frame.filter.as_deref(), frame.exposure_seconds, frame.camera.as_deref()),
            (Some(true), Some("Ha"), Some(300.0), Some("ASI2600MM"))
        );
    }
    let equipment: Vec<_> = ha_candidate
        .associations
        .iter()
        .filter(|a| a.kind == platevault_model::AssociationKind::Equipment)
        .map(|a| (a.subject_id, a.state.clone()))
        .collect();
    assert_eq!(equipment, vec![(Some(lib.equipment.id), AssociationState::Confirmed)]);
    let members: Vec<Uuid> = ha_candidate.assessed.observations.keys().copied().collect();
    assert_eq!(members, ha.asset_ids, "the evidence names the current members");
    assert_eq!(basis.equipment.iter().map(|e| e.id).collect::<Vec<_>>(), vec![lib.equipment.id]);

    // The unknown-type session reads frame type unknown with its corrected filter.
    let unknown_candidate = candidate(unknown_now.id);
    let frame = &unknown_candidate.captures[0].frame;
    assert_eq!((frame.light, frame.filter.as_deref()), (None, Some("SII")));

    // Reading hashed nothing: no library row (last_verified_at included) moved.
    assert_eq!(dump_tables(&lib.fx.db, &LIBRARY_TABLES).await, library);
    assert_eq!(tree(&lib.fx.root), lib.before);
}

#[tokio::test]
async fn view_membership_reads_live_availability_unresolved_and_changed_since_review() {
    let lib = indexed().await;
    let catalog = &lib.catalog;
    let by_filter = sessions(catalog).await;
    let (ha, oiii) = (&by_filter["Ha"], &by_filter["OIII"]);
    let id = catalog.create_view(&origin_sessions(&[ha, oiii])).await.unwrap().view.id;
    let draft = catalog.view_membership(id, Membership::Draft).await.unwrap();
    assert_eq!((draft.view_id, draft.membership, draft.revision), (id, Membership::Draft, 1));
    let chosen: Vec<Uuid> = draft.sessions.iter().map(|c| c.current.session.id).collect();
    assert_eq!(chosen, sorted(vec![ha.id, oiii.id]));
    assert_eq!(draft.members.len(), FRAMES.len());
    for member in &draft.members {
        assert!(!member.unresolved && !member.changed_since_review, "{member:?}");
        assert_eq!(member.quality, ApplicableQuality::Unreviewed);
        assert_eq!(member.frame.asset_id, member.member.member_key);
        let copy = &member.copies[0];
        let asset = catalog.asset(copy.asset_id).await.unwrap();
        assert_eq!(
            (copy.location_name.as_str(), copy.availability, copy.failure_reason.as_deref()),
            ("Astro-T7/Captures", Availability::Available, None)
        );
        assert_eq!(copy.path, asset.relative_path);
        assert_eq!(json(&copy.current), json(&expected(&asset)));
    }
    let none = catalog.view_membership(id, Membership::Committed).await.unwrap_err();
    assert_eq!(kind(&none), "not_found", "nothing is committed yet");
    catalog.save_view(id, 0, 1).await.unwrap();
    let committed = catalog.view_membership(id, Membership::Committed).await.unwrap();
    assert_eq!((committed.membership, committed.revision), (Membership::Committed, 1));
    let recorded = |basis: &platevault_model::MembershipBasis| {
        serde_json::to_value(basis.members.iter().map(|m| &m.member).collect::<Vec<_>>()).unwrap()
    };
    let states = |basis: &platevault_model::MembershipBasis| {
        basis.members.iter().map(|m| (m.member.member_key, m.member.state)).collect::<Vec<_>>()
    };
    assert_eq!(states(&committed), states(&draft), "Save committed the draft's members");
    assert!(committed.members.iter().all(|m| m.member.added_in_revision == Some(1)));
    assert_eq!(
        kind(&catalog.view_membership(id, Membership::Draft).await.unwrap_err()),
        "not_found"
    );

    // A new modification time on unchanged bytes, rescanned: the member is
    // changed since review and its copy reads the current fingerprint.
    let assets = catalog.location_assets(lib.location.id).await.unwrap();
    let touched = by_name(&assets, "OIII_001.fits").clone();
    let file = std::fs::File::options().write(true).open(lib.fx.root.join(FRAMES[3])).unwrap();
    file.set_modified(std::time::SystemTime::now() + std::time::Duration::from_secs(60)).unwrap();
    drop(file);
    scan(catalog, &lib.fx, &lib.location, &FRAMES).await;
    let drifted = catalog.view_membership(id, Membership::Committed).await.unwrap();
    let changed: Vec<Uuid> = drifted
        .members
        .iter()
        .filter(|m| m.changed_since_review)
        .map(|m| m.member.member_key)
        .collect();
    assert_eq!(changed, vec![touched.id]);
    let now = catalog.asset(touched.id).await.unwrap();
    let member = drifted.members.iter().find(|m| m.member.member_key == touched.id).unwrap();
    assert_eq!(json(&member.copies[0].current), json(&expected(&now)));
    assert_eq!(recorded(&drifted), recorded(&committed), "the stored members never move");

    // Offline and then Unreadable: every included member reads unresolved with
    // its location, failure reason and last observation; an excluded one does not.
    catalog
        .edit_view_draft(
            id,
            0,
            &DraftEdit::SetFrames { member_keys: vec![touched.id], state: MemberState::Excluded },
        )
        .await
        .unwrap();
    for (availability, reason) in
        [(Availability::Offline, "unplugged"), (Availability::Unreadable, "permission denied")]
    {
        catalog.mark_location_unavailable(lib.location.id, availability, reason).await.unwrap();
        for membership in [Membership::Committed, Membership::Draft] {
            let basis = catalog.view_membership(id, membership).await.unwrap();
            assert_eq!(basis.members.len(), FRAMES.len(), "never an empty session");
            for member in &basis.members {
                let excluded = member.member.state == MemberState::Excluded;
                assert_eq!(member.unresolved, !excluded, "{membership:?} {member:?}");
                let copy = &member.copies[0];
                assert_eq!(
                    (copy.availability, copy.failure_reason.as_deref(), copy.location_id),
                    (availability, Some(reason), lib.location.id)
                );
                assert_eq!(copy.location_name, "Astro-T7/Captures");
                assert!(!copy.last_observed_at.is_empty());
            }
            let captures: u64 = basis.sessions.iter().map(|c| c.current.capture_count).sum();
            assert_eq!(captures, FRAMES.len() as u64, "last-observed sessions keep their captures");
        }
    }
    assert_eq!(tree(&lib.fx.root), lib.before, "only the modification time moved");
}

#[tokio::test]
async fn an_older_revision_reads_unchanged_after_a_later_save_and_a_verified_remap() {
    let lib = indexed().await;
    let catalog = &lib.catalog;
    let by_filter = sessions(catalog).await;
    let (ha, oiii) = (&by_filter["Ha"], &by_filter["OIII"]);
    let id = catalog.create_view(&origin_sessions(&[ha])).await.unwrap().view.id;
    catalog.save_view(id, 0, 1).await.unwrap();
    let first = catalog.view_revision(id, 1).await.unwrap();
    let (choices, members) = stored(&lib.fx.db, id, Some(1)).await;
    assert_eq!(
        serde_json::to_value(&first.sessions).unwrap(),
        serde_json::to_value(&choices).unwrap()
    );
    assert_eq!(
        serde_json::to_value(&first.members).unwrap(),
        serde_json::to_value(&members).unwrap()
    );
    assert!(first.members.iter().all(|m| !m.copies.is_empty()), "every review basis is returned");
    let first = serde_json::to_value(first).unwrap();

    let manual = DraftEdit::SelectSessions { sessions: vec![expected_session(oiii)] };
    catalog.edit_view_draft(id, 0, &manual).await.unwrap();
    assert_eq!(catalog.save_view(id, 1, 1).await.unwrap().view.revision, 2);
    let older = catalog.view_revision(id, 1).await.expect("an older revision is never Conflict");
    assert_eq!(serde_json::to_value(older).unwrap(), first);
    let second = serde_json::to_value(catalog.view_revision(id, 2).await.unwrap()).unwrap();
    assert_ne!(second, first);

    // A verified remap onto a byte-identical copy keeps every member asset id.
    let copy = lib.fx.temp.path().join("Captures copy");
    for name in FRAMES {
        std::fs::create_dir_all(copy.join(name).parent().unwrap()).unwrap();
        std::fs::copy(lib.fx.root.join(name), copy.join(name)).unwrap();
    }
    let location = catalog.location(lib.location.id).await.unwrap();
    let review = catalog
        .review_remap(
            location.id,
            location.decision_revision,
            &NativePath::from_path(&copy),
            &folder_identity(&copy).unwrap(),
            DiskProbe,
        )
        .await
        .unwrap();
    assert!(review.blocked.is_empty(), "{:?}", review.blocked);
    let remapped = catalog.apply_remap(review.id, location.decision_revision, DiskProbe).await;
    assert_eq!(remapped.unwrap().path, NativePath::from_path(&copy));
    for (revision, before) in [(1, &first), (2, &second)] {
        let after = serde_json::to_value(catalog.view_revision(id, revision).await.unwrap());
        assert_eq!(&after.unwrap(), before, "revision {revision} unchanged by the remap");
    }
    let remapped = catalog.view_membership(id, Membership::Committed).await.unwrap();
    assert!(remapped.members.iter().all(|m| !m.unresolved), "the copies are available again");
    assert_eq!(tree(&lib.fx.root), lib.before);
}

/// D19: a verified remap is a completed byte verification, so it moves no member
/// out of review and writes no View row; only a later byte change does.
#[tokio::test]
async fn a_verified_remap_keeps_every_member_reviewed_until_its_bytes_change() {
    let lib = indexed().await;
    let catalog = &lib.catalog;
    let by_filter = sessions(catalog).await;
    let origin = origin_sessions(&[&by_filter["Ha"], &by_filter["OIII"]]);
    let id = catalog.create_view(&origin).await.unwrap().view.id;
    catalog.save_view(id, 0, 1).await.unwrap();
    let reviewed = |basis: &platevault_model::MembershipBasis| {
        let members = basis.members.iter();
        members
            .map(|m| (m.member.member_key, m.member.state, m.unresolved, m.changed_since_review))
            .collect::<Vec<_>>()
    };
    let before = catalog.view_membership(id, Membership::Committed).await.unwrap();
    assert_eq!(before.members.len(), FRAMES.len());
    assert!(before.members.iter().all(|m| m.member.state == MemberState::Included));
    assert!(before.members.iter().all(|m| !m.changed_since_review && !m.unresolved));
    let rows = serde_json::to_value(stored(&lib.fx.db, id, Some(1)).await).unwrap();

    // Byte-identical copies under new file IDs and modification times.
    let copy = lib.fx.temp.path().join("Captures copy");
    for name in FRAMES {
        std::fs::create_dir_all(copy.join(name).parent().unwrap()).unwrap();
        std::fs::copy(lib.fx.root.join(name), copy.join(name)).unwrap();
    }
    let location = catalog.location(lib.location.id).await.unwrap();
    let review = catalog
        .review_remap(
            location.id,
            location.decision_revision,
            &NativePath::from_path(&copy),
            &folder_identity(&copy).unwrap(),
            DiskProbe,
        )
        .await
        .unwrap();
    assert!(review.blocked.is_empty(), "{:?}", review.blocked);
    let remapped =
        catalog.apply_remap(review.id, location.decision_revision, DiskProbe).await.unwrap();
    let after = catalog.view_membership(id, Membership::Committed).await.unwrap();
    assert_eq!(reviewed(&after), reviewed(&before), "every member stays included and reviewed");
    let rows_after = serde_json::to_value(stored(&lib.fx.db, id, Some(1)).await).unwrap();
    assert_eq!(rows_after, rows, "the remap writes no View row");

    // New bytes at the new root, rescanned: only that member is changed.
    let assets = catalog.location_assets(lib.location.id).await.unwrap();
    let rewritten = by_name(&assets, "Ha_001.fits").id;
    std::fs::write(copy.join(FRAMES[0]), b"Ha_001 rewritten after the remap").unwrap();
    let copy_fx = Fixture { temp: tempfile::tempdir().unwrap(), db: lib.fx.db.clone(), root: copy };
    scan(catalog, &copy_fx, &remapped, &FRAMES).await;
    let drifted = catalog.view_membership(id, Membership::Committed).await.unwrap();
    let changed: Vec<Uuid> = drifted
        .members
        .iter()
        .filter(|m| m.changed_since_review)
        .map(|m| m.member.member_key)
        .collect();
    assert_eq!(changed, vec![rewritten]);
    assert_eq!(tree(&lib.fx.root), lib.before);
}

#[tokio::test]
async fn view_references_name_every_view_whose_revisions_or_draft_hold_an_asked_asset() {
    let lib = indexed().await;
    let catalog = &lib.catalog;
    let by_filter = sessions(catalog).await;
    let (ha, oiii) = (&by_filter["Ha"], &by_filter["OIII"]);
    // Saved with Ha; its draft adds OIII.
    let saved = catalog.create_view(&origin_sessions(&[ha])).await.unwrap().view.id;
    catalog.save_view(saved, 0, 1).await.unwrap();
    let manual = DraftEdit::SelectSessions { sessions: vec![expected_session(oiii)] };
    catalog.edit_view_draft(saved, 0, &manual).await.unwrap();
    // Never saved: only its draft holds OIII.
    let unsaved = NewView { name: Some("Bicolor draft".into()), ..origin_sessions(&[oiii]) };
    let unsaved = catalog.create_view(&unsaved).await.unwrap().view.id;
    let assets = catalog.location_assets(lib.location.id).await.unwrap();
    let (ha1, oiii1) = (by_name(&assets, "Ha_001.fits").id, by_name(&assets, "OIII_001.fits").id);

    let asked = BTreeSet::from([ha1, oiii1, Uuid::new_v4()]);
    let mut want = vec![
        AssetReference {
            kind: ReferenceKind::View,
            id: saved,
            name: "NGC7000 HOO - Siril".into(),
            revision: 1,
            asset_ids: sorted(vec![ha1, oiii1]),
        },
        AssetReference {
            kind: ReferenceKind::View,
            id: unsaved,
            name: "Bicolor draft".into(),
            revision: 0,
            asset_ids: vec![oiii1],
        },
    ];
    want.sort_by_key(|reference| reference.id);
    assert_eq!(catalog.view_references(&asked).await.unwrap(), want);
    assert!(catalog.view_references(&BTreeSet::new()).await.unwrap().is_empty());
    let elsewhere = BTreeSet::from([Uuid::new_v4()]);
    assert!(catalog.view_references(&elsewhere).await.unwrap().is_empty());
}

// ---------------------------------------------------------------------------
// Scoped quality actions and refresh reviews (T006)
// ---------------------------------------------------------------------------

/// Retire `location` after an Offline review naming the Views holding its copies.
async fn retire(catalog: &Catalog, location: Uuid) {
    let assets: BTreeSet<Uuid> =
        catalog.location_assets(location).await.unwrap().iter().map(|a| a.id).collect();
    let references = LocationReferences {
        references: catalog.view_references(&assets).await.unwrap(),
        assets,
        consulted: vec![ReferenceKind::View],
    };
    catalog.mark_location_unavailable(location, Availability::Offline, "unplugged").await.unwrap();
    let review = catalog.review_retire_location(location, &references).await.unwrap();
    catalog
        .retire_location(review.id, location, review.expected_revision, &references)
        .await
        .unwrap();
}

#[tokio::test]
#[allow(clippy::too_many_lines)] // one scope walked through every refusal and both actions
async fn view_quality_actions_decide_only_their_scope_and_never_move_members() {
    let lib = indexed_with(&["night1/Unknown_001.fits"]).await;
    let catalog = &lib.catalog;
    let cold = cold_copy(&lib).await;
    let assets = catalog.location_assets(lib.location.id).await.unwrap();
    let asset = |name: &str| by_name(&assets, name).clone();
    let ha = session_holding(catalog, asset("Ha_001.fits").id).await;
    let oiii = session_holding(catalog, asset("OIII_001.fits").id).await;
    let id = catalog.create_view(&origin_sessions(&[&ha, &oiii])).await.unwrap().view.id;
    let excluded = asset("OIII_002.fits");
    let exclude =
        DraftEdit::SetFrames { member_keys: vec![excluded.id], state: MemberState::Excluded };
    catalog.edit_view_draft(id, 1, &exclude).await.unwrap();
    let views = dump_tables(&lib.fx.db, &VIEW_TABLES).await;
    let decisions = dump_where(&lib.fx.db, "quality_decisions", "").await;
    let (ha2, ha3) = (asset("Ha_002.fits"), asset("Ha_003.fits"));

    // Refusals decide nothing: an excluded or a non-member, or a stale draft.
    let error = catalog
        .set_view_quality(
            id,
            Membership::Draft,
            Some(2),
            &[expected(&ha2), expected(&excluded)],
            Quality::Usable,
            DiskProbe,
        )
        .await
        .unwrap_err();
    assert_eq!(kind(&error), "invalid_input");
    assert!(error.to_string().contains(&excluded.id.to_string()), "{error}");
    let stranger = asset("Unknown_001.fits");
    let error = catalog
        .set_view_quality(
            id,
            Membership::Draft,
            Some(2),
            &[expected(&stranger)],
            Quality::Unusable,
            DiskProbe,
        )
        .await
        .unwrap_err();
    assert_eq!(kind(&error), "invalid_input", "not a member: {error}");
    let error = catalog
        .set_view_quality(
            id,
            Membership::Draft,
            Some(1),
            &[expected(&ha2)],
            Quality::Usable,
            DiskProbe,
        )
        .await
        .unwrap_err();
    conflict_at(&error, id, 2);
    assert_eq!(dump_where(&lib.fx.db, "quality_decisions", "").await, decisions);

    // Mark included frames usable hashes and decides; no member moves.
    let decided = catalog
        .set_view_quality(
            id,
            Membership::Draft,
            Some(2),
            &[expected(&ha2), expected(&ha3)],
            Quality::Usable,
            DiskProbe,
        )
        .await
        .unwrap();
    assert_eq!(decided.iter().map(|a| a.id).collect::<Vec<_>>(), sorted(vec![ha2.id, ha3.id]));
    for asset in &decided {
        assert_eq!(asset.quality, Quality::Usable);
        assert!(asset.quality_basis.as_ref().is_some_and(|basis| basis.content_sha256.is_some()));
    }
    assert_eq!(dump_where(&lib.fx.db, "quality_decisions", "").await.len(), decisions.len() + 2);
    assert_eq!(dump_tables(&lib.fx.db, &VIEW_TABLES).await, views, "no member moved");
    let error = catalog
        .set_view_quality(
            id,
            Membership::Draft,
            Some(2),
            &[expected(&ha2)],
            Quality::Usable,
            DiskProbe,
        )
        .await
        .unwrap_err();
    conflict_at(&error, ha2.id, ha2.decision_revision + 1);

    // Mark unusable in library takes an excluded member and leaves it excluded.
    catalog
        .set_view_quality(
            id,
            Membership::Draft,
            Some(2),
            &[expected(&excluded)],
            Quality::Unusable,
            DiskProbe,
        )
        .await
        .unwrap();
    assert_eq!(catalog.asset(excluded.id).await.unwrap().quality, Quality::Unusable);
    assert_eq!(dump_tables(&lib.fx.db, &VIEW_TABLES).await, views);
    let (_, members) = stored(&lib.fx.db, id, None).await;
    let member = members.iter().find(|m| m.member_key == excluded.id).unwrap();
    assert_eq!(
        (member.state, &member.reason),
        (MemberState::Excluded, &MemberReason::ViewExclusion)
    );

    // On a committed revision a later decision changes no revision row.
    catalog.save_view(id, 0, 2).await.unwrap();
    let rows = committed_rows(&lib.fx.db).await;
    let ha3 = catalog.asset(ha3.id).await.unwrap();
    let unusable = catalog
        .set_view_quality(
            id,
            Membership::Committed,
            None,
            &[expected(&ha3)],
            Quality::Unusable,
            DiskProbe,
        )
        .await
        .unwrap();
    assert_eq!(unusable[0].quality, Quality::Unusable);
    assert_eq!(committed_rows(&lib.fx.db).await, rows, "the revision is unchanged");
    let revision = catalog.view_revision(id, 1).await.unwrap();
    let member = revision.members.iter().find(|m| m.member_key == ha3.id).unwrap();
    assert_eq!((member.state, &member.reason), (MemberState::Included, &MemberReason::Initial));

    // A Retired copy is refused before anything is hashed.
    retire(catalog, cold.id).await;
    let cold_assets = catalog.location_assets(cold.id).await.unwrap();
    let retired = by_name(&cold_assets, "Ha_001.fits").clone();
    assert_eq!(retired.availability, Availability::Retired);
    let error = catalog
        .set_view_quality(
            id,
            Membership::Committed,
            None,
            &[expected(&retired)],
            Quality::Unusable,
            DiskProbe,
        )
        .await
        .unwrap_err();
    assert_eq!(kind(&error), "invalid_input", "{error}");
    assert_eq!(committed_rows(&lib.fx.db).await, rows);
    assert_eq!(tree(&lib.fx.root), lib.before);
}

#[tokio::test]
async fn reject_for_project_records_only_the_project_rejection() {
    let lib = indexed().await;
    let catalog = &lib.catalog;
    let by_filter = sessions(catalog).await;
    let (ha, oiii) = (&by_filter["Ha"], &by_filter["OIII"]);
    let project = hoo(&lib).await;
    let id = project_view(catalog, &project, vec![suggestion(catalog, ha).await]).await.view.id;
    let assets = catalog.location_assets(lib.location.id).await.unwrap();
    let (ha1, oiii1) = (by_name(&assets, "Ha_001.fits"), by_name(&assets, "OIII_001.fits"));
    let library = dump_tables(&lib.fx.db, &LIBRARY_TABLES[..7]).await;
    let views = dump_tables(&lib.fx.db, &VIEW_TABLES).await;

    let error = catalog
        .reject_view_members(id, Membership::Draft, Some(1), project.revision, &[expected(oiii1)])
        .await
        .unwrap_err();
    assert_eq!(kind(&error), "invalid_input", "not a member: {error}");
    let error = catalog
        .reject_view_members(id, Membership::Draft, Some(1), project.revision + 1, &[expected(ha1)])
        .await
        .unwrap_err();
    conflict_at(&error, project.id, project.revision);
    let error = catalog
        .reject_view_members(id, Membership::Draft, Some(2), project.revision, &[expected(ha1)])
        .await
        .unwrap_err();
    conflict_at(&error, id, 1);
    assert_eq!(catalog.project(project.id).await.unwrap().revision, project.revision);

    let rejected = catalog
        .reject_view_members(id, Membership::Draft, Some(1), project.revision, &[expected(ha1)])
        .await
        .unwrap();
    assert_eq!(rejected.revision, project.revision + 1);
    let decisions: Vec<(Uuid, bool)> =
        rejected.rejections.iter().map(|r| (r.asset_id, r.rejected)).collect();
    assert_eq!(decisions, vec![(ha1.id, true)]);
    assert_eq!(dump_tables(&lib.fx.db, &LIBRARY_TABLES[..7]).await, library, "library unchanged");
    assert_eq!(dump_tables(&lib.fx.db, &VIEW_TABLES).await, views, "no member moved");

    // A View without a Project has no Project scope.
    let standalone = catalog.create_view(&origin_sessions(&[oiii])).await.unwrap().view.id;
    let error = catalog
        .reject_view_members(
            standalone,
            Membership::Draft,
            Some(1),
            rejected.revision,
            &[expected(oiii1)],
        )
        .await
        .unwrap_err();
    assert_eq!(kind(&error), "invalid_input", "{error}");
    assert_eq!(catalog.project(project.id).await.unwrap().revision, rejected.revision);
    assert_eq!(tree(&lib.fx.root), lib.before);
}

fn refresh_item(kind: RefreshItemKind, session: &Session) -> RefreshItem {
    RefreshItem {
        id: Uuid::new_v4(),
        kind,
        session_id: session.id,
        session: Some(expected_session(session)),
        assessed: None,
        evidence: None,
        reason: None,
        member_keys: Vec::new(),
        successors: Vec::new(),
    }
}

/// An added-session item bound to the session's current members.
async fn added_session(catalog: &Catalog, session: &Session) -> RefreshItem {
    let detail = catalog.session(session.id).await.unwrap();
    RefreshItem {
        assessed: Some(assessed(&detail.assets)),
        evidence: Some(geometry()),
        ..refresh_item(RefreshItemKind::AddedSession, &detail.summary.session)
    }
}

async fn record_review(catalog: &Catalog, view: Uuid, items: Vec<RefreshItem>) -> RefreshReview {
    let record = catalog.view(view).await.unwrap();
    let revision = record.revision.unwrap();
    let review = RefreshReview {
        id: Uuid::new_v4(),
        view_id: view,
        base_revision: revision.revision,
        criteria: revision.criteria,
        items,
        state: RefreshState::Reviewed,
        created_at: String::new(),
        applied_at: None,
    };
    catalog.record_refresh_review(&review).await.unwrap()
}

#[tokio::test]
async fn refresh_reviews_persist_and_apply_once_onto_a_draft() {
    let lib = indexed_with(&["night1/Unknown_001.fits"]).await;
    let catalog = &lib.catalog;
    let assets = catalog.location_assets(lib.location.id).await.unwrap();
    let ha = session_holding(catalog, by_name(&assets, "Ha_001.fits").id).await;
    let oiii = session_holding(catalog, by_name(&assets, "OIII_001.fits").id).await;
    let unknown = session_holding(catalog, by_name(&assets, "Unknown_001.fits").id).await;
    let id = catalog.create_view(&origin_sessions(&[&ha])).await.unwrap().view.id;
    catalog.save_view(id, 0, 1).await.unwrap();
    let rows = committed_rows(&lib.fx.db).await;

    let added = added_session(catalog, &oiii).await;
    let declined = added_session(catalog, &unknown).await;
    let manual = RefreshItem {
        reason: Some(SelectionReason::OriginSessions),
        member_keys: ha.asset_ids.clone(),
        ..refresh_item(RefreshItemKind::ManualInclusion, &ha)
    };
    let review =
        record_review(catalog, id, vec![added.clone(), declined.clone(), manual.clone()]).await;
    assert_eq!((review.state, review.applied_at.is_none()), (RefreshState::Reviewed, true));
    assert_eq!((review.base_revision, review.items.len()), (1, 3));
    assert!(!review.created_at.is_empty());
    assert_eq!(dump_where(&lib.fx.db, "view_refresh_reviews", "").await.len(), 1, "persisted");
    let stale_base = RefreshReview { id: Uuid::new_v4(), base_revision: 2, ..review.clone() };
    conflict_at(&catalog.record_refresh_review(&stale_base).await.unwrap_err(), id, 1);
    // A review whose added session changed since it was computed.
    let mut changed = added_session(catalog, &oiii).await;
    changed.session.as_mut().unwrap().decision_revision += 1;
    let stale_review = record_review(catalog, id, vec![changed.clone()]).await;

    // Refusals write nothing: a kept item, an unknown item, a stale View or item.
    let before = dump_tables(&lib.fx.db, &VIEW_TABLES).await;
    let error = catalog.apply_refresh(review.id, id, 1, 0, &[manual.id], &[]).await.unwrap_err();
    assert_eq!(kind(&error), "invalid_input", "a manual inclusion is only listed: {error}");
    let error = catalog.apply_refresh(review.id, id, 1, 0, &[Uuid::new_v4()], &[]).await;
    assert_eq!(kind(&error.unwrap_err()), "invalid_input");
    let error = catalog.apply_refresh(review.id, id, 2, 0, &[added.id], &[]).await.unwrap_err();
    conflict_at(&error, id, 1);
    let error = catalog.apply_refresh(stale_review.id, id, 1, 0, &[changed.id], &[]).await;
    conflict_at(&error.unwrap_err(), oiii.id, oiii.decision_revision);
    assert_eq!(dump_tables(&lib.fx.db, &VIEW_TABLES).await, before);

    // Accepting OIII and declining the unknown session starts the draft.
    let applied = catalog.apply_refresh(review.id, id, 1, 0, &[added.id], &[declined.id]).await;
    let draft = applied.unwrap().draft.unwrap();
    assert_eq!(
        (draft.draft_revision, draft.base_revision, draft.refresh_review_id),
        (1, 1, Some(review.id))
    );
    let (choices, members) = stored(&lib.fx.db, id, None).await;
    let choice = |session: Uuid| choices.iter().find(|c| c.session_id == session).unwrap();
    let refresh = SelectionReason::RefreshMatch { review_id: review.id };
    assert_eq!(
        (choice(oiii.id).state, &choice(oiii.id).reason),
        (SessionChoiceState::Selected, &refresh)
    );
    assert_eq!(choice(oiii.id).evidence, Some(geometry()));
    assert_eq!(
        (choice(unknown.id).state, &choice(unknown.id).reason),
        (SessionChoiceState::Excluded, &refresh)
    );
    assert_eq!(choice(ha.id).reason, SelectionReason::OriginSessions);
    for member in &members {
        if member.session_id == oiii.id {
            assert_eq!(member.reason, MemberReason::RefreshAdded { review_id: review.id });
            assert_eq!((member.state, member.added_in_revision), (MemberState::Included, None));
        } else {
            assert_eq!((member.session_id, member.added_in_revision), (ha.id, Some(1)));
        }
    }
    assert_eq!(members.len(), ha.asset_ids.len() + oiii.asset_ids.len(), "no unknown member");
    assert_eq!(committed_rows(&lib.fx.db).await, rows, "revision 1 is byte-identical");
    let filter = format!("WHERE id = '{}'", review.id);
    let state = dump_where(&lib.fx.db, "view_refresh_reviews", &filter).await;
    assert!(state[0].contains("'applied'"), "{state:?}");
    let twice = catalog.apply_refresh(review.id, id, 1, 1, &[added.id], &[]).await.unwrap_err();
    assert_eq!(kind(&twice), "conflict", "{twice}");

    // Save: the additions carry the new revision; revision 1 stays as it was.
    let saved = catalog.save_view(id, 1, 1).await.unwrap();
    assert_eq!(saved.revision.as_ref().unwrap().refresh_review_id, Some(review.id));
    let revision = catalog.view_revision(id, 2).await.unwrap();
    for member in &revision.members {
        let added_in = if member.session_id == oiii.id { 2 } else { 1 };
        assert_eq!(member.added_in_revision, Some(added_in));
    }
    let after = committed_rows(&lib.fx.db).await;
    for (before, after) in rows.iter().zip(&after) {
        assert!(after.starts_with(before), "revision 1 rows unchanged: {before:?} vs {after:?}");
    }
    assert_eq!(tree(&lib.fx.root), lib.before);
}

#[tokio::test]
async fn accepted_captures_removals_and_regroups_follow_their_items() {
    let lib = indexed().await;
    let catalog = &lib.catalog;
    let by_filter = sessions(catalog).await;
    let (ha, oiii) = (by_filter["Ha"].clone(), by_filter["OIII"].clone());
    let project = hoo(&lib).await;
    let id = project_view(catalog, &project, vec![suggestion(catalog, &ha).await]).await.view.id;
    let details = DraftEdit::Details {
        name: "NGC 7000 HOO".into(),
        project_id: Some(project.id),
        criteria: CriteriaInput::default(),
    };
    catalog.edit_view_draft(id, 1, &details).await.unwrap();
    catalog.save_view(id, 0, 2).await.unwrap();

    // A new Ha frame joins the kept Ha session: accepting adds just that capture.
    lib.fx.write("night1/Ha_005.fits", b"night1/Ha_005.fits");
    let mut names = FRAMES.to_vec();
    names.push("night1/Ha_005.fits");
    scan(catalog, &lib.fx, &lib.location, &names).await;
    let assets = catalog.location_assets(lib.location.id).await.unwrap();
    let new = by_name(&assets, "Ha_005.fits").id;
    let grown = session_holding(catalog, new).await;
    assert_eq!(grown.id, ha.id, "identical evidence keeps the session");
    let captures = RefreshItem { member_keys: vec![new], ..added_session(catalog, &grown).await };
    let captures = RefreshItem { kind: RefreshItemKind::AddedCaptures, ..captures };
    let review = record_review(catalog, id, vec![captures.clone()]).await;
    catalog.apply_refresh(review.id, id, 1, 0, &[captures.id], &[]).await.unwrap();
    let (choices, members) = stored(&lib.fx.db, id, None).await;
    assert_eq!(choices[0].grouping_revision, grown.grouping_revision, "the choice follows");
    assert_eq!(members.len(), 4);
    let added = members.iter().find(|m| m.member_key == new).unwrap();
    assert_eq!(added.reason, MemberReason::RefreshAdded { review_id: review.id });
    catalog.save_view(id, 1, 1).await.unwrap();

    // Removing a criteria-based member session turns it into an exclusion.
    let removed = RefreshItem {
        member_keys: grown.asset_ids.clone(),
        ..refresh_item(RefreshItemKind::Removed, &grown)
    };
    let review = record_review(catalog, id, vec![removed.clone()]).await;
    catalog.apply_refresh(review.id, id, 2, 0, &[removed.id], &[]).await.unwrap();
    let (choices, members) = stored(&lib.fx.db, id, None).await;
    assert_eq!(
        (choices.len(), choices[0].state, &choices[0].reason),
        (1, SessionChoiceState::Excluded, &SelectionReason::GeometrySuggestion)
    );
    assert!(members.is_empty());

    // A superseded member session is regrouped: the choice points at the
    // successors and every member keeps its state, now held by a successor.
    let other = catalog.create_view(&origin_sessions(&[&oiii])).await.unwrap().view.id;
    let exclude = DraftEdit::SetFrames {
        member_keys: vec![by_name(&assets, "OIII_002.fits").id],
        state: MemberState::Excluded,
    };
    catalog.edit_view_draft(other, 1, &exclude).await.unwrap();
    catalog.save_view(other, 0, 2).await.unwrap();
    let (_, before) = stored(&lib.fx.db, other, Some(1)).await;
    let corrected = by_name(&assets, "OIII_002.fits").clone();
    let correction = CorrectionInput {
        asset_id: corrected.id,
        field: "filter".into(),
        value: serde_json::json!("SII"),
    };
    let outcome = catalog
        .apply_correction_and_regroup(&[expected(&corrected)], &[correction], group)
        .await
        .unwrap();
    let successors = outcome.lineage.unwrap().successors;
    let mut current = Vec::new();
    for successor in &successors {
        current.push(expected_session(&catalog.session(*successor).await.unwrap().summary.session));
    }
    let regrouped = RefreshItem {
        session: None,
        successors: current,
        ..refresh_item(RefreshItemKind::Regrouped, &oiii)
    };
    let review = record_review(catalog, other, vec![regrouped.clone()]).await;
    catalog.apply_refresh(review.id, other, 1, 0, &[regrouped.id], &[]).await.unwrap();
    let (choices, members) = stored(&lib.fx.db, other, None).await;
    assert_eq!(selected(&choices), sorted(successors.clone()));
    assert!(choices.iter().all(|c| c.reason == SelectionReason::OriginSessions));
    let keep = |members: &[ViewMember]| {
        members.iter().map(|m| (m.member_key, m.state, m.reason.clone())).collect::<Vec<_>>()
    };
    assert_eq!(keep(&members), keep(&before), "members unchanged");
    for member in &members {
        let holder = session_holding(catalog, member.member_key).await;
        assert_eq!(member.session_id, holder.id, "held by the successor holding its copy");
    }
    assert!(successors.contains(&session_holding(catalog, corrected.id).await.id));
    let now = tree(&lib.fx.root);
    assert!(
        lib.before.iter().all(|(path, file)| now.get(path) == Some(file)),
        "originals unchanged"
    );
}
