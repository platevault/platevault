# Research: SIMBAD Resolver Caching, Dual-Lookup, and Cone-Search

**Feature**: 052-simbad-caching-dual-lookup-cone-search | **Date**: 2026-07-12

Ground-truth code references confirmed during exploration (base `origin/main` @ 8b6b5839).

## Baseline (what already exists)

- **Resolver crate** `crates/targeting/resolver/` (`cache.rs`, `seed.rs`, `simbad.rs`, `caldwell.rs`, `lib.rs`). The repo's `SimbadResolver` is a **thin wrapper over `simbad_resolver::TapResolver`** (`simbad.rs:36`, `TapResolver::new` at `simbad.rs:47`) — it calls the TAP path directly. This is the "B2 direct-TAP" referenced in the campaign decisions.
- **Hand-rolled search** in `cache.rs`: `search_by_normalized` (`:245`) plus opt-in `search_fuzzy` (`:339`) over `target_alias.normalized`, using `simbad_resolver::normalize::token_set_similarity`. Two ranking code paths to converge onto one facade search.
- **`canonical_target`** schema: `crates/persistence/db/migrations/0031_target_resolution.sql` (id UUIDv5, `simbad_oid` dedup key UNIQUE-when-non-null, `primary_designation`, `object_type`, ICRS `ra_deg`/`dec_deg`, `source ∈ {seed,resolved,user-override}`, `display_alias`). `constellation TEXT` + `magnitude REAL` added nullable by `0047_target_constellation_magnitude.sql` — **present but only sparsely populated today**.
- **Dependency pins**: `simbad-resolver = "0.1.3"` (`crates/targeting/resolver/Cargo.toml:48`), `target-match = "0.3"` and `skymath = "0.3"` (`crates/targeting/Cargo.toml:17-18`; also in `crates/app/inbox`, `crates/metadata/core`).
- **Seed builder**: `crates/tools/seed-builder/src/main.rs`. `parse_basic_row` yields a 5-tuple `(oid, main_id, ra, dec, otype)`; two TAP `SELECT`s (around `:260`, `:297`) omit the V-magnitude column.
- **Online gating**: the live `SimbadResolver` is built only when the online-resolve setting is on (`apps/desktop/src-tauri/src/lib.rs:934-958`; `commands/target_lookup.rs:49-74`) — the spec-035 FR-015 gate this feature reuses.

---

## D1 — Facade vs direct `TapResolver`

**Decision**: Adopt the `simbad-resolver` crate's own **`SimbadResolver` facade** (0.2.0), constructed as `SimbadResolver::new(TapResolver, CacheBackend::File(<app_data>/simbad-cache.redb), ResolverConfig)`. Refactor the repo's current direct-`TapResolver` usage (`crates/targeting/resolver/src/simbad.rs`) onto it. The facade owns caching, dual-lookup, and unified search behind one type.

**Alternatives**:
- *(A) Keep calling `TapResolver` directly and bolt persistence/dual-lookup/search on in-repo.* Rejected: duplicates logic the upstream facade already maintains (caching, TAP+Sesame ordering, normalized search), and keeps two divergent search paths. Fails code-economy (reuse maintained upstream over hand-roll).
- *(B) Facade (chosen).* One integration seam; the crate is the maintained home for resolution semantics; the repo keeps only its domain mapping (Caldwell translation, `ObjectType`/`TargetSource` enums, `canonical_target` persistence).

**Consequence**: `cache.rs`'s hand-rolled `search_by_normalized`/`search_fuzzy` are replaced by `facade.search()` over the unified store; the `token_set_similarity` fuzzy path is dropped unless the facade lacks an equivalent (verify at impl).

## D2 — Cache backend: `File` (redb) vs `InMemory` vs moka

**Decision**: `CacheBackend::File` — the facade's own persistent **redb** file, **one global file** in the app-data dir, **no TTL**, plus a manual "clear resolve cache" action.

**Alternatives**:
- *`InMemory`* — the effective status quo; re-queries SIMBAD after every restart (SC-001 fails). Rejected.
- *`moka`* (in-process concurrent cache) — still volatile across restarts and adds a dependency for no durability gain. **Rejected** (explicitly dropped in the campaign decisions).
- *Per-library cache file* — rejected: SIMBAD identities are universal, not library-scoped; one global file avoids re-resolving the same object per library.
- *TTL expiry* — rejected: catalogue identities are stable; a TTL would force needless re-queries. A manual clear covers the rare "the seed/catalogue changed" case.

## D3 — §V reconciliation: cache vs system-of-record

