// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! In-app reminders (spec 072): the pure due and upcoming rules over computed
//! windows, and the scheduler that runs only while a subscription is enabled.
//! It claims each Target, site and window-start identity durably before it
//! submits a notification, so no identity is ever sent twice, and it never
//! starts a scan, inventory or image operation.
//!
//! A reminder is due from window start minus the lead time until window start,
//! and never after start (research R16). Only an `enabled` subscription has a
//! schedule, and only for windows computed at its subscribed site, site
//! revision and criteria: windows at any other site never become upcoming or
//! due (PLAN-AC-02).
//!
//! Per due window the scheduler reads permission first. A permission that is
//! not granted blocks the subscription with its reason and takes no identity.
//! It then commits the identity as `sending`; an identity that already exists,
//! in any state, suppresses the reminder (R15). Only then does it submit, and
//! it records `submitted` or `failed`. An identity whose outcome was never
//! recorded, because the process stopped or the record failed, stays `sending`
//! and reads `uncertain` after the next catalog open; it is never resubmitted.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration as StdDuration;

use persistence_library::{Catalog, DeliveryClaim, DeliveryOutcome};
use time::{Duration, OffsetDateTime};
use tokio::sync::{watch, Notify};
use tokio::task::JoinHandle;

use crate::notifier::{Clock, Notifier, ReminderNotice, SubmitOutcome};
use crate::planning::{compute_windows, night_of};
use crate::{
    LibraryError, ObservingSite, ObservingWindow, PlanCriteria, ReminderInput,
    ReminderSubscription, Revision, SubscriptionState, UpcomingReminder, WindowQuery, WindowSet,
};
use uuid::Uuid;

/// The longest the scheduler goes without re-reading the wall clock, so it
/// catches up after system sleep stalls monotonic timers (R16).
pub const RECHECK_INTERVAL: StdDuration = StdDuration::from_secs(30);

/// Nights scheduled per subscription: the night before the current
/// site-local night through two nights after it (R16).
const SCHEDULED_NIGHTS: u32 = 4;

/// The reminders due at `now`: windows of the subscription's schedule whose
/// start minus the lead time is at or before `now` and whose start is after it.
#[must_use]
pub fn due_reminders(
    subscription: &ReminderSubscription,
    windows: &WindowSet,
    now: OffsetDateTime,
) -> Vec<UpcomingReminder> {
    Schedule::of(subscription).map_or_else(Vec::new, |schedule| {
        schedule.due(windows, now).map(|window| schedule.reminder(windows, window)).collect()
    })
}

/// Every reminder of the subscription's schedule whose window has not started
/// at `now`, due ones included, by due instant.
#[must_use]
pub fn upcoming_reminders(
    subscription: &ReminderSubscription,
    windows: &WindowSet,
    now: OffsetDateTime,
) -> Vec<UpcomingReminder> {
    Schedule::of(subscription).map_or_else(Vec::new, |schedule| schedule.upcoming(windows, now))
}

/// The reminders a reviewed activation at `site` would produce, by due
/// instant, under the same rules as an enabled subscription.
#[must_use]
pub fn prospective_reminders(
    input: &ReminderInput,
    site: &ObservingSite,
    windows: &WindowSet,
    now: OffsetDateTime,
) -> Vec<UpcomingReminder> {
    Schedule {
        target_id: input.target_id,
        site_id: site.id,
        site_revision: site.revision,
        criteria: &input.criteria,
        lead_minutes: input.lead_minutes,
    }
    .upcoming(windows, now)
}

/// The window request a schedule at `site` covers at `now`: the night before
/// the current site-local night through two nights after it.
///
/// # Errors
/// `InvalidInput` when the site's zone is not bundled or no earlier night
/// exists.
pub fn schedule_query(
    target_id: Uuid,
    site: &ObservingSite,
    criteria: PlanCriteria,
    now: OffsetDateTime,
) -> Result<WindowQuery, LibraryError> {
    let first_night = night_of(now, site)?.previous_day().ok_or_else(|| {
        LibraryError::InvalidInput(format!("no night before {now} at site {}", site.id))
    })?;
    Ok(WindowQuery { target_id, site_id: site.id, first_night, nights: SCHEDULED_NIGHTS, criteria })
}

