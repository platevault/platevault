# Data States, Contracts, and Lifecycle Reference

## Purpose

This document captures the current Spec 001 product and UI decisions so future
implementation work does not have to recover them from design-session context.
It covers the data states, settings values, TypeScript-facing contracts, project
lifecycle, project metadata extraction rules, first-run setup, API contract
viewer, and application log behavior reflected in the frontend prototype.

## Interface Decisions

Primary navigation:

- `Inbox`
- `Inventory`
- `Projects`
- `Settings`

`Inbox` comes first because the direct workflow starts with unresolved material:
new source candidates, marker failures, path warnings, unknown folders, and
classification decisions.

`Inventory` means configured data sources and indexed inventory. It is not
called observed inventory or Library in the active UI.

`Data Sources` are visible in `Inventory` as a detail foldout and in
`Settings > Data Sources` for full management. They are not shown as a dominant
ledger column unless the workflow is about source setup or reconnect.

`Confidence`, `evidence`, and inferred provenance are implementation data, not
default row content. They belong in detail views, diagnostics, or logs only when
they help a direct workflow.

Selected ledger rows show details and actions, not duplicated row content. The
row itself remains the summary; the side panel contains the reasons, metadata,
and next safe actions.

The application log is a full-width bottom foldout over the workspace. When
closed it uses only the bottom strip. When open it overlays part of the current
application surface instead of pushing the whole layout down. The log includes
`Follow logs` and `Level` controls, and each event exposes structured metadata.

## First-Run Setup Wizard

The first-run experience is a one-time, app-level walkthrough. It is not a
dedicated primary navigation screen and it is not embedded on the Inbox,
Inventory, Projects, or Settings pages.

The wizard helps the user configure all relevant starting data sources before
normal work starts. Initial project
creation happens after setup through the guided Projects workflow. First-step
guidance runs after the wizard as an in-product coach over real actions, not as
a selectable wizard page or separate hints panel.

States:

- `Not Seen`: no completion or skip flag exists for the current profile.
- `Visible`: wizard overlay is open at app startup.
- `Completed`: user finished the wizard and normal app use continues.
- `Skipped`: user skipped the entire wizard and normal app use continues.
- `Guide Active`: post-setup coach is guiding real Inbox, Inventory, and Project
  actions.

Inputs:

- One or more Raw source directory selections.
- One or more Calibration source directory selections.
- One or more Projects source directory selections.
- One or more Inbox source directory selections.

Wizard pages:

- `Welcome`: explains setup scope, the skip option, and what the user will
  configure.
- `Sources`: clarifies Raw, Calibration, Project, and Inbox source categories
  before the user selects directories, including what the user should choose for
  each category.
- `Flow`: clarifies that setup saves source configuration;
  first project creation happens later through guided real actions.
- `Raw Sources`: configures one or more Raw roots using filesystem inputs.
- `Calibration Sources`: configures one or more Calibration roots using
  filesystem inputs.
- `Project Sources`: configures one or more Projects roots using filesystem
  inputs.
- `Inbox Sources`: configures one or more Inbox roots using filesystem inputs.

Post-setup guided first steps:

- Scan Inbox from the real Inbox action.
- Create or reveal sample Inbox placeholders for darks, bias, flats, and
  lights.
- Require the user to select each Inbox item before its move action appears.
- Move master darks, master bias, flats, and lights into Inventory one at a
  time.
- Select each moved Inventory item and verify its structured details.
- Confirm darks, bias, flats, and lights separately.
- Open Projects, add the first project, and create it from the project setup
  pane with path, name, target, workflow, one or more light sessions, optional
  flats per light session, dark master, and bias master.

Rules:

- Skipping the wizard opens the normal workspace and leaves setup available
  from Settings.
- Wizard pages are not individually skipped. Optional extra rows are expressed
  by adding/removing rows.
- Source pages support multiple rows and an `Add another source` action.
- Source roots are always directories. Production should use the native Tauri
  directory picker. Prototype replacements must be marked in source code.
- Next is blocked when any source row has no selected directory, a duplicate
  source name, a duplicate source root, or a file-like path.
- The wizard must not show a mock source preview, inferred runtime kind, or
  warning list. Those details are reviewed later in Inbox, Inventory, and
  Projects where the user can act on real items.
- Finishing creates source configuration drafts in the UI prototype and starts
  the guided first-step flow. The real implementation validates source roots
  before any marker or persisted source configuration is written.
- Setup can be restarted from Settings, not only by clearing local state.
- Source identity fields are immutable after creation; path changes use
  reconnect.

## Data States

### Data Source

Allowed source types:

- `Raw`
- `Calibration`
- `Projects`
- `Inbox`

Lifecycle:

