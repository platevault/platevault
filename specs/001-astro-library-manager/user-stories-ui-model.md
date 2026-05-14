# User Stories and Unified UI Model

## Purpose

This document expands Astro Library Manager into conversion-ready user stories
and use cases. It is not a replacement for `spec.md`; it is a working inventory
for future SpecKit feature slices, UI prototypes, and implementation tasks.

The stories are grounded in these current decisions:

- Primary navigation: `Inbox`, `Inventory`, `Projects`, `Settings`.
- `Inbox` is the review queue for scan results, warnings, candidate decisions,
  marker failures, and ad hoc folders.
- `Inventory` is the operational inventory of configured data sources and indexed
  contents.
- `Projects` is where app-managed projects are created, mapped, prepared,
  documented, observed, finalized, and cleaned up.
- `Settings` owns data source management, review defaults, naming, calibration,
  workflow profiles, cleanup policy, application log, API contracts, and
  advanced operations.
- Logs are full-width bottom panels, not a side rail mode.
- The UI should use plain labels, dense useful lists, and selected-item detail
  panels. Avoid explanatory marketing copy in routine workflow screens.

## Story Format

Each story includes:

- **User goal**: the outcome the user wants.
- **Entry points**: where the flow starts.
- **Inputs and settings**: parameters or configuration the user can provide.
- **UI elements**: controls and visible components needed for the flow.
- **Data touched**: durable records or generated artifacts involved.
- **Primary view**: where the story should live in the unified UI.
- **Result**: what changes after completion.

## User Story Inventory

### US-001: Complete First Run Setup

**User goal**: Start using the application with at least one configured source.

**Entry points**: First launch, `Settings > Data Sources`, empty `Library`.

**Inputs and settings**:

- Data source path.
- Data source type: `Raw`, `Calibration`, `Projects`, or `Inbox`.
- For calibration sources: frame kind and material kind.
- Include and exclude extensions.
- Ignore folder patterns.
- Follow links setting.
- Hashing mode.
- Display name and notes.

**UI elements**:

- Empty-state source prompt.
- Data source picker.
- Type selector.
- Source preview before saving.
- Settings form.
- Confirm button.
- Bottom log panel.

**Data touched**:

- Data Source record.
- Library root identity.
- Source marker `.astro-library-source.json`.
- Operation log entry.

**Primary view**: `Settings > Data Sources`, with a lightweight entry point from
`Library`.

**Result**: The source is registered, previewed, and ready to scan. No library
files are moved.

### US-002: Add a Data Source Later

**User goal**: Add another source without disturbing existing relationships.

**Entry points**: `Library > Sources`, `Settings > Data Sources`.

**Inputs and settings**:

- New source path.
- Source type.
- Optional display name.
- Source-specific scan settings.

**UI elements**:

- Add source button.
- Fold-out source list.
- Preview panel.
- Source conflict warnings.
- Confirm action.

**Data touched**:

- Data Source record.
- Source marker.
- Source settings.
- Application log.

**Primary view**: `Settings > Data Sources`.

**Result**: The source appears in Library inventory and can feed Inbox items.

### US-003: Reconnect a Moved Source

**User goal**: Repair a missing external drive or remapped path without losing
history.

**Entry points**: `Inbox` missing source item, `Library` source details,
`Settings > Data Sources`.

**Inputs and settings**:

- New path.
- Sample record verification.
- Optional notes.

**UI elements**:

- Reconnect action.
- Path picker.
- Sample records comparison.
- Confirm reconnect.
- Log panel.

**Data touched**:

- Data Source root path mapping.
- Root remap event.
- Existing root-relative records.
- Audit and application log entries.

**Primary view**: `Settings > Data Sources`.

**Result**: Relationships and history remain attached to the source identity.

### US-004: Scan a Data Source

**User goal**: Refresh inventory without mutating files.

**Entry points**: `Library`, `Settings > Data Sources`.

**Inputs and settings**:

- Source selection.
- Follow links setting.
- Hashing mode.
- Include and exclude filters.
- Ignore folder patterns.

**UI elements**:

- Scan button.
- Source list.
- Progress row or operation strip.
- Pause or cancel when safe.
- Bottom logs.

**Data touched**:

- File or folder records.
- Link records.
- Timestamps, sizes, root-relative paths.
- Scan errors and warnings.
- Operation state.

**Primary view**: `Library`.

**Result**: Inventory updates and review items appear in `Inbox`.

### US-005: Browse Library Inventory

**User goal**: Inspect what the app knows about sources, sessions, calibration,
projects, outputs, and unknown material.

**Entry points**: `Library`.

**Inputs and settings**:

- Search query.
- Source filter.
- Type filter.
- Frame type and review-state filters.
- Sort order.

**UI elements**:

- Top search.
- Inventory table.
- Source fold-out.
- Filters.
- Selected item detail panel.
- Row action.

**Data touched**:

- File or folder records.
- Source records.
- Candidate records.
- Review-state values.

**Primary view**: `Library`.

**Result**: User can locate a record and decide whether to review, reconnect,
inspect, classify, or ignore it.

### US-006: Add an Ad Hoc Folder to Queue

**User goal**: Review a folder that is not already covered by a data source.

**Entry points**: `Inbox`, file picker, drag and drop if implemented later.

**Inputs and settings**:

- Folder path.
- Intended queue type if known.
- Destination source if confirmation requires a move.

**UI elements**:

- Add Folder to Queue action.
- Folder picker.
- Queue item row.
- Selected item detail panel.
- Move-plan prompt when needed.

**Data touched**:

- Ad hoc scan record.
- Inbox item.
- Optional filesystem plan.

**Primary view**: `Inbox`.

**Result**: The folder becomes a review item. It does not become immutable source
data until it is in an appropriate source and confirmed.

### US-007: Review an Inbox Item

**User goal**: Resolve a queue item created by scan, marker failure, path
warning, missing source, or ad hoc input.

**Entry points**: `Inbox`.

**Inputs and settings**:

- Queue filter.
- Selected item.
- Decision: confirm, defer, ignore, classify, reconnect, retry, or move through
  a plan.

**UI elements**:

- Queue summary.
- Queue table.
- Selected item details.
- Context actions.
- Bottom logs.

**Data touched**:

- Inbox item.
- Candidate state.
- Warning state.
- Review decision.
- Application log.

**Primary view**: `Inbox`.

**Result**: The item leaves the queue, changes state, or opens the next
contextual workflow.

### US-008: Confirm a Raw Session Candidate

**User goal**: Promote a discovered folder into an immutable acquisition
session.

**Entry points**: `Inbox`, `Library`, target context.

**Inputs and settings**:

- Candidate folder.
- Target hints.
- Equipment and optical train hints.
- Filters.
- Date or date span.
- Capture software.
- Optional observing plan reference.

**UI elements**:

- Candidate detail panel.
- Metadata summary.
- Target selector or alias confirmation.
- Equipment summary.
- Confirm session action.
- Marker write status.

**Data touched**:

- Acquisition Session.
- File set membership.
- Target links.
- Equipment and optical train records.
- Source marker `.astro-library-session.json`.
- Application log.

**Primary view**: `Inbox`, with durable detail available from `Library`.

**Result**: The session becomes immutable source data that projects can reference.

### US-009: Confirm Calibration Frames or Masters

**User goal**: Promote calibration material into reusable records.

**Entry points**: `Inbox`, `Library`, `Settings > Calibration`.

**Inputs and settings**:

- Calibration source.
- Frame kind: dark, flat, dark flat, bias.
- Material kind: frames or masters.
- Setup metadata.
- Reuse scope.

**UI elements**:

- Calibration candidate table.
- Calibration detail panel.
- Setup fingerprint summary.
- Reuse scope selector.
- Confirm action.
- Marker status.

