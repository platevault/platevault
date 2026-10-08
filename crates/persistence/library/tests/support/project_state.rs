// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Project state fixture (spec 065 PRJ-FR-14): two Ha frames of NGC 7000 on
//! one confirmed rig in one confirmed session, and helpers to build Projects
//! and runs on them. Fixture files are real and only read.
#![allow(dead_code)]

use persistence_library::{Catalog, SessionQuery};
use platevault_model::{
    AssociationState, Equipment, GoalInput, GoalSpec, Location, Project, ProjectInput, Provenance,
    RunStage, Session, SubjectInput, TargetRecord,
};
use uuid::Uuid;

use super::support::{expected_session, scan, target, Fixture};

pub const HA: [&str; 2] = ["Ha_001.fits", "Ha_002.fits"];

pub struct World {
    pub fx: Fixture,
    pub catalog: Catalog,
    pub location: Location,
    pub ngc: TargetRecord,
    pub redcat: Equipment,
}

fn rig() -> Equipment {
    Equipment {
        id: Uuid::new_v4(),
        name: "RedCat 51".into(),
        camera: Some("ASI2600MM".into()),
        telescope: Some("RedCat 51".into()),
        focal_length_mm: Some(250.0),
        pixel_size_um: Some(3.76),
        sensor_width_px: None,
        sensor_height_px: None,
        color_kind: None,
        decision_revision: 0,
        state: AssociationState::Confirmed,
        provenance: Provenance::User,
    }
}

/// A frame-count goal on the NGC 7000 subject's Ha channel.
pub fn ha_frames(target: Uuid, goal_frames: u64) -> GoalInput {
    GoalInput {
        target_id: target,
        panel: None,
        goal: GoalSpec::FrameCount { channel: Some("Ha".into()), goal_frames },
    }
}

/// Two Ha frames of NGC 7000 on the `RedCat`, one session with its Target and
/// rig confirmed.
pub async fn world() -> World {
    let fx = Fixture::new();
    for name in HA {
        fx.write(name, format!("frame {name}").as_bytes());
    }
    let catalog = Catalog::open(&fx.db).await.unwrap();
    let location = catalog.register_location(&fx.registration()).await.unwrap();
    scan(&catalog, &fx, &location, &HA).await;
    let ngc = catalog.save_target(&target("NGC 7000", "ngc 7000"), None).await.unwrap();
    let redcat = catalog.save_equipment(&rig(), None).await.unwrap();
    let world = World { fx, catalog, location, ngc, redcat };
    let session = world.session().await;
    world
        .catalog
        .associate_target(&[expected_session(&session)], world.ngc.candidate.id)
        .await
        .unwrap();
    let session = world.session().await;
    world.catalog.confirm_equipment(&[expected_session(&session)], world.redcat.id).await.unwrap();
    world
}

impl World {
    /// The one session holding the Ha frames.
    pub async fn session(&self) -> Session {
        let summaries = self.catalog.list_sessions(&SessionQuery::default()).await.unwrap();
        summaries.into_iter().map(|summary| summary.session).next().unwrap()
    }

    /// An open Project named `name` on NGC 7000 and the `RedCat` with `goals`.
    pub async fn project(&self, name: &str, goals: Vec<GoalInput>) -> Project {
        let input = ProjectInput {
            name: name.into(),
            notes: None,
            subjects: vec![SubjectInput {
                target_id: self.ngc.candidate.id,
                name: None,
                mosaic: false,
                panels: Vec::new(),
            }],
            rig_ids: vec![self.redcat.id],
            goals,
        };
        self.catalog.create_project(&input).await.unwrap()
    }

    /// A run named `name` with every candidate selected and saved, moved to
    /// `stage`.
    pub async fn run(&self, project: &Project, name: &str, stage: RunStage) -> Uuid {
        let input = platevault_model::NewView {
            project_id: project.id,
            subject_id: project.subjects[0].id,
            rig_id: self.redcat.id,
            name: name.into(),
        };
        let id = self.catalog.create_view(&input).await.unwrap().view.id;
        self.catalog.save_view(id, 0, 1).await.unwrap();
        if stage != RunStage::Select {
            self.catalog.set_view_stage(id, stage).await.unwrap();
        }
        id
    }

    /// Mark the run Complete with no Running operation affecting it.
    pub async fn complete(&self, run: Uuid) {
        self.catalog.complete_view(run, |_| async { Ok(Vec::new()) }).await.unwrap();
    }

    /// Move the run to its Project's Trash with no blocker.
    pub async fn trash(&self, run: Uuid) {
        self.catalog.trash_view(run, |_| async { Ok(Vec::new()) }).await.unwrap();
    }
}
