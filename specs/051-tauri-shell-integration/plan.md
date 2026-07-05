# Implementation Plan: Tauri Shell Integration & Platform Polish

**Branch**: `051-tauri-shell-integration` | **Date**: 2026-07-05 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/051-tauri-shell-integration/spec.md`

## Summary

Adopt six Tauri shell integrations (single-instance guard, window-state
persistence, native theme sync, a rotating diagnostics log file, OS
notifications, a native application menu bar) plus signed auto-update as its
own, infra-dependent story; retire two hand-rolled shims (`__TAURI_INTERNALS__`
sniff, unguarded reload/native-context-menu in release builds); and move two
`localStorage`-only data stubs (target favourites, per-type cleanup action
overrides) into the canonical SQLite database. All of this lives at the
desktop-shell edge (`apps/desktop/src-tauri`, `apps/desktop/src`) plus two
small app-layer additions (a favourites use-case module in
`crates/app/targets`, a new stable settings key in `crates/app/settings`) and
one new shared crate (`crates/app/cache`). No product/domain crate outside
those two changes, and no PixInsight-adjacent behavior, is touched.

## Technical Context

**Language/Version**: Rust (workspace, edition 2021) for the Tauri shell and
app-layer crates; TypeScript 5.8 (React 19) for the frontend; both already in
place.

**Primary Dependencies**:

- Already pinned: `tauri = "2.11"` (resolved `2.11.2`), `@tauri-apps/api` `^2.9.0`,
  `tauri-plugin-dialog`/`tauri-plugin-opener` (existing), `moka = "0.12"`
  (existing, currently used directly by `crates/app/projects`).
- New (see `research.md` §c for exact confirmed versions): `tauri-plugin-single-instance`,
  `tauri-plugin-window-state` (+ `@tauri-apps/plugin-window-state`),
  `tauri-plugin-log` (+ `@tauri-apps/plugin-log`), `tauri-plugin-notification`
  (+ `@tauri-apps/plugin-notification`), `tauri-plugin-updater` (+
  `@tauri-apps/plugin-updater`, `@tauri-apps/plugin-process`),
  `tauri-plugin-prevent-default` (community, Rust-only).
- No new dependency for the native menu bar or native theme sync — both are
  already part of the pinned `tauri` core crate / `@tauri-apps/api` (`tauri::menu`,
  `WebviewWindow::set_theme` / `Window.setTheme()`).
- No new dependency for the `core.isTauri()` cleanup — already part of the
  pinned `@tauri-apps/api` `core` module.

**Storage**: SQLite via `persistence_db` (existing). One new table
(`target_favourite`, migration `0055`). No new table for cleanup overrides —
reuses the existing generic `settings` table (migration `0013`) via a new
stable key (`cleanupTypeOverrides`); see `research.md` §b. Window
size/position/maximized state is persisted by `tauri-plugin-window-state` in
its own store file under the platform app-data directory — **not** the app's
SQLite database (it is shell/UI-chrome state, not domain data).

**Testing**: `cargo test` (workspace + new/changed crates), existing vitest
suite for frontend changes (favourites hook, cleanup overrides wiring,
`isTauri()` call sites), Playwright/`tauri-driver` smoke coverage for
single-instance and window-chrome behavior where automatable (see
`docs/development/testing.md` Layer 1/2 split) — most of this feature is
Rust-shell/native-OS behavior that unit/integration tests cannot fully observe,
so manual verification via the `verify-on-windows`-style scenario is expected
for the native-OS-facing stories (see tasks.md polish phase).

**Target Platform**: Tauri desktop — Windows, macOS, Linux. Several stories
have real per-platform behavior differences; see "Platform differences" below.

**Project Type**: Desktop app (Tauri + React frontend, Rust core), monorepo —
matches the existing structure; no new top-level project type.

**Performance Goals**: All integrations are startup/one-shot or
low-frequency-event-driven (window resize/move debounced by the plugin itself,
theme change is user-triggered, notifications are per-completed-task, not
per-tick). No new hot-path/steady-state cost. The new `app_core_cache` crate
exists specifically to make future debounce/memoization cheap, not to add
overhead itself.

**Constraints**: Release binaries MUST NOT gain the `dev-tools`/`e2e` compile
gates' problems in reverse — i.e. `tauri-plugin-prevent-default`'s suppression
MUST be release-build-only (mirrors the existing `#[cfg(debug_assertions)]`
pattern already used for the MCP bridge plugin) so the dev workflow (hot
reload, devtools) is unaffected. The updater's public key/endpoint are
placeholder-safe (documented as non-functional until the real keypair/pipeline
exist — research.md §a) so this spec never ships a shippable-but-broken update
config. No change may cross the UI-to-core contract boundary except: (1) the
two new/changed settings surfaces (favourites, cleanup overrides), which
already are proper contracts, and (2) notification triggers, which are
backend-internal `EventBus` subscribers, not new IPC.

