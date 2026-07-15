# Feature Specification: Heuristic Frame-Type Suggestion

**Feature Branch**: `053-frame-type-suggestion`

**Created**: 2026-07-13

**Status**: Draft — **backlog stub** (`speckit.specify`, define-only; not yet
planned or scheduled)

**Input**: User description: "Heuristic frame-type suggestion — when IMAGETYP is
blank, unmapped, ambiguous, or wrong, SUGGEST the likely frame type
(light/dark/flat/bias) with confidence on the ingestion surface, never silent,
using measurable pixel and exposure metrics only. Override safety comes from
session-scoping (Q8)."

> **Stub scope.** This document defines *what* the feature is and its acceptance
> intent. It intentionally omits stack/schema/contract/task detail (those belong
> to `plan.md`, `data-model.md`, `contracts/`, `tasks.md`, produced later). The
> supporting research — thresholds, evidence tables, sampling and performance
> measurements — is complete in **`docs/research/078-heuristic-frame-type-suggestion.md`**.

## Overview

PlateVault classifies ingested frames from their `IMAGETYP` header
(`imagetyp-normalization.md`). When `IMAGETYP` is **absent** (the DWARF III
writes none; 110/627 frames in the research corpus had none), **unmapped**,
**ambiguous**, or **wrong** (e.g. a sky-flat sequence left on `IMAGETYP=LIGHT`),
the frame lands as `unclassified` and the user must reclassify it by hand.

This feature adds a **suggestion** layer that, on request, measures each frame
and proposes its likely type — `light`, `dark`, `flat`, or `bias` — **with a
confidence level and the measured reason**, on the ingestion (Inbox) surface. The
suggestion is **never applied silently**; the user accepts or overrides it, and
acceptance is scoped to a single session, which is where override safety already
comes from (Q8). Suggestions rest on **measurable metrics only** — a
spatially-sampled median pixel level (ADU) and the exposure time — not on header
labels, filenames, capture-software keywords, or catalogue lookups. Because the
measured level is authoritative, a suggestion can also **flag a frame whose
existing `IMAGETYP` contradicts the measurement** (the mislabeled-flat case).

Consistent with the constitution, measuring pixels for inspection is not
processing (§III — no calibrate/register/edit; no full read; nothing written to
the image), and every inference carries a confidence level (§II) against
documented thresholds (§IV, research doc 078).

This feature is a **suggester**, not an infallible classifier: it makes one
high-confidence call (flat), one medium call (bias), and presents the genuinely
ambiguous cases (light-vs-dark) honestly at low confidence rather than guessing.

## Clarifications

### Session 2026-07-13 (pre-spec research + grilling)

Decisions resolved with the user during the doc-078 research pass; recorded here
so the spec is self-contained.

- Q: What signals may the heuristic use? → A: **Measurable pixel/exposure metrics
  only.** A spatially-distributed median ADU and `EXPTIME`. **Excluded:**
  trusting `IMAGETYP`; string/filename/folder tokens (`FlatWizard`, `flat`,
  `dark`, `bias`, `light`, `master`); capture-software keywords; `BITPIX` /
  `STACKCNT` (not guaranteed); non-round-exposure (adjustable flat panels defeat
  it); per-frame catalogue-target resolution (latency).
- Q: Which types are suggested? → A: `light`, `dark`, `flat`, `bias`.
  **`dark_flat` is dropped** — consistent with spec 007 (R-DarkFlat-Reserved) and
  it has no measurable signature distinct from a short dark/bias.
- Q: How is FLAT detected? → A: **High ADU + low exposure.** Distributed-patch
  **median** ADU ≥ **40%** of full scale on a raw sub ⇒ flat (high confidence).
  Flats measured 45–59% vs everything else ≤8% across all cameras/projects, with
  a wide empty gap; a lower bound is used, not a 40–60% window (bright/over-
  exposed flats push higher). 20–40% is an empty dead-zone → low confidence.
