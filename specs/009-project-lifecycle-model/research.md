# Research: Project Lifecycle Model

**Spec**: 009-project-lifecycle-model | **Date**: 2026-05-09

## R1. Project Transition Graph

### Question

Which `from → to` lifecycle edges are admissible, and which are
forbidden-by-design?

### Decision

Seventeen allowed edges (sixteen original + `blocked → archived` escape hatch
per A3), organized as one forward path with recovery families:

- **Forward path**: `setup_incomplete → ready → prepared → processing →
  completed → archived`.
- **Back-edits**: `prepared → ready` (user re-edited sources after a
  PreparedSource generation; the generated artifact is invalidated through
  spec 017).
- **Re-open**: `completed → processing` (user discovered more work to do
  after marking complete).
- **Unarchive (two paths, R-Unarchive, GRILL 2026-05-22)**:
  - `archived → ready`: the user wants to revisit a finished project but
    is not necessarily resuming active processing. This is the primary
    unarchive path. The project returns to the `ready` state where the
    user can inspect, edit sources, or start a prepared-source generation.
    Reverse archival is supported via this single primary edge.
  - `archived → processing`: direct resume (the pre-existing path).
    Retained for users who know they want to immediately continue processing.
- **Block**: any active state (`setup_incomplete`, `ready`, `prepared`,
  `processing`) can transition to `blocked`.
- **Unblock**: `blocked → {ready, prepared, processing, setup_incomplete}`
  back to whatever state the resolution implies.
- **Escape-hatch archive**: `blocked → archived` (A3, GRILL 2026-05-22).
  For permanently-blocked projects the user cannot unblock. Requires explicit
  user confirmation and always requires a plan (identical requirements to
  `completed → archived`). Allowed actors: user (with explicit confirmation)
  OR system (if the system determines the project is permanently unrecoverable).

**`actor=system` authorization (A4, GRILL 2026-05-22)**: The use case enforces
that `actor=system` is allowed ONLY on:
1. `* → blocked` (any state to blocked).
2. `blocked → *` (any blocked recovery edge, including `blocked → archived`).
3. The deterministic invariant-driven `setup_incomplete → ready` auto-transition
   (R-Ready-Trigger) — classified as "automatic invariant transition".

Any other `actor=system` edge is rejected with `transition.refused`; the
rejection is audit-logged.

**`requires_plan` server derivation (A6)**: Callers MUST NOT pass `requires_plan`
on the contract request. The server consults the spec 002 canonical
`(entity_type, from, to) → requires_plan` plan-requirement edge table. For
project transitions:
- `ready → prepared`: required.
- `prepared → ready`: required.
- `completed → archived`: **always required** (R-Archived-Plan).
- `blocked → archived`: **always required** (same as `completed → archived`).
- `archived → processing`: required only when files moved (C7 criterion).
- `archived → ready`: required only when files moved (C7 criterion — mirrors
  `archived → processing`). Plan NOT required when only metadata transitions
  (R-Unarchive, GRILL 2026-05-22).
- All other project edges: not required.

**`setup_incomplete → ready` auto-transition (R-Ready-Trigger)**: Server-side
invariant check fires after every `project.update` or `project.source.add`.
Invariants: `tool != null AND ≥1 confirmed source mapped`. When satisfied,
lifecycle service auto-transitions via `actor=system`. Emits
`project.lifecycle.ready` event on event bus. This is an "automatic invariant
transition" — a sub-classification of system-actor use alongside
`* → blocked` / `blocked → *`.

**`completed → archived` always requires plan (R-Archived-Plan)**: Even when
no files move, plan generation produces a Plan with at least the manifest-write
structural item. The empty-move plan preserves the audit trail and satisfies the
spec 024 manifest snapshot requirement.

**Blocked-flag debounce (D5)**: The detector layer MUST debounce on the same
`(entity_id, blocking_condition)` for at least 60 seconds. The lifecycle layer
itself does NOT debounce.

### `status: "noop"` response (A2)

