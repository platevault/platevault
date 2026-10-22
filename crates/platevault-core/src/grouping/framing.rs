// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Intake framing split (D-W107, LIB-FR-04): the lights of one night and one
//! capture key form one session per framing.
//!
//! Frames are taken in capture order (`DATE-OBS`, frames without one last,
//! then file name, then id). A frame joins the framing whose anchor lies
//! nearest within that framing's split limits (the smallest centre
//! separation, then the smallest rotation difference, then the anchor first
//! in capture order; owner 2026-10-20), and otherwise anchors a new
//! framing under the limits of the intake bringing it in; an anchor is the
//! first frame of its framing that has pointing. A frame that returns to an
//! earlier framing rejoins that framing's session, however many frames of
//! other framings came between (D-W107, owner 2026-10-20). Frames are
//! compared with anchors only, never with each other, so a slow drift cannot
//! chain into one over-wide framing. Framings are numbered in the capture
//! order of their anchors.
//!
//! A session already in the catalog stands (D-W107, owner 2026-10-15/16/20):
//! the limits in force at its intake set its split, and no later change of
//! the Settings limits re-splits it. Its unchanged frames stay in it, its
//! anchor stays the frame it records while that frame stays in it, and a
//! frame indexed later is compared with that anchor by the session's own
//! recorded limits, not by the limits of the intake bringing the frame in.
//!
//! A frame is the anchor's framing when its centre lies within the centre
//! limit, an angle on the sky (5′ by default, whatever the field; CF2, owner
//! 2026-10-20), and its rotation within the rotation limit (5° by default):
//! ROTATANG when both record it (a meridian flip leaves it unchanged), else
//! the sky angle modulo 180°. A rotation whose evidence is missing never
//! splits. Lights without pointing stay in one session with no framing
//! (record §9), and lights the user labelled form one framing per label
//! whatever their pointing.

use std::cmp::Ordering;
use std::collections::BTreeSet;

use target_match::skymath as sky;
use target_match::{Field, Optics};
use uuid::Uuid;

use super::{capture_instant, Frame};
use crate::{FieldOfView, FramingEvidence, FramingMargins, SessionFraming, SplitLimits};

const NO_POINTING: &str =
    "framing: no pointing (RA/DEC or a plate solve) recorded; these lights stay in one session";
const ROTATION_UNKNOWN: &str = "framing: the anchor frame records no rotation (ROTATANG or a sky \
                                angle); its rotation limit was not applied";

/// The frames of one session, as indices into the frames split, with the
/// framing and notes the session records.
pub(super) struct Split {
    pub members: Vec<usize>,
    pub framing: Option<SessionFraming>,
    pub notes: BTreeSet<String>,
}

/// A session the catalog holds among the frames split: its unchanged
/// members, as indices into the frames split, and the framing it records.
pub(super) struct Standing<'a> {
    pub members: Vec<usize>,
    pub framing: Option<&'a SessionFraming>,
}

/// What one frame says about its framing.
struct Evidence<'a> {
    centre: Option<sky::Equatorial>,
    rotator_deg: Option<f64>,
    sky_angle_deg: Option<f64>,
    field: Option<Field>,
    label: Option<&'a str>,
}

impl<'a> Evidence<'a> {
    fn of(frame: &Frame<'a>) -> Self {
        let meta = frame.metadata;
        Self {
            centre: centre(meta.wcs_ra_deg, meta.wcs_dec_deg)
                .or_else(|| centre(meta.ra_deg, meta.dec_deg)),
            rotator_deg: angle(meta.mechanical_rotation_deg),
            sky_angle_deg: angle(meta.sky_rotation_deg),
            field: field(meta.focal_length_mm, meta.pixel_size_um, meta.width, meta.height),
            label: meta.framing_label.as_deref().map(str::trim).filter(|label| !label.is_empty()),
        }
    }

