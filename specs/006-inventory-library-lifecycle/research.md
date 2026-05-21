# Research: Inventory Lifecycle

**Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Date**: 2026-05-20

This document records the Phase 0 design decisions for the Inventory surface.
Each section names the question, lists the options considered, captures
tradeoffs, and records the decision the rest of the artifacts (data-model,
contracts, tasks) inherit.

## 1. Grouped Ledger vs. Flat Ledger

**Question**: Should Inventory render as a flat table of sessions with a
"Source" column, or as a grouped ledger with one group per source root?

**Options**:

1. **Flat table with `Source` column**: Familiar shape; one row per session;
   each row carries its source path.
2. **Grouped ledger keyed by `LibraryRoot.id`**: Source path appears once per
   group as a header; rows omit the source column.
3. **Hybrid (collapsible groups, default expanded)**: Group header is a
   toggle; default expanded matches flat behaviour.

**Tradeoffs**:

- Option 1 makes the source column noisy when many sessions share a root —
  the canonical case for users with one or two external drives. It also
  bloats horizontal space, pushing acquisition facts (target, filter,
  exposure) into truncation.
- Option 2 reflects how astrophotography libraries are physically organised
  and lets the group header carry the source-state cue without per-row
  decoration. It also gives a natural location for "Rescan source",
  "Disable source", and other source-scoped actions in a future iteration.
- Option 3 adds an interaction the mockup never exercises and adds state
  that has to persist across navigations.

**Decision**: Option 2 — grouped ledger keyed by `LibraryRoot.id`. The
group header renders the source path (monospace), `kind`, and `state` as
meta text. The mockup at `apps/desktop/src/features/inventory/InventoryPage.tsx`
already implements this shape via `DataTable.groups`.

## 2. Frame-Type Vocabulary and the `mixed` Sentinel

**Question**: The filter shows `light | dark | flat | bias | mixed`. What
does `mixed` mean given that spec.md FR-009 says mixed folders must be
split before becoming Inventory items?

**Options**:

1. **Reject `mixed` as a frame type**: A session that cannot resolve to a
   single frame kind never reaches Inventory; the filter omits `mixed`.
2. **Keep `mixed` as a presentational filter value but never a stored
   value**: The filter exists for the case where a session was promoted
   then later mutated (a frame was re-classified inside the session).
3. **Allow `mixed` as a stored value**: Sessions can carry a `mixed` kind
   indefinitely and live in Inventory.

**Tradeoffs**:

- Option 1 is the cleanest but loses the recoverability story when a
  classification regresses after move-to-Inventory (e.g. user reclassifies
  one frame inside a confirmed session).
- Option 2 keeps the data model honest (no `mixed` stored value) and gives
  the UI a way to surface "this session now has heterogeneous frames"
  during a transition window. The user is expected to split or reclassify.
- Option 3 contradicts FR-009 and the spec-002 invariant that calibration
  sessions reject frame-kind heterogeneity.

**Decision**: Option 2. Stored values are `light | dark | flat | bias |
dark_flat` (mirrors spec 002 `CalibrationSession.kind` plus `light` from
`AcquisitionSession`). `mixed` is a presentational sentinel produced by
the projection when a session's member frames disagree on kind; it is the
trigger for a "split or reclassify" recovery prompt rather than a stable
state. The filter accepts `mixed` so users can find these sessions.

## 3. Review-State Semantics and Spec 002 Cross-Reference

**Question**: The mockup shows three review states (`confirmed |
needs_review | rejected`) but spec 002 defines a six-state family
(`discovered | candidate | needs_review | confirmed | rejected | ignored`).
How do the two reconcile?

**Options**:

1. **Adopt the spec-002 family verbatim in the UI**: Six states everywhere.
2. **Project spec-002 states into a three-bucket UI vocabulary**:
   `discovered` and `candidate` collapse into `needs_review` for ledger
   display; `ignored` is filter-only.
3. **Diverge — keep three-state in the data model**: The inventory record
   stores only three states, losing the candidate/ignored distinction.

**Tradeoffs**:

- Option 1 surfaces internal pipeline states (`discovered`, `candidate`)
  that have no user-facing action. Users would see a row in `discovered`
  with no available transition, which violates FR-006 (actions must be
  consistent across Inbox/Inventory/Projects).
- Option 2 keeps the user vocabulary aligned with what users actually need
  to act on — "this needs my attention" vs "I confirmed it" vs "I rejected
  it" — while preserving the underlying state for analytics, audit, and
  re-derivation. `ignored` becomes a separate filter ("Hidden") rather
  than a row decoration.
- Option 3 throws away information the system already has and complicates
  re-ingestion when a previously ignored session reappears.

**Decision**: Option 2. The projection in `crates/fs/inventory/projection.rs`
maps `discovered` and `candidate` to a presentational `needs_review`
bucket. `ignored` rows are excluded from the default ledger and surfaced
only when the review filter explicitly selects `ignored` (filter value
added in a follow-up; v1 omits `ignored` from the filter selector to keep
the visible vocabulary tight). The Tauri `inventory.session.review`
contract operates on the spec-002 state family directly; the UI sends
canonical state names, not the projected bucket.

