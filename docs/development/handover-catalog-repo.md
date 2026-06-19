# Handover: astro-plan-catalogs (target catalog data repo)

**Date**: 2026-06-18
**Author**: research/scaffolding pass
**Scope**: Stand up a SEPARATE catalog data repo `astro-plan-catalogs` that
produces the signed `manifest.json` + per-catalog files the astro-plan app
already knows how to fetch, verify, and install. Modeled on `astro-up`'s catalog
operational pattern. This pass delivered a local scaffold + this doc; it did NOT
create a GitHub repo, publish a release, or generate real signing keys.

Related: spec 033 (US7) — catalog integrity/authenticity is implemented in the
app but "real catalog downloads are externally blocked today (the catalog repo
is unpublished)" (`specs/033-validation-bugfix-remediation/spec.md:204-205`).
The app's catalog step gracefully shows "source unavailable" until this repo's
first release exists. This handover is what unblocks it.

---

## 1. Reference pattern — how astro-up does it

astro-up keeps catalog **data + compiler** in a separate repo
(`astro-up-manifests`, with `astro-up-compiler`); the **client** in
`astro-up-core` only fetches/verifies/reads. The flow:

separate source repo → compile to a single signed SQLite `catalog.db` →
GitHub Releases → runtime fetch with ETag/TTL → minisign verify against a
compile-time embedded public key.

Key citations:

- **Embedded pubkey, compile-time.** `MINISIGN_PUBLIC_KEY` is
  `include_str!(".../minisign.pub.key")` —
  `astro-up/crates/astro-up-core/src/catalog/verify.rs:8-9`. Decision D2 "key
  baked into binary, not configurable"
  (`astro-up/specs/005-manifest-catalog/decisions.md:13-15`). The repo ships
  `minisign.pub` (full box) and `minisign.pub.key` (bare base64) at the root.
- **minisign verify (verify-only crate).** astro-up uses `minisign-verify`
  (`verify.rs:32-48`); research R1 picked it over the full `minisign` crate to
  avoid pulling signing deps (`specs/005-manifest-catalog/research.md:5-10`).
  (astro-plan differs — see §4.)
- **ETag conditional fetch + retry.** `fetch_catalog` sends `If-None-Match`,
  retries once on transient failure with 2s backoff, returns
  `Downloaded{..}|NotModified` — `.../catalog/fetch.rs:27-138`. The signature is
  fetched as `"{catalog_url}.minisig"` (`fetch.rs:106`).
- **TTL + sidecar.** ETag and `fetched_at` live in a JSON sidecar
  `catalog.db.meta`; TTL is measured from `fetched_at`
  (`spec.md:91`, `data-model.md:56-62`). Manager logic:
  `.../catalog/manager.rs:39-138` (TTL check → lock → fetch → **verify in
  memory before writing** → save + sidecar).
- **Verify-before-write.** Downloaded bytes are verified in memory; on failure
  the previous valid catalog is preserved (`manager.rs:89-122`,
  `verify.rs:58-83`).
- **Atomic save.** temp file + rename for catalog and `.minisig`
  (`fetch.rs:157-182`).
- **Release pipeline.** astro-up's own `.github/workflows/release.yml` is
  release-please + Tauri build (app binaries), not the catalog. The **catalog**
  artifact is compiled by `astro-up-compiler` in the manifests repo and signed
  with `minisign -Sm catalog.db -s test.key`
  (`specs/005-manifest-catalog/quickstart.md:57-67`). That is the piece
  astro-plan-catalogs reproduces.

---

## 2. astro-plan's existing catalog contract (what the repo must produce)

astro-plan already implements the client side. The repo must emit exactly what
it parses.

- **Manifest URL** (`apps/desktop/src-tauri/src/commands/catalogs.rs:32-33`):
  `https://github.com/sjors/astro-plan-catalogs/releases/latest/download/manifest.json`
- **Runtime parse target** — `crates/targeting/catalogs/src/download.rs`:
  - `Manifest { version, signature, catalogs: Vec<ManifestEntry> }`
    (`download.rs:184-194`).
  - `ManifestEntry { catalog_id, version, url, checksum, license, size_bytes }`
    (`download.rs:114-128`). **No `#[serde(rename_all)]`** → fields are
    **snake_case** on the wire.
  - Signature payload: `manifest_signed_bytes` = `serde_json::to_vec(&catalogs)`
    — the **`catalogs` array only** (`download.rs:435-439`).
  - Minisign verify uses the **full `minisign` crate**
    (`PublicKeyBox`/`SignatureBox`, `download.rs:401-423`).
  - Per-catalog: download bytes → `verify_sha256` against entry `checksum`
    (`download.rs:376-385`, `download.rs:666`).
  - License codes hard-fail if unknown (`parse_license`, `download.rs:140-143`);
    slugs hard-fail if unknown (`validate_slug`, `download.rs:154-180`).
  - `TRUSTED_PUBLIC_KEY` is a **placeholder** that verifies nothing
    (`download.rs:52-54`).
