#!/usr/bin/env bash
# Layer-2 real-UI E2E — local runner, mirrors .github/workflows/e2e.yml.
#
# Backs the `test:e2e:real` package.json script (invoked by `just test-e2e`,
# spec 037 T030/T032). Builds the frontend with VITE_E2E=1, serves it on
# :5173, builds desktop_shell with the `e2e` feature, then runs the
# thirtyfour+nextest suite (crates/e2e-tests). See that crate's README.md for
# prerequisites (`tauri-webdriver` on $PATH, Linux webview/GTK system deps).
#
# Linux/macOS only (bash) — matches spec 037 T038's "just test-e2e (Linux)"
# local gate; Windows verification runs in CI (e2e.yml).
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
desktop_dir="$(dirname "$script_dir")"
repo_root="$(cd "$desktop_dir/../.." && pwd)"

(cd "$desktop_dir" && VITE_E2E=1 pnpm build)

(cd "$desktop_dir" && exec pnpm exec vite preview --port 5173 --host 127.0.0.1) &
preview_pid=$!
trap 'kill "$preview_pid" 2>/dev/null || true' EXIT

cd "$repo_root"
cargo build -p desktop_shell --features e2e
ALM_DB_URL="${ALM_DB_URL:-sqlite://./e2e-test.db?mode=rwc}" \
  cargo nextest run -p e2e_tests --profile e2e --run-ignored all --no-tests=warn
