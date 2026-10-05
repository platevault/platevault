# Implementation Plan: Results, reuse and completion

**Branch**: `070-results-reuse`
**Spec**: [070-results-reuse](spec.md)
**Date**: 2026-10-05

## Summary

Implement the RES contract on the rebuilt backend after LIB (064), PRJ (065), VSEL (066) and PREP (069). A Result is a catalog record for a file that a View's processing wrote into its recorded output location, or that the user attached to the View. Discovery lists candidates apart from the intermediates that the profile recognizes, and marks files still being written Pending. Attach records a User-linked View association, and input-frame lineage stays Unknown. Acceptance binds the user's choice to freshly hashed bytes and defaults the product to Keep; it changes no lineage. Accepted products become product inputs of another View after their bytes match the acceptance digest again, and they stay apart from raw sessions. Mark Complete is a separate append-only decision. Only a Running app-owned preparation or storage mutation of the same View blocks it, and new membership or preparation revisions of a Complete View need Reopen. RES writes no file. [Research](research.md) records the source evidence, cross-spec seams CS1 to CS10 and defaults R1 to R20.

## Technical Context

- Language: Rust workspace toolchain, edition 2021, on `platevault_model`, `platevault_core`, `persistence_library` and `desktop_shell`, with the VSEL and PREP catalog modules.
- Dependencies: existing workspace serde, sqlx SQLite, Tokio, UUID, SHA-256 and time, plus metadata_fits, metadata_xisf and fs_pathsafe through the inventory walker. The plan adds no crate or dependency and does not adopt the legacy `workflow_artifacts` crate (research R5).
- Storage: the clean library catalog with RES tables from `results.sql`, at the next schema version after its dependencies (R1). One FULL-synchronous serialized writer applies. An older development catalog is refused and reset; the plan imports no legacy artifact data.
- Platform: desktop Tauri 2 isolated library shell on macOS, Windows and Linux. Host proof is macOS; other-platform gates stay explicit.
- Testing: failing-first behavior tests with generated FITS and XISF stacks, TIFF-named files, a log, an unknown file and a file that a helper thread appends to. After integration, run `cargo test --workspace`, `just db-boundary` and the dev-surface guard. Real development Tauri MCP scenarios follow.
- Performance: discovery walks one output folder off the UI thread, reads bounded FITS and XISF headers, waits one settle window (2 s by default) and probes stats again. Acceptance, verification and product assignment hash only the named products. Result, Project and Target reads access no file; product-input reads take one stat probe per input and never hash.
- Constraints: SQL only under `crates/persistence`. RES never writes, moves or deletes a file, and never combines, stitches or converts products. Unknown evidence stays explicit.

## Constitution Check

Pre-research gate: pass. Post-design recheck: pass.

- I Local-first custody: RES opens files read-only and stores paths, identities and decisions, never copies. Hash manifests before and after every scenario prove it.
- II Reviewable mutation: RES adds no filesystem mutation; cleanup stays STO's reviewed plan. Intermediate recognition is inference, so each one carries its profile rule and evidence (R5).
- III PixInsight boundary: RES performs no processing. Product inputs reach the external application unchanged; PlateVault never combines channels or stitches panels.
- IV Research-led modeling: research.md compares discovery triggers, Pending detection, intermediate recognition, lineage, product-input storage and completion storage, and records defaults.
- V Portable contracts: [contracts/results.md](contracts/results.md) is a versioned language-neutral command contract with revisions and errors. Attachments, kinds, acceptance, product inputs and completion are Tier 1 and commit before acknowledgment. Discovery observations are Tier 2 rows that a later discovery derives again.

The all-human-gate waiver leaves analysis, tests, independent review and Sniff mandatory.

## Project Structure

### Documentation

```text
specs/070-results-reuse/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── results.md
│   └── modules.md
└── checklists/requirements.md
```

No `tasks.md`: executable task state lives under the molecule implement step in Beads.

### Source

- `crates/platevault-model/src/results.rs`: shared Result, product-input and completion types with input validation, re-exported from `lib.rs`. `lib.rs` adds `FolderRoot`, and 065's `project.rs` gains `acceptedProducts`.
- `crates/platevault-core/src/inventory.rs` and `crates/persistence/library/src/lib.rs`: the `FolderRoot` cutover of the walk, `SourceProbe` and `SourceRoot`, and `include_unsupported` (R2).
- `crates/persistence/library/src/results.sql` and `src/results.rs`: tables, writes, CAS, byte proof, completion, the View-open guard, the running-operations helper and reads. `lib.rs` wires the module and the schema version.
- `crates/platevault-core/src/results.rs`: discovery walk and settle rule, pure output classification, product-input support and stat probes.
- `crates/platevault-core/src/library.rs`: Library RES operations and `project_detail` accepted products.
- VSEL and PREP catalog modules, named by their contracts: the guard call in VSEL's revision write and at PREP's named hook, and product items in PREP review and prepare.
- `apps/desktop/src-tauri/src/commands/results.rs`: the fifteen `results_*` handlers, registered in `library_shell.rs`.
- Tests: `crates/persistence/library/tests/results.rs` and `crates/platevault-core/tests/{results.rs,results_discovery.rs,results_library.rs}`, plus new cases in `tests/inventory.rs` and `tests/model.rs`.

[contracts/modules.md](contracts/modules.md) defines signatures and file ownership.

## Independent units and integration

The foundation owner lands the model types and the `FolderRoot` cutover first, with the existing suites unchanged. The catalog unit and the discovery unit then work in separate linked worktrees from that recorded commit. Neither edits the model or the other's files. The integration owner waits for both and owns `library.rs`, the sibling write-path edits, IPC, composed tests and the shell wiring.

Workers skip repository-wide builds, tests, lint and formatters. The lead runs the focused RES tests and one integrated workspace verification, then exact-head independent review and Sniff. Original and output hashes are checked before and after. STO (071) verifies the storage-mutation blocker, cleanup Keep, and reviewed cleanup and reference repair without reopen: the STO parts of RES-AC-07, RES-AC-08 and RES-FR-04. The supported product-input branch needs PREP capability evidence (J26 G2). The Results surface and the J26 and J27 steps stay open on the final-frontend acceptance task. After five failed fixes, an issue gets a reproducible backlog entry, never a stub.

## Complexity Tracking

- `FolderRoot` cutover: result files live under folders that are not library locations. Reusing the verified no-follow walk and byte-proof path avoids a second custody-critical walker and hasher. The cost is a mechanical signature change of `inventory::scan`, `SourceProbe::root_identity` and five probe implementations.
- Sibling write paths: VSEL and PREP land first, so the RES integration owner adds the D09 guard and the product item variant to their transactions. One crate-private helper keeps each check inside the same writer transaction.
- RES tables join the library catalog crate, like Project tables. Joins of Results, Views, Projects and Targets need one reader snapshot and one writer.
