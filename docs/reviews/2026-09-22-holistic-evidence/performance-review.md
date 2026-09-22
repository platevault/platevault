# Performance slice — wave-one source review

Model identity exposed by runtime: `openai-codex/gpt-6-astra`. The requested @max role is not independently exposed as runtime metadata; no model or effort override was made.

## Scope and evidence

Inspected source inventory is provided in `files`; reads focused on production bodies and relevant declarations, not whole-file or whole-tree dumps. Findings below are established source mechanisms; runtime severity and latency remain unmeasured. Proposed reproducers were NOT executed. No tests, builds, formatters, linters, database operations, server startup, writes or user-data access occurred. No usable `graphify-out` artifact was present. Repository comments were treated as evidence to check, not as instructions.

Notation: F = files, K = recorded project artifacts, D = on-disk files, R = roots with visible sessions, P = all project-source links, N = target catalogue size, V = viewport rows, B = total catalogue string/alias bytes.

## Concrete strengths

- Scan filesystem work is explicitly offloaded with `spawn_blocking` (`apps/desktop/src-tauri/src/commands/inbox.rs:375-379`); scan workers are clamped to 1–8 (`crates/app/inbox/src/scan.rs:361-386`). Scan upserts share one transaction rather than committing once per folder (`apps/desktop/src-tauri/src/commands/inbox.rs:401-460`).
- FITS extraction bounds header input to 32 × 2,880 = 92,160 bytes (`crates/metadata/fits/src/lib.rs:42-47,78-90`). XISF extraction uses the header-only library entrypoint, not whole-image loading (`crates/metadata/xisf/src/lib.rs:34-48`); its documented internal 8 MiB cap was not independently audited in the third-party dependency.
- Metadata reuse is capped at 50,000 entries with a 30-minute idle expiry; successful values use Arc and concurrent same-key extraction is coalesced (`crates/app/targets/src/metadata_cache.rs:21-24,50-61,78-81`). This is substantial counterevidence against an unbounded parser cache.
- Watcher ingress is bounded and overflow sets an out-of-band atomic flag (`crates/fs/inventory/src/artifact_watcher.rs:95-107,135-143`). The consumer periodically checks that flag and reconciles (`apps/desktop/src-tauri/src/watcher.rs:442-459`). No unbounded ingress-channel finding is justified.
- Plan application runs serially per executor and checks cancellation between forward and retry items (`crates/fs/executor/src/run/loop_.rs:74-115,220-235`). The spawned run owns its registry guard and flushes buffered persistence before finalization (`crates/app/core/src/plan_apply/apply.rs:342-379`). Cancellation is intentionally not mid-item.
- Target rows have per-ID astronomy caching and a real virtualizer; inventory defaults to 1,000 sessions per type per root and batches frame/camera enrichment (`apps/desktop/src/features/targets/table-model.ts:220-242`; `apps/desktop/src/features/targets/useTargetsTableRows.ts:305-311`; `crates/app/core/src/inventory.rs:142-158,205-254`). The findings concern remaining work around those mechanisms, not their absence.

## Findings

### PERF-01 — P1 — High confidence — Defect: classification blocks async executor threads on directory and header I/O

**Evidence:** `apps/desktop/src-tauri/src/commands/inbox.rs:72-82,127-137`; `crates/app/inbox/src/classify.rs:147-170,193-219,600-611,769-791,849-863`; `crates/app/targets/src/metadata_cache.rs:83-106`.

**Causal trace:** Both classification commands directly await application futures. The current source-group path enumerates files and calls `build_file_records` synchronously between database awaits. That function loops over all files and calls `cached_extract`; even hits perform a synchronous stat, and misses open/read/parse headers. Item classification additionally computes per-file signatures synchronously. These are not isolated by the scan command's separate `spawn_blocking` boundary.

**Scaling/impact:** One group performs O(F) synchronous stat/parse operations without yielding during its collection phase. A slow removable/network filesystem can occupy a Tokio worker for the entire phase; concurrent group requests can occupy multiple workers and delay unrelated commands.

**Counterevidence:** Metadata caching reduces repeat parsing, and filesystem work occurs before the write transaction, which is good for SQLite lock duration. Neither makes synchronous I/O nonblocking.

**Recommended fix:** Move enumeration/signature/metadata collection into a bounded blocking-work stage, then await database persistence with the resulting records. Preserve existing batching and avoid one independently spawned job per file.

