# Implementation Plan: Inbox Mixed-Folder Split

**Branch**: `005-inbox-mixed-folder-split` | **Date**: 2026-05-20 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/005-inbox-mixed-folder-split/spec.md`

## Summary

Detect whether each Inbox folder is single-type or mixed by reading
metadata (FITS/XISF `IMAGETYP`, falling back to filename heuristics with
reduced confidence). Surface a file-level breakdown in the desktop UI.
For mixed folders, generate a reviewable filesystem plan — one plan item
per file — through the existing plan-apply pipeline. For single-type
folders, confirm directly to Inventory. Maintain the invariant that any
Inbox item has at most one open plan at a time.

This feature is a **producer** for the reviewable plan pipeline (spec 017
+ spec 025) and a **consumer** of the Naming & Structure token pattern
(spec 015). It does not own mutation, audit, or destination semantics.

## Technical Context

**Language/Version**: Rust 1.75+ (core, classifier, plan generator);
TypeScript 5.x + React 18 (desktop UI shell).  
**Primary Dependencies**: Future Rust crates — `crates/metadata/fits`,
`crates/metadata/xisf`, `crates/metadata/core`, `crates/domain/core`,
`crates/app/core`, `crates/fs/planner`, `crates/persistence/db`. Frontend:
existing `apps/desktop/` shell.  
**Storage**: SQLite via `crates/persistence/db` for classification cache,
Inbox item state, and the Inbox→Plan back-reference. Image files remain on
disk per constitution principle I.  
**Testing**: `cargo test --workspace` for crates and contract conformance;
`vitest` for UI hooks; fixture folders for end-to-end classification.  
**Target Platform**: Tauri desktop on Windows, macOS, Linux.  
**Project Type**: Desktop monorepo (Tauri + Rust workspace).  
**Performance Goals**: Classify a 500-file folder in under 2 seconds
(metadata cache hit); generate a 500-item split plan in under 5 seconds
(per SC-004).  
**Constraints**: Local-first, no network calls; lazy/optional hashing;
classifier MUST not modify any image file.  
**Scale/Scope**: Inbox folders up to ~10k files per folder; up to ~200
candidate folders per scan root.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Local-first file custody**: PASS. Classifier reads headers only; no
  files are copied into an app-private store. Library roots remain modeled
  separately from relative paths through `crates/fs/inventory`.
- **Reviewable filesystem mutation**: PASS. The only mutation this feature
  triggers is the split plan, which flows through `crates/fs/planner` and
  the existing plan-apply pipeline (spec 017 + 025). No silent overwrites;
  destructive operations route through trash/archive per the planner crate.
- **PixInsight boundary**: PASS. No calibration, debayer, registration,
  integration, drizzle, stacking, or pixel manipulation. Classification
  reads headers only.
- **Research-led domain modeling**: PASS-WITH-RESEARCH. See
  [research.md](./research.md) for FITS header consensus rules, confidence
  thresholds, fallback heuristics, and prior art comparison (PI WBPP file
  classifier, NINA auto-sort).
- **Portable contracts and durable records**: PASS. Two language-neutral
  JSON Schema contracts under `contracts/`. The SQLite database is the
  durable record for Inbox items, classifications, and plan
  back-references. The classification result is reproducible from
  metadata and is therefore a projection, not canonical.
- **Cross-platform path safety**: PASS. The plan generator delegates path
  composition to `crates/fs/planner` and the Naming & Structure pattern
  (spec 015), both of which carry path-safety responsibilities.

No violations identified; Complexity Tracking section is empty.

## Project Structure

### Documentation (this feature)

```text
specs/005-inbox-mixed-folder-split/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── contracts/
│   ├── inbox.classify.json
│   └── inbox.confirm.json
└── tasks.md             # Phase 2 output
```

### Source Code (repository root)

```text
crates/
├── domain/core/                 # InboxClassificationRule, FrameType enum, confidence model
├── metadata/core/               # shared FrameType signal extraction trait
├── metadata/fits/               # FITS IMAGETYP, FILTER, OBJECT readers
├── metadata/xisf/               # XISF equivalents
├── fs/planner/                  # Plan + PlanItem (already planned; consumer)
├── app/core/                    # InboxClassifyUseCase, InboxConfirmUseCase
├── persistence/db/              # Inbox/Classification/PlanLink repositories
└── contracts/core/              # Rust DTOs matching contracts/*.json

apps/desktop/
└── src/features/inbox/          # UI shell (mockup-only today; to be rewired to contracts)

packages/contracts/
└── inbox/                       # generated TS types from contracts/*.json

tests/
├── contract/inbox/              # contract conformance tests
└── integration/inbox/           # fixture-folder end-to-end tests
```

**Structure Decision**: Single Tauri-desktop monorepo using existing crate
boundaries. The classifier lives in `crates/app/core` orchestrating
`crates/metadata/*` adapters; plan generation reuses `crates/fs/planner`.
No new top-level packages.

## Architecture

### Classifier

- Input: `inbox_item_id` and an optional `force_rescan` flag.
- Reads cached metadata when present; falls back to
  `crates/metadata/{fits,xisf}` adapters on miss.
- Frame-type consensus rule (default proposal, validated by research.md):
  - For each file, derive a `FrameType` signal from `IMAGETYP` (strong) or
    filename pattern (weak).
  - Aggregate per-folder: if more than one strong frame-type signal appears
    with count ≥ N, classify `mixed`. Else if a single dominant frame type
    has confidence ≥ threshold, classify `single-type`. Else
    `unclassified`.
- Output: `InboxClassification` with confidence, breakdown, sample files,
  and per-file evidence records.

### Plan Generator

- Driven by the active Naming & Structure token pattern (spec 015),
  resolved once at generation time and recorded on the plan.
- One `PlanItem` per scanned file. Items are grouped by frame type via a
  group key, not by sub-plans — the planner crate stays unaware of frame
  semantics.
- Validates that every token required by the pattern resolves for every
  file. If any file fails, the whole operation fails
  `pattern.unset` / `pattern.unresolved` with no partial plan.

### Store Integration

- `crates/persistence/db` owns:
  - `inbox_items` (one row per scanned folder)
  - `inbox_classifications` (current result, with `force_rescan`
    invalidation)
  - `inbox_plan_links` (Inbox item → open plan id, enforced unique
    where plan state is open)
- The plans publisher (existing in `crates/app/core`, planned alongside
  spec 017) emits state transitions. This feature subscribes to mark Inbox
  items resolved on `applied`, and to release the open-plan lock on
  `discarded`/`failed`.

### Future Rust Crate Mapping

| Concern | Crate |
|---|---|
| FITS header reads (IMAGETYP, FILTER, OBJECT) | `crates/metadata/fits` |
| XISF header reads | `crates/metadata/xisf` |
| Shared FrameType + confidence model | `crates/metadata/core` |
| Classification rule + invariants | `crates/domain/core` |
| Orchestration use cases | `crates/app/core` |
| Plan items + grouping | `crates/fs/planner` |
| DTOs for contracts | `crates/contracts/core` |
| SQLite persistence | `crates/persistence/db` |

### Contract Surface

- `inbox.classify` — idempotent unless `force_rescan: true`.
- `inbox.confirm` — only valid action depends on classification:
  `action: "split"` for `mixed`, `action: "confirm"` for `single-type`.

## Complexity Tracking

No constitution violations; no entries.