- **Contract DTO** — `crates/contracts/core/src/catalogs.rs`:
  `CatalogManifest`/`ManifestCatalogEntry` are `#[serde(rename_all =
  "camelCase")]` → `catalogId`, `sizeBytes` (`catalogs.rs:90-118`).
  `ManifestFetchStatus { fetched, not_modified, failed }` (`:169-180`);
  `CatalogDownloadStatus { success, failure }` (`:208-218`).
- **Slugs** (closed set) — `download.rs:160-174` and spec 013 `CatalogRef`
  (`specs/013-target-lookup-from-fits-object/data-model.md:39`): `messier,
  caldwell, sharpless, abell_pn, abell_galaxies, arp, vdb, barnard, lbn, ldn,
  melotte, common, openngc`.
- **License codes** (closed set) —
  `crates/targeting/catalogs/src/license.rs:68-78`: `public-domain, apache-2.0,
  mit, cc0-1.0, cc-by-4.0, cc-by-sa-4.0, hyperleda, esa-free`.

---

## 3. astro-plan-catalogs design

Repo at `/home/sjors/dev/astro-plan-catalogs` (separate git repo, outside
astro-plan).

### Layout

```
README.md                 purpose, pattern, build/sign/release, pubkey embedding
LICENSE                   per-catalog licensing + Apache-2.0 for build code
ATTRIBUTION.md            CC-BY-SA notices + slug reconciliation notes
justfile                  build / sign / keygen / verify / release-local / clean
build/SCHEMA.md           exact manifest + per-catalog formats vs the app contract
build/compile.py          sources/*.csv -> dist/manifest.json + <slug>.json (stdlib)
scripts/fetch_sources.sh  pull real upstream datasets (TODO stubs)
scripts/sign.sh           minisign-sign the catalogs payload, inject into manifest.json
sources/{common,openngc,abell_pn}/*.sample.csv   sample sources (real data NOT committed)
dist/                     build output (gitignored)
.github/workflows/release.yml   build -> sign -> GitHub Release (workflow_dispatch only)
.gitignore, _typos.toml
```

### manifest.json schema (matches the runtime parse path — snake_case)

```jsonc
{
  "version": "1.0.0",
  "signature": "<full minisign signature box string>",
  "catalogs": [
    { "catalog_id": "openngc", "version": "1.0.0",
      "url": ".../releases/latest/download/openngc.json",
      "checksum": "<sha256 hex of the openngc.json bytes>",
      "license": "cc-by-sa-4.0", "size_bytes": 524 }
  ]
}
```

`compile.py` emits **snake_case** by default (`EMIT_CASE=snake`) to match
`download.rs`. It also writes `dist/catalogs.signed.json` containing the exact
bytes (`serde_json`-compatible compact JSON of the `catalogs` array, field order
`catalog_id, version, url, checksum, license, size_bytes`) that `sign.sh` signs
and the app re-derives. Verified working in the scaffold: the emitted payload is
byte-identical in shape to `manifest_signed_bytes` output.

### Per-catalog file schema (PROPOSED — pending spec 013)

`<slug>.json` = `{ catalog_id, version, entries: [{ designation, name,
identifiers[], ra_deg, dec_deg, object_type, magnitude?, source }] }`. Derived
from spec 013 `CatalogRef` + the documented entry tuple `name, identifiers, ra,
dec, source` (`specs/013-target-lookup-from-fits-object/data-model.md:35-49`).
**This is not yet ratified** — `CatalogReader`
(`crates/targeting/catalogs/src/loader.rs`) is a reserved placeholder, spec 013
is "NOT IMPLEMENTED". Full format spec in `build/SCHEMA.md` §2.

### build → sign → release flow

1. `just fetch-sources` — pull upstream data into `sources/` (stubs today).
2. `just build` — `compile.py` → `dist/<slug>.json`, `dist/catalogs.signed.json`,
   `dist/manifest.json` (empty signature), `dist/equivalences.json`.
3. `just sign` — `minisign -S` over `dist/catalogs.signed.json`, inject the
   `.minisig` box string into `manifest.signature`.
4. GitHub Release: upload `manifest.json` + each `<slug>.json` as assets named
   exactly so `releases/latest/download/<asset>` resolves.

### minisign embedded-pubkey model

`just keygen` (`minisign -G`) once → `minisign.pub` (public, commit OK) +
`secret/minisign.key` (secret, gitignored). Embed the **public** box string into
astro-plan by replacing `TRUSTED_PUBLIC_KEY` in
`crates/targeting/catalogs/src/download.rs:52-54`. astro-plan uses the full
`minisign` crate (`PublicKeyBox::from_string`), so embed the full box, not just
the bare base64.

### ETag/TTL fetch — already-implemented vs needs-decision

- **Implemented in app:** ETag conditional fetch on the manifest
  (`ReqwestFetcher::fetch_manifest` sends `If-None-Match`, handles 304 →
  `ManifestFetchStatus::NotModified`, `download.rs:308-336`;
  `CatalogManifestFetchRequest.etag`, `catalogs.rs:159-166`).
- **Not yet present in app:** a TTL / sidecar / refresh policy like astro-up's
  `catalog.db.meta` + `cache_ttl`. astro-plan currently relies on the caller
  passing back the ETag; there is no automatic TTL-based refresh. See TODO (8).

