// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Observing plans (spec 072) on the [`Library`] facade: saved sites and the
//! default site, read-only windows and night sky, reminder review and
//! activation with the scheduler lifecycle, and calendar export. No planning
//! call reads or writes an image file or starts a scan.

use std::path::PathBuf;
use std::sync::Arc;

use persistence_library::{Catalog, SubscriptionWrite};
use time::{Date, OffsetDateTime};
use uuid::Uuid;

use crate::library::{blocking, Library};
use crate::notifier::{Clock, Notifier, SystemClock};
use crate::reminders::{self, ReminderScheduler};
use crate::{
    calendar, planning, AppClosedDelivery, CalendarExportOutcome, CalendarExportReview,
    CalendarFile, CalendarSnapshot, Darkness, DefaultSiteSaved, EnableReminders, ExportSelection,
    LibraryError, NativePath, NightSky, ObservingSite, ObservingWindow, PermissionState,
    PlanningSites, ReminderInput, ReminderReview, ReminderStatus, ReminderSubscription, Revision,
    SiteInput, SiteSaved, SubscriptionState, UnavailableReason, WindowQuery, WindowSet,
};

/// The planning runtime: the attached notification adapter, the wall clock,
/// and the reminder scheduler, which exists only while a notifier is attached
/// and at least one subscription is enabled (R17). A scheduler that ended on
/// its own, because a pass found nothing enabled, is replaced at the next sync
/// that finds a subscription enabled.
pub(crate) struct PlanningRuntime {
    catalog: Arc<Catalog>,
    notifier: Option<Arc<dyn Notifier>>,
    clock: Arc<dyn Clock>,
    scheduler: Option<ReminderScheduler>,
}

impl PlanningRuntime {
    /// No notifier, the system clock and no scheduler.
    pub(crate) fn new(catalog: Arc<Catalog>) -> Self {
        Self { catalog, notifier: None, clock: Arc::new(SystemClock), scheduler: None }
    }

    /// Run, wake or stop the scheduler so it runs exactly while `enabled`.
    async fn sync(&mut self, enabled: bool) {
        match self.scheduler.take() {
            Some(scheduler) if enabled && scheduler.wake() => {
                self.scheduler = Some(scheduler);
            }
            Some(scheduler) => {
                scheduler.stop().await;
                if enabled {
                    self.start();
                }
            }
            None if enabled => self.start(),
            None => {}
        }
    }

    fn start(&mut self) {
        if let Some(notifier) = &self.notifier {
            self.scheduler = Some(ReminderScheduler::spawn(
                Arc::clone(&self.catalog),
                Arc::clone(notifier),
                Arc::clone(&self.clock),
            ));
        }
    }
}

/// A reviewed calendar snapshot rendered for one export. Only
/// [`Library::prepare_calendar_export`] makes one, after the snapshot matched
/// its reviewed digest; [`Library::write_calendar_export`] writes it once.
#[derive(Debug)]
pub struct PreparedCalendar {
    review: CalendarExportReview,
    bytes: Vec<u8>,
}

impl PreparedCalendar {
    #[must_use]
    pub const fn review(&self) -> &CalendarExportReview {
        &self.review
    }

    /// The file name the save dialog proposes.
    #[must_use]
    pub fn suggested_file_name(&self) -> &str {
        &self.review.suggested_file_name
    }
}

impl Library {
    /// Attach the OS notification adapter and the wall clock, replacing any
    /// earlier ones, and start the scheduler only when a persisted
    /// subscription is enabled.
    ///
    /// # Errors
    /// `PersistenceFailure` when the subscriptions cannot be read; the
    /// notifier stays attached and the next planning write starts the
    /// scheduler.
    pub async fn attach_notifier(
        &self,
        notifier: Arc<dyn Notifier>,
        clock: Arc<dyn Clock>,
    ) -> Result<(), LibraryError> {
        let mut runtime = self.planning.lock().await;
        if let Some(scheduler) = runtime.scheduler.take() {
            scheduler.stop().await;
        }
        runtime.notifier = Some(notifier);
        runtime.clock = clock;
        let enabled = self.any_enabled().await?;
        runtime.sync(enabled).await;
        drop(runtime);
        Ok(())
    }

    /// Create or edit a saved site. The zone must be in the bundled database.
    /// An edit moves the site's subscriptions to `needs_reconfirmation` and
    /// names them; the scheduler follows.
    ///
    /// # Errors
    /// `InvalidInput` for invalid fields or an unknown zone, before anything is
    /// written; otherwise see [`Catalog::save_site`].
    pub async fn save_site(
        &self,
        id: Option<Uuid>,
        expected: Option<Revision>,
        input: &SiteInput,
    ) -> Result<SiteSaved, LibraryError> {
        input.validate()?;
        planning::validate_time_zone(&input.time_zone)?;
        let saved = self.catalog().save_site(id, expected, input).await?;
        self.sync_reminders().await;
        Ok(saved)
    }

