# Handover Plan — Catalog Pipeline: fixes, repo + CI/CD auto-refresh, in-app auto-update

> **Goal:** take catalogs from "graceful-skip placeholder" to a fully working, self-maintaining
> pipeline: a separate `astro-plan-catalogs` repo that **regularly pulls upstream data, rebuilds,
> signs, and releases** new catalog versions via CI/CD, and an app that **auto-updates** to the
> latest signed catalog. This plan also closes the catalog-contract bugs that block end-to-end
> download today.
>
> **Companion docs:** `handover-catalog-repo.md` (the scaffold + astro-up reference pattern),
> `runbook-033-interactive.md` (verification), `traceability-033.md`. Reference implementation:
> `~/dev/astro-up` (`specs/005-manifest-catalog/`, `crates/astro-up-core/src/catalog/`).

## Current state (2026-06-18)
- Backend catalog machinery exists (spec 014 / spec 033 US7): `catalog.manifest.fetch` (ETag), per-catalog
  `catalog.download` with **SHA-256 + minisign** verify, license hard-fail, atomic upsert, slug enum.
- App catalog UI (spec 033) = **select-then-download + graceful "source unavailable"** (the manifest URL
  `github.com/sjors/astro-plan-catalogs/releases/latest/download/manifest.json` 404s — repo unpublished).
- `~/dev/astro-plan-catalogs` is **scaffolded** (build/sign/release skeleton, sample sources) but has no real
  data, no keypair, and is unpublished.
- `TRUSTED_PUBLIC_KEY` in `crates/targeting/catalogs/src/download.rs:52` is a **placeholder**.

---

## Phase 0 — Fix the contract bugs (blocking; do first, inside astro-plan)
These break end-to-end download even after the repo is published. Verify each headless in WSL (repo
Playwright / Rust tests) before the Windows runbook, then push→pull→restart (see `spec-033-windows-verify-loop`).

- **F1 · Manifest field casing.** `download.rs::Manifest`/`ManifestEntry` (`crates/targeting/catalogs/src/download.rs:115,185`) have **no `#[serde(rename_all)]`** → deserialize **snake_case** (`catalog_id`, `size_bytes`), but the language-neutral contract DTO `contracts/core/src/catalogs.rs::ManifestCatalogEntry` is **camelCase**. Pick ONE canonical wire casing and make both agree (recommend `#[serde(rename_all = "camelCase")]` on the download.rs structs to match the published contract + TS bindings), then add a **conformance test** (extend the spec-033 harness) that round-trips a real manifest through both the download parser and the contract DTO. The catalog build script (`astro-plan-catalogs/build/compile.py`, `EMIT_CASE`) must emit the chosen casing.
- **F2 · Slug spelling drift.** `crates/targeting/catalogs/src/registry.rs:100,164` use `abell-pn` / `common-names`, but `download.rs::validate_slug` + spec 013 require the closed enum `{common, openngc, abell_pn}` → real manifests fail `UnknownCatalogSlug`. Reconcile `registry.rs` to the canonical enum (US7/D3 fixed the download side but not the registry). Add a test asserting every `registry.rs` id ∈ the `validate_slug` set.
- **F3 · Per-catalog entry file format.** Spec 013's `CatalogReader` (`loader.rs`) is a reserved placeholder; the `<slug>.json` schema each `catalog.download` installs is **undefined**. Ratify it (derive from spec-013 `CatalogRef`: catalogId, catalogDisplay, designation, names/aliases, RA/Dec, type, constellation, magnitude…), implement the reader, and lock it with a contract test. This is the largest open design item and gates the build script's output format.

---

## Phase 1 — Finalize the catalog repo (`astro-plan-catalogs`)
Build on the scaffold (`~/dev/astro-plan-catalogs`).

- **S1 · Source real upstream data + attribution.**
  - `openngc` ← OpenNGC (`mattiaverga/OpenNGC`, CC-BY-SA-4.0) — CSV → app format.
  - `common` ← Messier + Caldwell lists (factual/public-domain).
  - `abell_pn` ← Abell planetary nebulae catalog.
  - Record provenance + license per source in `ATTRIBUTION.md`; honor CC-BY-SA share-alike.
- **S2 · Build script** (`build/compile.py`) → emit per-catalog files (F3 format) + `manifest.json`
  matching astro-plan's `CatalogManifest`/`ManifestCatalogEntry` (F1 casing), with per-entry sha256 + sizeBytes
  + license + downloadUrl, and `version` + the `signature` field.
- **S3 · Minisign keypair.** `just keygen` → minisign keypair. **Public** box → embed in
  `download.rs::TRUSTED_PUBLIC_KEY` (replace placeholder; this is a compile-time-embedded key per astro-up D2,
  so a key rotation = an app release). **Private** key: NEVER in git; store as a CI secret + an offline backup.
- **S4 · Manual first release.** `just build && just sign` → create the GitHub repo `sjors/astro-plan-catalogs`
  and a first Release publishing `manifest.json` + `<slug>.json` at `releases/latest/download/…`.
- **S5 · End-to-end verify** against the app's catalog step (select → download → minisign verify → install),
  headless first, then the Windows runbook.

---

## Phase 2 — CI/CD: scheduled upstream refresh → rebuild → sign → release
In `astro-plan-catalogs/.github/workflows/` (build on the `release.yml` skeleton).

