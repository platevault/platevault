# 041 ingest — field-agnostic reclassify (bulk overrides, index-only, re-partition)

> Two-stage verification plan. Stage 1: agent via Tauri MCP bridge; Stage 2:
> Claude Desktop human pass, only after Stage 1 passes.
> Runner mechanics: `../../AGENT-RUNNER.md`. Fixtures: `../FIXTURES.md`.

## Coverage

| Requirement | Assertion in this scenario |
|---|---|
| FR-013 / US3 | Frame-type override for unclassified files |
| FR-014 / SC-005 | Multi-select + "Apply to selected (N)" with accurate count |
| FR-015 | Breakdown stays visible and reflects overrides; no cross-item leakage |
| FR-016 / FR-045 / SC-016 | Overrides are index-only — file bytes unchanged (sha256 before/after) |
| FR-016a / FR-046 | Overrides persist across a rescan (content-keyed) |
| FR-044 / SC-014 | `inbox_property_registry` exposes a typed registry; reclassify accepts registry properties |
| US11 / FR-049 | Supplying values re-partitions the needs-review bucket into single-type items |

Convoy preconditions: none (on `redesign-ui-platevault`).

Known-scope note (record, don't fail on it): the shipped bulk editor surfaces
frame type / filter / exposure / binning; the fully generic per-property
editor over the registry is exercised at the IPC level via
`inbox_property_registry` + `inbox_reclassify_v2` in step 8. If the UI has
since grown a generic property table, test it in place of step 8's IPC probe
and note the difference.

## Preconditions

1. Deploy `redesign-ui-platevault`; clean DB + fixtures (AGENT-RUNNER.md,
   FIXTURES.md § Cleanup).
2. Generate **RECIPE-NOTYPE** (2 files, no IMAGETYP) and **RECIPE-NOFILTER**
   (3 lights, no FILTER) under `test-data\inbox-drop\`, plus the empty
   **RECIPE-DEST** root.
3. Record baseline hashes (WSL):
   `sha256sum /mnt/c/dev/astro-plan/test-data/inbox-drop/*/*.fits | sort > /tmp/claude-1000/-home-sjors-dev-astro-plan/cb49f83e-59f6-4f9e-aa9e-2bbd718f18b5/scratchpad/fixture-hashes-before.txt`
4. Launch with bridge + `VITE_E2E=1`; window 1100×720; real backend
   (`VITE_USE_MOCKS=false`).
5. First-run wizard: inbox root = `test-data\inbox-drop`; light-frames root =
   `test-data\library-lights` (organized). Finish; navigate to `/inbox`;
   Rescan; select each new folder row once so classification runs.

## Stage 1 — Agent validation via Tauri MCP

1. **Needs-review table renders for unreadable types.** Select the `notype`
   item.
   - Expected: detail shows the "Needs review (2)" section with the two
     files, each row exposing `[data-testid="reclassify-select-<idx>"]` and
     `[data-testid="override-select-<filePath>"]`; the unclassified alert
     `[data-testid="inbox-unclassified-alert"]` is present; the confirm
     button `[data-testid="inbox-confirm-btn"]` is disabled.
   - FAIL if: the section is missing, or confirm is enabled while
     unclassified files exist (FR-048/FR-049 gate breach).
2. **Multi-select + bulk frame-type override (FR-014).** Check
   `[data-testid="reclassify-select-all"]`. The bulk controls appear.
   Set `[data-testid="bulk-frame-type"]` to `light`. Click
   `[data-testid="bulk-apply-btn"]` (label `Apply to selected (2)`).
   - Expected: button label shows count **2** (equal to the selection);
     an `inbox_reclassify` IPC call fires with `overrides` of length 2
     (assert via `ipc_get_captured` or by monitoring); afterwards the
     needs-review table empties for frame type and the item re-partitions.
   - FAIL if: the reported count differs from 2, or only a subset of the
     selection received the override.
3. **Re-partition after override (FR-049/US11).** Re-read `inbox_list`.
   - Expected: the former `notype` bucket has become a proper single-type
     `light` sub-item (files now carry `frameTypeEffective = light` in
     `inbox_item_metadata`); no sentinel needs-review item remains for that
     folder.
   - FAIL if: files stay in the needs-review bucket after the override, or
     the item still reports an unclassified composition.
4. **Bulk filter override on the nofilter lights.** Select the `nofilter`
   item. Its 3 files are missing `filter` (a mandatory light attribute) —
   they surface with `needs filter` badges
   (`[data-testid^="inbox-missing-attr-"]`) and/or in the needs-review
   table. Select all affected files, type `Ha` into
   `[data-testid="bulk-filter"]`, click `[data-testid="bulk-apply-btn"]`.
   - Expected: applied-count = 3; after refresh the metadata table shows
     `Ha` in the Filter column for all 3 files; the missing-attr badges and
     the danger banner `[data-testid="inbox-missing-attr-banner"]`
     disappear; `[data-testid="inbox-confirm-btn"]` becomes enabled.
   - FAIL if: count ≠ 3, badges persist, filter column still dashed, or
     confirm stays disabled with no remaining missing attribute.
5. **No cross-item leakage (FR-015).** Select a different item (the `notype`
   → now-light item), then re-select `nofilter`.
   - Expected: each item's detail shows only its own files and overrides;
     the breakdown section stays visible on both (does not blank after
     overrides).
   - FAIL if: an override value from one item appears pre-filled or applied
     on another item's files, or a breakdown blanks out.
6. **Index-only guarantee (SC-016/FR-016/FR-045).** From WSL re-hash:
   `sha256sum /mnt/c/dev/astro-plan/test-data/inbox-drop/*/*.fits | sort`
   and diff against the baseline from precondition 3.
   - Expected: **byte-identical** — zero hash differences after all
     overrides.
   - FAIL if: any fixture file's hash changed.
7. **Overrides persist across rescan (FR-016a/FR-046).** Click **Rescan**;
   wait; re-read `inbox_item_metadata` for both items.
   - Expected: `frameTypeEffective = light` (notype files) and
     `filter = Ha` (nofilter files) are still in effect; the items do not
     fall back into needs-review.
   - FAIL if: overrides are lost or the needs-review bucket reappears for
     unchanged files.
8. **Typed property registry (FR-044/SC-014, IPC-level).** Via
   `webview_execute_js`:
   `await window.__TAURI__.core.invoke('inbox_property_registry')`.
   - Expected: a response listing typed property descriptors (key, kind,
     unit, overridability, applicable frame types) including at least
     `filter`, `exposureS`, `gain`, `temperature`-class and `target` keys.
     Paste the key list into the report.
   - FAIL if: the command is missing ("not found") or returns an empty
     registry.
9. **Read-only for header-present values (FR-045).** In the `nofilter`
   item's metadata table, confirm header-present fields (exposure 300,
   object NGC 7000) are displayed as data, and the editor path only offered
   value entry for MISSING fields (the bulk editor targeted needs-review /
   missing files; there is no affordance that rewrites an existing header
   value other than the explicit frame-type correction).
   - Expected: no UI control lets you silently change a header-present
     filter/exposure on a file that already has one.
   - FAIL if: an existing header value can be edited in place without the
     explicit reclassify affordance.
10. **Log check.** `read_logs`: no ERROR entries from reclassify;
    each reclassify logged/audited without failures.

Screenshot checkpoints: `S1-reclass-01` (needs-review + bulk controls with
selection), `S1-reclass-02` (post-override metadata table, badges gone).

### Stage 1 verdict

PASS = steps 1–10 pass, including the byte-identity diff in step 6.
Otherwise FAIL with step number, IPC payloads, hash diff, screenshots.

## Stage 2 — Final Claude Desktop pass

1. Walk the same flow by hand at 1100×720: select-all → bulk set → apply.
   Judge: is the needs-review affordance discoverable? Is it clear WHICH
   files an override will hit before clicking apply ("Apply to selected
   (N)" reads correctly)?
2. Error-path UX: with nothing selected, confirm the bulk controls are
   hidden/disabled rather than failing; enter an absurd exposure (e.g. -5)
   and judge the validation/feedback.
3. Theme pass: needs-review warning rows, missing-attr badges, and the
   danger banner in **Warm Slate** and **Espresso** — badges must remain
   readable in both.
4. i18n: bulk labels, placeholders ("unchanged"), pluralized counts, and the
   `needs {attrs}` badge text are catalog strings, no raw keys.
5. Layout: bulk-controls fieldset wraps without overflowing the detail
   panel; action bars pinned; only content scrolls.
6. Sign-off: PASS/FAIL per point + screenshots (two themes); overall PASS
   requires Stage 1 PASS and no unfixed usability defect.
