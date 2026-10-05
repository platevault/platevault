// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Composed planning acceptance (spec 072) over generated FITS/XISF sessions
//! captured at Backyard and the second site, the saved NGC 7000 Target and the
//! NGC 7000 HOO Project: the Target overview with Project gaps, read-only
//! windows at either site, explicit reminder review and activation against the
//! default site, the scheduler lifecycle, calendar export of a reviewed
//! snapshot and the schema version. Every fixture file is only ever read.
#![cfg(unix)]

mod support;

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

use parking_lot::Mutex;
use persistence_library::SessionQuery;
use platevault_core::library::Library;
use platevault_core::notifier::{Clock, Notifier, NotifierFuture, ReminderNotice, SubmitOutcome};
use platevault_core::targets::ICRS_FRAME;
use platevault_core::*;
use sha2::{Digest, Sha256};
use sqlx::sqlite::{SqliteConnectOptions, SqliteConnection};
use sqlx::Connection;
use time::macros::{date, datetime};
use time::OffsetDateTime;
use uuid::Uuid;

const BACKYARD: (f64, f64) = (52.09, 5.12);
const SECOND_SITE: (f64, f64) = (37.98, 23.73);
/// Two nights at Backyard, the last one at the second site.
const NIGHTS: [(&str, (f64, f64)); 3] =
    [("2026-09-18", BACKYARD), ("2026-09-19", BACKYARD), ("2026-09-20", SECOND_SITE)];
const FILTERS: [&str; 2] = ["Ha", "OIII"];
/// Planning tables, children first.
const PLANNING_TABLES: [&str; 5] = [
    "reminder_deliveries",
    "reminder_subscriptions",
    "target_plans",
    "planning_settings",
    "observing_sites",
];
/// The fixed wall clock: noon UTC, hours before any window or due instant.
const NOW: OffsetDateTime = datetime!(2026-10-21 12:00 UTC);

// ---------------------------------------------------------------------------
// Ports under control
// ---------------------------------------------------------------------------

struct Fixed;

impl Clock for Fixed {
    fn now_utc(&self) -> OffsetDateTime {
        NOW
    }
}

/// Reports `permission`, answers a request with `requested` and records every
/// request and submission.
struct Recording {
    permission: Mutex<PermissionState>,
    requested: PermissionState,
    requests: AtomicUsize,
    submissions: Mutex<Vec<ReminderNotice>>,
}

impl Recording {
    fn new(permission: PermissionState, requested: PermissionState) -> Arc<Self> {
        Arc::new(Self {
            permission: Mutex::new(permission),
            requested,
            requests: AtomicUsize::new(0),
            submissions: Mutex::new(Vec::new()),
        })
    }

    fn granted() -> Arc<Self> {
        Self::new(PermissionState::Granted, PermissionState::Granted)
    }
}

impl Notifier for Recording {
    fn permission(&self) -> NotifierFuture<'_, PermissionState> {
        let permission = *self.permission.lock();
        Box::pin(async move { permission })
    }

    fn request_permission(&self) -> NotifierFuture<'_, PermissionState> {
        self.requests.fetch_add(1, Ordering::SeqCst);
        let answer = {
            let mut permission = self.permission.lock();
            if *permission == PermissionState::NotDetermined {
                *permission = self.requested;
            }
            *permission
        };
        Box::pin(async move { answer })
    }

    fn submit<'a>(&'a self, notice: &'a ReminderNotice) -> NotifierFuture<'a, SubmitOutcome> {
        self.submissions.lock().push(notice.clone());
        Box::pin(async { SubmitOutcome::Submitted })
    }
}

// ---------------------------------------------------------------------------
// Worked library
// ---------------------------------------------------------------------------

fn frame_name(night: usize, filter: &str, index: usize) -> String {
    let extension = if filter == "Ha" { "fits" } else { "xisf" };
    format!("n{night}_{filter}_{index}.{extension}")
}

