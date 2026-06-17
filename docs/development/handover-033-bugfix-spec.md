# Handover — Create SpecKit spec 033: Validation Bugfix & Remediation

> **Your task (next session):** produce a complete SpecKit feature spec —
> `specs/033-validation-bugfix-remediation/` — that resolves every open issue
> found in the 2026-06-17 independent validation, then implement it per the
> project's SpecKit gates. This is a *remediation* feature: the bugs are already
> diagnosed with file:line evidence; your job is to turn that diagnosis into a
> reviewed spec + plan + tasks and a verified implementation.

## Source of truth (read these first, in order)

1. `docs/development/autonomous-run-2026-06-validation-findings.md` — per-spec
   verdicts, the Tier-1/Tier-2 issue catalog, the "Fixes applied" + "Remaining"
   sections. **This is the authoritative issue list.**
2. `docs/development/autonomous-run-2026-06-backlog-decisions-review.md` — the
   cross-spec reconciliation items and decision assessments.
3. `docs/development/windows-validation-runbook.md` — how to validate each screen
   against the real backend.
4. `.specify/memory/constitution.md` (in CLAUDE.md) — the gates you MUST satisfy.

## Process (per `specs/CLAUDE.md` + constitution)

Do NOT write product code before the spec artifacts exist and pass review.
Produce, in order, under `specs/033-validation-bugfix-remediation/`:
`spec.md` → `plan.md` → `research.md` → `data-model.md` → `contracts/` →
`tasks.md`. Run the Constitution Check before Phase 0 and again after Phase 1.
Group tasks by independently testable user story with an exhaustive dependency
graph. Use the project's speckit agents/skills (steering-speckit DAG).

**Verification is now stronger than the original run assumed:** the real Tauri
app runs headless here via `xvfb-run pnpm tauri dev` (webkit2gtk-4.1 present) and
can be driven with `tauri-driver` + `WebKitWebDriver`. Every fix MUST be verified
against the **real backend**, not just mocks — add real-backend acceptance checks,
not only vitest.

## Already fixed (2026-06-17, on main — treat as regression-test targets, not new work)

These four are DONE and verified; the spec should add regression tests so they
don't recur, but must not re-implement them:
- **R-1** index route `/` → redirect to `/sessions` (was crashing returning users).
- **R-2** `MastersList` fingerprint null-safety (Calibration crash).
- **005/019** `run_app` now spawns `start_inbox_plan_listener` + `start_log_forwarder`.
- **028** token refs (`--alm-radius-md`, no hex fallbacks) + a desktop `lint`
  script wired into `just lint`.

## Scope — issues the spec MUST resolve (grouped as candidate user stories)

### US1 — Filesystem-apply safety (Constitution §II; HIGHEST priority) — spec 025
- Resolve plan-item paths against the **library root** (join + canonicalize) with
  a root-escape / symlink-escape refusal before any mutation. Today raw relative
  paths are passed to move/archive/delete/trash and the CAS check
  (`plan_apply.rs:173`, `:199`).
- Introduce a **destructive-confirm** signal distinct from `is_protected`
  (`confirm_required = is_protected` is a logic inversion).
- Emit a per-item audit row on **bulk cancel** (`batch_cancel_pending_items`
  currently bulk-updates with no per-item events).
- Decide HMAC approval token vs documented token-equality; real trash crate vs
  the `TrashUnavailable` stub.
- **Gate: no real `plan.apply` ships until US1 lands.**

### US2 — Protection gating becomes real (016 / Constitution §II)
- The cleanup/archive **plan generator** must tag plan items with real
  `source_id` + `category`, then call `resolve_protection` so
  `plan_protection_check` fires on real plans (today every generator hardcodes
  `protection:"normal"`; the gate is dead). Note this is blocked on the unbuilt
  cleanup-plan generator — sequence accordingly. Populate `source_id` on
  `ProtectedPlanItem` so the acknowledgement audit is complete.
- Wire global protection defaults persistence (016 T-003/T-005) + the
  `protection.default.changed` audit event (T-004).

### US3 — Lifecycle integrity (009)
- Persist a **typed blocked reason** (migration + `project_health` write + DTO)
  so `BlockedBanner` shows the real kind instead of a hardcoded `{kind:'user'}`.
- **Reconcile the two project tables**: spec-002 `project.state` (legacy, written
  by user IPC transitions) vs spec-008 `projects.lifecycle` (written by
  auto-transitions/health). Pick one canonical table; migrate the other.
- Write an **audit row** for auto-block / auto-ready transitions (today event-bus
  only). Emit the `project.unarchived` named event.
- Make the lifecycle filter multiselect (SC-004) or update the spec.

### US4 — Ingestion data plumbing (006 / 007 / 023)
- Inbox confirm (or the apply path that creates sessions) sets session `root_id`
  so real sessions appear in the inventory ledger.
