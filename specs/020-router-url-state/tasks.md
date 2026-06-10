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
- [ ] T004 [US1] Create `apps/desktop/src/lib/route-contract.ts`: typed search parsers `parseNumber`, `parseString`, `parseEnum(allow)`, `parseCsvEnum(allow)` (coerce invalid/unknown → `undefined`/empty, drop unknown keys), plus enum allow-list constants re-exported from `@/bindings` (`SessionState`, `ProjectState`, `CalibrationKind`, frame-type, group enums). Export a `validateSearch` factory helper.

**Checkpoint**: typed, unit-testable parsers exist as the single validator home.

---

## Phase 2: Selection + filters in URL (US1 + US2) 🎯 MVP

Each ledger route declares `validateSearch`; each page reads via
`useSearch({ from })` and writes via `useNavigate({ from })`, removing local
`useState` for selection/filters. Selection ids are numbers.

- [ ] T010 [US1] `/sessions`: `validateSearch {selected?:number, group?, state?}`. `SessionsPage` reads `selected` from search; `SessionsList` `onSelect` writes `navigate({search})`. Remove `useState` selection.
- [ ] T011 [US2] `/inbox`: `validateSearch {selected?:number, type?, group?}`. Lift `InboxList` `filterType`/`groupBy` to URL; selection via search.
- [ ] T012 [US1] `/calibration`: `validateSearch {selected?:number, kind?}`. Selection via search.
- [ ] T013 [US1] `/targets`: `validateSearch {selected?:number}`. Selection via search.
- [ ] T014 [US2] `/projects`: `validateSearch {selected?:number, lifecycle?:ProjectState[] (csv)}`. Lift `ProjectsList` lifecycle filter to URL; selection via search (handle the current non-null default — fall back to first item only when `selected` absent).
- [ ] T015 [US1] `/archive`: `validateSearch {selected?:number}`. Selection via search.

**Checkpoint**: every ledger view round-trips through reload; filters persist.

---

## Phase 3: Detail-path normalization (US1, FR-006)

- [ ] T020 [US1] Normalize `/calibration/$id`, `/targets/$id`, `/projects/$id` to `beforeLoad` redirect → `/<ledger>?selected=$id` (matching the existing `/sessions/$id` pattern). Remove stub/passthrough detail components from the route tree.

---

## Phase 4: Stale-id graceful fallback (US3)

- [ ] T030 [US3] Add a `useStaleSelectionCleanup(found: boolean)` hook (useRef-guarded) in `route-contract.ts`: when `selected` is present but the entity is missing, call `navigate({ search: prev => ({ ...prev, selected: undefined }), replace: true })` exactly once. Wire into all six ledger pages; render the existing empty detail when nothing is selected/found.
- [ ] T031 [US3] Confirm unknown route segments fall through to the `/` index resolver (TanStack default); no blank flash.

---

## Phase 5: Multi-window (US4)

- [ ] T040 [US4] Add `apps/desktop/src/lib/window.ts`: `openInNewWindow(path: string)` using `@tauri-apps/api/webviewWindow` `WebviewWindow`, guarded by a Tauri-presence check; in browser/dev fall back to `window.open('#'+path)` (or no-op). Generates a unique label per call.
- [ ] T041 [US4] Add an "Open in new window" affordance (app action bar and/or command palette) that calls `openInNewWindow` with the current `router.state.location.href` (route + search).
- [ ] T042 [US4] Grant the Tauri capability to create webview windows in `apps/desktop/src-tauri/capabilities/*.json` (`core:webview:allow-create-webview-window` or equivalent). Verify the Rust side builds.

---

## Phase 6: Tests (testability cross-cut)

- [ ] T050 [P] Vitest: `route-contract` parsers — `parseNumber` rejects non-numeric → `undefined`; `parseEnum`/`parseCsvEnum` drop values outside the allow-list; unknown keys dropped.
- [ ] T051 [P] Vitest: each route `validateSearch` drops unknown keys and coerces invalid values to `undefined`.
- [ ] T052 [P] Vitest: index resolver redirects to `/setup` when first-run incomplete and renders Sessions when complete (extend existing `SetupWizard.test` patterns / mock `getPreferences`).
- [ ] T053 [P] Vitest: stale-id cleanup preserves other params and fires `replace` exactly once (useRef guard).
- [ ] T054 [P] Vitest: special characters (`%2C`, `%20`, `+`) round-trip through a ledger route's search shape unchanged.

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
