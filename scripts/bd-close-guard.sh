#!/usr/bin/env bash
# bd-close-guard.sh — verify a bead's fix is actually on origin/main before
# it is closed.
#
# Beads in this repo get closed on push, not on merge: a bead is marked
# closed as soon as its fix lands on a branch, then the branch's PR sits open
# for review and the bead is already gone from the ready queue. A 2026-07-20
# audit found 23 of 42 recently-closed beads (55%) had an open PR. This
# script is the read-only check that catches that before a `bd close`.
#
# GitHub's PR `state` field reports MERGED as soon as a PR merges into ITS
# base branch, which in this repo's stacked-PR workflow is routinely a
# feature branch, not `main`. Trusting `state == MERGED` reproduces the exact
# defect this guard exists to prevent: astro-plan-pjg was closed on the
# strength of PR #1310 reading MERGED, while #1310 merged into
# `061-selectable-app-language` and its commit was never on origin/main.
# "MERGED" is not "on main"; ancestry of the merge commit on origin/main is
# the only authoritative test, so that is what this script checks.
#
# PR resolution order:
#   1. `metadata.pr` on the bead (set by `bd update --metadata pr=<n>`).
#   2. A `PR #<n>` mention (case-insensitive) anywhere in `notes` +
#      `description`, but ONLY if exactly one distinct PR number is
#      mentioned. Bare `#<n>` is never matched: descriptions routinely
#      cross-reference other issues/PRs by number without those being THIS
#      bead's PR. Multiple distinct `PR #<n>` mentions (e.g. a bead that
#      narrates "PR #1268 already covers X; PR #1309 implements Y") are
#      genuinely ambiguous without metadata — picking the first one guessed
#      wrong on a real bead during development of this script (astro-plan-yxw
#      resolved to the unrelated #1268 instead of the actual fix, #1309), so
#      ambiguity is reported as UNKNOWN, never silently resolved.
# A bead with no resolvable PR is reported UNKNOWN, not skipped — an unjudged
# bead must never look the same as a passing one.
#
# Usage:
#   scripts/bd-close-guard.sh <bead-id> [<bead-id> ...]
#   scripts/bd-close-guard.sh --self-test
#
# Requires: bd, gh (authenticated), jq, git (with `origin` reachable — the
# script runs `git fetch origin main` before checking ancestry; a failed
# fetch degrades to checking against whatever local origin/main is already
# present, which can produce a false FAIL against a stale ref).
# Read-only: never calls `bd close`/`bd update`, never mutates GitHub state,
# never modifies the working tree (only updates the origin/main
# remote-tracking ref via fetch).
#
# Exit status: 0 only if every bead's fix commit is an ancestor of
# origin/main. Non-zero if any bead is OPEN, STACKED (merged into a non-main
# branch), UNKNOWN, or errored.
set -euo pipefail

REPO_DEFAULT="platevault/platevault"

# Extract every distinct `PR #<n>` mention (case-insensitive) from arbitrary
# text, one number per line. Deliberately does not match a bare `#<n>` — see
# header comment.
extract_pr_mentions() {
  grep -ioE 'PR #[0-9]+' <<<"$1" | grep -oE '[0-9]+' | sort -un || true
}

# Resolve the PR number for one bead's JSON (as produced by `bd show --json`,
# unwrapped from its enclosing array). Prints the number, or nothing if
# unresolvable (no mention, or more than one distinct mention).
resolve_pr_number() {
  local bead_json="$1" pr mentions
  pr=$(jq -r '.metadata.pr // empty' <<<"$bead_json")
  if [ -n "$pr" ] && [ "$pr" != "null" ]; then
    printf '%s\n' "$pr"
    return
  fi
  mentions=$(extract_pr_mentions "$(jq -r '(.notes // "") + "\n" + (.description // "")' <<<"$bead_json")")
  if [ -n "$mentions" ] && [ "$(wc -l <<<"$mentions")" -eq 1 ]; then
    printf '%s\n' "$mentions"
  fi
}

