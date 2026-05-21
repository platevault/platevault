# Research: Bottom Log Viewer

## R1. Log buffering policy: ring vs append-only

**Question**: Should the in-UI log store be a bounded ring buffer or an
append-only list backed by virtualization?

**Options**:

1. **Bounded ring buffer** (chosen). Fixed size (500 entries), oldest-first
   eviction. Pros: trivial memory footprint, no virtualization complexity,
   matches the mockup, predictable render cost. Cons: forgets older entries
   that may still be referenced by audit links.
2. **Append-only with virtualization**. Pros: never drops entries. Cons:
   memory grows unbounded across a long session; the panel becomes a
   second audit timeline; render cost balloons; obvious pull toward
   features (search, pagination) that already live in the audit timeline
   feature.
3. **Hybrid**: small in-memory ring backed by an on-demand audit read for
   older entries. Pros: best of both. Cons: doubles the contract surface
   and re-implements audit timeline behaviors here.

**Decision**: Ring buffer. Older history is accessible through the audit
timeline feature, not the log viewer. The viewer is intentionally
session-scoped.

The buffer size is a compile-time constant in v1 (`LOG_BUFFER_SIZE = 500`).
A research decision is required to raise it because larger buffers change
render budget and color-pass behavior.

## R2. Severity partitioning: diagnostic vs workflow-significant

**Question**: Should every emitted event reach audit, or are some events
diagnostic-only?

**Options**:

1. **All-to-audit**. Pros: one canonical record; the viewer is a pure
   projection. Cons: noisy audit; high-frequency UI diagnostics (reduced
   motion, panel expand, stream reconnect) pollute the durable history.
2. **Workflow-significant in audit, diagnostics in a separate ephemeral
   channel** (chosen). Workflow-significant events (plan create, plan apply
   progress, lifecycle transitions, inventory review, settings updates on
   non-noisy keys) emit through audit and reach the viewer as a
   projection. Diagnostics emit directly on the stream channel with
   `source = "diagnostic"` and are never persisted.
3. **Two separate viewers**. Cons: defeats the bottom panel's purpose of
   one place to look while troubleshooting.

**Decision**: Two emission paths, one viewer. Diagnostic events are
flagged so audit consumers can filter them out and so export can choose
whether to include them (export defaults to excluding diagnostics).

## R3. Follow-tail vs scroll

**Question**: How does follow-tail interact with manual scrolling?

**Decision**:

- When follow-tail is on and the user scrolls up, follow-tail temporarily
  pauses without flipping the persisted preference. Scrolling back to the
  bottom resumes auto-scroll.
- When follow-tail is off, new entries do not move the viewport.
- The persisted preference (`rememberFollowLogs` in settings) is the
  initial state on panel mount; runtime pauses do not mutate it.
- Reduced-motion: follow-tail still scrolls; the scroll is instant rather
  than animated.

This matches mockup behavior except for the pause-on-manual-scroll piece,
which is plan work because the mockup does not yet implement scroll
position detection.

## R4. Color coding

**Decision**: Four level colors plus a neutral. The palette comes from the
existing design tokens used in the mockup (`alm-log__entry[data-level]`)
and is not configurable in v1.

| Level   | Token              | Use                              |
|---------|--------------------|----------------------------------|
| `error` | `--alm-danger`     | Failed operations, denied writes |
| `warn`  | `--alm-warning`    | Recoverable issues, schema repair|
| `info`  | `--alm-text-strong`| Normal workflow events           |
| `debug` | `--alm-text-dim`   | Developer diagnostics            |
| neutral | `--alm-text-faint` | Closed-panel idle preview text   |

Color is not the sole channel; the level name is always shown in the row
and is exposed to assistive technology so a color-blind user can still
distinguish levels (FR-008 functional labels).

## R5. Retention policy

**Question**: How long does audit history retain the rows that back the
viewer?

**Decision**: The viewer does not impose a retention policy on audit. Audit
retention is governed by a separate feature (currently unbounded except
by SQLite vacuum). The viewer-specific bound is the in-memory ring (R1).

Export-side bounds: the `log.export` contract carries optional `since`
and `until` ISO-8601 timestamps and an optional `level_min`. An absolute
size bound (max rows per export) is deferred to a future research
decision; v1 lets the user choose the time window instead.

## R6. Cursor semantics

**Question**: What does the cursor identify?

**Decision**: The cursor is the opaque `id` of the last delivered
`LogEntry`. The backend resolves cursors against the audit row ordering
(monotonic id within session for diagnostics, monotonic audit id for
workflow events). A cursor not found returns `cursor.invalid`; the client
restarts with no cursor and the backend returns the most recent window up
to the configured size. Cursors are not stable across app restarts because
diagnostics ids reset; durable replay belongs to the audit timeline.

## R7. Persistence of UI controls

**Question**: Which UI controls persist across sessions?

**Decision**:

- **Follow-tail**: persists via `rememberFollowLogs` settings key.
- **Level filter**: session-only. Resets to `all` on each panel mount. A
  diagnostic session sets a specific level; the next session starts
  unfiltered so a casual user is not surprised by a hidden filter.
- **Panel expanded state**: session-only. Closing the app collapses the
  panel for the next launch.

A future research decision can promote any of these to persisted state if
user feedback justifies it.
