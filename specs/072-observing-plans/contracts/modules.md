# Planning module contracts

The foundation owner publishes the shared model types, their validation, the core ports and the manifests before parallel work. The windows, catalog, calendar, reminders and notifier workers code against those types and this contract, and leave shared files to the foundation. No mock, empty default or placeholder success satisfies a contract. Tests may drive the ports with a controlled clock and a recording notifier; only the real adapter proves permission and submission.

## Shared model

`crates/platevault-model/src/planning.rs`, re-exported from `lib.rs`, defines `ObservingSite`, `SiteInput`, `PlanningSettings`, `PlanningSites`, `TargetPlan`, `PlanCriteria` with `Darkness` and `MoonCriterion`, `WindowQuery`, `WindowKey`, `ObservingWindow`, `NightPlan`, `NoWindowReason`, `WindowBasis`, `WindowSet`, `ReminderInput`, `EnableReminders`, `ReminderReview`, `ReminderSubscription`, `SubscriptionState`, `BlockReason`, `PermissionState`, `AppClosedDelivery`, `UpcomingReminder`, `ReminderDelivery`, `DeliveryState`, `ReminderStatus`, `ExportSelection`, `CalendarSnapshot`, `CalendarExportReview`, `CalendarExportOutcome`, `ProjectGap` and `PlanTargetOverview`. Wire types use camelCase serde. `SiteInput::validate`, `PlanCriteria::validate`, `WindowQuery::validate`, `ReminderInput::validate` and `ExportSelection::validate` return `LibraryError::InvalidInput` naming the field, as `TargetCone::validate` does. Zone names are checked by the windows owner, because the model holds no time-zone database. Errors reuse `LibraryError` and `ErrorResponse`; the plan adds no variant.

## Ports

`crates/platevault-core/src/notifier.rs` defines the ports with boxed futures, as `AssetReferences` does, and the real system clock.

```rust
pub type NotifierFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

pub struct ReminderNotice { pub window: WindowKey, pub title: String, pub body: String }
pub enum SubmitOutcome { Submitted, Failed { reason: String } }

pub trait Notifier: Send + Sync + 'static {
    fn permission(&self) -> NotifierFuture<'_, PermissionState>;
    fn request_permission(&self) -> NotifierFuture<'_, PermissionState>;
    fn submit<'a>(&'a self, notice: &'a ReminderNotice) -> NotifierFuture<'a, SubmitOutcome>;
}

pub trait Clock: Send + Sync + 'static {
    fn now_utc(&self) -> OffsetDateTime;
}

pub struct SystemClock;
```

The foundation declares `notifier`, `planning`, `reminders` and `calendar` in `crates/platevault-core/src/lib.rs`. Each unit file starts with its module documentation only, and its owner adds every item.

## Windows owner

`crates/platevault-core/src/planning.rs` holds pure window semantics and no I/O.

```rust
pub fn validate_time_zone(name: &str) -> Result<(), LibraryError>;
pub fn compute_windows(target: &TargetRecord, site: &ObservingSite, query: &WindowQuery) -> Result<WindowSet, LibraryError>;
pub fn night_of(instant: OffsetDateTime, site: &ObservingSite) -> Result<Date, LibraryError>;
```

It composes skymath 0.7.2 `twilight`, `altitude_crossings`, `moon_crossings` and `lunar_separation` as research R7 describes. It resolves zones through the bundled `jiff` database, and no `jiff` type appears in its public signatures. Equal inputs produce equal windows and keys.

## Catalog owner

`crates/persistence/library/src/planning.rs` is a child module of the catalog crate. It reuses the private `write_txn!` and `next_revision` helpers. `src/planning.sql` holds the planning tables. The catalog owner declares the module in `lib.rs` and appends `planning.sql` to `SCHEMA` after `projects.sql`. It sets `SCHEMA_VERSION` one above its recorded base, with the matching `catalog_meta` row in `schema.sql`. Catalog open marks `sending` deliveries `uncertain` beside interrupted-scan recovery. All planning SQL stays under `crates/persistence`, so `scripts/check-db-boundary.sh` keeps an empty baseline.

