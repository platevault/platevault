---
id: J05
title: Run a project from creation through tool launch and output tracking
version: 1
status: draft
last_reviewed: 2026-07-14
actors: [astrophotographer]
surfaces: [projects, plans, audit]
interfaces: [desktop-ui]
trace:
  - pre-migration journey.md @ git 66026463
  - e2e-agentic-test/008-project-create-onboard-edit/*
  - e2e-agentic-test/024-project-manifests-and-notes/manifests-notes-reveal-labels/scenario.md
  - e2e-agentic-test/011-processing-tool-launch/tool-launch-containment/scenario.md
  - e2e-agentic-test/012-processing-artifact-observation/artifact-attribution/scenario.md
  - e2e-agentic-test/journeys/full-project-lifecycle/scenario.md
  - deltas/2026-07-14-jval-docdrift.md (folded as correction)
---

## Goal
The user turns a set of already-confirmed acquisition sessions into a
tracked project: create it, attach the sessions it should use, watch its
documentation (per-channel numbers, manifests, notes) stay accurate as the
project changes, launch their processing tool against it, and have the
outputs that tool writes get recorded automatically. Done means the project
detail view reflects real attached data at every stage and every filesystem
side effect (folder creation, tool launch, artifact discovery) is either
safe-by-construction or was explicitly reviewed.

## Preconditions
- P1: At least one confirmed acquisition session exists and is unattached to
  any other project (see J02/J03).
- P2: A library root is registered so project folders and tool working
  directories have somewhere valid to resolve into.
- P3: A processing-tool profile (e.g. PixInsight) with a configured
  executable path exists if S5 (tool launch) is to be exercised; project
  creation and the rest of the journey do not require it.

## Steps

### S1 — Create the project {#S1}
- **Do:** Open the project creation flow, enter a name, optionally choose a
  processing-tool profile, and proceed to create.
- **Expect:** On success, a toast names the created project and its folder
  outcome (folders created / folder creation failed / plan pending review);
  the user returns to the projects list (the created project is not
  auto-selected). The project's on-disk folder structure (e.g. `lights/`,
  `darks/`, `flats/`) is created automatically inside the user's registered
  project library root, never elsewhere.
- **Expect (negative):** Entering a name that collides with an existing
  project (case-insensitively) is rejected only when the user submits the
  form — the wizard returns to the name step with an inline field error
  naming the conflict; no project is created and no folders are written.
- **Expect (negative):** If a plain file already occupies where a project
  folder should go, creation still succeeds for the project record, but the
  user is told which folder could not be created and that plan step remains
  available for review rather than being silently dropped.
- **Trace:** e2e-agentic-test/008-.../create-wizard-field-errors/scenario.md; e2e-agentic-test/008-.../project-mkdir-auto-apply/scenario.md; e2e-agentic-test/008-.../project-path-root-anchoring/scenario.md; correction — navigation target verified against `apps/desktop/src/features/projects/wizard/WizardPage.tsx` (`handleCreate` calls `navigate({ to: '/projects' })` with no `selected` search param) and `WizardPage.test.tsx` ("shows success toast and navigates to /projects after successful create"); duplicate-name-at-submit verified against the same `handleCreate` (`findDuplicateProjectName` runs inside `handleCreate`, not on keystroke), consistent with `docs/product/journeys/J05-project-lifecycle/deltas/2026-07-14-jval-docdrift.md`

### S2 — Attach sources {#S2}
- **Do:** From the project's edit view, add sources from a picker and, when
  needed, remove a previously attached source.
- **Expect:** The picker offers only unlinked, already-confirmed sessions;
  removing any source except the last one takes effect immediately.
- **Expect (negative):** Not-yet-confirmed inbox data never appears as an
  attachable source. Removing the *last* remaining source is blocked behind
  an inline confirmation, because it would drop the project back to an
  incomplete-setup state.
- **Expect (negative):** A project in a locked lifecycle state (e.g.
  archived) refuses source edits with an explicit message rather than
  silently no-op-ing.
- **Trace:** e2e-agentic-test/008-.../edit-project-sources/scenario.md

### S3 — Review real per-channel numbers {#S3}
- **Do:** Open the project detail view.
- **Expect:** The per-channel (per-filter) breakdown shows actual sub-frame
  counts and total integration time, computed from the currently attached
  sessions and formatted as hours/minutes.
- **Expect (negative):** No channel row shows a placeholder dash or a bare
  `0` where the real value is simply unknown — a missing value is
  distinguishable from a real zero.
- **Trace:** e2e-agentic-test/008-.../per-channel-integration-time/scenario.md

### S4 — Track manifests and notes {#S4}
- **Do:** Trigger any lifecycle-relevant change (creation, a source change,
  a later completed cleanup/archive) and, separately, type freeform notes on
  the project.
- **Expect:** Each lifecycle-relevant change appends a new manifest
  snapshot to an append-only list; opening "reveal" on a manifest opens its
  folder. Notes autosave a few seconds after typing stops, showing a live
  byte counter against a hard size cap.
- **Expect (negative):** No manifest is ever overwritten or removed by a
  later change — the history of prior snapshots stays intact.
- **Trace:** e2e-agentic-test/024-project-manifests-and-notes/manifests-notes-reveal-labels/scenario.md

### S5 — Launch the processing tool {#S5}
- **Do:** With a tool executable configured, choose "Open in {tool}" from
  the project.
- **Expect:** The tool process launches against the project's working
  directory without changing the project's lifecycle state.
- **Expect (negative):** If the project's working directory would resolve
  outside every registered library root, the launch is refused with a
  plain explanation instead of spawning into an unexpected location. If the
  OS itself fails to spawn the process, that failure is reported plainly,
  not swallowed.
- **Trace:** e2e-agentic-test/011-processing-tool-launch/tool-launch-containment/scenario.md

### S6 — Observe artifacts the tool produces {#S6}
- **Do:** Leave the project open while the processing tool writes files
  into its output folder; separately, close the project and let files land
  while it is closed, then reopen it.
- **Expect:** While open, new files in the output folder are recorded as
  artifacts with a kind (intermediate/master/final) and a confidence level.
  Files written while the project was closed are picked up the next time it
  is reopened.
- **Expect (negative):** The watcher only observes the project's own output
  folder, never the whole library, and the application never modifies or
  deletes an artifact file itself.
- **Trace:** e2e-agentic-test/012-processing-artifact-observation/artifact-attribution/scenario.md

## Success criteria
- SC1: Creating a project with a valid, unique name results in the project
  appearing in the projects list with its registered-root folders existing
  on disk (S1).
- SC2: A duplicate name (any casing) never creates a project or folders;
  the rejection is surfaced at the name field on submit, not as a generic
  toast (S1).
- SC3: The last-remaining-source removal is always intercepted by a
  confirmation; every other removal is immediate (S2).
- SC4: Per-channel counts and integration time in the detail view always
  match the sum of the currently attached sessions' subs (S3).
- SC5: The manifest list length only grows; it never shrinks or replaces an
  existing entry (S4).
- SC6: A tool launch whose working directory falls outside all registered
  roots never spawns a process (S5).
- SC7: Every file appearing in a project's output folder — whether the
  project was open or closed at the time — is eventually recorded as an
  artifact with a kind and confidence (S6).

## Known gaps
- G1: Rejecting an unconfirmed session as a project source is enforced by
  the backend but has no dedicated UI path to trigger it today (carried
  from legacy doc).
- G2: The flagship `CreateProjectDialog` component (polished per-field
  error mapping) is built and tested but not mounted by the router — the
  real `/projects/new` flow goes through the step wizard (`WizardPage`)
  instead. This is a product decision, not a defect, but affects where to
  look for the "other" creation UI (carried from legacy doc).

## Delta log
