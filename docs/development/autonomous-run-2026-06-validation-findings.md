# Autonomous Run 2026-06 — Independent Validation Findings (2026-06-17)

> Independent, evidence-based verification of the 21 specs the autonomous run
> (`autonomous-run-2026-06-master-plan.md`) claims it implemented. Produced by
> 21 parallel `speckit-verify` agents, one per spec, each instructed to treat the
> run's self-reports as **unverified** and to classify every gap as either
> *known-deferred (acceptable)* or *surprise gap / phantom completion (dangerous)*.
> This file — not the `tasks.md` checkboxes — is the accurate open-work ledger.

## Gate truth (independently re-run in WSL, 2026-06-17)

| Gate | Result |
|---|---|
| `cargo test --workspace` | **1087 passed, 0 failed** (63 binaries) |
| `cargo clippy --workspace --all-targets -- -D warnings` | **clean** (exit 0) |
| `cargo fmt --all --check` | **clean** |
| `just typecheck` | **clean** |
| `vitest` (apps/desktop) | **465 passed** (45 files) |

The run's "RUN COMPLETE / all green" gate claim is **TRUE**. The code is real
(not stubs): crates have full bodies, 30 sequential migrations (0001–0030) exist.
**However** the green gates only prove the logic that is *tested* is correct —
they do not prove the features fire on real (non-fixture) data, that the UI
exposes them, or that the spec FR/SC are met. That gap is what this validation
covers.

## Runtime smoke (WSL, Vite dev server + mocks, Playwright) — 2 release-blocking crashes

Driving the real UI (`VITE_USE_MOCKS=true` dev server, Playwright browser) — newly
possible per the user's dev-server steer — found **two crashes that all 1552 green
tests missed**, because vitest mounts components under a test router/fixtures that
hide them. Both are caught by spec-028's `AppErrorBoundary` (good — no white screen),
but both render the screen unusable.

- **R-1 (RELEASE BLOCKER) — `/` index route crashes for every returning user.**
  When `setupCompleted` is true, the index route (`router.tsx:235`, `path:'/'`)
  renders `SessionsPage` directly, but `SessionsPage` calls
  `useSearch({ from: '/shell/sessions' })` (`SessionsPage.tsx:36`). Under the index
  match the active route is `/shell/` (not `/shell/sessions`), so TanStack throws
  `Invariant failed: Could not find an active match from "/shell/sessions"`.
  Reproduced deterministically. A returning user opening the app lands on
  "Something went wrong!" instead of their sessions. Fix: index route should
  `throw redirect({to:'/sessions'})` rather than render `SessionsPage`. *(Navigating
  to `/sessions` directly works fine — see below.)*
- **R-2 (BLOCKER) — `/calibration` crashes on load.** `MastersList.tsx:126` throws
  `Cannot read properties of undefined (reading 'gain')` mapping master dimensions —
  a null-safety bug (and/or mock-vs-real shape mismatch; recall 007 found the masters
  list is a fixture stub). The Calibration ledger is unreachable.

**Routes that render cleanly** (mocks): `/setup` (full 4-step wizard), `/sessions`
(9 sessions grouped by root, filters, detail pane), `/inbox`, `/targets`, `/projects`,
`/archive`, `/settings` (+ `/settings/data-sources`). First-run guard correctly
redirects incomplete-setup users to `/setup`. The runtime also visually **confirmed
023's nav violation** — "Targets" is a primary sidebar entry.

> These are mock-data results. The Windows-native pass (real Rust backend) must
> re-run this sweep — R-2 in particular may differ in cause against real data, and
> R-1 will reproduce regardless (it is backend-independent).

## tasks.md checkboxes are NOT a truth source

Confirmed drift in both directions:
- **Built-but-unticked**: 005 (0/51 ticked), 015 / 023 (0/0) are fully implemented.
- **Ticked-but-phantom**: 010 marks frontend test tasks `[x]` for test files that
  **do not exist**; 018 marks T020 `[x]` though the debounce/snapshot timer is
  never wired; 024 claims component vitest suites that are absent.

