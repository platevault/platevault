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

Use selectors to choose what to clean, trash, or keep, then choose Proceed. Do not add separate skip or mark-done buttons. Use the agreed Edit… verb for renaming, editing details, and optics.

## Rationale

The user asked for a better flow across all product work and said to keep it consistent.

## Alternatives

Use one Edit… verb rather than separate Rename, Edit details, and Edit optics verbs.

## Consequences

Amended: D-W76 in specs/063-clean-rebuild-contract/workflow-decisions.md:91 sets one Edit… verb in place of Rename…, Edit details…, and Edit optics.
