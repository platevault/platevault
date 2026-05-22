# Tasks: Project Manifests And Notes

**Feature**: `024-project-manifests-and-notes`
**Date**: 2026-05-20
**Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

Tasks are grouped by user story. Mockup-done markers indicate behavior
already visible in `apps/desktop/src/features/projects/ProjectsPage.tsx`
or `apps/desktop/src/data/mock.ts`.

---

## US1 — View manifest list in project drawer (P1)

**Independent test**: Open a project drawer, see the Manifests accordion
section with the count badge, list of snapshots ordered newest first,
each showing reason + timestamp + path.

- [x] **T1.1** Mock data shape for `ProjectManifest` in `apps/desktop/src/data/mock.ts`. *(mockup-done)*
- [x] **T1.2** Drawer accordion section "Manifests" with count badge. *(mockup-done — `ProjectsPage.tsx:340-345`)*
- [x] **T1.3** Per-snapshot row rendering reason, timestamp, path. *(mockup-done)*
- [ ] **T1.4** Define `crates/project/structure/manifest.rs` writer skeleton with `ManifestReason` enum.
- [ ] **T1.5** Define DB schema for `manifests` table (id, project_id, reason, timestamp, path, version) in `crates/persistence/db/`.
- [ ] **T1.6** Implement `project.manifest.list` contract handler returning newest-first summaries with cursor-based pagination (cursor, limit default 50 / max 200, nextCursor in response). (A6.)
- [ ] **T1.7** Wire desktop drawer to live `project.manifest.list` call behind a feature flag (parallel to mock data).

---

## US2 — Expand a manifest body (P2)

**Independent test**: Click a manifest row, an expandable panel reveals
the structured body (source map summary, lifecycle state, notes
snapshot).

- [x] **T2.1** Expandable body container in drawer with source list and notes-of-record block. *(mockup-done — `ProjectsPage.tsx:391-395`)*
- [ ] **T2.2** Define `ManifestBody` rendering shape in TypeScript matching the schema in `project.manifest.get`.
- [ ] **T2.3** Implement `project.manifest.get` contract handler reading from DB and (optionally) the on-disk markdown body.
- [ ] **T2.4** Manifest writer renders markdown body with YAML front-matter at lifecycle triggers (created, source_change, lifecycle_transition, cleanup_applied, workflow_run). Subscribe to `workflow.run_completed` event bus topic (spec 012). (**FLAGGED**: spec 012 ripple — spec 012 must emit `workflow.run_completed` with `{ projectId, toolId, completedAt, outputArtifacts }`. See GRILL amendment 2026-05-22.)
- [ ] **T2.5** Embed **full text snapshot** of notes into manifest body when notes exist at write time (not hash or excerpt). (A8.)
- [ ] **T2.6** Audit events: `manifest.write.attempt` / `success` / `failure` via `crates/audit/`.
- [ ] **T2.7** Onboarding hook: detect preexisting `notes/manifest-*.md` and surface the choose-policy prompt (FR-006).

---

## US3 — Reveal manifest in OS / Export copy (P3)

**Independent test**: From a manifest row's context menu, choose
"Reveal in OS" — the host file manager opens with the file highlighted
(or parent folder on Linux). "Export copy" writes a copy to a
user-selected destination and records the event.

- [x] **T3.1** Row actions "Reveal in OS" and "Export copy" visible in drawer. *(mockup-done)*
- [x] **T3.2** Drawer context menu entry "Reveal manifest folder". *(mockup-done — `ProjectsPage.tsx:457`)*
- [ ] **T3.3** Implement `reveal_in_os(path)` shell adapter with Windows / macOS / Linux paths per research item M-5.
- [ ] **T3.4** Wire "Reveal in OS" action to the adapter, with error toast on failure.
- [ ] **T3.5** Implement "Export copy" using existing reviewable copy flow; record `manifest.export.copy` audit event with success/failure (FR-005).
- [ ] **T3.6** Implement `manifest.reveal_in_os` audit event recording.

---

## US4 — Edit project notes (P4)

**Independent test**: From the Notes section in the drawer, edit the
notes body and save. Reload the project; the new body persists. The
audit log shows a `note.update` event.

- [x] **T4.1** Drawer "Notes" section renders existing notes body or "No notes." placeholder. *(mockup-done — `ProjectsPage.tsx:414-427`)*
- [ ] **T4.2** Add inline edit affordance (textarea + save/cancel) to the Notes section. Apply a **5-second debounce** before issuing `project.note.update` to avoid per-keystroke writes. Enforce the 16 384-byte content cap client-side with a counter and server-side with `note.content_too_large` error. (A5.)
- [ ] **T4.3** Define DB schema for `project_notes` (id, project_id unique, updated_at, content).
- [ ] **T4.4** Implement `crates/project/structure/notes.rs` adapter reading/writing `notes/project-notes.md` atomically.
- [ ] **T4.5** Implement `project.note.update` contract handler returning `updated_at`.
- [ ] **T4.6** Audit event `note.update` recorded on save.
- [ ] **T4.7** Error mapping: `project.not_found`; `project.read_only` fires only when `lifecycle == "archived"` (not on other lifecycle states — R-NotesEdit); `note.content_too_large` when content exceeds 16 384 bytes UTF-8 (A5).

---

## Cross-cutting tasks

- [ ] **TX.1** Generate TypeScript types from the three new JSON-schema contracts into `packages/contracts/`.
- [ ] **TX.2** Add contract unit tests (request/response/error shapes).
- [ ] **TX.3** Integration test: create project → assert `created` manifest exists on disk and in DB.
- [ ] **TX.4** Integration test: mutate source map → assert `source_change` manifest exists; previous manifest unchanged.
- [ ] **TX.5** Integration test: edit notes → reload project → notes persist; manifest generated after a source change includes the new notes snapshot.
- [ ] **TX.6** Constitution recheck after design (pre-implementation).
- [ ] **TX.7** Integration test: generate >50 manifests for one project, call `project.manifest.list` with default limit, assert exactly 50 returned + `next_cursor` present; call with returned cursor, assert next page returned. (A6 pagination.)
- [ ] **TX.8** Integration test: simulate `workflow.run_completed` event → assert `workflow_run` manifest row written and file present on disk. (A4, R-Workflow-1. Requires spec 012 stub emitting the event.)
- [ ] **TX.9** Integration test: attempt `project.note.update` with content > 16 384 bytes → assert `note.content_too_large` error returned; assert no note file mutated. (A5.)
- [ ] **TX.10** Integration test: attempt `project.note.update` on an `archived` project → assert `project.read_only`; attempt on a `completed` project → assert success. (R-NotesEdit.)

---

## Dependencies

```
T1.4 ──► T1.5 ──► T1.6 ──► T1.7
                       └► T2.3
T1.4 ──► T2.4 ──► T2.5 ──► T2.6
T2.4 ──► T2.7
T1.5 ──► T4.3 ──► T4.4 ──► T4.5 ──► T4.6
T1.6, T2.3, T4.5 ──► TX.1 ──► TX.2 ──► TX.3 / TX.4 / TX.5
T3.3 ──► T3.4
T3.4, T3.5 ──► T3.6
```

US1 unblocks US2/US3/US4. US4 (notes edit) is independent of US2/US3 at
the handler level but depends on the same DB/writer scaffolding from US1.

---

## Out of scope (this feature)

- Manifest pruning, retention policies, or version migration tooling.
- Manual user-triggered manifest snapshots.
- Manifest diffing or cross-project comparison.
- Rich-text or WYSIWYG note editing.
- Remote publishing of manifests.
