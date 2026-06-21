# TinySpec: Canonical settings-key naming

**Branch**: 042-stdlib-adoption (implement after the in-progress main→042 merge is committed)
**Date**: 2026-06-21
**Status**: draft
**Complexity**: small

## What

Settings key-strings mix three styles: camelCase that mirrors the wire field
name (`autoApplyPattern`, `hashOnScan`), dotted-snake that does **not** match the
field's camelCase wire name (`calibration.dark_temp_tolerance`,
`plans.list.default_age_cutoff_days`), and plain snake (`current_library_id`,
`patterns_by_type`). Normalize every settings key to one rule. Greenfield — no
persisted-data migration. The serde `rename_all = "camelCase"` struct-field wire
boundary is correct and stays untouched; this changes **key strings only**.

## Canonical rule (decision)

**A settings key string equals the serde-camelCased wire name of its
`SettingsState` field.** The majority already comply; only the dotted/snake
outliers below change. This makes keys derivable from the struct and
test-enforceable.

| Old key | New key |
|---------|---------|
| `current_library_id` | `currentLibraryId` |
| `plans.list.default_age_cutoff_days` | `plansListDefaultAgeCutoffDays` |
| `calibration.dark_temp_tolerance` | `calibrationDarkTempTolerance` |
| `calibration.prefill_suggestion` | `calibrationPrefillSuggestion` |
| `calibration.dark.override_penalty` | `calibrationDarkOverridePenalty` |
| `calibration.flat.override_penalty` | `calibrationFlatOverridePenalty` |
| `calibration.bias.override_penalty` | `calibrationBiasOverridePenalty` |
| `calibration.aging_threshold_days` | `calibrationAgingThresholdDays` |
| `imagetyp_normalization.user_mappings` | `imagetypNormalizationUserMappings` |
| `patterns_by_type` | `patternsByType` |

## Context

| File | Role |
|------|------|
| `crates/app/settings/src/descriptors.rs` | Modify — `key:` entries, `NOISY_KEYS`, `OVERRIDABLE_KEYS`, validation match arms |
| `crates/persistence/db/src/repositories/settings.rs` | Modify — read/write key match arms + `PATTERNS_BY_TYPE_KEY` const |
| `apps/desktop/src/features/settings/*` | Modify — any literal key references |
| (repo-wide consumers) | Modify — crates/use-cases reading old keys (e.g. calibration, plans) — grep each old string |
| `crates/app/settings/src/` tests | Add — guard test: every `SettingsState` wire field name ∈ key registry and vice versa |

## Requirements

1. Every key in the table above is renamed to its camelCase wire-field form at all definition sites.
2. Every **consumer** of a renamed key (repo-wide, not just settings) is updated; no old key string remains.
3. `NOISY_KEYS` / `OVERRIDABLE_KEYS` / validation arms reference the new keys.
4. The serde `rename_all` struct-field boundary is unchanged.
5. A guard test asserts the key set is exactly the set of `SettingsState` camelCase wire field names.

## Plan

1. Update `descriptors.rs` keys, NOISY/OVERRIDABLE lists, and validation arms.
2. Update `persistence/.../settings.rs` match arms + `PATTERNS_BY_TYPE_KEY`.
3. Repo-wide: `rg` each old key string; update every remaining consumer + frontend literal.
4. Add the key↔field guard test.

## Tasks

- [ ] Rename keys in `descriptors.rs` (entries, NOISY_KEYS, OVERRIDABLE_KEYS, validation)
- [ ] Rename keys in persistence `settings.rs` (match arms + `PATTERNS_BY_TYPE_KEY`)
- [ ] `rg` old strings repo-wide; update all consumers + `features/settings/*` literals
- [ ] Add key↔wire-field guard test
- [ ] `cargo clippy`/`test` for touched crates + `tsc`/`vitest` for settings frontend

## Done When

- [ ] All tasks checked off; no old key string anywhere (`rg` clean)
- [ ] Guard test passes; touched-crate + settings-frontend gates green
- [ ] No lint errors
