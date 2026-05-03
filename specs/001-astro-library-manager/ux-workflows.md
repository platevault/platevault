# UX Workflow Outline

## First Run and Root Selection

Goal: Register one or more library roots without mutation.

Flow:
1. User selects a root such as `D:\Astrophotography`.
2. App shows scan settings: follow links off by default, hashing lazy/disabled,
   include/exclude patterns, protected folder hints.
3. App registers the root and starts a read-only scan only after confirmation.
4. App shows progress, unavailable root warnings, path warnings, and unknowns.

Primary screens:
- Root picker
- Scan settings panel
- Inventory dashboard
- Scan progress drawer

## Initial Scan and Classification

Goal: Turn a messy library into a reviewable inventory.

Flow:
1. Scanner records files, directories, links, sizes, timestamps, and root-relative
   paths.
2. Classifier assigns low/medium/high confidence categories.
3. User reviews unknowns, low-confidence folders, project-like material, and link
   warnings.
4. App stores corrections as rules or reviewed classifications.

Primary screens:
- Inventory dashboard
- Classification review queue
- File/folder detail drawer

## Acquisition and Calibration Ingest

Goal: Create immutable acquisition session candidates and independent reusable
calibration records.

Flow:
1. User selects discovered folders/files or chooses an ingest source.
2. App extracts FITS/XISF/video/sidecar metadata where possible.
3. App groups candidates into acquisition sessions, calibration sessions,
   masters, targets, equipment, and setup fingerprints.
4. User confirms, corrects, splits, merges, rejects, or defers candidates.
5. Calibration matching runs as candidate generation, not automatic final choice.

Primary screens:
- Ingest queue
- Metadata review
- Session grouping review
- Calibration candidate review

## Target Management

Goal: See what data exists per target before creating new sessions or projects.

Flow:
1. User searches or creates a target.
2. App shows aliases, catalog IDs, sessions, filters, calibration context,
   projects, outputs, notes, and plan references.
3. User confirms aliases and links plan artifacts such as NINA files.
4. User starts session or project creation from the target context.

Primary screens:
- Target catalog
- Target detail
- Alias review
- Plan reference drawer

## Project Creation and Source Mapping

Goal: Create an app-owned project envelope and documented source map.

Flow:
1. User creates project from target, selected sessions, or library context.
2. User selects workflow profile: PixInsight/WBPP or planetary/lunar common.
3. App generates a project structure plan.
4. User reviews and applies the plan.
5. User maps acquisition sessions, calibration sessions/masters, panels, filters,
   attempts, and reasons.
6. App previews generated project manifest from database state.

Primary screens:
- Project creation wizard
- Workflow profile selector
- Filesystem plan review
- Project source map editor
- Manifest preview

## Source View Preparation

Goal: Prepare tool-friendly source views without copying large data by default.

Flow:
1. User opens source view preparation for an approved project map.
2. App compares manifest-only, symlink, junction, hard link, copy, and hybrid
   strategies based on platform and workflow profile.
3. User reviews generated plan including links, folders, manifests, and conflicts.
4. App applies approved plan and tracks generated items for later cleanup.

Primary screens:
- Source view strategy comparison
- Source view plan review
- Generated source view status

## Lifecycle, Outputs, Archive, and Cleanup

Goal: Reclaim disk safely after final verification.

Flow:
1. User records final outputs and marks verification state.
2. App observes processing workspace on refresh/startup or optional monitoring.
3. App registers PixInsight/tool artifacts without treating them as canonical.
4. User opens cleanup policy tree with inherited global/project/resource rules.
5. User checks/unchecks directories, subdirectories, resources, and artifact
   types.
6. App generates archive/trash/delete-disabled plan with protected categories.
7. User approves and applies plan; audit history records each item.

Primary screens:
- Project lifecycle dashboard
- Output verification panel
- Artifact observation view
- Nested cleanup policy tree
- Plan review and apply progress
- Audit history

## Settings, Rules, and Root Recovery

Goal: Support user conventions and moved drives.

Flow:
1. User configures naming templates, classification rules, protected folders,
   retention policy, aliases, taxonomy, and metadata keyword maps.
2. User remaps a missing root to a new path.
3. App verifies sample records before updating root path mapping.
4. App preserves relationships and audit history.

Primary screens:
- Settings/rules
- Protected folders
- Naming templates
- Root recovery wizard
