// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! In-app reminders (spec 072, PLAN-FR-03/06/07, PLAN-AC-02/05/07) over a
//! file-backed catalog with a controlled wall clock and a recording notifier:
//! the due interval, one claim then one submission per window identity, no
//! reminder for windows at another site, durable suppression across restart,
//! permission re-read before each submission, the 30 s wall-clock re-check and
//! no scan or inventory activity.
#![cfg(unix)]

use std::future::Future;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Weak};
use std::time::{Duration as StdDuration, Instant};

use parking_lot::Mutex;

use persistence_library::{Catalog, SubscriptionWrite};
use platevault_core::notifier::{Clock, Notifier, NotifierFuture, ReminderNotice, SubmitOutcome};
use platevault_core::planning::compute_windows;
use platevault_core::reminders::{due_reminders, notice, upcoming_reminders, ReminderScheduler};
use platevault_core::{
    BlockReason, Darkness, DeliveryState, MoonCriterion, ObservingSite, ObservingWindow,
    PermissionState, PlanCriteria, Provenance, RecoveryAction, ReminderSubscription, SiteInput,
    SkyCoordinates, SubscriptionState, TargetAlias, TargetCandidate, TargetRecord, WindowKey,
    WindowQuery, WindowSet,
};
use time::macros::date;
use time::{Date, Duration, OffsetDateTime};
use uuid::Uuid;

/// The night every scenario plans, by its Backyard evening date.
const NIGHT: Date = date!(2026 - 10 - 21);
/// How long a test waits for one scheduler outcome.
const PATIENCE: StdDuration = StdDuration::from_secs(20);

// ---------------------------------------------------------------------------
// Ports under control
// ---------------------------------------------------------------------------

/// A wall clock the test sets; it never advances on its own.
struct Controlled(Mutex<OffsetDateTime>);

impl Controlled {
    fn at(instant: OffsetDateTime) -> Arc<Self> {
        Arc::new(Self(Mutex::new(instant)))
    }

    fn set(&self, instant: OffsetDateTime) {
        *self.0.lock() = instant;
    }
}

impl Clock for Controlled {
    fn now_utc(&self) -> OffsetDateTime {
        *self.0.lock()
    }
}

#[derive(Clone, Copy)]
enum Answer {
    Accept,
    Refuse,
    /// The OS never answers, as when the process stops mid-submission.
    Hang,
}

/// What one submission saw: the notice and the delivery state of its identity
/// in the catalog at that moment.
#[derive(Clone, Debug)]
struct Submission {
    notice: ReminderNotice,
    claimed_as: Option<DeliveryState>,
}

/// Records every permission read and submission, answering as configured.
struct Recording {
    permission: Mutex<PermissionState>,
    answer: Answer,
    permission_reads: AtomicUsize,
    submissions: Mutex<Vec<Submission>>,
    catalog: Mutex<Weak<Catalog>>,
}

impl Recording {
    fn new(permission: PermissionState, answer: Answer) -> Arc<Self> {
        Arc::new(Self {
            permission: Mutex::new(permission),
            answer,
            permission_reads: AtomicUsize::new(0),
            submissions: Mutex::new(Vec::new()),
            catalog: Mutex::new(Weak::new()),
        })
    }

    /// Let each submission observe the delivery state of its identity.
    fn observe(&self, catalog: &Arc<Catalog>) {
        *self.catalog.lock() = Arc::downgrade(catalog);
    }

    fn set_permission(&self, permission: PermissionState) {
        *self.permission.lock() = permission;
    }

    fn reads(&self) -> usize {
        self.permission_reads.load(Ordering::SeqCst)
    }

    fn submissions(&self) -> Vec<Submission> {
        self.submissions.lock().clone()
    }
}

impl Notifier for Recording {
    fn permission(&self) -> NotifierFuture<'_, PermissionState> {
        self.permission_reads.fetch_add(1, Ordering::SeqCst);
        let permission = *self.permission.lock();
        Box::pin(async move { permission })
    }

    fn request_permission(&self) -> NotifierFuture<'_, PermissionState> {
        let permission = *self.permission.lock();
        Box::pin(async move { permission })
    }

    fn submit<'a>(&'a self, notice: &'a ReminderNotice) -> NotifierFuture<'a, SubmitOutcome> {
        Box::pin(async move {
            let catalog = self.catalog.lock().upgrade();
            let claimed_as = match catalog {
                Some(catalog) => catalog
                    .reminder_deliveries(0, 0)
                    .await
                    .unwrap()
                    .into_iter()
                    .find(|delivery| delivery.window_key == notice.window)
                    .map(|delivery| delivery.state),
                None => None,
            };
            self.submissions.lock().push(Submission { notice: notice.clone(), claimed_as });
            match self.answer {
                Answer::Accept => SubmitOutcome::Submitted,
                Answer::Refuse => SubmitOutcome::Failed { reason: "request refused".into() },
                Answer::Hang => std::future::pending().await,
            }
        })
    }
}

