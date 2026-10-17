---
title: Standard components and one step flow
status: accepted
date: 2026-10-12
bead: astro-plan-42eka
---

# Standard components and one step flow

## Status

Accepted. The user confirmed decisions C1 to C15, recorded in Round 9.

## Context

The standard component set includes button hierarchy and row action menus. It also includes page headers and shells, selection bars, refusal and error presentation, confirmation dialogs with fold-out file details, dropdowns or radio buttons, sortable tables with headers, and filters. The decision also covers one staged-work flow across run steps, Wrap up, and cleanup.

## Decision

Use selectors to choose what to clean, trash, or keep, then choose Proceed. A selection step has no Skip or mark-done button: proceeding with nothing selected records it as Skipped. An optional step that is not a selection offers Skip beside Proceed. Use the agreed Edit… verb for renaming, editing details, and optics.

## Rationale

The user asked for a better flow across all product work and said to keep it consistent.

## Alternatives

The user asked for one consistent flow across product work, rather than separate skip and mark-done controls.

## Consequences

Round 9 records decisions C1 to C15. The open Home and goal-condition parts have separate decision beads, astro-plan-b66vy and astro-plan-so89f.
Amended: D-W76 in specs/063-clean-rebuild-contract/workflow-decisions.md:91 sets one Edit… verb in place of Rename…, Edit details…, and Edit optics. D-W77 at line 92 limits the no-Skip rule to selection steps. D-W77 also holds the full step-flow rules this ADR does not restate: an operation step is Finished only when its operation succeeds, and an unmet gate disables Proceed and names what is missing.
