# Testing Strategy

Astro Library Manager is tested in layers. Each layer exercises progressively
more of the real stack; put assertion load where it is cheapest and most
reliable.

| Layer | What runs | Where | Speed |
|---|---|---|---|
| **Unit** | pure domain logic; UI components against an in-process mock | `crates/**/src` inline tests; `apps/desktop/src/**/*.test.tsx` (vitest) | fastest |
| **Layer 1 — real-backend integration** | real `app_core` use cases against **real SQLite + real migrations**; external network mocked only at its boundary | `crates/**/tests/*.rs` | fast, deterministic |
| **Layer 2 — full-stack E2E** | the **built app** driven through its real UI → real IPC → real backend → real side effects | `apps/desktop/e2e/real-backend/*.spec.ts` | slow, smoke only |

The mock runtime / `mockIPC` path is **not** a real-stack test — it fakes backend
responses. Layers 1 and 2 use the real backend.

## Running each layer locally

### Layer 1 — integration (all OS)

```bash
just test-integration      # cargo test --workspace (real SQLite, real migrations)
```

No special prerequisites beyond the Rust toolchain. Deterministic and offline:
SIMBAD is exercised via the in-repo `FakeResolver` test double, not the network.
Each test gets an isolated in-memory database with all migrations applied
(`crates/app/core/tests/support/mod.rs`).

### Layer 2 — E2E smoke

```bash
just test-e2e              # pnpm --filter @astro-plan/desktop test:e2e:real
```

Drives the freshly built app via `tauri-driver`. Prerequisites by OS:

| OS | Driver | Notes |
|---|---|---|
| **Linux** | `tauri-driver` + `WebKitWebDriver` | `cargo install tauri-driver --locked`; `apt install webkit2gtk-driver xvfb`; runs under `xvfb-run`. |
| **Windows** | `tauri-driver` + `msedgedriver.exe` | version-match `msedgedriver` to installed Edge or it hangs on connect. |
| **macOS** | *best-effort* | Official `tauri-driver` does **not** support macOS (no WKWebView WebDriver from Apple). macOS E2E is non-merge-blocking; Layer 1 still runs in full on macOS. |

A missing prerequisite fails with a named message telling you what to install.

## CI

`.github/workflows/ci.yml` runs on every PR and push to `main`:

- **Stage A (required, Windows/Linux/macOS)**: format, clippy (`-D warnings`),
  build, Layer-1 tests, frontend unit tests, typecheck, and the generated
  contract/binding drift gate (`just check-generated`).
- **Stage B/C (E2E)**: added with the US3 E2E work — Linux + Windows required,
  macOS best-effort.

Fast checks and Layer 1 run before E2E so backend failures surface first.

## Adding coverage for a new feature

New features **ship with real-stack coverage**:

1. Add a Layer-1 integration test in the relevant crate's `tests/` dir, against a
   real DB, with any external network mocked only at its boundary (prefer the
   existing `FakeResolver` / `FakeSpawner` doubles).
2. If the feature has a primary user-facing flow, add/extend a Layer-2 journey.
3. Update the coverage mapping in
   `specs/037-e2e-integration-testing/contracts/coverage-matrix.md`.

Tests that touch the filesystem MUST use `tempfile::tempdir()` — never real user
libraries. Tests covering destructive operations assert the audit record.
