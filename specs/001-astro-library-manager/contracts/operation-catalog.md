# Operation Catalog Draft

This catalog names the first contract operations. Payload schemas will be
generated as JSON Schema files during implementation. The operation IDs are
transport-neutral and can be carried by Tauri, HTTP, or another service adapter.

## Library Roots and Inventory

### `library.root.register`

- Type: plan-generating or direct metadata mutation only
- Request: root display name, absolute path, scan settings
- Response: `LibraryRoot`
- Notes: Does not move or modify files.

### `library.root.remap.plan`

- Type: plan-generating
- Request: root ID, proposed new path, verification options
- Response: `FilesystemPlan`
- Notes: Verifies sample paths before approval.

### `library.scan.start`

- Type: long-running read-only
- Request: root IDs, scan settings override, include/exclude scope
- Response: `OperationHandle`
- Events: progress, discovered item batch, warning, completed, failed
- Notes: Does not follow links unless explicitly requested.

### `library.inventory.query`

- Type: read-only
- Request: filters, pagination, sort, classification state
- Response: inventory page

## Metadata and Classification

### `metadata.extract.start`

- Type: long-running read-only
- Request: file record IDs or root/session scope, extraction mode
- Response: `OperationHandle`
- Events: progress, extracted metadata batch, failed file batch

### `classification.review.update`

- Type: database mutation
- Request: classification ID, decision, corrected category, note
- Response: updated classification summary
- Notes: Records audit entry for review decisions.

### `rules.update`

- Type: database mutation
- Request: rule/template kind, definition, scope, enabled state
- Response: updated rule

## Targets and Sessions

### `target.create`

- Type: database mutation
- Request: primary name, target kind, aliases, catalog IDs, notes
- Response: `Target`

### `target.query`

- Type: read-only
- Request: text, kind, alias/catalog filters
- Response: target list with coverage summaries

### `session.acquisition.candidate.create`

- Type: database mutation
- Request: selected file sets, target hints, equipment hints
- Response: acquisition session candidate

### `session.acquisition.review.update`

- Type: database mutation
- Request: session ID, review decision, target links, notes
- Response: reviewed session

### `session.calibration.candidate.create`

- Type: database mutation
- Request: selected file sets, calibration kind, setup hints
- Response: calibration session candidate

### `calibration.match.start`

- Type: long-running read-only/database mutation for candidates
- Request: acquisition session IDs, calibration scopes, scoring options
- Response: `OperationHandle`
- Events: candidate batch, progress, completed

### `calibration.match.review.update`

- Type: database mutation
- Request: candidate ID, decision, override reason
- Response: updated candidate and affected project source suggestions

## Projects

### `project.structure.plan_create`

- Type: plan-generating
- Request: target IDs, project name, workflow profile, destination root/path,
  naming template
- Response: `FilesystemPlan`
- Notes: Creates the app-owned outer project structure only after approval.

### `project.create_from_applied_plan`

- Type: database mutation after filesystem plan
- Request: plan ID
- Response: `Project`
- Notes: Validates that required directories were created.

### `project.import.check_structure`

- Type: read-only
- Request: root/path
- Response: conformance report
- Notes: Nonconforming brownfield projects are not ingested as app-managed.

### `project.source.map.update`

- Type: database mutation
- Request: project ID, selected acquisition sessions, calibration selections,
  panels, reasons
- Response: project source map

### `project.lifecycle.update`

- Type: database mutation
- Request: project ID, new state, verification state, note
- Response: updated lifecycle summary

## Source Views and Manifests

### `source_view.plan_generate`

- Type: plan-generating
- Request: project ID, workflow profile, strategy preference, source map revision
- Response: `FilesystemPlan`
- Notes: Includes links, junctions, copies, manifest writes, and preconditions.

### `source_view.remove.plan`

- Type: plan-generating
- Request: source view ID
- Response: `FilesystemPlan`
- Notes: Only app-created links/generated files are eligible by default.

### `manifest.generate.plan`

- Type: plan-generating
- Request: project ID, manifest kinds, output location
- Response: `FilesystemPlan`

### `manifest.preview`

- Type: read-only
- Request: project ID, manifest kind
- Response: generated manifest content preview

## Processing Artifacts and Cleanup

### `artifact.observe.start`

- Type: long-running read-only/database mutation for observations
- Request: project ID, workflow profile, paths, monitoring mode
- Response: `OperationHandle`
- Events: observed artifact batch, progress, completed

### `cleanup.policy.update`

- Type: database mutation
- Request: scope, project ID, tree overrides, artifact type rules
- Response: effective cleanup policy

### `cleanup.tree.preview`

- Type: read-only
- Request: project ID, policy revision
- Response: nested cleanup tree with inherited/effective values

### `cleanup.plan_generate`

- Type: plan-generating
- Request: project ID, selected tree nodes, policy revision, preferred actions
- Response: `FilesystemPlan`

### `archive.plan_generate`

- Type: plan-generating
- Request: project ID, destination, include/exclude policy
- Response: `FilesystemPlan`

## Plans and Audit

### `plan.preview`

- Type: read-only
- Request: plan ID
- Response: plan details, conflicts, protected items, estimates

### `plan.approve`

- Type: database mutation
- Request: plan ID, plan revision, approval note, selected item changes
- Response: approval record

### `plan.apply.start`

- Type: long-running mutation-applying
- Request: plan ID, approval ID, plan revision
- Response: `OperationHandle`
- Events: item started, item applied, item failed, progress, completed
- Notes: Re-checks preconditions before every item.

### `audit.query`

- Type: read-only
- Request: entity filters, date range, event types
- Response: audit page

## Settings

### `settings.get`

- Type: read-only
- Request: settings scope
- Response: settings document

### `settings.update`

- Type: database mutation
- Request: settings patch, expected revision
- Response: updated settings

## DTO Families

Initial schema groups:

- `RootPath`, `LibraryRoot`, `RootRemapEvent`
- `FileRecord`, `MetadataEntry`, `ClassificationAssignment`
- `Target`, `TargetAlias`, `ObservingPlanReference`
- `Equipment`, `OpticalTrain`, `SoftwareTool`
- `AcquisitionSession`, `CalibrationSession`, `CalibrationMaster`
- `CalibrationMatchCandidate`
- `WorkflowProfile`, `Project`, `ProjectSource`, `ProjectPanel`
- `SourceView`, `SourceViewItem`
- `ProcessingArtifact`, `ProjectOutput`, `ProjectManifest`
- `CleanupPolicy`, `CleanupTreeNode`
- `FilesystemPlan`, `PlanItem`, `PlanApproval`, `AuditLogEntry`
- `OperationHandle`, `OperationEvent`, `ContractError`