**Data touched**:

- Calibration Session.
- Calibration Master.
- Setup fingerprint.
- Calibration source marker or sidecar marker.
- Application log.

**Primary view**: `Inbox`, with defaults in `Settings > Calibration`.

**Result**: Calibration material becomes independent reusable source data.

### US-010: Repair Metadata

**User goal**: Correct broken or missing metadata while preserving originals.

**Entry points**: Candidate detail, confirmed source detail, `Settings >
Advanced`.

**Inputs and settings**:

- Field corrections.
- Archive location.
- Target source records.
- Plan approval.

**UI elements**:

- Metadata field table.
- Before and after values.
- Filesystem plan review.
- Archive path selector.
- Apply plan action.

**Data touched**:

- Corrected file copies.
- Archived originals.
- Metadata repair lineage.
- Filesystem plan.
- Audit log.

**Primary view**: Contextual detail workflow, with defaults in `Settings >
Advanced`.

**Result**: Active records point to corrected copies and original files remain
tracked.

### US-011: Manage Target Identity and History

**User goal**: Understand all data associated with a target before adding more
work.

**Entry points**: Search, session detail, project creation, target link in
details.

**Inputs and settings**:

- Target name.
- Catalog identifiers.
- Aliases.
- Object type.
- Coordinates.
- Plan reference.
- Notes.

**UI elements**:

- Search result.
- Target detail panel.
- Alias list.
- Session and project lists.
- Output list.
- Plan reference action.

**Data touched**:

- Target.
- Target Alias.
- Observing Plan Reference.
- Linked sessions and projects.
- Notes.

**Primary view**: Contextual detail inside `Library` and `Projects`. No separate
primary nav item in v1.

**Result**: Target identity becomes reusable for classification and project
creation.

### US-012: Create a Project

**User goal**: Create an app-managed project structure for a target or selected
sources.

**Entry points**: `Projects`, target detail, session detail, Library selection.

**Inputs and settings**:

- Project name.
- Workflow: PixInsight, planetary, later Siril.
- Primary target.
- Optional secondary targets.
- Project data source/location.
- Mosaic flag and panels.
- Optional source sessions.
- Optional calibration records.
- Export destination override.

**UI elements**:

- New Project action.
- Project form.
- Target lookup.
- Workflow selector.
- Source selector.
- Structure preview.
- Confirm action.

**Data touched**:

- Project.
- Project Target.
- Project Panel.
- Project Source.
- Workflow Profile.
- Supported project structure.
- `project.json`.

**Primary view**: `Projects`.

**Result**: The project appears in Projects and receives an app-owned envelope.

### US-013: Configure Mosaic Panels

**User goal**: Model panel-specific source and calibration work inside a mosaic.

**Entry points**: Project creation, project detail.

**Inputs and settings**:

- Mosaic flag.
- Panel names or grid positions.
- Panel target relation.
- Panel sessions.
- Panel calibration choices.

**UI elements**:

- Mosaic toggle.
- Panel list or grid.
- Panel detail panel.
- Source mapping per panel.
- Prepared Sources preview.

**Data touched**:

- Project Panel.
- Panel sources.
- Panel calibration choices.
- Panel lifecycle state.

**Primary view**: `Projects`.

**Result**: Each panel can be mapped and prepared independently while the parent
project owns final outputs and lifecycle.

### US-014: Map Project Sources

**User goal**: Decide which confirmed sessions and calibration records belong in
a project.

**Entry points**: Project detail.

**Inputs and settings**:

- Confirmed raw sessions.
- Calibration sets and masters.
- Filters.
- Panels.
- Inclusion reason.
- Override decision.

**UI elements**:

- Source mapping table.
- Source selector.
- Calibration candidate list.
- Selected project detail panel.
- Manifest preview.

**Data touched**:

- Project Source.
- Calibration Match Candidate.
- User decision state.
- Project Manifest checkpoint.

