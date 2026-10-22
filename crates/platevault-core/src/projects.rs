// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Projects (spec 065, 066): their inputs, and the Project as a reference
//! source for Retire location review.
//!
//! A Project's inputs are edited through the catalog under the Project
//! revision (`persistence_library::project_inputs`). The edits here add the
//! core rules: where an added session goes and what a new group is called
//! ([`crate::project_groups`]), that no two groups share a folder, and that
//! the View step's processing location is absolute ([`crate::layout`]). The
//! catalog's own edits (remove or move sessions, frame choices, an empty
//! group's removal) need no core rule and are called directly. No edit
//! touches the View: once it exists, each reads as a pending change until
//! Apply (D-W100).
//!
//! A panel map derives its display geometry from groups' anchor framings
//! (PRJ-FR-29; VSEL-FR-07), alongside the Sessions step's derived data.
//!

use std::collections::BTreeSet;
use std::sync::Arc;

use persistence_library::{Catalog, NewGroup, SessionAdd};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::layout;
use crate::library::{AssetReferences, Library, ReferencesFuture};
use crate::project_groups::{
    group_folders, panel_name, place_sessions, require_distinct_folders, split_name, PlacementPlan,
    SessionToPlace,
};
use crate::{
    AdmissionBasis, AdmissionRefusal, ExpectedSession, FramingEvidence, GroupKeywords, GroupName,
    GroupOrigin, LibraryError, OpticsSignature, PendingChange, Project, ProjectAdded,
    ProjectDesired, ProjectGroup, ProjectInput, ProjectSuggestion, ProjectViewSettings,
    ReferenceKind, Revision, SessionPlacement,
};

/// One session to add, at the admission basis the user saw (`None` takes
/// the current one).
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct SessionToAdd {
    pub session_id: Uuid,
    #[serde(default)]
    pub expected: Option<AdmissionBasis>,
}

/// One group's folder in the next View; `None` while the Project has one
/// group (D-W114).
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct GroupFolder {
    pub group_id: Uuid,
    pub folder: Option<String>,
}

/// A Project's Sessions step (PRJ-FR-07, VSEL-FR-02): its inputs, derived
/// folders and panel outlines, pending changes, suggestions and adjustable
/// mosaic panel offers.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct ProjectInputs {
    pub desired: ProjectDesired,
    pub keywords: GroupKeywords,
    pub folders: Vec<GroupFolder>,
    pub pending: Vec<PendingChange>,
    pub suggestions: Vec<ProjectSuggestion>,
    pub panels: Vec<crate::project_groups::PanelOutline>,
    pub panel_offers: Vec<crate::project_groups::PanelOffer>,
}

const UNKNOWN_OPTICS: OpticsSignature =
    OpticsSignature { camera_id: None, focal_length_mm: None, reducer: None };

impl Library {
    /// The Project's Sessions step. Read-only.
    ///
    /// # Errors
    /// `NotFound` for an unknown Project; `PersistenceFailure` for a corrupt
    /// record.
    pub async fn project_inputs(&self, id: Uuid) -> Result<ProjectInputs, LibraryError> {
        let catalog = self.catalog();
        let desired = catalog.project_desired(id).await?;
        let workflow = catalog.workflow_settings().await?.0;
        let keywords =
            desired.settings.keywords.clone().unwrap_or_else(|| workflow.keywords.clone());
        let folders = group_folders(&desired, &keywords)?
            .into_iter()
            .map(|(group_id, folder)| GroupFolder { group_id, folder })
            .collect();
        let panels =
            desired.groups.iter().filter_map(crate::project_groups::panel_outline).collect();
        let panel_offers = crate::project_groups::panel_offers(&desired.groups, &workflow.framing);
        let pending = catalog.project_pending_changes(id).await?;
        let suggestions = catalog.project_suggestions(id).await?;
        Ok(ProjectInputs { desired, keywords, folders, pending, suggestions, panels, panel_offers })
    }

    /// Add whole sessions to Project `id` in one edit (PRJ-FR-08): each into
    /// `group` when given, which is the user's choice, else into the framing
    /// group of its rig and optics, or a new one with its default name
    /// (PRJ-FR-27, PRJ-FR-31). Only a Ready session with settled calibration
    /// joins, at the basis the user saw; the catalog checks it inside the
    /// write. Its Target and rig join the Project when it lacks them.
    ///
    /// # Errors
    /// `InvalidInput` naming every admission blocker, or for a session with
    /// no confirmed rig; otherwise as `Catalog::add_project_sessions`.
    pub async fn add_project_sessions(
        &self,
        id: Uuid,
        expected: Revision,
        sessions: &[SessionToAdd],
        group: Option<Uuid>,
    ) -> Result<ProjectDesired, LibraryError> {
        let catalog = self.catalog();
        let desired = catalog.project_desired(id).await?;
        let plan = self.placement(&desired.groups, sessions, group).await?;
        catalog.add_project_sessions(id, expected, &plan.groups, &plan.adds).await
    }

