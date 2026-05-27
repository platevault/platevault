# Technical Decisions (`docs/memory/`)

This file stores durable technical and implementation decisions. For governance-level decisions or project standards, see `.specify/memory/DECISIONS.md`.

## Entry Lifecycle

Each decision follows this lifecycle:

```
Active → Needs Review → Superseded → (pruned)
```

- **Active**: The decision is current and must be honored by all features and AI agents.
- **Needs Review**: Implementation reality or new context suggests this decision may be outdated. It should still be honored until reviewed and explicitly changed.
- **Superseded**: A newer decision has replaced this one. Keep it for historical context until the next audit, then consider pruning.
- **Pruned**: During an audit, remove superseded entries that no longer provide historical value. This keeps the file focused.

---

### 2026-05-25 - Dotted Tauri command names via specta rename

**Status**: Active

**Why this is durable**: Every new Tauri command must follow this naming pattern. Affects all specs that add backend commands.

**Decision**: All Tauri commands use `#[specta(rename = "domain.action")]` dotted names (e.g., `roots.register`, `sessions.list`, `firstrun.complete`). Specta generates TypeScript bindings with these names.

**Tradeoffs**: Readable TS bindings and consistent namespace; requires remembering to add the rename attribute on every new command.

**Future mistake prevented**: Using underscore names (`roots_register`) or inconsistent naming across command groups.

**Evidence**: Spec 029 validated the pattern across 31 stub commands. All passed binding generation + integration tests.

**Where to look next**: `apps/desktop/src-tauri/src/commands/`, `apps/desktop/src/bindings/index.ts`

---

### 2026-05-26 - Client-side validation, server-side registration

**Status**: Active

**Why this is durable**: Any future wizard or form that registers sources must follow this pattern to avoid side-effect bugs.

**Decision**: During wizard flows, `validatePath()` performs client-side deduplication checks only. Registration (DB write) happens exclusively at flush time via `roots.register.batch`. Never use a create/register endpoint for validation purposes.

**Tradeoffs**: No server-side path existence check during add (deferred to flush). Simpler flow, no side effects. User sees path validation errors only at completion, not at add time.

**Future mistake prevented**: Calling `registerRoot()` in a "validate" function that silently persists data, causing double-registration at completion (code review finding C1, spec 003).

**Evidence**: Spec 003 code review, critical finding C1. Original `validatePath()` called `registerRoot()`, causing every source to fail at completion with `path.already_registered`.

**Where to look next**: `apps/desktop/src/features/setup/sources-store.ts`

---

### 2026-05-26 - DB-first with localStorage cache for first-run gate

**Status**: Active

**Why this is durable**: Any feature that gates on persistent state should follow this authority model.

**Decision**: Route gate reads `FirstRunState.completed_at` from SQLite via Tauri command, falls back to `setupCompleted` localStorage preference only if the DB read fails. DB is authority; localStorage is cache.

**Tradeoffs**: Async route guard adds a loading state flash on cold start. More robust than localStorage-only (survives browser storage clears).

**Future mistake prevented**: Using localStorage as the authority for durable state that should survive across installs or storage resets.

**Evidence**: Spec 003 clarification Q4. Implemented in `router.tsx` and `SetupPage.tsx`.

**Where to look next**: `apps/desktop/src/app/router.tsx`, `apps/desktop/src/features/setup/SetupPage.tsx`

---

### 2026-05-26 - Contract schemas match Tauri/specta pattern

**Status**: Active

**Why this is durable**: All future spec contracts must follow this pattern instead of the envelope pattern.

**Decision**: JSON Schema contracts document the actual Tauri/specta interface — typed response on success, `Err(String)` on failure. No `contractVersion`/`requestId`/`status` envelope wrappers.

**Tradeoffs**: Contracts are less portable to non-Tauri transports. If a future remote API is added, envelope fields would need to be reintroduced at that boundary.

**Future mistake prevented**: Writing contract schemas with envelope patterns that no command actually implements, causing perpetual spec-code drift.

**Evidence**: Spec 003 sync analysis finding D3. All pre-implementation contracts had envelopes; none of the Tauri commands implemented them.

**Where to look next**: `specs/*/contracts/*.json`

---

### 2026-05-25 - JsonAny wrapper for specta-annotated command parameters

**Status**: Active

**Why this is durable**: Any Tauri command that accepts untyped JSON must use this wrapper.

**Decision**: Use `contracts_core::JsonAny` (not raw `serde_json::Value`) for all specta-annotated command parameters. Raw `Value` causes infinite recursion in specta's TypeScript binding generation.

