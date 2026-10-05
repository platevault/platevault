// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Project progress basis and Project asset references (spec 065) over real
//! generated FITS/XISF indexed through Library scans: only explicitly linked
//! current sessions count, each logical capture once, per exact channel, in
//! integer microseconds. Reading progress starts no rehash and every fixture file
//! is only ever read.

mod support;

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use persistence_library::SessionQuery;
use platevault_core::grouping::group_assets;
use platevault_core::inventory::validate_location_root;
use platevault_core::library::{InventoryProbe, Library};
use platevault_core::*;
use uuid::Uuid;

const BACKYARD: (f64, f64) = (52.0, 4.5);
const SECOND_SITE: (f64, f64) = (40.4, -3.7);

/// Header fields of one frame. `None` leaves the keyword out.
struct Frame<'a> {
    image_type: Option<&'a str>,
    camera: &'a str,
    filter: Option<&'a str>,
    exposure: Option<&'a str>,
    start: &'a str,
    site: Option<(f64, f64)>,
}

impl<'a> Frame<'a> {
    const fn light(filter: &'a str, exposure: &'a str, start: &'a str) -> Self {
        Self {
            image_type: Some("LIGHT"),
            camera: "ASI2600MM",
            filter: Some(filter),
            exposure: Some(exposure),
            start,
            site: Some(BACKYARD),
        }
    }

    fn fields(&self) -> Vec<(&'static str, String)> {
        let mut fields = vec![
            ("INSTRUME", format!("'{}'", self.camera)),
            ("OBJECT", "'NGC 7000'".into()),
            ("DATE-OBS", format!("'{}'", self.start)),
        ];
        if let Some(image_type) = self.image_type {
            fields.push(("IMAGETYP", format!("'{image_type}'")));
        }
        if let Some(filter) = self.filter {
            fields.push(("FILTER", format!("'{filter}'")));
        }
        if let Some(exposure) = self.exposure {
            fields.push(("EXPTIME", exposure.into()));
        }
        if let Some((latitude, longitude)) = self.site {
            fields.push(("SITELAT", format!("{latitude:.1}")));
            fields.push(("SITELONG", format!("{longitude:.1}")));
        }
        fields
    }

    /// Write the frame as FITS, or XISF for a `.xisf` path.
    fn write(&self, path: &Path) {
        let fields = self.fields();
        let fields: Vec<(&str, &str)> =
            fields.iter().map(|(key, value)| (*key, value.as_str())).collect();
        if path.extension().is_some_and(|extension| extension == "xisf") {
            support::xisf(path, &fields).unwrap();
        } else {
            support::fits(path, &fields).unwrap();
        }
    }
}

/// Every fixture file with its SHA-256 when written.
#[derive(Default)]
struct Originals(Vec<(PathBuf, String)>);

impl Originals {
    fn write(&mut self, root: &Path, name: &str, frame: &Frame<'_>) {
        let path = root.join(name);
        frame.write(&path);
        self.0.push((path.clone(), support::digest(&path)));
    }

    fn copy(&mut self, from: &Path, to: &Path, name: &str) {
        std::fs::copy(from.join(name), to.join(name)).unwrap();
        self.0.push((to.join(name), support::digest(&to.join(name))));
    }

    /// Every original is byte-identical.
    fn assert_unchanged(&self) {
        for (path, digest) in &self.0 {
            assert_eq!(&support::digest(path), digest, "{} is read-only", path.display());
        }
    }
}

/// Start a scan and wait for its terminal event, published after scan-time work.
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

async fn indexed(library: &Arc<Library>, root: &Path, name: &str) -> Location {
    let location = library
        .register_location(NativePath::from_path(root), name.into(), LocationRole::Captures)
        .await
        .unwrap();
    assert_eq!(scan_to_end(library, location.id).await.state, ScanState::Completed);
    location
}

/// Write `bytes` over a file in place, keeping its size and nanosecond mtime.
fn rewrite_same_stat(path: &Path, bytes: &[u8]) {
    assert_eq!(std::fs::metadata(path).unwrap().len(), bytes.len() as u64);
    let modified = std::fs::metadata(path).unwrap().modified().unwrap();
    let file = std::fs::OpenOptions::new().write(true).truncate(true).open(path).unwrap();
    std::io::Write::write_all(&mut &file, bytes).unwrap();
    file.set_modified(modified).unwrap();
    file.sync_all().unwrap();
}

