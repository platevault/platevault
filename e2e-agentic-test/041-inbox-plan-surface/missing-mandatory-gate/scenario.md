# 041 ingest — missing-mandatory gate blocks confirm until resolved

> Two-stage verification plan. Stage 1: agent via Tauri MCP bridge; Stage 2:
> Claude Desktop human pass, only after Stage 1 passes.
> Runner mechanics: `../../AGENT-RUNNER.md`. Fixtures: `../FIXTURES.md`.

## Coverage

| Requirement | Assertion in this scenario |
|---|---|
| FR-032 / US9 | Plan generation blocked while a path-load-bearing attribute is missing |
| FR-047 / US12 | Gate generalizes to mandatory grouping keys (light: frameType, target, filter, exposureS) |
| FR-048 / SC-015 | Missing-attribute files collect in a per-source-group needs-review bucket; no plan can be created from them |
| FR-049 | Split-before-confirm loop: supplying the value re-runs classification and re-splits into confirmable items |
| FR-047 (target) | A light with no pointing and no user-set target routes to needs-review |
| UI gate (spec 043 §4) | Confirm button disabled up-front with an explanatory danger alert |

Convoy preconditions: none (on `redesign-ui-platevault`).

## Preconditions

1. Deploy `redesign-ui-platevault`; clean DB + fixtures.
2. Generate **RECIPE-NOFILTER** (3 lights, FILTER card absent). Additionally
   generate a **no-target** variant folder `inbox-drop\notarget` (2 lights
   with `OBJECT=-`, `RA=-`, `DEC=-` — no object string AND no pointing, so
   coordinate resolution cannot satisfy `target`):

   ```powershell
   New-Item -ItemType Directory -Force -Path 'C:\dev\astro-plan\test-data\inbox-drop\notarget'
   cd 'C:\dev\astro-plan\test-data\inbox-drop\notarget'
   foreach ($i in 1,2) {
     python C:\dev\astro-plan\test-data\make_fits.py "light_notarget_000$i.fits" `
       IMAGETYP=LIGHT OBJECT=- RA=- DEC=- FILTER=Ha EXPTIME=300.0 EXPOSURE=300.0 `
       "DATE-OBS=2026-06-25T22:0${i}:00.000" <COMMON>
   }
   ```

   (`<COMMON>` per FIXTURES.md § Common card sets.)
3. Create **RECIPE-DEST** (`test-data\library-lights`, registered organized).
4. Launch with bridge + `VITE_E2E=1`; window 1100×720; real backend.
5. Wizard: inbox root = `test-data\inbox-drop`; light root =
   `test-data\library-lights` (organized). Finish → `/inbox` → Rescan →
   select each folder row once (classify).

## Stage 1 — Agent validation via Tauri MCP

1. **Missing filter surfaces per file.** Select the `nofilter` item.
   - Expected: each of the 3 files shows a
     `[data-testid="inbox-missing-attr-light_nofilter_000N.fits"]` badge
     whose title/text names `filter` (`needs filter`); the danger banner
     `[data-testid="inbox-missing-attr-banner"]` renders with the
     "Required metadata missing" title; the metadata rows carry the warn
     class (`alm-inbox-meta-row--warn`).
   - FAIL if: files present as cleanly classified with no missing-attr
     annotation.
2. **Confirm is gated in the UI.** Read
   `[data-testid="inbox-confirm-btn"]`.
   - Expected: `disabled` attribute set while missing attributes exist.
   - FAIL if: the button is clickable.
3. **Backend enforces the gate independently (FR-032/SC-015).** Bypass the
   UI: via `webview_execute_js`, call
   `invoke('inbox_confirm', { req: { inboxItemId, contentSignature,
   rootAbsolutePath, destructiveDestination: 'archive', rootId: null } })`
   using the item's real id + signature from `inbox_list`.
   - Expected: the promise REJECTS with a ContractError whose code is
     `inbox.missing_path_attributes` (paste the full error into the
     report); `inbox_plan_list_open` afterwards contains **no** plan for
     this item.
   - FAIL if: confirm succeeds, a plan record appears, or a different error
     code is returned.
4. **Target is a hard mandatory key for lights (FR-047).** Select the
   `notarget` item.
   - Expected: its files route to needs-review (unclassified/needs-review
     presentation or a missing-attr annotation naming `target`); confirm is
     disabled; a direct `inbox_confirm` invoke rejects (code
     `inbox.missing_path_attributes` or the unclassified-composition
     rejection — paste the actual code).
   - FAIL if: a plan can be created for lights with neither pointing nor
     target.
5. **Supply the missing filter → gate clears (FR-049/US9).** On `nofilter`:
   select all affected files, `[data-testid="bulk-filter"]` = `Ha`,
   `[data-testid="bulk-apply-btn"]`.
   - Expected: badges + banner disappear; item re-partitions into a fully
     resolved single-type item; `[data-testid="inbox-confirm-btn"]` becomes
     enabled; the destination preview/resolved path in the detail now
     includes the supplied `Ha` segment (pattern
     `{target}/{filter}/{date}/light/`).
   - FAIL if: gate stays engaged after the value is supplied, or the
     destination does not reflect the corrected value.
6. **Confirm now succeeds and produces exactly one plan.** Click
   `[data-testid="inbox-confirm-btn"]` (`Confirm to inventory`).
   - Expected: toast "Plan created (N items). Review below before
     applying."; `inbox_plan_list_open` now contains exactly ONE plan for
     the item (SC-013); the item stays in the queue in a planned state
     (`state = "plan_open"` in `inbox_list`).
   - FAIL if: confirm still rejects, more than one open plan exists for the
     item, or the item vanishes from the queue.
7. **No files moved by the gate/confirm cycle.** WSL:
   `find /mnt/c/dev/astro-plan/test-data -name '*.fits' | sort` — compare
   with the fixture layout.
   - Expected: all fixture files remain exactly where they were generated
     (confirm produces a plan, never a move — SC-001).
   - FAIL if: any file moved.
8. **Log check.** `read_logs`: the rejected confirms of steps 3–4 may log
   as refused/warn but there must be no crash/unhandled-rejection ERROR
   entries.

Screenshot checkpoints: `S1-gate-01` (missing-attr badges + banner + disabled
confirm), `S1-gate-02` (post-fix enabled confirm + destination preview).

### Stage 1 verdict

PASS = steps 1–8 pass, including the direct-IPC rejection in step 3 and the
on-disk no-move assertion in step 7. Otherwise FAIL with step, error
payloads, and screenshots.

## Stage 2 — Final Claude Desktop pass

1. Re-run the gate flow by eye at 1100×720. Judge: does the banner explain
   WHAT is missing and WHERE to fix it (FR-032's "surfaced in the
   needs-review flow" must be actionable, not just red)? Is the toast
   wording ("Some files are missing required attributes…") shown when you
   click a disabled-path confirm attempt via keyboard, or is the disabled
   state alone sufficient/self-explanatory?
2. Hover the `needs filter` badge: tooltip lists the missing attribute(s)
   legibly.
3. Theme pass: danger banner + warn rows in **Warm Clay** and
   **Observatory** — warn/danger tints must be distinguishable in both.
4. i18n: banner title/body, badge text, and toasts are catalog strings; the
   missing-attribute names render as user-meaningful words, and note (don't
   fail) if raw registry keys like `exposureS` leak into user-facing badge
   text — file a polish issue if so.
5. Layout: banner does not push the pinned action bar off-screen; the
   detail panel scrolls internally.
6. Sign-off: PASS/FAIL per point + screenshots (both themes). Overall PASS
   requires Stage 1 PASS and no unresolved usability defect.
