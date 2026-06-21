# Research: SIMBAD Target Resolution

**Spec**: 035-simbad-target-resolution | **Plan**: [plan.md](./plan.md) | **Date**: 2026-06-18

Supporting design + live verification: `docs/development/catalog-data-pipeline-plan.md` (rev 3).
Technical Context had no open `NEEDS CLARIFICATION`; product ambiguities were resolved in the spec's
Clarifications session. This file records the technical decisions.

## R1. SIMBAD access method

**Decision**: Use the **SIMBAD TAP** sync endpoint (`https://simbad.cds.unistra.fr/simbad/sim-tap/sync`,
ADQL) for structured resolution + alias/common-name retrieval, and the Sesame `sim-id` resolver as a
lightweight fallback for single-identifier resolution. Resolve via `basic` (ICRS `ra`/`dec`, `otype`,
`main_id`) joined to `ident`/`ids` (full alias set; `NAME …` = curated common names).

**Rationale**: TAP returns position + type + all aliases + common names in one call and supports the
queries we verified live. Sesame is a simpler GET resolver useful for exact identifiers and as a
backstop. Both are CDS-official, TLS, no signing needed.

**Alternatives**: VizieR per-catalog tables — rejected as primary: no cross-IDs/aliases/common-names,
original-epoch coordinates (e.g. Sharpless VII/20 is B1900), subset-only TAP, per-table parsing.
Bundled+signed catalog files (old spec 014) — rejected: unjustified once offline isn't required.

## R2. SIMBAD identifier acronyms (verified live 2026-06-18)

