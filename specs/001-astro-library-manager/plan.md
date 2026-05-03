# Implementation Plan: Astro Library Manager

**Branch**: `001-astro-library-manager` | **Date**: 2026-05-03 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/001-astro-library-manager/spec.md`

**Note**: This plan stops at SpecKit planning artifacts. It does not authorize
application implementation beyond scaffold maintenance required by the SpecKit
workflow.

## Summary

Astro Library Manager is a local-first cross-platform desktop GUI for indexing
astrophotography libraries, modeling immutable acquisition sessions and
independent reusable calibration data, creating app-owned processing project
envelopes, preparing PixInsight/WBPP and planetary/lunar source views, observing
tool-managed processing artifacts, and generating reviewed filesystem
archive/cleanup plans with audit history.

The recommended v1 architecture is a Tauri 2 desktop shell with React UI,
Rust domain/core crates, SQLite persistence, generated JSON/Markdown project
manifests as protected documentation, and a language-neutral operation contract
that is transported through Tauri commands initially but can later be exposed by
HTTP or another backend without rewriting UI workflow logic.

## Technical Context

**Language/Version**: Rust 2021 edition; TypeScript/React for the GUI; JSON
Schema 2020-12 compatible contracts for shared payloads.

**Primary Dependencies**: Tauri 2 shell; React frontend; Rust crates split by
domain, metadata, filesystem, calibration, persistence, contracts, workflow
profiles, targeting, sessions, project structure, and audit; SQLite library to
be selected during implementation; frontend validation library to be generated
from or checked against JSON Schema, with Zod as the likely UI-side validator.

**Storage**: SQLite for canonical local metadata, relationships, rules,
operation state, lifecycle, cleanup policy, and audit history. Image files remain
in user-selected library roots or project folders. Generated manifests and
source views are durable projections, not canonical records.

**Testing**: `cargo fmt --all --check`, `cargo clippy --workspace --all-targets -- -D warnings`,
`cargo test --workspace`; frontend type/lint/test commands once the React app is
created; fixture-based filesystem tests using temp roots and platform-specific
link behavior; contract schema validation tests; migration tests for SQLite
schema versions.

**Target Platform**: Windows, macOS, and Linux desktop. Windows is a first-class
target because the motivating library root is under `D:\Astrophotography`.

**Project Type**: Local-first desktop application with a Rust core and GUI
frontend, organized as a monorepo to preserve room for future contract packages,
CLI/admin tools, backend services, and infrastructure without coupling v1 to a
remote backend.

**Performance Goals**: Index at least 100,000 filesystem items in an initial
non-mutating scan; keep large-file hashing optional/lazy; keep long-running scan,
metadata extraction, matching, and plan application progress visible and
recoverable; avoid reading pixel payloads unless a later decision requires it.

**Constraints**: No image processing; no unreviewed filesystem mutation; no
silent overwrite; database is canonical; acquisition sessions immutable; app
owns the outer project structure but selected processing-tool workspaces inside
remain tool/user-managed; symlink/junction traversal disabled by default; roots
stored separately from relative paths.

**Scale/Scope**: Single-user local library management in v1; multiple roots and
external/removable drives; deep-sky, mosaic, planetary, lunar, solar, and
landscape workflow awareness; future remote API/sync preserved as an extension
path rather than v1 scope.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- Local-first file custody: PASS. The plan keeps actual image files on disk,
  stores root identity separately from relative paths, and treats manifests and
  source views as projections.
- Reviewable filesystem mutation: PASS. All move, copy, link, archive, trash,
  delete, generated manifest, and source view actions go through filesystem
  plans, explicit approval, preconditions, conflict checks, and audit entries.
- PixInsight boundary: PASS. PixInsight/WBPP and selected planetary/lunar tools
  remain responsible for processing; the app only prepares inputs, observes
  artifacts, documents decisions, and plans cleanup.
- Research-led domain modeling: PASS. Research decisions are captured in
  `research.md`; defaults remain configurable where workflows legitimately vary.
- Portable contracts and durable records: PASS. UI workflows target a
  language-neutral operation catalog and JSON Schema payloads, with Tauri as the
  first transport adapter.
- Cross-platform path safety: PASS. Path, root, link, junction, case, invalid
  character, long path, external drive, and optional hashing rules are explicit
  design topics.

## Project Structure

### Documentation (this feature)

```text
specs/001-astro-library-manager/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── api-strategy.md
│   └── operation-catalog.md
├── checklists/
│   └── requirements.md
└── tasks.md
```

### Source Code (repository root)

```text
apps/
└── desktop/
    ├── package.json
    ├── src/
    │   ├── app/
    │   ├── components/
    │   ├── features/
    │   ├── routes/
    │   └── services/
    └── src-tauri/
        ├── Cargo.toml
        └── src/
            ├── commands/
            └── lib.rs

