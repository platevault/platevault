# Autonomous Implementation — Master Plan & Progress Ledger (2026-06-11)

> Survives compaction. Source of truth for the full-autonomy run to implement
> every spec. Companion to `autonomous-run-2026-06-decisions.md` (judgment calls).
> Goal: implement ALL specs; update v4-deprecated specs to match reality; never
> stop until done; document skips. No user questions (user authorized full
> autonomy 2026-06-11).

## Ground truth (recon 2026-06-11, 5 parallel Explore agents)

Foundation BUILT: 002 (lifecycle state), 003 (first-run), 004 (native fs),
020 (router/url-state), 022 (design system), 027 (frontend), 029 (tauri wiring),
032 (design-v4 = current UI truth). 016 US1 + 024 partial done in prior run.

**Key finding**: design-v4 (027/030/031/032) shipped the UI as mockups bound to
fixtures in `apps/desktop/src/data/fixtures/*`. Almost NO domain backend exists.
Most crates (`crates/metadata/*`, `crates/targeting`, `crates/calibration/core`,
`crates/workflow/*`, `crates/patterns`) are empty skeletons. Tauri commands for
domain features return fixtures. The work is: build the real backend + wire the
existing v4 UI to it, per each spec.

Shared surfaces every spec touches (do sequentially to avoid conflict):
`crates/persistence/db/migrations/` (next free: 0013), `crates/contracts/core/src/`,
`packages/contracts/` (regen via `pnpm run build` in packages/contracts),
`crates/app/core/src/`, `apps/desktop/src-tauri/src/commands/`, `bindings`.

## Spec status reconciliation (deprecation updates required by goal)

- **001** umbrella — already `Closed`, superseded by 027. LEAVE. Do not implement.
- **030** — UI tasks superseded by 032; domain tasks live in dependent backend
  specs. ACTION: mark header "Superseded (UI by 032; domain by dependent specs)".
- **031** (design-v3) — superseded by 032. ACTION: mark `Closed`.
- **032** — current design truth. LEAVE.
- **028** — placeholder, no plan/tasks. ACTION: generate plan+tasks; implement last.

## Dependency-ordered build queue

Legend: [ ] todo  [~] in progress  [x] done  [S] skipped (with reason)

1. [ ] **018 settings backend** (M) — persistence + use cases + Tauri + wire UI.
   Unblocks 019, 021. Establishes the backend-wiring pattern. NO blockers.
2. [ ] **015 token-pattern resolver** (M) — `crates/patterns` resolver + sanitize
   + validate + override persistence + contracts. Unblocks 005. NO hard blocker.
3. [ ] **017 cleanup/archive review plans** (L) — plan use cases + persistence +
   Tauri + UI. Domain model in `crates/fs/planner` exists. Gates 005/008/016/026.
4. [ ] **025 filesystem plan application** (L) — `crates/fs/executor` + apply/cancel
   /pause/resume + failure taxonomy + Tauri. With 017 completes mutation spine.
   Unblocks 026, 008 atomic create, 016 US3.
5. [ ] **014 catalog index licensing** (M) — download/registry/license + persistence
   + UI panel + wizard step. Unblocks 013.
6. [ ] **013 target lookup from FITS OBJECT** (L) — `crates/targeting` catalog
   loader + exact/fuzzy lookup + persistence. Unblocks 023.
7. [ ] **008 project create/onboard/edit** (L) — create/update/source use cases
   (uses 025 for atomic folder), onboarding wizard, channel inference. Unblocks
   009 auto-transition, 010, 011, 016 US2.
8. [ ] **009 lifecycle enforcement** (M) — plan-gating, auto-blocked detection,
   setup→ready auto-transition, unarchive UX. Uses 025.
9. [ ] **005 inbox mixed-folder split** (L) — metadata extract (fits/xisf) +
   classify + confirm→plan. Uses 015 + 017/025.
10. [ ] **006 inventory library lifecycle** (M) — inventory projection + review
    actions + UI. Uses 005.
11. [ ] **007 calibration matching rules** (M) — matcher engine + dark/flat/bias
    rules + assignment persistence + UI.
