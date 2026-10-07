// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Rig filter lists, camera kind and field of view (spec 072 PLAN-EQ-FR-01..06,
//! LIB-FR-05 unknown filter part).

mod support;

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use persistence_library::SessionQuery;
use platevault_core::library::Library;
use platevault_core::rig::field_of_view;
use platevault_core::*;
use uuid::Uuid;

fn rig_record(
    name: &str,
    color_kind: Option<ColorKind>,
    sensor: Option<(u32, u32)>,
    pixel_size_um: Option<f64>,
    focal_length_mm: Option<f64>,
) -> Equipment {
    Equipment {
        id: Uuid::new_v4(),
        name: name.into(),
        camera: Some(format!("{name} camera")),
        telescope: None,
        focal_length_mm,
        pixel_size_um,
        sensor_width_px: sensor.map(|(width, _)| width),
        sensor_height_px: sensor.map(|(_, height)| height),
        color_kind,
        decision_revision: 0,
        state: AssociationState::Confirmed,
        provenance: Provenance::User,
    }
}

/// `RedCat`: an `ASI2600MM` (mono, 6248 × 4176 px of 3.76 µm) at 250 mm.
fn redcat() -> Equipment {
    rig_record("RedCat", Some(ColorKind::Mono), Some((6248, 4176)), Some(3.76), Some(250.0))
}

/// `Esprit`: an `ASI533MC` (OSC, 3008 × 3008 px of 3.76 µm) at 550 mm.
fn esprit() -> Equipment {
    rig_record("Esprit", Some(ColorKind::Osc), Some((3008, 3008)), Some(3.76), Some(550.0))
}

fn filter(name: &str, values: &[&str], bands: &[Band]) -> RigFilter {
    RigFilter {
        id: Uuid::new_v4(),
        name: name.into(),
        match_values: values.iter().map(|value| (*value).to_owned()).collect(),
        bands: bands.to_vec(),
    }
}

async fn open(dir: &Path) -> Arc<Library> {
    Library::open(&dir.join("library.sqlite"), None).await.unwrap()
}

async fn saved(library: &Library, equipment: &Equipment) -> Equipment {
    library.catalog().save_equipment(equipment, None).await.unwrap()
}

#[tokio::test]
async fn mono_rig_lists_seven_bands() {
    let temp = tempfile::tempdir().unwrap();
    let library = open(temp.path()).await;
    let rig = saved(&library, &redcat()).await;
    let empty = library.rig(rig.id).await.unwrap();
    assert!(empty.bands.is_empty(), "a mono rig with no filters passes no band");
    assert_eq!(empty.filters.revision, 0, "a never-saved list reads revision 0");

    let filters = vec![
        filter("L", &["L", "Lum"], &[Band::L]),
        filter("R", &["R"], &[Band::R]),
        filter("G", &["G"], &[Band::G]),
        filter("B", &["B"], &[Band::B]),
        filter("Ha", &["Ha"], &[Band::Ha]),
        filter("SII", &["SII"], &[Band::Sii]),
        filter("OIII", &["OIII"], &[Band::Oiii]),
    ];
    let saved = library.save_rig_filters(rig.id, &filters, 0).await.unwrap();
    let all = vec![Band::L, Band::R, Band::G, Band::B, Band::Ha, Band::Sii, Band::Oiii];
    assert_eq!(saved.bands, all);
    assert_eq!(saved.filters.revision, 1);
    assert_eq!(saved.filters.filters, filters, "each filter keeps its values, band and position");

    drop(library);
    let reopened = open(temp.path()).await;
    let durable = reopened.rig(rig.id).await.unwrap();
    assert_eq!(durable.bands, all, "the list is durable");
    assert_eq!(durable.filters.filters, filters);
    assert_eq!(durable.equipment.color_kind, Some(ColorKind::Mono));
}

#[tokio::test]
async fn osc_rig_with_empty_list_captures_rgb() {
    let temp = tempfile::tempdir().unwrap();
    let library = open(temp.path()).await;
    let rig = saved(&library, &esprit()).await;
    let read = library.rig(rig.id).await.unwrap();
    assert_eq!(read.equipment.color_kind, Some(ColorKind::Osc), "OSC comes from the camera");
    assert!(read.filters.filters.is_empty());
    assert_eq!(read.bands, vec![Band::R, Band::G, Band::B]);
}

#[tokio::test]
async fn dual_band_osc_passes_rgb_ha_oiii() {
    let temp = tempfile::tempdir().unwrap();
    let library = open(temp.path()).await;
    let rig = saved(&library, &esprit()).await;
    let dual = [filter("L-eXtreme", &["L-eXtreme", "LeXtr"], &[Band::Oiii, Band::Ha])];
    let read = library.save_rig_filters(rig.id, &dual, 0).await.unwrap();
    assert_eq!(read.bands, vec![Band::R, Band::G, Band::B, Band::Ha, Band::Oiii]);
}

