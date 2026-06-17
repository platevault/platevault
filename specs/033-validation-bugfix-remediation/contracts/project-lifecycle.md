# Contract: Project Lifecycle & Typed Blocked Reason (FR-019, FR-020, FR-021)

Decision **D2**: `projects.lifecycle` is the single canonical state; legacy `project.state` migrated out.

## Lifecycle state
One canonical state per project, read identically by the user-IPC transition surface and the automatic
health/transition surface. (Exact state enum unchanged from spec-008.)

## Typed blocked reason
```
BlockedReason {
  kind: "source_missing" | "tool_unconfigured" | "user" | ...   // typed, from project_health
  note?: string
}
```
- The project DTO / `BlockedBanner` carries the **typed `kind`** produced by `project_health`, NOT a
  hardcoded `{ kind: "user" }` (fixes `ProjectDetail.tsx:185`).

## Transitions & audit
- User-IPC transitions and automatic transitions both write the canonical row (FR-019).
- Automatic block / ready / unarchive transitions each write an audit row (FR-021).
- `project.unarchived` named event is emitted (was missing).

## Filter
- The lifecycle filter accepts **multiple** states (multiselect) (FR-022 / spec-009 SC-004).

## Conformance
- Test: a project driven through a user transition and an automatic transition reports one consistent
  state from both read paths (no divergence).
- Test: a project blocked by `source_missing` surfaces `kind="source_missing"` in the banner DTO.
- Test: auto block/ready/unarchive each produce an audit row.
