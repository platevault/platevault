---
id: J18
title: Get oriented after setup and track first-run progress on Home
version: 4
status: draft
last_reviewed: 2026-07-19
actors: [astrophotographer]
surfaces: [onboarding, shell, home, import, sessions, targets, projects, view-review, preparation, settings]
interfaces: [desktop-ui, desktop-ui-macos]
trace:
  - specs/056-onboarding-redesign (legacy design of the walk and checklist; PR #1048)
  - specs/056-onboarding-redesign/PENDING_REVIEW_QUESTIONS.md (PQ-004, user directive 2026-07-18: auto-hide when complete, resurface through Settings)
  - specs/063-clean-rebuild-contract/spec.md (FR-020, FR-023)
  - specs/064-library-inventory/spec.md (LIB-FR-05, LIB-FR-10, LIB-FR-16, LIB-AC-09)
  - specs/065-project-goals/spec.md (PRJ-FR-01, PRJ-FR-17)
  - specs/066-view-selection/spec.md (VSEL-FR-01)
  - specs/071-storage-custody/spec.md (STO-IMP-FR-01, STO-IMP-FR-02, STO-IMP-FR-06)
  - workflow decisions D-W1, D-W3, D-W7, D-W11, D-W24, D-W33, D-W39, D-W50
  - github: platevault/platevault#881
  - product decision 2026-07-18 (user-approved onboarding redesign)
  - HARNESS-V5-FEEDBACK-R1.md#round-6
  - HARNESS-V5-IA.md#source-list, HARNESS-V5-IA.md#S1, HARNESS-V5-IA.md#S3, HARNESS-V5-IA.md#S4, HARNESS-V5-IA.md#S5, HARNESS-V5-IA.md#S13
  - HIGH-LEVEL-DESIGN.md §7 (Motion)
  - apps/prototype/src/features/t1/setup/setup-pages.tsx (Welcome, Locations, Index; ui-harness-v5 @ 4f470775)
---

## Goal

A user who just finished first-run setup gets a one-time orientation walk.
After it, a Getting started checklist on Home tracks four real first-run
outcomes: setup, a first import, a first Project and a first processing run.
It never uses demo data and never blocks a workflow. Done means:

- The walk ran exactly once, or was skipped, and never auto-runs again. Settings can replay it.
- Home's checklist holds exactly those four items, and each ticks only on its real catalog outcome.
- Once all four are done, Home no longer shows the checklist. A Settings restore brings it back, re-seeded from real state rather than reset.

## Preconditions

- P1: A fresh install or a reset development database, showing the first-run Welcome screen. Folder `Empty/Captures` exists and is empty. No location, session, Project, processing run or My targets entry exists, and no demo or sample record exists anywhere.
- P2: The desktop app is running and has never completed first-run setup or the orientation walk.
- P3: Folder `Untyped/` holds only 2 frames with no frame-type header. Removable volume `Card-1` is connected and holds only the 30 NGC 7000 Ha lights of J31/P2, whose pointing lies within NGC 7000's footprint.
- P4: A processing profile for Siril is configured and Siril is installed, as J24 requires for **Open in Siril**. Settings › Equipment holds rig `RedCat` (RedCat 51 + ASI2600MM, as J15/S3 composes it), the rig that captured the Card-1 lights. Both are set through Settings before S1.

## Steps

### S1 — Orientation walk launches automatically after setup {#S1}

- **Do:** On the Welcome screen, click **Set up locations**. Add `Empty/Captures` as the Captures location and leave Calibration and Results unset. Click **Continue**, then **Start indexing**. When indexing has finished, click **Open library**.
- **Expect:** Setup closes, and a modal orientation walk opens at its first stop without any further click. Which page setup hands over to, and what the first stop shows, is G4.
- **Expect (negative):** Neither setup nor the walk creates a demo, sample or placeholder session, Project, run or Target record anywhere. The walk is only an overlay on an empty, real library.
- **Trace:** LIB-FR-10 · LIB-AC-09 · D-W39 · product decision 2026-07-18 (spec 056 FR-001) · prototype src/features/t1/setup/setup-pages.tsx · HARNESS-V5-FEEDBACK-R1.md §Round 6 (Onboarding: walk plus checklist) · G4

### S2 — Complete the walk end to end {#S2}

- **Do:** Use Next to advance through every stop, then finish the walk at the last stop.
- **Expect:** Every stop before the last brings its page into view, and Back returns to the prior stop and its page. The last stop points at Home's Getting started checklist (S6) with Home in view. Finishing the last stop closes the walk. Which pages the earlier stops show, and in what order, is G4.
- **Expect (negative):** No stop mentions an Inbox, a View, "File into library" or a sidebar Getting started trigger, and no stop points at a page that the v5 source list or toolbar does not offer. While the walk is open, clicking outside its tooltip neither dismisses it nor acts on the underlying page. The walk is modal and is controlled only by Next, Back, Skip and Escape.
- **Trace:** product decision 2026-07-18 (spec 056 FR-002, FR-003) · LIB-FR-10 · D-W7, D-W11, D-W24, D-W39 · HARNESS-V5-IA.md §Source list · HARNESS-V5-FEEDBACK-R1.md §Round 6 (Onboarding: walk plus checklist) · G4

### S3 — Skip the walk instead of finishing it {#S3}

- **Do:** From a fresh, not-yet-oriented install, open the walk (S1) and either click Skip on any stop or press Escape.
- **Expect:** The walk closes immediately from whichever stop it was on.
- **Expect:** Skipping is recorded as equivalent to finishing for "never auto-runs twice" (S4). Skip and finish are the two terminal outcomes of the same one-time walk.

### S4 — The walk never auto-runs a second time {#S4}

- **Do:** After completing S2 or S3, fully restart the app (quit and relaunch) at least once.
- **Expect (negative):** The walk does not open automatically on any later launch, whether it was finished or skipped.

### S5 — Replay the walk from Settings {#S5}

- **Do:** In Settings, use the control that replays the orientation walk (G4).
- **Expect:** The walk reopens at its first stop, whether it was previously finished or skipped.
- **Expect (negative):** Replaying the walk does not reset or alter the checklist's tick state. The two are independent.
- **Trace:** product decision 2026-07-18 (spec 056 FR-005) · G4

### S6 — The Getting started checklist sits on Home {#S6}

- **Do:** With the walk closed (S2 or S3), read Home, then the source list and its footer.
- **Expect:** Home shows a Getting started checklist. Home's header still offers **Plan tonight**, **New Project** and **Import**. The checklist is not modal: every other Home control stays usable while it shows.
- **Expect (negative):** The source list and its footer have no Getting started entry, progress ring or flyout, and the source list stays navigation only.
- **Trace:** HARNESS-V5-FEEDBACK-R1.md §Round 6 (Onboarding: walk plus checklist) · HARNESS-V5-IA.md §Source list (Round 2: navigation only), §Screens S1

### S7 — The checklist holds the four first-run items {#S7}

- **Do:** Read the checklist on Home.
- **Expect:** It holds exactly four items, in this order: setup, first import, first Project, first run. The setup item reads done, because S1 registered and indexed `Empty/Captures` and ended setup with **Open library**. The other three read not done, and an overall progress indicator reads 1 of 4 done.
- **Expect (negative):** No item refers to an Inbox, a View, "File into library", a page group, an observing site, a session's Target confirmation, the walk or a Calibration task. No item reads done before its outcome has happened.
- **Trace:** HARNESS-V5-FEEDBACK-R1.md §Round 6 (Onboarding: walk plus checklist) · product decision 2026-07-18 (spec 056 FR-007 overall progress, FR-009 no demo data) · G5

### S9 — A real Import auto-ticks the first-import item {#S9}

- **Do:** On Home, click **Import** in the header. Click **Choose folder…**, pick `Untyped/`, read the preview, then close the sheet without importing. Open Import again and choose `Card-1` as the source. Its destination is `Empty/Captures`, the only Captures location. In the preview, confirm NGC 7000 as the incoming session's Target, choosing it there if it is not prefilled. Choose **Copy** and click **Import 30 frames**. When the import finishes, open Home.
- **Expect:** For `Untyped/`, the preview holds both frames, the start button is unavailable, and the sheet reads `Only held files`. Home's first-import item still reads not done.
- **Expect:** The Card-1 import's summary reads `30 frames · <size> · 1 session`. On Home, the first-import item then reads done without any manual action, and the progress indicator reads 2 of 4. The item changes state in place, with no animation beyond what the v5 motion rule allows (HIGH-LEVEL-DESIGN.md §7: open-close fades and the running spinner only).
- **Expect (negative):** Neither the held-only `Untyped/` source nor closing the sheet ticks anything. No Inbox and no later filing step appears. No demo or sample session was created to produce the tick: the only frames are the user's own 30 imported ones.
- **Trace:** STO-IMP-FR-02, STO-IMP-FR-06 · LIB-FR-16 · D-W11, D-W24 · HARNESS-V5-IA.md §Screens S1, S13 · HARNESS-V5-FEEDBACK-R1.md §Round 6 (P-IMP2, Onboarding: walk plus checklist) · prototype messages/en-GB.json `import_only_held` · G5

### S9a — A real Project create auto-ticks its item {#S9a}

- **Do:** On Home, click **New Project** in the header and create a Project named `First light` with subject NGC 7000 and rig `RedCat`. Open Home.
- **Expect:** Once `First light` is saved, the first-Project item reads done without any manual action, and the progress indicator reads 3 of 4.
- **Expect (negative):** No demo, sample or placeholder Project was created to produce the tick. `First light` is the only Project, with the subject and rig the user entered.
- **Trace:** PRJ-FR-01 · LIB-FR-05 · D-W1, D-W33 · HARNESS-V5-IA.md §Screens S1, S4

### S9b — A real processing run auto-ticks the first-run item {#S9b}

- **Do:** Read Home's checklist. On the `First light` Project page, in Runs, click **Start run**. In the sheet, choose subject NGC 7000, rig `RedCat` and the Siril profile, then click **Start run**. Keep the Card-1 session selected, then save the run's membership and prepare it as J24 does. Point Siril's executable at a path that does not exist, click **Open in Siril**, and read Home. Restore the real executable and click **Open in Siril** again, so that Siril actually starts. Then quit Siril.
- **Expect:** Before **Start run**, Home's first-run item reads not done.
- **Expect:** The run is created inside `First light`, named `NGC 7000 RedCat`. It opens at its Select step with the 30-frame Card-1 session selected.
- **Expect:** After the successful launch, every candidate meaning in G5 (started, prepared, opened) is met, so all four items are done (S9c). G5 decides which of the three moments ticks the item.
- **Expect (negative):** The failed launch ticks nothing. If Home's first-run item read not done before it, it still reads not done after it. No demo or sample run exists: `NGC 7000 RedCat` is the only run.
- **Trace:** VSEL-FR-01 · D-W1, D-W3, D-W50 · HARNESS-V5-IA.md §Screens S3, S5 · HARNESS-V5-FEEDBACK-R1.md §Round 6 (Rename runs and Projects: Start run stays subject + rig + profile, auto-named) · G3, G5

### S9c — The checklist leaves Home once every item is done {#S9c}

- **Do:** After S9b, open Home. Then quit and relaunch the app, and open Home again.
- **Expect:** Home no longer shows the Getting started checklist, and its header still offers **Plan tonight**, **New Project** and **Import**. After the relaunch, Home still shows no checklist.
- **Expect (negative):** The checklist does not come back on its own after the relaunch, and the walk does not open (S4).
- **Trace:** HARNESS-V5-FEEDBACK-R1.md §Round 6 (Onboarding: walk plus checklist, "until done") · product decision 2026-07-18 (spec 056 PQ-004: auto-hide when complete, resurface through Settings)

### S17 — Restore from Settings re-seeds from real state {#S17}

- **Do:** In Settings, use the control that restores the Getting started checklist (G6). Open Home.
- **Expect:** Home shows the checklist again. Its four items are re-seeded from current catalog state, and all four read done: setup (S1), first import (the S9 Card-1 import), first Project (`First light`, S9a) and first run (`NGC 7000 RedCat`, S9b). The progress indicator reads 4 of 4, and nothing is reset to not done.
- **Expect (negative):** The restore creates no demo or sample data and does not open the walk.
- **Trace:** product decision 2026-07-18 (spec 056 PQ-004, FR-014) · HARNESS-V5-FEEDBACK-R1.md §Round 6 (Onboarding: walk plus checklist) · G6

### S18 — The checklist never blocks ordinary workflow {#S18}

- **Do:** With the restored checklist on Home (S17), click **New Project** in Home's header and create a second Project, `Second light`, with subject NGC 7000 and rig `RedCat`.
- **Expect:** The Project is created exactly as it would be with no checklist present, and Projects lists `First light` and `Second light`. Every checklist item keeps its state.
- **Expect (negative):** At no point does the checklist intercept a click meant for the page, force navigation away from the user's current action, or present a blocking modal during ordinary work.

## Success criteria

- SC1: Across one fresh install, the orientation walk opens on its own exactly once (S1) and 0 more times across at least one later restart (S4). This is checkable through a persisted one-time-orientation flag and by observing no walk overlay on relaunch.
- SC2: Both terminal walk outcomes, Finish (S2) and Skip or Escape (S3), satisfy SC1 on their own. The walk does not distinguish "skipped" from "finished" for re-run purposes.
- SC3: Every time Home shows the checklist (S7, S9, S9a, S17), it holds exactly 4 items, in the order setup, first import, first Project, first run. The source list shows 0 Getting started controls (S6), and the walk's last stop points at Home's checklist (S2).
- SC4: The checklist's done count changes only in response to a real outcome. It reads 1, 2 and 3 of 4 after setup (S7), the Card-1 import (S9) and `First light` (S9a). The held-only `Untyped/` source (S9) and the failed launch (S9b) each produce 0 ticks.
- SC5: Zero demo, sample or seeded-for-display records exist among sessions, Projects, runs or Targets at any point during or after this journey. Every record traces to a real user action taken during the journey.
- SC6: Once all 4 items are done, Home shows 0 checklists across at least one full relaunch (S9c), until the Settings restore (S17) is used.
- SC8: A done item never goes back to not done on its own (S9 to S9c). The restore re-seeds all 4 items as done from real catalog state (S17).
- SC9: The checklist intercepts 0 clicks meant for Home, the Import sheet, the New Project sheet or the run (S9 to S9b, S18).

## Known gaps

- G1: Not validated. The rebuilt application does not exist, and the v2 behavior was checked only against the legacy implementation of spec 056. Nothing in this version has been validated.
- G2: (dissolved 2026-10-12): answered by Round 6 "Onboarding: walk plus checklist", which is now the owning decision; the contract text follows in D-W28 order. S1 to S5 now assert a one-time walk after setup that ends on Home's checklist. S6, S7, S9 to S9c and S17 assert a Getting started checklist on Home with exactly the four items setup, first import, first Project and first run, shown until all four are done. The page groups and gates of the spec 056 design are gone. G4 to G6 hold what Round 6 leaves open.
- G3: Unresolved implementation qualification: S9b needs a prepared run and a working Siril launch, as J24 sets up; a failing-executable profile for the negative case is not specified. Blocks readiness.
- G4: Unresolved product question: Round 6 decides only that there is "an orientation walk after setup". No v5 source answers four things. (1) Which pages the stops show, and in what order: the v3 stops Home, Import, Sessions and Targets assumed Home was the Projects dashboard, but v5 gives Projects and Calibration their own pages and makes Import a toolbar sheet. (2) Which page setup hands over to: the prototype's **Open library** opens Targets, while J19/S6 asserts Home. (3) Whether the **Index later** and **Set up later** exits also launch the walk. (4) Where in Settings the replay control lives, since v5 Settings has no Advanced page. S1, S2 and S5 assert only what holds under every answer. Blocks readiness.
- G5: Unresolved product question: Round 6 names the four items but not the outcome that ticks two of them, and leaves one import case open. (1) Setup: does it tick when setup ends by any exit, or only once a Captures location is registered and indexed, so that **Set up later** and **Index later** leave it not done? (2) First run: does it tick when a run is started, when it is prepared, or when a prepared run is opened in the processing application? (3) First import: does adding an existing library folder (indexing in place) count? S7 and S9b assert only what holds under every answer. Blocks readiness.
- G6: Unresolved product question: Round 6 says the checklist shows "until done", and all four items tick from real outcomes. No v5 source says whether the 2026-07-18 controls survive: a manual tick or un-check, per-item dismiss, collapse, removing the checklist before it is done, per-item prerequisite gates with jump links, and the find spotlight (whose pulse the v5 motion rule, HIGH-LEVEL-DESIGN.md §7, does not allow). Nor does any say where in Settings the restore control lives. Old steps 8 and 11 to 16 stay retired until this is answered. Blocks readiness.

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

- **Δ3** 2026-10-06 · S1, S2, S5, S7, retired old 8, S9, S9a, S9b, S17, S18 · behavior-change
  The walk starts on Home and visits Home, Import, Sessions and Targets, because the Inbox is gone and Home is the Projects dashboard. The checklist groups follow the same pages. Import replaces the Inbox confirm as the first auto-ticked item, and a 0-imported Import ticks nothing. A Project is created with a subject and rig, and the tool launch runs from a processing run. The restore-source step S10 is retired and its id stays unused; the 0-imported Import in S9 now covers outcome-shape filtering.
  Evidence: D-W1, D-W3, D-W7, D-W11, D-W24, D-W33, D-W39, 063 FR-020, 064 LIB-FR-10, LIB-FR-16 and 071 STO-IMP-FR-01 at e4476231. Rig name `RedCat` from J15/S3; spec text for these steps unchanged at d45a22ad · by: agent (intent-gated, user instruction)

- **Δ4** 2026-10-12 · S1, S2, S5, S6, S7, S9, S9a, S9b, +S9c, S17, S18 · behavior-change
  The Getting started checklist moves from the sidebar flyout to Home and holds exactly four items: setup, first import, first Project and first run. It leaves Home once all four are done, and Settings restores it. The walk follows the v5 setup (Welcome, Locations, Index) and ends on Home's checklist. Its page stops are open (G4).
  Import confirms the Target in its preview, and a held-only source cannot start. The run is auto-named, and ticks change state in place without animation (HIGH-LEVEL-DESIGN.md §7 Motion). Retired old steps 8 (gated item), 11 (manual check and dismiss), 12 and 13 (spotlight), 14 (icon-collapsed sidebar), 15 (flyout collapse) and 16 (remove before done); what replaces them is G5 and G6. G2 is dissolved; G4 to G6 are new.
  Evidence: HARNESS-V5-FEEDBACK-R1.md §Round 6 (user, 2026-10-10) "Onboarding: walk plus checklist", "P-IMP2: confirm Targets in the Import preview", "Rename runs and Projects" (apps/prototype/design/ on ui-harness-v5 @ 4f470775); user answers to the PR #1788 journey questions · by: JourneysV5.R6H (intent-gated)
