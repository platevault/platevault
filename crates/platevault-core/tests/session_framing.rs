// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Sessions split at intake by framing (spec 064 LIB-FR-04, LIB-AC-31/32;
//! D-W107), on real generated FITS headers: pointing within 5′ and ROTATANG
//! within 5° stay one session whatever the field, a meridian flip never
//! splits, the sky angle alone reads 180° as the same framing, lights without
//! pointing stay together, exposure still splits, the split is deterministic
//! and non-transitive, a framing label holds lights together, rescans
//! keep every session id, and a later Settings change re-splits no indexed
//! session: new frames join a session by its own intake limits.

#[path = "support/scan.rs"]
mod scan_support;
mod support;

use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use metadata_core::MetadataExtractor;
use persistence_library::SessionQuery;
use platevault_core::grouping;
use platevault_core::library::Library;
use platevault_core::*;
use uuid::Uuid;

/// The fixture writer's 4×4 pixels at 3.76 µm behind 250 mm: the field
/// diagonal, in degrees. The centre limit is an angle, so this tiny field
/// never narrows it.
fn diagonal_deg() -> f64 {
    let pixel_arcsec = 206.264_806 * 3.76 / 250.0;
    4.0 * pixel_arcsec * std::f64::consts::SQRT_2 / 3600.0
}

const RA: f64 = 314.68;
const DEC: f64 = 44.31;

/// One light of the night of 14 October: `minute` after 19:00 UTC, its centre
/// `offset` arcminutes north of the first framing.
#[derive(Clone, Copy)]
struct Shot {
    minute: u32,
    offset: Option<f64>,
    rotatang: Option<f64>,
    sky_angle: Option<f64>,
    exposure: u32,
}

impl Shot {
    const fn at(minute: u32) -> Self {
        Self { minute, offset: Some(0.0), rotatang: Some(12.4), sky_angle: None, exposure: 300 }
    }

    const fn offset(self, offset: f64) -> Self {
        Self { offset: Some(offset), ..self }
    }

    const fn unpointed(self) -> Self {
        Self { offset: None, ..self }
    }

    const fn rotatang(self, rotatang: Option<f64>) -> Self {
        Self { rotatang, ..self }
    }

    const fn sky_angle(self, sky_angle: f64) -> Self {
        Self { sky_angle: Some(sky_angle), ..self }
    }

    const fn exposure(self, exposure: u32) -> Self {
        Self { exposure, ..self }
    }

    fn cards(&self, image_type: &str) -> Vec<(String, String)> {
        let (hour, minute) = (19 + self.minute / 60, self.minute % 60);
        let mut cards = vec![
            ("IMAGETYP", format!("'{image_type}'")),
            ("FILTER", "'Ha'".into()),
            ("EXPTIME", self.exposure.to_string()),
            ("GAIN", "100".into()),
            ("OFFSET", "50".into()),
            ("INSTRUME", "'ASI2600MM'".into()),
            ("TELESCOP", "'RedCat 51'".into()),
            ("FOCALLEN", "250".into()),
            ("XPIXSZ", "3.76".into()),
            ("SET-TEMP", "-10".into()),
            ("OBJECT", "'NGC 7000'".into()),
            ("DATE-OBS", format!("'2026-10-14T{hour:02}:{minute:02}:00'")),
            ("DATE-LOC", format!("'2026-10-14T{:02}:{minute:02}:00'", hour + 2)),
        ];
        if let Some(offset) = self.offset {
            cards.push(("RA", format!("{RA:.7}")));
            cards.push(("DEC", format!("{:.9}", DEC + offset / 60.0)));
        }
        if let Some(rotatang) = self.rotatang {
            cards.push(("ROTATANG", format!("{rotatang:.3}")));
        }
        if let Some(sky_angle) = self.sky_angle {
            cards.push(("OBJCTROT", format!("{sky_angle:.3}")));
        }
        cards.into_iter().map(|(key, value)| (key.to_owned(), value)).collect()
    }

    fn write(&self, path: &Path, image_type: &str) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        let cards = self.cards(image_type);
        let cards: Vec<(&str, &str)> =
            cards.iter().map(|(key, value)| (key.as_str(), value.as_str())).collect();
        support::fits(path, &cards).unwrap();
    }
}

