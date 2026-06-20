# Implementation Plan — Standard-Library Adoption & Structural Modernization (042)

**Branch**: `042-stdlib-adoption` (worktree) | **Date**: 2026-06-20
**Spec**: [spec.md](./spec.md) | **Research**: [research.md](./research.md) | **Data model**: [data-model.md](./data-model.md)

## Summary

Replace hand-rolled code with mature libraries and idiomatic patterns across both
stacks, de-duplicate copy-pasted helpers, harden the Rust↔TS boundary, and make narrow
crate-structure fixes — anchored on `store.ts` → TanStack Query. 16 independently
shippable user stories (US1–US16). DB schema, IPC command **semantics**, and Rust domain
invariants are unchanged; only the enumerated defects are fixed.

## Technical Context

- **Frontend**: React 19 + TypeScript 5.8 + Vite 7, Tauri v2, vitest 4 (jsdom). Generated
  IPC bindings via specta in `apps/desktop/src/bindings/index.ts` (authoritative).
- **Rust**: workspace of ~22 crates, edition 2021, clippy pedantic at warn (already
  green), `thiserror 2`, `tracing 0.1`, `serde`, `time 0.3`, `tokio`, `sqlx 0.9`,
  `specta`/`schemars` already present.
- **New npm deps (pinned, current as of 2026-06-20)**: `@tanstack/react-query@5.101.0`,
  `@tanstack/react-table@8.21.3`, `use-debounce@10.1.1`, `date-fns@4.4.0`,
  `tinykeys@4.0.0`, `pathe@2.0.3`, `zod@4.4.3`, `react-hook-form@7.80.0`,
  `@hookform/resolvers@5.4.0`. Already in tree: `@tanstack/react-virtual`,
  `@base-ui-components/react`, `lucide-react`, `clsx`.
- **New Rust deps (pin to current at implementation time via cargo / mcp-package-version
  has no crates.io checker)**: `anyhow`, `tracing-subscriber`, `strum`(+derive),
  `percent-encoding`, `globset`, `itertools`, `csv`, `byteorder`, `path-clean`, `camino`,
  `moka`, `dashmap`; dev-only: `rstest`, `proptest`. `serde_json` already present.
  Several (`camino`, `byteorder`, `globset`, `itertools`) are already in `Cargo.lock`
  transitively.

## Constitution Check

| Principle | Compliance |
|-----------|------------|
| I. Local-First File Custody | Unaffected — no change to file custody or root/path modeling. |
| II. Reviewable Filesystem Mutation | Unaffected — plan/audit semantics unchanged; `path-clean`/`spawn_blocking`/`camino` preserve the symlink-safety and reviewable-plan behavior; existing fs tests guard it. |
| III. PixInsight Boundary | Unaffected — no processing added; FITS `byteorder` swap is parsing-only. |
| IV. Research-Led Domain Modeling | Satisfied — `research.md` records options/tradeoffs/verdict per finding before implementation. |
| V. Portable Contracts & Durable Records | **Strengthened** — CB2 makes the language-neutral schema a *derived* artifact with an agreement test (closes the current Principle-V gap); the rejected internal HTTP API would have *added* a divergent surface. DB stays the durable record; O6 keeps on-disk representation byte-identical. |
| Deliberate dependencies | Each ADOPT justified in `research.md`; KEEP/REJECT items documented; no junk-drawer crate. |
| Gates | Per-story green gates (below) before marking complete; final real-Windows verification. |

**Result**: PASS (pre-design and post-design). No new [NEEDS CLARIFICATION].

## Project Structure (artifacts)

```
specs/042-stdlib-adoption/
  spec.md          research.md      plan.md       data-model.md
  contracts/       checklists/      tasks.md (next phase)
```

Implementation touches `apps/desktop/src/**` (US1–US7, US16 UI side), `crates/**`
(US8–US16), `apps/desktop/src-tauri/**` (US2 bindings, US16 channel), and
`packages/contracts/**` (US2 schema reconciliation).

