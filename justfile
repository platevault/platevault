default:
    @just --list

# Run Rust workspace tests and package tests when present.
test:
    cargo test --workspace
    pnpm -r --if-present test

# Lint and format
lint:
    cargo fmt --all --check
    cargo clippy --workspace --all-targets -- -D warnings
    pnpm -r --if-present lint
    pre-commit run --all-files

# Build the Rust workspace and package workspaces when present.
build:
    cargo build --workspace
    pnpm -r --if-present build

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
    cargo test -q -p desktop_shell --test bindings
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
    cargo test --workspace

# Run end-to-end tests against the real Tauri backend.
test-e2e:
    cd apps/desktop && pnpm test:e2e:real