# Pure decision table: given a PR's `state`, its merge commit oid (empty if
# none), and whether that oid is an ancestor of origin/main
# (yes|no|not-applicable), decide the verdict. Kept side-effect-free so
# --self-test can exercise every branch, including the stacked-PR regression,
# without a network call. Prints "<CODE>:<detail>".
classify_pr() {
  local state="$1" merge_oid="$2" is_ancestor="$3"
  case "$state" in
    MERGED)
      if [ -z "$merge_oid" ] || [ "$merge_oid" = "null" ]; then
        # Seen on some squash/rebase merges where the API has not yet
        # attached a merge commit. Never silently pass an unverifiable merge.
        echo "ERROR:MERGED but no merge commit reported — cannot verify ancestry"
        return
      fi
      case "$is_ancestor" in
        yes) echo "PASS:" ;;
        no) echo "STACKED:" ;;
        *) echo "ERROR:could not verify ancestry" ;;
      esac
      ;;
    OPEN | CLOSED)
      echo "FAIL:$state, not merged"
      ;;
    *)
      echo "ERROR:unexpected PR state '$state'"
      ;;
  esac
}

check_one() {
  local id="$1" bead_json repo pr pr_json state base merge_oid is_ancestor verdict code detail
  if ! bead_json=$(bd show "$id" --json 2>/dev/null | jq -e '.[0]' 2>/dev/null); then
    echo "ERROR    $id   bd show failed (bad id, or bd unavailable)"
    return 1
  fi

  pr=$(resolve_pr_number "$bead_json")
  if [ -z "$pr" ]; then
    echo "UNKNOWN  $id   no PR reference in metadata/notes/description — cannot verify, do not close"
    return 1
  fi

  repo=$(jq -r '.metadata.repo // empty' <<<"$bead_json")
  repo="${repo:-$REPO_DEFAULT}"

  if ! pr_json=$(gh pr view "$pr" --repo "$repo" --json state,baseRefName,mergeCommit 2>/dev/null); then
    echo "ERROR    $id   could not look up PR #$pr on $repo (gh error or not found)"
    return 1
  fi
  state=$(jq -r '.state' <<<"$pr_json")
  base=$(jq -r '.baseRefName' <<<"$pr_json")
  merge_oid=$(jq -r '.mergeCommit.oid // empty' <<<"$pr_json")

  is_ancestor="n/a"
  if [ "$state" = "MERGED" ] && [ -n "$merge_oid" ]; then
    if git merge-base --is-ancestor "$merge_oid" origin/main 2>/dev/null; then
      is_ancestor="yes"
    else
      is_ancestor="no"
    fi
  fi

  verdict=$(classify_pr "$state" "$merge_oid" "$is_ancestor")
  code="${verdict%%:*}"
  detail="${verdict#*:}"

  case "$code" in
    PASS)
      echo "PASS     $id   PR #$pr merged into main, commit $merge_oid is on origin/main ($repo)"
      ;;
    STACKED)
      echo "FAIL     $id   PR #$pr merged into $base, not on origin/main — do not close ($repo)"
      return 1
      ;;
    FAIL)
      echo "FAIL     $id   PR #$pr is $detail ($repo) — do not close"
      return 1
      ;;
    ERROR)
      echo "ERROR    $id   PR #$pr — $detail"
      return 1
      ;;
  esac
}

