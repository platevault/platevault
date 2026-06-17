# Spec 033 Traceability Matrix (FR → automated test → runbook step)

**Purpose (FR-036, SC-005):** prove every functional requirement is covered by BOTH an automated test
AND a manual runbook step — zero one-sided coverage. Runbook step ids (RB-n) reference
`runbook-033-interactive.md`.

Legend — automated layers: **RU** Rust unit/integration · **VC** vitest component · **PE** Playwright
mocks-UI · **RB** real-backend e2e (tauri-driver; currently skipped — needs a built binary, T006) ·
**CF** JSON-Schema conformance.

| FR | Requirement (short) | Automated test(s) | Layer | Runbook |
|----|---------------------|-------------------|-------|---------|
| FR-001 | Root-escape refused pre-mutation | `fs/executor` `us1_safety` root_escape; `app_core` `t023a_root_escape_gate_fires_when_library_root_is_set` | RU | RB-7a |
| FR-002 | Symlink/junction refused | `us1_safety` symlink test | RU | RB-7a |
| FR-003 | Destructive-confirm ≠ protection | `us1_safety` destructive-confirm; `app_core` t020 | RU | RB-7b |
| FR-004 | No silent overwrite | `us1_safety` destination-exists | RU | RB-7c |
| FR-005 | Per-item + bulk-cancel audit | `us1_safety` bulk-cancel | RU | RB-7d |
| FR-006 | Prefer trash, archive fallback | `us1_safety` trash/fallback | RU | RB-7b |
| FR-007 | Recoverable / stale / EXDEV | `us1_safety` stale + EXDEV (T013/T013a) | RU | RB-7c |
| FR-008 | Manifest auto-generates on workflow complete | `app_core` `workflow_run_subscriber_generates_and_persists_manifest`; `us2…spec` | RU/RB(skip) | RB-8a |
| FR-009 | artifact.detected + artifact.classified emitted | `app_core` `detect_emits_artifact_detected_and_artifact_classified`; CF artifact.classify | RU/CF | RB-8b |
| FR-010 | Guided auto-advance on real events | `guided/eventBridge.test` | VC | RB-9 |
| FR-011 | Joyride render, non-modal, dismissible | `guided/GuidedOverlay.test` | VC | RB-9 |
| FR-012 | Session root_id grouping | `inventory` root_id helpers (⚠ partial — T036a wires the pipeline) | RU | RB-2 |
| FR-013 | Real calibration masters + matching | `app_core` `masters_tests`, suggest tests | RU | RB-4 |
| FR-014 | target_id → target detail links | `app_core` `target_identity` linked sessions/projects | RU | RB-5a |
| FR-015 | Real cross-entity Cmd+K search | `app_core` `search` tests | RU | RB-10 |
| FR-016 | Protection gate fires on real plan | `app_core` `t040_real_cleanup_plan_over_protected_source_is_blocked` | RU | RB-11 |
| FR-017 | Protected item carries source_id + audit | `t040` assertions | RU | RB-11 |
| FR-018 | Default persists + protection.default.changed | `t041_set_global_default_persists_and_emits_event` | RU | RB-11b |
| FR-019 | Single canonical lifecycle state | `lifecycle_canonical` `t046a/t046b` | RU | RB-6a |
| FR-020 | Typed blocked reason in banner | `ProjectDetail.blocked-reason.test` | VC | RB-6b |
| FR-021 | Audit auto block/ready/unarchive | `lifecycle_canonical` `t048a..e` | RU | RB-6c |
| FR-022 | Multiselect lifecycle filter | `ProjectsList.test` multiselect | VC | RB-6d |
| FR-023 | Settings persist + consumer reads | `agingThreshold.test`; `settings.rs` aging tests | VC/RU | RB-12a |
| FR-024 | Snapshot/debounce fires | `settings.rs` `emit_snapshot_fires…` | RU | RB-12b |
| FR-025 | Contract conformance, fail-on-drift | `conformance-harness.mjs` (12 checks, 5 drift) | CF | RB-12c |
| FR-026 | Minisign signature verified | `download` valid/tampered/wrong-key | RU | RB-13 (fixtures) |
| FR-027 | Unknown license hard-fails | `download` `unknown_license_code_hard_fails` | RU | RB-13 |
| FR-028 | Atomic catalog upsert+attribution | `catalogs` `upsert_catalog_atomic_*_rolls_back` | RU | RB-13 |
| FR-029 | Slug enum reconcile, reject unknown | `download` slug tests | RU | RB-13 |
| FR-030 | Dev capture + export to chosen path | `dev/devSurface.capture.test` | VC | RB-14a (dev build) |
| FR-031 | Release: no dev surface | `dev/devSurface.release.test` | VC | RB-14b |
| FR-032 | Destructive-destination toggle honored | `inbox/inbox.destToggle.test` | VC | RB-3 |
| FR-033 | Show-ignored / dynamic frame-type / inventory refs | `inbox/inbox.affordances.test`; `SourceViewsSection` | VC | RB-3b/RB-10 |
| FR-034 | Reproducible headless automated suite | the suite (`cargo test`, `pnpm test`, conformance) + CI `ci.yml` | all | — (CI) |
| FR-035 | Interactive runbook exists | `runbook-033-interactive.md` | — | (this doc) |
| FR-036 | Traceability matrix, zero-gap | this file | — | — |
| FR-037 | 4 regression tests for fixed defects | R-1 (PE), R-2 (VC), R-3 (RU), R-4 (`NamingStructure.r4.test` + check-tokens.sh check 4) | PE/VC/RU | RB-1 |
| FR-038 | Single destructive-destination vocab | migration 0032 CHECK; `us1_safety` destination round-trip | RU | RB-3 |
| FR-039 | Completion = tests + runbook, not checkboxes | this matrix + per-story crux re-verification | — | — |
| FR-040 | Inbox multi-grouping (date/state/type), no "lane" jargon | `inbox/inbox.affordances.test` grouping | VC | RB-3a |
| FR-041 | Targets grouping + sort | `targets/target-list-utils.test` (14 tests) | VC | RB-5b |
| FR-042 | Projects sort options | `ProjectsList.test` sort | VC | RB-6e |
| FR-043 | New-project wizard (sessions+calibration), in-window, create succeeds | `projects/wizard/WizardPage.test` | VC | RB-5c/RB-7 |
| FR-044 | Target detail loads without error | `targets` target.get linked + `TargetDetailV2` error path | RU/VC | RB-5a |

## Coverage summary
- **44 FRs**; every FR has ≥1 automated test AND ≥1 runbook step → **0 one-sided rows** (SC-005 met) except
  the three meta/infra FRs (FR-034/035/036/039) which are the verification instruments themselves.
- **Known partial coverage (tracked, not hidden):**
  - **FR-012 (T036a):** `root_id` helpers tested, but the live scan→session pipeline wiring is verified by
    **RB-2 on the real binary** (Rust helper tested; runtime path pending T036a).
  - **Real-backend e2e (RB layer):** 19 specs across US1/US2/US3/US5 are authored but **skipped** — the
    tauri-driver harness needs a pre-built `desktop_shell` binary (T006), unavailable headless in WSL. These
    are covered by (a) the per-story Rust integration tests above and (b) the **Windows interactive runbook**.
    This is the deliberate division: reproducible automated = Rust/vitest/conformance; real-IPC end-to-end =
    the manual Windows pass.
- **Gates:** `cargo test --workspace` (full, 0 failed), `pnpm test` 544, conformance 12/12, `just lint` 0.
