> **MIGRATED:** current truth now lives at
> `docs/journeys/J05-project-lifecycle/journey.md`. This file and
> its deltas are frozen legacy history.

## Journey 5 — Project lifecycle: create → attach sources → manifests/notes → tool launch → artifacts

**Goal:** create a project, link the acquisition data it should use, document
it (manifests/notes), launch a processing tool against it, and track the
outputs that tool produces.

**Preconditions:** at least one confirmed session exists to attach (from
Journey 2/3); a processing tool (e.g. PixInsight) configured with an
executable path is useful but not required to exercise creation.

**Narrative flow:**

1. **Create** (`/projects/new`): name the project, optionally pick a
   processing-tool profile and initial sources. Typing a name that already
   exists (case-insensitively) surfaces an inline field error immediately,
   not a generic toast, and creation is blocked from that step. On success,
   a plain toast confirms creation and the project's on-disk folder
   structure (e.g. `lights/`, `darks/`, `flats/`) is created automatically —
   this "mkdir-only" plan auto-applies (see Known gaps for why that's safe)
   while still leaving an audit record and a reviewable plan row behind it.
   If a file already occupies where a folder should go, creation still
   succeeds but the toast says so and the folder plan stays available for
   review instead of being silently skipped.
2. **Attach sources** (Edit pane): "Add sources" opens a picker pre-filtered
   to unlinked, already-confirmed sessions only — you cannot attach
   not-yet-confirmed inbox data. Removing a source is immediate except for
   the *last* remaining source, which requires an inline confirmation
   ("You can't remove the last confirmed source.") because removing it drops
   the project back to an incomplete-setup state. A project in a locked
   lifecycle state (e.g. archived) refuses edits with a clear message instead
   of silently no-op-ing.
3. **Review the real numbers**: the project detail's per-channel (per-filter)
   breakdown shows actual sub-frame counts and total integration time
   computed from the attached sessions, formatted as hours/minutes — not a
   placeholder dash.
4. **Manifests & notes**: every lifecycle-relevant change (creation, source
   change, later a completed cleanup/archive) appends a new manifest
   snapshot — manifests are generated documentation, never overwritten, so
   the history of "what did this project look like at each point" is
   preserved. Notes are freehand, auto-saved a few seconds after typing
   stops, with a live byte counter and a hard size cap.
5. **Launch a tool**: with an executable configured, "Open in {tool}" spawns
   the process without touching the project's lifecycle state, refuses to
   launch if the project's working directory would resolve outside every
   registered root (a containment safety check), and if the OS itself fails
   to spawn the process, that failure is reported plainly rather than
   silently swallowed.
6. **Observe outputs**: while the project is open, a per-project watcher
   attaches to its output folder only (not the whole library) and records
   new files as artifacts with a kind (intermediate/master/final) and
   confidence; artifacts written while the project was closed are picked up
   the next time it's reopened. PlateVault never modifies or deletes an
   artifact file itself.

**Touch & validate:**

- Wizard, every step against the *actual* selection: step 2's session list
  and running integration total must reflect what is checked, at selection
  time; step 3's calibration recommendations must be computed from the
  library's real masters (assert at least one recommendation references a
  master that exists on the Calibration page); step 5's naming preview must
  render the *typed* project name; step 6's plan items and disk tree must
  correspond 1:1 to what apply will create (spot-check two destination
  paths). Any fixture/demo content on these steps fails the journey.
- Wizard chrome: duplicate-name inline error; Save draft → leave → resume;
  Cancel from every step; stepper state at 1100×720.
- Create: success signal naming the project with a path into it; landing
  state (project selected/open); Target association persisted when entered
  via Journey 14.
- Detail: Sources table shows human names (never raw ids) with real
  filter/subs/integration per row; Channels palette values carry correct
  units; lifecycle stepper advances through each state in order, including
  reverse transitions (Re-open on a completed project), and any refused
  transition explains itself at the control; Edit sources add/remove
  including the last-source guard; locked-state (archived) edit refusal.
- Manifests: creation, a source change, and a lifecycle transition each
  append a snapshot; the list grows append-only; reveal opens the
  manifest's folder; Notes: autosave signal, byte counter, cap behavior.
- Source views: the Generate dialog (profile choice, link-kind fallback
  disclosure, allow-copy option) produces a reviewable plan — never a
  direct filesystem mutation; Cancel leaves no plan behind; generated
  views list with their status.
- Tool launch: launch succeeds with a configured tool; containment refusal
  (working dir outside all roots) reported plainly; OS spawn failure
  reported plainly.
- Artifacts: a file dropped in the output folder while open is recorded with
  kind + confidence; one dropped while closed is picked up on reopen.

**Safety & trust notes:** mkdir-only project scaffolding auto-applies
because every action in that plan is a folder creation (never a move/copy/
delete of user files) — anything beyond that still requires explicit review;
tool launches are contained to registered roots; manifests are an
append-only audit trail, not a mutable summary.

**Scenario files:**
`e2e-agentic-test/008-project-create-onboard-edit/create-wizard-field-errors/scenario.md`,
`.../edit-project-sources/scenario.md`,
`.../per-channel-integration-time/scenario.md`,
`.../project-mkdir-auto-apply/scenario.md`,
`.../project-path-root-anchoring/scenario.md`,
`e2e-agentic-test/024-project-manifests-and-notes/manifests-notes-reveal-labels/scenario.md`,
`e2e-agentic-test/011-processing-tool-launch/tool-launch-containment/scenario.md`,
`e2e-agentic-test/012-processing-artifact-observation/artifact-attribution/scenario.md`,
`e2e-agentic-test/journeys/full-project-lifecycle/scenario.md` (canonical
end-to-end version of Journeys 5–7; this is the release gate for the
projects area).

**Known gaps (2026-07-04):**
- Project folders were only actually created on disk starting with **PR
  #411** (merged). A related bug — folders landing under the app's working
  directory instead of the user's registered project library — is fixed by
  **PR #414** (open); until it merges, new project folders can land in the
  wrong place.
- Rejecting an unconfirmed session as a project source is enforced by the
  backend but has no dedicated UI path to trigger it today.
- The flagship `CreateProjectDialog` component (with polished per-field
  error mapping) is built and tested but not actually mounted by the router
  — the real create flow goes through the setup-style wizard instead. This
  is a product decision, not a bug, but is worth knowing if you go looking
  for the "other" creation UI.
