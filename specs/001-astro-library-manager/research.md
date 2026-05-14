# Research: Astro Library Manager

## Related Decision Records

- [UI and Domain Decision Record](./research-ui-domain-decisions.md): navigation,
  data source boundaries, session confirmation, metadata repair, project
  creation, prepared sources, manifests, notes, settings, cleanup, and deferred
  scope decisions from the design grilling pass.

## Research Sources Consulted

- Tauri architecture and command communication:
  https://v2.tauri.app/concept/architecture/ and
  https://v2.tauri.app/es/develop/calling-rust/
- SQLite WAL behavior: https://www.sqlite.org/wal.html
- FITS support and documentation entry points:
  https://fits.gsfc.nasa.gov/ and
  https://heasarc.gsfc.nasa.gov/docs/heasarc/fits_overview.html
- XISF overview and specification:
  https://pixinsight.com/xisf/ and
  https://pixinsight.com/doc/docs/XISF-1.0-spec/XISF-1.0-spec.html
- Windows links and junctions:
  https://learn.microsoft.com/en-us/windows/desktop/fileio/hard-links-and-junctions
- macOS filesystem case and normalization behavior:
  https://developer.apple.com/library/archive/documentation/FileManagement/Conceptual/APFS_Guide/FAQ/FAQ.html
- JSON Schema and OpenAPI:
  https://json-schema.org/specification and
  https://spec.openapis.org/oas/v3.0.0.html
- Zod JSON Schema conversion:
  https://zod.dev/json-schema

## Decisions

### Desktop Architecture

**Decision**: Use Tauri 2 + React + Rust + SQLite for v1, with a transport
adapter layer between the React app and the Rust core.

**Rationale**: Tauri aligns with a local-first filesystem-heavy desktop app
because it provides a native desktop shell, Rust system integration, and a web
frontend. React keeps UI iteration fast. Rust is well suited for filesystem
planning, path handling, metadata parsing, and durable domain services. SQLite
is the right initial canonical store for single-user local metadata, audit logs,
relationships, and operation state.

**Alternatives considered**:

- Electron + React + Node: faster ecosystem access and simpler JS-only stack,
  but heavier distribution and weaker fit for Rust-first filesystem/domain
  logic.
- Native UI per platform: best platform integration, but too expensive for v1
  and less portable.
- Web app plus local service: good future migration path, but adds service
  lifecycle, localhost networking, auth, and packaging complexity before there
  is product proof.

**Tradeoff**: Tauri command surfaces can become tightly coupled if each UI
component invokes commands directly. The plan mitigates this by using a
frontend service client and language-neutral operation contracts.

### Monorepo and Rust Crate Layout

**Decision**: Keep a monorepo with granular Cargo workspace crates nested by
family, for example `crates/metadata/core`, `crates/metadata/fits`,
`crates/metadata/xisf`, `crates/metadata/video`, `crates/fs/inventory`, and
`crates/fs/planner`.

**Rationale**: Cargo supports workspace members at nested paths. Separate crates
reduce dependency leakage and build/test cost, which matters for metadata
parsers and filesystem logic that will have different dependencies and fixture
sets. Nested family directories provide TypeScript-like navigation without
pretending Rust has nested subcrates inside one package.

**Alternatives considered**:

- One large `metadata` crate with internal modules: simpler initial wiring, but
  likely to accumulate optional features and expensive dependencies that slow
  unrelated tests.
- Prefix every crate with the product name: avoids registry ambiguity, but adds
  noise in an internal workspace and was rejected by user preference.
- One crate per tiny concept: maximally isolated, but too much Cargo overhead
  before the boundaries are proven.

### Conceptual Model

**Decision**: The canonical domain model is target-centered but project-driven:
`LibraryRoot`, `FileRecord`, `Target`, `AcquisitionSession`,
`CalibrationSession`, `CalibrationMaster`, `Project`, `ProjectSource`,
`WorkflowProfile`, `ProcessingArtifact`, `ProjectOutput`, `FilesystemPlan`, and
`AuditLogEntry`.

**Rationale**: Targets help users answer "what data do I have for this object?"
while projects remain the unit of processing decisions, source maps, manifests,
outputs, and cleanup. Acquisition sessions are immutable source records.
Calibration data is first-class and independent because it can be reused across
targets, sessions, and projects.

**Alternatives considered**:

- Object folder as canonical entity: too brittle for multi-target sessions,
  mosaics, reusable flats, and messy libraries.
- Processing project as the only top-level entity: misses library inventory,
  acquisition history, and reusable calibration management.
- Capture session as the only top-level entity: weak for target history and
  processing lifecycle.

### Project Structure Ownership

**Decision**: App-managed projects require an app-created outer project envelope.
Existing projects can be onboarded only after they are migrated into that
supported structure through guidance or a reviewed filesystem plan.