Do not "reconcile checkboxes." Track the items in this document instead.

---

## TIER 1 — Undisclosed correctness / safety holes (fix before trusting on real data)

These are **surprise gaps**: not in the run's disclosed "deferred/KNOWN" list, and
they mean a feature is wrong, silently lossy, or cannot fire on real data.

### T1-1 · Spec 016 — protection gating is structurally dead (PHANTOM)
`plan_protection_check` reads `plan_items.protection`, but **every real plan
generator hardcodes `protection:"normal"`** — `prepared_views.rs:222`,
`project_setup.rs:219`, `plans.rs:550` (retry copies parent). Only test fixtures
ever set `"protected"`. So the entire protection gate (US3/US4, FR-004/FR-005)
**can never trigger on a plan produced by real code.** Also: global-defaults
persistence (T-003/T-005) unwired; `source_id` hardcoded `None` in protected-item
responses (`protection.rs:287`) → incomplete audit. Constitution §II requires
protected categories to gate cleanup; today they don't.

### T1-2 · Spec 025 — filesystem executor (SAFETY-CRITICAL): three undisclosed defects
The safety *basics* PASS: every action appends an audit event; `move_file` refuses
an existing destination (no silent overwrite); move/archive roll back on partial
failure; approval is CAS-gated (`approved → applying`). But:
- **Path resolution is a runtime correctness hole** (`plan_apply.rs:173`): items
  pass **raw relative paths** with no library-root join and no escape/symlink
  check. On a real filesystem they resolve against the process CWD or fail
  `SourceMissing`; the CAS staleness check stats the wrong path. This must be
  fixed before any real apply — it is the core Constitution §II promise.
- **`confirm_required = is_protected` logic inversion** (`plan_apply.rs:199`):
  destructive-confirm is conflated with protection status. A non-protected
  `delete` item gets `confirm_required=false` and is blocked for the wrong reason;
  a protected item proceeds. There is no separate destructive-confirm signal.
- **Retry / pause-resume / bulk-cancel are not what they claim**: in-run
  `retry_queue` never re-injects into the fixed executor loop; `resume_run`
  flips DB state but the tokio task already returned `Paused` (no in-process
  resume); `batch_cancel_pending_items` bulk-updates without per-item audit rows
  (Constitution §II "every item state transition logged" gap for mass cancel).

### T1-3 · Spec 009 — two live lifecycle tables + missing audit + dead blocked-reason
- **Two authoritative tables**: auto-transitions/health write spec-008
  `projects.lifecycle` (`project_health.rs`); user-triggered IPC transitions write
  the legacy spec-002 `project.state` (`transition_use_case.rs`). Both are live →
  a project's lifecycle can **silently diverge** between the two surfaces.
- **Auto-block / auto-ready write NO audit row** (event-bus only) — Constitution
  §II durable-audit gap.
- **`blockedReason` is hardcoded** `{kind:'user', note:'…'}` in
  `ProjectDetail.tsx:185`; the typed reasons `project_health` produces
  (`source_missing`, `tool_unconfigured`, …) never reach `BlockedBanner`
  (FR-009 / SC-001 not actually met at runtime).
- SC-004 lifecycle filter is single-select, not multiselect; `project.unarchived`
  named event not emitted.

### T1-4 · Spec 014 — minisign signature verification NOT implemented
`download.rs:374` explicitly defers crypto verification: the manifest `signature`
is parsed and stored but **never cryptographically verified**. SHA-256 checksum
IS verified, so the run's "signature/checksum verification" claim is checksum-only.
Also: `origin.not_implemented` guard is **phantom** (no `origin` field on the
request; the error code is never reachable); unknown license codes silently fall
back to `PublicDomain` (`catalogs.rs:166`) instead of hard-failing (FR-001);
catalog upsert + attribution are two non-transactional writes.
(Real downloads are inert anyway — external repo unpublished — so this is not yet
exploitable, but the security claim is overstated.)