async fn copy_named(library: &Library, location: Uuid, name: &str) -> Asset {
    let assets = library.catalog().location_assets(location).await.unwrap();
    assets.into_iter().find(|asset| asset.relative_path.display() == name).unwrap()
}

/// The current session holding the copy `name` of `location`.
async fn session_of(library: &Library, location: Uuid, name: &str) -> Session {
    let asset = copy_named(library, location, name).await;
    let sessions = library.catalog().list_sessions(&SessionQuery::default()).await.unwrap();
    sessions
        .into_iter()
        .map(|summary| summary.session)
        .find(|session| session.asset_ids.contains(&asset.id))
        .unwrap()
}

fn expected_session(session: &Session) -> ExpectedSession {
    ExpectedSession {
        session_id: session.id,
        grouping_revision: session.grouping_revision,
        decision_revision: session.decision_revision,
    }
}

fn expected_of(asset: &Asset) -> ExpectedAsset {
    ExpectedAsset {
        asset_id: asset.id,
        decision_revision: asset.decision_revision,
        fingerprint: asset.fingerprint.clone(),
    }
}

async fn ngc7000(library: &Library) -> TargetRecord {
    let target = TargetCandidate {
        id: Uuid::new_v4(),
        designation: "NGC 7000".into(),
        aliases: Vec::new(),
        common_name: None,
        object_type: "nebula".into(),
        coordinates: None,
        provenance: Provenance::User,
        provider_id: None,
    };
    library.catalog().save_target(&target, None).await.unwrap()
}

/// A Project framing `target` with these sessions explicitly linked.
async fn project_linking(
    library: &Library,
    target: &TargetRecord,
    name: &str,
    sessions: &[&Session],
) -> Project {
    let catalog = library.catalog();
    let input = ProjectInput {
        name: name.into(),
        notes: None,
        targets: vec![TargetFraming {
            target_id: target.candidate.id,
            expected_revision: target.decision_revision,
        }],
        panels: Vec::new(),
        equipment_ids: Vec::new(),
    };
    let project = catalog.create_project(&input).await.unwrap();
    if sessions.is_empty() {
        return project;
    }
    let links: Vec<SessionLinkInput> = sessions
        .iter()
        .map(|session| SessionLinkInput { session: expected_session(session), panel_id: None })
        .collect();
    catalog.link_sessions(project.id, project.revision, &links).await.unwrap()
}

async fn reject(library: &Library, project: &Project, asset: &Asset, rejected: bool) -> Project {
    library
        .catalog()
        .set_project_rejection(project.id, project.revision, &[expected_of(asset)], rejected)
        .await
        .unwrap()
}

async fn mark_usable(library: &Library, assets: &[&Asset]) {
    let expected: Vec<ExpectedAsset> = assets.iter().map(|asset| expected_of(asset)).collect();
    library.catalog().set_quality(&expected, Quality::Usable, InventoryProbe).await.unwrap();
}

fn us(seconds: u64) -> Microseconds {
    Microseconds::from_whole_seconds(seconds).unwrap()
}

fn row<'a>(basis: &'a ProjectProgressBasis, channel: &str) -> &'a ChannelProgress {
    basis
        .progress
        .channels
        .iter()
        .find(|row| row.channel.as_deref() == Some(channel))
        .unwrap_or_else(|| panic!("no {channel} row: {:?}", basis.progress))
}

fn channels(basis: &ProjectProgressBasis) -> Vec<&str> {
    basis.progress.channels.iter().filter_map(|row| row.channel.as_deref()).collect()
}

fn evidence(basis: &ProjectProgressBasis, session: Uuid) -> &LinkedSessionEvidence {
    basis.sessions.iter().find(|linked| linked.session_id == session).unwrap()
}

fn share(availability: Availability, seconds: u64, frames: u64) -> AvailabilityShare {
    AvailabilityShare { availability, captured_seconds: us(seconds), captured_frames: frames }
}

fn site((latitude_deg, longitude_deg): (f64, f64), frames: u64) -> CaptureSite {
    CaptureSite { latitude_deg, longitude_deg, frames }
}

fn exposure(channel: Option<&str>, seconds: Option<u64>, frames: u64) -> SessionExposure {
    SessionExposure {
        channel: channel.map(str::to_owned),
        exposure_seconds: seconds.map(us),
        frames,
    }
}

fn coverage_sum(coverage: &TargetCoverage, pick: fn(&CoverageContribution) -> f64) -> f64 {
    coverage.contributions.iter().map(pick).sum()
}

