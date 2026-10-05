# Implementation Plan: Optional Projects and capture checklist

**Branch**: `065-project-goals`
**Spec**: [065-project-goals](spec.md)
**Date**: 2026-10-05

## Summary

Implement the PRJ contract on the rebuilt 064 backend. A Project is a Tier 1 catalog record with confirmed Target framing, optional panels, preselection equipment, an ordered checklist, explicit session links and Project-scoped rejections. Progress reuses the library's logical-capture, quality-applicability and D19 verification rules over exactly the linked sessions. It reports captured, library-usable and Project-accepted totals separately. Creating or editing a Project writes catalog rows only; it never changes files, quality, sessions or Views. [Research](research.md) records the source evidence and the conservative defaults R1 through R17.

## Technical Context

- Language: Rust workspace toolchain, edition 2021, on the 064 crates `platevault_model`, `platevault_core`, `persistence_library` and `desktop_shell`.
- Dependencies: existing workspace serde, sqlx SQLite, Tokio, UUID and time. The plan adds no crate or dependency.
- Storage: the clean library catalog at schema version 7 with Project tables from `projects.sql`. One FULL-synchronous serialized writer applies, as for every user decision. A version-6 development catalog is refused and reset; the plan imports no legacy project data.
- Platform: desktop Tauri 2 isolated library shell on macOS, Windows and Linux. Host proof is macOS; other-platform gates stay explicit.
- Testing: failing-first behavior tests with generated FITS/XISF in the four test files listed under Source. After integration, run `cargo test --workspace`, `just db-boundary` and the dev-surface guard. Real development Tauri MCP scenarios follow.
- Performance: progress reads only catalog rows in one reader transaction, never source bytes, and starts no rehash. The plan assumes desktop-scale Projects of tens of sessions and thousands of frames.
- Constraints: SQL only under `crates/persistence`. Exact integer microsecond sums decide met goals. Unknown evidence stays explicit.

## Constitution Check

Pre-research gate: pass. Post-design recheck: pass.

- I Local-first custody: Project commands read no image file and write none. Hash manifests before and after every scenario prove it.
- II Reviewable mutation: this feature adds no filesystem mutation, so no plan or audit operation is needed.
- III PixInsight boundary: the feature adds no image processing.
- IV Research-led modeling: research.md compares alternatives for storage, linkage after regroup, panel coverage, channels, arithmetic and rejection, and records defaults.
- V Portable contracts: [contracts/projects.md](contracts/projects.md) is a versioned language-neutral command contract with revisions and errors. Project, link, checklist and rejection rows are Tier 1 and commit synchronously before acknowledgment. Progress is recomputed and never stored.

The all-human-gate waiver leaves analysis, tests, independent review and Sniff mandatory.

## Project Structure

### Documentation

```text
specs/065-project-goals/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── projects.md
│   └── modules.md
└── checklists/requirements.md
```

No `tasks.md`: executable task state lives under the molecule implement step in Beads.

### Source

- `crates/platevault-model/src/project.rs`: shared Project types and input validation, re-exported from `lib.rs`.
- `crates/persistence/library/src/projects.sql` and `src/projects.rs`: Project tables, writes, CAS, progress basis and asset references. `lib.rs` wires the module and schema version 7.
- `crates/platevault-core/src/projects.rs`: pure checklist evaluation.
- `crates/platevault-core/src/library.rs`: `Library::project_detail` and the registered `ProjectReferences` source.
- `apps/desktop/src-tauri/src/commands/project_goals.rs`: the eight `project_*` handlers, registered in `library_shell.rs`.
- Tests: `crates/persistence/library/tests/projects.rs` with a fixture shared through `tests/support/mod.rs`, and `crates/platevault-core/tests/{projects.rs,project_progress.rs,project_library.rs}`. The LIB-AC-16 retire test in `crates/platevault-core/tests/library.rs` replaces its fake Project source with a real Project.

[contracts/modules.md](contracts/modules.md) defines signatures and file ownership.

## Independent units and integration

The foundation owner lands the model types and validation first. The catalog unit and the checklist unit then work in separate linked worktrees from that recorded commit. Neither edits the model or the other's files. The integration owner waits for both and owns `library.rs`, the reference registration, IPC, the composed tests and the shell wiring.

Workers skip repository-wide builds, tests, lint and formatters. The lead runs the focused Project tests and one integrated workspace verification, then exact-head independent review and Sniff. Original hashes are checked before and after. VSEL (066) and RES (070) verify PRJ-AC-05 View creation and the View and product parts of PRJ-AC-06 and PRJ-FR-07. The Projects surface UI and J20/J22 Project steps stay open on the final-frontend acceptance task. After five failed fixes, an issue gets a reproducible backlog entry, never a stub.

## Complexity Tracking

Project tables join the library catalog crate instead of a new persistence crate. Progress must read assets, sessions, quality and Project rows in one snapshot through the crate's private logical-capture helpers. A second crate would need a second writer connection or public library internals.
