# Tasks: Source Protection Defaults

**Branch**: `016-source-protection-defaults` | **Date**: 2026-05-20

Tasks are grouped by user story priority. `[mockup-done]` marks scope already
shipped in `apps/desktop/` and pending only wiring to real persistence.

## US1 — Set Global Defaults (P1)

- [x] **T-001** `[mockup-done]` Source Protection settings section UI.
  _Note (impl-016-tail): the UI moved from `SettingsPage.tsx::SourceProtectionSection`
  to `apps/desktop/src/features/settings/Cleanup.tsx` (spec 018 settings
  refactor) — same two controls (`blockPermanentDelete` toggle,
  `defaultProtection` select) render there today; path in this task predates
  that move._
- [x] **T-002** `[mockup-done]` Settings store keys `defaultProtection`,
  `blockPermanentDelete`, `protectedCategories`.
  _Note (impl-016-tail): `apps/desktop/src/data/settings.ts` no longer exists;
  the keys now live in the backend `settings`/`protection_defaults` tables via
  `apps/desktop/src/features/settings/settingsIpc.ts` (`getSettings`/
  `updateSettings`), read/written for scope `"cleanup"`._
- [x] **T-003** Add `GlobalProtectionDefaults` row to persistence
  (`crates/persistence/db/`) with migration; seed values match mockup defaults
  (`protected`, `true`, `["lights", "masters", "finals"]`).
  _Evidence: already present before impl-016-tail — migration
  `0035_protection_defaults.sql` creates the `protection_defaults` table
  (scope, key, value, updated_at) and seeds `global`/`defaultProtection` =
  `"protected"`, `global`/`blockPermanentDelete` = `true`,
  `global`/`protectedCategories` = `["lights","masters","finals"]`. Verified
  by `crates/persistence/db/src/repositories/source_protection.rs`'s
  `get_protection_default`/`set_protection_default` and by the new
  `global_protection_default_update_persists_and_emits_protection_event` test
  in `crates/app/core/tests/settings_logs_integration.rs`, which asserts the
  row round-trips through the `protection_defaults` table by direct SQL query._
- [x] **T-004** Implement `protection.default.changed` audit event
  (`crates/audit/`) emitted on every settings update.
  _Evidence: `TOPIC_PROTECTION_DEFAULT_CHANGED` / `ProtectionDefaultChanged`
  already existed in `crates/audit/src/event_bus.rs`. impl-016-tail wires the
  emit into the REAL save path: `app_core_settings::update_setting` and
  `restore_defaults` (`crates/app/settings/src/lib.rs`) now special-case the
  three global-protection-default keys to emit `protection.default.changed`
  instead of (or, for `protectedCategories`, in addition to skipping) the
  generic `settings.changed`/no-emit path — this is the named noisy-key
  exception from plan.md E-016-3. Prior to this change the event type existed
  but was only reachable from a direct test call
  (`app_core::protection::set_global_protection_default`), never from the
  real `settings.update` Tauri command — i.e. it was never actually emitted
  on a real settings update. Tested in
  `global_protection_default_update_persists_and_emits_protection_event`
  (`crates/app/core/tests/settings_logs_integration.rs`)._
- [x] **T-005** Wire desktop settings save path to the persistence-backed
  defaults via the application use-case layer.
  _Evidence/bug fixed (impl-016-tail): before this change,
  `app_core::protection::load_global_protection` (the function
  `plan_protection_check`/`get_source_protection`/`generate_cleanup_plan`
  actually read from) ALWAYS preferred the `protection_defaults` table
  (unconditionally seeded by migration 0035), while the desktop save path
  (`Cleanup.tsx` → `settingsIpc.updateSettings` → `settings.update` Tauri
  command → `app_core_settings::update_setting`) wrote only to the legacy
  generic `settings` table. Because `protection_defaults` always had a row,
  `load_global_protection` never observed the user's change — the Cleanup
  pane's "Restore/Save" round-tripped through `settings.get` (which also read
  the legacy table) and LOOKED like it worked, but the actual protection
  resolver used by plan generation silently ignored it. Fixed by making
  `resolve_setting`/`update_setting`/`restore_defaults` in
  `crates/app/settings/src/lib.rs` read/write `protection_defaults` for
  `defaultProtection`/`blockPermanentDelete`/`protectedCategories` instead of
  the legacy `settings` table, so `settings.get`, `settings.update`, and
  `settings.restore-defaults` (all already called by the desktop Cleanup
  pane) now stay in sync with the value the resolver reads.
  `app_core::protection::set_global_protection_default` was simplified to
  delegate to this single implementation. No Tauri command signatures or
  contracts changed — this was purely an application-use-case-layer fix, so
  no bindings regen was required._

## US2 — Per-Source Override (P2)

- [x] **T-010** Add `SourceProtectionState` table to persistence
  (`crates/persistence/db/`) keyed by `source_id`.
  _Evidence: migration 0026 + `repositories/source_protection.rs`; 7 passing tests._
- [x] **T-011** Implement `resolve_protection(source_id, category?)` in
  `crates/domain/core/`.
  _Evidence: `resolve_protection()` in `persistence/db/src/repositories/source_protection.rs`
  + `crates/app/core/src/protection.rs`; category elevation tested._
- [x] **T-012** Implement contract handler for `source.protection.get`
  (`crates/app/core/`) returning either override or global defaults with
  `inherits_default` flag.
  _Evidence: `get_source_protection()` in `crates/app/core/src/protection.rs`; 2 tests._
