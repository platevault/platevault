# Memory Index

This is a compact routing map for durable project memory (`docs/memory/`). Keep it short.

> [!NOTE]
> High-level project governance, constitution, and standards are stored in the **Governance Layer** at `.specify/memory/` and should be reviewed before technical planning.

## Architecture

- [System overview](ARCHITECTURE.md#system-overview) — Tauri 2 + React + granular Rust crates, SQLite local store
- [Boundaries](ARCHITECTURE.md#boundaries) — specta result wrappers, camelCase DTOs, mock mode
- [Risks](ARCHITECTURE.md#risks--complexity-hotspots) — binding drift, JsonAny fragility, path canonicalization gap

## Bugs

- [Specta result wrapper](BUGS.md#2026-05-26---specta-bindings-return-result-wrapper-not-raw-response) — unwrap `.data` after checking `.status`
- [camelCase DTO fields](BUGS.md#2026-05-26---serde-camelcase-rename-means-dto-fields-are-camelcase-in-ts) — use `completedAt` not `completed_at`
- [localStorage shape mismatch](BUGS.md#2026-05-26---localstorage-shape-mismatch-between-writer-and-reader) — single module authority for shared keys
- [WSLg + WebKitGTK](BUGS.md#2026-05-25---wslg-cannot-render-webkitgtk--tauri-windows) — test Tauri visually on native Windows only

## Decisions

- [Dotted command names](DECISIONS.md#2026-05-25---dotted-tauri-command-names-via-specta-rename) — `domain.action` via specta rename
- [Client-side validation only](DECISIONS.md#2026-05-26---client-side-validation-server-side-registration) — never register in a validate function
- [DB-first route gate](DECISIONS.md#2026-05-26---db-first-with-localstorage-cache-for-first-run-gate) — DB authority, localStorage cache
- [Contract schemas = Tauri pattern](DECISIONS.md#2026-05-26---contract-schemas-match-tauriispecta-pattern) — no envelope wrappers
- [JsonAny for untyped params](DECISIONS.md#2026-05-25---jsonany-wrapper-for-specta-annotated-command-parameters) — prevents specta stack overflow
- [Spec 030 is authoritative UI spec](DECISIONS.md#2026-05-26---spec-030-is-the-authoritative-ui-design-spec) — supersedes 027/028 for layout, nav, components
- [Hybrid layout model](DECISIONS.md#2026-05-26---hybrid-layout-model-sidebars-for-workflow-screens-top-bars-for-data-screens) — sidebars for Inbox+Projects, top bars elsewhere
- [5-phase project lifecycle](DECISIONS.md#2026-05-26---project-lifecycle-simplified-to-5-phases-prepared-removed) — Prepared removed, Ready auto-advances to Processing
- [Folder-level junctions with DATE_](DECISIONS.md#2026-05-26---source-view-junctions-at-folder-level-with-date_-prefix-keyword) — one junction per session, WBPP grouping keyword
- [6 source folder types](DECISIONS.md#2026-05-26---expanded-source-folder-types-6-types-not-4) — light_frames/dark/flat/bias/project/inbox
- [Session files join table](DECISIONS.md#2026-05-26---session-file-tracking-via-join-table) — explicit membership, not metadata matching
- [Equipment alias-based identity](DECISIONS.md#2026-05-26---equipment-identity-via-alias-based-uuid-matching) — FITS strings match aliases, survive renames
- [Archive = soft delete, no retention](DECISIONS.md#2026-05-26---archive-is-the-soft-delete-stage-no-retention-timer) — three manual steps, no timer
- [Inbox-only filesystem watcher](DECISIONS.md#2026-05-26---filesystem-watcher-inbox-only-additions--deletions--moves) — additions, deletions, moves; source folders lazy
- [Notes sync one-way for v1](DECISIONS.md#2026-05-26---notes-sync-is-db--disk-one-way-for-v1) — DB authority, disk is projection; [#139](https://github.com/nightwatch-astro/alm/issues/139) tracks future bidirectional
- [Profile switch regenerates source view](DECISIONS.md#2026-05-26---tool-profile-switch-regenerates-source-view-via-reviewable-plan) — reviewable plan to swap junctions

## Workflow

- [Reconciliation pattern](WORKLOG.md#2026-05-26---reconciliation-workflow-for-specs-that-predate-later-merges) — clarify stale specs before re-implementing
- [Parallel agent execution](WORKLOG.md#2026-05-26---parallel-agent-execution-saves-significant-time-on-large-specs) — check DAG for independent workstreams
