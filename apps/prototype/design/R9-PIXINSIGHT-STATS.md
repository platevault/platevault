# R9 · PixInsight statistics, histogram and readout → Review panel (bead astro-plan-enmp7)

Feedback being answered (local://r9-user-feedback.md:137-143): the histogram needs more detail. The MAD ① tooltip should become histogram hover detail or plain values under Median/MAD. Add min and max. Adopt PixInsight's cursor readout where it makes sense.

Sources (primary only):
- **PCL** = gitlab.com/pixinsight/PCL @ `5a3902196a7d7a701385a7113cbdce2976ae1a85` (2026-09-28), e.g. `https://gitlab.com/pixinsight/PCL/-/blob/5a39021…/include/pcl/ReadoutOptions.h#L665`.
- **RefDoc** = gitlab.com/pixinsight/Reference-Documentation @ `08b8eb85ae17611629d21ff52014842077b01a1b`, `tools/HistogramTransformation/HistogramTransformation.pidoc` (author Juan Conejero, PTeam).
- **F7569** = https://pixinsight.com/forum/index.php?threads/pjsr-imagestatistics-vs-statistics-process-results.7569/ (Juan Conejero reply).
- **F12971** = https://pixinsight.com/forum/index.php?threads/statistics-process-bug.12971/ (full Statistics output with every option on, confirmed by Juan Conejero in the same thread).
- **F18439** = https://pixinsight.com/forum/index.php?threads/how-to-read-the-statistics-of-an-image.18439/ (a user's Statistics output; not staff).
- The Statistics tool and the Readout toolbar are closed-source core components. Their UI fields come from staff forum posts and the open PCL classes they call. Juan Conejero states that "all variants ultimately use the same PCL routines" (F7569).

---

## 1. Field lists per PixInsight tool

### 1a. Statistics process (window)
Per channel column (`K` for mono/CFA, else R, G, B; F12971 output header `K`). Every row with all options on, in display order (F12971):

| Row | Meaning | Source |
|---|---|---|
| count (%) | share of evaluated samples (clipped 0 and 1 excluded unless *Unclipped*) | F12971; F7569 ("Count 90% (rejects the pixel with a value of 0)") |
| count (px) | evaluated sample count | F12971; PCL `ImageStatistics.h:215` |
| mean | arithmetic mean | PCL `ImageStatistics.h:223` |
| modulus, norm, sumOfSquares, meanOfSquares | sums and norms | F12971; PJSR method list in F7569 |
| median | median (mean of the two middle values for even n: 0.0…0.9 gives 0.45) | PCL `ImageStatistics.h:241`; F7569 |
| variance, stdDev | about the mean | PCL `ImageStatistics.h:270` |
| avgDev | mean absolute deviation **from the median** | PCL doc page "Average deviation from the median" |
| MAD | median absolute deviation from the median | PCL `ImageStatistics.h:315` |
| sqrt(BWMV) | √ biweight midvariance (shown as a square root) | F12971; F7569 |
| sqrt(PBMV) | √ percentage bend midvariance (β = 0.2) | F12971; PCL doc page |
| Sn, Qn | Rousseeuw/Croux scale estimators (off by default) | PCL `ImageStatistics.h:375,391,838,871` |
| minimum, maximum | extremes | PCL `ImageStatistics.h:407,445` |
| minimumPos, maximumPos | x,y of the first occurrence | F12971; PCL `ImageStatistics.h:62-63,425,463` |

Tool options that change these values:
- **Normalized** (on by default): dispersion values are scaled to be comparable to a Gaussian σ: avgDev×1.2533, MAD×1.4826, BWMV×0.9901, PBMV×0.9709, Sn×1.1926, Qn×2.2191. Source: Juan Conejero, F7569.
- **Unclipped**: include 0/1 samples in all values. Source: F7569, F12971.
- **Range**: Normalized Real [0,1] or an integer range such as 16-bit, i.e. ADU. Source: F12971 "select 16-bit"; F18439.
- **Scientific notation**: e.g. `2.2447e-02` in F18439.

[INFERENCE, unverified] The out-of-box row set is count (%), count (px), mean, median, avgDev, MAD, minimum, maximum, with the others under Options. F18439 shows that set plus Sn/Qn, which the user had enabled.

### 1b. HistogramTransformation (interface)
- **Histogram**: 16-bit resolution (65,536 levels), 64-bit counts, normalized [0,1] axis. Source: RefDoc L37.
- **Plot**: plot resolution selectable from 6-bit (64 bins) upward (PCL `HistogramTransformationInterface.cpp:51-54`). Graph style Lines/Dots and grid toggle (`:2795-2836`). Reject saturated pixels for display (`:2808`). Per channel R, G, B, RGB/K, A (`:2858-2894`). Zoom 1:1–999:1 (RefDoc L265-277).
- **Information panel** (cursor over the histogram): `x = 0.162921 (10677->10860): 94981, %0.7866 | y = 0.455497`. Fields: normalized x, the bin range averaged under the cursor, the pixel count in that range, the percentage of all pixels, and normalized y. Sources: RefDoc L297-311; format string `HistogramTransformationInterface.cpp:1192` (`" x=%.4f(%d-%d) %llu, %%%.4f | y=%.4f"`).
- **Clipped pixel counts**: shadows and highlights, shown as `count, %percent` (`HistogramTransformationInterface.cpp:1092-1093`; RefDoc L452-458).
- **Image readouts on the histogram**: while the user presses on the image, each readout value is drawn as a vertical line in the channel's colour on the input and output histograms. Sources: RefDoc L496-498; `UpdateReadout` `:416-424`; `PlotReadouts` `:1492,1813,1847`. The black-point, midtones and white-point readout modes set parameters from the clicked pixel (RefDoc L517-533); these are processing-only.

### 1c. Readout (cursor) — Readout toolbar, click popup, ReadoutOptions
- **Where it shows**: readouts are generated as the cursor moves over an image. They appear on the Readout toolbar at the bottom of the main window and in a popup when the user clicks. While the mouse is pressed they are broadcast to tools such as HT. Source: PCL `ReadoutOptions.h:99-106`.
- **What is broadcast**: position in image coordinates plus R, G, B, A normalized to [0,1] (PCL `ProcessInterface.h:2305-2323`).
- **Options and defaults** (PCL `ReadoutOptions.h:665-682`; UI labels `ReadoutOptionsInterface.cpp:413-682`):

| Option | Values | Default |
|---|---|---|
| Data / colour space | RGB/K, RGB+L, RGB+Y, CIE XYZ, L\*a\*b\*, L\*c\*h\*, HSV, HSI | RGB/K |
| Calculation mode | Average, Median, Minimum, Maximum over the probe | Average |
| Probe size | 1×1 … 15×15 (odd) | single pixel |
| Readout preview | 15–127 px square, zoom 1:1–16:1, centre hairlines | on, 25 px, 8:1, hairlines on |
| Value format | real [0,1] with 0–15 decimals, or integer range up to 2³²−1 | real, 4 decimals (integer range 65,535 when integer is chosen) |
| Alpha / mask channel | include | on / on |
| Celestial coordinates | equatorial / ecliptic / galactic, **only when the image has a valid astrometric solution**; 1–3 sexagesimal items; 0–8 decimals | equatorial on, 3 items, 2 decimals |
| Broadcast | to tools | on |

The coordinate condition is stated at PCL `ReadoutOptions.h:381-401`.

Summary: the toolbar shows pixel X/Y, the channel value(s) for the probe, and RA/Dec only for plate-solved images. "Area" in PixInsight means either the probe (≤15×15, mean/median/min/max) or Statistics run on a preview rectangle. There is no free-form area readout.

---

## 2. Current prototype implementation

- `src/features/t3/raster.ts:387-437` `linearHistogram`
  - Samples the shown window on a grid of at most 160×120 (`:415-424`). The note row says "region shown".
  - Median is the upper-middle element (`:426`). PixInsight averages the two middle values; this is negligible here.
  - MAD is raw, not ×1.4826 (`:427-428`).
  - Range is 0…median+24·MAD (`:429`); the last bin also counts everything brighter (`:433-434`).
  - Already returns `saturated`, `invalid`, `above` and `samples`. No min, max, mean or σ.
- `src/features/v5/d-review/preview.tsx:179-211` `HistogramView`
  - SVG with log counts (`:183,192`) and a median line (`:195`). No pointer handling.
  - The caption is `review_histogram_median` "Median {median} · MAD {mad}", followed by saturated and invalid counts (`:198-200`).
  - ① `NoteMarker` (`:201-208`) with rows: Data `review_histogram_range` "Linear ADU 0–{max}", Counts `review_note_log` "Log", Samples `review_note_samples_value` "{count}, region shown", Brighter `review_note_brighter`.
- `src/features/v5/d-review/inspector.tsx:140` mounts `HistogramView` for the primary plate's shown window. The window comes from `frame-review.tsx:142,647`.
- `src/features/v5/d-review/preview.tsx:126-134` `Plate`: pointer down/move only pans at zoom ≠ fit. There is no hover readout. Star overlay mapping is `(s.x - win.x0)/win.scale` (`:157-158`), so cursor→source is `x0 + px·scale`.
- Frame caption bar `frame-review.tsx:568-626` (name plus zoom/stretch controls) is the natural home for a status readout.
- No WCS or astrometric solution exists in the domain. `domain/types.ts` has header pointing and rotation only, and `grep -i wcs` finds nothing.
- Copy keys: `messages/en-GB.json:4818-4857`, `messages/pt-BR.json:4874-4913`.

---

## 3. Recommendation (mapped to the Review panel)

Principle: Review judges frames; it is not a processing tool. Show PixInsight's default *summary* values in PixInsight's terms, with min and max. Skip estimators that only matter for processing: BWMV, PBMV, Sn, Qn, avgDev, sumOfSquares, modulus/norm, and colour-space readouts. Use ADU, which is PixInsight's 16-bit range, since the plate is integer camera data. Match PixInsight's unnormalized MAD (PCL `MAD()`) and state it once in the note, because Statistics shows MAD×1.4826 by default (F7569). Without the note, a user comparing numbers would see a 1.48× gap.

### 3a. Inline under the histogram — replace `preview.tsx:197-200`
Two tabular rows, no tooltip needed:

```
Median 1,527 · MAD 246
Min 802 · Max 65,449 · 12 saturated · 3 invalid
```
- `linearHistogram` (`raster.ts:425-436`) adds `min`, `max` (`sorted[0]`, `sorted.at(-1)`) and optionally `mean` from the existing sorted array. This is the same pass, so no second statistics function.
- **Accuracy risk**: min and max from the 160×120 sample grid miss hot pixels and star cores at fit zoom. A sampled Max is misleading, which matters most for a saturation check. Choose one:
  1. Scan every source pixel of the window for min/max/saturated. This is cheap at 1:1/2:1; at fit it is up to ~26 Mpx through `sampleAt`.
  2. In the synthetic model, take max analytically from `field.stars` in the window (`min(ADU_MAX, peak + background)`, as `raster.ts:294` already does for stars), and min from the sampled grid.

  Option 2 matches the model exactly and is cheap. [INFERENCE] Either way, the note should not claim exact extremes if they are sampled.
- Mean and stdDev: PixInsight shows them by default, but on a star field they mostly measure stars, and the plots strip already carries background and SNR. Leave them out inline; at most add "Mean" as a note row. Do **not** add σ.
- Keep "Median" (region shown) visually separate from the Values tab "Background", which is the frame-wide `field.background` (`raster.ts:295`). The two can differ when zoomed. The label "Median" is enough.
- Keys:
  - `review_histogram_median` stays.
  - New `review_histogram_extremes` "Min {min} · Max {max}" (pt-BR "Mín {min} · Máx {max}").
  - Saturated and invalid move to row 2 and reuse the existing plural keys.

### 3b. Histogram hover — new pointer handling on the SVG in `preview.tsx:190-196`
Follow HT's information panel (RefDoc L297-311), in ADU and without normalized y:
- A hairline guide at the cursor bin.
- The caption's first row is replaced live by `1,512–1,528 ADU · 3,412 px · 4.1 %`.
- On the last bin, which also holds brighter samples (`raster.ts:433-434`): `≥ 2,940 ADU · 812 px · 1.0 %`. This makes the Brighter note row redundant.
- Show the hover text in the caption line rather than a floating tooltip. That is desktop status-panel behaviour and matches the "remove tooltips unless they add value" feedback (local://r9-user-feedback.md:141).
- Keyboard: arrows step bins when the figure is focused, so the readout is not pointer-only. The `aria-label` stays the summary.
- Keys: `review_histogram_bin` "{from}–{to} ADU · {count} px · {percent}", `review_histogram_bin_last` "≥ {from} ADU · {count} px · {percent}".

### 3c. Cursor readout on the plate — `Plate` (`preview.tsx:93-176`) plus the caption bar (`frame-review.tsx:568-626`)
Follow the Readout toolbar defaults: single pixel, one channel (K), X/Y:
- On pointer hover over the plate, write a status line at the trailing end of the caption bar: `x 1,234 y 567 · 1,512 ADU`. On the invalid block (`sampleAt` NaN, `raster.ts:140`): `x 1,234 y 567 · NaN`. Clear it on leave.
- Use hover, not PixInsight's press-and-hold. Press-drag already pans when zoomed (`preview.tsx:126-134`), and a desktop app with one tool mode has no separate readout mode.
- Optional, HT-style cross-link (RefDoc L496-498): while hovering the plate, draw the readout value as a vertical line on the histogram. The plate's hover value goes up to `frame-review.tsx` with the window and down to `HistogramView`. This shows at a glance whether a pixel is sky, star or clipped. It is cheap and useful; adopt it.
- CFA frames (`field.cfa`): PixInsight treats a raw CFA frame as one grey channel (K). Show one ADU value. [INFERENCE] Appending the CFA site, e.g. `· G`, would help OSC users but is not a PixInsight behaviour; it is optional.
- **Do not adopt**:
  - Colour-space modes, alpha/mask rows and preview zoom options: processing-only.
  - Probe size and mean/median/min/max modes: a settings surface Review does not need. If one is wanted later, use a fixed 3×3 median, no setting.
  - RA/Dec: PixInsight shows it only with a valid astrometric solution (PCL `ReadoutOptions.h:381-401`). The prototype has only header pointing, so computing RA/Dec would present an estimate as a measurement. Add it if and when plate solving lands.
- Key: `review_readout` "x {x} y {y} · {value} ADU"; the NaN case uses `{value}` = "NaN" (no new key, or `review_readout_invalid`).

### 3d. The ① note (`preview.tsx:201-208`)
Keep one ① for basis only, per copy rule "Measured values" (HARNESS-V5-FEEDBACK-R1.md:11):
- Data: Linear ADU 0–{max}
- Samples: "{count} of {total}, region shown"
- MAD: "Unscaled" (pt-BR "Sem escala")

Drop "Counts: Log": the y-axis convention is not worth a row. Drop "Brighter": it is in the last-bin hover now.

### Dependency classification
- `related`: none of the above needs new data from other beads.
- `blocks`: RA/Dec readout is blocked by plate solving or a WCS in the domain, which does not exist today.

---

## 4. Design notes for the implementer (quality-code-design, investigate mode)
- Extend `Histogram` / `linearHistogram` in place. It already owns the region statistics; do not add a parallel stats helper.
- Three local `median` helpers exist with different rules: `domain/indexing.ts:143`, `t3/raster.ts:322` (null under 3), and the inline one at `raster.ts:426`. They have different contracts, so they are not DRY candidates. Report only; no refactor in scope.
- The readout value comes from `sampleAt(field, x, y)` (`raster.ts:138`), the same source as the histogram. Display stretch never reaches it, which keeps PIX-FR-03's invariant noted at `raster.ts:402-406`.
