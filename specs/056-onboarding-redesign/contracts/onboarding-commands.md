# Contract delta: onboarding operations (spec 056)

Language-neutral operation contracts (Constitution §V). Rust DTOs live in
`crates/contracts/core/src/onboarding.rs`; the Tauri adapter exposes them via
tauri-specta generated bindings (generated bindings are authoritative for
casing — camelCase on the wire). The legacy `guided.*` operations and
`tour.complete_step` are REMOVED, not versioned ([research R7](../research.md)).

## Removed operations

| Operation | Replacement |
| --- | --- |
| `guided.state.get` / `guided.step.complete` / `guided.dismiss` / `guided.restart` / `guided.activate` | `onboarding.*` below |
| `tour.complete_step` (spec 029 stub) | none (deleted) |
| `preferences.tourCompleted` field | `onboarding_flags.orientation_done_at` |

## New operations

### `onboarding.state.get` (command `onboarding_state_get`)

Read the full onboarding projection for UI hydration.

- **Request**: empty.
- **Response**: `{ state: { items: [{ itemId, page, state, at, source, prerequisite: { met, reasonKey, jumpPage } | null, hasAutoTick }], flags: { orientationDone, sectionHidden, sidebarCollapsed }, progress: { done, total, perPage: [{ page, done, total }] } } }` — the payload is nested under a `state` envelope (`OnboardingStateGetResponse.state` / `OnboardingRestoreResponse.state`); `sectionHidden` covers both explicit removal (FR-013) and completion auto-hide (FR-031).
- **Errors**: `db_failure`.

### `onboarding.item.set_state` (command `onboarding_item_set_state`)

Manual check-off or dismiss (FR-017). Not usable for auto states.

- **Request**: `{ itemId, state: "manually_checked" | "dismissed" }`
- **Response**: updated item row.
- **Errors**: `unknown_item`, `invalid_state` (auto states rejected), `db_failure`.

### `onboarding.orientation.complete` (command `onboarding_orientation_complete`)

Mark the walk finished or skipped (both set done-forever, FR-004).

- **Request**: `{ outcome: "finished" | "skipped" }`
- **Response**: `{ orientationDoneAt }`
- **Errors**: `db_failure`. Idempotent — repeat calls return the original timestamp.

### `onboarding.section.set` (command `onboarding_section_set`)

Section-level flags: explicit remove (FR-013) and collapse persistence
(FR-012).

- **Request**: `{ hidden?: true, sidebarCollapsed?: bool }` (at least one
  field). `hidden` accepts only `true` (user remove); unhiding happens
  exclusively via `onboarding.restore`. The completion auto-hide (FR-031) is
  written by the backend settle path, never through this command.
- **Response**: updated flags.
- **Errors**: `db_failure`, `invalid_state` (`hidden: false` rejected).

### `onboarding.restore` (command `onboarding_restore`)

The single Settings → Advanced restore/reset (FR-014). Clears the hidden flag
(explicit removal or completion auto-hide), then re-derives AUTOMATIC items
only from actual recorded state (same routine as first seed);
`manually_checked` and `dismissed` items keep their state — restore never
discards user progress. Idempotent.

- **Request**: empty.
- **Response**: full state (same shape as `onboarding.state.get`).
- **Errors**: `db_failure`.

## Notification (backend → frontend)

### `onboarding:state-changed`

Emitted by the bus subscriber after any persisted tick or flag change
([research R5](../research.md)). Payload is a hint only — `{ itemId | null }`;
the frontend re-reads via `onboarding.state.get`. No polling.

## Invariants

- Ticks from domain events are written ONLY by the backend subscriber; no
  command can set `auto_checked` (FR-021, backend-authoritative).
- Envelope `source == "restore"` events are filtered server-side before any
  write (FR-016).
- All operations are local-desktop today but remain portable to a remote
  service: no filesystem paths, no UI concepts, plain JSON-serializable DTOs
  (Constitution §V).