    /// Add to Project from a session row (LIB-FR-17, PRJ-FR-08, PRJ-FR-19):
    /// the session joins whole, placed as [`Self::add_project_sessions`]
    /// places it, with its Target as a subject and its rig when the Project
    /// lacks them, in one Project revision. Only a session whose calibration
    /// is settled joins. It commits only on the session and Project revision
    /// the user previewed (`Catalog::preview_project_addition`).
    ///
    /// # Errors
    /// `InvalidInput` naming every admission blocker, such as the calibration
    /// kinds to choose first, or for a session with no confirmed rig;
    /// otherwise as `Catalog::add_session_to_project`.
    pub async fn add_session_to_project(
        &self,
        session: &ExpectedSession,
        project_id: Uuid,
        expected_revision: Revision,
    ) -> Result<ProjectAdded, LibraryError> {
        let catalog = self.catalog();
        let desired = catalog.project_desired(project_id).await?;
        let add = [SessionToAdd { session_id: session.session_id, expected: None }];
        let plan = self.placement(&desired.groups, &add, None).await?;
        catalog
            .add_session_to_project(
                session,
                project_id,
                expected_revision,
                &plan.groups,
                &plan.adds,
            )
            .await
    }

    /// Create Project from a session row (LIB-FR-17, PRJ-FR-01): the Project
    /// `input` describes, as `Catalog::project_prefill` prefills it, holding
    /// the session in a new group of its rig, all at revision 1. Like Add to
    /// Project it holds only a session whose calibration is settled;
    /// otherwise no Project is saved.
    ///
    /// # Errors
    /// As [`Self::add_session_to_project`], and as `Catalog::create_project`
    /// for the input.
    pub async fn create_project_from_session(
        &self,
        input: &ProjectInput,
        session: &ExpectedSession,
    ) -> Result<Project, LibraryError> {
        let add = [SessionToAdd { session_id: session.session_id, expected: None }];
        let plan = self.placement(&[], &add, None).await?;
        self.catalog().create_project_with_session(input, session, &plan.groups, &plan.adds).await
    }

    /// Where `sessions` go in a Project with `groups`: into `group` when
    /// given, else as [`place_sessions`] places them, with every group's
    /// folder still distinct.
    async fn placement(
        &self,
        groups: &[ProjectGroup],
        sessions: &[SessionToAdd],
        group: Option<Uuid>,
    ) -> Result<PlacementPlan, LibraryError> {
        let margins = self.catalog().workflow_settings().await?.0.framing;
        let mut places = Vec::with_capacity(sessions.len());
        for session in sessions {
            places.push(self.session_to_place(session).await?);
        }
        let plan = match group {
            Some(group_id) => PlacementPlan {
                groups: Vec::new(),
                adds: places
                    .iter()
                    .map(|place| SessionAdd {
                        session_id: place.session_id,
                        group_id,
                        placement: SessionPlacement::User,
                        expected: place.expected,
                    })
                    .collect(),
            },
            None => place_sessions(groups, &places, &margins)?,
        };
        require_distinct_folders(
            groups.iter().map(|group| &group.name).chain(plan.groups.iter().map(|g| &g.name)),
        )?;
        Ok(plan)
    }

    /// Create a group on `rig_id`, named by the user, and move `sessions` of
    /// that rig into it (PRJ-FR-27). It takes the optics and framing of the
    /// group the first session leaves, else the rig's latest version.
    ///
    /// # Errors
    /// `InvalidInput` for a blank name or one sharing another group's folder;
    /// otherwise as `Catalog::create_project_group`.
    pub async fn create_project_group(
        &self,
        id: Uuid,
        expected: Revision,
        rig_id: Uuid,
        name: &str,
        sessions: &[Uuid],
    ) -> Result<ProjectDesired, LibraryError> {
        let desired = self.catalog().project_desired(id).await?;
        let name = GroupName::new(name)?;
        let source = sessions.first().and_then(|session| group_of(&desired, *session));
        let (optics, framing) = match source {
            Some(group) => (group.optics.clone(), group.framing),
            None => (self.latest_optics(rig_id).await?, None),
        };
        self.create_group(&desired, expected, rig_id, name, optics, framing, sessions).await
    }

