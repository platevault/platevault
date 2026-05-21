# Tasks: Catalog Index Licensing

**Spec**: 014-catalog-index-licensing | **Plan**: [plan.md](./plan.md)

Tasks are grouped by user story so each story can be developed and
tested independently. The Settings → Catalogs nav entry exists in the
mockup but renders no content; every task below is post-mockup work.

## Foundations

- T001. Add `crates/targeting/catalogs/` skeleton with modules
  `registry`, `license`, `loader`. Public surface exposes only the
  registry list and the attribution loader; the entry-reader trait
  remains unimplemented (owned by spec 013).
- T002. Define the compiled-in manifest format consumed by the
  built-in registry. Add a build script that consumes the CI bundle
  output (catalog files + sidecar attributions) and emits a Rust
  module mapping each `Catalog` to its `LicenseAttribution[]`.
- T003. Add SQLite tables `catalog_user` and
  `catalog_user_attribution` per `data-model.md`, with migrations and
  repository code in `crates/persistence/db`.
- T004. Add `crates/app/core/usecases/catalogs.rs` exposing `list` and
  `attribution_get` use cases. Use case tests run against a fake
  registry + fake repository.
- T005. Generate Rust DTOs in `crates/contracts/core/` and TypeScript
  types in `packages/contracts/generated/` from
  `catalog.list.json` and `catalog.attribution.get.json`.
- T006. Add Tauri command adapters mapping `catalog.list` and
  `catalog.attribution.get` to the two use cases.

## US 1 — List Available Catalogs in Settings (P1)

- T007. Replace the empty Settings → Catalogs stub with a
  `CatalogsPage` shell that mounts a single "Available catalogs"
  section and a placeholder for the attribution panel (wired in US 2).
- T008. Implement the available-catalogs table with columns: name,
  version, license short code, origin badge, source URL link,
  last-updated date. Sourced from a `useCatalogList()` hook backed by
  the `catalog.list` Tauri command.
- T009. Seed the built-in registry with Messier (public domain), NGC
  (HEASARC public), IC (HEASARC public), and the in-repo common-name
  list. Each row's `source_url`, `version`, and `last_updated` come
  from the CI manifest.
- T010. Render `origin = "user"` rows with a distinct badge and an
  inline action to open the user-catalog registration drawer
  (drawer itself deferred to a follow-up spec; the action surfaces a
  "not yet available" tooltip in v1).
- T011. Tests: vitest unit covering empty state, mixed origin
  ordering, and date formatting; Playwright smoke confirming
  Messier/NGC/IC render with non-empty version + last-updated values.

## US 2 — Show License Attribution (P2)

- T012. Implement the "License attribution" panel below the catalogs
  table. Group rows by `catalog_id`; render `text` verbatim in a
  monospaced or pre-wrap block and the `link` as an anchor.
- T013. Implement the `useCatalogAttributions()` hook backed by the
  `catalog.attribution.get` Tauri command. Render a loading skeleton
  while pending and a retry button on error.
- T014. Add a "Copy NOTICE" action that serialises every visible
  attribution into a single buffer (header per catalog + verbatim
  notice + link) suitable for inclusion in a downstream NOTICE file.
- T015. Surface public-domain entries with a `verified: <link>,
  accessed <date>` line so the panel is never empty for a registered
  catalog.
- T016. Tests: vitest unit covering attribution grouping and the
  NOTICE serialisation format; Playwright smoke confirming the Copy
  NOTICE action returns a buffer containing every catalog id.

## US 3 — Update Catalog Indexes (P3)

- T017. Add a `catalog.update` Tauri command stub that, in v1, returns
  a friendly `update.unavailable` error pointing the user at the app
  release notes. Spec 014 v1 ships bundle-only updates (research R3).
- T018. Implement the "Update Catalogs" action on the Settings page,
  wired to the stub. Render the returned message inline; the action
  remains visible so the affordance is discoverable.
- T019. Define the audit event shape `catalog.updated` and emit it
  from a future-tense path (no-op in v1, but the event type is
  reserved). Add a test that the event type is registered with the
  audit catalogue.
- T020. Document the deferred work — signed manifest fetch, atomic
  swap, rollback — as a follow-up spec stub and link it from
  `research.md` R3. No implementation in this spec.

## Cross-Cutting

- T021. Add a contract snapshot test that fails on enum or required
  field drift between `catalog.list.json`,
  `catalog.attribution.get.json`, and the Rust DTOs.
- T022. Add a CI check that refuses to merge a catalog source
  definition without a paired `LicenseAttribution` sidecar containing
  non-empty `text` and a resolvable `link`.
- T023. Update the steering index entry for `specs/014-` once the
  Settings page lands.

## Dependency Graph

```
T001 ─┬─► T002 ─► T009
      └─► T004 ─► T006 ─► T008 / T013 / T017
T003 ─► T004
T005 ─► T006
T007 ─► T008 ─► T010
T008 ─► T012 ─► T014 / T015
T017 ─► T018
T019 is independent (audit registration only).
T021 / T022 gate merge once T005 / T009 are in.
```

## Out of Scope

- Catalog entry rows themselves (spec 013).
- User-catalog registration drawer (deferred follow-up spec).
- Signed-manifest update fetch, atomic swap, rollback (deferred
  follow-up spec; see research R3).
- Per-catalog opt-in refresh independent of app version.
