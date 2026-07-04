# THE GRAND END-TO-END JOURNEY — wizard → ingest → confirm → plan apply → audit

> One continuous scenario across the whole ingest custody chain, on a
> completely fresh app. Two-stage: Stage 1 agent via Tauri MCP bridge;
> Stage 2 Claude Desktop human pass, only after Stage 1 passes.
> Runner mechanics: `../../AGENT-RUNNER.md`. Fixtures:
> `../../041-inbox-plan-surface/FIXTURES.md`.

This journey intentionally overlaps the focused scenarios (they isolate
failures; this one proves the CHAIN). Run the focused scenarios first when
triaging; run the journey to certify the release path.

## Coverage (chain)

003 first-run wizard (source registration, org-state choice FR-019b) →
041 ingest (FR-034 single-type sub-items, FR-047/FR-048 gate,
FR-044 reclassify) → 041 confirm (FR-001/FR-002, FR-017 move-vs-catalogue,
FR-030 auto root) → plan review + apply (FR-003–FR-007, SC-001, on-disk
custody) → sessions derivation (FR-051/SC-018) → audit trail
(FR-003a/FR-005). Constitution principles I (Local-First Custody) and II
(Reviewable Filesystem Mutation) end-to-end.

Convoy preconditions: none on the base branch. If PRs #408/#410 are merged
by run time, their behaviors simply enrich steps 12–13 (note versions in
the report).

## Preconditions

1. Deploy `redesign-ui-platevault` on `C:\dev\astro-plan`; force recompile
   if the deployed commit changed any `.rs` since the last build.
2. Full reset: kill app; `Remove-Item 'C:\dev\astro-plan\wizard-test.db*'
   -Force`; FIXTURES.md § Cleanup.
3. Fixtures: **RECIPE-MIXED** (`inbox-drop\night1`), **RECIPE-NOFILTER**
   (`inbox-drop\nofilter`), **RECIPE-ORGANIZED**
   (`organized-lights\…`), **RECIPE-DEST** (`library-lights`, empty).
4. WSL baselines into `$SCRATCH`: full `find … test-data -name '*.fits'`
   tree + `sha256sum` of every fixture file.
5. Launch with bridge + `VITE_E2E=1`; connect `driver_session`; window
   **1100×720**; real backend (`VITE_USE_MOCKS=false` — mock mode makes the
   whole journey INVALID).

## Stage 1 — Agent validation via Tauri MCP

### Act 1 — Wizard (fresh first run)

1. Fresh DB → the app lands on `/setup` (Step 1 of the wizard, Source
   Folders).
   - Expected: no redirect loop; the four kind cards render.
   - FAIL if: the app opens on `/sessions` (stale DB) or blanks.
2. Register sources via the E2E hooks: for each, type the path into
   `[data-testid="e2e-path-input-<kind>"]` (native value setter + `input`
   event) then click `[data-testid="e2e-add-path-btn-<kind>"]` in a
   separate call:
   - `inbox` → `C:\dev\astro-plan\test-data\inbox-drop`
   - `light_frames` → `C:\dev\astro-plan\test-data\library-lights`, then
     set the row's organization-state select to **organized**
   - `light_frames` → `C:\dev\astro-plan\test-data\organized-lights`,
     org-state **organized**
   - Expected: each row appears under its card; the inbox row shows NO
     org-state select (unorganized by definition, FR-019b); non-inbox rows
     show the explicit organized/unorganized select with an explanation
     (`title`/aria text present).
   - FAIL if: a non-inbox source registers with no visible org-state
     choice.
3. Continue through the remaining steps with defaults and finish.
   - Expected: the app leaves `/setup`; `roots_list` returns the 3 roots
     with the chosen categories + organization states (paste it).
   - FAIL if: setup completion doesn't persist (revisit `/` redirects back
     to `/setup`).

### Act 2 — Ingest

4. `/inbox` → Rescan → wait for `[data-testid="inbox-list"]` rows; select
   each folder row once to classify.
   - Expected: `night1` materializes 3 single-type sub-items (light/Ha/300,
     light/Ha/120, dark/300 — SC-012, zero "mixed"); `nofilter` surfaces
     3 lights blocked with `needs filter` badges +
     `[data-testid="inbox-missing-attr-banner"]`; the `organized-lights`
     content appears as a cross-root item with `organizationState:
     "organized"`; status-bar stats agree with the totals.
   - FAIL if: any of the four expectations misses (details per the focused
     scenarios).
5. Gate check: `[data-testid="inbox-confirm-btn"]` disabled for `nofilter`;
   direct `inbox_confirm` invoke rejects `inbox.missing_path_attributes`.
6. Repair: select all `nofilter` files → `[data-testid="bulk-filter"]` =
   `Ha` → `[data-testid="bulk-apply-btn"]` (`Apply to selected (3)`).
   - Expected: badges clear, item becomes confirmable, fixture bytes
     unchanged (spot-hash one file).

### Act 3 — Confirm

