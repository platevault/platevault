# Performance report — independent challenge

Model identity exposed by runtime: `openai-codex/gpt-6-astra`. The requested `@max` role is not independently exposed; no model or effort override was made.

This is a holistic snapshot review, not a patch-introduction assessment. All citations below are relative to the permitted worktree. Seven findings are accepted at their reported severity; one is downgraded to a source-established risk requiring production-layout confirmation. No finding is rejected. The snapshot contains substantive resource and inventory-query defects, hence the overall incorrect verdict.

## PERF-01 — ACCEPT, P1: synchronous classification work occupies async workers

**Evidence:** `apps/desktop/src-tauri/src/commands/inbox.rs:72-82,127-137` directly awaits application classification; `crates/app/inbox/src/classify.rs:147-170,193-219` synchronously enumerates files, hashes their contents and collects metadata. The source-group path performs enumeration and `build_file_records` at `classify.rs:600-611`; its synchronous per-file loop and metadata dispatch are at `classify.rs:769-791,849-863`. `crates/app/targets/src/metadata_cache.rs:83-106` performs `std::fs::metadata` before every cache lookup and synchronous extraction on misses.

**Counterevidence and correction:** The first-wave report omitted an important guard: `classify.rs:128-139` returns a cached classification before enumeration when `force_rescan` is false and the stored signatures match. Therefore the item finding applies to uncached/forced classification, not every repeated classification request. The source-group path shown has no equivalent early response cache. Metadata caching is bounded to 50,000 entries with 30-minute idle expiry, returns Arc-backed values, and coalesces same-key extraction (`metadata_cache.rs:20-24,50-61,83-86`). Collection before the write transaction avoids holding a SQLite transaction across the filesystem work. None of these guards moves cold/forced filesystem work off the async worker.

**Causal conclusion:** A qualifying request has a synchronous O(F) filesystem phase, plus signature sorting where applicable, between await points. Slow storage occupies the executing runtime worker for that phase; simultaneous requests can occupy additional workers. P1 remains justified for executor responsiveness, but neither universal starvation nor measured latency is established.

**Remaining verification:** Exercise uncached, forced and early-cache-hit item classification separately; include source groups and slow filesystem operations. Measure independent command latency and active blocking concurrency. No such experiment was run.

## PERF-02 — ACCEPT, P1: quadratic reconciliation and blocking filesystem traversal

**Evidence:** `apps/desktop/src-tauri/src/watcher.rs:319-340` awaits the initial query, then calls the synchronous reconciler with real filesystem callbacks. `watcher.rs:351-366` searches `known_rows` linearly for every reconciled existing path. `crates/workflow/artifacts/src/reconciler.rs:99-126` emits an outcome for every input known path in input order. `watcher.rs:191-205` supplies synchronous recursive traversal and metadata probes. Both live recovery (`watcher.rs:417-459`) and attachment (`watcher.rs:553-558`) invoke this path.

**Counterevidence inspected:** Reconciler membership uses hash sets (`reconciler.rs:101-105,129-139`); the quadratic work is specifically the caller's repeated row search, not those sets. Extension/symlink restrictions bound what is eligible, not the number of eligible files. Watcher tests at `watcher.rs:779-824` exercise nested discovery and symlink exclusion, not lookup complexity or scheduler responsiveness. Recovery clears pending work before reconciling. The ingress channel is bounded and overflow recovery is explicit (`crates/fs/inventory/src/artifact_watcher.rs:95-107,135-143`; `watcher.rs:449-459`), so an unbounded-ingress claim would be false.

**Causal conclusion:** For K distinct stored paths, the ordered repeated searches perform exactly K(K+1)/2 path-equality checks: 50,005,000 at K=10,000, excluding string-comparison cost. Synchronous traversal adds work proportional to visited filesystem entries. Both happen before the next database await. This is a concrete avoidable quadratic mechanism on attachment and overflow/error recovery.

**Remaining verification:** Count comparisons at increasing K and observe an independent async heartbeat while reconciling synthetic trees. Confirm seen/gone/unknown outcomes remain identical after indexing/offloading. Existing read tests do not establish either performance property.

## PERF-03 — ACCEPT, P2: repeated global project-link reads

