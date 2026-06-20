# Implementation Plan: End-to-End & Integration Testing (Full App Coverage)

**Branch**: `037-e2e-integration-testing` | **Date**: 2026-06-19 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/037-e2e-integration-testing/spec.md`

## Summary

Establish two real-stack test layers over the existing app and wire them into
cross-platform CI and local workflows:

- **Layer 1 — real-backend integration** (`cargo test`): exercise the real
  `app_core` use cases through the real `SqliteLifecycleRepository` against a
  real, file-backed, per-test SQLite DB with real migrations; SIMBAD mocked only
  at the HTTP boundary. Covers every implemented feature area (D7). Runs on all 3
  OS, carries the bulk of assertions.
- **Layer 2 — full-stack E2E** (**thirtyfour + cargo-nextest** +
  `tauri-plugin-webdriver`): drive the built app's real UI → real IPC → real
  backend for a thin set of smoke journeys, asserting a UI↔backend round-trip
  and a real filesystem mutation + audit record. Required on all 3 OS via the
  embedded WebDriver plugin (D10 supersedes D3/D4). Journeys live in
  `crates/e2e-tests/` (Rust, `#[ignore]` stubs today — wiring deferred per D9).

CI: `ci.yml` 3-OS matrix (Layer 1, required all OS) + `e2e.yml` (Layer 2,
thirtyfour+nextest, all 3 OS via tauri-plugin-webdriver). Local: `just` targets
mirror CI per-layer.
Documentation: the two-layer strategy and per-OS run instructions go into the
`.apm/`-sourced standing instructions and `docs/development/testing.md`.

No product behavior changes; no image-processing tool invocation.

## Technical Context

**Language/Version**: Rust (workspace, edition per repo) + TypeScript 5 / React 19; Tauri v2.11
**Primary Dependencies**: sqlx ^0.9 (SQLite), tokio; **thirtyfour ^0.37** (Rust W3C client) + `tauri-plugin-webdriver` v0.2 (dev, `e2e` feature-gated) + `tauri-webdriver` CLI (`cargo install tauri-webdriver --locked`) + **cargo-nextest** (Layer 2); Vitest ^4 (existing). New dev-deps: `wiremock` (Rust, network-boundary mock), `tempfile` (already present). WebdriverIO retired (research D10).
**Storage**: SQLite via sqlx; migrations in `crates/persistence/db/migrations/`. Tests use per-test tempdir DBs (Layer 1) and the app's real on-disk DB (Layer 2).
**Testing**: Layer 1 = `cargo test --workspace` (crate `tests/` dirs). Layer 2 = `cargo nextest run -p e2e_tests --profile e2e` (thirtyfour/W3C). Existing unit + mock-UI tests retained.
**Target Platform**: Desktop — Windows, Linux, macOS.
**Project Type**: Tauri desktop monorepo (Rust crates + React app + language-neutral contracts).
**Performance Goals**: Layer 1 deterministic and offline-capable (SC-006); fast-fail before Layer 2 (FR-012). No app perf targets (out of scope).
**Constraints**: No real user libraries touched (disposable test locations only, FR-016); release builds must omit any debug-only automation surface (Constitution V); macOS real-UI E2E unsupported by official driver (D4).
**Scale/Scope**: ~22 implemented feature areas (D7); ~6–10 Layer-2 smoke journeys; 3-OS CI matrix.

## Constitution Check

*Gate evaluated against `.specify/memory/constitution.md` v1.0.0.*

| Principle | Compliance |
|---|---|
| **I. Local-First File Custody** | PASS — tests never copy user files; all test data in disposable tempdirs. No change to custody model. |
| **II. Reviewable Filesystem Mutation** | PASS — Layer-2 mutation journeys assert the existing plan/audit path (FR-009); tests add no new mutation surface and verify audit records exist. |
| **III. PixInsight Boundary** | PASS — FR-018: no image-processing tool is invoked; processing-tool-launch coverage stops at launch wiring, asserts no real launch. |
| **IV. Research-Led Domain Modeling** | PASS — open questions (macOS driver, scaffold reuse, feature enumeration, regression scope) resolved in research.md (D1–D8) before design. |
| **V. Portable Contracts & Durable Records** | PASS — tests consume existing language-neutral contracts unchanged; the only added runtime surface (macOS WebDriver plugin) is debug-only/compile-gated so release binaries omit it, mirroring the spec-021 `dev-tools` discipline. DB remains the durable audit record, asserted by tests. |

**Product Constraints**: PASS — no symlink/junction following added; destructive-op tests are sandboxed; protected-category behavior is asserted, not bypassed.