7. Confirm, one by one: `light·Ha·300s`, `light·Ha·120s`, the repaired
   `nofilter` item, and the `organized-lights` item.
   - Expected: each shows toast "Plan created (N items)…"; items stay in
     the queue as planned (SC-003). Destination-root handling: TWO light
     roots are registered, so inbox-light confirms MUST prompt via
     `[data-testid="inbox-root-picker"]` (FR-029) — pick
     `library-lights` each time. The ORGANIZED item confirms without any
     prompt and reports `moveCount: 0, catalogueCount: 2` (FR-017/FR-018).
   - Expected: `inbox_plan_list_open` = 4 plans; disk tree still identical
     to baseline (SC-001 — nothing moves at confirm).
   - FAIL if: any confirm moves a file, drops the item from the queue, or
     the organized item gets a move plan.
8. Leave the `dark·300s` item UNCONFIRMED (it stays behind deliberately to
   prove partial application doesn't leak).

### Act 4 — Review + Apply

9. Open `[data-testid="inbox-review-plans-btn"]` (`Review plans (4)`).
   - Expected: overlay in-context on `/inbox` (never `/archive` — FR-004);
     `plan-total-count` = 9 actions (2+2+3 moves + 2 catalogues); per-group
     summaries; destructive control present, Archive default; absolute
     destinations under `C:\dev\astro-plan\test-data\library-lights\…`
     for every move row (FR-031). Record every destination path.
10. Cancel ONE plan (the 120s item) via `plan-cancel-<itemId>` — expected:
    discard toast, item back to `classified`, disk untouched (FR-006).
    Re-confirm it (root pick again) so 4 plans are pending once more.
11. Click `[data-testid="plan-apply-all"]`.
    - Expected: all 4 plans apply; each per-group progress completes; the
      queue retains ONLY the unconfirmed dark item; the overlay
      auto-closes.
    - On-disk custody assertions (WSL, against recorded paths):
      - 300s + 120s + nofilter lights (7 files) exist at EXACTLY the
        recorded destinations under
        `library-lights/NGC 7000/Ha/<date>/light/`, gone from their inbox
        folders, hashes identical to baseline;
      - `organized-lights` tree byte-for-byte identical (catalogued in
        place — SC-007);
      - darks still in `inbox-drop/night1/` (untouched);
      - no stray/duplicate files anywhere under `test-data`.
    - FAIL if: any custody assertion misses.

### Act 5 — Downstream truth

12. `/sessions`: derived sessions for NGC 7000/Ha on the fixture dates now
    exist with counts matching the 9 catalogued/moved lights; no
    Confirm/Re-open/Reject affordances (SC-018).
13. `/settings/audit` + `audit_list`: audit entries exist for each applied
    action (≥9 apply records, outcome applied/ok), plus plan
    created/discarded records for the step-10 cancel. Search for one moved
    filename — its audit row is findable. (If PR #410 is merged: coded
    rows expose `detailCode`/`detailParams` — spot-check one.)
    - FAIL if: any applied action lacks an audit record (FR-005).
14. Restart resilience: kill the app, relaunch (same DB).
    - Expected: no wizard (setup completed); inbox still shows the dark
      item; sessions and audit history intact — the DB is the durable
      record.
15. `read_logs` across the whole run: no unexpected ERROR entries (the
    deliberate gate rejection in step 5 is a structured refusal).

Screenshot checkpoints: `J-01` wizard sources step (rows + org-state),
`J-02` inbox after classify (grouped list + stats), `J-03` gate banner,
`J-04` overlay with 4 plans + destinations, `J-05` post-apply inbox (only
dark left), `J-06` sessions, `J-07` audit page.

### Stage 1 verdict

PASS = every act passes, including ALL on-disk custody assertions in
step 11 and the audit completeness in step 13. Any FAIL stops the journey;
report the act/step, payloads, `find`/hash diffs, and all screenshots
captured so far. A journey that only passes with mock data, a stale
binary, or skipped custody assertions is a FAIL.

## Stage 2 — Final Claude Desktop pass

Re-run the journey by hand (fresh reset, same fixtures), no bridge — pure
user experience judgment:

1. Wizard: is the organized/unorganized consequence explained well enough
   to choose correctly the first time (FR-019b)?
2. Ingest: with 6 items in the queue, does the surface guide you — what
   needs attention (gate) vs what is ready (classified) vs what is waiting
   (planned)?
3. Confirm + review: after four confirms, is "Review plans (4)" the obvious
   next step? In the overlay, can you answer "what exactly will happen to
   my files?" before applying (paths, counts, move vs catalogue)?
4. Apply: does progress feel trustworthy (per-group progress, final toast,
   items leaving the queue)? Afterwards, open File Explorer at
   `test-data\library-lights` and eyeball the result — does the folder
   structure look like a library you'd want?
5. Downstream: do Sessions and Audit tell the same story as what you just
   did, without re-review friction?
6. Theme + layout sweep at 1100×720: repeat the overlay + inbox + audit
   screens in **Warm Clay** and **Observatory**; pinned bars everywhere,
   only content scrolls, no overflow.
7. i18n sweep: no raw keys/codes anywhere along the journey; counts
   pluralize.
8. Sign-off: PASS/FAIL per point with screenshots (J-02/J-04/J-05 repeated
   in both themes). Overall verdict PASS only if Stage 1 passed AND the
   journey feels shippable end-to-end; otherwise FAIL with a prioritized
   defect list.
