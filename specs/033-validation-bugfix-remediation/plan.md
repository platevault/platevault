# Implementation Plan: Validation Bugfix & Remediation

**Branch**: `main` | **Date**: 2026-06-17 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/033-validation-bugfix-remediation/spec.md`

## Summary

Take the existing Astro Library Manager from "gates green but many features inert on real data" to a
provably working desktop app, by remediating the diagnosed defects in
`docs/development/autonomous-run-2026-06-validation-findings.md` story-by-story (US1–US8) and proving
the result with two mutually-aligned verification artifacts (US9): a reproducible headless automated
suite and a manually-validated interactive runbook, bound by a zero-gap traceability matrix.

Technical approach: this is **wiring, data-plumbing, safety, and contract fidelity** over an existing
codebase — not new architecture and not UI redesign. Three classes of fix dominate:

1. **Safety** (US1): a single path-resolution + escape/symlink-refusal + staleness gate in front of the
   filesystem executor, a destructive-confirm signal separated from protection, and per-item audit on
   every transition including bulk cancel. Replace the OS-trash stub with the `trash` crate.
2. **Activation** (US2): one startup-wiring pass in `run_app` that spawns the five implemented-but-never-
   started subscribers (manifest, artifact watcher, guided auto-advance bridge, inbox plan listener [done],
   log forwarder [done]), plus the missing async root resolver and the missing `artifact.classified` event.
3. **Real data + contracts** (US3/US4/US5/US6/US7/US8): populate the FKs/fingerprints/source-ids that make
   gating and matching fire on real rows; reconcile the divergent project tables and contract versions;
   add JSON-Schema conformance tests; implement minisign verification.

## Technical Context

**Language/Version**: Rust (workspace, edition 2021, toolchain per `rust-toolchain`); TypeScript 5 / React 19.2; Node via pnpm.

**Primary Dependencies**: Tauri 2 (desktop shell + IPC); TanStack Router/Query; Base UI (`@base-ui-components/react`, Floating-UI); `sqlx`/`rusqlite`-style SQLite access in `crates/persistence/db`; `tokio` (async + `broadcast` event bus); `notify` v7 (fs watching). **New (deliberate) deps**: `minisign-verify` 0.2.x (catalog signature verification, MIT — US7); `trash` 5.2.x (OS trash, MIT — US1). **Tour**: `react-joyride` ^3.1.0 (already declared; adopt). **Remove (dead)**: `@tanstack/react-table`, `@uiw/react-md-editor`.

**Storage**: SQLite — canonical store at `~/.local/share/dev.astro-plan.astro-library-manager/alm.db` (Linux) / platform-equivalent on Windows. 30 sequential migrations (0001–0030) exist; this feature adds new sequential migrations (typed blocked reason, project-table reconciliation, any protection-defaults persistence).

**Testing**: `cargo test --workspace` (Rust unit/integration, in-memory SQLite); `vitest` (React component); Playwright (`apps/desktop` — mocks-UI e2e); real-backend e2e via `tauri-driver` + `WebKitWebDriver` (W3C WebDriver) under `xvfb`; JSON-Schema conformance tests over contract payloads.

**Target Platform**: Cross-platform desktop (Windows primary review target; Linux/WSL for headless automation; macOS supported by design). Real-backend automated verification runs headless on Linux/WSL; interactive runbook runs on the Windows-native binary.

**Project Type**: Desktop application — Tauri + React frontend over a granular Rust crate backend; language-neutral contracts in `packages/contracts`.

**Performance Goals**: Not a performance feature. No regressions to current behavior; UI interactions remain responsive; the artifact watcher must coalesce bursts so editor/tool saves don't storm the event bus.

**Constraints**: Local-first, offline-capable; never follow symlinks/junctions on scan/apply unless explicitly enabled; large-file hashing stays lazy/optional; release builds MUST compile out the `dev-tools` surface; no AI attribution in commit messages (repo hook). Constitution §§I–V are hard gates (below).

**Scale/Scope**: ~21 validated specs touched; ~20 backend crates; design-v4 UI (~50 screens/components). 39 FRs across 9 user stories; 2 new dependencies; several new migrations; one new real-backend e2e harness.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Relevance to this feature | Verdict |
|---|---|---|
| **I. Local-First File Custody** | No image files copied into an app store; library roots modeled separately from relative paths; US1 explicitly resolves item paths against the registered root and supports remapping. | **PASS** — feature *strengthens* this (FR-001, root-relative resolution). |
| **II. Reviewable Filesystem Mutation** | The core of US1/US4: every mutation is a reviewable plan, no silent overwrite (FR-004), per-item audit incl. bulk cancel (FR-005), prefer trash/archive over delete (FR-006), protected sources gate cleanup (FR-016). | **PASS** — feature closes the current §II holes. The plan MUST NOT ship any real `plan.apply` before FR-001…FR-007 land. |
| **III. PixInsight Boundary** | No calibration/debayer/register/integrate/stack/edit. Calibration "matching" = suggesting existing masters (FR-013); artifact watcher = observing output files (FR-009); metadata = header reads only. | **PASS** — explicitly excluded in spec scope; verified per-task. |
| **IV. Research-Led Domain Modeling** | The three reconciliations (destructive-destination vocab, two project tables, catalog slug) + the two library choices are decided in `research.md` with options/tradeoffs/recommendation before dependent stories implement. | **PASS** — research.md records each decision (Phase 0). |
| **V. Portable Contracts & Durable Records** | Contracts are language-neutral (`packages/contracts`); US6 reconciles contract drift and adds JSON-Schema conformance tests; DB is the canonical audit/relationship record; manifests/notes are reproducible projections (FR-008). | **PASS** — feature adds the missing conformance enforcement. |
| **Product Constraints** | Messy libraries supported; cross-platform path concerns (US1); lazy hashing preserved; symlinks/junctions not followed by default (FR-002); protected categories documented before cleanup (US4). | **PASS** |
| **SpecKit Workflow & Quality Gates** | Constitution checked here (pre-Phase-0) and re-checked post-Phase-1; research precedes implementation for the reconciliations; tasks grouped by independently-testable user stories with a dependency graph; no implementation before artifacts pass review. | **PASS** |

No violations. **Complexity Tracking is empty** (no gate deviations to justify). The two new dependencies
are justified in research.md as safety-critical replacements for stubs, consistent with "deliberate
dependencies."

## Project Structure

### Documentation (this feature)

```text
specs/033-validation-bugfix-remediation/
├── plan.md              # This file
├── research.md          # Phase 0 — the 3 reconciliations + 2 library decisions + safety approach
├── data-model.md        # Phase 1 — changed/new entities, migrations, state transitions
├── quickstart.md        # Phase 1 — how to build, run headless real-backend, run each test layer
├── contracts/           # Phase 1 — reconciled/added operation & event contracts + conformance fixtures
│   ├── destructive-destination.md      # canonical vocab (FR-038)
│   ├── artifact-events.md              # artifact.detected + artifact.classified + classify response (FR-009/FR-025)
│   ├── project-lifecycle.md            # single canonical state + typed blocked reason (FR-019/FR-020)
│   ├── protection.md                   # source_id on protected items + default-changed event (FR-016..018)
│   ├── log-viewer.md                   # contractVersion/cursor/export reconciliation (FR-025)
│   ├── catalog.md                      # signature/license/slug (FR-026..029)
│   └── README.md                       # conformance-test index + traceability anchor
└── tasks.md             # Phase 2 (/speckit-tasks) — NOT created here
```

### Source Code (repository root)

This feature edits existing trees; it does not introduce new top-level layout. Touched paths:

```text
crates/
├── fs/executor/             # US1: path resolution+escape/symlink/staleness gate, destructive-confirm,
│   └── src/ops/             #      per-item+bulk-cancel audit, trash_op via `trash` crate
├── fs/planner/              # US1/US4: plan items carry source_id, category, destructive-confirm, staleness baseline
├── fs/inventory/            # US2: artifact watcher notify loop + debounce + watch-paths-from-roots
├── calibration/core/        # US3: real masters rows, fingerprint matching on populated data
├── targeting/               # US3/US7: target_id FK, cross-entity search; catalog slug reconcile
├── targeting/catalogs/      # US7: minisign verification, license hard-fail, atomic upsert+attribution
├── project/structure/       # US5: single canonical lifecycle, typed blocked reason
├── audit/                   # US1/US4/US5: per-item + auto-transition audit events; protection.default.changed
├── persistence/db/          # migrations: typed blocked reason, project-table reconciliation, protection defaults
├── contracts/core/          # US6: reconciled DTOs/versions; new event shapes
└── app/core/                # US2: run_app startup wiring (spawn subscribers, async root resolver)

