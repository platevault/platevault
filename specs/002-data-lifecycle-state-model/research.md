# Research: Data Lifecycle State Model

**Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Date**: 2026-05-20

This document captures the Phase-0 decisions that gate Phase-1 design. Where
the mockup at `apps/desktop/src/data/` already concretizes a decision, we
record the choice with the file/line citation; where a decision is still open
we mark it `[NEEDS DECISION]` and propose a constitution-aligned default.

## 1. State-name selection

**Decision matrix** (chosen names in bold; alternatives shown for traceability):

| Family | Chosen names | Rejected alternatives | Why |
|---|---|---|---|
| **Project** | `setup_incomplete`, `ready`, `prepared`, `processing`, `completed`, `archived`, `blocked` | `new`/`active`/`done`, `in_progress` | Tracks workflow gates explicit in spec 001; avoids ambiguous "active" which collapses ready/prepared/processing. |
| **Plan** | `draft`, `ready_for_review`, `approved`, `applying`, `applied`, `partially_applied`, `failed`, `cancelled` | `pending`, `in_review` | Mirrors the constitution's review-before-apply gate; `partially_applied` is mandatory because real-world plans can succeed in part. |
| **Inventory session** | `confirmed`, `needs_review`, `rejected` | `valid`/`invalid`, `verified`/`unverified` | Action-bound review per Spec 001 §FR-009; "rejected" is a soft terminal that preserves the record per constitution. |
| **Data source** | `active`, `missing`, `disabled`, `reconnect_required` | `online`/`offline` | "Missing" vs "reconnect_required" lets the UI distinguish "drive unplugged" from "stored root path changed". |
| **Prepared source view** | `not_created`, `planned`, `ready`, `stale`, `retired` | `current`/`outdated` | "Stale" propagates from source mutation; "retired" is a clean tombstone. |
| **Projection** (manifest, source view) | `current`, `stale`, `regenerating` | `dirty`/`clean` | Aligns with constitutional "DB is canonical, manifests are projections". |

**Why these specific names** (constitution citations):
- "Reviewable filesystem mutation" forces a `ready_for_review` → `approved`
  separation rather than collapsing to a single `pending` state.
- "Local-first file custody" forces `missing` and `reconnect_required` because
  external drives are first-class.
- "Research-led domain modeling" rules out compact `new`/`done` pairs that
  hide the intermediate gates.

**Citations to mockup** confirming the chosen names:
- `apps/desktop/src/data/mock.ts` — `ProjectLifecycle`, `PlanState`,
  `InventorySession.state` type unions.
- `apps/desktop/src/data/store.ts:376` — `PROJECT_TRANSITIONS` table.

## 2. Transition-graph rationale

### 2.1 Project lifecycle

The mockup's `PROJECT_TRANSITIONS` (`store.ts:376`) is the authoritative
table for this round:

```
setup_incomplete → { ready, blocked }
ready            → { prepared, processing, blocked }
prepared         → { ready, processing, blocked }
processing       → { completed, blocked }
completed        → { archived, processing }     # re-open by resuming
archived         → { processing }               # unarchive resumes work
blocked          → { ready, prepared, processing, setup_incomplete }
```

Rationale for the more contested edges:

- **`processing → ready` is REJECTED.** A processing project that wants to
  reset must transition through `blocked` (or `prepared` if research is
  rerun). Allowing direct `processing → ready` would lose the user-visible
  signal that work-in-flight was reset, which violates the constitutional
  "Reviewable Filesystem Mutation" principle (lifecycle state IS reviewable).
- **`completed → processing` is ALLOWED** (re-open). This is the only legal
  way to revisit a closed project's preparation work and is consistent with
  how the mockup `Unarchive…` button works (it goes `archived → processing`,
  not `archived → completed`).
- **`archived → completed` is REJECTED.** The mockup's `setProjectLifecycle`
  default action label avoids this misleading edge by routing Unarchive
  through `processing`. Audit history therefore reads "Unarchived → resumed
  processing" rather than the false "Marked completed".
