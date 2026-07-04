# JOURNEY — ingest calibration frames → masters detected → matched to lights

> End-to-end two-stage journey across Inbox → Sessions → Calibration. This
> is the scenario that proves the catalog surfaces COMPOSE: light frames
> ingested through the Inbox become acquisition sessions; master files are
> detected, registered as individual masters; and the matching engine links
> the two with real session context.
>
> Stage 1: agent via Tauri MCP bridge, real backend, real SQLite, real
> filesystem plans (`VITE_USE_MOCKS=false`). Stage 2: Claude Desktop human
> pass after Stage 1 PASS. Shared mechanics:
> `e2e-agentic-test/AGENT-RUNNER.md`.

## Specs exercised

- 041/005 Inbox universal ingest gate (single-type items, confirm → plan →
  apply), 035 FR-008/FR-016 (OBJECT resolution at ingest; applied lights
  create `acquisition_session` rows), 040 FR-004..007 (master detection →
  individual items → registered on confirm), 007 FR-003/006/007 (dark
  matching rules, ranked candidates, advisory assign), 043 §4 surfaces.
- PRs required on the deployed branch: #391, #395 (merged 2026-07-04);
  #415 only for the Sessions-parity assertions in Phase 3 (mark those
  BLOCKED if unmerged, continue the journey).

## Fixture recipe — controlled matched set (inline generator)

A fingerprint-controlled set where matching is DESIGNED to succeed for one
master and fail for another. Save as
`C:\dev\astro-plan\test-data\gen-matched-set.py` and run with
`python gen-matched-set.py` (pure stdlib; writes tiny valid FITS):

```python
import os, struct
OUT = r"C:\dev\astro-plan\test-data\matched-set"
def card(k, v, c=""):
    kw = k.upper().ljust(8)[:8]
    if isinstance(v, bool): s = f"{'T' if v else 'F':>20}"
    elif isinstance(v, int): s = f"{v:>20}"
    elif isinstance(v, float): s = f"{v:>20.6f}"
    else: s = f"'{str(v):<18}'"
    return (f"{kw}= {s}" + (f" / {c}" if c else "")).ljust(80)[:80].encode()
def fits(path, cards):
    hdr = [card("SIMPLE", True), card("BITPIX", 16), card("NAXIS", 2),
           card("NAXIS1", 4), card("NAXIS2", 4)] + cards + [b"END".ljust(80)]
    h = b"".join(hdr); h += b" " * (2880 - len(h) % 2880)
    data = struct.pack(">16h", *([100] * 16)); data += b"\0" * (2880 - len(data))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f: f.write(h + data)
CAM = [card("INSTRUME", "ZWO ASI2600MM Pro"), card("GAIN", 100),
       card("OFFSET", 50), card("XBINNING", 1), card("YBINNING", 1),
       card("CCD-TEMP", -10.0)]
NIGHT = "2026-01-15"
# 3 matched Ha lights of M 42 (one session: same target/filter/night)
for i in range(3):
    fits(rf"{OUT}\lights-m42\light_ha_{i:04}.fits",
         [card("IMAGETYP", "LIGHT"), card("OBJECT", "M 42"),
          card("FILTER", "Ha"), card("EXPTIME", 120.0),
          card("DATE-OBS", f"{NIGHT}T22:0{i}:00")] + CAM)
# 2 offset-divergent OIII lights of NGC 7000 (offset 10, for the #395 check)
for i in range(2):
    fits(rf"{OUT}\lights-ngc7000\light_oiii_{i:04}.fits",
         [card("IMAGETYP", "LIGHT"), card("OBJECT", "NGC 7000"),
          card("FILTER", "OIII"), card("EXPTIME", 120.0),
          card("DATE-OBS", f"{NIGHT}T23:0{i}:00"),
          card("INSTRUME", "ZWO ASI2600MM Pro"), card("GAIN", 100),
          card("OFFSET", 10), card("XBINNING", 1), card("YBINNING", 1),
          card("CCD-TEMP", -10.0)])
# masters: matched dark / MISMATCH dark (gain 200) / flat Ha / bias
fits(rf"{OUT}\masters\masterDark_120s_gain100.fits",
     [card("IMAGETYP", "Master Dark"), card("EXPTIME", 120.0),
      card("DATE-OBS", f"{NIGHT}T12:00:00")] + CAM)
fits(rf"{OUT}\masters\masterDark_120s_gain200_MISMATCH.fits",
     [card("IMAGETYP", "Master Dark"), card("EXPTIME", 120.0),
      card("DATE-OBS", f"{NIGHT}T12:05:00"),
      card("INSTRUME", "ZWO ASI2600MM Pro"), card("GAIN", 200),
      card("OFFSET", 50), card("XBINNING", 1), card("YBINNING", 1),
      card("CCD-TEMP", -10.0)])
fits(rf"{OUT}\masters\masterFlat_Ha.fits",
     [card("IMAGETYP", "Master Flat"), card("FILTER", "Ha"),
      card("EXPTIME", 1.5), card("DATE-OBS", f"{NIGHT}T18:00:00")] + CAM)
fits(rf"{OUT}\masters\masterBias.fits",
     [card("IMAGETYP", "Master Bias"),
      card("DATE-OBS", f"{NIGHT}T12:10:00")] + CAM)
print("wrote", OUT)
```