    /// Set or clear the default site; subscriptions on another site, or every
    /// subscription when it is cleared, need reconfirmation.
    ///
    /// # Errors
    /// See [`Catalog::set_default_site`].
    pub async fn set_default_site(
        &self,
        site: Option<Uuid>,
        expected: Revision,
    ) -> Result<DefaultSiteSaved, LibraryError> {
        let saved = self.catalog().set_default_site(site, expected).await?;
        self.sync_reminders().await;
        Ok(saved)
    }

    /// Observing windows of a saved Target at a saved site, computed off the
    /// async workers. Read-only: it writes nothing and starts nothing.
    ///
    /// # Errors
    /// `InvalidInput` for an invalid query; `NotFound` for an unknown Target or
    /// site.
    pub async fn compute_windows(&self, query: &WindowQuery) -> Result<WindowSet, LibraryError> {
        query.validate()?;
        let target = self.catalog().target(query.target_id).await?;
        let site = self.catalog().site(query.site_id).await?;
        let query = query.clone();
        blocking(move || planning::compute_windows(&target, &site, &query)).await
    }

    /// The Moon and the darkness window of one night at a saved site, the
    /// darkness at `level`. Read-only: it writes nothing and starts nothing.
    ///
    /// # Errors
    /// `NotFound` for an unknown site; `InvalidInput` for an unbundled zone,
    /// an invalid site position or a night outside the supported calendar.
    pub async fn night_sky(
        &self,
        site: Uuid,
        night: Date,
        level: Darkness,
    ) -> Result<NightSky, LibraryError> {
        let site = self.catalog().site(site).await?;
        blocking(move || planning::night_sky(&site, night, level)).await
    }

    /// Review reminder activation for a Target against the current default
    /// site: its revision and zone, the criteria, the lead time, the settings
    /// revision, the permission, app-closed delivery and the reminders these
    /// values would produce. Writes nothing.
    ///
    /// # Errors
    /// `InvalidInput` for invalid criteria or lead time, or naming
    /// `defaultSite` when none is set; `NotFound` for an unknown Target.
    pub async fn review_reminders(
        &self,
        input: &ReminderInput,
    ) -> Result<ReminderReview, LibraryError> {
        input.validate()?;
        let target = self.catalog().target(input.target_id).await?;
        let sites = self.catalog().list_sites().await?;
        let site = default_site(&sites)?;
        let subscription = self.catalog().reminder_subscription(input.target_id).await?;
        let permission = self.permission().await;
        let now = self.now().await;
        let designation = target.candidate.designation.clone();
        let query = reminders::schedule_query(input.target_id, &site, input.criteria, now)?;
        let windows = {
            let site = site.clone();
            blocking(move || planning::compute_windows(&target, &site, &query)).await?
        };
        Ok(ReminderReview {
            target_id: input.target_id,
            designation,
            site: site.basis(),
            time_zone: site.time_zone.clone(),
            settings_revision: sites.settings_revision,
            criteria: input.criteria,
            lead_minutes: input.lead_minutes,
            permission,
            app_closed_delivery: AppClosedDelivery::UNAVAILABLE,
            subscription_revision: subscription.map(|subscription| subscription.revision),
            upcoming: reminders::prospective_reminders(input, &site, &windows, now),
        })
    }

    /// Activate reminders with the reviewed values. A permission that was
    /// never decided is requested first; the subscription then commits as
    /// `enabled`, or `blocked` with the reason. Starts or wakes the scheduler,
    /// and never a scan.
    ///
    /// # Errors
    /// `InvalidInput` for invalid criteria or lead time, or naming
    /// `defaultSite` when none is set, before the OS is asked anything;
    /// `Conflict` when the site is not the default or a reviewed revision
    /// moved; see [`Catalog::put_reminder_subscription`]. Nothing is stored on
    /// failure.
    pub async fn enable_reminders(
        &self,
        request: &EnableReminders,
    ) -> Result<ReminderSubscription, LibraryError> {
        request.reminder.validate()?;
        default_site(&self.catalog().list_sites().await?)?;
        let permission = self.activation_permission().await;
        let (state, block_reason) = match permission.block_reason() {
            None => (SubscriptionState::Enabled, None),
            Some(reason) => (SubscriptionState::Blocked, Some(reason)),
        };
        let subscription = self
            .catalog()
            .put_reminder_subscription(&SubscriptionWrite {
                target_id: request.reminder.target_id,
                site_id: request.site_id,
                site_revision: request.site_revision,
                settings_revision: request.settings_revision,
                criteria: request.reminder.criteria,
                lead_minutes: request.reminder.lead_minutes,
                expected: request.expected_revision,
                state,
                block_reason,
            })
            .await?;
        self.sync_reminders().await;
        Ok(subscription)
    }

