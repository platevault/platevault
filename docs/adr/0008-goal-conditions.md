---
title: Goal conditions beyond time or frames
status: accepted
date: 2026-10-13
bead: astro-plan-so89f
---

# Goal conditions beyond time or frames

## Status

Accepted by user decision on 2026-10-13 and recorded in HARNESS-V5-FEEDBACK-R1.md, Goals, grilling round 4.

## Context

Each goal already uses time or frames. The user also wanted a quality bar on counted frames, channel balance, mosaic coverage, and a deadline or season window. The setup proposal covered where conditions are configured, their defaults, how progress and unmet conditions show, and how goal templates carry conditions.

## Decision

Set a quality bar per goal. Do not add channel balance as a separate goal. Per-channel goals set the ratio, and the Project page shows it. Support per-panel goals and editable panel balance per channel of plus or minus 10 percent. Support a deadline or season window.

## Rationale

The user dropped channel balance as a goal because per-channel goals set the ratio, which the Project page shows.

## Alternatives

Channel balance as a separate goal was not chosen. The per-channel goals set the ratio, and the Project page shows it.

## Consequences

Implementation is tracked by astro-plan-v7i9k.
