# Implementation Dependency Decisions

Date: 2026-05-03

Scope: Spec 001, task T001. These decisions select the first implementation
dependencies for the local-first desktop scaffold. They should be revisited only
when a concrete task proves the choice wrong.

## Decision Summary

| Area | Decision | Rationale |
|------|----------|-----------|
| Desktop shell | Tauri 2 | Fits the Rust core, local filesystem access, and small desktop package goal. Install JS CLI/API now; add Rust `tauri` crate when the shell task is ready for platform system dependencies. |
| Frontend | React with Vite | Matches the selected UI stack and Tauri's Vite integration path. |
| Local database | SQLite in WAL mode where safe | Local-first single-user metadata store with better read/write concurrency than rollback journal mode. |
| Rust SQLite access | `rusqlite` with bundled SQLite | Lower conceptual overhead than async SQL layers for a local desktop app; avoids compile-time database coupling. |
| Migrations | SQL migration files executed through a small `persistence_db` migration runner | Keeps schema changes explicit and portable; avoids an ORM as a source of domain truth. |
| Contract source | JSON Schema Draft 2020-12 | Language-neutral source of truth for local Tauri transport and future HTTP/service projection. |
| Type generation | `json-schema-to-typescript` for TypeScript types | Generates TypeScript declarations directly from canonical JSON Schema. |
| Runtime validation | JSON Schema validator first; generated Zod only where UI ergonomics justify it | Zod's JSON Schema import is marked experimental, so it should not be the canonical validation path. |
| FITS metadata | Custom bounded FITS header reader for v1 | Header extraction is enough for v1 and avoids heavy native CFITSIO dependency until pixel or full FITS behavior is needed. |
| XISF metadata | `quick-xml` streaming parser for XISF XML metadata | XISF metadata is XML-based; streaming avoids loading large image payloads. |
| Video metadata | Minimal built-in SER header reader plus optional external `ffprobe` capability | Keeps planetary/lunar support lightweight while allowing richer probing when installed by the user. |

## Desktop Shell: Tauri 2

Decision: Use Tauri 2 as the desktop shell. Configure the JavaScript CLI/API and
Tauri config during setup, but defer adding the Rust `tauri`/`tauri-build`
crates until the app-shell/Tauri command tasks need them.

Rationale:
- The application is local-first and filesystem-heavy, and Tauri keeps the
  native shell close to Rust core logic.
- Tauri's architecture supports webview UI with Rust backend commands.
- The plan already treats Tauri commands as a transport adapter, not as the
  canonical contract.
- On Linux, compiling the Rust Tauri stack requires system WebKit/DBus/GTK
  development packages. Deferring the Rust crate keeps early non-UI workspace
  tests fast and avoids forcing platform packages before Tauri shell work starts.

Alternatives considered:
- Electron: larger runtime and weaker fit for Rust-first filesystem services.
- Native UI per platform: too expensive for v1.
- Local web app plus service: useful future path, but too much packaging and
  service lifecycle overhead for the first desktop release.

Sources:
- https://v2.tauri.app/concept/architecture/
- https://v2.tauri.app/start/frontend/vite/

## Frontend: React with Vite

Decision: Use React with Vite.

Rationale:
- React matches the existing spec direction and gives fast iteration for a dense
  desktop tool UI.
- Vite is the documented Tauri frontend path and keeps the desktop shell
  conventional.
- UI implementation tasks must use `$impeccable` before designing or building
  product UI surfaces.

Alternatives considered:
- Solid/Svelte: lighter, but less aligned with the preferred stack.
- Next.js: unnecessary for a local desktop app with no server-rendered web
  product in v1.

Sources:
- https://react.dev/learn/installation
- https://react.dev/versions
- https://v2.tauri.app/start/frontend/vite/

## SQLite Access and Migrations

Decision: Use SQLite with `rusqlite` and a small repository/migration layer in
`crates/persistence/db`.

Rationale:
- The app is local-first and single-user in v1.
- `rusqlite` is a direct SQLite wrapper, which fits a desktop app with explicit
  transactions and repository boundaries.
- WAL mode is useful for concurrent readers while scan/index operations write
  metadata, but backup/export code must account for WAL files and checkpoints.
- SQL migrations should live as explicit files or embedded strings owned by the
  persistence crate. Domain crates must not depend on database implementation.

Alternatives considered:
- `sqlx`: strong async and compile-time query checking, but more build/runtime
  complexity and not necessary for local embedded DB access.
- Diesel: useful ORM/migration stack, but too heavy for a schema that should
  remain explicit and contract-oriented.
- Tauri SQL plugin as canonical persistence: rejected because persistence logic
  belongs in the Rust core and must remain portable beyond Tauri.

Initial implementation notes:
- Keep `@tauri-apps/cli`, `@tauri-apps/api`, and `tauri.conf.json` configured in
  T006.
- Add Rust `tauri` and `tauri-build` in T012/T018 when the shell and command
  adapter are implemented.
