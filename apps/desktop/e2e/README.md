# Real-Backend E2E Harness

> `apps/desktop/e2e/` — Playwright tests that drive the **real Tauri application**
> (real Rust backend, real SQLite IPC, no mock layer).

---

## Architecture

```
apps/desktop/
  e2e/
    README.md            ← this file
    playwright.real-backend.config.ts  ← Playwright config for real-backend mode
    helpers/
      tauri-app.ts       ← helpers for starting/stopping the real Tauri process
      db.ts              ← SQLite helpers for test setup/teardown
    real-backend/
      *.spec.ts          ← real-backend test files (skipped until spec 033 lands)
```

### Two Playwright configs

| Config | Command | Backend | Use case |
|---|---|---|---|
| `apps/desktop/playwright.config.ts` (existing) | `pnpm test:e2e` | Mocks (`VITE_USE_MOCKS=true`) | Routing, render, forms — no Tauri |
| `apps/desktop/e2e/playwright.real-backend.config.ts` (new) | `pnpm test:e2e:real` | Real Tauri (`VITE_USE_MOCKS=false`) | IPC, real SQLite, subscribers, safety paths |

---

## Prerequisites

All already installed in WSL (verified 2026-06-17):

- `webkit2gtk-4.1` — WebKit engine for the Tauri WebView
- `xvfb` — virtual framebuffer for headless operation
- `tauri-driver` — W3C WebDriver bridge for Tauri apps
- `WebKitWebDriver` — WebKit's WebDriver implementation

Verify with:

```bash
webkit2gtk-4.1 --version 2>/dev/null || echo "missing"
Xvfb -version 2>&1 | head -1
tauri-driver --version 2>/dev/null || echo "missing"
WebKitWebDriver --version 2>/dev/null || echo "missing"
```

---

## Running real-backend tests

### Manual (WSL, for development)

Step 1 — Start the Vite dev server (real backend, no mocks):

```bash
VITE_USE_MOCKS=false pnpm --filter @astro-plan/desktop exec vite \
  --host 127.0.0.1 --port 1420 --strictPort &
```

Step 2 — In a second terminal, start the Tauri process under xvfb:

```bash
xvfb-run -a -s "-screen 0 1400x900x24" \
  pnpm --filter @astro-plan/desktop exec tauri dev --no-watch \
  --config '{"build":{"devUrl":"http://localhost:1420"}}'
```

Step 3 — Run the real-backend Playwright suite:

```bash
cd apps/desktop
PLAYWRIGHT_BASE_URL=http://127.0.0.1:1420 \
  pnpm exec playwright test --config e2e/playwright.real-backend.config.ts
```

### Scripted (single command)

```bash
cd apps/desktop
pnpm test:e2e:real
```

This uses the `webServer` block in `playwright.real-backend.config.ts` to
orchestrate startup automatically.

### Reset test database

The real backend writes SQLite to:

```
~/.local/share/dev.astro-plan.astro-library-manager/alm.db
```

Delete or rename it to re-run first-time-setup tests:

```bash
rm ~/.local/share/dev.astro-plan.astro-library-manager/alm.db
```

---

## Test isolation strategy

Real-backend tests are harder to isolate than mocks-UI tests. The approach:

1. **Append-only setup** — each test inserts its own rows using unique IDs.
   Tests that need a clean state delete and recreate the DB file before running
   (use `test.beforeAll` with the `db.ts` helper).
2. **Use `test.serial`** — real-backend tests run sequentially
   (`fullyParallel: false` in config) to avoid SQLite lock contention.
3. **State reset via localStorage** — for first-run guard, seed/clear
   `alm.first-run.completed` via `page.addInitScript`.
4. **No permanent file mutations** — tests that exercise `plan.apply` must use
   temporary directories (`$TMPDIR`) and clean up in `test.afterAll`.

---

## Harness investigation (T006 — 2026-06-17)

Full investigation of the `xvfb → tauri-driver → WebKitWebDriver` W3C session
path was conducted on 2026-06-17. Findings:

### What works

