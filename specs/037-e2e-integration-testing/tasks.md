# Tasks: End-to-End & Integration Testing (Full App Coverage)

**Feature**: 037-e2e-integration-testing
**Input**: spec.md, plan.md, research.md (D1–D8), data-model.md, contracts/coverage-matrix.md
**Branch**: `037-e2e-integration-testing`

This feature **is** test infrastructure — "implementation tasks" are the tests,
harnesses, CI, and docs themselves. Paths are repo-relative.

> **Status 2026-06-19**: **US1 (Layer-1) COMPLETE** — all backend feature areas
> (#1–#20, #22) have ≥1 passing real-backend integration test; full workspace 76
> suites ok, 0 failed, 0 ignored. Done: T005, T009–T020, T030. Superseded:
> T001/T003/T006 `wiremock`+fixtures plan replaced by the existing `FakeResolver`/
> `FakeSpawner` test doubles (no new deps). Remaining: US2 (CI), US3 (E2E
> completion + T002/T007/T008), US4/US5 (docs), T036 (regression validation).

**Legend**: `[P]` = parallelizable (different files, no incomplete-task dep).
Story labels map to spec user stories US1–US5.

---

## Phase 1: Setup

- [ ] T001 Add Rust dev-dependencies for the integration layer (`wiremock`, ensure `tempfile`) to the relevant crates' `[dev-dependencies]` in `crates/app/core/Cargo.toml` and `crates/persistence/db/Cargo.toml`
- [ ] T002 [P] Add E2E dev-dependency `better-sqlite3` to `apps/desktop/package.json` (devDependencies) for read-only DB assertions
- [ ] T003 [P] Create shared test-fixture dir `tests/fixtures/` with SIMBAD response samples (success/ambiguous/not-found/error) and a couple of representative FITS-header OBJECT samples, per research D2
- [ ] T004 Decide and document the integration-test tagging mechanism (e.g. a `live`/`network` feature or `#[ignore]` for the one live-SIMBAD test) so the default suite stays deterministic/offline, per research D2 + open items; record in `quickstart.md`

## Phase 2: Foundational (blocking prerequisites)

- [X] T005 Create a Layer-1 test harness helper providing an isolated, file-backed SQLite DB in a `tempfile::tempdir()` with `sqlx::migrate!()` applied and a built `AppState`/`SqliteLifecycleRepository`, in `crates/app/core/tests/support/mod.rs` (or a small `crates/testkit` if cleaner) — per research D1, data-model isolation model
- [ ] T006 [P] Add a `wiremock`-based SIMBAD boundary stub helper (serves the T003 fixtures on localhost) usable by resolver tests, in the test support module — per research D2
- [ ] T007 Replace the placeholder `apps/desktop/e2e/helpers/db.ts` with a real read-only `better-sqlite3` reader resolving the app DB at the OS-specific app-data path (Linux/Windows/macOS), per research D3 + open items
- [ ] T008 Add a fresh-DB reset + freshly-built-binary guarantee to `apps/desktop/e2e/helpers/tauri-app.ts` / `playwright.real-backend.config.ts` (`beforeAll` deletes the app DB; build step before tests), satisfying FR-006 — reuse existing 033 scaffold

**Checkpoint**: Layer-1 harness + SIMBAD stub + E2E DB reader/reset exist. Story phases can begin.

---

## Phase 3: User Story 1 — Real-stack regression safety for every feature area (P1) 🎯 MVP

**Goal**: Every implemented feature area (coverage-matrix #1–22) has ≥1 real-backend integration test against real SQLite, network mocked only at the boundary.
**Independent test**: `cargo test --workspace` provisions real DBs, runs all area tests, deterministic offline; introducing a backend regression fails ≥1 named test.

- [X] T009 [P] [US1] Integration tests for **first-run setup + roots/native FS** (areas #1,#2,#16): register source, validate path, protection defaults — in `crates/app/core/tests/first_run_integration.rs`
- [X] T010 [P] [US1] Integration tests for **inbox split + lifecycle/inventory** (areas #3,#4): classify, split, ledger, transitions — in `crates/app/core/tests/inbox_lifecycle_integration.rs`
- [X] T011 [P] [US1] Integration tests for **calibration matching & masters** (area #5): suggest, batch-suggest, assign — in `crates/app/core/tests/calibration_integration.rs`
- [X] T012 [P] [US1] Integration tests for **sessions** (area #6): list/get/merge/split/transition/calendar — in `crates/app/core/tests/sessions_integration.rs`
- [X] T013 [P] [US1] Integration tests for **projects + lifecycle + manifests/notes** (areas #7,#8,#9): create/onboard/edit, blocked/ready transitions, manifest + note persistence — in `crates/app/core/tests/projects_integration.rs`
- [X] T014 [P] [US1] Integration tests for **processing tool launch + artifact observation** (areas #10,#11): launch wiring with **no real tool invocation** (FR-018), artifact detection — in `crates/app/core/tests/tools_artifacts_integration.rs`
- [X] T015 [P] [US1] Integration tests for **target lookup + identity/history/notes** (areas #12,#13): OBJECT→canonical, identity, notes — in `crates/app/core/tests/targets_integration.rs`
- [X] T016 [P] [US1] Integration tests for **SIMBAD resolution via wiremock boundary** (area #14): resolve/search/settings, cache + offline fallback paths — in `crates/targeting/tests/simbad_resolution_integration.rs`
- [X] T017 [P] [US1] Integration tests for **token pattern builder** (area #15): parse + resolve tokens against real data — in `crates/patterns/tests/pattern_integration.rs` (or `app/core`)
- [X] T018 [P] [US1] Integration tests for **cleanup/archive plans + filesystem plan application + audit** (areas #17,#18,#22): generate plan, apply real mutation inside tempdir, assert side effect **and** audit record — in `crates/app/core/tests/plan_apply_audit_integration.rs`
- [X] T019 [P] [US1] Integration tests for **settings + log viewer** (areas #19,#20): persist/reload settings, log stream — in `crates/app/core/tests/settings_logs_integration.rs`
- [X] T020 [US1] Produce the coverage report: confirm each of the 22 areas maps to ≥1 passing test; update `specs/037-e2e-integration-testing/contracts/coverage-matrix.md` with concrete test names and flag any gap explicitly (FR-002, FR-019)

**Checkpoint**: Layer 1 complete and green on the local OS — MVP delivered.

---

## Phase 4: User Story 2 — Automated cross-platform verification on every change (P1)

**Goal**: Full suite runs automatically on Windows/Linux/macOS per change, blocks merge, fast layer first.
**Independent test**: open a PR; CI launches Layer-1 on all 3 OS (+ later Layer-2), reports per-platform/per-layer, blocks on failure.
**Depends on**: US1 (Layer-1 suite must exist); Layer-2 stage extended in US3 (T028).

- [X] T021 [US2] Create `.github/workflows/ci.yml` with a 3-OS matrix (`ubuntu-latest`, `windows-latest`, `macos-latest`): checkout, toolchain + pnpm setup, cargo/pnpm caching, concurrency-cancel — per research D5
- [X] T022 [US2] Add **Stage A (required, all 3 OS)** to `ci.yml`: `cargo build --workspace`, lint, `cargo test --workspace` (Layer 1) + frontend unit tests; ordered before any E2E (FR-012)
- [X] T023 [US2] Add per-platform/per-layer result reporting/labels and merge-blocking required-checks notes in `ci.yml` + a short `.github/` note, so a platform-specific failure is attributable (FR-011)

**Checkpoint**: Every PR runs Layer 1 on all 3 OS and is blocked on failure.

---

## Phase 5: User Story 3 — Full E2E smoke journeys through the real app (P2)

**Goal**: Thin smoke layer drives the built app (real UI→IPC→backend) proving wiring; all top-level screens load; one round-trip; one mutation+audit.
**Independent test**: `pnpm test:e2e:real` launches the built app, runs journeys, asserts non-mock round-trip + real mutation/audit.
**Depends on**: Phase 2 (T007, T008).

> **GATED (W3 smoke, research D9, 2026-06-19)**: harness is READY and `cargo build
> -p desktop_shell` passes, but US3 data journeys are **blocked on backend stubs**
> — `search.global`, `sessions.list`, `calibration.masters.list` return hardcoded
> fixtures (de-stubbing is product work in specs 033/035, not 037). Authoring
> journeys over stubs would be false positives (violates FR-008/the feature's
> purpose). Only **US1 `plan_apply`** (T024-equivalent) is real-signal-ready; the
> webkit/tauri-driver IPC project also still needs wiring into the Playwright
> config + one verified run (deferred to CI/Windows, not this WSL sandbox). These
> tasks therefore remain OPEN with documented reasons rather than faked.

- [ ] T024 [P] [US3] Complete the **first-run setup → target resolve → project create** journey (un-skip + flesh out), asserting a UI→real-backend round-trip value (FR-008), in `apps/desktop/e2e/real-backend/us1_*.spec.ts`
- [ ] T025 [P] [US3] Complete the **filesystem plan review → apply** journey asserting the real side effect **and** durable audit record, inside disposable test locations (FR-009, FR-016), in `apps/desktop/e2e/real-backend/*plan*.spec.ts`
- [ ] T026 [P] [US3] Add an **all-top-level-screens-load** smoke spec covering every navigable feature screen without error (FR-007, coverage-matrix #21), in `apps/desktop/e2e/real-backend/screens_load.spec.ts`
- [ ] T027 [P] [US3] Complete remaining 033 journey skeletons (subscriber startup, ingestion plumbing, lifecycle integrity) or convert to explicit, documented not-applicable if superseded — `apps/desktop/e2e/real-backend/us{2,3,5}_*.spec.ts`
- [ ] T028 [US3] Extend `ci.yml` with **Stage B (required, Linux+Windows)**: build app, run Layer-2 (Linux under `xvfb-run` + `WebKitWebDriver`; Windows fetch version-matched `msedgedriver`) — gated after Stage A (FR-010/FR-012); ensure the `better-sqlite3` native binding is installed/rebuilt per-OS runner so the `db.ts` reader loads (addresses F4 native-module risk)
- [ ] T029 [US3] Add **Stage C (macOS, optional/`continue-on-error`)** for best-effort macOS E2E via debug-only `tauri-plugin-webdriver`, OR wire FR-013 explicit not-applicable reporting if the plugin path is deferred — per research D4; ensure the plugin is compile-gated to debug builds (Constitution V)

**Checkpoint**: Real UI↔backend wiring proven on Linux+Windows; macOS handled per D4.

---

## Phase 6: User Story 4 — One-command local execution (P2)

**Goal**: Each layer runnable locally on all 3 OS via one documented command matching CI, with clear missing-prerequisite errors.
**Independent test**: from a clean checkout on each OS, the documented command runs the layer; a missing driver yields a named error.

- [X] T030 [US4] Add `just test-integration` (→ `cargo test --workspace`, integration-tagged) and `just test-e2e` (→ `pnpm --filter @astro-plan/desktop test:e2e:real`) targets to `justfile`, mirroring CI (FR-014)
- [ ] T031 [P] [US4] Add prerequisite preflight checks (named, actionable failure when `tauri-driver`/`WebKitWebDriver`/`msedgedriver` missing) to the E2E entry path / `tauri-app.ts` (FR-015)
- [ ] T032 [P] [US4] Add matching `package.json` script(s) if useful and confirm command names are consistent across `justfile`, `package.json`, and docs

**Checkpoint**: Developers run either layer locally with one command on any OS.

---

## Phase 7: User Story 5 — Documented standing convention (P3)

**Goal**: Two-layer strategy, per-OS instructions/caveats, and "new features ship with real-stack coverage" are in standing instructions + contributor doc.
**Independent test**: a new contributor can state which layer to extend and how to run it per OS, from docs alone.

- [X] T033 [P] [US5] Write `docs/development/testing.md`: the two layers, what each covers, per-OS run commands + prerequisites + caveats (incl. macOS not-applicable), and the coverage-mapping expectation (FR-017)
- [X] T034 [US5] Update the standing instructions at the **`.apm/` source** (e.g. `.apm/instructions/` build-and-workflow + testing convention) and `PRODUCT.md`, then run `apm compile` to regenerate `CLAUDE.md`/`AGENTS.md` (do not hand-edit generated files) — FR-017, repo APM rule
- [X] T035 [P] [US5] Add a short "new features ship with real-stack coverage; update the coverage matrix" rule to the testing convention so it's enforced going forward

**Checkpoint**: Strategy is durable and discoverable.

---

## Phase 8: Polish & Cross-Cutting

- [X] T036 **Seeded-regression validation (D8 / SC-007)**: for ~3–5 covered behaviors, temporarily introduce a regression (drop a persisted field, rename a payload key, skip an audit write), confirm a Layer-1 or Layer-2 test fails, revert; record outcomes in an IMPLEMENTATION-NOTES.md
- [X] T037 Confirm determinism: run Layer 1 offline and repeatedly to rule out order-dependent/shared-state flakiness (SC-006)
- [ ] T038 Final verification gate: `just lint`, `just test`, `just typecheck`, `just test-integration`, and `just test-e2e` (Linux) all green; per-OS CI green on a test PR (required platforms per FR-010); confirm the feature diff adds only test/CI/fixture/doc code and touches **no product `src` logic** beyond thin test hooks (FR-018 guard, addresses F5); then `speckit.verify`
- [ ] T039 Update `specs/037-e2e-integration-testing/checklists/requirements.md` and coverage-matrix to final state; ensure no implemented area is silently uncovered

---

## Dependencies & Execution Order

- **Setup (P1–T004)** → **Foundational (T005–T008)** → user stories.
- **US1 (T009–T020)** is the MVP and unblocks meaningful CI. Mostly `[P]` (separate test files).
- **US2 (T021–T023)** depends on US1; its Layer-2 stage (T028) depends on US3.
- **US3 (T024–T029)** depends on Foundational (T007–T008).
- **US4 (T030–T032)** depends on the suites existing (US1, US3).
- **US5 (T033–T035)** depends on the layers/commands being final.
- **Polish (T036–T039)** last.

## Parallel Execution Examples

- After Foundational: run T009–T019 in parallel (distinct test files), one agent per cluster.
- T024–T027 (E2E journeys) run in parallel; T028/T029 (CI E2E stages) serialize after.
- T033 and T035 (docs) parallel with each other; T034 (regenerate) after T033/T035.

## Implementation Strategy

- **MVP = Phase 3 (US1)**: real-backend integration coverage for all 22 areas — the cheapest, highest-value protection; ship and validate first.
- **Increment 2 = US2 Stage A**: cross-OS Layer-1 in CI (merge-blocking).
- **Increment 3 = US3 + US2 Stage B/C**: real-UI smoke + E2E in CI (Linux/Windows required, macOS best-effort).
- **Increment 4 = US4 + US5**: local ergonomics + documentation.
- **Close-out = Phase 8**: prove the suites catch regressions (D8) and lock determinism.
