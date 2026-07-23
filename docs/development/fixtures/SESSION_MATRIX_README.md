# Session + calibration-matching fixture library (SessionMatrix)

A realistically-named FITS/XISF fixture set for exercising the two pipeline
stages *after* frame-type detection: **light-session grouping** and
**calibration matching**. Sibling of `gen_detection_matrix.py` (which covers
frame-type / master *detection*).

Generator: `gen_session_matrix.py` → writes the tree + `manifest.json` (the
machine-readable answer key). Pure Python 3 stdlib, no dependencies. Header
values follow `docs/development/077-fits-header-analysis.md`.

> Do NOT commit the generated binaries (FITS/XISF, ~100 files). Commit only the
> generator + this README. `manifest.json` is regenerated on every run.

## How to run

```sh
# From WSL, target the Windows test drive (never register the drive root itself):
python3 gen_session_matrix.py "/mnt/d/astrophotography/ALM test/SessionMatrix"
```

Idempotent: the `SessionMatrix` subtree is wiped and rebuilt each run (the
generator refuses any output path not named `SessionMatrix`, and never touches
the parent `ALM test/` dir). It self-verifies three re-read files and prints a
per-group count summary. Current output: **102 fixtures**.

## Session model under test

A light session is FIXED on five key fields:

```
object | filter | binning | gain | observing_night
```

plus camera and offset (also fixed within a session, but NOT part of the
canonical grouping key). **Only sensor temperature drifts within a session** (a
few tenths of a degree around the set point). `observing_night` is derived from
`DATE-LOC` (evening local ~22:00 → same calendar date); `DATE-OBS` is UTC.

### Rigs

| Rig | Camera / optic | FOCALLEN | XPIXSZ | Sensor | Header profile | Notes |
|-----|----------------|---------:|-------:|--------|----------------|-------|
| R1 | ZWO ASI2600MM Pro / APO 120 | 840 | 3.76 | mono | full NINA | no BAYERPAT, `EGAIN 0.24`, site 25.077/55.120/3 |
| R2 | Poseidon-C PRO / Celestron C925 HS | 525 | 3.76 | OSC (RGGB) | full NINA | site 24.839/55.383/101 |
| R3 | DWARF 3 / DWARF 3 | 150 | 2.0 | OSC (RGGB) | sparse DwarfLab | no IMAGETYP / FILTER, `DET-TEMP` not SET/CCD, GAIN=index, `ORIGIN=DWARFLAB` |

Gain / offset / temperature are deliberately **mixed across camera blocks**, not
fixed per camera.

### Session matrix (lights)

| Block | Session key (`object|filter|bin|gain|night`) | Subs | Expectation |
|-------|-----------------------------------------------|-----:|-------------|
| **S0** (base) | `M 51|L|1|100|2025-05-03` | 8 + 2 | R1, offset 50, set −10 (CCD drift −10.0/−9.6/−10.4…), EXPTIME 300, ROTATANG 90 |
| MUST-NOT-SPLIT | *(same key as S0)* | — | 8 temp-drift subs **+ 2 subs at EXPTIME 300.4** (sub-1s bucket) group WITH S0 |
| split: filter=R | `M 51|R|1|100|2025-05-03` | 4 | separate session |
| split: gain=0 | `M 51|L|1|0|2025-05-03` | 4 | separate session |
| split: bin=2 | `M 51|L|2|100|2025-05-03` | 4 | separate session |
| split: night=N2 | `M 51|L|1|100|2025-05-10` | 4 | separate session |
| split: target=M 16 | `M 16|L|1|100|2025-05-03` | 4 | separate session |
| LRGB night | `M 51|{L,R,G,B}|1|100|2025-05-03` | 4 ea. | **4 distinct filter sessions** (L == S0, R == the filter-R split; G, B are new) |
| **Sx** cross-camera | `M 51|L|1|100|2025-05-03` (== S0) | 4 | R2. **Ambiguous**: canonical key ignores camera → same session as S0; inbox grouping splits on optic_train (R2 optic ≠ R1). Both recorded; see `note`. |
| cross-rig R2/OSC | `M 16|LUM|1|0|2025-05-03` | 4 | R2, offset 20, set −20 |
| cross-rig R3/DWARF | `NGC 2264||1|60|2025-05-03` | 4 | DWARF, GAIN index 60, DET-TEMP 30, sparse → **frame type UNCLASSIFIED** (no IMAGETYP) |

Each MUST-SPLIT sibling changes **exactly one** key field vs S0 (verified in the
self-test). The LRGB "L" and "R" sessions are intentionally the same sessions as
S0 and the filter-R split (the night has four filter-sessions total); G and B are
new. This keeps the key-space unambiguous while still demonstrating 4 sessions.

## Calibration matrix

Matcher rules under test:

- **dark / bias** HARD = `gain` + `offset` exact; **dark** SOFT = exposure, temperature.
- **flat** HARD = `filter` + `binning` + `optic_train` + `gain`; SOFT = rotation, night.
- **darkflat** never matched (v1).

For R1 (gain 100, offset 50, bin 1) each calibration type emits a **raw sub-set**
(full headers, extensions woven `.fits`/`.fit`/`.fts`) and masters in every
flavor:

| Flavor | Format | Master signal |
|--------|--------|---------------|
| `STACKCNT-FITS` | FITS | base IMAGETYP + `STACKCNT=30` |
| `NCOMBINE-FITS` | FITS | base IMAGETYP + `NCOMBINE=25` |
| `MASTER-IMAGETYP-FITS` | FITS | `IMAGETYP='Master X'` |
| `REAL-XISF` | XISF | `IMAGETYP='Master X'`; **FOCALLEN keyword omitted** — focal length carried as `<Property id="Instrument:Telescope:FocalLength">` in **metres** (0.840 → 840 mm) to exercise the metres→mm path; `<Property id="Image:PixelSize">` in µm |
| `STRIPPED-FILENAME-FITS` | FITS | structural-only header; all metadata in the filename |

The type's **match** master is emitted in all five flavors; soft/excluded
variants use one flavor (`MASTER-IMAGETYP-FITS`).

| Type | Variant | Params vs S0 | Verdict |
|------|---------|--------------|---------|
| Dark | D_match (×5 flavors) | set −10, EXPTIME 300 | `match` (vs S0) |
| Dark | D_temp | set −20 | `soft:temperature` |
| Dark | D_exp | EXPTIME 330 (+10%) | `soft:exposure` |
| Dark | D_gain | gain 0 | `excluded:gain` |
| Dark | D_offset | offset 20 | `excluded:offset` |
| Bias | Bias_match (×5 flavors) | gain 100, offset 50, EXPTIME 0 | `match` |
| Bias | Bias_gainfail | gain 0 | `excluded:gain` |
| Flat | L (×5 flavors) | filter L, ROTATANG 90 | `match` (vs L/S0 session) |
| Flat | R, G, B | matching filter | `match` (vs R/G/B session) |
| Flat | Flat_rot | ROTATANG 92 (Δ 2 > 0.5) | `soft:rotation` |
| Flat | Flat_wrongfilter | filter Ha for an L session | `excluded:filter` |
| DarkFlat | one master | — | never suggested/matched (`expected_matches: []`) |

## Directory layout

```
SessionMatrix/
  Lights/{object}/{night}/{filter}/{stem}_{i}.fits
  Calibration/{Type}s/{rig}/{night}/{stem}_{i}.{fits,fit,fts}   # raw sub-sets
  Calibration/Masters/{rig}/{Type}/{flavor-stem}.{fits,xisf}    # masters
  manifest.json
```

Light stems embed rig + offset (`M 51_R1_L_300s_gain100_bin1_off50_2025-05-03_000.fits`)
so sessions sharing a folder (S0 and the cross-camera Sx) never overwrite each
other. Master extension follows the flavor (`.xisf` for REAL-XISF, else `.fits`).

## `manifest.json` schema

Array of objects, one per file:

| Field | Meaning |
|-------|---------|
| `path` | relative to `SessionMatrix/` |
| `format` | `"fits"` \| `"xisf"` |
| `profile` | `"nina"` \| `"dwarflab"` \| `"pixinsight"` \| `"stripped"` |
| `master_flavor` | flavor name, or `null` |
| `fields` | all emitted metadata (domain field → string/number) |
| `expected_frame_type` | `Light`/`Dark`/`Flat`/`Bias`/`DarkFlat`, or `null` (unclassified) |
| `expected_is_master` | bool |
| `expected_session_group` | `"object|filter|binning|gain|night"` for lights, else `null` |
| `expected_matches` | `[{session, verdict}]` for masters, else `[]` |
| `group` | coarse label for the count summary (e.g. `light:S0`, `master:Dark`) |
| `note` | present only where an ambiguity/caveat is recorded |

## Self-verification

After generating, the script re-reads three files with a minimal built-in parser
and asserts they match the manifest:

- a full-header FITS light — `IMAGETYP`, `GAIN`, `OFFSET`, `SET-TEMP`, `RA`;
- the REAL-XISF D_match — `XISF0100` signature, u32-LE length == actual XML byte
  length, `dataOffset == 16 + len(xml)`, `IMAGETYP='Master Dark'`, the
  FocalLength Property (0.840), and absence of a FOCALLEN keyword;
- a stripped FITS master — structural-only header, metadata only in the filename.

All checks must pass or the run exits non-zero.

## Deviations / caveats (recorded honestly)

- **Directory plurals** use readable English (`Darks`, `Biases`, `Flats`,
  `DarkFlats`) rather than a literal `{Type}s` (`Biass`). Consumers read manifest
  paths, so spelling is cosmetic.
- **Stripped masters carry no `offset`** (real internal masters encode only
  gain/exposure/temperature/binning/stack in the filename). Their manifest
  `fields.offset` is `null` and a `note` flags it; the verdict is still recorded
  as `match` per the matrix, so the harness can decide how strict offset matching
  should be for stripped inputs.
- **D_exp is +10%** exposure yet labelled `soft:exposure` (the matrix's stated
  expectation) even though the dark SOFT window is ±5% — the manifest records the
  intended verdict; use it to pin the desired behaviour.
- **Sx canonical-key collision with S0 is intentional** — it is the fixture for
  the camera-vs-optic-train grouping ambiguity, recorded in both the shared
  `expected_session_group` and a `note`.