**Rationale**: Cleanup safety depends on knowing which folders are app-created,
which are tool-managed, and which are user-managed. Supporting arbitrary
brownfield project layouts as managed projects would make cleanup rules
unreliable.

**Alternatives considered**:

- Ingest arbitrary existing project folders: convenient, but too risky for
  lifecycle and cleanup.
- Force full library migration before use: too disruptive and conflicts with
  local-first indexing of messy libraries.

### Default Project Envelope

**Decision**: Recommend this v1 outer structure, subject to final naming
template configuration:

```text
<ProjectRoot>/
├── .alm/
│   ├── project.json
│   ├── manifests/
│   ├── artifact-registry/
│   └── audit-refs/
├── sources/
│   ├── manifests/
│   └── views/
├── processing/
│   ├── pixinsight/
│   └── planetary/
├── outputs/
│   ├── final/
│   └── review/
├── notes/
└── archive/
```

**Rationale**: The app owns `.alm`, source views, generated manifests, notes
metadata, output registration, and cleanup policy. Processing tool workspaces
inside `processing/` are observed and registered but not treated as canonical
app-managed content.

**Alternatives considered**:

- Put everything under hidden `.alm`: safer for app files, but inconvenient for
  PixInsight and human inspection.
- Put all PixInsight data at project root: closer to tool usage, but makes
  cleanup and app ownership unclear.

### Metadata Extraction

**Decision**: Extract metadata in layers: filesystem attributes first, format
header metadata second, optional expensive/large-file operations last. Store raw
keyword/property values plus normalized fields and confidence/evidence.

**Rationale**: FITS headers and XISF metadata are useful but inconsistent across
capture tools and processing outputs. The app should preserve raw values and
derive normalized hints for date/time, exposure, frame type, filter, camera,
gain, offset, sensor temperature, binning, dimensions, target/object, telescope,
focal length, site, capture software, and processing software.

**Alternatives considered**:

- Trust folder names first: useful fallback, but less reliable than metadata
  where metadata exists.
- Require full hashing and pixel reads: expensive and unnecessary for v1
  classification.

### FITS/XISF Keyword Set

**Decision**: Start with a configurable keyword map that includes standard and
common astrophotography variants:
`DATE-OBS`, `TIME-OBS`, `EXPTIME`/`EXPOSURE`, `IMAGETYP`/`FRAME`, `FILTER`,
`OBJECT`, `INSTRUME`/camera, `TELESCOP`, `FOCALLEN`, `XBINNING`, `YBINNING`,
`GAIN`, `OFFSET`, `CCD-TEMP`/`SET-TEMP`, `PIERSIDE`, `ROTANGLE`,
`SITELAT`, `SITELONG`, `BAYERPAT`, image dimensions, capture software, and
history/comment cards.

**Rationale**: FITS provides standard structure but astrophotography software
varies in exact keyword usage. XISF is compatible with FITS metadata but can
also include richer properties. The app should normalize known keys without
discarding unknown keys.

`OBJECT` is treated as a target search hint for lights and other target-bearing
frames. It should search local/online target names, aliases, and catalog IDs, but
must not silently assign the target when the value is missing, ambiguous, or
contradicted by user review.

**Alternatives considered**:

- Hardcode only official FITS keywords: too narrow for amateur capture
  software.
- Treat every keyword equally in matching: noisy and hard to explain.

### Calibration Matching

**Decision**: Use a weighted explainable scoring model with hard incompatibility
gates. Matching produces candidate records, not automatic final choices.

**Rationale**: Darks, biases, dark flats, flats, and masters have different
compatibility dimensions. Some fields should be hard mismatches, such as camera,
sensor mode, binning, filter for flats, and frame type. Other fields can be
toleranced or confidence-affecting, such as sensor temperature, exposure, gain,
offset, night/date, optical train fingerprint, focus/rotation, and dust state.

**Alternatives considered**:

- Date-folder matching only: simple but fails reusable libraries.
- Fully automatic calibration selection: unsafe because metadata is often
  incomplete and flat reuse depends on physical setup stability.

### Source View Strategy

**Decision**: Use a hybrid strategy with manifest-first documentation and
platform/profile-specific generated views. Default to symlink/junction-based
folder views only after plan review; fallback to manifest-only or copy where
links are unsafe or unavailable.

**Rationale**: Large image files should not be copied by default. Windows,
macOS, and Linux link semantics differ, and processing tools may behave
differently with links. A plan can explain whether a view uses directory
junctions, symlinks, hard links, copies, or manifests.

**Alternatives considered**:

- Always copy: safest for tool compatibility but wasteful for large libraries.
- Always symlink: lightweight but platform capability and permission dependent.
- Manifest-only: safest and portable, but less convenient for tools expecting
  folders.

### PixInsight and Tool Artifact Observation

**Decision**: Treat PixInsight/WBPP workspaces and planetary/lunar processing
workspaces as tool-managed/user-managed. Observe them on startup/refresh and
optionally with folder monitoring. Register discovered artifacts with evidence,
type guesses, size, timestamps, and cleanup confidence.