fn progress_sum(basis: &ProjectProgressBasis, pick: fn(&ChannelProgress) -> Microseconds) -> f64 {
    let rows = basis.progress.channels.iter().chain(&basis.progress.unknown_channel);
    rows.map(pick).fold(Microseconds::default(), Microseconds::saturating_add).seconds()
}

/// PRJ-FR-04, PRJ-FR-06, PRJ-AC-01/03/07/08: per-channel captured, usable and
/// accepted totals of the linked sessions only, with unknowns counted apart.
#[tokio::test]
#[expect(clippy::too_many_lines, reason = "one composed scenario over one indexed library")]
async fn only_linked_current_sessions_count_per_exact_channel_with_unknowns_apart() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("Backyard");
    std::fs::create_dir(&root).unwrap();
    let mut originals = Originals::default();
    originals.write(&root, "Ha_1.fits", &Frame::light("Ha", "300", "2026-09-18T22:00:00"));
    originals.write(&root, "Ha_2.fits", &Frame::light("Ha", "300", "2026-09-18T22:05:00"));
    let away =
        Frame { site: Some(SECOND_SITE), ..Frame::light("Ha", "300", "2026-09-18T22:10:00") };
    originals.write(&root, "Ha_3.fits", &away);
    originals.write(&root, "OIII_1.xisf", &Frame::light("OIII", "300", "2026-09-18T23:00:00"));
    originals.write(&root, "OIII_2.xisf", &Frame::light("OIII", "300", "2026-09-18T23:05:00"));
    let no_filter =
        Frame { filter: None, site: None, ..Frame::light("", "300", "2026-09-18T23:30:00") };
    originals.write(&root, "nofilter_1.fits", &no_filter);
    let no_exposure = Frame { exposure: None, ..Frame::light("Ha", "", "2026-09-18T23:40:00") };
    originals.write(&root, "noexp_1.fits", &no_exposure);
    let no_type = Frame { image_type: None, ..Frame::light("Ha", "300", "2026-09-18T23:50:00") };
    originals.write(&root, "notype_1.fits", &no_type);
    let other_camera =
        Frame { camera: "ASI533MC", ..Frame::light("Ha", "300", "2026-09-18T23:55:00") };
    originals.write(&root, "other_1.fits", &other_camera);

    let library = Library::open(&temp.path().join("library.sqlite"), None).await.unwrap();
    let location = indexed(&library, &root, "Backyard").await.id;
    let catalog = library.catalog();
    let ha = session_of(&library, location, "Ha_1.fits").await;
    assert_eq!(ha.asset_ids.len(), 3, "the site is outside the capture key");
    let equipment = Equipment {
        id: Uuid::new_v4(),
        name: "ASI2600MM on RedCat".into(),
        camera: Some("ASI2600MM".into()),
        telescope: None,
        focal_length_mm: Some(250.0),
        pixel_size_um: Some(3.76),
        decision_revision: 0,
        state: AssociationState::Unresolved,
        provenance: Provenance::User,
    };
    let equipment = catalog.save_equipment(&equipment, None).await.unwrap();
    catalog.confirm_equipment(&[expected_session(&ha)], equipment.id).await.unwrap();
    let ha = session_of(&library, location, "Ha_1.fits").await;
    let oiii = session_of(&library, location, "OIII_1.xisf").await;
    let no_filter = session_of(&library, location, "nofilter_1.fits").await;
    let no_exposure = session_of(&library, location, "noexp_1.fits").await;
    let no_type = session_of(&library, location, "notype_1.fits").await;
    let other = session_of(&library, location, "other_1.fits").await;
    let linked = [&ha, &oiii, &no_filter, &no_exposure, &no_type];
    let distinct: std::collections::BTreeSet<Uuid> =
        linked.iter().chain([&&other]).map(|session| session.id).collect();
    assert_eq!(distinct.len(), 6, "six sessions");
    let target = ngc7000(&library).await;
    let mut project = project_linking(&library, &target, "NGC 7000 HOO", &linked).await;

    let basis = catalog.project_progress(project.id).await.unwrap();
    assert_eq!((basis.project_id, basis.project_revision), (project.id, project.revision));
    assert_eq!(channels(&basis), ["Ha", "OIII"], "exact FILTER text, in text order");
    let ha_row = row(&basis, "Ha");
    // The unlinked other-camera session with the same OBJECT contributes nothing.
    assert_eq!((ha_row.captured_frames, ha_row.captured_seconds), (4, us(900)), "{ha_row:?}");
    assert_eq!(ha_row.unknown_exposure_count, 1, "unknown exposure is counted, never zero");
    assert_eq!(ha_row.unknown_image_type_count, 1, "unknown image type stays outside");
    assert_eq!((ha_row.usable_frames, ha_row.accepted_frames), (0, 0));
    assert_eq!(ha_row.unreviewed_seconds, us(900));
    assert_eq!(ha_row.availability, [share(Availability::Available, 900, 4)]);
    assert_eq!(
        (ha_row.usable_last_verified_at.as_ref(), ha_row.accepted_last_verified_at.as_ref()),
        (None, None)
    );
    let oiii_row = row(&basis, "OIII");
    assert_eq!((oiii_row.captured_frames, oiii_row.captured_seconds), (2, us(600)));
    let unknown = basis.progress.unknown_channel.as_ref().expect("the unknown-channel row");
    assert_eq!((unknown.channel.as_ref(), unknown.captured_frames), (None, 1));
    assert_eq!(unknown.captured_seconds, us(300));
    assert!(!basis.progress.provisional, "{:?}", basis.progress);
    assert_eq!(basis.progress.covered_location_ids, [location]);

    // Per-session evidence: distinct exact sites, effective exposures, equipment.
    assert_eq!(basis.sessions.len(), 5);
    assert!(basis.sessions.iter().all(|linked| linked.session_id != other.id));
    let ha_evidence = evidence(&basis, ha.id);
    assert_eq!(ha_evidence.state, LinkState::Current);
    assert_eq!(ha_evidence.summary.capture_count, 3);
    assert_eq!(ha_evidence.capture_sites, [site(SECOND_SITE, 1), site(BACKYARD, 2)]);
    assert_eq!(ha_evidence.unknown_site_frames, 0);
    assert_eq!(ha_evidence.exposures, [exposure(Some("Ha"), Some(300), 3)]);
    let association = ha_evidence.equipment.as_ref().expect("the equipment association");
    assert_eq!(
        (&association.state, association.subject_id),
        (&AssociationState::Confirmed, Some(equipment.id))
    );
    let unknown_site = evidence(&basis, no_filter.id);
    assert!(unknown_site.capture_sites.is_empty());
    assert_eq!(unknown_site.unknown_site_frames, 1);
    assert_eq!(unknown_site.exposures, [exposure(None, Some(300), 1)]);
    assert_eq!(evidence(&basis, no_exposure.id).exposures, [exposure(Some("Ha"), None, 1)]);

    // Library-Usable frames are usable and accepted, labelled with their verification.
    let ha_1 = copy_named(&library, location, "Ha_1.fits").await;
    let ha_2 = copy_named(&library, location, "Ha_2.fits").await;
    mark_usable(&library, &[&ha_1, &ha_2]).await;
    let before = catalog.location_assets(location).await.unwrap();
    let basis = catalog.project_progress(project.id).await.unwrap();
    assert_eq!(catalog.location_assets(location).await.unwrap(), before, "a read changes no asset");
    let ha_row = row(&basis, "Ha");
    assert_eq!((ha_row.usable_frames, ha_row.usable_seconds), (2, us(600)), "{ha_row:?}");
    assert_eq!((ha_row.accepted_frames, ha_row.accepted_seconds), (2, us(600)));
    assert_eq!(ha_row.unreviewed_seconds, us(300));
    let verified: Vec<Option<String>> = before
        .iter()
        .filter(|asset| [ha_1.id, ha_2.id].contains(&asset.id))
        .map(|asset| asset.last_verified_at.clone())
        .collect();
    assert!(ha_row.usable_last_verified_at.is_some());
    assert!(verified.contains(&ha_row.usable_last_verified_at), "{verified:?}");
    assert_eq!(ha_row.accepted_last_verified_at, ha_row.usable_last_verified_at);

    // Rejecting a library-Usable frame lowers accepted only.
    let ha_1 = copy_named(&library, location, "Ha_1.fits").await;
    project = reject(&library, &project, &ha_1, true).await;
    let basis = catalog.project_progress(project.id).await.unwrap();
    let ha_row = row(&basis, "Ha");
    assert_eq!((ha_row.captured_frames, ha_row.captured_seconds), (4, us(900)));
    assert_eq!((ha_row.usable_frames, ha_row.usable_seconds), (2, us(600)));
    assert_eq!((ha_row.accepted_frames, ha_row.accepted_seconds), (1, us(300)));
    assert_eq!(ha_row.rejected_frames, 1);
    assert_eq!(basis.rejections.len(), 1);
    assert_eq!(
        (basis.rejections[0].asset_id, basis.rejections[0].session_id),
        (ha_1.id, Some(ha.id))
    );
    assert_eq!(basis.rejections[0].project_revision, project.revision);

    // Rejecting a library-Unreviewed frame leaves it captured and accepted unaffected.
    let ha_3 = copy_named(&library, location, "Ha_3.fits").await;
    project = reject(&library, &project, &ha_3, true).await;
    let basis = catalog.project_progress(project.id).await.unwrap();
    let ha_row = row(&basis, "Ha");
    assert_eq!((ha_row.captured_frames, ha_row.captured_seconds), (4, us(900)));
    assert_eq!(ha_row.unreviewed_seconds, us(300));
    assert_eq!((ha_row.accepted_frames, ha_row.accepted_seconds), (1, us(300)));
    assert_eq!(ha_row.rejected_frames, 2);

    // Captured and usable totals equal Target coverage over the same sessions.
    let mut expected = Vec::new();
    for name in ["Ha_1.fits", "OIII_1.xisf", "nofilter_1.fits", "noexp_1.fits", "notype_1.fits"] {
        expected.push(expected_session(&session_of(&library, location, name).await));
    }
    catalog.associate_target(&expected, target.candidate.id).await.unwrap();
    let coverage = catalog.target_coverage(target.candidate.id).await.unwrap();
    let basis = catalog.project_progress(project.id).await.unwrap();
    let captured = progress_sum(&basis, |row| row.captured_seconds);
    let usable = progress_sum(&basis, |row| row.usable_seconds);
    assert!((captured - 1_800.0).abs() < 1e-9, "{captured}");
    assert!((coverage_sum(&coverage, |c| c.captured_seconds) - captured).abs() < 1e-9);
    assert!((coverage_sum(&coverage, |c| c.usable_seconds) - usable).abs() < 1e-9);
    originals.assert_unchanged();
}

