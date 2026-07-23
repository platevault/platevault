# TinySpec: Migrate the targets feature to a TanStack Query store

**Branch**: spec/tanstack-query-migration (off `main`)
**Date**: 2026-07-11
**Status**: draft
**Complexity**: medium (upper end of tinyspec; contained to one feature)

## What

`features/targets` is the last feature still doing hand-rolled data loading —
`useState` + `useEffect` + `.then(unwrap)` / `await commands.*` with manual
`load()` refetch calls — instead of the shared TanStack Query store pattern every
other feature adopted in the spec-043 / n8 consolidation
(`features/{inbox,projects,sessions,...}/store.ts` + `data/queryKeys.ts`). Add a
`targets` query domain and a `features/targets/store.ts`, and move the targets
reads/mutations onto `useQuery`/`useMutation` with cache invalidation.
Behavior-preserving; the win is one caching/refetch/invalidation model, no manual
`load()` plumbing, and automatic refetch after mutations.

## Context

| File | Role |
|------|------|
| `apps/desktop/src/data/queryKeys.ts` | Modify — add a `targets` domain (list, detail, sessions, projects, notes, favourites) |
| `apps/desktop/src/features/targets/store.ts` | Add — `useQuery`/`useMutation` hooks, mirroring `features/sessions/store.ts` |
| `apps/desktop/src/features/targets/TargetDetailV2.tsx` | Modify — replace 4 load `useEffect`s + note/alias mutations (~9 `commands.*` sites) with store hooks |
| `apps/desktop/src/features/targets/TargetsPage.tsx` | Modify — replace the list-load `useEffect`(s) with `useTargets()` |
| `apps/desktop/src/features/targets/useFavourites.ts` | Modify — replace hand-rolled favourites read + toggles with `useQuery`/`useMutation` |
| `apps/desktop/src/features/targets/*.test.tsx` | Modify — wrap renders under `QueryClientProvider` (see existing store tests) |

## Requirements

1. A `queryKeys.targets` domain covers every targets read: list, detail, linked sessions, linked projects, notes, favourites.
2. `features/targets/store.ts` exposes typed hooks (`useTargets`, `useTargetDetail`, `useTargetSessions`, `useTargetProjects`, `useTargetNotes`, `useFavourites`, plus mutation hooks for note-update, alias add/remove, display-alias set/clear, favourite-toggle), following the `sessions/store.ts` shape (local `unwrap(await commands.X(ipcArgs(req)))` helpers).
3. Every mutation invalidates the affected query key(s) instead of calling a manual `load()`.
4. No `useEffect` + `commands.*` data-loading remains in the targets feature. **Out of scope:** `TargetSearch` (live search-as-you-type, not a cached read).
5. Behavior-preserving: loading / empty / error states and all existing targets-feature tests still pass.

## Plan

1. Add the `targets` domain to `data/queryKeys.ts`.
2. Write `features/targets/store.ts` mirroring `sessions/store.ts` (query hooks + mutation hooks + invalidation).
3. Migrate `TargetsPage` list load → `useTargets()`.
4. Migrate `TargetDetailV2`: detail/sessions/projects/notes reads → `useQuery`; note/alias/display-alias mutations → `useMutation` with invalidation; delete the manual `load()` calls.
5. Migrate `useFavourites` → `useQuery` + a toggle `useMutation`.
6. Wrap affected tests in `QueryClientProvider`.

## Tasks

- [ ] Add `queryKeys.targets`
- [ ] Add `features/targets/store.ts` (hooks + invalidation)
- [ ] Migrate `TargetsPage` list load
- [ ] Migrate `TargetDetailV2` reads + mutations
- [ ] Migrate `useFavourites`
- [ ] Update targets tests for `QueryClientProvider`
- [ ] `tsc` + `vitest src/features/targets/` + `eslint` green
- [ ] Real-app (Windows) spot-check: list, detail load, add/remove alias, notes save, favourite toggle

## Done When

- [ ] No `useEffect` + `commands.*` / `.then(unwrap)` data-load remains in `features/targets` (`rg` clean)
- [ ] All targets-feature vitest + tsc + eslint pass
- [ ] Real-app spot-check passes (loads + mutations refetch correctly)