**Primary view**: `Projects`.

**Result**: Project source map is ready for Prepared Sources generation.

### US-015: Generate Prepared Sources

**User goal**: Create tool-readable source inputs without copying large data by
default.

**Entry points**: Project detail.

**Inputs and settings**:

- Approved project source map.
- Workflow profile.
- Platform link capabilities.
- Strategy: manifest-only, symlink, junction, hard link, copy, or hybrid.
- Conflict handling.

**UI elements**:

- Prepare project source views action.
- Strategy comparison.
- Plan preview.
- Conflict list.
- Apply action.

**Data touched**:

- Workflow source view layout.
- App-created links or folders.
- Manifest checkpoint.
- Filesystem plan.
- Audit log.

**Primary view**: `Projects`.

**Result**: The project `sources/` directory contains the approved prepared
layout and is tracked for later cleanup.

### US-016: Generate or Review a Manifest

**User goal**: Create a checkpoint document for project state.

**Entry points**: Project detail, lifecycle transition, cleanup plan apply.

**Inputs and settings**:

- Manifest type or format.
- Project state checkpoint.
- Included sections.

**UI elements**:

- Manifest preview.
- Generate action.
- Export action.
- Version indicator.

**Data touched**:

- Project Manifest.
- Project source map.
- Calibration choices.
- Lifecycle state.
- Cleanup policy.
- Audit references.

**Primary view**: `Projects`.

**Result**: A protected generated artifact exists while the database remains
canonical.

### US-017: Add Notes

**User goal**: Record decisions, observations, and context attached to project
or source records.

**Entry points**: Project detail, session detail, calibration detail, target
detail, plan detail.

**Inputs and settings**:

- Note title.
- Markdown body.
- Linked subject.
- Attached subject.

**UI elements**:

- Notes panel.
- Markdown editor.
- Linked-subject selector.
- Auto-save state.
- Sync status.

**Data touched**:

- Note.
- Note attachment.
- Markdown sync/export.
- Project `notes/` folder when applicable.

**Primary view**: Contextual detail panels.

**Result**: The note is stored in the database and synced to project notes where
appropriate.

### US-018: Observe Processing Artifacts

**User goal**: Register files created by PixInsight or another workflow without
making them canonical app-managed data.

**Entry points**: Project detail, refresh action, optional monitoring.

**Inputs and settings**:

- Project workspace.
- Workflow profile.
- Artifact taxonomy.
- Refresh or monitoring mode.

**UI elements**:

- Refresh artifacts action.
- Artifact list.
- Artifact detail panel.
- Review state.
- Bottom logs.

**Data touched**:

- Processing Artifact.
- Artifact classification.
- Project lifecycle context.
- Application log.

**Primary view**: `Projects`.

**Result**: Tool-created artifacts become visible for lifecycle and cleanup
planning.

### US-019: Record Outputs and Final Verification

**User goal**: Mark final outputs and decide when a project is ready for
archive or cleanup.

**Entry points**: Project detail.

**Inputs and settings**:

- Output file or folder.
- Verification status.
- Processing attempt.
- Final stack or drizzle status.
- Notes.

**UI elements**:

- Outputs list.
- Verification checkbox or state selector.
- Attempt selector.
- Lifecycle stage track.
- Manifest checkpoint action.

**Data touched**:

- Project Output.
- Processing Attempt.
- Lifecycle state.
- Notes.
- Manifest checkpoint.

**Primary view**: `Projects`.

**Result**: Cleanup and archive flows can use verified project state.

### US-020: Configure Cleanup Policy

**User goal**: Set global or project-specific cleanup rules before generating a
plan.

**Entry points**: `Settings > Cleanup & Archive`, project detail.

**Inputs and settings**:

- Inherited global defaults.
- Project override.
- Resource override.
- Artifact category.
- Preferred action: keep, archive, trash, delete when enabled.
- Protection settings.

**UI elements**:

- Cleanup policy tree.
- Inherit, enable, disable, override controls.
- Protected category indicators.
- Auto-save state.

**Data touched**:

- Cleanup Policy.
- Cleanup Tree Node.
- Project policy override.
- Global defaults.

**Primary view**: Settings for global defaults, Projects for project-specific
policy.

**Result**: Cleanup plan generation uses explicit inherited rules.

### US-021: Generate Cleanup or Archive Plan

**User goal**: See exactly what could be archived, trashed, retained, or deleted.

**Entry points**: Project detail, `Settings > Cleanup & Archive` global sweep.

**Inputs and settings**:

- Project or global scope.
- Cleanup policy.
- Verification status.
- Protected categories.
- Destination or trash/archive preference.

**UI elements**:

- Generate plan action.
- Plan item list.
- Tree view.
- Reclaimable size summary.
- Protection and conflict indicators.
- Action selector per item.

**Data touched**:

- Filesystem Plan.
- Plan Item.
- Cleanup candidate.
- Protection status.
- Audit pre-record.

**Primary view**: Project detail for project cleanup, Settings for global sweep.

**Result**: A reviewable plan exists, but no filesystem mutation has happened.

### US-022: Apply a Filesystem Plan

**User goal**: Execute an approved move, link, archive, trash, delete-disabled,
or cleanup plan with audit records.

**Entry points**: Plan review.

**Inputs and settings**:

- Explicit approval.
- Plan item action choices.
- Conflict handling.
- Destination path.
- Permanent delete policy, if enabled.

**UI elements**:

- Approval step.
- Plan apply progress.
- Failure and retry state.
- Audit log link.
- Bottom logs.

**Data touched**:

- Filesystem Plan.
- Plan Item.
- Audit Log Entry.
- Operation State.
- Generated files, links, archive, or trash targets.

**Primary view**: Contextual plan review.

**Result**: Each action is recorded with result or failure details.

### US-023: Remove Generated Project Source Views

**User goal**: Remove app-created source links or generated folders without
touching original data.

**Entry points**: Project detail, cleanup flow.

**Inputs and settings**:

- Workflow source view layout.
- Tracked app-created items.
- Remove strategy.

**UI elements**:

- Remove generated project source views action.
- Generated item list.
- Plan preview.
- Apply action.

**Data touched**:

- Prepared Sources tracking.
- Filesystem Plan.
- Plan Items for app-created links or folders.
- Audit log.

**Primary view**: `Projects`.

**Result**: Generated project-local source artifacts are removed safely.

### US-024: Delete, Ignore, or Archive Data

**User goal**: Get unwanted data out of active workflows without unsafe deletion.

**Entry points**: Inbox item, Library item, project cleanup plan.

**Inputs and settings**:

- Item scope.
- Desired handling: ignore, archive, trash, delete if explicitly enabled.
- Reason or note.
- Policy override if needed.

**UI elements**:

- Item action menu.
- Plan preview for filesystem mutation.
- Confirmation step.
- Audit result.

**Data touched**:

- Review decision.
- Cleanup Policy.
- Filesystem Plan.
- Audit Log Entry.

**Primary view**: Contextual to selected item.

**Result**: Data is ignored or planned for archive/trash/delete with audit
coverage.

### US-025: Review Application Logs

**User goal**: See recent user-facing and technical events while working.

**Entry points**: Bottom log panel on every primary page, `Settings >
Application Log`.

**Inputs and settings**:

- Follow logs.
- Log level.
- User-facing or technical view.
- Export filter.

**UI elements**:

- Full-width bottom fold-out.
- Follow logs checkbox.
- Level selector.
- Structured log list.
- Export action in Settings.

**Data touched**:

- Application Log.
- Operation events.
- Audit references where relevant.

**Primary view**: Bottom log panel and `Settings > Application Log`.

**Result**: The user can monitor current operations without polluting side
details or top-level navigation.

### US-026: Inspect Developer Contract References And Diagnostics