**Tradeoffs**: Extra wrapper type; `.0` access to get inner Value. Prevents stack overflow.

**Future mistake prevented**: Using `serde_json::Value` directly in a `#[tauri::command]` parameter, causing a stack overflow during `cargo build`.

**Evidence**: Spec 029 implementation. Discovered during PoC, documented in handover.

**Where to look next**: `crates/contracts/core/src/lib.rs` (JsonAny definition)

---

### 2026-05-26 - Spec 030 is the authoritative UI design spec

**Status**: Active

**Why this is durable**: All UI implementation work must follow spec 030's decisions. Earlier UI specs (027, 028) are superseded for layout, navigation, and component design.

**Decision**: Spec 030 (UI Audit & Revision) is the leading specification for all UI/UX decisions. It supersedes spec 027 (frontend implementation) for layout and navigation patterns, and spec 028 (frontend quality hardening) for component consistency. Any conflict between spec 030 and earlier specs, spec 030 wins.

**Tradeoffs**: Existing implemented UI from specs 027/029 will need rework. This is intentional — the audit found significant inconsistencies that justify a comprehensive redesign.

**Future mistake prevented**: Implementing new features using spec 027's layout patterns (right sidebars everywhere, split-column property tables, confidence scores) when spec 030 has replaced them with the hybrid model.

**Evidence**: Interactive screen-by-screen audit with user, covering all 9 screens + settings (12 panes).

**Where to look next**: `specs/030-ui-audit-revision/spec.md`

---

### 2026-05-26 - Hybrid layout model: sidebars for workflow screens, top bars for data screens

**Status**: Active

**Why this is durable**: Every new screen or detail view must follow this pattern.

**Decision**: Inbox and Projects use a right action sidebar (multi-step workflow). Sessions, Calibration, Targets, and Archive use a top action bar (read-heavy, few actions). Contextual info (notes, calibration matches, project membership) goes in the main content area on top-bar screens.

**Tradeoffs**: Inconsistency between screens — but justified because Inbox/Projects have fundamentally different interaction patterns (workflow vs. data browsing).

**Future mistake prevented**: Adding right sidebars to every screen "for consistency" when they'd be mostly empty, wasting horizontal space.

**Evidence**: Spec 030 sections 2.3, 3.4, 4.3, 5.1, 6.5. Discussed Option A (sidebar everywhere), Option B (top bar only), Option C (hybrid). User chose hybrid after evaluating tradeoffs.

---

### 2026-05-26 - Project lifecycle simplified to 5 phases (Prepared removed)

**Status**: Active

**Why this is durable**: All project state machines, transitions, and UI must use the 5-phase model.

**Decision**: Project lifecycle is Setup → Ready → Processing → Completed → Archived. The "Prepared" phase is removed — generating source views auto-advances from Ready to Processing. Existing projects in "prepared" state need migration to "processing".

**Tradeoffs**: Less granular lifecycle tracking. But "prepared" was a meaningless pause — the user clicked "generate views" and then immediately started processing.

**Future mistake prevented**: Adding UI for a "Prepared" phase that has no user-facing purpose.

**Evidence**: Spec 030 section 6.3.

---

### 2026-05-26 - Source view junctions at folder level with DATE_ prefix keyword

**Status**: Active

**Why this is durable**: All source view generation code must follow this pattern.

**Decision**: Source views use folder-level junctions/symlinks (one per session), not per-file symlinks. Lights and flats are grouped by filter, with `DATE_` prefix on session folder names for WBPP custom grouping (e.g., `Lights/Ha/DATE_2024-11-30/`). Darks and bias use descriptive names without DATE_ prefix. Calibration lives under a `Calibration/` parent directory.

**Tradeoffs**: Requires source files to be organized in session folders before junction creation. The inbox-to-session confirmation flow handles this via the token pattern system.

**Future mistake prevented**: Creating thousands of per-file symlinks (slow, fragile) or flat junction structures that WBPP can't group by date.

**Evidence**: Spec 030 research.md R3, discussed in interactive session.

---

### 2026-05-26 - Expanded source folder types (6 types, not 4)

**Status**: Active

**Why this is durable**: All folder registration, wizard, and settings code must use the expanded enum.

**Decision**: Source folder types expanded from `raw | calibration | project | inbox` to `light_frames | dark | flat | bias | project | inbox`. All six are required during setup. Migration: `raw` → `light_frames`, `calibration` → user-disambiguated.

**Tradeoffs**: Breaking change to the roots.register contract. Requires migration for existing data.

**Future mistake prevented**: Registering one "calibration" folder when the app actually needs separate dark/flat/bias folders for proper calibration matching.

