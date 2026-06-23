# Coverage Matrix: Feature Area → Test Layer

**Feature**: 037-e2e-integration-testing

This feature exposes **no new product contracts** — it consumes the existing
language-neutral command contracts unchanged. This file is the auditable coverage
mapping required by FR-019 / SC-001. Final per-test names are filled in by
`/speckit.tasks`; this fixes the required coverage.

Legend: **L1** = real-backend integration test required; **L2** = appears in a
Layer-2 smoke journey; **—** = covered implicitly via screen-load smoke.

| # | Feature area | L1 | L2 | Notes |
|---|---|:--:|:--:|---|
| 1 | First-run source setup | ✅ | ✅ | setup wizard → root persisted |
| 2 | Native filesystem controls | ✅ | — | path validation/side effects via L1 |
| 3 | Inbox mixed-folder split | ✅ | ✅ | classify + split |
| 4 | Inventory / data lifecycle state | ✅ | ✅ | ledger + transitions |
| 5 | Calibration matching & masters | ✅ | ✅ | suggest + assign |
| 6 | Sessions | ✅ | ✅ | list/merge/split/transition |
| 7 | Projects: create/onboard/edit | ✅ | ✅ | CRUD round-trip |
| 8 | Project lifecycle model | ✅ | ✅ | blocked/ready transitions |
| 9 | Project manifests & notes | ✅ | ✅ | manifest + note persistence |
| 10 | Processing tool launch | ✅ | smoke | wiring only; **no real launch** |
| 11 | Processing artifact observation | ✅ | ✅ | artifact detection |
| 12 | Target lookup from FITS OBJECT | ✅ | ✅ | OBJECT → canonical |
| 13 | Target identity, history, notes | ✅ | ✅ | identity + notes |
| 14 | SIMBAD target resolution | ✅ | ✅ | **HTTP-boundary mocked** (wiremock) |
| 15 | Token pattern builder | ✅ | ✅ | parse/resolve tokens |
| 16 | Source protection defaults | ✅ | — | protection asserted via L1 + plans |
| 17 | Cleanup & archive review plans | ✅ | ✅ | plan generation/review |
| 18 | Filesystem plan application | ✅ | ✅ | **mutation + audit record assert** |
| 19 | Settings / configuration model | ✅ | ✅ | persist + reload |
| 20 | Bottom log viewer | ✅ | ✅ | log stream render |
| 21 | Router & URL state | n/a | ✅ | **all top-level screens load** (FR-007) |
| 22 | Audit event model (cross-cutting) | ✅ | via #18 | bus + stale propagation |

**Required round-trip proof (FR-008)**: areas #1, #7, #12/#14 each round-trip a
UI value through the real backend.

**Required mutation+audit proof (FR-009)**: area #18 (filesystem plan
application).

## Layer-1 implementation status (T009–T020) — 2026-06-19

All backend feature areas now have ≥1 passing real-backend integration test
(real SQLite + migrations, no mocked backend). Full workspace: 76 suites ok, 0
failed, **0 ignored** (no faked/skipped passes).

| Areas | Test file | Tests |
|---|---|---|
| #7 (+ #18/#22 audit) | `crates/app/core/tests/us1_coverage_smoke.rs` | 2 |
| #1/#2/#16 | `crates/app/core/tests/first_run_integration.rs` | 4 |
| #3/#4 | `crates/app/core/tests/inbox_lifecycle_integration.rs` | 4 |
| #5 | `crates/app/core/tests/calibration_integration.rs` | ✓ |
| #6 | `crates/app/core/tests/sessions_integration.rs` | ✓ |
| #7/#8/#9 | `crates/app/core/tests/projects_integration.rs` | 7 |
| #10/#11 | `crates/app/core/tests/tools_artifacts_integration.rs` | 5 |
| #12/#13 | `crates/app/core/tests/targets_integration.rs` | 7 |
| #14 | `crates/app/core/tests/simbad_resolution_integration.rs` | ✓ (offline, FakeResolver) |
| #15 | `crates/patterns/tests/pattern_integration.rs` | 4 |
| #17/#18/#22 | `crates/app/core/tests/plan_apply_audit_integration.rs` | ✓ (mutation+audit) |
| #19/#20 | `crates/app/core/tests/settings_logs_integration.rs` | ✓ |
| #21 | — (Layer-2 only, by design) | see US3 |

