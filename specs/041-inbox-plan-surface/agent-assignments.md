# Agent Assignments — 041-inbox-plan-surface (destination-model iteration)

Generated: 2026-06-21 · Command: `/speckit.agent-assign.assign`

Canonical machine-readable source: [`agent-assignments.yml`](./agent-assignments.yml).
This markdown is a human-readable mirror.

## Agents scanned

| Agent | Source | Description |
|-------|--------|-------------|
| rust-pro | project | Rust 1.75+ systems/domain specialist |
| frontend-developer | project | React/TypeScript UI specialist |
| test-automator | project | Test authoring across frameworks |
| speckit-implement-task | project | Non-code / tightly scoped SpecKit tasks |

## Assignments (T048–T060)

| Task | Agent | Reason |
|------|-------|--------|
| T048 | speckit-implement-task | research.md decision record + attribute matrix (non-code spec artifact) |
| T049 | rust-pro | Per-type pattern resolver + selector in `crates/patterns` |
| T050 | rust-pro | Settings persistence in `crates/persistence/db` (SQLite) |
| T051 | frontend-developer | Settings UI for per-type patterns (`apps/desktop`) |
| T052 | rust-pro | `confirm.rs` pattern selection by resolved type |
| T053 | rust-pro | `confirm.rs` destination-root resolution |
| T054 | rust-pro | Contracts/bindings: optional `root_id` + absolute destination |
| T055 | frontend-developer | InboxDetail/PlanPanel root picker + absolute-path display |
| T056 | rust-pro | classify.rs/confirm.rs missing-path-attribute gate |
| T057 | frontend-developer | Frontend missing-attribute input gate (IMAGETYP flow) |
| T058 | test-automator | Layer-1 cargo tests |
| T059 | test-automator | vitest: picker, abs-path, gate |
| T060 | default | Windows real-app E2E via tauri MCP + coverage-matrix update |
