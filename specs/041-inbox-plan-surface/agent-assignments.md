# Agent Assignments — 041-inbox-plan-surface (single-type ingest iteration, Phase 12 & 13)

Generated: 2026-06-23 · Command: `/speckit.agent-assign.assign` · Scope: unstarted T061–T080 (T001–T060 already implemented)

Machine-readable source of truth: `agent-assignments.yml`. Validation: `agent-assignments.validated.md` (PASS).

| Task | Description | Agent | Issue |
|---|---|---|---|
| T061 | Migration 0047 — source-groups, sub-item identity, overrides | coder | #320 |
| T062 | Extend FITS+XISF extraction | rust-pro | #321 |
| T063 | Property registry module + `inbox.property_registry` | coder | #322 |
| T064 | Grouping engine — recipes, bucketing, tolerances | rust-pro | #323 |
| T065 | scan.rs — emit source-group rows, stay lazy | coder | #324 |
| T066 | classify.rs — materialize single-type sub-items | coder | #325 |
| T067 | Composite identity + signature stability tests | test-automator | #326 |
| T068 | reclassify.rs — field-agnostic map + bulk | coder | #328 |
| T069 | Override persistence + staleness | coder | #329 |
| T070 | Generalized missing-mandatory gate + needs-review | coder | #330 |
| T071 | confirm.rs — delete split/mixed; one rootId | coder | #331 |
| T072 | Contracts + binding regen | frontend-developer | #332 |
| T073 | Layer-1 + vitest tests (Phase 12) | test-automator | #333 |
| T080 | Flat↔light rotation matching + warning UI | frontend-developer | #334 |
| T074 | Coordinate target resolution + op | rust-pro | #335 |
| T075 | Target propagation to projects | coder | #336 |
| T076 | Drop session review lifecycle | frontend-developer | #337 |
| T077 | Migration handling for plan_open legacy items | coder | #338 |
| T078 | sync.conflicts vs 045/006/035; mark 045 superseded | default (orchestrator) | #339 |
| T079 | quickstart + Windows E2E (tauri MCP) | default (orchestrator) | #340 |

**Breakdown**: coder ×10 · rust-pro ×3 · frontend-developer ×3 · test-automator ×2 · default ×2.
