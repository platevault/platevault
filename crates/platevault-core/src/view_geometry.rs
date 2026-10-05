// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Pure View geometry evidence (spec 066, research R6–R9 and R21).
//!
//! A frame footprint is the rotated field rectangle around the frame's pointing:
//! the plate-solved centre, else the header RA/DEC, oriented by the sky
//! position angle east of north, with a field of view from header optics or
//! the session's Confirmed equipment. OBJECT never takes part. Matching and
//! overlap come from `target-match` (`is_framed` with `Membership::Rotated`,
//! `SkyFootprint` and `compare_footprints`); every crossing goes through `f64`
//! degrees, as in [`crate::targets`]. Unknown evidence stays `None`, never 0.

use target_match::skymath as sky;
use target_match::{
    compare_footprints, is_framed, Field, FootprintProvenance, ImageParity, Membership, Optics,
    SkyFootprint, SkyObject,
};
use uuid::Uuid;

use crate::targets::ICRS_FRAME;
use crate::{
    Equipment, FootprintEvidence, FovEvidence, FovField, FovInput, FovSource, FrameEvidence,
    FramingElement, FramingMatch, FramingSnapshot, GeometryClass, GeometryEvidence,
    GeometryUnknown, SkyPoint, ViewCriteria,
};

/// Geometry of one frame. The footprint exists only with pointing,
/// orientation and field of view.
#[derive(Clone, Debug)]
pub struct FrameGeometry {
    pub asset_id: Uuid,
    pub light: Option<bool>,
    pub pointing: Option<SkyPoint>,
    /// Sky position angle east of north, normalized to [0, 360).
    pub orientation_deg: Option<f64>,
    pub fov: Option<FovEvidence>,
    footprint: Option<SkyFootprint>,
}

impl FrameGeometry {
    #[must_use]
    pub const fn footprint(&self) -> Option<&SkyFootprint> {
        self.footprint.as_ref()
    }
}

/// One framing element: a Target's coordinates or a panel, with the panel's
/// footprint when its orientation is known.
#[derive(Clone, Debug)]
pub struct FramingFootprint {
    pub element: FramingElement,
    /// `None` for a Target without ICRS coordinates.
    pub centre: Option<SkyPoint>,
    footprint: Option<SkyFootprint>,
}

impl FramingFootprint {
    /// The panel footprint for sky coverage; `None` for a Target or a panel
    /// without orientation.
    #[must_use]
    pub fn evidence(&self) -> Option<FootprintEvidence> {
        self.footprint.as_ref().map(|footprint| footprint_evidence(footprint, None))
    }
}

struct Point(sky::Equatorial);

impl SkyObject for Point {
    fn position(&self) -> sky::Equatorial {
        self.0
    }
}

fn position(point: SkyPoint) -> Option<sky::Equatorial> {
    sky::Equatorial::j2000(
        sky::Angle::from_degrees(point.ra_deg),
        sky::Angle::from_degrees(point.dec_deg),
    )
    .ok()
}

fn sky_point(position: sky::Equatorial) -> SkyPoint {
    SkyPoint { ra_deg: position.ra().degrees(), dec_deg: position.dec().degrees() }
}

fn valid_point(ra_deg: Option<f64>, dec_deg: Option<f64>) -> Option<SkyPoint> {
    let point = SkyPoint { ra_deg: ra_deg?, dec_deg: dec_deg? };
    position(point).map(|_| point)
}

fn separation_deg(left: sky::Equatorial, right: sky::Equatorial) -> f64 {
    sky::separation(left, right).degrees()
}

fn positive(value: Option<f64>) -> Option<f64> {
    value.filter(|value| value.is_finite() && *value > 0.0)
}

