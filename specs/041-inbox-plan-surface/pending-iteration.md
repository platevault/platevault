---
status: pending
created: 2026-06-21
change_request: "Inbox plan-surface destination model refinements (follow-up to merged spec 041), discovered during Windows real-app E2E: (A) Per-type configurable destination patterns — the pattern resolver applies the light template {target}/{filter}/{date}/{frametype}/ to ALL frames, so calibration frames get nonsensical segments like 'unclassified/nofilter/undated/dark/'. Provide a SEPARATE, user-configurable token-based pattern per type: light, flat, master flat, bias, master bias, dark, master dark — each editable in Settings, each with a sensible default. Defaults reflect which attributes matter: flats track date+filter; bias/darks ignore filter; masters ignore date; calibration has no target. Ensure a pattern can be set per type and sensible defaults exist per type. (B) Destination-root selection — confirm currently sets to_root_id = from_root_id (reorganize in place); new model: default move-in-place within the source's own root, EXCEPT inbox-kind sources which must move into a specific library root; when more than one registered root exists for the target frame type, require the user to explicitly select the destination root in plan review/confirm; when only one candidate root exists, no selection is required. (C) Full destination path display — show the full absolute destination (selected root + relative path), not just the root-relative path (depends on B). (D) Mandatory capture of missing path-creation attributes — any metadata used to build the destination path (date/DATE-OBS, target/object, filter for lights+flats, exposure for darks/flats, frame type) must, when missing, be required from the user before a plan can be generated/applied, handled like missing IMAGETYP; enumerate exactly which attributes are path-load-bearing per frame type and gate plan generation on them."
scope: "Feature-wide (additive new requirements + behavioral change to the merged move-destination computation)"
---

## Change Summary

Rework the inbox destination-computation layer on top of the now-working apply path: user-configurable per-type destination patterns (light/flat/master-flat/bias/master-bias/dark/master-dark) with sensible defaults, explicit destination-root selection (default in-place; inbox must target a root; ambiguous multi-root requires user choice), full absolute-path previews, and a hard gate that requires the user to supply any missing path-load-bearing metadata before a plan can be produced.

## Implementation Progress

- **Tasks completed**: T001–T047 (47 of 47 total) — spec 041 is **merged to `main`** (`3657061`).
- **Current phase**: 041 closed; this iteration is **new work on a new branch off `main`**.
- **Files changed on branch (041, now merged)**: full feature.
- **Potential task completions to mark**: none (all 041 tasks complete).
- **Adhoc changes**: the three closing fixes that shipped with 041 (apply root-id resolution via `registered_sources` `1d0aed9`; breakdown column stability + move-preview double-slash `c589cea`) are the foundation this iteration builds on.

## Impact Assessment

| Artifact | Action | Details |
|----------|--------|---------|
| spec.md | Modify + Add | New User Story 8 (destination-root selection) and User Story 9 (mandatory missing-attribute capture); new FR-025..FR-033; updated acceptance scenarios under US4 (move/catalogue) and US5 (split) to reflect calibration structure + root selection. |
| plan.md | Modify | Pattern resolver: add a calibration template path; `confirm` gains destination-root resolution + ambiguity detection + gate on path-load-bearing attributes; classify/confirm contracts carry chosen `root_id`, absolute destination, and missing-attribute requirements. |
| research.md | Add | Documented decision (Constitution Principle IV) for the calibration folder structure, and the path-load-bearing attribute matrix per frame type. |
| data-model.md | Modify | Confirm/plan request carries a selected destination `root_id`; per-type candidate-root resolution; optional per-type "primary/default root" concept; missing-attribute set surfaced on the classification. |
| tasks.md | Add | New phased tasks for A/B/C/D + Layer-1 and Windows-E2E tests; coverage-matrix update. |
| quickstart.md | Modify | Add E2E scenarios: calibration destination, inbox→root selection, multi-root selection prompt, single-root auto, missing-date gate. |

## Risk Checks

- [x] No completed 041 *task* is invalidated — work is additive on the merged, working apply path.
- [⚠] **Modifies merged behavior**: (B) changes `confirm.rs`'s `to_root_id = from_root_id` rule and (A) changes calibration destinations — US4/US5 acceptance scenarios are *updated*, not removed. User acknowledged.
- [x] No scope-boundary violation — stays within the inbox plan surface.
- [x] No downstream dependency breaks.

## Planned Changes

### spec.md

