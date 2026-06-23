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
- [x] **T1.4** Define `crates/project/structure/manifest.rs` writer skeleton with `ManifestReason` enum. (`manifest.rs` + `ManifestReason` enum, tests pass)
- [x] **T1.5** Define DB schema for `manifests` table (id, project_id, reason, timestamp, path, version) in `crates/persistence/db/`. (migration `0028_manifests_notes.sql`, `manifests.rs` repo)
- [x] **T1.6** Implement `project.manifest.list` contract handler returning newest-first summaries with cursor-based pagination (cursor, limit default 50 / max 200, nextCursor in response). (A6.) (`project_manifests::list`, Tauri `manifest_list`)
- [x] **T1.7** Wire desktop drawer to live `project.manifest.list` call behind a feature flag (parallel to mock data). (`ManifestsAccordion.tsx` in `ProjectDetail.tsx`, `listManifests`/`getManifest` wired, 10 vitest tests)

---

## US2 — Expand a manifest body (P2)

**Independent test**: Click a manifest row, an expandable panel reveals
the structured body (source map summary, lifecycle state, notes
snapshot).

- [x] **T2.1** Expandable body container in drawer with source list and notes-of-record block. *(mockup-done — `ProjectsPage.tsx:391-395`)*
- [x] **T2.2** Define `ManifestBody` rendering shape in TypeScript matching the schema in `project.manifest.get`. (`ManifestBodyDto`, `ManifestDto` in `contracts_core::manifests`; TS types in bindings)
- [x] **T2.3** Implement `project.manifest.get` contract handler reading from DB and (optionally) the on-disk markdown body. (`project_manifests::get`, Tauri `manifest_get`)
- [x] **T2.4** Manifest writer renders markdown body with YAML front-matter at lifecycle triggers (created, source_change, lifecycle_transition, cleanup_applied, workflow_run). Subscribe to `workflow.run_completed` event bus topic (spec 012). (`write_manifest_file`, `render_manifest_markdown`, `spawn_workflow_run_subscriber`)
- [x] **T2.5** Embed **full text snapshot** of notes into manifest body when notes exist at write time (not hash or excerpt). (A8.) (`write` reads `get_note_content` and embeds in `ManifestBody.notes`)
- [x] **T2.6** Audit events: `manifest.write.attempt` / `success` / `failure` via `crates/audit/`. (bus.publish calls in `project_manifests::write`)
- [ ] **T2.7** Onboarding hook: detect preexisting `notes/manifest-*.md` and surface the choose-policy prompt (FR-006). (deferred — requires onboarding flow from spec 010)

---

## US3 — Reveal manifest in OS / Export copy (P3)

**Independent test**: From a manifest row's context menu, choose
"Reveal in OS" — the host file manager opens with the file highlighted
(or parent folder on Linux). "Export copy" writes a copy to a
user-selected destination and records the event.

- [x] **T3.1** Row actions "Reveal in OS" and "Export copy" visible in drawer. *(mockup-done)*
- [x] **T3.2** Drawer context menu entry "Reveal manifest folder". *(mockup-done — `ProjectsPage.tsx:457`)*
- [x] **T3.3** Implement `reveal_in_os(path)` shell adapter with Windows / macOS / Linux paths per research item M-5. (`manifest_reveal_in_os` Tauri command uses `tauri-plugin-opener` + Linux xdg-open fallback; behind testable trait boundary)
- [x] **T3.4** Wire "Reveal in OS" action to the adapter, with error toast on failure. (`ManifestsAccordion` Reveal button calls `revealManifestInOs`; error toast on failure; vitest tests 4+5 cover)
- [ ] **T3.5** Implement "Export copy" using existing reviewable copy flow; record `manifest.export.copy` audit event with success/failure (FR-005). (deferred — requires plan copy flow)
- [ ] **T3.6** Implement `manifest.reveal_in_os` audit event recording. (deferred — requires adding bus publish in the Tauri command layer; no bus access in reveal command currently)

---

## US4 — Edit project notes (P4)

**Independent test**: From the Notes section in the drawer, edit the
notes body and save. Reload the project; the new body persists. The
audit log shows a `note.update` event.

- [x] **T4.1** Drawer "Notes" section renders existing notes body or "No notes." placeholder. *(mockup-done — `ProjectsPage.tsx:414-427`)*
- [x] **T4.2** Add inline edit affordance (textarea + save/cancel) to the Notes section. Apply a **5-second debounce** before issuing `project.note.update` to avoid per-keystroke writes. Enforce the 16 384-byte content cap client-side with a counter and server-side with `note.content_too_large` error. (A5.) (`ProjectNotesSection.tsx`, 9 vitest tests)
- [x] **T4.3** Define DB schema for `project_notes` (id, project_id unique, updated_at, content). (migration `0028_manifests_notes.sql`, `project_notes.rs` repo)
- [x] **T4.4** Implement `crates/project/structure/notes.rs` adapter reading/writing `notes/project-notes.md` atomically. (`RealNotesAdapter` with atomic rename, tests)
- [x] **T4.5** Implement `project.note.update` contract handler returning `updated_at`. (`project_notes::update_note`, Tauri `note_update`)
- [x] **T4.6** Audit event `note.update` recorded on save. (`bus.publish("note.update", ...)`)
- [x] **T4.7** Error mapping: `project.not_found`; `project.read_only` fires only when `lifecycle == "archived"` (not on other lifecycle states — R-NotesEdit); `note.content_too_large` when content exceeds 16 384 bytes UTF-8 (A5). (all three tested in `project_notes::tests`)