/// Two 300 s light frames per night and filter, each with its capture site.
fn write_frames(root: &Path) -> Vec<(PathBuf, String)> {
    let mut originals = Vec::new();
    for (night, (date, (latitude, longitude))) in NIGHTS.iter().enumerate() {
        for (hour, filter) in FILTERS.iter().enumerate() {
            for index in 0..2 {
                let fields = [
                    ("IMAGETYP", "'LIGHT'".to_owned()),
                    ("INSTRUME", "'ASI2600MM'".into()),
                    ("TELESCOP", "'RedCat 51'".into()),
                    ("OBJECT", "'NGC 7000'".into()),
                    ("FILTER", format!("'{filter}'")),
                    ("EXPTIME", "300".into()),
                    ("DATE-OBS", format!("'{date}T2{}:0{}:00'", hour + 1, index * 5)),
                    ("SITELAT", format!("{latitude:.2}")),
                    ("SITELONG", format!("{longitude:.2}")),
                ];
                let fields: Vec<(&str, &str)> =
                    fields.iter().map(|(key, value)| (*key, value.as_str())).collect();
                let path = root.join(frame_name(night, filter, index));
                if *filter == "Ha" {
                    support::fits(&path, &fields).unwrap();
                } else {
                    support::xisf(&path, &fields).unwrap();
                }
                originals.push((path.clone(), support::digest(&path)));
            }
        }
    }
    originals
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

fn backyard_input() -> SiteInput {
    SiteInput {
        name: "Backyard".into(),
        latitude_deg: BACKYARD.0,
        longitude_deg: BACKYARD.1,
        elevation_m: Some(5.0),
        time_zone: "Europe/Amsterdam".into(),
    }
}

fn athens_input() -> SiteInput {
    SiteInput {
        name: "Athens".into(),
        latitude_deg: SECOND_SITE.0,
        longitude_deg: SECOND_SITE.1,
        elevation_m: Some(100.0),
        time_zone: "Europe/Athens".into(),
    }
}

fn criteria() -> PlanCriteria {
    PlanCriteria {
        min_altitude_deg: 30.0,
        darkness: Darkness::Astronomical,
        moon: MoonCriterion::MinSeparation { min_separation_deg: 30.0 },
        min_duration_minutes: 60,
    }
}

/// The indexed worked subset with NGC 7000 saved and the HOO Project.
struct Worked {
    temp: tempfile::TempDir,
    database: PathBuf,
    library: Arc<Library>,
    location: Uuid,
    target: TargetRecord,
    project: Project,
    originals: Vec<(PathBuf, String)>,
}

impl Worked {
    async fn new() -> Self {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("RedCat");
        std::fs::create_dir(&root).unwrap();
        let originals = write_frames(&root);
        let database = temp.path().join("library.sqlite");
        let library = Library::open(&database, None).await.unwrap();
        let location = library
            .register_location(
                NativePath::from_path(&root),
                "RedCat".into(),
                LocationRole::Captures,
            )
            .await
            .unwrap();
        assert_eq!(scan_to_end(&library, location.id).await.state, ScanState::Completed);
        let target = TargetCandidate {
            id: Uuid::new_v4(),
            designation: "NGC 7000".into(),
            aliases: Vec::new(),
            common_name: Some("North America Nebula".into()),
            object_type: "nebula".into(),
            coordinates: Some(SkyCoordinates {
                ra_deg: 314.75,
                dec_deg: 44.33,
                frame: ICRS_FRAME.into(),
            }),
            provenance: Provenance::User,
            provider_id: None,
        };
        let target = library.catalog().save_target(&target, None).await.unwrap();
        let project = hoo_project(&library, &target).await;
        Self { temp, database, library, location: location.id, target, project, originals }
    }

    async fn sites(&self) -> (ObservingSite, ObservingSite) {
        let backyard = self.library.save_site(None, None, &backyard_input()).await.unwrap();
        let athens = self.library.save_site(None, None, &athens_input()).await.unwrap();
        (backyard.site, athens.site)
    }

    async fn default_site(&self, site: &ObservingSite) -> PlanningSettings {
        let current = self.library.catalog().list_sites().await.unwrap().settings_revision;
        self.library.set_default_site(Some(site.id), current).await.unwrap().settings
    }

    fn reminder(&self, lead_minutes: u32) -> ReminderInput {
        ReminderInput { target_id: self.target.candidate.id, criteria: criteria(), lead_minutes }
    }

    async fn enable(
        &self,
        site: &ObservingSite,
        expected: Option<Revision>,
    ) -> ReminderSubscription {
        let settings = self.library.catalog().list_sites().await.unwrap().settings_revision;
        self.library
            .enable_reminders(&EnableReminders {
                reminder: self.reminder(60),
                site_id: site.id,
                site_revision: site.revision,
                settings_revision: settings,
                expected_revision: expected,
            })
            .await
            .unwrap()
    }

    fn query(&self, site: &ObservingSite, nights: u32, criteria: PlanCriteria) -> WindowQuery {
        WindowQuery {
            target_id: self.target.candidate.id,
            site_id: site.id,
            first_night: date!(2026 - 10 - 21),
            nights,
            criteria,
        }
    }

    async fn planning_rows(&self) -> BTreeMap<&'static str, i64> {
        let options = SqliteConnectOptions::new().filename(&self.database).read_only(true);
        let mut conn = SqliteConnection::connect_with(&options).await.unwrap();
        let mut counts = BTreeMap::new();
        for table in PLANNING_TABLES {
            let count: i64 =
                sqlx::query_scalar(sqlx::AssertSqlSafe(format!("SELECT count(*) FROM {table}")))
                    .fetch_one(&mut conn)
                    .await
                    .unwrap();
            counts.insert(table, count);
        }
        conn.close().await.unwrap();
        counts
    }

    async fn operations(&self) -> serde_json::Value {
        serde_json::to_value(self.library.catalog().list_operations(None, 0, 100).await.unwrap())
            .unwrap()
    }

    /// Project links, every session with its capture site, the Target record
    /// and its coverage.
    async fn library_state(&self) -> serde_json::Value {
        let catalog = self.library.catalog();
        let detail = self.library.project_detail(self.project.id).await.unwrap();
        let query = SessionQuery { include_superseded: true, ..SessionQuery::default() };
        let mut sessions = Vec::new();
        for summary in catalog.list_sessions(&query).await.unwrap() {
            sessions.push(catalog.session(summary.session.id).await.unwrap());
        }
        serde_json::json!({
            "project": detail.project,
            "links": detail.links,
            "sessions": sessions,
            "assets": catalog.location_assets(self.location).await.unwrap(),
            "target": catalog.target(self.target.candidate.id).await.unwrap(),
            "coverage": catalog.target_coverage(self.target.candidate.id).await.unwrap(),
        })
    }

    async fn status(&self) -> ReminderStatus {
        self.library.reminder_status(0, 0).await.unwrap()
    }

    /// PV-PLAN-SC-03: every source image is byte-identical.
    fn assert_originals(&self) {
        for (path, digest) in &self.originals {
            assert_eq!(&support::digest(path), digest, "{} is read-only", path.display());
        }
    }
}

