# Data Model: SIMBAD Target Resolution

**Spec**: 035 | **Plan**: [plan.md](./plan.md) | **Date**: 2026-06-18

Reuses the spec-013 target-identity model (`crates/targeting/src/catalog.rs`: `CatalogId`,
`CatalogRef`, canonical target). Adds the resolution cache, resolver settings, and the ingest queue.

## Entities

### CanonicalTarget (reused, persisted)

The stable identity for one physical object.

| Field | Type | Description |
| --- | --- | --- |
| `id` | Uuid (v5) | Stable identity, namespaced from the canonical designation (spec 013 R6). |
| `simbad_oid` | i64? | SIMBAD physical-object id, when resolved online; the dedup key. Null for seed/override-only entries until resolved. |
| `primary_designation` | string | Canonical display designation (precedence table, spec 013). |
| `object_type` | ObjectType | Closed enum (galaxy, planetary_nebula, …, other) from SIMBAD `otype` mapping. |
| `ra_deg` / `dec_deg` | f64 | ICRS J2000 coordinates (decimal degrees, from SIMBAD `basic`). |
| `source` | enum `seed`\|`resolved`\|`user-override` | Provenance of the current identity (FR-006/014). |
| `resolved_at` | string (RFC 3339) | When this entry was last resolved/seeded/overridden. |

Invariants:
- Unique by `simbad_oid` when non-null (dedup — FR-007). Aliases of one object share one row.
- A `user-override` row takes precedence over `resolved`/`seed` for the same object (FR-014); a later
  SIMBAD resolution MUST NOT overwrite a `user-override` identity.
- `ra_deg ∈ [0,360)`, `dec_deg ∈ [-90,90]`; never fabricated (FR-009 — unresolved → no row, pending).

### TargetAlias (persisted)

An alternate designation/name pointing to a `CanonicalTarget`; the typeahead match surface.

| Field | Type | Description |
| --- | --- | --- |
| `target_id` | Uuid | FK → CanonicalTarget.id. |
| `alias` | string | A designation or `NAME` common name (e.g. `M 31`, `NGC 224`, `Andromeda Galaxy`). |
| `normalized` | string | Normalized form for matching (spec 013 normalize). |
| `kind` | enum `designation`\|`common_name` | `common_name` ← SIMBAD `NAME …` idents. |

Invariants: `(target_id, normalized)` unique; `normalized` indexed for instant prefix/typeahead lookup.

### ResolverSettings (persisted, singleton)

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `online_enabled` | bool | `true` | Enable/disable online SIMBAD resolution (FR-015). |
| `simbad_endpoint` | string | SIMBAD TAP URL | The resolver service endpoint. |
| `debounce_ms` | int | 300 | Interactive long-tail query debounce. |
| `request_timeout_secs` | int | 10 | Per-request timeout; degrade to seed+cache on timeout. |

Replaces the spec-014 catalog-settings columns (`manifest_url`, signing key, etc.) — superseded.

### IngestResolution (persisted) — pending queue

Tracks async resolution of FITS `OBJECT` values during ingest (FR-013).

| Field | Type | Description |
| --- | --- | --- |
| `image_id` | Uuid | FK → image/inventory record. |
| `object_raw` | string | Verbatim FITS `OBJECT` value. |
| `state` | enum `pending`\|`resolved`\|`unresolved` | Lifecycle; `pending` until the background queue resolves. |
| `target_id` | Uuid? | FK → CanonicalTarget when resolved. |
| `attempts` | int | Retry count (for later retry of `unresolved`). |

Invariants: a resolved row associates the image to exactly one `CanonicalTarget`; `unresolved` rows
are retryable and never silently mis-assigned (FR-009).

### CaldwellMap (static, bundled)

A committed, immutable C1–C109 → NGC/IC (or other) designation mapping (Patrick Moore's list), since
Caldwell is not a SIMBAD designation. Used to translate a Caldwell query to a resolvable designation.

## Object type mapping

SIMBAD `otype` → closed `ObjectType` enum (galaxy, planetary_nebula, emission_nebula,
reflection_nebula, dark_nebula, open_cluster, globular_cluster, supernova_remnant, galaxy_cluster,
double_star, asterism, other). One mapping table applied uniformly; unknown `otype` → `other`.

## Lifecycle / events

- Seed loaded at first run → `CanonicalTarget`/`TargetAlias` rows with `source=seed`.
- Search/ingest miss → SIMBAD resolve → upsert rows (`source=resolved`), emit `target.resolved`.
- Manual override → upsert with `source=user-override` (precedence locked).
- Ingest batch → `target.resolve_batch.completed` on the event bus (replaces `catalog.download.*`).