// ---------------------------------------------------------------------------
// Catalog fixture
// ---------------------------------------------------------------------------

fn criteria() -> PlanCriteria {
    PlanCriteria {
        min_altitude_deg: 30.0,
        darkness: Darkness::Astronomical,
        moon: MoonCriterion::MinSeparation { min_separation_deg: 30.0 },
        min_duration_minutes: 60,
    }
}

fn backyard_input() -> SiteInput {
    SiteInput {
        name: "Backyard".into(),
        latitude_deg: 52.09,
        longitude_deg: 5.12,
        elevation_m: Some(5.0),
        time_zone: "Europe/Amsterdam".into(),
    }
}

fn athens_input() -> SiteInput {
    SiteInput {
        name: "Athens".into(),
        latitude_deg: 37.98,
        longitude_deg: 23.73,
        elevation_m: Some(100.0),
        time_zone: "Europe/Athens".into(),
    }
}

fn candidate(designation: &str, ra_deg: f64, dec_deg: f64) -> TargetCandidate {
    TargetCandidate {
        id: Uuid::new_v4(),
        designation: designation.into(),
        aliases: vec![TargetAlias {
            text: designation.into(),
            normalized: designation.to_lowercase(),
            kind: "designation".into(),
            provenance: Provenance::User,
        }],
        common_name: None,
        object_type: "nebula".into(),
        coordinates: Some(SkyCoordinates { ra_deg, dec_deg, frame: "icrs".into() }),
        provenance: Provenance::User,
        provider_id: None,
        angular_size: None,
        catalogues: Vec::new(),
    }
}

/// A file-backed catalog holding NGC 7000, Backyard as the default site and
/// the second site.
struct Planning {
    /// Holds the catalog file for the test's lifetime.
    dir: tempfile::TempDir,
    db: PathBuf,
    catalog: Arc<Catalog>,
    ngc: TargetRecord,
    backyard: ObservingSite,
    athens: ObservingSite,
    settings_revision: u64,
}

impl Planning {
    async fn new() -> Self {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("library.db");
        let catalog = Arc::new(Catalog::open(&db).await.unwrap());
        let ngc = catalog.save_target(&candidate("NGC 7000", 314.75, 44.33), None).await.unwrap();
        let backyard = catalog.save_site(None, None, &backyard_input()).await.unwrap().site;
        let athens = catalog.save_site(None, None, &athens_input()).await.unwrap().site;
        let settings = catalog.set_default_site(Some(backyard.id), 0).await.unwrap().settings;
        Self { dir, db, catalog, ngc, backyard, athens, settings_revision: settings.revision }
    }

    async fn save_target(&self, designation: &str, ra_deg: f64, dec_deg: f64) -> TargetRecord {
        self.catalog.save_target(&candidate(designation, ra_deg, dec_deg), None).await.unwrap()
    }

    /// Activate reminders for `target` at Backyard, as granted activation does.
    async fn subscribe(
        &self,
        target: &TargetRecord,
        criteria: PlanCriteria,
        lead_minutes: u32,
    ) -> ReminderSubscription {
        self.catalog
            .put_reminder_subscription(&SubscriptionWrite {
                target_id: target.candidate.id,
                site_id: self.backyard.id,
                site_revision: self.backyard.revision,
                settings_revision: self.settings_revision,
                criteria,
                lead_minutes,
                expected: None,
                state: SubscriptionState::Enabled,
                block_reason: None,
            })
            .await
            .unwrap()
    }

    /// Close the catalog, which a stopped scheduler must have released, and
    /// open it again as a restart does.
    async fn reopen(self) -> Self {
        let Self { dir, db, catalog, ngc, backyard, athens, settings_revision } = self;
        let Ok(catalog) = Arc::try_unwrap(catalog) else {
            panic!("the scheduler still holds the catalog after stop");
        };
        catalog.close().await.unwrap();
        let catalog = Arc::new(open(&db).await);
        Self { dir, db, catalog, ngc, backyard, athens, settings_revision }
    }