/// An asset whose effective metadata is exactly what the shared FITS adapter
/// reads from the shot's real header.
fn asset(name: &str, shot: Shot, image_type: &str) -> Asset {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join(name);
    shot.write(&path, image_type);
    let metadata =
        CaptureMetadata::from(&metadata_fits::FitsExtractor.extract(&path).unwrap().unwrap());
    Asset {
        id: Uuid::new_v4(),
        location_id: Uuid::nil(),
        relative_path: NativePath::from_path(Path::new(name)),
        fingerprint: ObservationFingerprint {
            identity: FileIdentity {
                volume: VolumeIdentity {
                    filesystem: "apfs".into(),
                    stable_id: Some("VOLUME".into()),
                    file_ids_stable: false,
                    case: PathSensitivity::Unknown,
                    normalization: PathSensitivity::Unknown,
                },
                file_id: None,
            },
            size_bytes: 5760,
            modified_ns: 1,
            content_sha256: None,
        },
        observation_revision: 1,
        decision_revision: 1,
        format: ImageFormat::Fits,
        availability: Availability::Available,
        observed: metadata.clone(),
        effective: metadata,
        quality: Quality::Unreviewed,
        quality_basis: None,
        verification_pending: false,
        last_observed_at: "2026-10-15T00:00:00Z".into(),
        last_verified_at: None,
    }
}

fn lights(shots: &[Shot]) -> Vec<Asset> {
    shots
        .iter()
        .enumerate()
        .map(|(index, shot)| asset(&format!("NGC7000_Ha_{index:03}.fits"), *shot, "LIGHT"))
        .collect()
}

fn group(assets: &[Asset]) -> GroupingResult {
    grouping::regroup_assets(assets, &[], &FramingMargins::default())
}

fn ids(assets: &[Asset]) -> Vec<Uuid> {
    let mut ids: Vec<Uuid> = assets.iter().map(|asset| asset.id).collect();
    ids.sort_unstable();
    ids
}

fn framing(candidate: &SessionCandidate) -> &SessionFraming {
    candidate.framing.as_ref().expect("a framed light session")
}

/// LIB-AC-31's night: 25 frames before a meridian flip, 15 after it at the
/// same framing (the sky angle turned half a turn, ROTATANG unchanged, the
/// centre jittering within 0.4′), and 20 pointing 8′ away.
fn flip_night() -> Vec<Shot> {
    let mut shots = Vec::new();
    for minute in 60..85 {
        let jitter = if minute % 2 == 0 { 0.4 } else { -0.3 };
        shots.push(Shot::at(minute).offset(jitter).sky_angle(12.4));
    }
    for minute in 90..105 {
        shots.push(Shot::at(minute).offset(0.2).sky_angle(192.4));
    }
    for minute in 110..130 {
        shots.push(Shot::at(minute).offset(8.0).sky_angle(12.4));
    }
    shots
}

#[test]
fn a_night_splits_by_framing_and_a_meridian_flip_does_not() {
    let assets = lights(&flip_night());

    let result = group(&assets);

    assert_eq!(result.sessions.len(), 2, "one framing either side of the flip, one shifted");
    let (first, second) = (&result.sessions[0], &result.sessions[1]);
    assert_eq!(first.key, second.key, "framing joins identity beside the exact capture key");
    assert_eq!(first.asset_ids, ids(&assets[..40]), "the flip does not split");
    assert_eq!(second.asset_ids, ids(&assets[40..]), "8′ away starts a framing");
    let (first, second) = (framing(first), framing(second));
    assert_eq!((first.ordinal, second.ordinal), (1, 2), "\"framing 2\" is the later framing");
    assert_eq!(first.anchor_asset_id, assets[0].id, "the first frame in capture order anchors");
    assert_eq!(second.anchor_asset_id, assets[40].id);
    assert_eq!(first.rotator_deg, Some(12.4));
    let field = first.field.expect("the header optics give the field");
    let diagonal = field.width_deg.hypot(field.height_deg);
    assert!((diagonal - diagonal_deg()).abs() < 1e-9, "{diagonal} vs {}", diagonal_deg());
    assert_eq!(first.label, None);
}

