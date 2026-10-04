---
id: J29
title: Plan observing windows, opt into default-site reminders, and export a calendar snapshot
version: 1
status: draft
last_reviewed: 2026-10-03
actors: [primary-user]
surfaces: [planning, targets, projects, settings]
interfaces: [desktop-ui, desktop-ui-macos]
trace: [063-clean-rebuild-contract, 072-observing-plans, D07, D18, specs/063-clean-rebuild-contract/decisions.md, specs/072-observing-plans/spec.md, docs/reviews/2026-10-03-product-flow-and-journeys.md#journey-k-observing-plans-and-reminders]
---

## Goal

The user checks when NGC 7000 has a suitable observing window, compares planning
sites, deliberately enables reminders for the default site, and saves a one-time
calendar snapshot. Done means windows name their site and time-zone basis.
Reminders require opt-in, a default site, criteria and lead time; each names
Backyard. The saved `.ics` contains exactly the confirmed windows and remains
unchanged afterwards. Planning changes no library, Project or session data
and starts no indexing.

## Preconditions

- P1: J20 completed (the J21–J28 journeys are not required). Settings holds Backyard and the second site; no site is designated default.
- P2: The OS has not yet been asked for notification permission for PlateVault, so the first request can be denied.
- P3: No calendar provider account is configured.

## Steps

### S1 — Open the Plan area {#S1}

- **Do:** Open NGC 7000's Plan area and choose Backyard as planning site.
- **Expect:** Calculated windows show their site and time-zone basis. Project `NGC 7000 HOO` checklist gaps (Ha 10h and OIII 10h unmet) appear beside the relevant coverage. Notifications read disabled.
- **Expect (negative):** No window claims clear weather, telescope availability, or processing readiness.
- **Trace:** flow K · PLAN-FR-02, PLAN-FR-05 · D07

### S2 — Set criteria {#S2}

- **Do:** Set altitude, darkness, Moon, and minimum-duration criteria.
- **Expect:** The window list recalculates; every listed window meets the stated criteria.
- **Trace:** flow K · PLAN-FR-02

### S3 — Switch the planning site {#S3}

- **Do:** Choose the second site in the planning site selector.
- **Expect:** Windows recalculate and name the second site and its time zone.
- **Expect (negative):** Project membership and session capture sites are unchanged.
- **Trace:** flow K, B3 · PLAN-FR-01 · PLAN-AC-01

### S4 — Try to enable reminders without a default site {#S4}

- **Do:** Mark NGC 7000 **Planned** and click **Enable notifications**.
- **Expect:** NGC 7000 reads Planned. PlateVault directs the user to set a default site in Settings and does not enable notifications.
- **Expect (negative):** No reminder is scheduled.
- **Trace:** flow K · PLAN-FR-03 · PLAN-AC-04 · D07

### S5 — Set the default site and reminder values {#S5}

- **Do:** In Settings, make Backyard the default site, then return to the Plan area (planning site still the second site) and set the reminder lead time.
- **Expect:** **Enable notifications** names Backyard as the reminder site, the active criteria, and the lead time, while the window list still names the second site.
- **Trace:** flow K · PLAN-FR-01, PLAN-FR-03 · D07

### S6 — Deny notification permission {#S6}

- **Do:** Click **Enable notifications** and deny the OS permission request.
- **Expect:** The denial stays visible and offers **Settings** and **Retry**; notifications read not enabled.
- **Trace:** flow K · D07

### S7 — Enable reminders {#S7}

- **Do:** Grant the permission in the OS settings and click **Retry**.
- **Expect:** Notifications read enabled for Backyard. Every reminder names Backyard and its window.
- **Expect (negative):** No reminder is created for the second site. Enabling reminders starts no indexing or processing.
- **Trace:** flow K · PLAN-FR-03 · PLAN-AC-02, PLAN-AC-05 · D07

### S8 — Restart without duplicate reminders {#S8}

- **Do:** Quit and relaunch PlateVault, then open the Plan area.
- **Expect:** Upcoming windows are recomputed and each Backyard window has at most one reminder.
- **Trace:** D07

### S9 — Export a calendar snapshot {#S9}

- **Do:** Click **Export calendar**, confirm the displayed planning site, date range, time zone, and selected windows, and save the `.ics` with the native save dialog.
- **Expect:** The saved file contains exactly the selected windows with the displayed site and time-zone basis.
- **Expect (negative):** No provider account, calendar authorization, or hosted subscription is requested.
- **Trace:** flow K calendar · PLAN-FR-04 · PLAN-AC-03 · root FR-015, D18

### S10 — Change criteria after export {#S10}

- **Do:** Raise the minimum-duration criterion and compare the saved `.ics` with its S9 bytes.
- **Expect:** The window list changes; the saved file is byte-identical to S9 and a new export is needed to reflect the change.
- **Trace:** flow K calendar · PLAN-FR-04 · PLAN-AC-03

## Success criteria

- SC1: Every window lists its site and time zone, and capture sites are unchanged through S3.
- SC2: 0 reminders exist before S7; after S7 100% of reminders name Backyard and 0 name the second site.
- SC3: The `.ics` contains exactly the S9 selected windows and is unchanged after S10.
- SC4: 0 indexing operations start from planning or reminder steps (S7).
- SC5: A permission denial stays visible with Settings and Retry (S6).

## Known gaps

- G1: Not validated — the rebuilt application does not exist. Product behavior follows the specs and the defaults that the authorized autonomous run set in decisions D07 and D18; no implementation has been validated against them.
- G2: Unresolved implementation qualification — how a scheduled reminder is observed before delivery, and delivery while the app is closed (not claimed without an installed, tested scheduler, D07), are unspecified. S7 and S8 depend on it. Blocks readiness.

## Delta log

- No entries (initial draft, version 1).
