# Tasks: Source Protection Defaults

**Branch**: `016-source-protection-defaults` | **Date**: 2026-05-20

Tasks are grouped by user story priority. `[mockup-done]` marks scope already
shipped in `apps/desktop/` and pending only wiring to real persistence.

## US1 — Set Global Defaults (P1)

- [x] **T-001** `[mockup-done]` Source Protection settings section UI
  (`apps/desktop/src/features/settings/SettingsPage.tsx::SourceProtectionSection`).
- [x] **T-002** `[mockup-done]` Settings store keys `defaultProtection`,
  `blockPermanentDelete`, `protectedCategories`
  (`apps/desktop/src/data/settings.ts`).
- [ ] **T-003** Add `GlobalProtectionDefaults` row to persistence
  (`crates/persistence/db/`) with migration; seed values match mockup defaults
  (`protected`, `true`, `["lights", "masters", "finals"]`).
- [ ] **T-004** Implement `protection.default.changed` audit event
  (`crates/audit/`) emitted on every settings update.
- [ ] **T-005** Wire desktop settings save path to the persistence-backed
  defaults via the application use-case layer.

## US2 — Per-Source Override (P2)

- [ ] **T-010** Add `SourceProtectionState` table to persistence
  (`crates/persistence/db/`) keyed by `source_id`.
- [ ] **T-011** Implement `resolve_protection(source_id, category?)` in
  `crates/domain/core/`.
- [ ] **T-012** Implement contract handler for `source.protection.get`
  (`crates/app/core/`) returning either override or global defaults with
  `inherits_default` flag.
- [ ] **T-013** Implement contract handler for `source.protection.set`
  including `source.not_found` and `level.unknown` error codes.
- [ ] **T-014** Seed defaults table from source kind (Inbox → `normal`,
  others → `protected`) when a source is added.
- [ ] **T-015** Add per-source override UI to source detail / row in
  `apps/desktop/` (inheritance badge + Override button).
- [ ] **T-016** Emit `protection.source.set` audit events.

## US3 — Plan Gating (P3)

- [ ] **T-020** Extend `crates/fs/planner/` plan-item model with
  `resolved_level`, `matched_categories`, `requires_acknowledgement`,
  `original_action`, `rewritten_action`, `reason`.
- [ ] **T-021** Invoke `resolve_protection` during plan-item materialization
  for every cleanup (spec 017) and archive (spec 025) action.
- [ ] **T-022** When source resolves to `protected` and
  `block_permanent_delete = true`, rewrite `delete` to `archive` and record
  the rewrite on the plan item.
- [ ] **T-023** Implement contract handler for `plan.protection.check`
  (`crates/app/core/`) returning `has_protected_items` and protected-item
  details; surface `plan.not_found` error.
- [ ] **T-024** Add acknowledgement UI in plan review (`apps/desktop/`)
  blocking execution until every protected item is acknowledged.
- [ ] **T-025** Emit `protection.plan.acknowledged` audit events at
  acknowledgement time.

## US4 — Protected Category Enforcement (P4)

- [ ] **T-030** Persist `protected_categories` as a JSON-encoded `array<string>`
  in SQLite (A4). The UI parses/renders it as a comma-separated string (e.g.
  `"lights, masters, finals"`); whitespace is trimmed and empty tokens are
  ignored on parse. The canonical storage form is always the JSON array.
- [ ] **T-031** Resolve effective categories per source: per-source override
  if present, else global list.
- [ ] **T-032** Map plan-item targets to categories (frame type / role from
  metadata in spec 010); pass category into `resolve_protection`.
- [ ] **T-033** Ensure `matched_categories` is populated on plan items that
  were elevated to `protected` solely by category membership.
- [ ] **T-034** Document protected categories behavior in user-facing settings
  hint copy.

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