**Rationale**: PixInsight should own its own processing output structure. The
app can still learn which directories exist and later propose cleanup candidates
without pretending to control the workspace.

**Alternatives considered**:

- App-managed PixInsight directory tree: stronger predictability but brittle
  against PixInsight changes and user habits.
- Only manual cleanup tagging: safe but too much effort for disk recovery.

### Cleanup Policy and Review Tree

**Decision**: Cleanup is governed by inherited policy from global defaults to
project to resource/tree node. Plan review shows a nested directory/resource/type
tree where each node can inherit, enable, disable, or override cleanup behavior.

**Rationale**: Users need global defaults for repeated workflows and per-project
exceptions for valuable or unusual artifacts. Cleanup safety depends on
visible protected categories and explicit user selection.

**Alternatives considered**:

- One global cleanup toggle: too coarse.
- Per-file only selection: accurate but unusable for large projects.

### Protected Categories

**Decision**: Protect original sources, calibration masters, app manifests,
user notes, final outputs, audit logs, app configuration, and configured
protected folders by default. Cleanup candidates begin with observed
tool-specific intermediates, regenerated source views, temporary files, and
known processing caches after verification gates are met.

**Rationale**: Cleanup value comes from removing large intermediates while
preserving irrecoverable or decision-bearing artifacts.

**Alternatives considered**:

- Allow permanent delete by default: rejected for safety.
- Protect all processing artifacts forever: safe but fails disk-recovery goal.

### Lifecycle States

**Decision**: Use explicit lifecycle states:
`candidate`, `active`, `source_mapped`, `prepared`, `processing`, `finalized`,
`verified`, `cleanup_reviewed`, `archived`, and `retired`.

**Rationale**: The spec needs enough states to separate project creation,
source mapping, source view generation, active tool processing, final output
registration, verification, cleanup review, and archival.

**Alternatives considered**:

- Minimal open/closed lifecycle: too weak for cleanup gating.
- State per tool profile only: useful detail, but common lifecycle state is
  still needed across PixInsight and planetary/lunar workflows.

### Manifest Strategy

**Decision**: Database remains canonical. Generate protected project manifests
as versioned documentation/export artifacts, with a hybrid default:
`manifest.json` for machine-readable summary, optional append-only
`events.jsonl` export for selected audit/decision events, and `manifest.md` for
human-readable review.

**Rationale**: JSON supports future import/export and remote service migration.
JSONL is useful for event-style audit exports but should not become the only
project document. Markdown is useful outside the app but not a contract.

**Alternatives considered**:

- DB-only display: avoids duplication, but weak for project portability and
  out-of-app inspection.
- Manifest as source of truth: portable but complicates conflict handling,
  remote migration, and audit integrity.

### Contract Strategy

**Decision**: Define an operation catalog and JSON Schema payloads as the source
of truth. Generate TypeScript validators/types and Rust serde types from the
schemas where practical. Tauri commands are an adapter, not the contract.

**Rationale**: JSON Schema is language-neutral and can be used over local IPC or
HTTP. OpenAPI is useful for future HTTP projection, but Tauri operations are not
HTTP-native. Zod can validate in the UI, but using Zod as the source of truth
would bind the contract to TypeScript.

**Alternatives considered**:

- Tauri command signatures as source of truth: fast initially, but locks UI to
  Rust/Tauri.
- OpenAPI as the only source: excellent for HTTP, but awkward for local
  operation streams and non-HTTP commands.
- Zod as source of truth: good frontend ergonomics, but not language-neutral.

### Workflow Profiles

**Decision**: Model workflow profiles as data/config plus backend capabilities.
v1 includes PixInsight/WBPP and common planetary/lunar profiles. Siril and other
tools are later additions using the same profile model.

**Rationale**: Project creation should select the intended tool because source
views, expected artifacts, lifecycle hints, and cleanup candidates differ.

**Alternatives considered**:

- Hardcode PixInsight only: simpler, but the user explicitly wants
  planetary/lunar support.
- Generic project with no tool profile: too little information for source view
  and cleanup rules.

## Assumptions Requiring Later Validation

- Exact PixInsight/WBPP intermediate directory names and cleanup categories must
  be validated against current PixInsight behavior and user sample projects.
- Common planetary/lunar tool profiles should be researched further before
  tasking detailed artifact classifiers. Candidate tools include SharpCap for
  capture and common stacking/sharpening/editing tools, but v1 may start with a
  generic planetary/lunar profile plus named software metadata.
- FITS/XISF metadata parser dependencies should be selected during
  implementation planning for the metadata crates after fixture requirements
  are known.
- SQLite crate and migration tooling should be selected when persistence
  implementation begins; candidates include `sqlx`, `rusqlite`, and migration
  helpers, with test/build time as a deciding factor.
