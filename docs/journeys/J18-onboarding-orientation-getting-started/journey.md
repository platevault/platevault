---
id: J18
title: Get oriented after setup and make a first import, Project and View
version: 7
status: draft
last_reviewed: 2026-07-19
actors: [astrophotographer]
surfaces: [onboarding, shell, home, import, sessions, targets, projects, view, output, settings]
interfaces: [desktop-ui, desktop-ui-macos]
trace:
  - specs/056-onboarding-redesign (legacy design of the walk and checklist; PR #1048)
  - specs/056-onboarding-redesign/PENDING_REVIEW_QUESTIONS.md (PQ-004, user directive 2026-07-18: auto-hide when complete, resurface through Settings)
  - specs/063-clean-rebuild-contract/spec.md (FR-020, FR-023)
  - specs/064-library-inventory/spec.md (LIB-FR-05, LIB-FR-10, LIB-FR-16, LIB-FR-21, LIB-FR-27, LIB-AC-09, LIB-AC-35)
  - specs/065-project-goals/spec.md (PRJ-FR-01, PRJ-FR-07, PRJ-FR-17, PRJ-FR-22, PRJ-FR-30)
  - specs/066-view-selection/spec.md (VSEL-FR-01, VSEL-FR-12, VSEL-FR-14, VSEL-FR-16)
  - specs/071-storage-custody/spec.md (STO-IMP-FR-01, STO-IMP-FR-02, STO-IMP-FR-06)
  - workflow decisions D-W7, D-W11, D-W24, D-W89, D-W93 to D-W106, D-W117
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
- **Expect:** Setup closes and hands over to Home, and the orientation walk opens at its first stop without any further click. On the `desktop-ui` lane, the Locations step shows a Windows Developer Mode row reading Off, with **Open Windows settings** and **Check again**, and **Continue** stays available; on the `desktop-ui-macos` lane it shows no such row.
- **Expect (negative):** Neither setup nor the walk creates a demo, sample or placeholder session, Project or Target record anywhere. The walk is only an overlay on an empty, real library. Developer Mode being off blocks no setup step.
- **Trace:** LIB-FR-01, LIB-FR-03, LIB-FR-10, LIB-FR-27 · LIB-AC-35 · PRJ-FR-17, PREP-FR-15 · D-W89, D-W117 · product decision 2026-07-18 (spec 056 FR-001) · prototype src/features/t1/setup/setup-pages.tsx · HARNESS-V5-FEEDBACK-R1.md §Round 7 P-PREP3 ("Windows prerequisite": checked in setup)

### S2 — Complete the walk end to end {#S2}

- **Do:** Use Next to advance through every stop, then finish the walk at the last stop.
- **Expect:** The walk has one stop per main navigation entry, in navigation order, except that Home's stop comes last. The stops are Projects, Targets, Sessions and Calibration from the source list, Import from the toolbar, then Activity and Settings, and Home last (provisional list, G7). Every stop brings its page into view, and Back returns to the prior stop and its page. The last stop points at Home's dashboard (S6) with Home in view. Finishing the last stop closes the walk.
- **Expect (negative):** No stop mentions an Inbox, "File into library" or a sidebar Getting started trigger, and no stop points at a page that the v5 source list or toolbar does not offer. Provisional (G7): the walk is modal, so clicking outside its tooltip neither dismisses it nor acts on the underlying page, and only Next, Back, Skip and Escape control it.
- **Trace:** product decision 2026-07-18 (spec 056 FR-002, FR-003) · LIB-FR-10, LIB-FR-27 · LIB-AC-35 · PRJ-FR-17, PRJ-FR-22 · D-W7, D-W11, D-W24, D-W89, D-W117 · HARNESS-V5-IA.md §Source list

### S3 — Skip the walk instead of finishing it {#S3}

- **Do:** From a fresh, not-yet-oriented install, click **Set up locations**, then **Set up later** on the Locations step, and click Skip on any stop of the walk. On a second fresh install, add `Empty/Captures`, click **Continue**, then **Index later**, and press Escape on any stop of the walk.
- **Expect:** Each exit closes setup and hands over to Home, and the walk opens at its first stop without any further click. Skip and Escape each close the walk immediately from whichever stop it was on.
- **Expect:** Skipping is recorded as equivalent to finishing for "never auto-runs twice" (S4). Skip and finish are the two terminal outcomes of the same one-time walk.
- **Trace:** LIB-FR-01, LIB-FR-27 · LIB-AC-01, LIB-AC-35 · D-W117

### S4 — The walk never auto-runs a second time {#S4}

- **Do:** After completing S2 or S3, fully restart the app (quit and relaunch) at least once.
- **Expect (negative):** The walk does not open automatically on any later launch, whether it was finished or skipped.

### S5 — Replay the walk from Settings {#S5}

- **Do:** Open Settings › Help and use its control that replays the orientation walk.
- **Expect:** The walk reopens at its first stop, whether it was previously finished or skipped.
- **Expect (negative):** Replaying the walk creates, changes or removes no location, session, Project or Target, and Home's sections read as they did before the replay.
- **Trace:** product decision 2026-07-18 (spec 056 FR-005) · LIB-FR-21, LIB-FR-27 · LIB-AC-35 · D-W86, D-W117

### S6 — Read the Home dashboard {#S6}

- **Do:** With the walk closed (S2 or S3), read Home's sections and the source list.
- **Expect:** Home shows Pending ingestions, Pending work and Open work on the left, and Status, Tonight and the calendar on the right at 1280 px or wider. Below that width the same sections appear in one column in that order. Each section shows at most 5 rows before **All N ›**. Home has no tabs or header buttons.
- **Expect (negative):** Home shows no setup checklist, summary line above its sections or alerts list. The source list remains navigation only.
- **Trace:** PRJ-FR-17, PRJ-FR-19, PRJ-FR-22 · D-W89

### S7 — Read Home's pending and open work {#S7}

- **Do:** Read Pending ingestions, Pending work and Open work on Home.
- **Expect:** With `Empty/Captures` registered and indexed (S1) and no session or Project, Pending ingestions reads **Everything is imported.**; Pending work reads **Import captures to start sorting them.** and offers **Import…**; Open work reads **No Projects in progress.** and offers **New Project…**. Each section opens the page that owns its rows.
- **Expect (negative):** Home has no first-run checklist or Project summary line above its sections.
- **Trace:** PRJ-FR-17, PRJ-FR-19, PRJ-FR-22 · D-W89

### S7a — Turn on Windows Developer Mode and check it again {#S7a}

- **Do:** On the `desktop-ui` lane, read Home's Status section. Open Settings › Applications and read the Windows Developer Mode row. Choose **Open Windows settings**, turn Developer Mode on, return to PlateVault and click **Check again**. On the `desktop-ui-macos` lane, read Home's Status section and Settings › Applications only.
- **Expect:** With no operation running, Status reads **Nothing running.** On the `desktop-ui` lane, the Developer Mode row reads Off, with **Open Windows settings** and **Check again**, and after **Check again** it reads On. On the `desktop-ui-macos` lane, Settings › Applications shows no Developer Mode row.
- **Expect (negative):** Home shows no Developer Mode item or progress count. **Open Windows settings** alone does not change the row, and the check creates, links or moves no file.
- **Trace:** PRJ-FR-17, PRJ-FR-22 · PREP-FR-04, PREP-FR-15 · D-W81, D-W89, D-W98

### S9 — Import real captures and finish their review {#S9}

- **Do:** From the Import navigation entry, choose **Choose folder…**, pick `Untyped/`, read the preview, then close the sheet without importing. Open Import again and choose `Card-1` as the source. Its destination is `Empty/Captures`, the only Captures location. In the preview, confirm NGC 7000 as the incoming session's Target, choosing it there if it is not prefilled. For the session's darks, flats and bias, which read not found, choose **No darks**, **No flats** and **No bias**. Choose **Copy** and click **Import 30 frames**. When the import finishes, open the session's intake Review step, choose **Mark rest usable**, confirming it if PlateVault asks, then choose **Finish review**. Open Home.
- **Expect:** For `Untyped/`, the preview holds both frames, the start button is unavailable, and the sheet reads `Only held files`. No session is created.
- **Expect:** The Card-1 preview shows the session's darks, flats and bias as not found, then as No darks, No flats and No bias after the choices. The import's summary reads `30 frames · <size> · 1 session`, and the session lands with its 30 frames Unreviewed. After **Mark rest usable** all 30 frames read Usable, and **Finish review** makes the session Ready. Sessions then lists one Ready session with confirmed Target NGC 7000 and settled calibration, and it is in neither the Needs review nor the Needs calibration filter.
- **Expect (negative):** Neither the held-only `Untyped/` source nor closing the sheet creates a session or changes Home. No Inbox and no later filing step appears. The session is not Ready before **Finish review**. No demo or sample session is created: the only frames are the user's own 30 imported ones.
- **Trace:** STO-IMP-FR-02, STO-IMP-FR-06, STO-IMP-AC-11 · LIB-FR-16, LIB-FR-20, LIB-FR-23, LIB-FR-24 · CAL-FR-05 · PIX-FR-18 · D-W11, D-W24, D-W78, D-W105 · PRJ-FR-17, PRJ-FR-22

### S9a — Create a real Project {#S9a}

- **Do:** In Home's Open work empty state, choose **New Project…** and create a Project named `First light` with subject NGC 7000 and rig `RedCat`. Open Home.
- **Expect:** Once `First light` is saved, it appears in Home's Open work with its next step. Its Project page shows Sessions, Calibrate, View, Output and Wrap up.
- **Expect (negative):** No demo, sample or placeholder Project is created. `First light` is the only Project, with the subject and rig the user entered.
- **Trace:** PRJ-FR-01, PRJ-FR-07, PRJ-FR-17, PRJ-FR-22 · LIB-FR-05 · D-W94, D-W96, D-W98

### S9b — Apply the first Project View {#S9b}

- **Do:** On the `First light` Project page, add the Card-1 session from Suggestions, inspect its group and calibration in Sessions and Calibrate, then open View and choose **Apply…**. Review the sheet and proceed. Open the Project's Output section.
- **Expect:** The Card-1 session is suggested because it is Ready with settled calibration, and it is added only after the user selects it. On the `desktop-ui` lane the Developer Mode check reads On (S7a), so the Symlinks Apply is not refused; on the `desktop-ui-macos` lane no Developer Mode check runs. On both lanes Apply builds `View/` from the original session, swaps it in and reports the Project's first applied View. Output lists Results in `Output/`; it is empty until the user saves or copies a Result there.
- **Expect (negative):** No file changes before Apply, no original is changed or moved, and no tool writes into `Output/`.
- **Trace:** PRJ-FR-07, PRJ-FR-08 · VSEL-FR-03, VSEL-FR-12, VSEL-FR-14, VSEL-FR-16 · PREP-FR-06, PREP-FR-07, PREP-FR-15 · RES-FR-01 · D-W81, D-W94, D-W96, D-W98, D-W100, D-W105

### S9c — Home keeps its sections across a relaunch {#S9c}

- **Do:** After S9b, open Home. Then quit and relaunch the app, and open Home again.
- **Expect:** Home still shows the same six sections in the same order. `First light` remains in Open work with its View applied.
- **Expect (negative):** The orientation walk does not open again (S4). Home shows no Getting started checklist.
- **Trace:** PRJ-FR-17, PRJ-FR-32 · D-W89, D-W94, D-W100

### S17 — Settings offers no checklist to restore {#S17}

- **Do:** Open Settings and then Home after the restart in S9c.
- **Expect:** The Project remains in Open work with its View applied. Home's Status, Tonight and calendar sections remain present, and no setup checklist is restored.
- **Expect (negative):** Returning to Settings or Home creates no demo or sample data and does not replay the walk.
- **Trace:** PRJ-FR-17, PRJ-FR-32 · D-W89, D-W94

### S18 — Open the first Project from Home's Open work {#S18}

- **Do:** On Home, choose the `First light` row in Open work.
- **Expect:** The row opens the `First light` Project page. Its Sessions step holds the Card-1 session, and its View step reads applied.
- **Expect (negative):** Opening the Project from Home adds, removes or changes no session, Project or file, and no step is gated on a checklist.
- **Trace:** PRJ-FR-17, PRJ-FR-32 · D-W89, D-W94

## Success criteria

- SC1: Across one fresh install, the orientation walk opens on its own exactly once (S1) and 0 more times across at least one later restart (S4). This is checkable through a persisted one-time-orientation flag and by observing no walk overlay on relaunch.
- SC2: Both terminal walk outcomes, Finish (S2) and Skip or Escape (S3), satisfy SC1 on their own. The walk does not distinguish "skipped" from "finished" for re-run purposes.
- SC3: Home shows the six sections in PRJ-FR-17's fixed order and no checklist, tabs, header buttons or summary line (S6, S7, S7a, S9c, S17).
- SC4: The held-only `Untyped/` source creates 0 sessions; Card-1 creates exactly one session, which is Ready with No darks, No flats and No bias only after **Finish review**; creating `First light` creates one Project; its first successful Apply builds one View from its selected original sessions, on the `desktop-ui` lane after Developer Mode reads On (S7a, S9, S9a, S9b).
- SC5: Zero demo, sample or seeded-for-display records exist among sessions, Projects, Targets or Results at any point during or after this journey. Every record traces to a real user action taken during the journey.
- SC9: Home has no tabs or header buttons, and its Open work row opens the `First light` Project page (S6, S18).
- SC10: Each of the three ways out of setup, finishing it (S1), Set up later and Index later (S3), hands over to Home and opens the walk exactly once, and the walk's last stop is Home (S2).

## Known gaps

- G1: Not validated. The rebuilt application does not exist, and the v2 behavior was checked only against the legacy implementation of spec 056. Nothing in this version has been validated.
- G2: (dissolved 2026-10-12): answered by Round 6 "Onboarding: walk plus checklist", which is now the owning decision; the contract text follows in D-W28 order. S1 to S5 now assert a one-time walk after setup that ends on Home's checklist. S6, S7, S9 to S9c and S17 assert a Getting started checklist on Home with exactly the four items setup, first import, first Project and first run, shown until all four are done. The page groups and gates of the spec 056 design are gone. G4 to G6 hold what Round 6 leaves open.
- G3: (dissolved 2026-10-15): S9b no longer prepares a run or launches Siril. It applies the Project's first View (D-W94, D-W100), so this journey needs no tool profile and no failing executable; J24/S10 covers the launch refusal.
- G4: (dissolved 2026-10-16): answered by the owner's D-W117 (LIB-FR-27). Every way out of setup hands over to Home and launches the walk once (S1, S3). The walk has one stop per main navigation entry in navigation order with Home's stop last (S2), and Settings › Help replays it (S5).
- G5: (dissolved 2026-10-15): D-W89 leaves the setup checklist off Home, so no setup, import, Project or run outcome ticks an item. S9 to S9b assert the import, Project and Apply outcomes themselves.
- G6: (dissolved 2026-10-15): Home has no setup checklist under PRJ-FR-17 and D-W89; S6, S7 and S7a now assert the current dashboard sections and their empty states.
- G7: Rests on provisional items, pending the owner's confirmation in PR #1804: D-W96's matching rule, which makes the Ready Card-1 session a suggestion of `First light` (S9b), and D-W100's rule that the first Apply builds the View with no separate Start processing (S9b). D-W117's walk details are provisional too. The walk is modal and driven by Next, Back, Skip and Escape (S2, S3). Its stops are Projects, Targets, Sessions, Calibration, Import, Activity, Settings and Home (S2). If the owner changes one, the steps that cite it change.
- G8: Unresolved product question, open with the owner (D-W118): whether **Mark rest usable** asks for confirmation. S9 confirms it only if PlateVault asks and asserts the outcome after that, which holds under either answer. Blocks readiness.

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
- **Δ5** 2026-10-12 · S1, +S7a · behavior-change
  On Windows, setup's Locations step shows a Windows Developer Mode row (Off/On, Open Windows settings, Check again) that blocks nothing, and while it is off Home's checklist holds a fifth item, "Turn on Windows Developer Mode", which ticks once a check finds it on.
  Evidence: HARNESS-V5-FEEDBACK-R1.md §Round 7 (user, 2026-10-12) P-PREP3 "Windows prerequisite" (apps/prototype/design/ on ui-harness-v5 @ 12638a7c); setup row and checklist item as the U9 prototype slice builds them (R7U9Views, 2026-10-12) · by: JourneysV5.R7Prep3 (intent-gated)
- **Δ6** 2026-10-15 · S1, S2, S5, S6, S7, S7a, S9, S9a, S9b, S9c, S17, S18 · behavior-change
  The Project is the processing unit: the first Project View is built with Apply, and Results live in Output/. Home now has six sections, no header buttons and no setup checklist, so nothing ticks: SC6 and SC8 are retired, G3 and G5 are dissolved, and S18 opens the first Project from Open work instead of testing the checklist. S9 finishes the Card-1 session's review and sets No darks, No flats and No bias in the import review, so it is Ready with settled calibration before S9b adds it. On Windows, S7a turns Developer Mode on, so S9b's Symlinks Apply isn't refused.
  Evidence: D-W78, D-W81, D-W89, D-W93 to D-W106, PRJ-FR-07, PRJ-FR-17, PRJ-FR-22, LIB-FR-23, LIB-FR-24, VSEL-FR-16, PREP-FR-06, PREP-FR-15, RES-FR-01 · by: SpecF4Writer2 (intent-gated)
- **Δ7** 2026-10-16 · S1, S2, S3, S5, +SC10 · behavior-change
  Setup hands over to Home, and every way out of setup, Set up later and Index later included, launches the walk once (S3 now takes those two exits). The walk has one stop per main navigation entry, with Home's stop last, and Settings › Help replays it. G4 is dissolved.
  Evidence: D-W117 (owner's second batch of 2026-10-16) in PR #1804, LIB-FR-21, LIB-FR-27, LIB-AC-35 · by: EncodeOwnerAnswers2 (intent-gated)
