# crates/e2e-tests — spec 037 Layer-2 real-UI E2E

Thirtyfour + cargo-nextest end-to-end tests for the Astro Library Manager
desktop app.

## Status

**Real journeys, wired against the real backend (2026-07-04, spec 037 WP-C).**

Six journeys run against the real app + real SQLite + real filesystem:
`first_run_resolve_create_project`, `plan_review_apply_with_audit`,
`ingestion_sessions_search`, `lifecycle_integrity`, `cleanup_plan_review`
(`tests/journeys.rs`), and `all_top_level_screens_load`
(`tests/smoke.rs`). All six are `#[ignore]`d in-source purely so the
Layer-1 `cargo test --workspace` job (ci.yml) — which has no
`tauri-webdriver` CLI, no e2e-feature app build, and no served frontend —
skips them; the e2e workflow opts back in with `--run-ignored all`.
Durable-record proofs use
`plans.apply.status` (`plan_apply_events`) and `lifecycle.ledger.list` — the
read paths closest to the mutations being proved. (`audit.list`/
`audit.export` were stubs when these were authored; PR #388 wired them to
the real `audit_log_entry` table, #401 adds entity-filtered reads — they're
now available as complementary assertion surfaces.) See each journey's doc
comment for exactly which real commands it drives and why.

Cannot run in the WSL dev sandbox (no webview/display) — CI (`e2e.yml`, 3-OS
matrix) is the first real verification point; iterate there.

## How to run

```sh
cargo nextest run -p e2e_tests --profile e2e --run-ignored all
```

## Mechanism

- `desktop_shell` is built with `cargo build -p desktop_shell --features e2e`,
  which compiles in `tauri-plugin-webdriver` (Choochmeque) — an embedded W3C
  WebDriver server listening on `127.0.0.1:4445`. Release builds omit the
  `e2e` feature so the automation surface is never present (Constitution
  Principle V).
- The `tauri-webdriver` CLI (`cargo install tauri-webdriver --locked`) proxies
  `127.0.0.1:4444` to the embedded plugin server on `:4445`, and manages the
  target app's process lifecycle via the `tauri:options` capability — it does
  **not** take the app binary as a CLI argument.
- thirtyfour (this crate's W3C client) connects to the CLI on `:4444` and
  sends `tauri:options.application` = the built `desktop_shell` binary path in
  the New Session capabilities. No `browserName` is set.
- The app loads its own frontend from the Tauri `devUrl` (`:5173`)
  automatically on launch; the harness does not call `driver.goto(...)` after
  connecting.
- `window.__ALM_E2E__.invoke(...)` is the real-IPC invoke bridge exposed by
  the frontend when built with `VITE_E2E=1` (`apps/desktop/src/main.tsx`).

This mirrors `.github/workflows/e2e.yml` (see `specs/037-e2e-integration-testing/research.md`
D10 and `quickstart.md`).

## Prerequisites

- **tauri-webdriver** installed and on `$PATH`
  (`cargo install tauri-webdriver --locked`).
- The `desktop_shell` binary must be **built with the `e2e` feature**:
  `cargo build -p desktop_shell --features e2e`. Override the binary the
  harness launches with `ALM_E2E_APP_BIN=/path/to/binary`.
- Vite dev server / `vite preview` running on `:5173` with:
  - `VITE_USE_MOCKS=false` — real backend.
  - `VITE_E2E=1` — exposes the `window.__ALM_E2E__` invoke bridge.
- Set `ALM_DB_URL=sqlite:///path/to/alm.db?mode=rwc` to control which database
  is wiped before each test run and which one the launched app connects to
  (CI sets this — see `.github/workflows/e2e.yml`). If unset, `reset_database`
  no-ops and the app falls back to the OS app-data path (wiring deferred —
  see `tests/common/mod.rs`).

## Notes

- Old per-OS driver checks (`WebKitWebDriver`/`msedgedriver`) are obsolete —
  `tauri-plugin-webdriver` replaces them on every OS (research D10). The
  harness's `preflight()` only checks for the `tauri-webdriver` CLI and the
  built `desktop_shell` binary.
- Tests run serially (`test-threads = 1` in the `e2e` nextest profile) because
  there is one app instance, one driver session, and one database per run.
