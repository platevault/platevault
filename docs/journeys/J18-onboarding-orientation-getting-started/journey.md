---
id: J18
title: Get oriented after setup and track first-run progress on Home
version: 6
status: draft
last_reviewed: 2026-07-19
actors: [astrophotographer]
surfaces: [onboarding, shell, home, import, sessions, targets, projects, view, output, settings]
interfaces: [desktop-ui, desktop-ui-macos]
trace:
  - specs/056-onboarding-redesign (legacy design of the walk and checklist; PR #1048)
  - specs/056-onboarding-redesign/PENDING_REVIEW_QUESTIONS.md (PQ-004, user directive 2026-07-18: auto-hide when complete, resurface through Settings)
  - specs/063-clean-rebuild-contract/spec.md (FR-020, FR-023)
  - specs/064-library-inventory/spec.md (LIB-FR-05, LIB-FR-10, LIB-FR-16, LIB-AC-09)
  - specs/065-project-goals/spec.md (PRJ-FR-01, PRJ-FR-07, PRJ-FR-17, PRJ-FR-22, PRJ-FR-30)
  - specs/066-view-selection/spec.md (VSEL-FR-01, VSEL-FR-12, VSEL-FR-14, VSEL-FR-16)
  - specs/071-storage-custody/spec.md (STO-IMP-FR-01, STO-IMP-FR-02, STO-IMP-FR-06)
  - workflow decisions D-W7, D-W11, D-W24, D-W89, D-W93 to D-W106
  - github: platevault/platevault#881
  - product decision 2026-07-18 (user-approved onboarding redesign)
  - HARNESS-V5-FEEDBACK-R1.md#round-6
  - HARNESS-V5-IA.md#source-list, HARNESS-V5-IA.md#S1, HARNESS-V5-IA.md#S3, HARNESS-V5-IA.md#S4, HARNESS-V5-IA.md#S5, HARNESS-V5-IA.md#S13
  - HIGH-LEVEL-DESIGN.md §7 (Motion)
  - apps/prototype/src/features/t1/setup/setup-pages.tsx (Welcome, Locations, Index; ui-harness-v5 @ 4f470775)
  - HARNESS-V5-FEEDBACK-R1.md#round-7 (P-PREP3: Windows Developer Mode is checked in setup)
---

## Goal

A user who just finished first-run setup gets a one-time orientation walk and
learns the current Home dashboard. The user imports real captures, creates a
Project and applies its View, the Project's processing inputs. Done means the
walk does not auto-run again, a real import and Project are recorded, and the
first Apply builds the Project's View from the original sessions.

## Preconditions

- P1: A fresh install or a reset development database, showing the first-run Welcome screen. Folder `Empty/Captures` exists and is empty. No location, session, Project or My targets entry exists, and no demo or sample record exists anywhere.
- P2: The desktop app is running and has never completed first-run setup or the orientation walk.
- P3: Folder `Untyped/` holds only 2 frames with no frame-type header. Removable volume `Card-1` is connected and holds only the 30 NGC 7000 Ha lights of J31/P2, whose pointing lies within NGC 7000's footprint.
- P4: Settings › Equipment holds rig `RedCat` (RedCat 51 + ASI2600MM, as J15/S3 composes it), the rig that captured the Card-1 lights. The processing location is available for the Project's View and Output folders.
- P5: On the `desktop-ui` (Windows) lane, Windows Developer Mode is off before S1 and the user can turn it on in Windows Settings. The `desktop-ui-macos` lane has no Developer Mode prerequisite.

## Steps

### S1 — Orientation walk launches automatically after setup {#S1}

- **Do:** On the Welcome screen, click **Set up locations**. Add `Empty/Captures` as the Captures location and leave Calibration unset. Click **Continue**, then **Start indexing**. When indexing has finished, click **Open library**.
- **Expect:** Setup closes, and a modal orientation walk opens at its first stop without any further click. Which page setup hands over to, and what the first stop shows, is G4. On the `desktop-ui` lane, the Locations step shows a Windows Developer Mode row reading Off, with **Open Windows settings** and **Check again**, and **Continue** stays available; on the `desktop-ui-macos` lane it shows no such row.
- **Expect (negative):** Neither setup nor the walk creates a demo, sample or placeholder session, Project or Target record anywhere. The walk is only an overlay on an empty, real library. Developer Mode being off blocks no setup step.
- **Trace:** LIB-FR-01, LIB-FR-03, LIB-FR-10 · PRJ-FR-17, PREP-FR-15 · D-W89 · product decision 2026-07-18 (spec 056 FR-001) · prototype src/features/t1/setup/setup-pages.tsx · HARNESS-V5-FEEDBACK-R1.md §Round 7 P-PREP3 ("Windows prerequisite": checked in setup) · G4

### S2 — Complete the walk end to end {#S2}

- **Do:** Use Next to advance through every stop, then finish the walk at the last stop.
- **Expect:** Every stop before the last brings its page into view, and Back returns to the prior stop and its page. The last stop points at Home's dashboard (S6) with Home in view. Finishing the last stop closes the walk. Which pages the earlier stops show, and in what order, is G4.
- **Expect (negative):** No stop mentions an Inbox, "File into library" or a sidebar Getting started trigger, and no stop points at a page that the v5 source list or toolbar does not offer. While the walk is open, clicking outside its tooltip neither dismisses it nor acts on the underlying page. The walk is modal and is controlled only by Next, Back, Skip and Escape.
- **Trace:** product decision 2026-07-18 (spec 056 FR-002, FR-003) · LIB-FR-10 · PRJ-FR-17, PRJ-FR-22 · D-W7, D-W11, D-W24, D-W89 · HARNESS-V5-IA.md §Source list · G4

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

### S6 — Read the Home dashboard {#S6}

- **Do:** With the walk closed (S2 or S3), read Home's sections and the source list.
- **Expect:** Home shows Pending ingestions, Pending work and Open work on the left, and Status, Tonight and the calendar on the right at 1280 px or wider. Below that width the same sections appear in one column in that order. Each section shows at most 5 rows before **All N ›**. Home has no tabs or header buttons.
- **Expect (negative):** Home shows no setup checklist, summary line above its sections or alerts list. The source list remains navigation only.
- **Trace:** PRJ-FR-17, PRJ-FR-19, PRJ-FR-22 · D-W89

### S7 — Read Home's pending and open work {#S7}

- **Do:** Read Pending ingestions, Pending work and Open work on Home.
- **Expect:** With no indexed data or Project, Pending ingestions offers **Add a Captures location**; Pending work offers **Import captures**; Open work reads **No Projects in progress.** and offers **New Project…**. Each section opens the page that owns its rows.
- **Expect (negative):** Home has no first-run checklist or Project summary line above its sections.
- **Trace:** PRJ-FR-17, PRJ-FR-19, PRJ-FR-22 · D-W89

### S7a — Turn on Windows Developer Mode from the checklist {#S7a}

- **Do:** On the `desktop-ui` lane, read Home's Status section. On the `desktop-ui-macos` lane, skip this platform-specific check.
- **Expect:** With no operation running, Status reads **Nothing running.** Windows Developer Mode is checked during setup, in Settings and when Apply is reviewed.
- **Expect (negative):** Home shows no Developer Mode checklist item or progress count.
- **Trace:** PRJ-FR-17, PRJ-FR-22 · PREP-FR-15 · D-W89, D-W81

### S9 — A real Import auto-ticks the first-import item {#S9}

- **Do:** From the Import navigation entry, choose **Choose folder…**, pick `Untyped/`, read the preview, then close the sheet without importing. Open Import again and choose `Card-1` as the source. Its destination is `Empty/Captures`, the only Captures location. In the preview, confirm NGC 7000 as the incoming session's Target, choosing it there if it is not prefilled. Choose **Copy** and click **Import 30 frames**. When the import finishes, open Home.
- **Expect:** For `Untyped/`, the preview holds both frames, the start button is unavailable, and the sheet reads `Only held files`. No session is created.
- **Expect:** The Card-1 import's summary reads `30 frames · <size> · 1 session`. One Ready session with confirmed Target NGC 7000 appears in Sessions.
- **Expect (negative):** Neither the held-only `Untyped/` source nor closing the sheet ticks anything. No Inbox and no later filing step appears. No demo or sample session was created to produce the tick: the only frames are the user's own 30 imported ones.
- **Trace:** STO-IMP-FR-02, STO-IMP-FR-06 · LIB-FR-16, LIB-FR-20 · D-W11, D-W24 · PRJ-FR-17, PRJ-FR-22

### S9a — A real Project create auto-ticks its item {#S9a}

- **Do:** In Home's Open work empty state, choose **New Project…** and create a Project named `First light` with subject NGC 7000 and rig `RedCat`. Open Home.
- **Expect:** Once `First light` is saved, it appears in Home's Open work with its next step. Its Project page shows Sessions, Calibrate, View, Output and Wrap up.
- **Expect (negative):** No demo, sample or placeholder Project was created to produce the tick. `First light` is the only Project, with the subject and rig the user entered.
- **Trace:** PRJ-FR-01, PRJ-FR-07, PRJ-FR-17, PRJ-FR-22 · LIB-FR-05 · D-W94, D-W96, D-W98

### S9b — Apply the first Project View {#S9b}

- **Do:** On the `First light` Project page, add the Card-1 session from Suggestions, inspect its group and calibration in Sessions and Calibrate, then open View and choose **Apply…**. Review the sheet and proceed. Open the Project's Output section.
- **Expect:** The session is added only after the user selects it. Apply builds `View/` from the original session, swaps it in and reports the Project's first applied View. Output lists Results in `Output/`; it is empty until the user saves or copies a Result there.
- **Expect (negative):** No file changes before Apply, no original is changed or moved, and no tool writes into `Output/`.
- **Trace:** PRJ-FR-07, PRJ-FR-08 · VSEL-FR-03, VSEL-FR-12, VSEL-FR-14, VSEL-FR-16 · PREP-FR-06, PREP-FR-07 · RES-FR-01 · D-W94, D-W98, D-W100

### S9c — The checklist leaves Home once every item is done {#S9c}

- **Do:** After S9b, open Home. Then quit and relaunch the app, and open Home again.
- **Expect:** Home still shows the same six sections in the same order. `First light` remains in Open work with its View applied.
- **Expect (negative):** The orientation walk does not open again (S4). Home shows no Getting started checklist.
- **Trace:** PRJ-FR-17, PRJ-FR-32 · D-W89, D-W94, D-W100

### S17 — Restore from Settings re-seeds from real state {#S17}

- **Do:** Open Settings and then Home after the restart in S9c.
- **Expect:** The Project remains in Open work with its View applied. Home's Status, Tonight and calendar sections remain present, and no setup checklist is restored.
- **Expect (negative):** Returning to Settings or Home creates no demo or sample data and does not replay the walk.
- **Trace:** PRJ-FR-17, PRJ-FR-32 · D-W89, D-W94

### S18 — The checklist never blocks ordinary workflow {#S18}

- **Do:** From `First light`'s Project menu, choose **Duplicate…** and name the copy `Second light`.
- **Expect:** `Second light` is an independent open Project with the same chosen sessions, groups and settings as `First light`; it has no files and no link to the original. Home lists both Projects in Open work.
- **Expect (negative):** Duplicating the Project copies no files and creates no link or "Duplicated from" note.

## Success criteria

- SC1: Across one fresh install, the orientation walk opens on its own exactly once (S1) and 0 more times across at least one later restart (S4). This is checkable through a persisted one-time-orientation flag and by observing no walk overlay on relaunch.
- SC2: Both terminal walk outcomes, Finish (S2) and Skip or Escape (S3), satisfy SC1 on their own. The walk does not distinguish "skipped" from "finished" for re-run purposes.
- SC3: Home shows the six sections in PRJ-FR-17's fixed order and no checklist, tabs, header buttons or summary line (S6, S7, S7a, S9c, S17).
- SC4: The held-only `Untyped/` source creates 0 sessions; Card-1 creates exactly one Ready session; creating `First light` creates one Project; its first successful Apply builds one View from its selected original sessions (S9, S9a, S9b).
- SC5: Zero demo, sample or seeded-for-display records exist among sessions, Projects, Targets or Results at any point during or after this journey. Every record traces to a real user action taken during the journey.
- SC6: Once all 4 items are done, Home shows 0 checklists across at least one full relaunch (S9c), until the Settings restore (S17) is used.
- SC8: A done item never goes back to not done on its own (S9 to S9c). The restore re-seeds all 4 items as done from real catalog state (S17).
- SC9: Home has no tabs or header buttons, and duplicate creates one independent Project without copying files or blocking ordinary Home navigation (S6, S18).

## Known gaps

- G1: Not validated. The rebuilt application does not exist, and the v2 behavior was checked only against the legacy implementation of spec 056. Nothing in this version has been validated.
- G2: (dissolved 2026-10-12): the one-time orientation walk and its unresolved details remain in S1 to S5 and G4; Home's current layout and omission of a setup checklist are specified by PRJ-FR-17 (S6, S7).
- G4: Unresolved product question: Round 6 decides only that there is "an orientation walk after setup". No source answers four things. (1) Which pages the stops show, and in what order. (2) Which page setup hands over to. (3) Whether **Index later** and **Set up later** also launch the walk. (4) Where in Settings the replay control lives. S1, S2 and S5 assert only what holds under every answer. Blocks readiness.
- G5: Unresolved product question: Round 6 does not specify whether importing an existing library folder by indexing in place counts as the first import. S9 covers only a copied Card-1 import. Blocks readiness.
- G6: (dissolved 2026-10-15): Home has no setup checklist under PRJ-FR-17; S6, S7 and S7a now assert the current dashboard sections and their empty states.

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

- **Δ3** 2026-10-06 · S1, S2, S5, S7, S9, S9a, S9b, S17, S18 · behavior-change
  The orientation walk was updated to end at Home. Import became the first-import milestone, Project creation became the next milestone, and a Project View replaced the former tool-workflow milestone. The Home checklist description in this historical entry is superseded by PRJ-FR-17.
  Evidence: 063 FR-020, 064 LIB-FR-10, LIB-FR-16 and 071 STO-IMP-FR-01 at e4476231; superseded by D-W89, D-W94 and PRJ-FR-17 · by: agent (intent-gated, user instruction)

- **Δ4** 2026-10-12 · S1, S2, S5, S6, S7, S9, S9a, S9b, +S9c, S17, S18 · behavior-change
  This historical entry described a Getting started checklist on Home. The current Home dashboard has six sections, no header buttons and no setup checklist (PRJ-FR-17). Import confirms its Target in the preview, and a held-only source cannot start. The Project's first View is built with Apply; the page stops in the walk remain open (G4).
  Evidence: HARNESS-V5-FEEDBACK-R1.md §Round 6 (user, 2026-10-10) "Onboarding: walk plus checklist", "P-IMP2: confirm Targets in the Import preview" (apps/prototype/design/ on ui-harness-v5 @ 4f470775); superseded by D-W89, D-W94, D-W98 and D-W100 · by: JourneysV5.R6H (intent-gated)
- **Δ5** 2026-10-12 · S1, S7a · behavior-change
  This historical entry described a Developer Mode item in Home's checklist. Developer Mode is now verified at setup and Apply; Home has no such checklist item (PREP-FR-15, PRJ-FR-17).
  Evidence: HARNESS-V5-FEEDBACK-R1.md §Round 7 (user, 2026-10-12) P-PREP3 "Windows prerequisite" (apps/prototype/design/ on ui-harness-v5 @ 12638a7c); superseded by D-W81, D-W89 and PREP-FR-15 · by: JourneysV5.R7Prep3 (intent-gated)
- **Δ6** 2026-10-15 · S1, S2, S6, S7, S7a, S9, S9a, S9b, S9c, S17, S18 · behavior-change
  The Project is the processing unit: the first Project View is built with Apply, and Results live in Output/. Home now has six sections, no header buttons and no setup checklist; the onboarding journey follows that dashboard.
  Evidence: D-W93 to D-W106, PRJ-FR-07, PRJ-FR-17, PRJ-FR-22, VSEL-FR-16, PREP-FR-06, RES-FR-01 · by: SpecF4Writer2 (intent-gated)
