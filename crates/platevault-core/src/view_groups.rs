// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Mosaic run groups (spec 066 VSEL-FR-05/07/08/18/19, VSEL-AC-21/22,
//! PRJ-AC-13, PV-VSEL-SC-04; D-W38, D-W41, D-W73): panel assignment by
//! pointing, panel outlines, summaries per panel run and for the group, the
//! Panel filter, and the `Library` operations over them.
//!
//! Each panel's extent is the rig's field of view around the panel centre,
//! turned by the panel rotation; with the rotation unknown it is the circle
//! that field holds at any rotation, so an unknown never assigns a session
//! the field might miss. A session joins a panel when every light frame's
//! pointing lies inside that panel and no other panel holds them all. It is
//! flagged ambiguous when several panels hold it or its frames fall in
//! different panels, off-panel when no panel holds any frame, and no-pointing
//! or FOV-unknown when the evidence is missing. Flagged sessions join no panel
//! run; OBJECT never takes part.

use std::collections::{BTreeMap, HashMap};

use persistence_library::{CandidateSession, GroupCandidates, SessionSummary};
use serde::{Deserialize, Serialize};
use target_match::skymath as sky;
use target_match::{is_framed, Membership as Shape, SkyObject};
use uuid::Uuid;

use crate::library::Library;
use crate::rig::field_of_view;
use crate::view_geometry::{frame_geometry, rectangle, session_geometry, FrameGeometry};
use crate::{
    ChannelSummary, ExclusionCount, ExclusionReason, FieldOfView, GroupActionOutcome, GroupSetup,
    LibraryError, MembershipSummary, Microseconds, NewViewGroup, PanelAssignment, PanelBasis,
    PanelCheck, PanelDecision, PanelEvidence, PanelFilter, PanelFlag, PointingAssessment, Revision,
    SkyPoint, SubjectPanel, View, ViewGroup,
};

// ---------------------------------------------------------------------------
// Panel assignment
// ---------------------------------------------------------------------------

struct Position(sky::Equatorial);

impl SkyObject for Position {
    fn position(&self) -> sky::Equatorial {
        self.0
    }
}

fn equatorial(point: SkyPoint) -> Option<sky::Equatorial> {
    sky::Equatorial::j2000(
        sky::Angle::from_degrees(point.ra_deg),
        sky::Angle::from_degrees(point.dec_deg),
    )
    .ok()
}

const fn centre(panel: &SubjectPanel) -> SkyPoint {
    SkyPoint { ra_deg: panel.ra_deg, dec_deg: panel.dec_deg }
}

fn count(value: usize) -> u64 {
    u64::try_from(value).unwrap_or(u64::MAX)
}

/// The shape a panel holds pointing in: the rig's field turned by the panel
/// rotation, or the circle that field holds at any rotation.
fn panel_shape(extent: FieldOfView, rotation_deg: Option<f64>) -> Shape {
    match rotation_deg {
        Some(angle) => Shape::Rotated {
            fov: (
                sky::Angle::from_degrees(extent.width_deg),
                sky::Angle::from_degrees(extent.height_deg),
            ),
            position_angle: sky::Angle::from_degrees(angle),
        },
        None => Shape::Circular {
            radius: sky::Angle::from_degrees(extent.width_deg.min(extent.height_deg) / 2.0),
        },
    }
}

