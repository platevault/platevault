# Quickstart: Running the Real-Stack Test Layers

**Feature**: 037-e2e-integration-testing

Two layers. Run Layer 1 always (fast, all OS); run Layer 2 for UI↔backend wiring.

## Layer 1 — real-backend integration (all OS)

```bash
just test-integration          # → cargo test --workspace (integration-tagged)
# or directly:
cargo test --workspace
```

- No special prerequisites beyond the Rust toolchain.
- Deterministic and offline: SIMBAD is mocked at the HTTP boundary.
- Each test gets an isolated, file-backed SQLite DB in a tempdir with real
  migrations.

## Layer 2 — full-stack E2E smoke (thirtyfour + cargo-nextest)

```bash
# Run all Layer-2 journeys (including ignored stubs):
cargo nextest run -p e2e_tests --profile e2e --run-ignored all

# Run only the non-ignored subset (currently: 0 journeys un-ignored):
cargo nextest run -p e2e_tests --profile e2e
```

Today all journeys are `#[ignore]` stubs — the command above shows 5 skipped, 0
failed. Remove `#[ignore]` on a journey to make it run.

Drives the freshly built app through its real UI via `tauri-driver` (W3C
WebDriver). thirtyfour (Rust W3C client) connects to tauri-driver on :4444 and
sends the `tauri:options.application` capability (no `browserName` — WebKitWebDriver
rejects the session when it is set). The app loads its own frontend from the Tauri
devUrl (:5173); do NOT call `driver.goto(...)` in journeys.

### Full prerequisite setup (Linux)

1. **Build the frontend** with `VITE_E2E=1` (enables typeable path inputs):
   ```bash
   VITE_E2E=1 pnpm --filter @astro-plan/desktop build
   ```
2. **Serve `dist` on :5173** (background):
   ```bash
   pnpm --filter @astro-plan/desktop preview --port 5173 &
   ```
3. **Build the desktop binary** (debug):
   ```bash
   cargo build -p desktop_shell
   ```
4. **Run under xvfb** (headless display for WebKitWebDriver):
   ```bash
   xvfb-run -a cargo nextest run -p e2e_tests --profile e2e --run-ignored all
   ```

Set `ALM_E2E_APP_BIN=/path/to/binary` to override the default debug path.
Set `ALM_DB_URL=sqlite:///path/to/alm.db` to control which DB is reset per-test.

### Prerequisites by OS

| OS | Driver | Install / notes |
|---|---|---|
| **Linux** | `tauri-driver` + `WebKitWebDriver` | `cargo install tauri-driver --locked`; `apt install webkit2gtk-driver xvfb`; run under `xvfb-run`. |
| **Windows** | `tauri-driver` + `msedgedriver.exe` | `cargo install tauri-driver --locked`; fetch `msedgedriver` **version-matched to installed Edge** or it hangs on connect. |
| **macOS** | *best-effort* — `tauri-plugin-webdriver` | Official `tauri-driver` does **not** support macOS. macOS E2E is optional/non-blocking; the embedded plugin path (thirtyfour connects to it identically) is debug-only. `tauri-plugin-mcp` is an additional dev-only agent-interactive debug path (not a CI gate). Layer 1 still runs fully on macOS. |

### What the smoke suite proves (once journeys are un-ignored)

- Every top-level screen loads in the real app.
- At least one journey round-trips a value UI → real backend → UI.
- At least one journey applies a real filesystem plan and asserts the side effect
  **and** the durable audit record — all inside disposable test locations.

## CI

`ci.yml` runs Layer 1 on Linux/Windows/macOS (required, all 3 OS) on every
change. `e2e.yml` runs Layer 2 (thirtyfour+nextest, Linux required) — green
today because all journeys are `#[ignore]` stubs (`--no-tests=warn`). See
[research.md](./research.md) D5.

## Adding coverage for a new feature

1. Add a Layer-1 integration test in the relevant crate's `tests/` dir (real DB,
   boundary-mocked network).
2. If the feature has a primary user-facing flow, add/extend a Layer-2 journey.
3. Update [contracts/coverage-matrix.md](./contracts/coverage-matrix.md).

See `docs/development/testing.md` for the full strategy.
