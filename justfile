default:
    @just --list

# Run Rust workspace tests and package tests when present.
# cargo-nextest runs the unit/integration suite (faster, per-test output);
# `cargo test --doc` runs doctests, which nextest does not execute.
test:
    cargo nextest run --workspace
    cargo test --workspace --doc
    pnpm -r --if-present test
    node scripts/check-eslint-baseline.test.mjs

# Lint and format. The extra `rustfmt` call covers bootstrap/specta.rs, which
# `cargo fmt` cannot reach because it is `include!`d, not `mod`-declared.
lint:
    cargo fmt --all --check
    rustfmt --edition 2021 --check apps/desktop/src-tauri/src/bootstrap/specta.rs
    cargo clippy --workspace --all-targets -- -D warnings
    pnpm -r --if-present lint
    pre-commit run --all-files

# Build the Rust workspace and package workspaces when present.
build:
    cargo build --workspace
    pnpm -r --if-present build

# DB boundary ratchet — fail if production sqlx query/exec sites OUTSIDE
# crates/persistence/db EXCEED the checked-in baseline. Counts may only shrink.
# NOT YET wired into CI (see docs/development/persistence-layer-hardening.md
# and the PR that introduced this target for why). Regenerate the baseline
# after a refactor materially shuffles query sites:
#   bash scripts/check-db-boundary.sh --generate
db-boundary:
    bash scripts/check-db-boundary.sh

# Regenerate the sqlx offline query cache (.sqlx/) for compile-time verification.
# Requires a DATABASE_URL pointing at a migrated SQLite db, or run after the
# crate's migrations have been applied. Commit the resulting .sqlx/ dir so CI can
# build with SQLX_OFFLINE=true. NOTE: as of this writing the codebase uses only
# runtime-checked queries (sqlx::query/query_as, not the query!/query_as! macros),
# so `cargo sqlx prepare` currently has nothing to capture and is a no-op until a
# repository adopts the compile-time-checked macros. See
# docs/development/persistence-layer-hardening.md.
sqlx-prepare:
    cargo sqlx prepare --workspace -- --all-targets

# Type-check TypeScript workspaces when present.
typecheck:
    pnpm -r --if-present typecheck

# Generate contract TypeScript declarations from JSON Schema.
contracts-build:
    pnpm --filter @astro-plan/contracts build

# Regenerate Rust-derived JSON contract schemas and the tauri-specta
# TypeScript bindings, then fail when either is out of sync with the
# committed tree. Wire this into CI for spec 002 + onward.
check-generated:
    cargo run -q -p contracts_core --bin generate-contracts
    cargo test -q -p desktop_shell --features dev-tools --test bindings
    git diff --exit-code specs/*/contracts/*.generated.json apps/desktop/src/bindings/

# Full pre-merge gate: lint + tests + typecheck + generated-artifact drift.
check: lint test typecheck check-generated

# Placeholder fixture check hook.
fixtures-check:
    pnpm fixtures:check

# Start the desktop frontend dev server.
dev:
    pnpm --filter @astro-plan/desktop dev

# Start the Tauri desktop app in development mode (Rust + frontend).
# The dev overlay enables `withGlobalTauri`, required by the (debug-only) MCP
# bridge plugin; it is never applied to release builds.
tauri-dev:
    cd apps/desktop && pnpm tauri dev --config src-tauri/tauri.dev.conf.json

# Clean build artifacts
clean:
    cargo clean

# Speckit workflows (requires specify CLI)
speckit-full FEATURE INTEGRATION="codex":
    specify workflow run speckit-full -i feature_name={{FEATURE}} -i integration={{INTEGRATION}}

speckit-bugfix ISSUE INTEGRATION="codex":
    specify workflow run speckit-bugfix -i issue_number={{ISSUE}} -i integration={{INTEGRATION}}

speckit-tinyspec FEATURE INTEGRATION="codex":
    specify workflow run speckit-tinyspec -i feature_name={{FEATURE}} -i integration={{INTEGRATION}}

speckit-resume RUN_ID:
    specify workflow resume {{RUN_ID}}

speckit-status:
    specify workflow status

# Run all Rust workspace tests (integration layer).
test-integration:
    cargo nextest run --workspace
    cargo test --workspace --doc

# Run end-to-end tests against the real Tauri backend.
test-e2e:
    cd apps/desktop && pnpm test:e2e:real
