# ADR-0001: Planner astronomy math runs in the frontend (astronomy-engine), not a Rust core crate

**Status**: Accepted
**Date**: 2026-07-04
**Deciders**: Product owner (Sjors Robroek)
**Governs**: spec 044 — Targets Planner Astronomy
**Related**: `docs/research/044-frontend-astronomy-libraries.md`

## Context

Spec 044 (Targets Planner Astronomy) needs real ephemeris to replace the current
mocked/deterministic-placeholder values in the planner: altitude-vs-time curves,
max altitude tonight, imaging-time-above-threshold, visibility window, the "tonight"
twilight dark-window, moon phase/illumination, target↔Moon lunar distance, and the
opposition / best-date column.

Two properties of these values shape the decision:

- They are **UI-derived and not persisted or audited**. They are decorations recomputed
  for the current observer location / night, not durable relationship or audit records.
  Nothing in the database depends on them.
- They are **interactive**: they should recompute on observer-location change, on the
  usable-altitude slider, and on date navigation — ideally with no IPC round-trip.

A library survey (recorded in the research note above, verified 2026-07-04) found:

- **`astronomy-engine`** (npm, cosinekitty) — MIT, native TypeScript, zero runtime deps,
  ~48 KB gzip, ±1 arcmin validated against NOVAS / JPL Horizons — covers the **entire**
  planner (transforms, rise/set, twilight via `SearchAltitude`, moon phase/illumination,
  `AngleBetween` for lunar distance, `SearchRelativeLongitude` for opposition) in **one
  dependency**. ±1 arcmin is far tighter than the planner needs ("is it above 30° for 2h").
- **No viable maintained pure-Rust ephemeris crate exists**: the one with the right API
  shape (`astro`/saurvs) has been dormant since 2019 with known unfixed bugs; ANISE is
  flight-grade but heavy (SPICE binary kernels, a frames/states programming model);
  `hifitime` is excellent but covers time-scales only, not body positions.

## Decision Drivers

- Replace the 044 mocks with real, accurate values at the lowest risk/effort.
- Keep the planner interactive (no IPC per slider drag).
- Honor Constitution **Principle V** (Portable Contracts and Durable Records): UI-to-core
  operations remain portable, and **the core owns durable product semantics** independent
  of the desktop shell.

## Considered Options

### Option 1 — `astronomy-engine` in the React/TypeScript frontend (chosen)

- **Pros**: one small MIT dependency covers the whole planner; interactive client-side
  recompute with no IPC; native TS types; accuracy far exceeds the need; no persisted/audited
  values leave the frontend, so Principle V is not violated in practice.
- **Cons**: astronomy math lives in the shell, not behind the contract boundary. A future
  non-Tauri client, or backend/batch catalog-wide scoring, would need a separate
  implementation.

### Option 2 — a Rust ephemeris crate in a core crate now

- **Pros**: honors Principle V structurally; enables backend/batch scoring.
- **Cons**: **rejected** — no maintained, ergonomic pure-Rust ephemeris crate exists;
  adopting a dormant crate (`astro`) or the heavy SPICE-based ANISE is disproportionate to
  the need, today.

### Option 3 — hand-port Meeus formulae into a Rust core crate

- **Pros**: pure-Rust, no dormant dependency, Principle V honored.
- **Cons**: **deferred** — higher implementation cost (moon phase + alt/az + rise/set +
  opposition) for no present benefit, since the values are non-persisted UI decorations.

## Decision

Planner astronomy math runs in the **React/TypeScript frontend** via **`astronomy-engine`**,
**not** in a Rust core crate — for now. Consume npm `2.1.19` as-is (its one unpublished bug
fix, `VectorObserver` convergence, is entirely outside the functions used here).

## Consequences

### Positive

- Spec 044's entire mocked astronomy layer is replaced by one accurate, MIT-licensed dependency.
- Interactive, zero-IPC recompute; ±1 arcmin accuracy; strong TS types.
- No durable/audited record depends on frontend-computed values, so Principle V's intent
  (core owns *durable* semantics) is preserved.

### Negative / Risks

- Astronomy math is duplicated-in-principle: it is not available behind the contract boundary
  to a future non-Tauri client or a backend batch job.
- Single-maintainer library (slow npm cadence); mitigated because it is pure TS with zero deps
  — vendoring/pinning a GitHub commit is trivial if a needed fix never reaches npm.

### Trigger to revisit (→ move computation to Rust)

Re-open this ADR when **either** holds:

1. the app needs **server-side / catalog-wide batch visibility scoring** (e.g. rank the whole
   target catalog by tonight's max altitude, computed once and cached), **or**
2. any of these values become **persisted or audited** (a durable record, not a UI decoration).

At that point either shell out to the same JS engine from the backend, or invest in a Rust
port (hand-ported Meeus, or ANISE if precision/portability has by then outgrown Meeus).

## References

- `docs/research/044-frontend-astronomy-libraries.md` — full library survey + tiered
  `astronomy-engine` capability inventory (verified 2026-07-04).
- Constitution Principle V — Portable Contracts and Durable Records (`.specify/memory/constitution.md`).