packages/contracts/          # US6: reconciled JSON schemas + conformance fixtures

apps/desktop/
├── src/app/                 # US2: guided event→step bridge (model on data/logSubscription.ts); run_app wiring surfaced in UI
├── src/features/guided/     # US2: replace GuidedOverlay render layer with react-joyride; keep store/anchors/state machine
├── src/features/inbox/      # US8: destructive-destination toggle (FR-032)
├── src/features/projects/   # US5: BlockedBanner typed reason; multiselect lifecycle filter
├── src/features/calibration/# US3/US6: masters from real rows; aging-threshold consumer reads setting
├── src/features/settings/   # US6: aging-threshold real scope/key; snapshot/debounce wiring
├── src/app/CommandPalette*  # US3/US8: real search results; "show ignored" entry
├── e2e/                     # US9: real-backend (tauri-driver) + mocks (Playwright) harness  [scaffolded by test-catalog agent]
└── package.json             # US2/US8: adopt react-joyride 3.1; remove dead deps

docs/development/
├── test-strategy-033.md            # US9 scenario catalog  [test-catalog agent]
├── runbook-033-interactive.md      # US9 manual interactive runbook (NEW)
└── traceability-033.md             # US9 feature→test→runbook matrix (NEW)
```

**Structure Decision**: Reuse the existing monorepo structure unchanged. No new crates; changes are
localized to the crates/UI areas named above. New artifacts are test/verification assets (e2e harness,
runbook, traceability matrix) and sequential DB migrations. This honors "small crates, narrow
responsibility" and avoids cross-crate rebuild churn.

## Phase Sequencing & Dependencies (build order)

```text
US1 (safety) ─┬─> US4 (protection gating needs the cleanup-plan generator + source_id from US1 area)
              └─> real plan.apply unlocked
