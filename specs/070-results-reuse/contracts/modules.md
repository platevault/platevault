# Results module contracts

The foundation owner publishes the shared types, their validation and the `FolderRoot` cutover before parallel work. The catalog and discovery workers code against those types and this contract and leave shared model files to the foundation. No mock, empty default or placeholder success satisfies a contract.

## Shared model

`crates/platevault-model/src/results.rs`, re-exported from `lib.rs`, defines `ResultKind`, `ResultOrigin`, `ResultType`, `HeaderEvidence`, `WriteState`, `OutputClass`, `OutputRule`, `ViewAssociation`, `InputFrameLineage`, `ResultFile`, `ResultAcceptance`, `ExpectedResult`, `AcceptItem`, `AttachResult`, `ResultsListing`, `OutputDiscovery`, `DiscoveredOutput`, `ResultVerification`, `AcceptedResult`, `AcceptedScope`, `OriginatingViewGroup`, `ProductInputRef`, `ProductInputChange`, `ProductInput`, `ProductInputState`, `ProductInputCapability`, `UnsupportedInput`, `Completion`, `CompletionState` and `RunningOperation`. Wire types use camelCase serde. `AttachResult::validate`, `AcceptItem::validate`, `ProductInputChange::validate` and `OutputRule::validate` return `LibraryError::InvalidInput` naming the field. Errors reuse `LibraryError` and `ErrorResponse`; the plan adds no variant.

`lib.rs` adds `FolderRoot {id, path, identity}` and `Location::root()`. 065's `ProjectDetail` gains `accepted_products: Vec<AcceptedResult>`, serialized as `acceptedProducts`.

## Foundation cutover

`inventory::scan` takes `&FolderRoot`, and `inventory::validate_location_root` becomes `validate_root(&FolderRoot)`; every caller moves to the new signatures. `ScanOptions` gains `include_unsupported`, false by default, which reports regular files of unsupported formats as `ScanFile` entries with `ImageFormat::Unsupported` and empty metadata. `SourceProbe::root_identity` takes `&FolderRoot`, and the private `SourceRoot` holds a `FolderRoot`. `InventoryProbe` and the catalog test probes change with it. Library behavior stays the same, and the existing inventory, catalog and library suites prove it.

## Catalog owner

`crates/persistence/library/src/results.rs` is a child module of the catalog crate. It reuses the private `write_txn!`, `SourceRoot`, `current_digest`, `hash_contained` and `require_unchanged_contained` helpers. `src/results.sql` holds the RES tables. The catalog owner declares the module in `lib.rs`, appends `results.sql` to `SCHEMA` and sets `SCHEMA_VERSION` to the next version (research R1), with the matching `catalog_meta` row in `schema.sql`. All RES SQL stays under `crates/persistence`, so `scripts/check-db-boundary.sh` keeps an empty baseline.

```rust
impl Catalog {
    pub async fn record_discovery(&self, view_id: Uuid, discovery: &OutputDiscovery) -> Result<ResultsListing>;
    pub async fn attach_result(&self, input: &AttachResult, root: &FolderRoot, observed: &ScanFile) -> Result<ResultFile>;
    pub async fn accept_results<P: SourceProbe>(&self, items: &[AcceptItem], probe: P) -> Result<Vec<ResultFile>>;
    pub async fn verify_results<P: SourceProbe>(&self, ids: &[Uuid], probe: P) -> Result<Vec<ResultVerification>>;
    pub async fn result_proof<P: SourceProbe>(&self, input: &ProductInputRef, probe: P) -> Result<DigestEvidence>;
    pub async fn results_listing(&self, view_id: Uuid) -> Result<ResultsListing>;
    pub async fn result(&self, id: Uuid) -> Result<ResultFile>;
    pub async fn discovered_outputs(&self, view_id: Option<Uuid>) -> Result<Vec<DiscoveredOutput>>;
    pub async fn accepted_results(&self, scope: &AcceptedScope) -> Result<Vec<AcceptedResult>>;
    pub async fn result_picker(&self, project: Option<Uuid>, target: Option<Uuid>) -> Result<Vec<OriginatingViewGroup>>;
    pub async fn create_view_from_results<P: SourceProbe>(&self, name: &str, project: Option<Uuid>, inputs: &[ProductInputRef], probe: P) -> Result<(Uuid, Vec<ProductInput>)>;
    pub async fn update_view_inputs<P: SourceProbe>(&self, change: &ProductInputChange, probe: P) -> Result<Vec<ProductInput>>;
    pub async fn product_inputs(&self, view_id: Uuid) -> Result<Vec<ProductInput>>;
    pub async fn mark_complete(&self, view_id: Uuid, expected: Revision) -> Result<Completion>;
    pub async fn reopen_view(&self, view_id: Uuid, expected: Revision) -> Result<Completion>;
    pub async fn completion(&self, view_id: Uuid) -> Result<(Completion, Vec<RunningOperation>)>;
}

pub(crate) async fn require_view_open(conn: &mut SqliteConnection, view_id: Uuid) -> Result<()>;
pub(crate) async fn running_view_operations(conn: &mut SqliteConnection, view_id: Uuid) -> Result<Vec<RunningOperation>>;
```

