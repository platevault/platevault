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

use std::sync::Arc;
use std::time::Duration as StdDuration;

use persistence_library::{Catalog, DeliveryClaim, DeliveryOutcome};
use time::{Duration, OffsetDateTime};
use tokio::sync::{watch, Notify};
use tokio::task::JoinHandle;

use crate::notifier::{Clock, Notifier, ReminderNotice, SubmitOutcome};
use crate::planning::{compute_windows, night_of};
use crate::{
    LibraryError, ObservingWindow, ReminderSubscription, SubscriptionState, UpcomingReminder,
    WindowQuery, WindowSet,
};

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
    due_windows(subscription, windows, now)
        .map(|window| reminder(subscription, windows, window))
        .collect()
}

/// Every reminder of the subscription's schedule whose window has not started
/// at `now`, due ones included, by due instant.
#[must_use]
pub fn upcoming_reminders(
    subscription: &ReminderSubscription,
    windows: &WindowSet,
    now: OffsetDateTime,
) -> Vec<UpcomingReminder> {
    if !schedules(subscription, windows) {
        return Vec::new();
    }
    let mut upcoming: Vec<_> = windows
        .windows()
        .filter(|window| now < window.start_utc)
        .map(|window| reminder(subscription, windows, window))
        .collect();
    upcoming.sort_by_key(|reminder| (reminder.due_at, reminder.window_key));
    upcoming
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

/// Whether `windows` are this subscription's schedule: it is enabled, and the
/// windows were computed for its Target at its site, site revision and criteria.
fn schedules(subscription: &ReminderSubscription, windows: &WindowSet) -> bool {
    let basis = &windows.basis;
    subscription.state == SubscriptionState::Enabled
        && windows.unavailable_reason.is_none()
        && basis.target_id == subscription.target_id
        && basis.site.id == subscription.site_id
        && basis.site.revision == subscription.site_revision
        && basis.criteria == subscription.criteria
}

fn lead(subscription: &ReminderSubscription) -> Duration {
    Duration::minutes(i64::from(subscription.lead_minutes))
}

fn due_windows<'a>(
    subscription: &'a ReminderSubscription,
    windows: &'a WindowSet,
    now: OffsetDateTime,
) -> impl Iterator<Item = &'a ObservingWindow> + 'a {
    let lead = lead(subscription);
    let scheduled = schedules(subscription, windows);
    windows
        .windows()
        .filter(move |window| scheduled && window.start_utc - lead <= now && now < window.start_utc)
}

