# Implementation Plan: Application preparation and handoff

**Branch**: `069-application-handoff-plan`
**Spec**: [069-application-handoff](spec.md)
**Date**: 2026-10-05

## Summary

Implement the PREP contract on the rebuilt 064 backend after 066 View selection and 068 calibration land. A reviewed View membership revision becomes a durable preparation review and then a journaled preparation revision in a new View folder. Inputs arrive as Linked (symlink or explicitly chosen hardlink), Direct-source, Copy or supported Clone entries, with isolated patched copies for catalog corrections. Every effect is bound to the reviewed identity and a SHA-256 taken at the effect, and nothing is removed or overwritten. Profiles for PixInsight/WBPP, Siril and SETI Astro Suite Pro claim only cited capability evidence; generic Open in... never claims a profile. Open re-verifies every input, launches the located executable without a shell and never marks processing or the View complete. [Research](research.md) records the source evidence, the cross-spec seams S1 through S7 and the conservative defaults R1 through R29.

## Technical Context

- Language: Rust workspace toolchain, edition 2021, on the 064 crates `platevault_model`, `platevault_core`, `persistence_library` and `desktop_shell`.
- Dependencies: workspace serde, sqlx SQLite, Tokio, UUID, SHA-256 and time. `platevault_core` adds direct dependencies that already resolve in `Cargo.lock`: `fs4`, `libc` on Unix, `plist` on macOS, and the shared `fits-header` and `xisf-header` packages. `desktop_shell` already depends on `tauri-plugin-opener`.
- Storage: the clean library catalog with PREP tables from `preparations.sql`, at the schema version after 066 and 068 (research R2). One FULL-synchronous serialized writer commits each intent before its filesystem action. An older development catalog is refused and reset; no legacy prepared-view data is imported.
- Platform: desktop Tauri 2 isolated library shell on macOS, Windows and Linux. Host proof is macOS with APFS and FAT32 disk images. Linux and Windows link, clone and permission behavior stay explicit platform gates.
- Testing: failing-first behavior tests with generated FITS/XISF and disposable volumes in the test files listed under Source. After integration, run `cargo test --workspace`, `just db-boundary` and the dev-surface guard. Real development Tauri MCP scenarios follow.
- Performance: review reads catalog rows and no-follow fingerprints and hashes nothing. Prepare and Open hash each input once, off the UI thread, in chunks of up to 16 items per commit. The plan assumes desktop-scale Views of hundreds to a few thousand frames, where hashing dominates.
- Constraints: SQL only under `crates/persistence`. Sources are only read. PREP never deletes, trashes or overwrites a file. Capability claims require cited evidence.

## Constitution Check

Pre-research gate: pass. Post-design recheck: pass.

- I Local-first custody: sources are opened read-only through the catalog's contained no-follow reader, and every entry lives below a new reviewed View folder. Hash manifests before and after every scenario prove the originals unchanged.
- II Reviewable mutation: each link, copy, clone, patched copy and handoff file is listed in a durable review before Prepare. Intents and outcomes are Tier 1 rows committed around each effect. Nothing is overwritten, and PREP removes nothing; replaced entries and leftovers go to STO's reviewed cleanup.
- III PixInsight boundary: PREP writes inputs and launches the user's application; it calibrates, registers, integrates or stretches nothing. A patched copy edits header keywords only and preserves the data unit.
- IV Research-led modeling: research.md compares storage, profile evidence, link eligibility, clone support, patching, layout, cancel and restart choices and records defaults.
- V Portable contracts: [contracts/handoff.md](contracts/handoff.md) is a versioned language-neutral command contract with revisions, errors and long-running operation status. Restart recovery pauses interrupted operations and asks for an explicit Retry, with no userspace journal beyond the Tier 1 intent rows.

The all-human-gate waiver leaves analysis, tests, independent review and Sniff mandatory.

## Project Structure

### Documentation

```text
specs/069-application-handoff/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── handoff.md
│   └── modules.md
└── checklists/requirements.md
```

No `tasks.md`: executable task state lives under the molecule implement step in Beads.

### Source

- `crates/platevault-model/src/handoff.rs`: shared PREP types and input validation, re-exported from `lib.rs`.
- `assets/profiles/profiles.json` and `crates/platevault-core/src/profiles.rs`: the bundled capability manifest and pure capability assessment.
- `crates/persistence/library/src/preparations.sql` and `src/preparations.rs`: PREP tables, writes, CAS, restart recovery, references, the in-transaction running-operation answer and the contained source reader. `lib.rs` wires the module and the next schema version.
- `crates/platevault-core/src/handoff.rs`: pure review planning, folder naming and the handoff-file renderer.
- `crates/platevault-core/src/destination.rs` and `src/materialize.rs`: read-only destination probes and the no-removal materializer.
- `crates/platevault-core/src/launch.rs`: executable observation, argument rendering and detached launch.
- `crates/platevault-core/src/preparation.rs` and `src/library.rs`: the `Preparations` supervisor and the registered `PreparationReferences` source.
- `apps/desktop/src-tauri/src/commands/application_handoff.rs`: the `prep_*` handlers, registered in `library_shell.rs` with the `prep_progress` bridge and Reveal.
- Tests: `crates/persistence/library/tests/preparations.rs`, and `crates/platevault-core/tests/{profiles.rs,handoff_plan.rs,materialize.rs,launch.rs,preparation_library.rs}`. The retire test in `crates/platevault-core/tests/library.rs` gains a real preparation source.

[contracts/modules.md](contracts/modules.md) defines signatures and file ownership.

## Independent units and integration

The foundation owner lands the model types, validation and manifests first. The profile, catalog, planner, filesystem and launcher units then work in separate linked worktrees from that recorded commit. None edits the model or another unit's files. The qualification unit researches real profile evidence in parallel and changes only the bundled manifest. The integration owner waits for every unit and owns `preparation.rs`, `library.rs`, the reference registration, IPC, the composed tests and the shell wiring.

Workers skip repository-wide builds, tests, lint and formatters. The lead runs the focused PREP tests and one integrated workspace verification, then exact-head independent review and Sniff. Original hashes are checked before and after. RES (070) verifies the Mark Complete refusal during a Running preparation, and STO (071) verifies removal of replaced entries. The preparation surface UI and J23/J24 steps stay open on the final-frontend acceptance task. After five failed fixes, an issue gets a reproducible backlog entry, never a stub.

## Complexity Tracking

PREP tables join the library catalog crate instead of a new persistence crate, because review, start and finish read assets, locations, View revisions and calibration in one snapshot through the crate's writer and contained reader. Filesystem effects stay in `platevault_core`, so the persistence crate keeps opening sources only for reading. The legacy `fs_executor` link primitive is not adopted: it copies without destination verification, takes UTF-8-only paths and depends on legacy `domain_core`.