Design intent (assert against this table):

| Item | Fingerprint | Journey expectation |
| --- | --- | --- |
| `lights-m42` (3×) | Ha · 120 s · gain 100 · offset 50 · −10 °C · 1×1 | 1 session: M 42 · Ha · 2026-01-15 · 3 frames |
| `lights-ngc7000` (2×) | OIII · 120 s · gain 100 · **offset 10** | 1 session; dark-candidate only when `requireSameOffset` is OFF |
| `masterDark_120s_gain100` | matches lights exactly | top-ranked dark candidate for the M 42 session |
| `masterDark_…gain200_MISMATCH` | gain differs (hard rule FR-003) | no clean match / explicit gain mismatch |
| `masterFlat_Ha` | filter Ha (FR-004) | flat candidate for the Ha session (or observer-location-missing state) |
| `masterBias` | gain/offset match (FR-005) | bias candidate for both sessions |

## Preconditions

1. Branch `redesign-ui-platevault` deployed, **forced Rust rebuild** (this
   journey is backend-critical; see AGENT-RUNNER.md recompile trap).
2. Fresh DB. First-run setup registering:
   - Light frames root: `C:\dev\astro-plan\test-data\library-lights`
     (create empty — ingest destination),
   - Calibration root: `C:\dev\astro-plan\test-data\library-calibration`
     (create empty),
   - Inbox root: `C:\dev\astro-plan\test-data\inbox`,
   - Projects: any folder.
3. Run the generator above, then stage the fixtures into the inbox:
   ```powershell
   Copy-Item C:\dev\astro-plan\test-data\matched-set\* C:\dev\astro-plan\test-data\inbox\ -Recurse
   ```
4. Bridge connected; IPC capture on.

## Stage 1 — Agent validation via Tauri MCP

### Phase 1 — Ingest lights → sessions appear

1. **Inbox**: select the inbox root, scan (`inbox_scan_folder`). Expect
   items for `lights-m42` (light, 3 files, target M 42 recommended via
   OBJECT→resolution, spec 035 FR-008), `lights-ngc7000` (light, 2 files),
   and the 4 master files as INDIVIDUAL items.
2. Confirm + apply the TWO light items (destination: the Light frames
   root). All `inbox_confirm` / `inbox_plan_apply*` Ok; files physically
   moved under `library-lights` (verify with
   `Test-Path`/`Get-ChildItem -Recurse` count = 5).
3. **Sessions**: two sessions exist (spec 035 FR-016) — M 42 · Ha · 3
   frames and NGC 7000 · OIII · 2 frames, night 2026-01-15, camera `ZWO
   ASI2600MM Pro`. 📸 checkpoint.
4. **Targets**: M 42 and NGC 7000 now exist as canonical targets (created
   by ingest resolution); selecting M 42 shows the ingested session in the
   detail pane's Sessions column (positive-path for the 023 scenario's
   Test 6).