    /// Disable a Target's reminders; the scheduler stops when no subscription
    /// stays enabled.
    ///
    /// # Errors
    /// See [`Catalog::set_subscription_state`].
    pub async fn disable_reminders(
        &self,
        target: Uuid,
        expected: Revision,
    ) -> Result<ReminderSubscription, LibraryError> {
        let subscription = self
            .catalog()
            .set_subscription_state(target, expected, SubscriptionState::Disabled, None)
            .await?;
        self.sync_reminders().await;
        Ok(subscription)
    }

    /// Reminder state in one read: whether the scheduler runs, the permission,
    /// app-closed delivery, every subscription, the upcoming reminders of the
    /// enabled ones by due instant, and a page of delivery records, newest
    /// first. Writes nothing.
    ///
    /// # Errors
    /// `PersistenceFailure` when the catalog cannot be read; `NotFound` when an
    /// enabled subscription's Target or site is gone.
    pub async fn reminder_status(
        &self,
        offset: u32,
        limit: u32,
    ) -> Result<ReminderStatus, LibraryError> {
        let (scheduler_running, now) = {
            let runtime = self.planning.lock().await;
            let running = runtime.scheduler.as_ref().is_some_and(ReminderScheduler::is_running);
            (running, runtime.clock.now_utc())
        };
        let permission = self.permission().await;
        let subscriptions = self.catalog().reminder_subscriptions(None).await?;
        let mut upcoming = Vec::new();
        for subscription in &subscriptions {
            if subscription.state == SubscriptionState::Enabled {
                let windows =
                    reminders::scheduled_windows(self.catalog(), subscription, now).await?;
                upcoming.extend(reminders::upcoming_reminders(subscription, &windows, now));
            }
        }
        upcoming.sort_by_key(|reminder| (reminder.due_at, reminder.window_key));
        let deliveries = self.catalog().reminder_deliveries(offset, limit).await?;
        Ok(ReminderStatus {
            scheduler_running,
            permission,
            app_closed_delivery: AppClosedDelivery::UNAVAILABLE,
            subscriptions,
            upcoming,
            deliveries,
        })
    }

    /// Review a calendar export: recompute the windows, keep the selected
    /// ones in time order, and name the site, zone, night range, snapshot
    /// digest and a suggested file name. Writes nothing.
    ///
    /// # Errors
    /// `InvalidInput` for an invalid selection; `WindowConflict` naming the
    /// key and the site, with the Target's current revision, when a selected
    /// key is not in the recomputed set; `NotFound` for an unknown Target or
    /// site.
    pub async fn review_calendar_export(
        &self,
        selection: &ExportSelection,
    ) -> Result<CalendarExportReview, LibraryError> {
        selection.validate()?;
        let set = self.compute_windows(&selection.query).await?;
        let basis = &set.basis;
        let mut windows: Vec<ObservingWindow> = Vec::with_capacity(selection.window_keys.len());
        for key in &selection.window_keys {
            let Some(window) = set.windows().find(|window| window.key == *key) else {
                return Err(LibraryError::WindowConflict {
                    key: *key,
                    site: basis.site.name.clone(),
                    current: basis.target_revision,
                });
            };
            if !windows.iter().any(|selected| selected.key == *key) {
                windows.push(window.clone());
            }
        }
        windows.sort_by_key(|window| (window.start_utc, window.key));
        let first_night = selection.query.first_night;
        let last_night = first_night
            .checked_add(time::Duration::days(i64::from(selection.query.nights) - 1))
            .ok_or_else(|| {
                LibraryError::InvalidInput(format!("nights after {first_night} are out of range"))
            })?;
        let snapshot = CalendarSnapshot {
            target_id: basis.target_id,
            target_revision: basis.target_revision,
            designation: basis.designation.clone(),
            site: basis.site.clone(),
            time_zone: basis.time_zone.clone(),
            first_night,
            last_night,
            criteria: basis.criteria,
            windows,
        };
        let snapshot_digest = calendar::snapshot_digest(&snapshot)?;
        let suggested_file_name = suggested_file_name(&snapshot);
        Ok(CalendarExportReview { snapshot, snapshot_digest, suggested_file_name })
    }