12. [ ] **011 processing tool launch** (L) — tool.launch spawn + profiles +
    auto-discovery + settings UI. Uses 008.
13. [ ] **012 processing artifact observation** (L) — notify watcher + classify +
    attribution + workflow.run_completed. Uses 011 + 024.
14. [ ] **016 source protection US2-4** (M) — per-source override + plan gating +
    category enforcement. Uses 008 + 017 + 025 + 010.
15. [ ] **023 target identity/history/notes** (L) — targets schema + use cases +
    Cmd+K alias search + FK wiring. Uses 013 + 006 + 009.
16. [ ] **024 project manifests & notes** finish (M) — remaining 30 tasks. Uses 012.
17. [ ] **019 bottom log viewer** (M) — audit→LogEntry projection + stream + export.
    Uses 018.
18. [ ] **021 developer contract diagnostics** (L) — dev-tools feature + recording
    proxy + /dev/contracts + registry. Uses 018 devMode.
19. [ ] **026 generated source view removal** (M) — PreparedSourceView + remove/
    regenerate plans. Uses 017 + 025 + 009.
20. [ ] **010 guided first project flow** (M) — coach state machine + overlay +
    anchors. Uses 003 + 008 + 011.
21. [ ] **028 frontend quality hardening** — generate plan+tasks, then implement
    (eslint, error boundaries, tests, CI guards). Last.

Plus: spec-status doc edits for 030/031 (item 0, do first).

## Process deviations (authorized by full-autonomy directive)

- specs/CLAUDE.md mandates per-phase USER approval + agent-assign flow. User
  authorized fully autonomous no-questions operation, so approval gates are
  skipped and implementation proceeds directly (per-spec coder delegation or
  direct edits). All material decisions logged in the decisions doc.
- GUI verification: WSL cannot run the Tauri GUI; runtime UI smoke is deferred to
  Windows-native preview (documented skip, consistent with prior run D-010/D-005).
  Backend covered by `cargo test`; frontend by vitest + `tsc`.

## Execution model (decided 2026-06-11)

Backend specs share surfaces (migration sequence numbers, `contracts/core/src/lib.rs`,
`commands/mod.rs` + invoke_handler, audit event bus). Running coders in parallel
in one working tree collides; even worktree isolation collides on migration
numbering. So: **execute backend specs SEQUENTIALLY**, one coder per spec in the
shared tree, review the emitted diff (orchestrator review gate), commit, then next.
Each spec delegated to a `coder` subagent with a precise brief; orchestrator
reviews actual diffs (not summaries) before accepting, sending corrections to the
SAME agent via SendMessage so it keeps context. GUI runtime smoke deferred
(WSL headless) — backend proven by `cargo test`, frontend by `tsc`/vitest.

Reusable backend-wiring PATTERN (established by 018): persistence migration +
repository → `crates/app/core` use case → `crates/contracts/core` DTOs (regen TS
via `pnpm run build` in packages/contracts) → Tauri command (keep STABLE frontend
transport shapes; add new commands rather than changing existing invoke
signatures, since typecheck can't catch runtime invoke shape drift) → wire only
the panes/pages the spec OWNS, leaving other-spec surfaces on their current
source with a `// TODO(spec-NNN)` marker.

## Progress log (newest first)

- 2026-06-11: Item 0 done — 030 marked Superseded, 031 marked Closed (v4 truth).
- 2026-06-11: Item 1 (018) — backend (migration 0013 settings+source_overrides,
  repo, app/core settings use case, audit events SettingsChanged/Snapshot/Repair,
  4 Tauri commands, contract DTOs) landed by coder; cargo test/clippy/fmt +
  typecheck green. Review caught: (a) settings.get/update signatures diverged from
  the stable frontend `{scope}`/`{scope,values}`+SettingsData transport (runtime
  bug, typecheck-invisible); (b) panes still load from fixtures (T015 gap). Sent
  coder back to restore the stable transport + wire 018-owned panes (General/
  Advanced/Cleanup + scalar absorbed keys), leaving other-spec panes marked. In
  progress.
- 2026-06-11: Recon complete; master plan written.
</content>
</invoke>
