#!/usr/bin/env bash
# Install Tauri's Linux build/runtime packages with one bounded retry.
set -euo pipefail

if (( $# == 0 )); then
  echo "usage: $0 PACKAGE [PACKAGE ...]" >&2
  exit 2
fi

# Each complete update+install attempt is bounded independently; caller steps
# use timeout-minutes: 10, enough for two attempts plus their kill grace.
for attempt in 1 2; do
  echo "Installing Tauri Linux dependencies (attempt ${attempt}/2): $*"
  set +e
  timeout --signal=TERM --kill-after=30s 4m \
    bash -c 'sudo apt-get update && sudo apt-get install -y "$@"' _ "$@"
  status=$?
  set -e
  if (( status == 0 )); then
    exit 0
  fi
  if (( attempt == 2 )); then
    echo "Tauri Linux dependency installation failed after two attempts (exit ${status})." >&2
    exit "$status"
  fi
  echo "Tauri Linux dependency installation failed (exit ${status}); retrying once." >&2
done
