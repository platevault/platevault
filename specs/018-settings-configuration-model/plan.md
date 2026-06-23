# Implementation Plan: Settings Configuration Model

**Branch**: `018-settings-configuration-model` | **Date**: 2026-05-20 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/018-settings-configuration-model/spec.md`

## Summary

*(Reconciled 2026-06-23 against as-built code on `main`.)*

Settings are workflow-grouped, one-per-line, auto-saved configuration values
that drive application behavior across data sources, ingestion, naming,
calibration, tools, catalogs, cleanup, source protection, logging, and
appearance. The backend-canonical settings store is **built and on `main`**:
persisted in the library SQLite database, exposed through a scope/values IPC
transport, and read+written through Tauri commands. The desktop wires each
settings section pane through `useAutoSave.ts` and `apps/desktop/src/api/commands.ts`.
Theme remains a separate concern with its own persistence key.

The localStorage mockup is replaced. There is no `SettingsStore` in
`crates/app/core` — domain types live in `crates/domain/core/src/settings.rs`;
the use-case layer is `crates/app/settings/src/lib.rs` (`app_core_settings`);
low-level storage is in `crates/persistence/db/src/repositories/settings.rs`;
the Tauri adapter is `apps/desktop/src-tauri/src/commands/settings.rs`.

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
**Scale/Scope**: A bounded set of v1 keys (14 flat keys + 12 absorbed keys
including structured-path patterns) plus per-source overrides keyed by source
ID.

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
├── api/commands.ts                     # settingsGet / settingsUpdate (canonical desktop binding)
├── features/settings/
│   ├── SettingsPage.tsx                # section panes, useAutoSave wiring
│   └── useAutoSave.ts                  # auto-save hook for settings section panes
└── app/theme.tsx                       # separate theme persistence (alm.theme)

apps/desktop/src-tauri/src/commands/
└── settings.rs                         # settings_get, settings_update,
                                        # settings_restore_defaults, settings_source_override_set

crates/
├── domain/core/src/settings.rs         # PatternPart, ImageTypMapping, SettingsState, SourceOverride
├── contracts/core/src/settings.rs      # re-exports domain types as contract surface (spec 042 T254)
├── app/settings/src/
│   ├── lib.rs                          # app_core_settings: get_settings, update_setting,
│   │                                   # restore_defaults, set_source_override,
│   │                                   # resolve_setting, emit_snapshot
│   └── descriptors.rs                  # DESCRIPTORS table (29 keys): key set, noisy,
│                                       # overridable, defaults, devMode cfg gate
├── persistence/db/
│   ├── migrations/0013_settings.sql    # settings + source_overrides tables
│   └── src/repositories/settings.rs   # low-level: get_raw, set_raw, load_settings,
│                                       # patterns_by_type helpers
└── audit/src/event_bus.rs              # SettingsChanged, SettingsSnapshot, SettingsRepair variants

packages/contracts/
└── schemas/                            # JSON Schemas (canonical); no settings/ mirror
```

NOTE: `apps/desktop/src/data/settings.ts` does NOT exist.
NOTE: `crates/app/core/usecases/settings.rs` does NOT exist.
NOTE: `packages/contracts/settings/` mirror was never built; canonical surface is
`crates/contracts/core` + `packages/contracts/schemas`.

**Structure Decision**: The settings model is a vertical slice spanning the desktop
edge and the Rust core. Domain types live in `domain_core`; persistence logic in the
db repository; Tauri commands are the adapter boundary. `contracts_core` re-exports
the domain types for the IPC surface. The contracts directory in this spec holds the
operation JSON Schemas.

## Architecture

### Canonical Source

`crates/app/settings/src/lib.rs` (crate `app_core_settings`, re-exported as
`app_core::settings`) is the canonical settings use-case layer. It owns:

- `get_settings` / `update_setting` (no-op guard via `settings_value_eq`,
  validation via `validate_value`, audit emission).
