# Tasks: Tauri Shell Integration & Platform Polish

**Input**: Design documents from `specs/051-tauri-shell-integration/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Most of this feature is native-OS/shell behavior that unit tests
cannot observe end-to-end (window chrome color, native menu presence, OS
notification popups). Where a `cargo test`/vitest assertion IS the right
mechanism (repository behavior, settings validation, the favourites hook,
contract shapes), tests are included. Native-OS-facing acceptance is verified
manually (see Phase 10) and, where automatable, via `tauri-driver`/Playwright
per `docs/development/testing.md`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency)
- **[Story]**: which user story this task belongs to
- All paths are relative to the repo root.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Land every new dependency once, up front, so every story below
can assume the crates/packages already exist in the lockfiles.

- [ ] T001 Add Rust plugin dependencies to `apps/desktop/src-tauri/Cargo.toml`
      (and the workspace `Cargo.toml` `[workspace.dependencies]` table,
      matching the existing `tauri-plugin-dialog`/`tauri-plugin-opener`
      pattern): `tauri-plugin-single-instance`, `tauri-plugin-window-state`,
      `tauri-plugin-log`, `tauri-plugin-notification`, `tauri-plugin-updater`,
      `tauri-plugin-prevent-default`. Re-verify each exact patch version
      against crates.io at implementation time (research.md §c has versions
      confirmed 2026-07-05; time will have passed).
- [ ] T002 [P] Add JS plugin packages to `apps/desktop/package.json`:
      `@tauri-apps/plugin-window-state`, `@tauri-apps/plugin-log`,
      `@tauri-apps/plugin-notification`, `@tauri-apps/plugin-updater`,
      `@tauri-apps/plugin-process` (no JS package exists for
      single-instance or prevent-default — Rust-only). Run install; record
      resolved versions.
- [x] T003 [P] Create the new `app_core_cache` crate at `crates/app/cache/`
      (`Cargo.toml` + `src/lib.rs`) per plan.md's Project Structure: a thin
      wrapper around the existing workspace `moka = "0.12"` dependency (a
      generic `TtlCache<K, V>` and/or `DebounceCache<K>` type, mirroring the
      shape already hand-rolled in `crates/app/projects/src/project_health.rs`).
      Add `crates/app/cache` to the root `Cargo.toml` `[workspace] members`
      list. No consumers are required to migrate as part of this task (see
      research.md §d) — this is additive infrastructure.
- [ ] T004 `cargo build --workspace` and `pnpm install` sanity pass after
      T001-T003 land, before any behavior changes begin.

**Checkpoint**: All new dependencies compile/install cleanly; nothing wired
yet.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The two data-ownership migrations that several stories'
acceptance depends on (US2, US3), plus the cross-cutting `isTauri()` cleanup
that US6 and US9 both benefit from having in place first.

**⚠️ CRITICAL**: US2 and US3 cannot be verified end-to-end until their
respective foundational pieces below land.

- [ ] T005 [Foundational] Create
      `crates/persistence/db/migrations/0055_target_favourites.sql` with the
      exact contents specified in `data-model.md` §E1 (`target_favourite`
      table). Before creating it, re-check `crates/persistence/db/migrations/`
      for a newer file than `0054` introduced by a concurrent branch (prior
      duplicate-migration-version collision lesson) and bump the number if
      needed.
- [ ] T006 [Foundational] Add `list_favourites` / `add_favourite` /
      `remove_favourite` repository functions for `target_favourite` in
      `crates/persistence/db/repositories/` (new `target_favourites.rs` or an
      addition to the existing targets repository file — match current file
      layout), per data-model.md §E1's repository shape.
- [ ] T007 [Foundational] Add the `cleanupTypeOverrides` descriptor entry to
      `crates/app/settings/src/descriptors.rs`: a new `ValidationRule` variant
      (object map of known data-type id → `Keep|Archive|Delete`, mirroring the
      existing `PatternsByType` rule's validation style), registered as
      non-overridable / audited-on-change (matching `defaultProtection`'s
      descriptor flags, per data-model.md §E2). No migration needed — this
      reuses the existing generic `settings` table.
- [ ] T008 [P] [Foundational] Replace the hand-rolled `inTauri()` sniff in
      `apps/desktop/src/lib/window.ts` (`'__TAURI_INTERNALS__' in window`)
      with `core.isTauri()` from `@tauri-apps/api/core` (already a pinned
      dependency). No behavior change; add/keep a regression test asserting
      `openInNewWindow` still degrades to `window.open` outside Tauri.
- [ ] T009 [P] [Foundational] Audit every runtime read of the registered
      source list (Settings data-sources screen, any other consumer besides
      the first-run wizard) and confirm each reads from the backend
      (`registered_sources` via `sources.list`/equivalent), not
      `apps/desktop/src/features/setup/sources-store.ts`'s `localStorage`
      helpers. `sources-store.ts` itself is documented wizard-only scratch
      state (pre-registration buffer) and is exempt (FR-028) — this task is a
      verification pass with a fix only if a real gap is found; no gap is
      currently known.

**Checkpoint**: Schema/settings-key groundwork exists; both data-ownership
stories (US2, US3) can now be implemented against real storage.

---

## Phase 3: User Story 1 - Single-instance guard (Priority: P1) 🎯 MVP

**Goal**: A second launch focuses the existing window instead of opening a
duplicate process against the same database.

**Independent Test**: Launch the app twice in a row; confirm one window, one
process, no database contention.

- [x] T010 [US1] Register `tauri_plugin_single_instance::init(...)` as the
      **first** plugin in `build_app()` (`apps/desktop/src-tauri/src/lib.rs`)
      — single-instance must attach before other plugins/state so a
      redirected second launch never reaches database/migration code. The
      callback focuses/unminimizes the existing main window and logs the
      received argv/cwd (FR-002, FR-003).
- [x] T011 [US1] Confirm (add if missing) that the single-instance callback
      runs before `Database::connect`/`db.migrate()` in `main.rs` on the
      redirected path — i.e. the second process's `main()` never reaches
      those calls at all once the plugin redirects it (FR-003 — "exit without
      performing any database migration, seed, or write"). Confirmed:
      `main.rs` already calls `build_app()` (which registers and builds the
      single-instance plugin first) before `Database::connect`/`db.migrate()`;
      no reordering needed.
- [x] T012 [P] [US1] Add a capability entry if `tauri-plugin-single-instance`
      requires one (most single-instance plugins need no webview-side
      permission since it is a setup-time-only Rust API — verify against the
      plugin's docs at implementation time and add to
      `apps/desktop/src-tauri/capabilities/default.json` only if actually
      required). Verified against the vendored `tauri-plugin-single-instance
      2.4.2` crate: no `permissions/` schema directory and its README confirms
      it is a Rust-only, setup-time API with no frontend/webview surface — no
      capability entry added.
- [ ] T013 [US1] Manual verification: launch the built app, launch it again
      from a shortcut/CLI while running, confirm single window + focus
      (SC-001); repeat with the window minimized (US1 AS2).

**Checkpoint**: US1 fully functional and independently testable — ships first.

---

## Phase 4: User Story 2 - Favourites in the database (Priority: P1)

**Goal**: Target favourites are canonical, database-backed state.

**Independent Test**: Star a target, restart against the same DB, confirm the
star persists and is visible in the database, not `localStorage`.

**Depends on**: T005, T006 (Foundational).

### Tests for User Story 2

- [x] T014 [P] [US2] `cargo test` for the new repository functions
      (`list_favourites`/`add_favourite`/`remove_favourite`): add → present in
      list; add twice → single row, idempotent; remove → absent; remove of a
      never-favourited id → no-op, no error.
- [x] T015 [P] [US2] `cargo test` (or an integration test in
      `tests/contract`) exercising cascade delete: delete/retire a
      `canonical_target` row that has a favourite → `target_favourite` row is
      gone (FK `ON DELETE CASCADE`).

### Implementation for User Story 2

- [x] T016 [US2] Add `targets.favourites.list` / `targets.favourites.add` /
      `targets.favourites.remove` use-cases in
      `crates/app/targets/src/target_favourites.rs` (new file), calling the
      T006 repository functions; wire `target.not_found` for `add` against an
      unknown id (contracts/operations.md).
- [x] T017 [US2] Register the three commands with `tauri-specta` in
      `apps/desktop/src-tauri/src/lib.rs`'s command list; regenerate
      `apps/desktop/src/bindings/index.ts` (`cargo test -p desktop_shell`)
      and commit the regenerated bindings.
- [x] T018 [US2] Rewrite `apps/desktop/src/features/targets/useFavourites.ts`
      to call the new bindings instead of `localStorage`, **preserving the
      existing public hook shape** (`{ favouriteIds, toggle, isFavourite }`
      plus the non-hook `getFavouriteIds` export) so
      `apps/desktop/src/features/targets/TargetsTable.tsx` needs no change
      beyond removing the STUB comment. Handle the optimistic-update /
      re-fetch pattern consistent with other backend-backed hooks in this
      codebase.
- [x] T019 [P] [US2] Update `apps/desktop/src/features/targets/useFavourites.test.ts`
      for the new backend-backed behavior (mock the IPC bindings instead of
      `localStorage`/`StorageEvent`).
- [ ] T020 [US2] Remove the module-header STUB note in `useFavourites.ts` and
      close out task #54's cross-reference now that the FITS
      OBJECT→target linkage prerequisite is satisfied by this feature's own
      database-backed storage (confirm #54's actual blocking condition is
      met — if #54 was about something broader than storage location, note
      that distinction here rather than silently closing it).

**Checkpoint**: US2 fully functional — favourites survive restarts,
inspectable directly in SQLite.

---

## Phase 5: User Story 3 - Cleanup overrides in the database (Priority: P2)

**Goal**: Per-type cleanup action overrides are canonical, audited settings
state.

**Independent Test**: Change a per-type action, restart, confirm it persists
and produced exactly one audit event.

**Depends on**: T007 (Foundational).

### Tests for User Story 3

- [ ] T021 [P] [US3] `cargo test` for the new `ValidationRule` variant: valid
      map accepted; unknown data-type id rejected (`value.invalid`); invalid
      action string rejected; empty map accepted (all defaults apply).
- [ ] T022 [P] [US3] `cargo test` confirming `update_setting` for
      `cleanupTypeOverrides` emits exactly one `SettingsChanged`
      (`TOPIC_SETTINGS_CHANGED`) event on a real change and zero events on a
      no-op re-save of the identical map (SC-003).

### Implementation for User Story 3

- [ ] T023 [US3] Wire `apps/desktop/src/features/settings/Cleanup.tsx`'s
      `handleTableChange` to call `save('cleanup', { cleanupTypeOverrides: next })`
      (the same `save` prop already used for `blockPermanentDelete`/
      `defaultProtection`) instead of `saveActionsToStorage`; load initial
      state from the existing `getSettings({ scope: 'cleanup' })` call
      already present in the component (extend `applyValues` to read
      `cleanupTypeOverrides`) instead of `loadActionsFromStorage`.
- [ ] T024 [US3] Remove `ACTIONS_STORAGE_KEY`, `loadActionsFromStorage`,
      `saveActionsToStorage` from `Cleanup.tsx` once the backend path is
      wired and verified (FR-007).
- [ ] T025 [P] [US3] Update/add a vitest for `Cleanup.tsx` confirming an
      override change calls `save('cleanup', ...)` with the expected shape
      and that a reload (re-mount with `getSettings` returning the saved map)
      shows the override, not the fixture default.
- [ ] T026 [US3] Confirm the existing `warnedTypes` impact-warning banner
      logic (protected type set destructive) still functions unchanged
      against the backend-sourced `actions` state (US3 AS3) — no logic change
      expected, verification only.

**Checkpoint**: US3 fully functional — overrides persist and are audited.

---

## Phase 6: User Story 4 - Window-state persistence (Priority: P2)

**Goal**: Window size/position/maximized state survives restarts.

**Independent Test**: Resize/move, quit, relaunch, confirm restoration.

- [ ] T027 [US4] Register `tauri_plugin_window_state::Builder::default().build()`
      in `build_app()`, after single-instance (US1) so a redirected second
      launch never touches window-state's own store file for a window it
      isn't actually creating.
- [ ] T028 [US4] Add the plugin's required capability grant(s) (e.g.
      `window-state:default`, if the plugin exposes any webview-invokable
      surface — verify at implementation time) to
      `apps/desktop/src-tauri/capabilities/default.json`.
- [ ] T029 [US4] Confirm/enforce the minimum-size floor
      (`minWidth`/`minHeight` = 1100x720, already in `tauri.conf.json`) is
      still respected after the plugin restores a persisted size — add an
      explicit clamp in `build_app()`/`setup()` if the plugin does not already
      guarantee this (mirrors the `astro-up` reference's own explicit
      min-size enforcement after window-state restore — see research.md's
      cited `lib.rs` excerpt).
- [ ] T030 [US4] Add the off-screen-position fallback (US4 AS3, FR-013): on
      restore, if the persisted position is fully outside all current
      display bounds, reset to a centered/default position rather than
      accepting the plugin's raw restore (verify whether the plugin already
      handles this natively before adding app-level logic — avoid duplicating
      built-in behavior).
- [ ] T031 [US4] Manual verification across at least two of the three
      platforms: resize/move/maximize, restart, confirm restoration (SC-004);
      disconnect a second monitor the window was on, restart, confirm
      on-screen fallback.

**Checkpoint**: US4 fully functional.

---

## Phase 7: User Story 5 - Native application menu bar (Priority: P2)

**Goal**: A native menu with About/Settings/Quit/Window + a standard Edit
menu.

**Independent Test**: Open the native menu on each platform; confirm entries
and Edit-menu copy/paste/select-all work.

- [ ] T032 [US5] Build a `tauri::menu::Menu` in `build_app()`/`setup()` using
      `tauri::menu::{Menu, Submenu, PredefinedMenuItem, MenuItem}`: an
      App/PlateVault submenu (About, Settings, separator, Quit), a Window
      submenu (`PredefinedMenuItem::minimize`, `close_window`, etc., following
      the platform default set), and an Edit submenu
      (`PredefinedMenuItem::copy`, `paste`, `select_all`, `undo`/`redo` if
      appropriate for platform convention).
- [ ] T033 [US5] Wire the About and Settings menu items to whatever
      in-app navigation/dialog already exists for those surfaces (emit a
      frontend event the app shell already listens for, or open the existing
      Settings route) — reuse existing UI, do not build a new About dialog if
      one is not already planned elsewhere; if none exists, add the minimal
      native `about` `PredefinedMenuItem` (OS-provided About panel) as the
      placeholder rather than inventing new in-app UI (out of this spec's
      scope to design an About screen).
- [ ] T034 [US5] Wire Quit to the same shutdown path as the existing
      window-close control (FR-016) — verify no bypass of any existing
      close-confirmation logic (check for one before assuming none exists).
- [ ] T035 [US5] Explicitly verify (no code expected) that this task group
      does **not** touch any existing native/React context-menu code path
      (FR-017, US5 AS4).
- [ ] T036 [US5] Manual verification on macOS (global menu bar, Cmd+Q/Cmd+,
      conventions), Windows, and Linux: menu presence, Edit-menu
      copy/paste/select-all in a focused text field, Quit behavior.

**Checkpoint**: US5 fully functional.

---

## Phase 8: User Story 6 - Native window theme sync (Priority: P2)

**Goal**: Native chrome follows the active theme's light/dark family.

**Independent Test**: Switch all four themes; confirm native chrome matches
each theme's `mode`.

**Depends on**: T008 (Foundational `isTauri()` cleanup) so this uses the same
runtime check.

- [ ] T037 [US6] In `apps/desktop/src/data/theme.ts`, extend `applyTheme()`
      (or add a sibling called from the same call sites: `initAppearance()`,
      `setThemeChoice()`, and the `prefers-color-scheme` change listener) to
      call `getCurrentWindow().setTheme(mode === 'dark' ? 'dark' : 'light')`
      from `@tauri-apps/api/window`, using each theme's **already-existing**
      `mode: 'light' | 'dark'` field from the `THEMES` array — no new mapping
      table needed (research.md originally flagged this as a possible
      ambiguity; the existing `ThemeMeta.mode` field already resolves it
      exactly). Gate the call behind `core.isTauri()` (FR-020 — no-op outside
      Tauri / where unsupported).
- [ ] T038 [US6] Wrap the `setTheme` call so a platform/webview that throws or
      no-ops (Linux desktop environments per plan.md's platform-differences
      table) degrades silently — no error surfaced to the user (FR-020, US6
      AS2).
- [ ] T039 [P] [US6] Add/update a vitest confirming `applyTheme()`/theme-switch
      calls the native `setTheme` with the correct mode for each of the four
      themes when running under a mocked Tauri environment, and does not call
      it (or calls it as a no-op) outside Tauri.
- [ ] T040 [US6] Manual verification on Windows, macOS, and at least one
      Linux desktop environment: switch each of the four themes, confirm
      native chrome (where rendered) matches light/dark family (SC-005); on
      Linux, confirm the documented no-op is what actually happens (not a
      crash or partial application).

**Checkpoint**: US6 fully functional.

---

## Phase 9: User Story 7 - Diagnostics log file (Priority: P2)

**Goal**: A rotating, shareable log file exists alongside stdout logging.

**Independent Test**: Run the app, locate the log file, confirm rotation and
readability.

- [ ] T041 [US7] Register `tauri_plugin_log::Builder::new()` in `build_app()`
      configured with **both** a stdout target and a rotating file target
      (`tauri_plugin_log::Target::new(TargetKind::LogDir { file_name: None })`
      or equivalent, with a size/age-based `RotationStrategy`), so existing
      stdout behavior (`main.rs`'s `tracing_subscriber::fmt()` init) is
      preserved, not replaced (FR-021). Reconcile the two logging
      initializations (`tracing_subscriber` in `main.rs` vs. `tauri-plugin-log`,
      which itself is often bridged via the `tracing`/`log` facade) so
      messages are not duplicated or dropped — research the plugin's
      `tracing`-bridge feature flag at implementation time (research.md §c
      notes `2.8.0` "includes... tracing support").
- [ ] T042 [US7] Confirm the rotation policy is enforced (max file size and/or
      max file count) so the log directory never grows unbounded (FR-022,
      SC-006).
- [ ] T043 [P] [US7] Document the per-platform log location (already recorded
      in plan.md's platform-differences table) in whatever in-app "About" or
      "Diagnostics" surface exists (or the native About panel from T033, if a
      "reveal log folder" affordance is added — optional nice-to-have, not
      required by any FR).
- [ ] T044 [US7] Manual verification on all three platforms: run the app,
      locate the log file at the documented location, confirm readable
      recent entries and confirm the SQLite audit trail is unaffected/unchanged
      (FR-023).

**Checkpoint**: US7 fully functional.

---

## Phase 10: User Story 8 - OS notifications on long-task completion (Priority: P2)

**Goal**: Notifications on plan-apply, ingest-drain, and workflow-run
completion.

**Independent Test**: Trigger each of the three operations, confirm a
notification with focus elsewhere.

- [ ] T045 [US8] Register `tauri_plugin_notification::init()` in `build_app()`
      and add `notification:default` to
      `apps/desktop/src-tauri/capabilities/default.json`.
- [ ] T046 [US8] Add a notification call at the existing plan-apply
      completion point (`crates/app/core/src/plan_apply.rs`'s
      success/partial/failure outcome, surfaced via the existing `EventBus`)
      — extend the `run_app()` subscriber wiring in
      `apps/desktop/src-tauri/src/lib.rs` (plan.md's "Notification trigger
      wiring" section) to call `app.notification().builder()...show()` with
      an applied/failed/skipped summary (FR-024 AS1).
- [ ] T047 [US8] Add a notification call to `spawn_ingest_resolution_drain`
      (existing function in `lib.rs`) firing only when a pass resolved at
      least one pending item — not on every empty 30s tick (FR-024 AS2, "when
      it completes meaningful work").
- [ ] T048 [US8] Add a notification call alongside
      `app_core::project_manifests::spawn_workflow_run_subscriber`'s existing
      manifest-generation side effect (FR-024 AS2).
- [ ] T049 [US8] Ensure every notification call site handles a denied/unavailable
      permission or missing notification daemon gracefully (log at `debug`,
      continue) — never blocks or panics the task it is reporting on
      (FR-025, US8 AS3).
- [ ] T050 [P] [US8] `cargo test` (where feasible, using the plugin's
      testable API surface or by isolating the "should notify" decision logic
      — e.g. the "meaningful work" gate in T047 — into a pure, unit-testable
      function) covering: zero-resolved pass → no notification call; ≥1
      resolved → notification call attempted.
- [ ] T051 [US8] Manual verification: apply a plan, switch focus away,
      confirm notification within ~5s (SC-007); repeat for a triggered
      ingest-resolution drain and a workflow-run completion; test with OS
      notification permission denied to confirm graceful degradation.

**Checkpoint**: US8 fully functional.

---

## Phase 11: User Story 9 - Release builds behave like a native app (Priority: P2)

**Goal**: F5/reload, browser devtools shortcut, and native context menu are
suppressed in release builds only.

**Independent Test**: In a release build, confirm all three are inert; in a
dev build, confirm nothing changed.

**Depends on**: T008 (Foundational `isTauri()` cleanup, same shell file
family) for consistency, not a hard code dependency.

- [ ] T052 [US9] Register `tauri_plugin_prevent_default::init()` in
      `build_app()`, gated behind `#[cfg(not(debug_assertions))]` (mirroring
      the existing `#[cfg(debug_assertions)]` MCP-bridge pattern in the same
      file, inverted) so it is present in release builds and absent in dev
      builds (FR-026, US9 AS3).
