# 078 — Heuristic Frame-Type Suggestion: Thresholds and Evidence

**Date:** 2026-07-13
**Author:** Research pass over `/mnt/d/astrophotography` (read-only; pure-Python
FITS/XISF readers, no numpy)
**Status:** Complete — feeds the spec stub `specs/053-frame-type-suggestion/`
**Related:** doc 077 (header inventory), `imagetyp-normalization.md`,
spec 005 (inbox mixed-folder split), spec 007 (calibration matching rules),
spec 040 (calibration masters), spec 048 (per-frame inventory)

---

## 1. Problem and scope

When a frame's `IMAGETYP` is **blank, unmapped, ambiguous, or wrong**, PlateVault
currently lands it as `unclassified` and asks the user to reclassify by hand
(`imagetyp-normalization.md`). This is safe but leaves the whole burden on the
user — especially for the DWARF III, which writes **no `IMAGETYP` at all**
(doc 077 §2.3; 110/627 frames in this corpus had none), and for **mislabeled**
frames (a sky-flat sequence left on `IMAGETYP=LIGHT` is a real case).

This research defines a **suggestion** heuristic built on **measurable pixel and
exposure metrics only** — not on string tokens, filenames, software-specific
keywords, format flags, or network lookups. When the type is unknown *or when a
present `IMAGETYP` contradicts a strong measured signal*, it *suggests* the
likely type (`light` / `dark` / `flat` / `bias`) **with a confidence level**,
shown on the ingestion surface and never silently applied. This honours
Constitution §II (inference MUST carry confidence) and §IV (classification rules
are documented, threshold-based research questions). Override safety already
comes from scoping edits to a single session (Q8), so this only needs to be a
good *suggester*, not an infallible classifier.

**Types.** Four: `light`, `dark`, `flat`, `bias`. **`dark_flat` is dropped** —
consistent with spec 007 (R-DarkFlat-Reserved: modern flat panels make
dark-flats largely unnecessary; not matched in v1), and it has no measurable
signature distinct from a short dark/bias anyway (§5.3).

**Why measurable-only (design constraints established with the user):**

- `IMAGETYP` itself can be wrong (sky flats mislabeled `LIGHT`) → don't trust it;
  the measured ADU is authoritative and can *flag* a contradicting label.
- **No** string/token signals of any kind — not `OBJECT=FlatWizard`, not
  folder/filename tokens `flat`/`dark`/`bias`/`light`/`master`, not
  capture-software keywords. They are tool-specific and cause confusion. Type
  detection rests **only** on measured pixel ADU + exposure. (Filename tokens
  remain valid *elsewhere* — e.g. recovering gain/temp from a stripped-master
  filename, doc 077 §3 — but they never vote on frame type here.)
- `BITPIX` / `STACKCNT` are not guaranteed (float raws exist; `STACKCNT` is
  essentially Siril-only) → **not used**; master/normalized frames are detected
  from the **measured data range** instead (§4.3).
- Non-round exposure is **not** reliable (ADU-adjustable flat panels produce
  round exposures) → **not used**; flats are found by **high ADU + low
  exposure**.
- Resolving `OBJECT` to a catalogue target is **latency-inducing** (even with the
  spec-052 SIMBAD cache) → kept out of the fast suggestion path; available only
  as an optional, deferred confidence upgrade (§5.4).

**Out of scope / boundary:** sampling pixels to compute a median ADU is
*inspection*, not processing — it does not calibrate, register, or alter the file
(Constitution §III). No file is read in full; nothing is written to the image.
Matching flats to lights is **already shipped** (spec 007) and is not re-done
here — see §9.

## 2. Method and corpus

Headers parsed without loading full pixel data (80-byte FITS cards; XISF XML
header block). ADU characterised by a **spatially-distributed patch sample**
(§6), not a central slab. Throwaway scripts: `scratchpad/sampler.py`, `batch.py`,
`perf.py`.

