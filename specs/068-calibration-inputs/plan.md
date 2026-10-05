# Implementation Plan: Calibration matching, exceptions, and master adoption

**Branch**: `068-calibration-inputs`
**Spec**: [068-calibration-inputs](spec.md)
**Date**: 2026-10-05

## Summary

Implement the CAL contract on the rebuilt 064 backend. CAL lists raw calibration sets and masters from indexed locations with their evidence and missing evidence. For each light Session of a committed View revision, it evaluates candidates against the D13 criteria exactly, with no tolerance. It preselects one compatible candidate per required kind, keeps it a suggestion until the user accepts it, and explains every match. Mismatches and unknown criteria resolve only in four ways: an alternate input, a reasoned exception scoped to the View, VSEL exclusion of the Session, or deferral. Accept and exception hash their inputs and record that basis. The handoff names unresolved requirements for PREP.

Master adoption is the only file write. It is reviewed first and then confirmed. It copies one detected master into a registered Calibration location and re-reads and hash-verifies the copy. Only after the source is re-hashed does it register the master with its provenance. [Research](research.md) records the source evidence, the conservative defaults R1 through R22 and the cross-spec seams.

## Technical Context

- Language: Rust workspace toolchain, edition 2021, on the 064 crates `platevault_model`, `platevault_core`, `persistence_library` and `desktop_shell`.
- Dependencies: existing workspace serde, sqlx SQLite, Tokio, UUID, time, sha2 and hex. `platevault_core` gains a path dependency on the pure legacy `calibration_master_detect` crate, whose only dependency is `metadata_core`. `persistence_library` promotes workspace `tempfile` from a dev dependency to a regular one.
- Storage: the clean library catalog. Calibration tables from `calibration.sql` are appended after the 066 View tables. The schema version is the next one after the latest landed dependency, in the order 064 (v6), 065 (v7), 066, 068. Every other recorded version is refused and development catalogs are reset. The plan imports no legacy calibration data or tolerance.
- Platform: desktop Tauri 2 isolated library shell on macOS, Windows and Linux. Host proof is macOS. No-replace install behavior on other file systems and platforms stays an explicit gate.
- Testing: failing-first behavior tests with generated FITS and XISF in the test files listed under Source. After integration, run `cargo test --workspace`, `just db-boundary` and the dev-surface guard. Real development Tauri MCP scenarios follow.
- Performance: inventory, plan and handoff reads use one reader transaction over current non-light Sessions and adopted masters. They read no image bytes and start no rehash. Accept, exception and adoption hash only the files they bind, off the writer lock. The plan assumes desktop-scale Views of tens of Sessions and calibration libraries of thousands of frames.
- Constraints: SQL only under `crates/persistence`. Exact canonical comparisons, tolerance `none`. Unknown evidence stays explicit. No calibration, stacking or master generation (constitution III).

## Constitution Check

Pre-research gate: pass. Post-design recheck: pass.

- I Local-first custody: matching, decisions and handoff reads touch no image file. Adoption writes only a new file at a reviewed path that does not exist yet. It never modifies, moves or removes the source or any existing entry. Hash manifests before and after every scenario prove it.
- II Reviewable mutation: adoption is a durable review followed by an explicit confirmation. It never overwrites, and its operation record holds each phase and outcome. Master detection by name is labelled inference.
- III PixInsight boundary: PlateVault builds no master. Raw sets go to the external application, and an adopted master is a byte-identical copy.
- IV Research-led modeling: research.md compares alternatives for storage, kinds, criteria, camera and optical-train evidence, revision applicability, adoption sequencing and the write primitive, and records the defaults.
- V Portable contracts: [contracts/calibration.md](contracts/calibration.md) is a versioned, language-neutral command contract with revisions, errors and operation states. Plan, decision, review, operation and master rows are Tier 1. The adoption intent commits before the first file effect, and interrupted operations are reconciled at open with an explicit retry.

The all-human-gate waiver leaves analysis, tests, independent review and Sniff mandatory.

## Project Structure

### Documentation

```text
specs/068-calibration-inputs/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── calibration.md
│   └── modules.md
└── checklists/requirements.md
```

