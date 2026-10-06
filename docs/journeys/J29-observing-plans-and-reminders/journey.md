---
id: J29
title: Plan observing windows from Targets and Projects, opt into default-site reminders, see Tonight on Home, and export a calendar snapshot
version: 2
status: draft
last_reviewed: 2026-10-03
actors: [primary-user]
surfaces: [planning, targets, projects, home, settings]
interfaces: [desktop-ui, desktop-ui-macos]
trace: [063-clean-rebuild-contract, 065-project-goals, 072-observing-plans, D07, D17, D18, D-W16, D-W36, D-W37, D-W39, D-W60, D-W66, specs/063-clean-rebuild-contract/decisions.md, specs/065-project-goals/spec.md, specs/072-observing-plans/spec.md, docs/reviews/2026-10-03-product-flow-and-journeys.md#journey-k-observing-plans-and-reminders]
---

## Goal

The user checks when NGC 7000 has a suitable observing window, compares planning
sites, deliberately enables reminders for the default site, and saves a one-time
calendar snapshot. They also plan M 31, which belongs to no Project, plan from
the `NGC 7000 HOO` Project page through **Open in Planner**, and read tonight's
best windows on Home. Done means windows name their site and time-zone basis.
Reminders need opt-in, a default site, criteria and lead time, and each names
Backyard. A delivered reminder is not delivered again after a restart. The saved
`.ics` contains exactly the confirmed windows and remains unchanged afterwards.
Home's Tonight lists NGC 7000 and M 31 at Backyard. Planning changes no library,
Project or session data and starts no indexing.

## Preconditions

- P1: J15 and J20 completed (J21 to J28 are not required). Settings holds Backyard and `Remote site`, and no site is designated default. Project `NGC 7000 HOO` is open as J20 left it: subject NGC 7000, rigs `RedCat` and `Esprit`, goals Ha 10h and OIII 12h, seven candidate sessions, and the run `NGC7000-HOO-Siril` at Select with no saved membership. It is the only Project. No Target is marked ★, so M 31 is not in My targets.
- P2: The OS has not yet been asked for notification permission for PlateVault, so the first request can be denied.
- P3: No calendar provider account is configured.
- P4: A development-build clock control (D17) sets PlateVault's clock so that the first upcoming Backyard window reaches its reminder lead time while the app runs. The control keeps the clock inside that lead time across a relaunch, on a night when NGC 7000 and M 31 both have a window at Backyard (G3).

## Steps

### S1 — Open the Plan area {#S1}

- **Do:** On the Targets page, select the NGC 7000 row to open its Plan area, and choose Backyard as planning site.
- **Expect:** Calculated windows show their site and time-zone basis, and the active planning site reads Backyard. Beside the coverage, Project `NGC 7000 HOO` shows its per-channel goal gap with labeled numbers. Ha reads 0h 00m "in project" and 12h 35m "captured" against the 10h goal, and OIII reads 0h 00m "in project" and 10h 35m "captured" against the 12h goal. "captured" counts all seven candidate sessions on both rigs. Notifications read disabled.
- **Expect (negative):** No window claims clear weather, telescope availability, or processing readiness. The gap never says "not in a run" and never shows "in project" above "captured".
- **Trace:** flow K · PLAN-FR-02, PLAN-FR-05, PLAN-TGT-FR-14 · PRJ-FR-04, PRJ-FR-21 · root FR-023 · D07, D-W16, D-W36, D-W66

### S2 — Set criteria {#S2}

- **Do:** Set altitude, darkness, Moon, and minimum-duration criteria.
- **Expect:** The window list recalculates; every listed window meets the stated criteria.
- **Trace:** flow K · PLAN-FR-02

### S3 — Switch the planning site {#S3}

- **Do:** Choose `Remote site` in the planning site selector.
- **Expect:** Windows recalculate and name `Remote site` and its time zone.
- **Expect (negative):** Project subjects, the sessions in each processing run, and session capture sites are unchanged.
- **Trace:** flow K, B3 · PLAN-FR-01 · PLAN-AC-01 · root FR-014 · D-W16

### S4 — Try to enable reminders without a default site {#S4}

- **Do:** Mark NGC 7000 **Planned** and click **Enable notifications**.
- **Expect:** NGC 7000 reads Planned. PlateVault directs the user to set a default site in Settings and does not enable notifications.
- **Expect (negative):** No reminder is scheduled.
- **Trace:** flow K · PLAN-FR-03 · PLAN-AC-04 · D07

### S5 — Set the default site and reminder values {#S5}

- **Do:** In Settings, make Backyard the default site, then return to the Plan area (planning site still `Remote site`) and set the reminder lead time.
- **Expect:** **Enable notifications** names Backyard as the reminder site, the active criteria, and the lead time, while the window list still names `Remote site`.
- **Trace:** flow K · PLAN-FR-01, PLAN-FR-03, PLAN-FR-06 · PLAN-AC-06 · D07

### S6 — Deny notification permission {#S6}

- **Do:** Click **Enable notifications** and deny the OS permission request.
- **Expect:** The denial stays visible and offers **Settings** and **Retry**; notifications read not enabled.
- **Expect (negative):** No delivery success is claimed.
- **Trace:** flow K · PLAN-FR-07 · PLAN-AC-08 · D07

### S7 — Enable reminders {#S7}

- **Do:** Grant the permission in the OS settings and click **Retry**.
- **Expect:** Notifications read enabled for Backyard. Every reminder names Backyard and its window.
- **Expect (negative):** No reminder is created for `Remote site`. Enabling reminders starts no indexing or processing.
- **Trace:** flow K · PLAN-FR-03 · PLAN-AC-02, PLAN-AC-05 · D07

### S7a — Receive one reminder {#S7a}

- **Do:** With the P4 clock control, bring the first upcoming Backyard window to its reminder lead time while PlateVault runs.
- **Expect:** Exactly one OS notification arrives, naming NGC 7000, Backyard and that window. PlateVault records that reminder as delivered for its target/site/window identity.
- **Expect (negative):** The S7 scheduling did not read as delivery before this notification arrived. No notification names `Remote site`.
- **Trace:** flow K · PLAN-FR-06, PLAN-FR-07 · PLAN-AC-07 · D07

### S8 — Restart without duplicate reminders {#S8}

- **Do:** Quit and relaunch PlateVault with the P4 clock still inside the S7a window's lead time, then open the Plan area.
- **Expect:** Upcoming windows are recomputed and each Backyard window has at most one reminder. The S7a reminder still reads delivered.
- **Expect (negative):** No second notification arrives for the S7a target/site/window identity; the OS notification list holds exactly one for it.
- **Trace:** flow K · PLAN-FR-06 · PLAN-AC-07 · D07

### S9 — Export a calendar snapshot {#S9}

- **Do:** Click **Export calendar**, confirm the displayed planning site, date range, time zone, and selected windows, and save the `.ics` with the native save dialog.
- **Expect:** The saved file contains exactly the selected windows with the displayed site and time-zone basis.
- **Expect (negative):** No provider account, calendar authorization, or hosted subscription is requested.
- **Trace:** flow K calendar · PLAN-FR-04 · PLAN-AC-03 · root FR-015, D18

### S10 — Change criteria after export {#S10}

- **Do:** Raise the minimum-duration criterion and compare the saved `.ics` with its S9 bytes.
- **Expect:** The window list changes; the saved file is byte-identical to S9 and a new export is needed to reflect the change.
- **Trace:** flow K calendar · PLAN-FR-04 · PLAN-AC-03

### S11 — Plan a Target outside any Project {#S11}

- **Do:** On the Targets page, search `m 31` and choose **Add to targets** on the M 31 result. Select the M 31 row to open its Plan area.
- **Expect:** M 31 is listed in My targets. Its Plan area computes windows that name the active planning site and its time zone, and offers **Mark Planned**, **Enable notifications** and **Export calendar**.
- **Expect (negative):** No step asks for a Project or creates one, and the Plan area shows no Project goal gap for M 31.
- **Trace:** flow K · PLAN-FR-09, PLAN-TGT-FR-03 · PLAN-AC-09 · root FR-013 · D-W16, D-W17

### S12 — Plan from the Project page {#S12}

- **Do:** Open the `NGC 7000 HOO` Project page and read its planning. Click **Open in Planner**, then clear the Project context.
- **Expect:** The Project page lists windows for NGC 7000 only, at the active planning site. **Open in Planner** opens the Targets page limited to NGC 7000, with the `NGC 7000 HOO` context shown and the rig selector set to "this Project's rigs". Clearing the context returns the list to My targets, which lists M 31 and NGC 7000, with NGC 7000 carrying the `NGC 7000 HOO` badge.
- **Expect (negative):** M 31 appears in no Project planning list, and planning from the Project page writes no Project record.
- **Trace:** flow K · PLAN-FR-09, PLAN-FR-10, PLAN-TGT-FR-01 · PLAN-AC-10 · PRJ-FR-07 · root FR-013 · D-W16, D-W37, D-W60

### S13 — Read Tonight on Home {#S13}

- **Do:** With the planning site selector still on `Remote site`, open Home and read its Tonight section.
- **Expect:** Tonight names Backyard and its time zone. It lists the best window tonight for NGC 7000 and for M 31, each with start, end and peak altitude. Each matches the best window that the Target's Plan area lists for Backyard tonight under the same criteria. It also shows the Moon's illumination, phase, rise and set, and tonight's darkness window.
- **Expect (negative):** No Tonight value is computed for `Remote site`, and no Target without a window tonight is listed. Reading Tonight schedules no reminder and starts no indexing.
- **Trace:** Home Tonight · PLAN-FR-08, PLAN-FR-11 · PLAN-AC-11 · PRJ-FR-17 · PV-PLAN-SC-04 · D-W39

## Success criteria

- SC1: Every window lists its site and time zone, and capture sites are unchanged through S3.
- SC2: 0 reminders exist before S7; after S7 100% of reminders name Backyard and 0 name `Remote site`.
- SC3: The `.ics` contains exactly the S9 selected windows and is unchanged after S10.
- SC4: 0 indexing operations start from planning, reminder or Tonight steps (S7, S13).
- SC5: A permission denial stays visible with Settings and Retry (S6).
- SC6: Exactly 1 notification is delivered for the S7a target/site/window identity across S7a and S8.
- SC7: M 31 is planned with 0 Projects created or chosen (S11), and the Project page plans exactly 1 subject, NGC 7000 (S12).
- SC8: Tonight lists exactly 2 Targets, NGC 7000 and M 31, at Backyard, and each best window equals the Plan area's best Backyard window for that Target (S13).

## Known gaps

- G1: Not validated. The rebuilt application does not exist. Product behavior follows the specs and the defaults that the authorized autonomous run set in decisions D07 and D18, and the workflow decisions D-W16, D-W36, D-W37, D-W39, D-W60 and D-W66. No implementation has been validated against them.
- G2: Unresolved implementation qualification: how a scheduled reminder is observed before delivery is unspecified, and so is delivery while the app is closed, which is not claimed without an installed, tested scheduler (D07). S7 and S8 depend on it. Blocks readiness.
- G3: Unresolved implementation qualification: no development clock control yet brings a window to its lead time or holds it there across a relaunch (P4). S7a, S8 and S13 depend on it. Blocks readiness.
- G4: Out of scope for this journey: a mosaic subject's Plan area listing each panel (PLAN-FR-02, D-W63) is not exercised. Blocks readiness until covered by a step or a journey. J32/S5 and J32/S7 cover Home's **Plan tonight** Next action (PRJ-FR-18) and the mosaic's centre-based Tonight window (PLAN-FR-11), and J19/S6a covers Tonight without a saved site (PLAN-AC-12).

## Delta log

- **Δ2** 2026-10-06 · S1, S3, S5, S6, +S11, +S12, +S13 · behavior-change
  The Plan area opens from a Targets row and shows the Project goal gap as "in project" and "captured". A Target outside any Project is planned without a Project. The Project page plans its own subjects and opens the Planner in its context. Home's Tonight lists the best windows at the default site.
  Evidence: D-W16, D-W36, D-W37, D-W39, D-W60 (workflow decisions, settled 2026-10-06); 072 PLAN-FR-02, PLAN-FR-09, PLAN-FR-10, PLAN-FR-11, PLAN-AC-09, PLAN-AC-10, PLAN-AC-11 at e4476231; D-W66, 065 PRJ-FR-04, PRJ-FR-21 at d45a22ad · by: agent (intent-gated, user instruction)
