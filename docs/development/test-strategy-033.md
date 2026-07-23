# Test Strategy — Spec 033 Validation Bugfix Remediation (2026-06-17)

> Source of truth: `autonomous-run-2026-06-validation-findings.md` (Tier-1/Tier-2 issue
> catalog, fix ledger). This document translates every finding into a concrete test
> scenario, assigns it to the right layer, and records its current state.
>
> **What this document is NOT:** a tasks.md substitute or a checkbox list. Ticked
> boxes are not proof; real-backend evidence is. This catalog drives authoring work.
>
> **2026-07-11 update:** the **RB** layer described below
> (`apps/desktop/e2e/real-backend/*.spec.ts`, Playwright + `tauri-driver` +
> `WebKitWebDriver`) was never completed and has since been superseded
> end-to-end by spec 037's `crates/e2e-tests` Layer-2 harness (thirtyfour +
> `tauri-plugin-webdriver` + cargo-nextest, run in `.github/workflows/e2e.yml`
> on Linux+Windows CI, not the WSL sandbox this doc's RB layer targeted). The
> `apps/desktop/e2e/` scaffold (`README.md`, `tsconfig.json`) referenced
> throughout this file has been removed (spec 033 T085) as it described a
> directory structure that no longer exists on `main`. Any row below marked
> RB/"missing" should be checked against
> `specs/037-e2e-integration-testing/contracts/coverage-matrix.md` — the
> currently-maintained source of truth for e2e coverage state — before being
> treated as an open gap.

---

## 1. Layer definitions

| Layer | ID | Description | Signal strength | When to use |
|---|---|---|---|---|
| Rust unit (in-memory SQLite) | **RU** | `#[tokio::test]` or `#[test]` in crate, uses `Database::in_memory()` + migrations | Strongest for backend logic | Business rules, state machines, audit, safety invariants, data-plumbing |
| Rust integration (cross-crate) | **RI** | `tests/contract/` or `crates/app/core/tests/` — same in-memory SQLite, tests crossing crate boundaries | Strong for seam correctness | Contract serialization, cross-crate flows, use-case integration |
| Vitest component (jsdom) | **VC** | `src/**/*.{test,spec}.{ts,tsx}` — RTL + vitest, no Tauri bridge | Good for frontend logic, render, forms | UI state, component behaviour, mock-driven command call assertions |
| Playwright mocks-UI e2e | **PE** | `tests/e2e/*.spec.ts` — Playwright against `VITE_USE_MOCKS=true` Vite server (no Tauri) | Good for routing, full-page render, navigation | Route redirects, wizard flows, page-level integration with mocks |
| Real-backend headless e2e | **RB** | `apps/desktop/e2e/real-backend/*.spec.ts` — Playwright against real Tauri (`VITE_USE_MOCKS=false`) via xvfb + tauri-driver | Strongest for IPC correctness on real data | Features that can only fire on real SQLite, subscribers, safety paths |
| Manual Windows-native | **MW** | Runbook item (`windows-validation-runbook.md`) | Human judgement, real WebView2 | Platform-specific, first-run UX, OS-trash, file picker |

---

## 2. Core user journey scenarios (end-to-end, all layers)

The handover DoD defines the core journey a real user must be able to complete.
Each step below is a scenario cluster; subscenarios are numbered.

### J-1 First-run + index routing

| ID | Scenario | Layer | Spec | FR/SC | State |
|---|---|---|---|---|---|
| J-1.1 | `/` redirects to `/sessions` when setup is complete (not crash) | PE | 020, 028 | — | **exists (R-1 regression PE test, see §4)** |
| J-1.2 | `/` redirects to `/setup` when setup is incomplete | PE | 020 | — | exists (`tests/integration/first_run_gate.spec.ts`) |
| J-1.3 | `checkFirstRunComplete` returns true/false correctly | VC | 020 | — | exists (`first-run.test.ts`) |
| J-1.4 | First-run wizard completes full happy path → lands on sessions | PE | 020 | — | exists (`first_run_happy_path.spec.ts`) |
| J-1.5 | Index redirect is a real `throw redirect`, not `<SessionsPage>` render | RB | — | — | **missing** — add to RB suite once harness is ready |

### J-2 Ingest folder → sessions appear & group