- **C1 · Scheduled refresh workflow** (`refresh.yml`, `on: schedule:` cron — e.g. weekly, + `workflow_dispatch`):
  1. `scripts/fetch_sources.sh` pulls the latest upstream datasets (pin upstream by tag/commit where possible).
  2. `build/compile.py` rebuilds per-catalog files + `manifest.json`.
  3. **Change detection** — diff the rebuilt content hashes vs the latest release; **no-op if unchanged**
     (don't cut empty releases). Bump a catalog `version` (date- or semver-based) only on real change.
  4. **Sign in CI** — `minisign` sign the payload using the private key from `${{ secrets.MINISIGN_SECRET_KEY }}`
     (+ `MINISIGN_PASSWORD`); inject the signature into `manifest.json`. *(Key-custody decision below.)*
  5. Open a **PR** (or auto-commit to a `data` branch) with the regenerated artifacts for review, OR cut the
     release directly — pick a trust model (recommend PR-gated for the first iterations, then automate).
  6. `gh release create` the new versioned release; `latest` points at it (the app's `releases/latest/download`).
- **C2 · Validation in CI.** Before releasing: schema-validate `manifest.json`, verify each sha256, verify the
  minisign signature with the **public** key, and assert slugs ∈ the canonical enum (mirror F2). Fail the run
  rather than publish a bad catalog.
- **C3 · Provenance/attribution check.** Fail if a source's license/attribution is missing (ties to spec-014
  license hard-fail).
- **Key-custody decision (DECIDE):** signing-in-CI puts the minisign private key in GitHub secrets (convenient,
  but a repo compromise risks the key). Alternative: CI builds + opens a PR with unsigned artifacts; a human
  signs offline and uploads. Recommend **offline-signing for releases, CI for build+validate+PR** until the
  cadence justifies automated signing. Document the chosen model.

---

## Phase 3 — In-app auto-update (astro-plan)
Make the app pull new catalog versions automatically (astro-up pattern: ETag + TTL + background refresh).

- **A1 · Refresh policy.** The app already does ETag conditional manifest fetch. Add a **TTL / last-checked
  timestamp** (persisted) and a background check on launch (and/or on an interval) — `catalog.manifest.fetch`
  with the stored ETag; `304` → keep; `200` → a newer manifest is available. (astro-up: `catalog.db.meta` +
  TTL; astro-plan currently has ETag but no TTL — add it.)
- **A2 · Version compare + update.** Compare the fetched manifest `version` / per-entry versions vs installed
  (`catalog.list`). For installed catalogs with a newer version, download + minisign-verify + atomically
  upsert (reuse the US7 path). New (not-installed) catalogs are offered, not auto-installed.
- **A3 · UX.** Surface updates non-intrusively: a Settings → Catalogs section showing installed vs available
  versions with an "Update" / "Update all" action, plus an optional "auto-update catalogs" preference
  (persisted via the settings model). Respect offline (graceful, use installed data — like astro-up D7).
- **A4 · Safety.** Never replace an installed catalog with an unverified/older one; keep the previous catalog if
  verification fails (astro-up US3.2). Audit catalog install/update events (Constitution §II/§V).
- **A5 · Contracts/tests.** Extend contracts for the update-check/version-compare surface; conformance + Rust
  tests for: 304-keeps-current, newer-version-updates, bad-signature-keeps-previous, offline-uses-installed.

---

## Sequencing
```
Phase 0 (F1,F2,F3)  ──>  Phase 1 (S1..S5)  ──>  Phase 2 (C1..C3)  ──>  Phase 3 (A1..A5)
  contract bugs          repo + first release      automated refresh      in-app auto-update
```
F3 (entry format) and F1 (casing) gate the build script output, so do Phase 0 before Phase 1's build. Phase 3
can start in parallel with Phase 2 once Phase 1's first real release exists to test against.

## Verification (every phase)
- **Headless in WSL FIRST**, then the Windows runbook (per `spec-033-windows-verify-loop`): repo Playwright
  (`pnpm exec playwright test`) for UI/state, Rust/conformance tests for backend + manifest parsing, and a
  real-download test against the first release. Push→pull→restart on Windows; restart after every change.
- Add catalog rows to `traceability-033.md` (FR → automated test → runbook step) so coverage stays zero-gap.

## Open decisions to confirm with the user
1. **Refresh cadence** (weekly / monthly) and **change-only releases**.
2. **Signing key custody** (CI secret vs offline signing) — see C1/key-custody.
3. **Auto-update default** (on/off) and whether new catalogs auto-install or are offered.
4. **Versioning scheme** for catalog releases (date-based vs semver).
5. The still-open product question from spec 033: **calibration source-kind consolidation** (unrelated to
   catalogs but tracked — dark/flat/bias → single optional `calibration` kind?).

## Related spec-033 open items (not catalog-specific; tracked for completeness)
- T036a — wire the scan→session pipeline to set `root_id` (FR-012 runtime completeness).
- T006 / T015 / T024 / T025 / T031 / T049 — real-backend e2e specs remain `test.skip` pending a working
  tauri-driver harness; currently covered by per-story Rust tests + the Windows runbook.
- Final spec-033 gate pass + `speckit.verify` against the real backend before closing the feature.
