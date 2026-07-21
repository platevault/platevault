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
$ scripts/bd-close-guard.sh astro-plan-hew astro-plan-tlw astro-plan-pjg astro-plan-r8n
PASS     astro-plan-hew   PR #1364 merged into main, commit d4876d81528951e40901bb83f6799c3c54c0a94b is on origin/main (platevault/platevault)
FAIL     astro-plan-tlw   PR #1048 is OPEN, not merged (platevault/platevault) — do not close
FAIL     astro-plan-pjg   PR #1310 merged into 061-selectable-app-language, not on origin/main — do not close (platevault/platevault)
UNKNOWN  astro-plan-r8n   FIX-PR: UNDETERMINED — checked=bead's own notes (cites PR #1310 and #1321), gh pr list --search r8n, git log origin/main --grep=r8n | Two distinct stacked PRs cited, neither merged into origin/main (#1310 base=061-selectable-app-language, #1321 base=061-p1-locale-runtime); root-cause bead astro-plan-vi1w names this exact bead as the flagship ambiguous case (8 loosely-related numbers). Cannot pick one without guessing.
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

1. A `FIX-PR:` line in `notes` (format below). If present it wins outright —
   `metadata.pr` and prose mentions are not consulted.
2. `metadata.pr` on the bead, set via `bd update --metadata pr=<n>`.
3. Exactly one distinct `PR #<n>` mention across `notes` + `description`.

A bare `#<n>` is never treated as a PR reference: beads routinely
cross-reference other issues and PRs by number in prose, and most of those
numbers are not the bead's own PR.

Multiple distinct `PR #<n>` mentions with no `FIX-PR:` line and no
`metadata.pr` resolve to `UNKNOWN`, not a guess. Astro-plan-yxw's description
narrates two PRs ("PR #1268 already covers X ... PR #1309 implements Y");
taking the first mention resolved to the wrong, already-merged #1268 instead
of the actual fix, #1309.

### The `FIX-PR:` line

Write this format into a bead's notes when prose `PR #<n>` mentions are
ambiguous (multiple candidate PRs, a stacked-PR chain, or an already-reopened
bead). One line, anchored at the start of a line in `notes`:

```
FIX-PR: #<n> | base=<branch> | on-main=<yes|no> | verified=<date>
FIX-PR: UNDETERMINED | checked=<what was searched> | <why ambiguous>
```

`UNDETERMINED` resolves straight to `UNKNOWN` with the recorded reason. It
never falls back to prose scraping — that would silently overturn a
deliberate judgement that no single PR can be picked.

The `on-main=` field is a claim recorded at `verified=<date>`, not a fact:
`origin/main` moves after the note is written. The check always re-verifies
by ancestry and never trusts the field. When the recorded claim and the live
ancestry check disagree, the check reports both explicitly (for example, the
note claims `on-main=yes` but ancestry now says no) — a stale claim is worse
than no claim.

A `#<n>` with no `FIX-PR:` prefix, anywhere else in the line or in prose, is
not a `FIX-PR:` line and does not match this rule; it falls through to the
`PR #<n>` prose matching above.

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
