---
description: "Task list for Router And URL State (rescoped 2026-06-10 to design-v4 + desktop features)"
---

# Tasks: Router And URL State (desktop rescope)

**Input**: `spec.md` (rescoped 2026-06-10), design-v4 router at
`apps/desktop/src/app/router.tsx`, ledger pages under
`apps/desktop/src/features/*`.
**Scope**: selection + filters in URL (back/forward + refresh safe),
detail-path normalization, stale-id fallback, multi-window, testability.
**Deferred** (see spec *Out of Scope*): `?lib=` scoping, copy-link UX, Rust
`url.resolve`, `DeprecatedParamMap`, validator error banner.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: parallelizable (different files).
- **[Story]**: US1 navigate, US2 back/forward filters, US3 stale-id, US4 window.

---

## Phase 1: Foundation — typed route contract

- [x] T001 (design-v4) TanStack Router installed + wired in `router.tsx`.
- [x] T002 (design-v4) Root `Shell` renders `<Outlet>`; hash history via `createHashHistory()`.
- [x] T003 (design-v4) Index `/` resolver gates on first-run (`getPreferences().setupCompleted` + Tauri `firstrunState`), redirects to `/setup`.
- [x] T004 [US1] Create `apps/desktop/src/lib/route-contract.ts`: typed search parsers `parseNumber`, `parseString`, `parseEnum(allow)`, `parseCsvEnum(allow)` (coerce invalid/unknown → `undefined`/empty, drop unknown keys), plus enum allow-list constants synced to `@/bindings` types (`SESSION_STATES`, `PROJECT_STATES`, `CALIBRATION_KINDS`, `FRAME_TYPES`, group enums). `makeValidateSearch` factory helper.

**Checkpoint**: typed, unit-testable parsers exist as the single validator home.

---

## Phase 2: Selection + filters in URL (US1 + US2) 🎯 MVP

Each ledger route declares `validateSearch`; each page reads via
`useSearch({ from })` and writes via `useNavigate({ from })`, removing local
`useState` for selection/filters. Selection ids are numbers.

- [x] T010 [US1] `/sessions`: `validateSearch {selected?:number}`. `SessionsPage` reads `selected` from search; `SessionsList` `onSelect` writes `navigate({search})`. Removed `useState` selection. (Filter params deferred — list controls not yet stateful.)
- [x] T011 [US2] `/inbox`: `validateSearch {selected?:number, type?, group?}`. Lifted `InboxList` `filterType`/`groupBy` to URL (controlled props); `sortBy` stays local; selection via search.
- [x] T012 [US1] `/calibration`: `validateSearch {selected?:number}`. Selection via search. (Filter deferred.)
- [x] T013 [US1] `/targets`: `validateSearch {selected?:number}`. Selection via search.
- [x] T014 [US2] `/projects`: `validateSearch {selected?:number, lifecycle?:ProjectState[] (csv)}`. Lifted `ProjectsList` lifecycle filter to URL (single-select UI ↔ 1-element array); soft first-item default not written to URL.
- [x] T015 [US1] `/archive`: `validateSearch {selected?:number}`. Selection via search.

**Checkpoint**: every ledger view round-trips through reload; filters persist.

---

## Phase 3: Detail-path normalization (US1, FR-006)

- [x] T020 [US1] Normalize `/calibration/$id`, `/targets/$id`, `/projects/$id` to `beforeLoad` redirect → `/<ledger>?selected=$id` (NaN-safe via `selectedSearch`). Stub/passthrough detail components removed from the route tree.

---

## Phase 4: Stale-id graceful fallback (US3)

- [x] T030 [US3] `useStaleSelectionCleanup(selected, found, clear)` hook (useRef-guarded) in `apps/desktop/src/lib/use-stale-selection.ts` (kept separate from the pure parsers); page supplies the `clear` closure doing `navigate({ search: prev => ({ ...prev, selected: undefined }), replace: true })`. Wired into all six ledger pages.
- [x] T031 [US3] Added `defaultNotFoundComponent: () => <Navigate to="/" />` to the router so unknown segments fall through to the index resolver (no blank flash).