/// PRJ-FR-04, PRJ-AC-01: byte-identical copies count once, an offline location
/// keeps its last-observed contribution and a Retired location's copies leave.
#[tokio::test]
async fn copies_count_once_offline_keeps_its_share_and_retired_copies_leave() {
    let temp = tempfile::tempdir().unwrap();
    let (t7, nas) = (temp.path().join("T7"), temp.path().join("NAS"));
    std::fs::create_dir(&t7).unwrap();
    std::fs::create_dir(&nas).unwrap();
    let mut originals = Originals::default();
    for (name, start) in [
        ("ha_1.fits", "2026-09-18T22:00:00"),
        ("ha_2.fits", "2026-09-18T22:05:00"),
        ("ha_3.fits", "2026-09-18T22:10:00"),
    ] {
        originals.write(&t7, name, &Frame::light("Ha", "300", start));
    }
    originals.copy(&t7, &nas, "ha_1.fits");
    originals.copy(&t7, &nas, "ha_2.fits");
    let library = Library::open(&temp.path().join("library.sqlite"), None).await.unwrap();
    let t7_id = indexed(&library, &t7, "T7").await.id;
    let nas_id = indexed(&library, &nas, "NAS").await.id;
    let catalog = library.catalog();
    let sessions = catalog.list_sessions(&SessionQuery::default()).await.unwrap();
    assert_eq!(sessions.len(), 1, "copies share one capture key");
    let session = sessions[0].session.clone();
    let target = ngc7000(&library).await;
    let project = project_linking(&library, &target, "NGC 7000 Ha", &[&session]).await;

    let basis = catalog.project_progress(project.id).await.unwrap();
    let ha = row(&basis, "Ha");
    assert_eq!((ha.captured_frames, ha.captured_seconds), (3, us(900)), "{ha:?}");
    assert_eq!(ha.availability, [share(Availability::Available, 900, 3)]);
    assert_eq!(ha.duplicate_candidates, 0);
    let mut covered = vec![t7_id, nas_id];
    covered.sort_unstable();
    assert_eq!(basis.progress.covered_location_ids, covered);
    assert!(!basis.progress.provisional, "{:?}", basis.progress);
    assert_eq!(evidence(&basis, session.id).capture_sites, [site(BACKYARD, 3)]);

    // T7 goes offline: its only copy keeps its last-observed contribution, labelled.
    let unplugged = temp.path().join("T7 unplugged");
    std::fs::rename(&t7, &unplugged).unwrap();
    assert_eq!(scan_to_end(&library, t7_id).await.state, ScanState::Failed);
    assert_eq!(catalog.location(t7_id).await.unwrap().availability, Availability::Offline);
    let basis = catalog.project_progress(project.id).await.unwrap();
    let ha = row(&basis, "Ha");
    assert_eq!((ha.captured_frames, ha.captured_seconds), (3, us(900)), "{ha:?}");
    assert_eq!(
        ha.availability,
        [share(Availability::Available, 600, 2), share(Availability::Offline, 300, 1)]
    );

    // Retired: T7's copies leave every total; the NAS copies still count.
    let review = library.review_retire_location(t7_id).await.unwrap();
    library.retire_location(review.id, t7_id, review.expected_revision).await.unwrap();
    let basis = catalog.project_progress(project.id).await.unwrap();
    assert_eq!(evidence(&basis, session.id).state, LinkState::Current);
    let ha = row(&basis, "Ha");
    assert_eq!((ha.captured_frames, ha.captured_seconds), (2, us(600)), "{ha:?}");
    assert_eq!(ha.availability, [share(Availability::Available, 600, 2)]);
    assert_eq!(basis.progress.covered_location_ids, [nas_id]);
    std::fs::rename(&unplugged, &t7).unwrap();
    originals.assert_unchanged();
}