**Decision**: The redb cache is a **reproducible projection**; SQLite `canonical_target` remains the **canonical, FK-anchored system-of-record** (constitution §V). On any conflict the durable row wins; clearing the cache never touches `canonical_target` and the cache re-warms from seed + durable rows (D6).

**Rationale**: §V requires the database to be the durable relationship/audit record and marks manifests/projections reproducible unless explicitly canonical. The cache is exactly such a projection. This is what lets FR-004 move persistence to adoption without risking data loss — the cache can be rebuilt, the durable rows cannot.

## D4 — In-use-gated persistence (supersedes spec-035 FR-006)

**Decision**: Write `canonical_target` **only** when a target becomes "in use": added to a project, linked to an acquisition session, favourited, or confirmed in the Inbox. Pure typeahead/search hits the redb cache only.

**Rationale**: spec-035 FR-006 made the cache the durable record and persisted on every resolution, so browsing SIMBAD populated the system-of-record with objects the user never adopted. Splitting a persistent-but-reproducible cache (D2) from an adoption-gated durable table keeps the system-of-record clean while still making repeat search free. Documented supersession in `spec.md` FR-004.

**Alternative**: *persist-on-resolve (status quo).* Rejected for the clutter and semantics above.

## D5 — TAP-first / Sesame-fallback

**Decision**: Dual lookup = **TAP first, Sesame name-resolver fallback only on a TAP miss**, fired only on an **explicit** resolve (Enter / confirm / "search harder"), never per typeahead keystroke. oid recovery: a Sesame hit lacking `simbad_oid` is re-enriched via TAP by coordinates/main_id; if still none, a **UUIDv5-from-designation** synthetic identity preserves FR-007 dedup. Gated by the online-resolve setting.

**Alternatives**:
- *Sesame-first* — rejected: TAP returns the structured identifier/oid the dedup key needs; Sesame is a name→coords resolver with weaker structure. TAP-first keeps oids populated.
- *Fallback on every keystroke* — rejected: impolite to CDS and needless latency; typeahead is served locally.

## D6 — Normalization choke-point

**Decision**: A **single** normalization function (`simbad_resolver::normalize`) is the sole path by which any identity string is prepared before caching, persisting, or matching — applied identically to TAP, Sesame, Caldwell, user query, and seed. Dedup keys on `simbad_oid` → normalized primary designation; every alias is normalized before storage.

**Rationale**: FR-007 and FR-010 both depend on the same string being normalized the same way regardless of source; divergent normalization is how aliases split across catalogues. Centralizing it makes the dedup invariant enforceable and testable in one place. The repo already routes cache reads/writes through `targeting::normalize::normalize`; this decision makes that the *only* route.

## D7 — Seed builder V-magnitude fix (paired with the 0.2.0 bump)

**Decision**: Bump `simbad-resolver` 0.1.3 → 0.2.0 (facade + `ResolvedIdentity.v_mag`). Fix `seed-builder`: widen `parse_basic_row` from a 5-tuple to a 6-tuple `(oid, main_id, ra, dec, otype, v_mag)`, and add `f.V` + `LEFT OUTER JOIN allfluxes AS f ON f.oidref = b.oid` to its two TAP `SELECT`s so the bundled seed carries magnitude.

**Rationale**: Enrichment (FR-006) sources magnitude from `ResolvedIdentity.v_mag` for online resolves and from the seed for offline ones; without the seed-builder fix, seed-sourced adoptions would have no magnitude. `LEFT OUTER JOIN` keeps rows whose flux is absent (magnitude stays optional).

## D8 — Constellation enrichment

**Decision**: Populate `canonical_target.constellation` via **skymath 0.3** IAU constellation-from-coordinates (currently pinned but unused). Compute at adoption/resolve time from the target's ICRS coordinates.

**Rationale**: Coordinates are always present (never fabricated, spec-035 FR-009); constellation is a pure function of them, so it needs no extra network call and works offline. Reuses an already-pinned dependency (code economy).

## D9 — Cone-search building blocks (Phase 3)

**Decision**: Pointing source precedence WCS `CRVAL1/2` → `OBJCTRA/OBJCTDEC` → none (never filename). Field footprint and FOV from **target-match 0.3** (`Field`/`Optics` from focal length + sensor), **rotation-aware**; cone radius from FOV with a **~1°** default when optics are unknown; fetch top-N in radius. Confidence = separation-from-centre + source quality (WCS > mount) + catalogue-prominence weight, carried explicitly (constitution II). Primary object = nearest-to-centre, tie-broken by prominence, minus a default niche-otype exclusion set.

