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

# Port 5173 is NOT negotiable here, unlike the mock-mode Playwright suite which
# moved to a dedicated port (playwright.config.ts, #1117). The app binary loads
# its frontend from `devUrl` in src-tauri/tauri.conf.json, which is baked in at
# BUILD time — and `common/mod.rs::APP_URL` must stay byte-identical to it,
# because `localhost` and `127.0.0.1` are different web origins with separate
# localStorage (a mismatch ping-pongs the setup gate forever). So this runner
# must serve on exactly :5173, and the only safe response to that port being
# taken is to stop.
#
# Fail LOUDLY when it is occupied. Previously this ran `vite preview --port
# 5173` with no --strictPort: vite silently fell back to another port, the app
# still loaded localhost:5173, and the suite tested WHOEVER held that port —
# typically a concurrent worktree's interactive dev server (vite.config.ts
# hardcodes 5173 for `pnpm dev`). That produces phantom failures in unrelated
# journeys, which is worse than not running at all. Observed 2026-07-20: a
# local run silently exercised another worktree's build and reported errors
# that had nothing to do with the branch under test.
e2e_port=5173
if (command -v ss >/dev/null 2>&1 && ss -ltn 2>/dev/null | grep -q ":${e2e_port} ") ||
   (command -v lsof >/dev/null 2>&1 && lsof -iTCP:"${e2e_port}" -sTCP:LISTEN >/dev/null 2>&1); then
  holder=""
  if command -v ss >/dev/null 2>&1; then
    holder_pid="$(ss -ltnp 2>/dev/null | grep ":${e2e_port} " | grep -oE 'pid=[0-9]+' | head -1 | cut -d= -f2 || true)"
    [ -n "${holder_pid:-}" ] && holder="$(readlink "/proc/${holder_pid}/cwd" 2>/dev/null || true)"
  fi
  echo "ERROR: port ${e2e_port} is already in use${holder:+ by a process in ${holder}}." >&2
  echo "" >&2
  echo "The real-UI suite cannot use a different port: the app binary's devUrl" >&2
  echo "is compiled in as http://localhost:${e2e_port}. Running anyway would test" >&2
  echo "whatever build currently holds that port, not this worktree's." >&2
  echo "" >&2
  echo "Stop that server (often a 'pnpm dev' in another worktree) and retry." >&2
  exit 1
fi

(cd "$desktop_dir" && VITE_E2E=1 pnpm build)

# --strictPort: never silently drift to another port. Belt-and-braces with the
# preflight above, which cannot close the race between check and bind.
(cd "$desktop_dir" && exec pnpm exec vite preview --port "$e2e_port" --strictPort --host 127.0.0.1) &
preview_pid=$!
trap 'kill "$preview_pid" 2>/dev/null || true' EXIT

cd "$repo_root"
cargo build -p desktop_shell --features e2e
PV_DB_URL="${PV_DB_URL:-sqlite://./e2e-test.db?mode=rwc}" \
  cargo nextest run -p e2e_tests --profile e2e --run-ignored all --no-tests=warn
