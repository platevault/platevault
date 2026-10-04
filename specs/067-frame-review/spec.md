# Feature Specification: Frame pixel review and measurements

**Feature Branch**: `063-clean-rebuild-contract`

**Spec ID**: `067-frame-review`

**Created**: 2026-10-03

**Status**: Draft; product defaults and all human-approval gate waivers follow the root autonomous objective. Requirements analysis, implementation and verification remain required.

**Input**: Clean rebuild with selective reuse of verified code and the agreed PlateVault product flow.

## User Scenarios & Testing

### User Story 1 - Frame pixel review and measurements (Priority: P1)

Native measurement and full-resolution linear preview during View review, star/PSF diagnostics, and provenance-preserving import. Measurement records can be written automatically; none changes source data, membership, or quality decisions.

**Why this priority**: This feature owns the workflow steps listed below without imposing unrelated product features.

**Independent Test**: Exercise the acceptance scenarios through the running product with isolated inputs. Existing baseline code does not prove the redesigned behavior.

**Acceptance Scenarios**:

- **PIX-AC-01**: Given a 208-frame draft with 100 valid cached measurements, when Review frames opens, then 100 values show immediately and the rest are pending; a selected frame previews while measurement runs; Cancel keeps selection and exclusions and leaves unfinished frames 'Not measured'.
- **PIX-AC-02**: Given a preview under a strong display stretch, then the source file bytes are unchanged and measured values are identical with the stretch on and off.
- **PIX-AC-03**: Given a saturated star whose PSF fit fails, when it is selected, then it shows a failed fit with a saturation warning and no FWHM number.
- **PIX-AC-04**: Given a SubframeSelector CSV with one unmatched row and one ambiguous row, when it is imported and confirmed, then mapping review listed both rows, matched values show as imported with their units next to built-in values, and no frame is excluded or has a quality change.
- **PIX-AC-05**: Given a CSV column has no units or equivalent built-in metric, when its mapping is reviewed, then it remains unavailable rather than being labelled built-in FWHM or HFR.
- **PIX-AC-06**: Given Sessions are filtered by quality state, then no built-in measurement work starts.
- **PIX-AC-07**: Given a frame selected from a row, plot or preview, when the selection changes, then all three identify the same frame and disclosure names header evidence, metric source, units, method and input identity.
- **PIX-AC-08**: Given samples containing NaN, infinity, saturated values and a mask, when preview and measurement run, then invalid/masked evidence remains inspectable, no invalid sample is silently replaced with a plausible measurement, and values retain the qualified input/channel basis.
- **PIX-AC-09**: Given a raw CFA fixture with recorded pattern and channel evidence, when preview and linear measurement run, then the recorded mosaic plane is inspectable, the channel basis is named, no debayering or RGB-derived metric occurs, and source hashes remain unchanged.
- **PIX-AC-10**: Given a frame with cached and imported measurements replaced in place with its size and mtime preserved, when Review frames opens, then neither its cached nor its imported values read valid. The frame is measured again from its current bytes, and the earlier values remain only as history for the earlier content.

### Edge Cases

The [root contract](../063-clean-rebuild-contract/spec.md) governs file custody, uncertainty, exact membership, failed writes, and independent lifecycle decisions. Each acceptance scenario tests observable outcomes; no mock acknowledgment counts as terminal success.

## Requirements

### Functional Requirements

- **PIX-FR-01**: Review frames shows cached measurements at once and pending, failed, or unavailable states elsewhere. Each cached measurement records the SHA-256 of the bytes it measured. It reads verifying until the frame's current bytes rehash to that digest, then valid; a mismatch keeps it as history and re-measures the current bytes. Missing built-in measurements are computed with selected work first. Progress is visible and frames can be inspected meanwhile. Cancel stops further measurement and keeps the draft. Filtering or browsing never starts built-in measurement.
- **PIX-FR-02**: Selecting a frame in the row, plot, or preview highlights it in all three. Header metadata and measurement source and units are shown on disclosure.
- **PIX-FR-03**: Full-resolution zoom and pan, fixed centre/corner comparison, and next/previous frame. Display stretch affects the preview only; source pixels are never altered.
- **PIX-FR-04**: Measurements use linear image data, never a stretched thumbnail.
- **PIX-FR-05**: A Stars overlay with per-star details: location, state, PSF model where fitted, shape and width values, saturation and fit warnings, and observed/fitted/residual cutouts when available. A failed fit is labelled failed, with no plausible FWHM. HFR and FWHM keep distinct labels.
- **PIX-FR-06**: Every value carries input identity and basis, method/version, units, and source (built-in or imported). Imported values never silently replace built-in ones. The basis includes the SHA-256 of the frame bytes a value describes; an imported value takes it when its mapping is confirmed (D19). After drift the value reads as history, as PIX-FR-01 defines for cached values.
- **PIX-FR-07**: Import measurements from a supported export (PixInsight SubframeSelector CSV). The review lists matched, unmatched, and ambiguous rows with units and method, and the mapping needs confirmation. Missing units or ambiguous identity require review. Unsupported columns stay unavailable rather than being relabelled. Rejection decisions are never imported.
- **PIX-FR-08**: Measurements never auto-exclude, auto-reject, or mark frames Usable.
- **PIX-FR-09**: Invalid samples and mask evidence remain visible and are never silently replaced. Raw/CFA interpretation and metric-specific masking follow root decision D03 and the fixture-qualified metric definitions; no debayering is introduced.

### Owned interaction steps

- D1
- D2
- D3
- D6
- Cross-flow: Measurement pending/failed

### Key Entities

Use the [root vocabulary](../063-clean-rebuild-contract/spec.md#key-entities). Feature-specific evidence and decisions retain their input identity, scope, and revision.

## Success Criteria

### Measurable Outcomes

- **PV-PIX-SC-01**: Every acceptance scenario produces its stated outcome and refusal behavior.
- **PV-PIX-SC-02**: Every owned interaction step has a requirement and independently observable acceptance evidence.
- **PV-PIX-SC-03**: Original inputs remain unchanged except through separately reviewed and approved filesystem operations.

## Assumptions

- [Product flow](../../docs/reviews/2026-10-03-product-flow-and-journeys.md) supplies the confirmed interactions and illustrative worked example.
- This feature is independently specified; dependencies on other feature contracts are resolved in planning.
- Conservative defaults and all human-approval gate waivers follow the root autonomous objective and decision register. Tests, requirements analysis, independent review and delivery evidence remain mandatory.
- “Built-in” measurement means provided by PlateVault, not a prescribed implementation tier.

## Decisions before feature approval

- Root decision D03 fixes read-only raw/CFA handling and the initial SubframeSelector CSV format. Metric set, units, masks, saturation, background, aperture and method-specific tolerances require explicit definitions and fixture qualification during PIX planning. No debayering is authorized.
- Root decision D19 binds cached and imported measurements to the bytes they describe.