- Q: What separates the low-ADU (<20%) frames? → A: **bias** by exposure ≈ camera
  minimum (medium confidence); **dark vs light** by ADU-within-floor (dark is
  sky-free and measurably lower than a light's sky background) — but the margin
  is small and sky/temperature-dependent, so dark-vs-light is **low confidence**,
  presented as "light or dark", never guessed. A star-structure metric was tested
  and rejected (hot pixels defeat it).
- Q: Why 20% and not the observed 8% ceiling? → A: Headroom for very bright/large
  objects (Moon, dense star fields) that can lift the whole-frame median; the
  empty gap to 45% affords it.
- Q: Master/processed frames? → A: Detect by **measured data range** (values in
  [0,1] ⇒ normalized), not `BITPIX`; skip the raw-ADU rule for them.
- Q: When does the measurement run? → A: **Opt-in "deep classify" per session**
  (the ADU pass costs ~40–130 ms/frame on slow media; header/exposure facts are
  free). The measurement is sampled, never a full read.
- Q: Override safety? → A: Already provided by **scoping edits to a single
  session** (Q8); accepting a suggestion is a `manual_override`-class action.
- Q: Relationship to flat↔light matching? → A: **Out of scope — already shipped**
  (spec 007). This feature only says *which frames are flats*; spec 007 matches
  them to lights. The one coupling is a data dependency (spec 007 needs
  `ROTATANG` + optic-train fields extracted).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Suggest a type for unclassified frames (Priority: P1)

As a user ingesting frames whose `IMAGETYP` is missing or unmapped (e.g. DWARF
III captures, or a stripped folder), I want PlateVault to suggest each frame's
likely type with a confidence level, so I can accept good suggestions in bulk
instead of classifying every frame by hand.

**Why this priority**: This is the core value and the MVP. On its own it turns a
folder of `unclassified` frames into a reviewable set of confident suggestions.

**Independent Test**: Ingest a session of DWARF III lights (no `IMAGETYP`) and a
folder of raw flats. Run deep classify for the session. Verify each flat is
suggested `flat` at high confidence and each light is suggested `light` (or
"light or dark" at low confidence), each with a measured reason, and that nothing
is applied until the user accepts.

**Acceptance Scenarios**:

1. **Given** a raw sub with no `IMAGETYP` measuring median ADU ≥ 40%, **When**
   deep classify runs, **Then** it is suggested **flat** at **high** confidence
   with the measured ADU shown as the reason.
2. **Given** a raw sub with no `IMAGETYP` measuring ADU < 20% at an exposure of
   several minutes, **When** deep classify runs, **Then** it is suggested
   **light or dark** at **low** confidence, shown but not pre-selected.
3. **Given** a raw sub measuring ADU < 20% at ≈ the camera-minimum exposure,
   **When** deep classify runs, **Then** it is suggested **bias** at **medium**
   confidence.
4. **Given** any suggestion, **When** it is produced, **Then** no classification
   is written to the frame until the user explicitly accepts it.

### User Story 2 - Flag frames whose existing label contradicts the measurement (Priority: P2)

As a user who occasionally mislabels a sequence (e.g. sky flats captured on a
LIGHT sequence), I want PlateVault to flag frames whose `IMAGETYP` disagrees with
what the pixels measure, so mislabeled frames don't silently poison sessions or
calibration.

**Why this priority**: Catches a real, damaging error class that pure
`IMAGETYP`-trust cannot. Depends on the same measurement as US1.

**Independent Test**: Take a set of flats with `IMAGETYP` forced to `LIGHT`; run
deep classify; verify each is flagged as a contradiction (measures flat, labeled
light) and surfaced for the user, without auto-changing the label.

**Acceptance Scenarios**:

1. **Given** a frame with `IMAGETYP=LIGHT` measuring median ADU ≥ 40%, **When**
   deep classify runs, **Then** it is flagged "measured flat, labeled light" and
   surfaced for review, not silently re-typed.

### User Story 3 - Review, accept, and override per session (Priority: P2)

As a user reviewing an ingest, I want suggestions grouped by session with their
confidence and reasons, so I can batch-accept the confident ones and adjust the
ambiguous ones, with edits scoped to that session.

**Why this priority**: Makes the suggestions usable at scale; reuses the existing
single-type-item / focused-overlay review model (spec 005/041).

**Independent Test**: Produce suggestions for a mixed session; verify high-
confidence flats can be accepted in one action, low-confidence items require an
explicit choice, and an accepted suggestion is recorded with a distinct
`heuristic_suggestion` provenance and its confidence.

**Acceptance Scenarios**:

1. **Given** a session with several high-confidence flats and some low-confidence
   light-or-dark frames, **When** the user batch-accepts, **Then** only the
   high-confidence items are pre-selected and the low-confidence items are shown
   but require an explicit choice.
2. **Given** an accepted suggestion, **When** it is recorded, **Then** its
   classification source is `heuristic_suggestion` and its confidence is
   persisted, distinct from a header value and from a manual override.

### Edge Cases

- **Normalized master/processed frame** (measured data range in [0,1]): the
  raw-ADU rule does not apply — do not suggest a raw type from ADU; treat as
  master/processed.
- **Very bright/large object** (Moon, dense star field): median may exceed 8%;
  the 20% not-a-flat ceiling keeps it out of the flat band; it stays low-
  confidence in the 20–40% zone at worst.
- **DSLR native raw (CR3/DNG)**: pixel data not readable by the sampler in v1;
  the ADU pass is unavailable → header/exposure-only, lower confidence (research
  open item).
- **Slow/removable media**: the ADU pass is opt-in and sampled; it must degrade
  gracefully (skip/queue) rather than block ingest.
- **Frame too small / unreadable / truncated**: no suggestion, surfaced as
  "could not measure", never a fabricated type.
- **Dark vs light genuinely unresolvable**: presented as "light or dark" at low
  confidence; never auto-resolved.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST, on user request per session, produce a frame-type
  **suggestion** for frames whose type is unknown, unmapped, or ambiguous, drawn
  from `light`, `dark`, `flat`, `bias`.
- **FR-002**: Suggestions MUST rest **only on measurable metrics** — a
  spatially-distributed **median** pixel level (ADU) sampled without a full read,
  and the exposure time — and MUST NOT use `IMAGETYP` trust, string/filename/
  folder tokens, capture-software keywords, `BITPIX`/`STACKCNT`, non-round-
  exposure, or per-frame catalogue resolution.
- **FR-003**: The system MUST suggest **flat** at high confidence when the
  measured median ADU is at or above the documented flat threshold on a raw sub
  (research doc 078: ≥ 40% of full scale), treating the threshold as a lower
  bound, not a bounded window.
- **FR-004**: The system MUST suggest **bias** when the measured ADU is in the
  low floor and the exposure is at/near the camera minimum; and MUST distinguish
  **dark** from **light** within the low floor only as a **low-confidence**
  suggestion (dark floor below light's sky background), presenting genuinely
  unresolvable cases as "light or dark".
- **FR-005**: The system MUST treat a frame whose measured data range indicates
  normalization (values in [0,1]) as master/processed and MUST NOT apply the
  raw-ADU rule to it.
- **FR-006**: Every suggestion MUST carry a **confidence level** and a
  human-readable **measured reason** (e.g. the sampled ADU and exposure).
- **FR-007**: The system MUST NEVER apply a suggestion silently; a classification
  is written only when the user accepts it, and MUST NOT overwrite an existing
  value without explicit action.
- **FR-008**: When a frame's existing `IMAGETYP` contradicts a strong measured
  signal, the system MUST **flag the disagreement** for review and MUST NOT
  silently re-type the frame.
- **FR-009**: Suggestions MUST be presented **grouped by session** on the
  ingestion surface, with high-confidence suggestions eligible for batch
  acceptance and lower-confidence ones shown but not pre-selected.
- **FR-010**: An accepted suggestion MUST be recorded with a **distinct
  classification provenance** (`heuristic_suggestion`) separate from a header
  value (`imagetyp_header`/`xisf_property`) and a manual override
  (`manual_override`), and MUST persist the confidence.
- **FR-011**: The ADU measurement pass MUST be **opt-in per session** and sampled
  (never a full-file read), and MUST degrade gracefully on slow/removable media
  and on frames it cannot measure (no fabricated suggestion).
- **FR-012**: The feature MUST NOT calibrate, register, integrate, or modify any
  image file; measurement is read-only inspection (Constitution §III).
- **FR-013**: `dark_flat` MUST NOT be a suggested type in v1 (consistent with
  spec 007 R-DarkFlat-Reserved).

### Key Entities *(include if feature involves data)*

- **Frame-type suggestion**: proposed type + confidence level + measured reason
  (sampled ADU, exposure) for one frame; advisory until accepted.
- **Measurement**: the sampled statistics of one frame (distributed-patch median
  ADU, data range, exposure) — inspection output, not stored image data.
- **Classification provenance**: extends the existing `EvidenceSource`
  (`imagetyp_header` | `xisf_property` | `manual_override` | `none`) with
  `heuristic_suggestion`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On the research corpus, **100% of raw flats** (median ADU 45–59%)
  are suggested `flat`, and **0% of raw lights** (≤ ~8%) are suggested `flat`
  (clean flat/not-flat separation, camera-independent).
- **SC-002**: Frames whose measured ADU contradicts their `IMAGETYP` (e.g. a
  flat labeled `LIGHT`) are flagged in 100% of cases, with no silent re-typing.
- **SC-003**: No suggestion is ever applied without an explicit user accept, and
  every accepted suggestion is stored with `heuristic_suggestion` provenance and
  a persisted confidence.
- **SC-004**: The opt-in measurement pass samples each frame without a full read
  (touching only a few KB regardless of file size) and completes fast enough to
  review a night's session interactively (research doc 078 §6.1).
- **SC-005**: Genuinely ambiguous frames (light-vs-dark) are presented at low
  confidence as "light or dark" and are never pre-selected, so the user is never
  shown a confident wrong answer.

## Assumptions

- Users ingest through the existing Inbox confirm/apply flow; suggestions attach
  to that surface (spec 005/041 single-type items, focused-overlay review).
- The frames of interest are FITS/XISF the sampler can read; **DSLR native raw
  (CR3/DNG) is out of scope for the ADU pass in v1** (header/exposure-only there).
- Sampling a central-frame-avoiding distributed patch median is a faithful
  background-level estimator for these sensors (validated in research doc 078).
- **Flat↔light matching is out of scope** — it is already implemented in spec 007
  and is not re-specified here; this feature only supplies "which frames are
  flats" and (as a carried prerequisite, not a deliverable of the suggester) the
  `ROTATANG`/optic-train extraction that spec 007's matcher depends on.
- Override safety is inherited from single-session scoping (Q8); no new
  reversal/audit mechanism beyond the existing classification provenance is
  assumed.
- Bias/dark ADU-floor thresholds are anchored on a thin real-raw sample plus
  physics (research doc 078 open item #2); a larger raw-calibration corpus may
  refine the low-floor bands before implementation.