Corpus: **627 frames** across many projects and all three cameras, typed by
header `IMAGETYP` as ground truth (folder *not* trusted):

| Ground-truth class | n | Cameras |
|---|---|---|
| LIGHT (raw 16-bit) | 335 | Poseidon-C PRO (OSC), ZWO ASI2600MM Pro (mono) |
| FLAT (raw 16-bit) | 140 | Poseidon, ZWO |
| No `IMAGETYP` (DWARF III lights) | 110 | DWARF III (OSC) |
| Master dark / bias / flat + 2 real integrated darks | 34+ | all |

Camera mix: Poseidon 336, ZWO2600 176, DWARF 94. Software: N.I.N.A. 3.1/3.2
(473), DwarfLab (93).

**Coverage limitations.** (a) **Raw darks/bias are scarce** — in this real
library they were deleted after mastering; the dark/bias ADU floor below is
anchored on 2 integrated-master darks + physics, not a large raw sample (§9).
(b) **DSLR raw** (1342 `.cr3`, 327 `.dng`) is proprietary-compressed and not
pure-Python readable; the ADU pass is unverified there (§9).

---

## 3. Headline result: ADU cleanly isolates FLAT, and only FLAT

Distributed-patch **median** ADU as a fraction of the 16-bit container
(`median / 65535`), on **raw sub-frames**:

| Ground-truth type | camera | n | min | p05 | median | p95 | max |
|---|---:|---:|---:|---:|---:|---:|---:|
| **FLAT** | Poseidon (OSC) | 80 | 47.3% | 49.2% | 53.9% | 57.2% | 59.2% |
| **FLAT** | ZWO2600 (mono) | 60 | 45.1% | 46.7% | 50.1% | 55.2% | 56.8% |
| LIGHT | Poseidon | 229 | 0.24% | 0.24% | 0.86% | 2.89% | **6.76%** |
| LIGHT | ZWO2600 | 104 | 0.78% | 0.79% | 1.76% | 3.93% | **7.78%** |
| LIGHT (no IMAGETYP) | DWARF | 89 | 0.30% | 0.31% | 0.47% | 1.78% | 6.25% |
| DARK (integrated master) | — | 2 | — | — | **0.25–0.30%** | — | — |

**Two disjoint populations with a wide empty gap.** Flats never fell below
**45%**; everything else never rose above **~8%**. Nothing landed in 8%–45%.
This holds across sensor technology (OSC *and* mono), model, gain, and every
project — confirming and extending the prior camera-independent finding (raw
flats ≈ 50% full-well on both sensors).

**ADU decides exactly one thing: flat vs not-flat.** Below the flat band, light,
dark, and bias all sit together in the low floor and are **not** separable by ADU
level alone. But there is a real *ordering* within the floor (§3.2).

**Set the not-a-flat ceiling well above the observed 8%.** The distributed median
tracks sky background, but a **very bright or large object** (Moon, dense star
field, big bright nebula, planetary/lunar frame) can lift the whole-frame median.
Because the empty gap runs to 45%, we use generous headroom: the **not-a-flat
ceiling is 20%** (2.5× the observed light max, still 25 points below the lowest
flat).

### 3.1 Flat rule (the one high-confidence measurable verdict)

**FLAT ⇔ high ADU + low exposure**, both measured, sensor-independent:

| Measured | Suggestion | Confidence |
|---|---|---|
| ADU median **≥ 40%** on a raw sub | **FLAT** | **high** |
| ADU median **20–40%** (empty dead-zone) | ambiguous — faint/twilight flat *or* very bright light | **low** — show, don't pre-select |
| ADU median **< 20%** | **not a flat** | ADU abstains → §3.2 |

- **Lower bound, not a 40–60% window.** A brighter panel or slightly
  over-exposed flat pushes ADU *up* toward saturation; a window would eject the
  brightest flats. "Flat" = "level is high", not "level is in a window".