**Evidence:** `crates/app/core/src/inventory.rs:71-93` loops over selected roots and calls link lookup for each nonempty visible session set. `crates/persistence/targets/src/repositories/inventory.rs:275-307` fetches the entire joined project-source relation, ordered by project name, and only then filters by the provided session-ID set.

**Counterevidence inspected:** Empty session-ID input returns immediately; empty roots and roots excluded by the source filter do not perform this lookup. ID membership is a HashSet, and enrichment is batched rather than one query per session. The inspected migration provides `idx_project_sources_project_id` (`crates/persistence/core/migrations/0001_initial_schema.sql:3097`), but the decisive issue is the missing SQL predicate, not a proved index-plan failure.

**Causal conclusion:** With R selected roots that contain visible sessions and P joined project-source rows, the path materializes and filters O(RP) rows across R global queries. Peak lookup materialization is O(P) per sequential iteration, not O(RP) concurrent memory. Ordering costs are additional and require a query plan to quantify. A session-page cap does not cap the global link fetch.

**Remaining verification:** Independently vary R and P, count decoded rows and query calls, and inspect plans for a session-filtered replacement. Preserve project-name ordering and multi-project links. No database was opened or queried during review.

## PERF-04 — ACCEPT, P2: unstable list identity repeats catalogue derivation

**Evidence:** `apps/desktop/src/features/targets/TargetsPage.tsx:159-165` allocates a new `listState` wrapper on every page render. `useTargetsPageFilters.ts:123-131,143-155` depends on that wrapper, advances reveal count by 300, refilters the catalogue and creates a fresh reveal slice. `useTargetsTableRows.ts:159-198,261-303` remaps and sorts the supplied set on changed target-array identity. The filter itself performs catalogue matching per item (`apps/desktop/src/shared/planner/planner-catalog.ts:93-99`).

**Counterevidence inspected:** `table-model.ts:220-249` caches altitude per target/generation, so the report must not imply that every sort recomputes all expensive altitude geometry. The geometry cache and normal virtualizer also limit other work. `TargetsPage.test.tsx:677-735` verifies 300-row initial reveal, eventual completion, direct search results and preserving reveal across sort changes. Those behavioral tests do not constrain scan/sort counts. `TargetsTable.test.tsx:529-632` directly checks altitude-cache reuse and generation invalidation, not array derivation work.

**Complexity correction:** The first-wave prefix formula applies cleanly when the filtered visible catalogue size M equals the query result size N. For C=300 and M=N, prefix row visits are Θ(N²/C) and comparison sorting has an O((N²/C) log N) aggregate upper bound, not a measured comparison count. With M<N, reveal termination still uses unfiltered N; later ticks can repeatedly derive an already-complete M-row filtered set. The full-catalogue filtering term remains O(N ceil(N/C)); prefix derivation is better described as a sum of min(jC,M), rather than universally Θ(M²/C).

**Causal conclusion:** Ordinary reveal updates and unrelated page renders invalidate otherwise reusable filtering and sorting. This is real synchronous render work despite `useMemo`; it is not proof of a specific frame-rate loss.

**Remaining verification:** Profile filter invocations, rows visited and sorting across reveal, selection and dialog state changes, including M much smaller than N. Confirm filter/search behavior after stabilizing dependencies. No React profiler was run.

## PERF-05 — ACCEPT, P2: superseded geometry requests discard reusable results

**Evidence:** `apps/desktop/src/features/targets/useTargetsTableRows.ts:95-142` derives missing IDs from completed cache entries, submits a batch, and sets a local cancellation flag on cleanup. A cancelled response exits before inserting any result into the cache. Target-array or night identity changes retrigger the effect. The backend at `apps/desktop/src-tauri/src/commands/target_lookup.rs:464-495` computes every submitted target; the inspected handler has no cross-request cache or cancellation handling.

**Counterevidence inspected:** Null night skips all work, targets without coordinates are excluded, already-completed IDs are cached, and changed nights replace the cache. Shared Moon/Sun inputs are computed once per batch. `TargetsTable.test.tsx:514-525` proves a single stable input produces one batched call and excludes unknown coordinates; the mock resolves promptly and does not exercise overlapping deferred requests. Night identity in the page is memoized (`TargetsPage.tsx:128-135`), so a claim that every table render recreates night would be incorrect.