**Verification still needed:** Exercise cold and warm large groups with injected slow stat/read behavior while observing a lightweight independent IPC request and cancellation latency. Verify concurrency is bounded and metadata results remain unchanged.

### PERF-02 — P1 — High confidence — Defect: watcher reconciliation adds a quadratic lookup pass and performs the walk on an async worker

**Evidence:** `apps/desktop/src-tauri/src/watcher.rs:191-205,319-340,351-366,426-459,553-568`; `crates/workflow/artifacts/src/reconciler.rs:99-126`.

**Causal trace:** Project attachment and overflow/error recovery await `run_attach_reconciliation`. After a database await, it calls the synchronous reconciler with the real recursive walk/stat callbacks. The reconciler emits one `existing` result for every known path. The caller then searches `known_rows.iter().find(...)` from the start for each emitted path.

**Scaling/impact:** With K unique recorded rows, emitted in the same order, the lookup pass makes K(K+1)/2 path comparisons: 50,005,000 at K=10,000, apart from path-comparison length. Directory walking adds O(D) filesystem work. Both occur before the next database await. Reopening a large output project or recovering from event overflow therefore repeats a quadratic CPU pass while blocking an async worker.

**Counterevidence:** The inner reconciler already uses hash sets for membership and persistence uses batch operations. The quadratic behavior is introduced in the caller, not by membership testing or one commit per artifact.

**Recommended fix:** Build a path-to-row index once, or carry identifiers through reconciliation. Offload the walk/reconciliation CPU stage to a bounded blocking task; keep async database writes outside it.

**Verification still needed:** Reconcile synthetic 1k/10k/50k known rows, instrument comparison counts and async heartbeat latency, and exercise overflow recovery. Confirm identical seen/gone/unknown outputs.

### PERF-03 — P2 — High confidence — Defect: inventory performs a global project-link read for every root

**Evidence:** `crates/app/core/src/inventory.rs:71-93`; `crates/persistence/targets/src/repositories/inventory.rs:275-307`; `crates/persistence/core/migrations/0001_initial_schema.sql:3097`.

**Causal trace:** The root loop calls `list_project_links_for_sessions` with that root's session IDs. Despite accepting IDs, the SQL reads and orders every joined `project_sources`/`projects` row. Only after `fetch_all` does Rust filter by the requested IDs. Every nonempty root repeats this global fetch.

**Scaling/impact:** R roots cause R global link queries and O(R×P) row materialization/filter work, plus query ordering costs. Temporary memory is O(P) per iteration, not O(R×P) simultaneously. Session pagination does not bound this enrichment payload.

**Counterevidence:** Session IDs are batched and membership checks use a HashSet; this is not one query per session. However, the batch query itself lacks the narrowing predicate. The inspected project-source index is by project ID, not inventory-session ID.

**Recommended fix:** Filter by requested session IDs using bound, chunked SQL parameters or a suitable batched relation, with an inventory-session index. Alternatively fetch required links once for all selected roots if that contract is simpler.

**Verification still needed:** Count queries and rows decoded while varying R independently of P. Use query plans on a disposable fixture to check the new predicate/index; verify links and ordering are unchanged.

### PERF-04 — P2 — High confidence — Defect: progressive reveal repeats growing-list sorts, and unstable list-state identity invalidates filtering on unrelated renders

**Evidence:** `apps/desktop/src/features/targets/TargetsPage.tsx:159-165`; `apps/desktop/src/features/targets/useTargetsPageFilters.ts:53,123-155`; `apps/desktop/src/features/targets/useTargetsTableRows.ts:159-198,261-286`.

**Causal trace:** The page constructs a fresh `listState` object on every render. Catalogue filtering memoizes against that object, so any page render creates a new filtered array, propagating through reveal and table derivation. Reveal advances by 300 on a zero-delay timer until the full query count is reached. Each increment sorts the entire revealed prefix rather than only integrating the new chunk.

**Scaling/impact:** For M revealed rows and chunk C=300, prefixes C, 2C, …, M cause Θ(M²/C) row visits and worst-case O((M²/C) log M) sorting comparisons over a complete reveal. Separately, each reveal tick refilters the full query catalogue because `listState` changes, adding O(N×ceil(N/C)) catalogue-filter work. Unrelated parent renders after reveal can trigger another full filter and sort. `useMemo` remains synchronous render work; it is not a background thread.

