# E2E mock-mode Playwright coverage audit — 2026-07-05 (Phase A)

Full E2E revalidation, Phase A: audit + run the **Playwright mock-mode
suite** (`tests/e2e/*.spec.ts`) against all shipped scenarios on the unified
post-convergence tree. Read-heavy; no product code was touched.

## (a) Base ran on

`gh pr view 440` reported `state: OPEN` (not merged) at audit time, so per
the task's branch rule this ran on **`origin/044-us3-site-management` @
`388ed1ed`** (already checked out at
`~/tmp/worktrees/astro-plan/044-us3-site-mgmt`, clean, exactly at
`origin/044-us3-site-management`). This branch is described as containing
the full unified tree (redesign + 044/047/048/049 + the #440 regression
fix) — i.e. what `main` will look like once #440 merges. Re-run this audit
once #440 merges to confirm the base delta is a no-op for this suite.

## (b) Suite run results

Setup: `pnpm install --frozen-lockfile` (clean), `pnpm --filter
@astro-plan/desktop exec playwright install --with-deps chromium` (Chromium
+ system deps installed cleanly). Run: `pnpm --filter @astro-plan/desktop
test:e2e` (`apps/desktop/playwright.config.ts`, `testDir` =
`tests/e2e` at repo root, mocks pinned via `VITE_USE_MOCKS=true`, single
`chromium` project, dev server auto-started).

**Result: 9 passed, 0 failed, 1 skipped (intentional). All green.**

| # | Spec file | Test | Result | Notes |
|---|---|---|---|---|
| 1 | `lifecycle_detail.spec.ts` | session rows render; click opens detail w/ source-tagged facts | PASS | 2.1s |
| 2 | `lifecycle_detail.spec.ts` | no selection → table renders, no detail pane | PASS | 3.9s |
| 3 | `lifecycle_transitions.spec.ts` | Projects page renders; transition button → success toast | PASS | 2.5s |
| 4 | `lifecycle_transitions.spec.ts` | Projects page renders multiple projects | PASS | 4.0s |
| 5 | `lifecycle_transitions.spec.ts` | lifecycle pill updates after transition (real-backend) | **SKIP** | `test.skip` — documented: mock `projects.list` doesn't mutate fixture state; needs real backend (see `docs/development/test-strategy-033.md` §J-4.4) |
| 6 | `regression_r1_index_redirect.spec.ts` | R-1.1 `/#/` → `/#/sessions` when setup complete | PASS | 1.3s |
| 7 | `regression_r1_index_redirect.spec.ts` | R-1.2 `/#/` → `/#/setup` when setup incomplete | PASS | 3.9s |
| 8 | `regression_r1_index_redirect.spec.ts` | R-1.3 `/#/sessions` direct nav, no invariant error | PASS | 3.9s |
| 9 | `regression_setup_legacy_catalog.spec.ts` | Confirm step tolerates legacy `{downloadAll}` (no crash) | PASS | 2.0s |
| 10 | `regression_setup_legacy_catalog.spec.ts` | Catalogs/Configuration step tolerates legacy state (no crash) | PASS | 3.8s |

No failures found. The `regression_setup_legacy_catalog.spec.ts` file
already reflects the just-landed head commit (`388ed1ed`,
"fix setup-legacy-catalog regression for the new Site step index"), which
correctly accounts for the 6-step wizard (`SetupWizard.tsx` `STEPS`: 0
Sources, 1 Tools, 2 Configuration, 3 **Site** (spec 044 US3, new), 4
Confirm, 5 Scan) — verified against `SetupWizard.tsx` directly, no drift.

**Headline finding: the suite itself is not stale or broken — it is
extremely small.** Only 4 spec files exist under `tests/e2e/`, and they
have existed (with incremental fixes) since specs 002/006/008/033; no
journey-shaped spec files were ever added for Inbox, Cleanup, Archive,
Calibration, Targets, Settings, or the setup wizard's happy path. The gap
in this campaign is **breadth**, not regressions.

