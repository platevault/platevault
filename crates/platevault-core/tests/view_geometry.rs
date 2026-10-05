//! Pure frame and session geometry over target-match footprints (spec 066,
//! VSEL-FR-03/04/07, VSEL-AC-01/02/08). Every input is constructed evidence:
//! no catalog, no file and no OBJECT takes part.

use platevault_core::view_geometry::{frame_geometry, framing_footprints, session_geometry};
use platevault_core::{
    AssociationState, Equipment, FootprintEvidence, FovField, FovSource, FrameEvidence,
    FramingElement, FramingPanel, FramingSnapshot, FramingSource, FramingTarget, GeometryClass,
    GeometryUnknown, Provenance, SkyCoordinates, ViewCriteria,
};
use uuid::Uuid;

const RA: f64 = 314.75;
const DEC: f64 = 44.5;
/// arcsec per pixel of 3.76 µm behind 250 mm, as target-match's small-angle optics.
const SCALE: f64 = 3.76 / 1000.0 / 250.0 * 206_264.806_247_096_36;

fn width_deg(pixels: f64) -> f64 {
    pixels * SCALE / 3600.0
}

fn frame(id: u128, ra: f64, dec: f64, rotation: Option<f64>) -> FrameEvidence {
    FrameEvidence {
        asset_id: Uuid::from_u128(id),
        light: Some(true),
        ra_deg: Some(ra),
        dec_deg: Some(dec),
        sky_rotation_deg: rotation,
        focal_length_mm: Some(250.0),
        pixel_size_um: Some(3.76),
        width: Some(6248),
        height: Some(4176),
        binning_x: Some(1),
        binning_y: Some(1),
        ..FrameEvidence::default()
    }
}

fn equipment(id: u128) -> Equipment {
    Equipment {
        id: Uuid::from_u128(id),
        name: "RedCat 51 / ASI2600MM".into(),
        camera: Some("ASI2600MM".into()),
        telescope: Some("RedCat 51".into()),
        focal_length_mm: Some(250.0),
        pixel_size_um: Some(3.76),
        decision_revision: 1,
        state: AssociationState::Confirmed,
        provenance: Provenance::User,
    }
}

fn target(id: u128, ra: f64, dec: f64) -> FramingTarget {
    FramingTarget {
        target_id: Uuid::from_u128(id),
        revision: 1,
        designation: "NGC 7000".into(),
        coordinates: Some(SkyCoordinates { ra_deg: ra, dec_deg: dec, frame: "icrs".into() }),
    }
}

fn panel(id: u128, dec: f64, angle: Option<f64>) -> FramingPanel {
    FramingPanel {
        id: Uuid::from_u128(id),
        name: format!("P{id}"),
        ra_deg: RA,
        dec_deg: dec,
        width_deg: width_deg(6248.0),
        height_deg: width_deg(4176.0),
        position_angle_deg: angle,
    }
}

fn criteria(targets: Vec<FramingTarget>, panels: Vec<FramingPanel>) -> ViewCriteria {
    ViewCriteria {
        framing: FramingSnapshot {
            source: FramingSource::Project,
            project_revision: Some(1),
            targets,
            panels,
        },
        equipment_ids: Vec::new(),
        min_footprint_coverage: 0.5,
        suggestion_radius_deg: 2.0,
    }
}

fn session(frames: &[FrameEvidence], criteria: &ViewCriteria) -> platevault_core::GeometryEvidence {
    let geometry: Vec<_> = frames.iter().map(|frame| frame_geometry(frame, None)).collect();
    session_geometry(&geometry, criteria)
}

fn close(left: f64, right: f64, tolerance: f64) -> bool {
    (left - right).abs() <= tolerance
}