/// Check one session's light-frame pointing against every panel of
/// `candidates` and decide its panel or flag (VSEL-FR-18). Unknown evidence
/// stays unknown: no separation or frame count reads 0 without pointing.
#[must_use]
pub fn assess_session(
    session: &CandidateSession,
    candidates: &GroupCandidates,
) -> PointingAssessment {
    let frames: Vec<FrameGeometry> = session
        .captures
        .iter()
        .map(|capture| frame_geometry(&capture.frame, Some(&candidates.rig)))
        .collect();
    let geometry = session_geometry(&frames, &candidates.framing);
    let lights: Vec<sky::Equatorial> = frames
        .iter()
        .filter(|frame| frame.light != Some(false))
        .filter_map(|frame| frame.pointing.and_then(equatorial))
        .collect();
    let extent = field_of_view(&candidates.rig);
    let mean = geometry.mean_pointing.and_then(equatorial);
    let checks: Vec<PanelCheck> = candidates
        .panels
        .iter()
        .map(|panel| {
            let at = equatorial(centre(panel));
            let frames_inside = match (extent, at, mean) {
                (Some(extent), Some(at), Some(_)) => {
                    let shape = panel_shape(extent, panel.rotation_deg);
                    let inside = lights
                        .iter()
                        .filter(|pointing| is_framed(at, &Position(**pointing), shape).in_frame)
                        .count();
                    Some(count(inside))
                }
                _ => None,
            };
            PanelCheck {
                panel_id: panel.id,
                number: panel.number,
                centre: centre(panel),
                rotation_deg: panel.rotation_deg,
                separation_deg: mean.zip(at).map(|(mean, at)| sky::separation(mean, at).degrees()),
                frames_inside,
            }
        })
        .collect();
    let (panel_id, flag) = if mean.is_none() {
        (None, Some(PanelFlag::NoPointing))
    } else if extent.is_none() {
        (None, Some(PanelFlag::FovUnknown))
    } else {
        let every = Some(geometry.light_frames);
        let holding: Vec<&PanelCheck> =
            checks.iter().filter(|check| check.frames_inside == every).collect();
        match holding.as_slice() {
            [only] => (Some(only.panel_id), None),
            [] if checks.iter().all(|check| check.frames_inside == Some(0)) => {
                (None, Some(PanelFlag::OffPanel))
            }
            _ => (None, Some(PanelFlag::Ambiguous)),
        }
    };
    PointingAssessment {
        session: session.expected(),
        panel_id,
        flag,
        evidence: PanelEvidence {
            light_frames: geometry.light_frames,
            frames_with_pointing: geometry.frames_with_pointing,
            mean_pointing: geometry.mean_pointing,
            extent,
            checks,
        },
    }
}

/// A panel's outline for linked sky coverage (VSEL-FR-07): the rig's field
/// around the panel centre turned by its rotation, in the orientation frame
/// footprints use. `None` without a rotation or a rig field. Nothing is
/// stitched.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PanelOutline {
    pub centre: SkyPoint,
    pub corners: Vec<SkyPoint>,
    pub rotation_deg: f64,
}

#[must_use]
pub fn panel_outline(panel: &SubjectPanel, extent: Option<FieldOfView>) -> Option<PanelOutline> {
    let (extent, rotation_deg) = (extent?, panel.rotation_deg?);
    let footprint = rectangle(
        centre(panel),
        (extent.width_deg, extent.height_deg),
        rotation_deg,
        format!("panel:{}", panel.id),
    )?;
    let corners = footprint
        .corners()
        .iter()
        .map(|corner| SkyPoint { ra_deg: corner.ra().degrees(), dec_deg: corner.dec().degrees() })
        .collect();
    Some(PanelOutline { centre: centre(panel), corners, rotation_deg })
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

/// Where a group session stands.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GroupSessionState {
    /// Assigned to a panel by pointing or by the user.
    Assigned,
    /// Pointing assigned no panel: it waits for the user.
    Flagged,
    LeftOut,
    /// A candidate no decision covers yet, shown with what its pointing says.
    New,
}

/// One candidate of the group with its panel decision, or for a new one its
/// pointing assessed now.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupSessionRow {
    pub session: SessionSummary,
    pub state: GroupSessionState,
    /// The decided panel; for a new session the panel its pointing gives.
    pub panel_id: Option<Uuid>,
    pub panel_number: Option<u32>,
    /// `None` for a new session.
    pub basis: Option<PanelBasis>,
    pub flag: Option<PanelFlag>,
    pub evidence: PanelEvidence,
    pub decided_at: Option<String>,
}

