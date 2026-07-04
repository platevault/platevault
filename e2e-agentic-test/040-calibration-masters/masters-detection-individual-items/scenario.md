# Calibration — masters detection + individual master items

> Two-stage verification plan for spec 040 (calibration masters detection)
> against the real Windows app. Stage 1: agent via Tauri MCP bridge.
> Stage 2: Claude Desktop human pass after Stage 1 PASS. Real backend
> required (`VITE_USE_MOCKS=false`).
> Shared mechanics: `e2e-agentic-test/AGENT-RUNNER.md`.

## Feature facts (context)

- Spec 040 FRs:
  - FR-001/FR-002: extensible `master-detect` crate with `PixInsightDetector`
    (WBPP writes "Master" INTO `IMAGETYP`, e.g. `Master Dark`) and
    `SirilDetector` (base `IMAGETYP` + `STACKCNT`/`NCOMBINE` > 1 or
    `_stacked`/`master` in the file name/path). First detector match wins.
  - FR-004: inbox `inbox_classify` uses `detect_master` for base type +
    master status.
  - FR-005: masters are emitted as INDIVIDUAL inbox items (not folder
    aggregates), keyed by content.
  - FR-006: inbox list shows masters individually with type + filter.
  - FR-007: on confirm, masters register into the calibration masters store.
- Calibration page (spec 043 §4 redesign): full-width sortable MastersTable;
  only kinds dark/flat/bias are shown (v1 FR-001 of the page — `dark_flat` /
  `bad_pixel_map` never appear); columns Master · Camera · Filter · Gain ·
  Exposure · Temp · Binning · Usage · Date. Filter column only meaningful
  for FLATS, Exposure only for DARKS — others render `—` BY DESIGN.
- IPC: `calibration_masters_list` () → `CalibrationMaster[]` (kind,
  fingerprint{camera,filter,gain,exposureS,tempC,binning}, ageDays,
  usedBySessionIds, usedByProjectIds, createdAt); `calibration_masters_get`.
- Testids: `masters-loading`, `masters-error`, `masters-empty`,
  `master-usage-<id>`, `calibration-group-<dimension>-<key>`.
- PRs #391/#395 are MERGED (2026-07-04); verify the deployed branch tip
  includes them (`git log --oneline | head` on the Windows checkout should
  postdate them or contain the merge commits).

## Fixture recipe — synthetic FITS with controlled headers

Run the repo's generator (tiny 4×4-pixel valid FITS, headers modeled on
`docs/development/077-fits-header-analysis.md`) in the WINDOWS checkout:

```powershell
cd C:\dev\astro-plan
python scripts\gen-mock-fits.py --output-dir C:\dev\astro-plan\test-data\mock-fits-library
```

Relevant generated master fixtures (exact paths):

