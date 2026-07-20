# Close-on-merge, not close-on-push

A bead gets closed as soon as its fix is pushed to a branch. The PR built from
that branch then goes through review separately, and can sit open, get
force-pushed, or get closed without merging while the bead already reads
closed. A 2026-07-20 audit of 42 recently-closed beads found 23 (55%) had
their linked PR still open at close time.

## The rule

Close a bead only once its fix commit is on `origin/main`, not once its PR
shows `MERGED`. **"MERGED" is not "on main"; ancestry is the only
authoritative test.** GitHub reports a PR as `MERGED` as soon as it merges
into ITS base branch. This repo uses stacked PRs, so that base branch is
routinely a feature branch, not `main`.

astro-plan-pjg was closed on the strength of PR #1310 reading `state:
MERGED`. #1310 merged into `061-selectable-app-language`; its merge commit
was never an ancestor of `origin/main`. The bead was reopened once
`git merge-base --is-ancestor <mergeCommit> origin/main` returned false.

## The check

`scripts/bd-close-guard.sh <bead-id> [<bead-id> ...]` resolves the PR linked
to each bead, then checks whether that PR's merge commit is an ancestor of
`origin/main` — not just whether the PR's `state` field reads `MERGED`.
Read-only: it never calls `bd close`, `bd update`, or any mutating
`gh`/GitHub call, and never modifies the working tree beyond fetching the
`origin/main` remote-tracking ref.

```
$ scripts/bd-close-guard.sh astro-plan-hew astro-plan-tlw astro-plan-pjg
PASS     astro-plan-hew   PR #1364 merged into main, commit d4876d81528951e40901bb83f6799c3c54c0a94b is on origin/main (platevault/platevault)
FAIL     astro-plan-tlw   PR #1048 is OPEN, not merged (platevault/platevault) — do not close
FAIL     astro-plan-pjg   PR #1310 merged into 061-selectable-app-language, not on origin/main — do not close (platevault/platevault)
```

Exit status is 0 only if every given bead's fix commit is on `origin/main`.

| Result | Meaning |
|---|---|
| `PASS` | Linked PR's merge commit is an ancestor of `origin/main`. Safe to close. |
| `FAIL` (stacked base) | PR `state` is `MERGED`, but its merge commit merged into a non-main base and is not on `origin/main`. Do not close. |
| `FAIL` (open/closed) | Linked PR is `OPEN` or `CLOSED` without merging. Do not close. |
| `UNKNOWN` | No PR reference could be resolved. Do not close on the strength of this check; verify by hand. |
| `ERROR` | `bd show`/`gh` lookup failed, or the PR reads `MERGED` with no merge commit reported (some squash/rebase merges) so ancestry cannot be verified. Do not close on the strength of this check. |

PR resolution order:

1. `metadata.pr` on the bead, set via `bd update --metadata pr=<n>`.
2. Exactly one distinct `PR #<n>` mention across `notes` + `description`.

A bare `#<n>` is never treated as a PR reference. Beads routinely
cross-reference other issues and PRs by number in prose, and most of those
numbers are not the bead's own PR. When more than one distinct `PR #<n>`
mention exists and `metadata.pr` is not set, the check reports `UNKNOWN`
rather than guessing. One real bead's description narrated two PRs ("PR
#1268 already covers X ... PR #1309 implements Y"); taking the first mention
resolved to the wrong, already-merged PR instead of the actual fix. Setting
`metadata.pr` on beads that narrate more than one PR removes the ambiguity;
guessing does not.

## Where this runs

Not wired into `just` or CI. Run it by hand (or from an agent's own
pre-close check) before `bd close`, one or more bead ids at a time. There is
no existing check aggregator or `bd preflight` hook in this repo to attach it
to; wiring an automatic pre-close gate belongs in the beads workflow tooling
that governs how `bd close` gets invoked, not in this repo's `scripts/`.

## Requires

`bd`, `gh` (authenticated), `jq`, `git`. The script runs `git fetch origin
main` before checking ancestry, so a stale local `origin/main` does not
produce a false pass; a failed fetch degrades to a warning plus a check
against whatever `origin/main` is already present locally.
`scripts/bd-close-guard.sh --self-test` exercises the PR-resolution and
ancestry-classification logic without network access.
