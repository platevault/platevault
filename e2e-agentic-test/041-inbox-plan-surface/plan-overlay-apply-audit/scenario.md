# 041 plans — overlay review, cancel, stale guard, apply-all, audit records

> Two-stage verification plan. Stage 1: agent via Tauri MCP bridge; Stage 2:
> Claude Desktop human pass, only after Stage 1 passes.
> Runner mechanics: `../../AGENT-RUNNER.md`. Fixtures: `../FIXTURES.md`.

## Coverage

| Requirement | Assertion in this scenario |
|---|---|
| FR-001 / FR-002 / SC-003 | Confirm produces a reviewable plan; item stays visible as planned |
| FR-003 / FR-004 / SC-002 | In-context review (focused overlay), never navigates to Archive |
| FR-003a | Apply one / apply selected / apply all; each action individually audited |
| FR-005 | Apply writes an audit record per attempted action; no silent overwrite |
| FR-006 | Cancel discards the plan, files untouched, item re-confirmable |
| FR-007 | Stale plan (source changed on disk) refuses to apply |
| FR-022 / FR-023 / US7 | Destructive-destination control (Archive default vs System Trash) in the review surface |
| SC-013 | At most one open plan per item (`inbox.has.open.plan`) |

Convoy preconditions: none (on `redesign-ui-platevault`).

## Preconditions

1. Deploy `redesign-ui-platevault`; clean DB + fixtures.
2. Generate **RECIPE-MIXED** (3 sub-items) and **RECIPE-DEST**
   (`test-data\library-lights`, the ONLY light root — so root selection is
   automatic per FR-030 and does not interfere with this scenario).
3. WSL baseline: `find /mnt/c/dev/astro-plan/test-data -name '*.fits' |
   sort > $SCRATCH/tree-before.txt`.
4. Launch with bridge + `VITE_E2E=1`; window 1100×720; real backend.
5. Wizard: inbox root = `test-data\inbox-drop`; light root =
   `test-data\library-lights` (organized). Finish → `/inbox` → Rescan →
   classify all rows (select each once).

## Stage 1 — Agent validation via Tauri MCP

1. **Confirm both light sub-items.** For `light · Ha · 300s` and
   `light · Ha · 120s`: select → `[data-testid="inbox-confirm-btn"]`.
   - Expected per confirm: success (single valid root → auto-selected, NO
     picker — FR-030); toast "Plan created (2 items). Review below before
     applying."; the item row REMAINS in the list, visibly marked planned
     (`state = "plan_open"` in `inbox_list`; row shows a planned
     badge/greyed style).
   - FAIL if: a root prompt appears, an item vanishes on confirm, or no
     plan registers in `inbox_plan_list_open`.
2. **Double-confirm guard (SC-013).** Via `webview_execute_js`, re-invoke
   `inbox_confirm` for the 300s item with the same signature.
   - Expected: rejection containing `inbox.has.open.plan`; still exactly
     one open plan for the item.
   - FAIL if: a second plan is created.
3. **Review overlay is in-context (FR-003/FR-004/SC-002).** Click
   `[data-testid="inbox-review-plans-btn"]` (label `Review plans (2)`).
   - Expected: `[data-testid="plan-approval-overlay"]` opens over the inbox
     route — assert `window.location` (hash/path) still contains `/inbox`
     (NOT `/archive`); the overlay contains `[data-testid="plan-panel"]`
     with `[data-testid="plan-panel-bar"]`,
     `[data-testid="plan-total-count"]` = 4 actions total, a group per plan
     (`[data-testid="plan-group-<itemId>"]`) with per-group summary
     (`plan-group-summary-<itemId>`), expandable rows, per-group Apply
     (`plan-apply-one-<itemId>`) and Cancel (`plan-cancel-<itemId>`),
     bulk `plan-select-all` / `plan-apply-selected` / `plan-apply-all`.
   - FAIL if: review navigates away from `/inbox`, or any listed control is
     missing.
