# Data Model: Selectable Application Language

**Feature**: 061-selectable-app-language | **Date**: 2026-07-20

## Summary

**No schema change. No migration.**

This feature adds one scoped key/value row to storage that already exists. It
introduces no table, no column, and no relationship. This document exists to
record that conclusion and the evidence for it, not to describe new structure.

## Stored state

| Field | Scope | Key | Value | Default |
|---|---|---|---|---|
| Language preference | `general` | `locale` | BCP-47 tag from the shipped set (`en-GB`, `pt-BR`) | `en-GB` (base locale) |

Settings are stored as scoped key/value rows (spec 018), the same mechanism
holding `theme` and `fontSize`. A new preference is a new row value, not a
schema change — which is why no migration is required and the
[[duplicate-migration-version-collision]] hazard does not apply here.

## The registration requirement

The absence of a migration does **not** mean the backend is untouched. Writes
are filtered against a key allowlist:

```rust
// apps/desktop/src-tauri/src/commands/settings.rs
if !app_core::settings::is_valid_key(&key) {
    tracing::debug!("settings.update: skipping unknown key {key}");
    continue;              // ← caller still receives Ok
}
```

`locale` must be registered in `crates/app/settings/src/keys.rs` (T001) or
every write is discarded while reporting success. See research D8.

## Validation

- **Accepted**: a BCP-47 tag present in the shipped locale set.
- **Rejected**: any other value. A tag that was valid in a previous release but
  is no longer shipped fails validation on write; on *read*, an unrecognised
  stored value falls back to the base locale rather than failing startup
  (FR-009, SC-007).

## Derived, not stored

The following are computed from the locale tag and are deliberately **not**
persisted, so that adding a locale never requires a data change:

- native display name (`Português (Brasil)`)
- flag
- accessible name (derived from the native name, not the flag — research D6)

## Non-durable mirror

`localStorage` holds a copy of the locale tag purely to answer Paraglide's
synchronous `getLocale()` before IPC is available (research D3). It is a cache,
not a record: on disagreement the settings DB wins and the mirror is corrected.
It carries no data the DB does not, and losing it costs only one frame of base
locale at startup.
