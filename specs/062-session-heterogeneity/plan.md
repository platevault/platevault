# Implementation Plan: Immutable Session Heterogeneity and Grouping

**Branch**: `spec/062-session-heterogeneity-artifacts` | **Date**: 2026-07-21 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/062-session-heterogeneity/spec.md`

## Summary

Replace mutable, folder-influenced session accumulation with immutable,
operation-scoped session snapshots and explicit, reviewable relationships.
Every confirmed light session belongs to a stable PanelGroup, including a
singleton group. Same-panel siblings and mosaics are represented by immutable
group revisions with stable lineage; accepting a later relation creates a new
revision and never changes an accepted session or a project's exact session
membership.

Projects may discover related sessions and use an additive Update View plan
while processing, but completed and archived projects remain locked.

The implementation keeps SQLite as the durable source of truth, decomposes
relationship JSON into normalized tables, uses optimistic head checks inside
short `BEGIN IMMEDIATE` transactions, and uses recursive CTEs for bounded
lineage and topology queries. A generic session-materialization operation has
Inbox-ingestion and metadata-reclassification subtypes. Capture metadata is
normalized through a versioned embedded profile registry while preserving raw
evidence. Geometry is provided by the upstream skymath and target-match work,
with exact spherical footprint, overlap, residual-rotation, and mosaic-union
semantics.

Calibration sessions use distinct camera-library and optical-train policies;
native master construction stays outside this feature and DarkFlat remains
detected but unreachable in product workflows.

## Technical Context

**Language/Version**: Rust 2021; TypeScript 5.8; React 19

**Primary Dependencies**: Tauri 2.11, sqlx 0.9 with SQLite, Specta 2 release
candidate, Tokio 1, React Query 5, React Router 1, Zod 4

**Storage**: Local SQLite in WAL mode through `crates/persistence/core`; normalized
session, equipment, revision, relation, proposal, immutable project-membership,
command-ledger, audit, outbox, and materialization-extension tables; user-owned
image files remain in place

**Testing**: Rust unit and integration tests through cargo-nextest; SQL
invariant, migration, `EXPLAIN QUERY PLAN`, WAL, CAS, and contention tests;
Vitest and Testing Library; Playwright and real-backend Tauri journeys; a
deterministic generated full-scale SQLite acceptance harness

**Target Platform**: Cross-platform local desktop application on Windows,
macOS, and Linux

**Project Type**: Rust workspace with a Tauri desktop shell and React frontend

**Performance Goals**: Warm common list, filter, detail, and normal revision
acceptance p95 at or below 250 ms; relationship discovery p95 at or below 500
ms excluding FITS/WCS/catalog/file work; a 1,000-node/5,000-edge preview p95 at
or below 1 s; a 10,000-node/50,000-edge traversal at or below 5 s; full stress
acceptance at or below 1 s; Spec 062 startup delta p95 at or below 250 ms

**Constraints**: Offline and local-first; immutable accepted session membership;
no automatic mutation of projects or accepted group revisions; no folder path
or display name in identity; no graph database or in-memory graph mirror; no
native stacking; every mutation is reviewed, auditable, idempotent, and
collision-safe; DarkFlat stays unreachable

**Scale/Scope**: 100,000 sessions, 10 million frame memberships, 500,000
immutable group/mosaic revisions, and 2 million normalized topology and lineage
rows; ordinary 1,000/5,000 and pathological 10,000/50,000 connected components

## Constitution Check

*GATE: Passed before Phase 0 research and rechecked after Phase 1 design.*

- **I. Local-First File Custody — PASS**: session and grouping records refer to
  existing image files; no raw image copy or private application store is
  introduced.
- **II. Reviewable Filesystem Mutation — PASS**: grouping itself is metadata-only;
  project materialization uses the existing reviewable plan/apply pipeline,
  refuses known collisions before writing, journals successful items from
  runtime failures, and emits audit records.
- **III. PixInsight Boundary — PASS**: calibration selection prepares an external
  WBPP/Siril/PixInsight handoff. It neither constructs nor revises masters.
- **IV. Research-Led Domain Modeling — PASS**: session identity, observing-night
  semantics, metadata profiles, calibration matching, geometry, SQLite topology,
  project updates, and scale are recorded in `research.md` before tasks.
- **V. Portable Contracts and Durable Records — PASS**: language-neutral
  contracts define queries, commands, errors, concurrency, and progress. SQLite
  remains canonical; UI projections and source views are reproducible.
- **Product constraints — PASS**: safe-relative paths, approved-root
  containment, no-follow traversal, root remapping, source-fingerprint
  revalidation, lazy hashing, and protected cleanup categories are unchanged.

No constitution violation requires an exception. Implementation remains gated
on reviewed research, data model, contracts, tasks, and the upstream skymath and
target-match capabilities identified in Dependencies.

## Delivery Phases

### Phase 0: Domain foundations and upstream geometry

1. Land the required skymath position-angle transport and gnomonic
   projection/unprojection primitives, including their pole, wrap, horizon,
   and antipodal failure contracts.
2. Land target-match footprint comparison, coverage-derived rotation-interval
   sets, hole-aware unions, object-extent intersection, connected-component
   topology, and deterministic relation evidence. Policy thresholds remain in
   Astro Plan.
3. Add canonical observing-night and acquisition-fingerprint domain types so
   all ingestion and calibration paths share one noon-to-noon implementation.

### Phase 1: Metadata and immutable session persistence

1. Extend FITS/XISF extraction with raw provenance and the metadata needed for
   capture profiles, camera/telescope identity, separate X/Y binning and pixel
   dimensions, readout evidence, ROI evidence, and rotation evidence.
2. Add a versioned embedded capture-profile TOML registry with deterministic
   precedence, aliases/transforms, representative profile IDs, and a generic
   fallback. Preserve the profile version and field-level evidence used.
3. Introduce stable equipment and optical-profile UUIDs with aliases; do not
   distinguish physically identical cameras that expose identical metadata.
4. Add one generic session-materialization operation with Inbox-ingestion and
   metadata-reclassification subtypes. Use the generic command ledger for retry
   identity and the outbox for committed domain events.
5. Materialize sessions once per operation, with immutable frame membership and
   idempotent retry keys. Create each light session's singleton PanelGroup and
   initial accepted revision in the same transaction. Corrections and later
   ingestion create new sessions plus supersession or relation evidence rather
   than appending to an existing session.

### Phase 2: Grouping, calibration, and reviewed proposals

1. Append immutable PanelGroup successor revisions for reviewed same-panel
   siblings and corrections; singleton creation remains in Phase 1.
2. Create immutable Mosaic revisions from PanelGroup revision pins and
   normalized neighbor edges. Use bounded connected components; never infer an
   unbounded transitive match from target/train/zero-rotation alone.
3. Persist proposed, accepted, rejected, and superseded relationships with
   complete matching evidence and versioned settings. Grouping freezes on
   acceptance; later candidates appear as suggestions.
4. Implement dark and bias camera-library families plus calibration sessions,
   and flat sessions keyed by optical train, filter, physical rotation, and
   observing night. Apply exact gain/set-temperature rules, missing-field
   blocking, actual-temperature drift warnings, freshness tiers, and the
   DarkFlat exclusion boundary.
5. Persist immutable external-processing handoff snapshots, requirements,
   selections, reviews, and exact frame identities. Evaluate age from the
   trusted clock, serialize reviewed successor creation by CAS, and require all
   frames in a selected session to be readable and strongly verified before a
   handoff can execute.

### Phase 3: Project pins, Update View, and desktop UX

1. Replace greenfield `project_sources` authority with immutable project-
   membership revisions containing exact session IDs. Derive group and mosaic
   context for display, but never let a group-head change modify project
   membership.
2. Display related sessions and why they matched. Adding a session while a
   project is processing marks the materialized view stale; completed and
   archived projects reject additions.
3. Extend the existing generic plan/apply machinery with Spec 062 plan tables,
   item journals, and completed snapshots. Do not add a parallel filesystem
   executor.
4. Generate an explicit additive Update View plan containing only newly pinned,
   unmaterialized sessions. Refuse known collisions before any write. A runtime
   race or filesystem failure may leave journaled successful items; retry
   recognizes items created by the same operation, and no completed snapshot is
   published until every item succeeds.
5. Preserve old filesystem entries as an immutable historical overlay after a
   correction. The successor processing manifest excludes the predecessor and
   includes the approved replacement without rewriting old entries.
6. Expose singleton, same-panel, sibling, mosaic, relation proposal, freshness,
   warning, rejection, correction, and lineage states without making users
   understand database revisions.

### Phase 4: Scale hardening and release evidence

1. Remove unbounded list and calibration scans and N+1 expansion. Enforce
   maximum page sizes, recursive-query depth and row limits, candidate-set
   bounds, and request resource budgets. Add covering indexes for target,
   camera, group, session, revision, edge, lineage, project, filter, and
   observing-night access paths.
2. Add query-specific plan tests with `PRAGMA automatic_index=OFF` after
   `ANALYZE`. For every session, panel, mosaic, proposal, reclassification,
   calibration, and project list, assert that production SQL begins with its
   documented filter prefix and satisfies the exact cursor order through a
   declared composite index. For topology queries, assert target, camera, group,
   or RTree candidate narrowing before recursive expansion. Reject full scans of
   large bounded tables while avoiding brittle snapshots of complete plan text.
3. Generate the exact full-scale file-backed fixture through production
   migrations. Check in the deterministic generator and manifest, not the
   multi-gigabyte database.
4. Keep PR CI deterministic and timing-free. Run full latency, cancellation,
   concurrency, startup, integrity, and topology acceptance on a named
   reference machine before go-live, publishing raw results tied to the commit.

## Project Structure

### Documentation (this feature)

```text
specs/062-session-heterogeneity/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── README.md
│   ├── calibration-handoff.md
│   ├── inbox-materialization.md
│   ├── matching-settings.md
│   ├── metadata-equipment-reclassification.md
│   ├── projects-related-sessions-update-view.md
│   └── sessions-groups-proposals.md
├── checklists/
└── critiques/
```

Executable work packages and dependencies are child Beads under
`astro-plan-ic9h`. The repository's SpecKit-Beads hook prohibits `tasks.md`, so
the reviewed Beads graph is the sole task decomposition and status source.

The Beads are grouped by independently testable user-story slices through their
`story:usN` labels and `story_scope` metadata. Shared foundation and final-gate
Beads carry every story label they serve; this does not make them independent
story acceptance gates.

| User-story slice | Independently testable outcome | Beads |
|---|---|---|
| US1: immutable Inbox materialization | Mixed input is reviewed, resolved, and materialized into immutable sessions through the accessible real Inbox surface | `.1`, `.2`, `.4`-`.11`, `.23` |
| US2: panel and mosaic relationships | Users review same-panel and mosaic evidence, manual relations, stable revisions, and matching settings | `.1`, `.2`, `.4`, `.6`, `.7`, `.8`, `.11`-`.13` |
| US3: explicit project membership | Related sessions remain suggestions until explicit pinning and additive Update View approval | `.6`-`.9`, `.12`, `.14`-`.16` |
| US4: calibration organization | Dark, bias, and flat sessions expose reviewed family, freshness, warning, and handoff behavior while DarkFlat remains unreachable | `.4`-`.10`, `.17`, `.18` |
| US5: immutable correction | Metadata correction creates replacements, successor topology, project consequences, and immutable overlays | `.5`-`.10`, `.12`, `.14`-`.16`, `.19` |

Shared `.20`-`.22` integration, scale, journey, and exact-head gates serve all
five slices. Each story can pass its focused unit, real-SQLite integration, and
real-backend journey evidence before the shared final gate.

### Source Code (repository root)

```text
crates/
├── metadata/
│   ├── core/                 # normalized metadata, evidence, profile registry
│   ├── fits/                 # FITS header extraction
│   └── xisf/                 # XISF property extraction
├── sessions/                 # immutable identity, observing night, group domain
├── targeting/                # target identity and target-match integration
├── calibration/core/         # calibration family/session rules and warnings
├── persistence/core/
│   ├── migrations/           # normalized greenfield schema
│   ├── src/repositories/     # bounded queries and guarded transactions
│   └── tests/                # invariants, plans, WAL, CAS, contention, scale
├── contracts/core/           # portable request/response/event/error types
├── app/
│   ├── targets/              # ingestion operation and session materialization
│   ├── calibration/          # candidate discovery and external handoff
│   ├── projects/             # exact pins, related sessions, Update View plans
│   ├── settings/             # bounded thresholds and freshness settings
│   └── core/                 # public orchestration facade
└── e2e-tests/                # real-backend lifecycle and UI journeys

