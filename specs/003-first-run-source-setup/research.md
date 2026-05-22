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

**Decision**: Raw required, Project required, others optional, no global
skip (R-Wiz-3). Raw and Project are mandatory: without a Raw source the
app has nothing to scan; without a Project source downstream project
workflows have no root to write into. Old FR-002 ("allow skipping the
entire wizard") is REJECTED and removed from spec.md. Rationale: a
global skip leaves the app completely inert. There is no "I'll add
sources later" escape hatch (R-Wiz-3).

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

**Decision (A9, R-Batch)**: Per-source calls via the `source.register.batch`
contract with row-level partial-success reporting. The Finish step invokes
`source.register.batch` with all buffered sources in a single request.
The response reports per-item status (`success`, `partial`, or `failure`
at the envelope level). A `path.already.registered` error on a given row
is treated as success (idempotent — D1). The Finish step stays open and
surfaces row-level errors when any item fails; rows with errors can be
retried individually without re-submitting successful ones.

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

The `firstrun.restart` contract (R-E5) clears `FirstRunState.completed_at`
and returns the set of existing `RegisteredSource` rows as
`prefilled_sources` so the wizard working buffer can be hydrated. Crash
recovery from a restarted-but-unfinished session reads from
`localStorage` (`alm.first-run.sources`) — same-install only (R-Buf).

## 6a. Duplicate Path Across Kinds (R-1.4)

**Question**: If the user attempts to register the same absolute path under
two different kinds (e.g. the same directory as both `raw` and `calibration`),
what should happen?

**Decision (R-1.4)**: REJECT. A path that is already registered under a
different kind returns `path.already.registered.different_kind` error code.
This is distinct from `path.already.registered` (same kind, same path —
idempotent success on batch). The error is surfaced inline next to the
offending row, showing the conflicting kind.

Rationale: allowing one directory to serve two roles silently corrupts
downstream scan routing (inventory scanner, calibration matcher, project
envelope all filter by kind).

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

**Decision (A8)**: DB-first with `localStorage` cache (option 3). RESOLVED.
The `localStorage` flag is RETAINED as a synchronous-render cache layer; it
is not eliminated. `firstrun.complete` writes both. Cache mismatch triggers
a one-time re-resolve. The index route MUST show a loading/pending state
while the DB-first reconcile resolves (see spec.md FR-016; D2 test case in
018/T009).

**Open**: Confirm we don't need a separate "library not found" branch in
the gate. If the user's SQLite file is missing, the gate should fall
back to the wizard rather than rendering an empty Inventory.

## 7. `created_via` Server-Derived (R-Auth-1)

**Question**: Should the request payload for `source.register` include a
`created_via` field supplied by the caller?

**Decision (R-Auth-1)**: REMOVED from the request. `created_via` is now
server-derived. The server inspects `FirstRunState.completed_at`:

- If `completed_at == null` → `created_via = "first_run"`
- If `completed_at != null` and no restart in progress → `created_via = "settings_add"`
- If a restart is in progress → `created_via = "settings_restart"`

Rationale: the caller cannot be trusted to supply accurate provenance.
The server has the authoritative context to determine origin.

## 8. `sources_buffer` in localStorage Only (R-Buf)

**Question**: Should `FirstRunState.sources_buffer` be persisted in the DB
as a durable mirror of the wizard's in-progress source list?

**Decision (R-Buf)**: `sources_buffer` is REMOVED from the DB entity
`FirstRunState`. The wizard scratch state lives exclusively in
`localStorage` under `alm.first-run.sources`. This is intentional:

- Crash recovery is same-install only (the localStorage key survives
  browser/Tauri process crash but not a machine wipe or reinstall).
- The DB remains clean of transient wizard state.
- Restart recovery (T024) reads from localStorage, not the DB.

The `sources_buffer` field is removed from `data-model.md`.

## 9. Wizard Steps: Detect Tools and Download Catalogs (A5, A6)

**Question**: Should first-run include tool discovery and catalog download?

**Decision (A5)**: Yes. A 'Detect Tools' step is added after the four source
steps and before Finish. The step reads discovered tool paths from the
tool-discovery service (spec 011). The user reviews and confirms (or edits)
before advancing. This pre-fills Settings → Tool Workflows without
silently activating any tool.

**Decision (A6)**: Yes. A 'Download Catalogs' step is added after Detect
Tools. It downloads all thirteen v1 catalogs (spec 014, R-1.1) using the
`catalog.manifest.fetch` and `catalog.download` contracts from spec 014
(R-1.4). The step calls `catalog.manifest.fetch` first (no ETag on first
run), then calls `catalog.download` per catalog with parallel-N concurrency
(N TBD). Progress is driven by event-bus topics from spec 014 R-3.1. The
user can skip; catalog download can be retried from Settings → Catalogs. The
step does not block Finish if skipped. See spec 003 `plan.md` §Download
Catalogs Wizard Step for the full protocol.

Wizard step sequence (FR-009): Welcome → Raw → Calibration → Project →
Inbox → Detect Tools → Download Catalogs → Finish.

## 10. First-Run Completion as Standalone Audit Event (R-E2)

**Decision (R-E2)**: `firstrun.complete` emits a dedicated audit event
`first_run.completed` routed directly through `crates/audit/`. The payload
includes `completed_at` and `source_count_by_kind`. This is NOT a spec 002
lifecycle entity; first-run state is not part of the data lifecycle model.
The contract is defined in `contracts/audit.first_run.completed.json`.
