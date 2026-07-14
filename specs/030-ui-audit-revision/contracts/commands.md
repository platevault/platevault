# Contract Changes: UI Audit & Revision

New and modified Tauri commands required by the UI redesign. Follows the
existing dotted-namespace convention and specta result wrappers.

## New Commands

### Equipment Management

```
equipment.cameras.list       → Camera[]
equipment.cameras.create     → { name: string, aliases?: string[] } → Camera
equipment.cameras.update     → { id: string, name: string, aliases?: string[] } → Camera
equipment.cameras.delete     → { id: string } → void

equipment.telescopes.list    → Telescope[]
equipment.telescopes.create  → { name: string, focal_length_mm?: number, aliases?: string[] } → Telescope
equipment.telescopes.update  → { id: string, name: string, focal_length_mm?: number, aliases?: string[] } → Telescope
equipment.telescopes.delete  → { id: string } → void

equipment.trains.list        → OpticalTrain[]
equipment.trains.create      → { name?: string, telescope_id?: string, camera_id?: string, focal_length_mm: number } → OpticalTrain
equipment.trains.update      → { id: string, ... } → OpticalTrain
equipment.trains.delete      → { id: string } → void

equipment.filters.list       → Filter[]
equipment.filters.create     → { name: string, category: FilterCategory } → Filter
equipment.filters.update     → { id: string, name: string, category: FilterCategory } → Filter
equipment.filters.delete     → { id: string } → void
```

### Cleanup Policy

```
cleanup.policy.get           → CleanupPolicy
cleanup.policy.update        → { actions: CleanupAction[], mode: "manual" | "auto_on_completion" } → void
```

### Calibration Matching Tolerances

```
calibration.tolerances.get    → CalibrationTolerances
calibration.tolerances.update → CalibrationTolerances → void
```

### Ingestion Settings

```
ingestion.settings.get        → IngestionSettings
ingestion.settings.update     → IngestionSettings → void
```

### Status Bar Data

```
status.summary                → StatusSummary
```

Returns aggregated data for the status bar:

```typescript
interface StatusSummary {
  inboxPendingCount: number;
  libraryFileCount: number;
  librarySizeBytes: number;
  cleanupReclaimableBytes: number;
  volumes: VolumeHealth[];
  roots: RootHealth[];
}

interface VolumeHealth {
  path: string;
  totalBytes: number;
  freeBytes: number;
  warning: boolean; // true if free < 10%
}

interface RootHealth {
  id: string;
  path: string;
  type: SourceFolderType;
  online: boolean;
}
```

### Processing Tool Configuration

```
tools.list                    → ProcessingTool[]
tools.update                  → ProcessingTool → void
tools.validate_path           → { path: string } → { valid: boolean, error?: string }
```

## Modified Commands

### roots.register

Expand the type enum from `raw | calibration | project | inbox` to
`light_frames | dark | flat | bias | project | inbox`.

The existing `roots.register` command accepts a `kind` field — this enum
value set changes. A migration must handle existing `raw` → `light_frames`
and `calibration` → user-disambiguated type.

### roots.list

Add `type` to the response and ensure it uses the expanded enum.

### firstrun.complete

The wizard now sends 6 required source types instead of the previous
category-based registration. The batch registration payload changes to use
the expanded type enum.

## Unchanged Commands

All session, calibration, project, and audit commands remain unchanged unless
the lifecycle state enum change (removing `prepared`) requires a migration.

## Source View Strategy

The `source_view_strategy` setting enum changes:

```
Before: manifest_only | symbolic_links | ntfs_junctions | hard_links | full_copy | hybrid
After:  symbolic_links | ntfs_junctions | hard_links | full_copy
```

## Project Lifecycle State

```
Before: setup | ready | prepared | processing | completed | archived
After:  setup | ready | processing | completed | archived
```

Existing projects in `prepared` state need migration to `processing`.

## Audit Semantics (iteration 2026-07-14, Q15 / #647)

No new commands are required by this iteration, but the contract of existing
ones tightens:

- Any mutation command that returns an `auditId` MUST return one that
  resolves to a durable `audit_log_entry` row (previously some ids pointed
  at bus-only in-memory events, e.g. protection set/acknowledge).
- Audit read/list commands keep their shape; their coverage expands to all
  durable-state mutations (settings changes, protection overrides, equipment
  CRUD, source enable/disable/register/delete, rescans/root ops), each with
  outcome `applied | refused | failed` plus a reason/code.
- Reads, navigation, UI state, and transient internal/periodic events are
  not durably audited and MUST NOT appear in audit read results.

## Missing-Value Semantics (iteration 2026-07-14, Q16 / #620)

No new commands are required by this iteration, but DTO shapes tighten:

- Any DTO field whose value can be absent at extraction MUST be declared
  nullable. First fix: `CalibrationFingerprint.exposureS` / `gain`
  (currently non-optional `number`, forcing the backend to substitute 0
  for missing metadata).
- Returning a sentinel value (0, empty string) in place of a missing value
  is prohibited — missing crosses the boundary as `null`.
- UIs distinguish unresolved from not-applicable from the model
  (entity/frame-type field applicability), never by inspecting rendered
  strings.
