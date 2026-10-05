# View module contracts

The foundation owner publishes the shared model types, their validation, the D02 rule and the fixture geometry writers before parallel work. The geometry, catalog and selection workers code against those types and this contract, and leave shared model files to the foundation. No mock, empty default or placeholder success satisfies a contract.

## Shared model

`crates/platevault-model/src/view.rs`, re-exported from `lib.rs`, defines the types below. Wire types use camelCase serde.

- Records: `View`, `ViewOrigin`, `ViewRevisionHeader`, `ViewDraftHeader`, `ViewRecord`, `ViewListing` and `ViewQuery`.
- Criteria: `ViewCriteria`, `FramingSnapshot`, `FramingTarget`, `FramingPanel` and `CriteriaInput`.
- Membership: `SessionChoice`, `SessionChoiceState`, `SelectionReason`, `ViewMember`, `MemberCopy`, `MemberState`, `MemberReason` and `ViewRevision`.
- Inputs and edits: `ViewOriginInput`, `NewView`, `DraftEdit`, `AssessedMembers` and `Membership`.
- Candidates: `CandidateFilters`, `CandidateSort`, `CandidateQuery`, `FrameEvidence`, `CandidateBasis`, `GeometryEvidence`, `GeometryClass`, `FovEvidence`, `CandidateRow` and `CandidatePage`.
- Summaries: `MembershipBasis`, `MembershipSummary`, `ChannelSummary`, `UnresolvedSource` and `OpenChoice`.
- Refresh and quality: `RefreshItem`, `RefreshItemKind`, `RefreshReview`, `QualityAction`, `QualityScope` and `ViewDetail`.

```rust
pub const DEFAULT_MIN_FOOTPRINT_COVERAGE: f64 = 0.5;
pub const DEFAULT_SUGGESTION_RADIUS_DEG: f64 = 2.0;
pub fn initial_member_state(quality: &ApplicableQuality) -> (MemberState, MemberReason);
impl SelectionReason { pub fn is_pinned(&self) -> bool; }
```