#[test]
fn rotation_beyond_the_margin_splits_and_never_chains() {
    let assets = lights(&[
        Shot::at(0).rotatang(Some(0.0)),
        Shot::at(1).rotatang(Some(3.0)),
        Shot::at(2).rotatang(Some(4.5)),
        Shot::at(3).rotatang(Some(359.0)),
        // Within 5° of the frame before it, not of the anchor.
        Shot::at(4).rotatang(Some(8.0)),
        Shot::at(5).rotatang(Some(9.0)),
    ]);

    let result = group(&assets);

    let shape: Vec<Vec<Uuid>> =
        result.sessions.iter().map(|session| session.asset_ids.clone()).collect();
    assert_eq!(shape, vec![ids(&assets[..4]), ids(&assets[4..])], "compared with the anchor only");
    assert_eq!(framing(&result.sessions[1]).anchor_asset_id, assets[4].id);
    assert_eq!(framing(&result.sessions[1]).rotator_deg, Some(8.0));
}

/// Owner, 2026-10-20: a frame within the limits of two anchors joins the
/// nearest by centre, then by rotation, then the earlier framing.
#[test]
fn a_frame_within_two_framings_joins_the_nearer_rotation_on_a_centre_tie() {
    let assets = lights(&[
        Shot::at(0).rotatang(Some(10.0)),
        // 7° from the first anchor: a second framing at the same centre.
        Shot::at(1).rotatang(Some(17.0)),
        // 4.5° from the first anchor, 2.5° from the second.
        Shot::at(2).rotatang(Some(14.5)),
        // 3.5° from each: the earlier framing.
        Shot::at(3).rotatang(Some(13.5)),
    ]);

    let result = group(&assets);

    let shape: Vec<Vec<Uuid>> =
        result.sessions.iter().map(|session| session.asset_ids.clone()).collect();
    let ids_of = |indices: &[usize]| {
        let mut ids: Vec<Uuid> = indices.iter().map(|&index| assets[index].id).collect();
        ids.sort_unstable();
        ids
    };
    assert_eq!(shape, vec![ids_of(&[0, 3]), ids_of(&[1, 2])], "rotation decides a centre tie");
}

#[test]
fn with_only_the_sky_angle_a_half_turn_is_the_same_framing() {
    let assets = lights(&[
        Shot::at(0).rotatang(None).sky_angle(10.0),
        Shot::at(1).rotatang(None).sky_angle(190.0),
        Shot::at(2).rotatang(None).sky_angle(13.0),
        Shot::at(3).rotatang(None).sky_angle(25.0),
    ]);

    let result = group(&assets);

    assert_eq!(result.sessions.len(), 2);
    assert_eq!(result.sessions[0].asset_ids, ids(&assets[..3]), "180° apart is one framing");
    assert_eq!(result.sessions[1].asset_ids, ids(&assets[3..]), "15° is another");
    assert_eq!(framing(&result.sessions[0]).sky_angle_deg, Some(10.0));
}

#[test]
fn lights_without_pointing_stay_in_one_session_and_calibration_frames_never_split() {
    let unpointed = lights(&[
        Shot::at(0).unpointed().rotatang(Some(0.0)),
        Shot::at(1).unpointed().rotatang(Some(90.0)),
        Shot::at(2).unpointed().rotatang(None),
    ]);
    let flats: Vec<Asset> = [Shot::at(3), Shot::at(4).offset(30.0).rotatang(Some(40.0))]
        .iter()
        .enumerate()
        .map(|(index, shot)| asset(&format!("flat_{index}.fits"), *shot, "FLAT"))
        .collect();
    let mut assets = unpointed.clone();
    assets.extend(flats.iter().cloned());

    let result = group(&assets);

    assert_eq!(result.sessions.len(), 2);
    let light = result.sessions.iter().find(|s| s.asset_ids.contains(&unpointed[0].id)).unwrap();
    assert_eq!(light.asset_ids, ids(&unpointed), "no pointing, no framing split");
    assert_eq!(light.framing, None, "the session has no framing (\"Framing unknown\")");
    assert!(
        light.provisional.iter().any(|note| note.starts_with("framing: no pointing")),
        "{:?}",
        light.provisional
    );
    let flat = result.sessions.iter().find(|s| s.asset_ids.contains(&flats[0].id)).unwrap();
    assert_eq!(flat.asset_ids, ids(&flats), "only lights split by framing");
    assert_eq!(flat.framing, None);
}