- Enable SQLite foreign keys per connection.
- Use transactions for scan batches and plan application writes.
- Treat migrations as forward-only for v1.
- Add backup/checkpoint policy before exposing database backup/export.

Sources:
- https://www.sqlite.org/wal.html
- https://docs.rs/rusqlite/latest/rusqlite/
- https://github.com/rusqlite/rusqlite

## Contract and Type Generation

Decision: JSON Schema Draft 2020-12 remains the source of truth. Generate
TypeScript declarations from schemas and validate payloads against JSON Schema.

Rationale:
- JSON Schema is language-neutral and works for local IPC and future HTTP.
- `json-schema-to-typescript` directly compiles JSON Schema to TypeScript
  declarations.
- Zod can be useful in UI forms, but `z.fromJSONSchema()` is experimental and
  should not be the stability anchor.

Alternatives considered:
- Zod as source of truth: rejected because it makes the contract TypeScript-led.
- Rust serde structs as source of truth: rejected because it makes the contract
  Rust-led.
- OpenAPI as source of truth: useful later for HTTP projection, but awkward for
  local operation streams and Tauri command envelopes.

Initial implementation notes:
- Store canonical schemas under `packages/contracts/schemas`.
- Generate TypeScript types under `packages/contracts/src/generated`.
- Keep Rust DTOs manually aligned at first or generated after evaluating Rust
  generator quality.
- Add parity tests before relying on generated types.

Sources:
- https://json-schema.org/specification
- https://json-schema.org/draft/2020-12
- https://www.npmjs.com/package/json-schema-to-typescript
- https://zod.dev/json-schema

## FITS Metadata

Decision: Implement a custom bounded FITS header reader for v1 metadata
extraction.

Rationale:
- v1 needs header keywords, not image processing or pixel payload access.
- FITS headers are block-oriented and can be read without decoding image data.
- Avoiding CFITSIO initially keeps the workspace easier to build and test across
  platforms.

Alternatives considered:
- `fitsio`/CFITSIO wrapper: more complete FITS support, but adds native build
  complexity and is unnecessary for header-only extraction.
- Trust folder names only: insufficient when useful FITS metadata exists.

Initial implementation notes:
- Read only the header block sequence up to `END`.
- Enforce a maximum header byte budget per file.
- Preserve raw cards and normalize known astrophotography keywords separately.
- Reconsider a full FITS dependency only if later tasks require compressed FITS,
  pixel statistics, or nontrivial HDU traversal.

Sources:
- https://fits.gsfc.nasa.gov/
- https://heasarc.gsfc.nasa.gov/docs/heasarc/fits_overview.html

## XISF Metadata

Decision: Use `quick-xml` to stream XISF XML metadata.

Rationale:
- XISF metadata is represented in XML structures and can include FITS-compatible
  keywords plus richer properties.
- A streaming parser matches the app's large-file safety requirement.
- `quick-xml` is a focused XML reader/writer crate and can avoid loading whole
  files into memory.

Alternatives considered:
- Full custom XML parsing: unnecessary and error-prone.
- Load full XISF documents into memory: conflicts with large-file safety.

Initial implementation notes:
- Read only the XISF header/metadata region needed for properties.
- Preserve raw property names and values.
- Normalize known metadata through `metadata_core`.
- Add fixture tests for missing, malformed, and vendor-specific properties.

Sources:
- https://pixinsight.com/xisf/
- https://pixinsight.com/doc/docs/XISF-1.0-spec/XISF-1.0-spec.html
- https://docs.rs/quick-xml/latest/quick_xml/

## Video Metadata

Decision: Start with lightweight built-in metadata and optional external
probing:
- Implement a minimal SER header reader in `metadata_video`.
- Classify AVI/MOV/MP4 by filesystem/path and optional sidecars initially.
- Add optional `ffprobe` capability detection for richer video metadata when the
  user has it installed.

Rationale:
- Planetary/lunar support should not pull a heavy FFmpeg binding into every
  build before the exact workflow profile is proven.
- SharpCap and similar capture tools often produce files where basic path,
  timestamps, dimensions, and capture software hints are enough for v1
  inventory/session grouping.
- Optional external probing preserves extensibility without making processing
  libraries part of the core app.

Alternatives considered:
- Bundle FFmpeg bindings: powerful but heavy and packaging-sensitive.
- Ignore video metadata: too weak for planetary/lunar workflows.

Initial implementation notes:
- Treat external probing as optional and read-only.
- Store probe availability in settings/capabilities.
- Never invoke video processing, transcoding, stacking, sharpening, or editing.

## Implementation Order Impact

These decisions unblock:
- T006 dependency configuration.
- T014 persistence boundary implementation.
- T038 FITS metadata adapter implementation.
- T039 XISF metadata adapter implementation.
- T040 video metadata adapter implementation.
- T010/T011 contract parity and TypeScript client work.

They do not finalize:
- Exact crate versions in perpetuity.
- Full PixInsight artifact taxonomy.
- Full planetary/lunar profile depth.
- Future remote API transport.
