# Research: Catalog Index Licensing

**Spec**: 014-catalog-index-licensing | **Plan**: [plan.md](./plan.md)

This research records the open decisions referenced by `plan.md` and
`spec.md` before any catalog file is bundled or any Settings UI is
wired.

## R1. Catalog Bundle Formats

### Options

- **CSV (with sidecar JSON manifest)** — One file per catalog, fixed
  column layout (`name, identifier, ra_deg, dec_deg, source`). Manifest
  records version, license, and column schema. Smallest on-disk
  footprint, trivial to diff in PRs, easiest for downstream forks.
- **JSON (newline-delimited or array)** — Native to the contract and
  registry layers; no extra parser. Bigger on disk; harder to skim in
  PR review.
- **FITS extension table (BINTABLE)** — Authoritative for some upstream
  catalogs and avoids precision loss. Requires the FITS reader at app
  start just for catalog lookup; larger crate dependency surface.

### Recommendation

Default to **CSV + sidecar manifest** for v1 because it (a) keeps the
crate dependency surface small (no FITS at startup), (b) is trivial to
regenerate and diff in CI, and (c) maps 1:1 onto the minimal-field set
required by FR-002 / spec 013.

JSON is kept as an option for user-added catalogs where ergonomics
matter more than disk footprint. FITS BINTABLE is rejected for v1 to
avoid pulling the FITS adapter into the catalog crate.

### Open Question

Should the CSV include a `precision` column to indicate the original
coordinate precision? Deferred until spec 013 lookup pipeline is
implemented; without a consumer the column would be unused.

## R2. License Obligations per Catalog

> **Decision updated (A1, R-1.1, 2026-05-22)**: HEASARC NGC/IC is dropped
> in favor of OpenNGC. The v1 catalog set expands to thirteen catalogs, all
> distributed via download (Pattern X). The original "bundled Messier + NGC +
> IC + common-names" recommendation is superseded.

### v1 Catalog Set (thirteen catalogs, all `origin = "downloaded"`)

| Catalog | License | Notes |
|---|---|---|
| Messier (M1–M110) | public-domain | Original 1781 list; no attribution required. |
| Caldwell (C1–C109) | public-domain | Patrick Moore's supplement; widely published as PD. |
| Sharpless 2 (Sh2-1…Sh2-313) | public-domain | 1959/1965 HII region survey; no known redistribution restriction. |
| Abell PN | public-domain | Abell 1966 planetary nebulae survey. |
| Abell galaxy clusters | public-domain | Abell 1958/1989 cluster catalog. |
| Arp | public-domain | Arp 1966 peculiar galaxies; PD per standard academic publication norms. |
| vdB | public-domain | Van den Bergh 1966 reflection nebulae. |
| Barnard | public-domain | Barnard 1919 dark nebulae. |
| LBN | public-domain | Lynds 1965 Bright Nebula catalog. |
| LDN | public-domain | Lynds 1962 Dark Nebula catalog. |
| Melotte | public-domain | Melotte 1915 clusters; PD. |
| common-names (app-authored) | apache-2.0 | Hand-curated in this repo; ~300 most-searched names. |
| OpenNGC (NGC + IC + modern positions) | cc-by-sa-4.0 | See OpenNGC note below. |

### OpenNGC and CC BY-SA 4.0