4. **Destructive destination control (FR-022/FR-023).** In the overlay
   locate `[data-testid="plan-destructive-archive"]` and
   `[data-testid="plan-destructive-trash"]`.
   - Expected: both present inside the review surface with explanatory
     labels; **Archive is the default** (archive control checked/active).
     Toggle to trash and back; the selection is reflected in the control
     state. (These fixture plans contain no destructive actions — the
     control's placement + default is what is asserted here.)
   - FAIL if: control missing from the review surface, or default is
     Trash.
5. **Cancel discards cleanly (FR-006).** Click
   `[data-testid="plan-cancel-<itemId>"]` for the **120s** item.
   - Expected: toast "Plan discarded. Item is available for
     re-confirmation."; plan count drops to 1; the 120s item returns to
     confirmable state (`state = "classified"`, confirm enabled); on disk
     nothing changed (`find` = baseline).
   - FAIL if: files moved, the item disappears, or it cannot be
     re-confirmed.
6. **Stale plan refused (FR-007).** Make the 300s plan stale: append a new
   file into the source folder —
   `python C:\dev\astro-plan\test-data\make_fits.py
   "C:\dev\astro-plan\test-data\inbox-drop\night1\light_ha_300_0099.fits"
   IMAGETYP=LIGHT 'OBJECT=NGC 7000' FILTER=Ha EXPTIME=300.0 EXPOSURE=300.0
   "DATE-OBS=2026-06-23T22:00:00.000" RA=313.0 DEC=44.5 <COMMON>` — then
   click `plan-apply-one-<300sItemId>` in the overlay.
   - Expected: apply REFUSES; a staleness indication surfaces
     (`[data-testid="plan-stale-<itemId>"]` and/or an error toast naming
     staleness — paste the exact text/code, e.g. `classification.stale` /
     plan-stale error); NO file moved (verify via `find`); the plan is
     marked stale/blocked rather than silently applying the old action
     list.
   - FAIL if: the apply proceeds and moves files despite the source change.
7. **Regenerate and apply-all (FR-003a).** Cancel the stale 300s plan,
   Rescan, re-classify `night1` (the 300s group now has 3 files), resolve
   nothing else, then confirm BOTH light sub-items again. Open the overlay
   and click `[data-testid="plan-apply-all"]`.
   - Expected: both plans apply; toast reports applying N plans; queue
     empties of both items; overlay auto-closes when no plans remain.
   - On disk: all 5 light files (3×300s + 2×120s) now under
     `test-data\library-lights\NGC 7000\Ha\<date>\light\`, gone from
     `inbox-drop\night1`; darks untouched.
   - FAIL if: partial application without a partial-failure toast, files
     left behind, or the overlay stays open with zero plans.
8. **Audit records — one per attempted action (FR-003a/FR-005).** Via
   `webview_execute_js`:
   `await window.__TAURI__.core.invoke('audit_list', { filter: null,
   pagination: { limit: 50, offset: 0 } })` (adjust arg names to the
   generated bindings if the invoke rejects — paste the actual call used).
   - Expected: entries covering EACH applied action of step 7 (≥5 apply
     action records), each with outcome `applied`/`ok`, plus records for
     the plan lifecycle (created/cancelled/refused-stale as implemented).
     Also verify in the UI: Settings → Audit (pane `audit`, route
     `/settings/audit`) lists these events in "Audit Events" with outcome
     pills.
   - FAIL if: applied actions are missing from the audit log, or the UI
     page errors.
9. **No silent overwrite (FR-005).** Re-create one already-moved filename in
   the inbox (same command as step 6 but filename
   `light_ha_300_0001.fits`, i.e. a name that ALREADY exists at the
   destination), rescan, classify, confirm, and apply its plan.
   - Expected: the apply does NOT silently overwrite
     `library-lights\...\light_ha_300_0001.fits`: the action fails/skips
     with a surfaced conflict (error toast / per-item failure state) and an
     audit record with a non-ok outcome; the destination file's hash is
     unchanged.
   - FAIL if: the destination file is replaced without surfacing a
     conflict.
10. **Log check.** `read_logs`: apply/audit activity present; no unexpected
    ERROR entries (the deliberate stale + collision refusals are expected,
    as structured refusals).

Screenshot checkpoints: `S1-plan-01` (overlay with 2 plans + destructive
control), `S1-plan-02` (stale refusal), `S1-plan-03` (post-apply-all inbox),
`S1-plan-04` (audit page with apply records).

### Stage 1 verdict

PASS = steps 1–10 pass, including the disk assertions in 5–7 and 9 and the
audit assertions in 8–9. Otherwise FAIL with step, payloads, diffs,
screenshots.

## Stage 2 — Final Claude Desktop pass

1. Walk confirm → review → apply for one item by hand. Judge: does the
   planned state read clearly in the list (grey/badge)? Is the overlay's
   per-group summary ("N light → root") informative before expanding?
2. Stale path UX: is the staleness message actionable (tells you to rescan
   / re-confirm), not just an error?
3. Destructive control: read the Archive vs System Trash labels — is the
   consequence of each explained at the point of use (US7)?
4. Theme pass: overlay, progress bars, stale/danger states in **Warm
   Slate** and **Observatory**.
5. Layout at 1100×720: overlay header/footer pinned; only the plan list
   scrolls; long destination paths don't break rows.
6. i18n: all overlay strings, toasts, and audit-page strings from the
   catalog; counts pluralize.
7. Sign-off: PASS/FAIL per point + screenshots (both themes). Overall PASS
   requires Stage 1 PASS and no unresolved defect.
