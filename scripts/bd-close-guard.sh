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
# "MERGED" is not "on main", so this script never trusts `state`.
#
# Ancestry of the merge commit is checked first, but it is not sufficient on
# its own. This repo squash-merges, so a stacked PR's merge commit lives on the
# stack branch and is NEVER an ancestor of origin/main even after the stack
# root squashes the same content onto main. Ancestry then answers "not on main"
# for work that is on main. That failure is fail-closed — it withholds a
# green-light, it never grants one — but it blocked real closures on
# 2026-07-21. A negative ancestry result therefore falls back to a CONTENT
# check against origin/main (see content_check) instead of being reported as
# the final answer.
#
# PR resolution order:
#   1. A `FIX-PR:` line (start-of-line, see below) in `notes`. If present it
#      WINS OUTRIGHT — metadata and prose mentions are not consulted at all,
#      never merged with it.
#   2. `metadata.pr` on the bead (set by `bd update --metadata pr=<n>`).
#   3. A `PR #<n>` mention (case-insensitive) anywhere in `notes` +
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
# The `FIX-PR:` line is a canonical, human/agent-authored backfill format
# (see docs/development/bd-close-guard.md) for beads where prose mentions are
# genuinely ambiguous:
#   FIX-PR: #<n> | base=<branch> | on-main=<yes|no> | verified=<date>
#   FIX-PR: UNDETERMINED | checked=<what was searched> | <why ambiguous>
# `UNDETERMINED` is a deliberate judgement that no single PR can be picked; it
# resolves to UNKNOWN immediately and never falls through to prose scraping,
# which would silently overturn that judgement. For a numbered line, the
# `on-main=` field is a CLAIM recorded at `verified=<date>`, not a fact — main
# moves after the note is written. This script always re-verifies by ancestry
# and reports a mismatch (e.g. the note claims `on-main=yes` but ancestry now
# says no) explicitly: a stale claim is worse than no claim at all.
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
# Exit status: 0 only if every bead's fix is on origin/main, either by
# ancestry (ON-MAIN) or by content (CONTENT-ON-MAIN-VIA-SQUASH). Non-zero if
# any bead is OPEN, NOT-ON-MAIN, UNKNOWN, or errored.
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

# Extract the canonical `FIX-PR: ...` line body (everything after the
# "FIX-PR:" prefix) from arbitrary text. Anchored to start-of-line so prose
# that happens to mention the literal string "FIX-PR:" mid-sentence is not
# picked up. `grep` matches `^` per input line regardless of surrounding
# newlines, so this works whether the line opens, closes, or sits inside the
# text. Prints nothing if no such line exists.
extract_fixpr_line() {
  grep -m1 -E '^FIX-PR:[[:space:]]*' <<<"$1" | sed -E 's/^FIX-PR:[[:space:]]*//'
}

# Parse a FIX-PR line body into two output lines: the PR number (or the
# literal `UNDETERMINED`), then either the recorded `on-main=` claim
# (yes|no|empty) for a numbered line, or the full reason text for an
# UNDETERMINED line.
parse_fixpr_line() {
  local body="$1" first
  first=$(cut -d'|' -f1 <<<"$body" | xargs)
  if [ "$first" = "UNDETERMINED" ]; then
    printf 'UNDETERMINED\n%s\n' "$(cut -d'|' -f2- <<<"$body" | sed -E 's/^[[:space:]]*//')"
    return
  fi
  printf '%s\n%s\n' \
    "$(grep -oE '[0-9]+' <<<"$first" | head -1)" \
    "$(grep -oE 'on-main=[a-z]+' <<<"$body" | head -1 | cut -d= -f2)"
}

