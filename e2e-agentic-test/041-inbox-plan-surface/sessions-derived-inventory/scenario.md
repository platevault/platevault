# 041 sessions — derived, already-confirmed inventory (no review lifecycle)

> Two-stage verification plan. Stage 1: agent via Tauri MCP bridge; Stage 2:
> Claude Desktop human pass, only after Stage 1 passes.
> Runner mechanics: `../../AGENT-RUNNER.md`. Fixtures: `../FIXTURES.md`.

## Coverage

| Requirement | Assertion in this scenario |
|---|---|
| FR-051 / US14 / SC-018 | Sessions are derived from confirmed inventory; NO Confirm/Re-open/Reject/Ignore review affordances anywhere on the sessions surface |
| US14 AC-2 | Session metadata remains editable post-hoc with no lifecycle transition |
| FR-051 (derivation) | Sessions appear only after inbox confirm+apply establishes the inventory (not from raw scans) |

Convoy preconditions: none (on `redesign-ui-platevault`; FR-051 landed with
T076/Phase 13).

## Preconditions

1. Deploy `redesign-ui-platevault`; clean DB + fixtures.
2. Generate **RECIPE-MIXED** and **RECIPE-DEST** (single light root, so
   confirms auto-select the destination).
3. Launch with bridge + `VITE_E2E=1`; window 1100×720; real backend.
4. Wizard: inbox root = `test-data\inbox-drop`; light root =
   `test-data\library-lights` (organized). Finish.

## Stage 1 — Agent validation via Tauri MCP

1. **Before any confirm, sessions are empty of the fixture data.** Navigate
   to `/sessions`; also invoke `sessions_list` (args per bindings — filter
   null / defaults).
   - Expected: no session derived from `night1` (the fixture lights are
     still unconfirmed inbox items). Record the total for comparison.
   - FAIL if: unconfirmed inbox content already surfaces as sessions.
2. **Confirm + apply the two light sub-items.** On `/inbox`: Rescan,
   classify, confirm `light · Ha · 300s` and `light · Ha · 120s`, open
   `[data-testid="inbox-review-plans-btn"]` →
   `[data-testid="plan-apply-all"]`, wait for the applied state (see the
   `plan-overlay-apply-audit` scenario for the detailed expectations —
   here it is setup).
   - Expected: both plans applied; inbox items gone.
3. **Sessions derive from the confirmed inventory.** Back to `/sessions`
   (or `sessions_list`).
   - Expected: acquisition session row(s) for NGC 7000 / Ha on the fixture
     dates now exist, derived without ANY user session-review step; counts
     agree with the applied files (5 lights total if run after the full
     apply-audit scenario's regenerate, else 4 — assert against what was
     actually applied in step 2 and record the number).
   - FAIL if: no session appears after apply, or a session demands
     confirmation before appearing.
4. **No review lifecycle anywhere (SC-018).** On the sessions list AND a
   session's detail (`/sessions/$id` — click a row):
   via `webview_dom_snapshot` / `webview_execute_js`, search the rendered
   text and buttons for the review-lifecycle vocabulary:
   `Confirm`, `Re-open`, `Reject`, `Ignore`, `needs_review`, `candidate`,
   `discovered` (as state labels or action buttons).
   - Expected: ZERO review-state pills and ZERO Confirm/Re-open/Reject/
     Ignore action buttons on the sessions surface. (Unrelated uses of the
     word in other UI chrome — e.g. a global dialog — don't count; report
     any hit with its DOM context.)
   - IPC assertion: `sessions_list` entries carry no review-state field
     with values like `needs_review`/`candidate` (paste one entry).
   - FAIL if: any session exposes a review state or review action.
5. **Post-hoc metadata edit without lifecycle (US14 AC-2).** In the session
   detail, edit an editable metadata field (e.g. notes/label field exposed
   by SessionDetail; if the detail links back to the editable per-file
   metadata table, follow it) and save.
   - Expected: the edit persists (re-navigate and re-read via
     `sessions_get`) and NO state transition / confirmation gate is
     involved; no `lifecycle` transition command fires (watch
     `ipc_monitor` during the edit — no `lifecycle_transition_apply`).
   - If no editable field exists on the session detail in the current
     build: record "not exposed" and check instead that editing the
     underlying inventory metadata (via the file-metadata surface) is
     reachable without any Confirm/Re-open — the requirement is "editable
     with no lifecycle gate", not a specific widget.
   - FAIL if: editing requires re-opening/confirming a session, or the
     edit round-trips through a lifecycle transition.
6. **Rescan does not resurrect a lifecycle.** Trigger an inbox Rescan, then
   reload `/sessions`.
   - Expected: sessions unchanged (derived deterministically from
     confirmed metadata — no churn back into any pending/review state).
   - FAIL if: sessions duplicate or regress to a pending state.
7. **Log check.** `read_logs`: no ERROR entries from sessions derivation.

Screenshot checkpoints: `S1-sess-01` (sessions list with derived rows),
`S1-sess-02` (session detail — no review actions visible).

### Stage 1 verdict

PASS = steps 1–7 pass, with the DOM-wide absence check in step 4 clean.
Otherwise FAIL with step, DOM snippet of any offending control, payloads.

## Stage 2 — Final Claude Desktop pass

1. Read the sessions list as a user who just applied their first inbox
   batch. Judge: is it clear these sessions came from what you confirmed
   (derivation is trustworthy), with no dangling "so do I need to approve
   this?" ambiguity?
2. Open the session detail. Judge: the absence of Confirm/Reject reads as
   intentional (already-confirmed inventory), not broken; the metadata
   presented matches what you saw in the inbox detail.
3. Theme pass: sessions table + detail in **Warm Clay** and **Espresso**.
4. Layout at 1100×720: pinned bars, only the table scrolls, calendar/group
   views (if toggled) don't overflow.
5. i18n: table headers, group labels, empty states from the catalog.
6. Sign-off: PASS/FAIL per point + screenshots (both themes). Overall PASS
   requires Stage 1 PASS and no unresolved defect.
