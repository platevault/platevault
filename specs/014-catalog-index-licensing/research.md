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

### Messier

The Messier catalog is **public domain** in every jurisdiction that
matters for an Apache-2.0 distribution: the original 1781 list and the
modern reconciled coordinates have been published in numerous
unrestricted forms. No attribution clause is required; the panel will
nonetheless render a "public domain (verified: <source>, <accessed
date>)" entry so users can audit the claim.

### NGC / IC

The New General Catalogue and Index Catalogues are also public domain.
The reconciled "Revised NGC/IC" maintained by Wolfgang Steinicke is
explicitly released for non-commercial and research use; commercial
redistribution clauses are weaker than the NASA/IPAC HEASARC public
copies. **Recommendation**: source NGC/IC from HEASARC's public
release (or an equivalent NASA-published archive) to keep
distribution clearly Apache-2.0 compatible, and record the source URL
in the manifest. The Steinicke version is not bundled by default.

### Common-Name Lists

Lists that map common names ("Andromeda Galaxy", "Pleiades") to
catalog ids are often derived from third-party publications and may
carry attribution clauses (e.g. CC-BY) or, in some cases, restrictive
terms. Recommendation: bundle a small hand-curated common-name list
authored in this repo (Apache-2.0) for the most frequently looked-up
targets, and treat any external common-name corpus as a user-added
catalog rather than a built-in.

### Decision

Built-in v1 ships: Messier (public domain), NGC (HEASARC public),
IC (HEASARC public), and an in-repo common-name list. Every other
catalog is user-added until a separate research decision approves it.

## R3. Update Strategy

### Options

- **Bundle-only updates** (ship a new index with each app release): no
  network calls at runtime, simplest, but stale between releases.
- **Atomic in-place updates from a signed manifest URL**: app downloads
  a new bundle, verifies a signature, swaps catalog files atomically
  while keeping the previous version until success.
- **Per-catalog updates**: users opt in to specific catalog refreshes
  independently of the app version. Highest flexibility, most surface
  area.

### Recommendation

Default to **bundle-only updates** for v1 (FR-008 still applies: the
update path must be atomic when implemented). Defer per-catalog
updates and signed-manifest fetches to a follow-up spec. The Settings
"Update Catalogs" action is included in the contract surface but
short-circuits to a "managed by app release" notice until the signed
manifest workflow lands.

### Rationale

Bundle-only updates keep the v1 product offline-friendly and avoid
adding networked update infrastructure (signing keys, mirror lists,
revocation) before the lookup pipeline itself is proven. The contract
shape (`catalog.list`, `catalog.attribution.get`) does not change when
the update mechanism upgrades; only an additional `catalog.update`
contract is added later.

### Open Questions

- How is the previous bundle retained on disk during atomic swap, and
  for how long? Deferred to the future update spec.
- What signing scheme covers the manifest? Deferred.

## R4. Field Set for the Minimal Index

Confirms FR-002 is the floor and ceiling for v1:

- `name` (canonical name, e.g. "M31").
- `identifiers[]` (cross-catalog ids: NGC 224, IC 0, common names).
- `ra_deg`, `dec_deg` (ICRS, J2000.0).
- `source` (catalog id, e.g. `messier`).

Nothing else (no magnitudes, no morphological type, no parallax). Any
additional field requires a new research entry because it changes the
license calculus.