# Resolve what PR (if any) governs closing this bead. Prints one line:
#   NUM:<pr>:<on-main-claim>   from a FIX-PR line (claim may be empty)
#   NUM:<pr>:                 from metadata.pr / prose fallback (no claim)
#   UNDETERMINED:<reason>      from a `FIX-PR: UNDETERMINED` line
#   (nothing)                  unresolvable — caller reports generic UNKNOWN
resolve_pr_reference() {
  local bead_json="$1" fixpr_line parsed kind rest pr
  fixpr_line=$(extract_fixpr_line "$(jq -r '.notes // empty' <<<"$bead_json")")
  if [ -n "$fixpr_line" ]; then
    parsed=$(parse_fixpr_line "$fixpr_line")
    kind=$(head -1 <<<"$parsed")
    rest=$(tail -n +2 <<<"$parsed")
    if [ "$kind" = "UNDETERMINED" ]; then
      printf 'UNDETERMINED:%s\n' "$rest"
    else
      printf 'NUM:%s:%s\n' "$kind" "$rest"
    fi
    return
  fi
  pr=$(resolve_pr_number "$bead_json")
  if [ -n "$pr" ]; then
    printf 'NUM:%s:\n' "$pr"
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
        # Not a final verdict: ancestry cannot see through a squash, so the
        # caller re-checks by content before reporting anything.
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

# Evidence one path carries about whether a PR's content reached origin/main,
# comparing the blob the PR produced (at <ref>) against origin/main:
#   identical    — same blob oid, so this PR's exact content for that path is
#                  on main. Mere existence of the path proves nothing: a PR
#                  that only modifies pre-existing files would read as landed
#                  on the strength of files that were already there.
#   never        — the path has NO history on origin/main at all, the only
#                  available proof that the change never landed; bare absence
#                  is also what a later delete or rename produces
#   inconclusive — differing blobs (landed then edited further, or never
#                  landed) or a path deleted/renamed after landing
path_evidence() {
  local ref="$1" path="$2" ours theirs
  ours=$(git rev-parse "$ref:$path" 2>/dev/null) || ours=""
  theirs=$(git rev-parse "origin/main:$path" 2>/dev/null) || theirs=""
  if [ -n "$ours" ] && [ "$ours" = "$theirs" ]; then
    echo identical
  elif [ -z "$(git log --oneline -1 origin/main -- "$path" 2>/dev/null)" ]; then
    echo never
  else
    echo inconclusive
  fi
}

# Pure decision table over per-path evidence counts, kept side-effect-free so
# --self-test can exercise it without git or gh. One path that never existed on
# origin/main outweighs any number of identical ones: a squash that landed this
# PR's content would have put every path it touched into main's history. A
# truncated file list can hide exactly that path, so truncation may confirm
# NOT-ON-MAIN but must never conclude the content landed.
#
# `identical > 0` is not sufficient. One ancillary file can happen to be
# byte-identical on main while the PR's deliverable remains unlanded. Every
# visible path must therefore be identical before this fallback green-lights a
# close; mixed evidence is unverifiable and fails closed.
classify_content() {
  local identical="$1" inconclusive="$2" never="$3" truncated="$4"
  if [ "$never" -gt 0 ]; then
    echo "NOTONMAIN:"
  elif [ "$truncated" = "yes" ]; then
    echo "ERROR:PR file list is truncated (gh returns at most 100 files) — content check cannot rule out an unlanded path"
  elif [ "$inconclusive" -gt 0 ]; then
    echo "ERROR:mixed evidence — $inconclusive of $((identical + inconclusive)) paths are not byte-identical on origin/main, so the PR's complete content cannot be proven landed"
  elif [ "$identical" -eq 0 ]; then
    echo "ERROR:no path could be matched to origin/main by content"
  else
    echo "SQUASHED:"
  fi
}

# The tree to read the PR's own version of each path from. The merge commit is
# usually still local; when its branch has been deleted and pruned, GitHub
# still serves the PR head under refs/pull/<n>/head.
pr_content_ref() {
  local pr="$1" merge_oid="$2"
  if [ -n "$merge_oid" ] && git cat-file -e "${merge_oid}^{commit}" 2>/dev/null; then
    printf '%s\n' "$merge_oid"
  elif git fetch --quiet origin "refs/pull/$pr/head" 2>/dev/null; then
    git rev-parse FETCH_HEAD
  fi
}

# Decide by content whether a merged PR's changes are on origin/main, for the
# case where ancestry cannot see through a squash.
content_check() {
  local repo="$1" pr="$2" merge_oid="$3" ref pr_files counts identical inconclusive never truncated
  if ! pr_files=$(gh pr view "$pr" --repo "$repo" --json changedFiles,files 2>/dev/null); then
    echo "ERROR:could not list PR files for the content check"
    return
  fi
  ref=$(pr_content_ref "$pr" "$merge_oid")
  if [ -z "$ref" ]; then
    echo "ERROR:PR content is unreachable locally (merge commit pruned, refs/pull/$pr/head unfetchable)"
    return
  fi
  if ! counts=$(content_evidence_counts "$ref" "$pr_files"); then
    echo "ERROR:$counts"
    return
  fi
  read -r identical inconclusive never truncated <<<"$counts"
  classify_content "$identical" "$inconclusive" "$never" "$truncated"
}

# Validate GitHub's response before transporting paths as a NUL-delimited
# stream. Git permits newlines in filenames, so line-oriented transport can
# turn one unlanded path into several coincidentally identical landed paths.
content_evidence_counts() {
  local ref="$1" pr_files="$2" identical=0 inconclusive=0 never=0 truncated=no path evidence
  local -a paths=()
  if ! jq -e '
    (.changedFiles | type == "number" and . >= 0 and floor == .)
    and (.files | type == "array")
    and all(.files[]; (.path | type == "string") and (.path | length > 0))
  ' >/dev/null 2>&1 <<<"$pr_files"; then
    echo "malformed PR file evidence"
    return 1
  fi
  if [ "$(jq -r '.files | length' <<<"$pr_files")" -lt "$(jq -r '.changedFiles' <<<"$pr_files")" ]; then
    truncated=yes
  fi
  mapfile -d '' -t paths < <(jq -j '.files[] | .path, "\u0000"' <<<"$pr_files")
  for path in "${paths[@]}"; do
    evidence=$(path_evidence "$ref" "$path")
    case "$evidence" in
      identical) identical=$((identical + 1)) ;;
      inconclusive) inconclusive=$((inconclusive + 1)) ;;
      never) never=$((never + 1)) ;;
      *)
        echo "could not classify PR path evidence"
        return 1
        ;;
    esac
  done
  printf '%s %s %s %s\n' "$identical" "$inconclusive" "$never" "$truncated"
}