fn reminder(
    subscription: &ReminderSubscription,
    windows: &WindowSet,
    window: &ObservingWindow,
) -> UpcomingReminder {
    UpcomingReminder {
        target_id: subscription.target_id,
        designation: windows.basis.designation.clone(),
        site_id: subscription.site_id,
        site_name: window.site_name.clone(),
        window_key: window.key,
        due_at: window.start_utc - lead(subscription),
        start_utc: window.start_utc,
        end_utc: window.end_utc,
        start_local: window.start_local,
        end_local: window.end_local,
        time_zone: window.time_zone.clone(),
        night: window.night,
        lead_minutes: subscription.lead_minutes,
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

/// The in-app scheduler task. It holds only planning catalog operations, the
/// notifier and the clock, so it cannot start a scan or image work (R17).
/// Dropping it without [`ReminderScheduler::stop`] stops the task as well.
pub struct ReminderScheduler {
    wake: Arc<Notify>,
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
        let (stop, stopped) = watch::channel(false);
        let run = Run { catalog, notifier, clock, wake: Arc::clone(&wake) };
        let task = tokio::spawn(run.until_stopped(stopped));
        Self { wake, stop, task }
    }

    /// Run a pass now: a subscription, site or permission changed. A wake
    /// during a pass runs another pass right after it.
    pub fn wake(&self) {
        self.wake.notify_one();
    }

    /// Whether the task is still running.
    #[must_use]
    pub fn is_running(&self) -> bool {
        !self.task.is_finished()
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

/// Resolves once a stop was requested or the scheduler handle was dropped.
async fn stopped(stop: &mut watch::Receiver<bool>) {
    // An error means the sender is gone, which is a stop as well.
    let _ = stop.wait_for(|stop| *stop).await;
}

/// A stop arrived while waiting on the notifier.
struct Stopped;

struct Run {
    catalog: Arc<Catalog>,
    notifier: Arc<dyn Notifier>,
    clock: Arc<dyn Clock>,
    wake: Arc<Notify>,
}

impl Run {
    async fn until_stopped(self, mut stop: watch::Receiver<bool>) {
        loop {
            let Ok(next_due) = self.pass(&mut stop).await else {
                return;
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
    /// windows cannot be read is retried at the next pass.
    async fn pass(
        &self,
        stop: &mut watch::Receiver<bool>,
    ) -> Result<Option<OffsetDateTime>, Stopped> {
        let Ok(subscriptions) =
            self.catalog.reminder_subscriptions(Some(SubscriptionState::Enabled)).await
        else {
            return Ok(None);
        };
        let mut next_due: Option<OffsetDateTime> = None;
        for subscription in subscriptions {
            if *stop.borrow() {
                return Err(Stopped);
            }
            let now = self.clock.now_utc();
            let Ok(windows) = self.schedule(&subscription, now).await else {
                continue;
            };
            self.remind(&subscription, &windows, now, stop).await?;
            let now = self.clock.now_utc();
            let ahead = upcoming_reminders(&subscription, &windows, now)
                .into_iter()
                .map(|reminder| reminder.due_at)
                .find(|due| *due > now);
            next_due = next_due.into_iter().chain(ahead).min();
        }
        Ok(next_due)
    }

    /// The subscription's windows around the current site-local night.
    async fn schedule(
        &self,
        subscription: &ReminderSubscription,
        now: OffsetDateTime,
    ) -> Result<WindowSet, LibraryError> {
        let target = self.catalog.target(subscription.target_id).await?;
        let site = self.catalog.site(subscription.site_id).await?;
        let first_night = night_of(now, &site)?.previous_day().ok_or_else(|| {
            LibraryError::InvalidInput(format!("no night before {now} at site {}", site.id))
        })?;
        let query = WindowQuery {
            target_id: subscription.target_id,
            site_id: subscription.site_id,
            first_night,
            nights: SCHEDULED_NIGHTS,
            criteria: subscription.criteria,
        };
        tokio::task::spawn_blocking(move || compute_windows(&target, &site, &query)).await.map_err(
            |error| {
                LibraryError::SourceUnavailable(format!("reminder schedule interrupted: {error}"))
            },
        )?
    }

    /// Permission, claim, submission and outcome for each due window, in that
    /// order.
    async fn remind(
        &self,
        subscription: &ReminderSubscription,
        windows: &WindowSet,
        now: OffsetDateTime,
        stop: &mut watch::Receiver<bool>,
    ) -> Result<(), Stopped> {
        for window in due_windows(subscription, windows, now) {
            let permission = tokio::select! {
                permission = self.notifier.permission() => permission,
                () = stopped(stop) => return Err(Stopped),
            };
            if let Some(reason) = permission.block_reason() {
                // Blocked at the revision this pass read; a concurrent change
                // to the subscription wins, and it schedules again only if it
                // stays enabled.
                let _ = self
                    .catalog
                    .set_subscription_state(
                        subscription.target_id,
                        subscription.revision,
                        SubscriptionState::Blocked,
                        Some(reason),
                    )
                    .await;
                return Ok(());
            }
            // Never after window start, even when this pass ran long.
            if self.clock.now_utc() >= window.start_utc {
                continue;
            }
            let claim = DeliveryClaim {
                key: window.key,
                window_end_utc: window.end_utc,
                night: window.night,
                due_at: window.start_utc - lead(subscription),
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
        Ok(())
    }
}
