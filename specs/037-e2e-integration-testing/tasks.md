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
>
> **Status 2026-06-20**: **Layer-2 scaffold DONE** — `crates/e2e-tests` added
> with thirtyfour ^0.37 + cargo-nextest; `#[ignore]` journey stubs compile and
> list (5 skipped, 0 failed); harness in `tests/common/mod.rs` uses proven
> `tauri:options.application` caps (no `browserName`). `e2e.yml` updated to
> `cargo nextest run -p e2e_tests --profile e2e --no-tests=warn`. WebdriverIO
> interim (`apps/desktop/e2e/wdio/`) retained on disk but no longer invoked by
> CI. Wiring (T024–T027, T031) deferred per D9 backend gating.
>
> **Status 2026-06-20 (D10)**: **tauri-plugin-webdriver all-OS adopted** —
> `desktop_shell` gains `e2e` Cargo feature gating `tauri-plugin-webdriver` v0.2
> (embedded server on :4445; `tauri-webdriver` CLI proxies :4444 → :4445).
> `apps/desktop/e2e/wdio/` **DELETED**; `webdriverio` devDep + `test:e2e:wdio`
> script removed from `package.json`. `e2e.yml` rewritten to uniform 3-OS matrix
> (ubuntu/windows/macos) — no `webkit2gtk-driver`, no `msedgedriver`. Research
> D10 records the decision superseding D3/D4. T031 preflight TODO updated to
> reference `tauri-webdriver` instead of `tauri-driver`/`msedgedriver`.
>
> **Status 2026-07-09 (close-out)**: Setup/Foundational phase fully resolved —
> T001/T004 done (tempfile confirmed present; no live-network tag needed, `#[ignore]`
> repurposed for the L1/L2 split instead), T003/T006 confirmed superseded (no
> change from the 2026-06-19 note). T031 confirmed already implemented
> (`preflight()` in `crates/e2e-tests/tests/common/mod.rs`, not touched — owned
> by that lane). T032 found and fixed a real gap: `just test-e2e` called a
> `pnpm` script (`test:e2e:real`) that did not exist in `apps/desktop/package.json`
> — added it (`apps/desktop/scripts/run-e2e-real.sh`), untested end-to-end
> locally (no webview in this sandbox). Mock-Playwright layer: all 6 audit
> batches from `e2e-mock-coverage-audit-2026-07-05.md` confirmed landed
> (#447/#448/#452/#453/#454/#455/#494); the one still-open, mock-reachable gap
> named in this pass's brief (`StepSite.tsx` / spec 044 US3 wizard site step)
> closed via `tests/e2e/setup_wizard_site_step.spec.ts` (NEW). See
> `contracts/coverage-matrix.md`'s "Mock-Playwright batch completion + StepSite
> gap closed" section for the full breakdown, including what remains open as
> follow-up (full wizard happy path, Data Sources management UI).

**Legend**: `[P]` = parallelizable (different files, no incomplete-task dep).
Story labels map to spec user stories US1–US5.

---

## Phase 1: Setup

- [X] T001 ~~Add Rust dev-dependencies for the integration layer (`wiremock`, ensure `tempfile`)~~ **PARTIALLY SUPERSEDED** — `tempfile` is already a `[dev-dependencies]` workspace entry in `crates/app/core/Cargo.toml` (used by the T005 harness). `wiremock` was never added: superseded by the same T003/T006 decision below (offline `FakeResolver`/`FakeSpawner` test doubles, no HTTP-boundary mock needed).
- [ ] T002 [P] ~~Add E2E dev-dependency `better-sqlite3` to `apps/desktop/package.json`~~ **SUPERSEDED** — the thirtyfour harness (`crates/e2e-tests`) asserts through the real UI via element find/text and the `invoke()` bridge; no JS DB reader is needed. `better-sqlite3` is not added.
- [ ] T003 [P] ~~Create shared test-fixture dir `tests/fixtures/` with SIMBAD response samples~~ **SUPERSEDED** — no fixture dir was created; the in-repo `targeting::FakeResolver` test double (offline, in-memory) covers every SIMBAD scenario the fixtures would have (success/ambiguous/not-found/error) without a filesystem/HTTP fixture layer to maintain. See `crates/targeting/tests/simbad_resolution_integration.rs`.
- [X] T004 Decide and document the integration-test tagging mechanism so the default suite stays deterministic/offline, per research D2 + open items; record in `quickstart.md` — **decision: no live/network tag is needed.** Re-verified 2026-07-09: no test anywhere in the workspace makes a real network call (`grep` for a live-SIMBAD `#[ignore]`/feature gate returns nothing) — SIMBAD resolution is exercised entirely offline (`FakeResolver` at Layer 1, the bundled seed cache at Layer 2), matching the resolve-on-demand + bundled-seed pivot that obsoleted the original hosted-catalog/live-test plan. The `#[ignore]` attribute that DOES exist in this feature (`crates/e2e-tests/tests/*.rs`) serves a different purpose than the one T004 originally envisioned: gating Layer-2 real-UI journeys out of the Layer-1 `cargo test --workspace` run (no WebDriver/display there), opted back in via `--run-ignored all` in `e2e.yml`. Documented in `quickstart.md`.

## Phase 2: Foundational (blocking prerequisites)

- [X] T005 Create a Layer-1 test harness helper providing an isolated, file-backed SQLite DB in a `tempfile::tempdir()` with `sqlx::migrate!()` applied and a built `AppState`/`SqliteLifecycleRepository`, in `crates/app/core/tests/support/mod.rs` (or a small `crates/testkit` if cleaner) — per research D1, data-model isolation model
- [ ] T006 [P] ~~Add a `wiremock`-based SIMBAD boundary stub helper~~ **SUPERSEDED** — same decision as T001/T003: `targeting::FakeResolver` (an in-process trait-object double, not an HTTP server) is the boundary stub actually used by `crates/targeting/tests/simbad_resolution_integration.rs` and the Layer-2 `targets_journeys.rs` bundled-seed-cache path. No `wiremock` dependency was added; research D2's plan is superseded per the note already in this file's 2026-06-19 status block above.
- [ ] T007 ~~Replace `apps/desktop/e2e/helpers/db.ts`~~ **SUPERSEDED** — DB assertions use the real UI or the `invoke()` bridge in `crates/e2e-tests/tests/common/mod.rs`; `better-sqlite3` is not adopted. The `db.ts` placeholder remains as a structural reference.
- [ ] T008 ~~Add fresh-DB reset to `tauri-app.ts`~~ **SUPERSEDED** — fresh-DB reset in the thirtyfour harness is `reset_database()` in `crates/e2e-tests/tests/common/mod.rs` (reads `ALM_DB_URL` env; TODO wiring for OS app-data path). `tauri-app.ts` is now a reference scaffold.

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

> **STATUS (updated after merge to main, 2026-06-19)**: W3 smoke confirmed the
> harness is READY (`cargo build -p desktop_shell` passes). Backend stub blockers
> have largely cleared on main: **`search.global` and `calibration.masters.list/get`
> are now de-stubbed** (real SQLite, spec-033/035). **`sessions.list/get` de-stub**
> is the last backend prerequisite (use cases over the existing `acquisition_session`
> table — bounded; tracked separately). CI **Stage B (E2E Linux+Windows)** and
> **Stage C (macOS best-effort)** are wired in `.github/workflows/ci.yml`, plus a
> `screen_load_smoke.spec.ts` real-env smoke. **The webview/`tauri-driver` IPC
> journeys cannot run in the WSL dev sandbox** — they are first-verified by CI
> Stage B and on Windows (handover item). Authoring + un-skipping the full journey
> set against the real backend is the remaining US3 work, to be verified in CI.
>
> **STATUS 2026-07-04 (WP-C, D21/D22)**: journey bodies authored against the
> real backend and un-ignored — `first_run_resolve_create_project`,
> `plan_review_apply_with_audit`, `ingestion_sessions_search`,
> `lifecycle_integrity`, `cleanup_plan_review` (NEW, D22 — the WP-A cleanup
> generator #389 landed, unblocking a real cleanup-plan review journey; its
> terminal apply step is a documented gap, see the journey's doc comment),
> plus the `all_top_level_screens_load` smoke. `sessions.transition` is
> deliberately NOT exercised (deleted by 041 FR-051, D22). `audit.list`/
> `audit.export` were stubs when the journeys were authored; PR #388 has
> since wired them to the real `audit_log_entry` table (#401 adds
> entity-filtered reads) — durable-record proofs stay on
> `plans.apply.status` (`plan_apply_events`) and `lifecycle.ledger.list`,
> the read paths closest to the mutations proved. `e2e.yml` gained
> `ALM_DB_URL` (previously unset, so `reset_database()` silently no-opped).
> Cannot be exercised in the WSL dev sandbox (no webview) — compiles clean,
> 0 clippy warnings, `cargo nextest list` shows all 6 un-ignored; CI's 3-OS
> matrix is the first real run.

- [X] T024 [P] [US3] **First-run setup → target resolve → project create** journey: `target.resolve("M 31")` (offline bundled-seed cache hit — no network dependency), `projects.create` linked to the resolved target, `projects.list` round-trip (FR-008); real-UI proof is the fresh-DB `/setup` redirect. `crates/e2e-tests/tests/journeys.rs::first_run_resolve_create_project`.
- [X] T025 [P] [US3] **Filesystem plan review → apply** journey: real `roots.register` → `sources.set_organization_state` → `inbox.scan.folder` → `inbox.classify` → `inbox.confirm` → `inbox.plan.apply` (channel-free real apply) → poll `plans.apply.status` for the durable `plan_apply_events` record (FR-016) + assert the source file actually moved on disk (FR-009). `crates/e2e-tests/tests/journeys.rs::plan_review_apply_with_audit`.
- [X] T026 [P] [US3] **all-top-level-screens-load** smoke: real routes (`/sessions`,`/inbox`,`/calibration`,`/targets`,`/projects`,`/archive`,`/settings`) after completing first-run via real `roots.register`×2 + `firstrun.complete`; asserts the real, shipped `AppErrorBoundary` fallback (`[data-testid="app-error-boundary-fallback"]`) never appears (FR-007, coverage-matrix #21). `crates/e2e-tests/tests/smoke.rs::all_top_level_screens_load`.
- [X] T027 [P] [US3] Remaining journeys: `ingestion_sessions_search` (inbox confirm → event-driven ingest session grouping+resolution via the bundled M31 seed → `calibration.match.suggest` → `search.global` alias round-trip) and `lifecycle_integrity` (real `TransitionResponse` from `lifecycle.transition.apply` + a real `lifecycle.ledger.list` row — replaces the scaffold's aspirational, non-existent `events.recent` assertion; `audit.list`, stubbed at authoring time, was wired real by #388 and remains a complementary future assertion surface). Both in `crates/e2e-tests/tests/journeys.rs`. `sessions.transition` intentionally NOT exercised (041 FR-051 deleted it, D22).
- [X] T028 [US3] `e2e.yml` rewritten to uniform 3-OS matrix (ubuntu/windows/macos) via `tauri-plugin-webdriver` (D10). Drops old `tauri-driver`/msedgedriver/WebKitWebDriver steps. Per OS: install `tauri-webdriver` CLI, build frontend with `VITE_E2E=1`, serve dist on :5173, build `desktop_shell --features e2e`, run nextest (`xvfb-run -a` on Linux). Needs gate from `integration` job (ci.yml Stage A). 2026-07-04: added `ALM_DB_URL` (fresh file-backed DB per run) now that journeys are real.
- [X] T029 [US3] macOS E2E now part of the uniform matrix via `tauri-plugin-webdriver` (D10 supersedes D4 best-effort deferral). Plugin compile-gated behind `e2e` feature; release binaries omit it (Constitution V).
- [X] T027b [P] [US3] (NEW, D22) **Cleanup plan review** journey: real `artifact.watcher.attach` (spec 012, #400) + attach-time reconciliation observes a real `integration_*.xisf` output file → `cleanup.policy.update` (opt Intermediate into Archive; default policy is all-Keep) → `cleanup.scan` → `cleanup.plan.generate` → `plans.approve`. Terminal apply is a documented, not-yet-closeable gap (no channel-free apply command for archive/cleanup plans, no UI Apply button wired for `cleanup.plan.generate` output). `crates/e2e-tests/tests/journeys.rs::cleanup_plan_review`.

**Checkpoint**: Real UI↔backend wiring proven on Linux+Windows; macOS handled per D4.

---

## Phase 6: User Story 4 — One-command local execution (P2)

**Goal**: Each layer runnable locally on all 3 OS via one documented command matching CI, with clear missing-prerequisite errors.
**Independent test**: from a clean checkout on each OS, the documented command runs the layer; a missing driver yields a named error.

- [X] T030 [US4] Add `just test-integration` (→ `cargo test --workspace`, integration-tagged) and `just test-e2e` (→ `pnpm --filter @astro-plan/desktop test:e2e:real`) targets to `justfile`, mirroring CI (FR-014)
- [X] T031 [P] [US4] Add prerequisite preflight checks (named, actionable failure when `tauri-webdriver` CLI is missing, with `cargo install tauri-webdriver --locked` install hint) to the E2E entry path in `crates/e2e-tests/tests/common/mod.rs` `preflight()` (FR-015). Old per-OS driver checks (`WebKitWebDriver`/`msedgedriver`) are no longer needed (D10). Already implemented (`preflight()` → `check_tauri_webdriver_cli()` + `check_app_binary()`, `crates/e2e-tests/tests/common/mod.rs:1298-1340`) — not touched this pass (that file is owned by the crates/e2e-tests lane); verified by reading, not edited.
- [X] T032 [P] [US4] Add matching `package.json` script(s) if useful and confirm command names are consistent across `justfile`, `package.json`, and docs — **found and fixed a real inconsistency**: `justfile`'s `test-e2e` target already called `pnpm --filter @astro-plan/desktop test:e2e:real`, but `apps/desktop/package.json` had no such script (only the mock-mode `test:e2e`, a different suite entirely) — `just test-e2e` was dead/broken. Added `apps/desktop/scripts/run-e2e-real.sh` (builds the frontend with `VITE_E2E=1`, serves it, builds `desktop_shell --features e2e`, runs `cargo nextest run -p e2e_tests --profile e2e --run-ignored all`, mirroring `.github/workflows/e2e.yml`) and wired it as `apps/desktop/package.json`'s `test:e2e:real` script. `justfile` itself was not touched (outside this task's file scope). Untested end-to-end locally (no webview/display in the WSL sandbox, same limitation documented throughout this feature) — syntax-checked (`bash -n`) only; first real run is CI (`e2e.yml`) or a Linux/Windows dev machine.

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
- [X] T038 Final verification gate — this pass's diff (`tests/e2e/setup_wizard_site_step.spec.ts`, `apps/desktop/package.json`, `apps/desktop/scripts/run-e2e-real.sh`, docs/spec edits) touches **no product `src` logic**, only test/doc/dev-tooling code (FR-018 guard). Verified this pass: `pnpm -r --if-present lint` (0 errors), `pnpm -r --if-present typecheck` (green), the new spec + the full `tests/e2e/` mock suite compiled and the new spec's 3 tests pass in isolation and repeatably. No Rust dev-deps were touched (T001/T006 stayed superseded, not implemented), so per this task's run rules `cargo nextest`/`cargo test --workspace` was not re-run from a clean build — that remains CI's job (`ci.yml`), consistent with this feature's established pattern (every prior WP-C status note in this file defers real verification to CI because the WSL dev sandbox has no webview). **Finding, not a regression**: a full local `pnpm exec playwright test` run of the whole `tests/e2e/` suite hit ~40 unrelated failures; root-caused to a foreign, already-running Vite dev server on port 5173 from a *different* checkout (`/home/sjors/dev/astro-plan`, no `VITE_USE_MOCKS` set) that Playwright's `reuseExistingServer: !CI` silently reused instead of launching its own correctly-configured server — a shared-sandbox port collision, not a code defect (confirmed via `/proc/<pid>/environ` on the squatting process). Not fixed here (foreign process, outside this task's worktree). `speckit.verify` not run (CLI not available in this environment per prior sessions' convention); the coverage-matrix and checklist updates below stand in as the auditable equivalent.
- [X] T039 Update `specs/037-e2e-integration-testing/checklists/requirements.md` and coverage-matrix to final state; ensure no implemented area is silently uncovered — `checklists/requirements.md` re-reviewed: it is a spec-quality gate (all items already `[x]`, no implementation-status claims), still accurate, left unchanged. `contracts/coverage-matrix.md` updated: per-journey Mock-Playwright column reflects all 6 landed batches (PRs #447/#448/#452/#453/#454/#455, #494 stabilization) + a new "Mock-Playwright batch completion + StepSite gap closed — 2026-07-09" section recording what closed, what was re-verified as already-closed (046 i18n, 047 moon pills), and what remains open (full wizard happy path, Data Sources management) as follow-up, not a silent gap.

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
