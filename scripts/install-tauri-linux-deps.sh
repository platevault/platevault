#!/usr/bin/env bash
# Install Tauri's Linux build/runtime packages with one bounded mirror retry.
set -euo pipefail

if (( $# == 0 )); then
  echo "usage: $0 PACKAGE [PACKAGE ...]" >&2
  exit 2
fi

# Ubuntu 24.04 hosted runners use deb822 sources at this path. Change only the
# Azure archive mirror for attempt two; preserve security.ubuntu.com and all
# other configured sources. Do not rewrite sources when the file is absent.
switch_archive_mirror() {
  local sources=/etc/apt/sources.list.d/ubuntu.sources
  if [[ -f "$sources" ]]; then
    sudo sed -i 's|azure.archive.ubuntu.com|archive.ubuntu.com|g' "$sources"
  elif [[ -f /etc/apt/sources.list ]]; then
    sudo sed -i 's|azure.archive.ubuntu.com|archive.ubuntu.com|g' /etc/apt/sources.list
  else
    echo "No known Ubuntu sources file found; retaining configured mirror." >&2
  fi
}

for attempt in 1 2; do
  mirror=azure.archive.ubuntu.com
  budget=5s
  if (( attempt == 2 )); then
    switch_archive_mirror
    mirror=archive.ubuntu.com
    budget=5m
  fi
  echo "Installing Tauri Linux dependencies (attempt ${attempt}/2, mirror ${mirror}, budget ${budget}): $*"
  set +e
  timeout --signal=TERM --kill-after=30s "$budget" \
    bash -c 'sudo apt-get -o Acquire::http::Timeout=30 -o Acquire::Retries=2 update && sudo apt-get -o Acquire::http::Timeout=30 -o Acquire::Retries=2 install -y "$@"' _ "$@"
  status=$?
  set -e
  if (( status == 0 )); then
    exit 0
  fi
  if (( attempt == 2 )); then
    echo "Tauri Linux dependency installation failed after both mirrors (exit ${status})." >&2
    exit "$status"
  fi
  echo "Tauri Linux dependency installation failed on ${mirror} (exit ${status}); retrying once on archive.ubuntu.com." >&2
done