**Config/wiring finding:** `tests/integration/*.spec.ts` (3 files —
`first_run_gate.spec.ts`, `first_run_happy_path.spec.ts`,
`first_run_restart.spec.ts`, all real `@playwright/test` specs from spec
003) are **orphaned** — `apps/desktop/playwright.config.ts`'s `testDir` only
points at `tests/e2e`, so `pnpm test:e2e` silently never runs them. They
were not part of the 9/10 counted above. This is a pre-existing drift, not
introduced by 044/convergence.

## (c) Scenario → test coverage matrix (by journey)

Classification: **COVERED-green** (mock e2e spec exists and passed),
**COVERED-but-failing** (spec exists, failed — none found),
**STALE** (spec exists, asserts outdated behavior — none found, see below),
**UNCOVERED** (no mock Playwright spec at all).

| Journey | Scenario (from user-journeys.md / spec US) | Mock e2e spec | Status |
|---|---|---|---|
| 1 — First-run setup → data sources | 5-step wizard happy path (Sources→Tools→Config→Site→Confirm→Scan) | none | **UNCOVERED** |
| 1 | Wizard tolerates legacy persisted state (no `selectedCatalogIds`, no `site`) | `regression_setup_legacy_catalog.spec.ts` | COVERED-green |
| 1 | Index route `/` → `/setup` when incomplete, `/sessions` when complete (no crash) | `regression_r1_index_redirect.spec.ts` | COVERED-green |
| 1 | Data Sources management: rescan/remap/disable/delete/reveal | none | **UNCOVERED** |
| 1 / spec 044 US3 | Manage observing sites (Settings/wizard Site step itself: add/edit a site, default-from-wizard) | none (`StepSite.tsx` has no dedicated test at any layer, mock or vitest) | **UNCOVERED** |
| 2 — Ingest → reclassify → confirm (move) | Rescan, mixed-folder split, needs-review gate, bulk reclassify, root-picker, confirm→plan, apply, stale-plan refusal | none | **UNCOVERED** (spec 041 US1/US9/US10/US12; vitest component tests exist under `apps/desktop/src/features/inbox/__tests__/*` (14 files) + `plans/` (3) but no Playwright mock e2e) |
| 3 — Ingest → confirm (catalogue-in-place) | Organized-root confirm → move-count 0, catalogue-count = file count, no root picker | none | **UNCOVERED** |
| 4 — Sessions review (derived) | Sessions table renders, detail opens w/ source-tagged PropertyTable, empty-selection state | `lifecycle_detail.spec.ts` | COVERED-green |
| 4 | Absence of Confirm/Re-open/Reject/Ignore controls + no review pills | none (not asserted anywhere in `lifecycle_detail.spec.ts`) | **UNCOVERED** |
| 4 / spec 041 US14 | Notes edit doesn't trigger lifecycle transition; rescan doesn't duplicate/resurrect | none | **UNCOVERED** |
| 5 — Project lifecycle create→attach→manifests→launch→artifacts | Create-wizard duplicate-name inline error | none | **UNCOVERED** |
| 5 | Lifecycle transition button → success toast (Processing→Completed) | `lifecycle_transitions.spec.ts` | COVERED-green |
| 5 | Post-transition pill re-render (real backend needed) | `lifecycle_transitions.spec.ts` (`test.skip`, documented) | COVERED-but-**intentionally-skipped** (needs real-backend/Layer-2, not a mock-layer gap) |
| 5 | Attach-sources picker (unlinked confirmed sessions only), last-source removal guard, per-channel integration time, manifests/notes autosave, tool launch spawn+containment, artifact watcher | none | **UNCOVERED** |
| 6 — Cleanup: scan→review→apply | Scan candidates, protected-item lock, generate plan, protection-acknowledgement gate, apply progress, empty-plan block | none (`OutputsCleanupSections.test.tsx` is vitest-only) | **UNCOVERED** |
| 7 — Archive → delete from archive | Archive refusal without plan, archive apply → lifecycle flip, Archive page listing, send-to-trash, DELETE-confirm permanent delete, reveal label | none | **UNCOVERED** (also no Layer-2 coverage per `verify-on-windows-journeys.md`) |
| 8 — Calibration: ingest→masters→matching | Masters as individual items, per-kind fingerprint columns, ranked candidate matching, assign/cancel, offset-tolerance persistence | none (7 vitest files under `features/calibration/`, no Playwright) | **UNCOVERED** |
| 9 — Targets & planning | Catalog list/search/sort/group, add target (local + SIMBAD resolve-on-demand), target detail identity/aliases/notes, stub-disclosure tooltips (Max altitude/sparkline/Opposition/Lunar sep/Filters/Image time), Favourites localStorage-only | none (23 vitest files under `features/targets/`, no Playwright) | **UNCOVERED** (also no Layer-2 coverage) |
| 10 — Settings, appearance, i18n | 12-panes/3-sections layout, theme switch+persist, ingestion settings persist, planner altitude-threshold clamp, bottom log panel filter/export, sidebar collapse persist, translated error surfacing, command palette, 1100×720 layout convention | none (16 vitest files under `features/settings/`, no Playwright) | **UNCOVERED** (also no Layer-2 coverage) |
| cross-cutting / spec 046 | i18n: no raw keys, translated backend error codes | none at mock e2e layer | **UNCOVERED** |
| cross-cutting / spec 049 | Source-view generation (`GenerateSourceViewDialog`, `SourceViewsSection`, per-tool profile, regenerate-after-change, verify-before-processing) | none | **UNCOVERED** |
| cross-cutting / spec 048 | Per-frame inventory reconciliation, missing-frame calibration awareness, raw-subframe cleanup candidates | none | **UNCOVERED** |
| cross-cutting / spec 047 | Moon glance widget, lunar separation per target, filter guidance, opposition indicator | none | **UNCOVERED** (Journey 9 stub-disclosure requirement directly touches this) |

