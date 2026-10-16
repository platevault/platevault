# Ledger recovery comparison: missing August history

Bead: `astro-plan-p0ds`. Date: 2026-10-16. Data: [ledger-recovery-comparison.json](ledger-recovery-comparison.json). Harness sources: [ledger-recovery-comparison-sources.json](ledger-recovery-comparison-sources.json).

The investigation was read-only:

- It restored, imported, pulled, pushed and wrote no store.
- It created, closed and updated no bead for a recovered id.

## Result

| Measure | Count |
|---|---|
| Commit strings absent from the 2026-10-02 export | 183 |
| Bead-shaped ids (116 roots, 64 children) | 180 |
| Non-id strings | 3 |
| Confirmed missing | 180 |
| Implied missing parents (`astro-plan-3v3r`, 16 `3v3r.N`, `astro-plan-0sgb`) | 18 |
| Recoverable from any surviving store | 0 |
| Unresolved (183 scope) | 198 |
| Further bead-shaped strings outside the 183, also missing | 28 |
| August rows found only in an isolated clone | 26 |

The three non-id strings are `astro-plan-archive` (the `.astro-plan-archive` path), `astro-plan-catalogs` (a repository name) and `astro-plan-wisp`. The census pattern cut five wisp ids such as `astro-plan-wisp-b52` short to `astro-plan-wisp`. Wisps stay local by design, so their absence alone does not show that anything was lost.

None of the 180 ids exists in any examined source. The check covered current rows, every commit of history and every decoded storage chunk, reachable or not. Four live ids served as positive controls and were found wherever expected. All 180 ids stay unresolved: only commit text proves they existed, and it proves no record, status, claim, comment or dependency.

## Why nothing survives

- The canonical Dolt lineage, preserved bit for bit through the September migrations, has no commits between 2026-07-30 and 2026-09-17.
- The remote `refs/dolt/data` history fetched into an isolated repository shows 61 pushes in July, none in August and two on 2026-09-17.
- On 2026-08-26 the `~/tmp/platevault-claude` clone took its ledger from the remote and saw `origin/main` at the 2026-07-30 commit.
- The 2026-09-14 native archive (`44alf643…`, 118,311 chunks) contains none of the ids.
- `.beads/backup` was created on 2026-08-26 holding an empty-schema database.

[INFERENCE] The August ids lived in a per-checkout or per-worktree store that never committed into this lineage, never pushed, and was discarded with its directory. No such store survives on this machine, and no August platevault session transcript remains.

The 2026-10-02 review evidence the bead cites was never committed to any ref. It survives in `~/tmp/worktree-backups/review-application-local-20261002.files.tgz`, together with the 1670-row export used here.

## Parity

- The live export, the 2026-10-16 backup and the current remote hold the same 2261 issue ids. After the last backup sync, agents made nine claims and four comments between 07:16Z and 07:21Z and changed edges in the same minutes. Those writes are not yet committed, which explains every difference.
- The 2026-10-02 export (1670) and the pre-migration remote (1662) are subsets of live. Every status difference is a later live update except one: `astro-plan-v85j`. Its 2026-07-26 closure existed only in the working set of a stale store until commit `k1dc5d6` preserved it on 2026-09-22.
- The clone holds 26 design-system molecules from 2026-08-26 (`astro-plan-mol-*`) that are absent from live. They carry 11 comments, 56 internal dependencies and 45 labels, and no id collides with live. No commit on main references them. Two other clones use separate prefixes (`platevault-sol-mol`, `pv-mol`).

## Method

1. Rebuilt the census. Commits reachable from `94a3dc95` were matched with `astro-plan-[a-z0-9]+(\.[0-9]+)*`, then checked against the recovered 2026-10-02 export. The result is 243 distinct matches, 183 of them absent, which is the reviewed figure. Each string was classified by its whole token and its context.
2. Copied every candidate store into `/tmp/ledger-forensics` with `cp -R` and checked the checksums. The copies cover `.beads/backup`, `~/.beads/retired-carriers`, `~/.beads/backup`, `~/tmp/platevault-claude/.beads` and `~/tmp/platevault-beads-backup-20260826`. Scratch stores were built from the copies with every remote and backup removed.
3. Fetched the remote `refs/dolt/data` into a new bare repository, together with the pre-migration commits `b8d4879` and `65b15c98`. Snapshots and every storage file from that history were materialised.
4. Ran only `SELECT` queries in each scratch store: branches, log, issue counts, target ids in current rows and in `dolt_history_issues`.
5. Decompressed every chunk of every copied archive, table file and journal and searched them for the target strings.
6. Compared ids, statuses, comments and dependencies with the live export.