    /// Split `sessions` off their group into a new group of the same rig,
    /// optics and framing, named `name` or by default "<Rig> · 2" (PRJ-FR-27).
    ///
    /// # Errors
    /// `InvalidInput` for no session, a session of another group, or a name
    /// sharing another group's folder; `NotFound` for an unknown group;
    /// otherwise as `Catalog::create_project_group`.
    pub async fn split_project_group(
        &self,
        id: Uuid,
        expected: Revision,
        group_id: Uuid,
        sessions: &[Uuid],
        name: Option<&str>,
    ) -> Result<ProjectDesired, LibraryError> {
        let desired = self.catalog().project_desired(id).await?;
        let source = desired
            .groups
            .iter()
            .find(|group| group.id == group_id)
            .ok_or_else(|| LibraryError::NotFound(format!("group {group_id} of project {id}")))?
            .clone();
        if sessions.is_empty() {
            return Err(LibraryError::InvalidInput("a split moves at least one session".into()));
        }
        if let Some(stray) = sessions
            .iter()
            .find(|session| group_of(&desired, **session).map(|g| g.id) != Some(group_id))
        {
            return Err(LibraryError::InvalidInput(format!(
                "session {stray} is not in group {}",
                source.name.as_str()
            )));
        }
        let name = match name {
            Some(name) => GroupName::new(name)?,
            None => split_name(&desired, &self.catalog().equipment(source.rig_id).await?.name)?,
        };
        self.create_group(
            &desired,
            expected,
            source.rig_id,
            name,
            source.optics.clone(),
            source.framing,
            sessions,
        )
        .await
    }

    /// Rename a group; its folder changes on the next Apply (PRJ-FR-27).
    ///
    /// # Errors
    /// `InvalidInput` for a blank name or one sharing another group's folder;
    /// otherwise as `Catalog::rename_project_group`.
    pub async fn rename_project_group(
        &self,
        id: Uuid,
        expected: Revision,
        group_id: Uuid,
        name: &str,
    ) -> Result<ProjectDesired, LibraryError> {
        let desired = self.catalog().project_desired(id).await?;
        let name = GroupName::new(name)?;
        require_renamed_folders(&desired, group_id, &name)?;
        self.catalog().rename_project_group(id, expected, group_id, &name).await
    }

    /// Mark a group a mosaic panel, or not (PRJ-FR-29). Marking it names it
    /// `name`, or by default "Panel N" from its sessions' capture name or
    /// numbered (PRJ-FR-27); unmarking keeps the name unless one is given.
    ///
    /// # Errors
    /// `InvalidInput` for a blank name or one sharing another group's folder;
    /// `NotFound` for an unknown group; otherwise as
    /// `Catalog::set_project_group_panel`.
    pub async fn set_project_group_panel(
        &self,
        id: Uuid,
        expected: Revision,
        group_id: Uuid,
        panel: bool,
        name: Option<&str>,
    ) -> Result<ProjectDesired, LibraryError> {
        let catalog = self.catalog();
        let desired = catalog.project_desired(id).await?;
        if desired.groups.iter().all(|group| group.id != group_id) {
            return Err(LibraryError::NotFound(format!("group {group_id} of project {id}")));
        }
        let name = match name {
            Some(name) => Some(GroupName::new(name)?),
            None if panel => {
                let capture_name = self.capture_name(&desired, group_id).await?;
                Some(panel_name(&desired, group_id, capture_name.as_deref())?)
            }
            None => None,
        };
        if let Some(name) = &name {
            require_renamed_folders(&desired, group_id, name)?;
        }
        catalog.set_project_group_panel(id, expected, group_id, panel, name.as_ref()).await
    }

    /// The View step's settings (VSEL-FR-16, PREP-FR-04/06, PRJ-FR-28). The
    /// processing location must be absolute, as the Project folder is made in
    /// it; a relative one is refused here, where the user chose it, and
    /// nothing is stored.
    ///
    /// # Errors
    /// `InvalidInput` naming the processing location when it is relative, or
    /// for one that is not a path of this operating system; otherwise as
    /// `Catalog::set_project_view_settings`.
    pub async fn set_project_view_settings(
        &self,
        id: Uuid,
        expected: Revision,
        settings: &ProjectViewSettings,
    ) -> Result<ProjectDesired, LibraryError> {
        if let Some(parent) = &settings.parent {
            layout::require_absolute_processing_location(&parent.to_path_buf()?)?;
        }
        self.catalog().set_project_view_settings(id, expected, settings).await
    }

