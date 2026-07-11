# Duplication & Abstraction Audit

**Status (2026-07-11): AUDIT COMPLETE — implementation underway.** Phases 1–4
are being implemented via the `orchestrate` run `run-dab` (worktree-isolated
coder nodes n1–n8, each a PR off `main`). Phase 5 (crate candidates below) and
T1-e (lifecycle-stub product decision) are held to apply separately.

Follow-on to the `db-boundary-zero` campaign (see
`persistence-layer-hardening.md`). That campaign drained all production `sqlx`
into `crates/persistence/db`. This audit applies the same "drain a scattered
concern into a proper boundary/abstraction" lens to the *next* class of smells:
code duplication that should be centralised, and hand-rolled
transaction/storage/property patterns that should use an adapter/abstractor/
class.

## Method

- **Base:** `origin/main` @ `d45e92be` (the consolidated post-drain state), in a
  detached read-only worktree. The `chore/design-sync-platevault` branch
  predates the drain and was **not** used.
- **Detection:** manual grep/read recon on the persistence layer + a 4-lane
  `bloodhound` fan-out (app/contracts/domain · fs/metadata/patterns ·
  persistence · frontend) + `biome` on the frontend + a dedicated
  reinvented-wheel pass. `clippy` compiled clean but its output was mis-captured
  (recorded as a coverage gap; pedantic micro-lints are low signal for the
  architectural smells in scope).
- **Vetting:** every deletion/hazard claim was verified against ground truth,
  and the full finding set was stress-tested by one `refactor-challenger`
  adversarial pass. Verdicts (KEEP/DOWNGRADE/DROP) below reflect that pass.
- Use `grep`, not `rg` (rg returns false-empty in this environment).

## Key design correction (persistence transactions)

The first-pass recommendation — "make the 130 query fns executor-generic and wrap
app-layer multi-writes in a `with_transaction(pool, |tx| …)` closure" — is
**wrong for this codebase**. An app-layer `with_transaction` closure forces the
app layer to name `sqlx::Transaction` / `&mut SqliteConnection` and call
`pool.begin()`, leaking `sqlx` across the boundary `scripts/check-db-boundary.sh`
seals.

**Boundary-safe pattern** (the "query-constructor + atomic-executor" idea, kept
where `sqlx` is allowed to live):

- The executor-generic helpers + a `with_transaction` combinator live **entirely
  inside `crates/persistence/db`** — generalising the `q_resolver.rs` `*_conn`
  (`&mut SqliteConnection`) pattern *only where composition is actually needed*.
- Each operation that must be atomic gets **one composite public fn** inside
  persistence — e.g. `projects::create_project_tx(pool, input)` — that opens the
  transaction internally and composes the helpers. The app layer calls that
  single function and never sees a connection.
- This is **not** a 130-signature migration (that was flagged as YAGNI + high
  blast radius). Only the handful of ops that genuinely need cross-statement
  atomicity get composite `*_tx` functions; the rest stay as-is.

Confirmed problem it fixes: the entire app layer currently has **0**
transactions, so multi-repo operations (`project_setup.rs` chains
`first_run` + `plans` + `projects` + `q_projects`) are non-atomic — a
mid-sequence failure leaves a half-built project.

## Vetted findings

Severity/priority reflect the adversarial pass. "Gate" = a back-compat or
verification precondition before applying.

### Tier 1 — Correctness & safety (real bugs; do first)

