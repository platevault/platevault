# Tasks: Catalog Index Licensing

**Spec**: 014-catalog-index-licensing | **Plan**: [plan.md](./plan.md)

Tasks are grouped by user story so each story can be developed and
tested independently. The Settings → Catalogs nav entry exists in the
mockup but renders no content; every task below is post-mockup work.

## Foundations

- T001. Add `crates/targeting/catalogs/` skeleton with modules
  `registry`, `license`, `download`, `loader`. Public surface exposes
  registry list, attribution loader, and download use cases; the
  entry-reader trait remains unimplemented (owned by spec 013).
- T002. Add SQLite migrations for `catalog_downloaded(id, name,
  version, license, source_url, last_updated, entry_count)` and
  `catalog_downloaded_attribution(catalog_id, license, text, link,
  accessed_on, author, title, license_uri, modifications_notice)`
  in `crates/persistence/db`. (A2 — `catalog_user*` tables removed;
  user-added deferred to v1.x)
- T003. ~~Add `catalog_user` and `catalog_user_attribution` tables~~
  **REMOVED** (A2 — user-added catalogs deferred to v1.x). Enum value
  `origin = "user"` is defined in contracts but backend rejects with
  `origin.not_implemented` in v1. Add a unit test confirming the
  rejection.
- T004. Add `crates/app/core/usecases/catalogs.rs` exposing `list`,
  `attribution_get`, `manifest_fetch`, and `download` use cases. Use
  case tests run against a fake registry + fake repository.
- T005. Generate Rust DTOs in `crates/contracts/core/` and TypeScript
  types in `packages/contracts/generated/` from all four contracts:
  `catalog.list.json`, `catalog.attribution.get.json`,
  `catalog.manifest.fetch.json`, and `catalog.download.json`.
- T006. Add Tauri command adapters mapping all four contracts to the
  four use cases.
- T007-event. Add event-bus publishers in `crates/targeting/catalogs/download.rs`
  emitting the five topics from R-3.1:
  `catalog.manifest.fetched`, `catalog.download.started`,
  `catalog.download.progress`, `catalog.download.completed`,
  `catalog.download.failed`. Subscribers in the first-run wizard
  consume `started`/`progress`/`completed`/`failed` for per-row
  progress UI. (R-3.1)

## US 1 — Download Catalogs at First Run + List in Settings (P1)

- T008. Replace the empty Settings → Catalogs stub with a
  `CatalogsPage` shell that mounts a single "Available catalogs"
  section and a placeholder for the attribution panel (wired in US 2).
- T009. Implement the available-catalogs table with columns: name,
  version, license short code, origin badge (`downloaded` for all v1
  catalogs), source URL link, last-updated date. Sourced from a
  `useCatalogList()` hook backed by the `catalog.list` Tauri command.
  No "Add catalog" affordance in v1 (A2).
- T010. ~~Render `origin = "user"` rows~~ **REMOVED** (A2 — deferred
  to v1.x). Add a unit test confirming the backend rejects
  `origin = "user"` with `origin.not_implemented`.
- T010-dl. Implement the Download Catalogs wizard step for spec 003:
  (1) calls `catalog.manifest.fetch`; (2) iterates the manifest
  catalog list and calls `catalog.download` for each (parallel-N
  concurrency, N TBD); (3) subscribes to event-bus topics for
  per-row progress; (4) on any failure, shows per-row error and a
  Retry button (mirrors `source.register.batch` partial-success
  pattern). Step does not block Finish if skipped. (D, spec 003)
- T011. Tests: vitest unit covering empty state, single-origin
  ordering, and date formatting; Playwright smoke confirming all
  thirteen v1 catalogs render with non-empty version + last-updated
  values after wizard completion.

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

## US 3 — Update Catalog Indexes (Deferred to v1.x)

> These tasks ship in v1.x only. The `catalog.download` contract already
> serves as "install if missing, update if present" and covers first-run
> installation in v1. (A3)

- T017. *(v1.x)* Add a user-facing "Update Catalogs" action on the
  Settings page. Wire to `catalog.download` per-catalog with per-row
  progress and Retry on failure. In v1 this stub returns
  `update.unavailable` pointing the user to first-run setup if no
  manifest is cached.
- T018. *(v1.x)* Implement per-catalog update UI.
- T019. Define the audit event shape `catalog.updated` and reserve
  the type in `crates/audit/`. No-op in v1. Add a test that the
  event type is registered with the audit catalogue.
- T020. *(done in research R3)* Graceful-degradation behavior (error
  screen in v1; future `built_in` fallback) is documented in
  `research.md` R3. No additional implementation in this spec.

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
      └─► T004 ─► T006 ─► T009 / T013 / T017
T005 ─► T006
T008 ─► T009 ─► T010-dl
T008 ─► T012 ─► T014 / T015
T007-event ─► T010-dl
T017 ─► T018   (both v1.x)
T019 is independent (audit type reservation only).
T021 / T022 gate merge once T005 / T002 are in.
```

## Out of Scope

- Catalog entry rows themselves (spec 013).
- `origin = "user"` / user-catalog registration — deferred to v1.x. (A2)
- Full user-facing "Update Catalogs" UI — deferred to v1.x. (A3)
- `built_in` catalog content in v1 (enum reserved for forward-compat). (R-3.3)
- Per-catalog opt-in refresh independent of first-run (v1.x path).
