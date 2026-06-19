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

## Layer 2 — full-stack E2E smoke

```bash
just test-e2e                  # → pnpm --filter @astro-plan/desktop test:e2e:real
```

Drives the freshly built app through its real UI via `tauri-driver`.

### Prerequisites by OS

| OS | Driver | Install / notes |
|---|---|---|
| **Linux** | `tauri-driver` + `WebKitWebDriver` | `cargo install tauri-driver --locked`; `apt install webkit2gtk-driver xvfb`; runs under `xvfb-run`. |
| **Windows** | `tauri-driver` + `msedgedriver.exe` | `cargo install tauri-driver --locked`; fetch `msedgedriver` **version-matched to installed Edge** or it hangs on connect. |
| **macOS** | *best-effort* — `tauri-plugin-webdriver` | Official `tauri-driver` does **not** support macOS. macOS E2E is optional/non-blocking; the embedded plugin path is debug-only. Layer 1 still runs fully on macOS. |

If a prerequisite is missing the command fails with a named message telling you
what to install (FR-015).

### What the smoke suite proves

- Every top-level screen loads in the real app.
- At least one journey round-trips a value UI → real backend → UI.
- At least one journey applies a real filesystem plan and asserts the side effect
  **and** the durable audit record — all inside disposable test locations.

## CI

Every change runs both layers automatically (`.github/workflows/ci.yml`):
Layer 1 on Linux/Windows/macOS (required) → Layer 2 on Linux/Windows (required),
macOS (optional). See [research.md](./research.md) D5.

## Adding coverage for a new feature

1. Add a Layer-1 integration test in the relevant crate's `tests/` dir (real DB,
   boundary-mocked network).
2. If the feature has a primary user-facing flow, add/extend a Layer-2 journey.
3. Update [contracts/coverage-matrix.md](./contracts/coverage-matrix.md).

See `docs/development/testing.md` for the full strategy.