The seed/membership queries map our catalogue vocabulary to SIMBAD's space-padded, case-sensitive
prefixes: `M `, `NGC `, `IC `, `SH  2-` (two spaces), `Barnard `, `PN A66 ` (Abell PN), `ACO `
(Abell clusters), `APG ` (Arp), `VDB ` (vdB), `LBN `, `LDN `, `Cl Melotte `. **Caldwell is NOT a
SIMBAD designation** → a committed static **C1–C109 → NGC/IC map** (Patrick Moore's list) resolves
Caldwell to an object, then SIMBAD enriches it.

**Rationale**: empirically confirmed counts (e.g. Sharpless `SH  2-` → 366; Barnard → 372; Abell PN
`PN A66 ` → 86) and a working unified pull (`basic ⋈ ident` returns ICRS deg + otype).

## R3. Bundled seed index

**Decision**: Ship a **static seed asset** (SQLite db, or JSON loaded into SQLite at first run) of the
popular catalogues, built **once** from SIMBAD (+ OpenNGC for NGC/IC richness) by an offline build
script. Loaded into the local cache at first run (`source = seed`). Refreshed on app releases; no CI
signing/manifest/auto-update.

**Rationale**: SIMBAD has no prefix/partial-search API, so instant typeahead needs local data. A
bundled asset gives sub-100ms suggestions (SC-001) and offline tolerance for common objects.

**Alternatives**: client builds seed from SIMBAD at first run — rejected (hammers CDS per install,
slower first-run). No seed (pure live) — rejected (no instant typeahead).

## R4. Local cache & object identity

**Decision**: SQLite cache keyed by canonical target; physical-object **dedup by SIMBAD `oid`** (an
object in several catalogues is one target, KStars/Stellarium pattern). Each entry records `source`
(`seed` | `resolved` | `user-override`) and `resolved_at`. `user-override` rows take precedence
(FR-014). Cache is the durable record; a cached object is never re-queried (FR-006).

**Rationale**: dedup prevents target fragmentation across aliases (FR-007); source precedence makes
manual corrections sticky; cache-once keeps SIMBAD load minimal.

**Alternatives**: re-validate cache on a TTL — deferred; DSO positions/identities are effectively
static, so cache-forever is the v1 default (a manual "refresh" action can be added later).

## R5. Interactive search etiquette

**Decision**: typeahead renders local (seed+cache) results immediately; SIMBAD long-tail queries are
**debounced (~300 ms), require a minimum query length, and cancel the in-flight request** on new
input; results are de-duped against local hits and cached. Requests carry an identifying
`User-Agent` (CDS norm).

**Rationale**: keeps the public service usage polite (FR-005) and the UI responsive.

## R6. Async ingest resolution

**Decision**: ingest resolution runs on a **background queue** (FR-013): cache/seed hits resolve
inline; uncached `OBJECT` values are enqueued and resolved in the background; images are marked
**pending** (FR-009) until resolved, then associated with the canonical target. Emit
`target.resolved` / batch-completed events on the existing `tokio::broadcast` bus (replacing the
retired `catalog.download.*` topics).

**Rationale**: importing many files must not block on per-object network round-trips; pending state
preserves correctness without fabrication.

## R7. Testability seam

**Decision**: define a `Resolver` trait with `SimbadResolver` (reqwest) and `FakeResolver` (no
network) implementations — mirroring the retired `download::CatalogFetcher`/`FakeFetcher` seam — so
the search/resolve/queue logic is unit-testable offline.

**Rationale**: preserves fast, network-free unit tests and proven contract-parity testing.

## R8. Contracts & supersession

**Decision**: new operation contracts `target.search`, `target.resolve`, and resolver settings
(`target.resolution.settings.get`/`update`) in `crates/contracts/core` + `packages/contracts`. Retire
spec-014 `catalog.manifest.fetch` / `catalog.download` / `catalog.entry-file` contracts and the
`catalog.download.*` event topics. The spec-014 **license-attribution** model (CDS/OpenNGC CC-BY) is
retained for the app's notices (FR-012).

**Rationale**: keeps the UI-to-core boundary language-neutral (§V) while removing the superseded
download surface; reconciliation banners already added to 002/003/013/014/018/033.

---

*Decisions R9–R12 were added by iteration 2026-06-21 (US4 ingest grouping reactivation).*

## R9. `file_record.root_id` FK — ensure `library_root` row for inbox destinations

**Decision**: Before inserting a `file_record` row during plan-apply ingest, the ingest module MUST
resolve or ensure a `library_root` row exists for the destination root. Inbox move/catalogue
operations produce applied paths whose destination root may be a `registered_sources` entry (not yet
a `library_root`). The correct approach is to resolve/mirror the destination as a `library_root`
before inserting the `file_record`. If the root cannot be resolved or mirrored, the ingest step for
that frame is skipped and an audit entry is written; the session is still created (without that
frame) and the skip is retryable.

**Rationale**: `file_record.root_id` is a FK to `library_root`; inserting without a matching row
causes a constraint violation. This was the root cause of the `source.missing` bug in spec 041
(see memory: spec-041-apply-rootid-gen3.md). The spec-041 fix resolved root_id correctly; the
ingest path must apply the same resolution.

**Alternatives**: Use an absolute path (no `root_id` FK) — rejected: breaks the root-remapping
model (constitution §I). Use a join table — rejected: same complexity, no benefit.

## R10. Id-space mismatch — additive `canonical_target_id`, not legacy `target_id`

**Decision**: `acquisition_session.canonical_target_id` is a new nullable column referencing
`canonical_target(id)` (spec-035 UUID v5 space). The existing `target_id` column (FK → legacy
`target` table) is left untouched. This mirrors the decision made in migration 0033 for `projects`:
an additive nullable column coexisting with the legacy FK, not replacing it.

**Rationale**: The spec-035 `canonical_target` table uses a different id-space from the legacy
`target` table; writing to `target_id` with a spec-035 id would cause a FK violation or silent
mis-reference. A join table was evaluated and rejected: it adds a third table, complicates queries,
and provides no benefit over a single nullable FK column on the same row (which is idempotent to
insert and standard SQL).

**Alternatives**: Join table `acquisition_session_canonical_target` — rejected (see above). Write
spec-035 id to `target_id` — rejected (FK violation / id-space mismatch).

## R11. UTC observing-night fallback

**Decision**: When the observer's geographic location is not configured, the observing-night
boundary used in `session_key` grouping is computed in UTC instead of local solar time. The
`acquisition_session` records `has_observer_location = 0` to mark the degraded computation.
Sessions spanning a UTC midnight boundary may be incorrectly split. This is a documented, accepted
degraded mode for v1; a corrective re-group action can be added later if location is subsequently
configured.

**Rationale**: Session grouping must not fail silently or block ingest when location is missing.
UTC is the lowest-friction correct fallback; the flag preserves the information needed to identify
and correct affected sessions.

## R12. `plan_listener` ingest idempotency

**Decision**: The ingest hook in `plan_listener::handle_plan_completed` is idempotent by
construction: (a) `file_record` has a UNIQUE constraint on `(root_id, relative_path)` — repeat
ingest of the same file upserts, not duplicates; (b) `acquisition_session` has a UNIQUE constraint
on `session_key` — the upsert appends `frame_ids` using set-dedup so a frame id already present is
not added again; (c) only `move` and `catalogue` plan items with `terminal_state == "applied"` are
processed — other item types (calibration registrations, etc.) are filtered out.

**Rationale**: Plan-apply completion events may be re-delivered (e.g. crash recovery, retry). The
ingest path must produce the same result regardless of how many times it is called for the same plan.
