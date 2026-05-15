# UI and Domain Decision Record

## Purpose

This document records the product and UI decisions made during the design
grilling pass for Astro Library Manager. It is a reference for later specs,
mockups, implementation tasks, and future revisions.

## Navigation Model

### Decision

Primary navigation is intentionally small:

- `Inventory`
- `Projects`
- `Inbox`, visible when a review queue exists or an Inbox source is configured
- `Settings`

### Rejected Primary Navigation

- `Ingest`
- `Plans`
- `Audit`
- `Targets`
- `Global Sweep`
- `Root Remap`
- `Source Truth`

### Rationale

Astrophotography library management has many domain nouns. Making each noun a
top-level destination creates a noisy shell and weakens the actual workflows.
Scanning, source mapping, cleanup, root recovery, logs, and global actions are
contextual activities, not primary product destinations.

## Inventory and Data Sources

### Decision

`Inventory` means all registered data sources and their indexed contents.

`Data Source` means a configured filesystem location with a declared type and
scan rules.

Data source types for v1:

- `Raw`
- `Calibration`
- `Projects`
- `Inbox`

`Exports` are not a data source. Exports are project artifacts.

### Data Source Management

Data sources appear in two places:

- `Inventory`: operational browsing, scanning, and source inspection.
- `Settings > Data Sources`: full management, reconnect, and rule editing.

After creation, data source identity is immutable:

- Path is not casually editable.
- Source type is not editable.
- Calibration subtype and material kind are not editable.

Editable fields:

- Display name
- Notes/description
- Enabled state
- Include/exclude extensions
- Ignore folder patterns
- Symlink traversal setting
- Scan behavior settings that do not alter source identity

Path changes use an explicit `Reconnect Source` workflow.

### Source Markers

Every data source root gets:

```text
.astro-library-source.json
```

This marker is an identity/reconnect aid only. The DB remains canonical.

## Source Creation Preview

### Decision

For first-run setup, source configuration is validation-focused and does not show a
preview. The initial setup flow validates required roots and continues into guided
scan/workflow onboarding after sources are saved.

For non-first-run source creation or source edits, include a type-specific preview
before saving and before writing the source marker.

Examples:

- Raw: immediate child folders become raw session candidates.
- Calibration Frames: immediate child folders become calibration set candidates.
- Calibration Masters: supported files under the source become master
  candidates.
- Projects: immediate child folders with `project.json` are managed projects.
- Inbox: files/folders feed the review queue until confirmed or moved.

### Rationale

For first-run setup, this validation layer prevents creating a source with a
missing or invalid root before setup can continue.

For non-first-run operations, the preview prevents choosing a root at the wrong
level and makes the source boundary visible before the app writes markers or
indexes state.

## Raw Session Discovery

### Decision

For a Raw data source, the data source root is the directory directly above raw
session folders. Each immediate child folder is one raw session candidate. The
app recursively scans inside that child folder for supported image files.

Folder names and file names are not used for classification. FITS/XISF metadata
is used for classification, validation, grouping, target hints, equipment
consistency, and warnings.

### Example

```text
D:\Astrophotography\Raw\Poseidon-C PRO\
  20250310 heart & soul Panel 1\
    2025-10-18\
      Lights\
        LUM\
          120.00\
            *.fits
```

The Raw data source root is:

```text
D:\Astrophotography\Raw\Poseidon-C PRO\
```

The session candidate is:

```text
20250310 heart & soul Panel 1
```

### Validation

The app creates one candidate for the child folder and warns if metadata shows
major discrepancies:

- Multiple cameras
- Multiple telescopes/optical trains
- Multiple mounts when recorded
- Multiple unrelated targets or panels
- Conflicting frame categories
- Date span outside configured tolerance
- Conflicting capture software metadata

The app does not auto-split sessions in v1.

## Session Candidates and Confirmation

### Decision

Scans create session/calibration candidates. Candidates must be confirmed before
they become immutable sources that can be mapped to projects.

Candidate states:

- `Discovered`
- `Candidate`
- `Needs Review`
- `Confirmed`
- `Ignored`

The `Inbox` screen is the review queue for candidates and warnings. It is not
only a filesystem inbox folder.

### Confirmation

Confirming a raw session:

- Creates the immutable session record.
- Writes `.astro-library-session.json` into the raw session folder.
- Logs the confirmation in the Application Log.
- Fails or requires explicit recovery if marker writing fails.

Raw session markers are identity-only and do not duplicate extracted metadata.

## Calibration Discovery and Confirmation

### Decision

Calibration data is independent from raw sessions and projects.

Calibration data source setup requires:

