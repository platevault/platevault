#!/usr/bin/env bash
# Check that files newly added by recently merged PRs still exist on main.
#
# A merged PR can be lost when a child PR lands on a feature branch after that
# branch was already forwarded to main. The path is a real signal only when it
# has never appeared in main's history: a missing path with history was
# deliberately deleted or renamed later and is not a lost merge.
#
# Usage:
#   scripts/check-merged-pr-paths.sh
#   WINDOW_DAYS=14 scripts/check-merged-pr-paths.sh
#   scripts/check-merged-pr-paths.sh --self-test
#
# Requires: gh (authenticated), jq, git, and a complete checkout containing
# origin/main. The script reads GitHub state and local Git history only.
set -euo pipefail

REPO="${REPO:-${GITHUB_REPOSITORY:-platevault/platevault}}"
MAIN_REF="${MAIN_REF:-origin/main}"
WINDOW_DAYS="${WINDOW_DAYS:-14}"

die() {
  echo "ERROR: $*" >&2
  return 1
}

validate_window() {
  case "$WINDOW_DAYS" in
    ''|*[!0-9]*) die "WINDOW_DAYS must be a non-negative integer" ;;
  esac
}

iso_epoch() {
  date -u -d "$1" +%s
}

# Return success when a timestamp is inside the inclusive sweep window.
merged_in_window() {
  local merged_at="$1" merged_epoch
  merged_epoch=$(iso_epoch "$merged_at") || return 1
  [ "$merged_epoch" -ge "$SINCE_EPOCH" ] && [ "$merged_epoch" -le "$NOW_EPOCH" ]
}

