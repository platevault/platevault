#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
script="$repo_root/scripts/check-merged-pr-paths.sh"

if bash -n "$script"; then
  echo "ok: script passes bash syntax check"
else
  echo "FAIL: script has invalid Bash syntax" >&2
  exit 1
fi

bash "$script" --self-test

source "$script"
added_paths_for_pr() { return 1; }
if output=$(check_pr 999 2>&1); then
  echo "FAIL: check_pr ignored a file-list producer failure" >&2
  exit 1
elif [[ "$output" == *"could not read or validate its file list"* ]]; then
  echo "ok: check_pr reports a file-list producer failure"
else
  echo "FAIL: check_pr returned an unexpected producer-failure message" >&2
  exit 1
fi

echo "check-merged-pr-paths tests: PASS"