/// The notification for one window: the Target at the site, the local start
/// and end with their offsets, the zone and the lead time (R19).
#[must_use]
pub fn notice(
    subscription: &ReminderSubscription,
    window: &ObservingWindow,
    designation: &str,
) -> ReminderNotice {
    let unit = if subscription.lead_minutes == 1 { "minute" } else { "minutes" };
    ReminderNotice {
        window: window.key,
        title: format!("{designation} at {}", window.site_name),
        body: format!(
            "Observing window {} to {}, {}. Reminder {} {unit} before the start.",
            local_text(window.start_local),
            local_text(window.end_local),
            window.time_zone,
            subscription.lead_minutes,
        ),
    }
}

/// The values a schedule is computed from.
struct Schedule<'a> {
    target_id: Uuid,
    site_id: Uuid,
    site_revision: Revision,
    criteria: &'a PlanCriteria,
    lead_minutes: u32,
}

impl<'a> Schedule<'a> {
    /// The schedule of an enabled subscription; every other state has none.
    fn of(subscription: &'a ReminderSubscription) -> Option<Self> {
        (subscription.state == SubscriptionState::Enabled).then_some(Self {
            target_id: subscription.target_id,
            site_id: subscription.site_id,
            site_revision: subscription.site_revision,
            criteria: &subscription.criteria,
            lead_minutes: subscription.lead_minutes,
        })
    }

    /// Whether `windows` were computed for this Target at this site, site
    /// revision and criteria.
    fn covers(&self, windows: &WindowSet) -> bool {
        let basis = &windows.basis;
        windows.unavailable_reason.is_none()
            && basis.target_id == self.target_id
            && basis.site.id == self.site_id
            && basis.site.revision == self.site_revision
            && basis.criteria == *self.criteria
    }

    fn lead(&self) -> Duration {
        Duration::minutes(i64::from(self.lead_minutes))
    }

    fn due<'w>(
        &self,
        windows: &'w WindowSet,
        now: OffsetDateTime,
    ) -> impl Iterator<Item = &'w ObservingWindow> + 'w {
        let lead = self.lead();
        let covered = self.covers(windows);
        windows.windows().filter(move |window| {
            covered && window.start_utc - lead <= now && now < window.start_utc
        })
    }

    fn upcoming(&self, windows: &WindowSet, now: OffsetDateTime) -> Vec<UpcomingReminder> {
        if !self.covers(windows) {
            return Vec::new();
        }
        let mut upcoming: Vec<_> = windows
            .windows()
            .filter(|window| now < window.start_utc)
            .map(|window| self.reminder(windows, window))
            .collect();
        upcoming.sort_by_key(|reminder| (reminder.due_at, reminder.window_key));
        upcoming
    }

    fn reminder(&self, windows: &WindowSet, window: &ObservingWindow) -> UpcomingReminder {
        UpcomingReminder {
            target_id: self.target_id,
            designation: windows.basis.designation.clone(),
            site_id: self.site_id,
            site_name: window.site_name.clone(),
            window_key: window.key,
            due_at: window.start_utc - self.lead(),
            start_utc: window.start_utc,
            end_utc: window.end_utc,
            start_local: window.start_local,
            end_local: window.end_local,
            time_zone: window.time_zone.clone(),
            night: window.night,
            lead_minutes: self.lead_minutes,
        }
    }
}

/// `2026-10-21 20:14 (+02:00)`: a local time with its offset.
fn local_text(instant: OffsetDateTime) -> String {
    let offset = instant.offset();
    let sign = if offset.is_negative() { '-' } else { '+' };
    format!(
        "{:04}-{:02}-{:02} {:02}:{:02} ({sign}{:02}:{:02})",
        instant.year(),
        u8::from(instant.month()),
        instant.day(),
        instant.hour(),
        instant.minute(),
        offset.whole_hours().unsigned_abs(),
        offset.minutes_past_hour().unsigned_abs(),
    )
}

/// [`ReminderScheduler`] lifecycle word: this bit is set once the task ended
/// on its own; the bits above it count wakes.
const ENDED: u64 = 1;
/// One wake in the lifecycle word.
const WAKE: u64 = 2;

/// The in-app scheduler task. It holds only planning catalog operations, the
/// notifier and the clock, so it cannot start a scan or image work (R17).
/// Dropping it without [`ReminderScheduler::stop`] stops the task as well.
///
/// The task ends on its own when a pass finds no enabled subscription, as
/// after it blocked the last one (R17). It ends only if no wake arrived since
/// that pass read the subscriptions, and a wake counts only before it ended,
/// so a subscription enabled during that last pass either keeps the task
/// going or makes [`wake`](Self::wake) report the end.
pub struct ReminderScheduler {
    wake: Arc<Notify>,
    lifecycle: Arc<AtomicU64>,
    stop: watch::Sender<bool>,
    task: JoinHandle<()>,
}

