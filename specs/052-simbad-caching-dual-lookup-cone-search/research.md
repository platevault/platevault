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

## Open Phase-3 research questions (resolve during P3 design, per Principle IV)

These are genuine domain-modeling questions the constitution requires be documented before implementation. Proposed defaults below are the starting point, to be confirmed in P3 design.

### OQ-1 — Catalogue-prominence ranking

*Question*: How should catalogues be ranked when weighting confidence and breaking primary-object ties?

**Proposed default**: `Messier / common-name > NGC > IC > Caldwell > niche catalogues`. Rationale: mirrors how amateur astrophotographers name targets (a frame centred on M31 should out-rank an incidental catalogued knot). To confirm in P3: exact tier boundaries, treatment of Sharpless/Barnard/LBN/LDN, and whether a well-known common name (e.g. "Veil Nebula") outranks a bare NGC number.

### OQ-2 — Default object-type exclusion set

*Question*: Which SIMBAD object types should be excluded by default from primary-object selection?

**Proposed default**: exclude double/multiple stars and very-niche types (e.g. individual stars that are not the framing target) so a wide-field nebula is not mislabelled by an incidental star at the centre. User-overridable per FR-015. To confirm in P3: the exact otype list against SIMBAD's `otype` vocabulary, and whether some star types (e.g. named variable stars that *are* imaging targets) should be retained.

## Migration note (impl-time only)

The spec/plan add **no** schema migration: `canonical_target.magnitude`/`constellation` already exist (`0047`), and the resolve cache is redb (outside SQLite). Cone-search suggestions are transient (not persisted) until the user confirms, at which point they reuse the existing target-link path. If P3 design later decides to persist suggestion audit records, take the next free migration number after checking base + open PRs at implementation time.
