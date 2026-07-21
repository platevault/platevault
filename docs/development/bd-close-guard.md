# Close-on-merge, not close-on-push

A bead gets closed as soon as its fix is pushed to a branch. The PR built from
that branch then goes through review separately, and can sit open, get
force-pushed, or get closed without merging while the bead already reads
closed. A 2026-07-20 audit of 42 recently-closed beads found 23 (55%) had
their linked PR still open at close time.

## The rule

Close a bead only once its fix is on `origin/main`, not once its PR shows
`MERGED`. **"MERGED" is not "on main".** GitHub reports a PR as `MERGED` as
soon as it merges into ITS base branch. This repo uses stacked PRs, so that
base branch is routinely a feature branch, not `main`.

astro-plan-pjg was closed on the strength of PR #1310 reading `state:
MERGED`. #1310 merged into `061-selectable-app-language`; its merge commit is
not an ancestor of `origin/main`.

## Ancestry is necessary, not sufficient

This repo squash-merges. A squash rewrites a branch's commits into one new
commit on `main`, so a merged branch tip is never an ancestor of `main` even
when its content is fully landed. For a stacked PR, the merge commit sits on
the stack branch and the stack root's squash carries that content onto `main`
under a different oid. `git merge-base --is-ancestor <mergeCommit>
origin/main` then answers "no" for work that is on `main`.

A non-empty `git merge-tree` does not prove the inverse either: a squashed
branch keeps its diverged merge-from-main history, so it still conflicts.

Landed-ness is proven by CONTENT: `git cat-file -e origin/main:<path>`, a file
or tree diff, or the change's presence inside the squash commit.

## The check

`scripts/bd-close-guard.sh <bead-id> [<bead-id> ...]` resolves the PR linked
to each bead and reports one of three landed states. Read-only: it never calls
`bd close`, `bd update`, or any mutating `gh`/GitHub call, and never modifies
the working tree beyond fetching the `origin/main` remote-tracking ref.

1. **Ancestry, the fast path.** The PR's merge commit is an ancestor of
   `origin/main` → `ON-MAIN`.
2. **Content, the fallback.** Ancestry says no → compare the blob the PR
   produced for each of its paths against `origin/main`. The PR's own tree
   comes from its merge commit, or from `refs/pull/<n>/head` when that commit
   has been pruned.

| Path evidence | Test | Meaning |
|---|---|---|
| identical | Blob oid at the PR's tree equals the oid at `origin/main` | This PR's exact content for that path is on `main` |
| never | `git log origin/main -- <path>` is empty | Path never existed on `main` at any point |
| inconclusive | Blobs differ, or path is absent with a non-empty log | Landed then edited further, deleted, renamed — or never landed |

One `never` path resolves the PR to `NOT-ON-MAIN`. A squash that landed the
PR's content would have put every path it touched into `main`'s history, so an
empty log is proof the change never arrived. Otherwise one or more `identical`
paths resolve to `CONTENT-ON-MAIN-VIA-SQUASH`.

Byte-identity is the positive test, not path existence. A stacked PR that only
modifies pre-existing files would pass an existence test on the strength of
files that were already on `main`, whether or not its own changes landed.

```
$ scripts/bd-close-guard.sh astro-plan-3ra astro-plan-698 astro-plan-sm7 astro-plan-tlw
ON-MAIN  astro-plan-3ra   PR #1319 merged into main, commit 38b788943a95c239d5ce65fd6fb2c8aa45a03f31 is on origin/main (platevault/platevault)
SQUASHED astro-plan-698   CONTENT-ON-MAIN-VIA-SQUASH: PR #1296 merged into feat/sd-token-pipeline and its merge commit fc0a2ad43efb3af763732ffae57c25e036743129 is not an ancestor of origin/main, but the file content it produced is byte-identical on origin/main — the stack root squashed the content in. Safe to close (platevault/platevault)
FAIL     astro-plan-sm7   NOT-ON-MAIN: PR #1304 merged into feat/sd-foundation-outputs, and paths it touches are absent from origin/main and from main's entire history — do not close (platevault/platevault)
FAIL     astro-plan-tlw   PR #1048 is OPEN, not merged (platevault/platevault) — do not close
```

Exit status is 0 only if every given bead's fix is on `origin/main`, by
ancestry or by content.

| Result | Meaning |
|---|---|
| `ON-MAIN` | The linked PR's merge commit is an ancestor of `origin/main`. Safe to close. |
| `SQUASHED` | Ancestry says no, and content the PR produced is byte-identical on `origin/main`. It reached `main` through the stack root's squash. Safe to close. |
| `FAIL` (`NOT-ON-MAIN`) | Ancestry says no, and at least one path the PR touched has no history on `origin/main`. Do not close. |
| `FAIL` (open/closed) | The linked PR is `OPEN` or `CLOSED` without merging. Do not close. |
| `UNKNOWN` | No PR reference could be resolved. Do not close on the strength of this check; verify by hand. |
| `ERROR` | `bd show`/`gh` lookup failed, the PR reads `MERGED` with no merge commit reported (some squash/rebase merges), the PR's own tree is unreachable, no path matched by content, or the file list was truncated. Do not close on the strength of this check. |

### Limits of the content check

Every gap resolves to `ERROR` or `NOT-ON-MAIN`, never to a green-light.

A PR whose files were all edited further on `main` after landing has no
`identical` path left and reports `ERROR`. Confirm those by hand against the
squash commit.

`gh pr view --json files` returns at most 100 files: PR #1162 reports
`changedFiles: 236` and 100 entries. A hidden path could be the unlanded one,
so a truncated list reports `ERROR` instead of `SQUASHED`. A `never` path
found among the visible 100 still resolves to `NOT-ON-MAIN`.

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
and never trusts the field. When the recorded claim and the check's own
determination disagree, both are reported (for example, the note claims
`on-main=no` while the content check says `on-main=yes`) — a stale claim is
worse than no claim. The comparison uses the final determination, so a
`CONTENT-ON-MAIN-VIA-SQUASH` result agrees with an `on-main=yes` note.

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
`scripts/bd-close-guard.sh --self-test` exercises the PR-resolution, ancestry
and content classification logic without network access.