async fn hoo_project(library: &Library, target: &TargetRecord) -> Project {
    let catalog = library.catalog();
    let project = catalog
        .create_project(&ProjectInput {
            name: "NGC 7000 HOO".into(),
            notes: None,
            targets: vec![TargetFraming {
                target_id: target.candidate.id,
                expected_revision: target.decision_revision,
            }],
            panels: Vec::new(),
            equipment_ids: Vec::new(),
        })
        .await
        .unwrap();
    let sessions = catalog.list_sessions(&SessionQuery::default()).await.unwrap();
    assert_eq!(sessions.len(), NIGHTS.len() * FILTERS.len());
    let links: Vec<SessionLinkInput> = sessions
        .iter()
        .map(|summary| SessionLinkInput {
            session: ExpectedSession {
                session_id: summary.session.id,
                grouping_revision: summary.session.grouping_revision,
                decision_revision: summary.session.decision_revision,
            },
            panel_id: None,
        })
        .collect();
    let project = catalog.link_sessions(project.id, project.revision, &links).await.unwrap();
    let items = [
        ChecklistKind::Integration { channel: "Ha".into(), goal_seconds: 36_000 },
        ChecklistKind::Integration { channel: "OIII".into(), goal_seconds: 36_000 },
        ChecklistKind::ExposurePreference { exposure_seconds: 300.0, channel: None },
    ]
    .map(|criterion| ChecklistItemInput { id: None, criterion });
    catalog.set_checklist(project.id, project.revision, &items).await.unwrap()
}

