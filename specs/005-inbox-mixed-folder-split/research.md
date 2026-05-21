# Research: Inbox Mixed-Folder Split

**Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)
**Date**: 2026-05-20

## Scope

Decide how to classify folder contents as `single-type`, `mixed`, or
`unclassified`; what evidence is authoritative; how confidence is computed;
and how prior art handles the same problem. Output recommendations feed the
classifier crate boundary defined in plan.md.

## Frame-Type Signals

### Primary: FITS `IMAGETYP` Header

The FITS standard (NASA HEASARC TPV/IMAGETYP convention; also used by
SBIG, ASCOM, NINA, KStars/EKOS, ZWO ASIAIR, and most modern capture
software) sets `IMAGETYP` to one of:

- `Light Frame` / `LIGHT` / `OBJECT` — science frames
- `Dark Frame` / `DARK`
- `Bias Frame` / `BIAS` / `Zero`
- `Flat Frame` / `FLAT`
- `Dark Flat` / `FLATDARK` / `DARK FLAT`

**Normalization**: The classifier MUST normalize case, whitespace, and the
common variants (`LIGHT` ↔ `Light Frame`) before consensus. A canonical
mapping table lives in `crates/metadata/core`.

**Trust level**: High. When `IMAGETYP` is present and recognized, it is
the authoritative signal.

### Secondary: XISF Property Equivalents

XISF carries the same intent under `Observation:Type` or in
`FITSKeyword IMAGETYP` properties. PixInsight writes both. The adapter
crate `crates/metadata/xisf` SHALL surface the same `FrameType` enum from
either source.

### Tertiary: Filename Heuristics

Capture software frequently writes filenames like:

- NINA: `LIGHT_M31_300s_Ha_001.fits`, `DARK_300s_001.fits`
- ASIAIR: `Light_M31_..._Ha_001.fit`, `Bias_..._001.fit`
- Sequence Generator Pro: `M31_Light_Ha_001.fit`
- PixInsight WBPP outputs: `*_l_cc.xisf`, `*_d.xisf`, `*_f.xisf`

**Trust level**: Low. Used only when `IMAGETYP` is missing or unreadable.
Filename evidence reduces confidence (see thresholds below) and never
overrides a header signal.

### Anti-Signal: `FILTER`

`FILTER` is **not** a frame-type discriminator. Filter diversity within a
single frame type is a separate concern. The "is mixed filter mixed?"
question is left as a `[NEEDS DECISION]` in spec.md.

## Confidence Thresholds (Default Proposal)

Per-file confidence:

| Evidence | Confidence |
|---|---|
| `IMAGETYP` recognized and normalized | 1.0 |
| `IMAGETYP` present but non-standard | 0.7 |
| Filename matches strict capture-software pattern | 0.6 |
| Filename matches loose substring | 0.3 |
| Nothing | 0.0 (unclassified) |

Per-folder consensus:

- A folder is `single-type T` if the share of files with `frame_type == T`
  AND confidence ≥ 0.6 is ≥ 95%, **and** every other recognized frame
  type appears in < 2 files (absorbs occasional rogue files into
  "Needs review" rather than triggering a split).
- A folder is `mixed` if two or more recognized frame types each appear
  in ≥ 2 files with confidence ≥ 0.6.
- Otherwise the folder is `unclassified` and confirmation is blocked.

These thresholds are **defaults** and MUST be validated against the
fixture corpus before being frozen. Per spec FR-001 they are configurable
at the library level.

## Ambiguity Surfacing

Files with confidence < 0.6 are surfaced in a "Needs review" group in
the UI breakdown. They are not counted toward consensus and are not
auto-assigned to any frame type. They block direct Inventory confirmation
the same way a `mixed` classification does, but they do **not** force a
split plan — a separate "Resolve unclassified" affordance is required.
[NEEDS DECISION: design of the resolve-unclassified affordance — defer
to spec follow-up.]

## Prior Art

### PixInsight WBPP File Classifier

PixInsight's WeightedBatchPreprocessing script (Juan Conejero et al.)
classifies inputs by reading FITS headers with a deterministic priority
list (`IMAGETYP` → `FRAME` → user override → filename). WBPP groups by
`(IMAGETYP, FILTER, EXPTIME, BINNING, CCD-TEMP)` for calibration matching.
Astro Plan's classifier mirrors WBPP's header-first priority but stops at
frame type — calibration grouping is the responsibility of spec 001.

**Takeaway**: header-first, filename-fallback, user-override is the
established expert pattern. We adopt it.

### NINA Auto-Sort / SGP Image File Pattern

NINA's "image file pattern" and SGP's equivalent write frame type into
both the filename and the FITS header, so filename heuristics for these
two ecosystems are reliable enough to be a useful fallback when headers
are stripped or unreadable.

**Takeaway**: the filename heuristic table is small and worth maintaining
because it covers ~80% of practical "header missing" cases for these
ecosystems.

### KStars / EKOS, ASIAIR

Both write standard `IMAGETYP` values. ASIAIR additionally writes
proprietary headers (e.g., `ASIAIR_*`) that we may surface as evidence
metadata but do not use for classification.

## Handling Unclassified Files

Three policies were considered:

1. **Block the whole folder** until every file resolves. Rejected:
   one bad file shouldn't strand 499 good files.
2. **Silently drop** unclassified files from the plan. Rejected:
   violates constitution principle II (reviewable mutation requires
   awareness of every affected file).
3. **Surface as "Needs review" group**, exclude from consensus, exclude
   from the auto-generated split plan, allow manual reclassification or
   exclusion before plan generation. **Adopted.**

## Container Differences (FITS vs XISF)

XISF supports nested properties, multiple frame types per file (rare),
and explicit calibration history. The classifier MUST flatten to one
`FrameType` per file. Files with multiple frame-type properties are
treated as `unclassified` with high-priority surfacing in the UI.

## Performance

- Header reads: a single FITS header read is a few KB at the file head.
  Reading 500 headers is I/O-bound; sequential reads of ~1 MB total are
  comfortably under the 2 s target on SSD.
- Caching: classification results are cached in `inbox_classifications`
  keyed by (inbox_item_id, content_signature). `content_signature` is a
  lightweight per-folder signature derived from filenames, sizes, and
  mtimes — not file hashes. Per constitution, large-file hashing is
  optional or lazy.

## Open Questions Carried Forward

These map to `[NEEDS DECISION]` markers in spec.md:

1. Confidence thresholds: validate defaults against the fixture corpus.
2. Filter mismatch: does multi-filter in single-frame-type count as
   "mixed"?
3. Split destination model: sibling Inbox folders, or direct Inventory
   destinations?
4. Manual reclassification: allowed pre-plan? Does it bypass thresholds?
5. Video files (planetary/lunar): in-scope for this classifier or routed
   elsewhere?
