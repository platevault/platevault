---
id: J18
title: Get oriented on Home after setup and track first-run progress
version: 3
status: draft
last_reviewed: 2026-07-19
actors: [astrophotographer]
surfaces: [onboarding, shell, home, import, sessions, targets, projects]
interfaces: [desktop-ui, desktop-ui-macos]
trace:
  - specs/056-onboarding-redesign (legacy design of the walk and checklist; PR #1048)
  - specs/063-clean-rebuild-contract/spec.md (FR-020, FR-023)
  - specs/064-library-inventory/spec.md (LIB-FR-05, LIB-FR-10, LIB-FR-16, LIB-AC-09)
  - specs/065-project-goals/spec.md (PRJ-FR-01, PRJ-FR-17)
  - specs/066-view-selection/spec.md (VSEL-FR-01)
  - specs/071-storage-custody/spec.md (STO-IMP-FR-01, STO-IMP-FR-02, STO-IMP-FR-06)
  - workflow decisions D-W1, D-W3, D-W7, D-W11, D-W24, D-W33, D-W39 (settled 2026-10-06)
  - github: platevault/platevault#881
  - product decision 2026-07-18 (user-approved onboarding redesign)
---

## Goal

A user who just finished first-run setup gets a one-time guided tour of the
app's workflow pages, starting on Home, the Projects dashboard. Afterwards they
keep a persistent, per-page "Getting started" checklist beside the sidebar that
tracks their real first-run progress as they import captures, create a
Project and run their processing tool. It never uses demo data and never
blocks a workflow. Done means:

- The tour ran exactly once, or was skipped, and never auto-runs again.
- The checklist reflects real catalog state at every point: items tick on real outcomes and can be checked by hand for the rest.
- The user can locate any tracked control through a non-blocking spotlight.
- The user can collapse or permanently remove the checklist and restore it later without losing or faking progress.

## Preconditions

- P1: First-run setup has just completed on a fresh install or a reset development database. Only an empty Captures folder, `Empty/Captures`, is registered. No session, Project, processing run or My targets entry exists, and no demo or sample record exists anywhere.
- P2: The desktop app is running with the sidebar in its default expanded state, unless a step says otherwise (S14 covers the icon-collapsed variant).
- P3: Folder `Untyped/` holds only 2 frames with no frame-type header. Removable volume `Card-1` holds the 30 NGC 7000 Ha lights of J31/P2.
- P4: A processing profile for Siril is configured and Siril is installed, as J24 requires for **Open in Siril**. Settings > Equipment holds rig `RedCat` (RedCat 51 + ASI2600MM, as J15/S3 composes it), the rig that captured the Card-1 lights.

## Steps

### S1 — Orientation walk launches automatically after setup {#S1}

- **Do:** Finish the first-run setup wizard.
- **Expect:** Immediately after the wizard closes, Home opens and a modal page walk starts on its own. Its first stop is anchored to Home.
- **Expect (negative):** No demo, sample or placeholder session, Project, run or Target record exists anywhere as a result of the walk starting. The walk is only an overlay on an empty, real library.
- **Trace:** LIB-FR-10 · LIB-AC-09 · D-W39

### S2 — Complete the walk end to end {#S2}

- **Do:** Use Next to advance through every stop.
- **Expect:** The walk has exactly five stops in order: Home, Import, Sessions, Targets, then a final stop pointing at the sidebar's "Getting started" trigger. The last stop highlights the trigger without page navigation. Each of the first four stops' Next brings the corresponding page into view, and Back returns to the prior stop and its page. Finishing the last stop closes the walk.
- **Expect (negative):** No stop mentions an Inbox, a standalone View or "File into library". While the walk is open, clicking outside its tooltip neither dismisses it nor acts on the underlying page. The walk is modal and is controlled only by Next, Back, Skip and Escape.
- **Trace:** product decision 2026-07-18 · LIB-FR-10 · D-W7, D-W11, D-W24, D-W39

### S3 — Skip the walk instead of finishing it {#S3}

- **Do:** From a fresh, not-yet-oriented install, open the walk (S1) and either click Skip on any stop or press Escape.
- **Expect:** The walk closes immediately from whichever stop it was on.
- **Expect:** Skipping is recorded as equivalent to finishing for "never auto-runs twice" (S4). Skip and finish are the two terminal outcomes of the same one-time walk.

### S4 — The walk never auto-runs a second time {#S4}

- **Do:** After completing S2 or S3, fully restart the app (quit and relaunch) at least once.
- **Expect (negative):** The walk does not open automatically on any later launch, whether it was finished or skipped.

### S5 — Replay the walk from Settings {#S5}

- **Do:** Go to Settings → Advanced and use the restart-tour control.
- **Expect:** The walk reopens at stop 1 (Home), whether it was previously finished or skipped.
- **Expect (negative):** Replaying the walk does not reset or alter the checklist's tick state. The two are independent.

### S6 — The Getting-started trigger sits in the sidebar {#S6}

- **Do:** With the walk closed, look at the sidebar's workflow navigation, then click the Getting-started trigger.
- **Expect:** A Getting-started trigger appears above the Settings entry, separated from the primary workflow navigation the same way Settings is. It carries a progress ring that sums progress across all page groups, and it is labelled while the sidebar is expanded.
- **Expect:** Clicking it opens the checklist as a flyout panel beside the sidebar, with an overall progress indicator at its top. It is a panel, not an inline sidebar section: the sidebar's own content does not reflow.
- **Expect:** The flyout is non-modal. The rest of the app stays visible and clickable, and clicking outside it, including on a navigation link, closes it.
- **Expect (negative):** Nothing resembling the checklist is visible in the sidebar before the trigger is clicked.

### S7 — Per-page groups and auto-expand {#S7}

- **Do:** Open the flyout, then navigate between Home, Import, Sessions and Targets, reopening the flyout after each navigation.
- **Expect:** The checklist holds exactly four page groups, one each for Home, Import, Sessions and Targets, and each group lists between 2 and 4 short item labels:
  - Home: Create your first Project, Start a processing run, Open a run in your tool.
  - Import: Import from a card or folder, Save an Import source.
  - Sessions: Confirm a session's Target, Find sessions that need a Target.
  - Targets: Add a Target to My targets, Add an observing site.
- **Expect:** Each item's inline label is 3 to 6 words; the fuller explanatory copy lives only in the item's tooltip.
- **Expect:** The page group matching the open page is auto-expanded; the others may be collapsed.
- **Expect:** Hovering an item label shows its tooltip copy. Keyboard-focusing the item's checkbox shows the same copy, and Escape dismisses it without moving focus (WCAG 1.4.13). The checkbox owns the reveal because the label is not focusable.
- **Expect (negative):** No group or item refers to an Inbox, a standalone View or "File into library".

### S8 — Prerequisite-gated item shows reason and jump-link {#S8}

- **Do:** With no session indexed yet, open the Home group and find **Create your first Project**.
- **Expect:** The item shows a prerequisite-not-met state. Its reason text says that captures must be imported or indexed first, and a jump-link opens the Import page.
- **Expect (negative):** The item cannot be checked by hand while its prerequisite is unmet: its checkbox refuses the click.

### S9 — A real Import auto-ticks its item {#S9}

- **Do:** Follow the jump-link from S8. Import `Untyped/` with Copy and leave both frames unset. Then import `Card-1` with Copy, choosing `Empty/Captures` as the Captures location.
- **Expect:** After the `Untyped/` import, its summary reads 0 imported and 2 held Unclassified, and **Import from a card or folder** stays unticked. After the `Card-1` import, whose summary reads 30 imported, the item ticks automatically with no manual check. The tick plays its completion choreography: a brief emphasis in place, then a move into the group's completed area, while the overall progress indicator pulses.
- **Expect:** **Create your first Project** now shows its prerequisite as met, with the reason text and lock state cleared.
- **Expect (negative):** An Import that imports no file ticks nothing. No demo or sample session was created to produce the tick; only the user's own 30 imported frames exist.
- **Trace:** STO-IMP-FR-02, STO-IMP-FR-06 · LIB-FR-16 · D-W11, D-W24

### S9a — A real Project create auto-ticks its item {#S9a}

- **Do:** In Sessions, choose **Confirm Target** NGC 7000 for the Card-1 session. From Home, choose **New Project** and create a real Project with subject NGC 7000, rig `RedCat` and any name.
- **Expect:** **Confirm a session's Target** ticks when the confirmation saves. **Create your first Project** ticks automatically when the Project is saved. Both use the same completion choreography as S9.
- **Expect (negative):** No demo, sample or placeholder Project was created to produce the tick. Only the Project the user created exists, with the name, subject and rig the user entered.
- **Trace:** PRJ-FR-01 · LIB-FR-05 · D-W1, D-W33

### S9b — A real tool launch auto-ticks its item {#S9b}

- **Do:** In Sessions, choose **Confirm equipment** with rig `RedCat` for the Card-1 session. On the S9a Project, choose **Start a processing run**, save its membership and prepare it. First set the Siril profile's executable to a path that does not exist and choose **Open in Siril**. Then restore the real executable and choose **Open in Siril** again, so the launch actually starts Siril.
- **Expect:** **Start a processing run** ticks when the run is created. **Open a run in your tool** ticks only when the second launch starts the Siril process, with the same choreography as S9.
- **Expect (negative):** The failed first launch does not tick the item. Only a launch that actually starts the tool counts.
- **Trace:** VSEL-FR-01 · D-W1, D-W3 · G3

### S11 — Manual check and dismiss for non-event items {#S11}

- **Do:** Find a checklist item that no real outcome ticks, such as **Find sessions that need a Target**, and check it by hand. On a different item, use its dismiss action instead of checking it.
- **Expect:** The checked item enters the completed state through the user's action alone, with the same in-place-then-move choreography as an auto-tick.
- **Expect:** The dismissed item leaves the active list without counting as completed in the overall progress.
- **Expect (negative):** Checking or dismissing an item by hand never performs the action the item describes, and never changes any other item's or group's state.

### S12 — Spotlight find on a checklist item {#S12}

- **Do:** Click the find affordance next to a checklist item whose control is on the current page or in the sidebar.
- **Expect:** A non-modal spotlight highlights the real control in place, with a pulse animation that settles after a brief period.
- **Expect (negative):** Under a reduced-motion setting, the spotlight appears without the pulse animation.
- **Expect (negative):** The spotlight never blocks clicks on the underlying page. Every control beneath and around it stays clickable while the spotlight shows.

### S13 — Spotlight dismiss matrix {#S13}

- **Do:** Repeat S12 and dismiss the resulting spotlight five separate ways, once each: (a) click the spotlighted control, (b) click elsewhere on the page, (c) press Escape, (d) toggle the find affordance off again, (e) navigate to a different route.
- **Expect:** Each of the five actions dismisses the spotlight on its own, and no spotlight overlay remains after any of them.
- **Expect:** Dismissing via (a) both performs the control's normal action and clears the spotlight in the same interaction. It does not take a separate click to clear it first.

### S14 — Icon-collapsed sidebar keeps the same flyout {#S14}

- **Do:** Collapse the sidebar to its icon-only mode.
- **Expect:** The Getting-started trigger becomes a bare progress ring with no label. Opening it shows the same flyout, with the same overall and per-page progress, without expanding the sidebar.
- **Expect (negative):** The checklist is not rendered inline at either sidebar width. The flyout is its only host, so collapsing the sidebar changes only the trigger's appearance.

### S15 — Collapse state persists across restart {#S15}

- **Do:** Collapse the checklist section from inside the flyout (not the whole sidebar), then fully restart the app.
- **Expect:** The section is still collapsed when the flyout is reopened after relaunch.
- **Expect (negative):** Collapsing does not reset, hide or remove any item's tick state or the overall progress count.

### S16 — Permanently remove the section {#S16}

- **Do:** Open the Getting-started section's header menu and choose the permanent-remove action. Confirm at the prompt.
- **Expect:** A confirmation prompt appears before the section is removed; it is not a single-click irreversible action.
- **Expect:** After confirming, both the checklist and its sidebar trigger (the progress ring) disappear, leaving no ring to click.
- **Expect (negative):** The removed section does not reappear on its own: not after an app restart, not after navigating between pages, and not after further real outcomes that would otherwise tick items. It stays absent until restored (S17).

### S17 — Restore from Settings re-seeds from real state {#S17}

- **Do:** In Settings, use the control that restores the Getting-started section.
- **Expect:** The sidebar trigger reappears. Opening it shows the checklist with its auto-tick items re-seeded from current catalog state: every item whose real outcome already happened in this journey (the S9 Import, the S9a Project, the S9b launch) shows as complete, not reset to zero.
- **Expect (negative):** The restore creates no demo or sample data. Gated items whose prerequisite is already met show unlocked immediately, not locked pending a fresh outcome.

### S18 — The checklist never blocks ordinary workflow {#S18}

- **Do:** With the Getting-started trigger present (flyout open or closed), and separately with a spotlight active from S12, complete a real workflow without touching the checklist: from Home, choose **New Project** and create a second Project.
- **Expect:** The workflow completes exactly as it would with the checklist absent, and any matching checklist item updates afterwards without interrupting it.
- **Expect (negative):** At no point does the checklist or an active spotlight intercept a click meant for the page, force navigation away from the user's current action, or present a blocking modal during ordinary work.

## Success criteria

- SC1: Across one fresh install, the orientation walk opens on its own exactly once (S1) and 0 more times across at least one later restart (S4). This is checkable through a persisted one-time-orientation flag and by observing no walk overlay on relaunch.
- SC2: Both terminal walk outcomes, Finish (S2) and Skip or Escape (S3), satisfy SC1 on their own. The walk does not distinguish "skipped" from "finished" for re-run purposes.
- SC3: The walk has exactly 5 stops, and the checklist has exactly 4 page groups (Home, Import, Sessions, Targets) with between 2 and 4 items each at all times (S2, S7).
- SC4: The overall progress count changes only in response to a real outcome (S9, S9a, S9b) or an explicit manual check (S11). The 0-imported Import (S9) and the failed launch (S9b) each produce 0 ticks.
- SC5: Zero demo, sample or seeded-for-display records exist among sessions, Projects, runs or Targets at any point during or after this journey. Every record traces to a real user action taken during the journey.
- SC6: The removed section (S16) stays absent across at least one full restart and one unrelated navigation sequence until Settings restore (S17) is used.
- SC7: Each of the five spotlight-dismiss triggers in S13 clears the spotlight with no leftover overlay, and 0 clicks on the underlying page are swallowed by an active spotlight (S12, S18).
- SC8: A checklist item's completed state, whether auto-ticked or checked by hand, never goes back to incomplete on its own. Only a permanent-remove and restore cycle changes how it is re-seeded, and only from real catalog state.

## Known gaps

- G1: Not validated. The rebuilt application does not exist, and the v2 behavior was checked only against the legacy implementation of spec 056. Nothing in this version has been validated.
- G2: Unresolved product question: no requirement in specs 063 to 072 owns the orientation walk or the Getting-started checklist. The stops, page groups, items and gates in S2, S7 and S8 apply the 2026-10-06 workflow decisions to the spec 056 design, and need a human decision and a spec owner. Blocks readiness.
- G3: Unresolved implementation qualification: S9b needs a prepared run and a working Siril launch, as J24 sets up; a failing-executable profile for the negative case is not specified. Blocks readiness.

## Delta log

### v2 — 2026-07-19 — realign to the shipped flyout architecture

Authored in parallel with spec 056 and never reconciled against what shipped,
so v1 described a UI that does not exist. Amended against the implementation
on PR #1048.

- **S6** rewritten. v1 had the checklist as an inline accordion in the sidebar,
  expanded by default. It ships as a **flyout**: a progress-ring trigger sits
  above Settings and opens a portalled non-modal panel beside the sidebar.
  Rendered inline, the list blended into the sidebar's own surface and read as
  navigation. Added a negative expectation that nothing checklist-like is
  visible before the trigger is clicked.
- **S7** now re-opens the flyout after each navigation, because navigating
  closes it. The tooltip expectation names the checkbox as the keyboard
  reveal owner and adds Escape-without-moving-focus (WCAG 1.4.13, #1103) —
  the label is not focusable, which is how the keyboard path regressed.
- **S14** no longer describes the icon-collapsed width as a *different*
  presentation. Both widths use the same flyout; only the trigger differs
  (labelled row vs bare ring). Added a negative expectation against an inline
  host at either width.
- **S15** collapses the section from inside the flyout rather than collapsing
  an inline accordion.
- **S16** expects the trigger to disappear along with the checklist, so no
  dead ring is left behind.
- **S17/S18** reworded from "the section in the sidebar" to the trigger plus
  its flyout.

The v1 Known-gaps entry (G1: "no code implements this design yet; first
validation run pending") is removed — the implementation has landed and the
steps above were checked against it.

- **Δ3** 2026-10-06 · S1, S2, S5, S7, S8, S9, S9a, S9b, S17, S18 · behavior-change
  The walk starts on Home and visits Home, Import, Sessions and Targets, because the Inbox is gone and Home is the Projects dashboard. The checklist groups follow the same pages. Import replaces the Inbox confirm as the first auto-ticked item, and a 0-imported Import ticks nothing. A Project is created with a subject and rig, and the tool launch runs from a processing run. The restore-source step S10 is retired and its id stays unused; the 0-imported Import in S9 now covers outcome-shape filtering.
  Evidence: D-W1, D-W3, D-W7, D-W11, D-W24, D-W33, D-W39, 063 FR-020, 064 LIB-FR-10, LIB-FR-16 and 071 STO-IMP-FR-01 at e4476231. Rig name `RedCat` from J15/S3; spec text for these steps unchanged at d45a22ad · by: agent (intent-gated, user instruction)