- `restore_defaults`, `set_source_override`, `resolve_setting`, `emit_snapshot`.
- Key metadata (key set, noisy membership, overridable membership, defaults,
  devMode cfg gate) is descriptor-driven from
  `crates/app/settings/src/descriptors.rs` (`DESCRIPTORS` table, 29 keys) — the
  SINGLE SOURCE for the key registry.

Low-level storage is in `crates/persistence/db/src/repositories/settings.rs`
(get_raw / set_raw / load_settings / patterns_by_type helpers). The Tauri adapter
is `apps/desktop/src-tauri/src/commands/settings.rs` (scope/values transport).

Domain types (`PatternPart`, `ImageTypMapping`, `SettingsState`, `SourceOverride`)
are defined in `crates/domain/core/src/settings.rs` and re-exported by
`crates/contracts/core/src/settings.rs` (spec 042 T254). There is no
`SettingsStore` type in `crates/app/core` and no `usecases/settings.rs`.

The IPC transport uses a **scope/values** model: `settings.get { scope }` returns
a flat JSON bag of all keys in that scope; `settings.update { scope, values }`
persists every key present in `values`. Empty scope = full bag.

The desktop maintains a typed in-memory snapshot fed by the initial
`settings.get` response, and applies optimistic updates locally on
`settings.update` success.

### Desktop Wiring

Settings section panes read initial values from `settingsGet` and write
changes through `useAutoSave.ts`, which dispatches `settingsUpdate` via
`apps/desktop/src/api/commands.ts`. The no-op guard runs before dispatch.
The localStorage path is replaced; `apps/desktop/src/data/settings.ts`
does not exist.

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

## Absorbed Key Special Handling

### `devMode` — compile-time gating

`devMode` release gating is **enforced** in
`crates/app/settings/src/descriptors.rs` via `#[cfg(not(feature = "dev-tools"))]`:

- **`dev-tools` build**: `devMode` is read/write; the developer surface is
  shown when `true`.
- **Release build**: `settings.get` returns `devMode: false` regardless of
  stored value; `settings.update` on `devMode` returns `value.invalid` ("devMode
  cannot be set in release builds"). The Settings UI row is hidden entirely.

The `dev-tools` Cargo feature forwards `app_core` → `app_core_settings`.
No schema migration is needed: the row may be present or absent; both are handled
uniformly.

### Absorbed keys are flat typed fields

All absorbed calibration-penalty keys and watcher configuration keys are **flat
typed fields** on `SettingsState`, not structured-path keys. Only
`tools.<tool_id>.bundle_id` remains a structured per-tool key.

### `tools.<tool_id>.bundle_id` — per-tool structured key

`tools.<tool_id>.bundle_id` is validated by looking up `<tool_id>` against
existing ToolProfile rows in `crates/workflow/profiles` before writing. An
unrecognised `<tool_id>` (no registered ToolProfile row) returns `key.unknown`.
A recognised slug with an invalid value returns `value.invalid`. (T042, open.)

### Per-frame-type override_penalty — flat fields

`calibration_dark_override_penalty`, `calibration_flat_override_penalty`, and
`calibration_bias_override_penalty` are three independent **flat typed fields**
on `SettingsState` (f64 in [0,1], default 0.3). They are NOT structured-path
keys and do not require regex validation. (T041, done.)

### Artifact watcher — flat global fields

`tool_watch_extensions` (string[]) and `tool_attribution_window_hours` (number)
are flat global fields on `SettingsState`. They replace the former per-profile
structured-path keys (`workflow_profile.<profile_id>.*`). The nonexistent
`WorkflowProfile` model is dropped. (T043, open.)

### `target_lookup.active_catalogs` — DROPPED

This key referenced the spec 014 catalog manifest, which is superseded by
spec 035 (SIMBAD resolve-on-demand). The key is not implemented and is removed
from the absorbed key set. (T039, obsolete.)

### JSON-array keys

`tool_watch_extensions` (`string[]`) and
`imagetyp_normalization_user_mappings` (`object[]`) are stored as
JSON-encoded arrays in the `settings.value` column. Deep structural equality
(R4.1) applies; element order is significant.

## Complexity Tracking

No constitution violations.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|--------------------------------------|
| (none)    |            |                                      |
