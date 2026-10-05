# Storage custody module contracts

The foundation owner publishes the shared model types and their validation before parallel work. The catalog, filesystem and policy workers code against those types and this contract and leave shared files to the foundation. No mock, empty default or placeholder success satisfies a contract.

## Shared model

`crates/platevault-model/src/storage.rs`, re-exported from `lib.rs`, defines `CleanupScope`, `CustodyRole`, `CleanupGroup`, `ReclaimClass`, `ProofState`, `TrashSupport`, `CleanupFile`, `CleanupPreview`, `ProtectedSelection`, `CleanupReview` and `CleanupItem`. It also defines `TransferKind`, `TransferDestination`, `ItemFolder`, `ReferenceMode`, `ReferenceChoice`, `TransferReview`, `TransferItem`, `ItemPhase`, `ItemHold`, `ItemReference`, `Blocker`, `StorageOperation`, `OperationSummary`, `StorageOverview`, `DuplicateGroup`, `ViewCustodyRecord`, `EntryCustody`, `AssetRepoint`, `ViewFacts`, `ViewRoot` and `CustodyEntry`. Wire types use camelCase serde. `TransferDestination::validate` and `ItemFolder::validate` return `LibraryError::InvalidInput` naming the field for absolute, root or parent-traversal folders, as `NativePath::relative_path` does. Errors reuse `LibraryError` and `ErrorResponse`; the plan adds no variant.