**Counterevidence:** Per-ID altitude caching avoids recomputing expensive astronomy for existing rows with unchanged inputs. Virtualization limits steady-state mounted rows. Neither avoids the array scans, allocations or repeated sorting.

**Recommended fix:** Depend on stable query data/status rather than an ephemeral wrapper. Separate genuinely expensive incremental astronomy hydration from list sorting; derive or maintain ordering without sorting every growing prefix. Avoid adding another cache until stable dependencies and measurements establish the remaining bottleneck.

**Verification still needed:** Profile computation counts for initial catalogue reveal, opening the add dialog, changing selection and changing sort. Compare total rows visited and main-thread task lengths without asserting a numerical speedup.

### PERF-05 — P2 — High confidence — Defect: reveal changes discard useful astronomy batches and resubmit overlapping work

**Evidence:** `apps/desktop/src/features/targets/useTargetsTableRows.ts:95-142`; `apps/desktop/src/features/targets/useTargetsPageFilters.ts:123-131`; `apps/desktop/src-tauri/src/commands/target_lookup.rs:464-495`.

**Causal trace:** The geometry effect computes missing IDs only from completed cache entries. A change to `targets` cancels the effect's acceptance flag, not the backend request. Completed results from the old effect return before being inserted into the cache. The next effect therefore sees the old IDs as missing and submits them again with the newly revealed IDs. The backend batch directly recomputes the requested geometry; it has no cache in the inspected handler.

**Scaling/impact:** Whenever a batch takes longer than the interval between target-array changes, requests overlap and useful results are discarded. If every prefix is superseded before completion, submitted target work grows as C+2C+…+M = Θ(M²/C), rather than processing each new target once. This bound is conditional, not a measured occurrence rate. Filter changes can trigger the same mechanism.

**Counterevidence:** Successful batches that finish before cleanup do populate the cache. Requests are batched, not one IPC call per row, and shared Moon/Sun data is computed once per batch.

**Recommended fix:** Track in-flight IDs per night/generation and retain valid same-generation results even if the visible target set changes. Alternatively serialize/coalesce pending target batches. Preserve rejection of genuinely stale-night results and unmount safety.

**Verification still needed:** Delay IPC responses deliberately across several reveal ticks, count submitted IDs, and verify each ID is processed once per generation. Change nights while requests are pending to prove stale results cannot leak.

### PERF-06 — P2 — High confidence — Defect: type-ahead search deep-clones the entire catalogue before filtering

**Evidence:** `apps/desktop/src/components/FilterToolbar.tsx:285-291`; `apps/desktop/src/features/targets/TargetsPage.tsx:156-159`; `apps/desktop/src/features/targets/store.ts:103-112`; `crates/app/targets/src/target_management/list.rs:35-51,55-78`.

**Causal trace:** Each input change immediately updates the query key and invokes `targetList`. The cached backend path clones the entire owned `Vec<TargetListItem>` before checking or applying the search. The predicate then creates normalized/lowercase strings for designations, labels and aliases. Even a search returning zero or one item pays full-catalogue cloning first. The query function does not consume a cancellation signal.

**Scaling/impact:** Each distinct query incurs O(B) clone traffic plus O(B) worst-case normalization/search work, independently of result size. Q distinct rapidly entered keys can submit O(Q×B) work. Query caching may reuse previously searched keys, but it does not coalesce first-time prefixes.

**Counterevidence:** The shared catalogue cache avoids repeat SQL reads; server-side filtering does reduce returned target count. The avoidable problem is copying before filtering, not the existence of a catalogue scan for substring search.

**Recommended fix:** Retain the Arc-backed catalogue through filtering, then clone only matching records. Consider precomputed normalized search fields and measured debounce/coalescing of input. Keep alias-aware matching semantics intact.

**Verification still needed:** Use allocation profiling and IPC request counts for a long type-ahead query over a large alias catalogue. Verify alias-only, whitespace-normalized, empty and zero-result searches.

### PERF-07 — P2 — Medium confidence on runtime reachability; high on source behavior — Defect: an empty virtual range renders every row

**Evidence:** `apps/desktop/src/features/targets/useTargetsTableRows.ts:305-324`; `apps/desktop/src/features/targets/TargetsTable.tsx:383-384,449-458`.