const HALPHA_FRAMES: [&str; 2] = ["Halpha_001.fits", "Halpha_002.fits"];

fn write_halpha(root: &Path, name: &str, start: &str) {
    support::fits(
        &root.join(name),
        &[
            ("IMAGETYP", "'LIGHT'"),
            ("FILTER", "'Halpha'"),
            ("EXPTIME", "300"),
            ("DATE-OBS", &format!("'{start}'")),
            ("OBJECT", "'NGC 7000'"),
            ("INSTRUME", "'ZWO ASI2600MM Pro'"),
            ("TELESCOP", "'RedCat 51'"),
            ("FOCALLEN", "250"),
        ],
    )
    .unwrap();
}

async fn scan_to_end(library: &Arc<Library>, location: Uuid) -> ScanOperation {
    let mut progress = library.subscribe_scan_progress();
    let started = library.start_scan(location, None).await.unwrap();
    tokio::time::timeout(Duration::from_secs(20), async {
        loop {
            let operation = progress.recv().await.unwrap();
            if operation.id == started.id && operation.state != ScanState::Running {
                return operation;
            }
        }
    })
    .await
    .expect("scan must publish its terminal state")
}

/// The J15 `Halpha-test` session, the `RedCat` rig listing Ha and OIII and the
/// OSC `Esprit` rig with an empty list.
struct HalphaTest {
    _temp: tempfile::TempDir,
    root: PathBuf,
    library: Arc<Library>,
    session: Session,
    redcat: Equipment,
    esprit: Equipment,
}

impl HalphaTest {
    async fn new() -> Self {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("Filter-test").join("Captures");
        std::fs::create_dir_all(&root).unwrap();
        write_halpha(&root, HALPHA_FRAMES[0], "2026-09-12T22:00:00");
        write_halpha(&root, HALPHA_FRAMES[1], "2026-09-12T22:05:00");
        let library = open(temp.path()).await;
        let location = library
            .register_location(
                NativePath::from_path(&root),
                "Filter-test/Captures".into(),
                LocationRole::Captures,
            )
            .await
            .unwrap();
        assert_eq!(scan_to_end(&library, location.id).await.state, ScanState::Completed);
        let sessions = library.catalog().list_sessions(&SessionQuery::default()).await.unwrap();
        assert_eq!(sessions.len(), 1);
        let session = sessions[0].session.clone();
        let redcat = saved(&library, &redcat()).await;
        let esprit = saved(&library, &esprit()).await;
        let listed = [filter("Ha", &["Ha"], &[Band::Ha]), filter("OIII", &["OIII"], &[Band::Oiii])];
        library.save_rig_filters(redcat.id, &listed, 0).await.unwrap();
        Self { _temp: temp, root, library, session, redcat, esprit }
    }

    fn digests(&self) -> Vec<String> {
        HALPHA_FRAMES.iter().map(|name| support::digest(&self.root.join(name))).collect()
    }

    async fn confirm_redcat(&self) {
        let expected = ExpectedSession {
            session_id: self.session.id,
            grouping_revision: self.session.grouping_revision,
            decision_revision: self.session.decision_revision,
        };
        self.library.catalog().confirm_equipment(&[expected], self.redcat.id).await.unwrap();
    }

    fn halpha_unknown_on_redcat(&self) -> Vec<RigFilterValues> {
        vec![RigFilterValues {
            equipment_id: self.redcat.id,
            rig_name: "RedCat".into(),
            values: vec![RigFilterValue {
                value: "Halpha".into(),
                session_ids: vec![self.session.id],
            }],
        }]
    }

    async fn observed_filters(&self) -> Vec<Option<String>> {
        let detail = self.library.catalog().session(self.session.id).await.unwrap();
        detail.assets.iter().map(|asset| asset.observed.filter.clone()).collect()
    }
}

