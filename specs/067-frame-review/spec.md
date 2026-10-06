# Feature Specification: Frame pixel review and measurements

**Feature Branch**: `063-clean-rebuild-contract`

**Spec ID**: `067-frame-review`

**Created**: 2026-10-03

**Status**: Draft; product defaults and all human-approval gate waivers follow the root autonomous objective. Requirements analysis, implementation and verification remain required.

**Input**: Clean rebuild with selective reuse of verified code and the agreed PlateVault product flow.

## User Scenarios & Testing

### User Story 1 - Frame pixel review and measurements (Priority: P1)

Native measurement and full-resolution linear preview during the Review step of a processing run (View), star/PSF diagnostics, provenance-preserving measurement import, and Lightroom-style culling. The user reviews one list of frames as a table, a filmstrip or a grid, moves through it with hotkeys, and marks frames Picked, Rejected or Unreviewed. Measurement records can be written automatically; none changes source data, membership, or quality decisions. Quality changes only when the user marks frames (D-W3, D-W14, D-W42).

**Why this priority**: This feature owns the workflow steps listed below without imposing unrelated product features.

**Independent Test**: Exercise the acceptance scenarios through the running product with isolated inputs. Existing baseline code does not prove the redesigned behavior.

**Acceptance Scenarios**:

- **PIX-AC-01**: Given a 208-frame draft with 100 valid cached measurements, when Review frames opens, then 100 values show immediately and the rest are pending; a selected frame previews while measurement runs; Cancel keeps selection and exclusions and leaves unfinished frames 'Not measured'.
- **PIX-AC-02**: Given a preview under a strong display stretch, then the source file bytes are unchanged and measured values are identical with the stretch on and off.
- **PIX-AC-03**: Given a saturated star whose PSF fit fails, when it is selected, then it shows a failed fit with a saturation warning and no FWHM number.
- **PIX-AC-04**: Given a SubframeSelector CSV with one unmatched row and one ambiguous row, when it is imported and confirmed, then mapping review listed both rows, matched values show as imported with their units next to built-in values, and no frame is excluded or has a quality change.
- **PIX-AC-05**: Given a CSV column has no units or equivalent built-in metric, when its mapping is reviewed, then it remains unavailable rather than being labelled built-in FWHM or HFR.
- **PIX-AC-06**: Given Sessions are filtered by quality state, then no built-in measurement work starts.
- **PIX-AC-07**: Given a frame selected from a table row, a filmstrip or grid thumbnail, a plot point or the preview, then every view, the plots and the preview show the same frame. Disclosure names header evidence, metric source, units, method and input identity (D-W40).
- **PIX-AC-08**: Given samples containing NaN, infinity, saturated values and a mask, when preview and measurement run, then invalid/masked evidence remains inspectable, no invalid sample is silently replaced with a plausible measurement, and values retain the qualified input/channel basis.
- **PIX-AC-09**: Given a raw CFA fixture with recorded pattern and channel evidence, when preview and linear measurement run, then the recorded mosaic plane is inspectable, the channel basis is named, no debayering or RGB-derived metric occurs, and source hashes remain unchanged.
- **PIX-AC-10**: Given a frame with cached and imported measurements replaced in place with its size and mtime preserved, when Review frames opens, then its cached values never read valid. Its imported values read as history, the frame is measured again from its current bytes, and the earlier cached values remain only as history for the earlier content.
- **PIX-AC-11**: Given a CSV naming a measured frame that was replaced in place before import, with its size and mtime preserved, when the mapping is reviewed, then that row is listed for review against the frame's recorded digest. After confirmation no imported value attaches to it. Every attached imported value reads content unverified.
- **PIX-AC-12**: Given an Unreviewed frame with auto-advance on, when the user presses X, then the frame's library quality becomes Unusable and it reads Rejected with scope Library. The next frame in the current list order becomes current. The frame also reads Rejected in every other Project and run that shows it. Pressing U on it returns it to Unreviewed (D-W14, D-W42).
- **PIX-AC-13**: Given a library-Usable frame in a run of Project A that is also a candidate of Project B, when the user chooses Reject for this Project only, then its library quality stays Usable. Library usable totals are unchanged. The frame reads Rejected with scope This Project in Project A and Picked in Project B (D-W42).
- **PIX-AC-14**: Given 120 frames of which 100 have a built-in FWHM, when the user selects frames with FWHM above 3.5″, then exactly the measured frames above 3.5″ are selected. The 20 frames without a value are named Not measured and stay unselected. No quality state changes until the user marks the selection (D-W13).
- **PIX-AC-15**: Given the frame table at about 8 rows, when the user presses T three times, then the table shows the one-line strip, then full height, then 8 rows at the last dragged height. After the user presses ⌥3, the list holds only Rejected frames and the filter reads Rejected (D-W22).
- **PIX-AC-16**: Given the grid view (G) with 12 thumbnails multi-selected, when the user presses X, then those 12 frames read Rejected. Switching to the table or filmstrip keeps the same selection, current frame, filter and sort. Reopening the review shows the cached thumbnails without decoding the frames again. A frame whose bytes changed since its thumbnail was cached gets a new thumbnail (D-W40).
- **PIX-AC-17**: Given the frame name display template is switched to another preset, then the Name column re-renders for every frame and no file is renamed. Hovering a name, or opening the inspector, shows the full path. Hiding a column removes it from the table, and sorting a column orders frames by its value (D-W15).
- **PIX-AC-18**: Given a mosaic run group with four panel runs, when Review all opens, then frames from all four panels list together with a Panel column. Filtering to Panel 2 lists only Panel 2 frames. Marking a frame changes only that frame's quality, and every frame stays in its own panel run's membership (D-W41).
- **PIX-AC-19**: Given a run whose session holds a Trashed frame record, when Review frames opens, then that frame is not listed, counted, measured or thumbnailed in any view or filter (D-W43).

