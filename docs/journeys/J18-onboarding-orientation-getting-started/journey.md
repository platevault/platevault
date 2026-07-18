---
id: J18
title: Get oriented after setup and track first-run progress
version: 1
status: draft
last_reviewed: 2026-07-18
actors: [astrophotographer]
surfaces: [onboarding, shell]
interfaces: [desktop-ui]
trace:
  - specs/056-onboarding-redesign (design authored in parallel on branch
    spec/056-onboarding-redesign — not yet merged; this journey does not wait
    on it, see Known gaps G1)
  - specs/010-guided-first-project-flow/spec.md (superseded — the 3-step
    non-modal `guided/` coach this replaces)
  - github: nightwatch-astro/alm#881
  - product decision 2026-07-18 (user-approved onboarding redesign, relayed
    via orchestration run run-onb-0718)
---

## Goal

A user who just finished first-run setup gets a one-time guided tour of the
app's five workflow pages, then keeps a persistent, per-page "Getting
started" checklist in the sidebar that tracks their real first-run progress
as they do actual work — never from injected demo data, never blocking any
workflow. Done means: the tour ran exactly once (or was skipped) and never
auto-runs again; the checklist accurately reflects real domain state at every
point (auto-ticked on real events, manually checkable for the rest); and the
user can locate any tracked control via a non-blocking spotlight, collapse or
permanently remove the checklist, and restore it later without losing or
faking progress.

## Preconditions

- P1: First-run setup has just completed (fresh install or reset dev
  database) — inventory, sessions, projects, and targets are all empty; no
  demo/sample records exist anywhere.
- P2: The desktop app is running with the sidebar in its default expanded
  state, unless a step says otherwise (S13 covers the icon-collapsed
  variant).

## Steps

### S1 — Orientation walk launches automatically after setup {#S1}
- **Do:** Finish the first-run setup wizard.
- **Expect:** Immediately after the wizard closes, a modal page-walk opens
  on its own, its first stop anchored to the Inbox page.
- **Expect (negative):** No demo, sample, or placeholder inventory, session,
  project, or target record exists anywhere in the app as a result of the
  walk starting — the walk operates purely as an overlay on an empty, real
  library.

### S2 — Complete the walk end to end {#S2}
- **Do:** Use Next to advance through every stop.
- **Expect:** The walk has exactly six stops in order: Inbox, Sessions,
  Calibration, Targets, Projects, then a final stop pointing at the
  sidebar's "Getting started" section (this last stop highlights the
  sidebar without requiring page navigation). Each of the first five stops'
  Next brings the corresponding page into view; Back returns to the prior
  stop and its page. Finishing the last stop closes the walk.
- **Expect (negative):** While the walk is open, clicking outside its
  tooltip does not dismiss it or perform any action on the underlying
  page — it is modal, controlled only by Next, Back, Skip, and Escape.
- **Trace:** product decision 2026-07-18

### S3 — Skip the walk instead of finishing it {#S3}
- **Do:** From a fresh, not-yet-oriented install, open the walk (S1) and
  either click Skip on any stop or press Escape.
- **Expect:** The walk closes immediately from whichever stop it was on.
- **Expect:** Skipping is recorded as equivalent to finishing for the
  purposes of "never auto-runs twice" (S4) — skip and finish are the two
  terminal outcomes of the same one-time walk.

### S4 — The walk never auto-runs a second time {#S4}
- **Do:** After completing S2 or S3, fully restart the app (quit and
  relaunch) at least once.
- **Expect (negative):** The walk does not open automatically on any
  subsequent launch, regardless of whether it was finished or skipped.

### S5 — Replay the walk from Settings {#S5}
- **Do:** Go to Settings → Advanced and use the restart-tour control.
- **Expect:** The walk reopens starting at stop 1 (Inbox), regardless of
  whether it was previously finished or skipped.
- **Expect (negative):** Replaying the walk does not reset or alter the
  Getting-started checklist's tick state — the two are independent.

### S6 — The Getting-started section sits in the sidebar {#S6}
- **Do:** With the walk closed, look at the sidebar's workflow navigation.
- **Expect:** An accordion section labeled for getting started appears
  above the Settings entry, separated from the primary workflow nav the
  same way Settings is. It is expanded by default.
