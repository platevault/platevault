> **MIGRATED:** current truth now lives at
> `docs/journeys/J11-mistake-recovery/journey.md`. This file and
> its deltas are frozen legacy history.

## Journey 11 — Mistake recovery: undo a wrong classification or assignment

**Goal:** recover from the user's own mistakes without data archaeology: a
wrong bulk frame-type override, a mis-assigned calibration master, a mistaken
destination-root pick, or a plan confirmed too early.

**Preconditions:** an inbox item with several files of differing detected
types; a calibration master assigned to a session.

**Narrative flow:**

1. The user bulk-assigns a frame type to a heterogeneous selection; the bulk
   control warns that the selection spans differing detected types before
   overwriting.
2. Overridden files carry a "user override" provenance marker and a **Reset
   to detected** action (per file and per selection); resetting restores the
   scanner's classification and re-runs the needs-review gate.
3. A confirmed-but-unapplied plan is discarded from the review overlay; the
   item returns to its classified state, visible immediately in the queue.
4. A calibration assignment is removed from where it was made; usage counts
   decrement.
5. All recovery acts on PlateVault's index only; files are never touched.

**Touch & validate:**

- Heterogeneous bulk override → warning appears, cancel leaves state
  untouched, proceed overwrites all and marks provenance.
- Reset-to-detected per file and per selection → detected values return,
  needs-review gate recomputes, provenance marker clears.
- Plan discard → item state round-trips (classified → planned → classified),
  audit records the discard, disk untouched.
- Master un-assign → usage count decrements, "Used by" list updates, the
  session's calibration linkage clears.
- Every recovery action answers back (signal at the control).

**Safety & trust notes:** recovery is the other half of "reviewable
mutation" — a review gate without an undo teaches users to fear the gate.

**Scenario files:** *(to be authored)*
`e2e-agentic-test/journeys/mistake-recovery/scenario.md`.