    /// How far `frame` lies from this anchor when it lies within the split
    /// limits.
    fn offset(&self, frame: &Self, limits: &SplitLimits) -> Option<Offset> {
        let separation = sky::separation(self.centre?, frame.centre?).degrees();
        if separation * 60.0 > limits.max_centre_offset_arcmin {
            return None;
        }
        let rotation = match (self.rotator_deg, frame.rotator_deg) {
            (Some(anchor), Some(other)) => Some(circular_difference(anchor, other, 360.0)),
            _ => match (self.sky_angle_deg, frame.sky_angle_deg) {
                (Some(anchor), Some(other)) => Some(circular_difference(anchor, other, 180.0)),
                _ => None,
            },
        };
        if rotation.is_some_and(|difference| difference > limits.max_rotation_deg) {
            return None;
        }
        Some(Offset { separation, rotation })
    }
}

/// How far a frame lies from an anchor within its limits: the centre
/// separation in degrees and the rotation difference, `None` when either
/// records no rotation.
#[derive(Clone, Copy)]
struct Offset {
    separation: f64,
    rotation: Option<f64>,
}

impl Offset {
    /// The nearer of two anchors (owner, 2026-10-20): the smaller centre
    /// separation, then the smaller rotation difference, a known one before
    /// an unknown one. Equal offsets are a tie.
    fn nearer_than(&self, other: &Self) -> bool {
        let rotation = |offset: &Self| offset.rotation.unwrap_or(f64::INFINITY);
        (self.separation, rotation(self)) < (other.separation, rotation(other))
    }
}

impl Evidence<'_> {
    /// A recorded framing as evidence: a session's anchor or a Project
    /// group's.
    fn of_record(framing: &FramingEvidence) -> Self {
        Self {
            centre: centre(Some(framing.ra_deg), Some(framing.dec_deg)),
            rotator_deg: angle(framing.rotator_deg),
            sky_angle_deg: angle(framing.sky_angle_deg),
            field: framing.field.and_then(|field| {
                Field::from_fov(
                    sky::Angle::from_degrees(field.width_deg),
                    sky::Angle::from_degrees(field.height_deg),
                )
                .ok()
            }),
            label: None,
        }
    }
}

/// The angular distance of `other` from the `anchor` framing when it lies
/// within the split limits, by the same rule intake splits sessions with: a
/// Project groups its sessions by framing with the limits the night was
/// split with (PRJ-FR-31, LIB-FR-04).
pub fn framing_offset(
    anchor: &FramingEvidence,
    other: &FramingEvidence,
    margins: &FramingMargins,
) -> Option<f64> {
    Evidence::of_record(anchor)
        .offset(&Evidence::of_record(other), &margins.split)
        .map(|offset| offset.separation)
}

fn centre(ra_deg: Option<f64>, dec_deg: Option<f64>) -> Option<sky::Equatorial> {
    sky::Equatorial::j2000(sky::Angle::from_degrees(ra_deg?), sky::Angle::from_degrees(dec_deg?))
        .ok()
}

/// A finite angle normalized to [0, 360).
fn angle(value: Option<f64>) -> Option<f64> {
    let degrees = sky::Angle::from_degrees(value.filter(|angle| angle.is_finite())?)
        .normalized_0_360()
        .degrees();
    Some(if degrees >= 360.0 { 0.0 } else { degrees })
}

/// The header field. Header pixel sizes stay at 1×1 over the binned pixel
/// counts, as the geometry evidence reads them, so they never overstate it.
fn field(
    focal_mm: Option<f64>,
    pixel_um: Option<f64>,
    width: Option<u32>,
    height: Option<u32>,
) -> Option<Field> {
    let positive = |value: Option<f64>| value.filter(|value| value.is_finite() && *value > 0.0);
    let pixel = positive(pixel_um)?;
    Field::from_optics(Optics {
        focal_mm: positive(focal_mm)?,
        pixel_um: (pixel, pixel),
        binning: (1, 1),
        pixels: (width.filter(|width| *width > 0)?, height.filter(|height| *height > 0)?),
    })
    .ok()
}