- **Expect:** An overall progress indicator (e.g. a count or fraction line)
  is visible at the top of the section, summarizing progress across all
  page groups.

### S7 — Per-page groups and auto-expand {#S7}
- **Do:** Expand the Getting-started section and navigate between Inbox,
  Sessions, Calibration, Targets, and Projects.
- **Expect:** The section contains exactly five page groups, one each for
  Inbox, Sessions, Calibration, Targets, and Projects; each group lists
  between 2 and 4 short item labels.
- **Expect:** Whichever page group matches the page currently open is
  auto-expanded; the others may be collapsed.
- **Expect:** Hovering or focusing an item label surfaces its explanatory
  tooltip copy (distinct from the short label shown inline).

### S8 — Prerequisite-gated item shows reason and jump-link {#S8}
- **Do:** With no inventory item confirmed yet, open the Projects group and
  locate its "create first project" item.
- **Expect:** The item shows a prerequisite-not-met state, with reason text
  explaining what is missing (at least one confirmed inventory item) and a
  jump-link that navigates to where that prerequisite is satisfied (Inbox).
- **Expect (negative):** The item cannot be manually checked complete while
  its prerequisite is unmet — the gate is enforced, not just displayed.

### S9 — A real Inbox confirm auto-ticks its item {#S9}
- **Do:** Follow the jump-link from S8 (or navigate to Inbox directly) and
  confirm a real Inbox candidate into inventory.
- **Expect:** The corresponding Inbox checklist item ticks automatically,
  driven by the real `inventory.confirmed` domain event — no manual check
  action is needed.
- **Expect:** The tick performs its completion choreography: the item shows
  a brief emphasis in place, then moves into a completed area of its group;
  the overall progress affordance pulses to reflect the change.
- **Expect:** The Projects "create first project" item from S8 now shows its
  prerequisite as met (reason text and lock state clear).
- **Expect (negative):** No demo or sample inventory record was created to
  produce this tick — only the user's own confirmed item exists.

### S10 — Restore-source events never tick {#S10}
- **Do:** Perform a restore action that returns a previously archived or
  trashed item to an active state (e.g. via the archive/trash restore
  workflow), producing a domain event of similar shape to a fresh confirm.
- **Expect (negative):** No checklist item ticks as a result of the restore
  event — restore-source events are excluded from auto-tick eligibility
  regardless of which page or item they might otherwise resemble.

### S11 — Manual check and dismiss for non-event items {#S11}
- **Do:** Locate a checklist item that has no corresponding real domain
  event (an informational or self-paced item) and manually check it; on a
  different item, use its dismiss action instead of checking it.
- **Expect:** The manually checked item enters the completed state via the
  user's action alone, with the same in-place-then-move choreography as an
  auto-tick.
- **Expect:** The dismissed item leaves the active list without being
  counted as completed in the overall progress line.
- **Expect (negative):** Manually checking or dismissing an item never
  triggers the real domain event it would otherwise correspond to, and
  never changes any other item's or group's state.

### S12 — Spotlight find on a checklist item {#S12}
- **Do:** Click the find/magnify affordance next to a checklist item whose
  target control is on the current page (or in the sidebar itself).
- **Expect:** A non-modal spotlight highlights the real control in place,
  with a pulse animation that settles after a brief period.
- **Expect (negative):** Under a reduced-motion setting, the spotlight
  appears without the pulse animation.
- **Expect (negative):** The spotlight never blocks clicks on the
  underlying page — every control beneath and around it remains clickable
  while the spotlight is showing.

### S13 — Spotlight dismiss matrix {#S13}
- **Do:** Repeat S12 and dismiss the resulting spotlight five separate ways,
  once each: (a) click the spotlighted target itself, (b) click anywhere
  else on the page, (c) press Escape, (d) toggle the find affordance off
  again, (e) navigate to a different route.
- **Expect:** Each of the five actions dismisses the spotlight on its own —
  no leftover spotlight overlay persists after any of them.
- **Expect:** Dismissing via (a) both performs the target control's normal
  action and clears the spotlight in the same interaction — it does not
  take a separate click to clear it first.

### S14 — Icon-collapsed sidebar shows a progress-ring popover {#S14}
- **Do:** Collapse the sidebar to its icon-only mode.
- **Expect:** The Getting-started section collapses to a single progress-ring
  icon; interacting with it opens a popover showing the same overall and
  per-page progress summary available in the expanded view, without
  requiring the sidebar to expand.

