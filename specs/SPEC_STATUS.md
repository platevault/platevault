# Spec Status & Plan

**Living index of SpecKit feature status, dependencies, and the actionable frontier.**

Last reconciled: **2026-06-23** (full sweep). **2026-07-03**: 043 list-page
consistency + mock-mode E2E test redo landed (see the 043 row + CI note below).

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
| 005 inbox-mixed-folder-split | 🔴 Superseded by 041 | 0/51; replaced by single-type-at-ingest (#315) |
| 006 inventory-library-lifecycle | 🟡 Closeout-ready | 28/43; 14/15 open tasks DEFERRED |
| 007 calibration-matching-rules | 🟡 Closeout-ready | 31/42; all 11 open tasks DEFERRED (JSON-schema test runner absent) |
| 008 project-create-onboard-edit | 🟡 Partial | 28/38; ~6 real-open |
| 009 project-lifecycle-model | ✅ Implemented | 21/21 |
| 010 guided-first-project-flow | 🟡 Near-complete | 31/33 |
| 011 processing-tool-launch | 🟡 Partial | 24/29 |
| 012 processing-artifact-observation | 🟡 Partial | 26/36 (follows 011) |
| 013 target-lookup-from-fits-object | 🟡 Near-complete | 18/21 (largely folded into 035) |
| 014 catalog-index-licensing | 🔴 Superseded by 035 | download-catalog mechanism abandoned; attribution model retained |
| 015 token-pattern-builder | 🟡 Mockup only | 0/0 tasks |
| 016 source-protection-defaults | 🟡 Near-complete | 17/20 (underpins 017) |
| 017 cleanup-archive-review-plans | 🟠 Backend done, UI open | **19 real-open** |
| 018 settings-configuration-model | 🟠 Largely open | 18/46 — **28 real-open**, biggest unfinished domain spec |
| 019 bottom-log-viewer | 🟡 Near-complete | 30/34 |
| 020 router-url-state | ✅ Implemented | 22/23 |
| 021 developer-contract-diagnostics | 🟡 Partial | 32/37 (behind `dev-tools` feature) |
| 022 mantine-prototype-design-system | 🔴 Superseded by 027 | |
| 023 target-identity-history-notes | ⚪ Tasks not generated | 0/0; plan+contracts exist; 035 base shipped |
| 024 project-manifests-and-notes | 🟡 Closeout-ready | 32/37; all 5 open tasks DEFERRED |
| 025 filesystem-plan-application | 🟡 Partial (out-of-spec) | Real apply shipped via 041; rollback + progress UI open |
| 026 generated-source-view-removal | 🟡 Likely obsolete | 12/23; removal happened |
| 027 frontend-implementation | ✅ Implemented | 99/99 |
| 028 frontend-quality-hardening | 🟡 Placeholder | 9/15 |
| 029 tauri-backend-wiring | ✅ Implemented | 52/52 |
| 030 ui-audit-revision | 🔴 Superseded | delivered by 031/032 |
| 031 design-v3-implementation | ✅ Closed | superseded by 032 |
| 032 design-v4-implementation | ✅ Implemented | |
| 033 validation-bugfix-remediation | 🟡 Partial | 83/92; blocked on 017 cleanup generator |
| 035 simbad-target-resolution | ✅ Implemented | validated end-to-end 2026-06-23 |
| 036 retire-legacy-targets | ✅ Implemented | PR #255 |
| 037 e2e-integration-testing | 🟠 Partial / gated | 24/39; Layer-1 + CI Stage A done; real-UI E2E gated on backend stubs |
| 037 ipc-wrapper-removal | 🟠 Mostly open | 2/15; independent |
| 038 wizard-scan-step | ✅ Implemented | merged (no committed tasks.md) |
| 039 cross-root-inbox | ⚪ Not started | no plan/tasks; 041 base now on main |
| 040 calibration-masters-detection | ✅ Implemented | validated end-to-end 2026-06-23 |
| 041 inbox-plan-surface | ✅ Implemented | 59/59 + iteration-1 (#315); supersedes 005 |
| 042 stdlib-adoption | ✅ Implemented | 80/97; reconciled #310 |
| 043 ui-redesign-platevault | 🔵 Active | Ongoing on `redesign-ui-platevault`. List-page consistency landed (#360): all four list pages (Projects/Targets/Sessions/Calibration) flat-by-default, group headers unified onto shared `.alm-listgroup`, global font enforced (only `reset.css`). Sessions E2E specs redone for the flat table (#364). |
| 044 targets-planner-astronomy | ⚪ Placeholder | frontend mocked; needs research-led astronomy engine |
| 045 review-state-real | 🔴 Superseded by 041 | |
| 046 i18n-error-codes | ✅ Implemented | 36/36 (#311–#314) |
| tiny/ catalog-entry, settings-key | 📄 Micro-specs | reference notes, not tracked features |

## Dependency DAG

```
FOUNDATION (all ✅ — nothing blocked here)
  022 mantine ─▶ 027 frontend ─▶ 029 tauri-wiring ─▶ 032 design-v4
  002 lifecycle ✅   020 router ✅   030/031 (superseded/closed)

INBOX CHAIN
  005 mixed-folder 🔴 ─▶ 041 inbox-plan-surface ✅ ─┬─▶ 039 cross-root-inbox ⚪
  038 wizard-scan ✅                                ├─▶ 025 plan-application 🟡 (rollback+progress UI)
  016 protection 🟡 ─▶ 017 cleanup/archive 🟠 ──────┼─▶ 033 validation-bugfix 🟡 (needs 017 generator)
                                                    └───┘

TARGETS CHAIN
  013 fits-lookup 🟡 ┐
  014 catalog 🔴 ────┴─▶ 035 SIMBAD ✅ ─┬─▶ 036 retire-legacy ✅
                                        ├─▶ 023 target-identity ⚪ (tasks not generated)
                                        └─▶ 006 sessions 🟡 ─▶ 044 planner-astronomy ⚪

CALIBRATION CHAIN
  006 inventory/sessions 🟡 ─▶ 007 matching-rules 🟡 ─▶ 040 masters ✅

PROJECTS CHAIN
  006 inventory ─▶ 008 project-create 🟡 ─▶ 009 lifecycle ✅ ─▶ 010 guided-flow 🟡
                       └─▶ 024 manifests/notes 🟡
                  011 tool-launch 🟡 ─▶ 012 artifact-observation 🟡

INFRA / CROSS-CUTTING (mostly independent)
  018 settings 🟠   021 dev-diagnostics 🟡   019 log-viewer 🟡
  046 i18n ✅   042 stdlib ✅   043 ui-redesign 🔵
  037 e2e 🟠 ◀── gated on real backend stubs (search.global / sessions / calibration.masters)
  037 ipc-removal 🟠 (independent)
```

## Actionable frontier — what can be worked on now (unblocked)

| Priority | Spec | Why ready | Size |
|---|---|---|---|
| 1 | **018 settings-configuration-model** | No upstream blocker; underpins many flows | 🟠 Large (28 open) |
| 1 | **017 cleanup/archive review UI** | Backend + plan model (041) done; 016 nearly done | 🟠 Large (19 open) |
| 2 | **025 plan-application** (rollback + progress UI) | Apply backend already shipped via 041 | 🟡 Medium |
| 2 | **039 cross-root-inbox** | Greenfield; 041 base on main; needs plan/tasks | 🟡 Medium |
| 2 | **037 ipc-wrapper-removal** | Independent infra cleanup | 🟡 Medium (2/15) |
| 3 | **011 → 012** tool-launch then artifact-observation | 011 unblocked; 012 follows | 🟡 Medium |
| 3 | **008 project-create** | 006 inventory closeout-ready | 🟡 Medium |
| 3 | **021 dev-diagnostics** | Independent, behind `dev-tools` flag | 🟡 Small |
| 3 | **023 target-identity** | 035 done; needs `/speckit.tasks` to generate tasks | ⚪ Plan exists, 0 tasks |
| active | **043 ui-redesign** | In progress on current branch | 🔵 Ongoing |

**Suggested parallel lanes:** one engineer on **018 settings**; one on the **017 → 025 → 033** plan/cleanup chain; **043** continues on UI.

## Closeout-ready (verify pass, not new work)

**006, 007, 024** — open tasks are all DEFERRED, not unstarted. Run `speckit-verify`, then flip `Status:` to Implemented.

## Blocked / not-yet-actionable

- **033 validation-bugfix** — dead cleanup-plan path depends on the **017** generator; do 017 first.
- **037 e2e** — real-UI suite gated on backend stubs (`search.global`, `sessions`, `calibration.masters`) becoming real.
- **044 planner-astronomy** — research-gated: needs an astronomy-engine decision (currently mock).

## Known repo-health issues (2026-06-23)

- **Pre-existing CI red on `main`:** `Clippy (workspace, deny warnings)` fails at
  `crates/app/targets/src/target_management.rs:506` — `clippy::unnecessary_map_or`
  (newer clippy lint on existing target code). One-line fix; unrelated to recent PRs.
- **Fixed 2026-06-23 (PR #317):** duplicate migration version `0046`
  (`session_canonical_target` + `target_constellation_magnitude`) broke fresh-install
  startup and every real-backend integration test. The later file was renumbered to `0047`.
  Watch for this class of collision when concurrent branches pick the next migration number.
- **2026-07-03 — mock-mode E2E green again (PR #364):** `lifecycle_detail.spec.ts` asserted on the
  pre-redesign `.alm-sessions-table__group` header, but #360 renamed it to `.alm-listgroup` AND made
  Sessions flat-by-default (no group rows unless grouped), so both tests failed. Fixed to assert on
  `.alm-sessions-table__row`; full mock-mode Playwright suite now 9 passed / 1 skipped.
- **CI test-disable `45f8bb3` is now over-broad + unpushable.** It blanket-disables ALL test jobs
  ("#356 pending redesign test redo"), but the mock-Playwright E2E now passes (#364), frontend unit
  tests pass (404), and Real-UI E2E passes — so the disable mostly discards *working* coverage.
  It also remains **unpushed** because the token lacks the `workflow` scope, which blocks pushing the
  local `redesign-ui-platevault` branch (44+ commits ahead of origin). Prefer reverting the disable
  (re-enable CI) over pushing it; needs a `workflow`-scoped push or a web-UI edit.
