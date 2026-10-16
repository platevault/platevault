// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Where a Project's sessions go (spec 065 PRJ-FR-27 to PRJ-FR-31; D-W95,
//! D-W107, D-W114): automatic groups by rig, optics and framing, the default
//! group names, and the group folders. Pure: the caller reads one Project
//! and the sessions to add, and the catalog records the result under the
//! Project revision it read.
//!
//! A group holds one rig with one optical setup (a rig version starts a new
//! group only when its optics change) and one framing. A new session joins
//! the framing group of its rig and optics whose anchor framing lies nearest
//! within the margins, compared with the rule intake splits sessions by;
//! anchors are compared non-transitively, so drift never chains groups
//! together. Otherwise it anchors a new group. A session without pointing
//! joins its rig's first group of that optics flagged "Framing unknown"
//! (provisional, PRJ-FR-31). A user's group and a user's move are never
//! recomputed: placement only considers framing groups, and only for new
//! sessions.

use std::collections::BTreeMap;

use persistence_library::{NewGroup, SessionAdd};
use uuid::Uuid;

use crate::grouping::framing_offset;
use crate::layout::{folder_token, group_folder, name_key};
use crate::{
    AdmissionBasis, FramingEvidence, FramingMargins, GroupKeywords, GroupName, GroupOrigin,
    LibraryError, OpticsSignature, ProjectDesired, ProjectGroup, SessionPlacement,
};

/// What placement reads about one session to add.
#[derive(Clone, Debug, PartialEq)]
pub struct SessionToPlace {
    pub session_id: Uuid,
    /// The confirmed rig and its name, for default group names.
    pub rig_id: Uuid,
    pub rig_name: String,
    /// The optics of the rig version the session was captured with; every
    /// part unknown when the version is.
    pub optics: OpticsSignature,
    /// `None` for a session without pointing.
    pub framing: Option<FramingEvidence>,
    /// The basis the user reviewed, carried to the add.
    pub expected: Option<AdmissionBasis>,
}

/// The groups an add creates and where each session goes.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct PlacementPlan {
    pub groups: Vec<NewGroup>,
    pub adds: Vec<SessionAdd>,
}

/// A group placement can choose: the Project's own and those planned.
struct Candidate {
    id: Uuid,
    rig_id: Uuid,
    origin: GroupOrigin,
    optics: OpticsSignature,
    framing: Option<FramingEvidence>,
}

impl From<&ProjectGroup> for Candidate {
    fn from(group: &ProjectGroup) -> Self {
        Self {
            id: group.id,
            rig_id: group.rig_id,
            origin: group.origin,
            optics: group.optics.clone(),
            framing: group.framing,
        }
    }
}

/// Place `sessions`, in order, into the Project's framing groups or new
/// ones (PRJ-FR-31). New groups take their default names (PRJ-FR-27).
///
/// # Errors
/// `InvalidInput` when a default name leaves no folder name.
pub fn place_sessions(
    desired: &ProjectDesired,
    sessions: &[SessionToPlace],
    margins: &FramingMargins,
) -> Result<PlacementPlan, LibraryError> {
    let mut candidates: Vec<Candidate> = desired.groups.iter().map(Candidate::from).collect();
    let mut names: Vec<GroupName> = desired.groups.iter().map(|group| group.name.clone()).collect();
    let mut plan = PlacementPlan::default();
    for session in sessions {
        let fits = |candidate: &&Candidate| {
            candidate.origin == GroupOrigin::Framing
                && candidate.rig_id == session.rig_id
                && candidate.optics == session.optics
        };
        let joined = match &session.framing {
            Some(framing) => nearest(candidates.iter().filter(fits), framing, margins)
                .map(|group| (group, SessionPlacement::Framing)),
            None => candidates
                .iter()
                .find(fits)
                .map(|group| (group.id, SessionPlacement::FramingUnknown)),
        };
        let (group_id, placement) = if let Some(joined) = joined {
            joined
        } else {
            let rig_groups = candidates.iter().filter(|c| c.rig_id == session.rig_id).count();
            let name = automatic_name(&names, &session.rig_name, rig_groups)?;
            let group = NewGroup {
                id: Uuid::new_v4(),
                rig_id: session.rig_id,
                name: name.clone(),
                origin: GroupOrigin::Framing,
                optics: session.optics.clone(),
                framing: session.framing,
            };
            candidates.push(Candidate {
                id: group.id,
                rig_id: group.rig_id,
                origin: group.origin,
                optics: group.optics.clone(),
                framing: group.framing,
            });
            names.push(name);
            let placement = if session.framing.is_some() {
                SessionPlacement::Framing
            } else {
                SessionPlacement::FramingUnknown
            };
            let id = group.id;
            plan.groups.push(group);
            (id, placement)
        };
        plan.adds.push(SessionAdd {
            session_id: session.session_id,
            group_id,
            placement,
            expected: session.expected,
        });
    }
    Ok(plan)
}