### S15 — Collapse state persists across restart {#S15}
- **Do:** Collapse the Getting-started accordion itself (not the whole
  sidebar), then fully restart the app.
- **Expect:** The accordion remains collapsed after relaunch.
- **Expect (negative):** Collapsing the accordion does not reset, hide, or
  remove any item's tick state or the overall progress count.

### S16 — Permanently remove the section {#S16}
- **Do:** Open the Getting-started section's header menu and choose the
  permanent-remove action; confirm at the resulting prompt.
- **Expect:** A confirmation prompt appears before the section is removed
  (it is not a single-click irreversible action).
- **Expect:** After confirming, the section no longer appears in the
  sidebar.
- **Expect (negative):** The removed section does not reappear on its own —
  not after an app restart, not after navigating between pages, not after
  completing further real domain actions that would otherwise have ticked
  items. It stays absent until explicitly restored (S17).

### S17 — Restore from Settings re-seeds from real state {#S17}
- **Do:** In Settings, use the control that restores the Getting-started
  section.
- **Expect:** The section reappears in the sidebar with its auto-tick items
  re-seeded from actual current database state — any item whose real
  domain event already occurred (e.g. an inventory item confirmed earlier
  in this journey) shows as already complete, not reset to zero.
- **Expect (negative):** No demo or sample data is created by the restore;
  prerequisite-gated items whose prerequisite is already satisfied in real
  data show unlocked immediately, not locked pending a fresh event.

### S18 — The checklist never blocks ordinary workflow {#S18}
- **Do:** With the Getting-started section visible (expanded or collapsed)
  and, separately, with a spotlight active from S12, perform a complete
  real workflow unrelated to any checklist affordance (e.g. navigate
  directly to Projects and create a project without touching the
  checklist).
- **Expect:** The workflow completes exactly as it would with the checklist
  absent; any relevant checklist item updates afterward without having
  interrupted the workflow.
- **Expect (negative):** At no point does the checklist or an active
  spotlight intercept a click meant for the page, force navigation away
  from the user's current action, or present a blocking modal during
  ordinary work.

## Success criteria

- SC1: Across one fresh install, the orientation walk auto-opens exactly
  once (S1) and zero additional times across at least one subsequent app
  restart (S4) — checkable via a persisted one-time-orientation flag and by
  observing no walk overlay on relaunch.
- SC2: Both terminal walk outcomes (Finish via S2, Skip/Escape via S3)
  independently satisfy SC1 — the walk does not distinguish "skipped" from
  "finished" for re-run purposes.
- SC3: Every one of the 5 page groups (Inbox, Sessions, Calibration,
  Targets, Projects) contains between 2 and 4 items at all times — a fixed,
  checkable count range.
- SC4: The overall progress numerator changes only in response to a real
  domain event (`inventory.confirmed`, `project.created`, `tool.launch`
  outcome=spawned) or an explicit manual check (S9, S11) — restore-source
  events (S10) produce zero ticks across at least one exercised restore
  action.
- SC5: Zero demo, sample, or seeded-for-display records exist in inventory,
  sessions, projects, or targets at any point during or after this journey
  — every record present traces to a real user action taken during the
  journey.
- SC6: The permanently removed section (S16) stays absent across at least
  one full app restart and one unrelated navigation sequence, until
  Settings restore (S17) is used — never reappearing on its own.
- SC7: Every one of the five spotlight-dismiss triggers in S13 clears the
  spotlight with no leftover overlay, and no click on the underlying page
  is ever swallowed by an active spotlight (S12, S18).
- SC8: A checklist item's completed state (auto- or manually-ticked) never
  regresses back to incomplete on its own — only a permanent-remove +
  restore cycle can change how it's re-seeded, and only from real DB state.

## Known gaps

- G1: No code implements this design yet — `apps/desktop/src/features/guided/`
  currently implements the superseded spec-010 3-step non-modal coach, not
  the walk/checklist/spotlight design this journey describes. The
  replacement (spec-056-onboarding-redesign) is being authored in parallel
  and had not merged as of this journey's authoring (2026-07-18). This
  journey cannot be validated against a running app until that
  implementation lands; first validation run is pending.

## Delta log

(none — first version)