---

## 4. astro-plan vs astro-up — contract differences (read before reusing astro-up code)

| Aspect | astro-up | astro-plan |
|---|---|---|
| Artifact | one signed SQLite `catalog.db` | `manifest.json` + per-catalog JSON files |
| Signed bytes | the whole `catalog.db` file | `serde_json::to_vec(&catalogs)` (array only) |
| minisign crate | `minisign-verify` (verify only) | full `minisign` (`PublicKeyBox`/`SignatureBox`) |
| Sig delivery | sidecar `catalog.db.minisig` file | `signature` string field inside `manifest.json` |
| Integrity layers | minisign only | minisign on manifest **+** SHA-256 per catalog file |
| Refresh | TTL + ETag + `catalog.db.meta` sidecar | ETag only; no TTL/sidecar yet |
| Embedded key | bare base64 (`minisign.pub.key`) | full box string (placeholder today) |

Implication: do **not** copy astro-up's "sign the whole file + verify-only
crate + sidecar .minisig" mechanics verbatim. The astro-plan-catalogs scaffold
already follows the astro-plan semantics (sign the catalogs array, embed the box
in the JSON, SHA-256 per file).

---

## 5. What's scaffolded (this pass)

All under `/home/sjors/dev/astro-plan-catalogs` (git-init'd, one commit):

- `README.md`, `LICENSE`, `ATTRIBUTION.md`, `.gitignore`, `_typos.toml`.
- `build/SCHEMA.md` — exact manifest + per-catalog file formats, with the
  contract-gap callouts.
- `build/compile.py` — runnable stdlib compiler; verified it produces a
  correctly-shaped `manifest.json` + `catalogs.signed.json` from the samples.
- `scripts/sign.sh`, `scripts/fetch_sources.sh`.
- `justfile` (build/sign/keygen/verify/release-local/clean).
- `sources/{common,openngc,abell_pn}/*.sample.csv` — placeholder sources.
- `.github/workflows/release.yml` — `workflow_dispatch`-only build→sign→release
  skeleton (uses a `MINISIGN_SECRET_KEY` secret; publishes nothing until run).

Plus this handover doc (`docs/development/handover-catalog-repo.md` in
astro-plan).

---

## 6. What's still to be done (prioritized)

1. **Source the real datasets.** OpenNGC `NGC.csv` (CC-BY-SA-4.0) → map its
   native semicolon columns in `compile.py`; Messier + Caldwell lists;
   Abell PN list. Record provenance/access dates in `ATTRIBUTION.md`. Wire
   `scripts/fetch_sources.sh`.
2. **Finalize the per-catalog file format.** Reconcile `build/SCHEMA.md` §2 with
   spec 013's `CatalogReader` once it lands (it is reserved/unimplemented today).
   This is the biggest open design question — the app cannot read entries until
   both sides agree.
3. **Keys.** `just keygen`; embed the public box into
   `crates/targeting/catalogs/src/download.rs` `TRUSTED_PUBLIC_KEY` (replace the
   placeholder at `:52-54`); store the secret key in a password manager / CI
   secret (`MINISIGN_SECRET_KEY`), never in git.
4. **Build + sign** real `manifest.json` + data (`just release-local`).
5. **Create the GitHub repo** `sjors/astro-plan-catalogs` and the **first
   Release** with assets at `releases/latest/download/{manifest.json,
   <slug>.json}`.
6. **End-to-end verify** against the app's catalog step: list → select →
   `catalog.manifest.fetch` (minisign verify) → `catalog.download` (SHA-256) →
   install. Confirm spec 033 US7 acceptance scenarios pass with a live source.
7. **Reconcile contract gaps (BLOCKERS):**
   - **snake_case vs camelCase manifest fields.** Runtime parse path
     (`download.rs`) is snake_case; the contract DTO
     (`contracts/core/src/catalogs.rs`) is camelCase. Pick one and make both
     agree, then set `EMIT_CASE` accordingly. As shipped, `compile.py` follows
     the runtime path (snake_case) because that is what actually deserializes
     the fetched manifest.
   - **Slug spelling drift.** `registry.rs` uses `abell-pn` and `common-names`;
     `download.rs::validate_slug` + spec 013 use `abell_pn` and `common`. The
     manifest must use the `validate_slug` forms or fetch hard-fails with
     `UnknownCatalogSlug`. Unify inside astro-plan.
8. **Decide ETag/TTL/refresh behavior.** astro-plan does ETag conditional
   fetch but has no TTL/sidecar/auto-refresh like astro-up. Decide whether to
   add a TTL + persisted ETag (astro-up `catalog.db.meta` model) or keep
   caller-driven refresh. Document the decision (likely a small spec follow-up).

---

## 7. Quick verification done in this pass

`python3 build/compile.py` on the sample sources produced:
`dist/manifest.json` (snake_case fields, empty signature), `dist/<slug>.json`
(compact JSON, checksum = SHA-256 of the file bytes), and
`dist/catalogs.signed.json` whose bytes match `serde_json::to_vec(&catalogs)`
field order. Signing is stubbed pending a real keypair; the wiring is in place.