/// Header optics win per input; equipment optics fill the rest. Equipment pixel
/// sizes are unbinned, so they need the header binning; header pixel sizes stay
/// at 1×1 over the binned pixel counts and never overstate the field.
fn field_of_view(frame: &FrameEvidence, equipment: Option<&Equipment>) -> Option<FovEvidence> {
    let width = frame.width.filter(|width| *width > 0)?;
    let height = frame.height.filter(|height| *height > 0)?;
    let optic = |header: Option<f64>, recorded: fn(&Equipment) -> Option<f64>| {
        positive(header).map(|value| (value, FovSource::Header)).or_else(|| {
            let equipment = equipment?;
            positive(recorded(equipment))
                .map(|value| (value, FovSource::Equipment { equipment_id: equipment.id }))
        })
    };
    let (focal, focal_source) = optic(frame.focal_length_mm, |e| e.focal_length_mm)?;
    let (pixel, pixel_source) = optic(frame.pixel_size_um, |e| e.pixel_size_um)?;
    let mut inputs = vec![
        FovInput { field: FovField::FocalLengthMm, value: focal, source: focal_source },
        FovInput { field: FovField::PixelSizeUm, value: pixel, source: pixel_source },
    ];
    let binning = if pixel_source == FovSource::Header {
        (1, 1)
    } else {
        let x = frame.binning_x.filter(|binning| *binning > 0)?;
        let y = frame.binning_y.filter(|binning| *binning > 0)?;
        for (field, value) in [(FovField::BinningX, x), (FovField::BinningY, y)] {
            inputs.push(FovInput { field, value: f64::from(value), source: FovSource::Header });
        }
        (x, y)
    };
    for (field, value) in [(FovField::Width, width), (FovField::Height, height)] {
        inputs.push(FovInput { field, value: f64::from(value), source: FovSource::Header });
    }
    let field = Field::from_optics(Optics {
        focal_mm: focal,
        pixel_um: (pixel, pixel),
        binning,
        pixels: (width, height),
    })
    .ok()?;
    Some(FovEvidence {
        width_deg: field.width().degrees(),
        height_deg: field.height().degrees(),
        inputs,
    })
}

/// The `width`×`height` rectangle around `centre` turned by `angle_deg` east of
/// north, in the orientation `Membership::Rotated` uses, unprojected from the
/// tangent plane into a footprint with direct parity.
fn rectangle(
    centre: SkyPoint,
    (width_deg, height_deg): (f64, f64),
    angle_deg: f64,
    provenance: String,
) -> Option<SkyFootprint> {
    let anchor = position(centre)?;
    let half_x = (width_deg / 2.0).to_radians().tan();
    let half_y = (height_deg / 2.0).to_radians().tan();
    if !(half_x.is_finite() && half_y.is_finite() && half_x > 0.0 && half_y > 0.0) {
        return None;
    }
    let (sin, cos) = angle_deg.to_radians().sin_cos();
    let corners = [(-half_x, -half_y), (half_x, -half_y), (half_x, half_y), (-half_x, half_y)]
        .into_iter()
        .map(|(x, y)| {
            sky::gnomonic_unproject(
                anchor,
                sky::GnomonicPoint { east: x * cos + y * sin, north: -x * sin + y * cos },
            )
        })
        .collect::<Option<Vec<_>>>()?;
    SkyFootprint::new(
        anchor,
        corners,
        sky::Angle::from_degrees(angle_deg),
        ImageParity::Direct,
        FootprintProvenance::new(provenance).ok()?,
    )
    .ok()
}

fn footprint_evidence(footprint: &SkyFootprint, asset_id: Option<Uuid>) -> FootprintEvidence {
    FootprintEvidence {
        asset_id,
        centre: sky_point(footprint.centre()),
        corners: footprint.corners().iter().copied().map(sky_point).collect(),
        position_angle_deg: footprint.sky_position_angle().degrees(),
    }
}

/// Pointing, orientation, field of view and footprint of one frame (R6).
/// `equipment` is the session's Confirmed equipment record, if any.
#[must_use]
pub fn frame_geometry(frame: &FrameEvidence, equipment: Option<&Equipment>) -> FrameGeometry {
    let pointing = valid_point(frame.wcs_ra_deg, frame.wcs_dec_deg)
        .or_else(|| valid_point(frame.ra_deg, frame.dec_deg));
    let orientation_deg = frame
        .sky_rotation_deg
        .filter(|angle| angle.is_finite())
        .map(|angle| sky::Angle::from_degrees(angle).normalized_0_360().degrees());
    let fov = field_of_view(frame, equipment);
    let footprint = match (pointing, orientation_deg, &fov) {
        (Some(pointing), Some(angle), Some(fov)) => rectangle(
            pointing,
            (fov.width_deg, fov.height_deg),
            angle,
            format!("frame:{}", frame.asset_id),
        ),
        _ => None,
    };
    FrameGeometry {
        asset_id: frame.asset_id,
        light: frame.light,
        pointing,
        orientation_deg,
        fov,
        footprint,
    }
}