self_test() {
  local fail=0

  # extract_pr_mentions: matches "PR #<n>", ignores bare "#<n>" cross-refs.
  local got
  got=$(extract_pr_mentions "See #1194 and #1048; fix landed as PR #1048." | tr '\n' ',')
  [ "$got" = "1048," ] && echo "ok: extract_pr_mentions prefers explicit PR mention" \
    || { echo "FAIL: extract_pr_mentions got '$got', want '1048,'"; fail=1; }

  got=$(extract_pr_mentions "Cross-references #1194 and #943 only, no PR mention.")
  [ -z "$got" ] && echo "ok: extract_pr_mentions ignores bare issue refs" \
    || { echo "FAIL: extract_pr_mentions should be empty, got '$got'"; fail=1; }

  # resolve_pr_number: metadata.pr wins over text mentions.
  got=$(resolve_pr_number '{"metadata":{"pr":42},"notes":"PR #99 still open","description":""}')
  [ "$got" = "42" ] && echo "ok: resolve_pr_number prefers metadata.pr" \
    || { echo "FAIL: resolve_pr_number got '$got', want 42"; fail=1; }

  # resolve_pr_number: falls back to notes, then description.
  got=$(resolve_pr_number '{"metadata":{},"notes":"Reopened: PR #1358 still open.","description":""}')
  [ "$got" = "1358" ] && echo "ok: resolve_pr_number falls back to notes" \
    || { echo "FAIL: resolve_pr_number got '$got', want 1358"; fail=1; }

  got=$(resolve_pr_number '{"metadata":{},"notes":"","description":"Fixed by PR #7."}')
  [ "$got" = "7" ] && echo "ok: resolve_pr_number falls back to description" \
    || { echo "FAIL: resolve_pr_number got '$got', want 7"; fail=1; }

  # resolve_pr_number: no mention anywhere -> empty (UNKNOWN path).
  got=$(resolve_pr_number '{"metadata":{},"notes":"","description":"No PR reference here."}')
  [ -z "$got" ] && echo "ok: resolve_pr_number is empty with no PR reference" \
    || { echo "FAIL: resolve_pr_number should be empty, got '$got'"; fail=1; }

  # resolve_pr_number: two distinct PR mentions with no metadata -> ambiguous,
  # empty (UNKNOWN path). Regression case: a real bead (astro-plan-yxw)
  # narrates "PR #1268 already covers X ... PR #1309 implements Y"; picking
  # the first mention silently resolved to the WRONG (merged) PR instead of
  # the actual fix.
  got=$(resolve_pr_number '{"metadata":{},"notes":"","description":"PR #1268 already covers X. PR #1309 implements Y."}')
  [ -z "$got" ] && echo "ok: resolve_pr_number refuses to guess between two distinct PR mentions" \
    || { echo "FAIL: resolve_pr_number should be empty (ambiguous), got '$got'"; fail=1; }

  # classify_pr: MERGED + ancestor of origin/main -> PASS.
  got=$(classify_pr "MERGED" "abc123" "yes")
  [ "$got" = "PASS:" ] && echo "ok: classify_pr PASSes a merge commit on origin/main" \
    || { echo "FAIL: classify_pr got '$got', want 'PASS:'"; fail=1; }

  # classify_pr: OPEN -> FAIL.
  got=$(classify_pr "OPEN" "" "n/a")
  [ "${got%%:*}" = "FAIL" ] && echo "ok: classify_pr FAILs an open PR" \
    || { echo "FAIL: classify_pr got '$got', want FAIL:*"; fail=1; }

  # classify_pr: MERGED but merge commit NOT an ancestor of origin/main ->
  # STACKED, not a generic FAIL. Regression case: astro-plan-pjg was closed
  # on PR #1310 reading state=MERGED; #1310 merged into
  # 061-selectable-app-language, and its commit was never on origin/main.
  got=$(classify_pr "MERGED" "abc123" "no")
  [ "$got" = "STACKED:" ] && echo "ok: classify_pr reports STACKED (merged into non-main base) distinctly, not a generic FAIL" \
    || { echo "FAIL: classify_pr got '$got', want 'STACKED:' (the astro-plan-pjg regression)"; fail=1; }

  # classify_pr: MERGED with no merge commit reported -> ERROR, never a
  # silent PASS.
  got=$(classify_pr "MERGED" "" "n/a")
  [ "${got%%:*}" = "ERROR" ] && echo "ok: classify_pr returns ERROR rather than silently passing a MERGED PR with no merge commit" \
    || { echo "FAIL: classify_pr got '$got', want ERROR:*"; fail=1; }

  if [ "$fail" -eq 0 ]; then
    echo "bd-close-guard self-test: PASS"
  else
    echo "bd-close-guard self-test: FAIL"
    return 1
  fi
}

main() {
  if [ "${1:-}" = "--self-test" ]; then
    self_test
    return $?
  fi
  if [ $# -eq 0 ]; then
    echo "usage: $0 <bead-id> [<bead-id> ...]" >&2
    echo "       $0 --self-test" >&2
    return 2
  fi

  # Ancestry checks below need an up-to-date local origin/main; a stale one
  # produces false FAILs (a commit merged since the last fetch reads as not
  # an ancestor). Degrade to a warning rather than aborting, since a
  # temporary network failure should not block every check.
  git fetch origin main --quiet 2>/dev/null \
    || echo "WARN: git fetch origin main failed — ancestry checks may use a stale local origin/main" >&2

  local overall=0
  for id in "$@"; do
    check_one "$id" || overall=1
  done
  return $overall
}

main "$@"
