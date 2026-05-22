# Research: Target Lookup From FITS OBJECT

**Branch**: `013-target-lookup-from-fits-object` | **Date**: 2026-05-20
**Status**: NOT IMPLEMENTED — research decisions are draft and pending review.

## R1. Catalog Sources And Licensing

### Decision (A1, A2 — 2026-05-22)

The v1 catalog set is the thirteen catalogs downloaded at first run via spec
014's `catalog.download` flow. No catalog data is bundled with the app binary.
The thirteen catalogs and their `catalog_id` slugs are:

| `catalog_id` | Display Name |
|---|---|
| `messier` | Messier |
| `caldwell` | Caldwell |
| `sharpless` | Sharpless 2 |
| `abell_pn` | Abell Planetary Nebulae |
| `abell_galaxies` | Abell Galaxy Clusters |
| `arp` | Arp |
| `vdb` | van den Bergh |
| `barnard` | Barnard |
| `lbn` | Lynds Bright Nebulae |
| `ldn` | Lynds Dark Nebulae |
| `melotte` | Melotte |
| `common` | Common Names |
| `openngc` | OpenNGC (NGC + IC + corrections) |

Spec 014 is the source of truth for catalog data, licensing, download flow,
and NOTICE generation. The targeting crate reads rows from SQLite tables
installed by spec 014.

### Rationale

OpenNGC is a well-maintained, machine-readable, redistributable source for the
NGC/IC data and avoids any dependency on Sesame/SIMBAD or VizieR at
runtime. Common-name coverage is deliberately small to keep the curated list
reviewable. Downloading at first run (not bundling) keeps the app binary free
of CC BY-SA 4.0 share-alike data, consistent with the spec 014 Pattern X
decision.

### Alternatives Considered

- **Sesame/SIMBAD HTTP lookups**: rejected for v1 — requires network at every
  lookup and adds an external availability dependency that conflicts with
  offline-after-first-run policy (FR-005 revised).
- **Full HYG / VizieR snapshots**: rejected — far larger than required for
  amateur target identification and increases redistribution complexity.

### Licensing

All catalog licensing, NOTICE generation, and attribution are owned by
spec 014. The targeting crate contains no catalog data files.

## R2. Fuzzy Matching Algorithm

### Decision

Two-stage matcher:

1. **Normalize-then-exact**: casefold, NFKC normalize, collapse internal
   whitespace, strip punctuation except digits, and expand short catalog
   prefixes (`M` → `M `, `NGC` → `NGC `). Look the result up in a hash index
   keyed by normalized alias. A hit returns `confidence = high`.
2. **Token-set similarity**: if normalize-then-exact fails, run a token-set
   similarity using `rapidfuzz`-style token_set_ratio against the alias index,
   then break ties with a bounded Damerau–Levenshtein edit distance on the
   highest scorers. Scores above 90 map to `medium` confidence; 75–90 map to
   `low`; below 75 are discarded.

### Rationale

The two-stage shape keeps the common path (exact catalog designation)
deterministic and O(1) while still tolerating spacing, punctuation, and
common-name fragments. Token-set similarity handles trailing tokens such as
`M101 LRGB` naturally because the catalog token still contributes a
near-perfect token-set match.

### Alternatives Considered

- **Pure Levenshtein on full strings**: rejected — fails on the `M101 LRGB`
  pattern because trailing tokens inflate distance.
- **Phonetic algorithms (Soundex/Metaphone)**: rejected — popular astronomy
  names are mostly proper nouns where phonetic matching produces noise.
- **TF-IDF / vector embeddings**: rejected — over-engineered for a catalog
  this size and would add a heavy dependency.

## R3. Ambiguity Resolution Policy

### Decision (R-2.3 — 2026-05-22)

Lookup returns one of four outcomes. The decision tree uses the scorer's
`[0, 100]` score:

| Condition | Status | Confidence |
|---|---|---|
| `top_score >= 90` AND `second_best_score < top_score - 15` | `resolved` | `high` |
| `top_score >= 60` AND `second_best_score < top_score - 10` | `resolved` | `medium` |
| Candidates within 15 points of the top score (2+ candidates), OR multiple `high` candidates | `ambiguous` | — |
| `top_score < 50` OR no candidates above discard threshold | `unresolved` | — |
| Catalog not installed (first-run incomplete) | `catalog.not_installed` | — |
| Catalog index failed to build from SQLite | `catalog.unavailable` | — |

**Truth table for tie/multi-medium cases:**

| top | second | gap | Outcome |
|---|---|---|---|
| 95 | 79 | 16 | resolved/high (gap > 15) |
| 95 | 82 | 13 | ambiguous (gap ≤ 15) |
| 85 | 68 | 17 | resolved/medium (top ≥ 60, gap > 10) |
| 85 | 76 | 9 | ambiguous (gap ≤ 10) |
| 70 | 55 | 15 | ambiguous (top < 90, gap ≤ 15) |
| 45 | — | — | unresolved (top < 50) |

All candidates within 15 points of the top score are returned in the
`candidates[]` array of the response (R-2.1).

The `target.resolve` operation collapses the ranked form into a single
identity plus confidence, returning `ambiguous` or `unresolved` in the
status discriminator when it cannot resolve. The `target.lookup` operation
always returns the full ranked list so the UI can present a chooser.

