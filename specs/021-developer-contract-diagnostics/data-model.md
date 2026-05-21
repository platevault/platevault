# Data Model: Developer Contract Diagnostics

## ContractMeta

Static metadata for one registered UI-to-core contract. Built from the
existing contract registry; not persisted.

| Field               | Type                              | Notes                                                                                |
|---------------------|-----------------------------------|--------------------------------------------------------------------------------------|
| `name`              | `string`                          | Operation name, e.g. `plan.create`. Unique within the registry.                      |
| `version`           | `string`                          | Semantic version of the contract shape, e.g. `"1"` or `"1.2"`.                       |
| `schema_path`       | `string`                          | Absolute path to the JSON Schema file under `packages/contracts/`.                   |
| `direction`         | `"ui-to-core" \| "core-to-ui"`    | Matches the `direction` field in the schema's `operation` block.                     |
| `replay_safe`       | `boolean`                         | `true` for read-only contracts; `false` for write contracts in v1.                   |
| `sensitive_fields`  | `string[]`                        | JSON Pointer paths whose values are redacted before storage. Optional; defaults to the well-known set in research R4. |
| `ts_hash`           | `string?`                         | Hash of the TypeScript-side declaration. Used for mismatch detection at startup.     |
| `rust_hash`         | `string?`                         | Hash of the Rust-side declaration. Used for mismatch detection at startup.           |
| `mismatch`          | `boolean`                         | Derived: `ts_hash != rust_hash` when both are present.                               |

`ContractMeta` is computed at startup from the registry and cached for the
session. The list is bounded by the number of registered contracts.

## ContractCall

One recorded request/response pair captured by the recording proxy. Held in
the in-memory ring buffer; not persisted.

| Field                | Type                              | Notes                                                                                  |
|----------------------|-----------------------------------|----------------------------------------------------------------------------------------|
| `id`                 | `string`                          | Monotonic id within session. Used as the row key.                                      |
| `contract`           | `string`                          | Equal to `ContractMeta.name` at call time.                                             |
| `contract_version`   | `string`                          | Equal to `ContractMeta.version` at call time. Pinned per call so schema viewing matches the recorded shape. |
| `request`            | `object`                          | Redacted request payload. Sensitive fields replaced with `"<redacted>"`.               |
| `response`           | `object?`                         | Response payload on success. Absent when the call errored.                             |
| `error`              | `ContractError?`                  | Error envelope on failure. Absent on success.                                          |
| `started_at`         | `string` (ISO-8601, UTC)          | Wall-clock start time.                                                                 |
| `duration_ms`        | `number`                          | Monotonic elapsed time from dispatch to response or error.                             |
| `payload_truncated`  | `boolean`                         | `true` when the request or response exceeded the 64 KB recorder threshold.             |

`response` and `error` are mutually exclusive. Exactly one is present per
record.

### ContractError

| Field    | Type      | Notes                                                  |
|----------|-----------|--------------------------------------------------------|
| `code`   | `string`  | Stable error code declared in the contract.            |
| `message`| `string`  | Human-readable message.                                |
| `details`| `object?` | Optional error-specific details, redacted as needed.   |

## Ring Buffer

The recent-calls list is a single ring buffer instance owned by the desktop
process.

| Field      | Type            | Notes                                                       |
|------------|-----------------|-------------------------------------------------------------|
| `capacity` | `number`        | `CALL_BUFFER_SIZE = 100` (compile-time constant).           |
| `entries`  | `ContractCall[]`| Newest-first ordering for render.                           |
| `dropped`  | `number`        | Count of records evicted since session start. Diagnostics-only; not rendered as a row. |

Eviction is oldest-first when `entries.length` exceeds `capacity`. Insertion
does not dedupe; every dispatched call produces a new record.

## Developer Mode Flag

| Field      | Type      | Storage                          | Notes                                          |
|------------|-----------|----------------------------------|------------------------------------------------|
| `devMode`  | `boolean` | Settings store, key `devMode`    | Defaults to `false`. Persisted per device.     |

The flag is read once at app boot to decide whether to install the
recording proxy. Toggling the flag at runtime requires an app restart to
install or uninstall the proxy; the route gating and the command-palette
entry react immediately.

## Schema File

The schema viewer reads files directly from disk.

| Field         | Type      | Notes                                                                  |
|---------------|-----------|------------------------------------------------------------------------|
| `path`        | `string`  | Absolute path. Equal to `ContractMeta.schema_path`.                    |
| `body`        | `string`  | Raw file contents. Pretty-printed at render time, not at read time.    |
| `missing`     | `boolean` | `true` when the file does not exist at the recorded path.              |
