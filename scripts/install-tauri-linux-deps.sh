#!/usr/bin/env bash
# Install Tauri's Linux build/runtime packages with one bounded mirror retry.
set -euo pipefail

if (( $# == 0 )); then
  echo "usage: $0 PACKAGE [PACKAGE ...]" >&2
  exit 2
fi

# Hosted Ubuntu 24.04 uses a deb822 source with
# `URIs: mirror+file:/etc/apt/apt-mirrors.txt`. Change only the archive mirror
# for attempt two; keep security.ubuntu.com and all other source entries intact.
switch_archive_mirror() {
  local mirrors=/etc/apt/apt-mirrors.txt
  local sources=/etc/apt/sources.list.d/ubuntu.sources
  if [[ -f "$mirrors" ]]; then
    printf '%s\n' 'http://archive.ubuntu.com/ubuntu/' | sudo tee "$mirrors" >/dev/null
  elif [[ -f "$sources" ]]; then
    sudo sed -i 's|mirror+file:/etc/apt/apt-mirrors.txt|http://archive.ubuntu.com/ubuntu/|g; s|azure.archive.ubuntu.com|archive.ubuntu.com|g' "$sources"
  elif [[ -f /etc/apt/sources.list ]]; then
    sudo sed -i 's|azure.archive.ubuntu.com|archive.ubuntu.com|g' /etc/apt/sources.list
  else
    echo "No known Ubuntu source or mirror-list file found; retaining configured mirror." >&2
  fi
}

log_apt_mirror_activity() {
  local output=$1
  printf '%s\n' "$output" | grep -E '^(Get|Hit):' | sed -E 's#^(Get|Hit):[0-9]+ ([^ ]+).*#APT_SOURCE=\2#' | sort -u || true
}

for attempt in 1 2; do
  mirror=azure.archive.ubuntu.com
  if (( attempt == 1 )); then budget=5s; else budget=5m; fi
  if (( attempt == 2 )); then
    switch_archive_mirror
    mirror=archive.ubuntu.com
  fi
  echo "Installing Tauri Linux dependencies (attempt ${attempt}/2, initial mirror ${mirror}, budget ${budget}): $*"
  set +e
  output=$(timeout --signal=TERM --kill-after=30s "$budget" \
    bash -c 'sudo apt-get -o Acquire::http::Timeout=30 -o Acquire::Retries=2 update && sudo apt-get -o Acquire::http::Timeout=30 -o Acquire::Retries=2 install -y "$@"' _ "$@" 2>&1 | tee /dev/stderr)
  status=$?
  set -e
  log_apt_mirror_activity "$output"
  if (( status == 0 )); then
    exit 0
  fi
  if (( attempt == 2 )); then
    echo "Tauri Linux dependency installation failed after both mirrors (exit ${status})." >&2
    exit "$status"
  fi
  echo "Tauri Linux dependency installation failed on ${mirror} (exit ${status}); retrying once on archive.ubuntu.com." >&2
done
