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

# Placeholder fixture check hook.
fixtures-check:
    pnpm fixtures:check

# Start the desktop frontend dev server.
dev:
    pnpm --filter @astro-plan/desktop dev

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