/// One panel run's status, setup and summary (VSEL-FR-08, VSEL-FR-19).
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PanelRunDetail {
    pub panel: SubjectPanel,
    pub outline: Option<PanelOutline>,
    pub view: View,
    pub name: String,
    /// The run's profile and calibration policy are the group's.
    pub setup_matches_group: bool,
    /// The draft's summary when one exists, else the latest revision's.
    pub summary: Option<MembershipSummary>,
    /// What the run's 'Add N new sessions' offers.
    pub new_sessions: u64,
    /// Sessions decided onto the panel, by id.
    pub sessions: Vec<Uuid>,
}

/// The group's summary over its panel runs, each logical capture once since
/// every session belongs to one panel; flagged and new sessions count in no
/// panel (PRJ-AC-13).
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupSummary {
    pub channels: Vec<ChannelSummary>,
    pub unknown_channel: Option<ChannelSummary>,
    pub included_frames: u64,
    pub included_seconds: Microseconds,
    /// Unresolved sources and members changed since review, over every panel.
    pub unresolved_sources: u64,
    pub changed_since_review: u64,
    pub flagged_sessions: u64,
    pub new_sessions: u64,
}

/// A Panel filter value with its match count.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PanelFilterCount {
    pub filter: PanelFilter,
    pub count: u64,
}

/// The run group's backend read.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewGroupDetail {
    pub group: ViewGroup,
    /// By panel number.
    pub panels: Vec<PanelRunDetail>,
    pub summary: GroupSummary,
    /// The candidates the filter keeps, in candidate order.
    pub sessions: Vec<GroupSessionRow>,
    /// Every Panel filter value with its count: Panel 1..N, Flagged, New.
    pub filters: Vec<PanelFilterCount>,
}

fn add_channel(into: &mut ChannelSummary, from: &ChannelSummary) {
    into.included_frames += from.included_frames;
    into.included_seconds = Microseconds(into.included_seconds.0 + from.included_seconds.0);
    into.unreviewed_frames += from.unreviewed_frames;
    into.usable_frames += from.usable_frames;
    into.unknown_exposure_count += from.unknown_exposure_count;
    into.unknown_image_type_count += from.unknown_image_type_count;
    let mut excluded: BTreeMap<ExclusionReason, u64> =
        into.excluded.iter().map(|item| (item.reason, item.count)).collect();
    for item in &from.excluded {
        *excluded.entry(item.reason).or_default() += item.count;
    }
    into.excluded =
        excluded.into_iter().map(|(reason, count)| ExclusionCount { reason, count }).collect();
}

/// Totals of the panel summaries, channels by exact FILTER text.
#[must_use]
pub fn group_summary(summaries: &[&MembershipSummary], rows: &[GroupSessionRow]) -> GroupSummary {
    let mut channels: BTreeMap<String, ChannelSummary> = BTreeMap::new();
    let mut unknown: Option<ChannelSummary> = None;
    let mut summary = GroupSummary::default();
    for panel in summaries {
        for channel in &panel.channels {
            let name = channel.channel.clone().unwrap_or_default();
            let into = channels.entry(name).or_insert_with(|| ChannelSummary {
                channel: channel.channel.clone(),
                ..ChannelSummary::default()
            });
            add_channel(into, channel);
        }
        if let Some(channel) = &panel.unknown_channel {
            add_channel(unknown.get_or_insert_with(ChannelSummary::default), channel);
        }
        summary.included_frames += panel.included_frames;
        summary.included_seconds =
            Microseconds(summary.included_seconds.0 + panel.included_seconds.0);
        summary.unresolved_sources += count(panel.unresolved.len());
        summary.changed_since_review += count(panel.changed_since_review.len());
    }
    summary.channels = channels.into_values().collect();
    summary.unknown_channel = unknown;
    let state = |state| count(rows.iter().filter(|row| row.state == state).count());
    summary.flagged_sessions = state(GroupSessionState::Flagged);
    summary.new_sessions = state(GroupSessionState::New);
    summary
}