#[test]
fn wcs_pointing_wins_and_the_field_names_each_input_with_its_source() {
    let mut solved = frame(1, 300.0, 40.0, Some(0.0));
    solved.wcs_ra_deg = Some(RA);
    solved.wcs_dec_deg = Some(DEC);
    let geometry = frame_geometry(&solved, None);
    let pointing = geometry.pointing.expect("pointing");
    assert_eq!((pointing.ra_deg, pointing.dec_deg), (RA, DEC));

    // Header optics: binning stays 1×1 over the binned pixel counts.
    let fov = geometry.fov.expect("header field of view");
    assert!(close(fov.width_deg, width_deg(6248.0), 1e-9), "{fov:?}");
    assert!(close(fov.height_deg, width_deg(4176.0), 1e-9), "{fov:?}");
    assert!(fov.inputs.iter().all(|input| input.source == FovSource::Header), "{fov:?}");
    assert!(
        fov.inputs.iter().all(|input| input.field != FovField::BinningX),
        "header optics never apply binning"
    );
    let mut binned = frame(2, RA, DEC, Some(0.0));
    (binned.width, binned.height, binned.binning_x, binned.binning_y) =
        (Some(3124), Some(2088), Some(2), Some(2));
    let fov = frame_geometry(&binned, None).fov.expect("binned header field");
    assert!(close(fov.width_deg, width_deg(3124.0), 1e-9), "never overstates the field");

    // Without header optics: Confirmed equipment optics times header binning.
    let redcat = equipment(0xE1);
    binned.focal_length_mm = None;
    binned.pixel_size_um = None;
    let fov = frame_geometry(&binned, Some(&redcat)).fov.expect("equipment field");
    assert!(close(fov.width_deg, width_deg(6248.0), 1e-9), "{fov:?}");
    assert!(close(fov.height_deg, width_deg(4176.0), 1e-9), "{fov:?}");
    let source =
        |field| fov.inputs.iter().find(|input| input.field == field).map(|i| (i.value, i.source));
    let from_equipment = FovSource::Equipment { equipment_id: redcat.id };
    assert_eq!(source(FovField::FocalLengthMm), Some((250.0, from_equipment)));
    assert_eq!(source(FovField::PixelSizeUm), Some((3.76, from_equipment)));
    assert_eq!(source(FovField::BinningX), Some((2.0, FovSource::Header)));
    assert_eq!(source(FovField::BinningY), Some((2.0, FovSource::Header)));
    assert_eq!(source(FovField::Width), Some((3124.0, FovSource::Header)));

    // Equipment pixels are unbinned: unknown binning leaves the field unknown.
    binned.binning_x = None;
    assert_eq!(frame_geometry(&binned, Some(&redcat)).fov, None);
    assert_eq!(frame_geometry(&binned, None).fov, None);
}

#[test]
fn sessions_classify_as_footprint_pointing_only_or_position_unknown() {
    let framing = criteria(vec![target(0x7000, RA, DEC)], Vec::new());
    let full = [frame(1, RA, DEC, Some(0.0)), frame(2, RA, DEC + 0.1, Some(0.0))];
    let evidence = session(&full, &framing);
    assert_eq!(evidence.class, GeometryClass::Footprint);
    assert!(evidence.unknown.is_empty());
    assert_eq!((evidence.light_frames, evidence.frames_with_pointing), (2, 2));
    assert!(evidence.distance_deg.is_some_and(|d| close(d, 0.05, 1e-3)), "{evidence:?}");
    assert!(evidence.footprint.is_some() && evidence.fov.is_some());

    let unrotated = [frame(1, RA, DEC, Some(0.0)), frame(2, RA, DEC, None)];
    let evidence = session(&unrotated, &framing);
    assert_eq!(evidence.class, GeometryClass::PointingOnly);
    assert_eq!(evidence.unknown, vec![GeometryUnknown::OrientationUnknown]);
    assert!(evidence.footprint.is_none() && evidence.matched.is_none());

    let mut unknown_field = frame(2, RA, DEC, Some(0.0));
    unknown_field.focal_length_mm = None;
    let evidence = session(&[frame(1, RA, DEC, Some(0.0)), unknown_field], &framing);
    assert_eq!(evidence.class, GeometryClass::PointingOnly);
    assert_eq!(evidence.unknown, vec![GeometryUnknown::FovUnknown]);

    let mut unpointed = frame(3, RA, DEC, Some(0.0));
    (unpointed.ra_deg, unpointed.dec_deg) = (None, None);
    let evidence = session(&[full[0].clone(), full[1].clone(), unpointed], &framing);
    assert_eq!(evidence.class, GeometryClass::PositionUnknown);
    assert_eq!(evidence.unknown, vec![GeometryUnknown::PointingUnknown]);
    assert_eq!(evidence.distance_deg, None, "unknown position is never distance 0");
    assert_eq!(evidence.mean_pointing, None);
    assert_eq!((evidence.frames_with_pointing, evidence.frames_without_pointing), (2, 1));
    assert!(evidence.matched.is_none() && evidence.footprint.is_none());
}

#[test]
fn a_target_framing_matches_only_inside_every_rotated_frame_rectangle() {
    let framing = criteria(vec![target(0x7000, RA, DEC)], Vec::new());
    let element = FramingElement::Target { target_id: Uuid::from_u128(0x7000) };
    let inside = [frame(1, RA, DEC, Some(10.0)), frame(2, RA, DEC + 1.0, Some(10.0))];
    assert_eq!(session(&inside, &framing).matched.map(|m| m.element), Some(element));

    let missed = [frame(1, RA, DEC, Some(10.0)), frame(2, RA, DEC + 4.0, Some(10.0))];
    assert_eq!(session(&missed, &framing).matched, None, "every frame must hold the Target");

    // 2.2° east of centre lies inside the 5.38° width but outside the 3.60°
    // height once the frame turns by 90°.
    let shift = 2.2 / DEC.to_radians().cos();
    let east = [frame(1, RA - shift, DEC, Some(0.0))];
    assert_eq!(session(&east, &framing).matched.map(|m| m.element), Some(element));
    let turned = [frame(1, RA - shift, DEC, Some(90.0))];
    assert_eq!(session(&turned, &framing).matched, None);
}

