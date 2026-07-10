# Testing Strategy

Astro Library Manager is tested in layers. Each layer exercises progressively
more of the real stack; put assertion load where it is cheapest and most
reliable.

| Layer | What runs | Where | Speed |
|---|---|---|---|
| **Unit** | pure domain logic; UI components against an in-process mock | `crates/**/src` inline tests; `apps/desktop/src/**/*.test.tsx` (vitest) | fastest |
| **Layer 1 — real-backend integration** | real `app_core` use cases against **real SQLite + real migrations**; external network mocked only at its boundary (offline `FakeResolver`/`FakeSpawner` test doubles, no live network) | `crates/**/tests/*.rs` | fast, deterministic |
| **Mock-Playwright — UI regression** | the frontend against a fully mocked IPC layer (`VITE_USE_MOCKS=true`); proves UI wiring, validation, and rendered copy, not backend logic | `tests/e2e/*.spec.ts` (Playwright, chromium) | fast, no Rust/webview needed |
| **Layer 2 — full-stack real-UI E2E** | the **built app** driven through its real UI → real IPC → real backend → real side effects, via `tauri-plugin-webdriver` | `crates/e2e-tests/tests/*.rs` (thirtyfour + cargo-nextest) | slow, smoke only |

The mock-Playwright layer and Layer 2 are complementary, not redundant: the
mock layer is cheap and can assert every screen's wiring/validation/copy; only
Layer 2 can prove a real filesystem mutation, a real audit record, a real
async pipeline firing, or OS-specific behavior (symlinks/junctions, trash) —
see `specs/037-e2e-integration-testing/contracts/coverage-matrix.md`'s
"Layer-2-only flows" section for the exhaustive list of what a mock
structurally cannot prove.

## Running each layer locally

### Layer 1 — integration (all OS)

```bash
just test-integration      # cargo test --workspace (real SQLite, real migrations)
```

No special prerequisites beyond the Rust toolchain. The `app_core`
integration suites (`crates/app/core/tests/*.rs`) and the Layer-2
`crates/e2e-tests` suite are deterministic and offline — SIMBAD is
exercised via the in-repo `FakeResolver` test double / bundled seed cache,
not the network. One pre-existing exception: `crates/targeting/resolver/
tests/simbad_live.rs` is an ungated live-network suite that runs as part of
the default `cargo test --workspace` and hits the real SIMBAD TAP endpoint
(skips only on a transient network error, never on principle — see that
file's module doc for SC-004 rationale). Each test gets an
isolated in-memory/tempdir-backed database with all migrations applied
(`crates/app/core/tests/support/mod.rs`).

### Mock-Playwright — UI regression (all OS)

```bash
pnpm --filter @astro-plan/desktop test:e2e     # tests/e2e/*.spec.ts, VITE_USE_MOCKS=true
```

No prerequisites beyond Node/pnpm and a Chromium install
(`pnpm --filter @astro-plan/desktop exec playwright install --with-deps
chromium`, once). Drives a plain Vite dev server in a headless browser — no
Tauri, no Rust build required.

### Layer 2 — full-stack real-UI E2E

```bash
just test-e2e              # pnpm --filter @astro-plan/desktop test:e2e:real
```

Builds the frontend (`VITE_E2E=1`), builds `desktop_shell --features e2e`,
and drives it via `tauri-plugin-webdriver` + the `tauri-webdriver` CLI proxy.
Prerequisites by OS:

| OS | Requires | Required on PRs? |
|---|---|---|
| **Linux** | `tauri-webdriver` CLI (`cargo install tauri-webdriver --locked`) + Tauri's webview/GTK system libs; runs under `xvfb-run`. | Yes |
| **Windows** | `tauri-webdriver` CLI only — the embedded plugin replaces any external driver. | Yes |
| **macOS** | `tauri-webdriver` CLI. | **No** — disabled on PRs/pushes; re-tested only via `workflow_dispatch`. `tauri-plugin-webdriver` does not connect on `macos-latest` GitHub runners today, an upstream blocker tracked in issue #489, not a per-PR regression. Layer 1 and the mock-Playwright layer still run in full on macOS. |

A missing prerequisite fails with a named message telling you what to
install (`crates/e2e-tests/tests/common/mod.rs::preflight()`).

## CI

`.github/workflows/ci.yml` runs on every PR and push to `main`:

- **Stage A (required, Windows/Linux/macOS)**: format, clippy (`-D warnings`),
  build, Layer-1 tests, frontend unit tests, typecheck, and the generated
  contract/binding drift gate (`just check-generated`).

`.github/workflows/e2e.yml` runs the Layer-2 real-UI suite independently:
Linux + Windows are required on every PR; macOS Real-UI is
**`workflow_dispatch`-only** (not run on PRs or pushes to `main`) pending
issue #489 — re-test it manually once the upstream blocker clears.

The mock-Playwright suite runs as part of `pnpm -r --if-present test`/`lint`
wiring in Stage A's frontend checks.

Fast checks and Layer 1 run before any E2E so backend failures surface first.

## Adding coverage for a new feature

New features **ship with real-stack coverage**:

1. Add a Layer-1 integration test in the relevant crate's `tests/` dir, against a
   real DB, with any external network mocked only at its boundary (prefer the
   existing `FakeResolver` / `FakeSpawner` doubles).
2. If the feature has a primary user-facing flow, add/extend a mock-Playwright
   spec (`tests/e2e/*.spec.ts`) for UI wiring/validation, and/or a Layer-2
   journey (`crates/e2e-tests`) if it needs a real filesystem mutation, a real
   audit record, or another Layer-2-only proof.
3. Update the coverage mapping in
   `specs/037-e2e-integration-testing/contracts/coverage-matrix.md`.

Tests that touch the filesystem MUST use `tempfile::tempdir()` — never real user
libraries. Tests covering destructive operations assert the audit record.
