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
blocked          → { ready, prepared, processing, setup_incomplete, archived }
```

The `blocked → archived` edge is the escape hatch ratified in GRILL spec 009:
a user may archive a permanently blocked project without first recovering it
to an active stage. `blocked → completed` remains forbidden — completion
requires passing through an active stage so the audit trail records the
actual completion event rather than a synthetic resolution.

The plan-requirement gate per edge is encoded in the canonical `(entity_type,
from, to) → requires_plan` table — see data-model.md §Plan-Requirement Edge
Table. Callers MUST NOT pass `requires_plan` on the request; the server
derives it from this table.

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

### 2.4 FileRecord transitions

`FileRecord` is a first-class lifecycle entity (constitution §Local-First File
Custody). The graph below is the canonical edge list; the data-model.md
FileRecord lifecycle table is the per-entity rendering of the same edges. The
discriminated `Request` union in `contracts/lifecycle.transition.json` includes
a `file_record` family sub-schema bound to `FileRecordState`.

```
observed   → { classified, changed, missing, protected }
classified → { rejected, changed, missing, protected }
changed    → { observed, missing, protected }
missing    → { observed, protected }     # rescan recovers; protected pin
rejected   → { classified, protected }   # reinstate or protect
protected  → ∅ (sticky pin until user removes)
```

Edges from data-model.md §FileRecord §Lifecycle. The `* → protected` rule
applies to any non-terminal state and prevents subsequent cleanup-plan
inclusion (constitution §Reviewable Filesystem Mutation, spec 016).

### 2.5 Session-key derivation

`session_key = canonical_tuple(target_id, filter, binning, gain, observing_night)`.

`observing_night` is computed from a frame's UTC capture timestamp using the
configured `observer_location` (spec 018) — the local-solar-noon boundary rule
(consistent with GRILL spec 013/023 ratification):

```
local_time   = utc_capture_at  →  shift by observer_location.tz
observing_night
    = local_calendar_date(local_time)
        if local_time.hour < 12 (i.e. local morning, still last night)
            → previous_local_calendar_date
        else
            → today_local_calendar_date