fn row(
    session: &CandidateSession,
    candidates: &GroupCandidates,
    recorded: Option<&PanelAssignment>,
) -> GroupSessionRow {
    let number = |panel: Option<Uuid>| {
        panel.and_then(|id| candidates.panels.iter().find(|p| p.id == id).map(|p| p.number))
    };
    let Some(recorded) = recorded else {
        let assessed = assess_session(session, candidates);
        return GroupSessionRow {
            session: session.summary.clone(),
            state: GroupSessionState::New,
            panel_id: assessed.panel_id,
            panel_number: number(assessed.panel_id),
            basis: None,
            flag: assessed.flag,
            evidence: assessed.evidence,
            decided_at: None,
        };
    };
    let state = match (recorded.basis, recorded.panel_id) {
        (PanelBasis::LeftOut, _) => GroupSessionState::LeftOut,
        (_, Some(_)) => GroupSessionState::Assigned,
        (_, None) => GroupSessionState::Flagged,
    };
    GroupSessionRow {
        session: session.summary.clone(),
        state,
        panel_id: recorded.panel_id,
        panel_number: number(recorded.panel_id),
        basis: Some(recorded.basis),
        flag: recorded.flag,
        evidence: recorded.evidence.clone(),
        decided_at: Some(recorded.decided_at.clone()),
    }
}

fn keeps(row: &GroupSessionRow, filter: PanelFilter) -> bool {
    match filter {
        PanelFilter::Panel { number } => {
            row.state == GroupSessionState::Assigned && row.panel_number == Some(number)
        }
        PanelFilter::Flagged => row.state == GroupSessionState::Flagged,
        PanelFilter::New => row.state == GroupSessionState::New,
    }
}

/// The panel run holds the group's profile and calibration policy; the input
/// mode lives on the group alone.
fn setup_matches(view: &View, setup: &GroupSetup) -> bool {
    view.profile_id == setup.profile_id && view.calibration_policy == setup.calibration_policy
}

// ---------------------------------------------------------------------------
// Library operations
// ---------------------------------------------------------------------------

impl Library {
    /// Start a run group on a mosaic subject (VSEL-FR-18): one panel run per
    /// confirmed panel and no whole-mosaic run. Every candidate on the rig is
    /// assessed by pointing; one inside exactly one panel joins that panel
    /// run, the others are flagged and wait for the user.
    ///
    /// # Errors
    /// As [`persistence_library::Catalog::create_view_group`].
    pub async fn create_view_group(
        &self,
        input: &NewViewGroup,
    ) -> Result<ViewGroupDetail, LibraryError> {
        input.validate()?;
        let candidates = self
            .catalog()
            .view_group_candidates(input.project_id, input.subject_id, input.rig_id)
            .await?;
        let assessments: Vec<PointingAssessment> = candidates
            .sessions
            .iter()
            .map(|session| assess_session(session, &candidates))
            .collect();
        let record = self.catalog().create_view_group(input, &assessments).await?;
        self.view_group_detail(record.group.id, None).await
    }

