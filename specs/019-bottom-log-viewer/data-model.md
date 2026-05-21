# Data Model: Bottom Log Viewer

## LogEntry

The shape projected from audit (and from diagnostic emitters) into the UI
stream and into the JSON export.

| Field         | Type                                          | Notes                                                                                  |
|---------------|-----------------------------------------------|----------------------------------------------------------------------------------------|
| `id`          | `string`                                      | Stable id. Monotonic within a session. Used as the stream cursor.                      |
| `time`        | `string` (ISO-8601, UTC)                      | Server-side emission timestamp. The UI formats this to local clock for display.        |
| `level`       | `"error" \| "warn" \| "info" \| "debug"`      | Severity. Drives color and filter.                                                     |
| `source`      | `string`                                      | Emitter tag: `"plans"`, `"lifecycle"`, `"inventory"`, `"settings"`, `"diagnostic"`...   |
| `message`     | `string`                                      | Human-readable single-line message. No newlines.                                       |
| `request_id`  | `string?`                                     | Operation id correlating one user intent across multiple events. Required for workflow events. Absent for some `diagnostic` events. |
| `entity_type` | `string?`                                     | When the event refers to a specific entity (`"plan"`, `"project"`, `"target"`, ...).   |
| `entity_id`   | `string?`                                     | Stable id of the referenced entity. Present when `entity_type` is present.             |

Workflow-significant events (sourced from audit) MUST carry `request_id`
and MUST carry `entity_type` and `entity_id` when the event references an
entity. Diagnostic events MAY omit `request_id` and MUST omit
`entity_type` and `entity_id`.

## Level Ordering

`debug < info < warn < error`. Filter `level_min` admits entries with a
level greater than or equal to the bound. The viewer's `all` filter is
equivalent to `level_min = "debug"`. The mockup also exposes per-level
filters (`info`-only, `warn`-only, etc.) for triage; these are UI-only
and do not appear in the contract.

## Ring Buffer

The UI maintains a single ring buffer instance.

| Field       | Type     | Notes                                              |
|-------------|----------|----------------------------------------------------|
| `capacity`  | `number` | `LOG_BUFFER_SIZE = 500` (compile-time constant).   |
| `entries`   | `LogEntry[]` | Newest-first ordering for render.              |
| `cursor`    | `string?`| Id of the most recently appended entry; used to resume subscription. |
| `dropped`   | `number` | Count of entries evicted since session start. Exposed for diagnostics; not rendered. |

Eviction is oldest-first when `entries.length` exceeds `capacity`.
Insertion dedupes on `id` so a reconnect replay does not duplicate rows.

## Follow State

Persisted via `rememberFollowLogs` in the settings store (see
`specs/018-settings-configuration-model/data-model.md`). No new persistence
shape is introduced by this feature.

| Field    | Type      | Storage                                 |
|----------|-----------|-----------------------------------------|
| `follow` | `boolean` | Settings store, key `rememberFollowLogs`|

## Level Filter (UI-only)

| Field   | Type                                          | Storage                |
|---------|-----------------------------------------------|------------------------|
| `level` | `"all" \| "info" \| "warn" \| "error" \| "debug"` | Session-only in memory |

## Retention Bounds

| Surface          | Bound                                                                           |
|------------------|---------------------------------------------------------------------------------|
| UI ring buffer   | 500 entries (size bound). No time bound.                                        |
| Audit history    | Governed by audit feature; not constrained by the viewer.                       |
| Export window    | User-chosen `since`/`until` time bound and optional `level_min`. No size bound. |

## Diagnostic Event

A `LogEntry` with `source = "diagnostic"`. Always omits `entity_type` and
`entity_id`. May omit `request_id`. Examples:

- `cursor.invalid` recovered: `level = "warn"`, message includes the stale
  cursor and the recovery window size.
- Subscriber reconnect: `level = "info"`, message includes the elapsed
  time since disconnect.
- Reduced-motion preference applied to follow-tail: `level = "debug"`.

Diagnostic events do not reach audit and are excluded from export by
default. The `log.export` request can opt them in via `include_diagnostics:
true`.

## Mapping From Audit

Audit events map to `LogEntry` as follows.

| Audit field       | LogEntry field                                                |
|-------------------|---------------------------------------------------------------|
| `id`              | `id`                                                          |
| `at`              | `time`                                                        |
| `level`           | `level`                                                       |
| `source`          | `source`                                                      |
| `summary`         | `message`                                                     |
| `request_id`      | `request_id`                                                  |
| `entity_type`     | `entity_type`                                                 |
| `entity_id`       | `entity_id`                                                   |

Audit fields that have no `LogEntry` counterpart (full `payload`,
`prior_value`, `new_value`, `snapshot`) are not projected. They remain
available through the audit timeline feature.