apps/desktop/
├── src/features/
│   ├── inbox/                # grouped ingestion review
│   ├── sessions/             # related/group/mosaic and lineage UX
│   ├── projects/             # stale state and additive Update View
│   ├── calibration/          # candidate/freshness/warning UX
│   └── settings/             # bounded matching configuration
└── src-tauri/src/            # portable-contract command adapters only

tests/contract/               # language-neutral schema and compatibility tests
```

**Structure Decision**: Extend the existing layered Rust workspace and desktop
feature boundaries. Domain rules stay out of Tauri commands and React;
persistence stays inside `crates/persistence/core`; portable contracts bridge the
core and desktop. No new service, graph store, or native image-processing layer
is introduced.

## Dependencies and Delivery Gates

- `astro-plan-ic9h.1` supplies the skymath orientation and gnomonic primitives.
- `astro-plan-ic9h.2` supplies target-match footprint and mosaic classification.
- Spec 062 implementation must not approximate or duplicate those primitives
  locally while either dependency is unresolved.
- Before the first dependent Astro Plan branch is reviewed, each upstream Bead
  must record the exact released version and source commit that carries the
  required capabilities. Astro Plan must pin those versions in its lockfile and
  pass compatibility tests for every required geometry API. A PR head or
  unreleased branch does not satisfy this gate.
- Native calibration-master stacking remains in `astro-plan-1zp7` / GitHub
  #1425 and does not relax the external-processor boundary in this plan.
- Conditional graph acceleration remains in `astro-plan-7633` / GitHub #1426.
- Release PR `#1393` is outside this feature and remains held without fresh owner
  authorization.

## Complexity Tracking

No constitutional violation or exceptional architecture is requested. Stable
revision records and normalized topology tables are necessary to preserve
immutable membership, auditability, exact project pins, and bounded relation
queries; a mutable group row or JSON graph would violate those requirements.