    /// Recompute the reviewed snapshot and render it, before the save dialog
    /// opens.
    ///
    /// # Errors
    /// `Conflict` naming the Target with its current revision when the
    /// recomputed snapshot no longer has `digest`; see
    /// [`Self::review_calendar_export`].
    pub async fn prepare_calendar_export(
        &self,
        selection: &ExportSelection,
        digest: &str,
    ) -> Result<PreparedCalendar, LibraryError> {
        let review = self.review_calendar_export(selection).await?;
        if review.snapshot_digest != digest {
            return Err(LibraryError::Conflict {
                id: review.snapshot.target_id,
                current: review.snapshot.target_revision,
                successors: Vec::new(),
            });
        }
        let stamp = self.now().await;
        let bytes = calendar::render_ics(&review.snapshot, stamp).into_bytes();
        Ok(PreparedCalendar { review, bytes })
    }

    /// Write a prepared calendar to the path the user chose in the save
    /// dialog, atomically and synced. The library keeps no copy and never
    /// rewrites the file.
    ///
    /// # Errors
    /// See [`calendar::write_snapshot`]; a failed write leaves any existing
    /// file unchanged.
    #[allow(
        clippy::unused_self,
        reason = "the shell writes calendars only through the Library it holds"
    )]
    pub async fn write_calendar_export(
        &self,
        prepared: PreparedCalendar,
        path: PathBuf,
    ) -> Result<CalendarExportOutcome, LibraryError> {
        let window_count = u32::try_from(prepared.review.snapshot.windows.len())
            .map_err(|_| LibraryError::InvalidInput("too many calendar windows".into()))?;
        let native = NativePath::from_path(&path);
        let saved = blocking(move || calendar::write_snapshot(&path, &prepared.bytes)).await?;
        Ok(CalendarExportOutcome::saved(CalendarFile {
            path: native,
            byte_count: saved.byte_count,
            sha256: saved.sha256,
            window_count,
        }))
    }

    async fn any_enabled(&self) -> Result<bool, LibraryError> {
        Ok(!self
            .catalog()
            .reminder_subscriptions(Some(SubscriptionState::Enabled))
            .await?
            .is_empty())
    }

    /// Bring the scheduler in line with the committed subscriptions. When they
    /// cannot be read the scheduler stays as it is: a running one re-reads
    /// the enabled subscriptions on every pass.
    async fn sync_reminders(&self) {
        let mut runtime = self.planning.lock().await;
        if runtime.notifier.is_none() {
            return;
        }
        let enabled = match self.any_enabled().await {
            Ok(enabled) => enabled,
            Err(_) => runtime.scheduler.is_some(),
        };
        runtime.sync(enabled).await;
        drop(runtime);
    }

    async fn notifier(&self) -> Option<Arc<dyn Notifier>> {
        self.planning.lock().await.notifier.clone()
    }

    async fn now(&self) -> OffsetDateTime {
        self.planning.lock().await.clock.now_utc()
    }

    /// The current permission, without prompting.
    async fn permission(&self) -> PermissionState {
        match self.notifier().await {
            Some(notifier) => notifier.permission().await,
            None => NOT_ATTACHED,
        }
    }

    /// The permission an activation commits with: one that was never decided
    /// is requested first.
    async fn activation_permission(&self) -> PermissionState {
        let Some(notifier) = self.notifier().await else {
            return NOT_ATTACHED;
        };
        match notifier.permission().await {
            PermissionState::NotDetermined => notifier.request_permission().await,
            permission => permission,
        }
    }
}

/// The permission a Library without a notification adapter reports.
const NOT_ATTACHED: PermissionState =
    PermissionState::Unavailable { reason: UnavailableReason::NotifierNotAttached };

/// The default site reminders use.
fn default_site(sites: &PlanningSites) -> Result<ObservingSite, LibraryError> {
    let id = sites.default_site_id.ok_or_else(|| {
        LibraryError::InvalidInput(
            "defaultSite: no default site is set; reminders use the default site".into(),
        )
    })?;
    sites
        .sites
        .iter()
        .find(|site| site.id == id)
        .cloned()
        .ok_or_else(|| LibraryError::NotFound(format!("default site {id}")))
}

/// `NGC-7000-Backyard-2026-10-21-to-2026-10-27.ics`: letters and digits of
/// the designation and site, with the night range.
fn suggested_file_name(snapshot: &CalendarSnapshot) -> String {
    let slug = |text: &str| {
        let mut slug = String::with_capacity(text.len());
        for character in text.chars() {
            if character.is_alphanumeric() {
                slug.push(character);
            } else if !slug.is_empty() && !slug.ends_with('-') {
                slug.push('-');
            }
        }
        slug.trim_end_matches('-').to_owned()
    };
    format!(
        "{}-{}-{}-to-{}.ics",
        slug(&snapshot.designation),
        slug(&snapshot.site.name),
        snapshot.first_night,
        snapshot.last_night
    )
}