- **`blocked` is recoverable from any active stage.** A blocked project can
  resume to whichever stage the user was last on; in the mockup we store the
  prior `lastAction.label` so the audit log preserves the resume context.

### 2.2 Plan lifecycle

Established by spec 017 and reproduced here for completeness:

```
draft            → { ready_for_review, discarded }
ready_for_review → { approved, draft, discarded }
approved         → { applying, draft }            # reopen invalidates
applying         → { applied, partially_applied, failed, cancelled }
applied          → ∅ (terminal)
partially_applied→ ∅ (terminal — retry plan is a NEW plan)
failed           → ∅ (terminal — retry plan is a NEW plan)
cancelled        → ∅ (terminal)
```

Key constraint: **a retry plan is a new plan** with its own audit trail,
referencing the failed plan by id. This was confirmed in the mockup by the
"Generate retry plan for failures" CTA, which calls `createPlan(retry, parent_id)`
(future implementation) rather than mutating the failed plan in place.

### 2.3 Inventory session

```
discovered → { candidate, ignored }
candidate  → { needs_review, confirmed, rejected }
needs_review → { confirmed, rejected }
confirmed  → { needs_review, rejected }    # re-open review is allowed
rejected   → { needs_review }              # soft-terminal; can be re-opened
ignored    → { candidate }                 # un-ignore re-evaluates
```

`Re-open review` from `confirmed` is supported in the mockup at
`InventoryPage.tsx:388–394` (only renders when state ≠ needs_review).

## 3. Action-bound review vs blanket review

**Decision: action-bound (already accepted in spec 002 commit 7a681f6).**

A session's `needs_review` state does NOT block ledger listing; it only
blocks specific *actions* that depend on critical fields (e.g., assigning the
session to a project requires confirmed exposure + filter; merely listing the
row does not).

The mockup currently tracks the *session-level* review flag and renders a
"Review now…" CTA when the flag is set, but does not yet implement per-action
gating. The Rust port MUST:

1. Mark each critical-action input field with a `required_provenance: reviewed`
   tag.
2. Refuse the action with `provenance.unreviewed` if any required input is
   still `inferred` or `observed`.
3. Surface the specific blocking field to the UI, not just a generic "needs
   review" message.

`[NEEDS DECISION: Should the action-bound block emit a temporary "Review →
Continue" inline flow, or always route the user to the detail drawer to
confirm individual fields?]` Default: route to detail drawer; constitution
favors visibility over speed.

## 4. Provenance separation

Spec 002 §State Families calls out six provenance kinds. We treat them as
overlapping tags on a single value, NOT as a state-machine of one value:

| Tag | Meaning | Mutation rule |
|---|---|---|
| `observed` | Read directly from disk/header | Immutable; written once at ingest |
| `inferred` | Computed from observed values | Recomputed when observed changes |
| `reviewed` | User confirmed (possibly correcting inferred) | Persists until source changes |
| `generated` | Projection from canonical DB | Recomputed on any source change |
| `planned` | Recorded in an unapplied `FilesystemPlan` | Cleared when plan resolves |
| `applied` | Reflected in the live filesystem | Replaces `planned` on success |

A single field on a Data Asset can hold ALL of `observed`, `inferred`,
`reviewed` simultaneously (with priorities `reviewed > inferred > observed`
for display, but ALL are queryable for provenance). Rust representation:

```rust
pub struct ProvenancedValue<T> {
    pub current: T,
    pub origin: ProvenanceTag,            // which tag won
    pub history: Vec<ProvenanceEntry<T>>,  // full trail
}
```

