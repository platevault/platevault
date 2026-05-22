# Implementation Plan: Calibration Matching Rules

**Branch**: `007-calibration-matching-rules` | **Date**: 2026-05-20 | **Spec**: `specs/007-calibration-matching-rules/spec.md`
**Input**: Feature specification from `/specs/007-calibration-matching-rules/spec.md`

## Summary

Introduce a calibration matcher in `crates/calibration/core/` that takes a
light session as input, reads candidate calibration masters from persistence,
applies type-specific rules (dark, flat, bias), and returns ranked
`CalibrationMatch` records with confidence and dimension breakdown. The
desktop UI consumes this via two contracts — `calibration.match.suggest` and
`calibration.match.assign` — surfaced inside the project-detail accordion
defined in spec 008. Settings continue to live in the existing UI but become
durable inputs to the matcher rather than dead-end controls.

## Technical Context

**Language/Version**: Rust 1.75+ for crates; TypeScript 5.x for desktop UI consumption.
**Primary Dependencies**: workspace-local crates only (`crates/sessions`,
`crates/metadata/core`, `crates/persistence/db`). No new heavy deps.
**Storage**: SQLite via `crates/persistence/db` for masters, matching rule
configuration, and persisted assignments.
**Testing**: `cargo test --workspace` for matcher logic; contract tests against
JSON Schemas in `packages/contracts/`.
**Target Platform**: Local desktop (Tauri host process); matcher runs in-process.
**Project Type**: Multi-crate Rust workspace with Tauri React shell.
**Performance Goals**: Matcher returns ranked list for a single session in
under 200ms when fewer than 1k candidate masters are stored.
**Constraints**: Matcher MUST be pure-domain — no filesystem reads, no header
parsing inline. All inputs arrive as already-extracted metadata.
**Scale/Scope**: First release targets libraries with up to ~10k masters.

## Constitution Check

- **Local-first file custody**: Pass. Matcher reads metadata records, never
  copies image files. Library roots remain user-owned.
- **Reviewable filesystem mutation**: Pass. Matcher emits no filesystem
  changes; assignments are database records only.
- **PixInsight boundary**: Pass. No calibration application, no integration,
  no debayer. Output is a recommendation surface.
- **Research-led domain modeling**: Pass. Matching dimensions, tolerances,
  and override policy are documented in `research.md`.
- **Portable contracts and durable records**: Pass. Two JSON Schema contracts
  define the UI-to-core surface; assignments persist in SQLite.
- **Cross-platform path safety**: N/A — matcher does not touch paths.

## Project Structure

### Documentation (this feature)

```text
specs/007-calibration-matching-rules/
├── plan.md
├── research.md
├── spec.md
├── data-model.md
├── contracts/
│   ├── calibration.match.suggest.json
│   ├── calibration.match.suggest.batch.json  # R-Batch: v1 batch suggest
│   └── calibration.match.assign.json
└── tasks.md
```

**Spec 008 dependency**: The project-detail accordion in spec 008 must respect
`MatchingRuleConfig.prefill_suggestion` when opening the assign dialog. The
batch suggest contract (`calibration.match.suggest.batch`) is the recommended
call for project-level calibration preparation (spec 008 uses it for
project-wide calibration). See research.md R5 for the loop-closing rule.

### Source Code (repository root)

```text
crates/calibration/core/
├── src/
│   ├── lib.rs                  # public API: Matcher trait, MatcherConfig
│   ├── rules/
│   │   ├── mod.rs
│   │   ├── dark.rs             # P1: dark rules + tolerances
│   │   ├── flat.rs             # P2: flat rules + observing-night logic
│   │   └── bias.rs             # P3: bias rules
│   ├── candidate.rs            # CalibrationMatch + dimension types
│   ├── ranking.rs              # confidence + ordering
│   └── assign.rs               # P4: override + persistence handoff
└── tests/
    ├── dark_matching.rs
    ├── flat_matching.rs
    ├── bias_matching.rs
    └── override.rs

crates/contracts/core/
└── src/calibration_match.rs    # Rust DTOs mirroring JSON Schemas

packages/contracts/
└── schemas/
    ├── calibration.match.suggest.json
    └── calibration.match.assign.json

crates/persistence/db/
└── migrations/00X_calibration_matches.sql

apps/desktop/src/features/calibration/
└── matchPanel.tsx              # consumer of suggest/assign contracts
```

**Structure Decision**: Matcher lives in `crates/calibration/core/` with no
new crates. Rules are submodules to keep per-type changes isolated and unit-
testable. Persistence and adapter wiring stay in their existing crates.

## Complexity Tracking

No constitution violations. No complexity entries required.
