default:
    @just --list

# Run Rust workspace tests. Frontend tests are added once the desktop app is planned.
test:
    cargo test --workspace

# Lint and format
lint:
    cargo fmt --all --check
    cargo clippy --workspace --all-targets -- -D warnings
    pre-commit run --all-files

# Build the Rust workspace. Desktop packaging is added after the Tauri plan lands.
build:
    cargo build --workspace

# Start the desktop app once Tauri/React dependencies are added by implementation tasks.
dev:
    @echo "Desktop dev server pending SpecKit plan/tasks for Tauri + React setup"

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