fn kind(error: &LibraryError) -> String {
    error.response(None, None).kind
}

fn sha256(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

/// PLAN-FR-02, R23: the overview shows the Planned mark, the subscription, the
/// Target coverage and the unmet HOO goals copied from `project_detail`.
#[tokio::test]
async fn the_target_overview_shows_coverage_and_unmet_project_goals() {
    let worked = Worked::new().await;
    let library = &worked.library;
    let id = worked.target.candidate.id;
    let rows = worked.planning_rows().await;
    let overview = library.target_overview(id).await.unwrap();

    assert_eq!(overview.target.candidate.id, id);
    assert_eq!(overview.target.decision_revision, worked.target.decision_revision);
    assert_eq!((overview.plan.planned, overview.plan.revision), (false, 0));
    assert!(overview.subscription.is_none());
    assert!(overview.sites.is_empty() && overview.default_site_id.is_none());
    let coverage = library.catalog().target_coverage(id).await.unwrap();
    assert_eq!(
        serde_json::to_value(&overview.coverage).unwrap(),
        serde_json::to_value(&coverage).unwrap()
    );

    let detail = library.project_detail(worked.project.id).await.unwrap();
    let unmet: Vec<ChecklistProgress> = detail
        .checklist
        .iter()
        .filter(|item| matches!(item.item.criterion, ChecklistKind::Integration { .. }))
        .cloned()
        .collect();
    assert_eq!(unmet.len(), 2);
    assert!(unmet
        .iter()
        .all(|item| matches!(item.outcome, ChecklistOutcome::Seconds { met: false, .. })));
    assert_eq!(overview.project_gaps.len(), 1, "{:?}", overview.project_gaps);
    let gap = &overview.project_gaps[0];
    assert_eq!(
        (gap.project_id, gap.name.as_str(), gap.revision),
        (worked.project.id, "NGC 7000 HOO", detail.project.revision)
    );
    // Ha 10 h and OIII 10 h are unmet; the 300 s exposure preference matches
    // every linked session and is no gap.
    assert_eq!(gap.items, unmet);
    assert_eq!(worked.planning_rows().await, rows, "the overview writes nothing");
    worked.assert_originals();
}

/// PLAN-AC-01: windows at Backyard and then the second site name their site,
/// differ, and change no Project link, session, capture site, Target, planning
/// row or Activity operation.
#[tokio::test]
async fn windows_at_either_site_are_read_only_and_name_their_site() {
    let worked = Worked::new().await;
    let (backyard, athens) = worked.sites().await;
    let state = worked.library_state().await;
    let rows = worked.planning_rows().await;
    let operations = worked.operations().await;

    let at_backyard =
        worked.library.compute_windows(&worked.query(&backyard, 7, criteria())).await.unwrap();
    let at_athens =
        worked.library.compute_windows(&worked.query(&athens, 7, criteria())).await.unwrap();
    for (set, site, zone) in
        [(&at_backyard, &backyard, "Europe/Amsterdam"), (&at_athens, &athens, "Europe/Athens")]
    {
        assert_eq!(set.basis.site, site.basis());
        assert_eq!(
            (set.basis.time_zone.as_str(), set.basis.target_id),
            (zone, worked.target.candidate.id)
        );
        assert_eq!(set.nights.len(), 7);
        assert!(set.windows().count() > 0);
        assert!(set.windows().all(|w| w.site_name == site.name && w.time_zone == zone));
    }
    let starts = |set: &WindowSet| set.windows().map(|w| w.start_utc).collect::<Vec<_>>();
    assert_ne!(starts(&at_backyard), starts(&at_athens));

    assert_eq!(worked.library_state().await, state);
    assert_eq!(worked.planning_rows().await, rows);
    assert_eq!(worked.operations().await, operations);
    worked.assert_originals();
}

/// R3: a zone outside the bundled database is refused before the catalog
/// write.
#[tokio::test]
async fn an_unknown_time_zone_stores_no_site() {
    let worked = Worked::new().await;
    let mars = SiteInput { time_zone: "Mars/Olympus".into(), ..backyard_input() };
    let error = worked.library.save_site(None, None, &mars).await.unwrap_err();
    assert_eq!(kind(&error), "invalid_input", "{error}");
    assert!(error.to_string().contains("timeZone"), "{error}");
    assert!(worked.library.catalog().list_sites().await.unwrap().sites.is_empty());
    assert!(worked.planning_rows().await.values().all(|count| *count == 0));
    worked.assert_originals();
}

/// PLAN-AC-04, PLAN-AC-06: reminders need a default site and explicit
/// criteria and lead time; a review names every value and writes nothing.
#[tokio::test]
async fn reminder_review_and_activation_need_a_default_site_and_explicit_values() {
    let worked = Worked::new().await;
    let library = &worked.library;
    library.attach_notifier(Recording::granted(), Arc::new(Fixed)).await.unwrap();
    let (backyard, _athens) = worked.sites().await;
    let rows = worked.planning_rows().await;

    let error = library.review_reminders(&worked.reminder(60)).await.unwrap_err();
    assert_eq!(kind(&error), "invalid_input", "{error}");
    assert!(error.to_string().contains("defaultSite"), "{error}");
    let request = EnableReminders {
        reminder: worked.reminder(60),
        site_id: backyard.id,
        site_revision: backyard.revision,
        settings_revision: 0,
        expected_revision: None,
    };
    let error = library.enable_reminders(&request).await.unwrap_err();
    assert_eq!(kind(&error), "invalid_input", "{error}");
    assert!(error.to_string().contains("defaultSite"), "{error}");
    assert_eq!(worked.planning_rows().await, rows, "no default site stores nothing");

    let settings = worked.default_site(&backyard).await;
    let rows = worked.planning_rows().await;
    let target = worked.target.candidate.id;
    for missing in ["leadMinutes", "criteria"] {
        let mut reminder = serde_json::json!({
            "targetId": target, "criteria": criteria(), "leadMinutes": 60
        });
        reminder.as_object_mut().unwrap().remove(missing);
        let enable = serde_json::json!({
            "reminder": reminder, "siteId": backyard.id, "siteRevision": backyard.revision,
            "settingsRevision": settings.revision
        });
        assert!(serde_json::from_value::<EnableReminders>(enable).is_err(), "{missing}");
        assert!(serde_json::from_value::<ReminderInput>(reminder).is_err(), "{missing}");
    }
    assert_eq!(worked.planning_rows().await, rows, "an incomplete request stores nothing");

    let review = library.review_reminders(&worked.reminder(60)).await.unwrap();
    assert_eq!((review.target_id, review.designation.as_str()), (target, "NGC 7000"));
    assert_eq!(review.site, backyard.basis());
    assert_eq!(
        (review.time_zone.as_str(), review.settings_revision),
        ("Europe/Amsterdam", settings.revision)
    );
    assert_eq!((review.criteria, review.lead_minutes), (criteria(), 60));
    assert_eq!(review.permission, PermissionState::Granted);
    assert_eq!(review.app_closed_delivery, AppClosedDelivery::UNAVAILABLE);
    assert_eq!(review.subscription_revision, None);
    assert!(!review.upcoming.is_empty());
    assert!(review.upcoming.iter().all(|reminder| reminder.site_id == backyard.id
        && reminder.site_name == "Backyard"
        && reminder.lead_minutes == 60
        && reminder.start_utc > NOW));
    assert!(review.upcoming.windows(2).all(|pair| pair[0].due_at <= pair[1].due_at));
    assert_eq!(worked.planning_rows().await, rows, "a review writes nothing");
    worked.assert_originals();
}

/// PLAN-AC-05, R17: the scheduler exists only while a subscription is enabled
/// and a notifier is attached; enabling starts no scan.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_scheduler_runs_only_while_a_subscription_is_enabled() {
    let worked = Worked::new().await;
    let notifier = Recording::granted();
    worked.library.attach_notifier(notifier.clone(), Arc::new(Fixed)).await.unwrap();
    let (backyard, athens) = worked.sites().await;
    worked.default_site(&backyard).await;
    let operations = worked.operations().await;
    let status = worked.status().await;
    assert!(!status.scheduler_running);
    assert_eq!(status.app_closed_delivery, AppClosedDelivery::UNAVAILABLE);
    assert!(status.subscriptions.is_empty() && status.upcoming.is_empty());

    let enabled = worked.enable(&backyard, None).await;
    assert_eq!(
        (enabled.state, enabled.site_id, enabled.lead_minutes),
        (SubscriptionState::Enabled, backyard.id, 60)
    );
    let status = worked.status().await;
    assert!(status.scheduler_running);
    assert_eq!(status.permission, PermissionState::Granted);
    assert_eq!(status.subscriptions, std::slice::from_ref(&enabled));
    assert!(!status.upcoming.is_empty());
    // PLAN-AC-02: every upcoming reminder is at Backyard, none at the second site.
    assert!(status.upcoming.iter().all(|r| r.site_id == backyard.id && r.site_id != athens.id));
    assert!(status.upcoming.windows(2).all(|pair| pair[0].due_at <= pair[1].due_at));
    assert!(status.deliveries.is_empty());
    assert_eq!(worked.operations().await, operations, "enabling starts no scan");

    let disabled = worked
        .library
        .disable_reminders(worked.target.candidate.id, enabled.revision)
        .await
        .unwrap();
    assert_eq!(disabled.state, SubscriptionState::Disabled);
    let status = worked.status().await;
    assert!(!status.scheduler_running);
    assert!(status.upcoming.is_empty());

    // A reopened catalog without an enabled subscription starts no scheduler;
    // one with an enabled subscription starts it when the notifier attaches.
    let reopen = |worked: &Worked| {
        let database = worked.database.clone();
        async move {
            let library = Library::open(&database, None).await.unwrap();
            library.attach_notifier(Recording::granted(), Arc::new(Fixed)).await.unwrap();
            library
        }
    };
    let reopened = reopen(&worked).await;
    assert!(!reopened.reminder_status(0, 0).await.unwrap().scheduler_running);
    drop(reopened);
    let again = worked.enable(&backyard, Some(disabled.revision)).await;
    assert_eq!(again.state, SubscriptionState::Enabled);
    let reopened = reopen(&worked).await;
    assert!(reopened.reminder_status(0, 0).await.unwrap().scheduler_running);
    assert!(notifier.submissions.lock().is_empty(), "nothing was due at {NOW}");
    assert_eq!(worked.operations().await, operations);
    worked.assert_originals();
}