- `Draft`: selected in setup but not saved.
- `Previewed`: root scanned for type-specific boundary validation.
- `Active`: saved, marker written or marker write explicitly deferred by plan.
- `Disconnected`: path is unavailable.
- `Disabled`: configured but not scanned.
- `ReconnectRequired`: source identity exists but path or marker proof changed.
- `Retired`: retained for history but excluded from active workflows.

Immutable identity:

- `id`
- `type`
- `canonicalRoot`
- calibration subtype, when applicable
- material kind, when applicable

Editable fields:

- display name
- notes
- enabled state
- include extensions
- ignore patterns
- symlink traversal policy
- scan behavior values that do not redefine identity

### Inventory Record

Lifecycle:

- `Observed`: file or directory exists at scan time.
- `Missing`: previously observed item is no longer reachable.
- `Changed`: size, modified time, marker, or supported metadata changed.
- `Classified`: app assigned a material class from metadata and context.
- `Rejected`: user or rule excluded it from normal workflows.
- `Protected`: cleanup/archive planning must preserve it by default.

Inventory records can be updated by scans. They do not by themselves create
immutable sessions or projects.

### Session Candidate

Lifecycle:

- `Discovered`
- `Candidate`
- `Needs Review`
- `Confirmed`
- `Ignored`

Rules:

- Raw data source roots are the directory above raw session folders.
- Immediate child folders become raw session candidates.
- FITS/XISF/video metadata is used for validation and warnings.
- Folder names provide a boundary and human label, not classification truth.
- The app does not auto-split a candidate in v1.

Confirming a raw session:

- creates the immutable session record;
- writes `.astro-library-session.json`;
- extracts the project-relevant metadata snapshot once;
- logs the operation;
- leaves original source files untouched.

### Calibration Candidate

Lifecycle:

- `Discovered`
- `Candidate`
- `Needs Review`
- `Confirmed`
- `Ignored`

Frame kinds:

- `Dark`
- `Flat`
- `Dark Flat`
- `Bias`

Material kinds:

- `Frames`
- `Masters`

Compatibility fields:

- camera
- filter
- exposure length
- gain
- offset
- binning
- temperature, when present
- optical train fingerprint, when present

### Project

Lifecycle states:

- `Candidate`
- `Source Mapping`
- `Prepared`
- `Processing`
- `Finalized`
- `Cleanup Reviewed`
- `Archived`

`project.json` is required for app-owned projects. Processing-tool workspaces
inside the project remain tool-managed and observable.

### Prepared Sources

Prepared Sources are generated projections of immutable source data for a
processing workflow. They may be symlink layouts, copy layouts, or manifest-only
views depending on the workflow profile and source constraints.

Lifecycle:

- `Not Created`
- `Planned`
- `Ready`
- `Stale`
- `Retired`

Rules:

- Prepared Sources are not canonical source data.
- The database is canonical for relationships and state.
- Manifests are generated/export artifacts.
- Reconciliation favors the database unless the user starts an explicit repair.

### Filesystem Plan

Lifecycle:

- `Draft`
- `Ready for Review`
- `Approved`
- `Executing`
- `Succeeded`
- `Partially Failed`
- `Failed`
- `Cancelled`

Plan actions include:

- create project folder resources
- create workflow source views
- write project markers
- archive planned material
- trash planned material
- remove generated links
- repair metadata snapshot

Permanent delete is disabled by default.

### Application Log Event

Log events are structured records, not plain strings.

Fields:

- `id`
- `timestamp`
- `level`: `debug`, `info`, `warn`, or `error`
- `operation`
- `entityType`
- `entityId`
- `message`
- `source`
- `project`
- `requestId`
- `metadata`

The UI supports level filtering and follow mode. The log viewer is a bottom
workspace overlay so it remains accessible without becoming primary navigation.

## Settings Model

Settings sections:

- `Data Sources`
- `Ingestion & Review`
- `Naming & Structure`
- `Calibration`
- `Tool Workflows`
- `Cleanup & Archive`
- `Application Log`
- `Catalogs`
- `Setup`

Density is fixed by the desktop design system; compact/comfortable mode is not
exposed as a user setting.

Light/dark switching is an icon-only top-bar action.

Rules in settings mean configurable review and classification behavior, not AI
automation. Prefer concrete names such as `Scan defaults`, `Ignore patterns`,
`Review states`, `Project resources`, and `Inbox actions`.

## Developer Contract References

API contracts are not a normal Settings section. Contract references belong in
developer documentation or diagnostics, not in the main user settings menu.

Required UI areas:

- operation list with method and path;
- selected operation summary;
- request schema preview;
- response schema preview;
- diagnostics/export actions.

Purpose:

