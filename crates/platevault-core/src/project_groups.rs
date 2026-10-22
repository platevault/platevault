// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Where a Project's sessions go (spec 065 PRJ-FR-27 to PRJ-FR-31; D-W95,
//! D-W107, D-W114): automatic groups by rig, optics and framing and the
//! default group names and group folders. Pure: the caller reads one Project
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
use serde::{Deserialize, Serialize};
use skymath::{gnomonic_unproject, Angle, Equatorial, GnomonicPoint};
use uuid::Uuid;

use crate::grouping::framing_offset;
use crate::layout::{folder_token, group_folder, name_key};
use crate::{
    AdmissionBasis, FramingEvidence, FramingMargins, GroupKeywords, GroupName, GroupOrigin,
    LibraryError, OpticsSignature, ProjectDesired, ProjectGroup, SessionPlacement,
};
use targeting::matching::PANEL_OVERLAP_TOLERANCE_PERCENT;

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

/// Place `sessions`, in order, into the framing groups among a Project's
/// `groups` or new ones (PRJ-FR-31). New groups take their default names
/// (PRJ-FR-27).
///
/// # Errors
/// `InvalidInput` when a default name leaves no folder name.
pub fn place_sessions(
    groups: &[ProjectGroup],
    sessions: &[SessionToPlace],
    margins: &FramingMargins,
) -> Result<PlacementPlan, LibraryError> {
    let mut candidates: Vec<Candidate> = groups.iter().map(Candidate::from).collect();
    let mut names: Vec<GroupName> = groups.iter().map(|group| group.name.clone()).collect();
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
/// One corner of a [`PanelOutline`], in ICRS degrees.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct OutlineCorner {
    pub ra_deg: f64,
    pub dec_deg: f64,
}
/// A panel group's outline on a mosaic's panel map (decision record §2): the
/// anchor's field around the anchor centre, turned by the anchor's sky
/// position angle east of north. Nothing is stitched.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct PanelOutline {
    pub group_id: Uuid,
    pub corners: Vec<OutlineCorner>,
    pub sky_angle_deg: f64,
}

/// `group`'s outline for the panel map. `None` for a group that isn't a
/// panel, or whose framing, field or sky angle is unknown: the mechanical
/// ROTATANG angle gives no orientation on the sky.
#[must_use]
pub fn panel_outline(group: &ProjectGroup) -> Option<PanelOutline> {
    let framing = group.framing.filter(|_| group.panel)?;
    panel_group_outline(group, framing.sky_angle_deg?)
}

/// Shared footprint outline keeps the sky projection identical to the panel map.
fn panel_group_outline(group: &ProjectGroup, angle_deg: f64) -> Option<PanelOutline> {
    let framing = group.framing?;
    let field = framing.field?;
    let anchor = Equatorial::j2000(
        Angle::from_degrees(framing.ra_deg),
        Angle::from_degrees(framing.dec_deg),
    )
    .ok()?;
    let half_x = (field.width_deg / 2.0).to_radians().tan();
    let half_y = (field.height_deg / 2.0).to_radians().tan();
    if !(half_x.is_finite() && half_y.is_finite() && half_x > 0.0 && half_y > 0.0) {
        return None;
    }
    let (sin, cos) = angle_deg.to_radians().sin_cos();
    let corners = [(-half_x, -half_y), (half_x, -half_y), (half_x, half_y), (-half_x, half_y)]
        .into_iter()
        .map(|(x, y)| {
            let point = GnomonicPoint { east: x * cos + y * sin, north: -x * sin + y * cos };
            gnomonic_unproject(anchor, point).map(|corner| OutlineCorner {
                ra_deg: corner.ra().degrees(),
                dec_deg: corner.dec().degrees(),
            })
        })
        .collect::<Option<Vec<_>>>()?;
    Some(PanelOutline { group_id: group.id, corners, sky_angle_deg: angle_deg })
}
/// A suggestion that two group framings could be panels of one mosaic.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct PanelOffer {
    pub left_group_id: Uuid,
    pub right_group_id: Uuid,
    pub overlap_percent: f64,
}

