# Data Model: Tauri Shell Integration & Platform Polish

**Feature**: `051-tauri-shell-integration` | **Date**: 2026-07-05

This feature adds **one** new table. The other data-ownership migration
(cleanup overrides) deliberately reuses an existing table (see `research.md`
§b) and adds no schema. Everything else in this feature (window-state,
diagnostics log, native menu, theme sync) is shell/OS-chrome state with no
database representation at all (see spec.md Key Entities).

---

## E1 — `target_favourite` (new table, migration `0055`)

Replaces the `localStorage`-only stub in
`apps/desktop/src/features/targets/useFavourites.ts`. One row per favourited
canonical target; absence of a row means "not favourited" (no boolean column
needed).

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `target_id` | TEXT | PRIMARY KEY, `REFERENCES canonical_target(id) ON DELETE CASCADE` | The favourited target. FK cascade means a deleted/merged canonical target automatically drops its favourite — no orphaned rows, no app-level cleanup needed. |
| `favourited_at` | TEXT | NOT NULL | ISO-8601 UTC timestamp, matching the `Timestamp` convention used elsewhere (e.g. `canonical_target.resolved_at`). |

**Invariants**:

- A target is favourited **iff** a row exists for its id (FR-004, FR-005).
- Unfavouriting is a `DELETE`, not a soft-delete flag — there is no product
  need to retain "was once favourited" history, and it keeps `SELECT * FROM
  target_favourite` directly answer "what's favourited right now."
- No audit event is required for favourite/unfavourite changes (spec.md
  Requirements: audit is scoped to the cleanup-override entity via FR-008,
  not favourites — favourites are a personal UI preference, not a
  filesystem-plan-adjacent decision).
- Referential integrity relies on SQLite foreign keys being enabled
  (`PRAGMA foreign_keys = ON`, already the connection-wide convention in this
  codebase — see the `PRAGMA foreign_keys = OFF/ON` bracketing pattern used in
  rebuild-style migrations for the *opposite* case).

**Repository shape** (for `crates/persistence/db/repositories/target_favourites.rs`,
new — or added to the existing targets repository file, whichever the
implementer finds keeps the file count sane): `list_favourites(pool) -> Vec<TargetId>`,
`add_favourite(pool, target_id) -> Result<(), Error>` (upsert-safe / no-op if
already present), `remove_favourite(pool, target_id) -> Result<(), Error>`
(no-op if absent).

### Migration SQL (planned artifact — implementation creates this file verbatim)

Additive-only; no existing table is altered. No `PRAGMA foreign_keys OFF/ON`
rebuild dance is needed since this is a brand-new table, not a column/CHECK
change to an existing one. `0055` is the next free migration number as of this
writing (`0054_source_view_generation_origin.sql` is the latest on `main`);
re-check for collisions from concurrent branches before creating the file
(see the `duplicate-migration-version-collision` lesson from a prior spec).

File: `crates/persistence/db/migrations/0055_target_favourites.sql`

```sql
-- Migration 0055: target favourites (spec 051 US2).
--
-- Replaces the localStorage-only favourites stub
-- (apps/desktop/src/features/targets/useFavourites.ts) with a durable,
-- canonical record so favourited status survives restarts/reinstalls and is
-- inspectable in the database (Constitution Principle V).
--
-- One row per favourited target; absence of a row means "not favourited" --
-- no boolean column needed. ON DELETE CASCADE means a deleted/merged
-- canonical_target automatically drops its favourite row with no app-level
-- cleanup required.
--
-- Constitution §I : metadata only; no filesystem mutation.
-- Constitution §V : SQLite is the durable record for this previously
-- browser-storage-only piece of state.

CREATE TABLE IF NOT EXISTS target_favourite (
    target_id     TEXT NOT NULL PRIMARY KEY REFERENCES canonical_target(id) ON DELETE CASCADE,
    favourited_at TEXT NOT NULL
);
```

---

## E2 — `cleanupTypeOverrides` (existing `settings` table, new key — no migration)

Stored as a single row in the existing generic `settings` table
(`crates/persistence/db/migrations/0013_settings.sql`):

| `settings.key` | `settings.value` (JSON) shape |
|---|---|
| `"cleanupTypeOverrides"` | `{ "<dataTypeId>": "Keep" \| "Archive" \| "Delete", ... }` — an object whose keys are the stable numeric ids from the frontend `CLEANUP_TYPES` fixture (`apps/desktop/src/data/fixtures/settings.ts`, ids `1`-`20` today), stringified (JSON object keys are always strings), and whose values are one of the three action enum members. Absent key ⇒ absent id in the map ⇒ that type's built-in default action applies (matches today's `actions[row.id] ?? row.action` fallback already in `Cleanup.tsx`). |

**Invariants**:

- The value is validated by a new `descriptors.rs` `ValidationRule` variant
  (mirroring the existing `PatternsByType` rule for `defaultDestinationPatterns`):
  every key must parse as one of the known data-type ids, every value must be
  exactly `"Keep"`, `"Archive"`, or `"Delete"`; anything else is rejected the
  same way `value.invalid` errors already work for other stable keys.
- Every write goes through the existing `update_setting` path, which already
  performs the no-op guard (identical value ⇒ no audit event, no-op — FR-008
  is about recording *changes*, not re-saves of the same value) and, on an
  actual change, emits the existing `SettingsChanged` audit event
  (`TOPIC_SETTINGS_CHANGED`) carrying the key and new value. No new audit
  topic, no new event type.
- This key is **not** listed as `overridable` (no per-source override) or
  `noisy` (every real change IS audited) — matching `defaultProtection`'s
  descriptor shape, not `defaultDestinationPatterns`' (which research.md notes
  as the closest *shape* precedent, not necessarily the same flags).
- The fixed taxonomy (`CLEANUP_TYPES`: labels, stage, built-in default action,
  `warnOnChange`) is **not** part of this entity and is not moved to the
  database by this feature (FR-009).

---

## Non-entities (explicitly not modeled in the database)

- **Window state** (size/position/maximized): owned entirely by
  `tauri-plugin-window-state`'s own store file under the platform app-data
  directory. Not app SQLite data; not a contract; not portable to a
  hypothetical future non-desktop backend (documented assumption in spec.md).
- **Diagnostics log entries**: plain-text rotating file(s) on disk, owned by
  `tauri-plugin-log`. The SQLite `events` table (via `audit`/`EventBus`)
  remains the sole canonical history (FR-023); this file is never read back
  by the app itself, only by a human.
- **Notification records**: OS-native notification center state, entirely
  owned by the OS; the app does not persist "notifications shown" anywhere.