**Causal conclusion:** When a target-set change precedes response completion, the old response is discarded even if its night and requested IDs remain useful. The next request repeats still-uncached IDs. If every growing prefix is superseded, total submitted IDs sum to C+2C+…+M, Θ(M²/C). This is a conditional workload bound, not an observed frequency. PERF-04's fresh arrays also make unrelated page updates eligible triggers. Cleanup protects stale-night/unmounted state but does not cancel backend computation.

**Remaining verification:** Hold promises across multiple reveal ticks, count submitted IDs and resolve them out of order; separately change night and unmount. A fix must preserve stale-generation exclusion while accepting reusable same-generation results.

## PERF-06 — ACCEPT, P2: cached search deep-clones before filtering

**Evidence:** `crates/app/targets/src/target_management/list.rs:31-51` clones the complete cached owned vector before inspecting the query. `list.rs:55-78` then normalizes strings and filters owned items. `apps/desktop/src/features/targets/store.ts:103-112` keys the query by trimmed input and directly invokes `targetList`; `TargetsPage.tsx:156-159` forwards search state to this hook.

**Counterevidence inspected:** The shared catalogue avoids repeated SQL loading, completed query keys can be reused, whitespace-only normalization does not create a distinct query key, and filtering occurs before IPC return. Thus this is not a full-catalogue transmission per keystroke, an SQL N+1, or evidence that every DOM input event creates a request. The inefficiency is cloning all cached records—including owned strings and aliases—before reducing the result. Alias-aware and whitespace-normalized search behavior is intentional and must survive any optimization.

**Causal conclusion:** Each new executed search incurs O(N+B) catalogue clone/allocation work before filtering, where B is total owned string/alias content and N also accounts for fixed-size record storage. A long alias catalogue makes B dominant. For Q distinct executed query keys, that cost repeats Q times. String-search work additionally depends on normalization and substring matching; O(B) is a useful fixed-query-length model, not a universal bound for arbitrary pattern algorithms.

**Remaining verification:** Measure allocated bytes and requests for new prefixes versus cached repeated keys. Verify alias-only, zero-match, empty and normalized searches. Retain Arc-backed data through filtering and clone only selected records before considering measured input coalescing.

## PERF-07 — DOWNGRADE, P3: unmeasured-range fallback removes the render bound

**Evidence:** `apps/desktop/src/features/targets/useTargetsTableRows.ts:305-324` chooses all flat-row indices whenever the virtualizer returns no items. `TargetsTable.tsx:383-384` consumes every selected index; `TargetsTable.tsx:449-458` invokes visible-row astronomy for each target. There is no test-environment condition around this fallback.

**Counterevidence inspected:** The comment explicitly identifies the all-row behavior as a jsdom/testing accommodation; `TargetsTable.test.tsx:6-11` describes that same contract. Normal nonempty virtual ranges are bounded. Progressive reveal initially limits ordinary unsearched page input to 300 rows (`TargetsPage.test.tsx:677-693`); search and My Targets use different reveal rules (`useTargetsPageFilters.ts:157-181`). The first-wave report did not measure production empty-range occurrence, mount behavior, hidden layouts or frame costs. I did not inspect a running surface or installed virtualizer internals.

**Causal conclusion:** The conditional source mechanism is certain: an empty range changes rendering from viewport-sized work to all supplied flat rows. However, claims that ordinary production mounts or hidden transitions actually produce a problematic N-row render remain unverified, and the fallback is visibly intentional rather than an accidental missing branch. Downgrade from a confirmed P2 runtime defect to a P3 design/performance risk pending that evidence. This does not reject the mechanism.

**Remaining verification:** Observe mounted row counts and astronomy calls during a real cached-catalogue mount, zero-height container and hidden-to-visible transition. If a large production all-row render is observed, promote to P2 and replace the fallback with a bounded initial range while supplying layout fixtures to tests.

## PERF-08 — ACCEPT, P2: filtering after pagination loses matching sessions

**Evidence:** `crates/persistence/targets/src/repositories/inventory.rs:138-149,173-180,214-220` runs both session-type queries with LIMIT/OFFSET and without a frame-type SQL predicate. `inventory.rs:225-254` trims sentinels and computes `has_more` before filtering by frame type. `crates/app/core/src/inventory.rs:80-86` omits the entire root if the filtered page is empty. The default cap is 1,000 per type (`app/core/src/inventory.rs:142-159`).