impl ReminderScheduler {
    /// Start the scheduler on the current Tokio runtime. Its first pass runs
    /// immediately; later passes follow the next due instant, a
    /// [`wake`](Self::wake), or [`RECHECK_INTERVAL`], whichever comes first.
    #[must_use]
    pub fn spawn(
        catalog: Arc<Catalog>,
        notifier: Arc<dyn Notifier>,
        clock: Arc<dyn Clock>,
    ) -> Self {
        let wake = Arc::new(Notify::new());
        let lifecycle = Arc::new(AtomicU64::new(0));
        let (stop, stopped) = watch::channel(false);
        let run = Run {
            catalog,
            notifier,
            clock,
            wake: Arc::clone(&wake),
            lifecycle: Arc::clone(&lifecycle),
        };
        let task = tokio::spawn(run.until_stopped(stopped));
        Self { wake, lifecycle, stop, task }
    }

    /// Run a pass now: a subscription, site or permission changed. A wake
    /// during a pass runs another pass right after it. False once the task
    /// has ended, on its own or by a panic; only a new scheduler runs passes
    /// then.
    #[must_use]
    pub fn wake(&self) -> bool {
        let counted = self
            .lifecycle
            .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |state| {
                (state & ENDED == 0).then(|| state.wrapping_add(WAKE))
            })
            .is_ok();
        self.wake.notify_one();
        counted && !self.task.is_finished()
    }

    /// Whether the task is still running: it has not ended on its own, been
    /// stopped or panicked.
    #[must_use]
    pub fn is_running(&self) -> bool {
        self.lifecycle.load(Ordering::SeqCst) & ENDED == 0 && !self.task.is_finished()
    }

    /// Stop the task and wait for it. A catalog write in progress completes; a
    /// submission the OS has not answered is abandoned, and its identity stays
    /// taken.
    pub async fn stop(self) {
        self.stop.send_replace(true);
        if let Err(error) = self.task.await {
            if error.is_panic() {
                std::panic::resume_unwind(error.into_panic());
            }
        }
    }
}

/// A subscription's windows around the current site-local night, at its
/// subscribed site with its criteria, computed off the async workers.
///
/// # Errors
/// `NotFound` for a Target or site that no longer exists; `InvalidInput` for an
/// unbundled zone; `PersistenceFailure` when the catalog cannot be read.
pub async fn scheduled_windows(
    catalog: &Catalog,
    subscription: &ReminderSubscription,
    now: OffsetDateTime,
) -> Result<WindowSet, LibraryError> {
    let target = catalog.target(subscription.target_id).await?;
    let site = catalog.site(subscription.site_id).await?;
    let query = schedule_query(subscription.target_id, &site, subscription.criteria, now)?;
    tokio::task::spawn_blocking(move || compute_windows(&target, &site, &query)).await.map_err(
        |error| LibraryError::SourceUnavailable(format!("reminder schedule interrupted: {error}")),
    )?
}

/// Resolves once a stop was requested or the scheduler handle was dropped.
async fn stopped(stop: &mut watch::Receiver<bool>) {
    // An error means the sender is gone, which is a stop as well.
    let _ = stop.wait_for(|stop| *stop).await;
}

/// A stop arrived while waiting on the notifier.
struct Stopped;

/// What a pass found.
enum Pass {
    /// No subscription is enabled.
    Idle,
    /// The pass blocked a subscription; the next one runs at once, so the
    /// task ends promptly when nothing stays enabled.
    Blocked,
    /// Wait for this due instant, a wake or [`RECHECK_INTERVAL`].
    Wait(Option<OffsetDateTime>),
}

struct Run {
    catalog: Arc<Catalog>,
    notifier: Arc<dyn Notifier>,
    clock: Arc<dyn Clock>,
    wake: Arc<Notify>,
    lifecycle: Arc<AtomicU64>,
}

