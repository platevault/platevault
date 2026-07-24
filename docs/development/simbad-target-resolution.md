# SIMBAD Target Resolution (spec 035)

How astronomical target identities are resolved, cached, searched, and grouped. Implemented in
spec 035; supersedes the spec-014 hosted-catalog download model and spec-013's offline-index
resolution (the spec-013 target-identity *types* are reused).

## What it does

Turns a designation or name — typed in the project-creation search box or read from a FITS `OBJECT`
header — into a single **canonical target identity** (ICRS J2000 coordinates, object type, and the
full alias/designation set), so images and projects group by the same physical object even when
spellings differ (`M31` = `NGC 224` = `Andromeda Galaxy`).

## Architecture

```
                         ┌──────────────────────── apps/desktop (React) ───────────────────────┐
  TargetSearch ──────────┤ debounced typeahead → target.search (local)                          │
  (components/)           │ long-tail (≥3 chars, cancellable) → target.resolve (SIMBAD)          │
  ResolverSettings ──────┤ target.resolution.settings(.update)  · "Correct…" override            │
  (features/settings/)    └──────────────────────────────────────────────────────────────────────┘
        │  Tauri commands (apps/desktop/src-tauri/src/commands/target_lookup.rs)
        ▼
  app_core use-cases:  target_search · target_resolve · resolver_settings · ingest_resolution
        │
        ▼
  crates/targeting/src/resolver/
    mod.rs       Resolver trait, ResolveError, ObjectType/map_otype, TargetSource, FakeResolver
    cache.rs     SQLite cache: search_by_normalized, upsert_resolved(_conn), dedup-by-oid, precedence
    simbad.rs    SimbadResolver (reqwest TAP client) + OfflineResolver
    seed.rs      bundled-seed loader (first-run, batched transaction)
    caldwell.rs  static C1–C109 → NGC/IC map
        │
        ▼
  SQLite (migration 0031): canonical_target · target_alias · resolver_settings · ingest_resolution
```

## Resolution flow

- **Search (US1, local-only)**: `target.search` → `cache::search_by_normalized` (prefix/substring over
  the indexed `target_alias.normalized`, ranked exact > prefix > substring, deduped to one row per
  target). No network — instant.
- **Resolve (US3, long-tail)**: `target.resolve` is cache-first; on a miss and when `online_enabled`,
  `SimbadResolver` queries the SIMBAD TAP `sim-tap/sync` endpoint (`basic ⋈ ident` for identity +
  aliases + common names), maps `otype` → the closed `ObjectType`, and upserts to the cache (resolved
  at most once). Caldwell queries (`C n`) are translated to their NGC/IC designation first. Offline /
  disabled / not-found / ambiguous → `unresolved` (never fabricated).
- **Ingest grouping (US4)**: `ingest_resolution::associate_or_enqueue(image_id, object_raw)` resolves a
  FITS `OBJECT` value — cache hit inline, miss enqueued `pending`; a background `resolve_pending` drain
  resolves the queue (transient/offline errors stay `pending`, genuine misses → `unresolved` + retry).
  **NOTE:** this is a ready, tested seam — no production per-image ingest calls it yet (needs the
  spec-002 inventory pipeline; see IMPLEMENTATION-NOTES gap #2).
- **Override (FR-014)**: `target.resolve` with an `override` binds a query to a chosen canonical target
  as `source = user-override`; the cache precedence (`user-override > resolved > seed`) makes it sticky
  against future SIMBAD results.

## Bundled seed

`assets/seed/seed.json` (~13k popular deep-sky objects, ~4.5 MB) is embedded via `include_bytes!` and
loaded into the cache at **first run** (`seed::load_bundled_on_first_run`, guarded by `is_first_run`,
one batched transaction). Built offline by `crates/tools/seed-builder`:

- `cargo run -p seed-builder` — default `--popular`: NGC + IC + Messier + Caldwell + named + Sharpless +
  Barnard + vdB + Abell-PN + Melotte, DSO-only (drops `otype=Other` stellar noise). ~13k objects.
- `--full` — everything (≈56k / 19.5 MB; not recommended to ship).
- `--ngc <N>` / `--slice` — small smoke build.

Network (SIMBAD CDS) is required only for the offline build, not at runtime first-run.

## Settings

`resolver_settings` (singleton): `online_enabled` (default ON), `simbad_endpoint` (https-validated),
`debounce_ms` (300), `request_timeout_secs` (10). Edited via the Target Resolution settings pane (and
the setup wizard's repurposed step).

## Operations

- **Run the live SIMBAD test** (opt-in via env var, needs network):
  `PV_LIVE_SIMBAD=1 cargo test -p targeting_resolver --test simbad_live`.
- **Regenerate the seed**: `cargo run -p seed-builder` (commits to `assets/seed/seed.json`).
- **Attribution** (FR-012): SIMBAD (CDS, Université de Strasbourg) + OpenNGC — shown in the settings
  Attribution section.

## Known gaps (see specs/035-simbad-target-resolution/IMPLEMENTATION-NOTES.md)

1. Two target tables coexist (old spec-013 `targets` vs `canonical_target`) — reconciliation is an
   open architecture decision. (Project↔target persistence itself is now wired end-to-end:
   `ProjectCreateRequest.canonicalTargetId` persists the selection, and `ProjectDetail` displays the
   joined `canonicalTarget`.)
2. Ingest grouping is a tested seam, not wired to a live per-image ingest (spec-002 inventory).