| File (under `test-data\mock-fits-library\master\`) | Detector signal | Expected detection |
| --- | --- | --- |
| `dark\wbpp-poseidon\masterDark_BIN-1_EXPOSURE-120.00s_GAIN-0.fits` | `IMAGETYP='Master Dark'` | pixinsight → dark, master |
| `dark\wbpp-dwarf3\masterDark_BIN-1_4x4_EXPOSURE-120.00s.fits` | `IMAGETYP='Master Dark'` | pixinsight → dark, master |
| `dark\stripped\dark_exp_120.000000_gain_60_bin_1_44C_stack_9.fits` | stripped header, name-only | detection depends on path/name heuristics — see Test 2 |
| `bias\wbpp-zwo\masterBias_BIN-1_GAIN-0.fits` | `IMAGETYP='Master Bias'` | pixinsight → bias, master |
| `flat\nina-poseidon\master_flat_lum_gain125.fits` | name contains `master` + base `IMAGETYP` | siril/pixinsight → flat, master |
| `light\asideepstack-zwo\Light_AutoSave_Stack.fits` | `IMAGETYP='LIGHT'` + `STACKCNT=9` | siril → light, master (a MASTER LIGHT — must NOT appear on the Calibration page) |

Also generated: plain sub-frames under `dark\`, `flat\`, `bias\`, `light\`
(NO master markers) — negative controls.

For a fingerprint-controlled matched set (used by the matching + journey
scenarios), see the inline generator in
`e2e-agentic-test/journeys/calibration-journey-ingest-to-match/scenario.md`.

## Preconditions

1. Branch `redesign-ui-platevault` deployed; **Rust rebuild forced** after
   reset (detection is backend — the recompile trap WILL produce false
   results otherwise; see AGENT-RUNNER.md).
2. Fresh DB; complete first-run setup registering:
   - Light frames: `C:\dev\astro-plan\test-data\raw-lights` (any folder),
   - Inbox: `C:\dev\astro-plan\test-data\inbox` (create it first),
   - Projects: any folder.
3. Generate fixtures (recipe above), then copy the master folder into the
   inbox source:
   ```powershell
   Copy-Item C:\dev\astro-plan\test-data\mock-fits-library\master C:\dev\astro-plan\test-data\inbox\masters -Recurse
   ```
4. Bridge connected; IPC capture on.

## Stage 1 — Agent validation via Tauri MCP

### Test 1 — Empty state before ingest

1. Navigate to **Calibration** before scanning the inbox.
Expected: `masters-empty` testid with localized empty copy — NOT an error,
NOT a spinner stuck on `masters-loading`. `calibration_masters_list`
returned `[]`.
FAIL if: error state or phantom masters in a fresh DB.

### Test 2 — Inbox classify emits INDIVIDUAL master items (FR-004/005/006)

1. Go to **Inbox**, select the inbox root (`inbox-root-picker` /
   `inbox-root-option-<rootId>` if multiple), trigger the scan (invokes
   `inbox_scan_folder`), wait for items.
2. Read the inbox list (`inbox-list`): locate the items originating from
   `masters\…`.
Expected:
- Each master FILE is its own item (FR-005) — e.g. the two WBPP darks, the
  bias, and the flat appear as separate single-file items, NOT one folder
  item labelled "4 files".
- Each master item shows its detected type (dark/bias/flat) and, for the
  flat, its filter (FR-006).
- The `STACKCNT=9` stacked LIGHT is detected as a master LIGHT (record how
  the Inbox presents it — master-light handling is documented, but it must
  NOT later appear on the Calibration page).
- Negative controls: plain sub-frame folders classify as ordinary
  dark/flat/bias/light folder items with NO master marker.
- The stripped dark (`dark_exp_...stack_9.fits`, no IMAGETYP): record the
  observed classification verbatim. Path/name heuristics may or may not
  claim it — either a master-dark detection or an
  unclassified/needs-review state is acceptable; a MISclassification (e.g.
  "light") is a FAIL.
- 📸 inbox list with master items visible.
FAIL if: masters are aggregated into one folder item, types are wrong, or
scan errors.

### Test 3 — Confirm registers masters into the calibration store (FR-007)

1. For each master item (dark ×2, bias ×1, flat ×1): select it, complete the
   confirm flow (`inbox-confirm-btn`; pick the destination root in
   `inbox-dest-root-select` if prompted), then apply the resulting plan via
   the plan overlay (`plan-approval-overlay` → `plan-apply-one-<id>` or
   `plan-apply-all`).
2. Capture the `inbox_confirm` / `inbox_plan_apply*` IPC results (all Ok).
3. Navigate to **Calibration**.
Expected:
- `calibration_masters_list` now returns the registered masters; the table
  shows one ROW PER MASTER FILE (individual items — count matches the
  number of confirmed master files, NOT one row per folder).
- Kind pills DARK/BIAS/FLAT render; the master LIGHT is ABSENT (only
  dark/flat/bias shown, page FR-001).
- Fingerprint columns show real header values where present: the WBPP
  poseidon dark row shows Exposure `120s`; the flat row shows its filter;
  Camera/Gain/Binning populated when the header carried them; absent values
  render `—`.
- 📸 masters table.
FAIL if: masters missing after apply, folder-level rows, master light
listed, or fingerprint values contradict the known fixture headers.

### Test 4 — Sort, kind filter, grouping on the masters table

1. Kind filter dropdown (appears when >1 kind present): select `dark` → only
   dark rows. Reset to all kinds.
2. Click the **Exposure** header asc: darks order by exposure; flats/bias
   (`—`) sort to one end consistently.
3. Group by **Kind**: `calibration-group-kind-<key>` headers with counts;
   collapse/expand works; clear grouping restores flat.
Expected: as inline.
FAIL if: filter leaves wrong kinds, sort throws on `—` cells, grouping
headers missing.

### Test 5 — Master detail loads real data

1. Select the WBPP poseidon dark row.
Expected: MasterDetail opens; `calibration_masters_get` fires with the row
id; properties (kind, size, created, fingerprint) match the list row;
usage shows "unused" (`master-usage-<id>`); the compatible-sessions panel
renders (its behavior is covered by the matching scenario).
FAIL if: detail errors or shows a different master than selected.

**Stage 1 verdict**: PASS = Tests 1–5 green + no unexplained ERROR logs.
Record the verbatim classification result for the stripped-header dark
(Test 2) — it feeds the detector-heuristics backlog either way.

## Stage 2 — Final Claude Desktop pass (only after Stage 1 PASS)

Window 1100×720; Warm Slate + Observatory themes.

1. **Table honesty**: `—` in Filter (darks/bias) and Exposure (flats/bias)
   reads as "not applicable", not as missing data — judge whether the
   kind-conditional columns confuse.
2. **Kind pills**: DARK/FLAT/BIAS pill colors distinguishable in both
   themes; aging pill (if any master exceeds the aging threshold) legible.
3. **Layout**: top bar pinned, only the table scrolls; detail pane opens
   without pushing the bar; no horizontal scroll at 1100×720.
4. **Inbox presentation**: individual master items read clearly as "1 file,
   a master" vs sub-frame folder items ("N files") — judge scanability.
5. **i18n**: empty state, pills, tooltips — no raw keys.
6. Sign-off with screenshots (inbox master items, masters table both themes,
   detail open).

## Verdict rubric

- **PASS**: Stage 1 green + Stage 2 signed off.
- **FAIL**: detection misclassifications, folder-aggregated masters,
  master lights on the Calibration page, confirm not registering masters,
  layout/i18n violations.
- Report per test PASS/FAIL + verbatim `inbox_classify` /
  `calibration_masters_list` payload excerpts for the fixture files.