`history` is append-only; user corrections produce a new `reviewed` entry
without erasing the prior `inferred` value (constitution: "Destructive
operations MUST prefer archive or trash over permanent deletion").

## 5. No-op guards

The mockup demonstrates two invariants that the Rust port MUST preserve:

1. **Same-state writes are no-ops** (`store.ts:457`). Calling
   `setSessionReviewState(id, "confirmed")` when the session is already
   `confirmed` returns `state.unchanged` as the contract response and writes
   neither a state mutation nor an audit event.
2. **Refused transitions log but do not mutate** (`store.ts:406-413`). A
   disallowed edge writes a `warn` log entry and returns `transition.refused`
   without touching the entity. The audit log thus contains both successful
   transitions AND attempted-but-refused transitions, which is the signal
   needed to spot UI bugs (caller offered a button that mapped to a
   disallowed edge).

These two rules MUST be transactional with the audit write: the only valid
outcomes are (a) state mutated + audit emitted, or (b) no mutation + warn log,
or (c) no mutation + nothing logged.

## 6. Projection-staleness propagation

When a Data Asset transitions in a way that mutates its observed surface
(e.g., session `confirmed → rejected`, file moved by an applied plan), every
projection that depends on it MUST be marked `stale`. The Rust port does this
via a small dependency graph:

```
PreparedSourceView ─depends_on→ AcquisitionSession[]
ProjectManifest    ─depends_on→ Project + linked Sessions
TargetIndex        ─depends_on→ Target.aliases + linked Sessions
```

On any state change to a source node, all dependents flip to
`stale`. The UI surfaces "stale" inline; regeneration is a user-triggered
action that goes through `FilesystemPlan` if it implies any filesystem write.

`[NEEDS DECISION: Should stale propagation be eager (write on every
transition) or lazy (computed on read with a `dependents_dirty_at`
timestamp)?]` Default: lazy with timestamp, for write throughput. Citation:
matches the constitution's "Large-file hashing MUST be optional or lazy".

## 7. Open option points

1. `[NEEDS DECISION: action-bound block UX]` — inline confirm vs detail drawer
   routing. Default: detail drawer.
2. `[NEEDS DECISION: stale propagation strategy]` — eager vs lazy. Default:
   lazy with timestamp.
3. `[NEEDS DECISION: rejected sessions surfacing]` — by default the Inventory
   `Review` filter has a "Rejected" option (`InventoryPage.tsx:128`). Do
   rejected sessions appear in other views (Projects, Plans) or are they
   filtered out everywhere? Default: visible in detail surfaces, hidden in
   default ledger views.
4. `[NEEDS DECISION: audit-event partitioning]` — diagnostic vs
   workflow-significant. Default: a `severity: diagnostic | workflow` tag on
   every event; UI defaults to filtering diagnostics out.
5. `[NEEDS DECISION: provenance history retention]` — bounded vs unbounded.
   Default: unbounded (constitutional "archive over delete").

## 8. Resolved questions

| # | Question | Decision | Source |
|---|---|---|---|
| 1 | Project lifecycle state names | 7-state set above | mockup `PROJECT_TRANSITIONS` + spec 009 |
| 2 | Can a processing project reset to ready? | No — must go through blocked | mockup `store.ts:376` |
| 3 | Unarchive resumes to which state? | `processing` with action label "Unarchived" | mockup `store.ts:417` |
| 4 | Are session same-state writes no-ops? | Yes — no mutation, no log | mockup `store.ts:457` |
| 5 | Do refused transitions emit audit events? | Yes — warn-level | mockup `store.ts:406-413` |
| 6 | Is action-bound review the default? | Yes (commit 7a681f6) | spec 002 §accept-action-bound-review |
| 7 | Can a confirmed session be re-opened to needs_review? | Yes | mockup `InventoryPage.tsx:388` |
| 8 | Is retry-of-failed-plan a new plan? | Yes — referencing parent id | spec 017 §retry semantics |
| 9 | Does projection staleness propagate? | Yes — via a dependency graph | constitution §V (projections) |
| 10 | Provenance: state machine or overlapping tags? | Overlapping tags, append-only history | constitution §archive-over-delete |
