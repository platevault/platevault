# Data Model: Project Create, Onboard, And Edit

**Spec**: 008-project-create-onboard-edit | **Date**: 2026-05-09

This data model is shared with spec 009 (lifecycle), spec 010 (guided first
project), and spec 011 (tool launch). 008 owns the **identity, source link,
channel, and notes** facets; 009 owns `lifecycle`, `blockedReason`, and
`lastAction`; the storage shape is unified.

## Project

```
Project {
  id:                Uuid                       // stable identifier
  name:              String                     // user-facing label, ≤ 120 chars, unique within library
  tool:              ProcessingTool             // selected by user at create (R3)
  lifecycle:         ProjectLifecycle           // owned by spec 009; new projects start "setup_incomplete"
  path:              String                     // relative-to-library path of the project folder
  sources:           ProjectSource[]            // inventory links, see below
  calibrationSets:   CalibrationSetRef[]        // owned by spec 007
  channels:          ProjectChannel[]           // inferred + manual, see R4
  plans:             ProjectPlanRef[]           // owned by spec 025
  manifests:         ProjectManifest[]          // owned by spec 024
  notes?:            String                     // free-text, ≤ 4 KB
  lastAction?:       LastAction                 // owned by spec 009
  blockedReason?:    BlockedReason              // owned by spec 009
  createdAt:         Timestamp
  updatedAt:         Timestamp
}
```

```
ProcessingTool = "PixInsight" | "Siril" | "Planetary Suite"
```

The `ProcessingTool` enum is the canonical list; new tools require a
research decision and a versioned contract bump. The mockup currently uses
the same three values at `apps/desktop/src/data/mock.ts:323`.

## ProjectSource

```
ProjectSource {
  inventoryId:  Uuid           // hard reference to the Inventory row
  name:         String         // snapshot at link time
  frames:       u32            // snapshot at link time
  filter:       String         // snapshot at link time, drives channel inference
  exposure:     String         // snapshot at link time (display string, e.g. "120s")
  linkedAt:     Timestamp
}
```

Snapshot fields (`name`, `frames`, `filter`, `exposure`) are denormalized
from the Inventory row at link time. The Inventory row remains the
authoritative source; if the row mutates (rename, additional frames
appended), the project drawer reads the live values via join. The snapshot
is retained for two reasons:

1. Fast list-render without an Inventory join.
2. Audit truth: the user agreed to *these* numbers at link time. Later
   divergence is surfaced as a `prepared_source_stale` blocked reason
   (spec 009 R3).

## ProjectChannel

```
ProjectChannel {
  label:   String              // e.g. "Ha", "OIII", "L"
  source:  "inferred" | "manual"
  addedAt: Timestamp
}
```

Inference rule (R4): the inferred channel set is the deduplicated,
sorted-ascending list of `ProjectSource.filter` values across linked
sources. Manual additions persist regardless of source coverage. Manual
removals of inferred channels are recorded as user-intent and not
auto-restored even when a matching source is added later — except when
the user explicitly re-runs "Re-infer channels" from the edit pane.

## Cross-Spec References

```
CalibrationSetRef { id: Uuid, label: String }      // owned by spec 007
ProjectPlanRef    { id: Uuid, title: String, state: PlanState }   // owned by spec 025; PlanState defined by spec 002 (includes paused, discarded per spec 017+025 amendment — E6)
ProjectManifest   { id, reason, timestamp, path, body? }          // owned by spec 024
LastAction        { label, when }                  // owned by spec 009
BlockedReason     { kind, ...payload }             // owned by spec 009
ProjectLifecycle  = "setup_incomplete"             // owned by spec 009
                  | "ready"
                  | "prepared"
                  | "processing"
                  | "completed"
                  | "archived"
                  | "blocked"
```

The `ProjectLifecycle` enum is owned by spec 009; this spec consumes it
without redefinition. New project creation deterministically yields
`lifecycle = "setup_incomplete"`; the first transition to `ready` is a
spec-009 operation that runs after the create plan is applied.

## Invariants

- `name` is non-empty, ≤ 120 chars, unique within library scope.
- `path` is unique within library scope; two projects MUST NOT share a
  folder.
- `tool` is non-null on all projects after create (R-Tool-Req). `tool` is
  immutable when `lifecycle in {"prepared", "processing", "completed",
  "blocked"}` (R-Tool-Lock, GRILL 2026-05-22). The `blocked` state is
  included because it may be entered from any of the locked states.
  Changing tool requires lifecycle to be `setup_incomplete` or `ready`.
  Recovery from a locked-tool project uses manual re-creation via
  `project.create` (no `project.duplicate` in v1 — R-NoDup).
- `setup_incomplete` is ONLY for projects with missing/unconfirmed sources.
  A project without a tool MUST NOT be created (tool is required at create).
- `sources[]` MUST contain unique `inventoryId` values; duplicate add
  attempts return `source.already.linked`. Each linked source MUST reference
  a confirmed Inventory session (`state == "confirmed"` — R-Inventory-Confirmed).
- `channels[]` MUST contain unique `label` values.
- `lifecycle == "archived"` ⇒ all edit operations refuse with
  `lifecycle.read_only` (research R7).
- `notes` is plain text, ≤ 4 KB; markdown is not rendered in v1.

## Storage Notes

- Persisted in the SQLite store managed by `crates/persistence/db/`.
- `name`, `path`, and `tool` are indexed for filter and uniqueness.
- `sources` is a child table keyed by `(project_id, inventory_id)`.
- `channels` is a child table keyed by `(project_id, label)`.
- `manifests`, `plans`, and `calibrationSets` are owned by their
  respective specs; this spec only carries foreign keys.

## Derived Views

### ProjectCreateResult (returned by `project.create`)

```
ProjectCreateResult {
  project_id:    Uuid
  lifecycle:     "setup_incomplete"   // always, per invariant above
  plan_id?:      Uuid                 // FilesystemPlan id; present when folder/marker write was planned
  channels:      ProjectChannel[]     // inferred from initial_sources at create time
}
```

### ProjectUpdateResult (returned by `project.update`)

```
ProjectUpdateResult {
  project_id:     Uuid
  fields_updated: String[]            // subset of ["name", "tool", "notes"]
  audit_id:       Uuid
}
```

### ProjectSourceAddResult (returned by `project.source.add`)

```
ProjectSourceAddResult {
  project_id:    Uuid
  source_added:  ProjectSource
  channels:      ProjectChannel[]     // recomputed after link; the caller may diff against prior list
  audit_id:      Uuid
  new_lifecycle? ProjectLifecycle     // present if source.add triggered a setup_incomplete → ready auto-transition (R-Ready-Trigger)
}
```

### ProjectSourceRemoveResult (returned by `project.source.remove`)

```
ProjectSourceRemoveResult {
  projectId:       Uuid
  removedSourceId: Uuid
  auditId:         Uuid
  newLifecycle?:   ProjectLifecycle   // present if removal triggered a ready → setup_incomplete transition
}
```

Uses camelCase convention (A7 exception for new contracts).

### ChannelDrift (embedded in `project.get` response)

```
ChannelDrift {
  hasNewSources:   Boolean   // true when sources were added after last channel review
  suggestedAction: "re_infer" | "dismiss"
}
```

Present on the `project.get` response. Reset to `hasNewSources = false` by
calling `project.channels.reinfer` or `project.channels.dismiss_drift`
(R-ChannelDrift, GRILL 2026-05-22).
