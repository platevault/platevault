// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Composed View acceptance (spec 066) over the worked NGC 7000 set: real
//! generated FITS/XISF indexed through Library scans, the 065 Project
//! `NGC 7000 HOO` with its `RedCat` equipment, and the `Library::*view*`
//! operations with the catalog writers behind them, through restart. Every
//! fixture file is only ever read, except the steps that make a frame or
//! folder unreadable and restore it (quickstart steps 2 to 18).
#![cfg(unix)]

mod support;

use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use persistence_library::SessionQuery;
use platevault_core::library::{InventoryProbe, Library};
use platevault_core::targets::ICRS_FRAME;
use platevault_core::*;
use uuid::Uuid;

const RA: f64 = 314.75;
const DEC: f64 = 44.33;
const SIZE: (u32, u32) = (6248, 4176);
const REDCAT: &str = "ASI2600MM";

#[derive(Clone, Copy, PartialEq, Eq)]
enum Geometry {
    Full,
    /// RA/DEC and header optics, no orientation.
    PointingOnly,
    /// RA/DEC and OBJCTROT, no FOCALLEN or XPIXSZ: the field comes from equipment.
    EquipmentFov,
    /// No pointing.
    Unknown,
}

/// One generated session: every frame shares its header evidence.
struct Spec {
    date: &'static str,
    filter: &'static str,
    frames: usize,
    camera: &'static str,
    geometry: Geometry,
    object: Option<&'static str>,
    dec_offset: f64,
}

const fn spec(date: &'static str, filter: &'static str, frames: usize, geometry: Geometry) -> Spec {
    Spec {
        date,
        filter,
        frames,
        camera: REDCAT,
        geometry,
        object: Some("NGC 7000"),
        dec_offset: 0.0,
    }
}

/// The five `RedCat` sessions and the other camera's session on `Astro-T7`.
const ASTRO: [Spec; 6] = [
    Spec { dec_offset: 0.3, ..spec("2026-09-18", "Ha", 55, Geometry::PointingOnly) },
    Spec { object: None, ..spec("2026-09-24", "OIII", 20, Geometry::Unknown) },
    Spec {
        object: Some("Cygnus field"),
        dec_offset: 0.2,
        ..spec("2026-09-26", "OIII", 35, Geometry::Full)
    },
    Spec { camera: "ASI533MC", ..spec("2026-09-27", "Ha", 10, Geometry::Full) },
    Spec { dec_offset: 0.1, ..spec("2026-09-28", "Ha", 56, Geometry::EquipmentFov) },
    spec("2026-09-30", "OIII", 48, Geometry::Full),
];
const REDCAT_DATES: [&str; 5] =
    ["2026-09-18", "2026-09-24", "2026-09-26", "2026-09-28", "2026-09-30"];
const COLD: Spec = spec("2026-09-12", "OIII", 10, Geometry::Full);
const LATER: [Spec; 2] =
    [spec("2026-10-02", "Ha", 10, Geometry::Full), spec("2026-10-03", "OIII", 10, Geometry::Full)];
/// The six 30 Sep frames the View excludes.
const EXCLUDED: std::ops::Range<usize> = 42..48;

fn file_name(spec: &Spec, index: usize) -> String {
    let extension = if spec.filter == "Ha" { "fits" } else { "xisf" };
    format!("{}/{}_{index:02}.{extension}", spec.date, spec.filter)
}

fn write_session(root: &Path, spec: &Spec) -> Vec<(PathBuf, String)> {
    std::fs::create_dir_all(root.join(spec.date)).unwrap();
    (0..spec.frames)
        .map(|index| {
            let mut fields = vec![
                ("IMAGETYP", "'LIGHT'".to_owned()),
                ("INSTRUME", format!("'{}'", spec.camera)),
                ("TELESCOP", "'RedCat 51'".into()),
                ("FILTER", format!("'{}'", spec.filter)),
                ("EXPTIME", "300".into()),
                ("DATE-OBS", format!("'{}T20:{index:02}:00'", spec.date)),
                ("DATE-LOC", format!("'{}T22:{index:02}:00'", spec.date)),
                ("XBINNING", "1".into()),
                ("YBINNING", "1".into()),
                ("GAIN", "100".into()),
                ("OFFSET", "50".into()),
                ("SET-TEMP", "-10".into()),
            ];
            if let Some(object) = spec.object {
                fields.push(("OBJECT", format!("'{object}'")));
            }
            let pointing = [("RA", format!("{RA}")), ("DEC", format!("{}", DEC + spec.dec_offset))];
            let optics = [("FOCALLEN", "250".to_owned()), ("XPIXSZ", "3.76".into())];
            let rotation = ("OBJCTROT", "0".to_owned());
            match spec.geometry {
                Geometry::Full => {
                    fields.extend(pointing);
                    fields.extend(optics);
                    fields.push(rotation);
                }
                Geometry::PointingOnly => {
                    fields.extend(pointing);
                    fields.extend(optics);
                }
                Geometry::EquipmentFov => {
                    fields.extend(pointing);
                    fields.push(rotation);
                }
                Geometry::Unknown => {
                    fields.extend(optics);
                    fields.push(rotation);
                }
            }
            let fields: Vec<(&str, &str)> =
                fields.iter().map(|(key, value)| (*key, value.as_str())).collect();
            let path = root.join(file_name(spec, index));
            if spec.filter == "Ha" {
                support::fits_sized(&path, SIZE, &fields).unwrap();
            } else {
                support::xisf_sized(&path, SIZE, &fields).unwrap();
            }
            let digest = support::digest(&path);
            (path, digest)
        })
        .collect()
}

fn set_mode(path: &Path, mode: u32) {
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(mode)).unwrap();
}

