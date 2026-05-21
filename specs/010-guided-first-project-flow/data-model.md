# Data Model: Guided First Project Flow

**Feature**: 010-guided-first-project-flow
**Status**: Draft

## Entities

### GuidedFlowStep

Static definition of a single coach step. Loaded from a registry at app start;
not user-mutable.

| Field              | Type                         | Notes                                                                |
| ------------------ | ---------------------------- | -------------------------------------------------------------------- |
| `id`               | string                       | Stable id, e.g. `inbox.confirm_first`.                               |
| `route`            | string                       | Route pattern where the anchor is expected to exist.                 |
| `trigger`          | enum `InventoryConfirmed` \| `ProjectCreated` \| `ToolOpened` | Event that completes the step. |
| `completion_event` | string                       | Canonical event name from the lifecycle event bus.                   |
| `hint_text`        | string                       | Localized hint copy keyed by user locale.                            |
| `anchor`           | string                       | `data-guide-anchor` selector value for overlay positioning.          |

Registry (v1):

| id                       | route            | trigger              | completion_event      | anchor                |
| ------------------------ | ---------------- | -------------------- | --------------------- | --------------------- |
| `inbox.confirm_first`    | `/inbox`         | `InventoryConfirmed` | `inventory.confirmed` | `inbox.confirm-row`   |
| `project.create_first`   | `/projects`      | `ProjectCreated`     | `project.created`     | `projects.create-cta` |
| `tool.open_first`        | `/projects/:id`  | `ToolOpened`         | `tool.opened`         | `project.open-in-tool`|

### GuidedFlowState

Per-install runtime state, stored in a single SQLite row.

| Field              | Type                | Notes                                                       |
| ------------------ | ------------------- | ----------------------------------------------------------- |
| `current_step`    | string \| null      | Id of the active step, or `null` when no step is active.    |
| `completed_steps` | string[]            | Ids of completed steps; order preserved.                    |
| `dismissed`       | boolean             | True when the coach was dismissed and not yet restarted.    |
| `dismissed_at`    | ISO 8601 \| null    | Set when `dismissed` becomes true; cleared on restart.      |
| `updated_at`      | ISO 8601            | Updated on every transition.                                |

## Invariants

- `current_step` is null when `dismissed` is true or when all steps in the
  registry are present in `completed_steps`.
- `completed_steps` is a subset of registry step ids; unknown ids are pruned on
  load.
- A step id appears at most once in `completed_steps`.
- `dismissed_at` is non-null if and only if `dismissed` is true.

## Transitions

| From state                | Input                                    | To state                                       |
| ------------------------- | ---------------------------------------- | ---------------------------------------------- |
| Idle                      | `setup_completed`                        | Active(first uncompleted registry step)        |
| Active(s)                 | `completion_event` for any step `t`      | Active(next uncompleted step) or Completed     |
| Active(s)                 | `dismiss`                                | Dismissed                                      |
| Dismissed                 | `restart`                                | Active(lowest uncompleted registry step)       |
| Completed                 | `restart`                                | Completed (no-op; restart does not reset)      |

## Storage

Single SQLite table `guided_flow_state` with one row enforced by a check
constraint or a singleton primary key. Migrations owned by
`crates/persistence/db`.

## Relationship To Other Specs

- Consumes events emitted by spec 002 (lifecycle state model) and spec 008
  (project create).
- Activates on completion signal from spec 003 (first-run setup wizard).
- Does not own any domain entity; mirrors event state only.
