# Orchestration log — 2026-07-09 (release-finish campaign)

Run id: `run-20260709-release`. Mission: drive PlateVault to a
release-finished state (backend tails closed, docs reconciled, stale issues
verified/closed, Windows validation clean) without touching the release
mechanism itself.

## Lane map

| Node | Scope |
|---|---|
| 0a | docs-networking (Windows/WSL bridge docs, mirrored networking) |
| 0b | CI wins (quick, safe CI fixes) |
| A | workspace-red (fix red `cargo test --workspace` / lint baseline) |
| B | spec044 (targets-planner-astronomy, Track B) |
| C | spec017 (cleanup-archive-review-plans remainder) |
| D | spec048 (per-frame-inventory) |
| E | spec037 (e2e-integration-testing tail) |
| F | spec049 (source-view-generation) |
| G | spec026 (generated-source-view-removal decision) |
| H1 | 033-tail (validation-bugfix-remediation remainder) |
| H2 | 025/012/008/021 tails |
| I | bookkeeping (this lane): orchestration log, SPEC_STATUS.md, stale-issue closure |
| J | Windows validation |
| K | hand-off |

## Recorded decisions

- **(a) Journey-doc lanes serialized behind 0a.** Docs touching the
  Windows/WSL bridge mechanics wait for 0a to land first to avoid rebase
  churn on the same doc files.
- **(b) Backend tail serialized D → F → G → H1 → H2** to avoid scope
  collisions across specs 048/049/026/033/025/012/008/021 that touch
  overlapping crates and UI surfaces.
- **(c) `tasks.md` ticks land as surgical edits, with mandatory independent
  `speckit-verify` audits**, because SpecKit skill invocations are
  cwd-pinned to the primary checkout and single-active-feature — unsafe to
  run concurrently across parallel worktree lanes. Coders tick their own
  tasks by hand; a separate audit lane re-verifies against code before any
  status is trusted.
- **(d) macOS Real-UI E2E is under active investigation.** The merge bar
  (Integration + mock-mode CI green, plus ubuntu/windows Real-UI green) may
  be tightened once macOS is fixed; until then macOS Real-UI stays
  best-effort/non-blocking (carried from the 2026-07-06 campaign, D6).
- **(e) Versioning is reset to 0.x** (see `cbd91378`); the release lane is
  owned elsewhere in this campaign. This lane and all bookkeeping work MUST
  NOT touch `.github/workflows/**`, tags, versions, or release PRs.

## Updates

(Appended as decisions are relayed from `main`.)