/// Start a scan and wait for its terminal event, published after scan-time work.
async fn scan_to_end(library: &Arc<Library>, location: Uuid) -> ScanOperation {
    let mut progress = library.subscribe_scan_progress();
    let started = library.start_scan(location, None).await.unwrap();
    tokio::time::timeout(Duration::from_secs(60), async {
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

fn expected(session: &Session) -> ExpectedSession {
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

fn seconds(value: u64) -> Microseconds {
    Microseconds(value * Microseconds::PER_SECOND)
}

fn query(membership: Membership, filters: CandidateFilters) -> CandidateQuery {
    CandidateQuery { membership, filters, sort: None, selected_only: false, offset: 0, limit: 1000 }
}

fn json<T: serde::Serialize>(value: &T) -> serde_json::Value {
    serde_json::to_value(value).unwrap()
}

/// The worked set, indexed, with the Target, equipment and Project saved and
/// `Cold-1` offline.
struct Worked {
    temp: tempfile::TempDir,
    database: PathBuf,
    astro_root: PathBuf,
    library: Arc<Library>,
    astro: Uuid,
    cold: Uuid,
    target: TargetRecord,
    redcat: Uuid,
    other: Uuid,
    project: Uuid,
    originals: Vec<(PathBuf, String)>,
}

async fn register(library: &Arc<Library>, root: &Path, name: &str) -> Uuid {
    let location = library
        .register_location(NativePath::from_path(root), name.into(), LocationRole::Captures)
        .await
        .unwrap();
    assert_eq!(scan_to_end(library, location.id).await.state, ScanState::Completed);
    location.id
}

async fn save_equipment(library: &Library, camera: &str) -> Uuid {
    let equipment = Equipment {
        id: Uuid::new_v4(),
        name: format!("RedCat 51 / {camera}"),
        camera: Some(camera.into()),
        telescope: Some("RedCat 51".into()),
        focal_length_mm: Some(250.0),
        pixel_size_um: Some(3.76),
        decision_revision: 0,
        state: AssociationState::Unresolved,
        provenance: Provenance::User,
    };
    library.catalog().save_equipment(&equipment, None).await.unwrap().id
}

impl Worked {
    async fn new() -> Self {
        let temp = tempfile::tempdir().unwrap();
        let astro_root = temp.path().join("Astro-T7").join("Captures");
        let cold_root = temp.path().join("Cold-1").join("Captures");
        let mut originals = Vec::new();
        for spec in &ASTRO {
            originals.extend(write_session(&astro_root, spec));
        }
        let cold_originals = write_session(&cold_root, &COLD);
        let database = temp.path().join("library.sqlite");
        let library = Library::open(&database, None).await.unwrap();
        let astro = register(&library, &astro_root, "Astro-T7").await;
        let cold = register(&library, &cold_root, "Cold-1").await;
        let candidate = TargetCandidate {
            id: Uuid::new_v4(),
            designation: "NGC 7000".into(),
            aliases: Vec::new(),
            common_name: Some("North America Nebula".into()),
            object_type: "nebula".into(),
            coordinates: Some(SkyCoordinates {
                ra_deg: RA,
                dec_deg: DEC,
                frame: ICRS_FRAME.into(),
            }),
            provenance: Provenance::User,
            provider_id: None,
        };
        let target = library.catalog().save_target(&candidate, None).await.unwrap();
        let redcat = save_equipment(&library, REDCAT).await;
        let other = save_equipment(&library, "ASI533MC").await;
        let mut worked = Self {
            temp,
            database,
            astro_root,
            library,
            astro,
            cold,
            target,
            redcat,
            other,
            project: Uuid::nil(),
            originals,
        };
        for date in REDCAT_DATES {
            worked.confirm(date, redcat).await;
            let session = worked.session(date).await;
            let target = worked.target.candidate.id;
            worked.library.catalog().associate_target(&[expected(&session)], target).await.unwrap();
        }
        worked.confirm("2026-09-27", other).await;
        worked.project = worked
            .library
            .catalog()
            .create_project(&worked.input(vec![redcat], Vec::new()))
            .await
            .unwrap()
            .id;

        // Cold-1 goes offline.
        let unplugged = worked.temp.path().join("Cold-1").join("Captures unplugged");
        std::fs::rename(&cold_root, &unplugged).unwrap();
        assert_eq!(scan_to_end(&worked.library, cold).await.state, ScanState::Failed);
        worked.originals.extend(cold_originals.into_iter().map(|(path, digest)| {
            (unplugged.join(path.strip_prefix(&cold_root).unwrap()), digest)
        }));
        worked
    }

    fn input(&self, equipment_ids: Vec<Uuid>, panels: Vec<PanelInput>) -> ProjectInput {
        ProjectInput {
            name: "NGC 7000 HOO".into(),
            notes: None,
            targets: vec![TargetFraming {
                target_id: self.target.candidate.id,
                expected_revision: self.target.decision_revision,
            }],
            panels,
            equipment_ids,
        }
    }

    async fn confirm(&self, date: &str, equipment: Uuid) {
        let session = self.session(date).await;
        self.library.catalog().confirm_equipment(&[expected(&session)], equipment).await.unwrap();
    }

    /// The capture date folder of a session's first copy.
    async fn date_of(&self, session: Uuid) -> String {
        let detail = self.library.catalog().session(session).await.unwrap();
        let path = detail.assets[0].relative_path.display();
        path.split('/').next().unwrap().to_owned()
    }

    async fn session(&self, date: &str) -> Session {
        let current = self.library.catalog().list_sessions(&SessionQuery::default()).await.unwrap();
        for summary in current {
            if self.date_of(summary.session.id).await == date {
                return summary.session;
            }
        }
        panic!("no current session of {date}");
    }

    async fn expected(&self, date: &str) -> ExpectedSession {
        expected(&self.session(date).await)
    }

    async fn dates_of(&self, sessions: impl IntoIterator<Item = Uuid>) -> Vec<String> {
        let mut dates = Vec::new();
        for session in sessions {
            dates.push(self.date_of(session).await);
        }
        dates.sort();
        dates
    }

    async fn rows(&self, page: &CandidatePage) -> Vec<(String, CandidateRow)> {
        let mut rows = Vec::new();
        for row in &page.rows {
            rows.push((self.date_of(row.session.session.id).await, row.clone()));
        }
        rows
    }

    /// The `Astro-T7` copy of frame `index` of the session of `date`.
    async fn frame(&self, date: &str, index: usize) -> Asset {
        let spec = ASTRO.iter().chain(&LATER).find(|spec| spec.date == date).unwrap();
        let name = file_name(spec, index);
        let assets = self.library.catalog().location_assets(self.astro).await.unwrap();
        assets.into_iter().find(|asset| asset.relative_path.display() == name).unwrap()
    }

    async fn excluded_keys(&self) -> Vec<Uuid> {
        let mut keys = Vec::new();
        for index in EXCLUDED {
            keys.push(self.frame("2026-09-30", index).await.id);
        }
        keys
    }

    /// Every asset and session record with quality, decisions and associations,
    /// the Target coverage and the Project.
    async fn library_state(&self) -> serde_json::Value {
        let catalog = self.library.catalog();
        let mut assets = catalog.location_assets(self.astro).await.unwrap();
        assets.extend(catalog.location_assets(self.cold).await.unwrap());
        let query = SessionQuery { include_superseded: true, ..SessionQuery::default() };
        let mut sessions = Vec::new();
        for summary in catalog.list_sessions(&query).await.unwrap() {
            sessions.push(catalog.session(summary.session.id).await.unwrap());
        }
        serde_json::json!({
            "assets": assets,
            "sessions": sessions,
            "coverage": catalog.target_coverage(self.target.candidate.id).await.unwrap(),
            "project": catalog.project(self.project).await.unwrap(),
        })
    }

    /// Usable seconds of the Target per channel.
    async fn usable(&self) -> Vec<(Option<String>, f64)> {
        let coverage =
            self.library.catalog().target_coverage(self.target.candidate.id).await.unwrap();
        let mut channels: std::collections::BTreeMap<Option<String>, f64> =
            std::collections::BTreeMap::new();
        for contribution in &coverage.contributions {
            *channels.entry(contribution.channel.clone()).or_default() +=
                contribution.usable_seconds;
        }
        channels.into_iter().collect()
    }

    async fn revision(&self, view: Uuid, revision: Revision) -> serde_json::Value {
        json(&self.library.catalog().view_revision(view, revision).await.unwrap())
    }

    async fn edit(&self, view: Uuid, expected_draft: Revision, edit: DraftEdit) -> ViewRecord {
        self.library.catalog().edit_view_draft(view, expected_draft, &edit).await.unwrap()
    }
}

fn channels(summary: &MembershipSummary) -> Vec<(Option<&str>, u64, Microseconds)> {
    summary
        .channels
        .iter()
        .map(|row| (row.channel.as_deref(), row.included_frames, row.included_seconds))
        .collect()
}

/// Steps 2: the Project View preselects 26, 28 and 30 Sep, including the
/// `Cygnus field` label, and changes no library record or Project revision
/// (VSEL-AC-01, VSEL-AC-08, PRJ-AC-05).
async fn create_from_project(worked: &Worked) -> Uuid {
    let before = worked.library_state().await;
    let catalog = worked.library.catalog();
    let project = catalog.project(worked.project).await.unwrap();
    let origin = ViewOriginInput::Project { project_id: worked.project };
    let detail = worked.library.create_view(&origin, None).await.unwrap();
    assert_eq!(detail.view.revision, 0);
    assert!(detail.revision.is_none());
    let draft = detail.draft.as_ref().expect("unsaved work at draft revision 1");
    assert_eq!((draft.draft_revision, draft.base_revision), (1, 0));
    assert_eq!(draft.project_id, Some(worked.project));
    let chosen = worked.dates_of(detail.sessions.iter().map(|s| s.choice.session_id)).await;
    assert_eq!(chosen, ["2026-09-26", "2026-09-28", "2026-09-30"]);
    let element = FramingElement::Target { target_id: worked.target.candidate.id };
    for session in &detail.sessions {
        assert_eq!(session.choice.reason, SelectionReason::GeometrySuggestion);
        let evidence = session.choice.evidence.as_ref().expect("the evidence that qualified it");
        assert_eq!(evidence.matched.map(|matched| matched.element), Some(element));
    }
    assert_eq!(worked.library_state().await, before, "sessions, headers and associations stay");
    assert_eq!(catalog.project(worked.project).await.unwrap().revision, project.revision);
    let listed = worked.library.project_detail(worked.project).await.unwrap().views;
    assert_eq!(listed.iter().map(|view| view.id).collect::<Vec<_>>(), [detail.view.id]);
    detail.view.id
}

/// Step 3: candidate evidence, then the two unsuggested sessions checked by
/// hand make five selected (VSEL-AC-02).
#[expect(clippy::cognitive_complexity, reason = "one quickstart step's assertions in order")]
async fn evidence_and_manual_choices(worked: &Worked, view: Uuid) {
    let page = worked
        .library
        .view_candidates(view, &query(Membership::Draft, CandidateFilters::default()))
        .await
        .unwrap();
    let rows = worked.rows(&page).await;
    let row = |date: &str| &rows.iter().find(|(d, _)| d == date).unwrap().1;
    assert_eq!(rows.len(), 7);
    assert!(row("2026-09-27").selection.is_none(), "the other camera is listed unselected");
    assert_eq!(row("2026-09-27").suggestion, SuggestionState::Suggested);
    assert!(row("2026-09-12").selection.is_none());
    assert_eq!(row("2026-09-12").session.availability, Availability::Offline);
    let fov = row("2026-09-28").geometry.fov.as_ref().expect("FOV from confirmed equipment");
    let from_equipment = FovSource::Equipment { equipment_id: worked.redcat };
    for field in [FovField::FocalLengthMm, FovField::PixelSizeUm] {
        assert!(fov
            .inputs
            .iter()
            .any(|input| input.field == field && input.source == from_equipment));
    }
    let pointing = &row("2026-09-18").geometry;
    assert_eq!(pointing.class, GeometryClass::PointingOnly);
    assert!(pointing.distance_deg.is_some_and(|distance| distance > 0.0));
    assert!(pointing.footprint.is_none());
    let unknown = &row("2026-09-24").geometry;
    assert_eq!((unknown.class, unknown.distance_deg), (GeometryClass::PositionUnknown, None));
    assert!(row("2026-09-18").selection.is_none() && row("2026-09-24").selection.is_none());

    let sessions = vec![worked.expected("2026-09-18").await, worked.expected("2026-09-24").await];
    let record = worked.edit(view, 1, DraftEdit::SelectSessions { sessions }).await;
    assert_eq!(record.draft.unwrap().draft_revision, 2);
    let detail = worked.library.view_detail(view).await.unwrap();
    assert_eq!(detail.sessions.len(), 5);
    for session in &detail.sessions {
        let date = worked.date_of(session.choice.session_id).await;
        let manual = date == "2026-09-18" || date == "2026-09-24";
        assert_eq!(session.choice.reason == SelectionReason::Manual, manual, "{date}");
    }
}

/// Step 4: filters, sorting and paging keep the five selected and write
/// nothing (VSEL-AC-03).
async fn browse(worked: &Worked, view: Uuid) {
    let before = worked.library_state().await;
    let record = worked.library.catalog().view(view).await.unwrap();
    let ha = CandidateFilters { channels: vec!["Ha".into()], ..CandidateFilters::default() };
    let page =
        worked.library.view_candidates(view, &query(Membership::Draft, ha.clone())).await.unwrap();
    assert_eq!((page.match_count, page.selected_count, page.selected_outside_filters), (3, 5, 3));
    let missing = CandidateFilters { missing_object: true, ..CandidateFilters::default() };
    let page =
        worked.library.view_candidates(view, &query(Membership::Draft, missing)).await.unwrap();
    let dates: Vec<String> = worked.rows(&page).await.into_iter().map(|(date, _)| date).collect();
    assert_eq!(dates, ["2026-09-24"]);

    let sort =
        Some(CandidateSort { key: CandidateSortKey::SkyDistance, direction: SortDirection::Asc });
    let mut listed = Vec::new();
    for offset in [0, 3, 6] {
        let paged = CandidateQuery {
            sort,
            offset,
            limit: 3,
            ..query(Membership::Draft, CandidateFilters::default())
        };
        let page = worked.library.view_candidates(view, &paged).await.unwrap();
        assert_eq!(page.selected_count, 5);
        listed.extend(worked.rows(&page).await);
    }
    let (last, row) = listed.last().unwrap();
    assert_eq!((last.as_str(), row.geometry.distance_deg), ("2026-09-24", None));
    assert_eq!(listed.len(), 7);
    let shown = CandidateQuery { selected_only: true, ..query(Membership::Draft, ha) };
    assert_eq!(worked.library.view_candidates(view, &shown).await.unwrap().rows.len(), 5);
    assert_eq!(
        worked.library.catalog().view(view).await.unwrap(),
        record,
        "draft revision unchanged"
    );
    assert_eq!(worked.library_state().await, before, "no rehash, measurement or write");
}

/// Steps 5 and 6: the draft summary, and the offline 12 Sep session named
/// unresolved while selected (VSEL-AC-09, FR-09).
async fn summary_and_unresolved(worked: &Worked, view: Uuid) {
    let worked_totals = |summary: &MembershipSummary| {
        assert_eq!(
            channels(summary),
            [(Some("Ha"), 111, seconds(33_300)), (Some("OIII"), 103, seconds(30_900))]
        );
        assert_eq!((summary.included_frames, summary.included_seconds), (214, seconds(64_200)));
    };
    let detail = worked.library.view_detail(view).await.unwrap();
    let summary = detail.draft_summary.as_ref().unwrap();
    worked_totals(summary);
    assert!(summary.channels.iter().all(|row| row.unreviewed_frames == row.included_frames));
    assert!(summary.unresolved.is_empty() && detail.unresolved.is_empty());

    let offline = worked.expected("2026-09-12").await;
    worked.edit(view, 2, DraftEdit::SelectSessions { sessions: vec![offline.clone()] }).await;
    let detail = worked.library.view_detail(view).await.unwrap();
    worked_totals(detail.draft_summary.as_ref().unwrap());
    assert_eq!(detail.unresolved.len(), 1);
    let source = &detail.unresolved[0];
    assert_eq!((source.session_id, source.location_id), (offline.session_id, worked.cold));
    assert_eq!(
        (source.location_name.as_str(), source.availability),
        ("Cold-1", Availability::Offline)
    );
    assert_eq!(source.member_keys.len(), 10);
    assert_eq!((source.last_observed_frames, source.last_observed_seconds), (10, seconds(3000)));
    assert!(!source.verified);
    assert_eq!(
        source.actions,
        [UnresolvedAction::Reconnect, UnresolvedAction::Locate, UnresolvedAction::Remove]
    );
    let open =
        detail.open_choices.iter().find(|choice| choice.kind == OpenChoiceKind::UnresolvedMembers);
    assert_eq!(open.map(|choice| choice.count), Some(10));

    worked
        .edit(view, 3, DraftEdit::DeselectSessions { session_ids: vec![offline.session_id] })
        .await;
    let detail = worked.library.view_detail(view).await.unwrap();
    worked_totals(detail.draft_summary.as_ref().unwrap());
    assert!(detail.unresolved.is_empty());
}

/// Step 7: Save, then standalone Views from Sessions and from the Target
/// (VSEL-AC-07, VSEL-AC-14). Returns the standalone View ids.
#[expect(clippy::cognitive_complexity, reason = "one quickstart step's assertions in order")]
async fn save_and_standalone(worked: &Worked, view: Uuid) -> [Uuid; 2] {
    let catalog = worked.library.catalog();
    let details = DraftEdit::Details {
        name: "NGC7000 HOO - Siril".into(),
        project_id: Some(worked.project),
        criteria: CriteriaInput::default(),
    };
    worked.edit(view, 4, details).await;
    assert_eq!(catalog.save_view(view, 0, 5).await.unwrap().view.revision, 1);
    let first = worked.revision(view, 1).await;

    let sessions = vec![worked.expected("2026-09-18").await, worked.expected("2026-09-28").await];
    let standalone =
        worked.library.create_view(&ViewOriginInput::Sessions { sessions }, None).await.unwrap();
    assert_eq!(standalone.view.origin_project_id, None);
    assert_eq!(standalone.draft.as_ref().unwrap().project_id, None, "no Project is created");
    let dates = worked.dates_of(standalone.sessions.iter().map(|s| s.choice.session_id)).await;
    assert_eq!(dates, ["2026-09-18", "2026-09-28"]);
    assert!(standalone.sessions.iter().all(|s| s.choice.reason == SelectionReason::OriginSessions));
    worked.edit(standalone.view.id, 1, DraftEdit::ClearSelection).await;
    let cleared = worked.library.view_detail(standalone.view.id).await.unwrap();
    assert!(cleared.sessions.is_empty());
    assert_eq!(cleared.draft_summary.unwrap().included_frames, 0);
    assert_eq!(worked.revision(view, 1).await, first, "other Views stay unchanged");

    let origin = ViewOriginInput::Target {
        target_id: worked.target.candidate.id,
        expected_revision: worked.target.decision_revision,
    };
    let targeted = worked.library.create_view(&origin, None).await.unwrap();
    assert!(targeted.sessions.is_empty(), "no automatically selected session");
    let page = worked
        .library
        .view_candidates(targeted.view.id, &query(Membership::Draft, CandidateFilters::default()))
        .await
        .unwrap();
    let rows = worked.rows(&page).await;
    let suggested = rows.iter().find(|(date, _)| date == "2026-09-26").unwrap();
    assert_eq!(suggested.1.suggestion, SuggestionState::Suggested, "suggestions stay readable");
    assert!(rows.iter().all(|(_, row)| row.selection.is_none()));
    let matching = CandidateFilters {
        channels: vec!["Ha".into()],
        cameras: vec![REDCAT.into()],
        ..CandidateFilters::default()
    };
    let record = worked.library.view_select_matching(targeted.view.id, 1, &matching).await.unwrap();
    assert_eq!(record.draft.unwrap().draft_revision, 2);
    let chosen = worked.library.view_detail(targeted.view.id).await.unwrap().sessions;
    let dates = worked.dates_of(chosen.iter().map(|s| s.choice.session_id)).await;
    assert_eq!(dates, ["2026-09-18", "2026-09-28"], "Select matching takes every match");
    let recorded = SelectionReason::SelectMatching { filters: Box::new(matching) };
    assert!(chosen.iter().all(|session| session.choice.reason == recorded));
    let projects = catalog.list_projects(&ProjectQuery::default()).await.unwrap();
    assert_eq!(projects.len(), 1);
    let listed = worked.library.project_detail(worked.project).await.unwrap().views;
    assert_eq!(listed.iter().map(|view| view.id).collect::<Vec<_>>(), [view]);
    [standalone.view.id, targeted.view.id]
}

/// Steps 8 and 9: exclude six 30 Sep frames, restore one and exclude it
/// again, then Save revision 2 (VSEL-AC-04, VSEL-AC-05 View side).
#[expect(clippy::cognitive_complexity, reason = "one quickstart step's assertions in order")]
async fn exclude_six(worked: &Worked, view: Uuid, others: [Uuid; 2]) -> Vec<Uuid> {
    let catalog = worked.library.catalog();
    let before = worked.library_state().await;
    let mut other_records = Vec::new();
    for other in others {
        other_records.push(catalog.view(other).await.unwrap());
    }
    let keys = worked.excluded_keys().await;
    let exclude =
        |member_keys: Vec<Uuid>| DraftEdit::SetFrames { member_keys, state: MemberState::Excluded };
    worked.edit(view, 0, exclude(keys.clone())).await;
    let restore = DraftEdit::SetFrames { member_keys: vec![keys[0]], state: MemberState::Included };
    worked.edit(view, 1, restore).await;
    let draft = catalog.view_membership(view, Membership::Draft).await.unwrap();
    let restored = draft.members.iter().find(|m| m.member.member_key == keys[0]).unwrap();
    assert_eq!(restored.member.reason, MemberReason::Restored);
    worked.edit(view, 2, exclude(vec![keys[0]])).await;

    let detail = worked.library.view_detail(view).await.unwrap();
    let summary = detail.draft_summary.as_ref().unwrap();
    assert_eq!(
        channels(summary),
        [(Some("Ha"), 111, seconds(33_300)), (Some("OIII"), 97, seconds(29_100))]
    );
    assert_eq!((summary.included_frames, summary.included_seconds), (208, seconds(62_400)));
    let oiii = &summary.channels[1];
    assert_eq!(
        oiii.excluded,
        [ExclusionCount { reason: ExclusionReason::ViewExclusion, count: 6 }]
    );
    assert_eq!(worked.library_state().await, before, "files, quality, coverage and Project stay");
    for (other, record) in others.iter().zip(&other_records) {
        assert_eq!(&catalog.view(*other).await.unwrap(), record);
    }
    assert_eq!(catalog.save_view(view, 1, 3).await.unwrap().view.revision, 2);
    assert_eq!(worked.library_state().await, before, "Save changes no quality");
    keys
}

/// Steps 10 and 11: Mark included frames usable in its named library scope,
/// then Mark unusable and Reject for Project on excluded members; no member
/// changes (VSEL-AC-05, VSEL-AC-11).
#[expect(clippy::cognitive_complexity, reason = "one quickstart step's assertions in order")]
async fn quality_actions(worked: &Worked, view: Uuid, excluded: &[Uuid]) {
    let catalog = worked.library.catalog();
    let committed = catalog.view_membership(view, Membership::Committed).await.unwrap();
    let all: Vec<Uuid> = committed.members.iter().map(|member| member.member.member_key).collect();
    let library = &worked.library;
    let scope = library
        .view_quality_scope(view, Membership::Committed, QualityAction::MarkUsable, &all)
        .await
        .unwrap();
    assert_eq!((scope.owner.clone(), scope.frames, scope.sessions), (ScopeOwner::Library, 208, 5));
    let mut refused = excluded.to_vec();
    refused.sort();
    assert_eq!(scope.refused, refused);
    let per_channel: Vec<(Option<&str>, u64, Microseconds)> =
        scope.channels.iter().map(|c| (c.channel.as_deref(), c.frames, c.seconds)).collect();
    assert_eq!(
        per_channel,
        [(Some("Ha"), 111, seconds(33_300)), (Some("OIII"), 97, seconds(29_100))]
    );
    let decided = catalog
        .set_view_quality(
            view,
            Membership::Committed,
            None,
            &scope.expected,
            Quality::Usable,
            InventoryProbe,
        )
        .await
        .unwrap();
    assert_eq!(decided.len(), 208);
    let usable = vec![(Some("Ha".to_owned()), 33_300.0), (Some("OIII".to_owned()), 29_100.0)];
    assert_eq!(worked.usable().await, usable);

    let revision = worked.revision(view, 2).await;
    let unusable = library
        .view_quality_scope(
            view,
            Membership::Committed,
            QualityAction::MarkUnusable,
            &excluded[1..2],
        )
        .await
        .unwrap();
    assert_eq!((unusable.frames, unusable.refused.len()), (1, 0));
    catalog
        .set_view_quality(
            view,
            Membership::Committed,
            None,
            &unusable.expected,
            Quality::Unusable,
            InventoryProbe,
        )
        .await
        .unwrap();
    let reject = library
        .view_quality_scope(
            view,
            Membership::Committed,
            QualityAction::RejectForProject,
            &excluded[2..3],
        )
        .await
        .unwrap();
    assert!(matches!(&reject.owner, ScopeOwner::Project { name, .. } if name == "NGC 7000 HOO"));
    let project = catalog.project(worked.project).await.unwrap();
    let project = catalog
        .reject_view_members(view, Membership::Committed, None, project.revision, &reject.expected)
        .await
        .unwrap();
    assert!(project.rejections.iter().any(|r| r.asset_id == excluded[2] && r.rejected));
    assert_eq!(worked.usable().await, usable, "Target usable stays as Marked");
    assert_eq!(worked.revision(view, 2).await, revision, "no member changes");
    let detail = worked.library.view_detail(view).await.unwrap();
    assert_eq!(detail.revision_summary.unwrap().included_frames, 208);
    assert!(detail.draft.is_none());
}

/// Step 12: a standalone 30 Sep draft over Unreviewed, Usable, Unusable and an
/// unreadable frame (VSEL-AC-13).
#[expect(clippy::cognitive_complexity, reason = "one quickstart step's assertions in order")]
async fn standalone_over_mixed_quality(worked: &Worked, view: Uuid, excluded: &[Uuid]) {
    let catalog = worked.library.catalog();
    let spec = &ASTRO[5];
    let unreadable = worked.astro_root.join(file_name(spec, EXCLUDED.start + 3));
    set_mode(&unreadable, 0o000);
    assert_ne!(scan_to_end(&worked.library, worked.astro).await.state, ScanState::Running);
    let unreadable_key = excluded[3];
    assert_ne!(catalog.asset(unreadable_key).await.unwrap().availability, Availability::Available);
    let first = (catalog.view(view).await.unwrap(), worked.revision(view, 2).await);

    let sessions = vec![worked.expected("2026-09-30").await];
    let created =
        worked.library.create_view(&ViewOriginInput::Sessions { sessions }, None).await.unwrap();
    let id = created.view.id;
    let draft = catalog.view_membership(id, Membership::Draft).await.unwrap();
    let member =
        |key: Uuid| draft.members.iter().find(|m| m.member.member_key == key).unwrap().clone();
    let usable = worked.frame("2026-09-30", 0).await.id;
    assert_eq!(
        (member(usable).member.state, member(usable).quality),
        (MemberState::Included, ApplicableQuality::Usable)
    );
    let unreviewed = member(excluded[4]);
    assert_eq!(
        (unreviewed.member.state, unreviewed.quality),
        (MemberState::Included, ApplicableQuality::Unreviewed)
    );
    let unusable = member(excluded[1]);
    assert_eq!(
        (unusable.member.state, &unusable.member.reason),
        (MemberState::Excluded, &MemberReason::LibraryUnusable)
    );
    assert!(member(unreadable_key).unresolved, "included and unavailable");
    let summary = created.draft_summary.as_ref().unwrap();
    assert_eq!(summary.unresolved.len(), 1);
    assert_eq!(summary.unresolved[0].member_keys, [unreadable_key]);
    let oiii = &summary.channels[0];
    assert_eq!(
        oiii.excluded,
        [ExclusionCount { reason: ExclusionReason::LibraryUnusable, count: 1 }]
    );

    let include =
        DraftEdit::SetFrames { member_keys: vec![excluded[1]], state: MemberState::Included };
    worked.edit(id, 1, include).await;
    let draft = catalog.view_membership(id, Membership::Draft).await.unwrap();
    let included = draft.members.iter().find(|m| m.member.member_key == excluded[1]).unwrap();
    assert_eq!(included.member.reason, MemberReason::ExplicitInclusion);
    assert_eq!(
        catalog.asset(excluded[1]).await.unwrap().quality,
        Quality::Unusable,
        "library unchanged"
    );
    assert_eq!((catalog.view(view).await.unwrap(), worked.revision(view, 2).await), first);
    assert!(catalog.discard_view_draft(id, 2).await.unwrap().is_none(), "a never-saved View goes");

    set_mode(&unreadable, 0o644);
    assert_eq!(scan_to_end(&worked.library, worked.astro).await.state, ScanState::Completed);
    assert_eq!(catalog.asset(unreadable_key).await.unwrap().availability, Availability::Available);
}

/// Step 13: Project equipment and framing edits and a member quality change
/// leave revision rows unchanged and report the Project context (VSEL-AC-10).
async fn project_context(worked: &Worked, view: Uuid) {
    let catalog = worked.library.catalog();
    let revision = worked.revision(view, 2).await;
    let project = catalog.project(worked.project).await.unwrap();
    let panel = PanelInput {
        id: None,
        name: "Core".into(),
        ra_deg: RA,
        dec_deg: DEC,
        width_deg: 3.0,
        height_deg: 2.0,
        position_angle_deg: Some(0.0),
    };
    let input = worked.input(vec![worked.redcat, worked.other], vec![panel]);
    catalog.update_project(worked.project, project.revision, &input).await.unwrap();
    let member = worked.frame("2026-09-26", 0).await;
    catalog.set_quality(&[expected_of(&member)], Quality::Unusable, InventoryProbe).await.unwrap();
    assert_eq!(worked.revision(view, 2).await, revision);
    let detail = worked.library.view_detail(view).await.unwrap();
    assert!(detail.project_context_changed);
    assert!(detail
        .open_choices
        .iter()
        .any(|choice| choice.kind == OpenChoiceKind::ProjectContextChanged));
    let committed = catalog.view_membership(view, Membership::Committed).await.unwrap();
    let held = committed.members.iter().find(|m| m.member.member_key == member.id).unwrap();
    assert_eq!(held.member.state, MemberState::Included, "a quality change moves no member");
}

fn items_of(review: &RefreshReview, kind: RefreshItemKind) -> Vec<&RefreshItem> {
    review.items.iter().filter(|item| item.kind == kind).collect()
}

/// Steps 14 and 15: two new sessions and an unreadable 18 Sep, refresh, keep
/// unchanged, then accept Ha and decline OIII into revision 3 (VSEL-AC-06,
/// VSEL-AC-12 View side).
#[expect(clippy::cognitive_complexity, reason = "one quickstart step's assertions in order")]
async fn refresh(worked: &mut Worked, view: Uuid) {
    for spec in &LATER {
        let written = write_session(&worked.astro_root, spec);
        worked.originals.extend(written);
    }
    let denied: Vec<PathBuf> = (0..ASTRO[0].frames)
        .map(|index| worked.astro_root.join(file_name(&ASTRO[0], index)))
        .collect();
    for path in &denied {
        set_mode(path, 0o000);
    }
    assert_ne!(scan_to_end(&worked.library, worked.astro).await.state, ScanState::Running);
    for spec in &LATER {
        worked.confirm(spec.date, worked.redcat).await;
    }
    let catalog = worked.library.catalog();
    let (record, revision) = (catalog.view(view).await.unwrap(), worked.revision(view, 2).await);
    let review = worked.library.refresh_view(view).await.unwrap();
    let added = items_of(&review, RefreshItemKind::AddedSession);
    let added_dates = worked.dates_of(added.iter().map(|item| item.session_id)).await;
    assert_eq!(added_dates, ["2026-10-02", "2026-10-03"]);
    assert!(added.iter().all(|item| item.evidence.as_ref().is_some_and(|e| e.matched.is_some())));
    let manual = items_of(&review, RefreshItemKind::ManualInclusion);
    assert_eq!(
        worked.dates_of(manual.iter().map(|item| item.session_id)).await,
        ["2026-09-18", "2026-09-24"]
    );
    let kept: usize =
        items_of(&review, RefreshItemKind::KeptExclusion).iter().map(|i| i.member_keys.len()).sum();
    assert_eq!(kept, 6);
    let unavailable = items_of(&review, RefreshItemKind::Unavailable);
    assert_eq!(
        worked.dates_of(unavailable.iter().map(|item| item.session_id)).await,
        ["2026-09-18"]
    );
    assert!(items_of(&review, RefreshItemKind::Removed).is_empty(), "never removed");
    assert_eq!(catalog.view(view).await.unwrap(), record, "membership unchanged until accepted");

    let again = worked.library.refresh_view(view).await.unwrap();
    let ha = worked.expected("2026-10-02").await.session_id;
    let addition = |id: Uuid| {
        again
            .items
            .iter()
            .find(|i| i.kind == RefreshItemKind::AddedSession && i.session_id == id)
            .unwrap()
            .id
    };
    let oiii = worked.expected("2026-10-03").await.session_id;
    let applied = catalog
        .apply_refresh(again.id, view, 2, 0, &[addition(ha)], &[addition(oiii)])
        .await
        .unwrap();
    let draft = applied.draft.unwrap().draft_revision;
    assert_eq!(catalog.save_view(view, 2, draft).await.unwrap().view.revision, 3);
    let third = catalog.view_revision(view, 3).await.unwrap();
    let choice = |id: Uuid| third.sessions.iter().find(|c| c.session_id == id).unwrap();
    assert_eq!(choice(ha).reason, SelectionReason::RefreshMatch { review_id: again.id });
    assert_eq!(choice(oiii).state, SessionChoiceState::Excluded);
    let new: Vec<&ViewMember> = third.members.iter().filter(|m| m.session_id == ha).collect();
    assert_eq!(new.len(), 10);
    assert!(new.iter().all(|m| m.added_in_revision == Some(3)
        && m.reason == MemberReason::RefreshAdded { review_id: again.id }));
    assert_eq!(worked.revision(view, 2).await, revision, "revision 2 stays byte-identical");

    for path in &denied {
        set_mode(path, 0o644);
    }
    assert_eq!(scan_to_end(&worked.library, worked.astro).await.state, ScanState::Completed);
    let restored = worked.session("2026-09-18").await.id;
    for revision in [2, 3] {
        let held = catalog.view_revision(view, revision).await.unwrap();
        assert_eq!(held.sessions.iter().filter(|c| c.session_id == restored).count(), 1);
    }
}

/// Step 16: a stale draft edit and a stale Save are Conflict with the current
/// revision; one restored frame stays unsaved for the restart.
async fn stale_edits(worked: &Worked, view: Uuid, excluded: &[Uuid]) {
    let catalog = worked.library.catalog();
    let restore =
        DraftEdit::SetFrames { member_keys: vec![excluded[0]], state: MemberState::Included };
    assert_eq!(worked.edit(view, 0, restore.clone()).await.draft.unwrap().draft_revision, 1);
    let stale = catalog.edit_view_draft(view, 7, &restore).await.unwrap_err();
    assert!(matches!(stale, LibraryError::Conflict { current: 1, .. }), "{stale:?}");
    let stale = catalog.save_view(view, 2, 1).await.unwrap_err();
    assert!(matches!(stale, LibraryError::Conflict { current: 3, .. }), "{stale:?}");
}

/// Step 17: retire review of `Cold-1` names the View once a draft holds its
/// copies; that edit after a review makes it stale; after retiring, the
/// members read unresolved Retired and no revision changes.
async fn references(worked: &Worked, view: Uuid) {
    let library = &worked.library;
    let review = library.review_retire_location(worked.cold).await.unwrap();
    assert!(review.references.iter().all(|reference| reference.kind != ReferenceKind::View));
    let offline = worked.expected("2026-09-12").await;
    worked.edit(view, 1, DraftEdit::SelectSessions { sessions: vec![offline.clone()] }).await;
    let stale = library.retire_location(review.id, worked.cold, review.expected_revision).await;
    assert_eq!(stale.unwrap_err().response(None, None).kind, "conflict");
    let review = library.review_retire_location(worked.cold).await.unwrap();
    let named: Vec<(ReferenceKind, Uuid)> =
        review.references.iter().map(|reference| (reference.kind, reference.id)).collect();
    assert!(named.contains(&(ReferenceKind::View, view)), "{named:?}");
    let third = worked.revision(view, 3).await;
    let retired =
        library.retire_location(review.id, worked.cold, review.expected_revision).await.unwrap();
    assert_eq!(retired.lifecycle, LocationLifecycle::Retired);
    let detail = library.view_detail(view).await.unwrap();
    let source =
        detail.unresolved.iter().find(|source| source.session_id == offline.session_id).unwrap();
    assert_eq!((source.availability, source.member_keys.len()), (Availability::Retired, 10));
    assert_eq!(worked.revision(view, 3).await, third);
}

/// Step 18: after restart the committed revision and the unsaved draft read
/// separately and as before; every original is byte-identical.
async fn restart(worked: Worked, view: Uuid) {
    let before = json(&worked.library.view_detail(view).await.unwrap());
    let Worked { temp, database, library, originals, .. } = worked;
    drop(library);
    let reopened = Library::open(&database, None).await.unwrap();
    let detail = reopened.view_detail(view).await.unwrap();
    assert_eq!(detail.revision.as_ref().map(|revision| revision.revision), Some(3));
    assert_eq!(detail.draft.as_ref().map(|draft| draft.base_revision), Some(3));
    assert_eq!(json(&detail), before);
    for (path, digest) in &originals {
        assert_eq!(&support::digest(path), digest, "{} is read-only", path.display());
    }
    drop(temp);
}

#[tokio::test]
async fn the_worked_view_scenario_keeps_every_library_record_and_original() {
    let mut worked = Worked::new().await;
    let view = create_from_project(&worked).await;
    evidence_and_manual_choices(&worked, view).await;
    browse(&worked, view).await;
    summary_and_unresolved(&worked, view).await;
    let others = save_and_standalone(&worked, view).await;
    let excluded = exclude_six(&worked, view, others).await;
    quality_actions(&worked, view, &excluded).await;
    standalone_over_mixed_quality(&worked, view, &excluded).await;
    project_context(&worked, view).await;
    refresh(&mut worked, view).await;
    stale_edits(&worked, view, &excluded).await;
    references(&worked, view).await;
    restart(worked, view).await;
}
