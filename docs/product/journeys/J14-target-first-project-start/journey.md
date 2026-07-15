> **MIGRATED:** current truth now lives at
> `docs/journeys/J14-target-first-project-start/journey.md`. This file and
> its deltas are frozen legacy history.

## Journey 14 — Target-first project start

**Goal:** start from "I want to shoot IC 10 next" in the Targets planner and
end with a project correctly linked to that target, without retyping
anything.

**Preconditions:** seeded catalog; at least one confirmed session.

**Narrative flow:**

1. On **Targets**, the user finds the target (search, alias, planner
   columns) and clicks **"+ New project here"** on its detail.
2. The wizard opens with the association already made: name pre-filled with
   an editable default, the target shown as a fact in the summary rail.
3. The sources step surfaces sessions of that target first when any exist.
4. After creation, the project's Target column and detail header show the
   canonical target; the target's detail lists the new project.
5. The reverse link stays live: from the project, the target opens the
   Targets page with it selected.

**Touch & validate:**

- Launch the wizard from three entry points (target detail, Projects page
  button, command palette) — the target association exists only for the
  target-detail entry and survives to the created project.
- Name pre-fill is editable and editing it does not break the association
  (the link is by id, not by name parsing).
- Sources step ordering: target's sessions first; selecting none still
  allows creation.
- Round-trip: project → target → project navigation lands selected both
  ways; the target's Projects section updates without a reload.

**Safety & trust notes:** the trust at stake is referential — a project that
silently loses its target association corrupts the coverage story the
Targets planner sells.

**Scenario files:** *(to be authored)*
`e2e-agentic-test/journeys/target-first-project/scenario.md`.
