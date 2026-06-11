# Tasks: Token Pattern Builder

**Feature**: `015-token-pattern-builder`

Tasks are grouped by user story so each group is independently testable. Tasks
marked **[mockup-done]** are already realized in `apps/desktop/` and require
only verification when the resolver lands.

## US1 — Build Project Folder Pattern (P1)

- **T1.1 [mockup-done]** `TokenPatternBuilder` component renders token and
  separator chips with add/remove menus. Source: `apps/desktop/src/ui/TokenPattern.tsx`.
- **T1.2 [mockup-done]** Library default pattern persists as `PatternPart[]`
  via `apps/desktop/src/data/settings.ts`.
- **T1.3 [done]** Wire add/remove operations through `pattern.validate` so structural
  warnings (consecutive separators, leading/trailing separator,
  no_path_separator) surface inline on the Naming & Structure pane.
  Evidence: `apps/desktop/src/features/settings/NamingStructure.tsx` calls
  `patternValidate()` on every pattern change; warnings rendered inline.
- **T1.4 [done]** Block saving when `pattern.validate` returns `valid: false`
  (`pattern.empty` or `token.unknown`).
  Evidence: `NamingStructure.tsx` `canSave` flag gates save; error rendered.
- **T1.5 [done]** Unit tests for the token registry's `value`-set assertion and the
  separator allow-list (UI guard).
  Evidence: `crates/patterns/src/registry.rs` tests (v1_registry_contains_all_tokens,
  v1_registry_fallbacks_match_data_model); `crates/patterns/src/validator.rs` tests
  (valid_separators_pass, invalid_separator_is_invalid).

**Acceptance**: A user can build a pattern using each v1 token and each v1
separator, see warnings update live, and cannot save an invalid pattern.

## US2 — Live Preview Against Recent Metadata (P2)

- **T2.1 [mockup-done]** `PatternPreview` component shape (`{ path, count? }`).
  Source: `apps/desktop/src/ui/TokenPattern.tsx`.
- **T2.2 [done]** Replace mock preview rows in `NamingStructureSection` with a live
  preview that resolves the current pattern against sample metadata via `pattern.preview`.
  Evidence: `NamingStructure.tsx` calls `patternPreview()` on every edit; result shown in Live Preview section.
  Note: resolves against fixed sample metadata (T2.2 partial — inventory session data
  not wired because session repository is out of spec 015 scope; deferred to spec 018).
- **T2.3 [deferred]** Group preview rows by resolved destination and aggregate frame
  counts. Deferred: requires inventory session data (spec 018 scope).
- **T2.4 [done]** Show fallback substitution affordance in preview rows
  (e.g. dim `unclassified` segments) sourced from `ResolveResult.missing_tokens`.
  Evidence: `NamingStructure.tsx` renders `(fallback used for: ...)` annotation next to resolved path.
- **T2.5 [done]** Empty-state row when the pattern is empty.
  Evidence: `NamingStructure.tsx` shows `— (invalid or empty pattern)` when `!canSave`.

**Acceptance**: Editing the pattern updates preview rows within one frame; rows
with fallback substitutions are visibly distinguished.

## US3 — Resolve Pattern at Inbox Confirm (P3)

- **T3.1 [done]** Define **`crates/patterns/`** crate with `Pattern`, `PatternPart`,
  `TokenDefinition`, `TokenRegistry`, `ResolverConfig` types. Added as workspace member.
  Evidence: `crates/patterns/Cargo.toml`, `crates/patterns/src/lib.rs`,
  workspace `Cargo.toml` member `"crates/patterns"`.
- **T3.2 [done]** Implement the v1 token registry (R1, data-model.md). Include the
  `date_obs_local` source field mapping with UTC fallback. (Ref: R-Date-1)
  Evidence: `crates/patterns/src/registry.rs` V1_DEFINITIONS with `date` → `date` source_field,
  `DateIso` transform; tests in registry::tests and resolver::tests::date_*
- **T3.3 [done]** Implement value sanitization pipeline:
  - Step 1: `crates/patterns/src/sanitize.rs` step1_normalize_and_strip (NFC + disallowed chars). 23 tests.
  - Step 2: step2_substitute_reserved_chars (Windows chars → `_`, trim dots/spaces).
  - Step 3: step3_traversal_check (`.` / `..` → path.traversal). Runs before step2.
  - Step 4: step4_reserved_name_check (CON/PRN/AUX/NUL/COM1-9/LPT1-9 case-insensitive).
  - Step 5: step5_confusables_check via `unicode-security` crate MixedScript::is_single_script.
