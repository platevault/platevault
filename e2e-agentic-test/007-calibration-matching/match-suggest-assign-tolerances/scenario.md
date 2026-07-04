# Calibration — match suggestions, session context, assign, tolerances

> Two-stage verification plan for calibration matching (spec 007) with the
> PR #391 session-context columns and the PR #395 persisted Offset
> tolerance. Stage 1: agent via Tauri MCP bridge, real backend. Stage 2:
> Claude Desktop human pass after Stage 1 PASS.
> Shared mechanics: `e2e-agentic-test/AGENT-RUNNER.md`.

## Feature facts (context)

- Spec 007 FRs: FR-003 dark matching defaults gain/offset exact; FR-004
  flat matching filter exact + rotation tolerance; FR-005 bias gain/offset
  exact; FR-006 ranked recommendations with per-candidate confidence;
  FR-007 advisory + manual override; FR-012 hard-rule mismatches must be
  surfaced, not silently dropped.
- PR #391 (MERGED 2026-07-04): match candidates show REAL Target · Filter ·
  Night · Frames per suggested session (server-side batched lookup on
  `CalibrationMatchDto`: `targetName` / `filter` / `acquisitionNight` /
  `frameCount`); previously always `—`.
- PR #395 (MERGED 2026-07-04): `calibration_tolerances_get` /
  `calibration_tolerances_update` now persist to the
  `calibration_tolerances` singleton table (migration 0051 adds
  `require_same_offset`, default true); the Settings Offset toggle survives
  restart and feeds `MatchingRuleConfig::require_same_offset` in the engine.
- Surfaces: CalibrationPage → MasterDetail → `MatchCandidatesPanel`
  (status pill `suggest-status-pill`; rows `candidate-session-<sessionId>`;
  mismatch chips `mismatch-<dimension>`; `confidence-bar`;
  `assign-btn-<masterId>`, `assign-confirm-btn`, `assign-cancel-btn`,
  `assign-override-btn`, `override-warning`; states `suggest-loading`,
  `suggest-error`, `suggest-guard-error`, `suggest-observer-missing`).
  Settings → Calibration matching pane hosts the tolerance toggles.
- IPC: `calibration_match_suggest` `{ req }` →
  `{ status: match|ambiguous|no_match|observer_location_missing,
  candidates: CalibrationMatchDto[] }`; `calibration_match_assign`;
  `calibration_tolerances_get` / `calibration_tolerances_update`.

### Convoy preconditions

- PRs #391 and #395 are already MERGED; the deployed
  `redesign-ui-platevault` tip must contain them (both merged to `main` —
  if the redesign branch has not picked them up yet, report
  `BLOCKED — #391/#395 not on deployed branch` after checking
  `git log --oneline | grep -iE 'match candidates|offset match-required'`
  on the Windows checkout).

## Preconditions

1. Branch deployed with **forced Rust rebuild** (backend-heavy scenario —
   migration 0051 must have run; if Settings' Offset toggle errors with
   "no such column", the rebuild/migration did not happen: see project
   memory `sqlx-migrate-stale-embed`, touch a persistence `.rs` and
   relaunch).
2. Complete the **calibration journey scenario Phases 1–2**
   (`e2e-agentic-test/journeys/calibration-journey-ingest-to-match/scenario.md`)
   first: it ingests the MATCHED fixture set (lights 120 s gain 100 +
   masterDark 120 s gain 100 + masterFlat Ha + masterBias, one camera) and
   a DELIBERATE MISMATCH master (gain 200 dark). This scenario starts from
   that state.
3. Bridge connected; IPC capture on.

## Stage 1 — Agent validation via Tauri MCP

### Test 1 — Suggest returns ranked candidates with REAL session context (PR #391)

1. Calibration page → select the matched master dark (120 s, gain 100).
2. Wait out `suggest-loading`; capture the `calibration_match_suggest`
   response.
3. Read the candidates table rows (`candidate-session-<id>`).
Expected:
- Status pill (`suggest-status-pill`) shows `match` (or `ambiguous` if the
  fixture produced multiple equal candidates — record which).