/// PRJ-FR-04, PRJ-AC-03 (D19): usable and accepted carry the oldest verification;
/// drifted and verification-pending decisions are outside both, and reading
/// progress starts no rehash.
#[tokio::test]
async fn drifted_and_pending_decisions_leave_usable_and_labels_name_the_oldest_verification() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("Backyard");
    std::fs::create_dir(&root).unwrap();
    let mut originals = Originals::default();
    originals.write(&root, "ha_1.fits", &Frame::light("Ha", "300", "2026-09-18T22:00:00"));
    originals.write(&root, "ha_2.fits", &Frame::light("Ha", "300", "2026-09-18T22:05:00"));
    let library = Library::open(&temp.path().join("library.sqlite"), None).await.unwrap();
    let location = indexed(&library, &root, "Backyard").await;
    let catalog = library.catalog();
    let session = session_of(&library, location.id, "ha_1.fits").await;
    let target = ngc7000(&library).await;
    let project = project_linking(&library, &target, "NGC 7000 Ha", &[&session]).await;

    mark_usable(&library, &[&copy_named(&library, location.id, "ha_1.fits").await]).await;
    tokio::time::sleep(Duration::from_millis(20)).await;
    mark_usable(&library, &[&copy_named(&library, location.id, "ha_2.fits").await]).await;
    let first = copy_named(&library, location.id, "ha_1.fits").await;
    let second = copy_named(&library, location.id, "ha_2.fits").await;
    assert_ne!(first.last_verified_at, second.last_verified_at, "fixture: two verifications");
    let basis = catalog.project_progress(project.id).await.unwrap();
    let ha = row(&basis, "Ha");
    assert_eq!((ha.usable_frames, ha.accepted_frames), (2, 2), "{ha:?}");
    assert_eq!(ha.usable_last_verified_at, first.last_verified_at, "the oldest verification");
    assert_eq!(ha.accepted_last_verified_at, first.last_verified_at);

    // Same-stat replaced bytes: the rescan rehashes and the decision drifts.
    let path = root.join("ha_2.fits");
    let mut bytes = std::fs::read(&path).unwrap();
    *bytes.last_mut().unwrap() ^= 0xff;
    rewrite_same_stat(&path, &bytes);
    assert_eq!(scan_to_end(&library, location.id).await.state, ScanState::Completed);
    let first = copy_named(&library, location.id, "ha_1.fits").await;
    let basis = catalog.project_progress(project.id).await.unwrap();
    let ha = row(&basis, "Ha");
    assert_eq!(ha.drifted_decisions, 1, "{ha:?}");
    assert_eq!((ha.usable_frames, ha.usable_seconds), (1, us(300)));
    assert_eq!((ha.accepted_frames, ha.accepted_seconds), (1, us(300)));
    assert_eq!((ha.captured_frames, ha.captured_seconds), (2, us(600)));
    assert_eq!(ha.usable_last_verified_at, first.last_verified_at);

    // A readable scan that has not rehashed yet: the decision awaits verification.
    let operation = catalog.begin_scan(location.id, None).await.unwrap();
    let root_identity = validate_location_root(&location).unwrap();
    catalog
        .apply_scan_batch(operation.id, &root_identity, &ScanBatch::default(), group_assets)
        .await
        .unwrap();
    let before = catalog.location_assets(location.id).await.unwrap();
    let basis = catalog.project_progress(project.id).await.unwrap();
    let ha = row(&basis, "Ha");
    assert_eq!((ha.verification_pending, ha.drifted_decisions), (1, 1), "{ha:?}");
    assert_eq!((ha.usable_frames, ha.usable_seconds), (0, Microseconds::default()));
    assert_eq!((ha.accepted_frames, ha.accepted_seconds), (0, Microseconds::default()));
    assert_eq!(
        (ha.usable_last_verified_at.as_ref(), ha.accepted_last_verified_at.as_ref()),
        (None, None)
    );
    assert!(basis.progress.provisional, "a pending rehash keeps progress provisional");
    let after = catalog.location_assets(location.id).await.unwrap();
    assert_eq!(after, before, "reading progress starts no rehash");
    assert!(after.iter().any(|asset| asset.verification_pending));
    let canceled =
        catalog.abort_scan(operation.id, ScanState::Canceled, "canceled by user").await.unwrap();
    assert_eq!(canceled.state, ScanState::Canceled);
    // The test itself replaced ha_2; every other original stays byte-identical.
    originals.0.retain(|(original, _)| *original != path);
    originals.assert_unchanged();
}

