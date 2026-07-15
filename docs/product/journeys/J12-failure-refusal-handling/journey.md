> **MIGRATED:** current truth now lives at
> `docs/journeys/J12-failure-refusal-handling/journey.md`. This file and
> its deltas are frozen legacy history.

## Journey 12 — Failure & refusal handling: when the backend says no

**Goal:** when an action fails or is refused — a plan apply partially fails,
a lifecycle transition is refused, a generated plan is empty — the user sees
*what* failed, *why*, and *what to do next*, without leaving the surface
they're on.

**Preconditions:** a project that cannot satisfy a lifecycle transition; a
plan constructed to partially fail (e.g. one source file removed on disk
after confirm).

**Narrative flow:**

1. A refused lifecycle transition surfaces its refusal reason inline next to
   the control — the same reason the audit record stores; a transition that
   can never succeed from the current state renders disabled-with-reason.
2. An empty generated plan states why it is empty instead of only disabling
   Approve.
3. A partial apply failure lists failed items by name with per-item reasons,
   offers retry-failed-only, and keeps succeeded items' state visible.
4. A stale plan refuses to apply, names the changed file(s), and offers
   regeneration.
5. Every refusal/failure is afterwards findable in the Audit Log with
   outcome `refused`/`failed` and the same reason on demand.

**Touch & validate:**

- Trigger one refusal per class: lifecycle transition, empty plan, partial
  apply, stale plan — each must produce a visible, specific, in-context
  explanation (generic "failed" copy fails the run).
- Refusal reason parity: UI text ↔ audit record text.
- Retry-failed-only re-attempts only the failed subset.
- Buttons for impossible transitions are disabled-with-reason, never
  clickable-and-silent.

**Safety & trust notes:** the constitution requires auditing every attempted
action *and outcome*; this journey requires the same honesty at the moment
of failure, not only in the audit table after the fact.

**Scenario files:** *(to be authored)*
`e2e-agentic-test/journeys/failure-refusal-handling/scenario.md`.
