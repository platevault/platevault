# Astro Library Manager

Astro Library Manager is a local-first desktop application for astrophotography
library organization, acquisition/calibration metadata, target/session/project
mapping, processing-tool preparation, project lifecycle tracking, and safe
cleanup/archive planning.

## Agent Guidance

- Use SpecKit for product and implementation workflow. The active feature lives
  under `specs/001-astro-library-manager/`.
- Do not implement product behavior before the relevant SpecKit `plan.md`,
  `research.md`, `data-model.md`, `contracts/`, and `tasks.md` exist.
- Keep the initial scaffold dependency-light. Add heavy parser, database, Tauri,
  and UI dependencies only when the plan/tasks call for them.
- Preserve the product boundary: processing tools such as PixInsight/WBPP,
  planetary/lunar tools, and future Siril profiles process images/video; this
  app organizes, maps, prepares, observes, documents, and plans filesystem work.
- Prefer small Rust crates with narrow responsibility. This keeps unit tests
  fast and avoids rebuilding parser/UI/database dependencies for pure-domain
  changes.

## AGENTS Layering

- This root `AGENTS.md` applies to the whole repository unless a deeper file
  overrides it.
- `specs/AGENTS.md` applies to SpecKit artifacts.
- Add nested `AGENTS.md` files only for subtrees that need materially different
  rules.

## Codex Project Settings

- Project-scoped Codex overrides live in `.codex/config.toml`.
- Keep global/shared Codex behavior in `~/.codex/config.toml` and the
  chezmoi-managed source, not in this repo.

## Architecture

The repository is a monorepo with a Tauri/React desktop app planned at the edge,
language-neutral contracts in `packages/contracts`, and granular Rust crates for
domain, metadata, filesystem, lifecycle, audit, and persistence boundaries.

Initial scaffold is intentionally skeletal:

- Rust crates compile independently and avoid external dependencies for now.
- The desktop package is a placeholder until the SpecKit plan selects exact
  Tauri/React/Vite setup and dependency versions.
- Contracts are source-of-truth artifacts for future UI-to-core and possible
  remote backend transport; concrete schemas are produced during planning.

## Monorepo Structure

| Path | Contents |
|------|----------|
| `apps/desktop/` | Future Tauri + React desktop shell |
| `crates/domain/core/` | Pure domain types and invariants |
| `crates/targeting/` | Target catalog, aliases, observing-plan references |
| `crates/sessions/` | Acquisition and calibration session concepts |
| `crates/calibration/core/` | Calibration matching and reuse policy model |
| `crates/workflow/profiles/` | Processing tool/workflow profile model |
| `crates/project/structure/` | App-owned project envelope rules |
| `crates/fs/inventory/` | Filesystem scan records and root/path model |
| `crates/fs/planner/` | Reviewable filesystem plan model |
| `crates/metadata/core/` | Shared extracted metadata model |
| `crates/metadata/fits/` | FITS metadata extraction adapter boundary |
| `crates/metadata/xisf/` | XISF metadata extraction adapter boundary |
| `crates/metadata/video/` | Planetary/lunar video metadata adapter boundary |
| `crates/audit/` | Audit event model |
| `crates/persistence/db/` | Persistence/repository boundary |
| `crates/contracts/core/` | Rust contract DTO boundary |
| `crates/app/core/` | Application use-case orchestration boundary |
| `packages/contracts/` | Language-neutral schemas and generated TS surface |
| `docs/` | Project documentation and architecture notes |
| `docs/research/` | Technology and domain research |
| `specs/` | Feature specifications and SpecKit artifacts |
| `research/` | Broader research notes |
| `infra/` | Future infrastructure/package/distribution config |
| `tests/` | Cross-crate and end-to-end tests |
| `scripts/` | Build tooling and automation |
| `assets/` | Static assets |

## Build & Run

- `just test` runs `cargo test --workspace`.
- `just build` runs `cargo build --workspace`.
- `just lint` runs `cargo fmt --all --check`, `cargo clippy --workspace`, and
  `pre-commit run --all-files`.
- `just dev` currently reports that desktop dependencies are pending the
  SpecKit plan.

## Repo

- **Branch strategy**: feature branches off `main`, squash merge unless the
  project later chooses another strategy.

## Active Technologies
- Rust 2021 edition; TypeScript/React GUI; Tauri 2 desktop shell.
- SQLite for canonical local metadata, relationships, rules, lifecycle, plans,
  and audit history.
- JSON Schema based language-neutral operation contracts with Tauri as the first
  transport adapter.

## Recent Changes
- 001-astro-library-manager: Added SpecKit planning artifacts for the
  local-first desktop architecture, data model, contract strategy, filesystem
  safety model, and workflow profile approach.