**User goal**: Inspect or export operation contracts for local and future remote
backend paths.

**Entry points**: Developer diagnostics or documentation, not normal Settings.

**Inputs and settings**:

- Contract version.
- Diagnostics scope.

**UI elements**:

- Contract version field.
- Export action.
- Diagnostics action.
- Operation list.

**Data touched**:

- JSON Schema contracts.
- Operation catalog.
- Diagnostics report.

**Primary view**: Developer diagnostics.

**Result**: API contract state can be inspected without confusing product
workflow screens.

## Unified UI Model

### Global Shell

**Purpose**: Keep global navigation small and make search always available.

**Elements**:

- Left navigation: `Inbox`, `Library`, `Projects`, `Settings`.
- Top identity: app name and current page.
- Global search input.
- Theme icon button.
- Main content area.
- Full-width bottom log fold-out on each page.

**Rules**:

- Do not expose `Targets`, `Audit`, `Plans`, `Global Sweep`, `Root Remap`, or
  `Ingest` as primary nav.
- Use contextual entry points instead.
- Avoid secondary explanatory subheaders unless they are needed for form or
  table grouping.

### Catalogue/List Area

**Purpose**: Show the item set for the current workflow.

**Common elements**:

- Table or list.
- Filter selector.
- Row label.
- Type or queue/source.
- Current review state.
- One primary row action.

**Rules**:

- Do not put confidence or evidence in routine rows.
- Put diagnostic evidence inside selected details or advanced views.
- Use stable row structure per page.

### Selected Item Detail Area

**Purpose**: Show selected item details and available actions.

**Common elements**:

- Detail list.
- Context actions.
- Related records when useful.
- No duplicate title/path if already clear in the selected row, unless the row
  is out of view or the detail is opened from search.

**Rules**:

- Details should answer what the user needs to decide next.
- Actions must be specific: `Confirm session`, `Reconnect source`, `Create
  plan`, `Edit project`, `Apply plan`.
- Any filesystem mutation goes through a plan view.

### Bottom Logs

**Purpose**: Monitor operations without competing with the selected item.

**Elements**:

- Full-width `Logs` fold-out.
- Recent event count.
- `Follow logs` checkbox.
- Log level selector.
- Structured event list.

**Rules**:

- Logs are not a side rail mode.
- Logs expand vertically and take app space.
- Detailed historical log browsing belongs in `Settings > Application Log`.

### Inbox Page

**Purpose**: Resolve review work.

**Elements**:

- Queue summary.
- Queue table.
- Selected queue item details/actions.
- Bottom logs.

**Primary workflows**:

- Review scan warnings.
- Confirm candidates.
- Review source warnings.
- Classify unknown material.
- Add Folder to Queue.

### Inventory Page

**Purpose**: Inspect sources and inventory.

**Elements**:

- Add data source.
- Scan.
- Data source fold-out.
- Inventory table.
- Selected item details/actions.
- Bottom logs.

**Primary workflows**:

- Browse inventory.
- Inspect source records.
- Open review work in Inbox.
- Reconnect missing sources.
- Start scans.

### Projects Page

**Purpose**: Create and manage app-owned project work.

**Elements**:

- New project.
- Check folder.
- Lifecycle stage track.
- Project table with row-level primary actions.
- Row overflow menu for less common operations.
- Channel-by-channel acquisition metadata.
- FITS/session detail overlay.
- Bottom logs.

**Primary workflows**:

- Create project.
- Open project.
- Rename project.
- Rescan project observations.
- Map sources.
- Configure mosaic panels.
- Choose calibration.
- Generate Prepared Sources.
- Generate manifests.
- Track outputs.
- Observe artifacts.
- Generate cleanup/archive plans.
- Open project folder.

### Settings Page

**Purpose**: Manage defaults, rules, diagnostics, and global operations.

