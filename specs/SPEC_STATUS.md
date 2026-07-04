# Spec Status & Plan

**Living index of SpecKit feature status, dependencies, and the actionable frontier.**

Last reconciled: **2026-06-23** (full sweep). **2026-07-03**: 043 list-page
consistency + mock-mode E2E test redo landed (see the 043 row + CI note below).
**2026-07-03 (later)**: `redesign-ui-platevault` reconciled with its pushed
remote (041 single-type impl + 046/037/#360 merged); CI re-enabled; verified
against code — 041 iter-2 is implemented on the branch, 017 has UI. See the
updated 041 / 017 rows and the CI note.

> The per-spec `Status:` line in each `spec.md` had drifted badly — most still read
> "Draft" despite shipping. This document is the reconciled source of truth. Status
> here was verified against task completion, real code on `main`, and merge evidence,
> not the `Status:` field alone. When a spec ships or changes, update both its own
> `Status:` line **and** this table.

## Legend

| Marker | Meaning |
|---|---|
| ✅ Implemented | Shipped + verified |
| 🟡 Closeout-ready / partial | Core shipped; remaining tasks are DEFERRED or a small remainder |
| 🟠 Substantial open work | Real unfinished surface |
| 🔵 Active | In progress now |
| ⚪ Not started | Greenfield / placeholder |
| 🔴 Superseded | Replaced by another spec |

## Status by spec

| Spec | Status | Notes |
|---|---|---|
| 001 astro-library-manager | ✅ Closed | Umbrella/planning baseline |
| 002 data-lifecycle-state-model | ✅ Implemented (review) | 57/57; lifecycle partly *dropped* in inbox redesign — worth a tension review |
| 003 first-run-source-setup | ✅ Implemented | 32/32 (via 027/029) |
| 004 native-filesystem-controls | ✅ Implemented | 32/32 |
| 005 inbox-mixed-folder-split | 🔴 Superseded by 041 | 0/51; reassigned to 041 single-type model — **not yet implemented** (PR #315 docs-only) |
| 006 inventory-library-lifecycle | ✅ Implemented (closed 2026-07-03) | Core + 041/043/040 reconciliation landed; 12 open tasks all DEFERRED (Playwright-in-WSL, docs, additive-contract, spec-002-blocked enum snapshot). (Superseded a 2026-06-23 verify pass that found it NOT closeable due to a phantom `session.mixed_state` guard + 043 filter gaps; those were reconciled before this closeout.) |
| 007 calibration-matching-rules | ✅ Implemented (closed 2026-07-03) | Engine + adapters + DTOs shipped; 11 open all DEFERRED — 8 contract-tests (JSON-Schema runner absent), T040 (spec-002 enum), T032/T033 polish. `require_same_offset` **exists** in Rust; only the 043 Settings toggle's persistence is stubbed |
| 008 project-create-onboard-edit | 🟡 Partial | 28/38; ~6 real-open |
| 009 project-lifecycle-model | ✅ Implemented | 21/21 |
| 010 guided-first-project-flow | 🟡 Near-complete | 31/33 |
| 011 processing-tool-launch | ✅ Implemented (closed 2026-07-03) | Launch pipeline + UI + cwd-guard + detach/pid shipped & tested; T021 hint + X-1/X-2 done in closeout; 2 open (T018 Playwright, T022 real-spawn) DEFERRED (WSL/sandbox-blocked). Unblocks 012 |
| 012 processing-artifact-observation | 🟡 Partial | 26/36 (follows 011) |
| 013 target-lookup-from-fits-object | 🔴 Superseded by 035 | Fully subsumed by 035 — every FR/US covered by SIMBAD resolve-on-demand, or its one unique feature (fuzzy variant matching + confidence tiers) deliberately reversed (035 clarification Q4: exact-match only). 3 open tasks are obsolete stubs (spec-014 download pipeline / removed `catalog_equivalences`). Target-identity model retained in `crates/targeting/` |
| 014 catalog-index-licensing | 🔴 Superseded by 035 | download-catalog mechanism abandoned; attribution model retained |
| 015 token-pattern-builder | ✅ Implemented | Chip-based naming-pattern builder shipped: `crates/patterns/` (registry/resolver/validator/sanitize, ~64 tests) + contracts + Tauri `pattern_validate`/`resolve`/`preview` + live `PatternChipsEditor` in `NamingStructure.tsx` (validate + preview). Full SpecKit artifact set exists (~30 tasks, not "0/0"). Deferred downstream scope (per-source overrides, session-backed preview) handed to spec 018 |
| 016 source-protection-defaults | 🟡 Near-complete | 17/20 (underpins 017) |
| 017 cleanup-archive-review-plans | 🟡 Backend done; Archive UI shipped, cleanup-review UI remainder open | Backend + archive/trash executor done; Archive UI exists (`features/archive/ArchivePage/List/Detail`). Remaining open work is the cleanup-plan *review* UI (contextual per v4), not greenfield — earlier "19 real-open / UI open" overstated it |
| 018 settings-configuration-model | ✅ Reconciled + implemented (#348) | 42/46; spec reconciled to as-built scope/values architecture; backend + UI shipped & verified (live T034 walkthrough); 4 obsolete (contracts mirror, 014 key); open: FR-006↔043 density tension (cross-spec decision) |
| 019 bottom-log-viewer | ✅ Implemented (closed 2026-07-03) | Panel + backend + forwarder shipped; closeout added T006/T011 jsdom tests + T029 docs index + fixed dotted `log.recent`→`log_recent` binding bug; 1 open (T028 Playwright quickstart) DEFERRED (needs Tauri runtime host) |
| 020 router-url-state | ✅ Implemented | 22/23 |
| 021 developer-contract-diagnostics | 🟡 Partial | 32/37 (behind `dev-tools` feature) |
| 022 mantine-prototype-design-system | 🔴 Superseded by 027 | |
| 023 target-identity-history-notes | ✅ **Closed** | US1–US4 shipped on gen-3 (migration 0048 + `target.sessions.list`/`target.projects.list`/`target.note.*`) + caveats (note-edit audit event, UUID project deep-link, 16 KB note cap) + `speckit-verify` passed. `target.primary.rename` dropped; FR-005/FR-007 deferred |
| 024 project-manifests-and-notes | ✅ Implemented (closed 2026-06-23) | 32/37; 5 open all DEFERRED (FR-006/export/contract-tests); notes display-on-load fixed at close-out |
| 025 filesystem-plan-application | 🟡 Partial (out-of-spec) | Real apply shipped via 041; rollback + progress UI open |
| 026 generated-source-view-removal | 🟡 OPEN — core built, POSSIBLY OBSOLETE | 12/23; remove/regenerate feature fully wired but **vestigial** — no live source-view *generation* path after the 041/043 lifecycle-prep drop. Kept **open** (not closed): P3 (T014–T020 stale-detection + audit) deferred; awaiting product decision to restore generation or retire the surface |
| 027 frontend-implementation | ✅ Implemented | 99/99 |
| 028 frontend-quality-hardening | 🟡 Placeholder | 9/15 |
| 029 tauri-backend-wiring | ✅ Implemented | 52/52 |
| 030 ui-audit-revision | 🔴 Superseded | delivered by 031/032 |
| 031 design-v3-implementation | ✅ Closed | superseded by 032 |
| 032 design-v4-implementation | ✅ Implemented | |
| 033 validation-bugfix-remediation | 🟡 Partial | 83/92; blocked on 017 cleanup generator |
| 035 simbad-target-resolution | ✅ Implemented | validated end-to-end 2026-06-23 |
| 036 retire-legacy-targets | ✅ Implemented | PR #255 |
| 037 e2e-integration-testing | 🟠 Partial / gated | 24/39; Layer-1 + CI Stage A done. Gate note is now stale — `search.global`/`sessions.list`/`calibration.masters` graduated to real backends; only `sessions.transition` + tauri-driver wiring remain |
| 037 ipc-wrapper-removal | ✅ Complete | All caller areas migrated + merged 2026-07-03 (sessions #369, shell #372, settings #373, setup #374, targets #375, inbox #376, projects #377, dev #378, + fix `ad3497e1`); **0 live `@/api/commands` imports**. dev-tools commands generated under `--features dev-tools` (option C). Phase-4 teardown done: `commands.ts` + its guard test deleted, dead mocks removed, SC-001/SC-005 enforced by `api/ipc-boundary.guard.test.ts`; also swept guided + source-views callers |
| 038 wizard-scan-step | ✅ Implemented | merged (no committed tasks.md) |
| 039 cross-root-inbox | 🔴 Superseded by 041 | Scope fully implemented via 041 — cross-root `inbox_list`, inbox optional (`REQUIRED_KINDS`), rescan-all, bounded/virtualized. All 3 US + 7 FR + 5 SC verified in code 2026-07-03. No plan/tasks.md authored |
| 040 calibration-masters-detection | ✅ Implemented | validated end-to-end 2026-06-23 |
| 041 inbox-plan-surface | ✅ iteration-1 / 🟡 iteration-2 implemented on `redesign-ui-platevault` (pending merge to main) | iter-1 (confirm + plan surface + apply + destination model) shipped 59/59. **iter-2 (single-type sub-items, T061–T081) is now implemented with tests on `redesign-ui-platevault`** — migration `0049_inbox_single_type.sql`, real missing-mandatory gate (`inbox/confirm.rs` sentinel), field-agnostic `reclassify_v2` (`inbox/reclassify.rs`), `build_frame_metadata` grouping (`inbox/classify.rs`), split/mixed confirm action removed from the contract. **Not yet on `main`** — lands with PR #349. Supersedes 005 |
| 042 stdlib-adoption | ✅ Implemented | 80/97; reconciled #310 |
| 043 ui-redesign-platevault | 🔵 Active (foundation + round-2 done; PR #349 mergeable) | Ongoing on `redesign-ui-platevault`. Foundation + per-page round-2 verified against code: 4-theme tokens + Appearance picker, shared `<SortHeader>`/`.alm-sorth`, flat-by-default `.alm-listgroup` on all 4 list pages (#360), `InfoTip`/`SettingsKit`, Inbox bottom inspector, `eslint no-restricted-syntax` style-ban wired into lint. PENDING: Archive single-column, full Sessions inbox-parity, pill-system unification, resizable splitters, Settings per-pane polish. STUBs (all `// STUB:`-marked, blocked on backend): offset Settings-toggle **persistence** (the Rust `require_same_offset` field already exists in `calibration/core/ranking.rs`; only the settings-key wiring is stubbed), channel model, `altitudeCurve()`@52.1°N, Targets list enrichment (#54), + Outputs/Cleanup, audit-history endpoint. Known gap: Sessions table sortable but `aria-sort` not emitted (a11y follow-up). PR #349 → main is **mergeable** (3 behind main). |
| 044 targets-planner-astronomy | ⚪ Placeholder — Track B spec in progress (user session) | Split 2026-07-04: 044 = **Track B** (observer-location ephemeris engine: altitude curves/rise/set/transit, research-gated, being specced by the user separately); the moon/filter/opposition half moved to **047** and is now real (047 implemented). Track B's own altitude/imaging-time/visible-tonight columns remain placeholder (`planner-altitude.ts`, unchanged by 047 per FR-015/016) pending this spec |
| 045 review-state-real | 🔴 Superseded by 041 | |
| 046 i18n-error-codes | ✅ Implemented | 36/36 (#311–#314) |
| 047 targets-planner-moon-filters | ✅ Implemented (T001–T027, T029; T028 verify-on-windows pending) | Track A of the planner split, fully implemented on `047-targets-planner-moon-filters`: real Moon summary (US1), real per-target lunar distance + sort (US2), real per-band Moon-avoidance filter guidance pills + explanation popover + Settings → Target Planner per-band table + filter-by-recommendation (US3), real next-opposition date + sort (US4). All former spec 044 §3 mock symbols (`MOCK_MOON_PHASE_FRAC`, `mockLunarDistanceDegFor`, `filtersFor`) deleted; Track B altitude/imaging-time placeholders untouched (FR-015/016). Perf-optimized opposition scan (per-night memoized Sun-RA table) validated at 5,000 rows. T028 (verify-on-windows) intentionally deferred to a separate campaign lane |
| tiny/ catalog-entry, settings-key | 📄 Micro-specs | reference notes, not tracked features |

## Dependency DAG

```
FOUNDATION (all ✅ — nothing blocked here)
  022 mantine ─▶ 027 frontend ─▶ 029 tauri-wiring ─▶ 032 design-v4
  002 lifecycle ✅   020 router ✅   030/031 (superseded/closed)

INBOX CHAIN
  005 mixed-folder 🔴 ─▶ 041 inbox-plan-surface ✅ ─┬─▶ 039 cross-root-inbox ⚪
  038 wizard-scan ✅                                ├─▶ 025 plan-application 🟡 (rollback+progress UI)
  016 protection 🟡 ─▶ 017 cleanup/archive 🟡 ──────┼─▶ 033 validation-bugfix 🟡 (needs 017 generator)
                                                    └───┘

TARGETS CHAIN
  013 fits-lookup 🟡 ┐
  014 catalog 🔴 ────┴─▶ 035 SIMBAD ✅ ─┬─▶ 036 retire-legacy ✅
                                        ├─▶ 023 target-identity ⚪ (tasks not generated)
                                        └─▶ 006 sessions ✅ ─▶ 044 planner-astronomy ⚪

CALIBRATION CHAIN
  006 inventory/sessions ✅ ─▶ 007 matching-rules ✅ ─▶ 040 masters ✅

PROJECTS CHAIN
  006 inventory ─▶ 008 project-create 🟡 ─▶ 009 lifecycle ✅ ─▶ 010 guided-flow 🟡
                       └─▶ 024 manifests/notes ✅
                  011 tool-launch ✅ ─▶ 012 artifact-observation 🟡

INFRA / CROSS-CUTTING (mostly independent)
  018 settings ✅   021 dev-diagnostics 🟡   019 log-viewer ✅
  046 i18n ✅   042 stdlib ✅   043 ui-redesign 🔵
  037 e2e 🟠 ◀── now gated only on sessions.transition + tauri-driver (search/sessions/calibration are real)
  037 ipc-removal ✅ (all phases done+merged; commands.ts deleted, guards in CI)
```

## Actionable frontier — what can be worked on now (unblocked)

| Priority | Spec | Why ready | Size |
|---|---|---|---|
| 1 | **017 cleanup-plan review UI** (remainder) | Backend + plan model (041) done; Archive UI shipped; 016 nearly done | 🟡 Medium (cleanup-review UI remainder) |
| 2 | **025 plan-application** (rollback + progress UI) | Apply backend already shipped via 041 | 🟡 Medium |
| 2 | **039 cross-root-inbox** | Greenfield; 041 base on main; needs plan/tasks | 🟡 Medium |
| — | **037 ipc-wrapper-removal** | ✅ Complete — commands.ts deleted, SC-001/SC-005 guards in CI | done |
| 3 | **012 artifact-observation** | 011 tool-launch now closed; 012's deps (`launch_id`, `completed_at`, accordion) satisfied | 🟡 Medium |
| 3 | **008 project-create** | 006 inventory closed | 🟡 Medium |
| 3 | **021 dev-diagnostics** | Independent, behind `dev-tools` flag | 🟡 Small |
| 3 | **023 target-identity** | 035 done; needs `/speckit.tasks` to generate tasks | ⚪ Plan exists, 0 tasks |
| active | **043 ui-redesign** | In progress on current branch | 🔵 Ongoing |

**Suggested parallel lanes:** one engineer on the **017 → 025 → 033** plan/cleanup chain; **043** continues on UI. (018 settings shipped via #348.)

## Closeout-ready (verify pass, not new work)

**Closed 2026-07-03:** 006, 007, 011, 019 flipped to Implemented after code-verified closeout (deferred tails documented; 011 T021 + 019 T006/T011/T029 + the `log_recent` bug done this session). 024 was closed earlier via #357 (2026-06-23). **026** deliberately kept **open** (vestigial/possibly-obsolete — product decision pending). No verify-flip work remains in this group.

## Blocked / not-yet-actionable

- **033 validation-bugfix** — dead cleanup-plan path depends on the **017** generator; do 017 first.
- **037 e2e** — real-UI suite now gated only on `sessions.transition` becoming real + tauri-driver wiring (`search.global`/`sessions.list`/`calibration.masters` already graduated to real backends).
- **044 planner-astronomy** — research-gated: needs an astronomy-engine decision (currently mock).

## Known repo-health issues (2026-06-23)

- **Fixed 2026-06-23 (PR #346):** the `Clippy (workspace, deny warnings)` CI red —
  `crates/app/targets/src/target_management.rs:506` `clippy::unnecessary_map_or`
  (`map_or(false, …)` → `is_some_and(…)`). Workspace `cargo clippy --all-targets -- -D warnings` now green.
- **Fixed 2026-06-23 (PR #317):** duplicate migration version `0046`
  (`session_canonical_target` + `target_constellation_magnitude`) broke fresh-install
  startup and every real-backend integration test. The later file was renumbered to `0047`.
  Watch for this class of collision when concurrent branches pick the next migration number.
- **Coordination (2026-06-23):** the `041-single-type-impl` / `041-single-type-ingest` branches
  (iteration-2, in progress by another agent) still carry the **old duplicate `0046` pair** — they
  predate PR #317 and must be rebased onto current `main` before adding a single-type migration,
  which should take the next free number (≥0048).

## Artifact drift audit (2026-06-23)

Per-spec review of plan/research/data-model/contracts/tasks vs shipped code.

### ✅ Resolved (PRs #343 / #344)
- **`os_trash` "code bug" was a false alarm** — the flagged `crates/app/core/src/inbox/confirm.rs`
  was **dead code** (orphaned pre-042-split copy; `app_core::inbox` re-exports `app_core_inbox`).
  The live `crates/app/inbox/src/confirm.rs` already uses `archive | trash` and is tested. The dead
  file was **deleted** (#343). No live bug ever existed.
- **017 destination enums** (`plan.get.json`, `plan.list.json`, `data-model.md`) `archive | os_trash`
  → `archive | trash` (#343). *Error-code strings `os_trash.*` were left intact — they match the live
  executor `crates/fs/executor/src/failure.rs` and are NOT drift.*
- **013** STALE/SUPERSEDED banners on `tasks.md` + `research.md` (#344).
- **023** reconcile banner + status flip (retired gen-2 model, nav reversed) (#344).
- **002** research §6.2 `catalog.download.*` SUPERSEDED banner (#344).
- **035** `plan.md` migration filename corrected (#344).
- **040** artifact-completeness deviation recorded in spec.md (#344).
- **0047** migration's stale internal `Migration 0046:` comment fixed (#341).
- **Clippy CI red** fixed (#346) — see repo-health above.
- **008 contract drift** closed (#346): `project.create.json` gained optional `canonicalTargetId`;
  `project.source.add.json` gained optional `role` (`light|dark|flat|bias`) + `selection`
  (`selected|candidate`), matching `SourceRole`/`SourceSelection` (`crates/contracts/core/src/projects_v2.rs`).
- **006 `noop` enum + 007 `mismatchedDimensions`** — re-verified **already correct**; the audit over-flagged
  them (no change needed).
- **Prose `os_trash`** destination-value mentions in 016 (spec/plan/research) + 025 (research) → `trash` (#346).
- **002** session-lifecycle-historical note added to spec.md near the supersession notice (#346).
- **024** uncontracted commands (`project.note.get`, `project.manifest.reveal_in_os`) recorded as deferred
  tasks TX.11/TX.12 (#346).

### ⬜ Still open
- 002/007 minor: `confidence` placement / `canonicalTargetId` on the session DTO contract (cosmetic; verify
  on next contract regen).
- 023 — full re-scope onto gen-3 + 035 (banner added; rewrite pending — needs product input on scope).
- 024 — author the two deferred JSON contracts (low priority).
- 041 `contracts/operations.md:60` `os_trash` prose — left to the active single-type agent.
- The live confirm path is `crates/app/inbox`; an earlier duplicate in `app_core` was removed — watch for
  other dead pre-042-split copies if similar drift appears.
- **2026-07-03 — mock-mode E2E green again (PR #364):** `lifecycle_detail.spec.ts` asserted on the
  pre-redesign `.alm-sessions-table__group` header, but #360 renamed it to `.alm-listgroup` AND made
  Sessions flat-by-default (no group rows unless grouped), so both tests failed. Fixed to assert on
  `.alm-sessions-table__row`; full mock-mode Playwright suite now 9 passed / 1 skipped.
- **CI test-disable (#356) — RESOLVED 2026-07-03.** The blanket `if: false` disable of all test
  jobs was removed and CI re-enabled on `redesign-ui-platevault` (commit `9a6c49a4`); tests are green
  (974 frontend vitest, `app_core_targets` 79). Pushed via `gh`'s `workflow`-scoped token
  (`gh auth setup-git` — git's stored OAuth credential lacked the scope).