### Rationale

Treating ambiguity as an explicit, named outcome (rather than a single
"best-guess" answer) preserves the constitution's reviewability principle: a
target identity is only auto-applied when the system is confident, and the
user is always given the ranked evidence when it is not. The two-tier
threshold (90/15 for high, 60/10 for medium) was ratified in session
2026-05-22 (R-2.3).

## R4. No-Network Policy

### Decision (A2, A4 revised — 2026-05-22)

The targeting crate MUST NOT issue network requests. Catalog data is
downloaded at first run via spec 014's `catalog.download` flow and stored in
SQLite; the targeting crate reads only from SQLite. Online providers such as
Sesame/SIMBAD are out of scope for this feature and tracked separately as a
future enhancement.

If the catalog tables are empty (first-run download not yet completed), lookup
returns `catalog.not_installed`; ingestion is not blocked.

### Rationale

The revised FR-005 requires offline lookup after first-run download
completes. Keeping the targeting crate network-free preserves the pure-domain
boundary and avoids the availability and rate-limit failure modes that an
external service would introduce. Online enrichment can be added later as a
separate crate that sits behind the same operation contracts.

## R5. Cross-Catalog Equivalence Seeding

### Decision (A3 — 2026-05-22)

When two catalog entries refer to the same physical object (e.g. `M 31` in
Messier ≡ `NGC 224` in OpenNGC), a `CatalogEquivalence` row is written to
SQLite, asserting shared `canonical_target_id` and which entry holds
`is_primary = true` per the precedence table.

The initial equivalence dataset ships with the catalog manifest as a sidecar
file (e.g. `openngc-equivalences-v<ver>.json` or equivalent TOML). At first
catalog install, the `catalog.download.completed` handler seeds
`CatalogEquivalence` rows from this sidecar. Future catalogs may append
entries via the same mechanism.

Seeding task: T010-eq (seed equivalence table at first catalog install);
T011-eq (UUIDv5 derivation for `Target.id` from canonical designation).

## R6. Target Identity Via UUIDv5

### Decision (R-1.1 — 2026-05-22)

`Target.id` is a deterministic UUIDv5 derived as:

```
namespace_uuid   = UUIDv5(namespace=dns, name="astro-plan.targets")
canonical_designation = "<catalog_id>:<designation>"
                        (e.g. "messier:M31" for Andromeda, precedence-highest)
Target.id        = UUIDv5(namespace=namespace_uuid, name=canonical_designation)
```

`canonical_designation` is taken from the precedence-highest catalog row for
the object, formatted as `<catalog_id>:<designation>`. Precedence table
(highest first):

`messier > caldwell > openngc[ngc] > openngc[ic] > sharpless > abell_pn >
abell_galaxies > arp > vdb > barnard > lbn > ldn > melotte > common`

This makes `Target.id` stable across application restarts, across machines,
and across catalog updates as long as the canonical designation does not
change.

`Target` rows are persisted to SQLite on first catalog install (T010-eq in the
catalog.download flow). The targeting crate caches the index in memory at
startup and rebuilds on `catalog.download.completed` events.

## R7. Resolved Questions

| ID | Question | Decision | Ratification |
|---|---|---|---|
| A1 | Catalog set scope | 13-catalog set (see R1) | 2026-05-22 |
| A2 | Catalog data delivery | Pattern X (downloaded, not bundled) | 2026-05-22 |
| A3 | Cross-catalog equivalence | CatalogEquivalence table, seeded from manifest sidecar | 2026-05-22 |
| A4 | FR-005 offline policy | Revised: offline after first-run download; returns `catalog.not_installed` before | 2026-05-22 |
| R-1.1 | Target.id generation | UUIDv5 from canonical_designation per precedence | 2026-05-22 |
| R-1.2 | Target persistence | SQLite-persisted on first catalog install; FK on acquisition_sessions | 2026-05-22 |
| R-1.4 | CatalogRef fields | Two-field: `catalog_id` (slug) + `catalog_display` (human) + `designation` | 2026-05-22 |
| R-2.1 | target.resolve response | Includes display fields + candidates[] in response envelope | 2026-05-22 |
| R-2.2 | catalog_filter removed | Server-derives active catalog set from spec 018 settings | 2026-05-22 |
| R-2.3 | Ambiguity gap rule | Two-tier: 90/15 (high) and 60/10 (medium); truth table in R3 | 2026-05-22 |
| R-2.4 | Contract envelope | Status-discriminated camelCase per spec 002/014 pattern | 2026-05-22 |

## R8. Server-Derived Catalog Filter

### Decision (R-2.2 — 2026-05-22)

The backend reads spec 018's `target_lookup.active_catalogs: catalog_id[]`
setting at request time to determine which catalogs participate in scoring.
Callers of `target.lookup` and `target.resolve` CANNOT override the active
catalog set per request. The `catalog_filter` field is therefore absent from
both request schemas.

> **Spec 018 follow-up**: A settings key `target_lookup.active_catalogs:
> catalog_id[]` must be added to the spec 018 settings schema. This is a
> small ripple that should be applied when spec 018 is next revised. This
> spec does NOT edit spec 018.
