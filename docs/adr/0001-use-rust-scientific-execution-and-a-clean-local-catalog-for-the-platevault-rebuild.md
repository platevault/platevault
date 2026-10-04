<!-- Generated from a beads decision bead. Edit the bead, not this file:
     bd show astro-plan-trutg -->
---
number: 1
title: "Use Rust scientific execution and a clean local catalog for the PlateVault rebuild"
status: accepted
date: 2026-10-04
bead: astro-plan-trutg
spec: 064-library-inventory
---

# Use Rust scientific execution and a clean local catalog for the PlateVault rebuild

## Considered Options

Retain frontend astronomy-engine: it preserves the old interactive client path but would make durable backend planning and reminders depend on a second computation owner, contrary to the selected boundary. Incrementally retrofit legacy schema/orchestration: it retains conflicting location and session identity and is not required by the clean-catalog contract. Rewrite with no reuse: it discards verified pure calculations and format readers unnecessarily.

## Decision Outcome

Use Rust for scientific decoding, measurement and astronomical planning, a clean SQLite catalog for durable application records, and frontend presentation only. This supersedes ADR-0001 in docs/adr/0001-astronomy-compute-boundary.md for specs 063 through 072. Retain that file as the historical spec-044 decision.

### Rationale

The authorized autonomous rebuild requires one backend implementation for local catalog work, planning windows and reminders. The objective in specs/063-clean-rebuild-contract/autonomous-objective.md requires every non-deferred backend requirement and real development Tauri MCP verification. PLAN-FR-08 places calculation in Rust; the user selected frontend presentation only. ADR-0001 explicitly requires revisiting its frontend boundary when values become durable or support catalog-wide scoring, which planning and reminders now do. Existing qualified format, science and resolver modules remain selective reuse candidates. Their precision must be verified during implementation.

### Consequences

Rust APIs own inputs, numerical results, failure states and durable records. The frontend renders results and owns presentation interactions. This adds backend qualification and IPC work and may require reviewed shared-package changes. All old databases may be reset only under the objective's explicit authorization. Original images, credentials and unrelated work stay protected. No scientific/runtime accuracy is certified by this decision.

### Confirmation

Boundary acceptance is recorded in the autonomous objective and specs/072-observing-plans/spec.md PLAN-FR-08. Existing backend fixture evidence does not certify planning accuracy. Spec 072 requires its own numerical and real-app proof.