#[test]
fn exposure_still_splits_one_framing() {
    let assets =
        lights(&[Shot::at(0), Shot::at(5), Shot::at(10).exposure(120), Shot::at(12).exposure(120)]);

    let result = group(&assets);

    assert_eq!(result.sessions.len(), 2, "one session per exposure time (LIB-AC-32)");
    for session in &result.sessions {
        assert_eq!(framing(session).ordinal, 1, "each exposure's only framing");
    }
    assert_ne!(result.sessions[0].key, result.sessions[1].key);
}

#[test]
fn the_split_is_deterministic_whatever_the_input_order() {
    let assets = lights(&flip_night());
    let mut reversed = assets.clone();
    reversed.reverse();
    let mut interleaved: Vec<Asset> = assets.iter().skip(1).step_by(2).cloned().collect();
    interleaved.extend(assets.iter().step_by(2).cloned());

    let shape = |result: GroupingResult| {
        result
            .sessions
            .into_iter()
            .map(|session| (session.key, session.asset_ids, session.framing))
            .collect::<Vec<_>>()
    };
    let forward = shape(group(&assets));

    assert_eq!(shape(group(&reversed)), forward);
    assert_eq!(shape(group(&interleaved)), forward);
}

#[test]
fn a_framing_label_holds_lights_together_whatever_their_pointing() {
    let mut assets = lights(&flip_night());
    for asset in &mut assets {
        asset.effective.framing_label = Some("merged".into());
    }

    let result = group(&assets);

    assert_eq!(result.sessions.len(), 1, "the user's merge wins over the pointing");
    assert_eq!(result.sessions[0].asset_ids, ids(&assets));
    let merged = framing(&result.sessions[0]);
    assert_eq!(merged.label.as_deref(), Some("merged"));
    assert_eq!((merged.ordinal, merged.anchor_asset_id), (1, assets[0].id));
}

#[test]
fn the_margins_come_from_the_caller() {
    let assets = lights(&flip_night());
    let wide = FramingMargins {
        split: SplitLimits { max_centre_offset_arcmin: 10.0, ..SplitLimits::default() },
        ..FramingMargins::default()
    };

    let result = grouping::regroup_assets(&assets, &[], &wide);

    assert_eq!(result.sessions.len(), 1, "8′ is inside a 10′ centre limit");
}

/// CF2 (owner, 2026-10-20): the centre limit is an angle, 5′ by default,
/// not a share of the field: on this fixture's 17″ field, 4′ is one framing
/// and 6′ is two, as on any other field.
#[test]
fn the_centre_limit_is_an_angle_whatever_the_field() {
    let near = lights(&[Shot::at(0), Shot::at(1).offset(4.0)]);
    let far = lights(&[Shot::at(0), Shot::at(1).offset(6.0)]);

    assert_eq!(group(&near).sessions.len(), 1, "4′ is within the 5′ default");
    assert_eq!(group(&far).sessions.len(), 2, "6′ is beyond it");
}

// ── Intake: real scans of a Captures location ────────────────────────────────

async fn scan(library: &Arc<Library>, location: Uuid) {
    let watch = scan_support::ScanWatch::new(library);
    let started = library.start_scan(location, None).await.unwrap();
    let operation = watch.terminal(started.id, Duration::from_secs(120)).await;
    assert_eq!(operation.state, ScanState::Completed);
}

/// The current light sessions, by framing ordinal.
async fn light_sessions(library: &Library) -> Vec<Session> {
    let mut sessions: Vec<Session> = library
        .catalog()
        .list_sessions(&SessionQuery::default())
        .await
        .unwrap()
        .into_iter()
        .map(|summary| summary.session)
        .collect();
    sessions.sort_by_key(|session| session.framing.as_ref().map(|framing| framing.ordinal));
    sessions
}