**Gate result**: ✅ PASS (initial). Re-evaluated post-design below.

## Project Structure

### Documentation (this feature)

```
specs/037-e2e-integration-testing/
├── spec.md
├── plan.md            # this file
├── research.md        # D1–D8 decisions
├── data-model.md      # test-domain entities, coverage mapping, fixtures
├── quickstart.md      # how to run each layer per OS
├── contracts/
│   └── coverage-matrix.md   # feature-area → test mapping (no new API contracts)
└── checklists/
    └── requirements.md
```

### Source/test code (repository)

```
crates/app/core/tests/                 # Layer 1 integration tests (new + extended)
crates/persistence/db/tests/           # Layer 1 persistence/migration tests
crates/<feature-crate>/tests/          # Layer 1 lives in the relevant crate's tests/ dir
# NOTE: do NOT reuse the existing repo-root `tests/integration/` dir for Layer 1 —
# it already holds Playwright *mock-UI* specs (TypeScript). Keep Rust Layer-1
# tests inside crate `tests/` dirs to avoid path/terminology collision.
crates/e2e-tests/                      # Layer 2 — thirtyfour+nextest harness (ADOPTED)
├── Cargo.toml                         # dev-dep: thirtyfour ^0.37
├── tests/common/mod.rs                # harness: tauri-driver caps, invoke() helper
├── tests/smoke.rs                     # #[ignore] smoke stubs
└── tests/journeys.rs                  # #[ignore] journey stubs
.config/nextest.toml                   # [profile.e2e] for cargo nextest
apps/desktop/e2e/                      # legacy scaffolds
├── README.md                          # real-backend harness docs (kept)
├── tsconfig.json                      # Playwright real-backend tsconfig (kept)
└── real-backend/*.spec.ts             # Playwright real-backend stubs (kept; reference)
# NOTE: apps/desktop/e2e/wdio/ REMOVED (research D10 — WebdriverIO retired)
.github/workflows/ci.yml               # 3-OS matrix (Layer 1, required)
.github/workflows/e2e.yml              # Layer 2 (thirtyfour+nextest, Linux required)
justfile                               # test-integration / test-e2e targets
docs/development/testing.md            # two-layer strategy + per-OS guide
.apm/instructions/ (+ regenerate CLAUDE.md/AGENTS.md), PRODUCT.md   # standing convention
```

**Structure Decision**: `crates/e2e-tests` is the adopted Layer-2 home (thirtyfour
+ nextest + tauri-plugin-webdriver). The legacy WebdriverIO scaffold
(`apps/desktop/e2e/wdio/`) has been **deleted** (research D10). The Playwright
real-backend stubs and harness docs remain as structural references. The
`desktop_shell` `e2e` Cargo feature gates the embedded WebDriver plugin so release
binaries omit it (Constitution V). Layer-1 tests live in existing crate `tests/`
dirs to keep crates independently testable.

## Complexity Tracking

| Item | Why it's needed | Mitigation |
|---|---|---|
| macOS WebDriver plugin embeds a server in-app | Only way to get macOS real-UI E2E | Debug/dev-only compile gate; best-effort, non-blocking; revisit before requiring |
| Second SQLite access path in E2E (`better-sqlite3`) | Assert real DB side effects from the test runner | Read-only; dev-dependency only; isolated to `e2e/helpers/db.ts` |
| 3-OS CI with WebDriver | Product ships on 3 OS with divergent path/fs behavior | Stage-gated (fast Layer-1 first); macOS-E2E isolated as optional |

No constitution violations requiring justification.

## Phase 0 — Research

✅ Complete — see [research.md](./research.md) (D1–D8). All NEEDS CLARIFICATION
resolved; no open clarifications remain.

## Phase 1 — Design & Contracts

✅ Artifacts generated:
- [data-model.md](./data-model.md) — test-domain entities, coverage mapping,
  fixture/isolation model.
- [contracts/coverage-matrix.md](./contracts/coverage-matrix.md) — feature-area →
  test layer mapping (this feature exposes no new product contracts; it consumes
  existing ones).
- [quickstart.md](./quickstart.md) — per-OS run instructions and prerequisites.

**Post-Design Constitution Re-check**: ✅ PASS — design adds only test code,
disposable fixtures, CI config, and docs; the single new runtime element (macOS
plugin) is compile-gated to debug builds. No new mutation or custody surface.

## Phase 2 — Next

Run `/speckit.tasks` to generate the dependency-ordered `tasks.md` (Layer-1 tests
per feature area; Layer-2 journey completion; CI workflow; just targets; docs;
seeded-regression validation per D8).