- At least one candidate row shows Target `M 42` (or the fixture target),
  Filter `Ha`, the fixture Night (date), and Frames `3` — REAL values, not
  `—` (the pre-#391 regression this test exists to catch).
- Row order follows candidate confidence; each row has a `confidence-bar`.
- DOM values match the captured DTO fields (`targetName`, `filter`,
  `acquisitionNight`, `frameCount`) verbatim.
- 📸 candidates panel.
FAIL if: all context columns are `—` while the DTOs carry values (or the
DTOs are all null for sessions that have a linked target — server-side
enrichment regression), or no candidates for the deliberately matched
fingerprint.

### Test 2 — Hard-rule mismatch is surfaced, not hidden (FR-012)

1. Select the MISMATCH master dark (gain 200).
2. Capture suggest; read the panel.
Expected: either `no_match` status with the humanized empty state, or
candidates carrying explicit `mismatch-<dimension>` chips naming the gain
delta — the gain-100 sessions must NOT appear as a clean high-confidence
match.
FAIL if: the mismatched master presents the gain-100 session as a clean
match with no mismatch surface.

### Test 3 — Assign is advisory + confirmable, and updates usage (FR-007)

1. Back on the matched dark: click `assign-btn-<masterId>` on the top
   candidate.
2. A confirm affordance appears (`assign-confirm-btn` / `assign-cancel-btn`).
   First click **Cancel** → no `calibration_match_assign` call fired.
3. Click assign again, then confirm. Capture `calibration_match_assign`
   (Ok).
4. Re-read the master's usage (`master-usage-<id>` in the list, and the
   detail "Used by"): now reports 1 session.
Expected: as inline; the assignment persists across a page navigation
(leave to Sessions, return).
FAIL if: cancel still assigns, assign errors, or usage stays "unused" after
a successful assign response.

### Test 4 — Offset tolerance persists and gates the engine (PR #395)

1. Settings → Calibration matching pane. Read the **Offset** "match
   required" toggle state; capture `calibration_tolerances_get` — response
   must include `requireSameOffset` (camelCase) and match the UI.
2. Flip the toggle; capture `calibration_tolerances_update` (Ok, echoing
   the new value).
3. **Restart the app** (kill + relaunch per AGENT-RUNNER.md). Return to the
   pane.
4. Re-run suggest on the matched dark and compare with Test 1: with
   `requireSameOffset` flipped, candidates whose offset differs from the
   master's may appear/disappear. The fixture set encodes offset 50 on the
   matched pair and offset 10 on one extra light session — record the
   candidate delta between both toggle states.
5. Restore the toggle to ON (default).
Expected: the toggle survives restart (step 3 — THE #395 regression check);
`calibration_tolerances_get` after restart returns the flipped value;
suggest results react to the setting (step 4).
FAIL if: the toggle reverts after restart (stub regression), the update
call echoes without persisting, or the engine ignores the flag entirely
(identical candidate sets AND identical mismatch surfaces in both states
for the offset-divergent session).

### Test 5 — Error/edge surfaces

1. Flat master selected: if same-night flat logic requires observer
   location and none is set, the panel must show the
   `suggest-observer-missing` guidance (status
   `observer_location_missing`), NOT a raw error. Record which state the
   flat shows.
2. Force a transient failure: via `webview_execute_js`, patch
   `window.__TAURI__.core.invoke` to reject ONLY
   `calibration_match_suggest` (same technique as the 003 exemplar
   scenario's Test 5), reselect a master, assert `suggest-error` renders
   localized copy, then restore and confirm recovery without restart.
Expected: as inline.
FAIL if: raw error strings/codes render, or recovery requires an app
restart.

**Stage 1 verdict**: PASS = Tests 1–5 green + no unexplained ERROR logs.

## Stage 2 — Final Claude Desktop pass (only after Stage 1 PASS)

Window 1100×720; Warm Slate + Observatory.

1. **Confidence communication**: confidence bars + status pills read
   at-a-glance; ambiguous vs match vs no_match visually distinct in both
   themes.
2. **Mismatch chips**: dimension mismatch warnings are readable and clearly
   attached to their row (judge whether a user understands WHY a candidate
   is penalized).
3. **Assign flow**: the confirm step feels deliberate (advisory, FR-007),
   not accidental; the override path (`assign-override-btn` /
   `override-warning`) communicates risk without jargon.
4. **Settings pane**: the Offset toggle copy explains what "match required"
   means; flipping gives feedback (persisted state, not a dead toggle).
5. **Layout**: detail hero (match table) scrolls within the pane; action
   bar pinned; no overflow at 1100×720.
6. **i18n**: status labels, mismatch reasons, empty states — no raw keys.
7. Sign-off with screenshots (match table, mismatch state, assign confirm,
   settings toggle; both themes).

## Verdict rubric

- **PASS**: Stage 1 green + Stage 2 signed off.
- **FAIL**: context columns dash-only (#391 regression), tolerance toggle
  not surviving restart (#395 regression), hard-rule mismatches hidden,
  cancel-assign side effects, raw error surfaces.
- Report per test PASS/FAIL/BLOCKED + verbatim suggest/assign/tolerances
  request-response excerpts.
