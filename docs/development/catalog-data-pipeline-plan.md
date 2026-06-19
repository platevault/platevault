# Target Resolution & Catalog Plan — SIMBAD resolve-on-demand + bundled seed + cache

> **Status:** AGREED design (2026-06-18, rev 3). **Supersedes** the hosted-catalog pipeline
> (bundled `<slug>.json` files + manifest + minisign + GitHub-Releases auto-update). The app is a
> **desktop image-catalogue management tool** (not field/offline-first), so reliable connectivity at
> import/organize time is assumed, and SIMBAD is trusted (no signing needed).

## Decision

Pivot from "build + host + sign our own catalog files" to **online resolution against SIMBAD,
backed by a bundled seed index and a growing local cache.** Confirmed with user 2026-06-18.

## Architecture

Three components, one durable store:

1. **Bundled seed index** (ships with the app) — the *popular* catalogues built **once** from
   SIMBAD (+ OpenNGC for NGC/IC richness): NGC/IC, Messier, Caldwell, named objects, and the
   popular survey objects (Sharpless, Barnard, LBN, LDN, vdB, Abell, Arp, Melotte). Per object:
   canonical id, designations/aliases, common name, object type, ICRS J2000 coords. A few MB.
   **No signing, no manifest, no CI auto-update** — a static UX asset, refreshed on app releases.
   Seeded into the local cache at first run ("auto-cached").
2. **Local cache (SQLite)** — the working/durable store (constitution §V). Pre-populated from the
   seed; grows as SIMBAD resolves new objects. Columns ≈ target identity + aliases + type + ICRS
   coords + `source` (`seed`|`simbad`) + `resolved_at`. De-dupe physical objects by SIMBAD `oid`.
3. **SIMBAD resolver (online)** — the authority for everything beyond the seed:
   - Sesame `sim-id` for complete-identifier resolve; TAP (`basic`/`ident`/`ids`) for structured
     pulls + alias/common-name sets.
   - Endpoint: `https://simbad.cds.unistra.fr/simbad/sim-tap/sync` (TAP) / `.../sim-id` (Sesame).

## Flows

**A. Interactive search (project creation / target select):**
1. **Instant local typeahead** against the seed/cache — sub-ms, no network. Each result shows
   `designation · common name · type` (+ catalogue) for disambiguation.
2. **Debounced SIMBAD query** (~300 ms, min 2–3 chars, **cancel in-flight**) for the long tail not
   in the local index; merged into suggestions on return; de-duped against local hits.
3. **Authoritative resolve on selection** → full SIMBAD resolve → write canonical identity + coords
   + aliases + type to the cache.
4. **Optional catalogue/type filter** (default = all). Not a required picker — disambiguation is via
   the type/catalogue badge on each result, with the filter for power users / collisions.

**B. Ingest resolution (FITS `OBJECT`):** background — cache lookup → SIMBAD resolve on miss →
cache → group images under the resolved target. Same cache as A.

## Why SIMBAD is the resolver but not the typeahead engine

Sesame resolves **complete** identifiers/names; it has no good prefix/partial API, and per-keystroke
TAP `LIKE` queries would be slow and rate-limit-abusive. So instant typeahead runs against the
**local** seed/cache; SIMBAD handles authoritative resolve + the long tail. SIMBAD load is bounded by
the *distinct objects a user actually images/searches* (tens–hundreds, cached once) — its intended
use, not bulk scraping.

## One-time seed build

A simple script (run occasionally, output bundled — **not** CI/signed): pull the popular catalogues
from SIMBAD by their verified acronyms (`M `, `NGC `, `IC `, `SH  2-`, `Barnard `, `PN A66 `, `ACO `,
`APG `, `VDB `, `LBN `, `LDN `, `Cl Melotte `) + OpenNGC for NGC/IC physical detail; Caldwell via a
static C1–C109→NGC/IC map; common names from SIMBAD `NAME` idents. Normalize → bundled SQLite/JSON.

## Etiquette / minor concerns

- Debounce + min chars + cancel-in-flight + cache; identify the app via a `User-Agent` (CDS norm).
- Graceful degradation: SIMBAD down / offline → use seed+cache, mark unresolved as pending, retry.
- Privacy: resolving sends object names to CDS (minor; note in docs).

## Spec impact (route via iterate)

- **Spec 013 (target lookup):** resolution becomes **online Sesame/SIMBAD + cache**; the local index
  is for *typeahead*, not an offline fuzzy-match authority. Reduce the local fuzzy-matching machinery.
- **Spec 014 (catalog index licensing):** **supersede** the download/manifest/minisign/auto-update
  feature. Replace with: bundled seed + local cache + online resolver. CC-BY/CDS attribution noted.

## Obsoleted vs retained

- **Obsoleted:** `astro-plan-catalogs` repo + CI + signing + manifest; `download.rs` fetch/verify +
  `loader.rs` `<slug>.json` reader + `catalog.entry-file.json` + `catalog.manifest.fetch`/
  `catalog.download` contracts; F1 (manifest casing) + F3 (entry-file format); `rsign2`/keygen.
  (PR #249's *catalog* parts → revert/clean up in the iterate.)
- **Retained:** target-identity model (`CatalogId` enum [F2 slug set → now the bundled-catalogue +
  filter vocabulary], `CatalogRef`, canonical target, aliases, dedup); local cache schema (thin
  version of the old catalog tables).

## Next steps

1. `/speckit.iterate.define` on **013** and **014** to encode this pivot.
2. Decide PR #249 / Phase 0 disposition (revert catalog parts now vs fold into the iterate).
3. Archive the `astro-plan-catalogs` repo scaffold + local commits.
4. Build the one-time seed; implement resolver + cache + debounced search + optional filter per the iterated specs.
