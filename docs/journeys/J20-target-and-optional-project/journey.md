---
id: J20
title: Open a Target and organize an optional Project goal
version: 1
status: draft
last_reviewed: 2026-10-03
actors: [primary-user]
surfaces: [targets, projects, planning, view-review]
interfaces: [desktop-ui, desktop-ui-macos]
trace: [063-clean-rebuild-contract, 064-library-inventory, 065-project-goals, 066-view-selection, 072-observing-plans, D07, D10, D12, D18, specs/063-clean-rebuild-contract/decisions.md, specs/064-library-inventory/spec.md, specs/065-project-goals/spec.md, specs/066-view-selection/spec.md, specs/072-observing-plans/spec.md, docs/reviews/2026-10-03-product-flow-and-journeys.md#journey-b-target-and-optional-project]
---

## Goal

The user opens a Target to see what the library holds for it, then records an
optional Project goal with confirmed framing, explicitly linked sessions,
equipment, and a capture checklist, compares planning sites, and starts a View
from the Project. Done means the Target page shows captured, usable and
Unreviewed integration per channel, with its offline contribution labelled
Offline. The Project shows unmet progress for exactly the linked sessions.
Switching planning site changes only visibility. A View opens with Project
context despite the unmet checklist. Project edits change no file, quality
state or existing View.

## Preconditions

- P1: J19 completed through S15 (`Cold-1` is offline).
- P2: Settings holds two saved sites: Backyard and a second site at least 15° of longitude and one time zone away from Backyard. No site is designated default (J29 sets it).
- P3: No Project and no View exists.
- P4: The J19/P5 manifest is available.

## Steps

### S1 — Open NGC 7000 {#S1}

- **Do:** Launch PlateVault, use Target search, and open NGC 7000.
- **Expect:** Targets is the first surface shown. The Target page shows captured integration, library-wide usable integration, and Unreviewed integration by channel. Usable reads 0h 00m for Ha and OIII and Unreviewed equals captured for each channel. Availability is shown as a separate state; the 12 Sep OIII contribution counts in captured integration with its last-observed values and reads Offline.
- **Expect (negative):** The 12 Sep contribution is not offered as an available processing input. Search needs no network connection.
- **Trace:** flow B1 · LIB-FR-08 · LIB-AC-05 · D18

### S2 — Create the Project {#S2}

- **Do:** Click **New Project**. Enter `NGC 7000 HOO` and a note. Confirm the prefilled Target NGC 7000.
- **Expect:** The Project's framing shows NGC 7000's coordinates and their source. A control to add further Targets or panels is offered.
- **Trace:** flow B2 · PRJ-FR-01 · PRJ-AC-01 · D12

### S3 — Link sessions explicitly {#S3}

- **Do:** Link the six RedCat NGC 7000 sessions (12, 18, 24, 26, 28, and 30 Sep) to the Project.
- **Expect:** The Project lists exactly those six sessions.
- **Expect (negative):** The other-camera session is not linked by proximity or a shared OBJECT label.
- **Trace:** Projects surface · PRJ-FR-07 · D12 · G3

### S4 — Choose equipment and a checklist {#S4}

- **Do:** Choose RedCat 51 / ASI2600MM as the equipment for initial preselection. Add checklist items Ha 10h, OIII 10h, and a 300-second exposure preference. Save.
- **Expect:** Each integration item shows captured and library-usable progress separately; Ha reads captured 9h 15m (111 frames) and usable 0h 00m, unmet; OIII reads usable 0h 00m, unmet. The exposure item shows each linked session's exposure evidence (300 s) rather than an hour total. The Projects surface lists the Project with its goals, checklist, and linked sessions and no Views or accepted products.
- **Trace:** flow B2, Projects surface · PRJ-FR-02, PRJ-FR-03, PRJ-FR-04, PRJ-FR-07 · PRJ-AC-01 · D10

### S5 — Confirm the Project had no side effects {#S5}

- **Do:** Recompute the manifest of online fixture folders; open Views and Sessions. Compare Cold-1's manifest entries only after it is remounted, then restore its Offline state for the next step.
- **Expect:** Online paths and hashes equal their matching J19/P5 entries, and Cold-1 matches after remount. No View exists. Every frame still reads Unreviewed.
- **Expect (negative):** Creating or editing the Project moved, renamed, or wrote no file, generated no View, and changed no quality state.
- **Trace:** flow B2 · PRJ-FR-05 · PRJ-AC-02

### S6 — Inspect capture sites {#S6}

- **Do:** Open the Project's linked sessions.
- **Expect:** Each linked session shows its own capture site: 12 Sep reads the second site and the Astro-T7 sessions read Backyard. The Project has no single capture-site field.
- **Trace:** flow B3 · PRJ-FR-06 · PRJ-AC-04

### S7 — Compare planning sites {#S7}

- **Do:** In the planning site selector, choose Backyard, then the second site.
- **Expect:** The visibility calculation recalculates for the chosen site and names that site and its time zone.
- **Expect (negative):** Linked sessions, their capture sites, and Project membership are identical before and after. Notifications stay disabled and no reminder is scheduled.
- **Trace:** flow B3 · PLAN-FR-01 · PLAN-AC-01 · D07

### S8 — Start a View from the Project {#S8}

- **Do:** Click **Create View** from the Project.
- **Expect:** The View review workspace opens with Project `NGC 7000 HOO` and RedCat 51 / ASI2600MM as its context, although every checklist item is unmet. The Project stays open.
- **Expect (negative):** No View folder is created on disk and no quality state changes.
- **Trace:** flow B4 · VSEL-FR-01 · PRJ-FR-04

## Success criteria

- SC1: At S1, usable reads 0h 00m per channel, Unreviewed equals captured per channel, and 12 Sep reads Offline and unavailable.
- SC2: The Project links exactly 6 sessions (S3), and Ha progress reads captured 9h 15m and usable 0h 00m (S4).
- SC3: Zero file, quality-state, or View changes occur through S5; zero Views exist before S8.
- SC4: The S7 visibility calculation differs between the two sites while linked sessions and capture sites are identical (S6, S7).
- SC5: The workspace opens at S8 with every checklist item unmet.

## Known gaps

- G1: Not validated — the rebuilt application does not exist. Product behavior follows the specs and the defaults that the authorized autonomous run set in decisions D07, D10, D12, and D18; no implementation has been validated against them.
- G2: Out of scope for this journey — mosaic panels (user-defined panel footprints, D12) and automatic panel coverage are not exercised. Blocks readiness until covered by a step or a journey.
- G3: Unresolved implementation qualification — the flow names no control for explicit session linkage (S3) or for saving sites in Settings (P2). Blocks readiness.
- G4: Out of scope for this journey: external resolver enrichment of a saved target, its provider provenance and a resolver failure (LIB-AC-12, D18) are not exercised. Blocks readiness until covered by a step or a journey.

## Delta log

- No entries (initial draft, version 1).
