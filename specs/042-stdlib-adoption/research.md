# Research & Discovery Inventory — Standard-Library Adoption (042)

**Date**: 2026-06-20
**Method**: Multi-agent read-only discovery across both stacks (Rust `crates/*`, the
Tauri v2 + React app `apps/desktop`), plus quantitative tooling (`jscpd`, `madge`,
`scc`, `cargo` dep graphs, structural `rg`/ast-grep). Each finding carries a verdict:
**ADOPT** (use a library) · **REFACTOR** (idiomatic pattern, no dep) · **CONSOLIDATE**
(de-duplicate into a single home) · **KEEP** (hand-rolled is justified) · **DEFER**
(real but too large/risky here) · **REJECT** (a library exists but isn't warranted).

**Decision context**: the maintainer chose *maximal adoption* under the constitution's
"deliberate dependencies" principle — adopt every ADOPT/REFACTOR/CONSOLIDATE finding,
including items first marked DEFER, except the explicit rejections in §R. Verdicts below
reflect the **final** decisions.

**Evidence caveat**: file:line references come from the discovery agents; the
load-bearing/contested claims (walkdir, `db_err` divergence, react-virtual usage,
`as unknown as` count, the original-repo branch binding) were verified directly. The
`knip` "163 unused files / react-virtual unused" signal was a **false positive** (knip
could not load the vite/vitest config in the worktree) and is disregarded.

---

## A. Frontend — server state & data fetching

| ID | Verdict | Finding & evidence | Decision |
|----|---------|--------------------|----------|
| A1 | **ADOPT** | Homegrown store `apps/desktop/src/data/store.ts` (`createStore`/`createParameterizedStore` on `useSyncExternalStore`); **fetch-in-render** at `store.ts:83`, **unbounded param-Map** at `store.ts:110`. Consumers: `ProjectsPage:63`, `ProjectDetail:73`, `SessionsPage:50`, `StepSources:20`, `inbox/store.ts`, `guided/store.ts`. | **@tanstack/react-query** (US1). Retire store.ts. Idiomatically consistent with the TanStack Router/Virtual already in-tree. Subsumes the `{loading,data,error}` boolean-triple illegal-state shape. |

**Rationale**: highest-confidence adoption; removes two real defects; sets query-key +
invalidation conventions the rest of the frontend reuses.

## B. Frontend — installed UI frameworks

| ID | Verdict | Finding & evidence | Decision |
|----|---------|--------------------|----------|
| B1 | **ADOPT** | 500-row lists not virtualized: `LogPanel.tsx:332`, `InboxList.tsx:120` (+ O(n²) `items.indexOf` at `:122`), `TargetList.tsx:38`, `TargetSearch.tsx:438`. react-virtual is installed and proven in `CalendarScroll.tsx:55`. | **@tanstack/react-virtual** everywhere (US3) + fix the O(n²) lookup. |
| B2 | **ADOPT** | Hand-rolled filter dropdown with **real bugs (no click-outside, no Escape)** `ProjectsList.tsx:142-172`; 499-line hand-rolled combobox `TargetSearch.tsx`. base-ui used in 11 files (dialogs) but Select/Menu/Combobox/Popover never used. | **@base-ui-components** Select/Menu/Combobox/Popover everywhere (US4). |
| B3 | **REFACTOR** | lucide imported in only 2 files; inline `<svg>` duplicated elsewhere. | **lucide-react** everywhere (US6). |
| B4 | **KEEP** | `cmdk` (CommandPalette), `react-joyride` (GuidedOverlay), base-ui dialogs, `clsx` — all idiomatic. | Leave alone. |
| B5 | **DEFER (retain)** | `react-resizable-panels` installed, **0 imports** (verified). | **Keep the dep** for a future split-view; do NOT remove (maintainer decision). |

## C. Frontend — reinvented utilities

| ID | Verdict | Finding & evidence | Decision |
|----|---------|--------------------|----------|
| C1 | **ADOPT** | 2 hand-rolled `setTimeout` debounces (TargetSearch, `ProjectNotesSection` autosave). | **use-debounce** (US6). |
| C2 | **ADOPT** | 3 near-identical date formatters + date sorts: `LogPanel.tsx:49`, `manifests.ts:62`, `AuditLog.tsx:18/43`, `ProjectsList.tsx:90`. | **date-fns** via one shared formatter (US6). |
| C3 | **ADOPT** | Manual sort/filter state `ProjectsList.tsx:81-100`. | **@tanstack/react-table** (US6); pairs with react-virtual. |
| C4 | **ADOPT** | 3+ global keydown handlers: `CommandPalette.tsx:66`, `LogPanel.tsx:129`, `ActionSidebar.tsx:71`. | **tinykeys** (US6). |
| C5 | **ADOPT** | Manual path split/normalize (`replace(/\\/g,'/')`, `split('/').pop()`) in `picker.ts`, `ToolLaunchesAccordion.tsx`. | **pathe** (US6). |

## D. Frontend — type safety & IPC boundary

| ID | Verdict | Finding & evidence | Decision |
|----|---------|--------------------|----------|
| D1 | **REFACTOR** | Parallel snake_case type universe `bindings/types.ts` bridged by **26 `as unknown as`** (verified) + ~91 `as` casts across ~44 files. Root cause of prior casing bugs. | Full retirement → generated camelCase `_Serialize` types (US2). |
| D2 | **REFACTOR** | `mockInvoke<T>` blind `as T` casts (`mocks.ts:100+`, ~40 sites) hide camel/snake drift. | Typed fixtures per command (US7). |
| D3 | **REFACTOR** | `useStatusSummary.ts:46-56` `Record<string,unknown>` hand-parse of already-typed result. | Consume generated types (US7). |
| D4 | **REFACTOR** | `SettingsData { [k]: unknown }` (`bindings/types.ts:95`); untyped `filters?` bags (`commands.ts:115…`). | Concrete/generated shapes (US7). |
| D5 | **REFACTOR** | Literal `as Union` (accepts typos) `fixtures/calibration.ts:113-129`. | `satisfies` (US7). |
| D6 | **KEEP** | `ipc.ts` `unwrap` discriminated union; `route-contract.ts` exemplar. | Leave alone. |

## E. Frontend — string/message & error handling

| ID | Verdict | Finding & evidence | Decision |
|----|---------|--------------------|----------|
| E1 | **REFACTOR** | `instanceof Error ? .message : String(err)` ×15 + unsafe `(err as Error)?.message` ×8 across 12 files. | One `lib/errors.ts` `errMessage()`/`asError()` (US2). |
| E2 | **REFACTOR** | ~30 empty `catch {}` swallow errors (first-run:37, useStatusSummary:59, ProjectDetail:118/130/167, WizardPage:36/45/53, …). | Triage: log/narrow/annotate-intentional (US7). |
| E3 | **REFACTOR** | `ERROR_MESSAGES` map currently inline in `commands.ts` (good pattern, wrong home). | Move to its own module (US2). |

## CB. Cross-boundary (Rust ↔ TS)

| ID | Verdict | Finding & evidence | Decision |
|----|---------|--------------------|----------|
| CB1 | **REFACTOR** | Error codes are magic strings duplicated both sides (`'plan.required'`, `'alias.duplicate'`, `'target.not_found'`, `"internal.database"`, `'launch.failed'`). | Single shared **`ErrorCode` enum** (Rust → generated TS) (US2). |
| CB2 | **REFACTOR** | Two type generators: live specta `bindings/index.ts` vs **orphaned** JSON-Schema `packages/contracts` (never imported by the app), no agreement test. | Derive JSON-Schema from the same reflection + add an agreement test (US2). |
| CB3 | **REFACTOR** | 3 residual raw `invoke<>` bypass bindings: `commands.ts:170/322/328` (`plans_*`). | Route through `commands.*` (finish spec-037 tail) (US2). |
| CB4 | **REFACTOR** | `_Serialize`/`_Deserialize` dual-DTO flood (349/311) + per-file aliasing `commands.ts:23-105`. | Collapse + one generated alias module (US2). |
| CB5 | **ADOPT (was DEFER)** | `OperationHandle`/`OperationEvent` contract defined but dead (only `envelope.rs`); long-ops use ad-hoc per-feature events. | Adopt end-to-end for plan-apply over a `tauri::ipc::Channel` (US16). |
| CB6 | **REFACTOR (was DEFER)** | Errors transported as bare `string`, not the rich `ContractError`. | `Result<T, ContractError>` as the wire error type (US2). |
| CB7 | **REJECT** | An internal HTTP/JSON-RPC API. | Tauri IPC stays the transport; portability preserved via the language-neutral contracts. Adding HTTP would create a 3rd contract surface + a local attack surface for zero present benefit. |

## H. Rust — error handling & logging

| ID | Verdict | Finding & evidence | Decision |
|----|---------|--------------------|----------|
| H1 | **REFACTOR** | Manual `Display` impl `guided_flow.rs:137`. | `thiserror` derive (US8). |
| H2 | **REFACTOR** | Stray production `eprintln!` `transition_use_case.rs`. | `tracing` (US8). Tests keep `eprintln!`. |
| H3 | **REFACTOR (was DEFER)** | Systematic `.to_string()` error-context loss (`confirm.rs:128/144/…`, `prepared_views.rs`, `simbad.rs:328`). | `anyhow` + `.context()` at the app boundary (US8). |
| H4 | **KEEP** | `tracing` already pervasive; add `tracing-subscriber` config. `time` is the right logging timestamp source. | `tracing` is the correct standard (async-aware); no better mainstream option. |

## I. Rust — string/enum typing

| ID | Verdict | Finding & evidence | Decision |
|----|---------|--------------------|----------|
| I1 | **REFACTOR** | **Latent bug**: `CalibrationKind` parsed inline with divergent fallback `_=>Dark` (`sessions.rs:332`) vs `_=>None` (`calibration.rs:594/666/907`). | One `TryFrom/FromStr`, single fallback, parse at repo boundary (US9). |
| I2 | **REFACTOR** | Silent `_=>Discovered` parse `inventory.rs:331`; missing `From`. | `TryFrom`/`From` (US9). |
| I3 | **ADOPT** | `*_to_str`/`str_to_*` pairs with silent-default footgun: `first_run.rs:25-48`; `prepared_source.rs:102/166/225`. | **strum** (`EnumString`/`Display`) (US9). |
| I4 | **KEEP** | FrameType/PlanItemAction/PlanState already enum-bounded. | Leave alone. |

## J. Rust — reinvented utilities

| ID | Verdict | Finding & evidence | Decision |
|----|---------|--------------------|----------|
| J1 | **ADOPT** | Hand-rolled RFC-3986 `url_encode` `simbad.rs:355-376`. | **percent-encoding** (US10). |
| J2 | **ADOPT** | Hand-rolled ISO-8601 + Gregorian day-of-year math `calibration/ranking.rs:195-240`. | **time** (`Date::parse`/`to_julian_day`) (US10). |
| J3 | **ADOPT** | `glob_match_recursive` (subtle backtracking) `workflow/artifacts/rules.rs:108-124`. | **globset** + a pattern equivalence matrix (US10); classification is domain-critical. |
| J4 | **ADOPT** | `dedup_by_tool` + scattered dedup (`workflow/profiles/discover.rs`, targeting). | **itertools** `dedup_by`/`unique` (US10). |
| J5 | **ADOPT (was KEEP/DEFER)** | `parse_basic_row` TSV with RA/Dec domain validation `simbad.rs:333` (also duplicated in seed-builder). | **csv** for tokenization, keep RA/Dec validation; de-dup the two copies (US10/US11). |
| J6 | **ADOPT (was DEFER)** | Hand-rolled FITS header byte parsing `metadata/fits`. | **byteorder** — carefully, existing FITS tests as guard (US10). |
| J7 | **ADOPT (was DEFER)** | Lexical path normalization `path_gate.rs:117-150`. | **path-clean** (US10); keep the symlink/junction safety logic. |
| J8 | **ADOPT (was DEFER)** | Hand-written JSON marker `project/structure/lib.rs:132`. | **serde_json** (US10). |
| J9 | **KEEP** | targeting `tokenize`/sort/dedup (spec-driven), `unquote`/`collapse_spaces`, Caldwell parser. | Idiomatic/domain — leave alone. |

## K. Rust — caching & concurrency

| ID | Verdict | Finding & evidence | Decision |
|----|---------|--------------------|----------|
| K1 | **ADOPT** | `DebounceTable` unbounded `HashMap<_,Instant>` `project_health.rs:89` (grows forever). | **moka** TTL cache (auto-evicts) (US12). |
| K2 | **ADOPT** | `ACTIVE_RUNS` `OnceLock<Arc<Mutex<HashMap>>>` `plan_apply.rs:53` (coarse lock; leak-on-panic risk). | **dashmap** + RAII removal guard (US12). `parking_lot` was the conservative alternative; maintainer chose dashmap. |
| K3 | **REFACTOR** | Blocking `std::fs` reached from async task (no `spawn_blocking`): `plan_apply.rs:483` → sync `execute_item`. | `tokio::task::spawn_blocking` (confirm threading) (US12). |
| K4 | **REFACTOR** | `SkipSet`/`RetryQueue` `Arc<Mutex<HashSet>>` force async `fs/executor/run.rs:211/234`. | Make sync / use `watch` (US12). |
| K5 | **KEEP** | broadcast/watch channels, 8 `tokio::spawn`, 15 production unwraps. | Leave alone. |

## L. Rust — duplication → shared homes

| ID | Verdict | Finding & evidence | Decision |
|----|---------|--------------------|----------|
| L1 | **CONSOLIDATE** | `now_iso()` **~28 copies** across app/core, persistence/db, targeting, fs, seed-builder. | One helper on `domain_core` `Timestamp` (US11). |
| L2 | **CONSOLIDATE** | `db_err` **diverged → bug**: `plans.rs:60` maps NotFound→recoverable; most sites collapse NotFound→`Fatal "internal.database"`. Plus `bus_err`. | Single canonical mapper in `app/core/errors.rs` (recoverable NotFound) (US11). |
| L3 | **CONSOLIDATE** | `new_id()` ×5. | `domain_core` `EntityId` (US11). |
| L4 | **CONSOLIDATE** | `map_object_type` (12-arm) + `map_source` identical ×2 (`target_resolve.rs:94/111`, `target_search.rs:33/50`). | `app/core/target_dto.rs` (US11). |
| L5 | **CONSOLIDATE** | `parse_basic_row` ×2 (`simbad.rs:333`, `seed-builder:388`). | `pub` in `targeting` (US11). |
| L6 | **REFACTOR** | 123× `.map_err(db_err)?`. | `impl From<DbError> for ContractError` (US11). |
| L7 | **REFACTOR** | Settings schema in 3 parallel match arms (`settings.rs:~186/~502/apply_row`). | One key-descriptor table (US11). |

## M. Rust — filesystem / metadata / paths

| ID | Verdict | Finding & evidence | Decision |
|----|---------|--------------------|----------|
| M1 | **ADOPT (was DEFER)** | Path types crossing IPC use lossy `to_string_lossy()`. | **camino** `Utf8Path` across fs crates + IPC path serialization (US14); Windows/UNC verification required. |
| M2 | **REJECT** | walkdir. | **Verified**: no `read_dir`/recursion exists anywhere; the app uses `notify`. Nothing to replace. |
| M3 | **KEEP** | quick-xml (XISF), unicode-normalization/security (sanitize), `trash`, move_op/path_gate symlink+junction handling (constitutional), notify watcher. | Leave alone (FITS `nom` not adopted — `byteorder` only, see J6). |

## N. Rust — tests

| ID | Verdict | Finding & evidence | Decision |
|----|---------|--------------------|----------|
| N1 | **ADOPT (dev-only)** | 1133 tests, 0 parameterization; 27 near-identical sanitizer cases; per-key settings validation. | **rstest** (+ **proptest** for sanitizer invariants) (US15). |

## O. Workspace / crate structure

| ID | Verdict | Finding & evidence | Decision |
|----|---------|--------------------|----------|
| O1 | **ADOPT** | `targeting` (a *domain* crate) pulls `sqlx`+`reqwest`+`tokio` via its SIMBAD resolver. | **SPLIT** → `targeting` (pure) + `targeting-resolver` (US13). |
| O2 | **ADOPT** | `domain_core` is NOT the base layer — only 6 crates depend on it; 13 don't (why `now_iso` is copied 28×). | Promote `domain_core` to true base; add the dep to the ~13 crates (US13). |
| O3 | **ADOPT (was DEFER)** | `app/core` god-crate: 22k LOC / 39 files / ~33 flat modules. | Group into `targets/ projects/ inbox/ calibration/ lifecycle/` **and** split into per-domain use-case crates (US13; staged last, highest risk). |
| O4 | **ADOPT** | Error mappers belong app-internal. | `db_err`/`bus_err`/`map_object_type` → internal `app/core` modules (US11/US13). |
| O5 | **ADOPT** | Pure `project/structure` pulls `tokio`. | Drop `tokio` (US13). |
| O6 | **ADOPT (own change)** | **Layering inversion** `persistence/db → contracts/core`: repos import transport DTOs (`repositories/{equipment,settings,first_run,inbox}.rs`). | Move ~4 stored type clusters to domain; map at app/core. **On-disk/SQL representation MUST NOT change** (US13). |
| O7 | **DECLINE** | A new `support`/`common` crate. | Junk-drawer; use `domain_core` instead. |
| O8 | **DECLINE** | Merge thin crates (`sessions`, `metadata/video`, `fs/planner`…). | Intentional adapter/seam boundaries — leave alone. |
| O9 | **KEEP + doc** | Frontend: coherent features/, **zero cross-feature imports** (verified); minor 4-bucket ambiguity (`components`/`ui`/`shared`/`lib`). | Document the convention; no refactor. |

## R. Rejected (with reason)

- **walkdir** — no recursive `read_dir` exists (verified); the app uses `notify`.
- **react-hook-form-as-the-only-validator** — *adopted* for client UX, but the backend
  remains authoritative; not a replacement for backend validation.
- **clap** — no CLIs exist; the one build-time bin takes no args.
- **internal HTTP/JSON-RPC API** — adds a 3rd contract surface + a local attack surface;
  no present benefit; portability already promised by the contracts.
- **new `support`/`common` crate** — junk-drawer anti-pattern; use `domain_core`.
- **merging thin adapter crates** — they are intentional independent-compilation seams.
- **toast/notification lib** — none hand-rolled; nothing to replace.

## Deferred (documented; NOT in this feature)

- **FITS `nom`/full parser combinator** — `byteorder` only (J6); a full `nom` rewrite of
  FITS parsing stays deferred (correctness-critical, well-tested).
- **`parking_lot`** — documented alternative to dashmap/moka for K1/K2; not chosen.
- The KEEP items above are the standing "don't touch" set.

## Tally

≈16 library ADOPTs · ≈24 REFACTOR/CONSOLIDATE/restructure (no new dep) · ≈11 KEEP ·
several DEFER documented · 6 REJECT. Mapped to user stories US1–US16 in `spec.md`.