| ID | Scenario | Layer | Spec | FR/SC | State |
|---|---|---|---|---|---|
| J-2.1 | Inbox scan classifies FITS folder by IMAGETYP → breakdown rows show light/dark/flat | VC | 005 | FR-001, FR-002 | exists (`InboxPage.classify.test.tsx`) |
| J-2.2 | Inbox confirm with `action:"confirm"` calls the right command | VC | 005 | FR-015 | exists (`InboxPage.classify.test.tsx`) |
| J-2.3 | Inbox confirm with `action:"split"` for mixed type | VC | 005 | FR-016 | exists (`InboxPage.classify.test.tsx`) |
| J-2.4 | After confirm, sessions list shows the ingested session (real DB) | RB | 006 | FR-001 | **missing** — blocked on US3 (root_id plumbing) |
| J-2.5 | Sessions group correctly by root_id after confirm | RU | 006 | FR-002 | **missing** — blocked on US3 |
| J-2.6 | Inventory list renders sessions without crashing when root_id is null | VC | 006 | — | exists (`SessionsPage.inventory.test.tsx`) |
| J-2.7 | Plan listener auto-resolves inbox item after plan apply | RU | 005 | FR-020 | exists (`crates/app/core/tests/`) |
| J-2.8 | `start_inbox_plan_listener` is spawned in `run_app` | RB | 005 | — | **exists (R-3 regression RU test, see §4)** |

### J-3 Confirm/inbox split → calibration suggests

| ID | Scenario | Layer | Spec | FR/SC | State |
|---|---|---|---|---|---|
| J-3.1 | CalibrationMatchPanel renders candidates for a session | VC | 007 | FR-001 | exists (`CalibrationMatchPanel.test.tsx`) |
| J-3.2 | MastersList renders with null fingerprints (no crash) | VC | 007 | — | **exists (R-2 regression VC test, see §4)** |
| J-3.3 | MastersList groups by dark/flat/bias, hides dark_flat | VC | 007 | FR-001 | exists (`MastersList.test.tsx`) |
| J-3.4 | Calibration matching engine: fingerprint match returns ranked candidates | RU | 007 | FR-001 | exists (66 tests in `crates/calibration/core`) |
| J-3.5 | Calibration suggest fires on real data after fingerprint-population pass | RB | 007 | FR-002 | **missing** — blocked on US3 |
| J-3.6 | Masters list backed by real DB rows (not fixture stub) | RB | 007 | FR-001 | **missing** — blocked on US3 (fixture stub) |

### J-4 Create project → reviewable plan

| ID | Scenario | Layer | Spec | FR/SC | State |
|---|---|---|---|---|---|
| J-4.1 | CreateProjectDialog calls `projects.create` with correct payload | VC | 008 | FR-001 | exists (`CreateProjectDialog.test.tsx`) |
| J-4.2 | Project create → plan generated in same transaction (no orphan) | RU | 008 | FR-006 | **missing** — blocked on US5 (partial-create gap) |
| J-4.3 | `project.create` contract lifecycle const reflects real initial state | RI | 008 | — | **missing** (stale `"setup_incomplete"` const) |
| J-4.4 | Plans list shows plan with correct state after create | RB | 008, 017 | FR-001 | **missing** |

### J-5 Apply plan safely (audited, no escape, recoverable)

| ID | Scenario | Layer | Spec | FR/SC | State |
|---|---|---|---|---|---|
| J-5.1 | Plan apply: colliding destination is refused (no silent overwrite) | RU | 025 | FR-002 | exists (executor unit tests) |
| J-5.2 | Plan apply: path join against library root, escape refused | RU | 025 | FR-002 | **missing** — T1-2 gap |
| J-5.3 | Plan apply: relative path with `../` escape is refused before mutation | RU | 025 | FR-002, Constitution §II | **missing** — T1-2 gap |
| J-5.4 | Plan apply: symlink traversal to outside root is refused | RU | 025 | FR-002 | **missing** — T1-2 gap |
| J-5.5 | Plan apply: each item writes an audit row | RU | 025 | FR-001 | exists (executor unit tests) |
| J-5.6 | Plan apply: bulk cancel writes per-item audit rows | RU | 025 | Constitution §II | **missing** — T1-2 gap |
| J-5.7 | Plan apply: destructive-confirm signal is distinct from is_protected | RU | 025 | FR-003 | **missing** — T1-2 logic inversion |
| J-5.8 | Plan apply: failed apply leaves recoverable state | RU | 025 | FR-002 | exists (rollback tests) |
| J-5.9 | Plan approval: `approved_mtime` + `approved_size_bytes` populated | RU | 017 | FR-FS-1 | **missing** — T2 gap |
| J-5.10 | Stale CAS check refuses apply when file changed since approval | RU | 017, 025 | FR-FS-1 | **missing** — blocked on J-5.9 |