**Scale/Scope**: ~8 new/changed Cargo dependencies, 1 new migration, 1 new
Rust crate (`app_core_cache`, thin), 1 new app-layer module
(`crates/app/targets/src/target_favourites.rs`), 1 new settings descriptor
entry, ~2 IPC contract additions (favourites list/toggle) plus 1 existing-contract
extension (settings `cleanupTypeOverrides` key), frontend changes scoped to
`apps/desktop/src-tauri/src/lib.rs` (plugin registration + menu + notification
subscribers), `apps/desktop/src-tauri/tauri.conf.json` + `capabilities/default.json`,
`apps/desktop/src/data/theme.ts` (native sync hook), `apps/desktop/src/lib/window.ts`
(`isTauri()` swap), `apps/desktop/src/features/targets/useFavourites.ts`
(backend-backed rewrite), `apps/desktop/src/features/settings/Cleanup.tsx`
(overrides call-site swap), `apps/desktop/src/features/setup/sources-store.ts`
(verification only, no code change expected).

## Constitution Check

*GATE: Must pass before Phase 0 research and be rechecked after Phase 1 design.*

- **I. Local-First File Custody** — No raw/calibration/processed image files
  are touched, copied, or newly required into an app-private store by any part
  of this feature. Window-state, favourites, and cleanup overrides are all
  metadata/preference state, not image custody. ✅
- **II. Reviewable Filesystem Mutation** — This feature introduces **no new
  filesystem mutation**. Notifications react to the *completion* of
  already-reviewable, already-audited plan applies (spec 017/025) — they do
  not add, skip, or alter any approval/apply step. The one new audited write
  path (cleanup overrides, via the existing `settings.changed` audit event) is
  a *decision* record, not a filesystem action, and this spec explicitly does
  **not** wire it to plan generation (FR-010) — so no new class of
  filesystem mutation becomes reviewable-adjacent without its own future spec.
  ✅
- **III. PixInsight Boundary** — Untouched. No processing, calibration, or
  image-editing behavior is added or changed. ✅
- **IV. Research-Led Domain Modeling** — The two decisions genuinely requiring
  research (auto-update signing/endpoint shape; cleanup-override storage
  location) are recorded in `research.md` before this plan finalizes, per
  Principle IV. The remaining integrations (single-instance, window-state,
  log, notification, menu, theme sync, prevent-default) are shell/OS-chrome
  behavior with no plausible alternative domain model to weigh — they are
  scoped and versioned in `research.md` §c/§d for completeness, not because
  they are contested domain questions. ✅
- **V. Portable Contracts and Durable Records** — Favourites and cleanup
  overrides move from a non-durable, non-portable browser store into SQLite
  (durable) and existing/extended JSON-schema-shaped contracts (portable).
  Window-state, native menu, native theme sync, and the diagnostics log file
  are explicitly **desktop-shell-only** concerns with no UI-to-core contract
  surface and no equivalent in a hypothetical future non-desktop backend — this
  is called out, not silently assumed (see spec.md Assumptions). Notification
  triggers observe already-published, already-durable `EventBus` events; they
  add no new durable-record requirement of their own. ✅

**Result**: PASS. No complexity-tracking entries required — this feature adds
narrow, single-purpose Rust crates/modules and reuses existing generic
mechanisms (settings, audit, event bus) wherever the shape matches, rather than
introducing new bespoke infrastructure where an existing one already fits.

