# Research: Tauri Backend Wiring

## R-029-1: Specta Command Rename for Dotted Names

**Decision**: Use `#[specta(rename = "sessions.list")]` on each Tauri command
function to expose dotted names matching the frontend's existing `invoke()` calls.

**Rationale**: The frontend already uses dotted names throughout `commands.ts`.
Changing 30+ frontend invoke calls is higher risk than annotating Rust functions.
Specta's rename attribute is the supported mechanism for custom command names.

**Alternatives considered**:
- Change frontend to snake_case: higher churn, touches every page component
- Wrapper mapping layer: unnecessary indirection, two sources of truth

**Verification**: The existing spec-002 commands use `provenance_read` (snake_case)
naming. These will be preserved as-is since the frontend's `bindings/index.ts`
already calls them by their specta-generated camelCase names. Only new stub
commands use the dotted rename pattern to match `commands.ts`.

## R-029-2: Database Path Resolution via Tauri App Handle

**Decision**: Use `tauri::api::path::app_data_dir()` (Tauri 2: via `AppHandle`
path resolver) to get the platform data directory, then append
`astro-library-manager/alm.db`.

**Rationale**: Tauri's path API handles platform differences (XDG on Linux,
`~/Library/Application Support/` on macOS, `%APPDATA%` on Windows) and respects
the app identifier from `tauri.conf.json`.

**Alternatives considered**:
- `dirs` crate directly: duplicates Tauri's built-in resolution, diverges if
  Tauri config changes the app identifier
- Hardcoded paths per platform: fragile, doesn't respect XDG overrides

**Implementation note**: Database initialization must move into the Tauri
`setup` closure (or use `Builder::setup()`) because `app_data_dir()` requires
the `AppHandle`, which isn't available until after `Builder::build()`. The
current `main.rs` initializes the DB before `tauri::Builder`, which must change.

## R-029-3: Type Migration Strategy

**Decision**: Delete `apps/desktop/src/api/types.ts` entirely. Update all
frontend imports to reference types from `apps/desktop/src/bindings/index.ts`.

**Rationale**: Two type files (hand-written + generated) will inevitably drift.
A single generated source of truth enforced by `cargo test` + `tsc --noEmit`
prevents runtime shape mismatches.

**Risk**: The generated types may use different names or nesting than the
hand-written ones. The task plan must include a mapping audit to identify
renames before deleting.

**Mitigation**: Before deleting `types.ts`, generate the new bindings and
compare type names/shapes. Create type aliases in the bindings barrel if
the generated names differ significantly (e.g., specta appends `_Serialize`
suffixes for serde-annotated types).

## R-029-4: Stub Observability

**Decision**: Each stub emits `tracing::debug!("stub: {}", command_name)`.

**Rationale**: Visible with `RUST_LOG=debug`, zero cost in release builds.
Developers can grep logs to see which commands are still stubs during
domain spec development.

**Implementation**: Add `tracing` as a dependency of `desktop_shell`. Each
stub function begins with `tracing::debug!("stub: sessions.list");` (literal
string, no format args needed).