### J-6 Manifests/notes persist

| ID | Scenario | Layer | Spec | FR/SC | State |
|---|---|---|---|---|---|
| J-6.1 | ProjectNotesSection persists note to DB | VC | 024 | FR-001 | exists (`ProjectNotesSection.test.tsx`) |
| J-6.2 | `note_update` command writes on-disk `notes/project-notes.md` | RB | 024 | Constitution §V | **missing** — `project_root:None` gap |
| J-6.3 | Manifests accordion renders source_map | VC | 024 | SC-001 | **missing** — source_map omitted |
| J-6.4 | Manifest auto-generates on workflow run completion (subscriber fires) | RB | 024 | FR-002 | **missing** — subscriber not spawned |

### J-7 Cleanup/archive respects protected sources

| ID | Scenario | Layer | Spec | FR/SC | State |
|---|---|---|---|---|---|
| J-7.1 | PlanProtectionGate renders blocked state for protected items | VC | 016 | FR-004 | exists (`PlanProtectionGate.test.tsx`) |
| J-7.2 | Plan generator tags items with real source_id + category | RU | 016 | FR-004 | **missing** — T1-1 gap (phantom) |
| J-7.3 | `plan_protection_check` fires on a plan with real protected source | RU | 016 | FR-004, Constitution §II | **missing** — T1-1 gap |
| J-7.4 | Global protection defaults persist (T-003/T-005) | RU | 016 | FR-003 | **missing** — T1-1 gap |
| J-7.5 | `protection.default.changed` audit event emitted | RU | 016 | FR-006 | **missing** — T1-1 gap |

### J-8 Cmd+K finds real targets

| ID | Scenario | Layer | Spec | FR/SC | State |
|---|---|---|---|---|---|
| J-8.1 | `search.global` returns real target by name from DB | RU | 023 | FR-001 | **missing** — T1-7 (fixture stub) |
| J-8.2 | `search.global` matches on alias, returns aliased result | RU | 023 | FR-002 | **missing** — T1-7 |
| J-8.3 | CommandPalette shows target result routes to /targets/<id> | VC | 023 | FR-004 | exists (`CommandPalette.test.tsx`) |
| J-8.4 | "Targets" is not in primary nav (FR-005 / SC-002) | VC | 023 | FR-005 | **missing** — T1-7 nav violation |
| J-8.5 | Target detail sessions/projects populated from real data | RB | 023 | FR-003 | **missing** — blocked on US3 |

---

## 3. Per-spec scenario catalog

### Spec 005 — Inbox / confirm

| ID | Scenario | Layer | FR/SC | State |
|---|---|---|---|---|
| 005-1 | ActionSidebar renders correct button for mixed/single classification | VC | FR-001/FR-002 | exists |
| 005-2 | Confirm calls `inboxConfirm` with correct action + signature | VC | FR-015/FR-016 | exists |
| 005-3 | Plan listener transitions inbox item → `resolved` after plan applied | RU | FR-020 | exists |
| 005-4 | `start_inbox_plan_listener` spawned in `run_app` before bus moved | RU | — | **exists (R-3 regression)** |
| 005-5 | Destructive-destination toggle (Archive vs OS-trash) rendered in UI | VC | FR-017 | **missing** — T1-6: toggle absent |
| 005-6 | `destructiveDestination` passed through confirm payload when set | VC | FR-017 | **missing** — T1-6 |
| 005-7 | Pattern resolved and snapshotted onto plan row | RU | FR-010 | **missing** — T1-6 |
| 005-8 | `repair` scheduler exists and provides orphan-item safety net | RU | — | **missing** — module does not exist |

Tier-1 gaps to author only after US-wiring pass (spec 033 FR/SC): 005-5 through 005-8.