/// Groups whose framing footprints overlap within the adjustable panel range,
/// bounds included within `PANEL_OVERLAP_TOLERANCE_PERCENT` (PRJ-FR-29).
#[must_use]
pub fn panel_offers(groups: &[ProjectGroup], margins: &FramingMargins) -> Vec<PanelOffer> {
    let footprints: Vec<Option<target_match::SkyFootprint>> =
        groups.iter().map(panel_footprint).collect();
    let (minimum, maximum) = margins.panel_overlap_percent;
    let offered =
        (minimum - PANEL_OVERLAP_TOLERANCE_PERCENT)..=(maximum + PANEL_OVERLAP_TOLERANCE_PERCENT);
    let mut offers = Vec::new();
    for left in 0..groups.len() {
        let Some(left_footprint) = footprints[left].as_ref() else { continue };
        for right in left + 1..groups.len() {
            let Some(right_footprint) = footprints[right].as_ref() else { continue };
            let Ok(comparison) = target_match::compare_footprints(left_footprint, right_footprint)
            else {
                continue;
            };
            let overlap_percent = comparison.normalized_coverage * 100.0;
            if offered.contains(&overlap_percent) {
                offers.push(PanelOffer {
                    left_group_id: groups[left].id,
                    right_group_id: groups[right].id,
                    overlap_percent,
                });
            }
        }
    }
    offers
}
/// Construct the anchor framing's footprint, using sky position angle only.
/// ROTATANG alone is not an orientation on the sky.
fn panel_footprint(group: &ProjectGroup) -> Option<target_match::SkyFootprint> {
    let framing = group.framing?;
    let angle_deg = framing.sky_angle_deg?;
    let outline = panel_group_outline(group, angle_deg)?;
    let anchor = target_match::skymath::Equatorial::j2000(
        target_match::skymath::Angle::from_degrees(framing.ra_deg),
        target_match::skymath::Angle::from_degrees(framing.dec_deg),
    )
    .ok()?;
    let corners = outline
        .corners
        .into_iter()
        .map(|corner| {
            target_match::skymath::Equatorial::j2000(
                target_match::skymath::Angle::from_degrees(corner.ra_deg),
                target_match::skymath::Angle::from_degrees(corner.dec_deg),
            )
            .ok()
        })
        .collect::<Option<Vec<_>>>()?;
    target_match::SkyFootprint::new(
        anchor,
        corners,
        target_match::skymath::Angle::from_degrees(angle_deg),
        target_match::ImageParity::Direct,
        target_match::FootprintProvenance::new(group.id.to_string()).ok()?,
    )
    .ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::FieldOfView;
    use target_match::{compare_footprints, FootprintProvenance, ImageParity, SkyFootprint};

    fn framing(dec_deg: f64) -> FramingEvidence {
        FramingEvidence {
            ra_deg: 100.0,
            dec_deg,
            rotator_deg: None,
            sky_angle_deg: Some(0.0),
            field: Some(FieldOfView { width_deg: 3.0, height_deg: 2.0 }),
        }
    }

    fn footprint(framing: FramingEvidence) -> SkyFootprint {
        let anchor = target_match::skymath::Equatorial::j2000(
            target_match::skymath::Angle::from_degrees(framing.ra_deg),
            target_match::skymath::Angle::from_degrees(framing.dec_deg),
        )
        .unwrap();
        let field = framing.field.unwrap();
        let (half_x, half_y) = (
            (field.width_deg / 2.0).to_radians().tan(),
            (field.height_deg / 2.0).to_radians().tan(),
        );
        let corners = [(-half_x, -half_y), (half_x, -half_y), (half_x, half_y), (-half_x, half_y)]
            .into_iter()
            .map(|(east, north)| {
                target_match::skymath::gnomonic_unproject(
                    anchor,
                    target_match::skymath::GnomonicPoint { east, north },
                )
                .unwrap()
            })
            .collect();
        SkyFootprint::new(
            anchor,
            corners,
            target_match::skymath::Angle::from_degrees(0.0),
            ImageParity::Direct,
            FootprintProvenance::new("test").unwrap(),
        )
        .unwrap()
    }

    fn framing_pair_at_coverage(percent: f64) -> [ProjectGroup; 2] {
        let left = framing(44.3);
        let left_footprint = footprint(left);
        let mut low = 0.0;
        let mut high = 2.0;
        for _ in 0..48 {
            let middle = f64::midpoint(low, high);
            let coverage = compare_footprints(&left_footprint, &footprint(framing(44.3 + middle)))
                .unwrap()
                .normalized_coverage;
            if coverage * 100.0 > percent {
                low = middle;
            } else {
                high = middle;
            }
        }
        let group = |id, framing| ProjectGroup {
            id: Uuid::from_u128(id),
            rig_id: Uuid::from_u128(9),
            name: GroupName::new("Group").unwrap(),
            panel: false,
            origin: GroupOrigin::Framing,
            optics: OpticsSignature::new(None, None, None).unwrap(),
            framing: Some(framing),
            position: 0,
        };
        [group(1, left), group(2, framing(44.3 + f64::midpoint(low, high)))]
    }

    fn overlap_percent(groups: &[ProjectGroup; 2]) -> f64 {
        compare_footprints(
            &footprint(groups[0].framing.unwrap()),
            &footprint(groups[1].framing.unwrap()),
        )
        .unwrap()
        .normalized_coverage
            * 100.0
    }

    #[test]
    fn panel_offers_follow_inclusive_settings_range_without_marking_groups() {
        for percent in [5.0, 40.0] {
            let groups = framing_pair_at_coverage(percent);
            assert!((overlap_percent(&groups) - percent).abs() < 1e-8);
            let offers = panel_offers(&groups, &FramingMargins::default());
            assert_eq!(offers.len(), 1, "overlap {percent}%");
            assert_eq!(
                (offers[0].left_group_id, offers[0].right_group_id),
                (groups[0].id, groups[1].id)
            );
            assert!((offers[0].overlap_percent - percent).abs() < 1e-8);
            assert!(groups.iter().all(|group| !group.panel), "offers are suggestions only");

            let measured = overlap_percent(&groups);
            let lower_edge = FramingMargins {
                panel_overlap_percent: (measured, measured + 1.0),
                ..FramingMargins::default()
            };
            let upper_edge = FramingMargins {
                panel_overlap_percent: (measured - 1.0, measured),
                ..FramingMargins::default()
            };
            assert_eq!(panel_offers(&groups, &lower_edge).len(), 1, "inclusive lower bound");
            assert_eq!(panel_offers(&groups, &upper_edge).len(), 1, "inclusive upper bound");
        }

        for percent in [4.0, 41.0] {
            assert!(
                panel_offers(&framing_pair_at_coverage(percent), &FramingMargins::default(),)
                    .is_empty(),
                "overlap {percent}% is outside the default offer range"
            );
        }

        let groups = framing_pair_at_coverage(15.0);
        assert_eq!(panel_offers(&groups, &FramingMargins::default()).len(), 1);
        let changed =
            FramingMargins { panel_overlap_percent: (20.0, 30.0), ..FramingMargins::default() };
        assert!(
            panel_offers(&groups, &changed).is_empty(),
            "changed Settings range changes offers"
        );
    }

    /// PRJ-FR-29's bounds are inclusive up to `PANEL_OVERLAP_TOLERANCE_PERCENT`:
    /// an overlap less than that past a bound is on it, twice that is outside.
    #[test]
    fn panel_range_bounds_hold_within_the_float_tolerance_and_not_beyond() {
        let groups = framing_pair_at_coverage(20.0);
        let measured = overlap_percent(&groups);
        let offered = |range: (f64, f64)| {
            let margins =
                FramingMargins { panel_overlap_percent: range, ..FramingMargins::default() };
            panel_offers(&groups, &margins).len() == 1
        };
        let within = PANEL_OVERLAP_TOLERANCE_PERCENT / 2.0;
        let beyond = PANEL_OVERLAP_TOLERANCE_PERCENT * 2.0;

        assert!(offered((measured + within, measured + 1.0)), "just inside the lower bound");
        assert!(!offered((measured + beyond, measured + 1.0)), "just outside the lower bound");
        assert!(offered((measured - 1.0, measured - within)), "just inside the upper bound");
        assert!(!offered((measured - 1.0, measured - beyond)), "just outside the upper bound");
    }

    fn group(panel: bool, sky_angle_deg: Option<f64>) -> ProjectGroup {
        ProjectGroup {
            id: Uuid::from_u128(7),
            rig_id: Uuid::from_u128(1),
            name: GroupName::new("Panel 1").unwrap(),
            panel,
            origin: GroupOrigin::User,
            optics: OpticsSignature::new(None, None, None).unwrap(),
            framing: Some(FramingEvidence {
                ra_deg: 313.0,
                dec_deg: 44.0,
                rotator_deg: Some(90.0),
                sky_angle_deg,
                field: Some(FieldOfView { width_deg: 2.0, height_deg: 1.0 }),
            }),
            position: 0,
        }
    }

    #[test]
    fn a_panel_outline_is_the_anchor_field_turned_by_the_sky_angle() {
        let outline = panel_outline(&group(true, Some(0.0))).expect("a panel with a sky angle");
        assert_eq!(outline.group_id, Uuid::from_u128(7));
        assert_eq!(outline.corners.len(), 4);
        let decs: Vec<f64> = outline.corners.iter().map(|corner| corner.dec_deg).collect();
        assert!(decs.iter().all(|dec| (dec - 44.0).abs() < 0.55), "{decs:?}");
        let turned = panel_outline(&group(true, Some(90.0))).unwrap();
        let decs: Vec<f64> = turned.corners.iter().map(|corner| corner.dec_deg).collect();
        assert!(decs.iter().any(|dec| (dec - 44.0).abs() > 0.9), "turned 90°: {decs:?}");
    }

    #[test]
    fn no_outline_without_a_panel_or_a_sky_angle() {
        assert!(panel_outline(&group(false, Some(0.0))).is_none(), "not a panel");
        assert!(panel_outline(&group(true, None)).is_none(), "ROTATANG alone has no sky angle");
    }
}