packages/
└── contracts/
    ├── package.json
    └── src/

crates/
├── app/core/
├── audit/
├── calibration/core/
├── contracts/core/
├── domain/core/
├── fs/
│   ├── inventory/
│   └── planner/
├── metadata/
│   ├── core/
│   ├── fits/
│   ├── video/
│   └── xisf/
├── persistence/db/
├── project/structure/
├── sessions/
├── targeting/
└── workflow/profiles/

tests/
├── contract/
├── fixtures/
├── integration/
└── filesystem/
```

**Structure Decision**: Use a monorepo with a granular Rust workspace and
separate TypeScript package workspace. Rust packages are nested by family where
that improves navigation (`metadata/*`, `fs/*`, `calibration/core`,
`project/structure`) while remaining normal Cargo workspace members. Avoid
repo-name prefixes in crate names; package context already provides the product
namespace. This keeps unit tests smaller, prevents metadata/video/FITS/XISF
dependencies from leaking into every crate, and leaves room for future CLI,
service, sync, or infrastructure packages.

## Complexity Tracking

No constitution violations are required. The main complexity is deliberate:
filesystem safety, contract portability, and domain modeling are core product
requirements rather than optional abstractions.

## Phase 0 Research Outputs

See [research.md](./research.md). Decisions cover desktop stack, monorepo crate
layout, supported conceptual model, project structure ownership, metadata
extraction, calibration matching, source view strategy, PixInsight artifact
observation, cleanup protection, lifecycle states, manifest strategy,
cross-platform path safety, contract portability, and workflow profiles.

## Phase 1 Design Outputs

See [data-model.md](./data-model.md), [contracts/api-strategy.md](./contracts/api-strategy.md),
[contracts/operation-catalog.md](./contracts/operation-catalog.md),
[quickstart.md](./quickstart.md), [ux-workflows.md](./ux-workflows.md),
[milestones.md](./milestones.md), and [risk-register.md](./risk-register.md).

## Post-Design Constitution Check

- Local-first file custody: PASS. Data model separates `LibraryRoot` from
  relative item paths and keeps all image data outside app-private storage.
- Reviewable filesystem mutation: PASS. `FilesystemPlan`, `PlanItem`,
  `PlanApproval`, and `AuditLogEntry` are first-class entities and contract
  operations.
- PixInsight boundary: PASS. `WorkflowProfile` and `ProcessingArtifact` model
  PixInsight/WBPP and planetary/lunar tool behavior without processing images.
- Research-led domain modeling: PASS. Decisions remain documented and tradeoffs
  are visible for defaults versus configurable policy.
- Portable contracts and durable records: PASS. The contract strategy uses
  language-neutral schemas and a transport adapter layer instead of binding
  React components directly to Tauri commands.
- Cross-platform path safety: PASS. Filesystem entities model path kind,
  root-relative paths, link identity, platform capabilities, and operation
  preconditions.

## Next Phase

Run the SpecKit tasks phase only after reviewing these planning artifacts:

```bash
/speckit.tasks
```

Implementation should not begin until generated tasks are reviewed and accepted.