- **Low exposure is a secondary confirmer,** not a gate: flats in the corpus were
  0.1–7 s. High ADU *with* a long exposure is anomalous (over-illuminated light?)
  → keep it low-confidence rather than forcing "flat".
- **The measured ADU overrides a contradicting `IMAGETYP`.** A frame labeled
  `LIGHT` but measuring ≥40% is almost certainly a mislabeled flat → surface the
  disagreement (this is the sky-flat mislabel case).

### 3.2 Within the low floor: dark ≤ light, bias by exposure

Measured ordering (confirmed): **dark 0.25–0.30% < light 0.52–1.53%** — lights
carry sky background above the sky-free dark floor. Bias is pedestal-only
(≈ dark, ~0.2%) but is set apart by **exposure ≈ camera minimum**.

So within ADU < 20%:

| Measured | Suggestion | Confidence |
|---|---|---|
| exposure ≈ camera minimum (≈0 s) + very low ADU | **BIAS** | medium |
| longer exposure + **lowest** ADU (sky-free floor) | **DARK** | low |
| longer exposure + low-but-**elevated** ADU (sky background) | **LIGHT** | low |

The dark/light ADU margin (~0.3% vs ~0.5–1.5%) is **real but small and depends on
sky brightness and temperature**, so dark-vs-light from measured metrics alone is
**inherently low-confidence** (§5.3). A star-structure metric was tested and
**rejected** — a single hot pixel in an integrated dark produced a larger
max/median excursion (24×) than any light, so outlier-based "star presence" is
not robust. Bias-vs-dark is cleanly separated by exposure; dark-vs-light is the
honest residual, presented as "light or dark" at low confidence rather than
guessed.

---

## 4. Measurable context (not type votes — scoping and field recovery)

These are measured header facts (presence/values), used to **scope** the rules
and to recover missing fields (§8), never to vote on frame type:

| Measured signal | Tells | Evidence |
|---|---|---|
| `BAYERPAT` present / absent | OSC / mono | Poseidon 336/336 & DWARF 94/94 present; ZWO2600 0/176 |
| `EGAIN` present | ZWO camera | ZWO 176/176; others 0 |
| `OFFSET` present / absent | NINA-class capture / DWARF | Poseidon+ZWO present; DWARF 0/94 |
| `NAXIS1×NAXIS2` + `XPIXSZ` | camera model | Poseidon 6252×4176; ZWO 6248×4176; DWARF 3856×2180 |
| `GAIN`, `OFFSET`, `EXPTIME` values | numeric parameters | for scoping "camera-min exposure" and bias vs dark |

`BAYERPAT` presence cleanly flags OSC vs mono and disambiguates a `FILTER=LUM` on
an OSC (whole-spectrum session label) from a real mono filter-wheel position.

### 4.3 Master / normalized frames — detect by measured data range, not BITPIX

`BITPIX` is unreliable (float raws exist). Instead, **measure the sampled data
range**: normalized/integrated masters (PixInsight/WBPP output) sit in **[0, 1]**,
so a master flat reads ~3.5% and a master light ~0.1% on that scale — a *master
flat would masquerade as a light* if run through the 0–65535 rule.

Guard (measurable): if the sampled `max ≤ ~1.5` (data lives in [0,1]), the frame
is normalized/integrated → **do not apply the raw-ADU rule**; treat it as a
master/processed product. Most such files already carry `IMAGETYP='Master …'`
(doc 077 §2.7–2.14) and don't need the heuristic; the guard just prevents a
normalized master without a label from being mis-suggested as a raw light.

---

## 5. The combined heuristic (measurable-only)

### 5.1 Decision flow

