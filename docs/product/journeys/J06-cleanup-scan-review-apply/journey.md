> **MIGRATED:** current truth now lives at
> `docs/journeys/J06-cleanup-scan-review-apply/journey.md`. This file and
> its deltas are frozen legacy history.

## Journey 6 — Cleanup: scan → review → apply

**Goal:** find and safely reclaim disk space from intermediate/redundant
processing outputs a project no longer needs, without ever deleting
protected files or moving anything without review.

**Preconditions:** a project with processing outputs of mixed kind
(intermediate/master/final).

**Narrative flow:**

1. From a project's Outputs/Cleanup section, **Scan for cleanup candidates**
   runs a read-only preview — no plan is created yet. It groups candidates by
   kind (Intermediates/Masters/Finals), marks protected items as locked and
   unselectable, and totals the reclaimable size. Nothing on disk is touched
   by scanning.
2. The user chooses a destructive destination — **Archive folder** (default)
   or **System trash** — and clicks **Generate cleanup plan**. This is the
   point a real, reviewable plan is created; the destination is fixed at this
   point and shown read-only in the review overlay from here on.
3. The review overlay lists every affected item 1:1 with the plan; if any
   protected item is included, its protection must be explicitly
   acknowledged before **Approve & apply** becomes clickable. The user can
   discard the plan instead — disk stays untouched either way until apply.
4. Applying shows live per-item progress ("Applying N of M…"); files move to
   the chosen destructive destination (never deleted outright when the
   destination is Archive), and re-scanning afterward shows them gone from
   the candidate list. An empty plan (nothing selected) cannot be approved.

**Touch & validate:**

- Scan: read-only preview on a project *with* candidates (grouped by kind,
  protected items locked/unselectable, reclaimable total shown) and on one
  *without* (clear "no candidates" result); scanning twice produces the same
  result; nothing on disk changes.
- Destination choice: Archive vs System trash both selectable; the choice is
  frozen and displayed read-only in the review overlay.
- Generate → review: item list is 1:1 with the plan; protected items require
  explicit acknowledgement before Approve enables; an empty plan cannot be
  approved *and states why it is empty*; Discard leaves disk untouched and
  returns cleanly.
- Apply: live per-item progress; per-item outcomes visible afterwards
  (succeeded/failed with reason); files present at the chosen destination;
  re-scan shows candidates gone; audit rows carry outcome.
- Signals: generate, approve, apply, and discard each produce an explicit
  confirmation.

**Safety & trust notes:** two-step generation (preview, then a separate
"generate" action) means a scan alone can never turn into a mutation; the
per-item protection-acknowledgement gate means a user cannot approve-and-miss
a protected file by accident.

**Scenario files:**
`e2e-agentic-test/017-cleanup-archive-review-plans/cleanup-scan-review-apply/scenario.md`,
`e2e-agentic-test/journeys/full-project-lifecycle/scenario.md` (Phase E).

**Known gaps (2026-07-04):**
- The cleanup review UI itself requires **PR #413** (open) — pre-#413 the
  project detail's Cleanup section has no "Scan for cleanup candidates"
  button at all.
- A pre-flight free-space check (would this cleanup even fit at the
  destination) is not implemented; every generator currently reports a
  hardcoded zero for required bytes.
