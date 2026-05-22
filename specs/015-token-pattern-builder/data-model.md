# Data Model: Token Pattern Builder

**Feature**: `015-token-pattern-builder`

## Entities

### PatternPart

The atomic unit of a pattern.

| Field   | Type                       | Notes                                                   |
|---------|----------------------------|---------------------------------------------------------|
| `id`    | string                     | Stable client-side identifier. Used for keyed re-render and remove operations. Not persisted as semantic. |
| `kind`  | enum `"token" \| "separator"` | Discriminator.                                       |
| `value` | string                     | For `token`: a token name from the registry. For `separator`: a literal from the allowed separator set. |

Invariants:

- `kind = "token"` ⇒ `value` MUST be a registered token name.
- `kind = "separator"` ⇒ `value` MUST be one of `/`, `-`, `_`, ` `.
- `id` MUST be unique within a single `Pattern`.

### Pattern

`Pattern = PatternPart[]`. An ordered list. No nesting, no branching.

Invariants:

- A pattern MAY be empty in storage but MUST NOT be empty when used to
  resolve a destination — the resolver rejects empty patterns.

### TokenDefinition

Describes one token in the registry.

| Field          | Type   | Notes                                                                                       |
|----------------|--------|---------------------------------------------------------------------------------------------|
| `name`         | string | Token identifier (e.g. `target`).                                                           |
| `source_field` | string | Name of the field in the metadata bundle the token reads from (often equal to `name`).      |
| `fallback`     | string | Default value emitted when the source field is absent or sanitizes to empty.                |
| `transform`    | enum   | `none \| date_iso \| upper \| lower \| sanitize_only`. Applied after sanitization.          |

### TokenRegistry (v1)

| Token        | source_field      | fallback           | transform   |
|--------------|-------------------|--------------------|-------------|
| `target`     | `target`          | `unclassified`     | sanitize_only |
| `filter`     | `filter`          | `nofilter`         | sanitize_only |
| `date`       | `date_obs_local`  | `undated`          | date_iso    |
| `frame_type` | `frame_type`      | `unknown`          | lower       |
| `camera`     | `camera`          | `unknown-camera`   | sanitize_only |
| `exposure`   | `exposure`        | `unknown-exposure` | sanitize_only |
| `gain`       | `gain`            | `unknown-gain`     | sanitize_only |
| `binning`    | `binning`         | `1x1`              | sanitize_only |
| `set_temp`   | `set_temp`        | `untempered`       | sanitize_only |

**Note on `date` source field**: `date_obs_local` is the local date computed
from `exposure_start` in `AcquisitionSession.observer_location.tz` using the
solar-noon boundary rule (spec 023). When observer_location is unset the
caller substitutes the UTC date and includes `"date"` in the `missing_tokens`
array. (Ref: R-Date-1)

### MetadataBundle

A flat map keyed by `source_field`. Values are strings; absent keys imply
fallback substitution.

`frame_type` values in the bundle MUST be from the closed enum:
`["light", "dark", "flat", "bias", "dark_flat"]` (lowercase). `mixed` is
NOT a valid `frame_type` in a MetadataBundle; it is a folder-level
classification result, not a per-file property. (Ref: R-FrameEnum)

### ResolveResult

| Field             | Type     | Notes                                                                              |
|-------------------|----------|------------------------------------------------------------------------------------|
| `relative_path`   | string   | Forward-slash relative path. Never starts with a drive letter or root anchor.      |
| `missing_tokens`  | string[] | Names of tokens that were resolved via fallback.                                   |

### ValidateResult

| Field      | Type     | Notes                                                                                |
|------------|----------|--------------------------------------------------------------------------------------|
| `valid`    | bool     | False iff a structural error (empty, unknown token) is present.                      |
| `warnings` | string[] | Codes: `consecutive_separators`, `leading_separator`, `no_path_separator`, `trailing_separator`. |

### Fallback Table

Authoritative copy lives in `research.md` (R3). The data model references it
by token name; the registry above mirrors the same values.

## Persistence

- The library default pattern is stored as a `PatternPart[]` on the settings
  record (current localStorage shape on the desktop; future SQLite settings
  table).
- Per-source overrides are stored as `{ source_id, pattern: PatternPart[] }`
  rows. Absence of a row means the source uses the library default.
- Pattern history (versioning, rollback) is not persisted in v1.

## Errors

| Code                      | When                                                                                    |
|---------------------------|-----------------------------------------------------------------------------------------|
| `pattern.empty`           | Resolve or validate called with an empty `PatternPart[]`.                               |
| `pattern.invalid`         | Resolved path violates OS path rules (segment > 200 bytes or total > 200 chars). Details include `segmentLengthBytes` and `resolvedLength`. (Ref: A4) |
| `pattern.invalid.unicode` | A resolved token value contains Unicode confusables or stripped bidi/format characters. (Ref: A1) |
| `path.traversal`          | A resolved token value equals `.` or `..`, or the assembled path contains a `..` segment. (Ref: A2) |
| `path.reserved_name`      | A path segment matches a Windows reserved device name (CON, PRN, AUX, NUL, COM1–9, LPT1–9), case-insensitively, on any platform. (Ref: A3) |
| `token.unknown`           | Pattern references a token name not present in the registry.                            |