```
0. Sample the frame: distributed-patch MEDIAN ADU + data range + read EXPTIME.
1. NORMALIZED?  measured max ≤ ~1.5  → master/processed; ADU rule N/A. Stop.
2. FLAT?        ADU ≥ 40%            → FLAT (high). [flag if IMAGETYP disagrees]
3. AMBIGUOUS?   ADU 20–40%           → low-confidence flat-or-bright-light. Show.
4. NOT A FLAT   ADU < 20%: split by exposure + ADU-within-floor:
     exposure ≈ camera-min           → BIAS   (medium)
     longer exp, lowest ADU floor     → DARK   (low)
     longer exp, elevated ADU (sky)   → LIGHT  (low)
```

### 5.2 Signal × type matrix (measurable signals only)

`+++` strong-for · `+` weak-for · `·` neutral · `−`/`−−−` against.

| Measured signal | FLAT | BIAS | DARK | LIGHT |
|---|:--:|:--:|:--:|:--:|
| ADU median ≥ 40% (raw sub) | **+++** | −−− | −−− | −−− |
| ADU median 20–40% (dead-zone) | + (low) | · | · | + (low) |
| ADU median < 20% | −−− | + | + | + |
| Lowest ADU within floor (sky-free) | −− | + | **+** | − |
| Elevated ADU within floor (sky background) | −− | − | − | **+** |
| Exposure ≈ camera minimum (~0 s) | − | **+++** | − | − |
| Longer exposure (seconds–minutes) | + | −−− | **+** | **+** |
| Measured data range in [0,1] (normalized) | master/processed → ADU rule N/A |

Context (scoping only, §4): `BAYERPAT`, `EGAIN`, `OFFSET`, dims+`XPIXSZ`.

### 5.3 What stays unresolvable from measurable metrics (show, don't guess)

1. **Dark vs light** — same exposure (darks are shot to match light integration),
   both ADU < 20%. Light averages higher (sky) but overlaps; sky/temperature
   dependent → **low confidence**, present as "light or dark".
2. **Bias vs very-short dark** — both low ADU; separated only if one sits at the
   camera-minimum exposure. Without that anchor → low confidence.
3. **20–40% dead-zone** — empty in this corpus; reserved for faint/twilight/
   thin-cloud flats *and* unusually bright lights → always low confidence.

### 5.4 Optional confidence upgrades (deferred, not in the fast path)

Not required for a suggestion, offered only when the user asks to confirm:

- **Catalogue-target confirm** (spec 052 resolver): if the light's `OBJECT`
  resolves to a real catalogue target, upgrade a low-confidence LIGHT to high.
  Kept off the fast path because per-frame resolution is latency-inducing.
- **Session coherence:** within one confirmed session, a group all sharing one
  exposure + low ADU that also contains clearly-labeled darks elsewhere can lift
  or lower confidence. Purely local, measurable, no network.

---

## 6. Sampling strategy (resolves open question #5)

**Decision: spatially-distributed patches, pooled MEDIAN — not a central slab,
never the mean.**

A central slab through a bright core biases the median upward and risks reading a
*light as a flat*. A scattered sample tracks the **sky background**, which is what
separates the classes. Demonstrated on a 5 s Orion light where the central slab
struck a **saturated star** (median 182, max 65535, p95 512) while distributed
patches stayed clean (median 184, max 282, p95 214).

- Scatter N small patches on a **jittered grid over the inner 80%** (avoids
  amp-glow corners and vignette edges), pool all pixels, take the **median —
  never the plain mean**. A mean is dragged up by stars/hot pixels/cosmic rays
  (corpus p95/median = 1.2–1.35, a bright right-tail is always present) — exactly
  the pull that could push a light into the flat band. The median ignores it. A
  **10%-trimmed mean** agrees with the median to within 0.1–0.2% (ratio
  1.000–1.002 across all types), confirming the statistic is stable; a large
  divergence flags a suspect frame.
- **Coverage converges fast:** median was identical (184.0) at 4 096 px and at
  124 k px — a background-level estimate needs little coverage.