- Populate `calibration_fingerprint` / `acquisition_fingerprint` from metadata
  extraction so calibration matching fires on real data; back the calibration
  masters list/get with real rows (not the fixture stub).
- Populate `target_id` FK from ingestion (target chips + history).
- Replace the `search.global` fixture stub (`commands/search.rs:14-50`) with a
  real cross-entity query over targets/aliases/sessions/projects (Cmd+K).

### US5 — Subscriber startup wiring (012 / 024 / 010)
- 024 manifest subscriber: needs an **async-capable project-root resolver** (the
  current `spawn_workflow_run_subscriber` takes a sync `Fn(String)->Option<PathBuf>`
  that can't do DB lookups) — redesign the resolver, then spawn in `run_app`.
- 012 artifact watcher: add the notify loop + watch-paths-from-registered-roots,
  then spawn. Emit the missing `artifact.classified` event + fix the
  `artifact.classify` response shape vs its contract.
- 010 guided auto-advance: wire frontend domain events → `completeGuidedStep`;
  decide whether to keep `react-joyride` (declared but unused) or formalize the
  hand-rolled overlay.

### US6 — Catalog integrity (014 / 013)
- Implement **minisign signature verification** (today the signature is
  parsed+stored but never verified — checksum only) before the
  `astro-plan-catalogs` repo ships. Hard-fail on unknown license codes instead of
  silently falling back to `PublicDomain`. Make the catalog upsert + attribution
  transactional.
- Reconcile the **catalog slug mismatch**: 013 closed enum
  `common/openngc/abell_pn` vs 014 strings `opengc/...` (mismatched slugs parse
  to `Unknown` and are silently dropped).
- Wire FR-009 origin guard so `origin.not_implemented` is actually reachable.

### US7 — Settings & contract fidelity (018 / 007 / 019 / 012 / 008)
- Fix the **silent settings data-loss**: the aging-threshold control saves to a
  non-existent scope (`calibration_matching`) with a key absent from the v1 set,
  so it is silently dropped (same bug in 007). Pick a real scope/key and have a
  consumer read it (today `m.age_days > 90` is hardcoded in `MastersList`).
- Wire the 018 debounce/snapshot timer (`emit_snapshot` has no caller despite a
  `[x]`). Move the Cleanup per-type table off fixtures.
- Reconcile contract/schema drift with no conformance tests: 019
  `contractVersion` runtime "1" vs schema "2.0.0" (+ `dia:` cursor, export file
  picker, `log.export` `status` field); 012 `artifact.classify` response shape;
  008 `project.create` stale `lifecycle const`. Consider adding JSON-Schema
  conformance tests (deferred everywhere today).

### US8 — Dev surface & misc (021 / 005 / 006 / 026)
- 021: wrap the Tauri dispatcher at boot so the recording proxy auto-captures
  (SC-002); fix the `dev_export` relative-path bug; decide frontend bundle gating
  (T031/T036) so the dev route/recorder aren't bundled in release.
- 005: surface the destructive-destination toggle (Archive / OS-trash) in the
  inbox confirm UI; implement the referenced `repair` scheduler (or remove the
  reference); snapshot the resolved pattern onto the plan.
- 006: add the "Show ignored items" Cmd+K entry; derive `mixed` frame-type
  dynamically.
- 026: remove the stale "Status: NOT IMPLEMENTED" contract descriptions; show
  per-item inventory refs in `SourceViewsSection`.

### Cross-cutting reconciliations (must each have an explicit decision in research.md)
- `destructive_destination` vocab drift: 0014 (`archive`/`os_trash`) vs 0019
  (`trash`/`archive`/`none`) — pick one canonical vocabulary.
- The two project tables (US3 above).
- The catalog slug mismatch (US6 above).
- `tasks.md` checkbox hygiene: the existing per-spec checkboxes are unreliable;
  the spec should not trust them.

### Product decisions to surface to the user (do NOT decide silently)
- **023 nav**: "Targets" is a primary-nav entry, which spec 023 FR-005 says it
  MUST NOT be. design-v4 (approved) put it there. Needs a product call:
  realign the spec to v4, or remove Targets from primary nav.
- Whether to keep `react-joyride` (010) or adopt the shipped hand-rolled overlay.

## Suggested implementation order (encode in the dependency graph)
US1 (safety) → US5 (subscriber wiring; unblocks 012/024/010 runtime) →
US4 (data plumbing; unblocks 006/007/023) → US2 (protection, after the cleanup
generator) → US3 (lifecycle) → US7 (settings/contracts) → US6 (catalog) →
US8 (dev/misc). Each story independently testable and verified against the real
backend headless boot.

## Definition of done
Every issue maps to a numbered FR/SC; the four already-fixed items have
regression tests; all gates green (`just lint`, `cargo test --workspace`,
`just typecheck`, vitest); and a real-backend headless smoke (per the runbook)
shows each remediated screen working — not just mocks.
