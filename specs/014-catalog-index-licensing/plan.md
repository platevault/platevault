# Implementation Plan: Catalog Index Licensing

**Branch**: `014-catalog-index-licensing` | **Date**: 2026-05-20 | **Spec**:
[spec.md](./spec.md)

## Summary

This feature owns two surfaces that share a single registry:

1. A downloaded minimal catalog index (all thirteen v1 catalogs downloaded
   at first run from a project-hosted manifest in the `astro-plan-catalogs`
   repo — name TBD). There are **no bundled/built-in catalog files** in v1.
   All catalogs have `origin = "downloaded"`. (R-1.1, R-1.3)
2. A Settings → Catalogs page that lists installed catalogs and the license
   attribution required to ship them.

The catalog registry lives in `crates/targeting/catalogs/`. License
metadata is stored in SQLite alongside each catalog record, never inferred
at runtime. The Settings page reads the registry through two contracts
(`catalog.list`, `catalog.attribution.get`) and renders nothing else.
Manifest fetch and catalog download use two new contracts
(`catalog.manifest.fetch`, `catalog.download`). (R-1.4)

> **Forward-note (E3)**: Spec 013 must align cross-catalog equivalence work
> with OpenNGC as the canonical NGC+IC source.

> **Note (R-3.3)**: `origin = "built_in"` exists in the enum for
> forward-compatibility (future emergency-fallback if download fails);
> zero catalogs ship as `built_in` in v1.

## Constitution Check

- **I. Local-First File Custody**: Catalog index files are app-owned
  resources, not user image files; they live inside the app bundle (or
  user-added directory) and are referenced by id, never by absolute path
  in user-visible state.
- **II. Reviewable Filesystem Mutation**: Catalog updates are atomic
  swaps with the previous bundle retained until verification; the swap
  is recorded in the audit log under `catalog.updated`.
- **III. PixInsight Boundary**: Catalogs feed target lookup only; no
  catalog feature performs image processing or alters processing output.
- **IV. Research-Led Domain Modeling**: Format, license obligation, and
  update strategy decisions are recorded in `research.md` before any
  catalog file ships.
- **V. Portable Contracts and Durable Records**: `catalog.list` and
  `catalog.attribution.get` are JSON-Schema contracts; the registry
  state is durable in SQLite, and license attribution text travels with
  the bundle, not the binary.

## Architecture

### Layering

```
apps/desktop (Tauri + React)
  └─ features/settings/catalogs/* hooks
       └─ tauri commands: catalog.list / catalog.attribution.get
            |             catalog.manifest.fetch / catalog.download
            └─ crates/app/core/usecases/catalogs.rs
                 ├─ crates/targeting/catalogs/registry.rs   (registry)
                 ├─ crates/targeting/catalogs/license.rs    (attribution model)
                 ├─ crates/targeting/catalogs/download.rs   (manifest fetch + download)
                 ├─ crates/persistence/db (catalog table + audit hooks)
                 └─ crates/audit (catalog.* events)
```

### Catalog Distribution

