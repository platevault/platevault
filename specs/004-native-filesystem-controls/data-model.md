# Data Model: Native Filesystem Controls

**Branch**: `004-native-filesystem-controls` | **Date**: 2026-05-20

This feature owns no durable entities. All three operations
(`native.directory.pick`, `native.file.pick`, `native.reveal`) are
stateless and transient. This document models the request/response
shapes and the audit-event payloads emitted on failure so downstream
specs (003, 005, 006, 008, 017) can integrate against a single
contract surface.

## Operation: `PickerRequest`

A transient operation invoked by the UI to open the OS-native file or
directory picker. Not persisted.

| Field | Type | Required | Notes |
|------|------|---------|------|
| `kind` | enum `directory \| file` | yes | Selects directory-only or file-only picker mode. |
| `default_path` | string (absolute path) \| null | no | Anchor directory for the dialog. Honored where the host OS supports it (see research §1). Silently ignored if the path does not exist. |
| `filters` | array of `FileFilter` \| null | conditional | Required when `kind = file`; ignored when `kind = directory`. Order matters; the first filter is the default. |
| `request_id` | UUID v4 (text) | yes | Generated client-side for log correlation. |

### `FileFilter`

| Field | Type | Required | Notes |
|------|------|---------|------|
| `name` | string | yes | Human-readable filter label (e.g. `All supported`, `FITS`). |
| `extensions` | array of string | yes | Extensions without the leading `.` (e.g. `["fit", "fits"]`). Case-insensitive. |

### Constraints

- When `kind = directory`, `filters` MUST be null or absent.
- When `kind = file`, `filters` MUST contain at least one entry.
- `default_path` MUST be absolute. Relative paths are rejected at the
  contract layer.

## Operation: `PickerResult`

The response from a picker operation. Cancellation is a non-error
null path (research §4).

| Field | Type | Required | Notes |
|------|------|---------|------|
| `path` | string (absolute path) \| null | yes | The user-selected path, or null if the user cancelled. |
| `selected_filter` | string \| null | no | The name of the filter that was active when the user clicked Open. Only populated for file pickers. |
| `cancelled` | boolean | yes | Mirrors `path === null`. Provided so callers can branch without null checks. |

### State Transitions

```text
[issued] ── user picks path ──► [resolved with path]
[issued] ── user cancels  ──► [resolved with null]
[issued] ── OS error      ──► [rejected with error code]
```

The operation has no persistent state; it lives only for the duration
of the dialog.

## Operation: `RevealRequest`

A transient operation invoked by the UI to open the OS file browser
at the given path with the target selected when supported.

| Field | Type | Required | Notes |
|------|------|---------|------|
| `path` | string (absolute path) | yes | Path to reveal. May point to a file or a directory. |
| `entity_kind` | string | no | Optional entity context. Closed enum: `inbox_item \| inventory_row \| project_manifest \| master_calibration \| registered_source \| other` (R-EntityKind). Used for audit-log correlation. |
| `entity_id` | string | no | Optional entity id for audit-log correlation. |
| `request_id` | UUID v4 (text) | yes | Generated client-side for log correlation. |

### Constraints

- `path` MUST be absolute.
- `path` is not required to exist; non-existence is surfaced as the
  `path.not_exists` error, not as input validation.

## Operation: `RevealResult`

The response from a reveal operation.

| Field | Type | Required | Notes |
|------|------|---------|------|
| `revealed` | boolean | yes | True if the OS file browser was successfully launched. |
| `selection` | enum `target \| directory_only \| none` | yes | Whether the target was highlighted, only the parent directory was opened, or no selection was applied. Linux fallback returns `directory_only`. |

### State Transitions

```text
[issued] ── reveal succeeds, file selected ──► [resolved: target]
[issued] ── reveal succeeds, dir opened    ──► [resolved: directory_only]
[issued] ── path missing                   ──► [rejected: path.not_exists]
[issued] ── OS command fails               ──► [rejected: os.command_failed]
```

## Audit Events (Emitted On Failure)

Audit-event payloads are owned by `crates/audit/`. This feature emits
two new event kinds.

### `native.picker.failed`

| Field | Type | Required | Notes |
|------|------|---------|------|
| `kind` | constant `"native.picker.failed"` | yes | Discriminator. |
| `picker_kind` | enum `directory \| file` | yes | Which picker failed. |
| `error_code` | string | yes | Contract error code. |
| `request_id` | UUID v4 (text) | yes | Correlates to the originating request. |
| `timestamp` | ISO 8601 (text) | yes | Server-local time. |

### `native.reveal.failed`

| Field | Type | Required | Notes |
|------|------|---------|------|
| `kind` | constant `"native.reveal.failed"` | yes | Discriminator. |
| `error_code` | enum `path.not_exists \| os.command_failed` | yes | Contract error code. |
| `entity_kind` | string \| null | no | Mirrors the request's `entity_kind`. |
| `entity_id` | string \| null | no | Mirrors the request's `entity_id`. Used as the sole correlation key; raw path and path hash are NOT persisted (A2: drop path_hash to avoid PII in audit exports). |
| `request_id` | UUID v4 (text) | yes | Correlates to the originating request. |
| `timestamp` | ISO 8601 (text) | yes | Server-local time. |

Cancellation is NOT logged.

## LastPathMemory (R-LastPath)

Per-kind last-chosen directory stored in browser `localStorage`. The React
hook reads the value and passes it as `default_path` on the next picker open.
The Tauri backend command does not see or store these values.

| Key | Pick affordance |
|-----|-----------------|
| `alm.lastPath.library_root` | Source root (raw, calibration, project, inbox) |
| `alm.lastPath.catalog_import` | Catalog file import |
| `alm.lastPath.export` | Any export destination |
| `alm.lastPath.master_calibration` | Master calibration file |

Additional keys may be added for future affordances following the
`alm.lastPath.<kind>` namespace convention.

## File Filter Ordering (R-AllSupported)

The canonical filter list for master calibration file selection, in order.
The first row is the default. Extensions are without the leading dot.

1. `{ name: "All supported astro images", extensions: ["xisf","fits","fit","fts","tif","tiff","png","jpg"] }` — combined preset (default).
2. `{ name: "FITS", extensions: ["fit","fits","fts"] }` — includes `.fts` alias (B-.fts).
3. `{ name: "XISF", extensions: ["xisf"] }`.
4. `{ name: "TIFF", extensions: ["tif","tiff"] }`.
5. `{ name: "All files", extensions: ["*"] }` — escape hatch; `*` is only valid in a filter named `"All files"` (D-004-1). The server rejects `*` in any other filter row with `filters.invalid`.

## Relationships

```text
PickerRequest ──issues──► PickerResult     (transient pair)
RevealRequest ──issues──► RevealResult     (transient pair)

PickerRequest.failure ──emits──► native.picker.failed (audit)
RevealRequest.failure ──emits──► native.reveal.failed (audit)
```

There is no link to any other entity owned by this spec. Downstream
features pass their own `entity_kind` / `entity_id` for correlation.
