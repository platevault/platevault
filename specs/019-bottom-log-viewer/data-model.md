# Data Model: Bottom Log Viewer

## LogEntry

The shape projected from audit (and from diagnostic emitters) into the UI
stream and into the JSON export.

| Field         | Type                                          | Notes                                                                                  |
|---------------|-----------------------------------------------|----------------------------------------------------------------------------------------|
| `id`          | `string`                                      | Stable id. Prefixed format: `aud:<n>` for audit-sourced entries, `dia:<n>` for diagnostic entries (A1). Monotonic within each namespace within a session. Used as the stream cursor. Pattern: `^(aud\|dia):[0-9]+$`. |
| `time`        | `string` (ISO-8601, UTC)                      | Server-side emission timestamp. The UI formats this to local clock for display.        |
| `level`       | `"error" \| "warn" \| "info" \| "debug"`      | Severity. Drives color and filter.                                                     |
| `source`      | `string` (closed enum)                        | Emitter tag. Closed enum maintained by spec 002 event-bus topic prefixes: `audit \| diagnostic \| catalog \| plan \| workflow \| lifecycle \| inventory \| settings \| project \| target \| tool` (R-SourceEnum). See Source Enum section below. |
| `message`     | `string`                                      | Human-readable single-line message. No newlines.                                       |
| `request_id`  | `string?`                                     | Operation id correlating one user intent across multiple events. Required for workflow events. Absent for some `diagnostic` events. |
| `entity_type` | `string?`                                     | When the event refers to a specific entity (`"plan"`, `"project"`, `"target"`, ...).   |
| `entity_id`   | `string?`                                     | Stable id of the referenced entity. Present when `entity_type` is present.             |

| `contract_version` | `string`                               | Schema version of this LogEntry shape. Used for forward-compatibility checks (H1). Value is `"1"` for this spec version. |

Workflow-significant events (sourced from audit) MUST carry `request_id`
and MUST carry `entity_type` and `entity_id` when the event references an
entity. Diagnostic events MAY omit `request_id` and MUST omit
`entity_type` and `entity_id`.

## Source Enum (R-SourceEnum)

Closed enum. Values are maintained by spec 002 event-bus topic prefixes.
Spec 002 is the source of truth; this list mirrors it.

| Value        | Topic prefix / origin             | Notes                                              |
|--------------|-----------------------------------|----------------------------------------------------|
| `audit`      | `audit.*`                         | Generic audit events not covered by a specific prefix. |
| `diagnostic` | (no topic prefix; ephemeral only) | Log-viewer-internal events; not persisted.         |
| `catalog`    | `catalog.*`                       | Catalog download, install, update events.          |
| `plan`       | `plan.*`                          | Plan lifecycle and apply events.                   |
| `workflow`   | `workflow.*`                      | Processing tool workflow events.                   |
| `lifecycle`  | `lifecycle.*`                     | Entity lifecycle transition events.                |
| `inventory`  | `inventory.*`                     | Inventory scan and review events.                  |
| `settings`   | `settings.*`                      | Settings change events.                            |
| `project`    | `project.*`                       | Project create, edit, lifecycle events.            |
| `target`     | `target.*`                        | Target lookup, identity events.                    |
| `tool`       | `tool.*`                          | Processing tool launch events.                     |

**Note (E-019-1)**: This enum should be `$ref`-able from spec 002 in a future
schema consolidation pass. Until then, spec 019 maintains its own copy aligned
to spec 002 event-bus topic prefixes.

## Truncation Marker (A4)

When the viewer's `since` cursor predates retained history (because the audit
store has been vacuumed), the stream response includes:

| Field             | Type      | Notes                                                                               |
|-------------------|-----------|-------------------------------------------------------------------------------------|
| `truncated`       | `boolean` | True when the requested cursor predates the oldest available entry.                 |
| `truncated_count` | `int?`    | Estimated number of entries that existed before the oldest retained entry. May be null when the audit vacuum does not record counts. |

The UI renders an inline marker at the top of the log list when `truncated = true`:
> "History gap — N entries older than this point are no longer retained."

If `truncated_count` is null, the marker reads:
> "History gap — some entries older than this point are no longer retained."

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

**Diagnostic visibility (A3)**: The visibility of diagnostic entries is tied
to the `logLevel` setting (spec 018):

- When `logLevel != "debug"`: diagnostic entries are hidden in the viewer.
  The diagnostics filter chip is off and locked (cannot be toggled by the user).
- When `logLevel == "debug"`: diagnostic entries are visible by default.
  The log header exposes a toggle to show/hide diagnostics within the session.

The panel subscribes to spec 018's `logLevel` setting changes (via event bus
or settings store read) and updates diagnostic visibility reactively.

**Export source default (A2)**: Export defaults to `source: audit` with
`include_diagnostics: false`. The asymmetry with the stream default
(`include_diagnostics: true` when `logLevel == debug`) is intentional:
exported files should contain only durable audit entries by default.
The user may toggle "Include diagnostics" in the export dialog to override.

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