/// Targets with ICRS coordinates and every panel, in framing order. A panel
/// without orientation keeps its centre but has no footprint.
#[must_use]
pub fn framing_footprints(framing: &FramingSnapshot) -> Vec<FramingFootprint> {
    let targets = framing.targets.iter().map(|target| FramingFootprint {
        element: FramingElement::Target { target_id: target.target_id },
        centre: target
            .coordinates
            .as_ref()
            .filter(|coordinates| coordinates.frame == ICRS_FRAME)
            .and_then(|coordinates| {
                valid_point(Some(coordinates.ra_deg), Some(coordinates.dec_deg))
            }),
        footprint: None,
    });
    let panels = framing.panels.iter().map(|panel| {
        let centre = valid_point(Some(panel.ra_deg), Some(panel.dec_deg));
        FramingFootprint {
            element: FramingElement::Panel { panel_id: panel.id },
            centre,
            footprint: centre.zip(panel.position_angle_deg).and_then(|(centre, angle)| {
                rectangle(
                    centre,
                    (panel.width_deg, panel.height_deg),
                    angle,
                    format!("panel:{}", panel.id),
                )
            }),
        }
    });
    targets.chain(panels).collect()
}

/// Circular mean RA and arithmetic mean declination, as association evidence
/// averages pointing.
fn mean_pointing(points: &[SkyPoint]) -> Option<SkyPoint> {
    let mut ra = sky::CircularMean::new();
    for point in points {
        ra.push(sky::Angle::from_degrees(point.ra_deg));
    }
    #[expect(clippy::cast_precision_loss, reason = "frame counts are far below 2^52")]
    let dec = points.iter().map(|point| point.dec_deg).sum::<f64>() / points.len() as f64;
    valid_point(Some(ra.mean()?.normalized_0_360().degrees()), Some(dec))
}

/// Lowest per-frame normalized coverage of `panel`, or `None` when a
/// comparison fails. A frame beyond the centre-separation bound is provably
/// disjoint and skips polygon work (R7).
fn panel_coverage(frames: &[&FrameGeometry], panel: &SkyFootprint) -> Option<f64> {
    let mut lowest = f64::INFINITY;
    for frame in frames {
        let footprint = frame.footprint.as_ref()?;
        let bound = footprint.diagonal().degrees() + panel.diagonal().degrees();
        let coverage = if separation_deg(footprint.centre(), panel.centre()) > bound {
            0.0
        } else {
            compare_footprints(footprint, panel).ok()?.normalized_coverage
        };
        lowest = lowest.min(coverage);
    }
    lowest.is_finite().then_some(lowest)
}

fn frames_hold_target(frames: &[&FrameGeometry], target: sky::Equatorial) -> bool {
    frames.iter().all(|frame| {
        let (Some(pointing), Some(angle), Some(fov)) =
            (frame.pointing.and_then(position), frame.orientation_deg, frame.fov.as_ref())
        else {
            return false;
        };
        let shape = Membership::Rotated {
            fov: (
                sky::Angle::from_degrees(fov.width_deg),
                sky::Angle::from_degrees(fov.height_deg),
            ),
            position_angle: sky::Angle::from_degrees(angle),
        };
        is_framed(pointing, &Point(target), shape).in_frame
    })
}