When `next_state` equals the project's current state, the use case returns
`status: "noop"` — no error, no `audit_id`. This aligns with the spec 002
noop pattern (GRILL 2026-05-21, aligned A2). The removed `state.unchanged`
error code is explicitly retired; callers should handle `"noop"` status as a
success with no state change.

### Forbidden edges and rationale

- **`processing → ready`**: refused because it would erase the attestation
  that processing began. If the user wants to redo source mapping during
  processing, they go via `blocked` (with reason `needs_resource`) or open a
  filesystem plan that, on apply, demotes to `ready` with audit context.
- **`archived → completed`**: refused because re-completion is never silent;
  the user must re-enter `processing` and re-mark complete. This keeps
  `lastAction` truthful.
- **`archived → prepared`**: still refused. `archived → ready` is now the
  primary unarchive path; going directly to `prepared` skips the readiness
  gate (R-Unarchive, GRILL 2026-05-22 — `archived → ready` is now allowed).
- **`archived → ready` (UPDATED — R-Unarchive, GRILL 2026-05-22)**: This
  edge is NOW ALLOWED. It was previously forbidden; the rationale for
  forbidding it (archive is a terminal museum state) has been revised.
  User rationale: users legitimately need to revisit finished projects
  (e.g., planning an imaging re-run, reviewing sources, fixing metadata).
  The unarchive is explicit and auditable; the archive-over-delete principle
  still applies to any files that were moved during archival. Reverse archival
  is supported via this edge.
- **`blocked → completed`**: explicitly forbidden even after adding
  `blocked → archived`. The user must unblock and re-mark complete, or use
  the escape-hatch archive (A3).
- **Skipping `ready`**: `setup_incomplete` may only progress to `ready` (or
  `blocked`). No short-circuit to `prepared`/`processing` — the readiness gate
  is the invariant that source mapping exists.

### Alternatives considered

- **Allow `processing → ready` for re-mapping**: rejected because the user
  intent ("I need to fix the source mapping mid-processing") is better
  modeled as `processing → blocked(needs_resource) → ready`, which leaves a
  reviewable trail.
- **Auto-archive on `completed` after N days**: rejected for v1. Auto state
  transitions risk silent destruction of user expectations. Reconsider once
  the audit and revert surfaces are mature.
- **`blocked → completed`**: rejected (A3); use `blocked → archived` escape
  hatch instead.

## R2. Action-Label Policy

### Question

How are action labels (the human-readable text recorded on the audit entry
and surfaced as `lastAction.label`) derived from a transition?

### Decision

Action labels are **edge-derived**, not state-derived. The mockup precedent
(`store.ts::setProjectLifecycle`) is canonical:

| Edge                                | Default label        |
| ----------------------------------- | -------------------- |
| `setup_incomplete → ready`          | `Marked ready`       |
| `ready → prepared`                  | `Marked prepared`    |
| `prepared → ready`                  | `Reverted to ready`  |
| `ready → processing`                | `Marked processing`  |
| `prepared → processing`             | `Marked processing`  |
| `processing → completed`            | `Marked completed`   |
| `completed → archived`              | `Marked archived`    |
| `completed → processing`            | `Re-opened`          |
| `archived → processing`             | `Unarchived`         |
| `archived → ready`                  | `Unarchived`         |
| `* → blocked`                       | `Marked blocked`     |
| `blocked → *`                       | `Resolved blocker`   |

Callers MAY override the default with a contract-supplied `action_label`. The
override is recorded verbatim in audit and `lastAction.label`.

### Rationale

- Action labels are the most prominent UI element on the project row and
  drawer header. Labels MUST describe what happened, not the resulting state.
- "Unarchived" rather than "Marked processing" on `archived → processing`
  preserves user intent semantics; the mockup already does this.
- "Re-opened" rather than "Marked processing" on `completed → processing`
  distinguishes a re-open from a forward step.

### Alternatives considered

- **State-derived labels** (`Marked {state}` for every edge): rejected
  because it loses unarchive/re-open intent.
- **Free-text labels per call**: rejected as default; the contract still
  allows an override for system-emitted transitions
  (e.g. "Auto-blocked: source missing").

