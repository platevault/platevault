# Implementation Plan: Selectable Application Language

**Branch**: `061-selectable-app-language` | **Date**: 2026-07-20
**Spec**: [spec.md](./spec.md) | **Research**: [research.md](./research.md)

## Summary

Turn the interface language from a build-time constant into a persisted user
preference, and ship a second locale. Three layers change: the Paraglide
compiler strategy and a locale provider in the frontend, a settings-key
registration in the Rust backend, and two pieces of UI (a wizard first step and
a settings control). The message catalog gains `pt-BR.json`.

## Technical Context

**Language/Version**: TypeScript 5.x / React 19; Rust (Tauri v2)
**Primary dependencies**: `@inlang/paraglide-js` ^2.21.0 (already present)
**Storage**: settings DB, `general` scope (spec 018); localStorage mirror
**Testing**: vitest (unit), Layer-1 `cargo test` (real backend), Layer-2
`tauri-driver` E2E
**Target**: Tauri desktop — Windows, Linux, macOS
**Project type**: monorepo, Tauri + React desktop shell

## Constitution Check

| Principle | Assessment |
|---|---|
| I. Local-First File Custody | Not engaged — no image files touched. |
| II. Reviewable Filesystem Mutation | Not engaged — no filesystem plans. |
| III. PixInsight Boundary | Not engaged — no processing. |
| IV. Research-Led Domain Modeling | **Satisfied** — the strategy chain, no-reload behaviour, persistence split, and grammatical-divergence mechanism are each a documented decision with rejected alternatives (research.md D1–D8). |
| V. Portable Contracts | **Satisfied** — no new IPC command. Reuses `settings_update`/`settings_get` with an added key; contract shape unchanged. |

No new dependencies. No violations. Re-check after Phase 1 design: unchanged.

## Architecture

```
┌─ vite.config.ts ──────────────────────────────────────────────────┐
│ strategy: ["custom-almSettings","preferredLanguage","baseLocale"] │
└──────────────────────────┬────────────────────────────────────────┘
                           │ compiles messages/{en,pt-BR}.json
┌──────────────────────────▼───────────────────────────────────────┐
│ locale provider (React)                                          │
│  · defineCustomClientStrategy("custom-almSettings")              │
│      getLocale()  → localStorage mirror        (SYNC)            │
│      setLocale()  → settings DB + mirror       (async)           │
│  · setLocale(next, { reload: false }) then re-render subtree     │
│  · hydrate from settings DB on mount; DB wins on disagreement    │
└───────┬──────────────────────────────────┬───────────────────────┘
        │                                  │
┌───────▼──────────────────┐    ┌──────────▼────────────────────┐
│ Wizard step 1 (FR-005)   │    │ Settings → Appearance (FR-006)│
│ scrollable card panel    │    │ same control, pane styling    │
│ flag + native name       │    │ flag + native name            │
└──────────────────────────┘    └───────────────────────────────┘
                    │
┌───────────────────▼──────────────────────────────────────────────┐
│ Rust: keys.rs — register `locale` descriptor (D8)                │
│ WITHOUT THIS the write silently no-ops and returns Ok            │
└──────────────────────────────────────────────────────────────────┘
```

## Phasing

Ordered so the silent-failure risk is eliminated before any UI depends on it.

### Phase 0 — Backend key registration *(prerequisite)*

Register the `locale` descriptor and prove round-trip persistence with a
Layer-1 test. This is first because D8's failure mode is invisible from the
frontend: `settings_update` returns `Ok` for an unregistered key. Any UI built
before this would appear to work and lose the preference on restart.

**Exit**: a Layer-1 test writes `locale`, reopens the store, and reads it back.

### Phase 1 — Locale runtime

Switch the compiler strategy, add `pt-BR` to `project.inlang/settings.json`,
implement the custom strategy and the provider, and wire live re-render via
`{ reload: false }`.

**Exit**: locale changes re-render without reload; choice survives restart;
`preferredLanguage` selects pt-BR on a Portuguese OS with no stored preference.

### Phase 2 — Settings control (US2)

Add the language control to Settings → Appearance, matching the existing
theme/density controls.

**Exit**: US2 acceptance scenarios pass; J10 amended.

### Phase 3 — Wizard first step (US1)

Insert the language step ahead of every existing wizard step, as a scrollable
keyboard-navigable card panel.

**Exit**: US1 acceptance scenarios pass; J01 amended.

### Phase 4 — pt-BR catalog (US3)

Translate 1856 keys, including plural forms for the 30 `{count}` keys and
context-correct divergence for the shared-value keys (`Archive` verb vs state).
Label as machine-generated pending native review (FR-013).

**Exit**: no raw keys or gaps in either locale; counts correct at 0/1/many.

### Phase 5 — Drift guard

CI check comparing key sets across locales, **reporting** the gap rather than
failing (D5 — FR-013 accepts partial translation as a shipping state).

## Testing Strategy

Per the repo's real-stack rule:

| Layer | Covers |
|---|---|
| Layer 1 (`cargo test`) | `locale` key round-trips through the real settings DB (Phase 0 gate) |
| Unit (vitest) | strategy resolution order; DB-wins-over-mirror reconciliation; fallback to base locale for a missing key |
| Layer 2 (`tauri-driver`) | choose language in wizard → subsequent steps render translated; change in Settings → live re-render; **restart → choice survives** (SC-002) |

The restart assertion is the one that matters most — it is the only check that
catches D8, and it cannot be faked in mock mode.

Coverage matrix (`specs/037-e2e-integration-testing/contracts/coverage-matrix.md`)
gains a row for this feature; the 046 row is updated from single-locale to
multi-locale.

## Risks

| Risk | Mitigation |
|---|---|
| **Unregistered settings key silently discards the choice** (D8) | Phase 0 ordering + Layer-1 round-trip test before any UI |
| `setLocale` default reload discards session state on a Settings-initiated change (D2) | `{ reload: false }` mandatory; Layer-2 asserts scroll/panel/unsaved state survives a language change made from Settings |
| Machine translations read as native-reviewed | FR-013 labelling; drift-report in CI |
| Translated strings overflow layouts | pt-BR is frequently longer than English; check the 1100×720 layout convention |
| Windows E2E shards share one localStorage | Tests must not assume mirror isolation |

## Journeys

- **J01** (first-run setup) — new first step; existing step numbering shifts.
- **J10** (settings/appearance/i18n) — new language control; the "fully
  localized" claim moves from *no hardcoded strings* to *translated into a
  chosen language*.

Both amended in their phases, not up front — amending before the control's
behaviour is fixed would only mean rewriting them.
