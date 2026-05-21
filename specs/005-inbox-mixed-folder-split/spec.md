# Feature Specification: Inbox Mixed-Folder Split

**Feature Branch**: `005-inbox-mixed-folder-split`  
**Created**: 2026-05-09  
**Updated**: 2026-05-20  
**Status**: Draft (mockup-only; pre-implementation forward fill)  
**Input**: User description: "Specify how mixed folders are detected in Inbox, warned about, split into separate Inbox folders, and only then moved into Inventory."

## Implementation Status

A non-binding mockup exists in `apps/desktop/` to validate the interaction
model. It is **not** the canonical behavior and MUST NOT be treated as
authoritative once Rust/contract work begins.

Mockup-only evidence (May 2026):

- `apps/desktop/src/features/inbox/InboxPage.tsx`: drawer with file-level
  breakdown, contextual CTA toggling between "Generate split plan" (mixed)
  and "Confirm to Inventory" (single-type). Existing open plans for the same
  Inbox item are short-circuited via `useMemo` filtering of `usePlans()`.
- `apps/desktop/src/data/store.ts` (`createPlanFromInbox(item)`): builds
  per-file plan items, capped to `item.files` for sample folders and fully
  expanded otherwise; classifies items from `mixedBreakdown` or
  `sampleFiles`; sets `itemsTotal: items.length`; `simulateApply` advances
  the plan state machine.
- `apps/desktop/src/data/mock.ts`: `InboxItem` shape with `mixedBreakdown`,
  `sampleFiles`, `destinationPattern`.

The mockup does **not** read FITS headers, does **not** persist plans, does
**not** call a classifier service, and uses hand-authored seed data for both
single-type and mixed cases. The spec below defines the durable behavior the
Rust core and contracts MUST honor; the mockup will be retired or migrated
once those exist.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Detect Mixed vs Single-Type Folders (Priority: P1)

As a user scanning Inbox, I want each candidate folder classified as either
"single frame type" or "mixed", with the classification grounded in image
metadata (not only filenames), so that mixed data cannot be silently confirmed
into Inventory and single-type folders can be confirmed without a split step.

**Why this priority**: Classification is the gate; every downstream action
(confirm, split, plan apply) branches on this single decision. Without it the
inbox is unsafe and the user cannot trust frame-type promises made to
calibration matching (spec 001) or to project lifecycle (spec 002).

**Independent Test**: Point the scanner at two fixture folders — one pure
lights, one mixed lights + darks — and confirm the Inbox row for each shows
the correct classification with at least one piece of metadata-derived
evidence per detected type.

**Acceptance Scenarios**:

1. **Given** a folder where every readable FITS header reports `IMAGETYP=LIGHT`,
   **When** the scan completes, **Then** the Inbox row is classified
   single-type "light" with a confidence value and the primary CTA is
   "Confirm to Inventory".
2. **Given** a folder where readable headers report a mix of `IMAGETYP=LIGHT`
   and `IMAGETYP=DARK`, **When** the scan completes, **Then** the Inbox row is
   classified "mixed", lists the detected types with per-type counts, and the
   primary CTA is "Generate split plan".
3. **Given** a folder where headers are missing or unreadable for some files,
   **When** the scan completes, **Then** unclassified files are listed
   separately and do not silently inherit the majority classification.

---

### User Story 2 - Surface File-Level Breakdown (Priority: P2)

As a user reviewing a flagged folder, I want a per-type breakdown with
representative sample files and the evidence that drove each classification,
so that I can verify the system's judgement before triggering a filesystem
plan.

**Why this priority**: The split CTA is destructive in intent (it eventually
moves files). Users must be able to inspect why a folder is "mixed" without
opening files in a third-party tool.

**Independent Test**: Open the detail drawer for a mixed Inbox item and
confirm the visible breakdown lists each detected frame type, the count of
files per type, at least one sample filename per type, and the destination
pattern that would be produced by a split plan.

**Acceptance Scenarios**:

1. **Given** a mixed Inbox item with 50 lights and 12 darks, **When** the
   user opens the detail drawer, **Then** the drawer shows two rows
   ("LIGHT × 50", "DARK × 12") each with a sample file and a destination
   path preview rendered through the active Naming & Structure pattern
   (spec 015).
2. **Given** the detail drawer is open, **When** any file's classification
   confidence is below the configured threshold, **Then** that file appears
   in a "Needs review" sub-list rather than being attributed to a frame-type
   group.