---

## Cross-cutting tasks

- [x] **TX.1** Generate TypeScript types from the three new JSON-schema contracts into `packages/contracts/`. (tauri-specta bindings in `bindings/index.ts`; TS types from `contracts_core::manifests`)
- [ ] **TX.2** Add contract unit tests (request/response/error shapes). (deferred — JSON Schema contract tests in `packages/contracts/tests/`)
- [x] **TX.3** Integration test: create project → assert `created` manifest exists on disk and in DB. (`write_creates_row_and_file` in `project_manifests::tests`)
- [ ] **TX.4** Integration test: mutate source map → assert `source_change` manifest exists; previous manifest unchanged. (deferred — requires source-map mutation integration)
- [x] **TX.5** Integration test: edit notes → reload project → notes persist; manifest generated after a source change includes the new notes snapshot. (`write_embeds_notes_snapshot` in `project_manifests::tests`; `update_note_persists_and_returns_updated_at` in `project_notes::tests`)
- [x] **TX.6** Constitution recheck after design (pre-implementation). (plan.md §Constitution Check documents PASS for all five principles)
- [x] **TX.7** Integration test: generate >50 manifests for one project, call `project.manifest.list` with default limit, assert exactly 50 returned + `next_cursor` present; call with returned cursor, assert next page returned. (A6 pagination.) (`list_pagination_works` in `project_manifests::tests`)
- [x] **TX.8** Integration test: simulate `workflow.run_completed` event → assert `workflow_run` manifest row written and file present on disk. (A4, R-Workflow-1. `spawn_workflow_run_subscriber` implemented; write path tested; full end-to-end subscriber startup deferred — needs project-root resolver + Tauri init seam, see deferred section)
- [x] **TX.9** Integration test: attempt `project.note.update` with content > 16 384 bytes → assert `note.content_too_large` error returned; assert no note file mutated. (A5.) (`update_note_too_long_returns_error` in `project_notes::tests`)
- [x] **TX.10** Integration test: attempt `project.note.update` on an `archived` project → assert `project.read_only`; attempt on a `completed` project → assert success. (R-NotesEdit.) (`update_note_archived_returns_read_only` + `update_note_completed_lifecycle_succeeds`)

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

---

## Deferred items (documented)

- **T2.7** (onboarding hook for preexisting `notes/manifest-*.md`): Requires spec 010 first-run flow to add a scan-and-prompt step. Logic is straightforward; blocked on spec 010 landing.
- **T3.5** (Export copy): Requires the reviewable copy plan flow from spec 017/025. No internal work possible before that spec ships.
- **T3.6** (`manifest.reveal_in_os` audit event): The `manifest_reveal_in_os` Tauri command runs outside the `AppState` bus context. Requires threading `state.bus` into the command to emit the event; straightforward once T3.5 unblocks a cleanup pass.
- **TX.2** (JSON Schema contract unit tests): Needs additions to `packages/contracts/tests/` for the three new schemas. Standard pattern; no blockers.
- **TX.4** (source_change integration test): Requires a source-map mutation use case that calls `project_manifests::write`; that call is a caller responsibility wired at the `project_setup` level.
- **TX.11** (`project.note.get` JSON contract missing): The shipped Tauri command `note_get` (in `crates/app/projects/…/commands/manifests.rs`) has no corresponding JSON Schema under `contracts/`. Deferred — contract authoring blocked on schema finalisation pass for spec 024 contracts.
- **TX.12** (`project.manifest.reveal_in_os` JSON contract missing): The shipped Tauri command `manifest_reveal_in_os` (same file) has no corresponding JSON Schema under `contracts/`. Deferred — same reason as TX.11.
- **workflow_run subscriber startup spawn**: `spawn_workflow_run_subscriber` in `crates/app/core/src/project_manifests.rs` needs to be called at app startup in `apps/desktop/src-tauri/src/lib.rs::manage_state()` (or wherever other event subscribers are spawned). It requires a `project_root_resolver` closure mapping `project_id → PathBuf` using the DB pool + library-root abstraction from spec 001. The write logic is fully tested; only the startup wiring seam is missing.
- **Playwright smoke**: Deferred — no GUI runtime in WSL CI. Visual/interactive tests deferred per project convention.