| ID | Finding | Evidence | Fix | Gate |
|----|---------|----------|-----|------|
| T1-a | **Windows junction gap in symlink gate** | `fs/inventory/symlink_gate.rs:31` checks only `.is_symlink()` (misses junctions/reparse points) *while its own doc claims junction coverage*; `fs/executor/ops/path_gate.rs:88` already has the `FILE_ATTRIBUTE_REPARSE_POINT` guard. Also `app/inbox/scan.rs:291` + `src-tauri/watcher.rs` hand-roll `is_symlink`; `artifact_watcher.rs:61` recurses with no follow-symlinks gate. | One reparse-aware `is_link_or_junction` + `real_dirs_under` primitive, adopted by all sites; add the follow-symlinks gate to `artifact_watcher`. | Constitution §II / product constraint ("MUST NOT follow symlinks/junctions unless enabled"). Needs Windows verification. |
| T1-b | **Diverging PlanState parser default** | `app/core/plans.rs:90` coerces an unknown lifecycle-state string to `Draft`; `app/lifecycle/transition_use_case.rs:540` returns `None` for the same input. | Route both through serde (both enums already derive `rename_all="snake_case"`); drop the silent `Draft` default. | DB value compat: deserializer must accept the exact snake_case strings already stored. Removing the silent default makes corrupt rows error (intended, user-visible). |
| T1-c | **`db_err` reintroduces the NotFound→Fatal bug** | `app/inbox/metadata.rs:154`, `app/inbox/target_recommendations.rs:47`, `app/core/first_run.rs:123` map all `DbError` (incl. `NotFound`) to Fatal/retryable; `app_errors::db_err` (`app/errors/lib.rs:91`) special-cases NotFound→non-fatal. *(Adversarial correction: only these ~3 sites take `DbError`; the other 5 originally cited take `CacheError`/`impl Display` and don't have the bug.)* | Delegate the 3 sites to `app_errors::db_err`. | Verify the TS frontend doesn't branch on the old `severity`/`retryable` for NotFound (wire behavior change). |
| T1-d | **UUID parse mapped to wrong error variant** | `persistence/db/lifecycle.rs:331` maps a UUID *decode* failure to `DbError::NotFound`, mislabeling corruption as a missing row. | Add/use a decode/corrupt variant. | Internal. |
| T1-e | **Lifecycle stub on the archive path** | `app/lifecycle/lifecycle_use_case.rs` `transition_lifecycle` has edge/actor/provenance gates all `TODO T044-046`, yet drives real archive-closure from `app/core/plan_apply.rs:330`. | **Product decision** — confirm whether the partial edge table is intentional; if so, reframe the TODOs. | Constitution §II (reviewable/audited mutation). Not a mechanical fix. |

### Tier 2 — Boundary-safe centralizations (contained, real value)

| ID | Finding | Fix | Gate |
|----|---------|-----|------|
| T2-a | App-layer atomicity hole (see design correction) | Composite `*_tx` persistence fns for the few multi-write ops; internal `with_transaction`. | Keep all `sqlx` inside `persistence/db` (db-boundary guard). |
| T2-b | `TargetOpError` competing error envelope (`contracts/core/targets.rs:117`, `{code:String,…}` vs canonical `ContractError`/`ErrorCode` enum; ~10 free-string codes in `target_management.rs`) | Retire `TargetOpError` → `ContractError`; add the ~10 codes as `ErrorCode` variants. | **Wire-format change** — coordinate with the frontend; the TS side deserializes `TargetOpError`. Not low-risk. |
| T2-c | Settings key-set enumerated in 3 places | Table-drive the two **app-layer** matches (`app/settings/lib.rs` `apply_value_to_state:333`, `default_value_for_key:507`) via the existing `Descriptor`. | *(Adversarial: the persistence-layer `settings.rs:126` match was DROPPED — it's a lower crate and can't depend on `app/settings`.)* |
| T2-d | JSON-in-column codec scattered across 8 files, inconsistent error handling | Standardize on `sqlx::types::Json<T>`, **preserving graceful degradation** at `equipment.rs:42` / `artifacts.rs:153` per-site. | Blanket-propagating swallowed decode errors would fail whole queries against corrupt cells in existing user DBs. |

### Tier 3 — Mechanical dedup (safe, batchable, low value)

- Byte-identical fns: `target_exists` (`q_targets_mgmt.rs:122` == `target_favourites.rs:22`), `count_canonical_targets` (`q_desktop.rs:203` == `q_resolver.rs:235`), `common_name` (`target_resolve.rs:86` == `target_search.rs:36` → fold into existing `target_dto`).
- Derive `#[derive(FromRow)]` on `AuditLogRow` (`audit.rs:28`) + the `lifecycle.rs:310` row → delete the hand-rolled 12-field tuple maps.
- `equipment.rs:56-509` 4× CRUD skeleton (Camera/Telescope/OpticalTrain/Filter, ~450 lines) → extract shared update/delete NotFound-check helper.
- `Month→u8` 12-arm match (`sessions/key.rs:78`) → `u8::from`.
- `ItemProgressEvent` 9-field literal built inline 7× (`fs/executor/run.rs`) → a `::terminal(...)` builder.
- Shared `notify`-watcher setup helper (`watcher.rs:106` vs `artifact_watcher.rs:61`).
- Calibration `1e-9` epsilon repeated ~6× → a named const (precedent: `ROTATION_EPSILON_DEG`).
- Route `roots_list`/`status_summary` (`commands/roots.rs:41`, `status.rs:33`) through `app_core` (they call `persistence_db` directly though the doc claims delegation).
- Shared reparse-aware `create_symlink` dispatch (`capability.rs:39` ≈ `link_op.rs:72` — needs a shared lower crate; bundle with T1-a).
- Delete `if true {` at `persistence/db/inbox.rs:850`.
- Delete dead frontend components `MastersList.tsx` (164 lines) + `TargetList.tsx` (157 lines) — verified zero production importers.
- *Verify-before-migrate:* `project_health.rs:95` `DebounceTable` → `app_cache::DebounceCache` (semantic fit unconfirmed).

### Tier 4 — Frontend consistency (incremental, opportunistic)

- Migrate the ~7 hand-rolled IPC fetches to the TanStack-Query store pattern + `unwrap()` (`TargetDetailV2.tsx:344`, `InboxPage.tsx:158/262`, `SetupPage.tsx:12`, `CalibrationMatchPanel.tsx:64`, `shared/native/{reveal,picker}.ts` hooks, `useStatusSummary.ts:26`, `TargetsPage.tsx:191`).
- Fold the two `Dialog.Root` dialogs into the canonical `Modal` (`AddTargetDialog.tsx:88`, `CreateProjectDialog.tsx:131`) — verify `Modal` supports their footers first.
- Centralize the `x as Parameters<typeof commands.X>[0]` cast (8 sites/6 files) into one typed helper.
- Route stray `toLocaleDateString` through `lib/datetime.ts` (`TargetDetailV2.tsx:709`, `ProjectLifecycleStepper.tsx:94`).
- Use `queryKeys.inventory.all()` instead of the raw `['inventory']` literal (`sessions/store.ts:74`, `settings/DataSources.tsx:184`).
- biome triage: **82 `a11y/*`** (PRODUCT.md mandates accessibility), 34 `noNonNullAssertion`, 32 `useExhaustiveDependencies`, 4 `noExplicitAny`, and **inspect the 5 `noTemplateCurlyInString` (likely real bugs)**.
- *Downgraded to incremental (not campaigns):* the 86-site `localStorage` typed-adapter migration (shape-migration risk) and the 999-line `TargetDetailV2` split.

### Reinvented-wheel / crate candidates (Phase 5 — apply separately)

**Verdict: mostly deliberate.** The codebase is disciplined about the
dependency constraint — hashing (`sha2`/`hex`), XML (`quick-xml`), file-watching
(`notify`), event bus (`tokio::broadcast`), path lexical-normalize
(`path-clean`), CSV (`csv`), networking (`reqwest`) all already use mature
crates. Few real wins.

**Part A — reinvented wheel:**
- **Clear win:** `project_health::DebounceTable` (`crates/app/projects/src/project_health.rs:78-123`) duplicates `app_core_cache::DebounceCache` almost field-for-field (both wrap `moka::sync::Cache`). Switch its 3 call sites to `app_core_cache::DebounceCache` and delete ~45 LOC + a duplicate test module — near-zero risk; `app_core_cache`'s own doc already flags this migration. **NOTE: `project_health.rs` is in node n3's scope — Phase 5 must sequence AFTER n3 merges to avoid collision.**
- **Housekeeping:** `strsim = "0.11"` is declared in `crates/targeting/resolver/Cargo.toml` with a "fuzzy matching (R2)" comment but has **zero call sites** (resolver docs say matching is exact-normalized only, FR-008). Drop it after confirming (own small PR).
- **Leave (deliberate/tested):** haversine angular-separation (`targeting/coords.rs`), FITS-quirk sexagesimal parsing (`metadata/core`), FITS header-card reader (`metadata/fits`, explicit "no cfitsio" rationale). **Marginal, skip under the constraint:** the ~17-site hand-rolled `as_str`/`FromStr` enum matches could use `strum` (already a dep, used in 2 crates) — a DRY nit, each site is compiler-exhaustive + tested, not worth a dependency-wiring sweep.

**Part B — extractable into own crate:**
- `crates/patterns/src/sanitize.rs` (373 LOC) — a domain-agnostic, security-conscious safe-filename sanitizer (NFC, C0/C1/bidi-override stripping, Windows reserved-name rejection, `unicode-security` confusables). Stronger than crates.io's `sanitize-filename` on the trojan-source/confusables axis. Strong standalone-crate candidate.
- `crates/metadata/{core,fits,xisf}` — already structurally isolated (deps only `serde`/`thiserror`/`quick-xml`, no app-domain coupling); publish-ready as a lightweight FITS/XISF-header crate with no code changes. (Matches the pending "FITS/XISF publishable-crate split" note.)
- `fs/executor/ops/path_gate.rs` `resolve_and_validate` (sandboxed path resolution) — generic + well-tested, but coupled to this app's `PlanItemFailure`; would need the error type genericized first (real refactor, not copy-paste).

**How Phase 5 applies:** a small `strsim`-drop PR (standalone) + a DebounceTable→DebounceCache PR (**after n3 merges**); the crate extractions (`patterns::sanitize`, `metadata_*`) are packaging/publishing decisions, deferred as product calls, not code changes.

## Dropped by the adversarial pass (transparency)

- **Merge the two `PlanState` enums** — legitimate DTO (`contracts_core`) vs domain (`domain_core`) split across a serialization boundary; only the *parser divergence* (T1-b) is the real issue.
- **`collect_commands!` dedup** (`src-tauri/lib.rs:175` vs `400`, 216/224 identical) — the macro rejects `cfg` in its token list (documented at `lib.rs:130`); framework-mandated over a wire contract.
- **`lexical_normalize` → path-clean** (`workflow/artifacts/project_mapping.rs:32`) — the hand-roll deliberately unifies `\`→`/`, which path-clean won't do on Unix.
- **Shared `refuse_if_exists`** (`move_op.rs:46` / `mkdir_op.rs:23` / `link_op.rs:43`) — the three guards deliberately differ (idempotent mkdir / broken-symlink-aware link / plain move).
- **`FilterCategory::Other` default** (`equipment.rs:37`) — legitimate catch-all, not corruption-masking.
- **Clock DI across all ~45 `now_*` sites** — deferred (YAGNI): no test currently needs to control time. Add a `Clock` port when the first time-sensitive test does.
- **Extract-Method on god functions as a priority** — the large functions (`apply_plan` 491, `reclassify_v2` 488, `confirm` 455, `generate_source_view` 465) carry numbered phase comments that already provide navigation; behavior-preserving extraction of procedures threading shared mutable state is churn with regression risk. Do opportunistically on the largest *files* only.
- **NUL-byte map key** (`PlanPanel.tsx:309`) — real (`od -c` confirms `\0`) but a valid unambiguous compound-key delimiter; at most a named `KEY_SEP` const.

## Open verification items (before applying, not before planning)

- Frontend consumption of `severity`/`retryable` for NotFound (T1-c, T2-b).
- `app_cache::DebounceCache` semantic drop-in fit (T3).
- `Modal` footer/form support for the two dialogs (T4).
- biome per-rule counts (unverified; the "triage" framing needs no precise count).
- clippy pedantic sweep (mis-captured this run; re-run properly if micro-idiom cleanup is wanted).

## Execution plan

Sequenced by risk and dependency, not by tier number. Each phase is one or more
independently reviewable PRs off `main`. Verification per PR: `just lint` +
`just test` + `just typecheck` (Rust), plus `biome`/`tsc`/Playwright for
frontend PRs, plus `speckit-verify` where a PR touches a spec's FR/SC. Commit
and push after each meaningful step; do not strand work in a worktree.

### Phase 0 — Land this doc (branch `docs/dedup-abstraction-audit`)
- **Do:** commit this audit + plan; open a tracking PR (or issue) so the backlog
  is durable and reviewable. No product code.
- **Gate:** none. **Verify:** doc renders; links resolve.

### Phase 1 — Correctness & safety (Tier 1) — highest priority
Three PRs; these are bugs, not tidiness.

1. **PR 1a — reparse-aware path safety (T1-a + the T3 `create_symlink` bundle).**
   - **Do:** add one link/junction primitive (`is_link_or_junction` +
     `real_dirs_under` + reparse-aware `create_symlink`) in a shared low crate
     (promote `fs_inventory::symlink_gate`, or a new `crates/fs/pathsafe`);
     replace the divergent copies in `fs_executor`, `app/inbox/scan.rs`, and
     `src-tauri/watcher.rs`; add the follow-symlinks gate to `artifact_watcher`.
   - **Gate:** constitution §II. **Verify:** cross-platform unit tests + a
     regression test (scan a dir containing a symlink/junction → no traversal
     unless enabled) + **Windows real-app verification** (verify-on-windows).
   - **Seal (optional):** a guard forbidding new hand-rolled `is_symlink` /
     `read_link` outside the primitive.

2. **PR 1b — data-integrity error handling (T1-b + T1-c + T1-d).**
   - **Do:** route both `PlanState` parsers through serde and drop the silent
     `Draft` default; delegate the 3 real `db_err` sites to `app_errors::db_err`;
     give the `lifecycle.rs:331` UUID-parse failure a decode/corrupt variant
     instead of `NotFound`.
   - **Gate:** verify the frontend doesn't branch on the old
     `severity`/`retryable` for NotFound (grep the TS side first); confirm the
     serde deserializer accepts the exact stored snake_case strings.
   - **Verify:** add tests feeding an unknown/corrupt state string (now errors
     instead of coercing) and a NotFound path (now non-fatal/non-retryable).

3. **T1-e — lifecycle-stub decision (no code PR yet).**
   - **Do:** open an issue summarising that `transition_lifecycle` gates
     (T044-046) are stubbed on the live archive-closure path; ask for the
     product decision (finish the edge table vs. document the partial as
     intentional). Block any code change on the answer.

### Phase 2 — Boundary-safe centralizations (Tier 2)
Four PRs; land 2a–2c freely, 2d only after frontend coordination.

4. **PR 2a — atomic multi-write (design correction).**
   - **Do:** add a `with_transaction` combinator + executor-generic (`&mut
     SqliteConnection`) helpers **inside** `persistence/db`; expose composite
     `*_tx` fns for the ops that need atomicity (start with `create_project_tx`
     for `project_setup`); switch those app-layer call sites to the composite
     fn. Keep all `sqlx` inside the crate.
   - **Gate:** `scripts/check-db-boundary.sh` stays green.
   - **Verify:** a test that injects a mid-sequence failure and asserts full
     rollback (no half-built project).

5. **PR 2b — JSON columns → `sqlx::types::Json<T>`.**
   - **Do:** migrate the 19 sites; **keep** the two graceful-degradation sites
     (`equipment.rs:42`, `artifacts.rs:153`) degrading, not propagating.
   - **Verify:** round-trip tests + a corrupt-cell test asserting the chosen
     per-site policy.

6. **PR 2c — settings table-drive (app layer only).**
   - **Do:** extend `Descriptor` with hydration/default so `apply_value_to_state`
     + `default_value_for_key` read from the one table; leave the
     persistence-layer `apply_key_to_state` (layering).
   - **Verify:** a test asserting every descriptor key round-trips
     apply/default.

7. **PR 2d — `TargetOpError` → `ContractError` (wire-gated).**
   - **Do:** add the ~10 free-string codes as `ErrorCode` variants; return
     `ContractError` from target ops; update the generated bindings + the
     frontend error handling in the same PR.
   - **Gate:** coordinated frontend change — this alters the wire shape the TS
     deserializes. Do it as one cross-cutting PR, not a backend-only merge.
   - **Verify:** Playwright journey over a target-op error path.

### Phase 3 — Mechanical dedup (Tier 3)
8. **PR 3 (batched, parallelizable) — one or two PRs.**
   - **Do:** delete byte-identical fns (keep one, import); derive `FromRow` +
     delete the tuple maps; extract the `equipment.rs` CRUD helper; fold
     `common_name` into `target_dto`; `Month→u8`; `ItemProgressEvent::terminal`;
     shared `notify` setup; the calibration epsilon const; route
     `roots_list`/`status_summary` through `app_core`; delete `if true {`;
     delete the two dead frontend components. *Verify-before-migrate:*
     `DebounceTable`→`app_cache` only if the fit checks out.
   - **These files are independent → this phase parallelizes well** (the
     `db-boundary-zero` file-by-file model). **Verify:** full `just lint/test/
     typecheck`; frontend build for the component deletions.

### Phase 4 — Frontend consistency (Tier 4)
9. **PRs 4a…4n (incremental, opportunistic).**
   - **Do, in small PRs:** React-Query migration of the ~7 fetches; fold dialogs
     into `Modal` (verify fit first); central cast helper; datetime routing;
     `queryKeys` usage; biome triage (a11y batch, non-null, any, and the 5
     template-curly **as bug fixes**). Do the `localStorage` typed-adapter
     migration incrementally with a read-time shape fallback, not as one big
     campaign.
   - **Verify:** `biome` + `tsc --noEmit` + affected Playwright journeys.

### Phase 5 — Reinvented-wheel adoptions
10. **PR(s) 5 — as warranted** by the reinvented-wheel sweep (see section
    above), honouring the "keep dependencies deliberate" constraint. Only the
    clear net-wins; skip marginal swaps.

### How I'd run it
- **Solo, sequential** for Phase 1 (bugs — careful, verified, Windows-checked)
  and Phase 2 (semantic/wire changes need judgement).
- **Parallel fan-out** (orchestrate-style, worktree-per-lane) is a good fit for
  Phase 3's independent files and Phase 4's independent components — mirroring
  the `db-boundary-zero` drains, with a CI-shepherd lane batching merges.
- Recommended first cut: **PR 1a + PR 1b** (the actual bugs), then reassess.
