---
title: The production frontend uses the system UI font
status: accepted
date: 2026-10-26
bead: astro-plan-m8ab5
---

# The production frontend uses the system UI font

## Status

Accepted by owner decision on 2026-10-26.

## Context

Round 9 of the harness review (C13 in `apps/prototype/design/HARNESS-V5-FEEDBACK-R1.md` on `ui-harness-v5`) used the system font until the stack was decided. S1 then settled Tauri and React (ADR 0006). The current desktop app still bundles Inter, from spec 055. The production frontend needed one typeface before its token source could be ported (astro-plan-hqkn5).

The two options were the system UI font and bundled Inter:

- **System UI font:** SF Pro on macOS, Segoe UI on Windows and the distribution's UI font on Linux.
- **Bundled Inter:** the same font on every OS.

## Decision

The production frontend uses the system UI font stack, with no bundled text font.

## Rationale

Every round of the owner's harness review used the system font, so the reviewed layouts and copy were judged in it. It matches the OS-drawn menus, dialogs and notifications that the frontend keeps native (Round 9, stack round 1). It adds no font files to the app bundle.

## Alternatives

Bundled Inter was not chosen. It gives the same text widths on every OS, but adds font files to the bundle and looks less native next to OS menus and dialogs.

## Consequences

- Text widths differ a little between platforms. Tight layouts, such as the Locations table that fits at 1440 px, need checking on macOS, Windows and Linux.
- The DTCG token source of the production frontend carries the system UI stack (astro-plan-hqkn5).
- The bundled Inter files and the spec 055 font tokens leave with the legacy token pipeline at cutover.