**Evidence**: Spec 030 section 1.1, wizard redesign.

---

### 2026-05-26 - Session file tracking via join table

**Status**: Active

**Why this is durable**: Session split/merge, file reassignment, and audit trail all depend on this model.

**Decision**: Track file-to-session membership via a `session_files` join table (session_id, file_id, assigned_at, assignment_source), not metadata-only matching. Split creates N new sessions and moves memberships atomically with audit records.

**Tradeoffs**: Extra table and write overhead vs. metadata-only matching. But metadata matching is fragile for split operations and loses provenance.

**Future mistake prevented**: Implementing split/merge by mutating file metadata, which breaks audit trail and prevents reviewable plan previews (Constitution Principle II).

**Evidence**: Spec 030 design question resolution, 2026-05-26.

---

### 2026-05-26 - Equipment identity via alias-based UUID matching

**Status**: Active

**Why this is durable**: All equipment auto-detection, inbox scanning, and settings UI must follow this identity model.

**Decision**: Equipment (cameras, telescopes, filters) auto-detected from FITS headers during inbox scan, written to DB when the session is ingested. Each record has a stable UUID and an `aliases[]` array. FITS header strings (e.g., `INSTRUME = 'ZWO ASI2600MM Pro'`) are matched against aliases, not display names. User renames change `name` but aliases persist, preventing duplicate creation on re-scan.

**Tradeoffs**: Users must manually add aliases for the same physical device with different FITS strings (driver/firmware variations). Auto-merge of similar names is not attempted.

**Future mistake prevented**: Re-ingesting equipment as a new record after the user renames it, because the match key was the display name.

**Evidence**: Spec 030 design question resolution, 2026-05-26.

---

### 2026-05-26 - Archive is the soft-delete stage, no retention timer

**Status**: Active

**Why this is durable**: All cleanup/archive/delete flows must follow this three-step model.

**Decision**: Archive → "Delete from archive" → reviewable filesystem plan with confirmation → permanent removal. No retention timer or trash-after-trash stage. Three deliberate manual steps provide sufficient friction.

**Tradeoffs**: No automatic cleanup of old archived items. User must explicitly decide to permanently delete.

**Future mistake prevented**: Adding a retention timer or trash stage after archive, creating unnecessary complexity when three manual steps already satisfy Constitution Principle II.

**Evidence**: Spec 030 design question resolution, 2026-05-26.

---

### 2026-05-26 - Filesystem watcher: inbox only, additions + deletions + moves

**Status**: Active

**Why this is durable**: Watcher scope affects resource usage, notification design, and event handling architecture.

**Decision**: The `notify`-based filesystem watcher monitors inbox folders only. Detects additions, deletions, and moves. Does not watch registered source folders (lights, calibration, projects). Source folder staleness is discovered lazily when the user opens the relevant session/project.

**Tradeoffs**: External changes to source folders go unnoticed until the user navigates there. Acceptable because the app isn't expected to react to external source folder mutations in real time.

**Future mistake prevented**: Watching all registered folders, creating expensive background I/O and false-positive notifications for normal tool processing activity.

**Evidence**: Spec 030 design question resolution, 2026-05-26.

---

### 2026-05-26 - Notes sync is DB → disk one-way for v1

**Status**: Active

**Why this is durable**: All notes editing, display, and sync code must treat the DB as the sole authority.

**Decision**: Notes are authored and edited in the app only. Disk files in `notes/` are a read-only projection for portability and backup. Bidirectional sync (detecting external edits) is deferred to a future issue.

**Tradeoffs**: Users who prefer editing markdown in an external editor must copy changes back manually. Acceptable for v1.

**Future mistake prevented**: Building conflict resolution, concurrent-write detection, and merge logic for a v1 feature that primarily needs reliable persistence.

**Evidence**: Spec 030 design question resolution, 2026-05-26.

---

### 2026-05-26 - Tool profile switch regenerates source view via reviewable plan

**Status**: Active

**Why this is durable**: Any code that changes the active tool profile for a project must trigger source view regeneration.

**Decision**: Switching tool profile (e.g., PixInsight → Siril) generates a reviewable filesystem plan to remove old junctions and create new ones with the target tool's naming conventions. If the old source view was used (tool has partial results), the plan includes a warning annotation but does not block.

**Tradeoffs**: User must apply a plan to switch profiles. No automatic switching.

**Future mistake prevented**: Silently renaming junctions or leaving stale junctions that point to wrong naming conventions.

**Evidence**: Spec 030 design question resolution, research.md R12.
