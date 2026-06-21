---
status: applied
created: 2026-06-21
applied: 2026-06-21
change_request: "Unify ALL contract type definitions on Rust + schemars as the single canonical source. Today two parallel sources exist: (a) hand-authored canonical JSON-Schema draft-2020-12 contracts in packages/contracts/schemas/*.schema.json and specs/<NNN>/contracts/*.json (aggregated by packages/contracts/scripts/build-schemas.mjs via json-schema-to-typescript, runtime-validated by ajv, parity-checked by tests/contract/contract_schema_parity.rs), and (b) tauri-specta-generated apps/desktop/src/bindings/index.ts from Rust. Make Rust DTOs (+ schemars) the canonical authoring surface and emit the JSON-Schema contracts as a reproducible projection. Load-bearing items: (1) schemars pinned at 0.8 emits draft-07 while canonical schemas are draft-2020-12; the 0.8->1.x upgrade (pinned out due to the uuid feature mapping) is a prerequisite; (2) per-type #[schemars(...)] annotation to reproduce semantic richness (operation.name dotted-token regex, oneOf envelope composition, const version pins, examples, descriptions); (3) a Rust->JSON-Schema(2020-12) emission step replacing the hand-schema inputs to build-schemas.mjs, keeping ajv runtime-validation and contract_schema_parity green; (4) Constitution Principle V already reconciled by plan.md (CB2 = Principle V Strengthened: the derived schema is a reproducible projection, no amendment needed). This SUPERSEDES the deferred T116 stopgap (ba13cfd shipped only a draft-07 *.generated.json drift-guard that does not fulfill FR-005/SC-004)."
scope: "Phase 3 (US2) — task re-scope + new prerequisite task"
---

## Change Summary

Deliver CB2/FR-005/SC-004 for real: make Rust + schemars the single source of truth and emit
the language-neutral JSON-Schema (draft-2020-12) as a derived, agreement-tested projection,
retiring the hand-authored canonical schemas — gated behind a schemars 0.8->1.x upgrade.

## Implementation Progress

- **Tasks completed**: T010, T011, phase-0/1 + US1 (T100-series) + US2 T110-T115, T117, T118 (20 of 75)
- **Current phase**: Phase 3 done except T116 (deferred); Phases 4-18 remaining
- **Files changed on branch**: 6 commits (091949c, f4db727, 5c88e9c, bbda5a6, ba13cfd) + uncommitted agent-assignments.yml
- **Potential task completions to mark**: none new (US2 already marked)
- **Adhoc changes**: agent-assignments.yml (uncommitted, from /speckit.agent-assign.assign)

## Impact Assessment

| Artifact | Action | Details |
|----------|--------|---------|
| tasks.md | Add + Modify | Add T116a (schemars 0.8->1.x prerequisite); re-scope T116 to true derivation + agreement test; un-defer T116 |
| research.md | Modify | Under CB2: record schemars-1.x prerequisite, draft-07->2020-12 dialect decision, hand-authored schemas retired->derived; note ba13cfd stopgap superseded |
| plan.md | Modify | Add schemars 1.x to dependency notes + a risk row (breaking derive-API change across domain_core/audit/contracts_core) |
| data-model.md | No change | Canonical-vs-projection already implicit |
| spec.md | No change | FR-005 + SC-004 already specify "derived from one source" + agreement check |

## Risk Checks

- [x] No completed tasks invalidated — T116 was DEFERRED (not [x]); the ba13cfd draft-07 guard is intentionally superseded, not lost work
- [x] No scope boundary violations — change realizes the existing US2/CB2 intent; Principle V already marked Strengthened in plan.md
- [ ] Downstream dependency: schemars 1.x is a BREAKING upgrade touching JsonSchema derives in crates/domain/core, crates/audit, crates/contracts/core — must land isolated and green; sequence after US3-US16 (like US13) to minimize churn

## Planned Changes

### tasks.md
- Insert **T116a** before T116 (Phase 3, marked as prerequisite blocking T116):
  "T116a (CB2 prereq) Upgrade `schemars` 0.8 -> 1.x in workspace Cargo.toml (resolves the
  draft-07 -> draft-2020-12 dialect gap and the uuid1 feature mapping); fix breaking
  `JsonSchema` derive API across `crates/domain/core`, `crates/audit`, `crates/contracts/core`;
  keep existing schema_for! tests green."
- Re-scope **T116** (remove DEFERRED note, restore [ ]): "T116 (CB2) Make `packages/contracts`
  + allowlisted per-spec contracts derive their JSON-Schema (draft-2020-12) from the Rust
  reflection (schemars 1.x) via a generation step feeding `build-schemas.mjs`; annotate
  contract DTOs with `#[schemars(...)]` to reproduce semantic richness (operation.name regex,
  oneOf envelope, const versions, examples, descriptions); retire the hand-authored canonical
  `*.schema.json` inputs; keep `ajv` validation + `tests/contract/contract_schema_parity.rs`
  green; satisfy the FR-005/SC-004 agreement test. Supersedes the ba13cfd draft-07 drift-guard."
- Add a dependency note: T116 blocked-by T116a; both sequenced after US3-US16 (run with/just
  before US13 since both are high-risk, last).

### research.md
- Update the **CB2** row: change recommendation note to record that derivation requires the
  schemars 1.x upgrade (draft-2020-12), that hand-authored schemas are retired in favor of the
  Rust-derived projection, and that the ba13cfd draft-07 `*.generated.json` agreement test was
  an interim stopgap now superseded by full derivation.

### plan.md
- Add `schemars 1.x` to the "new/changed dependency" notes with the rationale (draft-2020-12,
  uuid feature) and a **risk** row: "schemars major upgrade — breaking `JsonSchema` derive API
  across 3 crates; mitigation: land isolated + per-crate `cargo test`/`clippy`, keep schema_for!
  snapshot tests green."

### data-model.md
- (No changes)

### quickstart.md
- (No changes)
