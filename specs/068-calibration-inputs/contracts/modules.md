# Calibration module contracts

The foundation owner publishes the shared model types, their validation and the rules trait before parallel work. The rules, catalog and integration owners code against those types and this contract. They leave shared model files to the foundation. No mock, empty default or placeholder success satisfies a contract.

## Shared model

`crates/platevault-model/src/calibration.rs`, re-exported from `lib.rs`, defines the following types. Wire types use camelCase serde.

- Inputs and evidence: `CalibrationKind`, `InputForm`, `InputRef`, `DecisionItem`, `Classification` with `MasterEvidence`, `LightEvidence` and `InputEvidence`.
- Evaluation: `CriterionId`, `Verdict`, `CriterionResult`, `EvidenceRow` and `CandidateEvaluation`.
- Plan and decisions: `CalibrationPlan`, `CalibrationDecision`, `Resolution`, `CalibrationInputFile`, `Requirement`, `RequirementState`, `UnresolvedReason`, `CalibrationViewBasis` and `CalibrationViewPlan`.
- Handoff: `CalibrationHandoff` and `HandoffAssignment`.
- Adoption: `AdoptionSource`, `AdoptionDestination`, `AdoptionReview`, `AdoptionOperation` with `AdoptionPhase`, and `AdoptedMaster`.
- Custody: `CustodyFact`.

`DecisionItem::validate`, `exception_reason`, `required_kinds` and `AdoptionDestination::validate` return `LibraryError::InvalidInput` naming the field, as `TargetCone::validate` does. `CalibrationViewPlan::handoff` is the pure projection that PREP reads.

The same owner makes two additive changes in `lib.rs`:

- `CaptureMetadata.stack_count: Option<u32>`, with `#[serde(default)]`, is filled from `RawFileMetadata.stack_count` (STACKCNT, falling back to NCOMBINE).
- `ReferenceKind::Calibration` serializes as `calibration`.

The plan adds no `LibraryError` variant.

```rust
pub trait CalibrationRules: Send + Sync {
    fn classify(&self, effective: &CaptureMetadata, relative_path: &NativePath) -> Option<Classification>;
    fn evaluate(&self, kind: CalibrationKind, light: &LightEvidence, input: &InputEvidence) -> Vec<CriterionResult>;
    fn plan(&self, basis: &CalibrationViewBasis) -> CalibrationViewPlan;
}
```

## Rules owner

`crates/platevault-core/src/calibration.rs` holds pure calibration semantics and no I/O. The rules owner declares it in `crates/platevault-core/src/lib.rs` and adds the path dependency `calibration_master_detect` to `crates/platevault-core/Cargo.toml`.

```rust
pub struct Rules;
impl CalibrationRules for Rules { /* classify, evaluate, plan */ }
```