- **T3.4 [done]** Implement `resolve(pattern, metadata, config) -> ResolveResult`
  with fallback substitution and `missing_tokens` accumulation.
  Evidence: `crates/patterns/src/resolver.rs`; 15 resolver tests all passing.
- **T3.5 [done]** Implement `validate(pattern) -> ValidateResult` plus `pattern.empty`,
  `token.unknown`, and structural warnings.
  Evidence: `crates/patterns/src/validator.rs`; 11 validator tests all passing.
- **T3.6 [done]** OS-path post-resolution check: segment > 200 UTF-8 bytes or total > 200 chars
  → `pattern.invalid` with `resolvedLength` / `segmentLengthBytes`.
  Evidence: `crates/patterns/src/resolver.rs` steps 4b/4c; tests segment_over_200_bytes_rejected,
  total_path_over_200_chars_rejected.
- **T3.7 [done]** Contract DTOs for `pattern.resolve`, `pattern.validate`, `pattern.preview`
  in `crates/contracts/core/src/patterns.rs` matching JSON Schemas. (Ref: R-Preview)
  Evidence: `crates/contracts/core/src/patterns.rs`; registered in lib.rs.
- **T3.8 [done]** Tauri adapter wiring.
  Evidence: `apps/desktop/src-tauri/src/commands/patterns.rs` (pattern_validate, pattern_resolve,
  pattern_preview); registered in `commands/mod.rs` and `lib.rs` collect_commands!.
- **T3.9 [done]** Unit tests: 56 tests in `crates/patterns/` + 9 in `crates/app/core/src/patterns.rs`.
  Covers: each fallback default, full sanitization pipeline, traversal, reserved names,
  confusables, date_iso, length caps, canonical end-to-end fixture.
- **T3.10 [deferred]** Contract conformance test (JSON Schema validation of request/response payloads).
  Deferred: requires a JSON Schema validation dependency in the test crate. Left for
  post-implementation quality pass. The DTOs structurally match the JSON Schemas in
  `specs/015-token-pattern-builder/contracts/` by construction.
- **T3.11 [done]** Wire `pattern.preview` in Settings UI live preview.
  Evidence: `apps/desktop/src/features/settings/NamingStructure.tsx` `runPreview()`
  called on every pattern edit via `useEffect`.

**Acceptance**: Given a metadata bundle, the resolver produces the expected
relative path and missing-token list; given a malformed pattern, the resolver
returns the documented error code.

## US4 — Per-Source Override Propagation (P4)

- **T4.1 [mockup-done]** Override row stubs visible in the Naming & Structure
  section. Source: `apps/desktop/src/features/settings/SettingsPage.tsx`
  (`NamingStructureSection`).
- **T4.2 [deferred-spec018]** Persist per-source overrides as `{ source_id, pattern }` rows.
  The `source_overrides` table from migration 0013 has the right shape (`source_id, key, value`);
  `pattern` can be stored as a JSON array value with key `"pattern"`. The contract surface
  (PatternResolveRequest + resolution order) is already in place. Full wiring deferred to spec 018
  which owns the Inbox confirm pipeline and source override UI.
- **T4.3 [deferred-spec018]** Inbox confirm pipeline integration deferred to spec 018.
  The resolver is ready to consume per-source patterns.
- **T4.4 [deferred]** Per-source preview groups deferred. Requires inventory session data.

**Acceptance**: An override on source A changes resolved destinations for
source A only; sources without overrides continue using the library default.

## Cross-cutting

- **TX.1 [deferred]** Document the token registry in user-facing docs (token name,
  source field, default fallback). Deferred to documentation pass.
  The registry is self-documented in `crates/patterns/src/registry.rs` V1_DEFINITIONS.
- **TX.2 [deferred]** Add a migration note to `docs/research/` describing the
  `token.unknown` error path. Deferred to documentation pass.

## Dependency Graph

- US1 → US2 (preview reads validation results).
- US3 → US2 (live preview calls the resolver).
- US3 → US4 (override propagation calls the resolver).
- US1, US2 can ship UI-only against a stub resolver; US3 unblocks real
  destinations and Inbox confirm.

## Stop Condition

Implementation pauses here. The next phase (spec 018: Naming & Structure)
consumes the resolver and override storage.
