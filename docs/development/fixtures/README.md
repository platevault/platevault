# Master / frame-type detection fixture library (spec 040)

A comprehensive, **realistically-named** FITS fixture set for exercising the
PlateVault master/frame-type detector across every permutation. Built for
issues **#514** (detection coverage) and **#513** (scan-preview display).

Generator: `gen_detection_matrix.py` → writes the tree + `manifest.json`
(machine-readable expected results). No dependencies (pure-Python raw FITS).

> Naming is deliberately realistic (target / date / filter folders, capture- and
> WBPP/Siril-style filenames) — NOT `sub/top.fits`. The scan preview and any
> folder-name display must render these correctly (that's part of #513).

## Detection model under test (header-FIRST)

- **Frame type** = `IMAGETYP` via `parse_frame_type`. PixInsight infers type
  from the path ONLY when `IMAGETYP` is absent AND the path signals a master.
  Siril requires `IMAGETYP`. A **raw frame with no `IMAGETYP` is unclassifiable**
  (this is the real cause behind #513's "missing darks").
- **is_master** = `IMAGETYP` contains "master" (PI) OR `STACKCNT`/`NCOMBINE` > 1
  (Siril) OR file name / path contains "master" or "_stacked" (fallback).

## Permutation coverage (19 fixtures)

| Type | raw (header) | master (Siril STACKCNT) | master (PI IMAGETYP) | master (path fallback) |
|------|:---:|:---:|:---:|:---:|
| Light | ✓ | ✓ (integration) | — | — |
| Dark | ✓ | ✓ | ✓ | ✓ |
| Flat | ✓ | ✓ | ✓ | ✓ (`_stacked`) |
| Bias | ✓ | ✓ (`OFFSET`→Bias) | ✓ | — |
| DarkFlat | ✓ | — | ✓ | — |

Plus:
- **Header-vs-name conflict** (header type MUST win): `IMAGETYP='DARK'` named
  `masterFlat…` → Dark + master; `IMAGETYP='BIAS'` named `light…` → Bias, not master.
- **Negative / unclassified**: no `IMAGETYP` + non-master name
  (`dark_stack_9_noheader.fits`) → unclassified — reproduces the exact fixture
  shape that hid in #513.

Every file's expected `(frame_type, is_master, evidence)` is in `manifest.json`.

## How to run

```sh
# From WSL, target the Windows test drive (never register D:\astrophotography itself):
python3 gen_detection_matrix.py "/mnt/d/astrophotography/ALM test/DetectionMatrix"
```

## RETRY / verification procedure (fixes to run — see handover)

The calibration/master-detection verification in the 2026-07-09 run was done with
**inadequate fixtures** (the real `Darks/` are stacked masters with STRIPPED
headers — no `IMAGETYP` — so they were unclassifiable and hid from the scan
preview, which looked like a bug but was a fixture problem). **Re-run with this
library:**

1. Generate the tree (command above).
2. Register the relevant roots via the wizard or `roots_register`
   (e.g. `…\DetectionMatrix\Lights`, `…\Calibration`), scan, and compare the
   scan/ingest classification against `manifest.json`.
3. Confirm **header-first**: the two `Conflicts/…` files classify by header
   (Dark / Bias), not by their misleading names.
4. Confirm the **path fallback** masters (no header) are detected as masters.
5. Re-check the scan preview against #513 — counts should reconcile with detected
   types once masters/unclassified are surfaced; the root row should be named.
6. Feed the gaps in #514 (bias raw, bias-master-STACKCNT, darkflat, path-based,
   conflict, master lights) into real unit/integration tests using these headers.

Do NOT commit the generated FITS (binary, ~110 KB each × 19); commit only the
generator + this README + `manifest.json` is regenerated on run.