- **Deterministic placement** (fixed seed) for reproducibility.
- **Also record the measured data range** (max) for the normalized-master guard
  (§4.3); no separate read.

### 6.1 Performance (across 66 frames, 11 project/camera groups)

| config | coverage | slow WSL mount (mean) | mount p95 | local ext4 (mean) |
|---|---|---:|---:|---:|
| 36×6 patches | ~1.3k px | 39.8 ms | 49.5 ms | — |
| 64×8 patches | ~4k px | 65.8 ms | 129.6 ms | **2.65 ms** |

- Touches only ~few-KB regardless of the 50–100 MB file size.
- At *equal coverage* to a slab (~124k px), distributed patches cost the same or
  **less** than a contiguous slab when patches are large enough to amortize seeks
  (20.4 ms vs 29.7 ms, local) — and are object-robust either way.
- The mount adds ~25–63 ms of per-frame seek latency; local ext4 is ~2.6 ms. A
  production Rust reader using positioned reads (`pread`), no per-file process
  spawn, will be far faster.
- **Don't copy-to-local first for one-shot use:** the copy full-reads 52 MB
  (≈385 ms) — ~6× the cost of sampling in place.

Implication: the ADU pass is cheap but not free at library scale on slow media,
so it is an **opt-in "deep classify" per session** (§7); exposure/range are read
with it.

---

## 7. UX and provenance (open question #6)

- **Grouped per session/folder** on the Inbox surface, so a whole night's
  flats/lights are reviewed and accepted together (consistent with spec 005/041
  single-type items and the focused-overlay approval).
- **Opt-in deep classify.** Because ADU costs ~40–130 ms/frame on slow media, the
  measurement pass is user-triggered per session; the result is the suggestion.
- **Never silent, never pre-applied below high confidence.** Show suggested type
  + confidence + the measured reasons ("ADU 51% ⇒ flat; exposure 0.5 s"). Only
  high-confidence FLAT may be batch-pre-selected; everything else is shown, not
  pre-selected (Constitution §II). Contradictions with an existing `IMAGETYP` are
  surfaced explicitly.
- **Provenance.** A suggestion is not a classification until accepted. Extend the
  existing `EvidenceSource` (`imagetyp_header` | `xisf_property` |
  `manual_override` | `none`) with **`heuristic_suggestion`**, so an accepted
  suggestion is auditable and distinct from a real header value and a manual
  override. Accepting is a `manual_override`-class action scoped to the session
  (Q8). **Confidence is persisted** with the classification.

---

## 8. Other data recoverable by measurable heuristic (beyond frame type)

Same measured signals, same discipline (suggestion + confidence):

| Recoverable field | Measured heuristic | Confidence |
|---|---|---|
| **OSC vs mono** | `BAYERPAT` present ⇒ OSC; absent ⇒ mono | near-certain (0 counter-examples) |
| **Camera model** | `NAXIS1×NAXIS2` + `XPIXSZ` fingerprint (§4) | high; recovers identity on stripped masters |
| **Raw vs master/processed** | measured data range in [0,1] (§4.3) | high |
| **Binning** | `XBINNING`/`YBINNING` values | high |
| **Whole-spectrum vs filtered** | OSC (`BAYERPAT`) + `FILTER=LUM`/`Astro` ⇒ no physical filter | high |

Deliberately **not** attempted (no reliable measured signal): mean/median ADU is
absent from all headers (doc 077); electron gain on non-ZWO; true sensor temp on
DWARF. These stay unknown, not guessed.

## 9. Relationship to flat↔light matching (already solved — spec 007)

Matching flats to the lights they calibrate is **out of scope and already
shipped**: spec 007 (calibration matching rules, *Implemented*, closed
2026-07-03; `crates/calibration/core/src/rules/flat.rs`, `ranking.rs`). Its flat
rules (FR-004, data-model):