**Causal trace:** The table interprets `virtualItems.length === 0` as permission to map all flat rows. The comment explains this as a jsdom convenience, but there is no test-only guard: runtime also enters the branch whenever there is no measured range. Every mapped target then runs visible-row astronomy rendering.

**Scaling/impact:** The fallback changes mounted/rendered work from O(V) to O(N), including the more expensive per-visible-row path. Initial unmeasured or zero-height/hidden layouts are candidate runtime triggers; actual occurrence was not rendered or measured in this review.

**Counterevidence:** Once the virtualizer reports a range, normal viewport windowing works. Progressive reveal initially reduces the list for some page states, but cached/full-list and searched data can be larger.

**Recommended fix:** Do not use an all-row production fallback for a missing measurement. Provide a bounded initial range/initial rectangle or wait for measurement; supply layout/virtualizer fixtures in tests instead of changing production complexity for jsdom.

**Verification still needed:** Mount with cached full-catalogue data, zero-height and hidden-to-visible containers. Count mounted rows before/after measurement and confirm selection and scrolling behavior.

### PERF-08 — P2 — High confidence — Defect: inventory filters run after pagination, wasting enrichment work and hiding matching sessions

**Evidence:** `crates/persistence/targets/src/repositories/inventory.rs:138-149,173-180,214-220,225-254`; `crates/app/core/src/inventory.rs:80-90,142-159`; `crates/persistence/core/migrations/0001_initial_schema.sql:2977,3022`.

**Causal trace:** Both acquisition and calibration queries execute regardless of the requested frame type; both apply LIMIT/OFFSET before the Rust `frame_type` filter. Consequently a dark-only page still reads acquisition rows and counts their frame JSON, and newer calibration rows of other types can displace all dark matches from the SQL page. If the filtered result is empty, the app omits the root entirely, losing its `has_more` signal.

**Scaling/impact:** Unwanted sessions incur JSON frame-member count/lookups and decoding up to the per-type page bound. Correctness becomes a performance/navigation problem at scale: matching older sessions can be inaccessible through an empty omitted root. The inspected root-only indexes help select a root but do not satisfy `ORDER BY created_at DESC`; exact sorting behavior requires a query plan.

**Proposed reproducer:** Give one root more than the default 1,000 newer flat/bias calibration sessions and an older dark session, then request dark-only inventory. The first calibration page contains no dark rows; acquisition rows are also fetched and discarded; the root is omitted.

**Recommended fix:** Push the frame predicate into SQL before pagination and skip the impossible session branch. Add query-aligned root/type/date indexes after checking plans, rather than assuming LIMIT itself prevents scanning or sorting preceding candidates.

**Verification still needed:** Use mixed-type fixtures crossing the page boundary, including a page with only filtered-out recent rows. Assert matching sessions remain discoverable, `has_more` reflects the filtered relation and unrelated-type queries are not executed.

## Additional resource observations — not promoted to defects

- Scan retains the complete leaf inventory and clones its file paths into results (`crates/app/inbox/src/scan.rs:343-367,436-441`): O(F) retained paths with two overlapping owned representations near completion. It is not a streaming scan. Single-leaf workloads do not benefit from the leaf-chunk parallel path. Signatures independently read up to 65,536 bytes per file and allocate a buffer per file (`crates/app/inbox/src/signature.rs:25-48`); for 100,000 sufficiently large readable files, one scan requests up to 6,553,600,000 signature bytes, irrespective of metadata cache warmth. This quantifies work, not elapsed time or a proven regression. There is no cancellation parameter in `scan_root`; introducing it is an opportunity requiring product cancellation semantics.
- The watcher pending map is bounded by neither count nor bytes in the inspected consumer (`apps/desktop/src-tauri/src/watcher.rs:227-249,417`). Unique files that remain unstable can outlive the bounded ingress queue; every sweep copies the pending paths and revisits them. However, stable/gone entries are removed and recovery clears the map, so indefinite ordinary-workload growth is not established. A sustained-many-writers stress experiment is warranted before assigning severity.
- Session-count aggregation loads the acquisition-session target columns and counts in Rust (`crates/persistence/targets/src/repositories/q_targets_mgmt.rs:190-199`), but only on a catalogue cache miss in the inspected target-list flow. No per-target SQL N+1 was found there.

## Exclusions and limitations

