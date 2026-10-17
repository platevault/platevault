---
title: Home dashboard without duplicating other pages
status: accepted
date: 2026-10-13
bead: astro-plan-b66vy
---

# Home dashboard without duplicating other pages

## Status

Accepted. The owner confirmed the decision on 2026-10-13 after three grilling rounds (Q1 to Q31). Round 9 records the decision.

## Context

The owner asked for a centralised dashboard of open and pending work. It also needs to show pending ingestions, alerts, and status. The owner wanted priorities and opportunities. The owner rejected the Night concepts, then Month and Progress. The criteria were to show state across areas, avoid list duplication, limit each section to five rows with an All N link, and sort by urgency.

## Decision

Home shows what needs attention, active work, and when to capture next. It uses standard components, and each row links to its owning page. Sections include Pending ingestions and Pending work. Other sections cover Open work, Status, Tonight, and the calendar. Show up to five rows in each section. An All N link opens the owning page. Keep the section order fixed. Show problems on affected rows. Put duplicates in the Sessions Duplicates filter. Show drift on the affected rows.

## Rationale

The selected dashboard brings cross-area state into one place. It shows active work, new ingestions, and problems. Each row links to its owning page, avoiding list duplication.

## Alternatives

The owner rejected the Night, Month, and Progress concepts because they showed goal tables only. The owner rejected inline work on Home. One-click actions remain for major actions that need no further input and can be undone. The owner rejected an alerts list on Home, tabs, and a separate priorities section. Weather-driven opportunities and user-arranged sections remain in the backlog.

## Consequences

Both quick-action modes need to be built and tested on every page. Pending ingestions needs desktop startup scans and capture-folder watching. This adds file-system activity and offline-drive states. The concepts route and its message keys are removed. Units that reused those keys need their own.
Amended: D-W92 in specs/063-clean-rebuild-contract/workflow-decisions.md:107 routes duplicates through the Sessions Duplicates filter and shows drift on affected rows.