- keep the Tauri adapter boundary visible;
- preserve a future remote backend path;
- make operation inputs and outputs reviewable before implementation;
- align TypeScript, Rust DTOs, and JSON Schema contracts.

## Project Metadata Snapshot

Project details must show FITS-derived acquisition metadata that helps direct
processing decisions.

Required project-level fields:

- total integration time;
- channels integrated;
- exposure count per project;
- acquisition date span;
- workflow profile;
- selected light session ids and calibration ids;
- extraction state;
- metadata repair state.

Required per-channel fields:

- channel or filter name;
- total integration time;
- exposure count;
- exposure lengths, preserving mixed notation such as `32 x 120s + 8 x 180s`;
- acquisition dates;
- gain;
- offset;
- binning;
- camera;
- temperature summary, when present;
- other FITS-derived values useful to processing, such as focal length,
  pixel size, capture software, telescope, reducer, rotator angle, or sensor
  mode when available.

Extraction rule:

- Project metadata is extracted when a source session becomes immutable.
- The extracted snapshot is not refreshed automatically on later scans.
- Updating the snapshot requires an explicit `Metadata Repair` or
  `Update Session Metadata` operation.
- Repairs are logged and should preserve previous snapshot history.

Rationale:

An immutable session is the point at which the user has reviewed the source
boundary. Later filesystem changes can be observed, but they must not silently
rewrite project facts that may have informed processing decisions.

## Project Lifecycle Detail

### Candidate

Metadata/entities:

- project candidate
- target hint
- workflow hint
- source candidate references

Actions:

- create project
- choose workflow
- ignore
- defer

Transitions:

- to `Source Mapping` after project identity and workflow are confirmed.
- to `Ignored` if the user rejects the candidate.

Edge cases:

- multiple target hints in one source candidate;
- missing target lookup;
- planetary videos mixed with deep-sky frames;
- unsupported metadata but clear user intent.

### Source Mapping

Metadata/entities:

- app-owned project identity;
- selected immutable sessions;
- selected calibration candidates or sets;
- target and panel mapping;
- workflow profile.

Actions:

- add/remove source sessions;
- map calibration;
- change workflow profile;
- preview Prepared Sources;
- create filesystem plan.

Transitions:

- to `Prepared` after a reviewed project operation creates workflow source
  views.
- back to `Candidate` only through explicit project deletion or rejection before
  project folder resources are created.

Edge cases:

- source session contains multiple targets;
- calibration compatibility is partial;
- selected source is missing;
- generated manifest would collide with existing files;
- symlink target is unsupported or crosses a protected boundary.

### Prepared

Metadata/entities:

- project folder resources;
- workflow source views;
- manifest;
- plan result;
- immutable source snapshot references.

Actions:

- open processing workspace;
- refresh Prepared Sources by explicit plan;
- mark processing started;
- inspect manifest.

Transitions:

- to `Processing` when the user records processing activity or app observes
  workflow artifacts.
- back to `Source Mapping` when sources or calibration are changed by review.

Edge cases:

- manifest drift;
- generated links missing;
- project moved;
- workflow profile changed after preparation.

### Processing

Metadata/entities:

- tool-managed workspace observations;
- processing notes;
- generated artifacts;
- active workflow profile.

Actions:

- record notes;
- observe tool outputs;
- mark finalized;
- defer.

Transitions:

- to `Finalized` after final outputs are selected or recorded.
- to `Prepared` when processing is reset while preserving Prepared Sources.

Edge cases:

- PixInsight workspace contains user-created files;
- planetary workflow produces multiple best outputs;
- final output exists outside app-owned folders;
- processing artifacts are deleted externally.

### Finalized

Metadata/entities:

- final outputs;
- export artifacts;
- protected generated outputs;
- project summary metadata.

Actions:

- add final output;
- update notes;
- create cleanup/archive plan;
- export manifest.

Transitions:

- to `Cleanup Reviewed` after cleanup/archive plan review.
- back to `Processing` if user reopens processing.

Edge cases:

- multiple final versions;
- missing final output;
- stale Prepared Sources;
- source sessions reused by another active project.

### Cleanup Reviewed

Metadata/entities:

- reviewed cleanup plan;
- protected sources;
- protected outputs;
- archive/trash decisions;
- audit log references.

Actions:

- execute archive;
- execute trash;
- defer;
- revise plan.

Transitions:

- to `Archived` after archive succeeds.
- remains `Cleanup Reviewed` after defer or partial failure.

Edge cases:

- source data belongs to multiple projects;
- calibration master is reused;
- archive destination is unavailable;
- trash operation partially fails;
- user requests permanent delete, which is disabled by default.

### Archived

Metadata/entities:

- archive records;
- retained project manifest;
- audit events;
- reconnect hints.