VSEL, CAL, PREP and RES land first and publish catalog reads, so STO defines no trait for them ([research](../research.md#cross-spec-seams) X1 to X5). Handoff files are rewritten with PREP's pure `render_handoff_file(spec, pathMapping)` in `platevault_core` (X3).

The foundation adds `fs4` 1.1, `libc` 0.2 on Unix, and `objc2` 0.6 with `objc2-foundation` 0.3 on macOS to `crates/platevault-core/Cargo.toml`. All are already in `Cargo.lock`.

## Catalog owner

`crates/persistence/library/src/storage.rs` is a child module of the catalog crate. It reuses the private `write_txn!`, `check_expected_assets`, `check_expected_sessions`, `current_digests`, `hash_contained`, `rebind_association_bases` and the quality-basis rebinding of `apply_remap_rows`. `src/storage.sql` holds the tables of the [data model](../data-model.md). The catalog owner appends it to `SCHEMA` and sets `SCHEMA_VERSION` as research R2 states, with the matching `catalog_meta` row in `schema.sql`. All STO SQL stays under `crates/persistence`, so `scripts/check-db-boundary.sh` keeps an empty baseline.

```rust
impl Catalog {
    pub async fn snapshot_sources<P: SourceProbe>(&self, expected: &[ExpectedAsset], probe: P) -> Result<Vec<SourceSnapshot>>;
    pub async fn view_custody_facts(&self, view: Uuid, scope: CleanupScope) -> Result<ViewFacts>;
    pub async fn custody_entries_for_assets(&self, assets: &BTreeSet<Uuid>) -> Result<Vec<CustodyEntry>>;
    pub async fn record_cleanup_review(&self, review: &CleanupReview) -> Result<CleanupReview>;
    pub async fn record_transfer_review(&self, review: &TransferReview) -> Result<TransferReview>;
    pub async fn begin_storage_operation(&self, review: Uuid, expected: Revision) -> Result<StorageOperation>;
    pub async fn record_item_intent(&self, operation: Uuid, item: Uuid, phase: ItemPhase) -> Result<()>;
    pub async fn record_item_outcome(&self, operation: Uuid, item: Uuid, outcome: &ItemOutcome) -> Result<StorageOperation>;
    pub async fn commit_references_updated(&self, operation: Uuid, item: Uuid, references: &[ItemReference], repoint: &AssetRepoint) -> Result<StorageOperation>;
    pub async fn settle_storage_operation(&self, operation: Uuid) -> Result<StorageOperation>;
    pub async fn resume_storage_operation(&self, operation: Uuid, expected: Revision) -> Result<StorageOperation>;
    pub async fn storage_operation(&self, operation: Uuid) -> Result<StorageOperation>;
    pub async fn list_storage_operations(&self, query: &StorageOperationQuery) -> Result<Vec<StorageOperation>>;
    pub async fn entry_custody(&self, preparation: Uuid) -> Result<Vec<EntryCustody>>;
    pub async fn view_custody(&self, view: Uuid) -> Result<ViewCustodyRecord>;
    pub async fn running_storage_for_view(&self, view: Uuid) -> Result<Vec<Uuid>>;
    pub async fn duplicate_groups(&self, query: &DuplicateQuery) -> Result<Vec<DuplicateGroup>>;
    pub async fn asset_repoints(&self, after: Option<i64>) -> Result<Vec<AssetRepoint>>;
}

/// Blocking and read-only: SHA-256 of a file below a root whose identity still matches.
pub fn hash_contained_file(root: &NativePath, identity: &FileIdentity, relative: &NativePath, recorded: &ObservationFingerprint) -> Result<String>;
```

`view_custody_facts` reads, in one reader transaction, `Catalog::view`, RES's completion record, `prepared_entries` of every preparation revision in scope, `discovered_outputs`, `accepted_results` and `calibration_custody_facts`. `custody_entries_for_assets` returns the PREP entries that name any moving asset, for transfer reference plans. Recording a review revalidates every expected asset, session, location, View and preparation revision in the same transaction. `begin_storage_operation` marks the review applied and inserts the operation, items and destination claims together. `commit_references_updated` repoints the asset, rebinds its quality and association bases and swaps the destination claim for a source claim.

Edits outside `storage.rs`: `apply_scan_batch` in `lib.rs` skips claimed paths and records them as incomplete scope. Retire location and remap apply return Conflict while an unfinished STO item touches the location. `recover_interrupted` marks Running storage operations `interrupted` and in-flight items `uncertain`. RES's `running_view_operations` calls the crate-private `running_storage_for_view(conn, view)` inside its completion transaction. A `#[cfg(test)]` unit test in the module forces SQLITE_FULL through `limit_writer_pages_for_test`.

## Filesystem owner

`crates/platevault-core/src/custody_fs/` holds every filesystem effect. It reads and writes only paths its caller passes, never follows a link and never removes a file except through `OsTrash` or `replace_app_entry`.

```rust
pub trait OsTrash: Send + Sync + 'static {
    fn support(&self, path: &Path) -> TrashSupport;
    fn move_to_trash(&self, path: &Path, expected: &EntryIdentity) -> Result<TrashEvidence, LibraryError>;
}
pub fn platform_trash() -> Arc<dyn OsTrash>;
pub fn entry_identity(path: &Path) -> Result<EntryIdentity, LibraryError>;
pub fn walk_root(root: &Path, identity: &FileIdentity) -> Result<Vec<WalkedFile>, LibraryError>;
pub fn write_destination(source: &Path, destination: &Path, method: TransferMethod, progress: &mut dyn FnMut(u64)) -> Result<WrittenFile, LibraryError>;
pub fn replace_app_entry(entry: &Path, expected: &EntryIdentity, replacement: &Replacement) -> Result<EntryIdentity, LibraryError>;
pub fn volume_status(path: &Path) -> Result<VolumeStatus, LibraryError>;
```

`OsTrash` follows research R4: macOS `trash.rs` uses NSFileManager with the resulting URL, Linux uses a same-filesystem freedesktop move, and Windows reports `platform_unqualified`. `move_to_trash` re-checks `expected` without following links, then verifies that the source path is gone and the Trash item has the same file identity. `write_destination` opens with `create_new` or creates a same-volume hardlink, then flushes file and parent directory; it never renames over a destination. `replace_app_entry` writes a sibling, re-checks `expected` and renames over the entry. `volume_status` returns free bytes from `fs4::available_space`, writability without writing, and the volume identity from the inventory probe.

## Policy owner

`crates/platevault-core/src/custody.rs` holds pure rules and no I/O.

```rust
pub fn classify(facts: &ViewFacts, walked: &[WalkedFile], library: &LibraryPaths) -> Vec<CleanupFile>;
pub fn preview(scope: CleanupScope, files: &[CleanupFile], trash: &[VolumeTrash]) -> CleanupPreview;
pub fn review_items(preview: &CleanupPreview, selected: &[FileKey], protected: &[ProtectedSelection], proof: &ProofEvidence) -> Vec<CleanupItem>;
pub fn filing_layout(items: &[TransferSource], folder: &NativePath, overrides: &[ItemFolder]) -> Vec<PlannedPath>;
pub fn reference_plan(entries: &[CustodyEntry], same_volume: bool, choices: &[ReferenceChoice]) -> Vec<ItemReference>;
pub fn transfer_blockers(review: &TransferReview, collisions: &[PlannedPath], volume: &VolumeStatus) -> Vec<Blocker>;
```

`classify` applies the group table and the Captures and Calibration exclusion. `review_items` applies the blockers of R9 and the proof rules of R7 and R8. `filing_layout` keeps every basename. `reference_plan` requires a choice for each cross-volume hardlink and never fills one in.

## Integration owner

`crates/platevault-core/src/storage.rs` defines `Storage`, holding `Arc<Catalog>`, `Arc<dyn OsTrash>`, the registered `AssetReferences` sources, operation controls and a progress broadcast. It reads View facts through `Catalog::view_custody_facts`, walks each View root with `walk_root` and hashes through `hash_contained_file`. It runs reviews, Trash items and transfer items with `spawn_blocking` and commits each intent before its effect. `Storage::recover` runs after `Catalog::open` and records what each claimed path holds without resolving any item.

```rust
impl Storage {
    pub async fn overview(&self) -> Result<StorageOverview, LibraryError>;
    pub async fn cleanup_preview(&self, view: Uuid, scope: CleanupScope) -> Result<CleanupPreview, LibraryError>;
    pub async fn review_cleanup(&self, request: &CleanupReviewRequest) -> Result<CleanupReview, LibraryError>;
    pub async fn apply_cleanup(self: &Arc<Self>, review: Uuid, expected: Revision) -> Result<StorageOperation, LibraryError>;
    pub async fn review_transfer(&self, request: &TransferReviewRequest) -> Result<TransferReview, LibraryError>;
    pub async fn start_transfer(self: &Arc<Self>, review: Uuid, expected: Revision) -> Result<StorageOperation, LibraryError>;
    pub async fn retry_transfer(self: &Arc<Self>, operation: Uuid, expected: Revision) -> Result<StorageOperation, LibraryError>;
    pub async fn running_for_view(&self, view: Uuid) -> Result<Vec<Uuid>, LibraryError>;
}
```

`crates/platevault-core/src/library.rs` adds the `storage` field, opens it in `Library::open`, exposes `Library::storage()` and forwards `register_references` sources to it for STO-FR-02. `apps/desktop/src-tauri/src/commands/storage_custody.rs` holds the eleven `storage_*` handlers with the library `Reply`, `fail` and `report` conventions. `commands/mod.rs` declares the module. `library_shell.rs` adds the handlers to `generate_handler!` and forwards `storage_operation_progress` events.

## Ownership

| Owner | Files |
| --- | --- |
| Foundation | `crates/platevault-model/src/{storage.rs,lib.rs}`, `crates/platevault-core/Cargo.toml`, `crates/platevault-core/tests/model.rs` |
| Catalog | `crates/persistence/library/src/{storage.rs,storage.sql,lib.rs,schema.sql}`, the one `running_view_operations` call in RES's `src/results.rs`, `crates/persistence/library/tests/{storage.rs,catalog.rs,support/mod.rs}` |
| Filesystem | `crates/platevault-core/src/custody_fs/{mod.rs,trash.rs,write.rs,repair.rs,volume.rs,walk.rs}`, `crates/platevault-core/tests/{custody_fs.rs,trash.rs}` |
| Policy | `crates/platevault-core/src/custody.rs`, `crates/platevault-core/tests/custody.rs` |
| Integration | `crates/platevault-core/src/{storage.rs,library.rs}`, `crates/platevault-core/tests/{storage_cleanup.rs,storage_transfer.rs,storage_overview.rs}`, `apps/desktop/src-tauri/src/{commands/storage_custody.rs,commands/mod.rs,library_shell.rs}` |

Each unit owner adds its one `pub mod` line to `crates/platevault-core/src/lib.rs`; the integration owner merges them. Backend acceptance exercises real catalog, filesystem, core and IPC outcomes. The Cleanup, Archive, Filing and Storage surfaces and their journey steps stay pending on the final-frontend acceptance task.