- Frame kind: `Dark`, `Flat`, `Dark Flat`, or `Bias`.
- Material kind: `Frames` or `Masters`.

### Calibration Frames

For Calibration Frames data sources:

- Immediate child folder is one calibration set candidate.
- The app recursively scans inside the child folder.
- FITS/XISF metadata determines frame kind/settings and validates consistency.
- Folder name provides boundary/identity, not classification.

Confirmed calibration frame sets use a central marker folder:

```text
CalibrationSource/
  .astro-library/
    calibration-sets/
      {calibration_set_id}.json
```

### Calibration Masters

For Calibration Masters data sources:

- The app recursively discovers supported master files.
- Each file is one calibration master candidate.
- Confirmation writes an adjacent sidecar marker:

```text
MasterDark_120s_gain100.xisf
MasterDark_120s_gain100.xisf.astro-library.json
```

### Confirmation

Calibration markers are written as part of `Confirm Calibration Set/Master`, not
through a separate reviewed plan.

## Immutability and Allowed Source Changes

### Decision

Confirmed raw sessions, calibration sets, and calibration masters have immutable
file membership.

Allowed changes after confirmation:

- Notes
- Notes and linked subjects
- Target aliases and links
- Project mappings
- Calibration mappings
- Review/status labels
- Marker schema migration
- Metadata repair through corrected copies and reviewed plan

### Rejected Frames

Raw sessions may contain configured rejected folders. Files under rejected
folders are excluded from active Prepared Sources but remain tracked as rejected
lineage.

Allowed normal post-confirmation file movement in raw sessions:

- Move known active frames into configured rejected folders.
- Move rejected frames back out when their identity can be matched.

Not allowed as normal v1 mutations:

- Arbitrary active file moves.
- In-place FITS/XISF header edits.
- Silent active membership changes.
- Silent deletes.
- Auto-adding extra files to confirmed sessions.
- Splitting or merging confirmed sessions.

Extra files inside confirmed raw/calibration records create warnings.

## Metadata Repair

### Decision

V1 supports Metadata Repair, not DB-only metadata overrides.

Metadata repair:

- Applies to raw and calibration candidates.
- Applies to confirmed raw sessions, calibration sets, and calibration masters.
- Creates corrected copies with repaired headers.
- Makes active records point to corrected copies.
- Archives and tracks originals.
- Preserves lineage.
- Requires a full reviewable filesystem plan.

Default original archive location is configurable and defaults to a sibling
archive folder near the affected session/candidate:

```text
_archived_originals/{operation_id}/
```

## Inbox and Review Queue

### Decision

Primary nav label is `Inbox`. Page title is `Review Queue`.

The queue receives:

- Scan results from registered data sources.
- Optional Inbox data source contents.
- Ad hoc scanned folders.

Action label:

```text
Add Folder to Queue
```

Candidates outside a matching Raw/Calibration data source cannot become
immutable in place. They must be moved into a selected data source through a
reviewed move plan before confirmation.

No normalization templates are included in v1. Normalizing session/calibration
structure is a future feature.

## Projects

### Decision

V1 does not ingest arbitrary brownfield project folders. Managed projects must
be created by Astro Library Manager and include:

```text
project.json
```

Existing projects can be handled by creating a new managed project and manually
migrating or mapping data.

### Project Creation

Required at creation:

- Project name
- Workflow/type
- Primary target
- Project data source/location when multiple Projects sources exist
- Lifecycle template, defaulted by workflow/type

Optional at creation:

- Additional targets
- Mosaic flag and panels
- Raw sessions
- Calibration sets/masters
- Export destination override

Online target lookup is v1 scope. Freeform targets remain allowed. Offline use
is not a v1 concern.

Initial project scaffold creation happens immediately after preview and
confirmation. It does not require a separate filesystem plan.

If sources are selected during creation, confirmation also creates the project
source mappings and prepared source links. Only confirmed immutable sources can
be selected.

Changing sources on an existing project requires a reviewed plan.

## Project Structure

### Decision

Create only the selected workflow workspace, not every possible tool folder.

Default non-mosaic structure:

```text
{project_slug}/
  project.json
  sources/
    raw/
    calibration/
  {workflow_workspace}/
  exports/
  manifests/
  notes/
  plans/
  logs/
  _archive/
```

Examples of workflow workspaces:

- `pixinsight/`
- `siril/`
- `planetary/`
- `landscape/`

Workflow launch/profile/config management is future scope. V1 prepares sources
and observes artifacts; tools own their own workspace folders.

## Prepared Sources

### Decision

User-facing term: `Prepared Sources`.

Internal concept may be `source_view` or `prepared_source_layout`, but the UI
does not expose view revisions as a primary concept.