All v1 catalogs are distributed via a **project-hosted manifest repository**
(proposed name: `astro-plan-catalogs`). The pattern mirrors
[astro-up](https://github.com/sjors/astro-up)'s `crates/astro-up-core/src/catalog/`
module (manifest reader, ETag-conditional fetch, minisign verification).
(R-1.2)

**Manifest repository** (`astro-plan-catalogs`, name TBD):
- Holds one TOML manifest file per catalog describing `catalog_id`,
  `version`, `url`, `checksum`, `license` (`LicenseShortCode`), and
  `size_bytes`.
- Each GitHub Release publishes a signed catalog bundle plus a `.minisig`
  signature file.

**Fetch flow** (mirrors astro-up `catalog/fetch.rs`):
1. App calls `catalog.manifest.fetch` with optional `etag` from prior fetch.
2. Backend sends HTTP GET with `If-None-Match` header; retries once on
   transient failure (timeout, 5xx) with 2-second backoff.
3. On 200: downloads catalog bytes + `.minisig` file.
4. On 304: returns `status: "not_modified"`.

**Signature verification** (mirrors astro-up `catalog/verify.rs`):
- App embeds the minisign public key at build time via
  `include_str!("minisign.pub.key")`.
- Verification runs **in memory** before writing to disk, preserving the
  previous catalog on failure.
- Any verification failure returns `catalog.signature.invalid` and leaves
  the previously installed version active.

**Installation**:
- Verified catalog bytes are written atomically (temp-file + rename).
- Catalog metadata and `LicenseAttribution` are upserted into SQLite.
- Event-bus topics are emitted during progress (R-3.1).

### Catalog Registry (`crates/targeting/catalogs/`)

- `registry.rs`: read-only listing of known catalogs. All v1 catalogs are
  stored in SQLite (`catalog_downloaded` table); the `built_in` origin is
  reserved but unused in v1. `user` origin is deferred to v1.x.
- `license.rs`: `LicenseAttribution` model with structured CC-BY fields
  (`author`, `title`, `license_uri`, `modifications_notice`). Attribution
  text is stored verbatim — never templated at runtime. (R-2.2)
- `download.rs`: manifest fetch, ETag caching, per-catalog download,
  in-memory minisign verification, atomic install into SQLite. Emits
  event-bus topics from R-3.1 during progress.
- `loader.rs` (out-of-scope here): file-format readers (CSV/JSON variants)
  live behind a `CatalogReader` trait; only registry metadata and license
  attribution are in v1 contract scope.

### Settings Page

`apps/desktop/src/features/settings/catalogs/`:

- `CatalogsPage` (replaces the empty stub) is composed of two sections:
  - **Available catalogs**: table with id, name, version, license short
    code, origin badge, source link, last-updated date. Sourced from
    `catalog.list`.
  - **License attribution**: read-only panel grouped by catalog id,
    showing full notice text + source link. Sourced from
    `catalog.attribution.get`. Provides a "Copy NOTICE" action that
    serialises the visible attributions into a single buffer suitable
    for downstream redistribution.

### Contracts

- `catalog.list`: request `{}`; response `catalogs: Catalog[]` ordered by
  origin (`downloaded` first) then name. (R-1.3)
- `catalog.attribution.get`: request `{}`; response
  `attributions: LicenseAttribution[]`. Separated from `catalog.list` so
  the large attribution payload is not paid for on the metadata listing.
- `catalog.manifest.fetch`: request `{ etag? }`; response
  `{ status: fetched|not_modified|failed, manifest?, etag?, error? }`.
  (R-1.4, new contract)
- `catalog.download`: request `{ catalog_id }`; response
  `{ status: success|failure, audit_id?, error? }`. Backend resolves the
  URL from the cached manifest, fetches, verifies checksum + minisign,
  installs into SQLite. Reusable for first-run install AND future updates.
  (R-1.4, A3, new contract)

### CI / NOTICE Artifacts

CI (in `astro-plan-catalogs` repo) generates two NOTICE artifacts per
release:

1. `NOTICE.json` — machine-readable array: `[{ catalog_id, name, license,
   license_uri, author?, title?, source_url, accessed_on,
   modifications_notice? }, ...]`.
2. `NOTICE.txt` — human-readable rendering, one section per catalog. (R-2.3)

Both are published alongside catalog bundles on GitHub Releases.

## Phasing

### Phase 0 — Research (this spec)

- Decide catalog format (CSV vs JSON vs FITS extension). (R1)
- Confirm license obligations per catalog. (R2 — updated for 13-catalog set)
- Define distribution mechanism: project-hosted manifest + minisign +
  GitHub Releases. (R3 — updated)
- Define field set for minimal index. (R4)
- Define `LicenseShortCode` closed enum. (R5)
- Define structured `LicenseAttribution` with CC-BY fields. (R-2.2)
- Define NOTICE artifact format. (R-2.3)
- Define size threshold constraint. (R-2.4)
- Define catalog event-bus topics. (R-3.1)
- Document `ProvenancedValue` carve-out. (R-3.2)

### Phase 1 — Design

- Finalize `data-model.md` for `Catalog` and `LicenseAttribution`.
- Finalize all four contracts in this directory.

### Phase 2 — Implementation (deferred, gated by review)

1. Add `crates/targeting/catalogs/` skeleton with registry, license,
   download modules and an in-memory test fixture.
2. Add `crates/app/core/usecases/catalogs.rs` with `list`,
   `attribution_get`, `manifest_fetch`, and `download` use cases.
3. Generate Rust DTOs and TypeScript types from all four contracts.
4. Replace the empty Settings → Catalogs stub with the two-section page
   driven by Tauri commands.
5. Wire the Download Catalogs wizard step in spec 003 to
   `catalog.manifest.fetch` + `catalog.download`.
6. Add a Playwright smoke verifying that all thirteen v1 catalogs appear
   with non-empty attribution text after first-run wizard.

## Cross-Spec Links

- **Spec 013 (Target Lookup from FITS OBJECT)** is the primary consumer
  of the bundled index; this spec MUST keep the minimal-fields shape
  defined there (`name, identifiers, RA, DEC, source`).
- **Spec 018 (Settings Configuration Model)** owns the Settings shell;
  this spec contributes the Catalogs nav entry's content only.
- **Spec 023 (Target Identity, History, Notes)** may, in a future
  revision, surface the catalog source on a target detail page; the
  `Catalog.id` shape exposed here is stable enough to reference.

## Risks

- **Attribution drift**: If an upstream catalog updates its required notice
  text mid-version, the in-app panel will silently lag until the next
  manifest release. Mitigation: every catalog update bumps the version and
  is audit-logged.
- **Manifest fetch failure at first run**: If the network is unavailable
  during the Download Catalogs wizard step, catalog lookup is non-functional.
  Current behavior: error screen (no graceful degradation in v1). Future
  mitigation: fall back to `built_in` content if available (R-3.3, R3 note).
- **OpenNGC CC BY-SA redistribution**: OpenNGC's CC BY-SA 4.0 license
  requires attribution and share-alike on derivatives. The app stays
  Apache-2.0; the `astro-plan-catalogs` repo acts as redistributor and
  attaches the LICENSE file alongside each OpenNGC artifact. `NOTICE.json` /
  `NOTICE.txt` carry the required attribution. (A1, R-2.3)
- **Catalog size growth**: SC-003 sets a 10 MB compressed threshold per
  catalog. Any catalog exceeding this requires an explicit decision. (R-2.4)