## Project Structure

### Documentation (this feature)

```text
specs/051-tauri-shell-integration/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md         # Phase 1 output
├── contracts/
│   └── operations.md     # Phase 1 output
└── tasks.md              # Phase 2 output
```

### Source Code (repository root)

```text
apps/desktop/src-tauri/
├── Cargo.toml                     # + 6 new plugin deps (single-instance,
│                                   #   window-state, log, notification,
│                                   #   updater, prevent-default)
├── tauri.conf.json                # + plugins.updater block (placeholder
│                                   #   pubkey/endpoint), window-state removes
│                                   #   the hardcoded width/height as the sole
│                                   #   source of truth (plugin takes over
│                                   #   after first run; defaults stay as the
│                                   #   documented first-run fallback)
├── capabilities/default.json      # + updater:default, notification:default,
│                                   #   process:default (relaunch-to-update)
└── src/
    ├── lib.rs                     # build_app(): register single-instance,
    │                               #   window-state, log, notification,
    │                               #   updater (behind a real-pubkey guard),
    │                               #   prevent-default (release-only);
    │                               #   construct the native Menu at setup.
    │                               # run_app(): notification-triggering
    │                               #   EventBus subscribers (plan-apply,
    │                               #   ingest-resolution drain, workflow-run
    │                               #   manifest completion).
    └── commands/                  # (no new commands beyond favourites;
                                    #  cleanup overrides reuse settings.*)

apps/desktop/src/
├── lib/window.ts                  # inTauri() → core.isTauri()
├── data/theme.ts                  # initAppearance()/applyTheme() also calls
│                                   #   the native setTheme(mode) when
│                                   #   core.isTauri() is true
├── features/targets/
│   ├── useFavourites.ts           # rewritten: backend-backed (IPC), same
│   │                               #   public hook shape so TargetsTable.tsx
│   │                               #   callers are unaffected
│   └── useFavourites.test.ts      # updated for the new backend
└── features/settings/
    └── Cleanup.tsx                # per-type action table now round-trips
                                    #   through save('cleanup', { cleanupTypeOverrides })
                                    #   instead of localStorage helpers

crates/app/targets/src/
├── target_favourites.rs           # NEW: list/add/remove use-cases
└── lib.rs                         # + re-export

crates/app/settings/src/
├── descriptors.rs                 # + `cleanupTypeOverrides` descriptor
│                                   #   (new ValidationRule variant: object
│                                   #   map of dataTypeId → Keep|Archive|Delete)
└── lib.rs                         # (no change expected — generic
                                    #  update_setting/get_settings already
                                    #  handle any registered key)

crates/app/cache/                  # NEW crate: app_core_cache
├── Cargo.toml
└── src/lib.rs                     # thin moka wrapper (TTL / debounce cache)

crates/persistence/db/
├── migrations/0055_target_favourites.sql   # NEW
└── repositories/target_favourites.rs        # NEW (or a module inside the
                                              #  existing targets repository
                                              #  file, matching current layout)

Cargo.toml                          # + crates/app/cache to workspace members
                                     # + moka dependency reference for the new
                                     #   crate (workspace dep already exists)
```

**Structure Decision**: Everything native/OS-facing (single-instance,
window-state, log, notification, updater, menu, theme sync, prevent-default,
the `isTauri()` swap) lives entirely in `apps/desktop/src-tauri` (Rust shell)
and `apps/desktop/src` (frontend shell glue) — none of it is a domain crate
concern. The two data-ownership migrations each land in the existing crate
that already owns that domain (`crates/app/targets` for favourites,
`crates/app/settings` for cleanup overrides) rather than a new crate, following
the "small crates, narrow responsibility" repository convention. The one
genuinely new crate, `app_core_cache`, is a leaf utility crate with zero
consumers required to change as part of this spec (it is additive
infrastructure other `app_core_*` crates may adopt later).

## Platform differences