## R3. Blocked Triggers

### Question

What causes a Project to enter `blocked`, and is `blocked` ever set
automatically?

### Decision

Two trigger families, both routed through the same transition contract:

1. **System-detected (auto)**:
   - `source_missing`: a referenced inventory item is gone (spec 003 event).
   - `prepared_source_stale`: the prepared source artifact is older than its
     inputs (spec 017 event).
   - `tool_unconfigured`: target tool path not configured at the time the
     user attempts `Open in {tool}`.
   - `calibration_unmatched`: required calibration set is missing or has
     diverged.

   Auto-emitted transitions use `actor = "system"` on the contract envelope
   and supply `blockedReason` plus a system-generated `action_label`
   (e.g. `"Auto-blocked: source missing"`).

2. **User-marked**:
   - User selects "Mark blocked…" from the row/footer overflow.
   - User MUST supply a free-text reason; `blockedReason` is stored as
     `{ kind: "user", note: "..." }`.

The mockup currently exposes only the user path; system detection is added
in the post-mockup phase and is wired through the same use case.

### `lastAction` semantics

`lastAction` is **denormalized state for fast row rendering**, NOT a
substitute for the audit log:

- Updated on every successful transition.
- `label` is the action label; `when` is an ISO-8601 timestamp truncated to
  the minute for stable rendering.
- The audit log holds the full event with actor, requestId, prior_state, and
  any plan_id reference.
- If the audit log and `lastAction` ever disagree (e.g. after a recovery
  rebuild), the audit log is authoritative; `lastAction` is recomputed from
  the most recent project audit entry.

## R4. Cross-Spec Side Effects

### Question

Which edges trigger filesystem work, and how is that work gated?

### Decision

| Edge                       | Side effect                                | Gating                          |
| -------------------------- | ------------------------------------------ | ------------------------------- |
| `ready → prepared`         | PreparedSource artifact creation           | Approved spec-017 plan required |
| `prepared → ready`         | PreparedSource invalidation/retire        | Approved spec-017 plan required |
| `completed → archived`    | Archive plan (move + manifest snapshot)    | Approved spec-017/025 plan required |
| `archived → processing`   | Optional re-link of archived sources       | Plan required only if files moved |
| All other edges            | None                                       | Pure metadata write             |

Gating is enforced by the use case via `requires_plan = true` on the
contract envelope. The server returns `plan.required` (spec 002 error code)
when the flag is set and no approved plan_id is referenced, and
`prepared_source.required` (project-scoped) when the prepared source
artifact is missing or invalid for a `ready → prepared` transition that
otherwise has an approved plan.

## R5a. JSON Schema Plan-Gated Enforcement (R-PlanGated-Schema)

### Question

Should the `project.lifecycle.transition.json` schema enforce `plan_id`
requirement for plan-gated edges at the schema layer?

### Decision

**Yes — belt-and-suspenders `if/then` allOf in Request** (GRILL 2026-05-22,
R-PlanGated-Schema):

```json
{
  "if": { "properties": { "next_state": { "enum": ["prepared", "archived"] } } },
  "then": { "required": ["plan_id"] }
}
```

This is schema-layer enforcement only. The server STILL enforces the requirement
authoritatively via the spec 002 plan-requirement edge table (A6). The schema
catches missing `plan_id` at client validation time before the request is sent.

### Rationale

- Schema-level enforcement catches integration bugs earlier.
- The server remains authoritative; schema is a defense-in-depth layer only.

## R5. Stepper UX and Visited-State Indication

### Question

How is the stepper rendered for non-linear states (`blocked`, `archived`)?

### Decision

- Linear stepper (`setup_incomplete → ready → prepared → processing →
  completed → archived`) is always rendered.
- The active state highlights its node; visited states are filled.
- `blocked` is rendered as a banner above the stepper, with the blocking
  reason and primary resolve action. The stepper underneath shows the
  pre-block state as active so the user can see where they will return.
- `archived` highlights the rightmost node and dims the rest.

Rationale: keeping the stepper visually stable across all seven states
avoids layout shift and matches the mockup's current behavior.
