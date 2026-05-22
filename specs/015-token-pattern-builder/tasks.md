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
- **T1.3** Wire add/remove operations through `pattern.validate` so structural
  warnings (consecutive separators, leading/trailing separator,
  no_path_separator) surface inline on the Naming & Structure pane.
- **T1.4** Block saving when `pattern.validate` returns `valid: false`
  (`pattern.empty` or `token.unknown`).
- **T1.5** Unit tests for the token registry's `value`-set assertion and the
  separator allow-list (UI guard).

**Acceptance**: A user can build a pattern using each v1 token and each v1
separator, see warnings update live, and cannot save an invalid pattern.

## US2 — Live Preview Against Recent Metadata (P2)

- **T2.1 [mockup-done]** `PatternPreview` component shape (`{ path, count? }`).
  Source: `apps/desktop/src/ui/TokenPattern.tsx`.
- **T2.2** Replace mock preview rows in `NamingStructureSection` with a live
  preview that resolves the current pattern against the most recent N
  inventory sessions per source.
- **T2.3** Group preview rows by resolved destination and aggregate frame
  counts.
- **T2.4** Show fallback substitution affordance in preview rows
  (e.g. dim `unclassified` segments) sourced from `ResolveResult.missing_tokens`.
- **T2.5** Empty-state row when the pattern is empty.

**Acceptance**: Editing the pattern updates preview rows within one frame; rows
with fallback substitutions are visibly distinguished.

## US3 — Resolve Pattern at Inbox Confirm (P3)

- **T3.1** Define **`crates/patterns/`** crate (previously `crates/project/structure/`
  — split per R-CratePatterns, 2026-05-22) with `Pattern`, `PatternPart`,
  `TokenDefinition`, `TokenRegistry`, `ResolverConfig` types. Add as workspace member.
- **T3.2** Implement the v1 token registry (R1, data-model.md). Include the
  `date_obs_local` source field mapping with UTC fallback. (Ref: R-Date-1)
- **T3.3** Implement value sanitization pipeline (R4 updated 2026-05-22):
  - Step 1: NFC normalization + strip C0/C1 controls, format chars, bidi overrides. (Ref: A1)
  - Step 2: OS character substitution (Windows reserved chars → `_`, trim whitespace/dots).
  - Step 3: Path traversal rejection — if token value is `.` or `..` or assembled path
    contains `..`, return `path.traversal`. (Ref: A2)
  - Step 4: Windows reserved device name rejection (CON, PRN, AUX, NUL, COM1-9, LPT1-9),
    case-insensitive, all platforms → `path.reserved_name`. (Ref: A3)
  - Step 5: Unicode confusables detection via `unicode-security` crate → `pattern.invalid.unicode`. (Ref: A1)
- **T3.4** Implement `resolve(pattern, metadata, config) -> ResolveResult`
  with fallback substitution and `missing_tokens` accumulation.
- **T3.5** Implement `validate(pattern) -> ValidateResult` plus `pattern.empty`,
  `token.unknown`, `path.reserved_name`, and `pattern.invalid.unicode` errors
  (for static checks on separator/literal values).
- **T3.6** OS-path post-resolution check producing `pattern.invalid` with
  `violating_chars`, `resolved_length`, and `segment_length_bytes` (≤200 bytes
  per segment, ≤200 chars total). (Ref: A4)
- **T3.7** Implement the `pattern.resolve`, `pattern.validate`, and
  `pattern.preview` operations in `crates/contracts/core/` matching the JSON
  Schemas under `contracts/`. (Ref: R-Preview)
- **T3.8** Tauri adapter wiring so the desktop shell can call all three operations.
- **T3.9** Unit tests covering: each fallback default, full sanitization pipeline
  (Unicode strip, traversal, reserved name, confusables), consecutive separators,
  unknown token error, date_iso transform (with and without observer_location),
  path length caps, and an end-to-end `{target}/{filter}/{date}/{frame_type}/` fixture.
- **T3.10** Contract conformance test: request/response payloads validate against
  the JSON Schemas for pattern.resolve, pattern.validate, and pattern.preview.
- **T3.11** Wire `pattern.preview` in the Settings UI live preview: each edit to
  the pattern triggers a `pattern.preview` call and updates the displayed example
  path within one frame. (Ref: R-Preview)

**Acceptance**: Given a metadata bundle, the resolver produces the expected
relative path and missing-token list; given a malformed pattern, the resolver
returns the documented error code.

## US4 — Per-Source Override Propagation (P4)

- **T4.1 [mockup-done]** Override row stubs visible in the Naming & Structure
  section. Source: `apps/desktop/src/features/settings/SettingsPage.tsx`
  (`NamingStructureSection`).
- **T4.2** Persist per-source overrides as `{ source_id, pattern }` rows in
  the settings store (handoff to `crates/persistence/db/` schema is owned by
  spec 018; this task captures the contract surface only).
- **T4.3** Inbox confirm pipeline (spec 018) reads the override for the item's
  source if present, otherwise uses the library default. This spec contributes
  the pattern lookup contract; the pipeline integration lives in spec 018.
- **T4.4** Preview rows in the Naming & Structure pane render one group per
  source so override impact is visible.

**Acceptance**: An override on source A changes resolved destinations for
source A only; sources without overrides continue using the library default.

## Cross-cutting

- **TX.1** Document the token registry in user-facing docs (token name,
  source field, default fallback).
- **TX.2** Add a migration note to `docs/research/` describing the
  `token.unknown` error path so future vocabulary changes can plan the
  rollout.

## Dependency Graph

- US1 → US2 (preview reads validation results).
- US3 → US2 (live preview calls the resolver).
- US3 → US4 (override propagation calls the resolver).
- US1, US2 can ship UI-only against a stub resolver; US3 unblocks real
  destinations and Inbox confirm.

## Stop Condition

Implementation pauses here. The next phase (spec 018: Naming & Structure)
consumes the resolver and override storage.