### Spec 006 — Inventory / sessions

| ID | Scenario | Layer | FR/SC | State |
|---|---|---|---|---|
| 006-1 | Sessions list renders without crash | VC | FR-001 | exists (`SessionsPage.inventory.test.tsx`) |
| 006-2 | Inventory commands: filter by frame type returns correct sessions | VC | FR-002 | exists (`inventory.commands.test.ts`) |
| 006-3 | Session `root_id` set after inbox confirm | RU | FR-002 | **missing** — blocked on US3 |
| 006-4 | Mixed frame-type derived dynamically (not literal string) | RU | FR-003 | **missing** — T2 gap |
| 006-5 | "Show ignored items" Cmd+K entry present in palette | VC | FR-010 | **missing** — T2 gap |

### Spec 007 — Calibration

| ID | Scenario | Layer | FR/SC | State |
|---|---|---|---|---|
| 007-1 | Matching engine: ranked candidates for a fingerprinted session | RU | FR-001 | exists (66 tests) |
| 007-2 | MastersList renders with null fingerprint (no crash) | VC | — | **exists (R-2 regression)** |
| 007-3 | Masters list/get backed by real DB rows | RB | FR-001 | **missing** — fixture stub |
| 007-4 | Aging threshold from settings persisted and consumed by MastersList | RU | FR-002 | **missing** — T1-5/T2 wrong scope |
| 007-5 | Flat rotation + night tolerances user-configurable | RU | FR-002, SC-001 | **missing** — T2 gap |

### Spec 008 — Project creation

| ID | Scenario | Layer | FR/SC | State |
|---|---|---|---|---|
| 008-1 | CreateProjectDialog renders form fields, submits | VC | FR-001 | exists |
| 008-2 | Project create + plan in single transaction (failure leaves no orphan) | RU | FR-006 | **missing** — T2 gap |
| 008-3 | `project.create` contract lifecycle const reflects real initial state | RI | — | **missing** — stale const |

### Spec 009 — Lifecycle

| ID | Scenario | Layer | FR/SC | State |
|---|---|---|---|---|
| 009-1 | Legal transition success: entity + audit row committed | RU | FR-001 | exists (`transition_apply.rs`) |
| 009-2 | Illegal transition refused: no mutation, no audit row | RU | FR-001 | exists |
| 009-3 | BlockedBanner renders typed reason from backend | VC | FR-009, SC-001 | exists (component tests) |
| 009-4 | `blockedReason` in ProjectDetail comes from real DTO, not hardcoded `user` | RB | FR-009, SC-001 | **missing** — T1-3: hardcoded |
| 009-5 | Auto-block/auto-ready writes audit row (not event-bus only) | RU | Constitution §II | **missing** — T1-3 |
| 009-6 | Only one canonical project table (spec-002 `project.state` vs spec-008 `projects.lifecycle` reconciled) | RU | — | **missing** — T1-3 two-table gap |
| 009-7 | `project.unarchived` event emitted on unarchive transition | RU | — | **missing** — T1-3 |
| 009-8 | Lifecycle filter is multi-select (SC-004) | VC | SC-004 | **missing** — T1-3 |

### Spec 010 — Guided overlay

| ID | Scenario | Layer | FR/SC | State |
|---|---|---|---|---|
| 010-1 | GuidedOverlay renders at correct anchor | VC | FR-001 | exists |
| 010-2 | Guided step advances on domain event (`completeGuidedStep` called) | VC | FR-003 | **missing** — T1-8 wiring unconfirmed |
| 010-3 | All anchor IDs registered in `anchors.ts` present in component DOM | VC | — | exists (`anchors.test.ts` — CI gate) |
| 010-4 | `react-joyride` dependency removed or actually used (not dead) | VC | — | **missing** — T1-8: declared unused |
| 010-5 | Backend step state machine transitions correctly | RU | FR-002 | exists |

### Spec 011 — Tool launch

| ID | Scenario | Layer | FR/SC | State |
|---|---|---|---|---|
| 011-1 | Tool-id alias resolution corrected | VC | — | exists (`tool-launch.test.ts`) |
| 011-2 | PixInsight boundary: spawn-and-walk-away, no scripting API calls | RU | Constitution §III | exists |

### Spec 012 — Artifact watcher