### T1-5 · Spec 018 — silent settings data-loss bug
`CalibrationMatching.tsx:230` saves the aging threshold to scope
`'calibration_matching'` (not a real scope) with a key absent from the v1 set →
the backend's unknown-key filter **silently drops it**; the user's change is
accepted by the UI but never persisted. Also: T020 debounce/snapshot timer is
**not wired** (no `emit_snapshot` caller) despite a `[x]` checkbox; the Cleanup
per-type action table is still fixture-driven. (Transport-regression fix from the
run **is** confirmed genuine.) Note: spec 007 has the *same* wrong-scope bug for
its aging-threshold control.

### T1-6 · Spec 005 — destructive-destination choice never surfaced in UI
Backend accepts `destructive_destination` (archive/os_trash), but
`ActionSidebar.tsx` / `InboxPage.tsx:56` never render the toggle and pass nothing,
so confirm **always silently defaults to `archive`** (FR-017 unmet). Also: the
`repair` scheduler module referenced by `plan_listener` docs **does not exist** —
combined with the deferred `plan_listener` startup spawn, orphaned inbox items
have no safety net. Pattern is resolved but not snapshotted onto the plan row.

### T1-7 · Spec 023 — Cmd+K alias search is a fixture stub + nav violation
`search.global` (`commands/search.rs:14-50`) is **hardcoded fixtures that ignore
the query** and never read `target_aliases` → alias-aware global search is
non-functional (the palette itself is real and mounted; only its data source is
fake). `Targets` is wrongly a **primary-nav entry** (`Sidebar.tsx:40`), directly
violating FR-005/SC-002 ("MUST NOT be primary nav"). FR-003 sessions/projects on
the target detail are always empty; alias/rename/note audit events are
`tracing::info!` placeholders, not real audit-bus records (weakens FR-004/FR-006).

### T1-8 · Spec 010 — chosen tour library unused + phantom test files
`react-joyride ^3.0.0` is declared (`package.json:32`) but **never imported**; a
hand-rolled MutationObserver portal (`GuidedOverlay.tsx`) shipped instead (dead
dependency; contradicts the recorded library decision). Claimed frontend test
files (`GuidedOverlay.test.tsx`, `anchors.test.ts`) **do not exist** despite `[x]`
marks → the anchor-orphan CI gate and all UI/a11y tests are unsubstantiated. The
event→`completeGuidedStep` wiring was not locatable, so steps may never advance in
the real UI (FR-003). Backend state machine, migration, and anchors are real.

### T1-9 · Spec 012 — `artifact.classified` audit event missing (DIVERGED)
Spec FR-008 + data-model name `artifact.classified` as a distinct event; it is
**never emitted** and the topic is absent from `event_bus.rs` (only
`artifact.detected` fires). Also the `artifact.classify` Tauri response shape
(`{artifact: …}`) diverges from the contract's flat-field schema. Watcher logic
itself is real and tested.

### T1-10 · Spec 028 — "quality hardening" still ships broken token refs (ironic)
`--alm-radius` (undefined; valid tokens are `-sm/-md/-lg`) at
`NamingStructure.tsx:150,204` → border-radius silently 0. Raw-hex `var()` fallbacks
`var(--alm-warn,#c07d00)` in `ActionSidebar.tsx:138,143` + `NamingStructure.tsx`
bypass the guard. `scripts/check-tokens.sh` is **not wired into `just lint` and
there is no `.github/` CI** → the guard never runs automatically. ESLint flat
config + `AppErrorBoundary` are real.

---

## TIER 2 — Contract/schema drift & backend-vs-UI wiring gaps (track, lower urgency)

- **017** — `approve_plan` never populates `approved_mtime`/`approved_size_bytes`
  (R-FS-1); spec-025 apply therefore has no staleness baseline. `reopen`
  (approved→draft) absent. Backend otherwise solid. *(017 verifier's worry that
  026 plan origin/type values violate the `plans` CHECK is RESOLVED: migration
  `0029` recreates the table with the expanded enums and 026's tests run on the
  migrated DB.)*
