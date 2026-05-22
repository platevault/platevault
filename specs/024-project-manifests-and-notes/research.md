# Research: Project Manifests And Notes

**Feature**: `024-project-manifests-and-notes`
**Date**: 2026-05-20

## M-1: When to generate a manifest

**Question**: At which project lifecycle events does the writer fire?

**Options considered**:
- A. Only on project creation.
- B. On creation + every source change.
- C. Creation + source change + lifecycle transition + cleanup apply.
- D. On every save of any project field (chatty).

**Decision (default)**: **C (extended)**. Triggers are bounded and meaningful:
1. **Created** — first manifest documents initial sources, calibration
   choices, workflow profile, and generated views.
2. **Source change** — lights/flats/darks/bias added, removed, or
   remapped. Captures the new source map.
3. **Lifecycle transition** — project state moves between
   acquisition/imaging/processing/done/archived (see feature 002).
4. **Cleanup applied** — a cleanup plan from feature 008 was committed
   and may have moved/archived files relevant to the project.
5. **Workflow run** — a processing-tool workflow run completed. Spec 024
   subscribes to the `workflow.run_completed` event-bus topic (spec 012).
   On receipt, writes a `workflow_run` manifest for the project named in
   the event payload `{ projectId, toolId, completedAt, outputArtifacts }`.
   **FLAGGED**: spec 012 must emit `workflow.run_completed` with this exact
   payload shape (R-Workflow-1, 2026-05-22). Do NOT edit spec 012 here —
   see GRILL amendment 2026-05-22 for the spec 012 ripple note.

**Rationale**: matches the mockup `reason` strings plus the ratified A4
decision to add `workflow_run` to the enum (GRILL 2026-05-21 spec 024 row).

**Open follow-ups**: whether manual user-triggered "snapshot now"
deserves its own reason; deferred until a clear use case appears.

## M-2: Manifest file format

**Question**: Markdown, JSON, both?

**Options considered**:
- A. Markdown only — human-readable, fits `notes/` siblings.
- B. JSON only — machine-readable, harder to read on disk.
- C. Markdown body + JSON sidecar with structured fields.
- D. Markdown body with front-matter (YAML/TOML) holding structured fields.

**Decision (default)**: **D**. One file per checkpoint with YAML
front-matter (id, reason, timestamp, version, project_id, source_map
references) followed by a markdown body. The database remains the
canonical index; the file is regeneratable documentation.

**Rationale**:
- Mockup paths use `.md`.
- Front-matter keeps the file self-describing without a second sidecar.
- A single file matches the "Reveal in OS" affordance — one click opens
  the artifact the user expects.

**Out of scope**: schema versioning beyond a single `version` integer in
front-matter; format-migration tooling is deferred.

## M-3: Notes vs. manifest distinction

**Question**: How do user notes relate to manifest snapshots?

**Decision**:
- **Notes** are a single, user-editable markdown file per project at
  `notes/project-notes.md`. They reflect current intent and are mutable.
- **Manifests** are immutable, app-generated checkpoints. When a manifest
  is generated, it MUST embed the **full text snapshot** of the notes body
  at that moment under a `notes:` field in front-matter (not a hash or
  excerpt). This preserves historical context alongside the source-map
  snapshot. (A8, ratified 2026-05-22.)
- The mockup already shows manifests carrying a `body.notes` string
  (`mock.ts` line 393), confirming the snapshot-in-manifest pattern.

**Rationale**: notes are living docs, manifests are dead-tree records.
Embedding a notes snapshot satisfies SC-002 (notes survive source
changes) without making notes themselves versioned.

## M-4: Manifest retention and versioning

**Question**: Do manifests accumulate forever? Are they pruned?

**Options considered**:
- A. Keep all manifests forever.
- B. Keep most recent N (configurable).
- C. Time-based retention.
- D. Coalesce same-day same-reason entries.

**Decision (default)**: **A** for v1. Manifests are small markdown files
and the user is the file owner. Pruning is a future concern handled by
an explicit cleanup plan if the count becomes a problem. A `version`
integer on each row lets the writer evolve front-matter shape without
discarding earlier entries.

**Rationale**: deletion is destructive and the constitution favors
reversibility. The "Export copy" action in the mockup confirms users
expect manifests to remain available.

**Pagination**: The `project.manifest.list` contract is paginated with
optional `cursor` and `limit` (default 50, max 200) in the request, and
`nextCursor` in the response. This keeps the list contract efficient for
projects with many manifests without requiring auto-pruning. Auto-prune
is deferred to v1.x. (A6, ratified 2026-05-22.)

**Open follow-ups**: add a manifest-pruning feature later if libraries
accumulate thousands of entries.

## M-5: "Reveal in OS" cross-platform behavior

**Question**: How does the desktop reveal a manifest file in the host
file manager?

**Options considered**:
- A. Platform-specific shell call (`explorer /select,`, `open -R`,
  `xdg-open` parent).
- B. Tauri shell plugin reveal API (if available).
- C. Just open the parent folder regardless of platform.

**Decision (default)**: **A** with a small adapter behind a
`reveal_in_os(path)` function. Windows uses `explorer.exe /select,<path>`,
macOS uses `open -R <path>` (Finder reveal), Linux uses
`xdg-open <parent>` because most Linux file managers cannot select a
single child. The adapter records the launch outcome as an audit event.

**Rationale**: each platform has a distinct best-effort reveal
mechanism; falling back to parent-folder on Linux keeps behavior
predictable.

**Open follow-ups**: revisit once Tauri's `shell.revealItemInFolder`
stabilizes across platforms.

## M-6: Manifest detection during onboarding

**Question**: If a project already has files in `notes/manifest-*.md`,
how does onboarding handle them?

**Decision (default)**: Detect, do not import. The onboarding flow
flags any preexisting `notes/manifest-*.md` files and asks the user
whether to (i) leave them as-is and start a fresh manifest series,
(ii) rename the legacy folder to `notes/legacy/`, or (iii) cancel and
inspect manually. The writer must not overwrite preexisting files.

**Rationale**: satisfies FR-006 and the constitution's
"never overwrite silently" principle.

## Summary Of Defaults

| Item | Default |
|------|---------|
| Triggers | created / source change / lifecycle transition / cleanup apply / workflow run |
| Format | markdown + YAML front-matter |
| Notes/manifest | separate file; manifest MUST embed full text snapshot at write time |
| Notes length cap | 16 384 bytes UTF-8 (A5); 5s debounce on UI saves |
| Retention | keep all in v1; paginated list (cursor, limit 50/max 200) |
| Reveal | platform shell adapter, parent-folder fallback on Linux |
| Onboarding | detect existing, prompt user, never overwrite |