impl Run {
    async fn until_stopped(self, mut stop: watch::Receiver<bool>) {
        loop {
            // Read before the pass reads the subscriptions.
            let seen = self.lifecycle.load(Ordering::SeqCst);
            let next_due = match self.pass(&mut stop).await {
                Err(Stopped) => return,
                Ok(Pass::Wait(next_due)) => next_due,
                Ok(Pass::Blocked) => continue,
                // A wake since `seen` may follow a newly enabled subscription,
                // so the task ends only without one, and looks again after one.
                Ok(Pass::Idle) => {
                    let ended = seen | ENDED;
                    if self
                        .lifecycle
                        .compare_exchange(seen, ended, Ordering::SeqCst, Ordering::SeqCst)
                        .is_ok()
                    {
                        return;
                    }
                    continue;
                }
            };
            let delay = next_due
                .and_then(|due| StdDuration::try_from(due - self.clock.now_utc()).ok())
                .map_or(RECHECK_INTERVAL, |until| until.min(RECHECK_INTERVAL));
            tokio::select! {
                () = tokio::time::sleep(delay) => {}
                () = self.wake.notified() => {}
                () = stopped(&mut stop) => return,
            }
        }
    }

    /// Remind every due window of every enabled subscription, and return the
    /// next due instant still ahead. A subscription whose Target, site or
    /// windows cannot be read, or a pass whose subscriptions cannot be read,
    /// is retried at the next pass.
    async fn pass(&self, stop: &mut watch::Receiver<bool>) -> Result<Pass, Stopped> {
        let Ok(subscriptions) =
            self.catalog.reminder_subscriptions(Some(SubscriptionState::Enabled)).await
        else {
            return Ok(Pass::Wait(None));
        };
        if subscriptions.is_empty() {
            return Ok(Pass::Idle);
        }
        let mut next_due: Option<OffsetDateTime> = None;
        let mut blocked = false;
        for subscription in subscriptions {
            if *stop.borrow() {
                return Err(Stopped);
            }
            let now = self.clock.now_utc();
            let Ok(windows) = scheduled_windows(&self.catalog, &subscription, now).await else {
                continue;
            };
            blocked |= self.remind(&subscription, &windows, now, stop).await?;
            let now = self.clock.now_utc();
            let ahead = upcoming_reminders(&subscription, &windows, now)
                .into_iter()
                .map(|reminder| reminder.due_at)
                .find(|due| *due > now);
            next_due = next_due.into_iter().chain(ahead).min();
        }
        Ok(if blocked { Pass::Blocked } else { Pass::Wait(next_due) })
    }

    /// Permission, claim, submission and outcome for each due window, in that
    /// order. True when a permission that is not granted blocked the
    /// subscription.
    async fn remind(
        &self,
        subscription: &ReminderSubscription,
        windows: &WindowSet,
        now: OffsetDateTime,
        stop: &mut watch::Receiver<bool>,
    ) -> Result<bool, Stopped> {
        let Some(schedule) = Schedule::of(subscription) else {
            return Ok(false);
        };
        for window in schedule.due(windows, now) {
            let permission = tokio::select! {
                permission = self.notifier.permission() => permission,
                () = stopped(stop) => return Err(Stopped),
            };
            if let Some(reason) = permission.block_reason() {
                // Blocked at the revision this pass read; a concurrent change
                // to the subscription wins, and it schedules again only if it
                // stays enabled.
                let blocked = self
                    .catalog
                    .set_subscription_state(
                        subscription.target_id,
                        subscription.revision,
                        SubscriptionState::Blocked,
                        Some(reason),
                    )
                    .await
                    .is_ok();
                return Ok(blocked);
            }
            // Never after window start, even when this pass ran long.
            if self.clock.now_utc() >= window.start_utc {
                continue;
            }
            let claim = DeliveryClaim {
                key: window.key,
                window_end_utc: window.end_utc,
                night: window.night,
                due_at: window.start_utc - schedule.lead(),
            };
            // False: the identity was taken before, or the subscription is no
            // longer enabled at this site. A failed claim is retried next pass.
            if !matches!(self.catalog.claim_reminder_delivery(&claim).await, Ok(true)) {
                continue;
            }
            let notice = notice(subscription, window, &windows.basis.designation);
            let outcome = tokio::select! {
                outcome = self.notifier.submit(&notice) => outcome,
                () = stopped(stop) => return Err(Stopped),
            };
            let outcome = match outcome {
                SubmitOutcome::Submitted => DeliveryOutcome::Submitted,
                SubmitOutcome::Failed { reason } => DeliveryOutcome::Failed { reason },
            };
            // A record that fails leaves the identity `sending`: never resent,
            // and `uncertain` after the next catalog open.
            let _ = self.catalog.finish_reminder_delivery(&window.key, &outcome).await;
        }
        Ok(false)
    }
}