- **007** — calibration masters `list`/`get` are **fixture stubs**
  (`calibration.rs:27-134`) → suggest/assign can't fire on real data; flat
  rotation + night tolerances are not user-configurable (`load_config` omits the
  keys, no UI control) (FR-002/SC-001). Matching engine itself is correct +
  66-test covered. Fingerprint-population gap is the disclosed/known one.
- **006** — FR-010 "Show ignored items" Cmd+K entry missing (the palette exists;
  the entry doesn't); mixed-type detection is fixture-only (`frame_type='mixed'`
  string match, never derived); `root_id`-not-set confirmed (disclosed); FR-007
  reveal-in-OS not wired into the Sessions detail.
- **013** — catalog-slug mismatch confirmed (013 closed enum
  `common/openngc/abell_pn` vs 014 string `opengc`…); mismatched slugs parse to
  `Unknown` and are silently skipped. FR-004 active-catalog-set filtering from 018
  settings not wired (full index always queried). Per-call DB load vs planned cache.
- **019** — `contractVersion` runtime `"1"` vs schema `const "2.0.0"` mismatch
  (schema validation would reject all real entries); `dia:` cursor not parsed
  (diagnostic resume silently replays full window); export path hardcoded `/tmp`
  (no file picker); `log.export` response missing `status` field. Pull-recent +
  export work; live push-forwarder deferred (disclosed).
- **021** — Rust dev-tools gating **PASS** (dev commands compile-time absent from a
  default build, verified across `mod.rs`/`lib.rs` `#[cfg(feature="dev-tools")]`).
  Frontend route NOT gated: `ContractsPage`/`recorder.ts` bundled unconditionally,
  render a stub (disclosed deferral T031/T036). T021 dispatcher-wrap not done → the
  recording proxy never auto-captures real calls (SC-002 unmet). `dev_export` is
  passed a relative path → the export action always fails `path.write.denied`.
- **024** — `spawn_workflow_run_subscriber` exists+tested but **never called in
  `run_app`** → manifests never auto-generate at runtime (disclosed-ish, flag it);
  `note_update` Tauri passes `project_root:None` → the on-disk notes projection is
  **never written** from the UI (DB row is, so Constitution §V holds);
  `ManifestsAccordion` omits `source_map` (SC-001 partial); claimed component
  vitest suites absent.
- **008** — no transaction/rollback on partial create (FR-006: project row inserted
  before plan; failure orphans it); `project.create` contract `lifecycle const
  "setup_incomplete"` is stale (can return `"ready"`); tool-scaffold file from
  plan.md absent from the plan items; stub `projects.create_plan` command still
  registered. The create→plan seam is **real** (reviewable plan, not a stub).
- **011** — solid. Tool-id alias bug fixed (`tool-launch.ts:32`); PixInsight
  boundary respected (spawn-and-walk-away, no scripting). Minor: BLAKE3-vs-SHA-256
  doc mismatch; row-overflow "Open in {tool}" CTA unverified; no real-spawn timing
  test.
- **015** — solid; no must-fix. Preview uses a hardcoded sample (live-inventory
  preview deferred to 018); per-source override deferred. Parser/resolver real +
  56-test covered.
- **026** — solid; CHECK-constraint PASS via migration 0029; tests run on migrated
  DB. Minor: contract JSON descriptions still say "Status: NOT IMPLEMENTED"
  (stale); SC-002 UI shows item *count* not per-item inventory refs.

---

## Cross-cutting themes