/// R18, PLAN-FR-07: an undetermined permission is requested first; a denial
/// commits a visible blocked subscription and starts no scheduler.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn activation_requests_an_undetermined_permission_and_commits_a_denial_as_blocked() {
    let worked = Worked::new().await;
    let (backyard, _athens) = worked.sites().await;
    worked.default_site(&backyard).await;

    let asking = Recording::new(PermissionState::NotDetermined, PermissionState::Denied);
    worked.library.attach_notifier(asking.clone(), Arc::new(Fixed)).await.unwrap();
    let blocked = worked.enable(&backyard, None).await;
    assert_eq!(asking.requests.load(Ordering::SeqCst), 1);
    assert_eq!(
        (blocked.state, blocked.block_reason),
        (SubscriptionState::Blocked, Some(BlockReason::PermissionDenied))
    );
    assert_eq!(blocked.actions, [RecoveryAction::Settings, RecoveryAction::Retry]);
    let status = worked.status().await;
    assert!(!status.scheduler_running);
    assert_eq!(status.permission, PermissionState::Denied);
    assert_eq!(status.subscriptions, std::slice::from_ref(&blocked));

    // Retry repeats activation with the shown values once the user allowed it.
    let allowed = Recording::new(PermissionState::NotDetermined, PermissionState::Granted);
    worked.library.attach_notifier(allowed.clone(), Arc::new(Fixed)).await.unwrap();
    let enabled = worked.enable(&backyard, Some(blocked.revision)).await;
    assert_eq!((enabled.state, enabled.block_reason), (SubscriptionState::Enabled, None));
    assert!(worked.status().await.scheduler_running);
    worked.assert_originals();
}