**Totals:** ~29 distinct journey/spec-level scenarios enumerated above.
**7 COVERED-green** test cases map to real passing specs (Journeys 1 and 4
partially, Journey 5's transition button). **1** is an intentionally-skipped
real-backend-only case (not a mock-layer gap). **0 STALE** and **0
COVERED-but-failing** — nothing in the existing 4 files asserts outdated
behavior; the suite was kept in sync with the step-index and provenance
redesigns. **The remaining ~21 scenario groups (Journeys 2, 3, 6, 7, 8, 9,
10, and specs 044 US3/046/047/048/049) have zero Playwright mock coverage.**
`specs/037-e2e-integration-testing/contracts/coverage-matrix.md` only tracks
Layer-1 (Rust integration) and Layer-2 (tauri-driver) coverage — it does not
mention the Playwright mock layer at all, so there is no existing
authoritative claim about mock-layer coverage to check for drift against;
this document is the first one.

Layer-2 cross-reference (not this campaign's focus, noted per instructions):
`crates/e2e-tests/tests/journeys.rs` has exactly 5 tests
(`first_run_resolve_create_project`, `plan_review_apply_with_audit`,
`ingestion_sessions_search`, `lifecycle_integrity`, `cleanup_plan_review`),
all `#[ignore = "..."]` (CI-only, `--run-ignored all`), plus
`all_top_level_screens_load` in `smoke.rs`. Per
`verify-on-windows-journeys.md`, Journeys 7, 9, and 10 have **no Layer-2
coverage at all** — combined with zero Playwright mock coverage, those three
journeys currently have no automated UI-level coverage whatsoever (Layer-1
Rust integration tests do exist for backend logic under those journeys).

## (d) Prioritized, batched fix-list for Phase B

Ordered by journey/spec priority and product risk (filesystem-mutation
journeys first, per the constitution's reviewable-mutation principle).
Each batch is a self-contained Phase-B assignment.

**Batch 1 — Journey 2/3 (spec 041): Inbox ingest → reclassify → confirm →
plan, both move and catalogue-in-place modes.** Highest priority: this is
the single largest, most mutation-relevant, and most completely uncovered
journey at the mock layer. Add `tests/e2e/inbox_ingest_confirm.spec.ts`
(or split move vs. catalogue into two files) covering: rescan/mixed-folder
split into single-type items, needs-review banner + badges + disabled
confirm, bulk reclassify re-partition, root-picker prompt vs. auto-select,
confirm→"planned" state persistence, plan review overlay destination path
display, and (mock-level) stale-plan / destination-collision refusal
banners. Use the existing mock wiring in `apps/desktop/src/api/mocks.ts` and
fixtures under `apps/desktop/src/data/fixtures/` as the seam (same pattern
`lifecycle_transitions.spec.ts` uses for `lifecycle_transition_apply`).

**Batch 2 — Journey 6/7 (spec 017/025): Cleanup scan→plan→apply and
Archive→trash/delete.** Second priority: also filesystem-mutation-adjacent
and has zero coverage at any UI test layer except Layer-1. Add
`tests/e2e/cleanup_review.spec.ts` (scan preview, protected-item lock,
generate-plan, protection-acknowledgement gate, empty-plan block) and
`tests/e2e/archive_lifecycle.spec.ts` (archive-refusal-without-plan,
archive page listing with real audit rows, send-to-trash, `DELETE`-literal
permanent-delete gate, reveal-label disabled state). Both areas currently
have *no* Layer-2 journey either (`verify-on-windows-journeys.md`), so this
closes the single biggest whole-stack gap for those two journeys.

**Batch 3 — Journey 5 (spec 008/009/012/024): Project lifecycle beyond the
single transition button already covered.** Add coverage for: create-wizard
duplicate-name inline field error (blocks creation), attach-sources picker
filtered to unlinked-confirmed-sessions-only, last-confirmed-source removal
guard message, per-channel integration-time display, and notes-field
autosave with byte counter. Tool-launch spawn and artifact-watcher are
better suited to Layer-2 (they need a real process/filesystem watcher) —
flag as Layer-2 backlog rather than mock e2e.

**Batch 4 — Journey 8 (spec 040/007): Calibration masters and matching.**
Add `tests/e2e/calibration_masters_matching.spec.ts`: masters ingest as
individual items with kind-conditional fingerprint columns on the
Calibration page, ranked candidate-session matching view, assign/cancel
(cancel fires no mock call), and the Settings → Calibration "Offset
tolerance" persistence + immediate matching-view effect.

**Batch 5 — Journey 9 (spec 035/023/044/047): Targets & planning, with
emphasis on the stub-disclosure requirement.** Add
`tests/e2e/targets_catalog_and_stubs.spec.ts`: catalog list/search/sort
(M31 vs. Andromeda alias resolution), add-target local match (no
duplicate), SIMBAD resolve-on-demand success/failure inline messaging,
target detail identity/alias/notes editing, and — called out specifically
in the user-journeys doc as safety-critical — an explicit assertion that
every placeholder column (Max altitude, sparkline, Opposition, Lunar
separation, Filters, Image time) and the altitude graph render a
disclosure/"approximate" affordance rather than a bare concrete-looking
number. This journey also has zero Layer-2 coverage, so the mock e2e spec
is the only automated net for the "stub must never look fabricated"
constitutional requirement.

**Batch 6 — Journey 10 (spec 018/019/043/046): Settings, appearance,
i18n, and cross-cutting layout.** Add `tests/e2e/settings_and_layout.spec.ts`:
pane grouping (no global Save button), theme switch + persistence across
reload, bottom log panel expand-shrinks-not-overlays behavior + severity
filter, translated-error-surface assertion (no raw error code visible), and
the 1100×720 pinned-header/scrolling-content layout convention check
(`page-layout-convention` — action bars stay visible, only `.alm-page__scroll`
scrolls). This journey also has zero Layer-2 coverage.

**Batch 7 (housekeeping, not a fixer task per se) — Wire or retire the
orphaned `tests/integration/*.spec.ts` files.** Three real Playwright specs
(`first_run_gate.spec.ts`, `first_run_happy_path.spec.ts`,
`first_run_restart.spec.ts`) from spec 003 exist but are outside
`playwright.config.ts`'s `testDir` and never run. Either add a second
`testDir`/project entry so `pnpm test:e2e` picks them up, move them into
`tests/e2e/`, or explicitly delete them if superseded by Batch 1's new
wizard coverage — currently they are silent dead weight that could bit-rot
without anyone noticing (as this audit found).

No batch is needed for Journeys 1 and 4's already-green scenarios, or for
the intentionally-skipped real-backend pill-refresh test — those are
correctly scoped as out-of-mock-layer already.
