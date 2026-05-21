---

description: "Task list for Router And URL State"
---

# Tasks: Router And URL State

**Input**: Design documents from `/specs/020-router-url-state/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/url.resolve.json

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: User story (US1 navigate, US2 filters, US3 stale-id, US4 export)
- Mockup-done tasks are marked `(mockup-done)` and are kept for traceability and promotion-to-canonical work.

---

## Phase 1: Setup (Shared Infrastructure)

- [x] T001 [P] (mockup-done) TanStack Router installed and wired in `apps/desktop/src/app/router.tsx`.
- [x] T002 [P] (mockup-done) Root `Shell` layout renders `<Outlet>` and is registered as `rootRoute`.
- [ ] T003 [P] Create shared `RouteContract` typing in `apps/desktop/src/lib/route-contract.ts` exporting `RouteContract`, `ResolvableEntityRef`, and the `parseSearch` helpers (`parseString`, `parseEnum`, `parseCsv`).
- [ ] T004 Mirror `specs/020-router-url-state/contracts/url.resolve.json` to `packages/contracts/url/url.resolve.json`.

---

## Phase 2: Foundational (Blocking Prerequisites)

- [x] T005 (mockup-done) Hash history adapter configured via `createHashHistory()` in `apps/desktop/src/app/router.tsx`.
- [x] T006 (mockup-done) Index resolver at `/` reads `alm.first-run.completed` and redirects via `<Navigate replace>`.
- [ ] T007 Refactor inline `parseId` helper into shared `parseString` in `route-contract.ts`; replace call sites in `router.tsx`.
- [ ] T008 Add a `RouteContract` instance per route under `apps/desktop/src/lib/routes/*.contract.ts` (one per route) that re-exports the `validateSearch` and `resolvableEntities` declarations consumed by `router.tsx`.

**Checkpoint**: Foundation ready – per-route contracts are the single source of truth for shape and resolution.

---

## Phase 3: User Story 1 - Navigate Predictably (Priority: P1) 🎯 MVP

**Goal**: Stable, refresh-safe routes for every primary surface.

**Independent Test**: Visit each route, refresh, confirm same page.

- [x] T010 [US1] (mockup-done) `/welcome` route in `router.tsx`.
- [x] T011 [US1] (mockup-done) `/inventory` route in `router.tsx`.
- [x] T012 [US1] (mockup-done) `/inbox` route in `router.tsx`.
- [x] T013 [US1] (mockup-done) `/projects` route in `router.tsx`.
- [x] T014 [US1] (mockup-done) `/plans` and `/plans/$planId` routes in `router.tsx`.
- [x] T015 [US1] (mockup-done) `/settings` redirect and `/settings/$section` route in `router.tsx`.
- [ ] T016 [US1] Replace any remaining `window.location.hash = ...` writes in the desktop tree with `useNavigate({ from })` calls.
- [ ] T017 [US1] Add a Vitest covering: `index → welcome` redirect when localStorage is empty, `index → inventory` redirect when `alm.first-run.completed === "1"`, and unknown-route fallthrough to `/`.

**Checkpoint**: Primary navigation works without manual hash mutation.

---

## Phase 4: User Story 2 - Persist Workflow Filters In Route State (Priority: P2)

**Goal**: Filters and selection survive refresh and live in URL.

**Independent Test**: Apply filters + select an entity, refresh, confirm restored.

- [x] T020 [US2] (mockup-done) `validateSearch` for `/inventory` declares `{id, source, frame, review}`.
- [x] T021 [US2] (mockup-done) `validateSearch` for `/inbox` declares `{id, type, source}`.
- [x] T022 [US2] (mockup-done) `validateSearch` for `/projects` declares `{id, lifecycle, tool}`.
- [x] T023 [US2] (mockup-done) `validateSearch` for `/plans` declares `{state, origin}`.
- [ ] T024 [US2] Add Vitest coverage that each `validateSearch` drops unknown keys and coerces non-string values to `undefined`.
- [ ] T025 [US2] Ensure each ledger page reads filters via `useSearch({ from })` and writes via `useNavigate({ from })` with merged search updates (audit `InventoryPage`, `InboxPage`, `ProjectsPage`, `PlansListPage`).
- [ ] T026 [US2] Convert `/projects` `lifecycle` filter to comma-separated multiselect parsing via `parseCsv` (per `research.md` R4).

**Checkpoint**: Filters round-trip through reload and copy-paste.

---

## Phase 5: User Story 3 - Graceful Stale-Id Fallback (Priority: P3)

**Goal**: Deleted/archived/unknown entities never strand the user.

**Independent Test**: Deep-link `/plans/missing`, `/inventory?id=does-not-exist`, `/projects?id=archived`; confirm graceful handling.

- [ ] T030 [US3] Implement "plan not found" empty state in `PlanDetailPage` with a link back to `/plans`; do not auto-redirect.
- [ ] T031 [US3] In each ledger page, when the data layer reports a missing `id`, call `navigate({ search: prev => ({ ...prev, id: undefined }), replace: true })` exactly once.
- [ ] T032 [US3] Add Vitest coverage that stale-id cleanup preserves the other filter keys and uses `replace: true`.
- [ ] T033 [US3] Confirm unknown route segments fall through to the index resolver (TanStack Router default 404 path); add a smoke test.
- [ ] T034 [US3] Ensure `/settings/$section` for unknown section renders a section-not-found empty state inside the settings shell (not a hard redirect).

**Checkpoint**: Zero uncaught errors on stale-id deep links.

---

## Phase 6: User Story 4 - Export Shareable Links (Priority: P4)

**Goal**: Users can copy a link that captures their current view.

**Independent Test**: Copy link, paste into a fresh instance, confirm restoration.

- [ ] T040 [US4] Add a `useCurrentLink()` hook that returns `window.location.href` after the router settles (post-navigation tick) for use by future "copy link" affordances.
- [ ] T041 [US4] Define `url.resolve` contract DTOs in `apps/desktop/src/lib/route-contract.ts` (`UrlResolveRequest`, `UrlResolveResponse`) matching `contracts/url.resolve.json`.
- [ ] T042 [US4] Implement a desktop-side fallback resolver that uses the in-memory route table to satisfy `url.resolve` until the Rust use-case lands.
- [ ] T043 [US4] Scaffold `crates/app/core/usecases/url_resolve.rs` with the contract signature; mark the body `unimplemented!()` and add a TODO referencing this spec.
- [ ] T044 [US4] Confirm special characters round-trip by adding a Vitest that pastes a URL with `%2C`, `%20`, and `+` into the resolver and gets the same search shape back.
- [ ] T045 [US4] Document the "copy link" UX as deferred; do not add the menu item until US3 fallback is in place.

**Checkpoint**: Shareable-link boundary is locked even though the affordance ships later.

---

## Phase 7: Polish & Cross-Cutting

- [ ] T050 [P] Update `docs/research/` index to reference `specs/020-router-url-state/research.md` for hash-vs-history rationale.
- [ ] T051 [P] Add a `RouteContract` audit Vitest that asserts every route in `router.tsx` has a matching contract entry in `data-model.md` (by hand-maintained list to start).
- [ ] T052 Promote `parseId` callers to typed `parseString`/`parseEnum` via `knip`-driven cleanup pass on `router.tsx`.
- [ ] T053 Add a Playwright MCP smoke that navigates each route in `data-model.md` and asserts no console errors.

---

## Dependencies & Execution Order

### Task Dependencies

```toml
[graph]

[graph.T001]
blocked_by = []
[graph.T002]
blocked_by = []
[graph.T003]
blocked_by = ["T001"]
[graph.T004]
blocked_by = []
[graph.T005]
blocked_by = ["T001"]
[graph.T006]
blocked_by = ["T001", "T005"]
[graph.T007]
blocked_by = ["T003"]
[graph.T008]
blocked_by = ["T003"]

[graph.T010]
blocked_by = ["T002", "T005"]
[graph.T011]
blocked_by = ["T002", "T005"]
[graph.T012]
blocked_by = ["T002", "T005"]
[graph.T013]
blocked_by = ["T002", "T005"]
[graph.T014]
blocked_by = ["T002", "T005"]
[graph.T015]
blocked_by = ["T002", "T005"]
[graph.T016]
blocked_by = ["T008"]
[graph.T017]
blocked_by = ["T006"]

[graph.T020]
blocked_by = ["T011"]
[graph.T021]
blocked_by = ["T012"]
[graph.T022]
blocked_by = ["T013"]
[graph.T023]
blocked_by = ["T014"]
[graph.T024]
blocked_by = ["T007", "T020", "T021", "T022", "T023"]
[graph.T025]
blocked_by = ["T020", "T021", "T022", "T023"]
[graph.T026]
blocked_by = ["T007", "T022"]

[graph.T030]
blocked_by = ["T014"]
[graph.T031]
blocked_by = ["T025"]
[graph.T032]
blocked_by = ["T031"]
[graph.T033]
blocked_by = ["T006"]
[graph.T034]
blocked_by = ["T015"]

[graph.T040]
blocked_by = ["T025"]
[graph.T041]
blocked_by = ["T004", "T003"]
[graph.T042]
blocked_by = ["T041", "T008"]
[graph.T043]
blocked_by = ["T004"]
[graph.T044]
blocked_by = ["T042"]
[graph.T045]
blocked_by = ["T031"]

[graph.T050]
blocked_by = []
[graph.T051]
blocked_by = ["T008"]
[graph.T052]
blocked_by = ["T007"]
[graph.T053]
blocked_by = ["T010", "T011", "T012", "T013", "T014", "T015"]
```

### Phase Dependencies

- **Setup (Phase 1)**: T001/T002/T005/T006 already done as mockup; T003/T004 unblock subsequent typed work.
- **Foundational (Phase 2)**: T007/T008 promote the mockup to typed contracts and block follow-up work in US2/US3/US4.
- **User Stories (Phase 3-6)**: P1 already mockup-done; P2/P3/P4 layer typed correctness, fallback, and link export on top.
- **Polish (Phase 7)**: Runs after the cross-story checkpoints.

### Within Each User Story

- Contracts before pages.
- Validators before tests of validators.
- Stale-id replace logic before "copy link" affordance (so exported links can't strand pasters).

### Parallel Opportunities

- T020-T023 (per-route `validateSearch` audits) can proceed in parallel.
- T030, T031, T033, T034 (stale-id behaviors) can be split across pages.
- T040, T041, T043 (link-export scaffolding) can be split across desktop/Rust.

---

## Notes

- Mockup-done tasks are tracked so the promotion path is auditable; they are not re-implemented.
- Each ledger page MUST stay aligned with the `RouteShape` table in `data-model.md`; adding a search key requires updating both.
- Avoid: introducing a global filter store; mirroring URL state into `useState`; manual hash mutation.
