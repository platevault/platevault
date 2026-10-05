# Application handoff module contracts

The foundation owner publishes the shared model types, their validation and the crate manifests before parallel work. The profile, catalog, planner, filesystem and launcher workers code against those types and this contract, and leave shared model files to the foundation. No mock, empty default or placeholder success satisfies a contract.

## Shared model

`crates/platevault-model/src/handoff.rs`, re-exported from `lib.rs`, defines `ApplicationKind`, `Application`, `ApplicationInput`, `ExecutableObservation`, `CapabilityClass`, `CapabilityState`, `CapabilityEvidence`, `ApplicationProfile`, `CapabilityAssessment`, `InputMode`, `LinkType`, `HandoffSettings`, `HandoffSettingsInput`, `SourceRef`, `DestinationFacts`, `ItemRole`, `EntryKind`, `ItemBlock` with `BlockReason`, `EffectiveValue` with `CorrectionChoice`, `ReviewItem`, `ModeOffer`, `PreparationReview`, `ReviewConfirmation`, `Preparation`, `PreparationState`, `PreparationItem`, `ItemState`, `PreparedEntry`, `PreparationOperation`, `Launch`, `LaunchState` and `PreparationDetail`. Wire types use camelCase serde. `ApplicationInput::validate`, `HandoffSettingsInput::validate` and `ReviewConfirmation::validate` return `LibraryError::InvalidInput` naming the field, as `TargetCone::validate` does. Errors reuse `LibraryError` and `ErrorResponse`; the plan adds no variant.

The foundation adds direct dependencies that already resolve in `Cargo.lock`: `fs4`, `libc` on Unix and `plist` on macOS to `platevault_core`, and `fits-header` and `xisf-header` for patched copies.

## Profile owner

`crates/platevault-core/src/profiles.rs` holds pure capability semantics. It embeds `assets/profiles/profiles.json` as `targets.rs` embeds `seed.json`.

```rust
impl ProfileCatalog {
    pub fn bundled() -> Result<Self, LibraryError>;
    pub fn from_manifest(bytes: &[u8]) -> Result<Self, LibraryError>;
    pub fn profiles(&self) -> &[ApplicationProfile];
    pub fn assess(&self, application: &Application) -> CapabilityAssessment;
}
pub fn offered_modes(assessment: &CapabilityAssessment, destination: &DestinationFacts) -> Vec<ModeOffer>;
pub fn folder_handoff_exact(assessment: &CapabilityAssessment, listing: &[NativePath], members: &BTreeSet<NativePath>) -> Result<(), ItemBlock>;
```

The loader refuses a verified or unsupported class without evidence. `assess` applies evidence only to a listed observed version and reads every class unknown for a generic application. `offered_modes` refuses Linked and Direct source unless `inputWrite` is verified read-only, and names the class. It refuses Linked where symlinks are unsupported and Clone without a qualified primitive. The bundled manifest starts with every class unknown; the qualification task alone adds cited evidence.

## Catalog owner

`crates/persistence/library/src/preparations.rs` is a child module of the catalog crate, and `src/preparations.sql` holds the tables of the [data model](../data-model.md). The module reuses the private `write_txn!`, `open_contained`, `stat_matches` and `check_expected_assets` helpers. The catalog owner declares the module in `lib.rs`, appends `preparations.sql` to the schema list and sets `SCHEMA_VERSION` to the next version after 066 and 068 have landed, with the matching `catalog_meta` row (research R2). `recover_interrupted` also applies research R22. All PREP SQL stays under `crates/persistence`, so `scripts/check-db-boundary.sh` keeps an empty baseline.

