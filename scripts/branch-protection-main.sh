#!/usr/bin/env bash
# Apply / inspect / remove branch protection on `main`.
#
# NOT APPLIED AUTOMATICALLY. The config lives in
# `scripts/branch-protection-main.json` so the required contexts are reviewable
# in a PR rather than living only in GitHub's UI, and so re-applying after a
# job rename is a one-liner instead of a click-path.
#
# Why each setting:
#
#   strict: true          Branches must be up to date with main before merging.
#                         Costly while main churns, correct once it settles.
#   enforce_admins: false Sole maintainer needs an override path when a runner
#                         or an upstream dependency breaks.
#   reviews: null         Solo repo; a required-review rule would just block.
#
# Required contexts are the PARENT jobs, never the individual shards: the
# `Real-UI journeys (L3) — <os>` gates already depend on their shards, so
# requiring shards as well would add nothing and would break whenever the shard
# count changes.
#
# Excluded on purpose:
#   Real-UI journeys (L3) — macos-latest   blocked upstream, see issue #489
#                                          (tauri-plugin-webdriver)
#   Unit + integration (L1+L2) — macos-latest
#                                          Held out only while the frontend
#                                          suite still runs on Rust-only PRs.
#                                          NOTE: issue #489 is about the E2E
#                                          macOS leg, NOT this one — the two
#                                          were previously conflated. Recent
#                                          history is 3 success / 3 cancelled /
#                                          2 failure, and both failures were
#                                          attributable (a frontend flake
#                                          dragged in by force_full, and a
#                                          paraglide bug). Reconsider including
#                                          it once those have landed.
#
# A context whose job is SKIPPED counts as satisfied by branch protection, so
# docs-only PRs do not hang. That is why `e2e.yml` gates whole JOBS with a
# job-level `if:` rather than step-level conditions — see the comment near the
# top of that workflow. Do not convert those to step-level.
#
# Usage:
#   scripts/branch-protection-main.sh show     # current protection (or 404)
#   scripts/branch-protection-main.sh apply    # PUT the config
#   scripts/branch-protection-main.sh remove   # DELETE protection
#   scripts/branch-protection-main.sh verify   # apply-time sanity checks only
set -euo pipefail

REPO="${REPO:-platevault/platevault}"
BRANCH="${BRANCH:-main}"
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
CONFIG="$here/branch-protection-main.json"

# The context strings contain U+2014 EM DASH, not a hyphen. A hyphen produces a
# required context that never reports, which leaves every PR pending forever.
verify_contexts() {
  # Only the SEPARATOR matters. Hyphens inside a word are fine
  # ("UI mock-mode (Playwright)", "ubuntu-latest"); the failure mode is a
  # spaced hyphen " - " where the job name uses " — ".
  local bad=0
  while IFS= read -r ctx; do
    case "$ctx" in
      *" - "*) echo "  WARN: '$ctx' uses ' - ' as a separator; job names use ' — ' (U+2014)" >&2; bad=1 ;;
    esac
  done < <(python3 -c '
import json,sys
print("\n".join(json.load(open(sys.argv[1]))["required_status_checks"]["contexts"]))' "$CONFIG")
  return $bad
}

# Guard against protecting on names no workflow produces.
verify_names_exist() {
  local missing=0
  local names
  names=$(grep -hoE "^    name: .*" "$here/../.github/workflows/ci.yml" \
                                    "$here/../.github/workflows/e2e.yml" \
          | sed 's/^    name: //')
  while IFS= read -r ctx; do
    # matrix jobs appear in source as `... — ${{ matrix.os }}`
    local stem="${ctx% — *}"
    if ! printf '%s\n' "$names" | grep -qF "$stem"; then
      echo "  WARN: no workflow job matches '$ctx' (stem '$stem')" >&2
      missing=1
    fi
  done < <(python3 -c '
import json,sys
print("\n".join(json.load(open(sys.argv[1]))["required_status_checks"]["contexts"]))' "$CONFIG")
  return $missing
}

case "${1:-show}" in
  show)
    gh api "repos/$REPO/branches/$BRANCH/protection" 2>&1 || true
    ;;
  verify)
    echo "Checking $CONFIG"
    verify_contexts && echo "  contexts: em dash OK"
    verify_names_exist && echo "  contexts: all match a workflow job name"
    ;;
  apply)
    verify_contexts || { echo "refusing to apply: hyphen/em-dash problem" >&2; exit 1; }
    verify_names_exist || echo "  (continuing despite name warnings)"
    gh api -X PUT "repos/$REPO/branches/$BRANCH/protection" --input "$CONFIG"
    ;;
  remove)
    gh api -X DELETE "repos/$REPO/branches/$BRANCH/protection"
    ;;
  *)
    echo "usage: $0 {show|verify|apply|remove}" >&2
    exit 2
    ;;
esac