/// The smaller difference of two angles on a circle of `period` degrees.
fn circular_difference(left: f64, right: f64, period: f64) -> f64 {
    let difference = (left - right).rem_euclid(period);
    difference.min(period - difference)
}

/// Capture order: `DATE-OBS`, frames without one last, then file name, then id.
fn capture_order(frames: &[Frame<'_>]) -> Vec<usize> {
    let instants: Vec<_> = frames.iter().map(|frame| capture_instant(frame.metadata)).collect();
    let mut order: Vec<usize> = (0..frames.len()).collect();
    order.sort_by(|&left, &right| {
        let by_time = match (instants[left], instants[right]) {
            (Some(left), Some(right)) => left.cmp(&right),
            (Some(_), None) => Ordering::Less,
            (None, Some(_)) => Ordering::Greater,
            (None, None) => Ordering::Equal,
        };
        by_time
            .then_with(|| frames[left].name.cmp(frames[right].name))
            .then_with(|| frames[left].id.cmp(&frames[right].id))
    });
    order
}

/// One framing while the frames are assigned.
struct Framing<'a> {
    label: Option<&'a str>,
    /// The anchor frame's index.
    anchor: Option<usize>,
    members: Vec<usize>,
    /// The limits a frame joins it within: a standing session's own, else
    /// those of this intake.
    limits: SplitLimits,
}