1. **"Built but never started"** — subscribers/loops implemented + tested but never
   `tokio::spawn`'d in `run_app`: 005 plan_listener, 012 artifact watcher, 024
   workflow_run subscriber, 019 push-forwarder (pull works), 010 auto-advance.
   The run disclosed this (backlog #1) — **confirmed accurate**. This is the single
   highest-leverage integration task: one startup-wiring pass activates five
   features at once.
2. **"Logic real, data plumbing absent"** — gating/matching can't fire on real
   data: 016 protection (T1-1, **more severe than disclosed** — phantom, not just
   "tagging"), 007 calibration fingerprints, 006 root_id, 023 target_id FK.
3. **Contract/schema drift, no conformance tests** — 019 contractVersion, 012
   artifact.classify shape, 008 lifecycle const, 014 license fallback. JSON-Schema
   conformance tests are deferred *everywhere*, so none of these are caught.
4. **UI lags backend** — 005 dest toggle, 009 blocked-reason, 024 source_map +
   notes-file, 006 "Show ignored". Backend is consistently richer than the UI
   exposes.
5. **Safety basics hold where they matter** — 025 audit/overwrite/rollback/approval,
   011 PixInsight boundary, 026 no-hard-delete, 017 permanent-delete gate — EXCEPT
   the 025 path-resolution + confirm-inversion + mass-cancel-audit holes (T1-2),
   which must land before any real filesystem application.

## Recommended fix ordering (proposed; for user confirmation)

1. **Before any real `plan.apply`**: T1-2 (025 path resolution + confirm signal +
   per-item cancel audit). Safety-critical.
2. **One startup-wiring pass** (theme #1): activate the five event-bus subscribers
   in `run_app`; simultaneously fixes the runtime-dead halves of 005/012/024/019/010.
3. **Data-plumbing pass** (theme #2): populate `plan_items.source_id`/`category`
   (unblocks T1-1 016 protection), session `root_id` (006), calibration
   fingerprints (007), `target_id` FK (023).
4. **Quick correctness fixes**: T1-5 (018/007 wrong-scope settings), T1-3 (009
   two-table + blocked-reason + audit), T1-6 (005 dest toggle), T1-7 (023 nav +
   search.global), T1-9 (012 artifact.classified), T1-10 (028 token refs + CI wire).
5. **Contract reconciliation** (theme #3) + the disclosed reconciliation items in
   the master plan (catalog slug, destructive_destination vocab, project tables).
6. **Decide 014 minisign** (T1-4) before publishing the catalogs repo.

## Per-spec verdict roll-up

| Spec | Verdict | Tier-1? |
|---|---|---|
| 005 inbox | implemented; UI dest-toggle + repair module gaps | T1-6 |
| 006 inventory | implemented; Cmd+K entry + mixed-detect + root_id | — |
| 007 calibration | engine real; masters stubbed, tolerances unconfigurable | — |
| 008 projects | solid; partial-create rollback + stale contract | — |
| 009 lifecycle | two-table divergence + audit + blocked-reason | T1-3 |
| 010 guided | backend real; tour lib unused + phantom tests + wiring | T1-8 |
| 011 tool launch | solid | — |
| 012 artifacts | watcher real; classified event + response shape | T1-9 |
| 013 target lookup | core real; slug mismatch + 018 filter | — |
| 014 catalog licensing | machinery real; **signature unverified** + guards | T1-4 |
| 015 token patterns | solid | — |
| 016 protection | **phantom — gating dead on real plans** | T1-1 |
| 017 plans | solid backend; approve-snapshot gap | — |
| 018 settings | transport fixed; **silent data-loss** + debounce | T1-5 |
| 019 log viewer | pull+export real; version/cursor/path drift | — |
| 021 dev diagnostics | Rust gating PASS; FE bundle + auto-capture + export bug | — |
| 023 target identity | backend real; **search stub + nav violation** | T1-7 |
| 024 manifests | backend real; subscriber + notes-file + UI gaps | — |
| 025 fs executor | safety basics PASS; **3 undisclosed defects** | T1-2 |
| 026 source-view removal | solid; CHECK ok via 0029 | — |
| 028 quality hardening | partial; **broken tokens remain + no CI** | T1-10 |
