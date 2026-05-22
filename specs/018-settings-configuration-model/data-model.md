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
| `rememberFollowLogs`      | `boolean`                                  | Application Log    | Remember follow       | Whether the follow-tail toggle persists across restarts. See absorbed keys table for updated default. |
| `defaultProtection`       | `"protected" \| "normal" \| "unprotected"` | Source Protection  | Default protection    | Overridable per source.                                               |
| `blockPermanentDelete`    | `boolean`                                  | Source Protection  | Block permanent delete| Routes destructive operations to archive/trash workflows.             |
| `protectedCategories`     | `string[]`                                 | Source Protection  | Protected categories  | Array of category strings. Noisy. (R-Set-1)                          |

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
| `rememberFollowLogs`      | `false` (amended from `true` per spec 019 E-019-3)                                                       |
| `defaultProtection`       | `"protected"`                                                                                            |
| `blockPermanentDelete`    | `true`                                                                                                   |
| `protectedCategories`     | `["lights", "masters", "finals"]`                                                                        |

### Absorbed Keys (2026-05-22 ripple absorption)

Keys absorbed from cross-spec ratification passes. Structured-path keys use
dot notation; `<tool_id>` and `<profile_id>` are runtime-defined slugs
matching `[a-z0-9_]+`.

| Key | Type | Default | Overridable per source? | Description | Noisy? |
|-----|------|---------|------------------------|-------------|--------|
| `current_library_id` | `string?` (uuid) | `null` | No | Currently-open library id; drives `?lib=` URL injection (spec 020 R-Lib-V1). | No |
| `devMode` | `boolean` | `false` | No | Runtime developer-mode toggle. Only meaningful in `dev-tools` builds; read-only/hidden in release. | No |
| `plans.list.default_age_cutoff_days` | `number` | `90` | No | UI hides terminal plans older than this; `0` = show all (spec 017 R-Ret-1). | Yes |
| `rememberFollowLogs` | `boolean` | `false` | No | Persists log viewer "follow tail" state across restarts (spec 019 E-019-3). | Yes |
| `target_lookup.active_catalogs` | `string[]` | all 13 v1 catalog ids | No | Active catalog set for `target.lookup`; user may disable specific catalogs (spec 013 R-2.2). | No |
| `calibration.dark_temp_tolerance` | `number` (°C) | `2.0` | No | Dark frame temperature matching tolerance (spec 007 A5). | No |
| `calibration.dark.override_penalty` | `number` [0,1] | `0.3` | No | Confidence penalty when user overrides dark calibration suggestion (spec 007 R-OverridePenalty). | No |
| `calibration.flat.override_penalty` | `number` [0,1] | `0.3` | No | Confidence penalty when user overrides flat calibration suggestion (spec 007 R-OverridePenalty). | No |
| `calibration.bias.override_penalty` | `number` [0,1] | `0.3` | No | Confidence penalty when user overrides bias calibration suggestion (spec 007 R-OverridePenalty). | No |
| `calibration.prefill_suggestion` | `boolean` | `true` | No | Open assign dialog pre-filled with top candidate; user must confirm (spec 007 R-Prefill). | No |
| `tools.<tool_id>.bundle_id` | `string?` | `null` (seeded for known tools) | No | Per-tool macOS bundle id for `open -b` launching; user-editable (spec 011 R-BundleId). | No |
| `workflow_profile.<profile_id>.watch_extensions` | `string[]` | see below | No | Per-profile file extension allow-list for the artifact watcher (spec 012 R-ExtAllow). | No |
| `workflow_profile.<profile_id>.launch_attribution_window_hours` | `number` | `6` | No | Per-profile attribution window for matching artifacts to tool launches (spec 012 C3). | No |
| `imagetyp_normalization.user_mappings` | `Array<{imagetyp_string: string, frame_type: FrameType}>` | `[]` | No | User-extensible IMAGETYP normalization entries for niche capture software (spec 005 R-IMAGETYP-Norm). | No |

**Default for `workflow_profile.<profile_id>.watch_extensions`**: `[".xisf", ".fits", ".fit", ".tif", ".tiff", ".png", ".jpg", ".ser", ".avi"]`

**Seed values for `tools.<tool_id>.bundle_id`** (stored only when tool is registered):
- `tools.pixinsight.bundle_id`: `"com.pixinsight.PixInsight"`
- `tools.siril.bundle_id`: `"org.siril.Siril"`

### Noisy Keys

`pattern`, `protectedCategories`, `plans.list.default_age_cutoff_days`,
`rememberFollowLogs`. Persisted on every change; audited as a snapshot rather
than per-change. See `research.md` R4. `plans.list.default_age_cutoff_days`
is noisy because users may sweep the slider frequently; `rememberFollowLogs`
is a toggle that changes on each session open but requires no discrete audit.

### Overridable Keys

`followSymlinks`, `hashOnScan`, `defaultProtection`. All other keys are
global-only in v1; attempts to override return `key.unoverridable`.
(`autoApplyPattern` was removed from the overridable set — A2.)

None of the newly absorbed keys are overridable per source. Structured-path
keys (`tools.*`, `workflow_profile.*`) encode their scope in their key path
and are not subject to the per-source override mechanism.

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