```rust
impl Catalog {
    pub async fn save_application(&self, id: Option<Uuid>, expected: Option<Revision>, input: &ApplicationInput, observed: &ExecutableObservation) -> Result<Application>;
    pub async fn applications(&self) -> Result<Vec<Application>>;
    pub async fn save_handoff_settings(&self, view_id: Uuid, expected: Option<Revision>, input: &HandoffSettingsInput, parent: &FileIdentity, output_parent: Option<&FileIdentity>) -> Result<HandoffSettings>;
    pub async fn handoff_settings(&self, view_id: Uuid) -> Result<Option<HandoffSettings>>;
    pub async fn last_chosen_parent(&self) -> Result<Option<(NativePath, FileIdentity)>>;
    pub async fn record_review(&self, review: &PreparationReview) -> Result<PreparationReview>;
    pub async fn confirm_review(&self, id: Uuid, expected: Revision, confirmation: &ReviewConfirmation) -> Result<PreparationReview>;
    pub async fn start_preparation(&self, review_id: Uuid, expected: Revision) -> Result<(Preparation, PreparationOperation)>;
    pub async fn start_retry(&self, preparation_id: Uuid, expected: Revision) -> Result<PreparationOperation>;
    pub async fn record_folders(&self, operation_id: Uuid, folders: &CreatedFolders) -> Result<()>;
    pub async fn record_intents(&self, operation_id: Uuid, intents: &[ItemIntent]) -> Result<()>;
    pub async fn record_outcomes(&self, operation_id: Uuid, outcomes: &[ItemOutcome]) -> Result<PreparationOperation>;
    pub async fn request_stop(&self, operation_id: Uuid, stop: StopRequest) -> Result<PreparationOperation>;
    pub async fn finish_operation(&self, operation_id: Uuid, reconciliation: &Reconciliation) -> Result<PreparationOperation>;
    pub async fn preparation(&self, id: Uuid) -> Result<PreparationDetail>;
    pub async fn list_preparations(&self, view_id: Option<Uuid>, offset: u32, limit: u32) -> Result<Vec<Preparation>>;
    pub async fn latest_preparation(&self, view_id: Uuid) -> Result<Option<Preparation>>;
    pub async fn prepared_entries(&self, preparation_id: Uuid) -> Result<Vec<PreparedEntry>>;
    pub async fn begin_launch(&self, preparation_id: Uuid, expected: Revision, application_id: Uuid) -> Result<Launch>;
    pub async fn record_launch(&self, launch_id: Uuid, update: &LaunchUpdate) -> Result<Launch>;
    pub async fn preparation_references(&self, assets: &BTreeSet<Uuid>) -> Result<Vec<AssetReference>>;
    pub async fn open_source<P: SourceProbe>(&self, source: &SourceRef, probe: &P) -> Result<SourceRead>;
}
pub(crate) async fn running_preparations(conn: &mut SqliteConnection, view_id: Uuid) -> Result<Vec<PreparationOperation>>;
```

Writers validate input and check revisions inside the transaction; a successful write increments the record revision. `start_preparation` refuses an unconfirmed or stale review, a View revision that is not the View's current one and a second Running or Paused operation of the preparation. `finish_operation` derives the terminal state from the journal and the reconciliation listing (research R19) and sets `supersededBy` on older revisions when Prepared. `open_source` loads the location, revalidates its root through the probe, requires the fingerprint and returns a read-only `SourceRead` over `open_contained`; `SourceRead::finish` rechecks the stats and the folder chain. A `#[cfg(test)]` unit test in the module forces SQLITE_FULL through `limit_writer_pages_for_test`.

## Planner owner

`crates/platevault-core/src/handoff.rs` holds pure review planning and no I/O.

```rust
pub fn plan_review(inputs: &ReviewInputs) -> Result<ReviewPlan, LibraryError>;
pub fn suggest_folder_name(view_name: &str, taken: &dyn Fn(&str) -> bool) -> Result<String, LibraryError>;
pub fn render_handoff_file(spec: &HandoffFileSpec, paths: &BTreeMap<Uuid, NativePath>) -> Result<Vec<u8>, LibraryError>;
```

`ReviewInputs` carries the View revision, the calibration handoff, each copy's asset and availability, effective and observed metadata, Confirmed equipment values, settings, the capability assessment, destination facts and the request's item modes and correction choices. `plan_review` chooses one copy per member (research R29), assigns the layout, computes footprints, offers and refuses modes, lists effective values and blocks, and marks every item whose mode differs from the View mode. The same inputs always give the same plan.

## Filesystem owner

`crates/platevault-core/src/destination.rs` reads destinations and writes nothing. `crates/platevault-core/src/materialize.rs` performs the effects of research R18 and never removes, trashes or overwrites a file.

```rust
pub fn probe_parent(path: &NativePath, recorded: Option<&FileIdentity>, child: &str) -> Result<DestinationFacts, LibraryError>;
pub fn hardlink_eligible(source: &VolumeIdentity, source_path: &Path, destination: &DestinationFacts) -> Result<(), ItemBlock>;
pub fn create_folders(plan: &FolderPlan) -> Result<CreatedFolders, LibraryError>;
pub fn materialize(intent: &ItemIntent, source: &mut SourceRead, folders: &CreatedFolders, stop: &AtomicU8) -> ItemOutcome;
pub fn reconcile(intent: &ItemIntent, folders: &CreatedFolders) -> ReconcileVerdict;
pub fn verify_entry(entry: &PreparedEntry, source: Option<&mut SourceRead>) -> Result<(), ItemBlock>;
pub fn list_layout(folders: &CreatedFolders) -> Result<Vec<NativePath>, LibraryError>;
```

`create_folders` re-validates the parent identity and creates the View, output and control folders with create-new semantics. `materialize` hashes while reading, creates links with `symlink` or non-following `linkat`, and stages copies, clones and patched copies before a no-replace rename. Patched copies use `Header::update_file` on the staged file only. `reconcile` and `verify_entry` compare recorded intent and entries by kind, link target, identity and SHA-256, never by name alone.