check_one() {
  local id="$1" bead_json ref pr claim repo pr_json state base merge_oid is_ancestor verdict code detail on_main staleness
  if ! bead_json=$(bd show "$id" --json 2>/dev/null | jq -e '.[0]' 2>/dev/null); then
    echo "ERROR    $id   bd show failed (bad id, or bd unavailable)"
    return 1
  fi

  ref=$(resolve_pr_reference "$bead_json")
  if [ -z "$ref" ]; then
    echo "UNKNOWN  $id   no PR reference in FIX-PR line/metadata/notes/description — cannot verify, do not close"
    return 1
  fi
  if [ "${ref%%:*}" = "UNDETERMINED" ]; then
    echo "UNKNOWN  $id   FIX-PR: UNDETERMINED — ${ref#UNDETERMINED:}"
    return 1
  fi
  pr=$(cut -d: -f2 <<<"$ref")
  claim=$(cut -d: -f3- <<<"$ref")

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

  # Ancestry saying "no" is not the final answer: a squash-merged stack root
  # puts this PR's content on main without its merge commit ever becoming an
  # ancestor. Only a merged PR reaches here, so there is always something to
  # look for on main.
  if [ "$code" = "STACKED" ]; then
    verdict=$(content_check "$repo" "$pr" "$merge_oid")
    code="${verdict%%:*}"
    detail="${verdict#*:}"
  fi

  # The FIX-PR note's on-main= claim is a snapshot as of its `verified=` date,
  # not truth — main moves after the note is written. Compare it against the
  # final determination rather than raw ancestry, or every squash-landed bead
  # whose note reads on-main=yes gets falsely branded stale.
  case "$code" in
    PASS | SQUASHED) on_main="yes" ;;
    NOTONMAIN) on_main="no" ;;
    *) on_main="$is_ancestor" ;;
  esac
  staleness=""
  if [ -n "$claim" ] && [ "$claim" != "$on_main" ]; then
    staleness=" — FIX-PR note claims on-main=$claim, this check says on-main=$on_main (note is stale)"
  fi

  case "$code" in
    PASS)
      echo "ON-MAIN  $id   PR #$pr merged into main, commit $merge_oid is on origin/main ($repo)$staleness"
      ;;
    SQUASHED)
      echo "SQUASHED $id   CONTENT-ON-MAIN-VIA-SQUASH: PR #$pr merged into $base and its merge commit $merge_oid is not an ancestor of origin/main, but every visible path it produced is byte-identical on origin/main — the stack root squashed the content in. Safe to close ($repo)$staleness"
      ;;
    NOTONMAIN)
      echo "FAIL     $id   NOT-ON-MAIN: PR #$pr merged into $base, and paths it touches are absent from origin/main and from main's entire history — do not close ($repo)$staleness"
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

  # resolve_pr_reference: a bead whose ONLY reference is a FIX-PR line, with
  # no prose "PR #<n>" mention anywhere, must still resolve. This is the
  # exact case that was broken: `PR #<n>` prose-matching does not match
  # `FIX-PR: #<n>` because of the colon, so before this fix such a bead fell
  # through resolve_pr_number to UNKNOWN even with a canonical answer present.
  got=$(resolve_pr_reference '{"metadata":{},"notes":"FIX-PR: #1310 | base=061-selectable-app-language | on-main=no | verified=2026-07-21","description":"No prose PR mention here at all."}')
  [ "$got" = "NUM:1310:no" ] && echo "ok: resolve_pr_reference resolves a FIX-PR-only bead (no prose mention exists)" \
    || { echo "FAIL: resolve_pr_reference got '$got', want 'NUM:1310:no'"; fail=1; }

  # resolve_pr_reference: FIX-PR: UNDETERMINED resolves to UNDETERMINED with
  # its reason, and never falls through to prose scraping even when prose
  # mentions exist.
  got=$(resolve_pr_reference '{"metadata":{},"notes":"FIX-PR: UNDETERMINED | checked=notes+search | two stacked PRs cited, neither on main","description":"See PR #1310 and PR #1321."}')
  [ "$got" = "UNDETERMINED:checked=notes+search | two stacked PRs cited, neither on main" ] \
    && echo "ok: resolve_pr_reference honours FIX-PR: UNDETERMINED and ignores competing prose" \
    || { echo "FAIL: resolve_pr_reference got '$got'"; fail=1; }

  # resolve_pr_reference: a FIX-PR line wins outright over a DIFFERENT
  # metadata.pr / prose mention — it is not merged or reconciled with them.
  got=$(resolve_pr_reference '{"metadata":{"pr":9999},"notes":"FIX-PR: #1364 | base=main | on-main=yes | verified=2026-07-21 -- see also PR #4242 for context.","description":""}')
  [ "$got" = "NUM:1364:yes" ] && echo "ok: resolve_pr_reference lets FIX-PR win outright over metadata.pr and other prose numbers" \
    || { echo "FAIL: resolve_pr_reference got '$got', want 'NUM:1364:yes'"; fail=1; }

  # classify_content: one path that never existed on main outweighs any number
  # of content matches. Regression case: PR #1304 modifies files that are on
  # main while its deliverable check-token-refs.mjs never landed.
  got=$(classify_content 12 0 1 no)
  [ "$got" = "NOTONMAIN:" ] && echo "ok: classify_content reports NOT-ON-MAIN when any path never existed on main" \
    || { echo "FAIL: classify_content got '$got', want 'NOTONMAIN:'"; fail=1; }

  got=$(classify_content 4 0 0 no)
  [ "$got" = "SQUASHED:" ] && echo "ok: classify_content reports CONTENT-ON-MAIN-VIA-SQUASH when the PR's content is byte-identical on main" \
    || { echo "FAIL: classify_content got '$got', want 'SQUASHED:'"; fail=1; }

  # classify_content: no path matched by content -> ERROR, never a silent pass.
  # This is the fail-closed case for a stacked PR whose content has NOT landed:
  # its paths exist on main (so existence alone would wrongly pass it) but none
  # of its blobs match.
  got=$(classify_content 0 1 0 no)
  [ "${got%%:*}" = "ERROR" ] && echo "ok: classify_content returns ERROR rather than passing a PR whose content matches nothing on main" \
    || { echo "FAIL: classify_content got '$got', want ERROR:*"; fail=1; }

  # One coincidentally identical ancillary path cannot green-light an
  # inconclusive deliverable.
  got=$(classify_content 1 1 0 no)
  [ "${got%%:*}" = "ERROR" ] && echo "ok: classify_content fails closed on one identical plus one inconclusive path" \
    || { echo "FAIL: classify_content got '$got', want ERROR:*"; fail=1; }

  # classify_content: gh caps `files` at 100 (PR #1162 reports changedFiles=236,
  # files=100), and the hidden path could be the unlanded one. Truncation must
  # never conclude the content landed...
  got=$(classify_content 100 0 0 yes)
  [ "${got%%:*}" = "ERROR" ] && echo "ok: classify_content refuses to conclude on-main from a truncated file list" \
    || { echo "FAIL: classify_content got '$got', want ERROR:*"; fail=1; }

  # ...but a `never` path found within the visible 100 is positive evidence
  # that stands on its own.
  got=$(classify_content 99 0 1 yes)
  [ "$got" = "NOTONMAIN:" ] && echo "ok: classify_content still reports NOT-ON-MAIN on a truncated list when a never-landed path is visible" \
    || { echo "FAIL: classify_content got '$got', want 'NOTONMAIN:'"; fail=1; }

  # Filename ingestion: Git permits newlines in paths. The old line-oriented
  # jq/read transport split this one unlanded path into README.md and LICENSE,
  # both identical on main, and returned a false SQUASHED verdict.
  local newline_repo newline_json counts
  newline_repo=$(mktemp -d)
  if (
    cd "$newline_repo"
    git init -q
    git config user.name test
    git config user.email test@example.invalid
    printf 'landed\n' >README.md
    printf 'landed\n' >LICENSE
    git add README.md LICENSE
    git commit -qm main
    git update-ref refs/remotes/origin/main HEAD
    git switch -qc pr
    printf 'unlanded\n' >$'README.md\nLICENSE'
    git add $'README.md\nLICENSE'
    git commit -qm pr
    newline_json=$(jq -cn --arg path $'README.md\nLICENSE' '{changedFiles: 1, files: [{path: $path}]}')
    counts=$(content_evidence_counts HEAD "$newline_json")
    read -r identical inconclusive never truncated <<<"$counts"
    got=$(classify_content "$identical" "$inconclusive" "$never" "$truncated")
    [ "$got" = "NOTONMAIN:" ]
  ); then
    echo "ok: content ingestion preserves a literal newline filename and cannot return false SQUASHED"
  else
    echo "FAIL: content ingestion split or misclassified a literal newline filename"
    fail=1
  fi
  rm -rf -- "$newline_repo"

  got=$(content_evidence_counts HEAD '{"changedFiles":1,"files":[{}]}' 2>/dev/null || true)
  [ "$got" = "malformed PR file evidence" ] && echo "ok: content ingestion fails closed on missing path evidence" \
    || { echo "FAIL: malformed content evidence got '$got'"; fail=1; }

  # path_evidence: reads this repo's own local origin/main ref, no network.
  got=$(path_evidence origin/main "scripts/bd-close-guard.sh")
  [ "$got" = "identical" ] && echo "ok: path_evidence matches a blob that is byte-identical on origin/main" \
    || { echo "FAIL: path_evidence got '$got', want 'identical'"; fail=1; }

  got=$(path_evidence origin/main "scripts/definitely-not-a-real-path-9f3a.mjs")
  [ "$got" = "never" ] && echo "ok: path_evidence reports 'never' for a path absent from all of origin/main's history" \
    || { echo "FAIL: path_evidence got '$got', want 'never'"; fail=1; }

  # path_evidence: a path that exists on main but whose blob differs is
  # inconclusive, never positive evidence. `origin/main~1` stands in for a PR
  # tree carrying a different version of a file main also has.
  got=$(path_evidence origin/main~1 "$(git diff --name-only origin/main~1 origin/main | head -1)")
  [ "$got" = "inconclusive" ] && echo "ok: path_evidence treats a differing blob as inconclusive, not as landed" \
    || { echo "FAIL: path_evidence got '$got', want 'inconclusive'"; fail=1; }

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
