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
event captures noisy-key state at two points:

1. **Session start** — on library open.
2. **Debounced inactivity** — after any noisy-key write, a 5-minute
   inactivity debounce fires once when no further noisy-key writes arrive.
   The timer is per-session; it resets on each noisy write and fires exactly
   once on quiet. The Settings page-close trigger is dropped. (R-Aud-1)

The debounce timer state lives in the use-case layer and MUST be cancelled on
library close to avoid a phantom snapshot after shutdown. T017/T020
implementation must provision the debounce timer and test the
reset-on-write + fire-once-on-quiet invariant.

Non-noisy keys emit one audit event per change.

The current noisy set is `{pattern, protectedCategories}`. Adding a key
requires a research decision because it lowers auditability.

### R4.1 Deep-equal no-op guard (A4)

Before any persistence write or audit emission, the use-case MUST compare the
incoming value to the stored value using **deep structural equality** for
`object` and `array` keys (e.g. `PatternPart[]`, `string[]`), and **strict
equality** for primitive keys. An incoming `PatternPart[]` that is
structurally equal to the stored array — same length, same `id`/`kind`/`value`
at every index — MUST be treated as a no-op even though the reference
differs. The `status: "noop"` response is returned; no row write and no audit
event are emitted. This is especially relevant for `protectedCategories`
(`string[]`, R-Set-1) and `pattern` (`PatternPart[]`).

T013 implementation note: implement `settings_value_eq(a, b)` using
recursive equality; cover a `PatternPart[]` structurally-equal test case
in T009's desktop unit tests alongside the existing scalar no-op test.

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

**Overridable keys**: a subset declared explicitly. The overridable keys are
`hashOnScan`, `followSymlinks`, and `defaultProtection`. `autoApplyPattern`
was removed from the overridable set for symmetry with `pattern`, which is
also not overridable (A2). Attempting to override a key outside this set
returns `key.unoverridable`.

## R7. Defaults are explicitly written on restore (A3)

**Revised (A3)**: `settings.restore-defaults` now writes the **literal
in-code default value** as an explicit row rather than deleting the row.
This makes the restored state unambiguous regardless of future in-code
default changes: a library whose user restored a key continues to have that
value until they change it again. Future default changes only affect
libraries where the key has no row (never explicitly set or restored).

A key with no stored row still resolves to its in-code default at read time
(unchanged from prior design). The distinction is that after a restore the
row exists explicitly with the current default value, whereas before the row
was absent.

This is consistent with spec 002's noop pattern (R-3.1): if the stored value
already equals the default, restore-defaults returns `status: "noop"` with no
row write and no audit event (see R3.1 below).

### R7.1 Restore-defaults already-at-default (R-3.1)

If the key's stored value already equals the in-code default (deep-equal per
R4.1), `settings.restore-defaults` returns `status: "noop"` — no row write,
no audit event. This mirrors the spec 002 noop pattern. The contract response
includes a top-level `status: "success" | "noop"` field; keys that were
already at default are reported in a separate `already_at_default` array
rather than in `restored`.

## R9. Structured-path keys (tools.* and workflow_profile.*)

**Question**: How should settings whose natural scope is "per tool" or
"per workflow profile" be represented in the flat key-value settings store?

**Options**:

1. **Top-level object keys** (e.g., `tools: { pixinsight: { bundle_id: "…" } }`).
   Cons: changes to one tool's bundle_id would require writing the entire
   `tools` object; no-op detection requires deep diffing the whole object.
2. **Structured-path strings** (e.g., `tools.pixinsight.bundle_id`). Pros:
   each key-value pair is independent; the no-op guard operates at the
   individual key grain; the `settings.update` contract accepts one key at a
   time which is already the model. Cons: the `key` field in contracts cannot
   enumerate every possible `<tool_id>`; a regex pattern is used instead.

**Decision**: Structured-path dot notation. The `key` field in
`settings.update`, `settings.restore-defaults`, and
`settings.source-override.set` contracts validates structured-path keys using
regex patterns rather than enum values:

- `^tools\.[a-z0-9_]+\.bundle_id$`
- `^workflow_profile\.[a-z0-9_]+\.watch_extensions$`
- `^workflow_profile\.[a-z0-9_]+\.launch_attribution_window_hours$`

The use-case layer validates that the `<tool_id>` / `<profile_id>` slug
exists before writing; an unknown slug returns `key.unknown`.

## R10. `devMode` compile-time gate

**Question**: How should the settings store handle a key that only has
behavioral effect in specific build configurations?

**Decision**: `devMode` is present in the settings schema for all builds so
that migrations and contract validation remain uniform. In a release build
(without the `dev-tools` Cargo feature), the use-case layer:

1. Returns `devMode: false` in every `settings.get` response, ignoring the
   stored value.
2. Rejects `settings.update` for `devMode` with `value.invalid` (read-only
   key in this build).

The desktop Settings UI hides the `devMode` row entirely in release builds.
This keeps the schema portable across build configurations while preventing
accidental exposure in production.

## R11. Per-frame-type override_penalty expansion

**Question**: `calibration.<frame_type>.override_penalty` implies three
separate keys (`calibration.dark.override_penalty`,
`calibration.flat.override_penalty`, `calibration.bias.override_penalty`).
Should these be a single structured object or three independent keys?

**Decision**: Three independent flat keys using the structured-path pattern
`calibration.<frame_type>.override_penalty`. Rationale: each frame type is
independently tunable; the per-key update contract already supports atomic
writes; flattening avoids nested JSON in the settings store. The enum of
valid `<frame_type>` slots is `dark | flat | bias` (v1). `dark_flat` is
reserved but not exposed until it exits the DarkFlat-Reserved decision
(spec 007 R-DarkFlat-Reserved). A regex pattern `^calibration\.(dark|flat|bias)\.override_penalty$`
validates the key in contracts.

## R12. `imagetyp_normalization.user_mappings` storage

**Question**: The `user_mappings` value is a JSON array of objects. How is it
stored in the single-column `value JSON` row, and how does deep-equal no-op
detection apply?

**Decision**: The entire array is stored as a JSON-encoded value in the
`settings.value` column, identical to how `protectedCategories` (`string[]`)
is stored. Deep structural equality (R4.1) applies element-wise across the
array: same length, same `{imagetyp_string, frame_type}` at each index in the
same order. Order is significant because the normalization engine applies
entries in order; a reorder is a meaningful change and is not a no-op.
`imagetyp_normalization.user_mappings` is **not** classified as noisy because
the array is edited via a structured table control (add/remove row), not via
free-text drag; individual row mutations are discrete auditable events.

## R13. `target_lookup.active_catalogs` default and validation

**Question**: The default is "all 13 v1 catalogs". Should the default be
stored as a literal array or derived at read time?

**Decision**: The default is **not stored**; it is derived at read time from
the spec 014 catalog manifest. When no `target_lookup.active_catalogs` row
exists, the use-case returns the full installed catalog id list. This keeps
the default in sync with the installed catalog set without requiring a
migration every time a new catalog ships. When a row does exist, only the
listed catalog ids that are currently installed and active are honored;
unknown ids are silently filtered and a `warn` audit entry is emitted (same
pattern as R2 schema validation).

## R8. Theme separation

Theme persistence is intentionally split from settings persistence. The
rationale (also captured in `plan.md`) is that theme must paint before the
backend is reachable, must be per-device, and must not pollute the settings
audit stream. Theme has its own key (`alm.theme`) and its own writer in
`apps/desktop/src/app/theme.tsx`.

## R9. calibration.flat.gain.tolerance_hard — dropped 2026-05-23

`calibration.flat.gain.tolerance_hard` was considered as a user-configurable
boolean setting (from the original spec 007 GRILL table, A5). It was dropped
on 2026-05-23 when flat gain was ratified as code-fixed Hard (exact match).
Because gain is now unconditionally Hard for flat matching, there is nothing
for the user to configure: no tolerance exists, no toggle applies. The key
does NOT appear in `data-model.md §Absorbed Keys`, `settings.update.json`,
or `settings.restore-defaults.json`. See spec 007 `data-model.md` Flat
dimensions and `research.md R1` for the rationale.