---

### User Story 3 - Generate Split Plan From Mixed Folder (Priority: P3)

As a user, I want the "Generate split plan" CTA to produce a reviewable
filesystem plan — one plan item per file, grouped by frame type, with
destination paths driven by the Naming & Structure token pattern — so that
the actual move into Inventory passes through the standard plan-apply
pipeline (specs 017 and 025) with audit records and rollback.

**Why this priority**: This is the bridge from classification to the
existing reviewable-mutation pipeline. It MUST NOT introduce a parallel
mutation path.

**Independent Test**: From a mixed Inbox item, trigger "Generate split
plan", confirm the plan appears in the Plans list in state
`ready_for_review`, contains one item per scanned file, and that the
destination paths match the active Naming & Structure pattern when
expanded against each file's extracted metadata.

**Acceptance Scenarios**:

1. **Given** a mixed Inbox item with 62 files, **When** the user triggers
   "Generate split plan", **Then** a new Plan is created with 62 plan items
   grouped by frame type, state `ready_for_review`, and a back-reference to
   the originating Inbox item.
2. **Given** the active Naming & Structure pattern is unset or invalid,
   **When** the user triggers "Generate split plan", **Then** the operation
   is rejected with error code `pattern.unset` and no plan is created.
3. **Given** the plan reaches `applied`, **When** the user re-opens the
   Inbox, **Then** the originating Inbox item is marked resolved and its
   files no longer appear as candidates.

---

### User Story 4 - Dedupe Open Plan For Same Inbox Item (Priority: P4)

As a user who clicked "Generate split plan" earlier, I want returning to
the same Inbox item to short-circuit to the existing open plan instead of
creating a duplicate, so that I never have two parallel reviewable plans
mutating the same files.

**Why this priority**: Two concurrent plans on one Inbox item creates a
filesystem race and breaks the "one open plan per Inbox item" invariant
that the rest of the workflow relies on.

**Independent Test**: Generate a split plan for a mixed Inbox item, leave
it in `ready_for_review`, return to the Inbox item, and confirm the CTA is
"Open existing plan" rather than "Generate split plan" and that activating
it routes to the existing plan.

**Acceptance Scenarios**:

1. **Given** an Inbox item already has a Plan in state {`draft`,
   `ready_for_review`, `approved`, `applying`}, **When** the user opens the
   detail drawer, **Then** the primary CTA is "Open existing plan" and
   references the existing `plan_id`.
2. **Given** an Inbox item's prior Plan reached state `applied`,
   `discarded`, or `failed`, **When** the user opens the detail drawer,
   **Then** a new "Generate split plan" CTA is available.
3. **Given** a user attempts the `inbox.confirm` operation while a plan is
   already open, **When** the request is processed, **Then** the operation
   is rejected with `inbox.has.open.plan` and includes the existing
   `plan_id`.

### Edge Cases

- Folder contains files whose headers are unreadable, malformed, or
  truncated. These MUST surface in a "Needs review" group and MUST NOT be
  silently dropped.
- Folder mixes FITS and XISF, both with frame-type metadata. The classifier
  MUST treat them uniformly via `crates/metadata/core` regardless of
  container.
- Folder contains video files (planetary/lunar). [NEEDS DECISION: are video
  files in scope for the mixed/single classifier, or always routed to a
  separate Inbox lane?]
- All files share the same `IMAGETYP` but different `FILTER` values
  (e.g., LRGB lights in one folder). [NEEDS DECISION: does "mixed filter"
  count as "mixed" for split purposes, or only "mixed frame type"?]
- Folder is on a read-only mount or external drive that is currently
  detached.
- A single file fails to read mid-plan-generation.
- User edits the Naming & Structure pattern (spec 015) between
  classification and plan generation: the plan MUST be built against the
  pattern resolved at generation time, recorded with the plan.

### Domain Questions To Resolve

- [NEEDS DECISION: Confidence threshold for `mixed` vs `single-type`
  classification — research.md proposes a default but requires fixture
  validation.]
- [NEEDS DECISION: Are filter mismatches a "mixed" condition? See edge
  cases.]