## 4. Source-State Surfacing: Missing vs. Reconnect-Required

**Question**: `LibraryRoot.state` from spec 002 has four values (`active |
missing | disabled | reconnect_required`). Which should be visible at the
Inventory surface, and where?

**Options**:

1. **Surface only `active`**: Hide non-active groups entirely.
2. **Surface all four with the same treatment**: Show every group with its
   state in the meta line.
3. **Surface all four but differentiate `missing` and `reconnect_required`
   with diagnostic affordances**: `missing` shows a "Rescan" affordance in
   the group header; `reconnect_required` shows a "Remap path" affordance;
   `disabled` shows neither and is rendered dimmer.

**Tradeoffs**:

- Option 1 hides data the user paid for. A missing drive should still show
  its sessions so the user can see what's affected.
- Option 2 is the mockup's current shape — meta text only, no
  per-state action. It's honest but pushes recovery into a future
  iteration.
- Option 3 is ideal but introduces source-scoped actions this spec does
  not own. `LibraryRoot` state transitions live in spec 002 / spec 001.

**Decision**: Option 2 for v1, with Option 3 captured as a follow-up. The
group meta line shows `kind · state` (e.g. `external disk · missing`).
Review actions on sessions whose root is `missing` or `reconnect_required`
are still callable from the drawer; the contract layer is responsible for
refusing them with `transition.refused` and the error detail
`{ reason: "source_unavailable" }` so the UI can surface a quiet message.
Confirm actions on sessions under `disabled` roots return `state.unchanged`
when already confirmed, and `transition.refused` otherwise.

## 5. Drawer Field Ordering

**Question**: The drawer has Facts / Provenance / Linked sections plus a
Lifecycle band. What is the canonical order, and which fields are
required?

**Options**:

1. **State-first**: Lifecycle band on top; then identity (target, frame,
   filter, exposure); then equipment (camera, gain, binning, set temp);
   then provenance; then linked references.
2. **Identity-first**: Identity (target, filter, exposure) at the top; then
   lifecycle; then equipment; then provenance; then linked.
3. **Free-form**: Order is whatever the mockup happens to render today.

**Tradeoffs**:

- Option 1 puts the most actionable signal first — "what state is this in,
  and when can I confirm it?" — which matches the action-bound CTA pattern
  from spec 002.
- Option 2 reads more like a catalog entry; it buries the actionable cue.
- Option 3 risks drift; future drawers won't match this one.

**Decision**: Option 1. The canonical order is:

1. **Lifecycle band** — `State` and `Captured`.
2. **Facts** — `Target`, `Frame`, `Filter`, `Exposure`, `Camera`, then
   optional `Gain`, `Binning`, `Set temp` in that order. Missing values
   render as an em-dash, not as hidden rows, so the field stays
   discoverable.
3. **Provenance** — only renders when at least one provenance field is
   set. Fields: `Target`, `Filter`, `Inferred`, `Confirmed`.
4. **Linked** — only renders when at least one linked reference exists.
   Fields: `Project`, `Session`, `Calibration`. Project value links out
   with an `ArrowUpRight` glyph.

The footer is action-bound: `Confirm` (primary) renders only when
`state === "needs_review"`; `Reveal in OS` and `Reclassify…` always
render; overflow contains `Rename session…`, `Merge into another
session…`, `Re-open review` (only when not in `needs_review`), and
`Reject session` (danger tone, always present).

## 6. Mixed Folders and the Inbox Boundary

**Question**: Spec 006 FR-009 says mixed folders must be split before
becoming Inventory items. Where does the split happen?

**Decision**: The split happens in Inbox (spec 008 owns Inbox). Inventory
refuses promotion when an Inbox item's frame kind is `mixed`. The
`inventory.list` contract therefore never returns a stored `mixed`
session; the only `mixed` rows possible are post-promotion regressions
(see §2 above). No new entity is needed.

## 7. Resolved Open Questions From spec.md

The spec lists two domain questions to resolve. The decisions:

- **Q**: Which Inventory review fields are mandatory before a project can
  reference an item?
  **Decision**: Spec 002's action-bound review (FR-009/FR-010) governs
  this. For a `Project` to reference an `AcquisitionSession`, the
  session's `target`, `filter`, and `exposure` fields MUST have a
  `reviewed` provenance tag. Equipment fields (camera, gain, binning,
  set temp) MAY be `inferred`. Recorded in data-model.md §Required
  Reviewed Fields.

- **Q**: Which stale source conditions block project use versus only warn?
  **Decision**: `LibraryRoot.state == missing` blocks new project
  references (refuses link) but warns on existing references.
  `reconnect_required` warns on both. `disabled` blocks both. Recorded
  in data-model.md §Source-State Effects.
