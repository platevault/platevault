---
description: Astro Library Manager monorepo structure and ownership map.
applyTo: "**/*"
---

# Astro Monorepo Structure

The repository is a monorepo with a Tauri/React desktop app at the edge,
language-neutral contracts in `packages/contracts`, and granular Rust crates for
domain, metadata, filesystem, lifecycle, audit, and persistence boundaries.

Primary paths:

- `apps/desktop/`: Tauri + React desktop shell.
- `crates/domain/core/`: pure domain types and invariants.
- `crates/targeting/`: target catalog, aliases, observing-plan references.
- `crates/sessions/`: acquisition and calibration session concepts.
- `crates/calibration/core/`: calibration matching and reuse policy model.
- `crates/workflow/profiles/`: processing tool/workflow profile model.
- `crates/project/structure/`: app-owned project envelope rules.
- `crates/fs/inventory/`: filesystem scan records and root/path model.
- `crates/fs/planner/`: reviewable filesystem plan model.
- `crates/metadata/core/`: shared extracted metadata model.
- `crates/metadata/fits/`: FITS metadata extraction adapter boundary.
- `crates/metadata/xisf/`: XISF metadata extraction adapter boundary.
- `crates/metadata/video/`: planetary/lunar video metadata adapter boundary.
- `crates/audit/`: audit event model.
- `crates/persistence/db/`: persistence/repository boundary.
- `crates/contracts/core/`: Rust contract DTO boundary.
- `crates/app/core/`: application use-case orchestration boundary.
- `packages/contracts/`: language-neutral schemas and generated TypeScript
  surface.
- `docs/` and `docs/research/`: project documentation and technology/domain
  research.
- `specs/`: SpecKit feature artifacts.
- `tests/`: cross-crate and end-to-end tests.

Contracts are source-of-truth artifacts for future UI-to-core and possible
remote backend transport. Concrete schemas are produced during planning.

SQLite is the canonical local store for metadata, relationships, rules,
lifecycle, plans, and audit history. JSON Schema based operation contracts form
the transport boundary, with Tauri as the first adapter.
