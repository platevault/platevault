# Feature Specification: Calibration master detection

**Feature Branch**: `040-calibration-masters-detection`

**Created**: 2026-06-19

**Updated**: 2026-06-23

**Status**: Implemented — per-tool MasterDetector (PixInsight/Siril), individual master items, format field, confirm→Calibration page (PRs #290/#292/#293). Validated end-to-end 2026-06-23: `calibration_master_detect` 23/23, `confirm_master_integration` 3/3.

**Input**: Detect calibration masters from XISF and FITS metadata via an extensible per-tool detector system; classify base frame type + an `isMaster` flag; distinguish masters by filter/exposure; show masters as individual items in the inbox and surface them on the Calibration page. (Sub-frames stay folder-grouped.)

## Background

XISF/FITS files are already scanned and frame-typed (`IMAGETYP` → Light/Dark/Bias/Flat/DarkFlat). Gaps found in validation:
- **Masters aren't recognized**: tools mark masters differently (see research.md) — Siril keeps the base `IMAGETYP` and uses `STACKCNT`/`_stacked`; PixInsight/WBPP uses `IMAGETYP` containing "master" + a path fallback. The current normalization has no notion of a master, so masters are mis-/un-classified.
- **No frame-vs-master distinction** in the model.
- **Folder grouping** hides individual masters (each leaf folder is one inbox item).

## User Scenarios & Testing *(mandatory)*

### User Story 1 — XISF/FITS masters are detected as masters (P1)
A user with PixInsight XISF masters (`IMAGETYP=Master Dark`) and/or Siril FITS masters (`IMAGETYP=DARK`, `STACKCNT>1`, `*_stacked.fit`) sees them recognized as calibration **masters** of the right type.

**Independent Test**: feed representative XISF (PixInsight) and FITS (Siril) master fixtures through detection → each yields `{frame_type, is_master:true, detector}`; a single sub-frame yields `is_master:false`.

**Acceptance Scenarios**:
1. **Given** an XISF with `IMAGETYP="Master Dark"`, **When** detected, **Then** `frame_type=Dark, is_master=true` (PixInsight detector).
2. **Given** a FITS with `IMAGETYP="DARK"` + `STACKCNT=30`, **When** detected, **Then** `frame_type=Dark, is_master=true` (Siril detector).
3. **Given** a file named `masterFlat_Ha.xisf` with no master IMAGETYP, **When** detected, **Then** `is_master=true` via the path/name fallback.
4. **Given** a single dark sub (`IMAGETYP=DARK`, no STACKCNT/master), **When** detected, **Then** `is_master=false`.

### User Story 2 — Masters shown individually with their metadata (P1)
Masters appear as **individual entries** (not a folder lump) in the inbox/imported list, each labeled by type + filter + exposure (e.g. "Master Dark · 300s", "Master Flat · Ha"). Sub-frames stay folder-grouped.

**Independent Test**: a calibration folder with 3 different masters (dark 300s, flat Ha, flat OIII) + a folder of dark subs → the inbox shows 3 master items + 1 grouped subs item.

**Acceptance Scenarios**:
1. **Given** several masters in one folder, **When** scanned, **Then** each is its own inbox item distinguished by filter/exposure.
2. **Given** a folder of sub-frames, **When** scanned, **Then** they remain a single grouped item.

### User Story 3 — Masters surface on the Calibration page (P2)
On confirm/ingest, detected masters are registered so they appear on the **Calibration masters page**.

**Independent Test**: confirm a detected master in the inbox → it appears in `calibration_masters_list` / the Calibration page.

## Requirements *(mandatory)*

- **FR-001**: A dedicated extensible crate `crates/calibration/master-detect` provides a `MasterDetector` trait + registry + `detect_master(input)` (see research.md). Adding a tool = one new detector impl.
- **FR-002**: Ship `SirilDetector` and `PixInsightDetector` per research.md (Siril: STACKCNT>1 / `_stacked` / name; PixInsight: IMAGETYP "master" / path / name). Base frame type from `IMAGETYP` (OFFSET→Bias); STACKCNT threshold `>1`.
- **FR-003**: The crate depends only on `metadata/core`; no domain/persistence/UI deps. Table-driven unit tests per detector (XISF + FITS fixtures), including negative (sub-frame) cases.
- **FR-004**: Classification (inbox `classify`) uses `detect_master` to set base frame type + an `is_master` flag; the metadata model carries `is_master` (and the matching detector for provenance).
- **FR-005**: Masters are emitted as **individual items** keyed by content + (type, filter, exposure); sub-frames keep the existing folder grouping.
- **FR-006**: Inbox/imported list shows masters individually with type + filter + exposure.
- **FR-007**: On confirm, masters are registered into the calibration masters store and appear on the Calibration page.
- **FR-008**: Mock mode exercises the new master items + list.

## Success Criteria *(mandatory)*

- **SC-001**: PixInsight XISF + Siril FITS master fixtures are each detected as masters of the correct type; sub-frames are not.
- **SC-002**: A folder with N distinct masters shows N individual inbox items distinguished by filter/exposure.
- **SC-003**: Confirming a master makes it appear on the Calibration page.
- **SC-004**: A new tool detector can be added by implementing `MasterDetector` + registering it (no changes to callers).
- **SC-005**: cargo + typecheck + vitest green; the detector crate has per-tool unit tests.

## Scope

**In scope**: the detector crate + Siril/PixInsight detectors; wiring detection into classification; per-master individual items + metadata display; surfacing masters to the Calibration page.

**Out of scope**: deep XISF/FITS binary parsing beyond the header fields already extracted; calibration *matching/reuse* policy (separate); per-sub-frame display for non-masters.

## Assumptions

- The existing FITS/XISF extractors already surface (or can cheaply surface) `IMAGETYP`, `STACKCNT`/`NCOMBINE`, filter, exposure; if `STACKCNT`/`NCOMBINE` isn't extracted yet, the extractors add it.
- "Master distinguished by filter/exposure" uses already-extracted metadata.
