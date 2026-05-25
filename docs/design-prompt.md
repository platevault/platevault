# Astro Library Manager — Product-Functional Design Prompt

Use this document to design the complete user interface for Astro Library Manager
from scratch. It describes what the product is, who uses it, what it does, and
how every workflow functions — without prescribing layout, navigation, visual
language, or component choices. You have full creative freedom on information
architecture, page structure, and interaction design.

---

## 1. Product Concept

Astro Library Manager is a local-first desktop application for individual
astrophotographers who maintain large image libraries across local and external
drives. The app organizes, documents, and plans — it never processes images.

**What it does:**

- Indexes existing messy libraries without changing the filesystem
- Extracts metadata from FITS, XISF, and video files to identify sessions,
  equipment, targets, and calibration material
- Groups source data into immutable acquisition sessions and independent
  reusable calibration records
- Creates app-managed processing project envelopes that reference sessions and
  calibration
- Prepares tool-friendly source views (symlinks, junctions, copies, manifests)
  for PixInsight/WBPP, planetary/lunar tools, and future tools like Siril
- Observes processing artifacts without owning them
- Tracks project lifecycle from creation through verification to archive
- Generates reviewable filesystem plans before any move, copy, link, archive,
  trash, or delete
- Records an immutable audit trail of every decision and action
- Recovers from moved drives by remapping library roots

**What it deliberately does NOT do:**