| ID | Scenario | Layer | FR/SC | State |
|---|---|---|---|---|
| 012-1 | Artifact detection fires `artifact.detected` event | RU | FR-001 | exists |
| 012-2 | `artifact.classified` event emitted on classify (distinct from detected) | RU | FR-008 | **missing** — T1-9: event never emitted |
| 012-3 | `artifact.classify` response shape matches contract | RI | — | **missing** — T1-9: shape divergence |
| 012-4 | Watcher loop spawned at startup (real watch-path registration) | RB | — | **missing** — blocked on US2 |

### Spec 013 — Target lookup

| ID | Scenario | Layer | FR/SC | State |
|---|---|---|---|---|
| 013-1 | Target lookup by name returns correct object | RU | FR-001 | exists |
| 013-2 | Catalog slug mismatch: slug `common/openngc` parsed correctly | RI | — | **missing** — T2: mismatch → `Unknown` |
| 013-3 | FR-009 active-catalog-set filter applied to query (not full index) | RU | FR-009 | **missing** — T2: always full index |

### Spec 014 — Catalog licensing

| ID | Scenario | Layer | FR/SC | State |
|---|---|---|---|---|
| 014-1 | SHA-256 checksum verified on download | RU | FR-001 | exists |
| 014-2 | Minisign signature verified cryptographically (not just parsed) | RU | FR-001 | **missing** — T1-4: never verified |
| 014-3 | Unknown license code hard-fails (no silent `PublicDomain` fallback) | RU | FR-001 | **missing** — T1-4 |
| 014-4 | Catalog upsert + attribution in single transaction | RU | FR-002 | **missing** — T1-4 |

### Spec 015 — Token patterns

| ID | Scenario | Layer | FR/SC | State |
|---|---|---|---|---|
| 015-1 | Pattern parser round-trips all token types | RU | FR-001 | exists (56 tests) |
| 015-2 | Resolver produces correct destination path | RU | FR-002 | exists |

### Spec 016 — Protection gating

| ID | Scenario | Layer | FR/SC | State |
|---|---|---|---|---|
| 016-1 | PlanProtectionGate renders blocked state | VC | FR-004 | exists |
| 016-2 | Plan generator tags item with real `source_id` + `category` | RU | FR-004 | **missing** — T1-1: phantom |
| 016-3 | `plan_protection_check` fires on protected-source plan item | RU | FR-004, FR-005 | **missing** — T1-1 |
| 016-4 | `source_id` populated on `ProtectedPlanItem` in response | RU | FR-004 | **missing** — T1-1 |
| 016-5 | Global defaults persist via T-003/T-005 | RU | FR-003 | **missing** — T1-1 |
| 016-6 | `protection.default.changed` audit event emitted | RU | FR-006 | **missing** — T1-1 |

### Spec 017 — Plans

| ID | Scenario | Layer | FR/SC | State |
|---|---|---|---|---|
| 017-1 | `approve_plan` populates `approved_mtime` + `approved_size_bytes` | RU | FR-FS-1 | **missing** — T2 |
| 017-2 | `reopen` (approved → draft) transition supported | RU | — | **missing** — T2 |
| 017-3 | Plan state machine transitions: draft → approved → applying | RU | FR-001 | exists |

### Spec 018 — Settings

| ID | Scenario | Layer | FR/SC | State |
|---|---|---|---|---|
| 018-1 | Transport: settings values round-trip through the command | RU | FR-001 | exists |
| 018-2 | Aging-threshold writes to correct scope + key and persists | RU | FR-002, SC-001 | **missing** — T1-5: wrong scope, silently dropped |
| 018-3 | `emit_snapshot` called by the debounce timer | RU | — | **missing** — T1-5: no caller |
| 018-4 | Cleanup per-type action table sourced from real DB (not fixtures) | RB | — | **missing** — T2: still fixtures |
| 018-5 | CalibrationMatching aging threshold control persists with correct key | VC | SC-001 | **missing** — T1-5 (same bug as 007 aging) |

### Spec 019 — Log viewer

