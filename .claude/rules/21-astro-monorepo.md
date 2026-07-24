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
- `crates/patterns/`: shared token-pattern parser and resolver (consumed by
  Inbox confirm pipeline, archive plans, and project source views).
- `crates/fs/inventory/`: filesystem scan records and root/path model.
- `crates/fs/planner/`: reviewable filesystem plan model.
- `crates/metadata/core/`: shared extracted metadata model.
- `crates/metadata/fits/`: FITS metadata extraction adapter boundary.
- `crates/metadata/xisf/`: XISF metadata extraction adapter boundary.
- `crates/metadata/video/`: planetary/lunar video metadata adapter boundary.
- `crates/audit/`: audit event model.
- `crates/persistence/core/`: Database, pool, WAL, migrations, shared audit-write primitives.
- `crates/persistence/calibration/`: calibration equipment, assignments, tolerances, calibration queries.
- `crates/persistence/inbox/`: inbox items, classification, metadata, source groups.
- `crates/persistence/lifecycle/`: lifecycle transitions, provenance, settings, onboarding, audit events, first-run.
- `crates/persistence/plans/`: plans, plan-apply, projects, artifacts, manifests, source views.
- `crates/persistence/targets/`: targets, framing, inventory, resolver queries, target-management queries.
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

The workspace Cargo manifest defines a `dev-tools` feature (default off) that
compile-time-gates the developer-mode surface from spec 021 (recording proxy,
`/dev/contracts` route, `dev.contracts.list` / `dev.calls.list` / `dev.export`
Tauri commands). Release binaries MUST omit the `dev-tools` feature so the
developer surface is absent at runtime, not merely hidden behind a flag.