## Launcher owner

`crates/platevault-core/src/launch.rs` observes and starts applications without a shell.

```rust
pub fn observe_executable(path: &NativePath) -> Result<ExecutableObservation, LibraryError>;
pub fn launch_arguments(application: &Application, assessment: &CapabilityAssessment, paths: &PreparationPaths) -> Result<Vec<OsString>, LibraryError>;
pub fn spawn_detached(executable: &NativePath, args: &[OsString], working_dir: &Path) -> Result<Option<u32>, LibraryError>;
```

`observe_executable` reads identity and, on macOS, the bundle version; it never runs the file. `launch_arguments` uses only verified `launch` evidence or the generic argument list (research R5, R7). `spawn_detached` adopts the reviewed legacy detach pattern from `workflow_profiles::launch`: `process_group(0)` on Unix and detached process flags on Windows, with `open -a` and the located bundle on macOS.

## Integration owner

`crates/platevault-core/src/preparation.rs` holds `Preparations`, the supervisor for reviews, operations and launches. It runs effects through `spawn_blocking` with a pause or cancel flag and broadcasts committed snapshots. `crates/platevault-core/src/library.rs` constructs it in `Library::open`, registers `PreparationReferences { catalog: Arc<Catalog> }` as an `AssetReferences` source and adds:

```rust
impl Library {
    pub fn preparations(&self) -> &Arc<Preparations>;
}
impl Preparations {
    pub async fn review(&self, request: &ReviewRequest) -> Result<PreparationReview, LibraryError>;
    pub async fn start(self: &Arc<Self>, review_id: Uuid, expected: Revision) -> Result<PreparationOperation, LibraryError>;
    pub async fn retry(self: &Arc<Self>, preparation_id: Uuid, expected: Revision) -> Result<PreparationOperation, LibraryError>;
    pub async fn stop(&self, operation_id: Uuid, stop: StopRequest) -> Result<PreparationOperation, LibraryError>;
    pub async fn open(self: &Arc<Self>, preparation_id: Uuid, expected: Revision, application_id: Option<Uuid>) -> Result<Launch, LibraryError>;
    pub async fn reveal_target(&self, preparation_id: Uuid) -> Result<PathBuf, LibraryError>;
    pub fn subscribe(&self) -> broadcast::Receiver<PreparationEvent>;
}
```

`review` reads the VSEL revision and CAL handoff through their catalog functions (research S1, S3), probes sources and the destination, calls `plan_review` and records the result. `start` and `retry` run research R18 to R23 and call `finish_operation`. `open` runs research R25 and then `spawn_detached`. Each owner declares its module in `crates/platevault-core/src/lib.rs`; the integration owner resolves those one-line additions.

`apps/desktop/src-tauri/src/commands/application_handoff.rs` holds the `prep_*` handlers with the library `Reply`, `fail` and `report` conventions. `commands/mod.rs` declares the module. `library_shell.rs` adds the handlers to `generate_handler!`, forwards `prep_progress` like `library_scan_progress`, and reveals through `tauri_plugin_opener::reveal_item_in_dir` with no webview capability. The legacy `preparedview_*` and `tools.launch` commands stay unregistered in the isolated shell.

## Ownership

| Owner | Files |
| --- | --- |
| Foundation | `crates/platevault-model/src/{handoff.rs,lib.rs}`, `crates/platevault-core/Cargo.toml`, `crates/platevault-core/tests/model.rs` |
| Profiles | `crates/platevault-core/src/profiles.rs`, `assets/profiles/profiles.json`, `crates/platevault-core/tests/profiles.rs` |
| Catalog | `crates/persistence/library/src/{preparations.rs,preparations.sql,lib.rs,schema.sql}`, `crates/persistence/library/tests/{preparations.rs,support/mod.rs}` |
| Planner | `crates/platevault-core/src/handoff.rs`, `crates/platevault-core/tests/handoff_plan.rs` |
| Filesystem | `crates/platevault-core/src/{destination.rs,materialize.rs}`, `crates/platevault-core/tests/materialize.rs` |
| Launcher | `crates/platevault-core/src/launch.rs`, `crates/platevault-core/tests/launch.rs` |
| Integration | `crates/platevault-core/src/{preparation.rs,library.rs,lib.rs}`, `crates/platevault-core/tests/{preparation_library.rs,library.rs}`, `apps/desktop/src-tauri/src/{commands/application_handoff.rs,commands/mod.rs,library_shell.rs}` |

Backend acceptance exercises real catalog, core, filesystem and IPC outcomes. The preparation surface UI and journey steps stay pending on the final-frontend acceptance task.
