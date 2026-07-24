# Quickstart: Running the Real-Stack Test Layers

**Feature**: 037-e2e-integration-testing

Two layers. Run Layer 1 always (fast, all OS); run Layer 2 for UI↔backend wiring.

## Layer 1 — real-backend integration (all OS)

```bash
just test-integration          # → cargo test --workspace
```

- No special prerequisites beyond the Rust toolchain.
- Deterministic and offline. Each test gets an isolated, file-backed SQLite DB
  in a tempdir with real migrations (`crates/app/core/tests/support/mod.rs`).

### Tagging mechanism (T004)

No additional live-network tag was added for the app_core/e2e-tests suites
in scope here: `app_core`'s integration tests (Layer 1) and
`crates/e2e-tests` (Layer 2) exercise SIMBAD entirely offline — the in-repo
`targeting::FakeResolver` test double at Layer 1, and the bundled offline
seed cache at Layer 2 (`targets_journeys.rs` deliberately avoids a live
lookup, flaky in CI). This supersedes research D2's original `wiremock`
HTTP-boundary-stub plan (see `contracts/coverage-matrix.md`).

**Pre-existing exception, not covered by that decision** (RESOLVED by the
spec-tails release-hardening sweep): `crates/targeting/resolver/tests/simbad_live.rs`
is a separate live-network suite; it is now opt-in — skipped by default,
set `PV_LIVE_SIMBAD=1` to exercise it against the real SIMBAD TAP endpoint
(SC-004 live coverage; still skips gracefully on a transient network error
via its own `resolve_or_skip` helper once opted in). No longer runs
unconditionally in `cargo test --workspace`.

The `#[ignore]` attribute that DOES exist in this feature
(`crates/e2e-tests/tests/*.rs`) serves a different purpose: it gates every
Layer-2 real-UI journey out of the Layer-1 `cargo test --workspace` run
(which has no `tauri-webdriver` CLI, no `e2e`-feature app build, and no
served frontend), opted back in via `--run-ignored all` in `e2e.yml`. It is
not a live/mocked-network distinction.

## Layer 2 — full-stack E2E smoke (thirtyfour + cargo-nextest + tauri-plugin-webdriver)

```bash
# Local, one command (mirrors CI — Linux/macOS; see prerequisites below):
just test-e2e

# Or drive the pieces directly:
cargo nextest run -p e2e_tests --profile e2e --run-ignored all
```

All journeys are real (spec 037 WP-C, 2026-07-04 onward) and un-ignored in
source — `#[ignore]` only gates them out of the Layer-1 job (see above).
`crates/e2e-tests/README.md` and `contracts/coverage-matrix.md` list every
journey and exactly which real commands each one drives.

Drives the freshly built `desktop_shell --features e2e` app through its real
UI via the embedded `tauri-plugin-webdriver` server (:4445) and the
`tauri-webdriver` CLI proxy (:4444). thirtyfour (Rust W3C client) connects to
the CLI on :4444 and sends the `tauri:options.application` capability (no
`browserName`). The app loads its own frontend from the Tauri `devUrl`
(:5173); journeys do NOT call `driver.goto(...)`.

### Full prerequisite setup (Linux)

1. Install the `tauri-webdriver` CLI: `cargo install tauri-webdriver --locked`.
2. **Build the frontend** with `VITE_E2E=1` (enables typeable path inputs the
   native folder picker can't accept from WebDriver):
   ```bash
   VITE_E2E=1 pnpm --filter @astro-plan/desktop build
   ```
3. **Serve `dist` on :5173** (background):
   ```bash
   pnpm --filter @astro-plan/desktop preview --port 5173 &
   ```
4. **Build the app binary** with the `e2e` feature:
   ```bash
   cargo build -p desktop_shell --features e2e
   ```
5. **Run** (under `xvfb-run` for a headless display on Linux):
   ```bash
   xvfb-run -a cargo nextest run -p e2e_tests --profile e2e --run-ignored all
   ```

`apps/desktop/scripts/run-e2e-real.sh` (backing `pnpm --filter
@astro-plan/desktop test:e2e:real`, in turn backing `just test-e2e`) automates
steps 2–5 for local Linux/macOS use.

Set `PV_E2E_APP_BIN=/path/to/binary` to override the default debug path.
Set `PV_DB_URL=sqlite:///path/to/alm.db?mode=rwc` to control which DB is reset
before each test and which one the launched app connects to; unset, the
harness's `reset_database()` no-ops and the app falls back to its OS app-data
path.

### Prerequisites / requiredness by OS

| OS | Requires | Required on PRs? |
|---|---|---|
| **Linux** | `tauri-webdriver` CLI + Tauri's own webview/GTK system libs; run under `xvfb-run` | Yes |
| **Windows** | `tauri-webdriver` CLI only (embedded plugin, no external driver) | Yes |
| **macOS** | `tauri-webdriver` CLI | **No** — disabled on PRs (`workflow_dispatch`-only re-test); `tauri-plugin-webdriver` does not connect on `macos-latest` GitHub runners today, an upstream limitation tracked in issue #489, not a per-PR regression. Layer 1 still runs in full on macOS. |

### What the smoke suite proves

- Every top-level screen loads in the real app (`smoke.rs`).
- At least one journey round-trips a value UI → real backend → UI
  (`first_run_resolve_create_project`).
- At least one journey applies a real filesystem plan and asserts the side
  effect **and** the durable audit record (`plan_review_apply_with_audit`) —
  all inside disposable test locations.

## CI

`ci.yml` runs Layer 1 on Linux/Windows/macOS (required, all 3 OS) on every
change. `e2e.yml` runs Layer 2 (thirtyfour+nextest): Linux + Windows are
required on every PR; macOS is `workflow_dispatch`-only (not run on PRs or
pushes) pending issue #489. See `research.md` D5/D10.

## Adding coverage for a new feature

1. Add a Layer-1 integration test in the relevant crate's `tests/` dir (real DB,
   boundary-mocked network where applicable).
2. If the feature has a primary user-facing flow, add/extend a Layer-2 journey
   (`crates/e2e-tests`) and/or a mock-Playwright spec (`tests/e2e`).
3. Update [contracts/coverage-matrix.md](./contracts/coverage-matrix.md).

See `docs/development/testing.md` for the full strategy.