FAIL if: light items don't classify, apply fails (`source.missing` — see
memory `spec-041-apply-rootid-gen3`), sessions missing/misgrouped, or
targets not created/linked.

### Phase 2 — Ingest masters → detected + registered

5. Back to **Inbox** (rescan if needed): the 4 master files are individual
   items with detected kinds (Master Dark ×2, Master Flat with filter Ha,
   Master Bias — spec 040 FR-004/005/006).
6. Confirm + apply all 4 (destination: the Calibration root).
7. **Calibration**: 4 rows — DARK 120s (×2), FLAT Ha, BIAS — with
   fingerprint columns matching the table above (gain 100 vs 200 visible,
   temp −10 °C, binning 1×1). 📸 checkpoint.
FAIL if: masters folder-aggregated, kinds wrong, fingerprints diverge from
the controlled headers.

### Phase 3 — Match masters to lights

8. Select `masterDark_120s_gain100`: suggest status `match` (or
   `ambiguous` — record); the TOP candidate is the M 42 session showing
   Target `M 42` · Filter `Ha` · Night `2026-01-15` · Frames `3`
   (PR #391 context columns, real values). The NGC 7000 session must NOT
   be a clean candidate while `requireSameOffset` is ON (offset 10 ≠ 50).
9. Select the gain-200 MISMATCH dark: no clean match to either session;
   any surfaced candidate carries an explicit gain `mismatch-<dimension>`
   chip (FR-012).
10. Select `masterFlat_Ha`: candidate is the Ha (M 42) session, or the
    documented `observer_location_missing` state — record which; the OIII
    session must not out-rank the Ha session (FR-004 filter exact).
11. Assign the matched dark to the M 42 session (assign → confirm →
    `calibration_match_assign` Ok). Usage now "1 session"; the Sessions
    detail for M 42's session reflects the assignment where surfaced.
12. Offset-rule composition (#395): Settings → Calibration matching → turn
    `requireSameOffset` OFF → re-suggest on the matched dark → the
    NGC 7000 session (offset 10) now appears as a candidate (possibly
    penalized). Turn it back ON → candidate disappears again. Capture both
    suggest responses.
FAIL if: any step's inline expectation breaks — most critically: context
columns all `—` (#391 regression), the mismatch dark matching cleanly, or
the offset toggle having no effect on candidates (#395 engine wiring).

### Phase 4 — Durability

13. Restart the app. Sessions (2), masters (4), the assignment (usage
    "1 session"), and the tolerance setting all survive (SQLite is the
    durable record).
FAIL if: anything reverts after restart.

**Stage 1 verdict**: PASS = Phases 1–4 green + `read_logs` shows no
unexplained ERROR entries across the whole journey.

## Stage 2 — Final Claude Desktop pass (only after Stage 1 PASS)

Re-walk the journey visually at 1100×720, Warm Slate AND Observatory:

1. **Narrative coherence**: does the app TELL the story — inbox items say
   what they'll become; after apply, is it obvious where things went
   (sessions vs calibration)? Judge cross-page continuity (target name
   identical in Inbox recommendation, Sessions row, Targets page,
   candidate row).
2. **Plan-approval overlay**: the move plan is reviewable before apply
   (constitution: reviewable filesystem mutation) — destination paths
   readable, per-file outcomes visible after apply.
3. **Matching comprehension**: with both darks in the table, can a user
   tell WHY one matches and one doesn't without reading logs? (mismatch
   chips + confidence).
4. **Pinned bars / scroll discipline** on every page touched; no raw i18n
   keys anywhere along the path.
5. Sign-off with a screenshot storyboard: inbox classified → plan overlay →
   sessions list → masters table → match panel → assigned usage.

## Verdict rubric

- **PASS**: all four Stage 1 phases + Stage 2 storyboard signed off.
- **FAIL**: any composition break (ingest not producing sessions, masters
  not registered, matching blind to the controlled fingerprints,
  durability loss after restart).
- Report per phase PASS/FAIL + the verbatim suggest responses from steps
  8, 9, 12 (both toggle states) and the applied-plan file counts.
