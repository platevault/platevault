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

## Workflow

- [Reconciliation pattern](WORKLOG.md#2026-05-26---reconciliation-workflow-for-specs-that-predate-later-merges) — clarify stale specs before re-implementing
- [Parallel agent execution](WORKLOG.md#2026-05-26---parallel-agent-execution-saves-significant-time-on-large-specs) — check DAG for independent workstreams