- [NEEDS DECISION: Should split plans physically move files into separate
  sibling folders under the Inbox root before Inventory promotion, or move
  directly into Inventory paths? Current mockup uses the second model but
  spec 005's original prose used the first.]
- [NEEDS DECISION: Can users manually re-classify individual files before
  generating the plan, and if so does that bypass the confidence threshold?]

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST classify each Inbox folder as `single-type`,
  `mixed`, or `unclassified` using metadata-derived evidence and MUST attach
  a confidence value and at least one evidence record per detected type.
- **FR-002**: Mixed folders MUST NOT be confirmable directly to Inventory.
  The `inbox.confirm` operation MUST reject mixed items with error
  `classification.ambiguous`.
- **FR-003**: Single-type folders with confidence at or above the configured
  threshold MUST be confirmable to Inventory via a single CTA without going
  through a split flow.
- **FR-004**: Mixed folders MUST present a file-level breakdown listing each
  detected frame type, per-type file count, at least one sample filename per
  type, and the destination path preview produced by the active Naming &
  Structure pattern (spec 015).
- **FR-005**: Files whose classification confidence is below the threshold
  MUST appear in a "Needs review" group and MUST NOT be auto-assigned to a
  detected type.
- **FR-006**: "Generate split plan" MUST produce a single Plan with one plan
  item per scanned file, grouped by frame type, in state
  `ready_for_review`, with a back-reference to the originating Inbox item.
- **FR-007**: Plan generation MUST resolve destination paths through the
  active Naming & Structure token pattern (spec 015) at generation time and
  record the resolved pattern on the plan.
- **FR-008**: An Inbox item MUST have at most one open Plan at a time, where
  "open" means any state in {`draft`, `ready_for_review`, `approved`,
  `applying`}. Attempting to create a second open Plan MUST fail with
  `inbox.has.open.plan` and surface the existing `plan_id`.
- **FR-009**: Plan apply MUST flow through the standard reviewable-mutation
  pipeline (specs 017 and 025); this feature MUST NOT introduce a parallel
  mutation path or bypass audit records.
- **FR-010**: On successful plan apply, the originating Inbox item MUST be
  marked resolved and its files MUST no longer surface as Inbox candidates.
- **FR-011**: If the active Naming & Structure pattern is unset, invalid, or
  fails to resolve required tokens for any file, plan generation MUST fail
  with `pattern.unset` and no plan MUST be created.
- **FR-012**: Classification MUST be re-runnable per Inbox item without
  rescanning the entire Inbox root (`force_rescan` flag on
  `inbox.classify`).

### Key Entities

- **Inbox Item**: A candidate folder under an Inbox root, with files,
  classification result, and at most one open Plan.
- **Inbox Classification**: A result describing whether the item is
  `single-type`, `mixed`, or `unclassified`, with confidence and evidence.
- **Inbox Breakdown Entry**: One row per detected frame type: type, count,
  destination preview, sample files.
- **Plan (cross-spec reference)**: Reviewable filesystem plan as defined by
  spec 017; this feature is a producer.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of mixed fixture folders in the test corpus are
  classified `mixed` and blocked from direct Inventory confirmation.
- **SC-002**: 100% of single-type fixture folders are confirmable in one
  click without traversing the split flow.
- **SC-003**: Re-opening an Inbox item with an open plan never creates a
  duplicate plan (verified by contract test on `inbox.confirm`).
- **SC-004**: Generating a split plan for a 500-file mixed folder completes
  in under 5 seconds on the reference dev workstation (excludes initial
  metadata scan time).
- **SC-005**: Users can resolve a representative mixed folder end-to-end
  (classify → review → generate → apply) in under 2 minutes.

## Assumptions

- The Naming & Structure token pattern (spec 015) is the single source of
  truth for destination paths. This feature consumes it; it does not
  redefine destination logic.
- The reviewable-mutation pipeline (specs 017 and 025) owns plan state
  transitions and audit records. This feature owns only plan creation.
- Frame-type primary signal is FITS/XISF `IMAGETYP`. Filename heuristics are
  fallback evidence only and reduce confidence.
- Inbox items represent folders, not individual files. A single rogue file
  inside an otherwise-uniform folder produces a `mixed` classification, not
  a separate Inbox item.

## Out of Scope

- Calibration matching (spec 001 owns this).
- Project lifecycle and promotion to projects (spec 002 owns this).
- Image processing (PixInsight/WBPP boundary per constitution).
- Automatic split application without user review.
- Cross-folder deduplication or merging of split outputs.
- Editing the Naming & Structure token pattern from inside the Inbox flow
  (spec 015 owns the pattern editor).
