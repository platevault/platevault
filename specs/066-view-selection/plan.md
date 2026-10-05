# Implementation Plan: View workspace: session selection, frame membership, quality decisions, refresh

**Branch**: `066-view-selection`
**Spec**: [066-view-selection](spec.md)
**Date**: 2026-10-05

## Summary

Implement the VSEL contract on the rebuilt 064 backend after the 065 Project backend lands. A View is a Tier 1 catalog record with a name, an origin and an optional Project. Its optional profile is a PREP handoff setting that the View shows. A View holds immutable committed membership revisions and at most one durable draft.

- Membership is exact: selected sessions with their reasons, and logical captures with their recorded copies, each included or excluded with a reason.
- Geometry suggestions come from frame footprints built with target-match over observed pointing, orientation and field of view. OBJECT never takes part.
- Saving, refreshing and preparing change no library quality. Quality actions run only through scoped confirmations that call the existing library and Project writers.

[Research](research.md) records the source evidence, the cross-spec seams S1 to S6 and the conservative defaults R1 to R30.

## Technical context

- Language: Rust workspace toolchain, edition 2021, on `platevault_model`, `platevault_core`, `persistence_library` and `desktop_shell`. Work starts from the integrated 065 commit.
- Dependencies: existing workspace crates. Geometry uses target-match 0.5.1 `SkyFootprint`, `compare_footprints` and `is_framed`, with the skymath 0.6 that target-match re-exports. The plan adds no crate or dependency.
- Storage: the library catalog at the next schema version after its dependencies (R1). View tables live in `views.sql`. Every user decision goes through the one FULL-synchronous serialized writer. The catalog refuses an older schema version, and a development catalog is reset. The plan imports no legacy prepared or source View data.
- Platform: the isolated Tauri 2 library shell on macOS, Windows and Linux. Host proof is macOS; other-platform gates stay explicit.
- Testing: failing-first behavior tests with generated FITS and XISF frames in the test files listed under Source. After integration the lead runs `cargo test --workspace`, `just db-boundary` and the dev-surface guard. Real development Tauri MCP scenarios follow.
- Performance: candidate and membership reads use one reader transaction over catalog rows. They read no source bytes and start no rehash or measurement. A cheap centre-separation bound limits polygon overlap work to sessions near the framing (R7). The plan assumes desktop-scale libraries of hundreds of sessions and tens of thousands of frames.
- Constraints: SQL stays under `crates/persistence`. Geometry, filtering and summaries are pure core functions. Committed revisions never change. Integer microsecond sums decide totals, and unknown evidence stays explicit.

## Constitution check

Pre-research gate: pass. Post-design recheck: pass.

- I Local-first custody: View commands write no image file. Only the scoped quality action reads source bytes, through the library's read-only hashing. Hash manifests before and after every scenario prove it.
- II Reviewable mutation: the feature adds no filesystem mutation. Creating or saving a View creates no folder.
- III PixInsight boundary: the feature adds no image processing. Footprints are header geometry, and sky coverage shows footprints without stitching.
- IV Research-led modeling: research.md compares alternatives for drafts, immutability, geometry, overlap, pinning, refresh and quality scope, and records defaults.
- V Portable contracts: [contracts/views.md](contracts/views.md) is a versioned language-neutral command contract with revisions and errors. View, draft, revision, session-choice and member rows are Tier 1. They commit synchronously before acknowledgment. Summaries and candidate evidence are recomputed and never stored as totals.

The all-human-gate waiver leaves analysis, tests, independent review and Sniff mandatory.

## Project structure

### Documentation

```text
specs/066-view-selection/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── views.md
│   └── modules.md
└── checklists/requirements.md
```

No `tasks.md`: executable task state lives under the molecule implement step in Beads.

### Source

- `crates/platevault-model/src/view.rs`: shared View types, input validation and the D02 initial-membership rule, re-exported from `lib.rs`.
- `crates/persistence/library/src/views.sql` and `src/views.rs`: View tables, immutability triggers, draft and save CAS, membership and candidate reads, scoped quality writes, refresh reviews and asset references. `lib.rs` wires the module and the schema version.
- `crates/platevault-core/src/view_geometry.rs`: pure frame footprints, field-of-view provenance and overlap evidence.
- `crates/platevault-core/src/view_selection.rs`: pure candidate filters, sorting, paging, preselection, summaries and refresh differences.
- `crates/platevault-core/src/library.rs`: the `Library::*view*` operations, the registered `ViewReferences` source and the `views` field of `project_detail`.
- `apps/desktop/src-tauri/src/commands/view_selection.rs`: the eighteen `view_*` handlers, registered in `library_shell.rs`.
- Tests: `crates/persistence/library/tests/views.rs`, and `crates/platevault-core/tests/{view_geometry.rs,view_selection.rs,view_library.rs}`. The LIB-AC-16 retire test in `crates/platevault-core/tests/library.rs` replaces its fake fixed View membership with a real View.

[contracts/modules.md](contracts/modules.md) defines signatures and file ownership.

## Owned interaction steps

| Step | Backend evidence | UI evidence |
| --- | --- | --- |
| B4 | `view_create` from a Project, a Target and Sessions | Deferred frontend |
| C1 | One draft shared by every read; `view_update_details` | Wizard-free movement, deferred |
| C2 | Preselection and per-candidate evidence | Deferred |
| C3 | FOV provenance, pointing-only and Position unknown classes | Deferred |
| C4 | `view_candidates` filters, chips data, sorting and Not measured | Deferred |
| C5 | Selection reasons, summary, Save and Clear selection | Sky linkage, deferred |
| C6 | Unresolved sources with reconnect, locate and remove | Deferred |
| D4 | `view_set_frames` exclusion and restore | Deferred |
| D5 | `view_quality_scope` and `view_apply_quality` | Deferred |
| G | `view_refresh` and `view_apply_refresh` | Deferred |
| Missing OBJECT, Missing geometry, Selection hidden by filters | Candidate filters and evidence classes | Deferred |
| View review surface host | `view_detail` and open choices | Deferred |

## Independent units and integration

The foundation owner first lands the model types, the D02 rule and the fixture geometry writers. The geometry unit and the catalog unit then work in separate linked worktrees from that recorded commit. The selection unit starts once the geometry unit lands. No unit edits the model or another unit's files. The integration owner waits for the catalog and selection units. It owns `library.rs`, the reference registration, IPC, the composed tests and the shell wiring.

Workers skip repository-wide builds, tests, lint and formatters. The lead runs the focused View tests and one integrated workspace verification, then exact-head independent review and Sniff. The lead checks original hashes before and after.

PREP (069) verifies the prepared-revision and external-input parts of VSEL-AC-05 and VSEL-AC-12. CAL (068) and PIX (067) verify their areas of the shared workspace. The View review surface and the J20 S8, J21, J22 S8 to S13a and S16, and J25 steps stay open on the final-frontend acceptance task. After five failed fixes, an issue gets a reproducible backlog entry, never a stub.

## Complexity tracking

View tables join the library catalog crate instead of a new persistence crate. A save, a scoped quality write and a refresh apply must check sessions, assets, quality and Project rows in one transaction with the crate's private helpers. A second crate would need a second writer connection or public library internals. Geometry stays in the application core, because persistence never depends on target-match.