/// Split the lights of one night and capture key into sessions by framing.
/// `standing` are the catalog's sessions among them, which keep their
/// members; `margins` are the limits of this intake.
pub(super) fn split<'a>(
    frames: &[Frame<'a>],
    standing: &[Standing<'a>],
    margins: &FramingMargins,
) -> Vec<Split> {
    let evidence: Vec<Evidence<'a>> = frames.iter().map(Evidence::of).collect();
    let order = capture_order(frames);
    let mut rank = vec![0; frames.len()];
    for (position, &index) in order.iter().enumerate() {
        rank[index] = position;
    }
    let mut framings: Vec<Framing<'a>> = Vec::new();
    let mut unframed = Vec::new();
    let mut placed = vec![false; frames.len()];
    for session in standing {
        for &member in &session.members {
            placed[member] = true;
        }
        match seeded(frames, &evidence, &rank, session, margins) {
            Some(framing) => framings.push(framing),
            None => unframed.extend_from_slice(&session.members),
        }
    }
    for &index in order.iter().filter(|&&index| !placed[index]) {
        let frame = &evidence[index];
        let pointed = frame.centre.is_some();
        if let Some(label) = frame.label {
            match framings.iter_mut().find(|framing| framing.label == Some(label)) {
                Some(framing) => {
                    framing.members.push(index);
                    if framing.anchor.is_none() && pointed {
                        framing.anchor = Some(index);
                    }
                }
                None => framings.push(Framing {
                    label: Some(label),
                    anchor: pointed.then_some(index),
                    members: vec![index],
                    limits: margins.split,
                }),
            }
        } else if !pointed {
            unframed.push(index);
        } else if let Some(framing) = nearest(&mut framings, &evidence, &rank, frame) {
            framing.members.push(index);
        } else {
            framings.push(Framing {
                label: None,
                anchor: Some(index),
                members: vec![index],
                limits: margins.split,
            });
        }
    }
    let mut splits = finish(frames, &evidence, &rank, framings);
    if !unframed.is_empty() {
        splits.push(Split {
            members: unframed,
            framing: None,
            notes: BTreeSet::from([NO_POINTING.to_owned()]),
        });
    }
    splits
}

/// A standing session as a framing: anchored at the frame it records while
/// that frame is still a member with pointing, else at its first member with
/// pointing in capture order; labelled as recorded, else as its members are;
/// joined within its recorded limits. `None` for lights with neither
/// pointing nor a label, which stay with the unframed lights.
fn seeded<'a>(
    frames: &[Frame<'a>],
    evidence: &[Evidence<'a>],
    rank: &[usize],
    session: &Standing<'a>,
    margins: &FramingMargins,
) -> Option<Framing<'a>> {
    let recorded = session.framing;
    let pointed = |index: &usize| evidence[*index].centre.is_some();
    let anchor = recorded
        .and_then(|framing| {
            session
                .members
                .iter()
                .copied()
                .find(|&member| frames[member].id == framing.anchor_asset_id)
        })
        .filter(pointed)
        .or_else(|| {
            session.members.iter().copied().filter(pointed).min_by_key(|&member| rank[member])
        });
    let label = recorded
        .and_then(|framing| framing.label.as_deref())
        .or_else(|| session.members.iter().find_map(|&member| evidence[member].label));
    if anchor.is_none() && label.is_none() {
        return None;
    }
    Some(Framing {
        label,
        anchor,
        members: session.members.clone(),
        limits: recorded.map_or(margins.split, |framing| framing.split_limits),
    })
}

/// The framing whose anchor lies nearest within its own limits: by centre,
/// then by rotation ([`Offset::nearer_than`]), then the framing whose anchor
/// comes first in capture order (`rank`).
fn nearest<'f, 'a>(
    framings: &'f mut [Framing<'a>],
    evidence: &[Evidence<'_>],
    rank: &[usize],
    frame: &Evidence<'_>,
) -> Option<&'f mut Framing<'a>> {
    let mut best: Option<(Offset, usize, &'f mut Framing<'a>)> = None;
    for framing in framings {
        let Some((offset, anchor)) = framing.anchor.and_then(|anchor| {
            evidence[anchor].offset(frame, &framing.limits).map(|offset| (offset, rank[anchor]))
        }) else {
            continue;
        };
        let nearer = best.as_ref().is_none_or(|(nearest, earliest, _)| {
            offset.nearer_than(nearest) || (!nearest.nearer_than(&offset) && anchor < *earliest)
        });
        if nearer {
            best = Some((offset, anchor, framing));
        }
    }
    best.map(|(_, _, framing)| framing)
}

/// Number the framings in the capture order (`rank`) of their anchors and
/// record each.
fn finish(
    frames: &[Frame<'_>],
    evidence: &[Evidence<'_>],
    rank: &[usize],
    framings: Vec<Framing<'_>>,
) -> Vec<Split> {
    let mut anchors: Vec<usize> =
        framings.iter().filter_map(|framing| framing.anchor.map(|anchor| rank[anchor])).collect();
    anchors.sort_unstable();
    framings
        .into_iter()
        .map(|framing| {
            let mut notes = BTreeSet::new();
            let record = framing.anchor.and_then(|anchor| {
                let ordinal = anchors.binary_search(&rank[anchor]).ok()? + 1;
                let evidence = &evidence[anchor];
                if evidence.rotator_deg.is_none() && evidence.sky_angle_deg.is_none() {
                    notes.insert(ROTATION_UNKNOWN.to_owned());
                }
                session_framing(frames[anchor].id, evidence, ordinal, &framing)
            });
            if record.is_none() {
                notes.insert(NO_POINTING.to_owned());
            }
            Split { members: framing.members, framing: record, notes }
        })
        .collect()
}

fn session_framing(
    anchor_asset_id: Uuid,
    anchor: &Evidence<'_>,
    ordinal: usize,
    framing: &Framing<'_>,
) -> Option<SessionFraming> {
    let centre = anchor.centre?;
    Some(SessionFraming {
        ordinal: u32::try_from(ordinal).ok()?,
        anchor_asset_id,
        ra_deg: angle(Some(centre.ra().degrees()))?,
        dec_deg: centre.dec().degrees(),
        rotator_deg: anchor.rotator_deg,
        sky_angle_deg: anchor.sky_angle_deg,
        field: anchor.field.map(|field| FieldOfView {
            width_deg: field.width().degrees(),
            height_deg: field.height().degrees(),
        }),
        label: framing.label.map(str::to_owned),
        split_limits: framing.limits,
    })
}
