# Research: Project Lifecycle Model

**Spec**: 009-project-lifecycle-model | **Date**: 2026-05-09

## R1. Project Transition Graph

### Question

Which `from → to` lifecycle edges are admissible, and which are
forbidden-by-design?

### Decision

Sixteen allowed edges, organized as one forward path with three recovery
families:

- **Forward path**: `setup_incomplete → ready → prepared → processing →
  completed → archived`.
- **Back-edits**: `prepared → ready` (user re-edited sources after a
  PreparedSource generation; the generated artifact is invalidated through
  spec 017).
- **Re-open**: `completed → processing` (user discovered more work to do
  after marking complete).
- **Unarchive**: `archived → processing` (resume work directly — see R3).
- **Block**: any active state (`setup_incomplete`, `ready`, `prepared`,
  `processing`) can transition to `blocked`.
- **Unblock**: `blocked → {ready, prepared, processing, setup_incomplete}`
  back to whatever state the resolution implies.

### Forbidden edges and rationale

- **`processing → ready`**: refused because it would erase the attestation
  that processing began. If the user wants to redo source mapping during
  processing, they go via `blocked` (with reason `needs_resource`) or open a
  filesystem plan that, on apply, demotes to `ready` with audit context.
- **`archived → completed`**: refused because re-completion is never silent;
  the user must re-enter `processing` and re-mark complete. This keeps
  `lastAction` truthful.
- **`archived → ready` / `archived → prepared`**: refused for the same
  reason. The archive is a terminal museum state and exits only through the
  explicit Unarchive action.
- **`completed → archived` via auto-transition**: not forbidden, but not
  automatic. User must approve the archive action; the audit chain MUST
  include the FilesystemPlan id.
- **Skipping `ready`**: `setup_incomplete` may only progress to `ready`. No
  short-circuit to `prepared`/`processing` — the readiness gate is the
  invariant that source mapping exists.

### Alternatives considered

- **Allow `processing → ready` for re-mapping**: rejected because the user
  intent ("I need to fix the source mapping mid-processing") is better
  modeled as `processing → blocked(needs_resource) → ready`, which leaves a
  reviewable trail.
- **Auto-archive on `completed` after N days**: rejected for v1. Auto state
  transitions risk silent destruction of user expectations. Reconsider once
  the audit and revert surfaces are mature.

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