/// R12, R10, R11: a default-site change needs reconfirmation and stops
/// scheduling; the Planned mark changes no Target revision and enables nothing.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_default_site_change_needs_reconfirmation_and_planned_enables_nothing() {
    let worked = Worked::new().await;
    worked.library.attach_notifier(Recording::granted(), Arc::new(Fixed)).await.unwrap();
    let (backyard, athens) = worked.sites().await;
    let settings = worked.default_site(&backyard).await;
    let enabled = worked.enable(&backyard, None).await;
    assert!(worked.status().await.scheduler_running);

    let moved = worked.library.set_default_site(Some(athens.id), settings.revision).await.unwrap();
    assert_eq!(moved.settings.default_site_id, Some(athens.id));
    assert_eq!(moved.needs_reconfirmation, [worked.target.candidate.id]);
    let status = worked.status().await;
    assert!(!status.scheduler_running, "a subscription needing reconfirmation schedules nothing");
    assert!(status.upcoming.is_empty());
    assert_eq!(status.subscriptions[0].state, SubscriptionState::NeedsReconfirmation);
    assert_eq!(status.subscriptions[0].revision, enabled.revision + 1);

    let id = worked.target.candidate.id;
    let plan = worked.library.catalog().set_target_planned(id, true, 0).await.unwrap();
    assert_eq!((plan.planned, plan.revision), (true, 1));
    let overview = worked.library.target_overview(id).await.unwrap();
    assert_eq!((overview.plan.planned, overview.plan.revision), (true, 1));
    assert_eq!(overview.target.decision_revision, worked.target.decision_revision);
    assert_eq!(overview.default_site_id, Some(athens.id));
    assert_eq!(overview.sites.len(), 2);
    let subscription = overview.subscription.unwrap();
    assert_eq!(subscription.state, SubscriptionState::NeedsReconfirmation);
    assert!(!worked.status().await.scheduler_running, "Planned enables nothing");
    worked.assert_originals();
}

