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

## Current status (2026-06-17)

All `real-backend/` spec files are **intentionally skipped** pending spec 033
implementation. The harness infrastructure (config, helpers) is scaffolded and
verified to compile/lint. Individual `test.skip` blocks document what each test
will prove once the relevant US lands.

Status of skipped test files:

| File | Spec 033 US | Unblocked by |
|---|---|---|
| `real-backend/r1_index_redirect.spec.ts` | — | Already fixed (covered by mocks-UI regression) |
| `real-backend/r3_startup_wiring.spec.ts` | — | Already fixed (covered by Rust unit) |
| `real-backend/us1_plan_apply_safety.spec.ts` | US1 | T1-2 fixes |
| `real-backend/us2_subscriber_startup.spec.ts` | US2 | US2 wiring pass |
| `real-backend/us3_ingestion_plumbing.spec.ts` | US3 | root_id + fingerprint population |
| `real-backend/us5_lifecycle_integrity.spec.ts` | US5 | two-table reconciliation |

---

## Adding a new test

1. Create `apps/desktop/e2e/real-backend/<name>.spec.ts`.
2. Import from `../helpers/tauri-app` for any app-level setup helpers.
3. Use `test.skip(...)` with a reason if the feature is not yet implemented.
4. Run `pnpm --filter @astro-plan/desktop test:e2e:real` to verify it is
   picked up by the config.
5. Typecheck: `pnpm --filter @astro-plan/desktop typecheck`.
