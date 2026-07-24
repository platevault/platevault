# Quickstart: Tauri Backend Wiring

## Prerequisites

- Rust toolchain (stable, workspace edition)
- Node.js 20+ and pnpm
- Tauri CLI: `cargo install tauri-cli` (or via `@tauri-apps/cli` in package.json)
- System dependencies for Tauri: see https://v2.tauri.app/start/prerequisites/

## Running the App

### Frontend-only mode (mock data, no Rust)

```bash
just dev
# or: cd apps/desktop && VITE_USE_MOCKS=true npx vite
```

### Full Tauri mode (stub data from Rust backend)

```bash
just tauri-dev
# or: cd apps/desktop && cargo tauri dev
```

The first Tauri launch compiles the Rust backend (~60s). Subsequent launches
use cached builds (~5s).

### Custom database location

```bash
PV_DB_URL=sqlite:///tmp/test-alm.db just tauri-dev
```

## Verifying the Wiring

1. Launch with `just tauri-dev`
2. Navigate to each page — all should show data (stubs)
3. Open DevTools (Cmd+Shift+I) — console should have zero invoke errors
4. Check Rust logs: `RUST_LOG=debug just tauri-dev` — look for `stub: ...` lines

## Regenerating TypeScript Bindings

```bash
cargo test -p desktop_shell
# Bindings written to apps/desktop/src/bindings/index.ts
```

## Milestones

- **M1**: `cargo build -p desktop_shell` succeeds with all stub commands
- **M2**: `cargo test -p desktop_shell` generates bindings with 31 commands
- **M3**: `just typecheck` passes with frontend using generated bindings
- **M4**: `just tauri-dev` launches and all pages render with stub data