#[tokio::test]
async fn unmatched_filter_reads_unknown_and_add_changes_only_rig() {
    let fx = HalphaTest::new().await;
    let before = fx.digests();
    assert!(
        fx.library.rig_unknown_filters(None).await.unwrap().is_empty(),
        "no prompt names a rig before the session's rig is confirmed"
    );

    fx.confirm_redcat().await;
    assert_eq!(fx.library.rig_unknown_filters(None).await.unwrap(), fx.halpha_unknown_on_redcat());
    assert_eq!(
        fx.library.rig_unknown_filters(Some(fx.redcat.id)).await.unwrap(),
        fx.halpha_unknown_on_redcat()
    );
    assert!(fx.library.rig_unknown_filters(Some(fx.esprit.id)).await.unwrap().is_empty());

    // "Add Halpha to RedCat" with band Ha.
    let rig = fx.library.rig(fx.redcat.id).await.unwrap();
    let mut filters = rig.filters.filters.clone();
    filters.push(filter("Halpha", &["Halpha"], &[Band::Ha]));
    let added =
        fx.library.save_rig_filters(fx.redcat.id, &filters, rig.filters.revision).await.unwrap();
    assert_eq!(added.filters.filters.len(), 3, "Ha, OIII and Halpha");
    assert_eq!(added.bands, vec![Band::Ha, Band::Oiii]);
    assert!(
        fx.library.rig_unknown_filters(None).await.unwrap().is_empty(),
        "Halpha leaves the unknown values listed for RedCat"
    );

    let esprit = fx.library.rig(fx.esprit.id).await.unwrap();
    assert!(esprit.filters.filters.is_empty(), "adding to RedCat leaves Esprit's list empty");
    assert_eq!(esprit.filters.revision, 0);
    assert_eq!(esprit.equipment.decision_revision, fx.esprit.decision_revision);
    assert_eq!(added.equipment.decision_revision, fx.redcat.decision_revision);
    assert_eq!(fx.digests(), before, "no header byte changes");
    assert_eq!(fx.observed_filters().await, vec![Some("Halpha".to_owned()); 2]);
    let associations = fx.library.catalog().session(fx.session.id).await.unwrap().associations;
    assert!(associations.iter().any(|association| association.kind == AssociationKind::Equipment
        && association.subject_id == Some(fx.redcat.id)
        && association.state == AssociationState::Confirmed));
}

#[tokio::test]
async fn declined_prompt_keeps_unknown() {
    let fx = HalphaTest::new().await;
    fx.confirm_redcat().await;
    let before = fx.library.rig(fx.redcat.id).await.unwrap();
    assert_eq!(fx.library.rig_unknown_filters(None).await.unwrap(), fx.halpha_unknown_on_redcat());

    // Declining writes nothing: the prompt stays available on the session and in
    // Settings > Equipment, and RedCat's list is unchanged.
    let after = fx.library.rig(fx.redcat.id).await.unwrap();
    assert_eq!(after.filters, before.filters);
    let names: Vec<&str> = after.filters.filters.iter().map(|f| f.name.as_str()).collect();
    assert_eq!(names, ["Ha", "OIII"]);
    assert_eq!(fx.library.rig_unknown_filters(None).await.unwrap(), fx.halpha_unknown_on_redcat());
    assert_eq!(
        fx.library.rig_unknown_filters(Some(fx.redcat.id)).await.unwrap(),
        fx.halpha_unknown_on_redcat()
    );
    assert_eq!(fx.observed_filters().await, vec![Some("Halpha".to_owned()); 2]);
}

#[tokio::test]
async fn fov_unknown_when_sensor_or_focal_unknown() {
    let close = |value: f64, expected: f64| (value - expected).abs() < 0.01;
    let fov = field_of_view(&redcat()).expect("RedCat has every dimension");
    assert!(close(fov.width_deg, 5.38) && close(fov.height_deg, 3.60), "{fov:?}");
    let fov = field_of_view(&esprit()).expect("Esprit has every dimension");
    assert!(close(fov.width_deg, 1.18) && close(fov.height_deg, 1.18), "{fov:?}");

    let mut unknown = redcat();
    unknown.sensor_width_px = None;
    assert!(field_of_view(&unknown).is_none(), "sensor width unknown");
    let mut unknown = redcat();
    unknown.sensor_height_px = None;
    assert!(field_of_view(&unknown).is_none(), "sensor height unknown");
    let mut unknown = redcat();
    unknown.pixel_size_um = None;
    assert!(field_of_view(&unknown).is_none(), "pixel size unknown");
    let mut unknown = redcat();
    unknown.focal_length_mm = None;
    assert!(field_of_view(&unknown).is_none(), "focal length unknown");

    let temp = tempfile::tempdir().unwrap();
    let library = open(temp.path()).await;
    let known = saved(&library, &redcat()).await;
    let read = library.rig(known.id).await.unwrap();
    assert_eq!(read.equipment.sensor_width_px, Some(6248));
    assert_eq!(read.equipment.sensor_height_px, Some(4176));
    assert!(read.field_of_view.is_some_and(|fov| close(fov.width_deg, 5.38)));
    let no_focal =
        saved(&library, &rig_record("No focal", None, Some((6248, 4176)), Some(3.76), None)).await;
    assert!(library.rig(no_focal.id).await.unwrap().field_of_view.is_none());
    let no_sensor =
        saved(&library, &rig_record("No sensor", None, None, Some(3.76), Some(250.0))).await;
    assert!(library.rig(no_sensor.id).await.unwrap().field_of_view.is_none());
}