    async fn operations(&self) -> String {
        serde_json::to_string(&self.catalog.list_operations(None, 0, 100).await.unwrap()).unwrap()
    }
}

async fn open(db: &Path) -> Catalog {
    Catalog::open(db).await.unwrap()
}

fn windows_at(
    target: &TargetRecord,
    site: &ObservingSite,
    criteria: PlanCriteria,
    first_night: Date,
    nights: u32,
) -> WindowSet {
    let query = WindowQuery {
        target_id: target.candidate.id,
        site_id: site.id,
        first_night,
        nights,
        criteria,
    };
    compute_windows(target, site, &query).unwrap()
}

/// The first window of `night`, or of the first night after it that has one.
fn first_window(set: &WindowSet, night: Date) -> ObservingWindow {
    set.windows().find(|window| window.night >= night).cloned().expect("a window on the night")
}

fn due_at(window: &ObservingWindow, lead_minutes: u32) -> OffsetDateTime {
    window.start_utc - Duration::minutes(i64::from(lead_minutes))
}

/// Poll `condition` until it holds or [`PATIENCE`] runs out.
async fn eventually<F, Fut>(what: &str, mut condition: F)
where
    F: FnMut() -> Fut,
    Fut: Future<Output = bool>,
{
    let deadline = Instant::now() + PATIENCE;
    while !condition().await {
        assert!(Instant::now() < deadline, "timed out waiting for {what}");
        tokio::time::sleep(StdDuration::from_millis(20)).await;
    }
}

/// Wait until the scheduler finished at least one whole pass over the due
/// reminders after this call. Each due reminder reads permission first, so a
/// read after a second wake proves the pass the first wake ran was fully
/// handled.
async fn settle(scheduler: &ReminderScheduler, notifier: &Recording) {
    for _ in 0..2 {
        let seen = notifier.reads();
        assert!(scheduler.wake(), "the scheduler is running");
        eventually("a pass after a wake", || async { notifier.reads() > seen }).await;
    }
}

// ---------------------------------------------------------------------------
// Pure due rules
// ---------------------------------------------------------------------------

#[tokio::test]
async fn a_reminder_is_due_from_start_minus_lead_until_start_and_names_its_site() {
    let planning = Planning::new().await;
    let subscription = planning.subscribe(&planning.ngc, criteria(), 60).await;
    let set = windows_at(&planning.ngc, &planning.backyard, criteria(), NIGHT, 2);
    let window = first_window(&set, NIGHT);
    let due = due_at(&window, 60);

    assert!(due_reminders(&subscription, &set, due - Duration::seconds(1)).is_empty());
    let at_due = due_reminders(&subscription, &set, due);
    assert_eq!(at_due.iter().map(|reminder| reminder.window_key).collect::<Vec<_>>(), [window.key]);
    let reminder = &at_due[0];
    assert_eq!(
        (reminder.target_id, reminder.designation.as_str(), reminder.site_id),
        (planning.ngc.candidate.id, "NGC 7000", planning.backyard.id)
    );
    assert_eq!(
        (reminder.site_name.as_str(), reminder.time_zone.as_str()),
        ("Backyard", "Europe/Amsterdam")
    );
    assert_eq!(
        (reminder.due_at, reminder.start_utc, reminder.end_utc),
        (due, window.start_utc, window.end_utc)
    );
    assert_eq!((reminder.start_local, reminder.end_local), (window.start_local, window.end_local));
    assert_eq!((reminder.night, reminder.lead_minutes), (window.night, 60));
    assert!(!due_reminders(&subscription, &set, window.start_utc - Duration::seconds(1)).is_empty());
    assert!(due_reminders(&subscription, &set, window.start_utc).is_empty());

    // Upcoming lists every window that has not started, by due instant.
    let upcoming = upcoming_reminders(&subscription, &set, due - Duration::seconds(1));
    assert_eq!(upcoming.first().map(|reminder| reminder.window_key), Some(window.key));
    assert!(upcoming.windows(2).all(|pair| pair[0].due_at <= pair[1].due_at));
    assert_eq!(upcoming.len(), set.windows().filter(|w| w.start_utc >= window.start_utc).count());
    let started = upcoming_reminders(&subscription, &set, window.start_utc);
    assert!(started.iter().all(|reminder| reminder.window_key != window.key));
    assert!(started.iter().all(|reminder| reminder.start_utc > window.start_utc));

    // The notice names the Target, the site, the local start and end with the
    // zone, and the lead time.
    let text = notice(&subscription, &window, "NGC 7000");
    assert_eq!(text.window, window.key);
    assert_eq!(text.title, "NGC 7000 at Backyard");
    let local = |instant: OffsetDateTime| {
        format!(
            "{:04}-{:02}-{:02} {:02}:{:02}",
            instant.year(),
            u8::from(instant.month()),
            instant.day(),
            instant.hour(),
            instant.minute()
        )
    };
    for expected in [
        local(window.start_local),
        local(window.end_local),
        "Europe/Amsterdam".to_owned(),
        "+02:00".to_owned(),
        "60 minutes".to_owned(),
    ] {
        assert!(text.body.contains(&expected), "{expected:?} missing from {:?}", text.body);
    }
}

