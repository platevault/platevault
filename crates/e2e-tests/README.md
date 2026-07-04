# crates/e2e-tests — spec 037 Layer-2 real-UI E2E

Thirtyfour + cargo-nextest end-to-end tests for the Astro Library Manager
desktop app.

## Status

**Ignored stub journeys. Wiring deferred while the backend is still changing.**

All tests compile and appear in `cargo nextest list` but are marked
`#[ignore]`. The harness itself (driver launch, `tauri:options.application`
capability, `__ALM_E2E__` invoke bridge) is wired — see `tests/common/mod.rs`.
Journeys stay ignored until the backend commands they'd assert against are
de-stubbed (research D9): `search.global`, `sessions.list`/`get`, and
`calibration.masters.list`/`get` currently return hardcoded fixture data.

## How to run (once a journey is un-ignored)

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
- Optional: set `ALM_DB_URL=sqlite:///path/to/alm.db` to control which
  database is wiped before each test run.  If unset, the harness will
  resolve the OS app-data path (wiring deferred — see `reset_database` in
  `tests/common/mod.rs`).

## Notes

- Old per-OS driver checks (`WebKitWebDriver`/`msedgedriver`) are obsolete —
  `tauri-plugin-webdriver` replaces them on every OS (research D10). The
  harness's `preflight()` only checks for the `tauri-webdriver` CLI and the
  built `desktop_shell` binary.
- Tests run serially (`test-threads = 1` in the `e2e` nextest profile) because
  there is one app instance, one driver session, and one database per run.
