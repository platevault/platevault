# Implementation Plan: Onboarding Redesign — Three-Layer Onboarding

**Branch**: `spec/056-onboarding-redesign` | **Date**: 2026-07-18 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/056-onboarding-redesign/spec.md`

## Summary

Replace the spec 010 sequential guided coach with three independent layers:
(L1) a one-time modal orientation walk after the first-run wizard, (L2)
per-page Getting Started checklists in one shared sidebar accordion with
backend-authoritative auto-ticks from real bus events, and (L3) per-item
non-modal find spotlights on the real controls. Old guided machinery is
deleted wholesale. Technical approach: react-joyride v3 behind a thin adapter
(headless Floating UI as pre-approved fallback), a Rust bus subscriber that
persists ticks server-side (restore-filtered), a new migration for
`onboarding_state`/`onboarding_flags`, new `onboarding_*` Tauri commands plus
an `onboarding:state-changed` notification, Paraglide i18n throughout, and one
parameterised checklist component.

## Technical Context

**Language/Version**: Rust (workspace toolchain) + TypeScript/React (Tauri v2 desktop shell)

**Primary Dependencies**: react-joyride `^3.2.0` (pinned; already a direct dep — [research R1/R2](research.md)); shared UI + design tokens; Paraglide (spec 046); tauri-specta bindings. No new runtime dependencies. Pre-approved fallback: `@floating-ui/react` headless build (adapter-confined swap).

**Storage**: SQLite via `crates/persistence/db` — new migration **0069** creating `onboarding_state` (per-item rows) + `onboarding_flags` (singleton), dropping `guided_flow_state` ([research R6](research.md)).

**Testing**: Layer-1 `cargo test --workspace` (real SQLite + real bus publisher→subscriber, first bus-subscribing Layer-1 tests in the repo); Playwright mock suite for UI semantics; one Layer-2 `tauri-driver` E2E journey (`crates/e2e-tests`); journey **J18** as behavioral contract.

**Target Platform**: Windows/macOS/Linux desktop (Tauri v2)

**Project Type**: Desktop app (Tauri + React) over granular Rust crates

**Performance Goals**: auto-tick visible within 2 s of the real event (SC-002); orientation walk stop transitions render without perceptible lag; zero polling — refresh only on `onboarding:state-changed`.

**Constraints**: backend-authoritative state (UI is a pure view); no new bus events minted in v1; restore-sourced events inert server-side; no demo data ever; reduced-motion parity; every string via Paraglide; ONE checklist component + one CSS class family; `dev-tools` feature gating untouched.

**Scale/Scope**: 5 checklist pages × 2–4 items (≈14 items), ~6 orientation stops, 1 subscriber, ~4 commands, 1 migration; deletion of ~10 legacy files/surfaces ([research R7](research.md)).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Verdict | Notes |
| --- | --- | --- |
| I. Local-first file custody | PASS | Metadata-only feature; no image files touched; state lives in SQLite. |
| II. Reviewable filesystem mutation | PASS | No filesystem mutation at all. Ticks observe plans/confirms; they never apply them. |
| III. PixInsight boundary | PASS | "Launch your processing tool" items only observe `tool.launch`; no processing performed. |
| IV. Research-led domain modeling | PASS | Event inventory verified, not assumed (research R4); library faceoff + a11y spike recorded (R1/R2); missing events become follow-ups, not inventions. |
| V. Portable contracts and durable records | PASS | `onboarding_*` operations documented as language-neutral contract deltas ([contracts/](contracts/)); SQLite is the durable record; the accordion/walk are reproducible projections of it. |
| No demo data (spec 010 FR-009 carried as 056 FR-009) | PASS | Auto-ticks derive exclusively from real recorded events; seeding derives from existing DB state only. |

**Modal-walk exception**: the orientation walk is deliberately modal — a
documented, user-approved exception to the product's non-modal norm, scoped to
the single post-setup moment and always skippable (spec FR-002). Recorded here
so the exception never generalizes.

**Post-design re-check (after Phase 1)**: PASS — data model stores only
onboarding metadata; contracts stay language-neutral; no principle newly
implicated.

## Project Structure

### Documentation (this feature)

```text
specs/056-onboarding-redesign/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output (onboarding command contract deltas)
├── checklists/          # requirements.md (+ /speckit-checklist output)
├── PENDING_REVIEW_QUESTIONS.md
└── tasks.md             # Phase 2 output (/speckit-tasks)
```

### Source Code (repository root)

```text
crates/
├── audit-types/src/event_bus.rs         # topics consumed (read-only; no new topics)
├── app/core/src/
│   ├── onboarding.rs                    # NEW: item registry, seed/restore, tick write path
│   └── guided_flow.rs                   # DELETED
├── contracts/core/src/
│   ├── onboarding.rs                    # NEW: onboarding DTOs
│   └── guided.rs                        # DELETED
└── persistence/db/
    ├── migrations/0069_onboarding.sql   # NEW: onboarding_state + onboarding_flags, drop guided_flow_state
    └── src/repositories/onboarding.rs   # NEW: repository boundary