- [ ] T053 [US9] Configure the plugin's flag set to cover: page reload
      (F5/Cmd+R and any browser-reload equivalents) and the native/browser
      right-click context menu; explicitly leave devtools-shortcut suppression
      scoped the same way (verify the plugin's default flag set already
      covers the OS devtools shortcut, or add it explicitly) — do not disable
      anything the app's own themed context menus or input handling rely on
      (Edge Cases: an in-app feature with its own right-click menu, or an
      input needing Ctrl/Cmd+A, must keep working).
- [ ] T054 [P] [US9] Manual verification in a release build: press the reload
      shortcut (no reload/state loss), right-click (no native menu; themed
      menus where present still work), confirm devtools shortcut is inert
      (SC-008); repeat in a dev build and confirm hot reload/devtools are
      unaffected (US9 AS3).

**Checkpoint**: US9 fully functional.

---

## Phase 12: User Story 10 - Signed auto-update (Priority: P3)

**Goal**: Application-side check/verify/install integration, ready against a
documented (placeholder) endpoint; signing keypair/CI pipeline stand-up is
tracked separately (research.md §a).

**Independent Test**: Against a locally-published signed test artifact,
confirm detect → verify → install; against a tampered one, confirm rejection.

- [x] T055 [US10] Add the `plugins.updater` block to
      `apps/desktop/src-tauri/tauri.conf.json` with a clearly-documented
      **placeholder** `pubkey` and the GitHub-Releases `latest.json` endpoint
      shape (research.md §a) — comment it as non-functional until the real
      keypair/pipeline exist.
