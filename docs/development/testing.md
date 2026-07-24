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
not the network. `crates/targeting/resolver/tests/simbad_live.rs` is the one
live-network suite in the workspace; it's opt-in (skips by default, set
`PV_LIVE_SIMBAD=1` to exercise it against the real SIMBAD TAP endpoint —
see that file's module doc for SC-004 rationale). Each test gets an
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

## Diagnosing load-state races in component tests

This section is the durable record of the #1083 sweep (#1095, #1109, #1118,
#1128). Read it before hunting async flakes again — the sweep's main output was
learning which methods do *not* work.

### Do not classify by pattern

The sweep's candidate list came from grepping for "a `waitFor(...)` block
followed by a synchronous `expect(someMock).toHaveBeenCalled…`". **4 of 31
candidates were real races.** Two independent reasons the textual pattern fails:

- It cannot see containment. The original scanner matched on *line proximity*
  and never checked whether the `expect` was inside the `waitFor` callback, so
  it flagged 11 already-correct `await waitFor(() => expect(...))` calls whose
  own opening `waitFor(` happened to sit one line up.
- Even with containment fixed, the shape is not the signal. The remaining
  candidates were still overwhelmingly false positives, because whether a test
  races is a question about the *component*, not the assertion.

No scanner is committed for this, deliberately. The discriminator below is
semantic and not statically decidable, so a candidate-list generator mostly
manufactures triage cost. (`ast-grep` would fix the containment defect but not
the underlying imprecision, and it is not a dependency of this repo.)

### The actual discriminator

**Does a React effect or an `await` sit between the trigger and the
observable?**

- The component calls the mock straight from a click handler → it cannot race.
  Classifiable by reading alone; skip it.
- The assertion targets work scheduled *after* a render commit (`useEffect`, a
  `.then()`, a state-triggered fetch) → genuine candidate.

`LogPanel.crosslink` was 0 for 4 on exactly this point: `void navigate({...})`
discards the returned promise, but the call itself is synchronous.

### Confirm empirically, with a positive control

Inject a ~120 ms delay into the relevant mock's *resolution* — keeping the call
itself synchronous — or make it never resolve, then run the test:

- fails under delay → genuine race; fix it
- still passes → false positive; leave it completely alone

**A suite that passes under hanging mocks is indistinguishable from a suite
that never ran.** Validate the instrumentation before trusting a negative
result: deliberately break one assertion (swap an expected route for a bogus
value) and confirm it fails. Both null-result lanes in the sweep did this.

Triage the assertion *block*, not the matched line. In 2 of the 3 real races,
the flagged line was a synchronous handler call (safe) and the racing assertion
was the next one.

### `waitFor` is the wrong fix for "must never happen"

`waitFor` retries until the callback stops throwing, so it only ever proves
**"the call hasn't arrived *yet*"**. Mock call counts never decrease, so a
*negated* call assertion inside a `waitFor` callback is satisfied on the first
attempt and asserts nothing — silently converting a regression test into a
no-op:

```ts
// WRONG — passes immediately, proves nothing
await waitFor(() => expect(mockIpc).not.toHaveBeenCalled());

// RIGHT — await the observable that proves the work is done, then assert
await waitFor(() => expect(screen.getByRole('status')).toBeVisible());
expect(mockIpc).not.toHaveBeenCalled();
```

`AuditLog.test.tsx` (a keystroke must not trigger an immediate IPC round-trip)
and `SchemaViewer.callVersion.test.tsx` (no extra re-fetch) are both correctly
synchronous for this reason. The `alm/no-vacuous-waitfor` ESLint rule
(`apps/desktop/eslint-rules/no-vacuous-waitfor.js`) enforces this, since the
failure mode is silent and green. Waiting for a call to *arrive*
(`await waitFor(() => expect(m).toHaveBeenCalledTimes(1))`) is monotonic,
legitimate, and not flagged.

### Element-exists vs value-changed

Where an element renders unconditionally and only its **value** arrives late,
`findByLabelText` does *not* fix the race — it resolves immediately against the
pre-hydration element. Use a value-aware query, e.g.
`findByRole('checkbox', { name, checked: true })`. That was the #1109 lesson,
and the #1128 `SourceProtectionOverride` fix is the same shape: it had to gate
on the editor's select *disappearing*, because the two nearby queries both
matched something present from first render.

### Sweep residue

The sweep covered `apps/desktop/src/{app,ui,dev,features/{settings,setup,targets,projects,inbox,archive,plans}}`.
Every other directory is unswept. Given the 4-in-31 hit rate and the triage cost
per real bug, a broad rescan is not worth running; investigate a specific
observed flake instead.
