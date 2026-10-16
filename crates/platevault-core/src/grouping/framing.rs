// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Intake framing split (D-W107, LIB-FR-04): the lights of one night and one
//! capture key form one session per framing.
//!
//! *Provisional rule; the spec leaves the anchor frame and the comparison
//! order open.* Frames are taken in capture order (`DATE-OBS`, frames without
//! one last, then file name, then id). A frame joins the framing whose anchor
//! lies nearest within the framing margins, and otherwise anchors a new
//! framing; an anchor is the first frame of its framing that has pointing.
//! Frames are compared with anchors only, never with each other, so a slow
//! drift cannot chain into one over-wide framing. Framings are numbered in the
//! capture order of their anchors.
//!
//! A frame is the anchor's framing when its centre lies within the margin's
//! share of the anchor's field diagonal and its rotation within the margin's
//! angle: ROTATANG when both record it (a meridian flip leaves it unchanged),
//! else the sky angle modulo 180°. A margin whose evidence is missing never
//! splits. Lights without pointing stay in one session with no framing
//! (record §9), and lights the user labelled form one framing per label
//! whatever their pointing.

use std::cmp::Ordering;
use std::collections::BTreeSet;

use target_match::skymath as sky;
use target_match::{Field, Optics};
use uuid::Uuid;

use super::{capture_instant, Frame};
use crate::{FieldOfView, FramingMargins, SessionFraming};

const NO_POINTING: &str =
    "framing: no pointing (RA/DEC or a plate solve) recorded; these lights stay in one session";
const FIELD_UNKNOWN: &str = "framing: the anchor frame's field is unknown (FOCALLEN, XPIXSZ, \
                             NAXIS1, NAXIS2); its centre margin was not applied";
const ROTATION_UNKNOWN: &str = "framing: the anchor frame records no rotation (ROTATANG or a sky \
                                angle); its rotation margin was not applied";

/// The frames of one session, as indices into the frames split, with the
/// framing and notes the session records.
pub(super) struct Split {
    pub members: Vec<usize>,
    pub framing: Option<SessionFraming>,
    pub notes: BTreeSet<String>,
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

    /// The angular distance of `frame` from this anchor when it lies within
    /// the margins.
    fn offset(&self, frame: &Self, margins: &FramingMargins) -> Option<f64> {
        let separation = sky::separation(self.centre?, frame.centre?).degrees();
        let share = margins.max_centre_offset_percent / 100.0;
        if self.field.is_some_and(|field| separation > field.diagonal().degrees() * share) {
            return None;
        }
        let rotation = match (self.rotator_deg, frame.rotator_deg) {
            (Some(anchor), Some(other)) => Some(circular_difference(anchor, other, 360.0)),
            _ => match (self.sky_angle_deg, frame.sky_angle_deg) {
                (Some(anchor), Some(other)) => Some(circular_difference(anchor, other, 180.0)),
                _ => None,
            },
        };
        if rotation.is_some_and(|difference| difference > margins.max_rotation_deg) {
            return None;
        }
        Some(separation)
    }
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
}

/// Split the lights of one night and capture key into sessions by framing.
pub(super) fn split(frames: &[Frame<'_>], margins: &FramingMargins) -> Vec<Split> {
    let evidence: Vec<Evidence<'_>> = frames.iter().map(Evidence::of).collect();
    let order = capture_order(frames);
    let mut framings: Vec<Framing<'_>> = Vec::new();
    let mut unframed = Vec::new();
    for &index in &order {
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
                }),
            }
        } else if !pointed {
            unframed.push(index);
        } else if let Some(framing) = nearest(&mut framings, &evidence, frame, margins) {
            framing.members.push(index);
        } else {
            framings.push(Framing { label: None, anchor: Some(index), members: vec![index] });
        }
    }
    let mut rank = vec![0; frames.len()];
    for (position, &index) in order.iter().enumerate() {
        rank[index] = position;
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

/// The framing whose anchor lies nearest within the margins; the earlier
/// framing on a tie.
fn nearest<'f, 'a>(
    framings: &'f mut [Framing<'a>],
    evidence: &[Evidence<'_>],
    frame: &Evidence<'_>,
    margins: &FramingMargins,
) -> Option<&'f mut Framing<'a>> {
    let mut best: Option<(f64, &'f mut Framing<'a>)> = None;
    for framing in framings {
        let Some(separation) =
            framing.anchor.and_then(|anchor| evidence[anchor].offset(frame, margins))
        else {
            continue;
        };
        if best.as_ref().is_none_or(|(nearest, _)| separation < *nearest) {
            best = Some((separation, framing));
        }
    }
    best.map(|(_, framing)| framing)
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
                if evidence.field.is_none() {
                    notes.insert(FIELD_UNKNOWN.to_owned());
                }
                if evidence.rotator_deg.is_none() && evidence.sky_angle_deg.is_none() {
                    notes.insert(ROTATION_UNKNOWN.to_owned());
                }
                session_framing(frames[anchor].id, evidence, ordinal, framing.label)
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
    label: Option<&str>,
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
        label: label.map(str::to_owned),
    })
}
