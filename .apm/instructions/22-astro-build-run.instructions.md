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

## Testing strategy (real-stack)

Tests run in layers; put assertion load where it is cheapest and most reliable.
See `docs/development/testing.md` for the full guide.

- **Layer 1 — real-backend integration** (`just test-integration`, i.e.
  `cargo test --workspace`): real `app_core` use cases against real SQLite + real
  migrations, external network mocked only at its boundary (prefer the in-repo
  `FakeResolver`/`FakeSpawner` doubles). Deterministic, offline, all OS.
- **Layer 2 — full-stack E2E** (`just test-e2e`): the built app driven through
  its real UI → real IPC → real backend via `tauri-driver`. Smoke paths only.
  Required on Windows + Linux; best-effort on macOS (no official WKWebView
  WebDriver).

The mock runtime / `mockIPC` path is NOT a real-stack test — it fakes backend
responses. CI (`.github/workflows/ci.yml`) runs Layer 1 on all three OS on every
change, fast checks first.

New features MUST ship with real-stack coverage: add a Layer-1 test (and a
Layer-2 journey for primary user flows), and update the coverage mapping in
`specs/037-e2e-integration-testing/contracts/coverage-matrix.md`. Tests that
touch the filesystem use `tempfile::tempdir()` only — never real user libraries.