#[tokio::test]
async fn windows_at_the_second_site_never_become_upcoming_or_due() {
    let planning = Planning::new().await;
    let subscription = planning.subscribe(&planning.ngc, criteria(), 180).await;
    let athens = windows_at(&planning.ngc, &planning.athens, criteria(), NIGHT, 3);
    assert!(athens.windows().count() > 0, "the second site has windows to ignore");
    for window in athens.windows() {
        for now in [due_at(window, 180), window.start_utc - Duration::minutes(1)] {
            assert!(due_reminders(&subscription, &athens, now).is_empty());
            assert!(upcoming_reminders(&subscription, &athens, now).is_empty());
        }
    }
    // Windows computed with other criteria than the subscribed ones are not
    // this subscription's schedule either.
    let other = PlanCriteria { moon: MoonCriterion::None, ..criteria() };
    let backyard = windows_at(&planning.ngc, &planning.backyard, other, NIGHT, 1);
    let window = first_window(&backyard, NIGHT);
    assert!(due_reminders(&subscription, &backyard, due_at(&window, 180)).is_empty());
}

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn each_due_backyard_identity_is_claimed_then_submitted_exactly_once() {
    let planning = Planning::new().await;
    planning.subscribe(&planning.ngc, criteria(), 180).await;
    let backyard =
        first_window(&windows_at(&planning.ngc, &planning.backyard, criteria(), NIGHT, 1), NIGHT);
    let athens =
        first_window(&windows_at(&planning.ngc, &planning.athens, criteria(), NIGHT, 1), NIGHT);
    let now = due_at(&backyard, 180);
    // At this instant an Athens window would be due as well, had it been
    // scheduled (PLAN-AC-02).
    assert!(due_at(&athens, 180) <= now && now < athens.start_utc, "{now} {athens:?}");
    let operations = planning.operations().await;

    let notifier = Recording::new(PermissionState::Granted, Answer::Accept);
    notifier.observe(&planning.catalog);
    let scheduler = ReminderScheduler::spawn(
        Arc::clone(&planning.catalog),
        notifier.clone(),
        Controlled::at(now),
    );
    assert!(scheduler.is_running());
    eventually("one submission", || async { !notifier.submissions().is_empty() }).await;
    for _ in 0..3 {
        settle(&scheduler, &notifier).await;
    }
    scheduler.stop().await;

    let submissions = notifier.submissions();
    assert_eq!(submissions.len(), 1, "{submissions:?}");
    let submission = &submissions[0];
    assert_eq!(submission.notice.window, backyard.key);
    assert_eq!(submission.claimed_as, Some(DeliveryState::Sending), "claimed before submission");
    assert_eq!(submission.notice.title, "NGC 7000 at Backyard");
    assert!(submission.notice.body.contains("180 minutes"), "{}", submission.notice.body);

    let deliveries = planning.catalog.reminder_deliveries(0, 0).await.unwrap();
    assert_eq!(deliveries.len(), 1, "{deliveries:?}");
    let delivery = &deliveries[0];
    assert_eq!((delivery.window_key, delivery.site_id), (backyard.key, planning.backyard.id));
    assert_eq!((delivery.state, delivery.reason.as_deref()), (DeliveryState::Submitted, None));
    assert_eq!((delivery.due_at, delivery.window_end_utc), (now, backyard.end_utc));
    assert_eq!(delivery.night, backyard.night);
    // The scheduler started no scan, inventory or other Activity operation.
    assert_eq!(planning.operations().await, operations);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn restarting_inside_the_due_interval_submits_nothing_again() {
    let planning = Planning::new().await;
    planning.subscribe(&planning.ngc, criteria(), 60).await;
    let window =
        first_window(&windows_at(&planning.ngc, &planning.backyard, criteria(), NIGHT, 1), NIGHT);
    let clock = Controlled::at(due_at(&window, 60) + Duration::minutes(10));

    let first = Recording::new(PermissionState::Granted, Answer::Accept);
    let scheduler =
        ReminderScheduler::spawn(Arc::clone(&planning.catalog), first.clone(), clock.clone());
    eventually("one submission", || async { !first.submissions().is_empty() }).await;
    settle(&scheduler, &first).await;
    scheduler.stop().await;
    let planning = planning.reopen().await;

    clock.set(due_at(&window, 60) + Duration::minutes(20));
    let second = Recording::new(PermissionState::Granted, Answer::Accept);
    let scheduler = ReminderScheduler::spawn(Arc::clone(&planning.catalog), second.clone(), clock);
    settle(&scheduler, &second).await;
    scheduler.stop().await;

    assert_eq!(first.submissions().len(), 1);
    assert!(second.submissions().is_empty(), "{:?}", second.submissions());
    let states: Vec<_> = planning
        .catalog
        .reminder_deliveries(0, 0)
        .await
        .unwrap()
        .into_iter()
        .map(|delivery| (delivery.window_key, delivery.state))
        .collect();
    assert_eq!(states, [(window.key, DeliveryState::Submitted)]);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_interrupted_submission_becomes_uncertain_and_is_never_resubmitted() {
    let planning = Planning::new().await;
    planning.subscribe(&planning.ngc, criteria(), 60).await;
    let window =
        first_window(&windows_at(&planning.ngc, &planning.backyard, criteria(), NIGHT, 1), NIGHT);
    let clock = Controlled::at(due_at(&window, 60));

    let hanging = Recording::new(PermissionState::Granted, Answer::Hang);
    let scheduler =
        ReminderScheduler::spawn(Arc::clone(&planning.catalog), hanging.clone(), clock.clone());
    eventually("a submission in flight", || async { !hanging.submissions().is_empty() }).await;
    // Stop returns although the OS never answered; the identity stays taken.
    tokio::time::timeout(PATIENCE, scheduler.stop()).await.expect("stop is not held by the OS");
    let state = |planning: &Planning| {
        let catalog = Arc::clone(&planning.catalog);
        async move {
            catalog
                .reminder_deliveries(0, 0)
                .await
                .unwrap()
                .into_iter()
                .map(|d| d.state)
                .collect::<Vec<_>>()
        }
    };
    assert_eq!(state(&planning).await, [DeliveryState::Sending]);

    let planning = planning.reopen().await;
    assert_eq!(state(&planning).await, [DeliveryState::Uncertain]);
    let fresh = Recording::new(PermissionState::Granted, Answer::Accept);
    let scheduler = ReminderScheduler::spawn(Arc::clone(&planning.catalog), fresh.clone(), clock);
    settle(&scheduler, &fresh).await;
    scheduler.stop().await;
    assert!(fresh.submissions().is_empty(), "{:?}", fresh.submissions());
    assert_eq!(state(&planning).await, [DeliveryState::Uncertain]);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_failed_identity_is_recorded_and_never_retried() {
    let planning = Planning::new().await;
    planning.subscribe(&planning.ngc, criteria(), 60).await;
    let window =
        first_window(&windows_at(&planning.ngc, &planning.backyard, criteria(), NIGHT, 1), NIGHT);
    let refusing = Recording::new(PermissionState::Granted, Answer::Refuse);
    let scheduler = ReminderScheduler::spawn(
        Arc::clone(&planning.catalog),
        refusing.clone(),
        Controlled::at(due_at(&window, 60)),
    );
    eventually("one submission", || async { !refusing.submissions().is_empty() }).await;
    for _ in 0..3 {
        settle(&scheduler, &refusing).await;
    }
    scheduler.stop().await;
    assert_eq!(refusing.submissions().len(), 1);
    let deliveries = planning.catalog.reminder_deliveries(0, 0).await.unwrap();
    let recorded: Vec<_> =
        deliveries.iter().map(|d| (d.window_key, d.state, d.reason.as_deref())).collect();
    assert_eq!(recorded, [(window.key, DeliveryState::Failed, Some("request refused"))]);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn permission_denied_before_submission_blocks_the_subscription_and_submits_nothing() {
    let planning = Planning::new().await;
    let enabled = planning.subscribe(&planning.ngc, criteria(), 60).await;
    let window =
        first_window(&windows_at(&planning.ngc, &planning.backyard, criteria(), NIGHT, 1), NIGHT);
    let notifier = Recording::new(PermissionState::Granted, Answer::Accept);
    // The user turned notifications off after activation.
    notifier.set_permission(PermissionState::Denied);
    let scheduler = ReminderScheduler::spawn(
        Arc::clone(&planning.catalog),
        notifier.clone(),
        Controlled::at(due_at(&window, 60)),
    );
    let catalog = Arc::clone(&planning.catalog);
    let target = planning.ngc.candidate.id;
    eventually("the subscription to block", || {
        let catalog = Arc::clone(&catalog);
        async move {
            catalog.reminder_subscription(target).await.unwrap().unwrap().state
                == SubscriptionState::Blocked
        }
    })
    .await;
    // Nothing is enabled any more, so the task ends on its own, and a wake
    // reports that it ended.
    eventually("the scheduler to end", || async { !scheduler.is_running() }).await;
    assert!(!scheduler.wake());
    scheduler.stop().await;

    let blocked = planning.catalog.reminder_subscription(target).await.unwrap().unwrap();
    assert_eq!(blocked.block_reason, Some(BlockReason::PermissionDenied));
    assert_eq!(blocked.actions, [RecoveryAction::Settings, RecoveryAction::Retry]);
    assert_eq!(blocked.revision, enabled.revision + 1);
    assert_eq!((blocked.criteria, blocked.lead_minutes), (enabled.criteria, 60));
    assert!(notifier.submissions().is_empty(), "{:?}", notifier.submissions());
    assert!(planning.catalog.reminder_deliveries(0, 0).await.unwrap().is_empty());
}

/// System sleep stalls monotonic timers while the wall clock moves on. The
/// scheduler re-reads the wall clock at least every 30 s, so a reminder whose
/// due instant passed during the stall is submitted at the next re-check while
/// its window has not started, and a window that started meanwhile never is.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_wall_clock_jump_is_caught_within_one_recheck_and_never_after_window_start() {
    let planning = Planning::new().await;
    let pleiades = planning.save_target("M 45", 56.75, 24.12).await;
    let open_sky = PlanCriteria { moon: MoonCriterion::None, ..criteria() };
    // NGC 7000 first, so its reminders are handled before the Pleiades' ones
    // in every pass.
    planning.subscribe(&planning.ngc, criteria(), 60).await;
    let ngc =
        first_window(&windows_at(&planning.ngc, &planning.backyard, criteria(), NIGHT, 1), NIGHT);
    let jump = ngc.start_utc + Duration::minutes(15);
    let later = windows_at(&pleiades, &planning.backyard, open_sky, NIGHT, 1);
    let rising = later.windows().find(|w| w.start_utc > jump).cloned().expect("a later window");
    let lead =
        u32::try_from((rising.start_utc - (ngc.start_utc + Duration::minutes(5))).whole_minutes())
            .unwrap();
    assert!((1..=1440).contains(&lead), "{lead}");
    planning.subscribe(&pleiades, open_sky, lead).await;
    assert!(due_at(&rising, lead) <= jump && jump < rising.start_utc);

    // Every due instant is an hour away, so the scheduler sleeps for 30 s.
    let clock = Controlled::at(due_at(&ngc, 60) - Duration::hours(1));
    let notifier = Recording::new(PermissionState::Granted, Answer::Accept);
    let scheduler =
        ReminderScheduler::spawn(Arc::clone(&planning.catalog), notifier.clone(), clock.clone());
    tokio::time::sleep(StdDuration::from_secs(1)).await;
    assert!(notifier.submissions().is_empty());

    // The wall clock moves past the NGC 7000 window start with no tick or wake.
    clock.set(jump);
    let jumped = Instant::now();
    let deadline = jumped + StdDuration::from_secs(35);
    while notifier.submissions().is_empty() {
        assert!(Instant::now() < deadline, "no re-check within 30 s of the jump");
        tokio::time::sleep(StdDuration::from_millis(100)).await;
    }
    assert!(jumped.elapsed() <= StdDuration::from_secs(32), "{:?}", jumped.elapsed());
    settle(&scheduler, &notifier).await;
    scheduler.stop().await;

    let keys: Vec<WindowKey> = notifier.submissions().iter().map(|s| s.notice.window).collect();
    assert_eq!(keys, [rising.key], "the started NGC 7000 window is never reminded");
    let deliveries = planning.catalog.reminder_deliveries(0, 0).await.unwrap();
    assert!(deliveries.iter().all(|d| d.target_id == pleiades.candidate.id), "{deliveries:?}");
}
