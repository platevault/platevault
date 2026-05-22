# Data Model: Target Lookup From FITS OBJECT

**Branch**: `013-target-lookup-from-fits-object` | **Date**: 2026-05-20
**Status**: NOT IMPLEMENTED — model is draft and pending review.

## Entities

### Target

The canonical, stable identity for an astronomical target as known to the
application.

| Field | Type | Description |
| --- | --- | --- |
| `id` | `Uuid` | UUIDv5 namespaced from canonical designation per precedence table (R6); deterministic across machines and catalog updates. |
| `primary_designation` | `string` | Canonical display designation (e.g. `M 101`). Chosen by catalog precedence: `messier > caldwell > openngc[ngc] > openngc[ic] > sharpless > abell_pn > abell_galaxies > arp > vdb > barnard > lbn > ldn > melotte > common`. |
| `aliases` | `string[]` | All known alternate spellings and short forms used for query matching (e.g. `M101`, `NGC 5457`, `Pinwheel Galaxy`). |
| `catalog_refs` | `CatalogRef[]` | Cross-references to entries in known catalogs. At least one entry; entries are unique by `(catalog_id, designation)`. |

Invariants:

- `primary_designation` MUST appear in either `aliases` or in one of the
  `catalog_refs` entries when rendered.
- `aliases` MUST be deduplicated after normalization.
- A `Target` MUST carry at least one `catalog_refs` entry.

Lifecycle: `Target` rows are persisted to SQLite on first catalog install
(T010-eq in spec 014's `catalog.download` flow). The targeting crate caches
the index in memory at startup and rebuilds on `catalog.download.completed`
event-bus events. `acquisition_sessions.target_id` is a real SQLite FK to
`targets.id` (R-1.2).

### CatalogRef

A reference to a specific entry inside a named source catalog. (R-1.4)

| Field | Type | Description |
| --- | --- | --- |
| `catalog_id` | `string` (closed enum slug) | Source catalog identifier. One of: `messier`, `caldwell`, `sharpless`, `abell_pn`, `abell_galaxies`, `arp`, `vdb`, `barnard`, `lbn`, `ldn`, `melotte`, `common`, `openngc`. |
| `catalog_display` | `string` | Human-readable catalog name (e.g. `"Messier"`, `"OpenNGC"`). |
| `designation` | `string` | Catalog-local designation (e.g. `"M31"`, `"NGC 224"`, `"Sh2-155"`). |

Invariants:

- `(catalog_id, designation)` MUST be unique within the targeting index.
- `catalog_id` MUST be one of the thirteen v1 slugs listed above; unknown
  slugs are rejected.

### CatalogEquivalence

Asserts that a catalog entry refers to the same physical object as a canonical
`Target`. Used to unify cross-catalog aliases (e.g. `M 31` ≡ `NGC 224`) into
a single stable `Target.id`. (A3, R-1.1)

| Field | Type | Description |
| --- | --- | --- |
| `id` | `Uuid` | Stable identifier. |
| `canonical_target_id` | `Uuid` | FK → `Target.id`. The unified identity. |
| `catalog_id` | `string` | FK → spec 014 catalog slug (closed enum). |
| `designation` | `string` | The designation within that catalog (e.g. `"NGC 224"` for Andromeda). |
| `is_primary` | `bool` | `true` for the precedence-winning catalog entry; exactly one row per `canonical_target_id` has `is_primary = true`. |
| `created_at` | `string` (RFC 3339) | When this equivalence row was seeded. |

Precedence rule: when two catalog entries refer to the same physical object,
the `CatalogEquivalence` row with `is_primary = true` is chosen by the
precedence table:

`messier > caldwell > openngc[ngc] > openngc[ic] > sharpless > abell_pn >
abell_galaxies > arp > vdb > barnard > lbn > ldn > melotte > common`

Invariants:

- `(catalog_id, designation)` is UNIQUE across the table.
- Exactly one row per `canonical_target_id` has `is_primary = true`.
- Seeded at first catalog install from the manifest equivalence sidecar;
  additional entries may be appended by future catalog installs.
- App does NOT generate equivalences at runtime; they are data artifacts
  from the catalog manifest (R5).

### TargetMatch

The result of evaluating a query against the catalog. Returned from
`target.lookup` and consumed internally by `target.resolve`.

| Field | Type | Description |
| --- | --- | --- |
| `target_id` | `Uuid` | The matching `Target.id`. |
| `confidence` | `enum { high, medium, low }` | Confidence bucket from the matcher. See research.md R2 for thresholds. |
| `evidence` | `MatchEvidence` | Why this candidate was selected. Required for traceability. |

### MatchEvidence

| Field | Type | Description |
| --- | --- | --- |
| `matched_alias` | `string` | The alias from the `Target` that produced the match. |
| `normalized_query` | `string` | Query after normalization. |
| `strategy` | `enum { exact, token_set, edit_distance }` | Which matcher stage produced the score. |
| `score` | `number` | Raw similarity score in `[0, 100]`. `100` for `exact`. |

## Lifecycle

`Target` records are persisted to SQLite at first catalog install and cached
in memory by the targeting crate. They are not edited at runtime in v1 except
when a `catalog.download.completed` event triggers an index rebuild.
`TargetMatch` and `MatchEvidence` are transient values returned from operation
contracts and never persisted directly; only the resolved `target_id` is
associated with downstream entities (sessions, projects) via the persistence
boundary.