**Rationale**: `target-match` already models optics→FOV and field matching; reusing it avoids re-deriving plate scale. Confidence is explicit per constitution II (inference must carry confidence). "Suggested only, never silent auto-apply" satisfies constitution II's reviewable-mutation posture at the identity-linking layer.

## Phase-3 OQ resolution (2026-07-13) — T022

**Governing principle** (user, 2026-07-13): zero static/curated object data — the ranking + exclusion inputs all come from `simbad_resolver::ResolvedIdentity` (`common_name`, `aliases: Vec<ResolvedAlias>` each with `AliasKind::{Designation,CommonName,User}`, `object_type: ObjectType`, `otype_raw`, `simbad_oid`). The only "static" artifacts are two small deterministic rule tables (`crates/targeting/resolver/src/cone_search.rs`), not object lists.

### OQ-1 — Catalogue-prominence ranking (RESOLVED)

**Decision**: tiers option 3, common-name promoted, alias-dedup mandatory.

- Prominence tier of an object = the **best (highest) tier across all its `aliases`** (kind `Designation`), by a catalogue-prefix→tier table (deterministic prefix classifier, not a catalog): `Messier(M) / common-name > NGC > IC > {Sharpless Sh2, Barnard B, LBN, LDN} > Caldwell(C) > other/niche`. (AP nebula catalogues Sh2/B/LBN/LDN are one mid-tier ABOVE Caldwell — user pick #3.)
- **Common name outranks a bare catalogue number**, sourced from the resolver — NO static name set: an object is in the top tier iff it has `common_name.is_some()` (equivalently any alias `kind == CommonName`, SIMBAD `NAME …`). So "Veil Nebula" (NGC 6960) lands top-tier because SIMBAD carries its `NAME`.
- **Alias-dedup before ranking (user requirement)**: cone-search returns top-N; before ranking, collapse duplicates of one physical object — primary key `simbad_oid` (same oid → one object, prominence = max over its aliases). Objects lacking an oid (seed/offline) dedup on normalized `primary_designation` (FR-007). Secondary guard: if two distinct candidates share any normalized alias across their alias sets, treat as duplicate and keep the higher-prominence one. Only the surviving highest-priority representative is shown.

Implemented in `targeting_resolver::cone_search::{prominence_tier, dedup_candidates}`.

### OQ-2 — Default object-type exclusion set (RESOLVED)

**Decision**: Stars + non-DSO points, retain named/notable stars.

- Exclude from primary-object selection when `object_type ∈ {DoubleStar, Asterism}` OR `otype_raw` is a single-star/non-DSO point type (SIMBAD otype star family `*`, `**`, `V*`, `PM*`, `HB*`, `WR*`, `Em*`, … and non-object points `Radio`, `X`, `gLens`, `err`, `?`…). Keep Galaxy/\*Nebula/\*Cluster/SupernovaRemnant/GalaxyCluster selectable. (Curated against SIMBAD's vocabulary at impl time — a small rule table in `targeting_resolver::cone_search::EXCLUDED_OTYPES`, resolver-fed.)
- **Retain named/notable stars**: the exclusion is skipped when `common_name.is_some()` — a genuine stellar target (Betelgeuse, a named variable) stays selectable while incidental field stars drop out. "Notable" signal = the resolver's curated `NAME`, no static list. Excluded objects are still shown, not pre-selected (FR-015); user override can always promote one.

Implemented in `targeting_resolver::cone_search::is_default_excluded`.

## Migration note (impl-time)

The Phase-0/1 assumption that WCS `CRVAL1/2` was already extracted (implicit in this doc's D9 and in data-model.md's Pointing entity) did not hold: no format adapter parsed `CRVAL1/2`/`CTYPE1/2` before P3. Reconciled at P3 implementation:

- `crates/metadata/core` gained a shared `interpret_wcs_pointing` helper (CTYPE-gated CRVAL1/2 + CD-matrix/CROTA2 rotation), consumed identically by `crates/metadata/fits` and `crates/metadata/xisf` (no per-adapter WCS logic).
- Migration `0062_inbox_wcs_pointing.sql` adds `inbox_file_metadata.wcs_ra_deg`/`wcs_dec_deg`/`wcs_rotation_deg` (distinct from the existing mount `ra_deg`/`dec_deg`) — the first schema change this spec required.
- Cone-search suggestions themselves remain transient (not persisted) until the user confirms, at which point they reuse the existing target-link path (`app_core_targets::target_resolve::promote_by_id`). No new audit-record migration was needed.
