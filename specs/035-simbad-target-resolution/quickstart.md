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

## S3 — Ingest grouping by resolved target (US4 / SC-003, FR-016)

### S3a — Alias variants → one session (cache hit)

1. Apply a plan that moves or catalogues light frames with `OBJECT` headers `M31`, `NGC 224`, and
   `Andromeda Galaxy` (aliases of the same object) from the same night.
2. The plan-apply completion triggers the ingest hook in `plan_listener`. Each frame upserts a
   `file_record`; `associate_or_enqueue` resolves all three aliases to the same `canonical_target`
   (seed/cache hit); the ingest derives the same `session_key` for all three.
3. Expect: one `acquisition_session` is created; `frame_ids` has length 3; `canonical_target_id`
   is set to the M31 canonical target id; `list_sessions` returns `frame_count = 3` with the
   primary designation "M 31".

### S3b — Unknown OBJECT → pending resolution, later back-fill

1. Apply a plan that moves a light frame with `OBJECT = "NGC_UNKNOWN_XYZ"` (no cache/seed match).
2. Ingest creates the `file_record`, cannot resolve the OBJECT inline, inserts a `pending`
   `ingest_resolution` row, and creates the `acquisition_session` with `canonical_target_id = NULL`.
3. Expect immediately: session exists in `list_sessions` with no target name; OBJECT is queued, not
   mis-assigned.
4. The background `resolve_pending` drain runs (using `FakeResolver` in tests; `SimbadResolver` in
   production). On resolution, `canonical_target_id` is back-filled on the session.
5. Expect after drain: `list_sessions` now shows the resolved target name; `ingest_resolution` state
   → `resolved`.

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
