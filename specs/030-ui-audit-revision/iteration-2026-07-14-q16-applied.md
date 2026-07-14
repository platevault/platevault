---
status: applied
created: 2026-07-14
applied: 2026-07-14
change_request: "Formalize grilling decision Q16 (docs/development/ui-campaign-grilling-decisions-2026-07-13.md §Q16, issues #620/#619) — missing-value semantics + detail-as-delta. LOCKED decisions: (A) Missing-value semantics fixed AT THE MODEL, then a shared renderer. Three distinguishable states everywhere: real value (incl. real 0), unresolved/missing (no data), not-applicable. Missing = null/None END-TO-END (extraction → contract → UI); NEVER default numerics to 0. One shared renderValue(value, {source}): real → value + source pill; missing → distinct muted 'unresolved' chip, NO source pill, never 0; n/a → blank/'—' without chip. Cross-cutting (Sessions, Calibration, Targets, everywhere); must start in the data model. (B) Detail-as-delta: detail panels ADD information (full metadata, provenance/source, related entities, history, actions), lead with what's new, minimal + curated, small identifying summary ok."
scope: "Feature-wide (new requirement block: missing-value semantics + detail-panel content model)"
---

## Change Summary

Add missing-value-semantics and detail-as-delta requirements (grilling Q16,
issues #620/#619) to spec-030: three distinguishable value states (real /
unresolved / not-applicable) modeled as null/None end-to-end with no numeric
zero-defaulting, rendered through one shared renderer, and detail panels
reframed to add information over their list rows.

## Implementation Progress

- **Tasks completed**: tasks.md checkboxes are all `[ ]` (0 of 117 ticked),
  but spec-030 was implemented issue-driven — see `issue-map.md`. Checkbox
  state is not authoritative for this spec (same finding as the Q15
  iteration, `iteration-2026-07-14-applied.md`).
- **Current phase**: post-implementation campaign; #620 (missing rendered as
  attributed/zeroed data) and #619 (detail panels echo list columns) are open
  findings against the shipped UI.
- **Adhoc changes**: None on this branch (branch is spec-artifact-only).

### Current value path (read-only orientation, cited)

The model already loses absence before the UI can render it:

1. **Extraction preserves absence** — the shared metadata model is
   `Option`-typed throughout (`crates/metadata/core/src/lib.rs:221`
   `exposure: Option<String>`, `:223` `gain: Option<String>`, plus ~25 more
   optional numeric fields).
2. **Persistence preserves absence** — the calibration query row keeps
   nullable fingerprint fields
   (`crates/persistence/db/src/repositories/q_calibration.rs:93-94`
   `fp_gain: Option<f64>`, `fp_exposure_s: Option<f64>`).
3. **The app layer destroys it** —
   `crates/app/calibration/src/matching.rs:739,741` and `:794,796` map the
   nullable row into the contract with `fp_exposure_s.unwrap_or(0.0)` /
   `fp_gain.unwrap_or(0.0)`; size follows the same pattern
   (`:748,803` `u64::try_from(r.size_bytes).unwrap_or(0)`).
4. **The contract cannot carry it** — `CalibrationFingerprint` declares
   `exposure_s: f64` and `gain: f64` non-optional
   (`crates/contracts/core/src/calibration.rs:96,99`), so missing cannot
   round-trip even if step 3 were fixed.
5. **UI null-checks are dead code** — `MastersTable.tsx:116,126` guard with
   `!= null`, but the value is never null by the time it arrives; a
   metadata-less master renders "Gain 0 · Exposure 0s · Size 0 KB"
   indistinguishable from a real Gain 0.
