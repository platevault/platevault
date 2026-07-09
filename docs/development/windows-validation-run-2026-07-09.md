# PlateVault — Windows real-app validation run (2026-07-09)

Interactive validation of the real Tauri desktop app on Windows, driven from WSL
via the tauri MCP bridge (`localhost:9223`, mirrored networking). Ten documented
journeys (`docs/development/windows-journeys/journey-01..10-*.md`) executed step by
step. **Interactive protocol:** every test stops for human review before the next.

**Run focus (per human directive, restart 2026-07-09):**
1. Restart the whole run from a clean first-run state.
2. Validate every step with an explicit human checkpoint.
3. Rigorously test **input validation** — actively feed wrong/edge entries and
   confirm the app catches them, not just the happy path.
4. Log **every** issue (human-noticed or agent-noticed) in the persistent
   backlog below.

## Environment

- **Commit under test:** `8097d9c6` (Windows checkout `C:\dev\astro-plan`).
  origin/main is `c6b82435`, 5 commits ahead, but all 5 are `docs:` / `chore:
  release` / `ci:` commits — **zero product-code diff** — so the running binary
  is behaviourally identical to current main.
- Real backend: `VITE_USE_MOCKS=false`, `VITE_E2E=1` (exposes `data-testid`
  stand-ins for the native folder pickers).
- DB (first-run source of truth): `sqlite://C:\dev\astro-plan\wizard-test.db`.
- Bridge: WebSocket `0.0.0.0:9223`, connect `driver_session host=localhost
  port=9223`.
- Run branch / worktree: `ws3-mcp-validation-run` @
  `/home/sjors/tmp/worktrees/astro-plan/campaign-ws0` (tracks origin/main).

## Persistent backlog

Every issue lives here for the life of the run. Status: `OPEN` / `FILED #NN` /
`FIXED` / `WONTFIX` / `INFO`. Severity: `bug` / `validation-gap` / `doc-drift` /
`enhancement` / `info`.

| ID | Sev | Where | Summary | Status |
|----|-----|-------|---------|--------|
| B1 | doc-drift | journey-01 doc | Doc says "Step 1 of 5"; wizard is now 6 steps (added Observing Site, 044-US3). | OPEN — fix doc in run branch |
| B2 | enhancement | Wizard · Observing Site | No map-based location picker; lat/long typed by hand. spec:044. | FILED #491 |
| B3 | validation-gap | Wizard · Step 1 Source Folders | Prior run: nonexistent path (`Q:\…`), illegal chars (`D:\bad<>\|chars`), and a relative path were all accepted into the wizard buffer with **no error**; empty input is a guarded no-op; duplicate path silently deduped. Register-time validation at Confirm/Scan was NEVER verified. **Priority re-test this run.** | OPEN — re-verify from scratch |
| B4 | info | Project wizard · Calibration (Journey 5) | Prior run: tool auto-detection is REAL on this build. Open issue #327 claims the Project-wizard Calibration step renders hardcoded mock masters — verify explicitly in Journey 5. | INFO — verify J5 |
| B5 | info | Wizard nav | Prior run: folder-card buffer survives Back/Forward navigation. Re-confirm. | INFO |

> B1–B5 were observed by the **prior** run session on this same build. Under the
> restart directive they are carried forward as claims to **re-verify from
> scratch**, not as settled facts.

## Journeys

_(populated as the run proceeds; each test: `Test N — name / PASS|FAIL|BLOCKED /
observed evidence / deviations / issues filed`)_

### Journey 1 — First-run setup → data sources

Environment: commit `8097d9c6`, fresh DB.

_pending first test_
