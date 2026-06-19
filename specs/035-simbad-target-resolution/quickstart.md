# Quickstart / Integration Scenarios: SIMBAD Target Resolution

**Spec**: 035 | **Plan**: [plan.md](./plan.md) | **Date**: 2026-06-18

Integration scenarios mapping to the spec's user stories + success criteria. Backend logic is tested
offline via the `FakeResolver` seam; the search/settings UI is verified with Playwright; one gated
test hits live SIMBAD.

## S1 — Instant local typeahead (US1, US2 / SC-001, SC-002)

1. Fresh install → first run loads the bundled seed into the cache.
2. With the network disabled, open project-creation target search; type `M3`.
3. Expect: suggestions (M 31, M 33, …) render < 100 ms, each with designation + common name + type,
   no network call. Select M 31 → project associated with that canonical target.

## S2 — Long-tail SIMBAD resolve + cache (US3 / SC-004)

1. Online. Search an object NOT in the seed (e.g. an obscure `LBN`/`PK` designation).
2. After the debounce, a SIMBAD result merges into suggestions; select it.
3. Expect: a `resolved` cache entry is written. Repeat the search with the network disabled → it now
   resolves from cache (no SIMBAD call). Rapid-typing past an in-flight query does not show stale
   results (cancelled).

## S3 — Ingest grouping by resolved target (US4 / SC-003)

1. Ingest images whose `OBJECT` headers read `M31`, `NGC 224`, `Andromeda`.
2. Cache/seed hits associate inline; any uncached value is enqueued (state `pending`) and resolved in
   the background, then associated.
3. Expect: all three images group under one `CanonicalTarget`. An unknown/garbled `OBJECT` →
   `unresolved` (pending, retryable), never mis-assigned, never given fabricated coordinates.

## S4 — Manual override wins (FR-014)

1. Force a mis-resolution (FakeResolver returns the wrong target for a query).
2. User manually binds the query to the correct target (`target.resolve` with `override`).
3. Expect: a `user-override` row; subsequent resolves of that query return the override even though
   SIMBAD/seed would return something else.

## S5 — Online toggle + graceful degradation (FR-011, FR-015 / SC-005)

1. Settings → resolver: toggle online resolution OFF (default is ON).
2. Search/ingest a seeded object → still works (local). Search an unseeded object → `unresolved`
   (`resolver.disabled`), marked pending.
3. Re-enable; SIMBAD unreachable (simulate) → degrade to seed+cache, unresolved marked pending, no
   block; recover when reachable.

## Contract conformance (tests/contract)

- `target.search` / `target.resolve` / `target.resolution.settings` DTOs round-trip identically
  through the Rust contract DTOs and the JSON Schemas (camelCase wire), mirroring the spec-033
  manifest-parity pattern.
- SIMBAD response → `ResolvedTarget` mapping: ICRS deg coords, `otype` → closed `ObjectType`,
  `NAME` idents → common name + aliases, `oid` dedup.
- Cache precedence: `user-override` > `resolved` > `seed`.
