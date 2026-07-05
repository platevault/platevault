# Phase 1 Contracts: Tauri Shell Integration & Platform Polish

**Feature**: 051-tauri-shell-integration | **Date**: 2026-07-05

Language-neutral operation contracts (Principle V). These map to Tauri
commands via `tauri-specta`; the generated `bindings/index.ts` is
authoritative (camelCase). Errors use the existing `ContractError { code,
message, severity, retryable }` envelope. Legend: 🆕 new operation · ✳️
changed/extended existing operation · — no IPC surface (documented for
traceability only).

## Targets — favourites (🆕)

### 🆕 `targets.favourites.list`

Return the current set of favourited canonical target ids.

- Request: `{}`
- Response: `{ targetIds: string[] }`
- Errors: none expected beyond the generic database-unavailable case.

### 🆕 `targets.favourites.add`

Mark a canonical target as favourited. Idempotent — adding an already-favourited
target succeeds with no error and no duplicate row.

- Request: `{ targetId: string }`
- Response: `{ targetId: string, favouritedAt: string }`
- Errors: `target.not_found` (the id does not resolve to an existing
  `canonical_target` row).

### 🆕 `targets.favourites.remove`

Unmark a canonical target as favourited. Idempotent — removing a target that
was not favourited succeeds with no error.

- Request: `{ targetId: string }`
- Response: `{ targetId: string }`
- Errors: none expected (no-op on absent row).

### Contract test intentions

- `favourites.add` then `favourites.list` includes the id; `favourites.remove`
  then `favourites.list` no longer includes it.
- `favourites.add` for a non-existent target id returns `target.not_found`.
- `favourites.add` twice for the same target is idempotent (single row,
  `favouritedAt` reflects the first add — a second add MUST NOT reset the
  timestamp, matching "already favourited" being a no-op).
- Deleting a `canonical_target` row (e.g. a future target-merge/retire path)
  cascades to remove its `target_favourite` row (FK `ON DELETE CASCADE`
  behavior, exercised directly at the repository layer).

---

## Settings — cleanup type overrides (✳️ extends existing `settings.get` / `settings.update`)

No new operation. `cleanupTypeOverrides` becomes a new valid key accepted by
the existing generic settings contract (spec 018), scoped like
`defaultProtection`/`protectedCategories` under the `"cleanup"` settings
scope already used by `apps/desktop/src/features/settings/Cleanup.tsx`.

### ✳️ `settings.get` (scope `"cleanup"`)

Response's `values` object gains an optional `cleanupTypeOverrides` entry:
`{ [dataTypeId: string]: 'Keep' | 'Archive' | 'Delete' }`. Absent entirely on
a fresh install (no overrides yet saved); absent individual ids fall back to
that type's built-in default action (unchanged frontend fallback behavior).

### ✳️ `settings.update` (scope `"cleanup"`, key `cleanupTypeOverrides`)

- Request: `{ scope: "cleanup", values: { cleanupTypeOverrides: { [dataTypeId: string]: 'Keep' | 'Archive' | 'Delete' } } }`
- Response: unchanged existing shape (`SettingsUpdateResponse`).
- Errors: `value.invalid` if any key is not a known data-type id, or any value
  is outside the closed `Keep|Archive|Delete` enum (new `ValidationRule`
  variant in `descriptors.rs`; same error family as every other stable-key
  validation failure).
- Side effect (unchanged, already-existing mechanism): a real value change
  emits the existing `settings.changed` audit event
  (`TOPIC_SETTINGS_CHANGED`) carrying the new map — satisfying spec.md FR-008
  with zero new audit plumbing.

### Contract test intentions

- Set a single type's override via `settings.update` → `settings.get` reflects
  it; unset types still report their fixture default client-side (unchanged
  client fallback logic, not a contract concern).
- Setting the same value twice produces exactly one audit event (first write),
  not two (existing no-op guard).
- An invalid data-type id or an invalid action value is rejected with
  `value.invalid` and never partially applied.

---

## Notifications — no new IPC surface (—)

Notification triggers (spec.md US8/FR-024) are backend-internal `EventBus`
subscribers added in `apps/desktop/src-tauri/src/lib.rs`'s `run_app()`,
reacting to already-published events (plan-apply completion,
ingest-resolution drain progress, workflow-run manifest completion). They call
the native OS notification API directly from the Rust shell and do not add,
change, or remove any Tauri command, event contract, or frontend-invokable
surface. Documented here only so this feature's full IPC-surface delta is
traceable in one place (per the task's request for a contract entry — there is
deliberately no operation to define).

If a future iteration wants the frontend to explicitly trigger a permission
request at a chosen UX moment (rather than relying on the plugin's
first-notification-attempt prompt), that would be a 🆕
`app.notifications.request_permission` operation — **not needed for this
spec's acceptance criteria** and therefore not added here; noted so it is not
mistaken for an oversight.

---

## Window-state, native menu, native theme sync, diagnostics log, single-instance, prevent-default, auto-update — no IPC surface (—)

All remaining stories in this feature are desktop-shell/native-OS
integrations with no UI-to-core contract surface:

- Window-state, native menu bar, prevent-default, and single-instance are
  entirely Rust-plugin-managed; nothing is invoked from the frontend.
- Native theme sync is triggered from the frontend's existing
  `apps/desktop/src/data/theme.ts` theme-change path, but calls the Tauri
  **core** window API (`@tauri-apps/api/window`'s `getCurrentWindow().setTheme()`)
  directly — this is a platform API call, not an app-defined IPC contract, and
  is out of scope for `packages/contracts` (which covers this app's own
  request/response operations, not framework-provided APIs).
- The diagnostics log file is written by `tauri-plugin-log` from Rust
  `tracing`/`log` call sites already in place; no new command reads or writes
  it from the frontend.
- Auto-update's check/verify/install flow is driven through
  `tauri-plugin-updater`'s own `@tauri-apps/plugin-updater` JS API
  (`check()`, `update.downloadAndInstall()`) — again a platform plugin API,
  not an app-defined contract. The frontend surfaces its result (an
  "update available" affordance) via a plugin-emitted event, not a new
  command.
