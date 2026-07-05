# Targets — SIMBAD resolve-on-demand via "Add target"

> Two-stage verification plan. Stage 1: agent over the Tauri MCP bridge on
> the real Windows app. Stage 2: Claude Desktop human pass, only after
> Stage 1 PASS. Real backend required (`VITE_USE_MOCKS=false`).
> Shared mechanics: `e2e-agentic-test/AGENT-RUNNER.md`.

## Feature facts (context)

- Spec 035: FR-001 (resolve designation/common name to ONE canonical
  target), FR-002 (bundled seed for popular catalogues — served locally, no
  network), FR-004 (long-tail queries resolved via SIMBAD on demand), FR-005
  (as-you-type suggestions debounced; seed/cache suggestions are pure-local),
  FR-006 (local cache is the durable record), FR-011 (SIMBAD unreachable →
  graceful degradation, not an error crash), FR-015 (setting to disable
  online resolution).
- Surfaces: Targets top bar → **Add target** button → `AddTargetDialog`
  (spec 036), which reuses the `TargetSearch` typeahead.
- IPC:
  - `target_search` `{ req: { contractVersion, requestId, query, limit? } }`
    → ranked `TargetSuggestion[]` (LOCAL seed/cache only — never network).
  - `target_resolve` `{ req: { contractVersion: '1.0', requestId, query,
    override: null } }` → `{ status: 'resolved' | …, target? }`; this is the
    call that may hit SIMBAD for long-tail names and PERSISTS the canonical
    row.
- Error copy (frontend): resolve-failure renders `role="alert"` text from
  `targets_add_resolve_failed` / `targets_add_failed`.

## Preconditions

1. Branch `redesign-ui-platevault` deployed on `C:\dev\astro-plan`; fresh DB;
   first-run setup completed (AGENT-RUNNER.md).
2. Network access available for the long-tail test (Test 3). If the Windows
   host is offline, run Test 3's offline variant instead and mark the online
   variant `SKIPPED — offline host`.
3. Bridge connected. Start `ipc_monitor` (or use `ipc_get_captured`) so the
   `target_search` / `target_resolve` traffic can be asserted.

## Stage 1 — Agent validation via Tauri MCP

### Test 1 — Seed-served suggestions (no network, debounced)

1. Targets page → click **Add target**. The dialog opens with focus in the
   search field.
2. Type `M 42` slowly (per-character via `webview_keyboard`).
3. Read the captured IPC: `target_search` calls with the growing query.
Expected:
- A suggestion list appears containing M 42 (Orion Nebula) with its type.
- All suggestions arrive from `target_search` (local seed) — NO
  `target_resolve` call fires during typing (FR-005: resolve is not part of
  the typeahead).
- 📸 dialog with suggestions visible.
FAIL if: no suggestions for a Messier designation (seed missing = backend
regression), or `target_resolve` fires while typing.

### Test 2 — Confirm persists a canonical target (seed path)

1. Select the M 42 suggestion → the dialog shows it as the pending selection
   (accent pill + common name) with a **Change** affordance.
2. Click **Add target** (primary button; label switches to "Adding…" while
   in flight).
3. Assert from captured IPC: exactly one `target_resolve` with
   `query: "M 42"` (the suggestion's primaryDesignation) and `override: null`;
   response `status === 'resolved'` with a `target.targetId`.
4. The dialog closes; the list reloads (`target_list` fires) and the URL
   gains `?selected=<targetId>`; the detail pane opens for M 42.
5. Re-open **Add target**, search `M 42`, select, confirm again.
Expected:
- Steps 1–4 as inline. Step 5 must NOT create a duplicate: FR-001/FR-007 —
  the resolve returns the SAME canonical target id (compare with step 3's
  id), and the Targets list contains one M 42 row.
FAIL if: resolve rejects on a seed object, a duplicate canonical row
appears, or the dialog closes without selecting the new target.

### Test 3 — Long-tail resolve-on-demand (SIMBAD network path)

1. Open **Add target**, type an object NOT in the popular-catalogue seed,
   e.g. `HD 189733` (exoplanet host star).
2. If a suggestion appears (already cached), pick it; otherwise the pending
   state comes from typing — either way click confirm and watch
   `target_resolve`.
Expected (online):
- `target_resolve` completes with `status: 'resolved'`; the new target
  appears in the list with its SIMBAD-derived identity, and the detail pane
  identity table shows a **SIMBAD OID** row (proof the row came from SIMBAD,
  not the seed).
- Repeat the same query: second resolve is served from the local cache
  (FR-006) — same targetId, fast, and works even if you first disable the
  network (see offline variant).
Expected (offline variant — FR-011): with the Windows host's network
disabled, the confirm attempt shows the inline `role="alert"` error copy
("Could not add/resolve …") INSIDE the dialog; the dialog stays open, both
buttons re-enable (retry possible), the app does not navigate or crash, and
no partial row is added to the Targets list.
FAIL if: an unresolvable state crashes the dialog, the error is a raw error
code with no i18n copy, or an offline failure still inserts a row.

### Test 4 — Unknown object degrades gracefully

1. Open **Add target**, type `zzz-not-a-real-object-987`, confirm whatever
   pending state is reachable (if the UI never enables confirm without a
   suggestion, that IS the expected guard — record it as PASS).
Expected:
- Either the confirm button stays disabled (guard), or resolve returns a
  non-`resolved` status and the dialog shows the resolve-failed alert copy
  naming the query. No row is created (spec 035 FR-009: never guessed).
FAIL if: a fabricated/garbage canonical target row is created.

**Stage 1 verdict**: PASS requires Tests 1, 2, 4 PASS and Test 3 PASS in at
least one variant (online or offline). Check `read_logs` for new ERROR
entries; unexplained ones = FAIL.

## Stage 2 — Final Claude Desktop pass (only after Stage 1 PASS)

Window at 1100×720.

1. **Dialog UX**: the Add target dialog is centered, backdrop-dimmed,
   keyboard-escapable; focus lands in the search field on open; Cancel and
   backdrop-click both close without side effects.
2. **Suggestion quality**: typing `orion` (common name) surfaces sensible
   ranked suggestions with type labels — judge whether ranking feels right
   (designation matches above fuzzy ones).
3. **Error presentation**: re-run the offline variant visually — the alert
   is readable, non-technical, and clearly inside the dialog, in BOTH a
   light theme (Warm Slate) and a dark theme (Observatory).
4. **Attribution (FR-012)**: verify SIMBAD attribution is discoverable
   (settings/about or near the search). If absent anywhere in the app,
   record as a FINDING with severity, not an automatic FAIL of this
   scenario.
5. **i18n**: all dialog copy localized (no raw keys, no hardcoded English
   leaking from error codes).
6. Sign-off with screenshots (dialog open, resolved detail pane, error
   state).

## Verdict rubric

- **PASS**: Stage 1 green + Stage 2 signed off.
- **FAIL**: duplicate canonical targets, resolve-on-demand not persisting,
  offline path crashing or fabricating data, raw error codes shown to user.
- Report each test PASS/FAIL/SKIPPED + captured `target_resolve`
  request/response pairs (verbatim ids) for Tests 2–3.
