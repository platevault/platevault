# Project module contracts

The foundation owner publishes the shared model types and their validation before parallel work. The catalog and checklist workers code against those types and this contract, and leave shared model files to the foundation. No mock, empty default or placeholder success satisfies a contract.

## Shared model

`crates/platevault-model/src/project.rs`, re-exported from `lib.rs`, defines `Project`, `ProjectTarget`, `ProjectPanel`, `ChecklistItem` with `ChecklistKind`, `ProjectSessionLink`, `LinkState`, `ProjectRejection`, `ProjectInput`, `ChecklistItemInput`, `SessionLinkInput`, `ProjectQuery`, `ProjectSummary`, `ProjectProgressBasis`, `ChannelProgress`, `LinkedSessionEvidence`, `ChecklistProgress` and `ProjectDetail`. Wire types use camelCase serde. `ProjectInput::validate`, `PanelInput::validate` and `ChecklistItemInput::validate` return `LibraryError::InvalidInput` naming the field, as `TargetCone::validate` does. Errors reuse `LibraryError` and `ErrorResponse`; the plan adds no variant.

## Catalog owner

`crates/persistence/library/src/projects.rs` is a child module of the catalog crate. It reuses the private `write_txn!`, `check_expected_sessions`, `check_expected_assets`, `current_member_assets`, `CaptureView` and `is_light` helpers. `src/projects.sql` holds the Project tables. The catalog owner declares the module in `lib.rs`, appends `projects.sql` to `SCHEMA` and sets `SCHEMA_VERSION` to 7, with the matching `catalog_meta` row in `schema.sql`. All Project SQL stays under `crates/persistence`, so `scripts/check-db-boundary.sh` keeps an empty baseline.

```rust
impl Catalog {
    pub async fn create_project(&self, input: &ProjectInput) -> Result<Project>;
    pub async fn update_project(&self, id: Uuid, expected: Revision, input: &ProjectInput) -> Result<Project>;
    pub async fn set_checklist(&self, id: Uuid, expected: Revision, items: &[ChecklistItemInput]) -> Result<Project>;
    pub async fn link_sessions(&self, id: Uuid, expected: Revision, links: &[SessionLinkInput]) -> Result<Project>;
    pub async fn unlink_sessions(&self, id: Uuid, expected: Revision, sessions: &[Uuid]) -> Result<Project>;
    pub async fn set_project_rejection(&self, id: Uuid, expected: Revision, assets: &[ExpectedAsset], rejected: bool) -> Result<Project>;
    pub async fn project(&self, id: Uuid) -> Result<Project>;
    pub async fn list_projects(&self, query: &ProjectQuery) -> Result<Vec<ProjectSummary>>;
    pub async fn project_progress(&self, id: Uuid) -> Result<ProjectProgressBasis>;
    pub async fn project_references(&self, assets: &BTreeSet<Uuid>) -> Result<Vec<AssetReference>>;
}
```

Writers validate input and check the Project revision and referenced records inside the transaction. A successful write increments the revision. `project_progress` uses one deferred reader transaction. It reads the Project, link states, current members, logical captures, quality applicability, effective rejections and per-session evidence. It returns per-channel integer-microsecond totals and frame counts with labels. A `#[cfg(test)]` unit test in the module forces SQLITE_FULL through `limit_writer_pages_for_test`.

## Checklist owner

`crates/platevault-core/src/projects.rs` holds pure checklist semantics and no I/O. The checklist owner declares it in `crates/platevault-core/src/lib.rs`.

```rust
pub fn evaluate_checklist(project: &Project, basis: &ProjectProgressBasis) -> Vec<ChecklistProgress>;
```

Integration and frame_count items read accepted totals for their exact channel; met is `accepted >= goal` on integers. Exposure and equipment items return per-session matches, differs or unknown. Panel coverage lists assigned links per panel. Missing calibration returns unknown with `calibration_matching_unavailable`. NeedsReview links never contribute. Evaluation never writes or changes the Project.

## Integration owner

`crates/platevault-core/src/library.rs` registers `ProjectReferences { catalog: Arc<Catalog> }` as an `AssetReferences` source in `Library::open` and adds:

```rust
impl Library {
    pub async fn project_detail(&self, id: Uuid) -> Result<ProjectDetail, LibraryError>;
}
```

`project_detail` combines `Catalog::project`, `Catalog::project_progress` and `evaluate_checklist`. VSEL reads Project context through `Catalog::project` and records Project rejection through `Catalog::set_project_rejection`.

`apps/desktop/src-tauri/src/commands/project_goals.rs` holds the eight `project_*` handlers with the library `Reply`, `fail` and `report` conventions. `commands/mod.rs` declares the module, and `library_shell.rs` adds the handlers to its `generate_handler!` list. The legacy `commands/projects.rs` and its `projects_*` commands stay unregistered in the isolated shell.

## Ownership

| Owner | Files |
| --- | --- |
| Foundation | `crates/platevault-model/src/{project.rs,lib.rs}`, `crates/platevault-core/tests/model.rs` |
| Catalog | `crates/persistence/library/src/{projects.rs,projects.sql,lib.rs,schema.sql}`, `crates/persistence/library/tests/{projects.rs,support/mod.rs,catalog.rs}` for the shared fixture move, `crates/platevault-core/tests/project_progress.rs` |
| Checklist | `crates/platevault-core/src/{projects.rs,lib.rs}`, `crates/platevault-core/tests/projects.rs` |
| Integration | `crates/platevault-core/src/library.rs`, `crates/platevault-core/tests/{project_library.rs,library.rs}`, `apps/desktop/src-tauri/src/{commands/project_goals.rs,commands/mod.rs,library_shell.rs}` |

Backend acceptance exercises real catalog, core and IPC outcomes. The Projects surface UI and journey steps stay pending on the final-frontend acceptance task.
