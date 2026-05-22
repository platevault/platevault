# Data Model: Source Protection Defaults

**Branch**: `016-source-protection-defaults` | **Date**: 2026-05-20

## Enums

### ProtectionLevel

```
ProtectionLevel ::= "protected" | "normal" | "unprotected"
```

- `protected`: destructive plan items require explicit acknowledgement; permanent
  delete is rewritten to archive when `block_permanent_delete` is enabled.
- `normal`: standard plan review applies; no extra acknowledgement gate.
- `unprotected`: advanced-mode plan items; destructive actions emitted without
  additional gating beyond plan review.

## Entities

### SourceProtectionState

Per-source override of protection policy. Absence means the source inherits
the global default.

| Field                   | Type                  | Notes                                                                           |
| ----------------------- | --------------------- | ------------------------------------------------------------------------------- |
| `source_id`             | `string` (uuid)       | FK to Source. Primary key.                                                      |
| `level`                 | `ProtectionLevel`     | Effective protection for this source.                                           |
| `block_permanent_delete`| `bool?`               | null = inherit global `block_permanent_delete`; true/false = explicit per-source override (A2). |
| `categories`            | `array<string>`       | Optional override of protected categories for this source.                      |
| `updated_at`            | `timestamp`           | Audit timestamp.                                                                |
| `updated_by`            | `string`              | User / agent identifier.                                                        |

### GlobalProtectionDefaults

Singleton row holding the global defaults used when no per-source override
exists. Mirrors the settings keys already present in the desktop mockup.

| Field                    | Type              | Default                       |
| ------------------------ | ----------------- | ----------------------------- |
| `default_level`          | `ProtectionLevel` | `protected`                   |
| `block_permanent_delete` | `boolean`         | `true`                        |
| `protected_categories`   | `array<string>`   | `["lights", "masters", "finals"]` |

**Hard-coded fallback values (A3)**: If the `GlobalProtectionDefaults` row is
absent from the database (e.g. first run before migration completes), the
resolver uses hard-coded in-code defaults:
- `level: "protected"`
- `block_permanent_delete: true`
- `protected_categories: ["lights", "masters", "finals"]`

These values are also the seed values for the migration that creates the
`GlobalProtectionDefaults` row.

**`protected_categories` storage (A4)**: Stored as a JSON-encoded
`array<string>` in SQLite. The UI presents and parses this as a
comma-separated string (e.g. `"lights, masters, finals"`). Whitespace is
trimmed; empty tokens are ignored.

### ProtectedPlanItem (projection)

Computed on plan generation; not persisted as its own table — it is a tagged
plan item from `crates/fs/planner/`.

| Field                       | Type              | Notes                                              |
| --------------------------- | ----------------- | -------------------------------------------------- |
| `item_id`                   | `string` (uuid)   | Plan item identifier.                              |
| `source_id`                 | `string` (uuid)   | Resolved source.                                   |
| `resolved_level`            | `ProtectionLevel` | Output of the protection resolver.                 |
| `matched_categories`        | `array<string>`   | Categories that triggered protection, if any.      |
| `requires_acknowledgement`  | `boolean`         | True when `resolved_level == "protected"`.          |
| `original_action`           | `string`          | E.g. `delete`, `archive`, `move`.                   |
| `rewritten_action`          | `string \| null`  | E.g. `archive` when delete was rewritten.           |
| `reason`                    | `string`          | Human-readable explanation for the review UI.       |

## Resolver

**Precedence rule (A1)**: When a per-source override row exists, it wins
unconditionally. Categories elevate the level ONLY when NO override row exists.

```
resolve(source_id, category?) -> ProtectionLevel
  override = SourceProtectionState[source_id]
  if override exists:
    return override.level          // override wins; categories are NOT checked
  defaults = GlobalProtectionDefaults (or hard-coded fallback if row absent)
  if category and defaults.protected_categories includes category:
    return "protected"
  return defaults.default_level
```

**`block_permanent_delete` resolution (A2)**:

```
resolve_block_permanent_delete(source_id) -> bool
  override = SourceProtectionState[source_id]
  if override exists and override.block_permanent_delete is not null:
    return override.block_permanent_delete
  defaults = GlobalProtectionDefaults (or hard-coded fallback)
  return defaults.block_permanent_delete
```

## Defaults Table

| Source kind (from spec 008) | Default level | Notes                                |
| --------------------------- | ------------- | ------------------------------------ |
| Inbox                       | `normal`      | Moves into Inventory are expected.   |
| Inventory                   | `protected`   | Curated material; archive over delete. |
| Calibration store           | `protected`   | Masters are expensive to re-derive.  |
| Project source              | `protected`   | Contains user artistic outputs.      |
| Externally owned            | `protected`   | App is a guest on these roots.       |

These defaults seed `SourceProtectionState` rows when a source is first added;
the user can override per source from the settings UI.

## Audit Events

| Event                          | Payload                                                       |
| ------------------------------ | ------------------------------------------------------------- |
| `protection.default.changed`   | `{field, prior_value, new_value}`                             |
| `protection.source.set`        | `{source_id, prior_level, new_level, prior_categories?, new_categories?}` |
| `protection.plan.acknowledged` | `{plan_id, item_id, source_id, resolved_level, reason}`       |