apps/desktop/
├── src-tauri/src/
│   ├── commands/onboarding.rs           # NEW: onboarding_* commands + bus subscriber (start_onboarding_subscriber)
│   ├── commands/guided.rs               # DELETED (incl. start_guided_event_forwarder)
│   ├── commands/tour.rs                 # DELETED
│   └── lib.rs                           # registrations swapped
├── src/features/onboarding/             # NEW: adapter (joyride), walk, checklist section, popover, spotlight, store
│   └── (ONE parameterised checklist component + one CSS class family)
├── src/features/guided/                 # DELETED
├── src/data/preferences.ts              # tourCompleted removed
└── messages/en.json                     # all onboarding strings (Paraglide)

tests/e2e/support/harness.ts             # disableGuidedTourOverlay → disableOnboarding (R8)
crates/e2e-tests/                        # ONE Layer-2 journey: orientation → real confirm → live auto-tick
docs/journeys/                           # J18 (authored by the journey lane; referenced here)
```

**Structure Decision**: follows the monorepo boundary rules — pure use-case
logic in `crates/app/core`, DTOs in `crates/contracts/core`, SQL behind
`crates/persistence/db`, Tauri command shims + subscriber wiring in
`apps/desktop/src-tauri`, all UI in one new `features/onboarding/` directory
replacing `features/guided/`.

## Design Decisions (binding, from decision record + research)

1. **Backend-authoritative ticks** ([research R5](research.md)): the Rust bus
   subscriber maps events→items per the verified R4 table, filters
   `source == "restore"` server-side, persists directly, then emits
   `onboarding:state-changed`. The frontend never writes tick state except via
   the manual check/dismiss commands.
2. **Thin adapter** ([research R3](research.md), spike-verified R2): joyride
   receives only derived `stepIndex`/`run`; the adapter `tooltipComponent`
   does NOT spread `tooltipProps` (kills `role="alertdialog"`/`aria-modal`),
   sets its own role + aria-live announcer; the orientation walk keeps the
   focus trap, L3 spotlights set `disableFocusTrap`; every mount gates
   `run={steps.length > 0}` (#1211).
3. **State model**: per-item rows (`unchecked | auto_checked |
   manually_checked | dismissed`, timestamp, source) + singleton flags
   (orientation done, section removed, sidebar-collapse state) — see
   [data-model.md](data-model.md). Seed and restore share one derivation
   routine reading actual DB state (spec FR-014).
4. **Deletion, not adaptation** ([research R7](research.md)): the full legacy
   inventory is removed in one lane; `data-guide-anchor` convention kept;
   duplicate `inbox.confirm-row` resolved to the InboxPage bulk-confirm
   control.
5. **E2E suppression replacement** ([research R8](research.md)): app-level
   suppression flag replaces the `#react-joyride-portal` CSS hack; helper
   renamed and all ~30 call sites across 7 files migrated in the same change.
6. **i18n + shared component** (R9/R10): all strings are Paraglide messages;
   one parameterised checklist component + one tokens-based CSS class family
   serves both the accordion and the collapsed-mode popover.

## Validation Plan (maps spec VC-001…VC-005)

| Contract | Vehicle | Notes |
| --- | --- | --- |
| VC-001 | Journey **J18** (`docs/journeys/`) | Authored by the journey lane; behavioral contract for done. |
| VC-002 | Playwright mock suite | Orientation walk incl. skip path, accordion semantics, spotlight dismissal matrix, persistence flags, a11y assertions. **Documented limit**: mock mode's event path is a no-op — auto-ticking is NOT validated there. |
| VC-003 | Layer-1 Rust tests | Assert the three core events publish from real use cases; subscriber writes ticks; restore-sourced events inert. First bus-subscribing Layer-1 tests — no prior art (R5). |
| VC-004 | Layer-2 tauri-driver journey (`crates/e2e-tests`) | Orientation walk → real inventory confirm → assert live auto-tick. |
| VC-005 | Coverage matrix row in `specs/037-e2e-integration-testing/contracts/coverage-matrix.md` | Row added by the validation lane; referenced as part of done. |

GitHub issue convention for validation failures: one issue per individual
failing step, referencing campaign tracker **#881**.

## Risks & Follow-ups

- **Missing milestone events** (R4): `calibration.master.registered` and a
  site-saved event do not exist; their items ship manual. Follow-up issues to
  mint those events in a later spec (no new events in v1).
- **Migration number collision** (R6): renumber 0069 at merge time if a
  parallel lane claims it; touch `crates/persistence/db/src/lib.rs` on
  Windows dev to force sqlx re-embed.
- **Joyride regression risk** (R2): version pinned; upgrade re-runs the spike
  checklist; `@floating-ui/react` headless build is the pre-approved fallback
  behind the adapter.
- **E2E churn** (R8): ~30 suppression call sites migrate atomically with the
  deletion lane to avoid a window where unrelated e2e suites flake.

## Complexity Tracking

No constitution violations to justify. The single deliberate norm exception
(modal orientation walk) is documented in the Constitution Check above and in
spec FR-002.