    /// The group's setup, each panel run's status, outline and summary, the
    /// group summary, and its candidates with their panel decisions, kept by
    /// `filter`. Read-only: a new candidate's pointing is assessed, never
    /// recorded.
    ///
    /// # Errors
    /// `NotFound` for an unknown run group.
    pub async fn view_group_detail(
        &self,
        id: Uuid,
        filter: Option<PanelFilter>,
    ) -> Result<ViewGroupDetail, LibraryError> {
        let basis = self.catalog().view_group_basis(id).await?;
        let candidates = &basis.candidates;
        let recorded: HashMap<Uuid, &PanelAssignment> = basis
            .record
            .assignments
            .iter()
            .map(|assignment| (assignment.session_id, assignment))
            .collect();
        let rows: Vec<GroupSessionRow> = candidates
            .sessions
            .iter()
            .map(|session| {
                row(session, candidates, recorded.get(&session.summary.session.id).copied())
            })
            .collect();
        let extent = field_of_view(&candidates.rig);
        let group = basis.record.group;
        let mut panels = Vec::with_capacity(basis.record.runs.len());
        for run in &basis.record.runs {
            let detail = self.view_detail(run.view.id).await?;
            let panel = candidates
                .panels
                .iter()
                .find(|panel| Some(panel.id) == detail.view.panel_id)
                .cloned()
                .ok_or_else(|| {
                    LibraryError::PersistenceFailure(format!(
                        "panel run {} has no panel of its mosaic",
                        detail.view.id
                    ))
                })?;
            let name = detail
                .draft
                .as_ref()
                .map(|draft| draft.name.clone())
                .or_else(|| detail.revision.as_ref().map(|revision| revision.name.clone()))
                .unwrap_or_default();
            let sessions = rows
                .iter()
                .filter(|row| {
                    row.state == GroupSessionState::Assigned && row.panel_id == Some(panel.id)
                })
                .map(|row| row.session.session.id)
                .collect();
            panels.push(PanelRunDetail {
                outline: panel_outline(&panel, extent),
                setup_matches_group: setup_matches(&detail.view, &group.setup),
                summary: detail.draft_summary.or(detail.revision_summary),
                new_sessions: detail.new_sessions,
                view: detail.view,
                panel,
                name,
                sessions,
            });
        }
        let summaries: Vec<&MembershipSummary> =
            panels.iter().filter_map(|panel| panel.summary.as_ref()).collect();
        let summary = group_summary(&summaries, &rows);
        let filters = panels
            .iter()
            .map(|panel| PanelFilter::Panel { number: panel.panel.number })
            .chain([PanelFilter::Flagged, PanelFilter::New])
            .map(|value| PanelFilterCount {
                filter: value,
                count: count(rows.iter().filter(|row| keeps(row, value)).count()),
            })
            .collect();
        let sessions =
            rows.into_iter().filter(|row| filter.is_none_or(|filter| keeps(row, filter))).collect();
        Ok(ViewGroupDetail { group, panels, summary, sessions, filters })
    }

    /// Record the user's panel for each decided session, with its pointing
    /// assessed now, and return the group read afresh. A session given a panel
    /// joins that panel run; one moved off a panel or left out leaves it.
    ///
    /// # Errors
    /// `InvalidInput` for a session that is not a candidate of the group, and
    /// as [`persistence_library::Catalog::decide_view_group_panels`].
    pub async fn assign_view_group_panels(
        &self,
        id: Uuid,
        expected: Revision,
        decisions: &[PanelDecision],
    ) -> Result<ViewGroupDetail, LibraryError> {
        let basis = self.catalog().view_group_basis(id).await?;
        let candidates = &basis.candidates;
        let writes = decisions
            .iter()
            .map(|decision| {
                let session = candidates
                    .sessions
                    .iter()
                    .find(|session| session.summary.session.id == decision.session_id)
                    .ok_or_else(|| {
                        LibraryError::InvalidInput(format!(
                            "session {} is not a candidate of run group {id}",
                            decision.session_id
                        ))
                    })?;
                Ok((assess_session(session, candidates), decision.choice))
            })
            .collect::<Result<Vec<_>, LibraryError>>()?;
        self.catalog().decide_view_group_panels(id, expected, &writes).await?;
        self.view_group_detail(id, None).await
    }

    /// Set the shared setup on the group and every panel run outside the
    /// Project's Trash, reporting each panel's outcome (VSEL-AC-22).
    ///
    /// # Errors
    /// As [`persistence_library::Catalog::set_view_group_setup`].
    pub async fn set_view_group_setup(
        &self,
        id: Uuid,
        expected: Revision,
        setup: &GroupSetup,
    ) -> Result<GroupActionOutcome, LibraryError> {
        self.catalog().set_view_group_setup(id, expected, setup).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        AssessedMembers, AssociationState, Availability, CandidateCapture, CaptureKey, Equipment,
        FrameEvidence, FramingTarget, Provenance, Session,
    };

    fn rig(sensor: Option<(u32, u32)>) -> Equipment {
        Equipment {
            id: Uuid::new_v4(),
            name: "RedCat 51".into(),
            camera: Some("ASI2600MM".into()),
            telescope: Some("RedCat 51".into()),
            focal_length_mm: Some(500.0),
            pixel_size_um: Some(3.76),
            sensor_width_px: sensor.map(|(width, _)| width),
            sensor_height_px: sensor.map(|(_, height)| height),
            color_kind: None,
            decision_revision: 0,
            state: AssociationState::Confirmed,
            provenance: Provenance::User,
        }
    }