- **Hard** (mismatch excludes): `filter` (exact), `binning` (exact),
  `optic_train` (exact — telescope+camera+filter-wheel+focuser+rotator owns the
  vignetting pattern; cross-train flats are unsafe, R-OpticTrain), `gain` (exact).
- **Soft** (scored): `rotation` (±0.5° — dust/vignetting rotate with the camera),
  `observing_night_proximity` (0 nights preferred, ±7 tolerated).

This corpus confirms the matcher's keys are extractable: `FILTER`,
`INSTRUME`/`TELESCOP`/`FOCALLEN`/`FOCRATIO`, `XBINNING`, `GAIN`, and `ROTATANG`
are present on **96–100%** of both lights and flats. Illustration: a ZWO BLUE
flat (APO 120, FL 672 mm, rot 355.6°) is correctly *not* a match for an OIII
light (C925, FL 1645 mm, rot 335°); a Poseidon LUM light (186.1°) and its LUM
flat (190.1°, 4° apart) are a same-train match inside the rotation tolerance.

**Pipeline, not overlap:** this feature answers *"which frames are flats?"*; spec
007 answers *"which flats calibrate these lights?"*. The only coupling is a
**data dependency** — spec 007's matcher needs `ROTATANG` and the optic-train
fields, several of which are still doc-077 extraction gaps (`ROTATANG` is not
extracted today). Extracting them so the shipped matcher has its inputs is a
prerequisite this feature's metadata work should satisfy.

## 10. Open items carried into the spec / future work

1. **Native DSLR raw (14-bit).** CR3/DNG pixel data is not pure-Python readable;
   the ADU pass is unverified there. The fraction is container-relative, so the
   ≥40% flat rule should hold against `2^14−1`, but needs a raw decoder to
   confirm.
2. **Larger raw dark/bias sample.** Real raws are scarce here (deleted
   post-mastering). The dark/bias floor and the dark-vs-light margin are anchored
   on 2 integrated darks + physics; a dedicated raw-calibration corpus would
   tighten §3.2 / §5.3.
3. **DWARF EXPTIME anomalies** (4380/4500 s values) — likely total-integration or
   an encoding quirk; verify before trusting DWARF exposure for the bias/dark
   split.
4. **Twilight/sky flats** would populate the empty 20–40% dead-zone; none in this
   corpus. The low-confidence band is reserved for them.

## 11. Summary of decisions

- **Measurable-metrics-only.** No IMAGETYP-trust, no string/filename tokens, no
  `BITPIX`/`STACKCNT`, no non-round-exposure signal, no catalogue lookup in the
  fast path. Types: `light`, `dark`, `flat`, `bias` — **dark-flat dropped**.
- **FLAT is the one high-confidence verdict:** distributed-patch **median** ADU
  **≥ 40%** on a raw sub ⇒ flat (flats 45–59% vs everything ≤8%, wide empty gap,
  camera-independent), with low exposure as a secondary confirmer. The measured
  ADU overrides a contradicting `IMAGETYP` (catches mislabeled sky flats).
- **Below the flat band:** bias by exposure ≈ camera-minimum (medium);
  dark-vs-light is a **low-confidence residual** — dark ADU sits below light
  (sky-free floor vs sky background), but the margin is small; presented as
  "light or dark", never guessed. A star-structure metric was tested and
  rejected (hot pixels defeat it).
- **Master/normalized detected by measured data range** in [0,1], not `BITPIX`.
- **Sampling:** scattered patches over the inner 80%, pooled **median** (never
  mean), deterministic, raw-only; ~40–130 ms/frame slow media, ~2.6 ms local;
  opt-in deep classify.
- **UX:** grouped per session, never silent, confidence + measured reasons shown,
  only high-confidence FLAT pre-selectable; new `heuristic_suggestion`
  provenance; override safety from session-scoping (Q8).
- **Flat↔light matching is spec 007 (shipped); not re-done here** — only the
  `ROTATANG`/optic-train extraction it depends on is a carried prerequisite.
