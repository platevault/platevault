# Requirements Quality Checklist: Inbox — Drop Parent Items

**Purpose**: Requirements-quality gate over `spec.md` + `plan.md` + `tasks.md`.
This spec went `specify → plan` directly, skipping the checklist step; this run
closes that gap before implementation begins.
**Created**: 2026-07-20
**Feature**: [spec.md](../spec.md)

**Depth**: Standard · **Audience**: Reviewer (PR) · **Timing**: pre-implementation

> Run non-interactively at the user's request ("work autonomously, log
> ambiguities"). The skill's three clarifying questions were resolved to their
> documented defaults rather than asked. Focus areas were taken from the
> invocation: clarity, completeness and testability across the twelve success
> criteria.

**These are unit tests for the requirements, not for the implementation.** Each
item asks whether something is *written well*, not whether the code works.

---

## Blocking — resolve before implementation

- [ ] CHK001 Is D-004's greenfield licence still valid? It states "there are no
      current installs (product owner, resolving Q-1)" and explicitly scopes
      itself: *"This licence is conditional on that fact. If any part of this
      work lands after the product has real users, the question reopens."*
      **Five public releases exist — v0.1.0 through v0.5.0, latest 2026-07-12.**
      The spec's own precondition appears to be false. [Assumption, Conflict,
      Spec §D-004]
- [ ] CHK002 If installs exist, is the accepted risk still acceptable — that
      "open inbox plans and confirmed-but-unapplied inbox items would be
      stranded"? The spec accepts this only because "the stranding cannot reach
      a user". Is there a requirement covering what a user with an existing
      library database sees on first launch after this change? [Gap, Spec §D-004,
      §FR-027]
- [ ] CHK003 Is the needs-review split gap decided? The edge case that a
      heterogeneous needs-review bucket resolving into two frame types "arguably
      ought to **split**" is recorded as "a gap to size, not a decision taken",
      and `tasks.md` carries no task for it. Entering implementation with an
      undecided model question is what this gate exists to catch. [Ambiguity,
      Spec §Edge Cases, §Next Gates item 2]

## Requirement Consistency

- [ ] CHK004 Does FR-031 still describe the state of the world? It says the
      `mixed` affordance "MUST be retained for as long as placeholder rows
      exist" and that "the plan gate MUST decide whether the affordance is then
      retired or re-scoped". The plan gate **did** decide (PG-1: retired), and
      T035 implements the retirement — but FR-031's text still reads as an open
      question. [Conflict, Spec §FR-031 vs plan.md §PG-1]