| ID | Scenario | Layer | FR/SC | State |
|---|---|---|---|---|
| 019-1 | Pull-recent returns log entries | RU | FR-001 | exists |
| 019-2 | Export writes JSON to path | RU | FR-002 | exists |
| 019-3 | `contractVersion` in runtime response matches schema const `"2.0.0"` | RI | — | **missing** — T2: runtime emits `"1"` |
| 019-4 | `dia:` cursor prefix parsed for diagnostic resume | RU | — | **missing** — T2: silently replays full window |
| 019-5 | Export path uses file picker (not hardcoded `/tmp`) | MW | — | **missing** — T2: manual only |
| 019-6 | `log.export` response contains `status` field | RI | — | **missing** — T2 |
| 019-7 | `start_log_forwarder` spawned in `run_app` | RU | — | **exists (R-3 regression)** |

### Spec 021 — Dev diagnostics

| ID | Scenario | Layer | FR/SC | State |
|---|---|---|---|---|
| 021-1 | Rust dev commands absent from default build (no `dev-tools` feature) | RU | Constitution | exists (build verification in runbook §0) |
| 021-2 | Dispatcher wrap auto-captures real IPC calls (SC-002) | RB | SC-002 | **missing** — T2: wrap never installed |
| 021-3 | `dev_export` uses absolute path (not relative) | RU | — | **missing** — T2: always fails |
| 021-4 | Frontend dev bundle gated from release (T031/T036) | VC | — | **missing** — T2: bundle always included |

### Spec 023 — Target identity

| ID | Scenario | Layer | FR/SC | State |
|---|---|---|---|---|
| 023-1 | TargetDetailV2 renders aliases, notes | VC | FR-001 | exists (`TargetDetailV2.test.tsx`) |
| 023-2 | `search.global` queries real DB (not fixture) | RU | FR-001 | **missing** — T1-7 |
| 023-3 | `search.global` matches on alias | RU | FR-002 | **missing** — T1-7 |
| 023-4 | Alias/rename/note writes real audit-bus records (not `tracing::info!`) | RU | FR-004, FR-006 | **missing** — T1-7 |
| 023-5 | "Targets" not in primary nav (FR-005, SC-002 violation) | VC | FR-005, SC-002 | **missing** — T1-7 |
| 023-6 | Target detail sessions/projects list populated from real FK | RB | FR-003 | **missing** — blocked on US3 |

### Spec 024 — Manifests

| ID | Scenario | Layer | FR/SC | State |
|---|---|---|---|---|
| 024-1 | `project_notes` write persists DB row | RU | FR-001 | exists |
| 024-2 | `note_update` writes on-disk `project-notes.md` (real path) | RB | Constitution §V | **missing** — T2: `project_root:None` |
| 024-3 | Manifest subscriber spawned and auto-generates on run completion | RB | FR-002 | **missing** — T2: subscriber not spawned |
| 024-4 | ManifestsAccordion renders `source_map` | VC | SC-001 | **missing** — T2 |

### Spec 025 — Filesystem executor

| ID | Scenario | Layer | FR/SC | State |
|---|---|---|---|---|
| 025-1 | Move refuses existing destination (no silent overwrite) | RU | FR-002 | exists |
| 025-2 | Move/archive rolls back on partial failure | RU | FR-002 | exists |
| 025-3 | Approval is CAS-gated (approved → applying state check) | RU | FR-002 | exists |
| 025-4 | Path join against library root before any mutation | RU | FR-002, Constitution §II | **missing** — T1-2 |
| 025-5 | `../` escape in item path refused before mutation | RU | FR-002, Constitution §II | **missing** — T1-2 |
| 025-6 | Symlink outside root refused before mutation | RU | FR-002, Constitution §II | **missing** — T1-2 |
| 025-7 | Bulk cancel writes per-item audit rows | RU | Constitution §II | **missing** — T1-2 |
| 025-8 | Destructive-confirm signal is separate from `is_protected` | RU | FR-003 | **missing** — T1-2 logic inversion |
| 025-9 | `retry_queue` actually re-injects into executor loop | RU | FR-004 | **missing** — T1-2: never re-injects |
| 025-10 | `resume_run` resumes the in-process task (not just DB state) | RU | FR-005 | **missing** — T1-2: tokio task already returned |

### Spec 026 — Source-view removal