/// PLAN-AC-03: export writes exactly the reviewed windows; a site edit makes
/// the reviewed digest stale; the written file never changes afterwards.
#[tokio::test]
async fn calendar_export_writes_exactly_the_reviewed_snapshot() {
    let worked = Worked::new().await;
    let library = &worked.library;
    library.attach_notifier(Recording::granted(), Arc::new(Fixed)).await.unwrap();
    let (backyard, _athens) = worked.sites().await;
    let query = worked.query(&backyard, 7, criteria());
    let set = library.compute_windows(&query).await.unwrap();
    let all: Vec<ObservingWindow> = set.windows().cloned().collect();
    assert!(all.len() >= 3, "{}", all.len());
    let chosen = [all[2].clone(), all[0].clone()];
    let selection = ExportSelection {
        query: query.clone(),
        window_keys: chosen.iter().map(|w| w.key).collect(),
    };
    let rows = worked.planning_rows().await;

    let review = library.review_calendar_export(&selection).await.unwrap();
    let snapshot = &review.snapshot;
    assert_eq!(
        snapshot.windows,
        [all[0].clone(), all[2].clone()],
        "selected windows in time order"
    );
    assert_eq!(
        (snapshot.target_id, snapshot.target_revision),
        (worked.target.candidate.id, worked.target.decision_revision)
    );
    assert_eq!(
        (snapshot.site.clone(), snapshot.time_zone.as_str()),
        (backyard.basis(), "Europe/Amsterdam")
    );
    assert_eq!(
        (snapshot.first_night, snapshot.last_night),
        (date!(2026 - 10 - 21), date!(2026 - 10 - 27))
    );
    assert_eq!(snapshot.criteria, criteria());
    assert_eq!(review.snapshot_digest, calendar::snapshot_digest(snapshot).unwrap());
    assert_eq!(review.suggested_file_name, "NGC-7000-Backyard-2026-10-21-to-2026-10-27.ics");
    assert_eq!(worked.planning_rows().await, rows, "a review writes nothing");

    // A key the recomputed set lacks is a Conflict.
    let absent = WindowKey::new(
        worked.target.candidate.id,
        backyard.id,
        all[0].start_utc + time::Duration::minutes(1),
    )
    .unwrap();
    let stale = ExportSelection { query: query.clone(), window_keys: vec![absent] };
    let error = library.review_calendar_export(&stale).await.unwrap_err();
    assert_eq!(kind(&error), "conflict", "{error}");

    let path = worked.temp.path().join("ngc-7000.ics");
    let prepared =
        library.prepare_calendar_export(&selection, &review.snapshot_digest).await.unwrap();
    let outcome = library.write_calendar_export(prepared, path.clone()).await.unwrap();
    let bytes = std::fs::read(&path).unwrap();
    let file = outcome.file.clone().unwrap();
    assert!(outcome.saved);
    assert_eq!(file.path, NativePath::from_path(&path));
    assert_eq!((file.window_count, file.byte_count), (2, bytes.len() as u64));
    assert_eq!(file.sha256, sha256(&bytes));
    let text = String::from_utf8(bytes).unwrap().replace("\r\n ", "");
    assert_eq!(text.matches("BEGIN:VEVENT").count(), 2);
    let uids: Vec<&str> = text.lines().filter_map(|line| line.strip_prefix("UID:")).collect();
    let expected: Vec<String> = [&all[0], &all[2]]
        .iter()
        .map(|window| {
            let start = window.key.start_utc();
            format!(
                "{}-{}-{:04}{:02}{:02}T{:02}{:02}Z@platevault",
                window.key.target_id(),
                window.key.site_id(),
                start.year(),
                u8::from(start.month()),
                start.day(),
                start.hour(),
                start.minute()
            )
        })
        .collect();
    assert_eq!(uids, expected, "exactly the selected windows, in time order");
    assert!(text.contains("LOCATION:Backyard") && text.contains("X-WR-TIMEZONE:Europe/Amsterdam"));
    let written = sha256(&std::fs::read(&path).unwrap());

    // Editing the site makes the reviewed digest stale.
    let moved = SiteInput { latitude_deg: 52.5, ..backyard_input() };
    let edited =
        library.save_site(Some(backyard.id), Some(backyard.revision), &moved).await.unwrap();
    assert_eq!(edited.site.revision, backyard.revision + 1);
    let error =
        library.prepare_calendar_export(&selection, &review.snapshot_digest).await.unwrap_err();
    assert_eq!(kind(&error), "conflict", "{error}");

    // New criteria give another snapshot; the written file stays as it was.
    let wider = PlanCriteria { min_altitude_deg: 20.0, ..criteria() };
    let recomputed = library.compute_windows(&worked.query(&edited.site, 7, wider)).await.unwrap();
    let first = recomputed.windows().next().unwrap().key;
    let other =
        ExportSelection { query: worked.query(&edited.site, 7, wider), window_keys: vec![first] };
    let other_review = library.review_calendar_export(&other).await.unwrap();
    assert_ne!(other_review.snapshot_digest, review.snapshot_digest);
    assert_eq!(sha256(&std::fs::read(&path).unwrap()), written);
    worked.assert_originals();
}

/// R1: the schema version is one above 065's version 7, and a catalog
/// recorded at 7 is refused.
#[tokio::test]
async fn the_schema_version_is_eight_and_an_older_catalog_is_refused() {
    let temp = tempfile::tempdir().unwrap();
    let database = temp.path().join("library.sqlite");
    drop(Library::open(&database, None).await.unwrap());
    let mut conn = SqliteConnection::connect_with(&SqliteConnectOptions::new().filename(&database))
        .await
        .unwrap();
    let version: i64 =
        sqlx::query_scalar("SELECT value FROM catalog_meta WHERE key = 'schema_version'")
            .fetch_one(&mut conn)
            .await
            .unwrap();
    assert_eq!(version, 8);
    sqlx::query("UPDATE catalog_meta SET value = 7 WHERE key = 'schema_version'")
        .execute(&mut conn)
        .await
        .unwrap();
    conn.close().await.unwrap();
    let error = Library::open(&database, None).await.err().expect("an older catalog is refused");
    assert_eq!(kind(&error), "invalid_input", "{error}");
    assert!(error.to_string().contains("schema version 7"), "{error}");
}