**Counterevidence inspected:** Pagination genuinely limits returned rows per session type; sentinel handling is correctly independent for acquisition and calibration. `repositories/inventory.rs:993-1066` tests limit/offset without frame filtering, and `1072-1127` tests both types overflowing, also without a frame filter. Those tests do not contradict the defect. Root indexes exist (`0001_initial_schema.sql:2977,3022`), but no query plan was inspected, so the report's potential sorting/index implications remain recommendations, not additional proved bugs.

**Causal conclusion:** A dark-only request can first select 1,000 newer flat/bias sessions and exclude an older dark session before filtering. It then returns no visible sessions and the application drops the source, including its `has_more` signal. This is a deterministic filtered-query correctness defect, not merely performance inefficiency. Unrelated acquisition queries and their selected-row frame-count calculations also execute for dark-only requests. The stronger wording that all matching sessions are permanently inaccessible should be avoided: an explicit unfiltered offset request could reach them; the demonstrated failure is that the filtered first response hides them and removes normal continuation evidence.

**Remaining verification:** Use mixed frame types spanning page boundaries, including a wholly filtered-out first page and unrelated-type overflow. Assert that filtered relation pagination and `has_more` agree, and that impossible session-type branches are skipped. No fixture or database test was executed here.

## Material omissions and unsupported extensions

- The item-classification early cache return was omitted in wave one and materially narrows PERF-01; corrected above.
- PERF-04's reveal loop uses query count rather than filtered count. Repeated completed-subset derivation can continue after all M filtered targets are visible; corrected complexity above. This strengthens the existing finding rather than creating another one.
- The geometry backend itself is an async function with a synchronous CPU loop and no await in its body (`target_lookup.rs:464-495`). PERF-05's duplicated submissions therefore consume async execution time as well as redundant arithmetic. This is an additional consequence of the same path, not a separately counted finding; workload timing and executor impact are unmeasured.
- No new verified unbounded-queue defect is added. Bounded watcher ingress and explicit overflow recovery are real guards. Scan memory is O(F) retained path inventory with overlapping owned copies (`crates/app/inbox/src/scan.rs:343-367,436-441`), not a demonstrated leak. Signatures allocate a 65,536-byte buffer per file and request at most that many bytes (`signature.rs:25-48`); multiplying file count by that cap gives an upper bound on requested content, not actual disk traffic, resident memory or elapsed time.
- No numerical speedup, actual frame-rate loss, query-plan result, production starvation event or visual defect was established. Source-only visual consequences remain unverified.

## Exclusions and limitations

Read-only source challenge only. No repository writes, user-data access, installs, builds, tests, formatters, linters, database operations, server startup or runtime validation occurred. Tests cited were inspected, never executed. Runtime scheduling, allocations, UI layout, dependency internals and complete migration/index coverage were not independently measured. Findings concern the specified snapshot; they are not attributed to an unavailable patch. No additional agent was delegated work.

## Prioritized roadmap

1. Correct filtered inventory pagination and continuation semantics (PERF-08); this has directly provable incorrect output.
2. Remove the reconciliation repeated search and isolate blocking filesystem phases in reconciliation/classification (PERF-02, PERF-01), preserving cache-hit and transaction behavior.
3. Restrict project-link SQL to requested sessions (PERF-03), measuring plans before selecting indexes.
4. Stabilize target derivation inputs and coalesce geometry work by generation/in-flight ID (PERF-04, PERF-05); avoid changing stale-night safeguards.
5. Filter the shared catalogue before cloning selected results (PERF-06); measure before adding debounce policy.
6. Verify production empty-range behavior before promoting the all-row fallback risk (PERF-07).

| ID | Verdict | Severity |
|---|---|---|
| PERF-01 | ACCEPT | P1 |
| PERF-02 | ACCEPT | P1 |
| PERF-03 | ACCEPT | P2 |
| PERF-04 | ACCEPT | P2 |
| PERF-05 | ACCEPT | P2 |
| PERF-06 | ACCEPT | P2 |
| PERF-07 | DOWNGRADE | P3 |
| PERF-08 | ACCEPT | P2 |

Totals: accepted 7; downgraded 1; rejected 0. Eight original findings accounted for; no additional findings added.