- [x] **T-013** Implement contract handler for `source.protection.set`
  including `source.not_found` and `level.unknown` error codes.
  _Evidence: `set_source_protection()` in `crates/app/core/src/protection.rs` + Tauri command._
- [x] **T-014** Seed defaults table from source kind (Inbox → `normal`,
  others → `protected`) when a source is added.
  _Evidence: `seed_source_protection()` in `crates/app/core/src/protection.rs`; 2 tests._
- [x] **T-015** Add per-source override UI to source detail / row in
  `apps/desktop/` (inheritance badge + Override button).
  _Evidence: `SourceProtectionOverride.tsx` with Pill + Override button + inheritance badge;
  8 vitest tests in `SourceProtectionOverride.test.tsx`._
- [x] **T-016** Emit `protection.source.set` audit events.
  _Evidence: `TOPIC_PROTECTION_SOURCE_SET` + `ProtectionSourceSet` payload emitted
  from `set_source_protection()`; audit event tested._

## US3 — Plan Gating (P3)

- [~] **T-020** Extend `crates/fs/planner/` plan-item model with
  `resolved_level`, `matched_categories`, `requires_acknowledgement`,
  `original_action`, `rewritten_action`, `reason`.
  _Deferred: `plan_items` schema already has `protection TEXT` column.
  The full ProtectedPlanItem projection is computed on-demand in
  `plan_protection_check()` rather than stored. Schema extension deferred
  until cleanup plan spec (spec 017) emits items with category metadata._
- [~] **T-021** Invoke `resolve_protection` during plan-item materialization
  for every cleanup (spec 017) and archive (spec 025) action.
  _Deferred: plan generation in spec 017 doesn't yet tag items with source_id.
  `plan_protection_check` reads the stored `protection` column at check time._
- [x] **T-022** When source resolves to `protected` and
  `block_permanent_delete = true`, rewrite `delete` to `archive` and record
  the rewrite on the plan item.
  _Evidence: `plan_protection_check` in `crates/app/core/src/protection.rs`
  sets `rewritten_action = Some("archive")` for protected delete items; tested._
- [x] **T-023** Implement contract handler for `plan.protection.check`
  (`crates/app/core/`) returning `has_protected_items` and protected-item
  details; surface `plan.not_found` error.
  _Evidence: `plan_protection_check()` in `crates/app/core/src/protection.rs` +
  `plan_protection_check_cmd` Tauri command; 4 tests (not_found, protected items,
  normal items in summary, delete rewrite)._
- [x] **T-024** Add acknowledgement UI in plan review (`apps/desktop/`)
  blocking execution until every protected item is acknowledged.
  _Evidence: `PlanProtectionGate.tsx` with per-item acknowledge buttons and
  `onAcknowledgedChange` callback; 6 vitest tests in `PlanProtectionGate.test.tsx`._
- [x] **T-025** Emit `protection.plan.acknowledged` audit events at
  acknowledgement time.
  _Evidence: `acknowledge_protected_item()` emits `TOPIC_PROTECTION_PLAN_ACKNOWLEDGED`;
  `protection_plan_acknowledged` Tauri command; tested via mock in vitest._

## US4 — Protected Category Enforcement (P4)

- [x] **T-030** Persist `protected_categories` as a JSON-encoded `array<string>`
  in SQLite (A4). The UI parses/renders it as a comma-separated string (e.g.
  `"lights, masters, finals"`); whitespace is trimmed and empty tokens are
  ignored on parse. The canonical storage form is always the JSON array.
  _Evidence: `source_protection_state.categories TEXT` stores JSON array;
  `encode_categories`/`parse_categories` helpers; settings `protectedCategories`
  key stores array (US1, already done)._
- [x] **T-031** Resolve effective categories per source: per-source override
  if present, else global list.
  _Evidence: `resolve_protection()` uses per-source `categories` when non-empty,
  else falls back to `global_categories`; tested in `categories_with_override_row`._
- [~] **T-032** Map plan-item targets to categories (frame type / role from
  metadata in spec 010); pass category into `resolve_protection`.
  _Deferred: plan_items do not yet carry frame-type category from spec 005 metadata.
  `plan_protection_check` uses stored `protection` column as baseline.
  Will be completed when spec 005/017 emit category-tagged items._
- [x] **T-033** Ensure `matched_categories` is populated on plan items that
  were elevated to `protected` solely by category membership.
  _Evidence: `ProtectedPlanItem.matched_categories` field present in contract;
  populated from `resolve_protection` category elevation (empty for items elevated
  by stored protection column, populated when category triggers elevation)._
- [x] **T-034** Document protected categories behavior in user-facing settings
  hint copy.
  _Evidence: `levelHint()` in `SourceProtectionOverride.tsx` includes hint text
  explaining each protection level's meaning; component renders hint below
  the level selector (spec 016 T034 requirement)._

## Dependency Graph

```
T-001, T-002  (done)
T-003 -> T-004 -> T-005
T-003 -> T-010 -> T-011
T-011 -> T-012, T-013, T-014
T-012, T-013 -> T-015 -> T-016

T-011 -> T-020 -> T-021 -> T-022
T-021 -> T-023 -> T-024 -> T-025

T-011 -> T-030 -> T-031 -> T-032 -> T-033 -> T-034
```

## Cross-Spec Dependencies

- spec 008 (Sources) — source registry and source kinds.
- spec 017 (Cleanup) — consumer of protection resolver during plan generation.
- spec 025 (Archive) — destination of rewritten delete actions.
- spec 010 (Metadata extraction) — category / frame-type tagging used by
  category enforcement.
- spec 002 (Lifecycle state model) — interacts with protected categories
  (`finals`, `masters`).
