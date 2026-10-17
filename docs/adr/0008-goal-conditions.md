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

Each goal measures time or frames. A goal may carry an optional quality bar. Channel balance is not a goal. Per-channel goals set the ratio, which the Project page shows. Support per-panel goals and editable panel balance per channel of plus or minus 10 percent. Support a deadline or season window.

## Rationale

The user dropped channel balance as a goal because per-channel goals set the ratio, which the Project page shows.

## Alternatives

Goals may omit the quality bar and measure time or frames alone.

## Consequences

Implementation is tracked by astro-plan-v7i9k.
Amended: D-W90 in specs/063-clean-rebuild-contract/workflow-decisions.md:105 and PRJ-FR-03 in specs/065-project-goals/spec.md:97 make the quality bar optional.
