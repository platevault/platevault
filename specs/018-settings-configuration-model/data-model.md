# Data Model: Settings Configuration Model

## SettingsState v1

The canonical bag of v1 settings. Stored under storage key `alm.settings.v1`
in localStorage today, and intended to migrate to a SQLite `settings` table
in which each field below maps to one row keyed by field name.

### Field Table

| Key                       | Type                                       | Section            | Section Title         | Notes                                                                 |
|---------------------------|--------------------------------------------|--------------------|-----------------------|-----------------------------------------------------------------------|
| `pattern`                 | `PatternPart[]`                            | Naming & Structure | Project folder        | Structured token list, not a string. Noisy.                           |
| `autoApplyPattern`        | `boolean`                                  | Naming & Structure | Auto-apply pattern    | Whether new projects adopt the pattern without confirmation.          |
| `alwaysPreviewBeforePlan` | `boolean`                                  | Ingestion & Review | Preview before plan   | Forces a preview step before any filesystem plan is generated.        |
| `followSymlinks`          | `boolean`                                  | Data Sources       | Follow symlinks       | Off by default per constitution. Overridable per source.              |
| `hashOnScan`              | `"lazy" \| "eager" \| "off"`               | Data Sources       | Hash on scan          | Overridable per source.                                               |
| `darkMatchTolerance`      | `"strict" \| "loose" \| "any"`             | Calibration        | Dark match            | Per calibration frame type (dark).                                    |
| `flatMatching`            | `"filter-rot" \| "filter" \| "manual"`     | Calibration        | Flat match            | Per calibration frame type (flat).                                    |
| `suggestCalibration`      | `boolean`                                  | Calibration        | Suggest calibration   | Whether to surface calibration suggestions.                           |
| `rowDensity`              | `"dense" \| "comfortable"`                 | Advanced           | Row density (mockup)  | FR-006 says density is fixed; key retained for mockup until removed.  |
| `logLevel`                | `"error" \| "warn" \| "info" \| "debug"`   | Application Log    | Log level             |                                                                       |
| `rememberFollowLogs`      | `boolean`                                  | Application Log    | Remember follow       | Whether the log auto-scrolls on new entries.                          |
| `defaultProtection`       | `"protected" \| "normal" \| "unprotected"` | Source Protection  | Default protection    | Overridable per source.                                               |
| `blockPermanentDelete`    | `boolean`                                  | Source Protection  | Block permanent delete| Routes destructive operations to archive/trash workflows.             |
| `protectedCategories`     | `string`                                   | Source Protection  | Protected categories  | Comma-separated; parsed at use site. Noisy.                           |

### Defaults

| Key                       | Default                                                                                                  |
|---------------------------|----------------------------------------------------------------------------------------------------------|
| `pattern`                 | `[{target}, /, {filter}, /, {date}, /, {frame_type}, /]`                                                 |
| `autoApplyPattern`        | `true`                                                                                                   |
| `alwaysPreviewBeforePlan` | `false`                                                                                                  |
| `followSymlinks`          | `false`                                                                                                  |
| `hashOnScan`              | `"lazy"`                                                                                                 |
| `darkMatchTolerance`      | `"strict"`                                                                                               |
| `flatMatching`            | `"filter-rot"`                                                                                           |
| `suggestCalibration`      | `true`                                                                                                   |
| `rowDensity`              | `"dense"`                                                                                                |
| `logLevel`                | `"info"`                                                                                                 |
| `rememberFollowLogs`      | `true`                                                                                                   |
| `defaultProtection`       | `"protected"`                                                                                            |
| `blockPermanentDelete`    | `true`                                                                                                   |
| `protectedCategories`     | `"lights, masters, finals"`                                                                              |

### Noisy Keys

`pattern`, `protectedCategories`. Persisted on every change; audited as a
snapshot rather than per-change. See `research.md` R4.

### Overridable Keys

`followSymlinks`, `hashOnScan`, `autoApplyPattern`, `defaultProtection`. All
other keys are global-only in v1; attempts to override return
`key.unoverridable`.

## SourceOverride

A per-source override of an overridable settings key.

| Field       | Type     | Notes                                                                |
|-------------|----------|----------------------------------------------------------------------|
| `source_id` | `string` | Identifier of the data source (root) the override applies to.        |
| `key`       | `string` | Must be one of the overridable keys.                                 |
| `value`     | `JSON`   | Must validate against the same JSON Schema as the global key value.  |
| `updated_at`| `string` | ISO-8601 timestamp set by the store on write.                        |

Resolution order is per-source override → global setting → in-code default
(`research.md` R6).

## Theme (separate)

Theme persists separately and is intentionally not part of `SettingsState`.

| Field  | Type                                | Storage                                 |
|--------|-------------------------------------|-----------------------------------------|
| `mode` | `"system" \| "light" \| "dark"`      | localStorage key `alm.theme`            |

Theme changes do not appear in the settings audit stream and do not
participate in `settings.get`, `settings.update`, or
`settings.restore-defaults`.

## Pattern Part

`PatternPart` is the token-builder fragment used by `pattern`.

| Field   | Type                          | Notes                                                  |
|---------|-------------------------------|--------------------------------------------------------|
| `id`    | `string`                      | Stable identifier for drag-reorder.                    |
| `kind`  | `"token" \| "separator"`     | Token resolves at materialization; separator is literal.|
| `value` | `string`                      | Token name or literal separator character.             |

## Audit Event (settings shape)

| Field          | Type     | Notes                                                          |
|----------------|----------|----------------------------------------------------------------|
| `source`       | `string` | Always `"settings"`.                                           |
| `level`        | `string` | `"info"` for changes; `"warn"` for schema repairs.             |
| `key`          | `string` | Settings key affected (omitted for snapshot events).           |
| `prior_value`  | `JSON`   | Previous value (omitted for snapshot events).                  |
| `new_value`    | `JSON`   | New value (omitted for snapshot events).                       |
| `snapshot`     | `JSON?`  | Noisy-key snapshot at session boundaries.                      |
| `at`           | `string` | ISO-8601 timestamp.                                            |