### Edge Cases

The [root contract](../063-clean-rebuild-contract/spec.md) governs file custody, uncertainty, exact membership, failed writes, and independent lifecycle decisions. Each acceptance scenario tests observable outcomes; no mock acknowledgment counts as terminal success.

- Auto-advance on the last frame of the current list keeps that frame current.
- When a mark moves the current frame out of the active filter (for example, P under the Unreviewed filter), the next frame in list order becomes current.
- Hotkeys do not act while a text field has focus.
- A frame whose thumbnail cannot be decoded shows an unreadable state with the reason, never a blank or substitute image.
- A frame with no value for the threshold metric is never selected by a threshold and is named Not measured (D-W13).

## Requirements

### Functional Requirements

- **PIX-FR-01**: Review frames shows cached measurements at once and pending, failed, or unavailable states elsewhere. Each cached measurement records the SHA-256 of the bytes it measured. It reads verifying until the frame's current bytes rehash to that digest, then valid; a mismatch keeps it as history and re-measures the current bytes. Missing built-in measurements are computed with selected work first. Progress is visible and frames can be inspected meanwhile. Cancel stops further measurement and keeps the draft. Filtering or browsing never starts built-in measurement.
- **PIX-FR-02**: Selecting a frame in a table row, a filmstrip or grid thumbnail, a plot point or the preview highlights it in every view, in the plots and in the preview. Header metadata and measurement source and units are shown on disclosure (D-W40).
- **PIX-FR-03**: The preview offers full-resolution zoom (Z toggles fit and 1:1) and pan, fullscreen (F), comparison of fixed middle and corner regions, next/previous frame, and a histogram of the displayed frame's linear data. Compare mode (C) shows the current frame beside a chosen reference frame with linked zoom and pan. Display stretch affects the preview, thumbnails and histogram display only; source pixels are never altered (D-W13).
- **PIX-FR-04**: Measurements use linear image data, never a stretched thumbnail.
- **PIX-FR-05**: A Stars overlay with per-star details: location, state, PSF model where fitted, shape and width values, saturation and fit warnings, and observed/fitted/residual cutouts when available. A failed fit is labelled failed, with no plausible FWHM. HFR and FWHM keep distinct labels.
- **PIX-FR-06**: Every value carries input identity and basis, method/version, units, and source (built-in or imported). Imported values never silently replace built-in ones. A built-in value's basis is the SHA-256 of the frame bytes it measured. An imported value is matched by file name only, so it reads content unverified unless its export supplies a content identity PlateVault can check (D19). Confirming the mapping records the frame's current identity and SHA-256 only as the import observation: once the frame differs from it, the value reads as history. When the frame's current bytes differ from its latest recorded basis, such as a cached measurement or quality decision, its row is listed for review and not attached.
- **PIX-FR-07**: Import measurements from a supported export (PixInsight SubframeSelector CSV). The review lists matched, unmatched, and ambiguous rows with units and method, and the mapping needs confirmation. Missing units or ambiguous identity require review. Unsupported columns stay unavailable rather than being relabelled. Rejection decisions are never imported.
- **PIX-FR-08**: Measurements never auto-exclude, auto-reject, or mark frames Usable. Threshold selection only selects frames; quality changes only through a user mark under PIX-FR-14 (D-W13).
- **PIX-FR-09**: Invalid samples and mask evidence remain visible and are never silently replaced. Raw/CFA interpretation and metric-specific masking follow root decision D03 and the fixture-qualified metric definitions; no debayering is introduced.
- **PIX-FR-10**: Layout: the frame table sits at the top across the full width. T and a visible toolbar control cycle it through three heights: full height; about 8 rows, resizable with a drag handle and remembered; and a one-line strip showing the current frame. The preview, with histogram and star cutouts, and the plots across the session in the bottom strip fill the rest of the window (D-W13, D-W22).
- **PIX-FR-11**: Three views show the same frame list: the table, a filmstrip (the table's one-line state, with thumbnails) and a grid (G) for Lightroom-style culling. All three share the filter, sort, multi-selection and current frame, and every hotkey in PIX-FR-13 acts the same in each (D-W40).
- **PIX-FR-12**: Thumbnails are decoded by the same PIX decoder as the preview, with a display stretch, and cached. A cached thumbnail records the SHA-256 of the bytes it was decoded from; when the frame's current bytes differ, it is decoded again. A thumbnail not yet decoded shows a pending state. Thumbnails are display-only and are never used for measurement (PIX-FR-04). Decoding a thumbnail does not start built-in measurement (D-W40).
- **PIX-FR-13**: Hotkeys, which act the same in every view (D-W14, D-W22, D-W40):
  - ← and → or J and K move to the previous and next frame.
  - P marks Picked, X marks Rejected and U marks Unreviewed.
  - Shift+P marks Picked and Shift+X marks Rejected, and the next frame then becomes current even when auto-advance is off.
  - Z toggles zoom, F toggles fullscreen and C toggles compare mode.
  - G switches to the grid, and T cycles the table height.
  - ⌘A selects every frame in the current filtered list.
  - ⌥1, ⌥2, ⌥3 and ⌥4 filter the list to All, Picked, Rejected and Unreviewed.
  - Auto-advance is on by default. After a mark, the next frame in the current list order becomes current.
  - When more than one frame is selected, a mark applies to every selected frame.
- **PIX-FR-14**: Quality has two levels. P, X and U set the frame's library quality to Usable, Unusable or Unreviewed, recorded under LIB-FR-09. Library quality is global: it shows in every Project, run, Sessions list and Target total. A mark applies at once, and the frame's state names its scope. Picked, Rejected and Unreviewed are the review labels for Usable, Unusable and Unreviewed. "Reject for this Project only" is a secondary action in the frame menu and the inspector, with no single-key hotkey. It writes the Project-scoped rejection record (root D10) and leaves library quality unchanged; the frame reads Rejected with scope This Project in that Project only, and Clear Project reject removes it. The Rejected filter lists both scopes and labels each. Marks change quality records only: run membership follows VSEL-FR-14 and VSEL-FR-15, and "in project" goal progress, which excludes Project-rejected frames, follows PRJ (D-W42).
- **PIX-FR-15**: Multi-select and threshold selection: frames can be selected one by one, as a range, with ⌘A, or by a threshold on a measured metric (above or below a value), set from a control or from a plot. A threshold uses only values for the metric and source shown; frames with no value are named Not measured and are not selected. The plots highlight the selected frames (D-W13).
- **PIX-FR-16**: Frame names use a display template with presets, built from the naming tokens and fallbacks; the default preset is the file name. The template changes display only and never renames files. Columns can be shown, hidden and sorted by value. The full path shows on hover and in the inspector (D-W15).
- **PIX-FR-17**: In a mosaic run group, Review all opens one list that spans every panel run, with a Panel column and a Panel filter. Each frame stays in its own panel run's membership. Measurement, views, hotkeys and marks behave as in a single run (D-W41).
- **PIX-FR-18**: Review frames opens from a run's Review step, from a run group's Review all, and from a Project's new candidate sessions with the list filtered to Unreviewed. A Trashed frame record never appears in frame review: it is not listed, counted, measured or thumbnailed (D-W35, D-W43).

### Owned interaction steps

- D1
- D2
- D3
- D6
- Cross-flow: Measurement pending/failed
- Frame culling: views, hotkeys, threshold selection and quality marks (D-W13, D-W14, D-W40, D-W42)
- Run-group review across panels (D-W41)

### Key Entities

Use the [root vocabulary](../063-clean-rebuild-contract/spec.md#key-entities). Feature-specific evidence and decisions retain their input identity, scope, and revision.

- **Processing run (View)**: the unit whose Review step opens frame review; it belongs to one Project and uses one rig (D-W1, D-W37). A mosaic subject's runs form a run group with one run per panel (D-W38).
- **Quality mark**: a library quality decision (Usable, Unusable or Unreviewed, shown as Picked, Rejected or Unreviewed) or a Project-scoped rejection. Each names its scope (D-W42).
- **Thumbnail**: a cached, display-only decode of a frame, bound to the SHA-256 of the bytes it was decoded from (D-W40).
- **Display template**: a token template, chosen from presets, that sets how frame names read in review (D-W15).

## Success Criteria

### Measurable Outcomes

- **PV-PIX-SC-01**: Every acceptance scenario produces its stated outcome and refusal behavior.
- **PV-PIX-SC-02**: Every owned interaction step has a requirement and independently observable acceptance evidence.
- **PV-PIX-SC-03**: Original inputs remain unchanged except through separately reviewed and approved filesystem operations.
- **PV-PIX-SC-04**: Every hotkey in PIX-FR-13 gives the same result in the table, filmstrip and grid views (D-W40).
- **PV-PIX-SC-05**: No quality record changes except through a user mark: P, X, U, Shift+P, Shift+X, Reject for this Project only, or Clear Project reject (D-W42).

## Assumptions

- [Product flow](../../docs/reviews/2026-10-03-product-flow-and-journeys.md) supplies the confirmed interactions and illustrative worked example.
- This feature is independently specified; dependencies on other feature contracts are resolved in planning.
- Conservative defaults and all human-approval gate waivers follow the root autonomous objective and decision register. Tests, requirements analysis, independent review and delivery evidence remain mandatory.
- “Built-in” measurement means provided by PlateVault, not a prescribed implementation tier.

## Decisions before feature approval

- Root decision D03 fixes read-only raw/CFA handling and the initial SubframeSelector CSV format. Metric set, units, masks, saturation, background, aperture and method-specific tolerances require explicit definitions and fixture qualification during PIX planning. No debayering is authorized.
- Root decision D19 binds cached measurements to the bytes they describe. Imported values stay content unverified and become history when the frame differs from its import observation.
- Workflow decisions D-W13, D-W14, D-W15, D-W22, D-W40, D-W41 and D-W42 (2026-10-06) set the review layout, views, hotkeys, frame names, run-group review and quality scopes.
