# Research: First-Run Source Setup

**Branch**: `003-first-run-source-setup` | **Date**: 2026-05-20

This document captures the decisions and open questions that gate the
implementation plan. Each section names the question, the options
considered, the recommended default, and the open follow-up.

## 1. Native Directory Picker Library

**Question**: Which library opens the OS-native directory picker from the
Tauri desktop shell?

**Options Considered**:

- **`@tauri-apps/plugin-dialog`** — official Tauri plugin, returns a path
  string or null on cancel, supports `directory: true` and `multiple:
  false`, works on Windows/macOS/Linux without extra capabilities beyond
  the dialog allowlist.
- **Browser `<input type="file" webkitdirectory>`** — works without Tauri
  but returns synthetic `File` objects, not paths. Useless for local-first
  custody because we need the real absolute path.
- **Custom Rust command using `rfd`** — works, but duplicates what the
  Tauri plugin already wraps; only worth considering if `plugin-dialog`
  proves unreliable on a target platform.

**Decision (default)**: Use `@tauri-apps/plugin-dialog`. It is the only
option that satisfies the local-first principle (real absolute paths) and
the portable-contract principle (the Rust handler can be swapped behind
the same JSON-Schema contract later).

**Open**: Confirm the capability allowlist entry for `dialog:default`
fits inside the project's existing capabilities file. Verify behavior on
Windows when the user cancels the dialog with Escape.

## 2. Source Category Clarification UX

**Question**: How should the wizard help users distinguish Raw vs
Calibration vs Project vs Inbox before they click "Add source"?

**Options Considered**:

- **Inline step copy only** — the current mockup approach. One paragraph
  per step, no examples.
- **Inline copy + concrete example paths** — copy plus a short
  "Examples:" list ("e.g. `D:/AstroData/raw`, `~/astro/lights`") to
  anchor the abstract category.
- **Separate clarification page before each picker** — earlier spec hinted
  at this (FR-012 in v1). Adds clicks and slows setup.
- **Tooltip/help-icon per row** — minimal copy on the page, deeper help
  on hover/click.

**Decision (default)**: Inline copy plus concrete example paths
(option 2). Keeps the 6-step flow but adds enough specificity to prevent
the "wrong category" failure mode. The dedicated clarification page is
rejected because the wizard already spans 6 steps; adding more would push
setup past the 5-minute SC-001 ceiling.

**Open**: Confirm the example paths are not so opinionated they bias users
toward a particular library structure. Consider letting the user toggle
"show me an example" rather than always rendering it.

## 3. Required vs Optional Step Gating

**Question**: Which steps block advancement, and how does that interact
with the older FR-002 ("MUST allow skipping the entire wizard")?

**Options Considered**:

- **Raw required, others optional, no global skip** — current mockup.
  Simple, but contradicts FR-002 in the legacy spec.
- **All four kinds required** — strictest. Most defensible technically
  but causes friction for users who genuinely have no calibration library
  yet.
- **None required, global skip honored** — matches old FR-002 but breaks
  every downstream surface because Inventory has nothing to scan.
- **Raw required + per-step skip + global "I'll do this later" escape
  hatch** — flexible but adds three control surfaces to maintain.

**Decision (default)**: Raw required, others optional, no global skip
(option 1). This matches the mockup and matches the "without a Raw source
the app has nothing to do" reality. Old FR-002 should be retired; the
spec marks the conflict as a `[NEEDS DECISION]`.

**Open**: Whether to add a single "I'll add sources later from Settings"
escape on the Welcome step that bypasses Raw enforcement at the cost of
landing in an empty Inventory. Recommend rejecting until users ask.

## 4. Persistence Boundary (Mid-Wizard vs Finish)

**Question**: When are registered sources actually written into the
library database?

**Options Considered**:

- **Per-add (row-at-a-time)** — every time the user adds a source it is
  inserted into SQLite immediately. Restart-from-Settings would then need
  to undo rows or treat them as already-registered.
- **On Finish only, with `localStorage` as buffer** — the mockup pattern.
  Working list lives in `localStorage`; Finish flushes via
  `source.register` and `firstrun.complete`. On wizard abandonment
  nothing leaks into the durable DB.
- **On step transition** — write each kind's batch when leaving its step.
  Hybrid of the above; harder to reason about partial-failure recovery.

**Decision (default)**: On Finish only, with `localStorage` as the
mid-wizard buffer (option 2). This keeps the durable DB clean of
abandoned half-runs, matches the "durable records vs reproducible
projections" constitution principle, and lets the Finish step surface
row-level errors as a unit.

**Open**: Decide whether the Finish flush is atomic (all-or-nothing
transaction) or row-by-row with partial-failure reporting. Default is
atomic; revisit if validation needs to surface multiple errors per run.

## 5. Restart Semantics (Destructive Reset vs Prefill)

**Question**: When the user clicks "Restart first-run wizard" in
Settings, should previously registered sources be cleared, prefilled into
the wizard for editing, or left alone in the DB while the flag is
cleared?

**Options Considered**:

- **Destructive reset** — clear `alm.first-run.completed` and
  `alm.first-run.sources`. The mockup behavior today. Simple, but throws
  away accurate data the user wanted to amend.
- **Prefill for editing** — read existing `RegisteredSource` rows into
  the wizard's working buffer so the user starts from their current
  state, adds/removes individual entries, and re-finishes.
- **Flag-only clear** — clear only the completion flag; leave registered
  sources in the DB. The wizard then shows whatever is in the DB and
  treats Finish as a no-op upsert.

**Decision (default)**: Prefill for editing (option 2). This matches the
old spec's SC-004 ("Restarting setup preserves or updates source settings
predictably") and avoids the data-loss footgun in option 1. The mockup
currently does option 1; this counts as a known regression to fix during
real implementation.

**Open**: Confirm whether restart should also revalidate every existing
source (e.g. drive disconnected) before showing the wizard, or only on
demand. Default: lazy revalidation on Finish.

## 6. Index Route Gating Source of Truth

**Question**: Does the `/` route gate read from `localStorage` or from
the library database?

**Options Considered**:

- **`localStorage` only** — current mockup. Fast and synchronous, but
  becomes inconsistent if the DB is wiped externally.
- **DB only via Tauri command** — authoritative, but requires an async
  call before the first render; the gate becomes a loading state.
- **DB-first with `localStorage` cache** — read the cached flag for an
  optimistic render, then reconcile with the DB on mount.

**Decision (default)**: DB-first with `localStorage` cache (option 3).
Honors the durable-record principle while keeping the gate snappy.
`firstrun.complete` writes both. Cache mismatch triggers a one-time
re-resolve.

**Open**: Confirm we don't need a separate "library not found" branch in
the gate. If the user's SQLite file is missing, the gate should fall
back to the wizard rather than rendering an empty Inventory.
