# Data Model & Conventions — 042 Standard-Library Adoption

This feature is a refactor: it introduces no new **product** entities and changes no DB
schema or IPC command semantics. It does define a few cross-cutting structures and
conventions the migrations standardize on.

## 1. Query keys (US1 — TanStack Query)

A single `queryKeys` factory in `apps/desktop/src/data/queryKeys.ts` is the source of
truth for cache identity and invalidation. Hierarchical, tuple-based:

```
queryKeys = {
  projects: {
    all:    () => ['projects'] as const,
    detail: (id) => ['projects', id] as const,
  },
  inventory: { all: (filters) => ['inventory', filters] as const },
  sessions:  { all: () => ['sessions'] as const,
               calendar: (start,end) => ['sessions','calendar',start,end] as const },
  inbox:     { list: (rootId) => ['inbox', rootId] as const },
  calibration:{ masters: () => ['calibration','masters'] as const,
                master: (id) => ['calibration','masters', id] as const,
                matches:(sid)=> ['calibration','matches', sid] as const },
  guided:    { state: () => ['guided'] as const },
  setup:     { sources: () => ['setup','sources'] as const },
  status:    { summary: () => ['status'] as const },
}
```

**Invalidation map** (ported 1:1 from the homegrown store; mutation → invalidated keys):

| Mutation | Invalidates |
|----------|-------------|
| createProject | `projects.all` |
| updateProject(id) | `projects.all`, `projects.detail(id)` |
| addProjectSource / removeProjectSource / reinferChannels / dismissChannelDrift / transitionLifecycle (id) | `projects.detail(id)` |
| inventorySessionReview | `inventory` |
| inbox classify/confirm/reclassify (rootId) | `inbox.list(rootId)` |

`QueryClient` defaults: `staleTime` modest (e.g. 30s) for lists, `gcTime` default
(replaces the unbounded Map — bounded eviction satisfies FR-002).

## 2. `ErrorCode` enum (US2/CB1 — shared across the boundary)

One Rust enum in `crates/contracts/core` is the single source; specta generates the TS
union. Replaces duplicated magic-string codes on both sides.

```rust
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]      // wire form e.g. "plan.required" preserved via explicit rename where needed
pub enum ErrorCode {
    InternalDatabase,        // "internal.database"
    InternalAudit,           // "internal.audit"
    PlanRequired,            // "plan.required"
    PlanNotFound,            // "plan.not_found"
    TransitionRefused,       // "transition.refused"
    AliasDuplicate,          // "alias.duplicate"
    TargetNotFound,          // "target.not_found"
    LaunchFailed,            // "launch.failed"
    ProjectNotFound, ViewNotFound, /* …enumerated from the audit of existing codes… */
}
```

Existing wire strings (dotted, e.g. `"internal.database"`) MUST be preserved exactly via
serde renames so no IPC payload semantics change (FR-004, FR-022). `ContractError.code`
becomes typed as `ErrorCode`. TS compares against the generated `ErrorCode` union from
`bindings/index.ts` (no string literals).

## 3. Wire error type (US2/CB6)

Command results move from `Result<T, String>` to `Result<T, ContractError>` so the rich
error model (`code: ErrorCode`, `message`, `severity`, `retryable`, `field_errors`,
`recovery_actions`) crosses the wire and specta generates a typed error. `unwrap()` in
`ipc.ts` surfaces a typed `ContractError`, not a bare string.

## 4. Shared Rust helper homes (US11)

| Helper | New single home |
|--------|-----------------|
| `now_iso()` (RFC-3339) | `domain_core` (method on `Timestamp`) |
| `new_id()` (UUID string) | `domain_core` (via `EntityId`) |
| `db_err` / `bus_err` (→ `ContractError`) | `crates/app/core/src/errors.rs` (canonical; `DbError::NotFound` → recoverable code, NOT Fatal) |
| `From<DbError> for ContractError` | `app/core/errors.rs` (collapses 123 `.map_err`) |
| `map_object_type` / `map_source` | `crates/app/core/src/target_dto.rs` |
| `parse_basic_row` (SIMBAD) | `pub` in `targeting` (shared with seed-builder) |
| settings schema | one key-descriptor table in `crates/app/core/src/settings/` consumed by validate/default/hydrate |

## 5. Typed conversions (US9)

`CalibrationKind: TryFrom<&str>/FromStr` with **one** defined fallback (resolving the
`_=>Dark` vs `_=>None` divergence — the canonical fallback is determined from current
stored values; known values map identically). Inventory state + first_run/prepared_source
enums via `strum` (`EnumString`/`Display`, `serialize_all="snake_case"`), each with an
explicit error on unknown input (no silent default).

## 6. Concrete `SettingsData` (US7/D4)

The open `SettingsData { [k]: unknown }` becomes a concrete interface matching the
generated settings contract (or a re-export of the generated type), so settings reads/
writes are type-checked.

## 7. Crate-structure deltas (US13)

| Change | Before | After |
|--------|--------|-------|
| Targeting split (O1) | `targeting` holds SIMBAD resolver (sqlx/reqwest/tokio) | `targeting` (pure domain) + `targeting-resolver` (infra) |
| Base layer (O2) | `domain_core` a peer (6 deps) | true base; ~13 more crates depend on it |
| app/core (O3) | 1 crate, ~33 flat modules | grouped modules → per-domain use-case crates |
| project/structure (O5) | pulls `tokio` | no `tokio` |
| persistence inversion (O6) | `persistence/db → contracts/core` (stores DTOs) | stores **domain** types; map DTOs at app/core. **On-disk/SQL byte-identical.** |

## 8. Long-operation contract (US16)

`OperationHandle { operation_id, operation, status }` + streamed
`OperationEvent { operation_id, event_type, sequence, payload }` (already defined in
`contracts/core`) are wired end-to-end for **plan apply** over a
`tauri::ipc::Channel<OperationEvent>`; the UI subscribes and renders progress. No new
types — the existing contract types become live (FR-021).

## Invariants (must hold after every story)

- No DB schema / migration change; existing databases round-trip byte-identically.
- IPC command **names and payload field names** unchanged (only the error *type* and the
  TS-side *representation* change; wire strings preserved).
- Every `KEEP` item in `research.md` is left untouched.