US2 (startup wiring) ── independent; highest leverage; unblocks runtime halves of 005/010/012/019/024
US3 (data plumbing) ──> precondition for US4 (source_id/category) and for real US6 calibration consumer
US5 (lifecycle) ── depends on the project-table reconciliation decision (research.md)
US6 (settings/contracts) ── depends on US3 (calibration consumer) + the contract decisions (research.md)
US7 (catalog) ── independent; externally-blocked downloads → verified on fixtures
US8 (dev/misc) ── independent; small
US9 (verification) ── spans all; regression tests authorable now; per-story acceptance tests authored
                      as each story's behavior is defined (red-first against the FRs)
```

Backend specs share surfaces (migrations, `contracts/core`, `run_app`, event bus) → implement
**sequentially**, not in parallel, to avoid migration-ordering and invoke-handler conflicts.

## Verification approach (US9 — the acceptance instrument)

Four layers, each FR mapped to at least one:

1. **Rust unit/integration (in-memory SQLite)** — strongest backend signal; owns US1 safety proofs, US3
   matching, US4 protection, US5 lifecycle, US7 catalog, contract conformance.
2. **vitest component** — frontend logic (BlockedBanner reason, destructive toggle, guided bridge unit).
3. **Playwright mocks-UI e2e** — routing/render/forms incl. regression R-1/R-2.
4. **Real-backend headless e2e (`tauri-driver`+`WebKitWebDriver` under `xvfb`, `VITE_USE_MOCKS=false`)** —
   the core journey (SC-001) on real SQLite IPC; proves background features fire (SC-003).

The **interactive runbook** (`runbook-033-interactive.md`) mirrors the same FR set against the Windows
binary; **traceability-033.md** is the matrix proving every FR/use-case appears in *both* the automated
suite and the runbook (FR-036/SC-005). Regression tests for the 4 fixed defects are authored immediately
(FR-037).

## Complexity Tracking

No Constitution gate violations. Table intentionally empty.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| (none) | — | — |