Acceptance, verification, proof and product assignment hash outside the writer lock and recheck stats and revisions inside the transaction, as `set_quality` does. `record_discovery` reconciles absence only inside complete scopes of a verified root. `create_view_from_results` and `update_view_inputs` call VSEL's in-transaction View and membership-revision writes (research CS1) and write product inputs in the same transaction. `running_view_operations` calls every `ViewOperationSource` function, PREP's now and STO's later. A `#[cfg(test)]` unit test in the module forces SQLITE_FULL through `limit_writer_pages_for_test`.

## Discovery owner

`crates/platevault-core/src/results.rs` holds the discovery walk and pure rules. The discovery owner declares it in `crates/platevault-core/src/lib.rs`.

```rust
pub fn discover(output: Option<&FolderRoot>, attached: &[(FolderRoot, NativePath)], rules: &[OutputRule], settle: Duration, canceled: &AtomicBool) -> Result<OutputDiscovery, LibraryError>;
pub fn observe_attachment(path: &NativePath) -> Result<(FolderRoot, ScanFile), LibraryError>;
pub fn classify_output(relative: &NativePath, rules: &[OutputRule]) -> OutputClass;
pub fn write_state(walked: &ObservationFingerprint, first: Option<&ObservationFingerprint>, second: Option<&ObservationFingerprint>) -> WriteState;
pub fn product_input_support(capability: Option<&ProductInputCapability>, inputs: &[ProductInput], has_raw_sessions: bool) -> Vec<UnsupportedInput>;
pub fn probe_inputs(inputs: &[ProductInput]) -> Vec<(Uuid, ProductInputState)>;
```

`discover` calls `inventory::scan` with `include_unsupported` over the output root, probes attached files, applies the settle rule and classifies output-origin files. It opens files read-only and hashes nothing. `classify_output` returns `recognized` with the rule's role only for a matching rule; a path that matches no rule is a candidate. `probe_inputs` takes one no-follow stat probe per input.

## Integration owner

`crates/platevault-core/src/library.rs` adds:

```rust
impl Library {
    pub async fn discover_results(&self, view_id: Uuid, settle: Option<Duration>) -> Result<ResultsListing, LibraryError>;
    pub async fn attach_result(&self, input: &AttachResult) -> Result<ResultFile, LibraryError>;
    pub async fn view_product_inputs(&self, view_id: Uuid) -> Result<Vec<(ProductInput, ProductInputState)>, LibraryError>;
    pub async fn product_support(&self, view_id: Uuid, profile_id: Uuid) -> Result<Vec<UnsupportedInput>, LibraryError>;
}
```

`discover_results` reads the output location and the profile's recognized-output rules through `Catalog::latest_preparation(view_id)` (research CS3, CS4), runs `discover` on a blocking thread and commits it through `record_discovery`. Acceptance, verification and product assignment call the catalog with `InventoryProbe`. `project_detail` adds `acceptedProducts`.

The integration owner also edits sibling write paths named by their contracts. It adds the `require_view_open` call at the hook the 069 contract names in PREP's preparation-start and Retry transactions, and inserts the same call into VSEL's membership-revision write. `running_view_operations` calls PREP's `running_preparations(conn, view_id)`. PREP's review and prepare gain the product item variant, embed `product_support` and rehash products through `result_proof` (CS5).

`apps/desktop/src-tauri/src/commands/results.rs` holds the fifteen `results_*` handlers with the library `Reply`, `fail` and `report` conventions. `commands/mod.rs` declares the module, and `library_shell.rs` adds the handlers to `generate_handler!`. The legacy `commands/artifacts.rs` stays unregistered.

## Ownership

| Owner | Files |
| --- | --- |
| Foundation | `crates/platevault-model/src/{results.rs,lib.rs,project.rs}`, `crates/platevault-core/src/inventory.rs`, the `SourceProbe` and `SourceRoot` lines of `crates/persistence/library/src/lib.rs`, the `InventoryProbe` lines of `crates/platevault-core/src/library.rs`, the probe impls in `crates/persistence/library/tests/{support/mod.rs,catalog.rs}`, `crates/platevault-core/tests/{model.rs,inventory.rs}` |
| Catalog | `crates/persistence/library/src/{results.rs,results.sql,schema.sql}`, the module and schema lines of `lib.rs`, `crates/persistence/library/tests/results.rs` |
| Discovery | `crates/platevault-core/src/{results.rs,lib.rs}`, `crates/platevault-core/tests/{results.rs,results_discovery.rs}` |
| Integration | the RES methods of `crates/platevault-core/src/library.rs`, `crates/platevault-core/tests/results_library.rs`, the VSEL and PREP catalog modules named by their contracts, `apps/desktop/src-tauri/src/{commands/results.rs,commands/mod.rs,library_shell.rs}` |

Backend acceptance exercises real catalog, core and IPC outcomes. The Results surface UI and the J26 and J27 steps stay pending on the final-frontend acceptance task.