OpenNGC (https://github.com/mattiaverga/OpenNGC) provides NGC and IC
coverage with modern positions and is licensed CC BY-SA 4.0. The project
app itself stays Apache-2.0; the `astro-plan-catalogs` repo acts as
redistributor and:

- Attaches the OpenNGC `LICENSE` file alongside every published OpenNGC
  artifact.
- Populates `LicenseAttribution` with `author`, `title`, `license_uri`
  (required for CC-BY-SA — R-2.2).
- Includes OpenNGC in both `NOTICE.json` and `NOTICE.txt` on every release.

The `modifications_notice` field is populated if the project applies any
transformations to the OpenNGC data (e.g., field subset, coordinate
normalisation). Sharing OpenNGC data in unmodified form requires no
`modifications_notice`.

### Common-Name List

App-authored, Apache-2.0, ~300 entries. Maintained in this repo; not an
external corpus. `LicenseAttribution.author = "astro-plan contributors"`.

### Decision

All thirteen catalogs listed above are approved for v1. Every additional
catalog requires a new research entry per the constitution (§IV). No
catalog may be added with an unknown `LicenseShortCode` (R-2.1).

## R3. Distribution Mechanism (updated 2026-05-22)

> **Decision updated (A1, R-1.2)**: "Bundle-only updates" is replaced by
> **Pattern X (all-download)**. All thirteen v1 catalogs are downloaded at
> first run from a project-hosted manifest. The distribution mechanism
> mirrors [astro-up](https://github.com/sjors/astro-up)'s
> `crates/astro-up-core/src/catalog/` module (manifest reader, ETag
> fetch, minisign verification).

### Manifest Repository (`astro-plan-catalogs`, name TBD)

A separate repository holds TOML manifest files — one per catalog —
describing `catalog_id`, `version`, `url`, `checksum`, `license`
(`LicenseShortCode`), and `size_bytes`. On each release, GitHub Actions:

1. Builds a catalog bundle for each catalog.
2. Signs it with `minisign` and publishes the bundle + `.minisig` to
   GitHub Releases.
3. Generates `NOTICE.json` and `NOTICE.txt` and publishes alongside.

### ETag-Conditional HTTP Fetch

The app calls `catalog.manifest.fetch`, which mirrors astro-up's
`catalog/fetch.rs` `fetch_catalog()`:

- Sends `If-None-Match: <stored-etag>` on repeat fetches.
- Returns `status: "not_modified"` on HTTP 304 (no re-download).
- Retries once on transient failures (timeout, 5xx) with 2-second backoff.

### Minisign Signature Verification

Mirrors astro-up `catalog/verify.rs` `verify_bytes()`:

- The app embeds the minisign public key at build time via
  `include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/minisign.pub.key"))`.
- Verification runs in memory before any disk write.
- On failure: `catalog.signature.invalid` error; previously installed
  catalog remains active.

### `catalog.download` as Install + Update

`catalog.download` (R-1.4) resolves the URL from the cached manifest,
fetches, verifies checksum + minisign signature, and upserts the catalog
into SQLite. It is reusable for:

- **v1**: first-run installation of all thirteen catalogs.
- **v1.x**: user-triggered update of individual catalogs.

The full user-facing "Update Catalogs" UI (per-row progress, retry, rollback
affordance) is deferred to v1.x. (A3)

### Graceful Degradation

**v1 behavior**: if manifest fetch fails (no network), the Download Catalogs
wizard step shows an error screen and the user cannot proceed with catalog
installation. Catalog lookup is unavailable until connectivity is restored
and the user re-attempts from Settings → Catalogs.

**Future (v1.x)**: if manifest fetch fails and `built_in` content is
available, fall back to `built_in` catalogs. The `origin = "built_in"` enum
value exists for this forward-compatibility purpose. (R-3.3)

## R4. Field Set for the Minimal Index

Confirms FR-002 is the floor and ceiling for v1:

- `name` (canonical name, e.g. "M31").
- `identifiers[]` (cross-catalog ids: NGC 224, IC 0, common names).
- `ra_deg`, `dec_deg` (ICRS, J2000.0).
- `source` (catalog id, e.g. `messier`).

Nothing else (no magnitudes, no morphological type, no parallax). Any
additional field requires a new research entry because it changes the
license calculus.

## R5. `LicenseShortCode` Closed Enum (2026-05-22)

`LicenseShortCode` is a **closed enum** in all contracts and the data model.
The ratified set for v1:

```json
{ "enum": ["public-domain", "apache-2.0", "mit", "cc0-1.0", "cc-by-4.0", "cc-by-sa-4.0", "hyperleda", "esa-free"] }
```

**Governance rule**: CI hard-fails on any `LicenseShortCode` value not in
this enum. Adding a new code requires an explicit research decision per the
constitution (§IV). The `hyperleda` and `esa-free` codes are reserved for
future catalog additions that are known to carry specific attribution
requirements; no catalog using these codes ships in v1. (R-2.1)

## R6. NOTICE Artifact Format (2026-05-22)

CI (in `astro-plan-catalogs`) generates two NOTICE artifacts per release
and publishes them alongside catalog bundles on GitHub Releases. (R-2.3)

### `NOTICE.json` — machine-readable

```json
[
  {
    "catalog_id": "string",
    "name": "string",
    "license": "LicenseShortCode",
    "license_uri": "string (URI)?",
    "author": "string?",
    "title": "string?",
    "source_url": "string (URI)",
    "accessed_on": "string (date)",
    "modifications_notice": "string?"
  }
]
```

### `NOTICE.txt` — human-readable

One section per catalog, in the following format:

```
## <name> (<license>)
<text>

Source: <link>
Accessed: <accessed_on>
[Author: <author>]
[Title: <title>]
[License URI: <license_uri>]
[Modifications: <modifications_notice>]
---
```

Square-bracketed lines are omitted when the field is absent (e.g. for
public-domain catalogs, `author`/`title`/`license_uri` are typically absent).

The Settings → Catalogs "Copy NOTICE" action serialises the visible
attributions into a `NOTICE.txt`-compatible buffer.

## R7. Catalog Size Threshold (2026-05-22)

**Decision (R-2.4)**: No upstream catalog larger than **10 MB compressed**
may be added to the v1 catalog set without an explicit research decision.
This is a process-level constraint, not a hard binary limit (the binary
itself does not enforce it). Review is required before adding any catalog
above this threshold. The constraint replaces the earlier open question
"what maximum index size is acceptable?" (spec.md SC-003 updated).

All thirteen v1 catalogs are well within this threshold; OpenNGC at ~13,000
entries is the largest and compresses to well under 2 MB.

## R8. Catalog Event-Bus Topics (2026-05-22)

Catalog download operations emit the following topics onto the in-process
event bus (spec 002 §6.1 canonical event-bus design). These are defined
here (spec 014 owns the catalog domain) and also registered in spec 002
§6 event-bus subsection. (R-3.1)

| Topic | Payload |
|---|---|
| `catalog.manifest.fetched` | `{ manifest_version, etag?, catalogs_count, fetched_at }` |
| `catalog.download.started` | `{ catalog_id, expected_bytes, started_at }` |
| `catalog.download.progress` | `{ catalog_id, bytes_downloaded, expected_bytes, fraction }` |
| `catalog.download.completed` | `{ catalog_id, bytes_downloaded, duration_ms, audit_id }` |
| `catalog.download.failed` | `{ catalog_id, error_code, error_message, duration_ms }` |

**Delivery semantics**: same as `lifecycle.transition.applied` (§6.1) —
at-least-once, idempotent subscribers, transactional with SQLite write.
Refused or failed operations that do not write to SQLite MUST still emit
`catalog.download.failed`.

The first-run Download Catalogs wizard step subscribes to
`catalog.download.progress` and `catalog.download.completed` /
`catalog.download.failed` for per-row progress UI. (D — spec 003 ripple)

## Resolved Questions

| # | Question | Decision | Source |
|---|---|---|---|
| 1 | Canonical v1 catalog set | 13 catalogs; all `origin = "downloaded"` | R-1.1, 2026-05-22 |
| 2 | NGC/IC source | OpenNGC (CC BY-SA 4.0), not HEASARC | A1, R-1.1, 2026-05-22 |
| 3 | Distribution mechanism | Pattern X: project-hosted manifest, GitHub Releases, minisign | R-1.2, 2026-05-22 |
| 4 | `origin` enum | `built_in` (reserved, unused in v1) \| `downloaded` \| `user` (deferred) | R-1.3, 2026-05-22 |
| 5 | Two new contracts | `catalog.manifest.fetch` + `catalog.download` | R-1.4, 2026-05-22 |
| 6 | `LicenseShortCode` | Closed enum, 8 values; CI hard-fails on unknown | R-2.1 / R5, 2026-05-22 |
| 7 | `LicenseAttribution` CC-BY fields | `author`, `title`, `license_uri` required for cc-by-* | R-2.2, 2026-05-22 |
| 8 | NOTICE artifacts | `NOTICE.json` + `NOTICE.txt` generated by CI per release | R-2.3 / R6, 2026-05-22 |
| 9 | Size threshold | 10 MB compressed per catalog; process constraint | R-2.4 / R7, 2026-05-22 |
| 10 | Catalog event-bus topics | 5 topics defined in R8 | R-3.1, 2026-05-22 |
| 11 | `ProvenancedValue` carve-out | Catalog entries are app-owned reference data; no per-field provenance | R-3.2, 2026-05-22 |
| 12 | `built_in` in v1 | Zero catalogs; enum reserved for forward-compat (graceful degradation future) | R-3.3, 2026-05-22 |
| 13 | User-added catalogs | Deferred to v1.x; `origin.not_implemented` error in v1 | A2, 2026-05-22 |
| 14 | Catalog update UI | Deferred to v1.x; `catalog.download` doubles as update in v1 | A3, 2026-05-22 |