/// PRJ-FR-04 (R8): sums are integer microseconds, so ten 0.1 s frames meet a
/// one-second goal that f64 summation misses.
#[tokio::test]
async fn integer_microsecond_sums_meet_a_boundary_float_summation_misses() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("Backyard");
    std::fs::create_dir(&root).unwrap();
    let mut originals = Originals::default();
    for index in 0..3 {
        let start = format!("2026-09-18T22:00:{index:02}");
        originals.write(&root, &format!("L_{index}.fits"), &Frame::light("L", "0.1", &start));
    }
    for index in 0..10 {
        let start = format!("2026-09-18T23:00:{index:02}");
        originals.write(&root, &format!("R_{index}.fits"), &Frame::light("R", "0.1", &start));
    }
    let library = Library::open(&temp.path().join("library.sqlite"), None).await.unwrap();
    let location = indexed(&library, &root, "Backyard").await.id;
    let catalog = library.catalog();
    let luminance = session_of(&library, location, "L_0.fits").await;
    let red = session_of(&library, location, "R_0.fits").await;
    let target = ngc7000(&library).await;
    let project = project_linking(&library, &target, "NGC 7000 LRGB", &[&luminance, &red]).await;

    let basis = catalog.project_progress(project.id).await.unwrap();
    assert_eq!(row(&basis, "L").captured_seconds, Microseconds(300_000));
    assert_eq!(row(&basis, "L").captured_frames, 3);

    let assets = catalog.location_assets(location).await.unwrap();
    let reds: Vec<&Asset> =
        assets.iter().filter(|asset| red.asset_ids.contains(&asset.id)).collect();
    assert_eq!(reds.len(), 10);
    mark_usable(&library, &reds).await;
    let basis = catalog.project_progress(project.id).await.unwrap();
    let accepted = row(&basis, "R").accepted_seconds;
    assert_eq!(accepted, Microseconds(1_000_000));
    assert!(accepted >= Microseconds::from_whole_seconds(1).unwrap(), "the goal boundary is met");
    let float: f64 = std::iter::repeat_n(0.1_f64, 10).sum();
    assert!(float < 1.0, "f64 summation misses the boundary: {float}");
    originals.assert_unchanged();
}