Shared harness: `crates/app/core/tests/support/mod.rs` (T005).
**Implementation note**: research D2's `wiremock` boundary stub was superseded by
the repo's existing `targeting` `FakeResolver` (offline) for #14 and `FakeSpawner`
for #10 — fewer deps, matches repo convention. No `wiremock` dependency was added.

**Explicit exclusions (not implemented-feature backend areas)**: Catalog index
licensing (014), Developer contract diagnostics (021, dev-only), Design/UI specs
(022, 026–032) — covered implicitly by #21 screen-load smoke; remediation specs
033/036 fold into the areas above. Any area later found implemented but unmapped
MUST be added here or reported as a gap (FR-002).

## Spec 041 iteration — destination model (US8/US9) — 2026-06-21

Per-type destination patterns, destination-root selection, full absolute-path
preview, and the missing-path-attribute gate (FR-025–FR-033). Folds into areas
#3/#4 (inbox lifecycle).

| Scenario (quickstart Iteration 2026-06-21) | Layer-1 test |
|---|---|
| Per-type pattern resolution + calibration structure (no target) | `crates/patterns/src/per_type.rs`, `crates/patterns/src/resolver.rs` (`pattern_str_*`), `confirm.rs::calibration_destinations_omit_target` |
| Root resolution: in-place / inbox-target / single-auto / multi-require / none | `confirm.rs::{non_inbox_source_moves_in_place, inbox_single_candidate_auto_selects, inbox_multi_candidate_requires_selection, inbox_no_candidate_blocks}` |
| Missing path-attribute gate (US9) | `confirm.rs::missing_path_attribute_blocks_with_report` |
| Settings per-type pattern round-trip + validation (FR-026b) | `app_core settings.rs::update_patterns_by_type_*`, `persistence_db settings.rs` |
| Frontend: root picker, absolute-path preview, missing-attr annotations | `apps/desktop/src/features/inbox/__tests__/{PlanPanel,InboxDetail}.test.tsx`; settings: `NamingStructure` vitest |

**Windows real-app E2E (T060)**: the live tauri-MCP run of the quickstart
destination-model scenarios (calibration structure, inbox root selection,
multi-root prompt vs single-root auto, missing-date gate) is the recommended
post-merge verification loop (see the `tauri-mcp-windows-verify-mechanics`
memory); Layer-1 + vitest coverage above gates the merge.

## Spec 035 iteration — US4 ingest → session → target — 2026-06-21

Applied light frames create `acquisition_session` records grouped by capture
identity and link a resolved `canonical_target` (FR-016). Folds into areas
#3/#4 (inbox lifecycle) + the Sessions read path. Closes GitHub issue #307
(empty Sessions page; targets never linked).

| Scenario (spec 035 US4 acceptance) | Layer-1 test |
|---|---|
| M31 cache-hit grouping: two alias-spelled light frames (`M 31`, `NGC 224`) → ONE session, `frame_ids` length 2, `canonical_target_id` = seeded M31, `list_sessions` frame_count 2 + target name | `crates/app/core/tests/ingest_sessions_integration.rs::two_m31_frames_group_into_one_linked_session` (T045) |
| Unknown OBJECT → session created, `canonical_target_id` NULL, `ingest_resolution` pending, never fabricated; `resolve_pending` (FakeResolver) + back-fill → linked | `crates/app/core/tests/ingest_sessions_integration.rs::unknown_object_session_backfills_after_resolve` (T046) |
| Per-frame ingest unit coverage (light detection, binning, DATE-OBS UTC fallback, session_key) | `crates/app/targets/src/ingest_sessions.rs` unit tests |
| Inline cache-hit / miss-enqueue / drain / offline-pending | `crates/app/targets/src/ingest_resolution.rs` unit tests |

**Background drain (T043)**: the `resolve_pending` + `backfill_session_targets`
interval task in `apps/desktop/src-tauri/src/lib.rs::run_app` is exercised
function-by-function at Layer 1 (T046 calls both directly); the live interval
loop is validated in the Windows real-app E2E loop.
