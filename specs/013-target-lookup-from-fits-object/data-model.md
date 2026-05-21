# Data Model: Target Lookup From FITS OBJECT

**Branch**: `013-target-lookup-from-fits-object` | **Date**: 2026-05-20
**Status**: NOT IMPLEMENTED — model is draft and pending review.

## Entities

### Target

The canonical, stable identity for an astronomical target as known to the
application.

| Field | Type | Description |
| --- | --- | --- |
| `id` | `Uuid` | Stable application-owned identifier. Persisted; never derived from catalog data. |
| `primary_designation` | `string` | Canonical display designation (e.g. `M 101`). Chosen by catalog precedence: Messier > NGC > IC > common name. |
| `aliases` | `string[]` | All known alternate spellings and short forms used for query matching (e.g. `M101`, `NGC 5457`, `Pinwheel Galaxy`). |
| `catalog_refs` | `CatalogRef[]` | Cross-references to entries in known catalogs. At least one entry; entries are unique by `(catalog, id)`. |

Invariants:

- `primary_designation` MUST appear in either `aliases` or in one of the
  `catalog_refs` entries when rendered.
- `aliases` MUST be deduplicated after normalization.
- A `Target` MUST carry at least one `catalog_refs` entry.

### CatalogRef

A reference to a specific entry inside a named source catalog.

| Field | Type | Description |
| --- | --- | --- |
| `catalog` | `enum { Messier, NGC, IC, CommonName }` | Source catalog identifier. |
| `id` | `string` | Catalog-local identifier (e.g. `101`, `5457`, `Pinwheel Galaxy`). |

Invariants:

- `(catalog, id)` MUST be unique within the bundled catalog.
- For `Messier`, `NGC`, `IC` the `id` MUST be a positive integer expressed as
  a string. For `CommonName` the `id` MUST be the canonical-cased nickname.

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

`Target` records are produced from the bundled catalog at application startup
and held in memory for the duration of the process. They are not edited at
runtime in v1. `TargetMatch` and `MatchEvidence` are transient values returned
from operation contracts and never persisted directly; only the resolved
`target_id` is associated with downstream entities (sessions, projects) via
the persistence boundary.
