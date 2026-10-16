// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Hold sessions in a Project through the membership writer, as the user
//! does once review and calibration let a session join (spec 065 PRJ-FR-08,
//! LIB-FR-23): its Unreviewed frames marked, its review finished at its
//! grouping revision and every calibration kind answered No. A test that
//! needs it declares it beside the shared fixture with
//! `#[path = "support/membership.rs"] mod membership_support;`.
#![allow(dead_code)]

use persistence_library::{Catalog, NewGroup, SessionAdd};
use platevault_model::{
    AdmissionBasis, ExpectedAsset, GroupName, GroupOrigin, InputKind, LibraryError,
    OpticsSignature, ProjectDesired, Quality, Revision, SessionPlacement,
};
use uuid::Uuid;

use crate::support::{expected, DiskProbe};

/// Mark `session`'s Unreviewed frames `quality` (marks already made stay),
/// finish its review and say No to each calibration kind: it is Ready and
/// settled.
pub async fn admit(catalog: &Catalog, session: Uuid, quality: Quality) {
    let detail = catalog.session(session).await.unwrap();
    let unreviewed: Vec<ExpectedAsset> = detail
        .assets
        .iter()
        .filter(|asset| asset.quality == Quality::Unreviewed)
        .map(expected)
        .collect();
    if !unreviewed.is_empty() {
        catalog.set_quality(&unreviewed, quality, DiskProbe).await.unwrap();
    }
    let grouping = catalog.session(session).await.unwrap().summary.session.grouping_revision;
    catalog.finish_session_review(session, grouping).await.unwrap();
    for kind in [InputKind::Bias, InputKind::Dark, InputKind::Flat] {
        let generation = catalog.session_admission(session).await.unwrap().calibration.generation;
        catalog.decline_calibration(&[(session, generation)], kind).await.unwrap();
    }
}

/// Add the Ready, settled `session` whole to `project` at its current
/// revision: into the Project's group on `rig`, or a new group for it.
///
/// # Errors
/// As `Catalog::add_project_sessions`.
pub async fn add(
    catalog: &Catalog,
    project: Uuid,
    session: Uuid,
    rig: Uuid,
) -> Result<ProjectDesired, LibraryError> {
    let revision = catalog.project_desired(project).await.unwrap().revision;
    add_at(catalog, project, revision, session, rig, None).await
}

/// [`add`] at the Project revision and admission basis the user saw.
///
/// # Errors
/// As `Catalog::add_project_sessions`.
pub async fn add_at(
    catalog: &Catalog,
    project: Uuid,
    revision: Revision,
    session: Uuid,
    rig: Uuid,
    expected: Option<AdmissionBasis>,
) -> Result<ProjectDesired, LibraryError> {
    let desired = catalog.project_desired(project).await.unwrap();
    let mut groups = Vec::new();
    let group_id = if let Some(group) = desired.groups.iter().find(|group| group.rig_id == rig) {
        group.id
    } else {
        let id = Uuid::new_v4();
        groups.push(NewGroup {
            id,
            rig_id: rig,
            name: GroupName::new(&format!("Rig {}", desired.groups.len() + 1)).unwrap(),
            origin: GroupOrigin::Framing,
            optics: OpticsSignature::new(None, Some(250.0), None).unwrap(),
            framing: None,
        });
        id
    };
    let adds = [SessionAdd {
        session_id: session,
        group_id,
        placement: SessionPlacement::FramingUnknown,
        expected,
    }];
    catalog.add_project_sessions(project, revision, &groups, &adds).await
}

/// [`admit`] with every Unreviewed frame Usable, then [`add`].
pub async fn hold(catalog: &Catalog, project: Uuid, session: Uuid, rig: Uuid) -> ProjectDesired {
    admit(catalog, session, Quality::Usable).await;
    add(catalog, project, session, rig).await.unwrap()
}

/// Remove `session` from `project` at its current revision.
pub async fn remove(catalog: &Catalog, project: Uuid, session: Uuid) -> ProjectDesired {
    let revision = catalog.project_desired(project).await.unwrap().revision;
    catalog.remove_project_sessions(project, revision, &[session]).await.unwrap()
}