    /// What placement reads about one session to add: its confirmed rig,
    /// the optics of the rig version it was captured with, and its framing.
    async fn session_to_place(&self, add: &SessionToAdd) -> Result<SessionToPlace, LibraryError> {
        let catalog = self.catalog();
        let admission = catalog.session_admission(add.session_id).await?;
        let Some(rig_id) = admission.intake.rig_id else {
            return Err(AdmissionRefusal {
                session_id: add.session_id,
                blockers: admission.blockers,
            }
            .into());
        };
        let optics = catalog
            .session_rig_version(add.session_id)
            .await?
            .map_or(UNKNOWN_OPTICS, |version| version.optics);
        let detail = catalog.session(add.session_id).await?;
        Ok(SessionToPlace {
            session_id: add.session_id,
            rig_id,
            rig_name: catalog.equipment(rig_id).await?.name,
            optics,
            framing: detail.summary.session.framing.as_ref().map(FramingEvidence::from),
            expected: add.expected,
        })
    }

    /// The optics of the rig's latest version; unknown without one.
    async fn latest_optics(&self, rig_id: Uuid) -> Result<OpticsSignature, LibraryError> {
        let versions = self.catalog().rig_versions(rig_id).await?;
        Ok(versions
            .into_iter()
            .max_by_key(|version| version.valid_from)
            .map_or(UNKNOWN_OPTICS, |version| version.optics))
    }

    /// The first OBJECT a light of the group's sessions records: NINA names
    /// mosaic panels there.
    async fn capture_name(
        &self,
        desired: &ProjectDesired,
        group_id: Uuid,
    ) -> Result<Option<String>, LibraryError> {
        for member in desired.sessions.iter().filter(|member| member.group_id == group_id) {
            let detail = self.catalog().session(member.session_id).await?;
            if let Some(object) =
                detail.assets.iter().find_map(|asset| asset.effective.object.clone())
            {
                return Ok(Some(object));
            }
        }
        Ok(None)
    }

    #[allow(clippy::too_many_arguments)]
    async fn create_group(
        &self,
        desired: &ProjectDesired,
        expected: Revision,
        rig_id: Uuid,
        name: GroupName,
        optics: OpticsSignature,
        framing: Option<FramingEvidence>,
        sessions: &[Uuid],
    ) -> Result<ProjectDesired, LibraryError> {
        require_distinct_folders(desired.groups.iter().map(|group| &group.name).chain([&name]))?;
        let group = NewGroup {
            id: Uuid::new_v4(),
            rig_id,
            name,
            origin: GroupOrigin::User,
            optics,
            framing,
        };
        self.catalog().create_project_group(desired.project_id, expected, &group, sessions).await
    }
}

/// The group a held session sits in.
fn group_of(desired: &ProjectDesired, session: Uuid) -> Option<&ProjectGroup> {
    let member = desired.sessions.iter().find(|member| member.session_id == session)?;
    desired.groups.iter().find(|group| group.id == member.group_id)
}

/// Every group's folder stays distinct once `group_id` is named `name`.
fn require_renamed_folders(
    desired: &ProjectDesired,
    group_id: Uuid,
    name: &GroupName,
) -> Result<(), LibraryError> {
    require_distinct_folders(
        desired
            .groups
            .iter()
            .filter(|group| group.id != group_id)
            .map(|group| &group.name)
            .chain([name]),
    )
}

pub(crate) struct ProjectReferences {
    pub(crate) catalog: Arc<Catalog>,
}

impl AssetReferences for ProjectReferences {
    fn kind(&self) -> ReferenceKind {
        ReferenceKind::Project
    }

    fn references_to<'a>(&'a self, assets: &'a BTreeSet<Uuid>) -> ReferencesFuture<'a> {
        Box::pin(self.catalog.project_references(assets))
    }
}

/// Adopted masters (spec 068) as a reference source for Retire location review:
/// an adopted master holds the library copies it was generated from.
pub(crate) struct CalibrationReferences {
    pub(crate) catalog: Arc<Catalog>,
}

impl AssetReferences for CalibrationReferences {
    fn kind(&self) -> ReferenceKind {
        ReferenceKind::Calibration
    }

    fn references_to<'a>(&'a self, assets: &'a BTreeSet<Uuid>) -> ReferencesFuture<'a> {
        Box::pin(self.catalog.calibration_references(assets))
    }
}