| Concern | Windows | macOS | Linux |
|---|---|---|---|
| Single-instance | Works as documented (second-launch IPC via the plugin). | Works, but note macOS's own "already running" app-activation semantics may also apply at the OS level; the plugin still governs the Tauri-level focus/argv behavior. | Works; some window managers may not honor programmatic focus-raise identically — plugin still prevents the second process/DB-open. |
| Window-state | Full support. | Full support. | Full support, but on Wayland compositors that restrict programmatic window positioning, the *position* restore may be a no-op while *size* restore still works (a known Wayland platform limitation, not a bug in this feature) — this is why FR-013's off-screen fallback and general graceful-degradation framing matters. |
| Native theme sync | `Window.setTheme()` sets the titlebar/immersive-dark-mode chrome. | Sets the window appearance (`NSAppearance`) — affects titlebar and any native-drawn chrome (scrollbars, some system controls in web content are unaffected, which is expected — CSS theming already owns in-content look). | Native chrome theming has no consistent effect on most Linux desktop environments (GTK/Wayland compositors draw their own decorations) — this is the primary real-world case for FR-020's documented no-op. |
| Native menu bar | Rendered as the window's own menu bar (traditional Win32-style) or, depending on Tauri's default, may present as a compact menu — Edit/Window/About/Quit all present regardless. | Rendered as the **global** macOS menu bar (the conventional location); this is the platform where a missing menu bar is most conspicuous, and where `Cmd+Q`/`Cmd+,` conventions are strongest. | Rendered as a window-attached menu bar (GTK-style), consistent with other native Linux apps. |
| Diagnostics log location | `%APPDATA%/<identifier>/logs` (via `tauri-plugin-log`'s default `Target::LogDir`). | `~/Library/Logs/<identifier>`. | `~/.local/share/<identifier>/logs` (XDG). |
| Notifications | Native Action Center notifications; no separate runtime permission prompt typically required for unpackaged/dev builds but the packaged/signed app should still request permission gracefully. | Requires an explicit permission prompt (`Notification.requestPermission()`-equivalent via the plugin); denial must degrade gracefully per FR-025. | Depends on the desktop environment's notification daemon (e.g. `notify-send` backend); absence of a daemon must degrade gracefully, not crash. |
| Prevent-default | Applies uniformly (WebView2). | Applies uniformly (WKWebView). | Applies uniformly (WebKitGTK). |
| Auto-update | NSIS-preferred updater artifact (per `astro-up`'s `updaterJsonPreferNsis: true` precedent) once the pipeline exists. | `.app.tar.gz` + signature, standard Tauri updater bundle shape. | AppImage update bundle shape (Tauri updater support for Linux is bundle-format-dependent — confirm at pipeline-build time, since this is infra, not app-side, work). |

## Notification trigger wiring (no new IPC)

Per spec.md US8/FR-024, notifications are triggered from three points, all
already emitting durable `EventBus` events today (`crates/audit/src/bus.rs` +
existing publishers):

1. **Filesystem plan apply completion** — the existing plan-apply pipeline
   (`crates/app/core/src/plan_apply.rs`) already updates plan state
   (`applied`/`partially_applied`/`failed`) and is observable via the events
   table/live bus; a new subscriber in `run_app()` (mirroring the existing
   `start_inbox_plan_listener` / `spawn_workflow_run_subscriber` pattern in
   `apps/desktop/src-tauri/src/lib.rs`) reacts to that completion and calls
   `app.notification().builder()...show()`.
2. **Ingest-resolution background drain** — `spawn_ingest_resolution_drain`
   (already in `lib.rs`) already logs a summary each pass; extend it (or add a
   sibling subscriber) to fire a notification when a pass resolved at least one
   pending item (not on every empty 30s tick — FR-024 says "completes
   meaningful work").
3. **Workflow-run manifest generation** — `app_core::project_manifests::spawn_workflow_run_subscriber`
   (already wired in `run_app()`) already reacts to workflow-run completion;
   add the notification call alongside its existing manifest-generation side
   effect.

None of this adds a new Tauri command or contract — it is purely additional
side effects hung off event-bus subscribers/completions that already exist,
consistent with the constitution-check note above (no new filesystem-mutation
surface, no new UI-to-core contract).

## Complexity Tracking

*No constitution violations to justify — table intentionally omitted.*