Settings must not be a static key/value inventory. Each section should expose
only options that affect future scans, source behavior, project generation,
workflow behavior, cleanup planning, diagnostics, or repair workflows. Options
must be editable in place and saved from the current section.

**Internal sections**:

- Data Sources.
- Ingestion & Review.
- Naming & Structure.
- Calibration.
- Tool Workflows.
- Cleanup & Archive.
- Application Log.
- Advanced.

**Rules concept**:

Rules are not one generic settings bucket. They are scoped defaults that affect
future scans, candidates, project creation, and cleanup plans. A rule should
either change classification, naming, source behavior, workflow behavior,
cleanup behavior, diagnostics, or advanced repair behavior. If it does not fit
one of those scopes, it should stay contextual to the selected item instead of
being promoted to Settings.

**Data Sources section**:

Data Sources must show actual configured sources in a table with name, type,
root, state, last scan, scan rule, and action controls. Actions include add,
reconnect, rescan, enable/disable, and remove. Source action overlays must
explain whether the operation changes configuration, starts a scan, or only
creates a reviewed draft.

**Naming and Structure section**:

Naming templates are not a fabricated UI concept. They are required by
FR-044/US6 as configurable naming rules. In UI copy, prefer concrete names such
as project folder pattern, project resources, source mappings, archive location
pattern, and metadata keyword mapping. Do not show a generic "Edit templates"
button without showing the editable fields it changes.

**First-run setup access**:

Settings must include a Restart setup action. This clears the one-time wizard
state and opens the app-level setup wizard again.

## Metadata Coverage Matrix

| Metadata or concept | Primary location | Secondary location |
| --- | --- | --- |
| Data source path/type/settings | Settings > Data Sources | Library source fold-out |
| Source marker status | Inbox item detail | Library selected item |
| Scan settings | Settings > Ingestion & Review | Library scan controls |
| File/folder path, size, timestamps, link status | Library selected item | Inbox warnings |
| Candidate state | Inbox | Settings > Ingestion & Review |
| FITS/XISF/video metadata | Inbox candidate detail | Library selected item |
| Target names, aliases, catalog IDs | Contextual detail/search | Settings > Naming & Structure |
| Observing plan references | Target/session/project details | Library selected item |
| Equipment and optical train | Session candidate detail | Project source mapping |
| Filters, exposure, gain, offset, temperature, binning | Session/calibration detail | Project source mapping |
| Calibration frame kind and material kind | Inbox calibration review | Settings > Calibration |
| Setup fingerprints | Calibration review | Settings > Calibration |
| Calibration match candidates | Project source mapping | Calibration detail |
| Project workflow | Projects | Settings > Tool Workflows |
| Project structure | Projects | Settings > Naming & Structure |
| Mosaic panels | Projects | Project selected detail |
| Prepared Sources | Projects | Manifest checkpoint |
| Processing artifacts | Projects | Cleanup plan detail |
| Outputs and verification | Projects | Cleanup plan detail |
| Notes | Contextual detail | Project notes sync |
| Manifests | Projects | Developer diagnostics for schema/export context |
| Cleanup policies | Settings > Cleanup & Archive | Project detail |
| Cleanup tree nodes | Project cleanup workflow | Settings > Cleanup & Archive |
| Filesystem plans and plan items | Contextual plan review | Application log |
| Audit log entries | Settings > Application Log | Plan apply result |
| API contract version/export | Developer diagnostics | Documentation |
| Metadata repair defaults | Settings > Advanced | Candidate/source detail |

## Candidate Spec Slices

The story inventory can be split into these future specs:

1. First run, data sources, scan, inventory, and Inbox review.
2. Raw session and calibration confirmation.
3. Target identity, aliases, observing-plan references, and notes.
4. Project creation, source mapping, and mosaic panels.
5. Generated project source views and manifest checkpoints.
6. Artifact observation, outputs, lifecycle, cleanup, archive, and audit.
7. Settings, rules, developer diagnostics, logs, and advanced repair.