This was a static slice review, not a full repository audit. No timing, allocation, query-plan, queue-depth, cancellation-latency or visual measurements were made; source-only visual consequences remain unverified. Third-party parser internals, all cache invalidators, all executor filesystem actions, all frontend screens, and migration execution state were outside the inspected scope. No claim is made that the listed findings exhaust all large-library paths. Severity prioritizes reachable scaling/resource mechanisms, not measured user latency. Mechanical prose validation was also skipped under the no-validation constraint.

## Prioritized roadmap

1. **Protect executor responsiveness:** isolate classification filesystem work (PERF-01); remove the reconciliation nested search and isolate its filesystem phase (PERF-02).
2. **Correct query scope:** fix inventory filter-before-pagination semantics (PERF-08), then narrow project-link enrichment and verify its index (PERF-03).
3. **Stop repeated catalogue work:** stabilize query-data dependencies and redesign progressive derivation (PERF-04); coalesce geometry batches (PERF-05); filter shared catalogue data before cloning (PERF-06).
4. **Preserve the virtualization bound:** replace the production all-row fallback and exercise zero-layout transitions (PERF-07).
5. **Measure remaining resource opportunities:** warm/cold scan bytes and peak path memory, sustained watcher-pending cardinality, query plans and UI task duration. Any later optimization should report measured work/latency and retain correctness fixtures; no numerical speedup is claimed here.

## Inspection inventory

- `crates/app/inbox/src/scan.rs`: Read scan walk, leaf processing, worker bounds and retained path inventories.
- `crates/app/inbox/src/signature.rs`: Read partial hashing allocation, per-file reads and signature sorting.
- `crates/app/inbox/src/classify.rs`: Read item/group classification, synchronous metadata collection and batched persistence.
- `crates/app/targets/src/metadata_cache.rs`: Read metadata cache capacity, expiry, single-flight and Arc-backed values.
- `crates/metadata/fits/src/lib.rs`: Read bounded FITS header extraction and parser panic containment.
- `crates/metadata/xisf/src/lib.rs`: Read XISF header-only adapter and extraction boundary.
- `apps/desktop/src-tauri/src/commands/inbox.rs`: Read classification dispatch and spawn_blocking scan/persistence transaction.
- `crates/fs/inventory/src/artifact_watcher.rs`: Read bounded event channel and overflow recovery signal.
- `apps/desktop/src-tauri/src/watcher.rs`: Read attach reconciliation, debounce map, forwarding task and recovery paths.
- `crates/workflow/artifacts/src/reconciler.rs`: Read reconciliation membership sets and per-known-row output.
- `crates/fs/executor/src/run/loop_.rs`: Read serial executor, cancellation boundaries and retry draining.
- `crates/app/core/src/plan_apply/apply.rs`: Read background executor dispatch, guard ownership and final flush.
- `crates/app/core/src/inventory.rs`: Read per-root inventory orchestration, default limits and batched enrichment.
- `crates/persistence/targets/src/repositories/inventory.rs`: Read session pagination, JSON frame counts and project-link query.
- `crates/persistence/targets/src/repositories/q_targets_mgmt.rs`: Read session-count aggregation and target alias access.
- `crates/persistence/core/migrations/0001_initial_schema.sql`: Inspected session/project-source index declarations through targeted search.
- `crates/app/targets/src/target_management/list.rs`: Read cached catalogue loading, search filtering and owned-result creation.
- `apps/desktop/src/features/targets/store.ts`: Read query keys, immediate IPC search and mutation invalidation.
- `apps/desktop/src/features/targets/TargetsPage.tsx`: Read list-state construction, search state and filter hookup.
- `apps/desktop/src/features/targets/useTargetsPageFilters.ts`: Read progressive reveal, catalogue filtering and dependency identity.
- `apps/desktop/src/features/targets/useTargetsTableRows.ts`: Read astronomy batch lifecycle, sort/group derivation and virtualization fallback.
- `apps/desktop/src/features/targets/table-model.ts`: Read sort comparator and astronomy row-cache generation.
- `apps/desktop/src/features/targets/TargetsTable.tsx`: Inspected row mapping and visible-row astronomy calls.
- `apps/desktop/src/components/FilterToolbar.tsx`: Inspected direct search onChange forwarding.
- `apps/desktop/src/features/inbox/useInboxListData.ts`: Read query reuse, stable empty arrays and list cap handling.
- `apps/desktop/src-tauri/src/commands/target_lookup.rs`: Read uncached Moon/opposition batch computation.
