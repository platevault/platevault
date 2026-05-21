# Research: Settings Configuration Model

## R1. Settings persistence: config file vs library database

**Question**: Should v1 settings live in a dotfile (TOML/JSON next to the
binary or in OS config dir) or in the library SQLite database?

**Options**:

1. **Per-user config file** (e.g. TOML in OS config dir). Pros: trivially
   diff-able, easy to back up, survives database loss. Cons: divorced from
   library lifecycle, ambiguous when a user opens multiple libraries, harder
   to audit, two write paths for what is conceptually one record.
2. **Library SQLite database** (chosen). Pros: travels with the library;
   per-library values match the product model in which most settings affect
   library behavior (pattern, calibration matching, protection); one audit
   stream; one migration story. Cons: settings are unavailable before a
   library opens, so first-run defaults are inlined in code.
3. **Mixed**: per-device keys (theme, log follow flag) in a config file,
   library-scoped keys in SQLite. Adopted in a degenerate form: theme lives
   in localStorage (`alm.theme`), but no general per-device file is
   introduced in v1.

**Decision**: SQLite for the canonical settings record; theme in localStorage;
no separate config file. Reconsider if a future requirement demands settings
before any library is opened.

## R2. JSON-Schema validation on read

**Question**: Should stored settings values be validated against a schema on
read, on write, or both?

**Options**:

1. **Write-only**: trust persisted data because we wrote it. Cons: a
   downgrade, a manual DB edit, or a partial migration can ship invalid
   values to the UI.
2. **Read-only**: validate when hydrating into the in-memory store. Catches
   drift but can mask write-side bugs.
3. **Both** (chosen). Validate on `settings.update` to reject bad inputs at
   the boundary with a precise `value.invalid` error. Validate on
   `settings.get` to defend against corrupted or downgraded rows; invalid
   rows reset to defaults with one `warn` audit entry rather than failing
   the whole load.

**Decision**: Validate on both ends. The same JSON Schema sourced from
`contracts/settings.update.json` is the authority.

## R3. Migration on version bump

**Question**: What happens when the schema version bumps from `v1` to `v2`?

**Options**:

1. **In-place rewrite**: load v1, transform to v2, replace rows. Simple but
   destroys provenance.
2. **Versioned table per schema**: `settings_v1`, `settings_v2`, etc. Reads
   pick the highest available. Cons: query duplication.
3. **Migration use-case** (chosen). A `crates/persistence/db` migration runs
   on first open after upgrade. It reads each v1 row, transforms it through
   a versioned mapping, writes the v2 row, and emits one `audit` event of
   level `info` summarizing the migration (count of keys migrated, count of
   keys dropped, count of keys reset to default).
4. **Lazy migration**: migrate keys on first read in the new version. Cons:
   split-brain values during the migration window.

**Decision**: Eager migration with an audit summary. The storage key
(`alm.settings.v1`) becomes a column-level marker only when needed.

## R4. Audit log policy for high-frequency keys

**Question**: How do we keep the audit stream readable when keys like
`pattern` (drag-reordered) and `protectedCategories` (free-text edited)
update on every keystroke?

**Decision**: A `NOISY_KEYS` set, mirrored in the desktop snapshot and in the
Rust use-case, gates per-change audit emission. Noisy keys still persist on
every change; they do not emit per-change audit events. A `settings.snapshot`
event captures noisy-key state at session start and at user-initiated
explicit save points (e.g. closing the Settings page). Non-noisy keys emit
one audit event per change.

The current noisy set is `{pattern, protectedCategories}`. Adding a key
requires a research decision because it lowers auditability.

## R5. Cross-tab / cross-window settings divergence (deferred)

**Question**: If two windows of the app run side by side, how do they
reconcile a settings write?

**Decision**: Deferred. The desktop is a single-window Tauri app in v1, so
divergence cannot arise. The design keeps the backend as the canonical
source so that a future multi-window or remote backend can broadcast
`settings.changed` events through the same channel without redesigning the
contract.

## R6. Per-source override resolution order

**Question**: Given a global setting and a per-source override, which wins?

**Decision**: Two layers only in v1.

1. Per-source override (`source_overrides.value` where `source_id` matches).
2. Global default (`settings.value`).
3. In-code default (fallback when no row exists).

Per-project overrides (mentioned in spec Key Entities) are out of scope here;
they live in the Edit project pane per the spec's Assumptions. The settings
model exposes only global and per-source layers in v1.

**Overridable keys**: a subset declared explicitly. Today the planned
overridable keys are `hashOnScan`, `followSymlinks`, `autoApplyPattern`, and
`defaultProtection`. Attempting to override a key outside this set returns
`key.unoverridable`.

## R7. Defaults are not stored

A key with no stored row resolves to its in-code default. This keeps
defaults free of drift across libraries and lets a defaults change in code
ship cleanly without a data migration. Restoring a default deletes the
stored row rather than writing the default value, so a future defaults
change is picked up automatically by any user who restored that key.

## R8. Theme separation

Theme persistence is intentionally split from settings persistence. The
rationale (also captured in `plan.md`) is that theme must paint before the
backend is reachable, must be per-device, and must not pollute the settings
audit stream. Theme has its own key (`alm.theme`) and its own writer in
`apps/desktop/src/app/theme.tsx`.