- **New User Story 8 — Destination-root selection for moves (P2)**: default is move-in-place within the source's own root; inbox-kind sources are never a destination and must move into a specific library root; when >1 registered root exists for the target frame type the user must explicitly pick the destination root during plan review; with exactly one candidate root, selection is automatic (no prompt). Acceptance scenarios for: single-root auto, multi-root required selection, inbox always-select, in-place default for a non-inbox unorganized source.
- **New User Story 9 — Mandatory capture of missing path attributes (P2)**: a plan cannot be generated/applied while any path-load-bearing attribute for a file is missing; the file routes through the existing "needs review"/unclassified gate (same UX as missing IMAGETYP) until the user supplies the value. Acceptance scenarios for: missing DATE-OBS on a light blocks plan + prompts; missing exposure on a dark blocks; supplying the value clears the gate and the destination updates.
- **FR-025**: The destination path structure MUST be **configurable per frame-type class**, with a distinct token-based pattern for each of (at minimum): **light, flat, master flat, bias, master bias, dark, master dark**. Patterns are edited in Settings using the shared token vocabulary (the same tokens used elsewhere for path variables).
- **FR-026**: Each per-type pattern MUST ship a **sensible default** reflecting which attributes are meaningful for that type — and calibration types MUST NOT include a target segment. Default intent:
  - **light**: target / filter / date (current behaviour).
  - **flat**: filter / date (flats are per-night, per-filter; no target).
  - **dark**: exposure [+ gain/temp/binning as configured]; no filter, no target.
  - **bias**: [gain/temp/binning]; no filter, no date, no target.
  - **master flat / master bias / master dark**: same key attributes as their raw counterpart **minus date** (masters are not per-night), no target.
- **FR-026a**: The resolver MUST select the pattern by the file's **resolved type including master-vs-raw** (a master dark uses the master-dark pattern, etc.), applying the configured pattern with the shared tokens.
- **FR-026b**: Per-type patterns MUST be **persisted in settings** and overridable by the user; invalid/empty patterns fall back to the built-in default for that type. (Light-master / integration routing — stacked lights — is out of this list and TBD; flag for confirmation.)
- **FR-027**: For a move from a non-inbox source, the default destination root is the source's own root (reorganize in place).
- **FR-028**: Inbox-kind sources MUST move into a chosen library root (never catalogued/left in place); a destination root is always required for inbox items.
- **FR-029**: When more than one registered root is a valid destination for the item's frame type, the user MUST explicitly select the destination root before the plan can be applied.
- **FR-030**: When exactly one valid destination root exists for the frame type, it is selected automatically with no prompt.
- **FR-031**: The plan/review surface MUST display the full absolute destination path (selected root path + relative path) for each action, not just the root-relative path.
- **FR-032**: Plan generation MUST be gated on the presence of every path-load-bearing attribute for each file; missing values block the plan and surface the file in the needs-review flow (consistent with missing IMAGETYP).
- **FR-033**: The set of path-load-bearing attributes MUST be defined per frame type (enumerated in research.md) and drive both the gate (FR-032) and the destination structure (FR-025/FR-026).
- Update **US4** scenarios: catalogue-in-place unchanged; move scenarios now reference destination-root selection (FR-027..FR-030) and absolute-path preview (FR-031).
- Update **US5** scenarios: split actions route per-type using the light/calibration structure split (FR-025/FR-026) and respect root selection.

### plan.md

- Pattern resolver (`crates/patterns`): support a **per-type pattern** (light/flat/master-flat/bias/master-bias/dark/master-dark) loaded from settings, with a selector that picks the pattern by the file's resolved type (incl. master-vs-raw) and built-in default fallback.
- Settings (`crates/persistence/db` + settings surface + `apps/desktop` Settings UI): persist and edit the per-type patterns using the shared token vocabulary; validate tokens; reset-to-default per type.
- `crates/app/core/src/inbox/confirm.rs`: replace the unconditional `to_root_id = from_root_id` with destination-root resolution — in-place default, inbox-must-target, candidate-root enumeration by frame type, ambiguity → require caller-supplied `root_id`; build absolute destination preview.
- `crates/app/core/src/inbox/classify.rs` (+ contracts): compute and surface the per-file missing-path-attribute set; confirm rejects with a typed error when required attributes are missing or the destination root is ambiguous and unselected.
- Contracts / bindings: `inbox_confirm` request gains an optional destination `root_id`; classify/plan responses carry the absolute destination and the missing-attribute requirements + candidate roots.
- Frontend (`InboxDetail`/`PlanPanel`): destination-root picker (shown only when ambiguous / for inbox), absolute-path display, and a missing-attribute input gate mirroring the IMAGETYP flow.

### research.md

- New decision: **per-type destination patterns** (light, flat, master flat, bias, master bias, dark, master dark) — document the token vocabulary, the default pattern for each type, and the rationale (which attributes matter per type), per Constitution Principle IV. Keep user-configurable.
- New table: path-load-bearing attribute matrix per frame type (light/dark/flat/bias, raw vs master) → drives both the default patterns (FR-025/FR-026) and the missing-attribute gate (FR-032/FR-033).

### data-model.md

- **Per-type destination pattern settings**: a stored pattern string per type (light/flat/master-flat/bias/master-bias/dark/master-dark), with built-in defaults.
- Confirm/plan request: optional selected destination `root_id`.
- Candidate-root resolution by frame type; optional per-type default/primary root concept (for FR-030 auto-select and future config).
- Classification surfaces `missing_path_attributes` per file.

### tasks.md

- New phase(s): calibration structure (resolver + research), destination-root selection (backend resolution + contract + frontend picker), absolute-path preview, missing-attribute gate (backend + frontend), with Layer-1 tests and Windows-E2E journeys; update `specs/037-e2e-integration-testing/contracts/coverage-matrix.md`.

### quickstart.md

- Add scenarios: calibration frame lands in calibration structure (no target); inbox item requires root selection; multi-root prompt vs single-root auto; missing-DATE-OBS light blocks plan and is fixed via the needs-review input.
