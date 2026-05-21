# Data Model: Target Identity, History, And Notes

**Spec**: 023-target-identity-history-notes | **Date**: 2026-05-20

## Target

```
Target {
  id:            Uuid                  // stable identifier
  primary:       String                // canonical display name (e.g. "M 31")
  aliases:       String[]              // user nicknames + normalized variants
  catalog_refs:  CatalogRef[]          // structured catalog identifiers
  notes?:        String                // per-target free text (R4)
  created_at:    Timestamp
  updated_at:    Timestamp             // bumped on any field change
}
```

```
CatalogRef {
  catalog:      String                 // e.g. "Messier", "NGC", "IC", "Sh2"
  designation:  String                 // e.g. "31", "224", "1396"
}
```

### Invariants

- `primary` is non-empty; trimmed; unique within the targets table.
- `aliases[*]` is normalized (R2): trimmed, internal whitespace collapsed,
  compared case-insensitively. The stored form preserves user casing for
  display.
- A normalized alias appears on at most one target. Re-adding the same alias
  to its current target is a no-op success; adding it to a different target
  returns `alias.duplicate`.
- `catalog_refs[*]` is unique on `(catalog, designation)` per target.
- `notes` is optional; absence and empty string are equivalent.
- `updated_at >= created_at`.

## TargetSession (join view)

A read-only projection joining `sessions` to `targets` for the history list.

```
TargetSession {
  session_id:    Uuid
  captured_on:   Date                  // night of acquisition (R3)
  filter?:       String
  exposure?:     String                // e.g. "300s x 24"
  frames?:       u32
  inventory_id:  Uuid                  // deep link target
}
```

Ordered reverse-chronologically by `captured_on`.

## TargetProject (join view)

A read-only projection joining `projects` to `targets`.

```
TargetProject {
  project_id:    Uuid
  name:          String
  lifecycle:     ProjectLifecycle      // re-uses spec 009 enum
  tool:          ProcessingTool
}
```

## History Aggregate (returned by `target.get`)

```
TargetDetail {
  target:    Target
  sessions:  TargetSession[]           // ordered desc by captured_on
  projects:  TargetProject[]           // ordered by lifecycle then name
}
```

## Storage Notes

- Persisted by `crates/persistence/db`. Table sketch:
  - `target(id, primary, notes, created_at, updated_at)`
  - `target_alias(target_id, alias_normalized, alias_display)` with UNIQUE
    on `alias_normalized`.
  - `target_catalog_ref(target_id, catalog, designation)` with UNIQUE on
    `(target_id, catalog, designation)`.
- `sessions.target_id` (FK to `target.id`) is set by spec 013 confirmation.
- `projects.target_id` (FK to `target.id`) is set when a project is created
  against a target or when a source resolves to one.
- Indexes: `target_alias.alias_normalized` (lookup for Cmd+K and conflict
  check), `sessions.target_id + captured_on DESC` (history view),
  `projects.target_id` (projects-per-target view).

## Derived Names

- Cmd+K matches both `primary` and any `alias_normalized` row.
- Target chip on Inventory and Project rows renders `primary`.