- [x] T056 [US10] Register `tauri_plugin_updater::Builder::new().build()` in
      `build_app()`; add `updater:default` and `process:default` (for the
      relaunch-to-apply step) to
      `apps/desktop/src-tauri/capabilities/default.json`.
- [x] T057 [US10] Add a `check_for_app_update` helper (mirroring the cited
      `astro-up` `lib.rs` pattern in research.md §a): call
      `app.updater()?.check().await`, treat `Err` as "updater unavailable"
      (log at `debug`, non-fatal, FR-031), and on `Ok(Some(update))` emit a
      frontend-visible "update available" signal (event, matching the
      reference implementation's `update-available` event).
- [x] T058 [US10] Add a minimal frontend affordance (e.g. a Settings-page or
      toast surface) that listens for the update-available signal and offers
      the user an explicit "install" action calling
      `update.downloadAndInstall()` from `@tauri-apps/plugin-updater` — no
      silent/automatic install without user awareness (US10 AS1).
- [ ] T059 [US10] Verify (via the plugin's own behavior, which this task does
      not need to reimplement) that signature verification happens before
      install and that a failed verification aborts cleanly (FR-030); add a
      test artifact/manifest with a deliberately broken signature and confirm
      rejection end-to-end once a real keypair exists (blocked on the
      follow-up infra — record as a deferred verification if the keypair is
      not yet available at implementation time).
      **Deferred**: no real minisign keypair exists yet (T060 not built); this
      cannot be exercised until that follow-up lands.
- [ ] T060 [US10] **Follow-up, not implemented in this feature's commits**:
      generate a new PlateVault-specific minisign keypair; add
      `.github/workflows/release.yml` modeled on
      `~/dev/astro-up/.github/workflows/release.yml` (release-please +
      `tauri-apps/tauri-action` with `includeUpdaterJson: true`); replace the
      placeholder `pubkey`. Record this explicitly as a tracked follow-up
      task/issue rather than a commit in this branch, since (a) it needs
      release-please/CI ownership decisions this spec does not make, and (b)
      pushes touching `.github/workflows/**` are rejected for this branch's
      token.

**Checkpoint**: US10's app-side integration is complete and independently
verifiable against a manually-published test manifest; full end-to-end
production readiness depends on T060's follow-up infra.

---

## Phase 13: Polish & Cross-Cutting Verification

**Purpose**: Final sweep confirming the whole feature's constitution
compliance and success criteria, across all ten stories.

- [ ] T061 [P] Re-run `just lint`, `just test`, `just typecheck`, `just build`
      across the whole workspace after all stories land.
- [ ] T062 [P] Update `specs/037-e2e-integration-testing/contracts/coverage-matrix.md`
      per the repo's standing rule that new features add real-stack coverage
      — add entries (or explicit "manual-only, native-OS" notes) for each of
      the ten stories, consistent with how prior specs recorded
      native/manual-only coverage.
      Consider adding a `verify-on-windows`-style scenario doc for the
      native-OS-facing stories (US1, US4, US5, US6, US7, US8, US9) given how
      much of this feature cannot be asserted from Linux CI alone.
- [ ] T063 Re-check the Constitution gate from plan.md after all stories are
      implemented (not just at design time) — confirm no filesystem-mutation
      surface, PixInsight boundary, or contract-portability assumption was
      violated by the concrete implementation (plan.md's Constitution Check
      section is the checklist).
- [ ] T064 Confirm SC-010 by code audit: grep the frontend for any remaining
      read of the registered-source list from `localStorage` outside
      `sources-store.ts`'s documented wizard scope; record the audit result
      (clean, or the specific gap found and closed).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies.
- **Foundational (Phase 2)**: Depends on Setup — blocks US2, US3, and (loosely,
  for shared file/context) US6, US9.
- **US1 (Phase 3)**: Depends only on Setup. Ships first (P1, MVP).
- **US2 (Phase 4)**: Depends on Foundational T005/T006.
- **US3 (Phase 5)**: Depends on Foundational T007.
- **US4-US9 (Phases 6-11)**: Each depends only on Setup (plugin deps landed);
  independent of each other and of US1/US2/US3's data changes.
- **US10 (Phase 12)**: Depends on Setup; its full production readiness also
  depends on the out-of-band T060 follow-up.
- **Polish (Phase 13)**: Depends on all stories intended for this release
  being complete.

### Notes on parallelism

- Phases 3 (US1) through 12 (US10) touch almost entirely disjoint files
  (`lib.rs` plugin-registration lines aside, which are additive and can be
  sequenced by whoever lands first) and can be staffed in parallel once Setup
  + Foundational are done — this mirrors the task's original framing of each
  integration as independently decided and independently valuable.
- Within `apps/desktop/src-tauri/src/lib.rs`, note that T010 (US1), T027
  (US4), T032 (US5), T037-context (US6 is frontend-only), T041 (US7), T045
  (US8), T052 (US9), and T056 (US10) all add lines to the same
  `build_app()`/`run_app()` functions — real parallel *implementation* is
  fine, but the actual merge of these edits is inherently sequential at the
  file level (small, additive, low-conflict-risk diffs; not a reason to avoid
  parallelizing the underlying work).

## Implementation Strategy

### MVP First

1. Phase 1 (Setup) + Phase 2 (Foundational).
2. Phase 3 (US1, single-instance) — ship/validate independently; this is the
   one story with a genuine data-safety argument for going first.
3. Phase 4 (US2, favourites) and Phase 5 (US3, cleanup overrides) — the two
   constitution-driven data-ownership closures.
4. Phases 6-11 (US4-US9) — platform polish, any order, in parallel if staffed.
5. Phase 12 (US10) — last, given its infra dependency.
6. Phase 13 (Polish).

### Incremental Delivery

Each user story phase above ends with its own checkpoint and is independently
testable/demoable per spec.md's "Independent Test" for that story — this
feature was explicitly decided as a bundle of independently valuable
integrations, so partial delivery (e.g. shipping US1+US2 first, US10 much
later once infra exists) is an expected, supported outcome, not a fallback.