/// The framing group whose anchor lies nearest within the margins; the
/// earlier group on a tie. A group without a framing anchors nothing.
fn nearest<'a>(
    groups: impl Iterator<Item = &'a Candidate>,
    framing: &FramingEvidence,
    margins: &FramingMargins,
) -> Option<Uuid> {
    let mut best: Option<(f64, Uuid)> = None;
    for group in groups {
        let Some(anchor) = &group.framing else { continue };
        let Some(offset) = framing_offset(anchor, framing, margins) else { continue };
        if best.is_none_or(|(nearest, _)| offset < nearest) {
            best = Some((offset, group.id));
        }
    }
    best.map(|(_, id)| id)
}

/// The first of `candidates` whose name and folder no group already has.
fn first_free(
    names: &[GroupName],
    candidates: impl Iterator<Item = String>,
) -> Result<GroupName, LibraryError> {
    for candidate in candidates {
        let name = GroupName::new(&candidate)?;
        if free(names, &name)? {
            return Ok(name);
        }
    }
    unreachable!("default group names are unbounded")
}

/// No group has the name or a name with the same folder.
fn free(names: &[GroupName], name: &GroupName) -> Result<bool, LibraryError> {
    let folder = name_key(&folder_token(name)?);
    Ok(!names.iter().any(|taken| {
        taken.key() == name.key()
            || matches!(folder_token(taken), Ok(token) if name_key(&token) == folder)
    }))
}

/// A new framing group's default name: the rig's name for its first group,
/// then "<Rig> · Framing N" (PRJ-FR-27).
fn automatic_name(
    names: &[GroupName],
    rig: &str,
    rig_groups: usize,
) -> Result<GroupName, LibraryError> {
    let first = (rig_groups == 0).then(|| rig.to_owned());
    let numbered = (rig_groups.max(1) + 1..).map(|n| format!("{rig} · Framing {n}"));
    first_free(names, first.into_iter().chain(numbered))
}

/// A user split's default name, "<Rig> · 2" and up (PRJ-FR-27).
///
/// # Errors
/// `InvalidInput` when the rig's name leaves no folder name.
pub fn split_name(desired: &ProjectDesired, rig: &str) -> Result<GroupName, LibraryError> {
    let names: Vec<GroupName> = desired.groups.iter().map(|group| group.name.clone()).collect();
    first_free(&names, (2..).map(|n| format!("{rig} · {n}")))
}

/// A mosaic panel's default name, "Panel N": the number the capture name
/// gives when it names a free one, else the next free number (PRJ-FR-27).
///
/// # Errors
/// Never in practice; `InvalidInput` only for an unusable name.
pub fn panel_name(
    desired: &ProjectDesired,
    group: Uuid,
    capture_name: Option<&str>,
) -> Result<GroupName, LibraryError> {
    let names: Vec<GroupName> = desired
        .groups
        .iter()
        .filter(|other| other.id != group)
        .map(|other| other.name.clone())
        .collect();
    let hinted = capture_name.and_then(panel_number).map(|n| format!("Panel {n}"));
    let panels = desired.groups.iter().filter(|other| other.panel && other.id != group).count();
    let numbered = (panels + 1..).map(|n| format!("Panel {n}"));
    first_free(&names, hinted.into_iter().chain(numbered))
}

/// The N of a "Panel N" a capture name carries, as NINA's mosaic names do.
fn panel_number(name: &str) -> Option<u32> {
    let lower = name.to_lowercase();
    let at = lower.find("panel")?;
    let digits: String = lower[at + "panel".len()..]
        .trim_start_matches(|c: char| c.is_whitespace() || c == '_' || c == '-' || c == '#')
        .chars()
        .take_while(char::is_ascii_digit)
        .collect();
    digits.parse().ok().filter(|n| *n > 0)
}

/// Refuse group names that would share a folder (D-W114): two names the
/// layout turns into one token would silently collapse two groups.
///
/// # Errors
/// `InvalidInput` naming both groups, or a name that leaves no folder name.
pub fn require_distinct_folders<'a>(
    names: impl IntoIterator<Item = &'a GroupName>,
) -> Result<(), LibraryError> {
    let mut seen: BTreeMap<String, &GroupName> = BTreeMap::new();
    for name in names {
        let key = name_key(&folder_token(name)?);
        if let Some(other) = seen.insert(key, name) {
            return Err(LibraryError::InvalidInput(format!(
                "groups '{}' and '{}' would share one folder; choose another name",
                other.as_str(),
                name.as_str()
            )));
        }
    }
    Ok(())
}

/// Each group's folder with the keyword names in effect, `GROUP_<name>` or
/// `PANEL_<name>`; `None` for every group of a one-group Project, which has
/// no group folder level, even for a mosaic panel (PRJ-FR-28, D-W114).
///
/// # Errors
/// `InvalidInput` for a name that leaves no folder name.
pub fn group_folders(
    desired: &ProjectDesired,
    keywords: &GroupKeywords,
) -> Result<Vec<(Uuid, Option<String>)>, LibraryError> {
    let several = desired.groups.len() > 1;
    desired
        .groups
        .iter()
        .map(|group| {
            let folder =
                several.then(|| group_folder(keywords, &group.name, group.panel)).transpose()?;
            Ok((group.id, folder))
        })
        .collect()
}
