# Close-on-merge, not close-on-push

A bead gets closed as soon as its fix is pushed to a branch. The PR built from
that branch then goes through review separately, and can sit open, get
force-pushed, or get closed without merging while the bead already reads
closed. A 2026-07-20 audit of 42 recently-closed beads found 23 (55%) had
their linked PR still open at close time.

## The rule

Close a bead only once its PR shows `MERGED`, not once its fix is pushed.
"Fix pushed to the branch" and "fix landed on main" are different events; only
the second one is safe to mark done.

## The check

`scripts/bd-close-guard.sh <bead-id> [<bead-id> ...]` resolves the PR linked
to each bead and reports its merge state. Read-only: it never calls `bd
close`, `bd update`, or any mutating `gh`/GitHub call.

```
$ scripts/bd-close-guard.sh astro-plan-6yx astro-plan-tlw
PASS     astro-plan-6yx   PR #1315 MERGED (platevault/platevault)
FAIL     astro-plan-tlw   PR #1048 is OPEN, not merged (platevault/platevault) — do not close
```

Exit status is 0 only if every given bead resolved to a merged PR.

| Result | Meaning |
|---|---|
| `PASS` | Linked PR is `MERGED`. Safe to close. |
| `FAIL` | Linked PR is `OPEN` or `CLOSED` without merging. Do not close. |
| `UNKNOWN` | No PR reference could be resolved. Do not close on the strength of this check; verify by hand. |
| `ERROR` | `bd show` or the `gh` lookup failed (bad id, no network, PR not found). |

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

`bd`, `gh` (authenticated), `jq`. `scripts/bd-close-guard.sh --self-test`
exercises the PR-resolution logic without network access.