#[tokio::test]
async fn intake_splits_by_framing_and_rescans_keep_every_session_id() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("Captures");
    let night = flip_night();
    for (index, shot) in night.iter().enumerate() {
        shot.write(&root.join(format!("NGC7000/NGC7000_Ha_{index:03}.fits")), "LIGHT");
    }
    let library = Library::open(&temp.path().join("catalog.sqlite"), None).await.unwrap();
    let location = library
        .register_location(NativePath::from_path(&root), "Captures".into(), LocationRole::Captures)
        .await
        .unwrap();

    scan(&library, location.id).await;
    let first = light_sessions(&library).await;
    assert_eq!(first.len(), 2);
    assert_eq!((first[0].asset_ids.len(), first[1].asset_ids.len()), (40, 20));
    let ordinals: Vec<u32> =
        first.iter().map(|session| session.framing.as_ref().unwrap().ordinal).collect();
    assert_eq!(ordinals, [1, 2], "the framing is recorded on the session");

    scan(&library, location.id).await;
    let again = light_sessions(&library).await;
    let session_ids = |sessions: &[Session]| sessions.iter().map(|s| s.id).collect::<Vec<_>>();
    assert_eq!(session_ids(&again), session_ids(&first), "an unchanged rescan keeps every id");

    // Later frames of the first framing join it under its id.
    for minute in 140..145 {
        let path = root.join(format!("late/late_{minute}.fits"));
        Shot::at(minute).sky_angle(192.4).write(&path, "LIGHT");
    }
    scan(&library, location.id).await;
    let grown = light_sessions(&library).await;
    assert_eq!(session_ids(&grown), session_ids(&first), "joining frames keep the id");
    assert_eq!(grown[0].asset_ids.len(), 45);

    // An earlier framing indexed later takes ordinal 1; no session is replaced.
    for minute in 0..3 {
        Shot::at(minute)
            .offset(-8.0)
            .write(&root.join(format!("dusk/dusk_{minute}.fits")), "LIGHT");
    }
    scan(&library, location.id).await;
    let all = light_sessions(&library).await;
    assert_eq!(all.len(), 3);
    let kept: Vec<Uuid> = all.iter().skip(1).map(|session| session.id).collect();
    assert_eq!(kept, session_ids(&first), "existing sessions keep their ids");
    let renumbered: Vec<u32> =
        all.iter().map(|session| session.framing.as_ref().unwrap().ordinal).collect();
    assert_eq!(renumbered, [1, 2, 3]);
}

// ── Settings changed after intake (D-W107, owner 2026-10-15/16/20) ──────────

/// Save the workflow settings with these split limits, as Settings does.
async fn save_split(library: &Library, split: SplitLimits) {
    let (mut settings, revision) = library.catalog().workflow_settings().await.unwrap();
    settings.framing.split = split;
    library.catalog().save_workflow_settings(revision, &settings).await.unwrap();
}

/// Write `shots` as lights under `folder`, one file per shot.
fn write_lights(root: &Path, folder: &str, shots: &[Shot]) {
    for (index, shot) in shots.iter().enumerate() {
        shot.write(&root.join(format!("{folder}/{folder}_{index:03}.fits")), "LIGHT");
    }
}

/// A library with a Captures location holding `shots`, scanned once.
async fn indexed_night(temp: &Path, shots: &[Shot]) -> (Arc<Library>, Uuid, std::path::PathBuf) {
    let root = temp.join("Captures");
    write_lights(&root, "night", shots);
    let library = Library::open(&temp.join("catalog.sqlite"), None).await.unwrap();
    let location = library
        .register_location(NativePath::from_path(&root), "Captures".into(), LocationRole::Captures)
        .await
        .unwrap();
    scan(&library, location.id).await;
    (library, location.id, root)
}

/// Each session's id and member count, by framing ordinal.
fn shape(sessions: &[Session]) -> Vec<(Uuid, usize)> {
    sessions.iter().map(|session| (session.id, session.asset_ids.len())).collect()
}

fn is_superset(session: &Session, earlier: &Session) -> bool {
    earlier.asset_ids.iter().all(|asset| session.asset_ids.contains(asset))
}

