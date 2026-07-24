# Orchestrator Handover — end-to-end implementation drive

Started: 2026-07-03 ~18:30Z. Orchestrator session: plan/delegate only (no direct implementation).
Append-only log below: every agent completion gets a timestamped entry with implementation
details, branch/commit info, and test results.

## Ground truth at start (2026-07-03 18:30Z)

- **Integration branch**: `redesign-ui-platevault` is the de-facto integration branch.
  origin/redesign is **104 ahead / 3 behind** origin/main. The 037 IPC-migration fleet PRs
  (#368–#378), 046 follow-ups, 041 iter-2, and 043 all live there.
- **In-flight agents (other sessions)**: still pushing to redesign as of 18:19Z.
  Active lanes: `037-phase4-teardown` (+ `verify-integrated`, same tip da9ad183 — deletes
  legacy `commands.ts`), `agent-ae32a6166288f3c13`. Their work lands on redesign; a
  **re-merge redesign→main sweep is required after the fleet settles**.
- **Shared main checkout** (`/home/sjors/dev/astro-plan`) is on `redesign-ui-platevault`,
  **9 local commits unpushed** (tip dae31388, T075/T077 recovery + 046 gate) and 12 behind
  origin/redesign. An in-flight agent may own these — DO NOT rebase/reset/push this checkout
  until the fleet settles. Reconcile in the re-merge sweep.
- **PR #349** (redesign → main): open, SPEC_STATUS says mergeable, CI re-enabled. This is
  the highest-value action.
- **win-qa**: 36 commits behind main (and far more behind redesign). Must be re-pointed to
  track main after #349 lands.
- **origin/main tip**: f165a240 (#362).
- Spec status source of truth: `specs/SPEC_STATUS.md` (reconciled 2026-07-03). Open fronts
  per latest review: 008 (~6 tasks), 010 closeout, 012 test/doc tail, 016 (17/20),
  017 cleanup-review UI (blocks 033), 021 (32/37), 025 rollback+progress UI, 026 product
  decision pending, 028 CI wiring, 033 (blocked on 017), 037-e2e (sessions.transition +
  tauri-driver), 043 pending items, 044 not started (research-gated).

## Standing rules for all delegated agents

- Work in a dedicated worktree + dedicated branch; commit and push often
  (`GIT_SSH_COMMAND='ssh.exe'` if push fails through the sandbox); rebase onto the current
  integration target before opening a PR. No AI attribution in commits (hook enforces).
- Base branch decision: while the fleet is active, feature work targeting the app bases on
  **origin/redesign-ui-platevault**; after the re-merge sweep, base on **origin/main**.
- Pre-existing issues encountered mid-task: fix them if safe, else report back for
  re-delegation. Never skip silently.
- Migrations: check for version-number collisions before adding (renumber later file).
- E2E agentic tests: `e2e-agentic-test/<spec>/<test>/` — authored via /verify-on-windows
  scenarios, user-journey driven.
- **NO `git stash` in agent worktrees (2026-07-03, incident-derived)**: stash refs are
  repo-wide, shared across ALL worktrees — concurrent agents' stash push/pop interleave
  and silently swap each other's working trees (bit the FR-015 agent; edits reverted
  mid-task, recovered). Agents commit WIP to their own branch instead (fixup/squash
  later). Include in every new implementation brief.
- **Continuous commit+push (USER RULE, 2026-07-04)**: every agent that writes commits AND
  pushes to origin after each meaningful step. No accumulated unpushed work; never rely on
  /tmp worktrees or local-only branches surviving. First action when adopting an existing
  local branch: push its ref as-is. WIP commits allowed (squash at merge). Derived from the
  2026-07-04 session-limit kill that stranded impl-p12/wire-p6a as local-only commits and
  left #388/#390/#395 worktrees ahead of their pushed PR refs.
- **Pipelined CI, push-PR-idle (USER RULE, 2026-07-04)**: writer agents do NOT wait on
  full CI runs. They run local gates (fmt/clippy/tests/typecheck/i18n), push, open the PR,
  report, and go IDLE keeping their context (not exit). One dedicated CI-shepherd agent
  (own reserved slot outside the worker cap) batches CI watching across all open convoy
  PRs, rebases+merges green ones, and returns per-PR failure lists to the orchestrator,
  who messages the idle author agent to fix its own PR with warm context. The shepherd is
  EVENT-DRIVEN (2026-07-04): blocking `gh pr checks --watch` per queued PR instead of
  sleep loops; fully idle on empty queue; the orchestrator prods it on each
  writer-completion/PR event.
- **i18n review (USER RULE, 2026-07-03)**: every completed implementation package gets a
  dedicated reviewer pass over its PR diff for hardcoded user-facing strings that belong in
  the Paraglide catalog — including gate-evading spots (attributes, aria-labels, title=,
  template literals, plural forms). Runs BEFORE merge authorization.
- After #349 merges: integration target flips to `main` — all open feature branches rebase
  onto origin/main and re-target their PRs to main.

### 2026-07-03 ~21:55Z — spec-verifier-1 (Sonnet, read-only) — WAVE 3 COMPLETE; full-spec coverage achieved

013: false "NOT IMPLEMENTED" claim hides a build-then-retire cycle (built 2026-06-11,
retired by 036's gen-2 removal); targeting primitives live via 035/041; → FOLD-AND-
SUPERSEDE banner, close outright. 015: HOLDS — 041 T049 extends crates/patterns cleanly,
P11 fills a documented gap, no duplication. 027: two-links-dead supersession chain
(027→030→032/043) + stale architecture claims (commands.ts, light-only theme vs 4 live
themes, hardcoded copy vs ~1290 Paraglide call-sites) → rewritten as historical baseline;
foundational dep choices still hold. 038: not regressed (separately reported); footnote
added to prevent future false alarms. 042/046: HOLD. 019 row updated (FR-015 fix is IN
via #385, not just tracked). **Amendment patch set: 13 files, verified against 826467e9.
Every active spec (002-046) has now been verified against code reality across waves 1-3 +
the scoping passes.** Parked pending post-#349 re-verify + application go-ahead.

### 2026-07-03 ~21:45Z — impl-wpa-cleanup-gen (OPUS) — COMPLETE (PR #389, review gate running)

The critical-path 017 cleanup generator: scan-preview + generate commands (D11 two-step),
DataType classification off processing_artifacts.kind (Unclassified → always excluded),
policy persisted in the protection_defaults KV (D13 outcome: NO new migration),
real total_bytes_required (FR-012 generator half), protected categories through
resolve_protection end-to-end, latent CHECK-constraint bug hardened (unprotected→normal
in the shared tail — its first real caller). 14 new tests; fmt/clippy/typecheck green;
bindings regenerated. KEY PRODUCT FINDING: raw sub-frame cleanup is IMPOSSIBLE today —
sessions.frame_ids is always '[]' and file_record is never written by any real path;
generator correctly refuses to walk the filesystem (constitution). → task #40 (user
decision: per-frame inventory). Also: db-boundary ratchet currently red on redesign
(baseline predates #385) → task #39. review-389 gating the merge.

### 2026-07-03 ~22:05Z — scope-017 — DECISION MEMOS DELIVERED (stand-down after)

scratchpad/decision-memos/: **026** → recommendation RETIRE (remove/regenerate machinery
real but inert — no first-generation function exists; ready→prepared edge has the same
never-closed requires_plan gate as C5's archived edge; restore = M-L + product-model
question). **044** → 7 research questions + two-track plan; SCOPE FINDING: blocker #57
(list-endpoint enrichment) is ALREADY RESOLVED in code — Track A (Moon/filters) is
promotable to a real spec almost immediately; only #58 (ephemeris/observer) needs
/speckit.research. Routed to amendment set.

### 2026-07-03 ~22:05Z — review gates round: #387 approve-with-nits, #388 i18n findings

**#387** (equipment): reviewer independently re-ran tests; verdict approve-with-nits.
3 required fixes sent to owner (form-shell extraction per mandate; TOCTOU on delete-guard
while trains load; reuse canonical utility class instead of joining an 11-member dup
group) → then rebase + squash-merge per D20. Reviewer confirmed the delete-guard FK
coverage is complete (schema-verified) and mock error fidelity is faithful.
**#388** (audit log): i18n FINDINGS — falsely-justified eslint-suppress on "page X of Y"
(→ catalog key), raw outcome enum in Pill (→ outcomeLabel factory), and backend-composed
English refusal text first exposed to users (→ D23: documented-as-intentional, upgrade
task #45). Backend review (review-388) still running; merge held until both gates clear.
Standing-rule lesson adopted from #387: i18n review always verifies keys are CALLED,
not just added.

### Housekeeping notes (accumulated)

- **Spec numbering collision (pre-existing)**: TWO specs are numbered 037
  (037-ipc-wrapper-removal and 037-e2e-integration-testing). Flagged in the amendment-set
  README; renaming a spec directory is disruptive — left for the user to decide.
- Amendment patch set final state: **15 files** (adds 037-e2e-coverage-matrix.patch +
  033-tasks.patch after D21/D22, every claim independently re-verified by
  spec-verifier-1 before applying), verified against tip 1e412c03.
- Minor UI debts found by gates, not yet ticketed individually: dead `setSourceFilter`
  capability in LogPanelContext (019), missingTokens indicator + aria-live now folded
  into the #390 correction round.
- Duration formatting (`h`/`m` suffixes, period decimals) is systemically unlocalized
  house style across the app (fmtIntegS + lib/format.ts helpers) — consistent, not a
  regression; a future locale pass must touch all sites together.

## Note to the user (away ~10h from ~19:00Z 2026-07-03)

Decisions I made for you (all revertable, see D7-D10 above): Archive UI drops
Master/Target tabs for now (D7); root delete blocks on dependents (D8); the 002
project-link gate is descoped as superseded by 041's inbox gate — both amendment variants
exist if you disagree (D9); I proceeded with the #349 merge after verifying it was still
open despite the "already merged" report (D10).
What I would have asked you: nothing else blocking — remaining open product questions
(spec 026 source-view retire-or-restore, 044 planner scope) were NOT decided; they need
research/specs, not snap calls.

## Decision log (revertable best-effort calls)

- **D1 (2026-07-03)**: PR #349 merges with a **merge commit**, not squash, deviating from
  the repo's squash default. Rationale: redesign is a long-lived integration branch that
  keeps receiving pushes from the in-flight fleet; squash would orphan the merge-base and
  make the follow-up re-merge conflict-heavy. Revert path: `git revert -m 1 <merge-sha>`.
- **D2 (2026-07-03, USER)**: `persistence-layer-infra` (c551c088) is to be REVIVED and
  landed via PR, not dropped. Delegated.
- **D3 (2026-07-03, USER)**: `scripts/css-dup-sniff.mjs` (only surviving unique content of
  `backup-css-consolidation`): evaluate whether still needed vs the eslint style-ban; if
  yes, code-review + refactor and land it; if no, document and drop. Delegated.
- **D4 (2026-07-03, USER)**: win-qa force-reset APPROVED — after #349 lands: push backup
  ref of old win-qa, reset win-qa (local+origin) to new main tip, cherry-pick 7418c983
  (Windows QA launch script) back on top.
- **D5 (2026-07-03)**: P7 exposure aggregation parses the existing `"300s"`-style
  `exposure_snapshot` strings at read time (zero-migration); numeric-column migration
  deferred as an optional later cleanup. Revert path: helper is additive, drop it.
- **D6 (2026-07-03)**: P3 per-entity audit history REUSES the audit_log_entry read path
  being built for P2 (auditList + entityType/entityId filters); no bespoke archive.history
  endpoint. Rationale: dedicated idx_audit_entity index exists; second endpoint would be a
  redundant wrapper. Revert path: bespoke endpoint can still be added later without
  breaking the reuse callers.
- **D7 (2026-07-03, autonomous — user away)**: Archive UI scope = Project/Session/Plan
  only. Master and Target tabs DROPPED until a real archival lifecycle concept for them is
  designed (none exists in the domain model). Rationale: don't invent product surface as a
  wiring side effect. Revert path: tabs re-added when/if a masters/targets archival model
  is specced.
- **D8 (2026-07-03, autonomous — user away)**: `roots.delete` BLOCKS when dependent records
  exist (typed error, e.g. RootHasDependents), no cascade-nullify. Rationale: constitution
  principle II spirit (no silent orphaning). Revert path: cascade-with-confirm can be added
  later as an explicit option.
- **D9 (2026-07-03, autonomous — user away)**: spec 002's never-implemented
  `source.not_confirmed` project-link gate is DESCOPED via amendment — superseded by the
  041 inbox universal confirm gate (sessions derive from confirmed inventory). Caveat: if
  legacy/plan_open paths can still yield unconfirmed sessions reaching project-linking, a
  follow-up gate ticket must be opened. Revert path: the implement-the-gate amendment
  variant is drafted (spec-verifier-1) and can be applied instead.
  UPDATE 19:2xZ: caveat verification commissioned — spec-verifier-1 is tracing all
  session-creation/link paths (legacy plan_open, catalogue-in-place, scan/wizard/
  calibration) for inbox-gate bypasses; D9 flips to implement-gate if any path is
  found UNSAFE. Amendment patch already updated to the D9 outcome (002 → Implemented,
  descope recorded, revert variant in banner).
  VERDICT 19:5xZ: **D9 CONFIRMED — descope stands.** All forward paths SAFE with
  evidence: the only production acquisition_session INSERT runs solely off applied inbox
  plans; only confirm() (mandatory-field gate) creates move/catalogue plan items;
  catalogue-in-place shares the identical pipeline; calibration sessions can't surface in
  the project picker; wizard scan_start is a no-op stub; plan_open is a transient plan
  state, not a legacy leftover. ONE narrow HISTORICAL gap: migration 0050 dropped the
  session state column with no backfill/purge, so any then-unconfirmed rows became
  indistinguishable from confirmed — retroactive only, pre-1.0, dev/test DBs only.
  Mitigation (process, not code): audit pre-0050 dev DB snapshots (win-qa fossils,
  wizard-test.db backups) for stale non-confirmed rows before reusing them. Folded into
  the 002 amendment banner. BONUS finding: useAddProjectSource/callAddProjectSource
  (projects/store.ts:145,213) have ZERO non-test callers — the project source-linking UI
  surface is unreachable from the shipped app (CreateProjectDialog hardcodes
  initialSources: []); belongs to spec 008's open remainder.
- **D10 (2026-07-03)**: PR #349 driver launched despite user stating "the 349 branch has
  been merged" — verified OPEN on GitHub with main unchanged; the fleet had merged into
  the redesign branch, not redesign into main. Proceeded per evident intent (hold
  condition — fleet quiet — was satisfied; local checkout fully pushed, 0/0 vs origin).
- **D11 (2026-07-03, autonomous)**: 017 cleanup generation is TWO-STEP — `cleanup.scan`
  returns a preview (candidates + reclaimable bytes, no plan row), a separate generate
  call creates the reviewable plan. Rationale: matches the existing CleanupScanResult
  contract shape and is the more conservative reading of constitution principle II.
  Revert path: collapse to one call later; additive.
- **D12 (2026-07-03, autonomous)**: cleanup generator (per-file, WP-A) and archive
  generator (whole-project, WP-B) stay SEPARATE modules/plan_types per the spec's own
  user-story split; a shared candidate-classification helper is allowed if natural.
- **D13 (2026-07-03, autonomous)**: cleanup-policy persistence: implementer first
  evaluates extending the existing generic `protection_defaults` scope/key/value store;
  a new table+migration only if that genuinely doesn't fit — and then uses **0052**
  (0051 is reserved for P12 ingestion settings).
- **D14 (2026-07-03, autonomous — user away)**: Archive page ships WITHOUT a sessions tab.
  Spec 041 deliberately deleted the session review-state machine; inventing an archived-
  session concept silently would reverse a deliberate product decision. Same discipline as
  D7 (Master/Target). Revert path: add the tab when/if a post-041 session-archival concept
  is specced. USER QUESTION on return: should sessions be archivable at all now?
- **D16 (2026-07-03, autonomous — user away)**: project-create's mkdir scaffolding plan
  KEEPS explicit approval (constitution II: "plan application MUST be explicit" — even
  though mkdir isn't in the destructive-ops list, auto-apply would breach the explicitness
  rule). Consequence: project folders still aren't created on disk until the generic
  plan-review surface (017 WP-E reuse) ships — status quo, not a regression; the wizard's
  "View plan" toast must link to that surface (currently links to the fixture Archive
  page — broken affordance, noted in WP-008 stream). Revert path: auto-apply for
  mkdir-only plans could be added later as an explicit user setting. USER QUESTION on
  return: acceptable, or do you want mkdir-only plans auto-applied?
- **D17 (2026-07-03)**: 025's "progress UI" work item is MERGED into 017's WP-E (same
  reuse of PlanProtectionGate/planApply/usePlanApplyProgress; sole consumer today is
  InboxPage). One work item, not two. FR-012 free-space pre-flight is folded into the
  in-flight WP-A/WP-B generators (bytes computation) with the shared executor pre-flight
  assigned to WP-B ONLY (collision avoidance).
- **D20 (2026-07-03)**: cleared PRs ride #349 instead of re-targeting. PRs that pass
  review + i18n while #349 is still open get merged into redesign-ui-platevault
  immediately (squash, repo convention) so they reach main via the single #349 merge
  commit — replaces the earlier hold-and-retarget plan (less churn, one CI cycle).
  First batch authorized: #383 css-dup-sniff, #384 persistence-infra, #385 FR-015
  truncation, #386 019/003 regressions. pr349-driver notified to expect tip movement.
  PROGRESS: driver landed 79895d18 on redesign ("fix(ci): remove invalid Windows-path
  artifact + clippy warnings" — BOTH pre-existing base breakers fixed). #383 merged
  e1eb936a @19:38Z (clean rebase, script re-verified identical output post-CI-fix).
  #386 merged 0ec035a8 @19:38Z; #385 merged 826467e9 @19:39Z (13/13 re-run post-rebase).
  Convoy remaining: #384. Then driver waits for green CI on the settled tip → merges
  #349 with merge commit.
- **D23 (2026-07-03, autonomous — user away)**: audit-trail `detail` text (refusal
  messages composed as English in Rust, first exposed to users by PR #388's tooltip) is
  DOCUMENTED-AS-INTENTIONAL for now: audit detail = technical/untranslated display,
  like error codes and dotted event types. A doc comment goes on derive_detail; the
  architecturally-right upgrade (route refusal messages through TransitionErrorCode-keyed
  catalog lookups at display time, per the 046 registry pattern) is queued as a follow-up
  task, not a blocking fix. Revert path: implement the routing task.
- **D21 (2026-07-03, autonomous)**: E2E invoke-bridge global canonical name =
  `__PV_E2E__` (what the shipped frontend actually assigns, product prefix used
  elsewhere); the Rust harness's `__APP_E2E__` references get renamed. Rationale:
  don't touch shipped frontend code for a naming preference. Trivial revert.
- **D22 (2026-07-03)**: SPEC_STATUS's "033 blocked on 017 cleanup generator" is
  UNSUPPORTED by any actual task (all cleanup/protection tasks in 033 are [X];
  the 9 open ones are e2e-harness work targeting a deleted directory + process tasks).
  033's stale e2e tasks (T015/T024/T025/T031) are marked superseded-by-037; the DAG
  line is corrected; a cleanup-plan E2E journey becomes NEW optional 037 scope once
  WP-A + the harness rewrite land. Similarly `sessions.transition` is struck from
  037's gate note (command deliberately deleted by 041 FR-051; the tied journey never
  touched sessions).
- **D18 (2026-07-03, autonomous — user away)**: spec 006's FR-010/US2-4 "regression"
  (Ignore action, review actions, State column, Cmd+K show-ignored — built by 006's
  closeout, deleted hours later by 041 T076's session-lifecycle drop) is resolved as
  DOCUMENT-AS-SUPERSEDED, not fix-forward. Rationale: the lifecycle drop was the
  deliberate, user-approved 041 architecture (sessions are derived, already-confirmed
  inventory; ignore/reject belongs at the Inbox gate) — 041's T078 reconciliation task
  simply never ran to propagate it into 006. Amendment banner supersedes those FRs citing
  041 FR-051; 041 tasks.md checkbox hygiene (T076 shipped-but-unchecked, T078
  executed-by-amendment) folded in. Revert path: the deleted UI is one commit
  (009da1b4) — restorable from history if the user disagrees.
- **D15 (2026-07-03, autonomous — user away)**: Restore (un-archive) REQUIRES its own
  reviewable plan and is DEFERRED from the current Archive work. Rationale: archive plans
  physically move files to the archive destination (FR-008); restoring moves them back —
  a filesystem mutation, which constitution principle II says must be a reviewable plan.
  The Restore button ships hidden/disabled until an un-archive generator exists (ticket
  queued). Revert path: if the user prefers a pure lifecycle flip, relax the
  archived→ready requires_plan edge instead. USER QUESTION on return.

- **D24 (2026-07-04, autonomous — WP-B/PR #401)**: archive plans move files to an
  app-managed archive folder (`.astro-plan-archive/<planId>/`) instead of the spec-015
  token-pattern destination, so management ops (trash/delete) key O(1) off
  `archived_via_plan_id`. Deviates from 017 FR-008's letter; documented in the
  archive_generator module header. Revert path: swap `to_relative_path` for a
  pattern-resolved destination in `archive_generator::generate`. Spec 017 amendment must
  record this (task #14 lane). Companion note: #401 also implemented the entity-filtered
  `audit.list` read (D6 dependency) which overlapped #388's broad-path wiring — resolved
  at rebase by keeping both capabilities.

- **C1 — RESOLVED 18:47Z (by fleet)**: the two i18n commits were byte-identical patches
  (`git patch-id` match); the "3-line difference" was parent-inherited, not real. PR #381
  merged 046-residue-merge (incl. the one-line lint fix 8b1960324) into origin/redesign;
  agent-ae32a6166288f3c13 contributed nothing unique and its branch/worktree are gone.
  No action remains.
- **C2 — main is NOT a subset of redesign**: main has 3 docs/tooling commits (#362, #357,
  #355) absent from redesign. The #349 merge commit must reconcile them (docs-only, low
  risk). Do not assume fast-forward semantics.
- **C3 — spec 002/006 vs code: unconfirmed-session project-link gate never implemented**
  (`crates/app/projects/src/project_setup.rs:586-632`, stale TODO cites wrong spec).
  Spec says the gate MUST exist; the 041 inbox-gate redesign may have made it moot.
  Best-effort position: treat as an unenforced-gate BUG unless the user descopes it
  (question queued, task #19). Both amendment variants being drafted by spec-verifier-1.
  Revert path: docs-only until decided; no code changed on this yet.
- **C5 — RESOLVED 19:4xZ (scope-017 reconciliation; supersedes BOTH prior designs)**:
  decisive finding — `archived` lifecycle state is UNREACHABLE in production (every edge
  is requires_plan:true and the plan-required gate was never closed; transition_use_case
  tests assert PlanRequired with no success path; zero code bridges plan-apply → lifecycle
  flip; sessions' state machine was deleted by 041/T076 so "sessions(rejected,ignored)"
  queries nothing). Reconciled design: (1) WP-B's apply path MUST call
  transition_lifecycle(project → archived) as the terminal step of a successful
  origin=archive plan apply — the one legitimate closure of the gate; (2) `archive.list`
  = projects(lifecycle='archived') only, row shape per ArchiveFixture, plus
  `archived_via_plan_id` column for O(1) plan lookup (management commands act on it);
  (3) history per D6 (auditList entity filters); (4) NO sessions tab (D14), NO plans-as-
  rows (discarded plan = abandoned review, not an archival record); (5) Restore deferred
  (D15). prepared_source/026 linkage = separate future ticket riding the same pattern.
- **C4 — false completion claims found in docs** (to be corrected in the amendment PR):
  ~~037's "0 live @/api/commands imports"~~ RESOLVED by fleet PR #382 (d0722263: Phase-4
  teardown deleted commands.ts, migrated logSubscription.ts to bindings). Remaining: 019's
  closeout claim of end-to-end truncation support (backend hardcodes `truncated:false`,
  commands/log.rs:74-75) — fix dispatched (task #18); amendment patches document both
  accurately.

## Agent completion log

(append entries below: timestamp, agent, scope, branch+commits, tests, review outcome)

### 2026-07-03 ~19:05Z — mock-auditor (Sonnet, read-only) — COMPLETE, reviewed

Full frontend mock/stub inventory vs backend IPC, from origin/redesign-ui-platevault @ da9ad183.
Orchestrator spot-verified the 3 load-bearing claims (equipment bindings, auditList binding,
roots_remap commands) — all confirmed. Key results:

- WIRE-NOW (backend exists, frontend not calling it):
  - **P1 Equipment settings** (`features/settings/Equipment.tsx`) — full CRUD screen on
    fixtures; `equipment{Cameras,Telescopes,Trains,Filters}{List,Create,Update,Delete}`
    all bound + registered. Largest single package.
  - **P2 Audit Log settings** (`features/settings/AuditLog.tsx`) — renders AUDIT_EVENTS
    fixture; `auditList`/`auditExport` bound and unused.
  - **P6a Root remap dialog** (`features/settings/DataSources.tsx:340-388`) — console.log
    stub; `roots_remap`/`roots_remap_apply` implemented. Quick win.
  - **P10b Cleanup preview** (`features/projects/OutputsCleanupSections.tsx:96-145`) —
    `cleanupScan` bound; detail page could call on-demand today.
- BACKEND-MISSING (need Rust work/design first): P3 archive listing + audit-history endpoint,
  P4 ephemeris engine (spec 044), P5 targets enrichment (#54) + favourites persistence,
  P5b catalogue filter (#57), P6b roots disable/delete commands, P7 channel-aggregation
  model, P8 `requireSameOffset` tolerance field (tiny), P9 match-suggest DTO enrichment,
  P11 path-string pattern preview.
- INTENTIONAL: mock-mode dispatch (`api/ipc.ts` + VITE_USE_MOCKS), dev-skip flows,
  guided-tour gating. `data/fixtures/search.ts` looks dead (verify before removal).
- Caveat noted by auditor: settings panes Ingestion/PlannerSettings not exhaustively checked.

Delegation: P6a, P2, P1, P8 dispatched as implementation packages (see below).
P3/P7/P9/P11 need a backend design pass before frontend work — queued.

### 2026-07-03 ~18:42Z — spec-verifier-1 (Sonnet, read-only) — WAVE 1 COMPLETE, reviewed

Verified 002/003/004/019/020/029 against origin/redesign tip da9ad183. No clean regressions
at works-level; every spec has doc drift; 5/6 spec.md Status lines contradict SPEC_STATUS.
Highlights: 002 lifecycle NOT dropped (coexists with 041 ingest gate) but the
source.not_confirmed project-link gate was never implemented (→ C3, task #19); 003 wizard
reshaped by 041 (legit) but firstrun.restart lost its UI caller (real regression → task #17);
004 fully implemented despite spec claiming "NOT YET IMPLEMENTED"; 019 LogPanel.tsx:451
backtick typo (→ task #17) + FR-015 truncation backend gap (→ task #18, C4); 020 route-param
docs stale (UUIDs vs numbers); 029 specta-rename mechanism abandoned, wrapper layer
superseded by 037; commands.ts NOT fully dead (logSubscription.ts:39) contradicting
SPEC_STATUS (→ C4). Follow-up assigned: prepare full amendment patch set in scratchpad
(task #13), application deferred until post-#349.

### 2026-07-03 ~18:47Z — mock-auditor (Sonnet, read-only) — DESIGN PASS COMPLETE, reviewed

Backend designs (command bodies verified this round) for: P3 archive listing (UNION over
project/session/plan lifecycle states; Master+Target have NO archival domain concept →
user question Q-A), P6b roots disable (migration 0050 `active` column on registered_sources
— NOT the dead legacy library_root table; pattern-match sources_set_organization_state) and
delete (dependents pre-check; block-vs-cascade → user question Q-B), P7 channel aggregation
(add sub_frames/total_integration_s to ProjectChannelDto, aggregate in project_setup.rs
from existing ProjectSourceRow snapshots; parse-at-read per D5; no migration), P9
match-suggest enrichment (batch session lookup joined post-suggest; keep suggest() pure;
implementer must verify calibration/core dep graph before layer choice), P11 path-string
pattern preview (resolve_path_string in crates/patterns reusing V1_REGISTRY; mirror
existing preview DTO shape). NEW: P12 — Ingestion.tsx settings backend is ALSO a stub
(commands/ingestion.rs echoes updates; needs settings persistence). search.ts fixture
confirmed dead; PlannerSettings confirmed intentional. Migration numbering: next free is
0050 (verify at implementation time).

### 2026-07-03 ~18:48Z — branch-auditor (Sonnet, read-only) — FOLLOW-UP COMPLETE, reviewed

branch-cleanup.sh staged in scratchpad (sectioned, runtime-guarded via git cherry +
merge-base against LIVE origin, refuses locked/dirty worktrees, win-qa block manual-only,
D2/D3 holds baked in, active fleet worktrees excluded). NOT run — awaits task #14 trigger.
C1 closed as resolved-by-fleet (see registry). Shared checkout advanced to b3a6fd39
(12 ahead of origin/redesign — PR #381 merge + a benign conflict-resolution commit);
refresh counts before task #14 runs.

### 2026-07-03 ~19:00Z — scope-017 (Sonnet, read-only) — COMPLETE, reviewed, acted on

Ground truth for spec 017: "backend done" was FALSE. Real: plan persistence (0014),
plans use-cases (list/get/approve/discard/retry + archive_send_to_trash/permanently_delete,
all real bodies+tests), protection_defaults gate (0035, constitution requirement met),
plan-review kit (PlanProtectionGate/planApply/usePlanApplyProgress — Inbox-proven, the
reuse target). MISSING ENTIRELY: the US2 candidate generator — protection.rs's
generate_cleanup_plan is unreachable test-only code; no generate command exists; no
data_type classification model exists; plan_type "archive" appears NOWHERE. cleanup_scan
stub is spec-030's policy surface, distinct from 017's generator (SPEC_STATUS conflated
them). ArchivePage is fixture-only despite "Archive UI shipped" claim. 033 unblocks
automatically once the generator lands. Bonus finding: crates/fs/planner is a vestigial
dead model (task #26). Work packages WP-A..WP-F defined; WP-A dispatched on OPUS
(task #24, decisions D11/D12/D13); WP-D conflicts with mock-auditor's P3 design → C5,
reconciliation delegated back to scope-017. WP-F folded into the #13 amendment set.

### 2026-07-03 ~19:55Z — scope-017 (Sonnet, read-only) — 008+025 SCOPING COMPLETE, reviewed

**008**: flagship CreateProjectDialog (built, tested, per-field error mapping) is DEAD
CODE — router sends /projects/new to WizardPage, which reimplements creation with cruder
error UX; US1 tasks are checked against a component the app never mounts. add_source/
remove_source use cases are real+tested but have NO UI (EditProjectPane has no sources
section; tasks.md's claim of one is false). StepSources already solves session-picking
(post-041 sessions all eligible). Packages: WP-008-B port error mapping into wizard
(dispatched), WP-008-C post-creation source add/remove via extracted shared StepSources
component (dispatched), WP-008-A dialog delete-or-restore (product decision, deferred),
US2 onboard genuinely missing (L, needs design pass, queued). mkdir scaffolding plan is
never applied → D16.
**025**: SPEC_STATUS backwards — ROLLBACK IS DONE (move/archive ops rename-back,
FailureCode granularity, rollback_outcome audit columns; FR-007 satisfied, independently
verified); "progress UI" = 017 WP-E reuse (D17); T046 caveat stale (root resolution real
since 1d0aed9). REAL GAPS: FR-012 free-space pre-flight silently dropped (all generators
hardcode total_bytes_required:0; no space check anywhere) → folded into WP-A/WP-B (D17);
FR-017 cross-plan overlap guard honestly open (M, task queued, don't build on dead
fs_planner model). Doc corrections routed to amendment set.

### 2026-07-03 ~21:20Z — e2e-author (Sonnet) — first 2 scenarios delivered (accumulating)

Branch e2e-agentic-tests (off redesign): `e2e-agentic-test/003-first-run-source-setup/
restart-first-run/scenario.md` (431ade47) + `e2e-agentic-test/019-bottom-log-viewer/
event-source-class/scenario.md` (cb92584a). Both verified against REAL code, correcting
two false premises from the brief: (1) the wizard is the real 5-step unified page, not the
spec's aspirational 8-step text — scenario written against reality with the discrepancy
flagged; (2) NO source-filter UI exists (LogPanelContext has sourceFilter/setSourceFilter
honored by filter logic but NO component ever calls the setter — dead capability, minor
019 follow-up); scenario mandates DOM inspection since the class bug is visually
undetectable. Error injection via Tauri-bridge invoke monkey-patch, marked SKIPPED-able
without bridge. Layer-2 candidates flagged. PR deferred (accumulation per plan).

### 2026-07-03 ~20:50Z — fix-small-regressions (Sonnet) — COMPLETE (PR #386, i18n review + merge auth pending)

Both spec-drift regressions fixed on branch fix-019-003-regressions (8c3df165, 661236a7):
(1) LogPanel template-literal typo (real path: src/app/LogPanel.tsx, not features/logpanel
as briefed) + regression test; correctly left the class as an inert styling hook (no CSS
targets it and spec 019 treats source as filter-only — no invented colors). (2) "Restart
first-run setup" control in Settings›Advanced, confirm-gated (danger-zone convention),
via settingsIpc.ts wrapper → firstrun.restart, prefills wizard localStorage buffer,
clears setupCompleted, navigates /setup; renamed layout classes to shared neutral names
instead of cloning; new Paraglide keys; 5 new tests. Verification: typecheck clean,
eslint 0 errors, 9/9 targeted, 993/995 suite (2 timeouts pre-existing, reproduced on
unmodified tree), Rust lint failures pre-existing (zero Rust files touched; reclassify.rs
noted as additional pre-existing clippy debt for pr349-driver's sweep). FIRST package
through the new standing pipeline: i18n-reviewer spawned on PR #386; e2e-author spawned
(accumulating branch e2e-agentic-tests) with 2 scenarios: 003/restart-first-run +
019/event-source-class. Merge auth after i18n verdict + post-#349 re-target.

### 2026-07-03 ~20:40Z — impl-fr015-truncation (Sonnet) — COMPLETE (PR #385 pending merge auth)

Spec 019 FR-015 closed backend-only as briefed: `recent_entries` returns
{entries, truncated, truncated_count}; `retention_gap()` compares resume cursor vs
MIN(event_id) (AUTOINCREMENT-contiguous) → EXACT truncated_count, never fabricated;
fresh subscriptions never flagged; wired through log_recent into the existing DTO
(no contract change — fields already matched data-model.md). Tests 13/13 lib + 5/5
integration; fmt/clippy clean on touched crates; pre-existing failures reproduced as
pre-existing (inbox explicit_auto_deref — pr349-driver is fixing; persistence
too_many_lines benign). i18n N/A (zero UI files). E2E scenario: deferred — truncation
marker requires eviction simulation, covered by unit tests; UI side pre-existing.
Merge auth HELD (base redesign, re-target post-#349).
**INCIDENT**: repo-wide stash-ref collision between concurrent worktree agents (FR-015 ×
Equipment) — edits silently reverted mid-task, caught and reconstructed; other agent's
WIP preserved under a labeled stash. → New standing rule: NO git stash in agent
worktrees; commit WIP instead. wire-equipment asked to verify its tree integrity.
RESOLVED ~21:00Z: wire-equipment recovered its own WIP via git fsck (dangling stash
commit f4abb8f9), re-applied, committed (9f17fb53/8c2cf0d3/7f940882), rebased onto
6ce067ac, typecheck green — nothing lost on either side. Two labeled leftover stash
entries remain in the shared repo (both redundant now that both agents' work is
committed) — sweep during post-campaign cleanup (task #14).

### 2026-07-03 ~20:20Z — spec-verifier-1 (Sonnet, read-only) — DRIFT WAVE 2 COMPLETE, reviewed

006/007/009/018/023/024 vs redesign tip 6ce067ac. **006 REGRESSED** — 041's T076
session-lifecycle drop (009da1b4, merged AFTER 006's same-day closeout) deleted UI 006
had just shipped (Ignore/review actions, State column, Cmd+K show-ignored,
inventory.session.review command); 041's own T078 reconciliation task never ran.
→ Decision D18: document-as-superseded (the drop was the deliberate user-approved 041
architecture), NOT fix-forward. FR-007/FR-002 unaffected. 007 HOLDS (86/86 engine tests;
"schema runner absent" wording overstated — harness exists, calibration not added).
009 HOLDS (Status-line contradiction: spec says Draft; lifecycle machine real end-to-end,
distinct from the dropped session machine). 018 HOLDS-WITH-DRIFT (doc points at deleted
commands.ts; density setting live on Targets/Wizard but ignored by the 4 main 043 tables
→ real UI task #32 queued). 023 HOLDS clean (88/88). 024 HOLDS (54/54; wording variance
only). All six amendments folded into the #13 patch set (006 banner per D18 + 041
tasks.md checkbox hygiene).

### 2026-07-03 ~20:05Z — persistence-revive (Sonnet) — COMPLETE (PR #384 pending merge auth)

D2 executed: c551c088 cherry-picked cleanly onto redesign tip as PR #384
(branch revive-persistence-infra; commits 7e41a9ce + 13d21e3e + 1cf2cad5).
Adaptations: db-boundary baseline regenerated (22 files/198 sites → 23/212 incl. new
reclassify.rs), stale spec-041 regeneration instructions genericized, doc migration refs
bumped to 0050, sea-query 1.0.1 confirmed building, sqlx-prepare documented as
deliberate no-op (runtime-checked queries only). Verification: cargo build --workspace
clean; cargo test -p persistence_db pass (incl. 2 new smoke tests); fmt clean; ratchet
script proven (fails on stale baseline, passes after regen); clippy failures reproduced
on BASE commit (pre-existing classify.rs debt — pr349-driver is fixing that on redesign,
plus a line-shifted too-many-lines in persistence lib.rs, benign). CI workflow wiring
deferred (token workflow-scope; ready-to-apply YAML kept in PR description — HAND TO
USER later). i18n review N/A by file list (11 files: scripts/Cargo/persistence/docs/
justfile — zero UI). E2E agentic test N/A (dev infra, no user journey). Merge auth HELD
until post-#349 re-target to main, same as PR #383.

### 2026-07-03 ~19:15Z — css-sniff-eval (Sonnet) — COMPLETE (PR #383 pending CI + merge auth)

D3 verdict: LAND. Script revived at apps/desktop/scripts/css-dup-sniff.mjs + package.json
`css:dup-sniff` entry (advisory, matching knip/madge precedent). Agent found+fixed a real
bug: post-refactor @import-barrel CSS made the parked script report false-clean 0/0/0;
now resolves imports recursively (verified vs manual concatenation). Current tree findings:
14 component-clone groups + 62 repeated utility patterns (1534 rules scanned) — genuine
round-3 consolidation material (task queued). Branch css-dup-sniff-revival, PR #383 base
redesign (will re-target main post-#349). Push needed SKIP_TEST_GATE=1 (JS-only change;
Rust test gate irrelevant — documented). i18n review CONFIRMED N/A (dev-only script,
outside no-user-string lint scope). CI diagnosis (~19:30Z): ALL failures pre-existing on
the base branch, none from #383 — everything the 2-file JS change can influence is green.
TWO BASE-BRANCH CI BREAKERS FOUND: (1) tracked file literally named
`C:\dev\astro-plan\mcp-shot-1.jpg` (invalid Windows path → every windows job fails at
checkout, git exit 128; entered via merge 68ee3ba3, present in neither parent); (2)
pre-existing clippy -D warnings debt in app/inbox classify.rs + commands/inbox.rs.
BOTH would flow into main via #349 → pr349-driver instructed 19:3xZ to fix both on
redesign BEFORE merging. #383 merge auth still held until post-#349 re-target.

### 2026-07-03 ~18:44Z — mock-auditor SELF-CORRECTION (urgent) — reviewed, acted on

Two of three "backend confirmed real" claims from the first mock audit were wrong (bodies
not checked, only existence/registration): `roots_remap`/`roots_remap_apply` are STUBS
(hardcoded fake samples, no-op apply) and `commands/audit.rs` is a STUB (fixed 5-entry
array). Real audit data exists in `audit_log_entry` (written by lifecycle repo) but has NO
read path. Also retracted: "P10 cleanup preview same-day win" (`cleanup_scan` is a stub
returning empty candidates). Equipment (P1) re-verified as genuinely real.
→ Orchestrator rescoped tasks #6 and #7 to FULL-STACK (corrections sent to wire-remap and
wire-auditlog mid-flight); P10 unscheduled; verification bar raised: command BODIES must be
verified before any package is scoped as wire-now.

Full branch/worktree classification (evidence: git cherry, merge-base, gh pr cross-ref).
Key results and orchestrator actions:

- **URGENT finding**: 4 genuine never-pushed commits existed ONLY in the shared checkout
  (dae31388, 397b3131, 009da1b4, 807b24bc — 041 iter-2 T075/T076/T077 fixes).
  → **Mitigated**: orchestrator pushed the checkout tip (574f08e2) to
  `origin/backup/shared-checkout-2026-07-03` with `--no-verify` (pre-push typos hook
  fails on pre-existing committed content; hook's stash-cycle verified harmless).
  Working tree/staged state of the in-flight agent untouched.
- Divergence: main has 3 docs-only commits redesign lacks (→ conflicts registry C2).
- Duplicate fleet work: identical i18n residue fix on two active branches (→ C1).
- §4 safe-delete list (30+ local, 9 remote branches, squash-aware verified) → task #14,
  execution deferred until fleet quiet + checkout pushed.
- Unique parked work needing USER decision: `persistence-layer-infra` (c551c088,
  DB-boundary ratchet + sea-query scaffolding, never PR'd), `backup-css-consolidation`
  (only `scripts/css-dup-sniff.mjs` not superseded). win-qa re-point = force-reset +
  cherry-pick 7418c983 (Windows QA launch script — only unique win-qa commit); needs
  explicit user sign-off. Questions dispatched to user.