| ID | Scenario | Layer | FR/SC | State |
|---|---|---|---|---|
| 026-1 | CHECK constraint via migration 0029 prevents invalid plan type | RU | — | exists |
| 026-2 | Permanent delete requires "DELETE" confirmation | VC | FR-001 | exists |
| 026-3 | Block-permanent-delete setting honored | RU | FR-002 | exists |
| 026-4 | SourceViewsSection shows per-item inventory refs | VC | SC-002 | **missing** — T2: count only |
| 026-5 | Contract descriptions drop stale "NOT IMPLEMENTED" text | RI | — | **missing** — T2: stale text |

### Spec 028 — Quality hardening

| ID | Scenario | Layer | FR/SC | State |
|---|---|---|---|---|
| 028-1 | AppErrorBoundary catches render errors, shows fallback | VC | FR-001 | exists |
| 028-2 | Token guard `check-tokens.sh` runs in `just lint` | MW | — | **exists (wired 2026-06-17)** |
| 028-3 | No `--alm-radius` undefined token in NamingStructure.tsx | VC | — | **exists (R-4 regression: lint gate)** |
| 028-4 | ESLint flat config runs via `just lint` | MW | — | **exists (wired 2026-06-17)** |

---

## 4. Regression tests — already-fixed items (DO author now)

These pin behavior that was **broken and then fixed on 2026-06-17**. They must
exist so the fixes cannot regress silently. The current state (after fix) is the
correct baseline.

| ID | Fix | What it pins | Layer | State |
|---|---|---|---|---|
| R-1 | Index route crash | `/` throws `redirect({to:'/sessions'})`, never renders `SessionsPage` at the index match | PE | **authoring below (§4.1)** |
| R-2 | MastersList null fingerprint | `MastersList` renders without crash when `fingerprint` is null/undefined for every field | VC | **authoring below (§4.2)** |
| R-3 | run_app startup wiring | `start_inbox_plan_listener` + `start_log_forwarder` are called in `run_app` before bus/pool moves | RU | **authoring below (§4.3)** |
| R-4 | Token lint gate | `just lint` wires `check-tokens.sh` + ESLint; token guard sees no `--alm-radius` reference | — | pinned by the gate itself (lint fails if broken) |

### 4.1 R-1: `/` redirects to `/sessions` (Playwright mocks-UI)

File: `tests/e2e/regression_r1_index_redirect.spec.ts`

The test seeds `alm.first-run.completed=1` so setup is done, then navigates to
`/` and asserts the router lands on a URL containing `sessions`, and that no
error boundary is visible.

### 4.2 R-2: MastersList null fingerprint guard (vitest component)

File: `apps/desktop/src/features/calibration/MastersList.regression.test.tsx`

The test renders `MastersList` with a master whose `fingerprint` is `null` and
another with `fingerprint` that has all numeric fields as `undefined`. Asserts no
throw, list renders.

### 4.3 R-3: run_app startup wiring (Rust unit, feature-file inspection)

File: `crates/app/core/tests/run_app_startup_wiring.rs`

The test is a compile-time assertion via a doc-test or by calling the public
`start_inbox_plan_listener` function directly in a unit test with an in-memory
pool — proving the symbol is importable and callable. The real spawn is in
`apps/desktop/src-tauri/src/lib.rs` which is not under workspace test, but a
grep-style assertion in a separate `#[test]` that reads the source file and
confirms the call sites are present provides a canary.

---

## 5. Scenarios deferred to spec 033 authoring (red acceptance tests)

**DO NOT author these against current behavior.** They are acceptance tests
for spec 033's FRs/SCs and must be written against the defined behaviour
after the spec artifacts are reviewed.

| Cluster | Items | Blocked on |
|---|---|---|
| US1 — filesystem safety | J-5.2, J-5.3, J-5.4, J-5.6, J-5.7, 025-4 through 025-10, J-5.9, J-5.10 | spec 033 FR/SC; T1-2 fixes |
| US2 — subscriber startup | J-2.8 (full), J-6.4, 012-4, 024-3 | spec 033 FR/SC; T1-2 must go first |
| US3 — ingestion data plumbing | J-2.4, J-2.5, J-3.5, J-3.6, J-8.1, J-8.2, J-8.5, 006-3, 007-3 | spec 033 FR/SC |
| US4 — protection gating | J-7.2 through J-7.5, 016-2 through 016-6 | spec 033 FR/SC; US1 first |
| US5 — lifecycle integrity | J-4.2, 009-4 through 009-8, 008-2, 008-3 | spec 033 FR/SC |
| US6 — settings + contract fidelity | 018-2 through 018-5, 007-4, 019-3, 019-4, 019-6, 012-2, 012-3 | spec 033 FR/SC |
| US7 — catalog integrity | 014-2 through 014-4, 013-2, 013-3 | spec 033 FR/SC; external repo |
| US8 — dev surface + misc | 021-2 through 021-4, 005-5 through 005-8, 006-4, 006-5, 026-4, 026-5 | spec 033 FR/SC |