    fn panel(number: u32, ra_deg: f64, rotation_deg: Option<f64>) -> SubjectPanel {
        SubjectPanel { id: Uuid::new_v4(), number, ra_deg, dec_deg: 44.0, rotation_deg }
    }

    fn session(pointing: &[(f64, f64)]) -> CandidateSession {
        let id = Uuid::new_v4();
        let captures = pointing
            .iter()
            .map(|&(ra, dec)| {
                let asset_id = Uuid::new_v4();
                CandidateCapture {
                    member_key: asset_id,
                    copies: Vec::new(),
                    quality: crate::ApplicableQuality::Unreviewed,
                    frame: FrameEvidence {
                        asset_id,
                        light: Some(true),
                        ra_deg: Some(ra),
                        dec_deg: Some(dec),
                        ..FrameEvidence::default()
                    },
                }
            })
            .collect();
        CandidateSession {
            summary: SessionSummary {
                session: Session {
                    id,
                    key: CaptureKey(String::new()),
                    grouping_revision: 1,
                    decision_revision: 1,
                    asset_ids: Vec::new(),
                    provisional: Vec::new(),
                    date_basis: None,
                },
                location_ids: Vec::new(),
                asset_count: 0,
                capture_count: 0,
                availability: Availability::Available,
                last_observed_at: None,
                provisional: false,
                successors: Vec::new(),
            },
            captures,
            assessed: AssessedMembers::default(),
        }
    }

    fn candidates(rig: Equipment, panels: Vec<SubjectPanel>) -> GroupCandidates {
        GroupCandidates {
            subject_id: Uuid::new_v4(),
            framing: FramingTarget {
                target_id: Uuid::new_v4(),
                designation: "NGC 7000".into(),
                coordinates: None,
            },
            rig,
            panels,
            sessions: Vec::new(),
        }
    }

    #[test]
    fn unknown_rotation_checks_the_circle_the_field_holds_at_any_rotation() {
        // A 1.29° × 0.86° field: the circle has radius 0.43°.
        let group = candidates(rig(Some((3000, 2000))), vec![panel(1, 313.0, None)]);
        let near = assess_session(&session(&[(313.4, 44.0)]), &group);
        assert_eq!(near.panel_id, Some(group.panels[0].id), "0.29° from the centre");
        let corner = assess_session(&session(&[(313.8, 44.0)]), &group);
        assert_eq!(corner.flag, Some(PanelFlag::OffPanel), "0.58° may fall outside the field");
        assert_eq!(corner.evidence.checks[0].rotation_deg, None);
    }

    #[test]
    fn frames_in_different_panels_are_ambiguous_and_unknown_fov_is_flagged() {
        let panels = vec![panel(1, 313.0, Some(0.0)), panel(2, 315.0, Some(0.0))];
        let group = candidates(rig(Some((3000, 2000))), panels.clone());
        let split = assess_session(&session(&[(313.0, 44.0), (315.0, 44.0)]), &group);
        assert_eq!((split.panel_id, split.flag), (None, Some(PanelFlag::Ambiguous)));
        let inside: Vec<Option<u64>> =
            split.evidence.checks.iter().map(|check| check.frames_inside).collect();
        assert_eq!(inside, vec![Some(1), Some(1)]);

        let unknown = candidates(rig(None), panels);
        let assessed = assess_session(&session(&[(313.0, 44.0)]), &unknown);
        assert_eq!((assessed.panel_id, assessed.flag), (None, Some(PanelFlag::FovUnknown)));
        assert!(assessed.evidence.checks.iter().all(|check| check.frames_inside.is_none()));
        assert!(assessed.evidence.checks[0].separation_deg.is_some());
        assert!(panel_outline(&unknown.panels[0], None).is_none());
    }
}
