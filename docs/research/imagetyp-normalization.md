# IMAGETYP Normalization Research

**Spec**: 005-inbox-mixed-folder-split  
**Task**: T0-IMAGETYP-Research  
**Status**: Complete — normalization table shipped in `crates/metadata/core/src/lib.rs`

## Summary

Survey of `IMAGETYP` keyword values emitted by major astrophotography capture software. The normalization table maps raw IMAGETYP strings (case-insensitive) to the `FrameType` enum: `Light`, `Dark`, `Bias`, `Flat`. `DarkFlat` is reserved in v1 (R-DarkFlat-Reserved).

## Software Survey

### NINA (N.I.N.A. Nighttime Imaging 'N' Astronomy)

NINA follows FITS standard closely. Default values:

| Sequence type | IMAGETYP value |
|---|---|
| Light frames | `"Light Frame"` |
| Dark frames | `"Dark Frame"` |
| Bias frames | `"Bias Frame"` |
| Flat frames | `"Flat Frame"` |

### SGP (Sequence Generator Pro)

| Type | IMAGETYP |
|---|---|
| Light | `"Light Frame"` |
| Dark | `"Dark Frame"` |
| Bias / Offset | `"Offset Frame"` or `"Bias Frame"` |
| Flat | `"Flat Frame"` |

SGP historically used `"Offset Frame"` for bias before standardising on `"Bias Frame"`.

### APT (Astro Photography Tool)

| Type | IMAGETYP |
|---|---|
| Light | `"Light Frame"` |
| Dark | `"Dark Frame"` |
| Flat | `"Flat Frame"` |
| Bias | `"Bias Frame"` |

### Voyager (AstroEllio)

| Type | IMAGETYP |
|---|---|
| Light | `"Light Frame"` |
| Dark | `"Dark Frame"` |
| Flat | `"Flat Frame"` |
| Bias | `"Bias Frame"` |

### Ekos / KStars

| Type | IMAGETYP |
|---|---|
| Light | `"Light Frame"` or `"light"` |
| Dark | `"Dark Frame"` or `"dark"` |
| Flat | `"Flat Frame"` or `"flat"` |
| Bias | `"Bias Frame"` or `"bias"` |

### MaximDL

Uses shorter forms:

| Type | IMAGETYP |
|---|---|
| Light | `"Light"` or `"Object"` |
| Dark | `"Dark"` |
| Flat | `"Flat"` |
| Bias | `"Bias"` or `"Zero"` |

`"Object"` is a legacy MaximDL and ACP designation for science/light frames.

### ACP (Astronomer's Control Panel)

| Type | IMAGETYP |
|---|---|
| Science | `"Object"` |
| Dark | `"Dark"` |
| Flat | `"Flat"` |
| Bias | `"Zero"` |

### ASIAIR (ZWO)

| Type | IMAGETYP |
|---|---|
| Light | `"Light Frame"` |
| Dark | `"Dark Frame"` |
| Flat | `"Flat Frame"` |
| Bias | `"Bias Frame"` |

### SharpCap

SharpCap writes `IMAGETYP` per FITS standard for captures designated as calibration:

| Type | IMAGETYP |
|---|---|
| Light | `"Light Frame"` |
| Dark | `"Dark Frame"` |
| Flat | `"Flat Frame"` |
| Bias | `"Bias Frame"` |

### FireCapture

Primarily used for planetary; rarely writes `IMAGETYP`. When present:

| Type | IMAGETYP |
|---|---|
| Any | `"Light Frame"` or absent |

## Normalization Table (v1)

The canonical mapping is implemented in `crates/metadata/core/src/lib.rs` as `v1_normalization_table()`. Keys are compared case-insensitively after trimming whitespace.

### Light / Science frames

| Raw IMAGETYP | Canonical |
|---|---|
| `light` | `Light` |
| `light frame` | `Light` |
| `light frames` | `Light` |
| `science` | `Light` |
| `science frame` | `Light` |
| `science frames` | `Light` |
| `object` | `Light` |

### Dark frames

| Raw IMAGETYP | Canonical |
|---|---|
| `dark` | `Dark` |
| `dark frame` | `Dark` |
| `dark frames` | `Dark` |

### Bias frames

| Raw IMAGETYP | Canonical |
|---|---|
| `bias` | `Bias` |
| `bias frame` | `Bias` |
| `bias frames` | `Bias` |
| `offset` | `Bias` |
| `offset frame` | `Bias` |
| `zero` | `Bias` |

### Flat frames

| Raw IMAGETYP | Canonical |
|---|---|
| `flat` | `Flat` |
| `flat frame` | `Flat` |
| `flat frames` | `Flat` |
| `sky flat` | `Flat` |
| `dawn flat` | `Flat` |
| `dusk flat` | `Flat` |
| `twilight flat` | `Flat` |

## DarkFlat (Reserved — v1)

Values like `"dark flat"`, `"darkflat"`, `"flat dark"` are intentionally absent from the v1 table. Files with these IMAGETYP values land as `unclassified` and must be manually reclassified via `inbox.reclassify`. User-configurable extensions to the mapping are deferred to v1.x (spec 018 follow-up). (Ref: R-DarkFlat-Reserved)

## Decisions

- **Deterministic IMAGETYP-only model**: no confidence scores, no filename heuristics (Ref: R-IMAGETYP, A5)
- **Case-insensitive with whitespace trimming**: covers most real-world variation
- **Unknown values → unclassified**: surfaces as "Needs review" in the UI (Ref: R-FileMarker)
- **Data-driven table**: normalization logic is data, not hardcoded if-chains, for forward extensibility
