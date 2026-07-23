# Data Model: SIMBAD Resolver Caching, Dual-Lookup, and Cone-Search

**Feature**: 052-simbad-caching-dual-lookup-cone-search | **Date**: 2026-07-12

Principle: reuse existing tables and columns. This feature adds **no** new SQLite table and **no** migration. Changes are (a) enforcing when `canonical_target` rows are written (in-use gate), (b) actually populating the already-present `magnitude`/`constellation` columns, (c) a persistent redb resolve-cache shape (outside SQLite), and (d) a transient cone-search suggestion/confidence model.

## Entities

### Canonical target — existing `canonical_target` (`0031` + `0047`)

No schema change. Semantics this feature enforces:

| Column | Type | This feature |
|--------|------|--------------|
| `id` | TEXT PK (UUIDv5) | unchanged; UUIDv5-from-normalized-designation is also the synthetic-identity fallback when no `simbad_oid` (FR-010) |
| `simbad_oid` | INTEGER | dedup key (UNIQUE when non-null); recovered via TAP re-enrichment for Sesame hits that lack it (FR-010) |
| `primary_designation` | TEXT | normalized via the single choke-point before write (FR-007) |
| `object_type` | TEXT | unchanged closed enum |
| `ra_deg` / `dec_deg` | REAL | unchanged (ICRS J2000, never fabricated) |
| `source` | TEXT `seed`\|`resolved`\|`user-override` | unchanged |
| `resolved_at` | TEXT | unchanged |
| `magnitude` | REAL (nullable) | **now populated** from `ResolvedIdentity.v_mag` (online) or the seed (offline) at adoption/resolve — remains NULL when the source has none (FR-006) |
| `constellation` | TEXT (nullable) | **now populated** via skymath 0.3 IAU-from-coordinates at adoption/resolve (FR-006) |
| `display_alias` | TEXT | unchanged (presentation-only, never normalized/matched) |

**Write gate (FR-004, supersedes spec-035 FR-006)**: a row is written **only** when the target becomes in use — added to a project, linked to an acquisition session, favourited, or confirmed in the Inbox. Pure typeahead/search never writes here. On adoption, the row is created (or the existing dedup match reused) and enriched with magnitude + constellation.

### Resolve cache — persistent redb (NEW, outside SQLite)

`CacheBackend::File(<app_data>/simbad-cache.redb)`, one global file (identities are universal), **no TTL**. Owned by the `simbad-resolver` facade; the repo treats it as an opaque projection with these properties:

| Property | Value |
|----------|-------|
| Scope | global (app-data dir), not per-library |
| Contents | resolved identities + normalized aliases, keyed for typeahead/search |
| Authority | **non-authoritative projection** — `canonical_target` wins on conflict (§V) |
| Expiry | none |
| Warm | at first run from the bundled seed + existing durable `canonical_target` rows (FR-005) |
| Clear | manual "clear resolve cache" action; never deletes any `canonical_target` row; re-warms from seed + durable rows |
| Search | `facade.search()` is the single search path (replaces `cache.rs` `search_by_normalized`/`search_fuzzy`) |

**Invariant**: every string entering the cache passes the normalization choke-point (FR-007); dedup keys on `simbad_oid` → normalized primary designation.

### Pointing — derived (transient, P3)

Not persisted. Derived per light-frameset at ingest:

| Field | Meaning |
|-------|---------|
| `center` | ICRS sky centre (deg) |
| `source` | `wcs` (plate-solved, high) \| `mount` (medium) \| `none` (no suggestion) |
| `fov` | field of view from target-match `Optics` (focal length + sensor); default radius ~1° when optics unknown |
| `rotation` | camera rotation, applied to the footprint |

Precedence: WCS `CRVAL1/2` → `OBJCTRA/OBJCTDEC` → none. **Never** from the filename. A frameset whose subs disagree on pointing beyond tolerance resolves to `source = none`.

### Cone-search suggestion + confidence — derived (transient, P3)

Not persisted until the user confirms (then it flows through the existing target-link/adoption path). Per candidate:

| Field | Meaning |
|-------|---------|
| `candidate_target` | canonical identity (from resolution over local + online catalogues) |
| `separation_deg` | angular separation from the field centre |
| `confidence` | explicit level combining `separation_deg` + source quality (WCS > mount) + catalogue-prominence weight (OQ-1) |
| `preselected` | true for high confidence, false for low (never silent auto-apply) |
| `excluded` | true if the candidate's object type is in the default exclusion set (OQ-2), unless user-overridden |

**Primary object** (multi-object frame): nearest-to-centre (min `separation_deg`) among non-excluded candidates, tie-broken by catalogue prominence (OQ-1). If all in-field candidates are excluded, no primary is pre-selected; candidates may still be shown for manual choice.

## Relationships

```
canonical_target 1───1 resolve-cache entry   (projection of the durable row; cache re-derivable)  [NEW cache; SQLite canonical]
canonical_target *───1 project / session / favourite / inbox-confirm  (in-use gate → write)        [existing links; write timing changed]
light-frameset   1───1 Pointing               (derived at ingest; WCS→mount→none)                  [transient, P3]
Pointing         1───* Cone-search suggestion  (top-N candidates + confidence)                      [transient, P3]
Cone-search sugg 1───1 canonical_target        (on confirm → in-use → durable write)                [existing target-link path]
```

## Invariants

- **INV-1**: `canonical_target` is written only on adoption (in-use); pure search never creates a row (FR-004).
- **INV-2**: The redb cache is a reproducible projection; clearing it never deletes a `canonical_target` row and it re-warms from seed + durable rows (FR-002, FR-003, §V).
- **INV-3**: Every identity string is normalized by the single choke-point before caching/persisting/matching; dedup keys `simbad_oid` → normalized designation (FR-007).
- **INV-4**: Coordinates are never fabricated; magnitude/constellation are optional and stay NULL when the source lacks them (FR-006).
- **INV-5**: The name-resolver fallback fires only on explicit resolve, never per keystroke (FR-009).
- **INV-6**: A cone-search suggestion never becomes a durable link without explicit user confirmation (FR-014, FR-016).
- **INV-7**: Pointing is never derived from the filename (FR-012).