- `classify` maps effective IMAGETYP through `metadata_core::v1_normalization_table` for raw frames. It runs `calibration_master_detect::detect_master` with `stack_count`, the file name and the relative path for masters, and labels the basis `header_stack_count`, `header_imagetyp` or `name_only` ([research](../research.md) R4). Dark flats, light masters and unclassified types return `None`.
- `evaluate` applies the [criteria table](../data-model.md#criteria) exactly, with the canonical text and decimal forms of the `capture-v1` key and tolerance `none`.
- `plan` builds requirements from the basis and orders candidates. It preselects per R10, applies decisions under R13 and names unresolved reasons. It never reads storage, the clock or settings.

## Catalog owner

`crates/persistence/library/src/calibration/` is a child module of the catalog crate. It reuses the crate's private `write_txn!`, `check_expected_sessions`, `check_expected_assets`, `current_member_assets`, `CaptureView`, `current_digests`, `current_digest`, `hash_contained`, `open_contained` and `require_unchanged_contained` helpers.

- `mod.rs` and `inventory.rs` read raw sets, candidates, adopted masters and View bases.
- `adoption.rs` holds reviews, operations, masters and restart recovery.
- `contained_write.rs` holds the create-new temporary file, streaming hash copy, `sync_all`, no-replace install with folder sync, and handle-bound temporary removal.
- `decisions.rs` holds the plan and decision writes and the handoff read.
- `custody.rs` holds the custody facts and reference reads.

`src/calibration.sql` holds the tables. It is appended to `SCHEMA` after the View tables, and `SCHEMA_VERSION` becomes the next version after the latest one landed (R1). `Catalog::open` also marks Running adoptions Interrupted. `tempfile` becomes a regular dependency of `persistence_library`. All calibration SQL stays under `crates/persistence`, so `scripts/check-db-boundary.sh` keeps an empty baseline.

```rust
impl Catalog {
    pub async fn calibration_inputs<R: CalibrationRules>(&self, query: &InputQuery, rules: &R) -> Result<Vec<CalibrationInputSummary>>;
    pub async fn calibration_input<R: CalibrationRules>(&self, input: &InputLookup, rules: &R) -> Result<CalibrationInputDetail>;
    pub async fn calibration_match<R: CalibrationRules>(&self, sessions: &[ExpectedSession], kinds: &[CalibrationKind], rules: &R) -> Result<Vec<SessionMatch>>;
    pub async fn calibration_view_plan<R: CalibrationRules>(&self, view: Uuid, revision: Revision, rules: &R) -> Result<CalibrationViewPlan>;
    pub async fn calibration_handoff<R: CalibrationRules>(&self, view: Uuid, revision: Revision, rules: &R) -> Result<CalibrationHandoff>;
    pub async fn set_required_kinds(&self, view: Uuid, revision: Revision, expected: Revision, kinds: &[CalibrationKind]) -> Result<CalibrationPlan>;
    pub async fn accept_calibration<R: CalibrationRules, P: SourceProbe>(&self, view: Uuid, revision: Revision, expected: Revision, items: &[DecisionItem], rules: &R, probe: P) -> Result<CalibrationViewPlan>;
    pub async fn record_calibration_exception<R: CalibrationRules, P: SourceProbe>(&self, view: Uuid, revision: Revision, expected: Revision, item: &DecisionItem, reason: &str, rules: &R, probe: P) -> Result<CalibrationViewPlan>;
    pub async fn withdraw_calibration<R: CalibrationRules>(&self, view: Uuid, revision: Revision, expected: Revision, items: &[(Uuid, CalibrationKind)], rules: &R) -> Result<CalibrationViewPlan>;
    pub async fn review_adoption<R: CalibrationRules, P: SourceProbe>(&self, source: &AdoptionSource, destination: &AdoptionDestination, rules: &R, probe: P) -> Result<AdoptionReview>;
    pub async fn adopt_master<P: SourceProbe>(&self, review: Uuid, expected: Revision, probe: P) -> Result<AdoptionOperation>;
    pub async fn list_adoptions(&self, state: Option<AdoptionState>, offset: u32, limit: u32) -> Result<Vec<AdoptionOperation>>;
    pub async fn calibration_custody_facts<R: CalibrationRules>(&self, view: Uuid, rules: &R) -> Result<Vec<CustodyFact>>;
    pub async fn calibration_references(&self, assets: &BTreeSet<Uuid>) -> Result<Vec<AssetReference>>;
}
```

Reads use one deferred reader transaction and hash nothing. Accept and exception hash inputs off the writer lock first. Inside the transaction they rebuild the basis and confirm every item is a listed candidate with the required verdict. They then snapshot its criteria, bind digests and append decisions. Adoption commits each lifecycle phase before the next file effect, and every file step runs on the blocking pool. Catalog tests use a small behavioral `CalibrationRules` implementation, never one that echoes success. `#[cfg(test)]` hooks force SQLITE_FULL through `limit_writer_pages_for_test`, and corrupt or interrupt an adoption after install.

## Integration owner

`crates/platevault-core/src/library.rs` registers `CalibrationReferences { catalog: Arc<Catalog> }` as an `AssetReferences` source in `Library::open`. It also adds the `Library::calibration_*` methods. Each composes one catalog method with `Rules` and the disk probe. PREP calls `Library::calibration_handoff`. Once 070 and 071 land, the same owner adds RES output sources and implements STO's `CustodyFacts` over `calibration_custody_facts`.

`apps/desktop/src-tauri/src/commands/calibration_inputs.rs` holds the thirteen `calibration_*` handlers with the library `Reply`, `fail` and `report` conventions. `commands/mod.rs` declares the module, and `library_shell.rs` adds the handlers to `generate_handler!`. The legacy `commands/calibration.rs` and `commands/calibration_tolerances.rs` stay unregistered in the isolated shell.

## Ownership

| Owner | Files |
| --- | --- |
| Foundation | `crates/platevault-model/src/{calibration.rs,lib.rs}`, `crates/platevault-core/tests/model.rs` |
| Rules | `crates/platevault-core/src/{calibration.rs,lib.rs}`, `crates/platevault-core/Cargo.toml`, `crates/platevault-core/tests/calibration_rules.rs` |
| Catalog | `crates/persistence/library/src/{calibration.sql,calibration/*.rs,lib.rs,schema.sql}`, `crates/persistence/library/Cargo.toml`, `crates/persistence/library/tests/{calibration_inventory.rs,calibration_adoption.rs,calibration_decisions.rs,calibration_custody.rs,support/mod.rs}` |
| Integration | `crates/platevault-core/src/library.rs`, `crates/platevault-core/tests/{calibration_library.rs,library.rs,support/mod.rs}`, `apps/desktop/src-tauri/src/{commands/calibration_inputs.rs,commands/mod.rs,library_shell.rs}` |

Backend acceptance exercises real catalog, core and IPC outcomes. The Calibration surface UI and journey steps stay pending on the final-frontend acceptance task.