#[tokio::test]
async fn a_narrower_centre_limit_re_splits_no_indexed_session() {
    let temp = tempfile::tempdir().unwrap();
    // 3′ apart: one framing under the 5′ default.
    let night: Vec<Shot> =
        (0..10).map(|minute| Shot::at(minute).offset(if minute < 5 { 0.0 } else { 3.0 })).collect();
    let (library, location, root) = indexed_night(temp.path(), &night).await;
    let first = light_sessions(&library).await;
    assert_eq!(first.len(), 1, "3′ is within the 5′ default");

    save_split(&library, SplitLimits { max_centre_offset_arcmin: 2.0, ..SplitLimits::default() })
        .await;
    let mut late: Vec<Shot> = (20..23).map(|minute| Shot::at(minute).offset(3.5)).collect();
    late.extend((30..33).map(|minute| Shot::at(minute).offset(8.0)));
    late.extend((34..36).map(|minute| Shot::at(minute).offset(9.5)));
    late.push(Shot::at(40).offset(10.5));
    write_lights(&root, "late", &late);
    scan(&library, location).await;

    let all = light_sessions(&library).await;
    assert_eq!(all.len(), 3, "{:?}", shape(&all));
    assert_eq!(all[0].id, first[0].id, "the indexed session keeps its id");
    assert!(is_superset(&all[0], &first[0]), "and every frame intake gave it");
    assert_eq!(all[0].asset_ids.len(), 13, "3.5′ from its anchor joins it by its own 5′ limit");
    assert_eq!(all[1].asset_ids.len(), 5, "8′ starts a session that 9.5′ joins within 2′");
    assert_eq!(all[2].asset_ids.len(), 1, "2.5′ from that anchor is beyond the new 2′ limit");
    let limits = |session: &Session| session.framing.as_ref().unwrap().split_limits;
    assert_eq!(limits(&all[0]), SplitLimits::default(), "it keeps the limits of its intake");
    assert_eq!(limits(&all[1]).max_centre_offset_arcmin, 2.0, "a new one records the new limit");
}

#[tokio::test]
async fn a_narrower_rotation_limit_re_splits_no_indexed_session() {
    let temp = tempfile::tempdir().unwrap();
    // 3° apart: one framing under the 5° default.
    let night: Vec<Shot> = (0..10)
        .map(|minute| Shot::at(minute).rotatang(Some(if minute < 5 { 10.0 } else { 13.0 })))
        .collect();
    let (library, location, root) = indexed_night(temp.path(), &night).await;
    let first = light_sessions(&library).await;
    assert_eq!(first.len(), 1, "3° is within the 5° default");

    save_split(&library, SplitLimits { max_rotation_deg: 2.0, ..SplitLimits::default() }).await;
    let mut late: Vec<Shot> =
        (20..23).map(|minute| Shot::at(minute).rotatang(Some(14.0))).collect();
    late.extend((30..33).map(|minute| Shot::at(minute).rotatang(Some(30.0))));
    late.extend((34..36).map(|minute| Shot::at(minute).rotatang(Some(31.5))));
    late.push(Shot::at(40).rotatang(Some(32.5)));
    write_lights(&root, "late", &late);
    scan(&library, location).await;

    let all = light_sessions(&library).await;
    assert_eq!(all.len(), 3, "{:?}", shape(&all));
    assert_eq!(all[0].id, first[0].id, "the indexed session keeps its id");
    assert!(is_superset(&all[0], &first[0]), "and every frame intake gave it");
    assert_eq!(all[0].asset_ids.len(), 13, "4° from its anchor joins it by its own 5° limit");
    assert_eq!(all[1].asset_ids.len(), 5, "30° starts a session that 31.5° joins within 2°");
    assert_eq!(all[2].asset_ids.len(), 1, "2.5° from that anchor is beyond the new 2° limit");
}

#[tokio::test]
async fn a_returning_frame_rejoins_its_session_by_that_sessions_limits() {
    let temp = tempfile::tempdir().unwrap();
    let mut night: Vec<Shot> = (0..5).map(Shot::at).collect();
    night.extend((10..15).map(|minute| Shot::at(minute).offset(8.0)));
    let (library, location, root) = indexed_night(temp.path(), &night).await;
    let first = light_sessions(&library).await;
    assert_eq!(first.len(), 2);

    save_split(&library, SplitLimits { max_centre_offset_arcmin: 2.0, ..SplitLimits::default() })
        .await;
    // Back to the first framing after the second, 3′ from its anchor, then
    // back to the second.
    let mut late: Vec<Shot> = (20..23).map(|minute| Shot::at(minute).offset(3.0)).collect();
    late.push(Shot::at(25).offset(7.0));
    write_lights(&root, "late", &late);
    scan(&library, location).await;

    let all = light_sessions(&library).await;
    let ids = |sessions: &[Session]| sessions.iter().map(|session| session.id).collect::<Vec<_>>();
    assert_eq!(ids(&all), ids(&first), "no session is replaced or added: {:?}", shape(&all));
    assert_eq!(all[0].asset_ids.len(), 8, "the returning frames rejoin the first framing");
    assert_eq!(all[1].asset_ids.len(), 6, "and 1′ from the second's anchor rejoins it");
    assert!(is_superset(&all[0], &first[0]) && is_superset(&all[1], &first[1]));
}