/// Classify one session's light frames against the criteria framing and apply
/// the overlap (R7) and pointing-radius (R8) rules. Frames of a known non-light
/// type take no part; frames of unknown type do.
#[must_use]
pub fn session_geometry(frames: &[FrameGeometry], criteria: &ViewCriteria) -> GeometryEvidence {
    let lights: Vec<&FrameGeometry> =
        frames.iter().filter(|frame| frame.light != Some(false)).collect();
    let count = |frames: usize| u64::try_from(frames).unwrap_or(u64::MAX);
    let pointings: Vec<SkyPoint> = lights.iter().filter_map(|frame| frame.pointing).collect();
    let mut evidence = GeometryEvidence {
        class: GeometryClass::PositionUnknown,
        unknown: vec![GeometryUnknown::PointingUnknown],
        light_frames: count(lights.len()),
        frames_with_pointing: count(pointings.len()),
        frames_without_pointing: count(lights.len() - pointings.len()),
        mean_pointing: None,
        distance_deg: None,
        nearest: None,
        pointing_spread_deg: None,
        fov: None,
        footprint: None,
        matched: None,
        coverage: None,
        within_radius: false,
    };
    if lights.is_empty() || pointings.len() < lights.len() {
        return evidence;
    }
    let Some(mean) = mean_pointing(&pointings) else {
        return evidence;
    };
    let Some(mean_position) = position(mean) else {
        return evidence;
    };
    evidence.mean_pointing = Some(mean);
    let framing = framing_footprints(&criteria.framing);
    let nearest = framing
        .iter()
        .filter_map(|element| {
            Some((separation_deg(mean_position, position(element.centre?)?), element.element))
        })
        .min_by(|left, right| left.0.total_cmp(&right.0));
    evidence.distance_deg = nearest.map(|(distance, _)| distance);
    evidence.nearest = nearest.map(|(_, element)| element);

    let spread = |frame: &&FrameGeometry| {
        frame
            .pointing
            .and_then(position)
            .map_or(f64::INFINITY, |p| separation_deg(p, mean_position))
    };
    evidence.pointing_spread_deg =
        lights.iter().map(spread).filter(|spread| spread.is_finite()).reduce(f64::max);
    if let Some(representative) = lights.iter().min_by(|left, right| {
        spread(left).total_cmp(&spread(right)).then(left.asset_id.cmp(&right.asset_id))
    }) {
        evidence.fov.clone_from(&representative.fov);
        evidence.footprint = representative
            .footprint
            .as_ref()
            .map(|footprint| footprint_evidence(footprint, Some(representative.asset_id)));
    }

    let mut unknown = Vec::new();
    if lights.iter().any(|frame| frame.orientation_deg.is_none()) {
        unknown.push(GeometryUnknown::OrientationUnknown);
    }
    if lights.iter().any(|frame| frame.fov.is_none()) {
        unknown.push(GeometryUnknown::FovUnknown);
    }
    if !unknown.is_empty() || lights.iter().any(|frame| frame.footprint.is_none()) {
        evidence.class = GeometryClass::PointingOnly;
        evidence.footprint = None;
        if unknown.is_empty() {
            unknown.push(GeometryUnknown::FovUnknown);
        }
        evidence.unknown = unknown;
        evidence.within_radius = evidence
            .distance_deg
            .is_some_and(|distance| distance <= criteria.suggestion_radius_deg);
        return evidence;
    }
    evidence.class = GeometryClass::Footprint;
    evidence.unknown = Vec::new();

    (evidence.matched, evidence.coverage) = match_framing(&framing, &lights, criteria);
    evidence
}

/// The first framing element every footprint matches, and the lowest per-frame
/// coverage of the best compared panel.
fn match_framing(
    framing: &[FramingFootprint],
    lights: &[&FrameGeometry],
    criteria: &ViewCriteria,
) -> (Option<FramingMatch>, Option<f64>) {
    let mut first = None;
    let mut best_panel: Option<f64> = None;
    for element in framing {
        let matched = match element.element {
            FramingElement::Target { .. } => element
                .centre
                .and_then(position)
                .filter(|target| frames_hold_target(lights, *target))
                .map(|_| FramingMatch { element: element.element, coverage: None }),
            FramingElement::Panel { .. } => {
                let coverage =
                    element.footprint.as_ref().and_then(|panel| panel_coverage(lights, panel));
                if let Some(coverage) = coverage {
                    best_panel = Some(best_panel.map_or(coverage, |best| best.max(coverage)));
                }
                coverage.filter(|coverage| *coverage >= criteria.min_footprint_coverage).map(
                    |coverage| FramingMatch { element: element.element, coverage: Some(coverage) },
                )
            }
        };
        if first.is_none() {
            first = matched;
        }
    }
    (first, best_panel)
}