- [ ] CHK005 Is FR-001 consistent with the calibration-master carve-out? FR-015
      was scoped to permit master rows at scan time, but FR-001 — "MUST NOT
      create any inbox item that lacks a classification identity, **at any
      point**" — was not similarly scoped. Per issue #1157 master rows carry
      `group_key = ''`, and FR-028 narrows `group_key` to *be* the classification
      identity. Read together, shipped master rows violate FR-001. [Conflict,
      Spec §FR-001 vs §FR-015, §FR-028, #1157]
- [ ] CHK006 Do FR-006 and the target-recommendation path agree? FR-006 forbids
      designating any sibling as primary or authoritative, but no requirement
      mentions target recommendations at all — the surface where `resolve_item_id`
      does exactly that. The decision is now recorded on #1102, but is it
      reflected in the requirements? [Gap, Spec §FR-006, #1102/T003]
- [ ] CHK007 Is SC-009 marked as descoped *where a reader will look for it*? The
      descoping is stated under FR-020–022 and in D-005's commentary, but SC-009's
      own text in the Success Criteria list reads as a live exit criterion with
      no marker. A completion sweep reading only that section would tick it —
      the exact failure T043 exists to prevent. [Clarity, Consistency,
      Spec §SC-009]
- [ ] CHK008 Do FR-013's requirement text and its status annotation agree? It is
      written as a live MUST while its own italicised note says "No work remains
      under this requirement" (delivered by #1105). Is a shipped requirement
      distinguishable from an outstanding one at a glance? [Clarity, Spec §FR-013]

## Requirement Completeness

- [ ] CHK009 Are requirements defined for the sentinel collision #1157
      describes? FR-028 removes `group_key`'s discriminator role but no
      requirement states what happens to rows that legitimately carry an empty
      group key, nor that placeholder-scoped predicates must be re-scoped when
      the placeholder disappears. [Gap, #1157, Spec §FR-028]
- [ ] CHK010 Do the requirements state whether source-group rows count toward
      the Inbox summary counts? FR-009 and SC-004 require counts to equal the
      rows the list shows, and D-006 makes unclassified folders visible rows —
      but nothing says whether those rows are counted. T022 must implement one
      answer or the other. [Gap, Ambiguity, Spec §FR-009, §SC-004, §D-006]
- [ ] CHK011 Is the required end state of selection continuity specified? FR-023
      says selection "MUST NOT be silently dropped" when one source-group row
      becomes N item rows, but does not say what selection *should* be
      afterwards — no selection, the first sibling, or the whole group. "Not
      silently dropped" is a prohibition, not a specification. [Clarity,
      Measurability, Spec §FR-023]
- [ ] CHK012 Are requirements defined for a folder of calibration masters as a
      distinct row shape? It is neither uniform, mixed, nor needs-review, yet it
      is confirmable at scan time — which is the qualification PG-2 had to make
      to its own harness invariant. [Coverage, Gap, Spec §FR-015, plan.md §PG-2]
- [ ] CHK013 Do the requirements say whether a folder containing masters
      *and* classifiable files produces a source-group row alongside its master
      rows, or only master rows? The mixed case is unaddressed. [Gap, Edge Case,
      Spec §FR-015, §FR-016]
- [ ] CHK014 Is folder grouping's default state specified? FR-025 requires the
      list to "offer" grouping by folder and SC-010 requires a user to be able to
      group — neither says whether it is on by default, nor how grouping renders a
      folder represented by a source-group row rather than items. Q-8 recorded an
      engine limitation; is it reflected as a requirement? [Gap, Spec §FR-025,
      §SC-010, §D-007]
- [ ] CHK015 Are rollback requirements defined for the migration this feature
      adds? T004 adds a schema column; no requirement covers failure of that
      migration or the state a partially-migrated database is left in.
      [Gap, Exception Flow, Constitution §II]
- [ ] CHK016 Are requirements defined for the ordering of sibling rows within a
      folder? D-002 forbids a distinguished member, but a list must render in
      *some* order, and an unspecified order is how `ids.next()` became a defect
      in the first place. [Gap, Spec §D-002, §FR-025]

## Acceptance Criteria Quality

- [ ] CHK017 Can SC-002b be objectively verified? "that row is not an inbox
      item" is a statement about internal representation, not an observable.
      `contracts/operations.md` specifies structural non-confirmability (no item
      id to pass to confirm) — is that the measurable form, and is it the one
      stated? [Measurability, Spec §SC-002b]
- [ ] CHK018 Is SC-001's measurement population complete? It is measured "across
      uniform, mixed, and needs-review folders" — three shapes. A scanned but
      unclassified folder (SC-002b) and a calibration-master folder are two more
      row shapes this feature creates or preserves. [Coverage, Spec §SC-001]
- [ ] CHK019 Is SC-007 objectively checkable? "Every read-side predicate that
      exists solely to suppress an aggregate row is deleted" requires enumerating
      the predicates. `tasks.md` names four call sites and warns the count was
      once wrong; is the enumeration in the requirement or only in the task?
      [Measurability, Traceability, Spec §SC-007, tasks.md constraint 2]
- [ ] CHK020 Is SC-004's "every combination" bounded? Combinations of uniform,
      split and needs-review folders is a combinatorial claim with no stated
      enumeration, so "all pass" has no defined size. [Measurability,
      Spec §SC-004]
- [ ] CHK021 Does SC-008's "no item identity churn" define identity? Whether
      identity means the row's primary key, its `(root_id, relative_path,
      group_key)` tuple, or its user-visible selection anchor changes what the
      test asserts. [Clarity, Spec §SC-008]
- [ ] CHK022 Are the three SC-005 journeys named precisely enough to be located?
      They are described by behaviour ("catalogue-in-place zero-moves") rather
      than by test function name. [Traceability, Spec §SC-005]
- [ ] CHK023 Is the exit bar stated unambiguously in one place? The spec lists
      twelve success criteria; the real bar is eleven, because SC-009 is
      knowingly unmet. The correction lives in `tasks.md`'s verification note
      rather than in `spec.md`. [Clarity, Consistency, Spec §Success Criteria]

## Scenario & Edge Case Coverage

- [ ] CHK024 Are requirements defined for a folder whose every file is
      unclassifiable? The edge case says it becomes "a single needs-review item,
      not zero items and not a placeholder" — is that stated as a requirement, or
      only as an edge-case narrative? [Coverage, Spec §Edge Cases, §FR-001]
- [ ] CHK025 Are requirements defined for a previously split folder converging
      back to homogeneous? The edge case requires convergence "without leaving
      orphans"; no FR states the orphan-removal obligation. [Coverage, Gap,
      Spec §Edge Cases, §FR-014]
- [ ] CHK026 Are requirements defined for two folders at the same relative path
      under different roots once the list groups by folder? The edge case flags
      root-scoped identity as the reason D-007 groups on the source group — is
      that a requirement or a rationale? [Coverage, Spec §Edge Cases, §D-007]
- [ ] CHK027 Is the user-visible consequence of the surviving lifecycle
      interlock stated as a requirement or only as commentary? "A folder with one
      confirmed sibling cannot have its other siblings reclassified" is accepted
      friction that a user will hit; nothing requires it to be explained to them.
      [Gap, Spec §The one lifecycle coupling that knowingly survives]
- [ ] CHK028 Are recovery requirements defined for a re-scan that fails partway
      through re-derivation, leaving some siblings reconciled and others not?
      [Gap, Exception Flow, Recovery, Spec §FR-014, §FR-019]

## Dependencies & Assumptions

- [ ] CHK029 Is the assumption that "the lane distinction remains a folder-level
      property of the source group" still true? Issue #1021 fixed a conflation
      between `inbox_source_groups.lane` and `inbox_items.lane` — the spec
      assumes only the former exists. [Assumption, Spec §Assumptions, #1021]
- [ ] CHK030 Is the dependency on the follow-on micro-spec correctly directional?
      The spec says the follow-on "depends on this feature rather than blocking
      it", while D-005/SC-009 substance is delivered only there. Is the resulting
      partial-delivery window documented as intended? [Dependency, Spec
      §Dependencies]
- [ ] CHK031 Is the migration-number contention recorded where an implementer
      will see it? T002 warns that `0074` may not be free because PR #1048 claims
      colliding numbers. Is a stale number a requirements-traceability risk for
      `data-model.md`, which may cite a specific one? [Assumption, Traceability,
      tasks.md §T002]
- [ ] CHK032 Is `spec.md`'s **Feature Branch** field correct? It reads
      `spec/057-inbox-drop-parent-items` while the feature directory is
      `058-inbox-drop-parent-items`. [Traceability, Spec §header]

## Notes

- Check items off as resolved: `[x]`. Record the resolution inline.
- CHK001–CHK003 are **blocking**: each is a question about whether the spec's
  own stated preconditions hold, not a wording improvement.
- CHK001 is the highest-stakes item on this list. D-004 wrote its own expiry
  condition, and that condition now appears to be met.
</content>
</invoke>
