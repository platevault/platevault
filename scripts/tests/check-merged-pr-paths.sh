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

# shellcheck source=scripts/check-merged-pr-paths.sh
source "$script"

declare -A fixture_base=()
declare -A fixture_merged=()
declare -A fixture_forward=()

pull_metadata() {
  local pr="$1"
  [ -n "${fixture_base[$pr]-}" ] || return 1
  printf '%s\t%s\n' "${fixture_base[$pr]}" "${fixture_merged[$pr]-}"
}

forwarding_pr_for_branch() {
  printf '%s\n' "${fixture_forward[$1]-none}"
}

assert_disposition() {
  local description="$1" pr="$2" expected="$3" actual
  actual=$(stack_disposition "$pr")
  if [ "$actual" = "$expected" ]; then
    echo "ok: $description"
  else
    echo "FAIL: $description: expected '$expected', got '$actual'" >&2
    exit 1
  fi
}

# PR #1296 merged into feat/sd-token-pipeline before root PR #1279. It must
# wait for the root, then become eligible for the ordinary path-history check.
fixture_base[1296]=feat/sd-token-pipeline
fixture_merged[1296]=2026-07-20T18:43:37Z
fixture_forward[feat/sd-token-pipeline]=1279
fixture_base[1279]=main
assert_disposition "child-before-root defers while PR #1279 is open" 1296 \
  "defer:base 'feat/sd-token-pipeline' is awaiting PR #1279 into 'main'"
fixture_merged[1279]=2026-07-21T00:43:36Z
assert_disposition "child-before-root checks after PR #1279 reaches main" 1296 check

# PR #1310 and root PR #1379 exercise the same legitimate chronology with a
# different stack, preventing the fixture from depending on one branch name.
fixture_base[1310]=061-selectable-app-language
fixture_merged[1310]=2026-07-20T18:43:28Z
fixture_forward[061-selectable-app-language]=1379
fixture_base[1379]=main
assert_disposition "second child-before-root defers while PR #1379 is open" 1310 \
  "defer:base '061-selectable-app-language' is awaiting PR #1379 into 'main'"
fixture_merged[1379]=2026-07-21T01:17:01Z
assert_disposition "second child-before-root checks after PR #1379 reaches main" 1310 check

# PR #1304 merged after PR #1296 had already forwarded its direct base. The
# open root is irrelevant: the child was absent from the forwarded snapshot.
fixture_base[1304]=feat/sd-foundation-outputs
fixture_merged[1304]=2026-07-20T20:37:16Z
fixture_forward[feat/sd-foundation-outputs]=1296
fixture_base[1296]=feat/sd-token-pipeline
fixture_merged[1296]=2026-07-20T18:43:37Z
fixture_merged[1279]=
assert_disposition "child-after-forwarded-base checks before the root lands" 1304 check

fixture_base[1400]=reused-base
fixture_merged[1400]=2026-07-20T20:00:00Z
fixture_forward[reused-base]=ambiguous
assert_disposition "ambiguous branch reuse defers instead of guessing" 1400 \
  "defer:multiple forwarding PRs match base 'reused-base'"

stack_disposition() { echo "defer:base 'feature' is awaiting PR #998 into 'main'"; }
added_paths_for_pr() {
  echo "FAIL: deferred PR fetched its file list" >&2
  return 1
}
if output=$(check_pr 999 2>&1) \
  && [[ "$output" == *"DEFER PR #999"* ]]; then
  echo "ok: check_pr defers before fetching paths"
else
  echo "FAIL: check_pr did not honor the stack deferral: $output" >&2
  exit 1
fi

stack_disposition() { echo check; }
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