## Sequencing & dependency graph (between stories)

```
P1: US1 (store→Query) ─┐
    US2 (boundary/types/ErrorCode/errMessage) ─┬─> US7 (FE type-safety; needs generated types as source)
                                               └─> US5 (forms reuse zod from US2 seam)
P2: US3 (virtualize)  US4 (base-ui)  US8 (Rust errors)  US9 (Rust enums)
    US11 (Rust dedup) ──> needs O2 base-crate promotion (US13 partial) for now_iso/new_id homes
P3: US6 (FE utils)  US10 (Rust utils)  US12 (caching/concurrency)
    US13 (crate restructure: O1 targeting split, O2 base, O3 app/core split, O5, O6 inversion)
    US14 (camino)   US15 (tests)   US16 (long-op contract)
```

Hard orderings:
- **US2 before US7** (generated types must be the source of truth first).
- **US11 needs the `domain_core` base-promotion** (an O2 slice of US13) so `now_iso`/
  `new_id` have a reachable home → land O2 early, even though the rest of US13 is late.
- **US2 ErrorCode enum** lands in `contracts_core` before the TS side consumes it.
- **O6 (persistence inversion)** is its own carefully-tested change, guarded by
  persistence tests + a DB byte-identity check; sequence after O2.
- **US13 app/core crate split (O3)** is the highest-risk story → staged **last**.

Within each story, implement incrementally and keep the repo green at every commit.

## Per-story implementation approach (concise)

- **US1**: add `QueryClient` + provider at the app root; define `queryKeys` factory
  (`data-model.md`); convert each consumer (`useProjects`/`useProjectDetail`/
  `useInventorySources`/inbox/guided/setup) to `useQuery`/`useMutation`; map each
  homegrown `invalidate` to `queryClient.invalidateQueries({queryKey})`; delete
  `data/store.ts`. Keep `commands.ts` camelCase args exact.
- **US2**: add `ErrorCode` Rust enum in `contracts_core` (specta `Type`, serde
  rename) → regenerate bindings; change command results to `Result<T, ContractError>`;
  re-export generated `_Serialize` types from `bindings/types.ts` then delete the
  hand-written structs, migrating field access across ~44 files; add `lib/errors.ts`
  (`errMessage`/`asError`) + `lib/error-messages.ts`; make `packages/contracts` schema
  derived + add an agreement test; finish the 3 `plans_*` raw invokes; add zod IPC-seam
  validation. Keep the `commands.bindings-guard` test green throughout.
- **US3**: wrap each long list in `useVirtualizer` mirroring `CalendarScroll`; fix
  `InboxList` indexer (map by index / precomputed `Map`).
- **US4**: replace ProjectsList dropdown with base-ui `Select`/`Menu`; TargetSearch
  combobox with base-ui Combobox/Popover; delete the hand-rolled click-outside/ARIA.
- **US5**: `react-hook-form` + `@hookform/resolvers/zod`; zod schemas aligned to the
  generated contract types; backend still validates on submit.
- **US6**: `use-debounce`, `date-fns` (one shared formatter), `@tanstack/react-table`
  (ProjectsList), `tinykeys` (one `useHotkeys` hook), `pathe`, `lucide-react` sweep.
- **US7**: typed mock fixtures, generated types in `useStatusSummary`, concrete
  `SettingsData`, `satisfies` in fixtures, empty-`catch` triage, delete `lib/display.ts`,
  exhaustive state-label fns.
- **US8**: `thiserror` derive for `GuidedFlowError`; `anyhow`+`.context()` at the app
  boundary incl. `.to_string()` sites; stray `eprintln!`→`tracing`; `tracing-subscriber`.
- **US9**: `TryFrom/FromStr` for `CalibrationKind` (single fallback) + inventory state;
  `strum` for first_run/prepared_source enum↔string.
