# Implementation Plan: Storage operations: View cleanup, verified archive, reviewed filing

**Branch**: `071-storage-custody`
**Spec**: [071-storage-custody](spec.md)
**Date**: 2026-10-05

## Summary

Implement the STO contract on the rebuilt 064 backend after VSEL, CAL, PREP and RES. View cleanup sends a reviewed, exact selection to the OS Trash. It never follows a link, needs retained-original proof for copies and hardlinks, keeps protected products and has no permanent-delete path. Archive and filing share one verified transfer. It copies with `create_new`, flushes durably and re-reads the hash. Then it repairs prepared references, repoints each asset with its ID kept, and only then retires the source to the OS Trash. Every phase is journaled per item and retry revalidates identities. Storage shows locations, View footprints, duplicate groups and transfers without authorizing removal. [Research](research.md) records the source evidence, defaults R1 through R21 and seams X1 through X7.

## Technical Context

- Language: Rust workspace toolchain, edition 2021, on the 064 crates `platevault_model`, `platevault_core`, `persistence_library` and `desktop_shell`.
- Dependencies: existing workspace serde, sqlx SQLite, Tokio, UUID, SHA-256 and time. `platevault_core` adds direct dependencies on `fs4` 1.1, `libc` 0.2 on Unix, and `objc2` 0.6 with `objc2-foundation` 0.3 on macOS. All four are already in `Cargo.lock`, so no new crate enters the build.
- Storage: STO tables from `storage.sql` in the clean library catalog, at the schema version after the one recorded when its last dependency lands (R2). Reviews, phase intents, outcomes and claims are Tier 1 and commit on the FULL-synchronous writer before or after the action they name. An older catalog is refused and reset.
- Platform: desktop Tauri 2 isolated library shell on macOS, Windows and Linux. Host proof is macOS. Linux Trash and the Windows Recycle Bin stay explicit qualification gates; Windows Trash reads unsupported until qualified (R4).
- Testing: failing-first behavior tests with generated FITS/XISF, disk-image volumes and the files listed under Source. Tests that move files into a real OS Trash run only in an isolated account or disposable VM. After integration, run `cargo test --workspace`, `just db-boundary` and the dev-surface guard. Real development Tauri MCP scenarios follow.
- Performance: preview and the overview read catalog rows and no-follow metadata only and start no hash. Cleanup review hashes every selected regular file and each kept copy, and execution hashes them again (D19). A transfer reads each source at review and before retirement and reads the destination once. Hashing runs off the UI thread.
- Constraints: SQL only under `crates/persistence`. No code path deletes a file permanently. Unknown support, evidence or ownership blocks the item.

## Constitution Check

Pre-research gate: pass. Post-design recheck: pass.

- I Local-first custody: originals change only through a reviewed and approved transfer, which retires a source only after its destination and every reference verify. Hash manifests before and after every scenario prove it.
- II Reviewable mutation: every Trash move, copy, link and reference repair belongs to a durable reviewed plan. Each attempted action records its intent and outcome as a StorageItem row. Collisions never overwrite and removal always goes to the OS Trash. Recognition evidence names its PREP rule and profile, as the inference clause requires.
- III PixInsight boundary: STO moves and removes files and adds no image processing.
- IV Research-led modeling: research.md compares alternatives for Trash, transfer, reference repair, layout, retirement and retry and records defaults.
- V Portable contracts: [contracts/storage.md](contracts/storage.md) is a versioned language-neutral command contract with reviews, revisions, operation status and errors. STO rows are Tier 1 intent and outcome records.
- Product constraints: walks and Trash moves never follow links. The protected categories and cleanup groups in [data-model.md](data-model.md) are fixed before any cleanup plan exists. After an unclean shutdown, open marks unfinished items uncertain and `Storage::recover` records observations only; the user resumes through retry. STO adds no write-ahead journal beyond these intent and outcome rows.

The all-human-gate waiver leaves analysis, tests, independent review and Sniff mandatory.

## Project Structure

### Documentation

```text
specs/071-storage-custody/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── storage.md
│   └── modules.md
└── checklists/requirements.md
```

No `tasks.md`: executable task state lives under the molecule implement step in Beads.

### Source

- `crates/platevault-model/src/storage.rs`: shared STO types and input validation, re-exported from `lib.rs`.
- `crates/persistence/library/src/storage.sql` and `src/storage.rs`: STO tables, reviews, phases, claims, asset repoint, View custody facts and duplicate groups. `lib.rs` wires the module, the schema version and the scan, retire, remap and recovery interplay.
- `crates/platevault-core/src/custody_fs/`: OS Trash, destination writes, reference repair, volume status and no-follow walks.
- `crates/platevault-core/src/custody.rs`: pure groups, preselection, proof, blockers, layout and reference plans.
- `crates/platevault-core/src/storage.rs`: the `Storage` service; `library.rs` opens it and exposes `Library::storage()`.
- `apps/desktop/src-tauri/src/commands/storage_custody.rs`: the eleven `storage_*` handlers, registered in `library_shell.rs` with the progress event.
- Tests: `crates/persistence/library/tests/storage.rs` and `crates/platevault-core/tests/{custody.rs,custody_fs.rs,trash.rs,storage_cleanup.rs,storage_transfer.rs,storage_overview.rs}`.

[contracts/modules.md](contracts/modules.md) defines signatures and file ownership.

## Independent units and integration

STO starts after 066, 068, 069 and 070 land, from a recorded commit that holds their catalog reads. The foundation owner lands the model types, their validation and the core manifest first. The catalog, filesystem and policy units then work in separate linked worktrees from that recorded commit. None edits the model or another unit's files. The integration owner waits for all three and owns `storage.rs`, `library.rs`, IPC, the composed tests and the shell wiring.

Workers skip repository-wide builds, tests, lint and formatters. The lead runs the focused STO tests and one integrated workspace verification, then exact-head independent review and Sniff. Original hashes are checked before and after. PREP (069) verifies Open refusal after removal and after an archive disconnects, which completes STO-AC-07. The Cleanup, Archive, Filing and Storage surfaces and J27, J28 and J30 stay open on the final-frontend acceptance task. After five failed fixes, an issue gets a reproducible backlog entry, never a stub.

## Complexity Tracking

STO tables join the library catalog crate, because a phase commit must repoint an asset and swap its claims in one transaction. STO implements the macOS and Linux Trash moves itself instead of calling `trash` 5.2. That crate discards the macOS resulting URL that proves where the item went. On Linux it may copy through a link across devices. Path claims add a check to scans, but without them a scan could index a half-written destination or a source awaiting retirement.
