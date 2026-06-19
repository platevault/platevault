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