Actions:

- reconnect archive;
- restore project references;
- inspect manifest;
- export audit summary.

Transitions:

- to `Cleanup Reviewed` if archive state needs correction.
- to `Processing` only through explicit reopen.

Edge cases:

- archive path moved;
- archived source unavailable;
- project manifest is older than database state;
- restore path collides with existing files.

## TypeScript Contract Sketch

```ts
export type SourceType = "Raw" | "Calibration" | "Projects" | "Inbox";
export type DataSourceState =
  | "Draft"
  | "Previewed"
  | "Active"
  | "Disconnected"
  | "Disabled"
  | "ReconnectRequired"
  | "Retired";

export interface DataSource {
  id: string;
  displayName: string;
  type: SourceType;
  state: DataSourceState;
  canonicalRoot: string;
  enabled: boolean;
  ignorePatterns: string[];
  includeExtensions: string[];
  followSymlinks: boolean;
  markerId?: string;
  notes?: string;
}

export type CandidateState =
  | "Discovered"
  | "Candidate"
  | "Needs Review"
  | "Confirmed"
  | "Ignored";

export interface SessionCandidate {
  id: string;
  sourceId: string;
  folderPath: string;
  state: CandidateState;
  targetHints: string[];
  warnings: ReviewWarning[];
  fileCount: number;
}

export interface ImmutableSession {
  id: string;
  sourceId: string;
  folderPath: string;
  confirmedAt: string;
  markerPath: string;
  metadataSnapshot: SessionMetadataSnapshot;
}

export interface SessionMetadataSnapshot {
  extractedAt: string;
  extractorVersion: string;
  channelSummaries: ChannelSummary[];
  captureSoftware?: string;
  camera?: string;
  telescope?: string;
  focalLengthMm?: number;
  pixelSizeUm?: number;
}

export interface ChannelSummary {
  channel: string;
  integrationSeconds: number;
  integrationLabel: string;
  exposureCount: number;
  exposureLengthsLabel: string;
  acquisitionDatesLabel: string;
  gainLabel: string;
  offsetLabel: string;
  binningLabel: string;
  camera?: string;
  temperatureLabel?: string;
}

export type ProjectState =
  | "Candidate"
  | "Source Mapping"
  | "Prepared"
  | "Processing"
  | "Finalized"
  | "Cleanup Reviewed"
  | "Archived";

export interface Project {
  id: string;
  name: string;
  target: string;
  workflow: "PixInsight" | "Planetary" | "Siril";
  state: ProjectState;
  lightSessionIds: string[];
  flatCalibrationIdsByLightSessionId: Record<string, string | null>;
  darkCalibrationId?: string;
  biasCalibrationId?: string;
  channelSummaries: ChannelSummary[];
  totalIntegrationLabel: string;
  channelsIntegratedLabel: string;
  exposureCount: number;
  acquisitionDatesLabel: string;
  metadataSnapshotState: "Extracted" | "Repair Pending" | "Repair Reviewed";
}

export interface ApiOperationContract {
  id: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  summary: string;
  requestSchemaName: string;
  responseSchemaName: string;
  requestExample: unknown;
  responseExample: unknown;
}

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface AppLogEvent {
  id: string;
  timestamp: string;
  level: LogLevel;
  operation: string;
  entityType: string;
  entityId: string;
  message: string;
  source?: string;
  project?: string;
  requestId: string;
  metadata: Record<string, string | number | boolean | null>;
}
```

## Contract Boundary

The TypeScript interfaces above are UI-facing sketches. The implementation
source of truth remains language-neutral JSON Schema in `packages/contracts`
with Rust DTOs in `crates/contracts/core`. Tauri is the first transport adapter,
not the only possible adapter.

## Future Implementation Notes

- Keep first-run setup as a one-time app-level wizard. Do not add per-step
  skipping; full-wizard skip is the only skip path.
- Do not add `confidence` or `evidence` columns back into default ledgers.
- Keep logs in a bottom overlay with structured metadata and level filtering.
- Keep project metadata snapshots immutable after confirmation unless an
  explicit repair/update operation is performed.
- Keep settings labels concrete and functional; avoid vague generated terms.
  Settings are one-column, auto-save on change, include info affordances, and
  do not use section-local Save buttons.
- Do not surface API Contracts as a normal Settings section; keep contract
  references in developer documentation or diagnostics.
- Treat FITS/XISF `OBJECT` as a target search hint, not as an automatic target
  assignment.
- Keep the guided onboarding sample as four separate placeholders: darks, bias,
  flats, and lights. Do not collapse it back into a single generic session.
- Keep project setup source mapping as one or more light sessions with optional
  flats per light session, plus separate dark and bias selections.
