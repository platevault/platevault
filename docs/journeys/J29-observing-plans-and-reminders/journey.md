---
id: J29
title: Plan nights on the Targets page's Planned view, opt into default-site reminders, see Tonight on Home, and export every planned night to a calendar
version: 6
status: draft
last_reviewed: 2026-10-03
actors: [primary-user]
surfaces: [planning, targets, projects, home, settings, observing-sites]
interfaces: [desktop-ui, desktop-ui-macos]
trace: [063-clean-rebuild-contract, 065-project-goals, 072-observing-plans, D07, D17, D18, D-W16, D-W36, D-W95, D-W89, D-W60, D-W63, D-W96, specs/063-clean-rebuild-contract/decisions.md, specs/065-project-goals/spec.md, specs/072-observing-plans/spec.md, docs/reviews/2026-10-03-product-flow-and-journeys.md#journey-k-observing-plans-and-reminders, HARNESS-V5-IA.md#S10, HARNESS-V5-IA.md#S11, HARNESS-V5-IA.md#S1, HARNESS-V5-IA.md#S3, HARNESS-V5-IA.md#S16, HARNESS-V5-FEEDBACK-R1.md#round-5, P-PLAN2, "HARNESS-V5-FEEDBACK-R1.md#domain-and-seed-foundation Sites, Planning", HARNESS-V5-FEEDBACK-R1.md#round-6, apps/prototype/src/features/v5/e-targets-plan-settings/plan.tsx @b5e813a5, apps/prototype/src/features/v5/a-home/home.tsx @b5e813a5, apps/prototype/src/features/t1/settings/sites-page.tsx @b5e813a5, apps/prototype/src/domain/planning.ts @b5e813a5, apps/prototype/messages/en-GB.json @4f470775]
---

## Goal

The user plans nights on the Targets page, where each night has its own plan.
They add NGC 7000 to tonight's plan, read its windows on the Planned view for
the night the header date picker sets, find tomorrow's plan empty and add
NGC 7000 to it as well, compare planning sites, and grade each filter against
the Moon. From the Planned view header they deliberately enable reminders for
the default site and export every upcoming planned window to a calendar file.
They also plan M 31, which belongs to no Project, plan from the `NGC 7000 HOO`
Project page through its **Planner** button, and read tonight's best windows on
Home. Done means windows name their site and time-zone basis, and the date
picker names the night they belong to. Adding a Target to one night's plan
leaves every other night's plan unchanged. Reminders need opt-in, a default
site, criteria and lead time, and each names Backyard and a planned window. A
delivered reminder is not delivered again after a restart. The saved `.ics`
contains exactly the upcoming windows of every planned night. When S7 enables
reminders, tonight's plan and the following night's plan from S3a both exist,
and S9 exports both. The saved file remains unchanged afterwards. Home's
Tonight lists NGC 7000 and M 31 at the picked planning site. When reminders
are on, moving the default site asks first. Planning changes no library,
Project or session data and starts no indexing.

## Preconditions

- P1: J15 and J20 completed (J21 to J28 are not required). Settings holds Backyard at 52.09° N, 5.12° E, minimum altitude 25° and astronomical darkness, plus `Remote site`; no site is designated default. Project `NGC 7000 HOO` is open as J20 left it: subject NGC 7000, rigs `RedCat` and `Esprit`, goals Ha 10h and OIII 12h, and seven matching sessions, none added to the Project. It is the only Project. No Target is marked ★, so M 31 is not in My targets, and no night has a plan. Backyard's coordinates, minimum altitude and darkness follow J15/P3 and prototype `domain/seed.ts` line 805 at a2ec1297.
- P2: The OS has not yet been asked for notification permission for PlateVault, so the first request can be denied.
- P3: No calendar provider account is configured.
- P4: A development-build clock control (D17) sets PlateVault's clock to a night before 2026-10-25. It holds the clock inside the first upcoming Backyard window's reminder lead time while the app runs and across a relaunch. NGC 7000 and M 31 have windows at Backyard and `Remote site` tonight, and NGC 7000 has a window at both sites on the following night (G3). The date picker reads this controlled tonight. The fixed 2026-10-25 fixture night and its windows therefore remain in the future.

## Steps

### S1 — Add NGC 7000 to tonight's plan and open the Planned view {#S1}

- **Do:** On the Targets page, with the date picker on tonight, choose **Add to plan** on the NGC 7000 row. Switch to the Planned view and choose Backyard in the site picker. Then open NGC 7000's Target detail and go back.
- **Expect:** The site picker lists Backyard and `Remote site`. After Backyard is chosen, the Planned view lists NGC 7000 with its best window, Img time, Moon separation and altitude sparkline, and the page shows Backyard, its IANA time zone, tonight's darkness window and the Moon. Calculated windows show their site and time-zone basis. NGC 7000's row menu offers **Remove from plan** instead of **Add to plan**. The Target detail lists Project `NGC 7000 HOO` with its goal lines: Ha reads 0h 00m "in project" and 12h 35m "captured" against the 10h goal, and OIII reads 0h 00m "in project" and 10h 35m "captured" against the 12h goal. "captured" counts all seven suggested sessions on both rigs. The Planned view header offers **Enable notifications** and **Export calendar**, and notifications read off.
- **Expect (negative):** No window claims clear weather, telescope availability, or processing readiness. The goal lines never show "in project" above "captured". Adding NGC 7000 to the plan changes no ★, Project or session record.
- **Trace:** flow K · PLAN-FR-02, PLAN-FR-05, PLAN-TGT-FR-14 · PRJ-FR-04, PRJ-FR-21 · root FR-023 · D07, D-W16, D-W36, D-W66 · HARNESS-V5-IA.md S10 (Target detail), S11 · Round 5 P-PLAN2 · Round 6 "Reminders and calendar export stay" (both in the Planned view header)

### S2 — Grade filters with the per-filter Moon curve {#S2}

- **Do:** Set the header date picker to **2026-10-25** and choose Backyard in the site picker. In All, choose **Add to plan** for NGC 7000 on that night. Open **Moon limits**, choose OIII, set **Separation at full Moon** to 60° and **Width** to 7 days, and save, so the baseline does not depend on the build's default OIII curve. Return to the plan view, expand its Per filter sub-rows, and read each band's grade, windows and Img time. Record those baseline values. Open **Moon limits**, choose OIII, raise **Separation at full Moon** from 60° to 90°, and leave **Width** at 7 days. Save and read the recalculated OIII row. Compare the other four rows with their recorded values. In All, choose **Remove from plan** for NGC 7000 on 2026-10-25. Open the Planned view again for that night. Check that it reads `Plan list empty` and the All row offers **Add to plan**. Then set the date picker back to tonight and return to the Planned view.
- **Expect:** At 2026-10-25, Backyard uses the P1 coordinates, 25° minimum altitude and astronomical darkness. At ui-harness-v5 commit a2ec1297, the seeded NGC 7000 position (RA 314.75°, Dec 44.53°) has a Moon-up reading at 100% illumination, 64.74° separation and age 14.306 days. The 60°/7-day and 90°/7-day OIII curves ask for 59.74° and 89.61° separation at that age. As a reference calculation from that prototype, before the edit OIII is Good with a 440-minute window from 2026-10-25 18:20 UTC through 2026-10-26 01:40 UTC. After the edit OIII is Poor with no window and 0 Img time. Forty-four Moon-up samples fall within the 440-minute dark, above-altitude stretch between the curves. The functions are `skyNight` (planning.ts:489 to 509), `nightImaging` (605 to 646), and `requiredMoonSeparationDeg` (455 to 457); target coordinates are seed.ts:805 and sky.ts:59. Each band has a Per filter row with its grade and Moon-clear windows. The required separation is greatest at full Moon and shrinks as the Moon dims. A sample counts when the Moon is below the horizon or at least that far away.
- **Expect (negative):** Immediately before and after saving OIII's curve on 2026-10-25, the grade, windows and Img-time values for R, G, B and Ha are identical. The OIII edit changes 0 of the other 4 bands. The dialog offers no separate maximum-illumination limit. Editing the curve changes no rig filter list or Project goal.
- **Trace:** flow K · PLAN-FR-02 · PLAN-TGT-FR-06 · PLAN-TGT-AC-18 · D-W88 · HARNESS-V5-FEEDBACK-R1.md Round 9 C6 · prototype `domain/planning.ts` (`skyNight`, `nightImaging`, `requiredMoonSeparationDeg`), `domain/seed.ts`, `domain/sky.ts` and `moon-limits.tsx` at a2ec1297 on ui-harness-v5
### S3 — Switch the planning site {#S3}

- **Do:** Choose `Remote site` in the site picker.
- **Expect:** Windows, sparklines and Max alt recalculate and name `Remote site` and its time zone.
- **Expect (negative):** Project subjects, each Project's sessions, and session capture sites are unchanged.
- **Trace:** flow K, B3 · PLAN-FR-01 · PLAN-AC-01 · root FR-014 · D-W16 · HARNESS-V5-IA.md S11 (a site picker when there are several)

### S3a — Plan another night with its own plan {#S3a}

- **Do:** Set the header date picker to tomorrow's night and read the Planned view. Switch to the All view, read NGC 7000's row and choose **Add to plan** on it, then return to the Planned view. Then set the date picker back to tonight and read the Planned view.
- **Expect:**
  - The date picker names tomorrow's night. Tomorrow's Planned view reads `Plan list empty`, and NGC 7000's row menu offers **Add to plan**, although tonight's plan holds it.
  - NGC 7000's best window, Img time, sparkline and Per filter grades are those of tomorrow's night at `Remote site`, with window times on that date.
  - After **Add to plan**, tomorrow's Planned view lists exactly NGC 7000, with tomorrow's values.
  - Back on tonight, the Planned view lists exactly NGC 7000, and every value equals its S3 value.
- **Expect (negative):** Changing the night alone writes nothing. Adding NGC 7000 to tomorrow's plan adds nothing to and removes nothing from tonight's plan, changes no ★, Project or session record, and starts no indexing.
- **Trace:** HARNESS-V5-FEEDBACK-R1.md Round 5 P-PLAN2 (a date picker in the page header, default tonight, sets the night that suitability, altitude and windows use), Round 6 "Per-night plans" · messages plan_list_empty, targets_add_to_plan @ 4f470775

### S4 — Try to enable reminders without a default site {#S4}

- **Do:** With NGC 7000 in tonight's plan, click **Enable notifications** in the Planned view header.
- **Expect:** PlateVault directs the user to set a default site in Settings → Observing sites and does not enable notifications.
- **Expect (negative):** No reminder is scheduled.
- **Trace:** flow K · PLAN-FR-03 · PLAN-AC-04 · D07 · Round 6 "Reminders and calendar export stay"

### S5 — Set the default site and reminder values {#S5}

- **Do:** In Settings → Observing sites, choose **Make default** on Backyard. Return to the Targets page's Planned view (planning site still `Remote site`) and set the reminder lead time in its header.
- **Expect:** Backyard carries the one Default pill and the "No default site" notice is gone. In the Planned view header, **Enable notifications** names Backyard as the reminder site, the active criteria, and the lead time, while the Planned view still names `Remote site`.
- **Trace:** flow K · PLAN-FR-01, PLAN-FR-03, PLAN-FR-06 · PLAN-AC-06 · D07 · HARNESS-V5-IA.md S16 (Sites: one Default pill, Make default)

### S6 — Deny notification permission {#S6}

- **Do:** In the Planned view header, click **Enable notifications** and deny the OS permission request.
- **Expect:** The denial stays visible in the Planned view header and offers **Settings** and **Retry**; notifications read not enabled.
- **Expect (negative):** No delivery success is claimed.
- **Trace:** flow K · PLAN-FR-07 · PLAN-AC-08 · D07

### S7 — Enable reminders {#S7}

- **Do:** Grant the permission in the OS settings and click **Retry**.
- **Expect:** By S7, S1 created tonight's plan and S3a added the following night's plan. The Planned view header reads notifications on for Backyard. Reminders cover NGC 7000 windows on both planned nights.
- **Expect (negative):** No reminder is created for `Remote site`, for a night without a plan, or for a Target in no plan. Enabling reminders starts no indexing or processing.
- **Trace:** flow K · PLAN-FR-03 · PLAN-AC-02, PLAN-AC-05 · D07 · Round 6 "Reminders and calendar export stay" (a notification before a planned window), "Per-night plans"

### S7a — Receive one reminder {#S7a}

- **Do:** With the P4 clock control, bring the first upcoming Backyard window to its reminder lead time while PlateVault runs.
- **Expect:** Exactly one OS notification arrives, naming NGC 7000, Backyard and that window. PlateVault records that reminder as delivered for its target/site/window identity.
- **Expect (negative):** The S7 scheduling did not read as delivery before this notification arrived. No notification names `Remote site`.
- **Trace:** flow K · PLAN-FR-06, PLAN-FR-07 · PLAN-AC-07 · D07

### S8 — Restart without duplicate reminders {#S8}

- **Do:** Quit and relaunch PlateVault with the P4 clock still inside the S7a window's lead time, then open the Targets page's Planned view.
- **Expect:** Upcoming windows are recomputed and each Backyard window has at most one reminder. The S7a reminder still reads delivered.
- **Expect (negative):** No second notification arrives for the S7a target/site/window identity; the OS notification list holds exactly one for it.
- **Trace:** flow K · PLAN-FR-06 · PLAN-AC-07 · D07

### S9 — Export every planned night to a calendar file {#S9}

- **Do:** After S3a adds NGC 7000 to the following night's plan, set the date picker to tonight and click **Export calendar** in the Planned view header. Read the confirmation of the planning site, date range, time zone and windows. Confirm that scope and save the `.ics` with the native save dialog.
- **Expect:** After S3a adds NGC 7000 to the following-night plan, the confirmation covers all upcoming planned windows, not only the night in the date picker. It names `Remote site` and its time zone and lists exactly NGC 7000's windows on both planned nights. The saved file contains exactly those windows with the displayed site and time-zone basis.
- **Expect (negative):** The export leaves out no window from tonight's or the following night's plan. It holds no window of an unplanned Target or a night without a plan. The flow requests no provider account, calendar authorization, or hosted subscription.
- **Trace:** flow K calendar · PLAN-FR-04 · PLAN-AC-03 · root FR-015, D18 · Round 6 "Reminders and calendar export stay" (calendar export of every planned night)

### S10 — Change criteria after export {#S10}

- **Do:** In Settings → Observing sites, raise `Remote site`'s Min. altitude by 10°. Return to the Planned view and compare the saved `.ics` with its S9 bytes.
- **Expect:** The window list changes: every listed window now stays above the new minimum altitude. The saved S9 file containing both planned nights' windows remains byte-identical. A new export is needed to reflect the change.
- **Expect (negative):** Raising the minimum altitude changes no field of Backyard.
- **Trace:** flow K calendar · PLAN-FR-04 · PLAN-AC-03 · apps/prototype src/features/t1/settings/sites-page.tsx (Min. altitude, Darkness) and src/domain/planning.ts defaultCriteria @ b5e813a5

### S11 — Plan a Target outside any Project {#S11}

- **Do:** On the Targets page, search `m 31` and click the M 31 result. Choose **Add to plan** on the M 31 row and read the Planned view.
- **Expect:** M 31 is listed in My targets with ★ set. The Planned view lists NGC 7000 and M 31 in order of their best window's start, and M 31's windows name the active planning site and its time zone.
- **Expect (negative):** No step asks for a Project or creates one, and M 31's Target detail lists no Project and no goal line. M 31 joins tonight's plan only: tomorrow's plan still lists exactly NGC 7000.
- **Trace:** flow K · PLAN-FR-09, PLAN-TGT-FR-03 · PLAN-AC-09 · root FR-013 · D-W16, D-W17 · Round 5 P-PLAN2 (Planned: the night's schedule in order), "Click a result to act" · Round 6 "Per-night plans", "Clicking a result" (a catalogue result is added)

### S12 — Plan from the Project page {#S12}

- **Do:** Open the `NGC 7000 HOO` Project page and read its Planning section. Click **Planner**, read the Planned view, then clear the Project scope.
- **Expect:** The Project page's Planning lists NGC 7000 only, with its best window tonight at the active planning site and its goal gaps. **Planner** opens the Targets page scoped to the Project (`?project=`), with the `NGC 7000 HOO` context shown and the rig selector reading "This Project's rigs (2)". Its Planned view lists only NGC 7000, with its 2 unmet goals ("2 short"). Clearing the scope returns the Planned view to the Plan list, which lists NGC 7000 and M 31.
- **Expect (negative):** M 31 appears in no Project planning list, and planning from the Project page writes no Project record.
- **Trace:** flow K · PLAN-FR-09, PLAN-FR-10, PLAN-TGT-FR-01 · PLAN-AC-10 · PRJ-FR-07 · root FR-013 · D-W16, D-W37, D-W60 · HARNESS-V5-IA.md S3 (Planning), S11 (`?project=` scopes the page to that Project's subjects with their unmet goals)

### S13 — Read Tonight on Home {#S13}

- **Do:** With the planning site still on `Remote site`, open Home and read its Tonight box. Then follow its Plan link.
- **Expect:** Tonight names `Remote site` and its time zone, and shows tonight's darkness window and the Moon's phase, illumination, rise and set. Its windows list NGC 7000 and ★ M 31, each with start, end, peak altitude and Moon separation, and each matches the best window that the Planned view lists for that Target at `Remote site` tonight. The Plan link opens the Targets page's Planned view.
- **Expect (negative):** No Tonight value is computed for Backyard while `Remote site` is the picked planning site. Reading Tonight schedules no reminder and starts no indexing.
- **Trace:** Home Tonight · PLAN-FR-08, PLAN-FR-11 · PLAN-AC-11 · PRJ-FR-17 · PV-PLAN-SC-04 · D-W39 · HARNESS-V5-IA.md S1 (Tonight) · HARNESS-V5-FEEDBACK-R1.md Domain and seed (Sites: Plan and Tonight use the default unless one is picked)

### S14 — Confirm before the default site takes the reminders {#S14}

- **Do:** In Settings → Observing sites, choose **Make default** on `Remote site`, read the confirmation, and cancel it.
- **Expect:** The confirmation "Make Remote site the default?" lists "Default: Remote site" and "Reminders: Backyard → Remote site". After cancelling, Backyard still carries the Default pill and the Planned view header's notifications still name Backyard.
- **Expect (negative):** Nothing changes before the confirmation is accepted: no default moves and no reminder moves to `Remote site`.
- **Trace:** PLAN-FR-03 · HARNESS-V5-IA.md S16 (Sites) · apps/prototype src/features/t1/settings/sites-page.tsx, messages/en-GB.json site_make_default_title, settings_default_named, site_reminders_change @ b5e813a5 · Round 6 "Reminders and calendar export stay"

## Success criteria

- SC1: Every window lists its site and time zone, and capture sites are unchanged through S3.
- SC2: 0 reminders exist before S7; after S7 100% of reminders name Backyard and a window on a planned night (tonight or tomorrow), and 0 name `Remote site`.
- SC3: The `.ics` contains exactly the S9 windows, NGC 7000's on tonight's and tomorrow's nights at `Remote site`, spans 2 nights, and is unchanged after S10.
- SC4: 0 indexing operations start from planning, night, reminder or Tonight steps (S3a, S7, S13).
- SC5: A permission denial stays visible with Settings and Retry (S6).
- SC6: Exactly 1 notification is delivered for the S7a target/site/window identity across S7a and S8.
- SC7: M 31 is planned with 0 Projects created or chosen (S11), and the Project page plans exactly 1 subject, NGC 7000 (S12).
- SC8: Tonight lists exactly 2 Targets with a window, NGC 7000 and M 31, at `Remote site`, and each best window equals the Planned view's best `Remote site` window for that Target (S13).
- SC9: On 2026-10-25 at Backyard, changing the OIII curve from 60°/7 days to 90°/7 days changes its grade from the Good, 440-minute prototype reference to Poor, 0 Img time and no window (S2, `domain/planning.ts` at a2ec1297). The OIII edit changes 0 of the other 4 bands. After S2 removes its temporary plan, only tonight's plan remains. S3a later adds the following night's plan. Returning the picker to tonight restores the S3 values (S3a).
- SC11: Tomorrow's plan holds 0 Targets before the S3a add and exactly 1, NGC 7000, after it; tonight's plan holds exactly NGC 7000 throughout S3a, and adding M 31 at S11 leaves tomorrow's plan at exactly 1.
## Known gaps

- G1: Not validated. The rebuilt application does not exist. Product behavior follows the harness v5 design (HARNESS-V5-IA.md S1, S3, S10, S11 and S16; HARNESS-V5-FEEDBACK-R1.md Domain and seed and Round 5 P-PLAN2, at ui-harness-v5 b5e813a5, and Round 6 at 4f470775), the specs and the defaults that the authorized autonomous run set in decisions D07 and D18, and the workflow decisions D-W16, D-W36, D-W37, D-W39, D-W60 and D-W66. No implementation has been validated against them.
- G2: Unresolved implementation qualification: how a scheduled reminder is observed before delivery is unspecified, and so is delivery while the app is closed, which is not claimed without an installed, tested scheduler (D07). S7 and S8 depend on it. Blocks readiness.
- G3: Unresolved implementation qualification: no development clock control yet brings a window to its lead time or holds it there across a relaunch (P4). S7a, S8 and S13 depend on it. Blocks readiness.
- G4: Out of scope for this journey: a mosaic Project is not exercised. Its Plan area shows the goal gap per panel group (PLAN-FR-02), and Tonight grades each panel group's goals from the subject's window (PLAN-FR-11, provisional). Blocks readiness until covered by a step or a journey. J32/S5 and J32/S7 cover Home's **Plan tonight** Next action (PRJ-FR-18), and J19/S6a covers Tonight without a saved site (PLAN-AC-12).
- G5: (dissolved 2026-10-12): answered by Round 6 "Reminders and calendar export stay". S1 and S4 to S7 assert **Enable notifications**, its lead time and state in the Planned view header, with reminders only for planned nights at the default site. By S7, S1 created tonight's plan and S3a added the following night's plan. S9 exports both nights, and S10 checks the saved file.
- G6: (dissolved 2026-10-12): answered by Round 6 "Per-night plans"; S3a now asserts that tomorrow's plan starts empty, **Add to plan** adds NGC 7000 to tomorrow only and tonight keeps its list, and S11 asserts that M 31 joins tonight's plan only.

## Delta log

- **Δ4** 2026-10-12 · S1, S3a, S4, S5, S6, S7, S9, S11, S14 · behavior-change
  Each night has its own plan: tomorrow starts empty and Add to plan adds to the chosen night only. Enable notifications, its lead time and Export calendar sit in the Planned view header.
  Reminders come before planned windows, and the export covers every upcoming planned night, not just the one the date picker shows.
  Evidence: HARNESS-V5-FEEDBACK-R1.md §Round 6 (user, 2026-10-10) "Per-night plans", "Reminders and calendar export stay", "Clicking a result" (apps/prototype/design/ on ui-harness-v5 @ 4f470775); user answers to the PR #1788 journey questions · by: JourneysV5.R6F (intent-gated)
- **Δ3** 2026-10-12 · S1, S2, S3, +S3a, S4, S5, S8, S10, S11, S12, S13, +S14 · behavior-change
  The Plan area and Plan page are gone: Targets are added to the plan from their row and read on the Targets page's Planned view, for the night a header date picker sets (default tonight), with a site picker, sparklines and Per filter grades under editable Moon limits. Altitude and darkness come from the site.
  Home's Tonight follows the picked planning site, and making a site default while reminders are on asks first.
  Evidence: HARNESS-V5-IA.md §Screens S1, S3, S10, S11, S16; HARNESS-V5-FEEDBACK-R1.md §Domain and seed (Sites, Planning), §Round 5 P-PLAN2, "Click a result to act" (apps/prototype/design/ on ui-harness-v5 @ b5e813a5); prototype home.tsx TonightBox, sites-page.tsx, planning.ts defaultCriteria @ b5e813a5; user instruction 2026-10-12 · by: JourneysV5.U6Targets (intent-gated)
- **Δ2** 2026-10-06 · S1, S3, S5, S6, +S11, +S12, +S13 · behavior-change
  The Plan area opens from a Targets row and shows the Project goal gap as "in project" and "captured". A Target outside any Project is planned without a Project. The Project page plans its own subjects and opens the Planner in its context. Home's Tonight lists the best windows at the default site.
  Evidence: D-W16, D-W36, D-W37, D-W39, D-W60 (workflow decisions, settled 2026-10-06); 072 PLAN-FR-02, PLAN-FR-09, PLAN-FR-10, PLAN-FR-11, PLAN-AC-09, PLAN-AC-10, PLAN-AC-11 at e4476231; D-W66, 065 PRJ-FR-04, PRJ-FR-21 at d45a22ad · by: agent (intent-gated, user instruction)
- **Δ5** 2026-10-15 · S1, S3 · behavior-change
  The Project holds sessions directly, with no processing run, and a mosaic is a Project with panel groups whose goals Tonight grades from the subject's window.
  Evidence: D-W93 to D-W106 (F4 Project model, owner's answers of 2026-10-14) in PR #1804, 065 PRJ-FR-29, 072 PLAN-AC-01, PLAN-FR-02, PLAN-FR-11 · by: SpecF4Writer2 (intent-gated)
- **Δ6** 2026-10-17 · S2 · behavior-change
  One Moon-avoidance curve per filter replaces the separate Moon limits. S2's **Moon limits** edit now raises OIII's separation at full Moon, and only OIII's grade, windows and Img time recalculate.
  Evidence: HARNESS-V5-FEEDBACK-R1.md Round 9 C6 · D-W88 · PLAN-FR-02, PLAN-TGT-FR-06, PLAN-TGT-AC-18 · prototype moon-limits.tsx (ui-harness-v5) · by: JourneysR9c (intent-gated)