/// PRJ-FR-06, PRJ-FR-07: a superseded link needs review and contributes nothing
/// until its successor is linked; Project references name linked and rejected
/// assets with the Project revision.
#[tokio::test]
async fn a_superseded_link_contributes_nothing_and_references_name_linked_and_rejected_assets() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("Backyard");
    std::fs::create_dir(&root).unwrap();
    let mut originals = Originals::default();
    for (name, start) in [
        ("ha_1.fits", "2026-09-18T22:00:00"),
        ("ha_2.fits", "2026-09-18T22:05:00"),
        ("ha_3.fits", "2026-09-18T22:10:00"),
    ] {
        originals.write(&root, name, &Frame::light("Ha", "300", start));
    }
    let library = Library::open(&temp.path().join("library.sqlite"), None).await.unwrap();
    let location = indexed(&library, &root, "Backyard").await.id;
    let catalog = library.catalog();
    let session = session_of(&library, location, "ha_1.fits").await;
    let target = ngc7000(&library).await;
    let mut linked = project_linking(&library, &target, "NGC 7000 Ha", &[&session]).await;
    let ha_1 = copy_named(&library, location, "ha_1.fits").await;
    let ha_2 = copy_named(&library, location, "ha_2.fits").await;
    let ha_3 = copy_named(&library, location, "ha_3.fits").await;
    linked = reject(&library, &linked, &ha_3, true).await;

    let asked = |ids: &[Uuid]| ids.iter().copied().collect::<std::collections::BTreeSet<Uuid>>();
    let references = catalog.project_references(&asked(&[ha_1.id, Uuid::new_v4()])).await.unwrap();
    assert_eq!(
        references,
        [AssetReference {
            kind: ReferenceKind::Project,
            id: linked.id,
            name: "NGC 7000 Ha".into(),
            revision: linked.revision,
            asset_ids: vec![ha_1.id],
        }]
    );

    // A Project without links is named while its effective rejection holds the asset.
    let rejecting = project_linking(&library, &target, "NGC 7000 rejects", &[]).await;
    let rejecting = reject(&library, &rejecting, &ha_2, true).await;
    let references = catalog.project_references(&asked(&[ha_2.id])).await.unwrap();
    let mut named: Vec<(Uuid, Revision)> =
        references.iter().map(|reference| (reference.id, reference.revision)).collect();
    let mut expected = vec![(linked.id, linked.revision), (rejecting.id, rejecting.revision)];
    named.sort_unstable();
    expected.sort_unstable();
    assert_eq!(named, expected, "{references:?}");
    assert!(references.iter().all(|reference| reference.asset_ids == [ha_2.id]));
    let withdrawn = reject(&library, &rejecting, &ha_2, false).await;
    assert!(withdrawn.revision > rejecting.revision);
    let references = catalog.project_references(&asked(&[ha_2.id])).await.unwrap();
    assert_eq!(references.iter().map(|reference| reference.id).collect::<Vec<_>>(), [linked.id]);

    // A FILTER correction supersedes the linked session.
    let corrected = expected_of(&ha_1);
    let correction = CorrectionInput {
        asset_id: corrected.asset_id,
        field: "filter".into(),
        value: serde_json::json!("OIII"),
    };
    let preview = catalog
        .preview_correction(std::slice::from_ref(&corrected), &[correction], group_assets)
        .await
        .unwrap();
    let confirmed = library.confirm_correction(preview.id, &[corrected]).await.unwrap();
    let mut successors = confirmed.outcome.lineage.unwrap().successors;
    successors.sort_unstable();
    assert_eq!(successors.len(), 2);

    let basis = catalog.project_progress(linked.id).await.unwrap();
    let superseded = evidence(&basis, session.id);
    assert_eq!(superseded.state, LinkState::NeedsReview);
    let mut named = superseded.successors.clone();
    named.sort_unstable();
    assert_eq!(named, successors);
    assert!(superseded.capture_sites.is_empty() && superseded.exposures.is_empty());
    assert_eq!(superseded.unknown_site_frames, 0);
    assert!(basis.progress.channels.is_empty(), "{:?}", basis.progress);
    assert!(basis.progress.unknown_channel.is_none());
    assert!(basis.progress.covered_location_ids.is_empty());
    assert_eq!(basis.rejections.len(), 1);
    assert_eq!(
        (basis.rejections[0].asset_id, basis.rejections[0].session_id),
        (ha_3.id, Some(session.id))
    );
    let references = catalog.project_references(&asked(&[ha_1.id])).await.unwrap();
    assert_eq!(
        references.iter().map(|reference| (reference.id, reference.revision)).collect::<Vec<_>>(),
        [(linked.id, linked.revision)],
        "a link needing review still holds its assets"
    );

    // Linking the Ha successor counts it; the corrected frame stays outside.
    let remainder = session_of(&library, location, "ha_2.fits").await;
    assert!(successors.contains(&remainder.id));
    let links = [SessionLinkInput { session: expected_session(&remainder), panel_id: None }];
    linked = catalog.link_sessions(linked.id, linked.revision, &links).await.unwrap();
    let basis = catalog.project_progress(linked.id).await.unwrap();
    assert_eq!(channels(&basis), ["Ha"]);
    let ha = row(&basis, "Ha");
    assert_eq!((ha.captured_frames, ha.captured_seconds), (2, us(600)), "{ha:?}");
    assert_eq!(ha.rejected_frames, 1);
    assert_eq!(evidence(&basis, session.id).state, LinkState::NeedsReview);
    assert_eq!(evidence(&basis, remainder.id).state, LinkState::Current);
    originals.assert_unchanged();
}
