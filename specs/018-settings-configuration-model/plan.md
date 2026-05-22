# Implementation Plan: Settings Configuration Model

**Branch**: `018-settings-configuration-model` | **Date**: 2026-05-20 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/018-settings-configuration-model/spec.md`

## Summary

Settings are workflow-grouped, one-per-line, auto-saved configuration values
that drive application behavior across data sources, ingestion, naming,
calibration, tools, catalogs, cleanup, source protection, logging, and
appearance. The implementation today is a desktop-side mockup wired to
localStorage. The plan promotes the mockup to a backend-canonical settings
store: a single `SettingsStore` value type owned by `crates/app/core`, persisted
in the library SQLite database, exposed through versioned JSON contracts, and
read+written through Tauri commands. The desktop continues to wire each
SettingsPage row through `useSettings()` and a typed `updateSettings(key, value)`
mutator. Theme remains a separate concern with its own persistence key.

## Technical Context

**Language/Version**: Rust 1.75+ (backend), TypeScript 5.x (desktop)
**Primary Dependencies**: Tauri (desktop adapter), `crates/app/core`,
`crates/persistence/db` (SQLite), `crates/audit`, `crates/contracts/core`
**Storage**: SQLite settings table in the library database; theme persists
separately in browser localStorage under `alm.theme`.
**Testing**: `cargo test --workspace` for use-case and contract round-tripping;
desktop unit tests for the settings hook and the no-op guard; contract tests
using `packages/contracts` JSON Schemas.
**Target Platform**: Desktop (Tauri on Windows/macOS/Linux).
**Project Type**: Desktop application with a layered Rust core.
**Performance Goals**: Settings reads must not block UI render (cached in
desktop store); single-key writes complete in <50ms p95 against a cold SQLite.
**Constraints**: Single-window application; no cross-tab coordination required
in v1. Audit log must not amplify noisy keys.
**Scale/Scope**: A bounded set of v1 keys (14 today) plus per-source overrides
keyed by source ID.

## Constitution Check

- **Local-first file custody**: PASS. Settings drive but never own image files.
  Library roots remain modeled separately.
- **Reviewable filesystem mutation**: PASS. Settings changes are not filesystem
  mutations; destructive defaults (`blockPermanentDelete`,
  `defaultProtection`, `protectedCategories`) feed reviewable plans elsewhere
  rather than triggering writes.
- **PixInsight boundary**: PASS. Calibration matching settings configure how
  Astro suggests inputs to PixInsight; they do not run calibration here.
- **Research-led domain modeling**: PASS. Persistence shape, migration
  strategy, audit policy, and override resolution are research questions in
  `research.md` rather than assumed.
- **Portable contracts and durable records**: PASS. The four operations are
  defined as language-neutral JSON Schemas under `contracts/` and versioned via
  the `v1` storage key. SQLite is the durable record; the desktop snapshot is
  a derived cache.
- **Cross-platform path safety**: N/A for the settings model itself; the
  `pattern` value is a structured token list, not a string, so platform path
  rules are enforced where patterns are materialized, not where they are
  stored.

## Project Structure

### Documentation (this feature)

```text
specs/018-settings-configuration-model/
├── plan.md
├── research.md
├── data-model.md
├── contracts/
│   ├── settings.get.json
│   ├── settings.update.json
│   ├── settings.restore-defaults.json
│   └── settings.source-override.set.json
└── tasks.md
```

### Source Code (repository root)

```text
apps/desktop/src/
├── data/settings.ts              # SettingsState, useSettings(), updateSettings()
├── features/settings/SettingsPage.tsx
└── app/theme.tsx                 # separate theme persistence (alm.theme)

crates/
├── app/core/usecases/settings.rs # future: get / update / restore / set_override
├── persistence/db/               # future: settings + source_overrides tables, migrations
├── audit/                        # future: settings change events
└── contracts/core/               # future: Rust DTOs for settings contracts

packages/contracts/
└── settings/                     # JSON Schemas mirrored from specs/.../contracts/
```

**Structure Decision**: The settings model is a vertical slice that spans the
desktop edge and the Rust core. The desktop hook stays the user-facing API.
The Rust use-case crate becomes the canonical writer once Tauri-bound. The
contracts directory is the boundary that decouples them.

## Architecture

### Canonical Source

`SettingsStore` (Rust, `crates/app/core/usecases/settings.rs`) is the canonical
source of settings values once persistence lands. It owns:

- Loading the row set from SQLite on startup, hydrating defaults for missing
  keys.
- Validating an incoming `(key, value)` pair against the v1 JSON Schema.
- Writing the change inside a transaction with an `audit` event for non-noisy
  keys.
- Returning `prior_value`, `new_value`, and an optional `audit_id`.

The desktop maintains a typed in-memory snapshot fed by the initial
`settings.get` response, and applies optimistic updates locally on
`settings.update` success.

### Desktop Wiring

`SettingsPage.tsx` reads through `useSettings()` and writes through
`updateSettings(key, value)`. Today this hook talks to localStorage; once the
Tauri adapter is in place, `updateSettings` dispatches the
`settings.update` command and applies the returned `new_value` back into the
local store on success. The no-op guard runs both before and after dispatch
to keep behavior identical when offline.

### Persistence (Future, Replaces localStorage)

A `settings` table holds `(key TEXT PRIMARY KEY, value JSON, updated_at)`. A
`source_overrides` table holds `(source_id TEXT, key TEXT, value JSON,
updated_at, PRIMARY KEY(source_id, key))`. Defaults are not stored; missing
rows are hydrated from the in-code default table at read time. This keeps
default churn cheap and audit-free.

### Schema Versioning

The storage key (`alm.settings.v1`) embeds the schema version. The SQLite
schema versions globally; key-level schema versioning is intentionally not
adopted because version-coupled migrations are simpler at the table grain.
Reads against a stored payload with an unknown key drop the unknown key and
emit one `warn`-level audit entry. Reads against a known key with an invalid
value reset that key to its default and emit one `warn`-level audit entry.

### Audit Policy

Every successful update of a non-noisy key creates one `audit` event with
`source = "settings"`, `level = "info"`, the key, the prior value, and the new
value. `pattern` and `protectedCategories` are noisy and do not generate
per-change audit entries; instead, a `settings.snapshot` audit event captures
their state at:

1. **Session start** — on library open.
2. **Debounced inactivity (R-Aud-1)** — after any noisy-key write, a 5-minute
   inactivity debounce emits one `settings.snapshot` once quiet. The timer
   resets on each noisy write and fires exactly once. The "page close" trigger
   is dropped in favour of this debounce. Timer state is per-session and is
   cancelled on library close.

Restoring defaults emits one `audit` event per restored key (for keys where
the value actually changed; already-at-default keys emit no event — R-3.1).

T017 and T020 implementation notes: provision a debounce timer in the
use-case; test reset-on-write and fire-once-on-quiet behaviour.

### Default Restore

`settings.restore-defaults` with an empty `keys` array restores every key.
With a non-empty array, only the listed keys are restored. Restoring a key
issues an update through the same code path as `settings.update` so that
audit, no-op guard, and validation behavior are uniform.

### Theme

Theme persistence remains in `apps/desktop/src/app/theme.tsx` under the
`alm.theme` localStorage key. Reasons: it is read on first paint before the
backend channel is ready; it is per-device rather than per-library; it must
not block on Tauri startup; and it should not pollute the settings audit
stream. The Appearance section in Settings reads/writes through the theme
module, not through `useSettings()`.

## Complexity Tracking

No constitution violations.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|--------------------------------------|
| (none)    |            |                                      |
