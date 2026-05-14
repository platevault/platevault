---
description: Astro Library Manager build, test, lint, and repository workflow.
applyTo: "{Cargo.toml,crates/**,apps/**,packages/**,tests/**,scripts/**,justfile,package.json,pnpm-workspace.yaml}"
---

# Astro Build And Repository Workflow

Use the repo task runners:

- `just test`: runs `cargo test --workspace` and package tests when present.
- `just build`: runs `cargo build --workspace` and package builds when present.
- `just lint`: runs `cargo fmt --all --check`, `cargo clippy --workspace
  --all-targets -- -D warnings`, package lint scripts, and pre-commit.
- `just typecheck`: runs TypeScript package type checks.
- `just dev`: starts the desktop frontend dev server.

Branch strategy is feature branches off `main`; squash merge unless the project
later chooses another strategy.

Rust crates should compile independently. Avoid adding cross-crate dependencies
that force parser, UI, or persistence rebuilds for pure-domain changes.
