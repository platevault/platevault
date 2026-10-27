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
  local sources=(/etc/apt/sources.list /etc/apt/sources.list.d/*.sources /etc/apt/sources.list.d/*.list)
  local path
  local found=false
  for path in "${sources[@]}"; do
    [[ -f "$path" ]] || continue
    if grep -q 'azure.archive.ubuntu.com' "$path"; then
      sudo sed -i 's|azure.archive.ubuntu.com|archive.ubuntu.com|g' "$path"
      found=true
    fi
  done
  local mirrors=/etc/apt/apt-mirrors.txt
  if [[ -f "$mirrors" ]] && grep -q 'azure.archive.ubuntu.com' "$mirrors"; then
    sudo sed -i 's|azure.archive.ubuntu.com|archive.ubuntu.com|g' "$mirrors"
    found=true
  fi
  local remaining
  remaining=$(grep -rl 'azure.archive.ubuntu.com' /etc/apt/sources.list /etc/apt/sources.list.d /etc/apt/apt-mirrors.txt 2>/dev/null || true)
  if [[ -n "$remaining" ]]; then
    echo "Azure archive mirror remains configured after fallback rewrite: $remaining" >&2
    return 1
  fi
  if [[ "$found" != true ]]; then
    echo "No Azure archive URI found to rewrite; verify runner apt source layout." >&2
    return 1
  fi
}

log_apt_mirror_activity() {
  local output=$1
  printf '%s\n' "$output" | grep -E '^(Get|Hit):' | sed -E 's#^(Get|Hit):[0-9]+ ([^ ]+).*#APT_SOURCE=\2#' | sort -u || true
}

for attempt in 1 2; do
  mirror=azure.archive.ubuntu.com
  if (( attempt == 1 )); then budget=4m; else budget=5m; fi
  if (( attempt == 2 )); then
    switch_archive_mirror
    mirror=archive.ubuntu.com
    # A timeout during unpacking leaves dpkg interrupted, and apt refuses to
    # install until it is configured again.
    if ! sudo dpkg --configure -a; then
      echo "dpkg --configure -a failed after attempt 1; the package state is broken, so attempt 2 can't install." >&2
      exit 1
    fi
  fi
  echo "Installing Tauri Linux dependencies (attempt ${attempt}/2, initial mirror ${mirror}, budget ${budget}): $*"
  set +e
  output=$(set -o pipefail; timeout --signal=TERM --kill-after=30s "$budget" \
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