`sources/` is app-owned. Processing tools read from `sources/` and write to
their own workflow workspace folders.

V1 has one active prepared source layout per project or mosaic panel. No visible
`current`, `view-001`, or `view-002` folder pattern.

Updating Prepared Sources:

- Is part of project creation when sources are selected.
- Is part of adding/changing sources on existing projects.
- Replaces only app-owned links.
- Warns if unexpected files exist under `sources/`.

Link rules:

- Folder-level selections create directory links.
- File-level selections create file links.
- Mixed mappings preserve mixed granularity.

## Manifests

### Decision

The DB is canonical. Manifests are checkpoint documentation snapshots, not live
mirrors and not a source view mode.

Generate manifests at checkpoints:

- Project creation
- Prepared Sources creation/update
- Calibration mapping approval
- Metadata repair
- Lifecycle transition to finalized/archive
- Cleanup/archive plan application

If manifest and DB disagree, DB wins. Later workflows may regenerate or
reconcile manifests.

## Targets and Mosaics

### Targets

Projects support multiple targets in v1. Exactly one target is primary.
Additional targets can be secondary, panel, background, field, or annotation
targets.

FITS/XISF `OBJECT` metadata is a target lookup hint, not an authoritative
assignment. When light frames contain an object name, the app should use that
value to search target names, aliases, and catalog identifiers, then ask the
user to confirm or choose another target if the match is ambiguous.

Online target lookup is v1 scope. Likely lookup source:

- CDS Sesame/SIMBAD for resolving names, aliases, object type, and RA/Dec.

The UI should always allow manual target entry and catalog/identifier selection.
If lookup is unavailable, project creation and session review continue with the
manual target value.

### Mosaics

Mosaic support is v1.

A project can be flagged as Mosaic. Mosaic projects contain panels. Panels are
bounded sub-project-like records, but the UI should prefer the domain term
`Panels`.

Parent mosaic project owns:

- Primary target
- Overall lifecycle
- Panel list/grid
- Final combined exports
- Cross-panel notes and decisions

Each panel owns:

- Simplified panel lifecycle/status
- Mapped sessions
- Calibration choices
- Prepared Sources
- Processing attempts
- Panel-level artifact cleanup

Mosaic Prepared Sources are organized by panel first.

## Notes

### Decision

Notes are DB-canonical and written in Markdown.

Notes can attach to:

- Project
- Raw session
- Calibration set/master
- Target
- Mosaic panel
- Plan/action
- Lifecycle event

SQLite FTS indexes note title, body, and tags.

When notes are saved:

- DB save happens first.
- Markdown sync/export runs immediately after save.
- Sync writes only inside app-owned project `notes/` folders for projects that
  reference the note subject.
- No review plan is required for note sync.
- External drift is not overwritten silently.

When a session/calibration/target is added to a project, existing notes for that
subject sync into the project on first add.

## Exports

### Decision

`Exports` are project artifacts, not data sources.

Default is project-local exports. A global shared Exports destination and
per-project override may be configured.

Exports are protected from cleanup by default.

## Settings Workbench

### Decision

Settings has internal subnavigation:

- `Data Sources`
- `Ingestion & Review`
- `Naming & Structure`
- `Calibration`
- `Tool Workflows`
- `Cleanup & Archive`
- `Application Log`
- `Advanced`

`Application Log` is one structured log stored once and rendered differently in
the UI for user-facing and technical views.

Contract references are developer diagnostics, not a normal Settings section.
They should expose schema/contract version, contract export, and diagnostics
outside the main product workflow.

## Cleanup and Archive

### Decision

Cleanup and archive actions are contextual and settings-driven, not primary
navigation.

Examples:

- Project cleanup from project detail/settings.
- Rejected frame cleanup from session detail.
- Global sweep under `Settings > Cleanup & Archive` or `Advanced`.
- Reconnect under data source settings.

Every destructive or cleanup operation uses reviewed filesystem plans.

## Future / Deferred

Defer from v1:

- Brownfield project ingestion.
- Full session/library normalization.
- PixInsight launch/profile/icon-set management.
- In-place FITS/XISF header mutation.
- DB-only metadata overrides.
- Arbitrary session split/merge/restructure.
- Curated per-project raw subframe subsets.
- CI-generated minimal local target index for offline autocomplete. The index
  should contain names, aliases/identifiers, object type, RA/Dec, and provenance
  only. Because this project is Apache-2.0 open source, every upstream catalog
  must pass a redistribution/license review before any derived index is bundled.
  NGC 2000.0 is a known review risk because HEASARC/CDS note Sky Publishing
  copyright and non-commercial restrictions for the machine-readable catalog.