- **US10**: `percent-encoding`, `time::Date`, `globset` (+ pattern matrix), `itertools`,
  `csv` (keep RA/Dec validation), `byteorder` (FITS, tests as guard), `path-clean`,
  `serde_json` (marker).
- **US11**: move `now_iso`/`new_id` to `domain_core`; `app/core/errors.rs`
  (`db_err`/`bus_err`, canonical NotFound) + `From<DbError> for ContractError`;
  `app/core/target_dto.rs`; settings descriptor table; share `parse_basic_row`.
- **US12**: `moka` TTL (DebounceTable); `dashmap` + RAII guard (ACTIVE_RUNS);
  `spawn_blocking` (executor); sync-ify SkipSet/RetryQueue.
- **US13**: O1 split `targeting`/`targeting-resolver`; O2 promote `domain_core` (+ deps);
  O3 group then split `app/core`; O5 drop `tokio` from `project/structure`; O6 move
  stored types to domain + map at app/core (DB byte-identical).
- **US14**: `camino::Utf8Path` across fs crates + IPC path serialization; Windows/UNC test.
- **US15**: `rstest` + `proptest` dev-deps; convert sanitizer/settings tests.
- **US16**: route plan-apply through `OperationHandle` + `OperationEvent` over a
  `tauri::ipc::Channel`; UI listener; (the dead per-feature event path retired for this flow).

## Verification per story (gate before "complete")

- Frontend touched: `cd apps/desktop && npx tsc --noEmit` (ignore the pre-existing
  TS5101 baseUrl warning) + `npx vitest run <touched feature>` (jsdom; `localStorage`
  shimmed in `vitest.setup.ts`; mock `commands.ts` wrappers as existing tests do).
- Rust touched: `cargo test -p <crate>` + `cargo clippy -p <crate> --all-targets -- -D
  warnings` per crate (full `cargo test --workspace` is red on main for unrelated
  reasons). `src-tauri` files are NOT covered by `cargo fmt --all` → run
  `rustfmt --edition 2021` on any touched `src-tauri` file.
- Whole repo at story boundaries: `just lint`, `just typecheck`, `just test`.
- **Behavioral**: do not mark complete on green gates alone — confirm real behavior; the
  final state is verified in the real Windows Tauri build (push → pull → recompile →
  click-through), per the project's Windows verify loop.
- Commit messages contain **no** AI attribution (pre-commit hook blocks it). Branch off
  `main`; squash-merge at the end.

## Risks & mitigations

| Risk | Mitigation |
|------|------------|
| `app/core` crate split (O3) is large/risky | Stage last; do internal grouping first (compiles green), then split per-domain incrementally; each split crate keeps the same public surface used by `desktop_shell`. |
| Persistence→domain type move (O6) could alter on-disk data | Keep serde/`#[serde(rename)]` + SQL column mapping identical; add a DB round-trip byte-identity check; persistence tests gate it; ship as its own commit. |
| FITS `byteorder` swap (J6) is correctness-critical | Existing FITS tests as the guard; behavior-equivalence required (FR-015); no `nom` rewrite. |
| `globset` ≠ hand-rolled glob semantics (J3) | Build a pattern×input equivalence matrix from all in-use artifact rules before switching. |
| `camino` broad blast radius (US14) | Sequence late; verify on real Windows incl. long/UNC paths. |
| Boundary retirement (US2, ~44 files) breaks mock mode | Keep the `commands.bindings-guard` test green; type the mock fixtures (US7 D2) so drift fails to compile. |
| TanStack Query invalidation gaps (US1) | Port the documented invalidation map 1:1 to query keys; assert refresh in feature vitest. |

## Phase outputs

- This phase: `plan.md`, `research.md`, `data-model.md`, `contracts/` (ErrorCode +
  query-key + boundary conventions). Next: `/speckit.tasks` (driven manually) → grouped,
  dependency-ordered `tasks.md`.
