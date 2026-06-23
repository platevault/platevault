# Spec Status & Plan

**Living index of SpecKit feature status, dependencies, and the actionable frontier.**

Last reconciled: **2026-06-23** (after the 035 / 040 / 041 / 046 iteration waves).

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
| 018 settings-configuration-model | ✅ Reconciled + implemented (#348) | 42/46; spec reconciled to as-built scope/values architecture; backend + UI shipped & verified (live T034 walkthrough); 4 obsolete (contracts mirror, 014 key); open: FR-006↔043 density tension (cross-spec decision) |
| 019 bottom-log-viewer | 🟡 Near-complete | 30/34 |
| 020 router-url-state | ✅ Implemented | 22/23 |
| 021 developer-contract-diagnostics | 🟡 Partial | 32/37 (behind `dev-tools` feature) |
| 022 mantine-prototype-design-system | 🔴 Superseded by 027 | |
| 023 target-identity-history-notes | ✅ Implemented on gen-3 | US1 identity/aliases + US2 linked sessions + US3 linked projects + US4 observing notes shipped (migration 0048 + `target.sessions.list`/`target.projects.list`/`target.note.*`). `target.primary.rename` dropped; gen-2 Foundations obsolete |
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
| 037 e2e-integration-testing | 🟠 Partial / gated | 24/39; Layer-1 + CI Stage A done. Gate note is now stale — `search.global`/`sessions.list`/`calibration.masters` graduated to real backends; only `sessions.transition` + tauri-driver wiring remain |
| 037 ipc-wrapper-removal | 🟡 In progress (~8/15) | tasks.md says 2/15 but Phases 1–2 shipped: `api/ipc.ts` switcher exists, `commands.ts` has 0 invoke literals. Phase 3–4 (repoint 99 `@/api/commands` importers) open |
| 038 wizard-scan-step | ✅ Implemented | merged (no committed tasks.md) |
| 039 cross-root-inbox | ⚪ Not started | no plan/tasks; 041 base now on main |
| 040 calibration-masters-detection | ✅ Implemented | validated end-to-end 2026-06-23 |
| 041 inbox-plan-surface | ✅ iteration-1 / 🔵 iteration-2 in progress | iter-1 (confirm + plan surface + apply + destination model) shipped 59/59. iter-2 (single-type sub-items, T061–T080) is **being implemented by another agent** on `041-single-type-*` branches — docs/task-scaffolding present, no crate schema on `main` yet. Supersedes 005 |
| 042 stdlib-adoption | ✅ Implemented | 80/97; reconciled #310 |
| 043 ui-redesign-platevault | 🔵 Active | current branch `redesign-ui-platevault` |
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
  018 settings ✅   021 dev-diagnostics 🟡   019 log-viewer 🟡
  046 i18n ✅   042 stdlib ✅   043 ui-redesign 🔵
  037 e2e 🟠 ◀── now gated only on sessions.transition + tauri-driver (search/sessions/calibration are real)
  037 ipc-removal 🟡 (~8/15; Phases 1–2 shipped)
```

## Actionable frontier — what can be worked on now (unblocked)

| Priority | Spec | Why ready | Size |
|---|---|---|---|
| 1 | **017 cleanup/archive review UI** | Backend + plan model (041) done; 016 nearly done | 🟠 Large (19 open) |
| 2 | **025 plan-application** (rollback + progress UI) | Apply backend already shipped via 041 | 🟡 Medium |
| 2 | **039 cross-root-inbox** | Greenfield; 041 base on main; needs plan/tasks | 🟡 Medium |
| 2 | **037 ipc-wrapper-removal** (Phase 3–4) | Phases 1–2 already shipped; finish repointing `@/api/commands` importers | 🟡 Medium (~7 left) |
| 3 | **011 → 012** tool-launch then artifact-observation | 011 unblocked; 012 follows | 🟡 Medium |
| 3 | **008 project-create** | 006 inventory closeout-ready | 🟡 Medium |
| 3 | **021 dev-diagnostics** | Independent, behind `dev-tools` flag | 🟡 Small |
| 3 | **023 target-identity** | 035 done; needs `/speckit.tasks` to generate tasks | ⚪ Plan exists, 0 tasks |
| active | **043 ui-redesign** | In progress on current branch | 🔵 Ongoing |

**Suggested parallel lanes:** one engineer on the **017 → 025 → 033** plan/cleanup chain; **043** continues on UI. (018 settings shipped via #348.)

## Closeout-ready (verify pass, not new work)

**006, 007, 024** — open tasks are all DEFERRED, not unstarted. Run `speckit-verify`, then flip `Status:` to Implemented.

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
- The live confirm path is `crates/app/inbox`; an earlier duplicate in `app_core` was removed — watch for
  other dead pre-042-split copies if similar drift appears.