`CriteriaInput::validate`, `CandidateFilters::validate` and `CandidateQuery::validate` return `LibraryError::InvalidInput` naming the field, as `TargetCone::validate` does. `initial_member_state` encodes the D02 table in [the data model](../data-model.md#initial-membership). Catalog and core both call it, because persistence never depends on the core. Errors reuse `LibraryError` and `ErrorResponse`; the plan adds no variant.

## Catalog owner

`crates/persistence/library/src/views.rs` is a child module of the catalog crate. It reuses the private `write_txn!`, `check_expected_sessions`, `check_expected_assets`, `require_decidable`, `current_member_assets`, `CaptureView`, `capture_quality`, `is_light`, `current_digests` and `decide_quality` helpers. `src/views.sql` holds the View tables and the triggers that refuse changes to committed rows. The catalog owner declares the module in `lib.rs`, appends `views.sql` to `SCHEMA` and sets `SCHEMA_VERSION` to the base version plus one, with the matching `catalog_meta` row in `schema.sql`. All View SQL stays under `crates/persistence`, so `scripts/check-db-boundary.sh` keeps an empty baseline.

```rust
impl Catalog {
    pub async fn create_view(&self, input: &NewView) -> Result<ViewRecord>;
    pub async fn edit_view_draft(&self, id: Uuid, expected_draft: Revision, edit: &DraftEdit) -> Result<ViewRecord>;
    pub async fn save_view(&self, id: Uuid, expected: Revision, expected_draft: Revision) -> Result<ViewRecord>;
    pub async fn discard_view_draft(&self, id: Uuid, expected_draft: Revision) -> Result<Option<ViewRecord>>;
    pub async fn view(&self, id: Uuid) -> Result<ViewRecord>;
    pub async fn list_views(&self, query: &ViewQuery) -> Result<Vec<ViewListing>>;
    pub async fn view_revision(&self, id: Uuid, revision: Revision) -> Result<ViewRevision>;
    pub async fn view_membership(&self, id: Uuid, membership: Membership) -> Result<MembershipBasis>;
    pub async fn candidate_basis(&self) -> Result<CandidateBasis>;
    pub async fn set_view_quality<P: SourceProbe>(&self, id: Uuid, membership: Membership, expected_draft: Option<Revision>, expected: &[ExpectedAsset], quality: Quality, probe: P) -> Result<Vec<Asset>>;
    pub async fn reject_view_members(&self, id: Uuid, membership: Membership, expected_draft: Option<Revision>, expected_project: Revision, expected: &[ExpectedAsset]) -> Result<Project>;
    pub async fn record_refresh_review(&self, review: &RefreshReview) -> Result<RefreshReview>;
    pub async fn apply_refresh(&self, review: Uuid, id: Uuid, expected: Revision, expected_draft: Revision, accept: &[Uuid], decline: &[Uuid]) -> Result<ViewRecord>;
    pub async fn view_references(&self, assets: &BTreeSet<Uuid>) -> Result<Vec<AssetReference>>;
}
```

Writers validate input and check the expected revisions inside the transaction. Draft session choices compute member states with `initial_member_state` over `CaptureView` captures read in that transaction. A criteria-based `SessionChoice` carries `AssessedMembers`; the catalog refuses it with Conflict unless they equal the current members, as `assessed_current` does. `save_view` changes the draft row into revision n+1 in one statement; RES later adds its open check there.

`candidate_basis` and `view_membership` each use one deferred reader transaction. They return current sessions with projected `FrameEvidence`, D16 captures, applicable quality, availability, associations and referenced equipment, or the chosen members with their live state. Neither hashes, measures nor writes.

`set_view_quality` hashes outside the transaction through `current_digests`. Its transaction checks the draft revision, the membership scope, the expected assets and then decides quality. `reject_view_members` calls the 065 rejection body inside its own transaction (S1). A `#[cfg(test)]` unit test forces SQLITE_FULL through `limit_writer_pages_for_test`.

## Geometry owner

`crates/platevault-core/src/view_geometry.rs` holds pure geometry and no I/O. The geometry owner declares it in `crates/platevault-core/src/lib.rs`.

```rust
pub fn frame_geometry(frame: &FrameEvidence, equipment: Option<&Equipment>) -> FrameGeometry;
pub fn session_geometry(frames: &[FrameGeometry], criteria: &ViewCriteria) -> GeometryEvidence;
pub fn framing_footprints(framing: &FramingSnapshot) -> Vec<FramingFootprint>;
```

`FrameGeometry` and `FramingFootprint` are core types of this module. `frame_geometry` follows research R6 and names each field-of-view input with its source. `session_geometry` classifies the session, computes the mean-pointing separation, and applies R7 and R8 through target-match `is_framed`, `SkyFootprint` and `compare_footprints`. Every crossing to target-match goes through `f64` degrees, as `targets.rs` does. Unknown evidence returns None, never 0.

## Selection owner

`crates/platevault-core/src/view_selection.rs` holds pure selection semantics and no I/O. The selection owner declares it in `crates/platevault-core/src/lib.rs`.

```rust
pub fn evaluate_candidates(basis: &CandidateBasis, criteria: &ViewCriteria) -> Vec<CandidateEvaluation>;
pub fn preselect(evaluations: &[CandidateEvaluation], criteria: &ViewCriteria) -> Vec<SessionChoice>;
pub fn page_candidates(evaluations: &[CandidateEvaluation], query: &CandidateQuery, selection: &[SessionChoice]) -> CandidatePage;
pub fn matching_sessions(evaluations: &[CandidateEvaluation], filters: &CandidateFilters) -> Vec<ExpectedSession>;
pub fn summarize(basis: &MembershipBasis) -> MembershipSummary;
pub fn refresh_items(committed: &MembershipBasis, evaluations: &[CandidateEvaluation], criteria: &ViewCriteria) -> Vec<RefreshItem>;
```

`CandidateEvaluation` is a core type of this module that pairs a candidate's basis with its `GeometryEvidence`. `preselect` returns choices only for a Project framing with qualifying equipment (R10). `page_candidates` filters, sorts with evidence-less rows last, pages and counts selected sessions outside the filters. `summarize` uses integer microseconds and exact FILTER channels (R19). `refresh_items` never proposes removing a pinned choice or an unavailable member (R24).

## Integration owner

`crates/platevault-core/src/library.rs` registers `ViewReferences { catalog: Arc<Catalog> }` as an `AssetReferences` source in `Library::open` and adds:

```rust
impl Library {
    pub async fn create_view(&self, origin: &ViewOriginInput, name: Option<String>) -> Result<ViewDetail, LibraryError>;
    pub async fn view_detail(&self, id: Uuid) -> Result<ViewDetail, LibraryError>;
    pub async fn view_candidates(&self, id: Uuid, query: &CandidateQuery) -> Result<CandidatePage, LibraryError>;
    pub async fn view_select_matching(&self, id: Uuid, expected_draft: Revision, filters: &CandidateFilters) -> Result<ViewDetail, LibraryError>;
    pub async fn refresh_view(&self, id: Uuid) -> Result<RefreshReview, LibraryError>;
    pub async fn view_quality_scope(&self, id: Uuid, membership: Membership, action: QualityAction, members: &[Uuid]) -> Result<QualityScope, LibraryError>;
}
```

These combine catalog reads with the pure geometry and selection functions. Creation and refresh re-read up to three times when the catalog refuses stale evidence (R11). `project_detail` gains `views` from `Catalog::list_views`.

`apps/desktop/src-tauri/src/commands/view_selection.rs` holds the eighteen `view_*` handlers with the library `Reply`, `fail` and `report` conventions. Handlers that need no geometry call the catalog directly; the quality handler passes `InventoryProbe`, as `library_set_quality` does. `commands/mod.rs` declares the module, and `library_shell.rs` adds the handlers to its `generate_handler!` list. The legacy `preparedview_*` and `sourceview_*` commands stay unregistered in the isolated shell.

## Ownership

| Owner | Files |
| --- | --- |
| Foundation | `crates/platevault-model/src/{view.rs,lib.rs}`, `crates/platevault-core/tests/{model.rs,support/mod.rs}` |
| Geometry | `crates/platevault-core/src/{view_geometry.rs,lib.rs}`, `crates/platevault-core/tests/view_geometry.rs` |
| Catalog | `crates/persistence/library/src/{views.rs,views.sql,lib.rs,schema.sql,projects.rs}`, `crates/persistence/library/tests/{views.rs,support/mod.rs}` |
| Selection | `crates/platevault-core/src/{view_selection.rs,lib.rs}`, `crates/platevault-core/tests/view_selection.rs` |
| Integration | `crates/platevault-core/src/library.rs`, `crates/platevault-model/src/project.rs` for the `views` field, `crates/platevault-core/tests/{view_library.rs,library.rs}`, `apps/desktop/src-tauri/src/{commands/view_selection.rs,commands/mod.rs,library_shell.rs}` |

The geometry and selection owners both add one `pub mod` line to `crates/platevault-core/src/lib.rs`; the selection owner rebases on the geometry commit. The catalog owner touches `projects.rs` only to extract the rejection body (S1). Backend acceptance exercises real catalog, core and IPC outcomes. The View review surface and journey steps stay pending on the final-frontend acceptance task.
