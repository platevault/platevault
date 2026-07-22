# Research: Onboarding Redesign — Three-Layer Onboarding (Spec 056)

**Date**: 2026-07-18 | **Spec**: [spec.md](spec.md)

All decisions below were verified against `origin/main` in this worktree or
carry primary evidence pointers. Constitution §IV (research-led domain
modeling): every inference-based mapping records its evidence.

## R1 — Tour/spotlight library: react-joyride v3 (pinned)

**Decision**: react-joyride v3 (`^3.2.0`, pinned), behind a thin adapter
(R3). Already a direct dependency (`apps/desktop/package.json:60`), installed
by spec 010.

**Rationale**: Head-to-head faceoff scored joyride over Shepherd 15.x
**54–41**. Shepherd was disqualified on merit: an unfixable tooltip autofocus
defect (shepherd-pro/shepherd#2117) and HTML-string-only step content
(incompatible with our React component chrome and i18n pipeline).

**Licensing note (corrects spec 010's stale rationale)**: Shepherd's AGPL
option WAS license-compatible with this AGPL-3.0-only application. Spec 010
recorded Shepherd as disqualified on licensing; that reasoning is retired —
the 056 disqualification is on merit alone.

**Alternatives considered**:
- Shepherd 15.x — disqualified on merit (above).
- Headless build on `@floating-ui/react` — **pre-approved fallback** if
  joyride regresses. It is a transitive dependency through
  `@base-ui-components/react 1.0.0-rc.0`; adopting it adds one direct
  dependency. The thin adapter (R3) confines the swap.

## R2 — Joyride risk register (a11y spike executed: verdict GO)

The screen-reader spike evidence is in a11y-spike `findings.txt`, with file and
line citations plus DOM dumps. React-joyride v3 passed the spike. The following
adapter requirements are binding:

1. **No modal ARIA from the library**: joyride's `role="alertdialog"` /
   `aria-modal="true"` exist ONLY in `DefaultTooltip`'s `tooltipProps` spread.
   Our adapter `tooltipComponent` MUST NOT spread `tooltipProps`; it sets its
   own role (`status`/`region`) and renders our own `aria-live` announcer from
   step title/content. Verified: with a custom tooltip, no modal ARIA appears
   anywhere in the DOM.
2. **Focus trap is ARIA-independent** (`useFocusTrap`, 100 ms delayed
   autofocus to `[data-action=primary]`, focus-return on close) and MUST be
   set explicitly per layer: the orientation walk (modal by design) KEEPS the
   trap; non-modal L3 spotlights set `disableFocusTrap`.
3. **Escape-to-dismiss** comes free via the default `dismissKeyAction:
   'close'` — no custom key handling needed for FR-003/FR-023.
4. **Issue #1211 confirmed permanent**: `run=true` at mount with
   async-hydrating steps renders NOTHING. Every joyride mount MUST gate
   `run={steps.length > 0}`.

Version stays pinned; upgrades re-run the spike checklist before landing.

## R3 — Thin adapter architecture

**Decision**: All engine state — item registry, activation, ticks,
persistence, walk progress — is library-agnostic in our store/backend.
Joyride receives only derived `stepIndex`/`run` props. All visible chrome is
our own `tooltipComponent` built from shared UI + design tokens, with our own
aria-live announcer (R2.1). The joyride import surface is confined to one
adapter module.

**Rationale**: keeps the pre-approved `@floating-ui/react` fallback a
one-module swap; prevents joyride API/ARIA defaults from leaking into product
semantics.

## R4 — Auto-tick event inventory (verified, not assumed)

Bus topic registry: `crates/audit-types/src/event_bus.rs` (45 topics scanned).

| Milestone | Topic | Publisher (verified) | Verdict |
| --- | --- | --- | --- |
| Inventory confirmed | `inventory.confirmed` | `crates/app/inbox/src/confirm.rs:623-651` (best-effort, swallow-on-failure) | **Auto-tick** |
| Project created | `project.created` | `crates/app/projects/src/project_setup.rs:599` (published in use case after commit) | **Auto-tick** |
| Tool launched | `tool.launch` | `crates/app/core/src/tool_launch.rs:146` (best-effort) | **Auto-tick**, only when payload outcome == `spawned` |
| Plan applied | `plan.applying.completed` | `crates/app/core/src/plan_apply.rs:1266,1401` | **Auto-tick** (exists; usable for an Inbox "apply your first plan" item) |
| Target added/resolved | `target.resolved` | `crates/app/targets/src/ingest_resolution.rs:329-330` | **Auto-tick** (exists; fires on real target resolution) |
| Master registered | — none — | registration is a side effect of `plan.applying.completed` (`crates/app/core/tests/confirm_master_integration.rs:178`); no dedicated topic | **Manual item + follow-up** to mint `calibration.master.registered` in a later spec |
| Site saved | — none — | no `site.*` topic; `settings.changed` is too coarse to distinguish site saves | **Manual item + follow-up** |
| First-run finished | `first_run.completed` | `crates/app/core/src/first_run.rs:645` | **L1 trigger** (orientation walk launch), not a tick |

**Constraint honored**: no new backend events are minted in v1 (decision
record #2). Missing milestones above are recorded as follow-ups and their
checklist items are manual.

**Restore filtering**: the bus envelope carries `source`; the subscriber
filters `source == "restore"` SERVER-side (FR-016) so replayed history can
never tick, regardless of frontend state.

## R5 — Backend-authoritative tick subscriber

**Decision**: a Rust bus subscriber — same wiring pattern as
`start_guided_event_forwarder` (`apps/desktop/src-tauri/src/commands/guided.rs`,
#722) but *writing* — maps topic→item, applies the R4 table, filters
restore-sourced envelopes, persists the tick directly, then emits a single
`onboarding:state-changed` Tauri notification. The frontend only reads state
via `onboarding_*` commands and refreshes on that notification.

**Rationale**: ticks are correct even if no window is open, no UI race can
lose a tick, and mock-mode UI can never fake one (FR-021, SC-003).

**Test gap noted**: no Layer-1 test anywhere subscribes to the bus today —
the Layer-1 suite for this feature is the first, and must assert publisher →
subscriber → persisted tick end-to-end (VC-003).

## R6 — Persistence and migration

**Decision**: migration **0080** creates `onboarding_state` (per-item rows) and
`onboarding_flags` (singleton). Migration **0081** drops the legacy table via
`DROP TABLE IF EXISTS guided_flow_state`. Migration `0030_guided_flow.sql` is
shipped and untouched.

**Cautions (project memory)**: parallel merges claiming the same migration
number abort fresh-DB migrate. On Windows, touch
`crates/persistence/db/src/lib.rs` to force sqlx re-embedding of a new
migration.

## R7 — Deletion inventory (old machinery, verified paths)

Deleted, not adapted (FR-027):

- `crates/app/core/src/guided_flow.rs` — state machine + STEP_REGISTRY.
- 5 commands in `apps/desktop/src-tauri/src/commands/guided.rs`
  (`guided_state_get`, `guided_step_complete`, `guided_dismiss`,
  `guided_restart`, `guided_activate`) + registrations in
  `apps/desktop/src-tauri/src/lib.rs:54,321-325,564-568` + the
  `start_guided_event_forwarder` bridge (replaced by R5 subscriber).
- `crates/contracts/core/src/guided.rs` + `mod guided` (`lib.rs:17`).
- `apps/desktop/src/features/guided/` — `GuidedOverlay.tsx`, `eventBridge.ts`,
  `store.ts`, `useGuidedFlow.ts`, `anchors.ts`, `__tests__/`.
- `apps/desktop/src-tauri/src/commands/tour.rs` (`tour_complete_step` stub)
  incl. `lib.rs` registrations, `mocks.ts` entries, and `commands.rs`/
  `bindings.rs` tests.
- `preferences.tourCompleted` in `apps/desktop/src/data/preferences.ts`,
  `apps/desktop/src/api/mocks.ts`, and generated bindings.
- `guided_flow_state` table dropped by migration 0069 (R6).

**Kept**: the `data-guide-anchor` DOM convention (14 anchor sites in
`apps/desktop/src`). The duplicate `inbox.confirm-row` anchor
(`InboxPage.tsx:997` bulk-confirm AND `InboxDetail.tsx:779`) is resolved to a
single target: the **InboxPage bulk-confirm control** keeps the anchor (always
reachable without a selection); the InboxDetail attribute is removed.

## R8 — E2E suppression replacement

Today `tests/e2e/support/harness.ts:72 disableGuidedTourOverlay` hides
`#react-joyride-portal` via injected CSS, called from 7 e2e support/spec files
(~30 call sites). That helper dies with the old coach.

**Decision**: a deterministic app-level suppression input (E2E/mock harness
sets an explicit flag the onboarding store reads at startup, in the existing
`VITE_E2E` input family) that suppresses ALL onboarding surfaces (walk,
accordion auto-expand, spotlights) — satisfying FR-030 semantically instead
of visually. Helper renamed (`disableOnboarding`), all call sites migrated in
the same change. CSS hiding of the joyride portal remains available as a
belt-and-braces fallback but is not the contract.

## R9 — i18n

Every user-facing string goes through the Paraglide catalog
(`apps/desktop/messages/en.json`, spec 046 pipeline). Checklist labels
(3–5 words), tooltip sentences, orientation stop copy, prerequisite reasons,
menu/confirm strings, and announcer text are all message keys. No error-code
registry changes expected.

## R10 — Shared-component mandate

ONE parameterised checklist component and one CSS class family
(tokens-based), reused by the sidebar accordion section and the
icon-collapsed popover (FR-011). Per the standing shared-UI rule and
`scripts/css-dup-sniff.mjs` guard: no per-surface CSS clones.

## R11 — Interaction & accessibility notes (UX skills pass)

- **Modal walk (L1)**: keeps joyride's focus trap (R2.2); Escape closes
  (R2.3) and counts as Skip (FR-003/FR-004); focus returns to the invoking
  context on close (WCAG 2.4.3); page changes between stops re-announce via
  the adapter's aria-live region.
- **Accordion (L2)**: standard disclosure pattern — `aria-expanded` on group
  headers, list semantics for items, tooltip content available on hover AND
  keyboard focus and dismissable (WCAG 1.4.13); progress ring exposes
  `role="progressbar"` with `aria-valuenow`; completion announcements are
  `aria-live="polite"` so auto-ticks never interrupt.
- **Spotlight (L3)**: non-modal — `disableFocusTrap` (R2.2), never steals
  focus, rest of app stays interactive; pulse ≤ first few seconds then static
  outline; `prefers-reduced-motion` suppresses pulse and completion
  choreography (FR-020/FR-024); overlay may dim the sidebar but must keep the
  spotlighted target at ≥ 3:1 non-text contrast against the dimmed field.
- **Completion choreography (FR-018)**: tick animation ~300 ms, row emphasis
  then reorder; reduced-motion path applies final state instantly (no motion,
  no pulse) — state parity between both paths is a test assertion, not a
  style detail.