- Calibrate, debayer, register, integrate, drizzle, stack, or edit images (that
  is PixInsight/WBPP/planetary tools' job)
- Require the user to reorganize their library before getting value
- Modify files silently or without explicit user approval
- Sync to cloud or require network access
- Provide a CLI in v1
- Import existing brownfield processing projects as app-managed unless they
  conform to the supported project structure

**Platform:** Windows, macOS, Linux desktop. Windows is a first-class target
because the motivating library lives on `D:\Astrophotography`. Cross-platform
path concerns (case sensitivity, long paths, reserved names, symlinks,
junctions, external drives) are first-class design considerations.

**Scale:** Single-user, local-first. Must handle 100,000+ files in an initial
scan. Large-file hashing is optional/lazy. Long-running operations (scans,
metadata extraction, plan application) must show progress and support
pause/cancel where safe.

---

## 2. Who Uses This

Individual astrophotographers managing large local libraries. They work at a
desk alongside:

- Filesystem tools (Explorer, Finder)
- Capture software exports (NINA, SharpCap, ASIStudio)
- Processing tools (PixInsight/WBPP for deep-sky; stacking/sharpening tools for
  planetary/lunar)
- External and removable drives

They are technically proficient, accustomed to dense information displays, and
care deeply about data safety. They have years of accumulated data organized in
personal conventions that may not match any standard.

---

## 3. Design Principles

1. **Make source truth visible.** Separate what the app observed on disk, what
   it inferred from metadata, what the user reviewed and confirmed, what the app
   generated as a projection, and what is planned but not yet applied. These are
   different categories of truth and the user must be able to distinguish them.

2. **Put safety before speed.** Every filesystem mutation — move, copy, link,
   archive, trash, delete — must feel deliberate. The user must see exactly what
   will happen, approve it, and be able to inspect the result afterward. Never
   make destructive actions feel casual.

3. **Keep lifecycle contextual.** Project and target lifecycle belong in the
   context of the project or target being worked on. A global cleanup/archive
   sweep surface exists but as a settings-level tool, not a primary destination.

4. **Support expert density without visual noise.** These users scan, compare,
   filter, and repeatedly review data. Prioritize information density, scannable
   tables, and efficient repeated-use workflows over pretty presentation.

5. **Stay tool-agnostic.** PixInsight, planetary/lunar tools, and future
   workflows are selectable profiles. Nothing in the interface should assume a
   single processing tool.

**Brand personality:** Precise, calm, technical, safety-first. Feel like an
expert workbench for source-of-truth decisions.

**Anti-references:** Avoid marketing-style SaaS dashboards, decorative identical
card grids, dark blue admin templates, flashy astronomy theming, gradient hero
treatments, and interfaces that make filesystem risk feel casual. Do not bury
destructive or cleanup-related decisions behind vague controls.

---

## 4. Accessibility Requirements

- Target WCAG AA compliance
- Keyboard-first navigation for all review workflows
- Visible focus states
- Reduced-motion support
- Semantic status and error messaging
- Clear differentiation that does not rely on color alone (use shape, text,
  position in addition to color)

---

## 5. Domain Concepts

These are the things the user works with. Design the interface around these
concepts and their relationships.

### Library Roots

A library root is a user-registered filesystem path such as
`D:\Astrophotography\Raw` or `/Volumes/AstroData/Masters`. The user may have
several roots across local disks, external drives, and network shares. Each root
can become unavailable (drive unplugged, mount moved) and must be recoverable
through a remapping workflow that verifies sample files before updating paths.

Roots have scan settings: whether to follow symlinks/junctions (default: no),
hashing mode (default: lazy/none), include/exclude patterns, protected folder
patterns, and metadata extraction depth.

### File Records

Every discovered file, directory, symlink, junction, or mount point becomes a
file record. Records track: root-relative path, file kind (FITS, XISF, video,
image, sidecar, project file, plan file, directory, unknown), size, timestamps,
link target if applicable, optional content hash, metadata extraction status,
current classification, and protection status.

File records have an inventory lifecycle:
`observed → classified → confirmed/rejected/ignored` with transitions through
`changed` (when re-scanned with differences) and `missing` (when no longer found
on disk). Any state can be pinned as `protected`.

### Metadata

Metadata is extracted from FITS headers, XISF properties, sidecar files, path
patterns, user corrections, and tool observations. Raw values are always
preserved alongside normalized values. Key extracted fields include:

- Date/time (DATE-OBS, TIME-OBS)
- Exposure duration (EXPTIME)
- Frame type (IMAGETYP: light, dark, flat, bias, dark flat)
- Filter name (FILTER)
- Camera/instrument (INSTRUME)
- Telescope (TELESCOP)
- Focal length, binning, gain, offset
- Sensor temperature (CCD-TEMP, SET-TEMP)
- Object name (OBJECT — used as target search hint)
- Observer location and timezone
- Pier side, rotation angle, bayer pattern
- Image dimensions

Every extracted value carries a confidence level and evidence reference. Missing
or conflicting metadata keeps items reviewable rather than silently assigning
high-confidence values.

### Classification

Each file record receives a classification: raw light, calibration dark,
calibration bias, calibration flat, calibration dark flat, calibration master,
project-like material, app-managed project, final output, processing artifact,
source view, manifest, note, or unknown. Classifications carry confidence levels
(`unknown`, `low`, `medium`, `high`, `confirmed`, `rejected`) with evidence
references and review state (`unreviewed`, `confirmed`, `corrected`, `rejected`,
`ignored`).

### Targets

A target is an astronomical, planetary, lunar, solar, or landscape subject. It
has a primary name, aliases (for matching inconsistent naming in metadata and
folders), optional catalog identifiers (NGC, IC, Messier, etc.), optional
coordinates, and a kind (deep sky, mosaic, planetary, lunar, solar, landscape).

Targets aggregate: linked acquisition sessions, linked projects, project
outputs, notes, and observing plan references (NINA plans, SharpCap plans).
The target view lets the user see what data they already have for a subject
before creating a new session or project.

The app uses the FITS `OBJECT` keyword as a target search hint but requires user
review before assigning ambiguous or unresolved targets.

### Acquisition Sessions

An acquisition session is an immutable grouping of light frames (or related raw
material) that share a metadata-derived session key. The session key is computed
from target, filter, binning, gain, and observing night (local solar noon
boundary).

Sessions are **immutable source records** after confirmation. Corrections create
reviewed metadata updates or relationship changes — they never silently rewrite
the source identity. Sessions can be linked to zero or more targets and are
independent from processing projects (one session can be used by multiple
projects).

Session lifecycle: `discovered → candidate → needs_review → confirmed` (with
`rejected` and `ignored` as alternatives). Confirmed sessions are soft-terminal
but can be re-opened to `needs_review`.

Certain transitions require reviewed provenance — for example, confirming a
session requires that `observer_location` has been reviewed (not just inferred).
When extraction fails for required fields, the session auto-transitions to
`needs_review`.

### Calibration Sessions

Independent groupings of calibration frames (darks, flats, biases, dark flats)
sharing equipment and exposure metadata. Same lifecycle as acquisition sessions.
Calibration sessions are independent from targets, object folders, and
acquisition sessions — they can serve multiple sessions or projects when matching
criteria support reuse.

### Calibration Masters

Reusable master calibration artifacts (master dark, master flat, master bias,
master dark flat, bad pixel map) with provenance tracking back to their source
calibration session. The app tracks masters but does NOT produce them — that's
PixInsight's job. Masters have a compatibility fingerprint for matching against
acquisition sessions.

### Calibration Matching

The app generates candidate matches between acquisition sessions and compatible
calibration sessions or masters. Each candidate has:
- A weighted score and confidence level
- Hard mismatches (camera, sensor mode, binning, filter for flats, frame type)
  that block matching
- Soft mismatches (temperature, exposure, gain, offset, night, optical train,
  focus, dust state) that reduce confidence
- Match reasons (explanations for the score)
- A user decision: undecided, accepted, rejected, or overridden

Accepted candidates become project source records. The user always sees why a
match was proposed and can override it.

### Equipment and Optical Trains

Equipment records track cameras, telescopes, lenses, reducers, rotators,
focusers, filter wheels, filters, mounts, sites, capture software, and
processing software. Each has aliases for matching inconsistent metadata.

An optical train is a named combination of equipment (camera + telescope +
filter wheel + reducer + focuser + site) with a setup fingerprint used for
session identification and calibration matching.

### Workflow Profiles

A workflow profile defines processing tool expectations: source view defaults,
artifact classification rules, cleanup policy templates, and lifecycle hints.
Initial profiles: PixInsight/WBPP (deep-sky) and planetary/lunar common. The
model is extensible for future tools like Siril.

### Projects

A project is an app-managed processing envelope. It has:

- A display name and key
- A selected workflow profile (PixInsight, planetary, etc.)
- A project root on disk with a supported structure the app creates and owns
- A lifecycle state, verification state, cleanup state, and archive state
- Linked targets (primary, secondary, panel targets, references)
- Mapped sources: selected acquisition sessions, calibration sessions/masters,
  with roles (light, dark, flat, bias, master, etc.) and selection state
  (candidate, selected, rejected, superseded)
- Mosaic panel definitions (for multi-panel targets)
- Processing attempts
- Observed processing artifacts
- Recorded outputs with verification state
- Source views (tool-friendly projections)
- Cleanup policy (inherited from global, overridable per-project and per-resource)
- Generated manifests (JSON, JSONL, Markdown — protected documentation)

**Project structure on disk** (created by the app):
```
{project_name}/
  .alm/                    (app-owned config and metadata)
    project.json
    manifests/
    artifact-registry/
    audit-refs/
  sources/
    manifests/
    views/                 (generated source views go here)
  processing/              (tool-managed, observed by app)
    pixinsight/
    planetary/
  outputs/
    final/
    review/
  notes/
  archive/
```

Existing brownfield processing folders that don't match this structure are
classified as "project-like material" — visible but not app-managed.

**Project lifecycle:**
```
setup_incomplete → ready → prepared → processing → completed → archived
                                                             → blocked (with reason)
```
- `ready` requires at least one linked acquisition session
- `prepared → processing` means tool-friendly source views are generated
- `completed → archived` always requires a filesystem plan (at minimum a
  manifest write)
- Any state before `archived` can return to earlier states when sources or
  outputs are revised
- `archived` can be re-opened to `processing` or `ready` (unarchive)
- `blocked` is an escape hatch with a required reason; can recover to any prior
  state or archive

### Source Maps

A project's source map documents exactly which acquisition sessions, calibration
sessions, and calibration masters are selected for the project, with roles and
reasons. For mosaics, source mapping is per-panel.

### Source Views

A source view is a project-local tool-friendly projection of the source map. It
makes source data accessible to processing tools without copying large files by
default. Strategies include:

- **Manifest-only**: Write a manifest file listing source paths
- **Symlink**: Create symbolic links to source files
- **Junction**: Create NTFS junctions (Windows)
- **Hard link**: Create hard links
- **Copy**: Copy files (last resort for large data)
- **Hybrid**: Mix strategies based on platform constraints

The app shows all proposed links, folders, and manifests before creating
anything. Generated items are tracked for safe cleanup later. When a preferred
strategy is unavailable on the platform, the app recommends a fallback and
explains the tradeoff.

### Processing Artifacts

After the user runs PixInsight or another tool, the app observes the processing
workspace and registers discovered files and directories as processing artifacts.
Types include: registered frames, calibrated frames, debayered, local normalized,
drizzle data, integration cache, temporary files, logs, process icons, tool
project files, and manual notes.

These artifacts are **observed, not owned** — the app never modifies their
content. They carry classification confidence, cleanup eligibility, and
protection reasons. Artifacts can become stale when source data changes.

### Project Outputs

Final or intermediate results recorded after processing: final image, final
stack, drizzle result, published export, preview, rejected. Outputs carry
verification state (unreviewed, accepted, rejected, superseded) and are
protected from cleanup by default.

### Cleanup Policies

Cleanup policies control what can be removed or archived. They form an
inheritance tree:

```
Global defaults
  → Project-level overrides
    → Resource-level overrides (per directory, subdirectory, artifact group,
      artifact type, individual file)
```

Each node in the tree can: inherit from parent, enable cleanup, disable cleanup,
or override with a specific action (keep, archive, trash, delete). Permanent
delete is disabled by default and requires explicit policy enablement.

**Protected by default** (cannot be cleaned up without explicit override):
- Original source files (lights, raw data)
- Calibration masters
- Final outputs
- Project manifests
- User notes
- Audit records
- App configuration
- User-configured protected folders

**Cleanup candidates** (eligible after verification):
- PixInsight intermediates (registered, calibrated, debayered, normalized)
- Drizzle data
- Integration caches
- Temporary files
- Retired source views
- Processing logs

The user configures cleanup as a nested tree where they can check/uncheck
directories, subdirectories, resources, and artifact types at every level.

### Filesystem Plans

**This is the core safety mechanism.** Every filesystem mutation in the app goes
through a reviewable plan before anything touches disk.

Plan kinds: project structure creation, source view generation, source view
removal, archive, cleanup, root remapping, manifest generation.

Each plan contains items specifying: action (mkdir, move, copy, link, junction,
hard link, write manifest, archive, trash, delete, remove generated link),
source and destination paths, preconditions (source exists, destination missing,
root available, generated by app), conflict policy (fail if exists, rename with
suffix, skip, manual resolution required), protection status, and dry-run result.

**Plan lifecycle:**
```
draft → ready_for_review → approved → applying → applied
                                               → partially_applied
                                               → failed
                                               → paused (on volume unavailable,
                                                 disk full, or stale item)
```
Plans can be discarded from draft or ready states. Paused plans can resume or
cancel. Failed plans are terminal — retry creates a new plan. Every plan item
records its apply status: pending, applied, failed, skipped, or rolled back.

Approval requires explicit user action. Plans that include permanent delete
require a separate explicit approval flag. Every plan creation, approval,
application, item result, and failure generates an audit log entry.

### Audit Log

An immutable, append-only record of every significant action:
- Plan created, approved, applied
- Individual plan items applied, failed, skipped
- Root remapped
- Manifest generated
- Source view generated
- Classification decisions
- Lifecycle transitions (including refused ones — logged with `outcome: refused`)
- Cleanup decisions

Each entry records: entity type and ID, from/to state, trigger action, actor
(user or system), outcome (applied, refused, failed), timestamp, and structured
details. System actor is only used for edges entering/leaving the `blocked`
state. No-op transitions (same state) produce no audit row.

The audit log is queryable by entity, date range, event type, and outcome.

---

## 6. Entity Relationships

```
LibraryRoot
  └── has many FileRecord
        ├── has many MetadataEntry (extracted fields with confidence)
        ├── classified as ClassificationAssignment
        └── may link to: ProcessingArtifact, ProjectOutput, CalibrationMaster,
            SourceViewItem, ObservingPlanReference

Target
  ├── has many TargetAlias
  ├── has many AcquisitionSession (through AcquisitionSessionTarget)
  ├── has many Project (through ProjectTarget)
  ├── has many ProjectOutput
  └── has many ObservingPlanReference

AcquisitionSession
  ├── has many FileSet (grouped lights)
  ├── has many AcquisitionSessionTarget (target links)
  ├── has many CalibrationMatchCandidate
  ├── has many ProjectSource (used by projects)
  └── has many ObservingPlanReference

CalibrationSession
  ├── has many FileSet (grouped calibration frames)
  ├── produces many CalibrationMaster
  └── has many CalibrationMatchCandidate

CalibrationMaster
  ├── linked to one CalibrationSession
  └── has many CalibrationMatchCandidate

Project
  ├── has many ProjectTarget (linked targets)
  ├── has many ProjectSource (mapped sessions + calibration)
  ├── has many ProjectPanel (mosaic panels)
  ├── has many ProcessingAttempt
  ├── has many ProcessingArtifact (observed)
  ├── has many ProjectOutput (final results)
  ├── has many SourceView (tool-friendly projections)
  ├── has one CleanupPolicy (inherited + overrides)
  ├── has many ProjectManifest (generated docs)
  └── generates FilesystemPlan for mutations

FilesystemPlan
  ├── has many PlanItem (individual actions)
  ├── has many PlanApproval
  └── generates many AuditLogEntry

CleanupPolicy (tree inheritance)
  └── has many CleanupTreeNode (directory/resource/type tree)

Equipment → grouped into OpticalTrain (named configurations)
WorkflowProfile → selected by Project (tool expectations)
```

---

## 7. Provenance and Confidence

Every metadata value and inferred relationship carries provenance tracking:

**Provenance origins** (in priority order):
1. `reviewed` — user confirmed or corrected (highest trust)
2. `inferred` — derived from other values (e.g., timezone from coordinates)
3. `observed` — extracted directly from file metadata
4. `generated` — recomputed from source changes
5. `planned` — staged in a filesystem plan, not yet applied
6. `applied` — result of an executed plan

Each field maintains a history of values with their origins. User corrections
create new `reviewed` entries without erasing prior observations. The interface
should make provenance visible — users need to understand why a value is what it
is and how confident they should be in it.

**Confidence levels:** `unknown` → `low` → `medium` → `high` → `confirmed` / `rejected`

**Review states:** `unreviewed` → `confirmed` / `corrected` / `rejected` / `ignored`

Some lifecycle transitions are **action-gated** by provenance: for example, an
acquisition session cannot be confirmed until its observer location has been
reviewed (not just observed or inferred). When required fields lack reviewed
provenance, the transition is blocked and the user is told which fields need
review.

---

## 8. Functional Workflows

### 8.1 First Run

1. User launches the app for the first time
2. App presents setup for selecting initial data sources by category:
   - Raw sources (where light frames live) — required
   - Calibration sources (where darks, flats, biases live) — optional
   - Project sources (where processing projects live) — required
   - Inbox sources (folders for new/unprocessed data) — optional
3. For each source, user selects a directory using native OS file picker
4. User configures scan settings: follow links (default off), hashing mode
   (default lazy/none), include/exclude patterns
5. App registers roots and starts a read-only scan after explicit confirmation
6. User sees scan progress with file counts, warnings, and path issues
7. Setup is restartable from settings (prefills existing sources)

### 8.2 Scan and Classify

1. Scanner records files, directories, links, sizes, timestamps, and
   root-relative paths without modifying anything
2. Classifier assigns confidence-rated categories: raw lights, calibration
   frames, project-like material, outputs, unknown
3. Results appear in a review queue showing: item type, source, review state,
   confidence, warnings
4. User reviews unknowns, low-confidence items, project-like material, link
   warnings
5. User confirms, corrects, rejects, or ignores classifications
6. Corrections are stored as rules or reviewed classifications that improve
   future scans

**Mixed folder handling:** When a folder contains multiple frame types (lights
mixed with darks, etc.), the app detects this and presents a split plan showing
per-type counts, sample filenames, and destination previews. The user reviews and
approves the split before anything moves.

### 8.3 Ingest Acquisition and Calibration Data

1. User selects discovered folders/files or chooses an ingest source
2. App extracts FITS/XISF/video/sidecar metadata where possible
3. App groups candidates into acquisition sessions and calibration sessions
   based on session key (target + filter + binning + gain + observing night)
4. For each candidate session, the app shows: grouped frames, metadata summary,
   equipment hints, target hints, confidence level, setup fingerprint
5. User confirms, corrects (target assignment, equipment, split/merge sessions),
   rejects, or defers candidates
6. Calibration matching runs: the app evaluates compatibility between
   acquisition sessions and calibration sessions/masters, generating candidate
   matches with scores, confidence, hard/soft mismatches, and explanations
7. User reviews calibration candidates and accepts, rejects, or overrides

### 8.4 Target Management

1. User searches existing targets or creates a new one
2. Target view shows: primary name, aliases, catalog IDs, coordinates, kind
3. Linked data: all acquisition sessions for this target, all projects, outputs
   across projects, processing history, notes
4. User manages aliases (for matching inconsistent metadata naming)
5. User links observing plan artifacts (NINA files, etc.) as references
6. User can start session or project creation from target context, which
   pre-populates target metadata for review

### 8.5 Project Creation and Source Mapping

1. User creates a project from target context, selected sessions, or library
   context
2. User provides project name and selects workflow profile (PixInsight/WBPP,
   planetary/lunar)
3. App generates a filesystem plan for creating the project structure
4. User reviews the plan (directories to create, config files to write) and
   approves
5. App applies the plan and creates the project record
6. User maps sources: selects acquisition sessions (lights), calibration
   sessions/masters (darks, flats, biases), with roles
7. For mosaics: user defines panels and maps sources per panel
8. Calibration match candidates are shown with scores and reasons — user
   accepts/rejects/overrides
9. App generates project manifest from the source map
10. User can preview the manifest before it's written

### 8.6 Source View Preparation

1. User opens source view preparation for a project with an approved source map
2. App compares available strategies (manifest-only, symlink, junction, hard
   link, copy, hybrid) based on platform and workflow profile
3. App recommends a strategy and explains tradeoffs (disk usage, portability,
   tool compatibility, safety)
4. User selects strategy and reviews the generated plan: every proposed link,
   folder, manifest, and copy
5. User approves and app applies the plan
6. Generated items are tracked for safe cleanup later
7. If the user wants to remove a source view later, the app identifies only
   app-created items for safe removal

### 8.7 Lifecycle, Outputs, and Verification

1. User processes data in PixInsight/planetary tool (outside this app)
2. On app refresh/startup (or optional folder monitoring), the app observes the
   processing workspace and registers discovered artifacts
3. Artifacts are classified by type (registered frames, calibrated, drizzle,
   integration cache, logs, process icons, temporary files, etc.) with
   confidence
4. User records final outputs and marks verification state (accepted, rejected,
   superseded)
5. Project lifecycle advances: processing → completed after outputs are recorded
   and verified
6. User can record multiple processing attempts with notes

### 8.8 Cleanup and Archive Planning

1. User opens cleanup configuration for a project (or global cleanup settings)
2. App presents a nested tree showing: project directories, subdirectories,
   resources, artifact groups, artifact types
3. Each node shows: inherited policy, effective action (keep/archive/trash/
   delete), estimated size, protection status and reason
4. User adjusts tree: enables/disables cleanup at any level, overrides inherited
   policy
5. App generates a cleanup or archive plan with estimated reclaimable space
6. Plan shows every item: what will be moved/trashed/deleted, from where to
   where, protection status, preconditions, conflict policy
7. User reviews and approves the plan (permanent delete requires separate
   explicit approval)
8. App applies the plan with progress, recording each item's result
9. If items fail (disk full, volume unavailable, stale state), the plan pauses
   — user can resume or cancel
10. Full audit trail records every action and result

### 8.9 Settings and Root Recovery

**Settings areas:**

- **Data Sources**: Registered roots with add/remove/reconnect. Reconnect
  handles missing drives with verification.
- **Ingestion & Review**: Scan defaults, candidate settings, review queue
  preferences
- **Naming & Structure**: Token-based naming templates for projects and folders,
  per-frame-type overrides
- **Calibration**: Matching rules per frame type with numeric tolerances
- **Tool Workflows**: Processing tool executable paths, workflow profile
  management
- **Catalogs**: Target catalog download (OpenNGC), target lookup behavior
- **Source Protection**: Protected category defaults (multiselect)
- **Cleanup & Archive**: Global cleanup policy tree, archive/trash defaults,
  permanent delete policy, verification requirements
- **Application Log**: Structured chronological log with filtering by level,
  entity, and event type; expandable detail
- **Appearance**: Light/dark mode
- **Advanced/Developer**: Diagnostics, contract export (dev-only)

**Root recovery workflow:**
1. App detects a root is unavailable (drive unplugged, mount changed)
2. User selects "reconnect" and provides the new path
3. App verifies sample file records against the new path before updating
4. Relationships, projects, and audit history are preserved

---

## 9. Operations the App Supports

These are the actions the backend can perform, grouped by domain. The UI must
provide surfaces for initiating, monitoring, and reviewing the results of each.

**Library & Inventory:**
- Register a library root
- Plan and apply root remapping
- Start a read-only scan (long-running, shows progress)
- Query inventory with filters, pagination, sort

**Metadata & Classification:**
- Start metadata extraction (long-running)
- Review and update classifications
- Update classification rules and templates

**Targets & Sessions:**
- Create, query, and manage targets
- Create acquisition session candidates from file sets
- Review acquisition sessions (confirm, correct, reject)
- Create calibration session candidates
- Start calibration matching (long-running, generates candidates)
- Review calibration match candidates

**Projects:**
- Generate project structure creation plan
- Create project from applied plan
- Check structure conformance for import
- Update project source map
- Update project lifecycle state

**Source Views & Manifests:**
- Generate source view plan
- Generate source view removal plan
- Generate manifest plan
- Preview manifest content

**Processing Artifacts & Cleanup:**
- Start artifact observation (long-running)
- Update cleanup policy
- Preview cleanup tree (effective values at every node)
- Generate cleanup plan
- Generate archive plan

**Plans & Audit:**
- Preview a plan (details, conflicts, protected items, estimates)
- Approve a plan
- Apply a plan (long-running, shows per-item progress)
- Query audit log

**Settings:**
- Get and update settings by scope

**Long-running operations** produce an operation handle and emit progress events:
discovered item batches, extracted metadata batches, candidate batches, observed
artifact batches, individual plan item results, warnings, and completion/failure.

---

## 10. Safety and Trust Patterns

These patterns must be reflected in the design. They are not optional.

1. **Plan-review-approve-apply**: Every filesystem change is staged as a plan,
   reviewed by the user, explicitly approved, then applied with per-item
   progress and audit. No silent mutations.

2. **No silent overwrites**: If a destination already exists, the plan item
   specifies a conflict policy (fail, rename, skip, or manual resolution). The
   user sees this before approval.

3. **Destructive actions prefer safety**: Archive and trash are preferred over
   permanent delete. Permanent delete is disabled by default and requires both
   policy enablement and explicit approval.

4. **Protected categories**: Original sources, calibration masters, final
   outputs, manifests, notes, and audit records are protected from cleanup by
   default. The user must see which items are protected and why.

5. **Confidence and evidence**: Every inferred classification, calibration match,
   and cleanup candidate carries a confidence score and explainable evidence. The
   user must be able to see why the app thinks something is what it says it is.

6. **Provenance visibility**: Every metadata value shows where it came from
   (observed from file, inferred, user-reviewed, generated, planned, applied)
   and its history. User corrections don't erase prior values.

7. **Immutable source records**: Acquisition sessions and calibration sessions
   are immutable after confirmation. Corrections create new reviewed records, not
   rewrites of history.

8. **Action-gated transitions**: Some lifecycle transitions require specific
   fields to have reviewed provenance. The app blocks the transition and tells
   the user which fields need review.

9. **Audit everything**: Every plan, approval, application, success, failure,
   refused transition, and classification decision is permanently recorded.

10. **Operation visibility**: Long-running operations (scans, extractions,
    matching, plan application) show progress, support pause/cancel where safe,
    and recover gracefully from crashes.

---

## 11. State Machines

### Project Lifecycle (7 states)

```
setup_incomplete ──→ ready ──→ prepared ──→ processing ──→ completed ──→ archived
                  │                                     │
                  └─────────────── blocked ─────────────┘
```

- `setup_incomplete → ready`: requires at least one linked acquisition session
- `ready → prepared`: requires filesystem plan for source view generation
- `prepared → ready`: requires plan for retiring source views
- `processing → completed`: outputs recorded and verified
- `completed → archived`: always requires a plan (at minimum manifest write)
- `blocked`: escape hatch from any non-archived state, requires reason
- `archived → processing` or `archived → ready`: unarchive with plan when
  content moves

### Filesystem Plan Lifecycle (10 states)

```
draft ──→ ready_for_review ──→ approved ──→ applying ──→ applied
      │                    │                          ├──→ partially_applied
      │                    │                          ├──→ failed
      │                    └──→ draft (changes)       └──→ paused
      └──→ discarded

paused ──→ applying (resume) / cancelled
```

Terminal: applied, partially_applied, failed, cancelled, discarded.
Retry creates a new plan.

### Session Lifecycle (6 states)

```
discovered ──→ candidate ──→ needs_review ──→ confirmed
           ├─→ ignored       └──→ rejected
```

Confirmed and rejected are soft-terminal (can re-open to needs_review).
Ignored can return to candidate.

### Inventory State (6 states)

```
observed ──→ classified ──→ confirmed / rejected / ignored
         ├──→ changed (re-scan found differences)
         ├──→ missing (no longer on disk)
         └──→ protected (sticky pin from any state)
```

---

## 12. Key Data Displayed per Context

**When viewing a file record:** path, file kind, size, timestamps, classification
(with confidence and evidence), review state, metadata entries (raw + normalized),
protection status, linked sessions/artifacts/outputs, link target if applicable.

**When viewing an acquisition session:** session key, capture dates, night key,
source location, optical train, equipment, setup fingerprint, frame count and
total size, confidence, review state, linked targets, linked projects, metadata
summary, observer location with provenance.

**When viewing a calibration session:** same as acquisition plus calibration kind
(dark/flat/bias/dark flat), temperature, gain, offset, binning, filter, exposure.

**When viewing a calibration match candidate:** acquisition session, calibration
source, score, confidence, hard mismatches (blocking), soft mismatches (reducing),
match reasons, user decision.

**When viewing a target:** primary name, aliases, catalog IDs, kind, coordinates,
linked sessions (with dates and data coverage), linked projects (with lifecycle
state), outputs, notes, plan references.

**When viewing a project:** display name, workflow profile, lifecycle state,
verification state, cleanup state, archive state, linked targets, source map
(sessions + calibration + panels), source views (strategy and status), processing
attempts, observed artifacts (by type), outputs (with verification), cleanup
policy tree, manifests, notes, audit history.

**When viewing a filesystem plan:** plan kind, status, summary, item count,
estimated reclaimable bytes, creation/approval/application timestamps. Per item:
action, source path, destination path, preconditions, conflict policy, protection
status, dry-run result, apply status, failure message if any.

**When viewing a cleanup tree:** nested hierarchy of directories/resources/types.
Per node: display name, inherited vs. overridden policy, effective action, size,
protection status and reason.

**When viewing the audit log:** timestamp, event type, entity type and ID,
from/to state, trigger action, actor, outcome, structured details.

**When viewing a long-running operation:** operation type, status, progress
(current/total with percentage), current item being processed, elapsed time,
warnings and errors encountered.