6. **Renderer conflates missing with n/a and attributes absence** —
   `apps/desktop/src/components/PropertyTable.tsx:44-48`
   (`formatDisplayValue`) renders `null` as `—` for both missing and
   not-applicable, and the source badge (`:181-197`) renders whenever
   `prop.source` is set regardless of value presence — an em-dash still gets
   a "FITS" pill (absence rendered as attributed data, #620).

## Impact Assessment

| Artifact | Action | Details |
|----------|--------|---------|
| spec.md | Modify | New FR block **Missing-Value Semantics & Detail Panels** (FR-135–FR-140); new SC-010, SC-011; new detailed-spec section 12; Iterations log entry |
| plan.md | Modify | New implementation phase **H. Missing-Value Semantics & Detail-as-Delta**; technical-context note on the value path with citations |
| tasks.md | Add | New **Phase 11: Missing-Value Semantics & Detail-as-Delta (Q16 / #620, #619)**, tasks T128–T134; dependencies note |
| data-model.md | Add | New section **Metadata Value States** (three-state model, null end-to-end rule, contract optionality mapping, n/a determination) |
| contracts/commands.md | Add | New section on missing-value semantics: absence-capable DTO fields MUST be nullable (e.g. `CalibrationFingerprint.exposureS`/`gain`); sentinel-zero prohibited; no new commands |
| research.md | No change | — |
| quickstart.md | No change | — |
| issue-map.md | No change | New tasks get issues via `/speckit.taskstoissues` later, not in this iteration |

## Risk Checks

- [x] No completed tasks invalidated — tasks.md has no ticked tasks; shipped
  issue-driven work is affected at the model/contract level (zero-defaulting
  emitters and non-optional DTO fields need optionality), which is exactly
  what the new Phase 11 tasks cover.
- [x] No scope boundary violations — PropertyTable, detail panels, and the
  shared-component layer are already spec-030 scope (FR-032, plan Phase A);
  Q16's iterate-map row assigns it to the spec-030 campaign (data-model +
  shared renderer).
- [x] No downstream dependency breaks — Phase 11 depends only on the shipped
  metadata/contract plumbing and the shared PropertyTable component; it is
  independent of Phases 3–10. Contract optionality changes are
  loosening-only at the transport layer (fields become nullable), but each
  consumer of the affected DTOs must be swept in the same task to keep
  generated bindings compiling.

## Planned Changes

### spec.md

1. Add a new FR group **"Missing-Value Semantics & Detail Panels"** after
   the "Durable Audit Coverage" FR group (FR-130–FR-134), numbered
   FR-135–FR-140:
   - **FR-135**: Every displayed metadata field MUST be distinguishable in
     one of three states everywhere it renders: a real value (including a
     real 0), unresolved/missing (no data), or not-applicable (the field
     does not apply to the entity). The three states MUST be modeled, not
     inferred at render time.
   - **FR-136**: Missing values MUST be represented as null/None end-to-end
     — extraction → persistence → application layer → contract → UI.
     Numeric fields MUST NEVER default to 0 (or any other sentinel) to
     stand in for absence; contract DTO fields whose values can be absent
     MUST be nullable.
   - **FR-137**: One shared value renderer MUST be used everywhere metadata
     values are displayed — `renderValue(value, {source})`: real value →
     the value plus its source pill; unresolved → a distinct muted
     "unresolved" chip, never 0; not-applicable → blank/"—" without any
     chip.
   - **FR-138**: Source/provenance indicators MUST only appear for present
     values. Absence MUST NOT be attributed to a source (no "FITS" pill on
     a missing value).
   - **FR-139**: Detail panels MUST add information beyond the selected
     row's list columns — full metadata, provenance/source, related
     entities, history, and actions — and MUST lead with what is new. A
     small identifying summary of the row is permitted but MUST NOT
     dominate the panel.
   - **FR-140**: Detail panels MUST stay minimal and curated — only
     relevant data for the entity, not a raw dump of every available field.
2. Add **SC-010**: A calibration master (or any entity) with missing
   numeric metadata never displays a defaulted 0 (e.g., "Gain 0",
   "Exposure 0s", "Size 0 KB"); 100% of metadata value renderings across
   Inbox, Sessions, Calibration, Targets, and Archive go through the shared
   renderer and are distinguishable as real / unresolved / not-applicable.
3. Add **SC-011**: Every detail panel presents at least one information
   class (full metadata, provenance, related entities, history, or actions)
   that is not present in its list row.
4. Add detailed-spec **section 12 "Missing-Value Semantics & Detail-as-Delta
   (Q16 / #620, #619)"** after section 11: the three-state model, the
   end-to-end null rule with the current value-path failure chain, the
   shared renderer contract, the source-pill coupling rule, and the
   detail-as-delta content model.
5. Append an Iterations log entry for this iteration after the Q15 entry.

### plan.md

1. Add row **H. Missing-Value Semantics & Detail-as-Delta** to the
   Implementation Phases table: contract/model optionality sweep, shared
   renderer, adoption across all metadata surfaces, detail-panel delta
   rework.
2. Add a technical-context note documenting the current value path (the
   six-step chain from the orientation section, with citations).

### tasks.md

Add **Phase 11: Missing-Value Semantics & Detail-as-Delta (Q16 / #620,
#619)** after Phase 10:

- T128: Make absence representable in contract DTOs: `CalibrationFingerprint.exposure_s`/`gain` (and other absence-capable non-optional numeric fields found by sweep) become `Option`; regenerate bindings; sweep DTO consumers.
- T129: Remove zero-defaulting in the application layer (`crates/app/calibration/src/matching.rs:739,741,794,796` `unwrap_or(0.0)`; size `:748,803`); repo-wide sweep for `unwrap_or(0`/`unwrap_or_default` collapsing absent metadata; carry `Option` through to the contract.
- T130: Shared `renderValue(value, {source})` renderer + muted "unresolved" chip component: real → value + source pill; missing → unresolved chip, no source pill, never 0; n/a → blank/"—" without chip.
- T131: PropertyTable adopts the shared renderer: couple source badge to value presence (no badge when value missing), distinguish n/a from missing in `PropertyDef` (explicit n/a marker, not null-overload).
- T132: Adopt the shared renderer across all metadata surfaces: Inbox review, Sessions detail, Calibration (incl. `MastersTable` meta lines/cells), Targets, Archive.
- T133: Detail-as-delta rework: audit every detail panel against its list row; lead with new information (full metadata, provenance, related entities, history, actions); trim echoed columns to a small identifying summary; keep panels curated.
- T134: Tests: real 0 renders as "0" with source pill; missing numeric renders unresolved chip (never 0, no source pill); n/a renders blank/"—" without chip; contract round-trips null; each detail panel adds ≥1 non-row information class.

Update "Dependencies & Execution Order": Phase 11 depends on shipped
metadata/contract plumbing and shared components (Phase 2) only;
independent of Phases 3–10. T128–T129 first (model), T130–T131 next
(renderer), T132–T133 parallel after, T134 last.

### data-model.md

Add section **"Metadata Value States"**: the three-state model (real /
unresolved / not-applicable), the null-end-to-end rule (nullable DB columns
→ `Option` app types → nullable contract DTO fields — no sentinel zeros at
any hop), the mapping for the known offender
(`CalibrationFingerprint.exposure_s`/`gain` non-optional today), and the
rule that not-applicable is determined by the entity/frame-type model
(e.g., filter on a dark, set-temp on flats/bias per spec §2.2), never by
data absence.

### contracts/commands.md

Add section **"Missing-Value Semantics (iteration 2026-07-14, Q16 /
#620)"**: no new commands; DTO fields whose values can be absent at
extraction MUST be declared nullable (first fix:
`CalibrationFingerprint.exposureS`/`gain`); returning a sentinel 0 for a
missing value is prohibited; UIs distinguish unresolved from
not-applicable from the model, not by inspecting rendered strings.

### research.md

- (No changes)

### quickstart.md

- (No changes)