No `tasks.md`: executable task state lives under the molecule implement step in Beads.

### Source

- `crates/platevault-model/src/calibration.rs`: shared calibration types, input validation and the `CalibrationRules` trait, re-exported from `lib.rs`. `lib.rs` also gains `CaptureMetadata.stack_count` and `ReferenceKind::Calibration`.
- `crates/platevault-core/src/calibration.rs`: pure classification, criterion evaluation and plan assembly.
- `crates/persistence/library/src/calibration.sql` and `src/calibration/`: tables, inventory reads, decisions and handoff, adoption with the contained write primitive, custody facts and references. `lib.rs` wires the module, the schema version and adoption recovery at open.
- `crates/platevault-core/src/library.rs`: the `Library::calibration_*` methods and the registered `CalibrationReferences` source.
- `apps/desktop/src-tauri/src/commands/calibration_inputs.rs`: the thirteen `calibration_*` handlers, registered in `library_shell.rs`.
- Tests: `crates/persistence/library/tests/calibration_{inventory,adoption,decisions,custody}.rs` on the shared `tests/support/mod.rs` fixture. `crates/platevault-core/tests/{model.rs,calibration_rules.rs,calibration_library.rs}`. The LIB-AC-16 retire test in `crates/platevault-core/tests/library.rs` gains a real calibration reference.

[contracts/modules.md](contracts/modules.md) defines signatures and file ownership.

## Owned interaction steps

| Step | Requirements | Journey | Backend evidence ([quickstart](quickstart.md)) |
| --- | --- | --- | --- |
| E1 | CAL-FR-01 to CAL-FR-04, CAL-AC-01 | J23 S1 to S4 | steps 2, 3 and 5 |
| E2 | CAL-FR-05, CAL-AC-02, CAL-AC-03 | J23 S5 to S7 | steps 4, 6 and 7 |
| H4 | CAL-FR-06, CAL-FR-07, CAL-AC-04, CAL-AC-05, CAL-AC-07 | J26 S8 and S9 | steps 9 to 12 |
| Cross-flow: Calibration mismatch | CAL-FR-05, CAL-FR-08, CAL-AC-06 | J23 S5 and S6 | steps 4, 6 and 8 |
| Calibration surface | CAL-FR-01, CAL-FR-06 | J26 S8 | step 1 |

Each row also needs the final-frontend proof listed under Independent units.

## Independent units and integration

068 starts after 066's View tables and schema version land, because CAL rows reference committed View revisions. The foundation owner lands the model types, validation and the rules trait first. The rules unit and the catalog unit then work in separate linked worktrees from that recorded commit. Neither edits the model or the other's files. Within the catalog unit, inventory, adoption, decisions and custody land in that order, because each reads the previous unit's rows. The integration owner waits for both units. It owns `library.rs`, the reference registration, the IPC, the composed tests and the shell wiring. RES output sources and the STO `CustodyFacts` adapter follow when 070 and 071 land.

Workers skip repository-wide builds, tests, lint and formatters. The lead runs the focused calibration tests and one integrated workspace verification, then exact-head independent review and Sniff. Original hashes are checked before and after. PREP (069) verifies that the handoff blocks Prepared. STO (071) verifies protected Keep. The Calibration surface UI and the J23 S1 to S7 and J26 S8 to S9 steps stay open on the final-frontend acceptance task. After five failed fixes, an issue gets a reproducible backlog entry, never a stub.

## Complexity Tracking

| Choice | Why needed | Simpler alternative rejected because |
| --- | --- | --- |
| Calibration tables in the library catalog crate | Plans read Sessions, assets, equipment and View revisions in one snapshot. Accept and adoption need the crate's private digest and containment helpers. | A separate crate needs a second writer connection or public catalog internals. |
| A contained write primitive inside the catalog crate | Destination containment reuses the same root identity and no-follow proof as the existing reads. | `fs_executor::update_view::install_item` buffers whole files and never re-reads the destination (D05). |
| Rules passed as a trait object | Pure semantics stay in core while the catalog evaluates inside write transactions, the same way `group_assets` is passed today. | Putting semantics in persistence would mix storage and product rules. |