## Commands run

Ledger, read-only, against the live store:

```sh
bd show astro-plan-p0ds --json --readonly
bd comments astro-plan-i3o6 --json --readonly
bd export --all --readonly -o /tmp/ledger-forensics/live/export-all.jsonl
bd export --readonly -o /tmp/ledger-forensics/live/export.jsonl
```

Git and evidence:

```sh
git log 94a3dc958c13e297baf501aa2721efa2c2628622 --format='%x1e%H%x1f%ad%x1f%P%x1f%B' --date=iso-strict --output=/tmp/ledger-forensics/main-94a3dc95-log.txt
git log --all --format='%x1e%H%x1f%ad%x1f%P%x1f%B' --date=iso-strict --output=/tmp/ledger-forensics/all-refs-log.txt
git log --all -- 'docs/reviews/evidence/2026-10-02' 'docs/reviews/2026-10-02-engineering-review.md'
git log --all --name-status -- .beads/
tar -xzf ~/tmp/worktree-backups/review-application-local-20261002.files.tgz -C /tmp/ledger-forensics/oct2-review .audit-smoke/ledger-refreshed.jsonl .audit-smoke/ledger-corrected.jsonl docs/reviews/2026-10-02-engineering-review.md
```

Isolation and remote:

```sh
cp -R .beads/backup /tmp/ledger-forensics/backup-copy/live-beads-backup-20261016
cp -R ~/.beads/retired-carriers ~/.beads/backup ~/tmp/platevault-claude/.beads ~/tmp/platevault-beads-backup-20260826 /tmp/ledger-forensics/carriers/
scratch-store.sh <name> <copy>
git init --bare /tmp/ledger-forensics/remote-git
git -C /tmp/ledger-forensics/remote-git fetch https://github.com/platevault/platevault.git '+refs/dolt/data:refs/dolt/data'
git -C /tmp/ledger-forensics/remote-git fetch https://github.com/platevault/platevault.git b8d4879b2c2b8e1e858000d3314ee3bbc240a93a 65b15c985b7510582f48660fd8e1a7126890d569
materialise-remote.sh <commit> <dir>
python3 remote_blobs.py /tmp/ledger-forensics/remote-blobs
```

Analysis, all on copies:

```sh
python3 extract.py
python3 classify.py
python3 store_census.py <out.json> <scratch stores>
python3 darc_scan.py <needles> <out.jsonl> <copies and remote blobs>
python3 compare_ids.py <out.json>
python3 supplementary.py <baseline tree ids>
dolt sql --disable-auto-gc -r json -q "SELECT ... FROM dolt_history_issues ..."
```

## Proposed reconciliation, for review before use

Nothing here is applied. The owner chooses one option for each group. Every option adds rows only:

- No option restores, replaces, resets or merges an old store.
- No option closes a bead on a guessed status.
- Existing claims, comments and dependencies stay as they are.

**Recommended: record only.** Leave the ledger as it is. This file is the record. Add one comment to `astro-plan-i3o6` that points here. A restore would gain nothing, because no store holds the rows, and it would put the 591 rows created since 2026-10-02 at risk.

**Option B, placeholder records for the 180 ids.** Use this only if the owner wants the commit trailers to resolve.

1. Preserve. Pause writers. Take `bd export --all`, copy `.beads/embeddeddolt` to a dated directory outside `.beads` with checksums, and confirm the backup sync and remote push. Record counts of issues, comments, dependencies and `in_progress` claims.
2. Generate one command file from this JSON. Each command is `bd create --id <id> --defer <far date> -l ledger-reconstructed`, with a description citing the commits and trailers. Add `--parent` only inside the `3v3r` tree, and only after creating its 18 implied parents. Set no assignee and no `blocks` edges, and leave every record open.
3. Run every line with `--dry-run`. Expect 198 creates and nothing else.
4. A second reviewer checks the file against the JSON and confirms that no existing id appears in it.
5. Apply it as one `bd batch` transaction. Check that the counts grew by 198 and that comments, dependencies and claims are unchanged for every pre-existing id. If a check fails, roll back by removing the 198 new ids in one batch.

**Option C, the 26 clone-only design molecules.** Recommended: do not import them. They came from a scratch design run that nothing on main references. If the owner wants them, export them from the isolated copy, run `bd import --dry-run` to confirm 26 creates and zero updates, and import without `--allow-stale` after the step 1 preservation above.

Dependencies the dispatcher may record:

- The owner's choice of option `blocks` any bead that applies it.
- Preventing per-checkout ledger divergence is `discovered-from` this bead. That means pinning `BEADS_DIR`, keeping native isolation off, and checking push and backup after each session.