- `xvfb-run -a echo "test"` — xvfb virtual framebuffer starts cleanly.
- `tauri-driver --port 4444` starts, the `/status` endpoint returns
  `{"value":{"ready":true,"message":"No sessions"}}`.
- A WebDriver `POST /session` with `{"browserName":"wpe webkit"}` causes
  `tauri-driver` to launch `WebKitWebDriver` and then `MiniBrowser` (the
  underlying WebKit browser). The MiniBrowser process starts successfully
  (dconf warnings are harmless WSL2 artifacts on the read-only `/run/user`
  filesystem).

### What is blocked in this environment

- `tauri-driver` expects to attach to a **running Tauri application binary**.
  Without a pre-built `desktop_shell` binary already running (listening on the
  WebKit devtools port), the `POST /session` call hangs waiting for the app
  connection rather than returning a session ID.
- Building a Tauri binary from scratch under the sandbox takes 15–30 minutes
  and requires a full Rust + webkit2gtk build. This is not feasible within a
  single test harness session.
- The sandbox's network restrictions prevent downloading the Vite dev server
  dependencies needed for a `tauri dev` cold-start.

### Conclusion for T006

**The tauri-driver/WebKitWebDriver harness is structurally sound**: the driver
starts, the status endpoint responds, and WebKit MiniBrowser launches on
session request. The blocking gap is the absence of a pre-built Tauri binary
and a running Vite dev server — infrastructure that exists in the Windows-native
development environment (via `pnpm tauri dev`) but is not available headlessly
in WSL sandbox CI.

**Honest verdict**: the harness scaffolding is complete and verified. Actual
W3C session drive of the real app requires:
1. A pre-built `desktop_shell` binary.
2. A running Vite dev server on port 1420.
3. `tauri-driver` launched after step 1 + 2.

This is the setup described in `specs/033-validation-bugfix-remediation/quickstart.md`
§ Layer 3. All real-backend spec files remain `test.skip` with precise reasons.
The per-story Rust integration tests and vitest are the strongest automated
signal and all pass. The real acceptance is done by the user on Windows-native
(Layer 4 in the quickstart).

### Running the suite now

```bash
cd apps/desktop
pnpm test:e2e:real
# Outputs: 19 skipped, 0 failed — harness structurally valid, specs awaiting binary.
```

---

## Current status (2026-06-17, updated post-T006 investigation)

All `real-backend/` spec files are **intentionally skipped** with precise
documented reasons. The harness infrastructure (config, helpers) is scaffolded,
type-checked, and lint-clean. Individual `test.skip` blocks document what each
test will prove once the relevant US lands and a Tauri binary is available.

Status of spec files:

| File | Spec 033 US | Skip reason |
|---|---|---|
| `real-backend/us1_plan_apply_safety.spec.ts` | US1 | Needs running Tauri binary (T006) + real plan items with library root resolved (T023a) |
| `real-backend/us2_subscriber_startup.spec.ts` | US2 | Needs running Tauri binary (T006) for subscriber startup verification |
| `real-backend/us3_ingestion_plumbing.spec.ts` | US3 | Needs running Tauri binary (T006) + root_id plumbing (T036a) |
| `real-backend/us5_lifecycle_integrity.spec.ts` | US5 | Needs running Tauri binary (T006); Rust unit tests (T046/T048) cover the logic |

Regressions R-1, R-2, R-3 are covered by their respective layer (mocks-UI PE,
vitest VC, Rust RU) — they do not need the real-backend harness.

R-4 is pinned by `scripts/check-tokens.sh` check 4 (wired into `just lint`)
and by `src/features/settings/NamingStructure.r4.test.ts` (vitest, runs in
`pnpm test`).

---

## Adding a new test

1. Create `apps/desktop/e2e/real-backend/<name>.spec.ts`.
2. Import from `../helpers/tauri-app` for any app-level setup helpers.
3. Use `test.skip(...)` with a reason if the feature is not yet implemented.
4. Run `pnpm --filter @astro-plan/desktop test:e2e:real` to verify it is
   picked up by the config.
5. Typecheck: `pnpm --filter @astro-plan/desktop typecheck`.
