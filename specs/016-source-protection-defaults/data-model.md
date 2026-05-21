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

| Field        | Type                  | Notes                                                       |
| ------------ | --------------------- | ----------------------------------------------------------- |
| `source_id`  | `string` (uuid)       | FK to Source. Primary key.                                  |
| `level`      | `ProtectionLevel`     | Effective protection for this source.                       |
| `categories` | `array<string>`       | Optional override of protected categories for this source.  |
| `updated_at` | `timestamp`           | Audit timestamp.                                            |
| `updated_by` | `string`              | User / agent identifier.                                    |

### GlobalProtectionDefaults

Singleton row holding the global defaults used when no per-source override
exists. Mirrors the settings keys already present in the desktop mockup.

| Field                    | Type              | Default                       |
| ------------------------ | ----------------- | ----------------------------- |
| `default_level`          | `ProtectionLevel` | `protected`                   |
| `block_permanent_delete` | `boolean`         | `true`                        |
| `protected_categories`   | `array<string>`   | `["lights", "masters", "finals"]` |

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

```
resolve(source_id, category?) -> ProtectionLevel
  override = SourceProtectionState[source_id]
  if override exists:
    if category and override.categories includes category: return "protected"
    return override.level
  defaults = GlobalProtectionDefaults
  if category and defaults.protected_categories includes category:
    return "protected"
  return defaults.default_level
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
