# Contracts: Spec 033 Validation Bugfix & Remediation

Language-neutral contract changes this feature introduces or reconciles. The canonical machine-readable
schemas live in `packages/contracts` and `crates/contracts/core`; these docs state the agreed shape and the
**conformance tests** that must enforce it (FR-025). No new product surfaces — these reconcile drift and add
the fields the remediation requires.

| Contract doc | Reconciles / adds | FR | Decision |
|---|---|---|---|
| [destructive-destination.md](./destructive-destination.md) | single `archive\|trash` vocab | FR-038, FR-006 | D1, D4 |
| [artifact-events.md](./artifact-events.md) | `artifact.classified` event + classify response shape | FR-009, FR-025 | D10 |
| [project-lifecycle.md](./project-lifecycle.md) | one canonical state + typed blocked reason | FR-019, FR-020 | D2 |
| [protection.md](./protection.md) | `source_id` on protected items + `protection.default.changed` | FR-016/017/018 | — |
| [log-viewer.md](./log-viewer.md) | `contractVersion`, `dia:` cursor, export status/path | FR-025 | — |
| [catalog.md](./catalog.md) | signature verify, license hard-fail, slug enum | FR-026/027/029 | D3, D5 |

## Conformance testing (FR-025)
Every contract here gets a JSON-Schema conformance test that validates **real runtime request/response
payloads** against the single agreed schema and **fails on drift**. These tests are part of the automated
suite (US9) and are referenced in `traceability-033.md`. Today there are *no* conformance tests — that
absence is why the 019/012/008 drift went unnoticed.
