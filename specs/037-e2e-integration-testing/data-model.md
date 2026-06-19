# Data Model: End-to-End & Integration Testing

**Feature**: 037-e2e-integration-testing
**Phase**: 1 (Design)

This feature adds no product data. The "data model" here is the **test domain**:
the entities the test suites and coverage tracking operate on.

## Test-domain entities

### Implemented Feature Area
- **Fields**: id (#), name, source specs, requires-Layer-2-smoke (bool).
- **Source of truth**: research.md D7 table.
- **Relationship**: 1 area → 1..N integration tests; primary areas → 1 Layer-2
  journey (often shared across several areas).

### Integration Test (Layer 1)
- **Fields**: name, feature-area ref, exercised use case(s), fixtures used,
  network-boundary stub (bool), assertions.
- **Rules**: provisions an isolated file-backed SQLite DB in a fresh tempdir with
  migrations applied; no shared/leftover state (FR-004); deterministic offline
  (FR-003, SC-006).
- **Location**: crate `tests/` dirs (`app/core`, `persistence/db`, relevant
  feature crate). Do **not** use the repo-root `tests/integration/` dir — it
  already holds Playwright mock-UI specs (TypeScript); keeping Rust Layer-1 in
  crate `tests/` dirs avoids the collision.

### End-to-End Journey (Layer 2)
- **Fields**: name, screens visited, action(s), round-trip assertion (bool),
  mutation+audit assertion (bool), platforms (linux/windows[/macos best-effort]).
- **Rules**: drives the freshly built app (FR-006) via real UI; resets the app DB
  before run; at least one journey asserts a UI→backend round trip (FR-008) and at
  least one asserts a real filesystem mutation + audit record (FR-009); destructive
  ops only inside disposable test locations (FR-016).
- **Location**: `apps/desktop/e2e/real-backend/*.spec.ts`.

### Supported Platform
- **Values**: linux, windows, macos.
- **Rules**: Layer 1 required on all three; Layer 2 required on linux+windows,
  best-effort/non-blocking on macos (research D4); a platform that cannot drive the
  UI reports Layer-2 not-applicable explicitly, never a false pass (FR-013).

### Test Fixture / Disposable Test Data
- **Fields**: kind (sqlite-db | temp-fs-tree | simbad-response | fits-header-sample),
  location (tempdir), lifecycle (created per run/test, discarded after).
- **Rules**: never references real user libraries; cleaned up regardless of
  pass/fail.

### Coverage Mapping
- **Fields**: feature-area ref → [test refs], layer(s), gap? (bool).
- **Source of truth**: `contracts/coverage-matrix.md`.
- **Rules**: every implemented feature area maps to ≥1 test or is flagged as an
  explicit gap (FR-002, FR-019, SC-001) — never silently absent.

### Audit Record (asserted, not defined here)
- The existing durable audit record produced by mutating operations; Layer-2
  mutation journeys assert its presence (FR-009). No schema change.

### Seeded Regression (validation artifact, D8)
- **Fields**: target behavior, mutation description, expected failing test,
  observed result.
- **Rules**: introduced temporarily during implementation, reverted after; recorded
  in implementation notes (SC-007). Not committed as product code.

## Isolation & determinism model

- **Layer 1**: one tempdir + one SQLite file per test (or per test module with
  per-test transactions/cleanup); migrations applied fresh; SIMBAD via `wiremock`
  on localhost. No ordering dependence.
- **Layer 2**: app DB at the OS-specific app-data path reset in `beforeAll`;
  sequential execution (`fullyParallel: false`, already in the 033 config);
  append-only unique IDs per test to avoid collisions.

## State transitions

None introduced. Tests assert existing lifecycle/state transitions
(`crates/domain/core`, `app_core::transition_use_case`) behave correctly through
the real stack.