---

## 6. Scenario count summary

### By spec

| Spec | Total scenarios | Exists | Missing | Deferred (post-033) |
|---|---|---|---|---|
| 005 | 8 | 4 | 0 | 4 |
| 006 | 5 | 2 | 0 | 3 |
| 007 | 5 | 2 | 0 | 3 |
| 008 | 3 | 1 | 0 | 2 |
| 009 | 8 | 3 | 0 | 5 |
| 010 | 5 | 3 | 2 | 0 |
| 011 | 2 | 2 | 0 | 0 |
| 012 | 4 | 1 | 1 | 2 |
| 013 | 3 | 1 | 0 | 2 |
| 014 | 4 | 1 | 0 | 3 |
| 015 | 2 | 2 | 0 | 0 |
| 016 | 6 | 1 | 0 | 5 |
| 017 | 3 | 1 | 0 | 2 |
| 018 | 5 | 1 | 1 | 3 |
| 019 | 7 | 2 | 1 | 4 |
| 021 | 4 | 1 | 1 | 2 |
| 023 | 6 | 2 | 1 | 3 |
| 024 | 4 | 1 | 0 | 3 |
| 025 | 10 | 3 | 0 | 7 |
| 026 | 5 | 3 | 0 | 2 |
| 028 | 4 | 4 | 0 | 0 |
| **Total** | **103** | **41** | **7** | **55** |

### By layer

| Layer | Total scenarios | Exists | Needed now | Deferred |
|---|---|---|---|---|
| Rust unit (RU) | 52 | 18 | 4 | 30 |
| Rust integration (RI) | 5 | 0 | 2 | 3 |
| Vitest component (VC) | 28 | 18 | 3 | 7 |
| Playwright mocks-UI (PE) | 8 | 5 | 1 | 2 |
| Real-backend headless (RB) | 8 | 0 | 0 | 8 |
| Manual Windows-native (MW) | 2 | 1 | 0 | 1 |

"Needed now" = regression pinning or canary tests safe to write against current
behaviour. "Deferred" = must wait for spec 033 FR/SC definition.

---

## 7. Real-backend e2e harness notes

See `apps/desktop/e2e/README.md` for setup instructions and harness architecture.

The harness uses `VITE_USE_MOCKS=false` + xvfb + the real Tauri process in a mode
where Playwright connects to the Chromium/WebKit devtools endpoint exposed by
`tauri dev --inspect` (or via `tauri-driver` + `WebKitWebDriver` for the full
W3C protocol). Individual test files in `apps/desktop/e2e/real-backend/` are
intentionally skipped until spec 033 implementation lands.

---

## 8. Known test debt (cross-cutting)

1. **No JSON-Schema conformance tests** — contract shapes are never validated at
   runtime. The `tests/contract/contract_schema_parity.rs` file exists but is not
   comprehensive. Missing: 019 `contractVersion`, 012 `artifact.classify` shape,
   008 `project.create` lifecycle const, 014 license fallback.

2. **tasks.md checkboxes are unreliable** — 010 claims
   `GuidedOverlay.test.tsx` / `anchors.test.ts` are phantom but both exist; the
   phantom claim in the validation findings referred to `completeGuidedStep` event
   wiring tests (still missing). Cross-reference the file-system, not ticks.

3. **Playwright e2e vs real-backend gap** — all existing Playwright tests run
   against `VITE_USE_MOCKS=true`. Real-backend tests require the harness in
   `apps/desktop/e2e/` which is newly scaffolded and currently has no live specs.

4. **Rust integration tests are contract-only** — `tests/contract/` covers DTO
   shape, not behaviour. Cross-crate use-case tests live in
   `crates/app/core/tests/` and are the strongest signal for backend logic.