# Load one validated pull-request snapshot. Keeping every stacked child in the
# snapshot makes deferrals durable without repeated metadata API calls.
load_pull_snapshot() {
  local pages
  pages=$(gh api --paginate --method GET \
    "/repos/${REPO}/pulls" \
    -f state=all \
    -f sort=updated \
    -f direction=desc \
    -f per_page=100) || return 1
  PULL_SNAPSHOT=$(jq -s -c '
    if all(.[];
      type == "array"
      and all(.[];
        (.number | type == "number" and floor == .)
        and (.state | type == "string")
        and (.base.ref | type == "string" and length > 0)
        and (.head.ref | type == "string" and length > 0)
        and (.merged_at == null or (.merged_at | type == "string" and length > 0))
      )
    ) then add else error("invalid pull-request snapshot") end
  ' <<<"$pages") || return 1
}

# Print recently merged main PRs plus every merged stacked PR. Old stacked PRs
# are cheap metadata-only candidates until their eligibility reaches the sweep
# window; this prevents a deferred child from aging out before its root lands.
merged_pr_numbers() {
  jq -r --argjson since "$SINCE_EPOCH" --argjson until "$NOW_EPOCH" '
      .[]
      | select(.merged_at != null)
      | select(
          .base.ref != "main"
          or (
            (.merged_at | fromdateiso8601) >= $since
            and (.merged_at | fromdateiso8601) <= $until
          )
        )
      | .number
    ' <<<"$PULL_SNAPSHOT"
}

# Print selected paths as a NUL-delimited stream. GitHub REST calls these
# entries "added"; additions > 0 excludes malformed/empty additions records.
added_paths_for_pr() {
  local pr="$1" files
  files=$(gh api --paginate "/repos/${REPO}/pulls/${pr}/files?per_page=100") || return 1
  jq -e '
    type == "array"
    and all(.[];
      (.filename | type == "string" and length > 0)
      and (.status | type == "string")
      and (.additions | type == "number" and floor == .)
    )
  ' >/dev/null <<<"$files" || return 1
  jq -j '
    .[]
    | select(.status == "added" and .additions > 0)
    | .filename, "\u0000"
  ' <<<"$files"
}

# Print a pull request's base branch and merge timestamp as tab-separated
# fields. An empty timestamp means the pull request has not merged.
pull_metadata() {
  local pr="$1" response
  if [ -n "${PULL_SNAPSHOT:-}" ]; then
    jq -r --argjson pr "$pr" '
      [.[] | select(.number == $pr)]
      | if length == 1
        then [.[0].base.ref, (.[0].merged_at // "")] | @tsv
        else error("pull request absent or duplicated in snapshot")
        end
    ' <<<"$PULL_SNAPSHOT"
    return
  fi
  response=$(gh api "/repos/${REPO}/pulls/${pr}") || return 1
  jq -e '
    type == "object"
    and (.base.ref | type == "string" and length > 0)
    and (.merged_at == null or (.merged_at | type == "string" and length > 0))
  ' >/dev/null <<<"$response" || return 1
  jq -r '[.base.ref, (.merged_at // "")] | @tsv' <<<"$response"
}

# Identify the one active or merged PR that forwards a branch. Closed,
# unmerged attempts cannot carry the branch toward main. Branch reuse is
# deliberately treated as ambiguous instead of guessing at chronology.
forwarding_pr_for_branch() {
  local branch="$1" owner response
  if [ -n "${PULL_SNAPSHOT:-}" ]; then
    jq -r --arg branch "$branch" '
      [
        .[]
        | select(.head.ref == $branch)
        | select(.state == "open" or .merged_at != null)
        | .number
      ]
      | if length == 1 then .[0]
        elif length == 0 then "none"
        else "ambiguous"
        end
    ' <<<"$PULL_SNAPSHOT"
    return
  fi
  owner=${REPO%%/*}
  response=$(gh api --paginate --method GET \
    "/repos/${REPO}/pulls" \
    -f state=all \
    -f head="${owner}:${branch}" \
    -f per_page=100) || return 1
  jq -s -e '
    all(.[];
      type == "array"
      and all(.[];
        (.number | type == "number" and floor == .)
        and (.state | type == "string")
        and (.head.ref | type == "string" and length > 0)
        and (.merged_at == null or (.merged_at | type == "string" and length > 0))
      )
    )
  ' >/dev/null <<<"$response" || return 1
  jq -s -r --arg branch "$branch" '
    [
      .[][]
      | select(.head.ref == $branch)
      | select(.state == "open" or .merged_at != null)
      | .number
    ]
    | if length == 1 then .[0]
      elif length == 0 then "none"
      else "ambiguous"
      end
  ' <<<"$response"
}

# Print whether a merged PR is ready for path checks and the timestamp when it
# became eligible. A child that merged
# before its base branch was forwarded follows that forwarding PR toward main;
# it is deferred while any forwarding PR remains open. A child that merged
# after its base was forwarded is checked immediately because that forwarding
# could not have included the child (the lost-merge chronology from PR #1304).
stack_disposition() {
  local pr="$1" trail="${2:-:}" metadata base merged_at parent parent_metadata
  local parent_base parent_merged_at merged_epoch parent_epoch

  if [[ "$trail" == *":${pr}:"* ]]; then
    echo "ERROR PR #${pr}: cycle in stacked-PR forwarding chain" >&2
    return 1
  fi
  trail="${trail}${pr}:"

  metadata=$(pull_metadata "$pr") || {
    echo "ERROR PR #${pr}: could not read or validate pull-request metadata" >&2
    return 1
  }
  IFS=$'\t' read -r base merged_at <<<"$metadata"
  if [ -z "$merged_at" ]; then
    echo "ERROR PR #${pr}: sweep selected a pull request without a merge timestamp" >&2
    return 1
  fi
  if [ "$base" = "main" ]; then
    echo "check:${merged_at}"
    return 0
  fi

  parent=$(forwarding_pr_for_branch "$base") || {
    echo "ERROR PR #${pr}: could not resolve forwarding PR for base '${base}'" >&2
    return 1
  }
  case "$parent" in
    none)
      echo "defer:no forwarding PR identifies base '${base}'"
      return 0
      ;;
    ambiguous)
      echo "ERROR PR #${pr}: multiple forwarding PRs match base '${base}'" >&2
      return 1
      ;;
  esac

  parent_metadata=$(pull_metadata "$parent") || {
    echo "ERROR PR #${pr}: could not read forwarding PR #${parent}" >&2
    return 1
  }
  IFS=$'\t' read -r parent_base parent_merged_at <<<"$parent_metadata"
  if [ -z "$parent_merged_at" ]; then
    echo "defer:base '${base}' is awaiting PR #${parent} into '${parent_base}'"
    return 0
  fi

  merged_epoch=$(iso_epoch "$merged_at") || return 1
  parent_epoch=$(iso_epoch "$parent_merged_at") || return 1
  if [ "$merged_epoch" -gt "$parent_epoch" ]; then
    echo "check:${merged_at}"
    return 0
  fi
  stack_disposition "$parent" "$trail"
}

# Classify one repo-relative path against main:
#   present    — currently exists on main
#   historical — absent now, but appeared in main's history
#   never      — absent from main and from its entire history
path_state() {
  local path="$1"
  if git cat-file -e "${MAIN_REF}:${path}" 2>/dev/null; then
    echo present
  elif git log --format=%H -1 "$MAIN_REF" -- "$path" | grep -q .; then
    echo historical
  else
    echo never
  fi
}

check_pr() {
  local pr="$1" path state disposition eligible_at eligible_epoch missing=0 count=0 path_file
  local -a paths=()
  if ! disposition=$(stack_disposition "$pr"); then
    echo "ERROR PR #${pr}: could not establish stacked-PR chronology" >&2
    return 1
  fi
  case "$disposition" in
    check:*)
      eligible_at=${disposition#check:}
      eligible_epoch=$(iso_epoch "$eligible_at") || {
        echo "ERROR PR #${pr}: invalid eligibility timestamp '${eligible_at}'" >&2
        return 1
      }
      if [ "$eligible_epoch" -gt "$NOW_EPOCH" ]; then
        echo "ERROR PR #${pr}: eligibility timestamp is after the sweep time" >&2
        return 1
      fi
      if [ "$eligible_epoch" -lt "$SINCE_EPOCH" ]; then
        return 3
      fi
      ;;
    defer:*)
      echo "DEFER PR #${pr}: ${disposition#defer:}"
      return 2
      ;;
    *)
      echo "ERROR PR #${pr}: unknown stack disposition '${disposition}'" >&2
      return 1
      ;;
  esac
  # Capture through a file because process substitution hides producer errors.
  path_file=$(mktemp)
  if ! added_paths_for_pr "$pr" >"$path_file"; then
    rm -f "$path_file"
    echo "ERROR PR #${pr}: could not read or validate its file list" >&2
    return 1
  fi
  if ! mapfile -d '' -t paths <"$path_file"; then
    rm -f "$path_file"
    echo "ERROR PR #${pr}: could not read or validate its file list" >&2
    return 1
  fi
  rm -f "$path_file"

  for path in "${paths[@]}"; do
    count=$((count + 1))
    state=$(path_state "$path")
    case "$state" in
      present)
        echo "OK   PR #${pr} ${path} (present on main)"
        ;;
      historical)
        echo "OK   PR #${pr} ${path} (absent now, but present in main history; later deletion/rename)"
        ;;
      never)
        echo "FAIL PR #${pr} ${path} (absent from main and main history: never landed)" >&2
        missing=1
        ;;
      *)
        echo "ERROR PR #${pr} ${path}: unknown path state '${state}'" >&2
        return 1
        ;;
    esac
  done

  if [ "$count" -eq 0 ]; then
    echo "OK   PR #${pr}: no added paths"
  fi
  return "$missing"
}

self_test() {
  local fail=0
  NOW_EPOCH=1000
  SINCE_EPOCH=500

  if merged_in_window "1970-01-01T00:15:00Z"; then
    echo "ok: merged_in_window accepts timestamps inside the window"
  else
    echo "FAIL: merged_in_window rejected an in-window timestamp"
    fail=1
  fi
  if ! merged_in_window "1970-01-01T00:08:19Z"; then
    echo "ok: merged_in_window rejects timestamps before the window"
  else
    echo "FAIL: merged_in_window accepted an early timestamp"
    fail=1
  fi
  if ! merged_in_window "1970-01-01T00:16:41Z"; then
    echo "ok: merged_in_window rejects timestamps after the sweep time"
  else
    echo "FAIL: merged_in_window accepted a future timestamp"
    fail=1
  fi

  local repo
  repo=$(mktemp -d)
  git -C "$repo" init -q
  git -C "$repo" config user.name test
  git -C "$repo" config user.email test@example.invalid
  printf 'present\n' >"$repo/present.txt"
  printf 'removed\n' >"$repo/removed.txt"
  printf 'old\n' >"$repo/old.txt"
  git -C "$repo" add .
  git -C "$repo" commit -qm main-files
  git -C "$repo" rm -q removed.txt
  git -C "$repo" mv old.txt renamed.txt
  git -C "$repo" commit -qm delete-and-rename
  MAIN_REF=HEAD
  local got
  got=$(cd "$repo" && path_state present.txt)
  if [ "$got" = "present" ]; then
    echo "ok: path_state detects a path currently present on main"
  else
    echo "FAIL: path_state present got '$got'"
    fail=1
  fi
  got=$(git -C "$repo" rev-parse HEAD >/dev/null 2>&1; (cd "$repo" && path_state removed.txt))
  if [ "$got" = "historical" ]; then
    echo "ok: path_state ignores a later deletion"
  else
    echo "FAIL: path_state deletion got '$got'"
    fail=1
  fi
  got=$(cd "$repo" && path_state old.txt)
  if [ "$got" = "historical" ]; then
    echo "ok: path_state ignores a later rename"
  else
    echo "FAIL: path_state rename got '$got'"
    fail=1
  fi
  got=$(cd "$repo" && path_state never.txt)
  if [ "$got" = "never" ]; then
    echo "ok: path_state distinguishes a never-on-main path"
  else
    echo "FAIL: path_state never got '$got'"
    fail=1
  fi

  if [ "$fail" -eq 0 ]; then
    echo "check-merged-pr-paths self-test: PASS"
  else
    echo "check-merged-pr-paths self-test: FAIL"
    return 1
  fi
}

main() {
  if [ "${1:-}" = "--self-test" ]; then
    self_test
    return $?
  fi
  [ "$#" -eq 0 ] || die "usage: $0 [--self-test]"
  validate_window

  NOW_EPOCH="${NOW_EPOCH:-$(date -u +%s)}"
  SINCE_EPOCH=$((NOW_EPOCH - WINDOW_DAYS * 86400))
  echo "Checking merged PRs from $(date -u -d "@${SINCE_EPOCH}" +%Y-%m-%dT%H:%M:%SZ) through $(date -u -d "@${NOW_EPOCH}" +%Y-%m-%dT%H:%M:%SZ)"

  git fetch --no-tags origin main --quiet
  if ! load_pull_snapshot; then
    echo "ERROR: could not read or validate pull-request metadata" >&2
    return 1
  fi
  local prs overall=0 deferred=0 settled=0 pr status
  if ! prs=$(merged_pr_numbers); then
    echo "ERROR: could not list recently merged PRs" >&2
    return 1
  fi
  if [ -z "$prs" ]; then
    echo "PASS: no merged PRs in the sweep window"
    return 0
  fi
  while IFS= read -r pr; do
    [ -n "$pr" ] || continue
    if check_pr "$pr"; then
      continue
    else
      status=$?
    fi
    case "$status" in
      2) deferred=$((deferred + 1)) ;;
      3) settled=$((settled + 1)) ;;
      *) overall=1 ;;
    esac
  done <<<"$prs"
  if [ "$overall" -eq 0 ]; then
    echo "PASS: every eligible added path is present on main or has main history; deferred=${deferred}; settled_outside_window=${settled}"
  else
    echo "FAIL: one or more eligible paths or PR classifications failed" >&2
  fi
  return "$overall"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
