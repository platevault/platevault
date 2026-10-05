// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! View records in the clean catalog (spec 066): creation from each origin,
//! draft edits checked against the draft revision, explicit Save into immutable
//! revisions, D16 members with their D02 starting state, and refusals that
//! write nothing. Library rows and fixture files are never changed.
#![cfg(unix)]

mod support;

use std::collections::BTreeMap;

use persistence_library::{Catalog, LocationRegistration, SessionQuery};
use platevault_model::{
    ApplicableQuality, AssessedMembers, Asset, AssociationState, Availability, CorrectionInput,
    CriteriaInput, DraftEdit, Equipment, GeometryClass, GeometryEvidence, LibraryError,
    LocationRole, MemberReason, MemberState, NativePath, NewView, Project, ProjectInput,
    Provenance, Quality, Revision, SelectionReason, Session, SessionChoice, SessionChoiceState,
    SuggestedChoice, TargetFraming, TargetRecord, ViewMember, ViewOriginInput, ViewRecord,
};
use sqlx::Connection;
use support::*;
use uuid::Uuid;

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