```rust
impl Catalog {
    pub async fn save_site(&self, id: Option<Uuid>, expected: Option<Revision>, input: &SiteInput) -> Result<SiteSaved>;
    pub async fn list_sites(&self) -> Result<PlanningSites>;
    pub async fn site(&self, id: Uuid) -> Result<ObservingSite>;
    pub async fn set_default_site(&self, site: Option<Uuid>, expected: Revision) -> Result<DefaultSiteSaved>;
    pub async fn target_plan(&self, target: Uuid) -> Result<TargetPlan>;
    pub async fn set_target_planned(&self, target: Uuid, planned: bool, expected: Revision) -> Result<TargetPlan>;
    pub async fn put_reminder_subscription(&self, write: &SubscriptionWrite) -> Result<ReminderSubscription>;
    pub async fn set_subscription_state(&self, target: Uuid, expected: Revision, state: SubscriptionState, reason: Option<BlockReason>) -> Result<ReminderSubscription>;
    pub async fn reminder_subscription(&self, target: Uuid) -> Result<Option<ReminderSubscription>>;
    pub async fn reminder_subscriptions(&self, state: Option<SubscriptionState>) -> Result<Vec<ReminderSubscription>>;
    pub async fn claim_reminder_delivery(&self, claim: &DeliveryClaim) -> Result<bool>;
    pub async fn finish_reminder_delivery(&self, key: &WindowKey, outcome: &DeliveryOutcome) -> Result<ReminderDelivery>;
    pub async fn reminder_deliveries(&self, offset: u32, limit: u32) -> Result<Vec<ReminderDelivery>>;
}
```

`SiteSaved` and `DefaultSiteSaved` name the subscriptions moved to `needs_reconfirmation` in the same transaction. `put_reminder_subscription` checks, inside its transaction, that the site exists at the given revision, that it is the default site and that the settings revision matches. `claim_reminder_delivery` inserts a `sending` row and returns false when the identity exists. A `#[cfg(test)]` unit test in the module forces SQLITE_FULL through `limit_writer_pages_for_test`.

## Calendar owner

`crates/platevault-core/src/calendar.rs` renders and writes snapshots.

```rust
pub fn snapshot_digest(snapshot: &CalendarSnapshot) -> String;
pub fn render_ics(snapshot: &CalendarSnapshot, stamp: OffsetDateTime) -> String;
pub fn write_snapshot(path: &Path, bytes: &[u8]) -> Result<SavedCalendar, LibraryError>;
```

Rendering follows research R21 and is deterministic for a given stamp. `write_snapshot` follows R22 and refuses a path without the `.ics` extension.

## Reminders owner

`crates/platevault-core/src/reminders.rs` holds the due rules and the scheduler.

```rust
pub fn due_reminders(subscription: &ReminderSubscription, windows: &WindowSet, now: OffsetDateTime) -> Vec<UpcomingReminder>;
pub fn upcoming_reminders(subscription: &ReminderSubscription, windows: &WindowSet, now: OffsetDateTime) -> Vec<UpcomingReminder>;
pub fn notice(subscription: &ReminderSubscription, window: &ObservingWindow, designation: &str) -> ReminderNotice;

pub struct ReminderScheduler { /* task handle and wake signal */ }
impl ReminderScheduler {
    pub fn spawn(catalog: Arc<Catalog>, notifier: Arc<dyn Notifier>, clock: Arc<dyn Clock>) -> Self;
    pub fn wake(&self);
    pub async fn stop(self);
}
```

The scheduler follows research R15 through R17. It claims each identity before `Notifier::submit`, records the outcome and never retries a claimed identity. It reads permission before each submission and blocks the subscription when permission is not granted. It calls no scan, inventory or image API.

## Notifier owner

`apps/desktop/src-tauri/src/library_notifier.rs` implements `Notifier`.

```rust
pub fn platform_notifier() -> Arc<dyn Notifier>;
pub fn notification_settings_url() -> Option<&'static str>;
```

On macOS it uses `UNUserNotificationCenter` through `objc2-user-notifications`: settings for permission, authorization for requests, and an immediate request whose completion result decides Submitted or Failed. Only `Authorized` maps to granted. A process without a bundle identifier reads `unavailable` with `unbundled_process`. Other platforms read `unavailable` with `platform_not_qualified`, and their settings URL is none. The plugin's desktop permission API is not used.

## Integration owner

`crates/platevault-core/src/library.rs` adds the planning runtime to `Library` and:

```rust
impl Library {
    pub async fn attach_notifier(&self, notifier: Arc<dyn Notifier>, clock: Arc<dyn Clock>) -> Result<(), LibraryError>;
    pub async fn save_site(&self, id: Option<Uuid>, expected: Option<Revision>, input: &SiteInput) -> Result<SiteSaved, LibraryError>;
    pub async fn set_default_site(&self, site: Option<Uuid>, expected: Revision) -> Result<DefaultSiteSaved, LibraryError>;
    pub async fn target_overview(&self, target: Uuid) -> Result<PlanTargetOverview, LibraryError>;
    pub async fn compute_windows(&self, query: &WindowQuery) -> Result<WindowSet, LibraryError>;
    pub async fn review_reminders(&self, input: &ReminderInput) -> Result<ReminderReview, LibraryError>;
    pub async fn enable_reminders(&self, request: &EnableReminders) -> Result<ReminderSubscription, LibraryError>;
    pub async fn disable_reminders(&self, target: Uuid, expected: Revision) -> Result<ReminderSubscription, LibraryError>;
    pub async fn reminder_status(&self, offset: u32, limit: u32) -> Result<ReminderStatus, LibraryError>;
    pub async fn review_calendar_export(&self, selection: &ExportSelection) -> Result<CalendarExportReview, LibraryError>;
    pub async fn prepare_calendar_export(&self, selection: &ExportSelection, digest: &str) -> Result<PreparedCalendar, LibraryError>;
    pub async fn write_calendar_export(&self, prepared: PreparedCalendar, path: PathBuf) -> Result<CalendarExportOutcome, LibraryError>;
}
```

`save_site` validates the zone with `planning::validate_time_zone` before the catalog write. Window work runs through the existing `blocking` helper. `attach_notifier` starts the scheduler only when an enabled subscription exists. `enable_reminders`, `disable_reminders`, `save_site` and `set_default_site` start, wake or stop it. `target_overview` reads the Target, its plan, sites, subscription and `Catalog::target_coverage`. It also reads the 065 `Catalog::list_projects` filtered by Target and `Library::project_detail` for Project gaps.

`apps/desktop/src-tauri/src/commands/observing_plans.rs` holds the thirteen `planning_*` handlers with the library `Reply`, `fail` and `report` conventions. `planning_export_calendar` prepares the snapshot, opens the save dialog through `tauri_plugin_dialog::DialogExt` off the async workers, then writes through the Library. `planning_open_notification_settings` opens `notification_settings_url` through `tauri_plugin_opener::OpenerExt`. `commands/mod.rs` declares the module. `library_shell.rs` adds the handlers to `generate_handler!`, registers the dialog and opener plugins, and calls `attach_notifier` with `platform_notifier()` and `SystemClock` before `app.manage`.

## Ownership

| Owner | Files |
| --- | --- |
| Foundation | `crates/platevault-model/src/{planning.rs,lib.rs}`, `crates/platevault-core/src/{notifier.rs,lib.rs}`, module headers of `crates/platevault-core/src/{planning.rs,reminders.rs,calendar.rs}`, `crates/platevault-core/Cargo.toml`, `apps/desktop/src-tauri/Cargo.toml`, `Cargo.lock`, `crates/platevault-core/tests/model.rs` |
| Reference | `crates/platevault-core/tests/fixtures/planning/{generate_reference.py,astroplan-reference.json,README.md}` |
| Windows | `crates/platevault-core/src/planning.rs`, `crates/platevault-core/tests/planning_windows.rs` |
| Catalog | `crates/persistence/library/src/{planning.rs,planning.sql,lib.rs,schema.sql}`, `crates/persistence/library/tests/planning.rs` |
| Calendar | `crates/platevault-core/src/calendar.rs`, `crates/platevault-core/tests/calendar.rs` |
| Reminders | `crates/platevault-core/src/reminders.rs`, `crates/platevault-core/tests/reminders.rs` |
| Notifier | `apps/desktop/src-tauri/src/library_notifier.rs` |
| Integration | `crates/platevault-core/src/library.rs`, `crates/platevault-core/tests/planning_library.rs`, `apps/desktop/src-tauri/src/{commands/observing_plans.rs,commands/mod.rs,library_shell.rs}`, and the schema version on the integration base |
| Qualification | `apps/desktop/src-tauri/library-dev/tauri.conf.json`, the development bundle recipe in `justfile` |

Backend acceptance exercises real catalog, core, adapter and IPC outcomes. The Plan area and Settings sites UI and the journey steps stay pending on the final-frontend acceptance task.