```

Stored as `YYYY-MM-DD` (start-of-night local calendar date). Missing
`observer_location` triggers `provenance.unreviewed` against the
`observer_location` settings field (spec 018) and refuses session formation
rather than guessing. Frames spanning the boundary keep their per-frame
observing_night value; if two frames in a candidate group resolve to different
nights, the candidate MUST split (FR-012).

The implementation task for the derivation function sits before T034 in
`tasks.md`.

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
   still `inferred` or `observed`. The error envelope's `details.blocking_fields`
   MUST list every offending field as
   `{ field_path: string, required_origin: "reviewed" }`. The
   `lifecycle.transition.json` contract defines this shape.
3. Surface the specific blocking field to the UI, not just a generic "needs
   review" message.

**Resolved (GRILL 2026-05-21):** action-bound review blocks route the user to
the detail drawer with the offending field highlighted. The inline "Review →
Continue" alternative was rejected because it tucks audit-relevant decisions
behind a transient dialog. See §8 resolved-questions table.

**Resolved (GRILL 2026-05-21) — rejected-session visibility:** ledger views
default-filter `state != rejected` for `InventorySession` and
`CalibrationSession`; detail surfaces always show rejected entries; a
'show rejected' toggle re-includes them in ledger views. This is captured in
spec.md FR-006 and removes the open question from §7.

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

> **Carve-out — catalog entries (spec 014, R-3.2)**: Catalog entries
> (`Catalog`, `LicenseAttribution`) are **app-owned reference data**, not
> user assets. Fields on these types do NOT use `ProvenancedValue<T>`. Source
> provenance for a catalog as a whole is carried by the manifest record and
> the `LicenseAttribution`. The canonical example of this carve-out is
> spec 014; any future app-owned reference data that is not a user asset
> should follow the same pattern. User-visible Target identity that diverges
> from catalog data lives in spec 013 with full `ProvenancedValue` tracking.

## 5. No-op guards

The mockup demonstrates two invariants that the Rust port MUST preserve:

1. **Same-state writes are no-ops** (`store.ts:457`). Calling
   `setSessionReviewState(id, "confirmed")` when the session is already
   `confirmed` returns `status: "noop"` as the contract response and writes
   neither a state mutation nor an audit event. The `noop` response shape
   omits `audit_id` and `error`; the contract `allOf` block enforces this.
2. **Refused transitions log but do not mutate** (`store.ts:406-413`). A
   disallowed edge writes a `warn` audit entry and returns
   `transition.refused` without touching the entity. The audit log thus
   contains both successful transitions AND attempted-but-refused
   transitions, which is the signal needed to spot UI bugs (caller offered a
   button that mapped to a disallowed edge).

These two rules MUST be transactional with the audit write: the only valid
outcomes are (a) state mutated + audit emitted (`status: "success"`),
(b) no mutation + refused-edge audit entry (`status: "error"` with
`error.code = "transition.refused"`), or (c) no mutation + nothing logged
(`status: "noop"`).

**Decision (GRILL 2026-05-21):** no-op transitions emit `status: "noop"` and
write nothing to the audit log. The earlier `state.unchanged` error code is
removed from the contract; the `unchanged` outcome value is also removed from
`AuditLogEntry.outcome` because no row is ever written for a no-op.

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

### 6.1 Event bus (canonical state-propagation design)

**Decision (GRILL 2026-05-21):** propagation is driven by an event bus, not
eager database writes or lazy reads. Spec 002 owns the canonical event-bus
design note for the whole project.

On every successful transition (`status: "success"` per §5), the use-case
layer publishes a `lifecycle.transition.applied` event onto the in-process
event bus. Subscribers (projection-staleness recomputer, log panel /
spec 019, guided-flow trigger / spec 010, manifest regenerator / spec 024,
detail-drawer cache invalidator) consume the event and react.

**Event shape:**

```jsonc
// topic: lifecycle.transition.applied
{
  "entity_type": "project" | "plan" | "inventory_session"
                | "calibration_session" | "data_source"
                | "prepared_source" | "projection" | "file_record",
  "entity_id": "<uuid>",
  "from": "<state-or-null>",
  "to": "<state>",
  "applied_at": "<rfc3339>",
  "audit_id": "<uuid>",
  "actor": "user" | "system",
  "request_id": "<uuid>",
  "source": "user" | "restore" | "system"  // R-Source-1 (2026-05-22)
}
```

**R-Source-1 — `source` field semantics (ratified 2026-05-22)**:

Every event on the bus carries a top-level `source` field with one of three
values:

| Value | Meaning |
|-------|---------|
| `user` | Event triggered by direct user action (a command issued from the UI or a user-initiated Tauri call). |
| `restore` | Event triggered by recovery or replay of the audit log (e.g. app startup reconciliation, crash-recovery replay). |
| `system` | Event triggered by an automatic invariant check, a scheduled background job, or an internal system process without direct user initiation. |

Subscribers SHOULD branch on `source` where the distinction matters:
- The guided-flow coach (spec 010) ignores events where `source == "restore"` so
  that audit-log replay does not prematurely advance coach steps.
- The audit log records `source` on every event row.
- Subscribers that are idempotent on `(audit_id, subscriber_id)` may safely
  ignore `source`, but must still accept and discard `restore` events without
  side-effects if idempotency is already guaranteed by another means.

The `source` field applies to ALL event topics on the in-process bus, not
only `lifecycle.transition.applied`.

**Delivery semantics:**

- At-least-once delivery to subscribers within the same process. Subscribers
  MUST be idempotent on `(audit_id, subscriber_id)`.
- Refused transitions and no-ops do NOT publish events (refused emits only an
  audit row; no-ops emit nothing).
- Publication is transactional with the entity mutation + audit write:
  publication runs inside the same SQLite transaction commit hook so a
  rolled-back transaction never emits.
- Cross-process or cross-machine delivery is out of scope for v1 (single
  desktop process). The topic and payload shape are designed to be
  serializable for a future remote service per constitution §V.

The earlier "lazy with `dependents_dirty_at` timestamp" default is replaced
by event-bus driven invalidation. Subscribers that need projection staleness
(`ProcessingArtifact.staleness`, `PreparedSource.state`, manifest staleness)
recompute on each event using the dependency graph above.

#### 6.2 Catalog event-bus topics (spec 014)

Catalog download and manifest-fetch operations publish the following
additional topics on the same in-process event bus. These are owned by
**spec 014** (`crates/targeting/catalogs/download.rs`); they are registered
here because spec 002 is the canonical event-bus design owner. (R-3.1,
spec 014 research R8)

| Topic | Payload |
|---|---|
| `catalog.manifest.fetched` | `{ manifest_version, etag?, catalogs_count, fetched_at }` |
| `catalog.download.started` | `{ catalog_id, expected_bytes, started_at }` |
| `catalog.download.progress` | `{ catalog_id, bytes_downloaded, expected_bytes, fraction }` |
| `catalog.download.completed` | `{ catalog_id, bytes_downloaded, duration_ms, audit_id }` |
| `catalog.download.failed` | `{ catalog_id, error_code, error_message, duration_ms }` |

Delivery semantics are identical to `lifecycle.transition.applied` (§6.1):
at-least-once, idempotent on `(audit_id, subscriber_id)`, transactional
with the SQLite write. The first-run Download Catalogs wizard step
subscribes to `progress` / `completed` / `failed` for per-row progress UI.

## 7. Open option points

All previously open option points have been resolved by the GRILL 2026-05-21
pass and are now folded into the §8 resolved-questions table:

1. ~~`[NEEDS DECISION: action-bound block UX]`~~ — **Resolved:** detail drawer
   with offending field highlighted. (§3, §8 #11.)
2. ~~`[NEEDS DECISION: stale propagation strategy]`~~ — **Resolved:** event
   bus is the canonical state-propagation mechanism (§6.1, §8 #12).
3. ~~`[NEEDS DECISION: rejected sessions surfacing]`~~ — **Resolved:** ledger
   views default-filter `state != rejected`; detail surfaces always show
   rejected; 'show rejected' toggle re-includes them in ledgers. (§3, §8 #13,
   spec.md FR-006.)
4. ~~`[NEEDS DECISION: audit-event partitioning]`~~ — **Resolved:** keep
   `severity: workflow | diagnostic` as the partitioning mechanism on
   `AuditLogEntry`; default UI timelines and the spec 019 log panel
   default-filter `severity = workflow`. (§8 #14.)
5. ~~`[NEEDS DECISION: provenance history retention]`~~ — **Resolved:** keep
   the most recent N entries per origin tag inline on `ProvenancedValue`;
   archive older entries to a separate `provenance_history_archive` table
   (data-model.md). The `provenance.read` contract carries a
   `history_truncated` flag and an archive query path. (§8 #15.)

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
| 11 | Action-bound review block UX | Route to detail drawer with offending field highlighted | GRILL 2026-05-21 |
| 12 | Projection-staleness propagation strategy | Event bus (`lifecycle.transition.applied`); §6.1 owns the canonical design | GRILL 2026-05-21 |
| 13 | Rejected sessions in default ledger views | Hidden by default; detail surfaces always show; 'show rejected' toggle re-includes | GRILL 2026-05-21 |
| 14 | Audit diagnostic vs workflow partitioning | `severity: workflow \| diagnostic` on `AuditLogEntry`; default UI filters `severity = workflow` | GRILL 2026-05-21 |
| 15 | Provenance history retention | Most recent N per origin tag inline; older archived to `provenance_history_archive`; `provenance.read` returns `history_truncated` | GRILL 2026-05-21 |
| 16 | `requires_plan` provenance | Server-derived from canonical `(entity_type, from, to)` edge table; callers MUST NOT assert | GRILL 2026-05-21 |
| 17 | `LifecycleState` shape in contract | Discriminated `oneOf` Request sub-schemas per entity family (8 families incl. `file_record`) | GRILL 2026-05-21 |
| 18 | No-op response shape | `status: "noop"` with no `audit_id`, no `error`; `state.unchanged` error removed | GRILL 2026-05-21 |
| 19 | `actor=system` edge policy | Permitted only on `* → blocked` and `blocked → *` edges; enforced in use case, rejected with `transition.refused` | GRILL spec 009 2026-05-21 |
| 20 | `blocked → archived` legality | Allowed (escape hatch); `blocked → completed` remains forbidden | GRILL spec 009 2026-05-21 |
| 21 | `discarded` in PlanState | Added to `PlanState` enum (terminal soft-delete; pairs with spec 017) | GRILL 2026-05-21 |
| 22 | `FileRecord` lifecycle first-class | Yes — own transition graph (§2.4) and discriminated Request sub-schema; edge-list test owned by tasks.md | GRILL 2026-05-21 |
| 23 | Session-key formula | `(target_id, filter, binning, gain, observing_night)` with local-solar-noon `observing_night` derivation (§2.5) | GRILL 2026-05-21 |
