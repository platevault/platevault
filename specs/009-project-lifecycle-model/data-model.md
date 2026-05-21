# Data Model: Project Lifecycle Model

**Spec**: 009-project-lifecycle-model | **Date**: 2026-05-09

## Project

```
Project {
  id:                Uuid                       // stable identifier
  name:              String                     // user-facing label
  lifecycle:         ProjectLifecycle           // current state (R1)
  tool:              ProcessingTool             // PixInsight | Siril | Planetary Suite
  sources:           ProjectSource[]            // inventory links
  calibrationSets:   CalibrationSetRef[]        // matched calibration sets
  channels:          String[]                   // e.g. ["Ha","OIII","L"]
  plans:             ProjectPlanRef[]           // related filesystem plans
  manifests:         ProjectManifest[]          // historical manifests
  notes?:            String                     // free-text user notes
  lastAction?:       LastAction                 // denormalized R3 marker
  blockedReason?:    BlockedReason              // present iff lifecycle == "blocked"
}
```

```
ProjectLifecycle = "setup_incomplete"
                 | "ready"
                 | "prepared"
                 | "processing"
                 | "completed"
                 | "archived"
                 | "blocked"
```

```
ProjectSource {
  inventoryId:  Uuid
  name:         String
  frames:       u32
  filter:       String
  exposure:     String
}
```

```
ProjectManifest {
  id:         Uuid
  reason:     String           // "Created", "Source updated", "Prepared", ...
  timestamp:  Timestamp
  path:       String           // relative-to-library path
  body?: {
    sources:      String[]
    calibration:  String[]
    lifecycle:    String       // snapshot label
    notes?:       String
  }
}
```

```
ProjectPlanRef {
  id:     Uuid
  title:  String
  state:  PlanState           // spec 002 PlanState
}
```

```
LastAction {
  label:  String              // R2-derived or caller-supplied
  when:   Timestamp           // truncated to minute for stable rendering
}
```

```
BlockedReason =
  | { kind: "source_missing",       inventoryId: Uuid }
  | { kind: "prepared_source_stale", preparedId:  Uuid }
  | { kind: "tool_unconfigured",    tool: ProcessingTool }
  | { kind: "calibration_unmatched", calibrationSetId: Uuid }
  | { kind: "user",                 note: String }
```

## Transition Table

Sixteen allowed edges. The `requires_plan` column marks edges whose use case
sets `requires_plan = true` on the spec 002 envelope. The `trigger` column
describes who normally drives the edge.

| From               | To                  | Default action label  | Trigger              | Side effect / requires_plan          |
| ------------------ | ------------------- | --------------------- | -------------------- | ------------------------------------ |
| `setup_incomplete` | `ready`             | `Marked ready`        | user                 | none                                 |
| `setup_incomplete` | `blocked`           | `Marked blocked`      | user or system       | none                                 |
| `ready`            | `prepared`          | `Marked prepared`     | user                 | PreparedSource creation, **plan**    |
| `ready`            | `processing`        | `Marked processing`   | user                 | none (Open in tool is launch-only)   |
| `ready`            | `blocked`           | `Marked blocked`      | user or system       | none                                 |
| `prepared`         | `ready`             | `Reverted to ready`   | user                 | PreparedSource retire, **plan**      |
| `prepared`         | `processing`        | `Marked processing`   | user                 | none                                 |
| `prepared`         | `blocked`           | `Marked blocked`      | user or system       | none                                 |
| `processing`       | `completed`         | `Marked completed`    | user                 | none                                 |
| `processing`       | `blocked`           | `Marked blocked`      | user or system       | none                                 |
| `completed`        | `archived`          | `Marked archived`     | user                 | Archive move + manifest, **plan**    |
| `completed`        | `processing`        | `Re-opened`           | user                 | none                                 |
| `archived`         | `processing`        | `Unarchived`          | user                 | optional re-link, **plan if moved**  |
| `blocked`          | `setup_incomplete`  | `Resolved blocker`    | user or system       | none                                 |
| `blocked`          | `ready`             | `Resolved blocker`    | user or system       | none                                 |
| `blocked`          | `prepared`          | `Resolved blocker`    | user or system       | none                                 |
| `blocked`          | `processing`        | `Resolved blocker`    | user or system       | none                                 |

All other `(from, to)` combinations are rejected with error code
`transition.refused` and a `details.allowed_next_states` array enumerating
the legal successors for the current state.

## Derived Views

### ProjectSummary (returned by `project.list`)

```
ProjectSummary {
  id:           Uuid
  name:         String
  lifecycle:    ProjectLifecycle
  tool:         ProcessingTool
  sourceCount:  u32
  channels:     String[]
  blockedReason?: BlockedReason
  lastAction?:  LastAction
}
```

Full `Project` is fetched by detail-view contracts; the list endpoint
deliberately omits `manifests`, `notes`, and full `sources` to keep paged
responses small.

## Invariants

- `lifecycle == "blocked"` ⇔ `blockedReason` is present.
- `lifecycle == "setup_incomplete"` ⇒ either `sources.length == 0` or at
  least one source is unmapped/unconfirmed.
- `lastAction` MAY be absent only for never-transitioned projects; once any
  transition has been recorded it is present and monotonically forward in
  time.
- `manifests[*].body.lifecycle` is a snapshot label and MUST NOT be used as
  an authoritative state read.
- `plans[*].id` references spec 017 plan records; if the referenced plan is
  garbage-collected, the reference is hidden from the UI but the manifest
  trail is preserved.

## Storage Notes

- Persisted in the SQLite store managed by `crates/persistence/db/`.
- `lifecycle`, `blockedReason.kind`, and `lastAction.when` are indexed for
  filter and sort.
- `lastAction` is denormalized; `crates/audit/` retains the durable record.
