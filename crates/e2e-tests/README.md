# crates/e2e-tests — spec 037 Layer-2 real-UI E2E

Thirtyfour + cargo-nextest end-to-end tests for the Astro Library Manager
desktop app.

## Status

**Ignored stub journeys. Wiring deferred while the backend is still changing.**

All tests compile and appear in `cargo nextest list` but are marked
`#[ignore]`. They will be unwired once:

1. The `__APP_E2E__` invoke bridge is exposed by the frontend (built with
   `VITE_E2E=1`).
2. The tauri-driver WebDriver caps (`tauri:options.application` +
   `browserName="wry"`) replace the chrome placeholder caps in
   `tests/common/mod.rs`.

## How to run (once wired)

```sh
cargo nextest run -p e2e_tests --profile e2e --run-ignored all
```

## Prerequisites

- **tauri-driver** installed and on `$PATH`
  (`cargo install tauri-driver`, or from the Tauri release assets).
- Platform WebDriver binary on `$PATH`:
  - Linux: `WebKitWebDriver` (from the `webkit2gtk-driver` package or equivalent).
  - Windows: `msedgedriver` (matching the installed Edge version).
- The desktop app must be **built** (`cargo tauri build` or `cargo tauri dev`
  with `VITE_USE_MOCKS=false`).
- Vite dev server running on `:1420` with:
  - `VITE_USE_MOCKS=false` — real backend.
  - `VITE_E2E=1` — exposes the `window.__APP_E2E__` invoke bridge.
- Optional: set `ALM_DB_URL=sqlite:///path/to/alm.db` to control which
  database is wiped before each test run.  If unset, the harness will
  resolve the OS app-data path (wiring deferred — see `reset_database` in
  `tests/common/mod.rs`).

## Notes

- The `__APP_E2E__.invoke` bridge and the tauri-driver caps are **not yet
  wired**.  See `tests/common/mod.rs` for the `TODO(spec-037 wiring)` comments.
- Tests run serially (`test-threads = 1` in the `e2e` nextest profile) because
  there is one app instance, one driver session, and one database per run.
