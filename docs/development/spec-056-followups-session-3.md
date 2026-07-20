# Spec 056 follow-ups — session 3 decision log

Date: 2026-07-19. Continues the sweep recorded in the session-2 handover.

Scope boundary, unchanged from session 2: **PR #1048 is owned by another
session.** Nothing here touches that PR, its branch, or
`specs/056-onboarding-redesign/`.

## Outcome

| Item | State |
| --- | --- |
| A — open the sweep PR | Done → **#1164** |
| B — `tests/e2e` lint coverage | Done → **#1166**, deferred half filed as **#1167** |
| C — environment hygiene | Already satisfied; residue reported below |
| D — post-#1048 items | Still blocked; #1048 is `OPEN` + `DIRTY` |
| — | Unplanned: `main` was red → **#1163** |

## Decisions

### 1. Fixed a red `main` that was not in scope

`main` has been failing since #1130 (`7219fb57`) merged. That commit reworded
`err_path_not_directory` to "This path is not a folder." while
`StepSourceFolders.test.tsx:267` still asserted `/not a directory/i`.

Verified as inherited rather than caused by this branch: the test, its
component, and `messages/en.json` are all byte-identical to `origin/main`, and
the failing job on #1164 names exactly that one test.

Decided to fix it in **its own PR (#1163)** rather than folding it into the
sweep, because a red `main` blocks every lane, not just this one, and a
one-line test fix should not wait on review of unrelated a11y work.

Fixed by asserting `m.err_path_not_directory()` instead of a copy regex, so the
next voice sweep cannot break it. Same rationale as #1014.

### 2. Wiring `lint:tests` into the root `lint` script would have been theatre

The session-2 plan was to add `lint:tests` to the root `lint` script. Checking
CI showed it runs `pnpm --filter @astro-plan/desktop run lint` and **never
invokes the root `lint` script**. The gate would have looked correct in review
and silently never executed.

Added an explicit CI step instead, gated on the existing `frontend` path filter
(which matches `**/*.ts`, so it does cover `tests/e2e/*.spec.ts`). Kept the root
script wiring too, since that is what a developer runs locally.

### 3. Split the reformat from the gate, reformat first

Two commits: the 25-file mechanical reformat, then the config + CI step. This
ordering keeps every commit green — the reverse would land a commit whose own
CI fails by construction.

Verified the reformat is genuinely cosmetic rather than trusting the formatter:
normalizing whitespace, quote style, trailing commas, and semicolons out of all
25 files yields **0 differences** before vs after.

### 4. Root `biome.json` scoped to `tests/**`, not repo-wide

A repo-wide root config would be tidier but risks shadowing
`apps/desktop/biome.json`. Scoped it narrowly and **verified rather than
assumed**: `biome check .` inside `apps/desktop` still exits 0 with the root
config present.

### 5. Left the four `noNonNullAssertion` findings at `warn`

They are pre-existing and non-blocking. Draining them is test-quality work, not
part of turning the gate on.

## Ambiguities — decisions deliberately NOT made

1. **#1050 — should an observing-site checklist row exist at all?** Product
   call. Evidence posted on the issue in session 2 (`ITEM_REGISTRY` has exactly
   11 items and no observing-site item); issue left open.
2. **`Lock` now adds one tab stop per instance.** Defensible — it matches
   `InfoTip` and the alternative is keyboard-unreachable content — but it is a
   UX tradeoff worth weighing in a many-row cleanup table. Flagged explicitly in
   #1164 for a reviewer rather than decided unilaterally.
3. **Orphaned scratch directories under `/tmp/claude-worktrees/astro-plan/`.**
   Found five that no lane owns (see below). Not removed: they are not the
   directories the handover named, they sit in a location shared with concurrent
   sessions, and removing them was inference rather than instruction.

## Environment hygiene (item C) — already satisfied

Re-checked the session-2 constraints against live state instead of acting on
them:

- Ports `:5399`, `:5288`, `:5173` — **none are listening.** Nothing to kill, and
  in particular nothing of the #711 lane's was at risk.
- The five worktrees named in the handover (`worktree-2387156`, `-2391139`,
  `-2395148`, `-2542125`, `-2550012`) **no longer exist**, in neither the git
  registry nor on disk.
- `git worktree prune --dry-run` is empty — every registered worktree still
  exists, so the registry is consistent.

### Residue found, left alone (needs an owner's call)

Five directories under `/tmp/claude-worktrees/astro-plan/` are on disk but
registered to no worktree:

- `worktree-1074187`, `worktree-2734180`, `worktree-308953`, `worktree-3942749`
  — each contains **only** `apps/desktop/.vite/deps/` build cache (~28K each).
  No source, no `.git`.
- `tap-scratch/` — a full clone of a **different repo**
  (`platevault/homebrew-tap`). Verified clean: 0 dirty paths, 0 unpushed
  commits, 0 stashes.

All five look safe to delete, but none were created by this lane and the
location is shared, so they are reported rather than removed.

Worth noting separately: 56 worktrees are currently registered, many under
`/tmp`, which prior incidents have shown gets wiped. That is a standing hazard
independent of this sweep.

## Still blocked on #1048

`#1048` is `OPEN` with `mergeStateStatus: DIRTY`; `#1149` tracks it being red.
Unchanged and still gated:

- Item 1 — J18 first validation run (T033)
- Item 3 — anchor consolidation (**#1161**; registry data is the wrong side, fix
  it before consolidating)
- Item 6 — T018 / T022

Plus two post-merge corrections that cannot land until #1048 does:

- The `ITEM_REGISTRY` doc comment claims "calibration master registration, site
  save" both stay manual. Only calibration has a manual row.
- `ui/Tooltip.tsx`'s docstring warning should reflect the completed WCAG 1.4.13
  sweep. That file is deliberately untouched here because #1048 also edits it.

## Traps that fired again

- **`rtk` compresses `grep`.** A `git diff -w | grep -c` returned **0** while
  the raw diff was 536 lines — nearly banking a false "no semantic changes"
  conclusion. Re-ran the check in `node`. Never verify through a piped `grep`.
- **`CI=true pnpm install` uses `--frozen-lockfile`**, so it refuses to install a
  newly added dependency. This is why session 2 saw "no output and no
  `node_modules/.bin/biome`". `pnpm install --no-frozen-lockfile` resolves it.
- **Do not cite an issue number before creating it.** #1165 was written into a
  PR body as the placeholder for the typecheck gap; by the time the issue was
  filed, an adjacent lane had taken that number and it became **#1167**. Body
  corrected after the fact.