#[test]
fn a_panel_framing_matches_by_normalized_coverage_at_the_threshold() {
    let height = width_deg(4176.0);
    let framing = criteria(Vec::new(), vec![panel(0xA, DEC, Some(0.0))]);
    let element = FramingElement::Panel { panel_id: Uuid::from_u128(0xA) };

    let high = [frame(1, RA, DEC + 0.05 * height, Some(0.0))];
    let evidence = session(&high, &framing);
    let coverage = evidence.coverage.expect("compared coverage");
    assert!(close(coverage, 0.95, 0.01), "{coverage}");
    assert_eq!(evidence.matched.map(|m| m.element), Some(element));

    let low = [frame(1, RA, DEC + 0.95 * height, Some(0.0))];
    let evidence = session(&low, &framing);
    assert!(evidence.coverage.is_some_and(|c| close(c, 0.05, 0.01)), "{evidence:?}");
    assert_eq!(evidence.matched, None);

    // Coverage exactly at the threshold matches.
    let mut exact = framing.clone();
    exact.min_footprint_coverage = coverage;
    assert_eq!(session(&high, &exact).matched.map(|m| m.element), Some(element));
    exact.min_footprint_coverage = (coverage + 1e-9).min(1.0);
    assert_eq!(session(&high, &exact).matched, None);

    // The lowest per-frame coverage is the session's.
    let both = [frame(1, RA, DEC, Some(0.0)), high[0].clone()];
    let matched = session(&both, &framing).matched.expect("both frames cover the panel");
    assert!(matched.coverage.is_some_and(|c| close(c, coverage, 1e-12)), "{matched:?}");

    // A panel without orientation has no footprint and matches nothing.
    let unoriented = criteria(Vec::new(), vec![panel(0xB, DEC, None)]);
    let evidence = session(&[frame(1, RA, DEC, Some(0.0))], &unoriented);
    assert_eq!((evidence.matched, evidence.coverage), (None, None));
    let footprints = framing_footprints(&unoriented.framing);
    assert_eq!(footprints.len(), 1);
    assert!(footprints[0].evidence().is_none());
    assert!(framing_footprints(&framing.framing)[0].evidence().is_some());
}

#[test]
fn object_never_takes_part_in_geometry() {
    let framing = criteria(vec![target(0x7000, RA, DEC)], vec![panel(0xA, DEC, Some(0.0))]);
    let labelled = |object: Option<&str>| {
        let mut evidence = frame(1, RA, DEC, Some(5.0));
        evidence.object = object.map(str::to_owned);
        session(&[evidence], &framing)
    };
    let reference = labelled(Some("NGC 7000"));
    assert!(reference.matched.is_some());
    assert_eq!(labelled(Some("Cygnus field")), reference);
    assert_eq!(labelled(None), reference);
}

#[test]
fn pointing_only_sessions_are_suggested_within_the_radius_and_never_matched() {
    let framing = criteria(vec![target(0x7000, RA, DEC)], Vec::new());
    let near = [frame(1, RA, DEC + 1.0, None), frame(2, RA, DEC + 1.0, None)];
    let evidence = session(&near, &framing);
    assert_eq!(evidence.class, GeometryClass::PointingOnly);
    assert!(evidence.within_radius);
    assert!(evidence.distance_deg.is_some_and(|d| close(d, 1.0, 1e-6)), "{evidence:?}");
    assert_eq!(
        evidence.nearest,
        Some(FramingElement::Target { target_id: Uuid::from_u128(0x7000) })
    );
    assert_eq!(evidence.matched, None);

    let far = [frame(1, RA, DEC + 3.0, None)];
    let evidence = session(&far, &framing);
    assert!(!evidence.within_radius);
    assert!(evidence.distance_deg.is_some_and(|d| close(d, 3.0, 1e-6)));
    assert_eq!(evidence.matched, None);
}

#[test]
fn a_distant_session_skips_polygon_work_and_reads_outside_with_its_representative_footprint() {
    let framing = criteria(Vec::new(), vec![panel(0xA, DEC, Some(0.0))]);
    // Nearly antipodal: comparing these polygons would fail to project, so a
    // `Some(0)` coverage proves the centre-separation bound decided it.
    let (ra, dec) = (RA - 179.0, -DEC);
    let frames = [
        frame(1, ra, dec, Some(0.0)),
        frame(2, ra, dec + 0.25, Some(0.0)),
        frame(3, ra, dec + 0.5, Some(0.0)),
    ];
    let evidence = session(&frames, &framing);
    assert_eq!(evidence.class, GeometryClass::Footprint);
    assert_eq!(evidence.matched, None);
    assert_eq!(evidence.coverage, Some(0.0), "outside, not unknown");
    assert!(evidence.distance_deg.is_some_and(|d| d > 170.0), "{evidence:?}");

    let FootprintEvidence { asset_id, corners, .. } =
        evidence.footprint.as_ref().expect("representative");
    assert_eq!(*asset_id, Some(Uuid::from_u128(2)), "the frame nearest the mean pointing");
    assert_eq!(corners.len(), 4);
    assert!(evidence.pointing_spread_deg.is_some_and(|s| close(s, 0.25, 1e-3)), "{evidence:?}");
}