---

## Phase 5: Multi-window (US4)

- [x] T040 [US4] `apps/desktop/src/lib/window.ts`: `openInNewWindow(path)` via `@tauri-apps/api/webviewWindow` (lazy-imported), runtime-guarded by `__TAURI_INTERNALS__`; browser fallback `window.open`. Unique `alm-win-*` label per call.
- [x] T041 [US4] "Open view in new window" command added to the command palette Actions group; uses `useRouterState` to capture the current href (route + search).
- [x] T042 [US4] Granted `core:webview:allow-create-webview-window` in `capabilities/default.json` and broadened `windows` to `["main", "alm-win-*"]` so spawned windows are functional. `cargo check -p desktop_shell` passes (capability validated).

---

## Phase 6: Tests (testability cross-cut)

- [x] T050 [P] Vitest `route-contract.test.ts`: `parseNumber` rejects non-numeric → `undefined`; `parseEnum`/`parseCsvEnum` drop values outside the allow-list; unknown keys dropped.
- [x] T051 [P] Vitest: `makeValidateSearch` drops unknown keys and coerces invalid values away (representative projects shape).
- [x] T052 [P] Vitest `first-run.test.ts`: `checkFirstRunComplete` → `false` when setup incomplete (index redirects to `/setup`), `true` when complete. (Gate extracted to `app/first-run.ts` for light testing.)
- [x] T053 [P] Vitest `use-stale-selection.test.tsx`: cleanup fires `clear` exactly once per stale id (useRef guard), never when found/empty. (The `replace:true` + param-preservation lives in the page's `clear` closure — spreads `prev`, nulls only `selected`.)
- [x] T054 [P] Vitest: special characters (spaces, `+`, commas) round-trip through the contract layer unchanged.

> Runtime/browser interaction smoke (selection round-trip, back/forward in a
> real window) is **deferred to the Windows-native preview** — WSL's network
> sandbox blocks a localhost Vite+Playwright smoke here. Logic is unit-tested and
> loop-safe by construction. Test totals: **27 vitest passing**; `tsc` clean;
> `cargo check` clean.

---

## Phase 7: Polish & docs

- [ ] T060 [P] Note the hash-vs-history + desktop-rescope rationale in `docs/research/` index (link to this spec + decisions log).
- [x] T061 Record rescope decision + deferrals in `docs/development/autonomous-run-2026-06-decisions.md` (D-007).

---

## Deferred (explicitly out of v1 scope — see spec)

- `?lib=` library scoping + cross-library refusal banner (old FR-010/011).
- "Copy shareable link" UX.
- Rust `crates/app/core/usecases/url_resolve.rs` + `url.resolve` contract mirror.
- `DeprecatedParamMap` (no legacy params exist).
- Two-tier validator **error banner** (v1 silently drops invalid values).

---

## Dependencies & Execution Order

```toml
[graph]
T004 = { blocked_by = [] }
T010 = { blocked_by = ["T004"] }
T011 = { blocked_by = ["T004"] }
T012 = { blocked_by = ["T004"] }
T013 = { blocked_by = ["T004"] }
T014 = { blocked_by = ["T004"] }
T015 = { blocked_by = ["T004"] }
T020 = { blocked_by = ["T010","T012","T013","T014"] }
T030 = { blocked_by = ["T010","T011","T012","T013","T014","T015"] }
T031 = { blocked_by = ["T003"] }
T040 = { blocked_by = [] }
T041 = { blocked_by = ["T040"] }
T042 = { blocked_by = ["T040"] }
T050 = { blocked_by = ["T004"] }
T051 = { blocked_by = ["T010","T011","T012","T013","T014","T015"] }
T052 = { blocked_by = ["T003"] }
T053 = { blocked_by = ["T030"] }
T054 = { blocked_by = ["T010"] }
```

### Notes

- Each ledger page MUST stay aligned with the search-param table in `spec.md`;
  adding a key requires updating both.
- Avoid: a global filter store; mirroring URL state into `useState`; manual hash
  mutation.
- Selection ids are numbers; `parseNumber` returns `undefined` for non-numeric.
