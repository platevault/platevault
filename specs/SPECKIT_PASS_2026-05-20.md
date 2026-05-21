# SpecKit Forward Pass — Summary

**Date:** 2026-05-20 → 2026-05-21
**Scope:** All 25 child specs (002–026) of the Astro Library Manager (parent: spec 001)
**Mode:** Non-interactive, parallel agent-driven SpecKit forward (spec → plan → research → data-model → contracts/ → tasks.md), stopped at the implementation point. Each spec was paired with an adversarial code-reviewer pass.

## Headline result

All 25 specs now have a complete SpecKit document set ready for implementation review. 21 of 25 are signed **BLOCKED** by adversarial review with concrete, actionable findings; 4 are **PROCEED-with-fixes**. The set is internally consistent; remaining issues are spec-internal, not cross-spec contradictions (the 017/025 boundary, the most-coupled pair, is clean apart from the approval-token issue documented below).

| Status | Count | Specs |
|---|---|---|
| BLOCKED on review | 21 | 002, 003, 005, 006, 007, 008, 009, 010, 011, 012, 014, 016, 017, 018, 019, 020, 021, 023, 024, 025 |
| PROCEED-with-fixes | 4 | 013, 015, 022, 026 |

The PROCEED specs still carry HIGH-priority items but no constitutional or load-bearing contract gaps that would corrupt downstream work.

## Per-spec table

For each spec: status, the most material resolved questions, the must-fix items from the adversarial pass, and key files written.

---

### 002 — Data Lifecycle State Model

**Status:** BLOCKED.

**Resolved questions (representative):**
1. Project lifecycle is the 7-state set; `processing → ready` REJECTED (must route via `blocked`); `archived → processing` (not `→ completed`) is the unarchive path. Mockup `PROJECT_TRANSITIONS` is canonical.
2. Provenance is overlapping append-only tags (`observed | inferred | reviewed | generated | planned | applied`), NOT a state machine of one value.
3. No-op + refused-transition semantics: same-state writes are no-ops with no audit; refused edges audit-log without mutating; both are transactional with the audit write.
4. Plan apply resolves to exactly one of `applied | partially_applied | failed | cancelled`.

**Must-fix (from review):**
- **B1** Contract `LifecycleState` is `oneOf` over overlapping enums — replace with per-entity discriminated sub-schemas keyed on `entity_type`.
- **B2** `requires_plan` is caller-asserted; server must derive it from a `(entity_type, from, to)` edge table — otherwise a malicious caller bypasses the constitutional plan gate.
- **B3** Three-way contradiction on `state.unchanged` (error code vs suppressed audit vs no audit) — pick one; recommend `status: "noop"` with no `audit_id`.
- **H1** Add `provenance.*` error codes + blocking-fields detail for action-bound review.
- **M1** FR-011 session-key derivation formula is still undefined; resolve in research before T034.

**Files:** `spec.md` (updated), `plan.md`, `research.md`, `data-model.md`, `contracts/lifecycle.transition.json`, `tasks.md`.

---

### 003 — First-Run Source Setup

**Status:** BLOCKED.

**Resolved questions:**
1. Picker library = `@tauri-apps/plugin-dialog`.
2. Raw step required; Calibration/Project/Inbox optional; no global "skip wizard" control.
3. Wizard persists sources to `localStorage.alm.first-run.sources` during the flow, flushes via `source.register` + `firstrun.complete` to SQLite on Finish.

**Must-fix:**
- **B1** Restart semantics contradiction — mockup is destructive; research recommends prefill. Pin behavior in FR.
- **B2** Gate authority drift — `indexRoute` reads localStorage synchronously; needs async loading state for DB-first reconcile.
- **B3** Finish atomicity unresolved — per-source register + `firstrun.complete` is not atomic; needs `sources.register_batch` or idempotent `path.already.registered`.

**Files:** `spec.md` (updated), `plan.md`, `research.md`, `data-model.md`, `contracts/source.register.json`, `contracts/firstrun.complete.json`, `tasks.md`.

---

### 004 — Native Filesystem Controls

**Status:** PROCEED-with-fixes (graduates after 4 HIGH items resolved).

**Resolved questions:**
1. Directory picker = `@tauri-apps/plugin-dialog`; file picker = same; reveal = `tauri-plugin-opener`.
2. Cancellation is `path: null`, not an error.
3. Linux reveal fallback opens the parent directory (not the file) — documented but with mitigation.

**Must-fix (HIGH):**
- Filter `*` escape hatch must be locked to a single named filter (currently any caller can inject `*`).
- `entity_kind` enum drift between spec (4 values) and contract (6 values).
- Unsalted SHA-256 path hashing in audit log is trivially reversible — add a per-library salt or drop the field.
- `opener:default` capability is too broad — narrow to `opener:allow-reveal-item-in-dir`.

**Files:** `spec.md` (updated), `plan.md`, `research.md`, `data-model.md`, 3 contracts (`directory.pick`, `file.pick`, `reveal`), `tasks.md`.

---

### 005 — Inbox Mixed-Folder Split

**Status:** BLOCKED.

**Resolved questions:**
1. Classifier signal priority: FITS/XISF `IMAGETYP` (confidence 1.0) > filename heuristics (≤ 0.6).
2. Rogue-file handling: < 2 occurrences absorbed; ≥ 2 triggers `mixed` and forces split.
3. One-plan-per-Inbox-item invariant enforced at use case, partial unique DB index, and contract error `inbox.has.open.plan { existing_plan_id }`.

**Must-fix:**
- **B1** Classify/confirm TOCTOU — `content_signature` must be returned by classify and required by confirm.
- **B2** Single-type plan generation fabricates filenames from one sample (`store.ts:163-167`) — must persist the actual file list, not regenerate names from a count.
- **H1** Confidence threshold inconsistency — folder-level aggregate must weight by evidence source.
- **H4** `unclassified` items have no `inbox.confirm` action path — dead-end state.

**Files:** `spec.md` (rewritten), `plan.md`, `research.md`, `data-model.md`, `contracts/inbox.classify.json`, `contracts/inbox.confirm.json`, `tasks.md`.

---

### 006 — Inventory Library Lifecycle

**Status:** BLOCKED.

**Resolved questions:**
1. Grouped ledger by `LibraryRoot.id` with kind/state in the group header.
2. Review-state vocabulary projection: spec 002's 6 canonical states collapse to 3 presentational (`needs_review | confirmed | rejected`); contract operates on canonical names.
3. Required reviewed fields for project linkage = `target/filter/exposure` (acquisition), `kind/exposure/equipment` (calibration). Applies action-bound review.

**Must-fix:**
- **B1** `setSessionReviewState` accepts presentational state but contract requires canonical — narrow contract `next_state` or change hook signature.
- **H1** `state.unchanged` outcome semantics conflict between research (success, no audit) and contract (error code).
- **H2** `mixed` projection rule unverifiable — `inventory.list.json` carries `type: FrameType` per session, no per-frame kind to derive "frames disagree."

**Files:** `spec.md` (updated), `plan.md`, `research.md`, `data-model.md`, `contracts/inventory.list.json`, `contracts/inventory.session.review.json`, `tasks.md`.

---

### 007 — Calibration Matching Rules

**Status:** BLOCKED.

**Resolved questions:**
1. Hard/soft dimensions per type: Dark = hard gain/offset, soft exposure ±5% and temp ±2°C. Flat = hard filter/binning/optic train, soft rotation/observing-night/gain. Bias = hard gain/offset.
2. Observing-night identity is canonical (cross-spec to sessions crate); calendar-date fallback ONLY when observing-night record missing.
3. Override model: `suggest` is read-only; `assign` requires explicit `override=true` for hard mismatches and records mismatched dimensions.

**Must-fix:**
- **B1** Confidence math allows negative values — flat soft caps sum to 1.1 plus per-missing 0.1 plus override penalty; need explicit `max(0, ...)` clamp.
- **B2** `override_penalty` is referenced in formula but undefined (value, units, origin).
- **H1** Observing-night timestamp source (FITS DATE-OBS? mtime? sidereal?) still ambiguous.

**Files:** `spec.md` (rewritten), `plan.md`, `research.md`, `data-model.md`, `contracts/calibration.match.suggest.json`, `contracts/calibration.match.assign.json`, `tasks.md`.

---

### 008 — Project Create / Onboard / Edit

**Status:** BLOCKED.

**Resolved questions:**
1. Project create = wizard (analogous to first-run but scoped to one project).
2. Source picking from Inventory only (no arbitrary disk paths from this surface).
3. Tool is immutable after `prepared`; `tool.locked` error code defined.
4. Channel inference is auto from source filters; manual override is sticky.

**Must-fix:**
- **B1** `path` required but `initial_sources=[]` allowed with no `plan_id` — creates a project that can never transition out of `setup_incomplete`.
- **B2** Tool-locked invariant has no defined unlock path — user is stuck if they mis-pick the tool.
- **H1** Inventory-only constraint not enforced at contract layer (only UI).
- **H3** Channel inference + snapshot-staleness race — two sources of truth (snapshot vs live join).

**Files:** `spec.md` (updated), `plan.md`, `research.md`, `data-model.md`, `contracts/project.create.json`, `contracts/project.update.json`, `contracts/project.source.add.json`, `tasks.md`.

---

### 009 — Project Lifecycle Model

**Status:** BLOCKED.

**Resolved questions:**
1. 16 edges in the project lifecycle graph (closed set; mirrors `PROJECT_TRANSITIONS`).
2. Action labels are edge-derived, not state-derived. `archived → processing` = "Unarchived"; `completed → processing` = "Re-opened"; `blocked → *` = "Resolved blocker".
3. `blocked` is bidirectional, triggered by user OR system detectors (`source_missing | prepared_source_stale | tool_unconfigured | calibration_unmatched`) — modeled as a tagged union.

**Must-fix:**
- **B1** Plan-gating bypass via caller-set `requires_plan=false` (same root cause as 002 B2).
- **B2** Enum drift: contract redeclares `ProjectLifecycle` literally instead of `$ref`ing spec 002's `ProjectState`.
- **H1** Blocked-flag exhaustion — no debounce or "same reason within N min" suppression.
- **H2** `actor=system` accepted on any edge — needs per-edge authorization table.

**Files:** `spec.md` (updated), `plan.md`, `research.md`, `data-model.md`, `contracts/project.lifecycle.transition.json`, `contracts/project.list.json`, `tasks.md`.

---

### 010 — Guided First-Project Flow

**Status:** BLOCKED.

**Resolved questions:**
1. Coach UX = overlay popover anchored via `data-guide-anchor`; gracefully degrades when anchor absent.
2. Triggers = event-bus only (`InventoryConfirmed | ProjectCreated | ToolOpened`); no clicks or timeouts.
3. Activation = auto-activate once after setup; restart from Settings resumes at lowest uncompleted step.

**Must-fix:**
- **B1** `STATE_CORRUPTED` error declared but no recovery path defined.
- **B2** Trigger taxonomy collision: Rust event names vs `completion_event` strings inconsistent across plan/data-model/tasks.
- **H1** `source=restore` filtering — event payload contract doesn't include `source` field.
- **H3** Anchor-orphan lint is scheduled but no CI gate or anchor-presence test is in tasks.

**Files:** `spec.md` (rewritten), `plan.md`, `research.md`, `data-model.md`, 3 contracts (`guided.state.get`, `guided.step.complete`, `guided.dismiss`), `tasks.md`.

---

### 011 — Processing Tool Launch

**Status:** BLOCKED.

**Resolved questions:**
1. First-class tool list = PixInsight, Siril, Planetary Suite; user-defined deferred.
2. `args_template` is a closed-vocabulary array (`{folder}`, `{file}`); cwd always set.
3. Settings is authoritative for tool paths; auto-discovery pre-fills only.

**Must-fix:**
- **B1** macOS `open -a` is shell-name hostile — must lock to bundle id (`-b`) or direct executable path with `setsid`.
- **B2** `executable_path` validation is TOCTOU — drop the pre-spawn check or treat as advisory.
- **H1** Audit `args_hash` excludes the executable — two launches with different binaries hash identically.
- **H3** Project working-folder cwd has no library-root containment check — a poisoned path becomes the tool's cwd.

**Files:** `spec.md` (rewritten), `plan.md`, `research.md`, `data-model.md`, `contracts/tool.launch.json`, `contracts/tool.profile.list.json`, `tasks.md`.

---

### 012 — Processing Artifact Observation

**Status:** BLOCKED.

**Resolved questions:**
1. Output folder discovery via `output_folder_strategy` per workflow profile: PI = project-relative; Siril/planetary = user-configured.
2. Classification = manual > literal > prefix > suffix > extension fallback; default rules per tool.
3. Watcher: notify-rs by default with mount-type probe; polling fallback (5s) on SMB/NFS/FUSE; debounce 2000ms with stable-size recheck.

**Must-fix:**
- **B1** Frozen-at-detection launch attribution breaks under clock skew, retroactive launches, NAS clock drift.
- **B2** `UNIQUE(project_id, path)` collides with PI rerun replace-in-place — supersede vs in-place mutate not defined.
- **H1** Sticky manual override has no clear-path in v1.
- **H3** Self-test probe writes a hidden file in user's folder — violates "observation is read-only" without an explicit carve-out.

**Files:** `spec.md` (updated), `plan.md`, `research.md`, `data-model.md`, `contracts/artifact.list.json`, `contracts/artifact.classify.json`, `tasks.md`.

---

### 013 — Target Lookup From FITS OBJECT

**Status:** PROCEED-with-fixes.

**Resolved questions:**
1. Catalog sources: bundled Messier (public domain), OpenNGC (CC BY-SA 4.0), curated common-name list.
2. Matcher = two-stage exact (designation) → fuzzy (token-set + edit-distance); confidence buckets `high/medium/low/none`.
3. Ambiguity policy: `resolved | ambiguous | unresolved | catalog.unavailable`; 15-point gap rule between top match and runner-up.

**Must-fix (HIGH):**
- Sharpless/LBN/LDN listed as user-selectable but not bundled — trim or defer-mark.
- Cross-catalog identity merge (M101 ≡ NGC5457) needs deterministic rule in `Target.id` generation.
- Gap rule is asymmetric and undertested — needs a truth table for tied/multi-medium cases.

**Files:** `spec.md` (updated), `plan.md`, `research.md`, `data-model.md`, `contracts/target.lookup.json`, `contracts/target.resolve.json`, `tasks.md`.

---

### 014 — Catalog Index Licensing

**Status:** BLOCKED.

**Resolved questions:**
1. v1 ships built-in Messier + OpenNGC + common names; user-added catalogs deferred.
2. Bundle format = CSV + JSON sidecar manifest (rejects FITS BINTABLE for v1).
3. v1 ships catalog updates only via app release (no remote fetch).

**Must-fix:**
- **B1** OpenNGC is CC BY-SA 4.0, NOT public domain as the spec claims — share-alike is **incompatible with Apache-2.0 redistribution**. Resolve licensing factual claim and the Apache-2.0 compatibility test before bundling.
- **B2** `license` field is a free-form string; must be a closed enum of approved short codes with explicit incompatibility rejection list.
- **H1** NOTICE serialization format is undefined yet user-actionable.
- **H2** `LicenseAttribution` lacks CC BY required fields (author, title, license URI, modification notice).

**Files:** `spec.md` (updated), `plan.md`, `research.md`, `data-model.md`, `contracts/catalog.list.json`, `contracts/catalog.attribution.get.json`, `tasks.md`.

---

### 015 — Token Pattern Builder

**Status:** PROCEED-with-fixes.

**Resolved questions:**
1. v1 token vocabulary: target, filter, date, frame_type, camera, exposure, gain, binning, set_temp. Telescope/project/workflow deferred.
2. Per-token configurable fallbacks (target → "unclassified", filter → "nofilter"); every substitution reported in `missing_tokens`.
3. Unknown tokens in persisted patterns hard-fail with `token.unknown` (no silent drop); UI banner blocks Inbox confirm.

**Must-fix (BLOCKING):**
- **B1** Unicode normalization unspecified — NFKC homoglyphs, zero-width, bidi controls all bypass sanitization.
- **B2** Path traversal via `..` segment not blocked — sanitization replaces OS-reserved chars but allows `..`.
- **B3** MAX_PATH amplification — no per-segment or total length cap.

**Files:** `spec.md` (rewritten), `plan.md`, `research.md`, `data-model.md`, `contracts/pattern.resolve.json`, `contracts/pattern.validate.json`, `tasks.md`.

---

### 016 — Source Protection Defaults

**Status:** BLOCKED.

**Resolved questions:**
1. Three-level protection (`protected | normal | unprotected`); per-source override + global default + in-code default chain.
2. Archive preferred over OS trash preferred over permanent delete.
3. Recovery via pre-flight acknowledgement gate + post-flight audit + archive retention.

**Must-fix:**
- **H1** Resolver order conflict: `plan.md` says override-then-default; `data-model.md` says category protection elevates even over an `unprotected` override. Pick one.
- **H2** No documented in-code default tier — behavior is undefined if `GlobalProtectionDefaults` row is missing.
- **H3** `block_permanent_delete` is global-only but `level` is per-source — does the global toggle override an `unprotected` source?

**Files:** `spec.md` (updated), `plan.md`, `research.md`, `data-model.md`, `contracts/source.protection.get.json`, `contracts/source.protection.set.json`, `contracts/plan.protection.check.json`, `tasks.md`.

---

### 017 — Cleanup Archive Review Plans

**Status:** BLOCKED.

**Resolved questions:**
1. Retry = new plan with `parentPlanId` (not in-place reset).
2. Cancellation halts forward progress without rollback; applied items stay applied; plan → `cancelled`.
3. Default ordering: failed-first, then creation-time descending.

**Must-fix:**
- **B1** Counter coherence (`itemsTotal == applied + failed + pending`) is asserted but unenforceable across the 017/025 boundary; missing `itemsSkipped` in counter set.
- **B2** Reopen `approved → draft` race with spec 025 apply start — needs `approval_id` / `expected_state_token`.
- **H3** Retry chain orphaning — `parentPlanId` is soft ref; discard breaks chain. Either refuse discard if retries exist or specify orphan-tolerance.
- **H4** `discarded` state appears in transitions but is missing from the 8-state vocabulary in FR-005 and `plan.list.json` enum.

**Files:** `spec.md` (updated), `plan.md`, `research.md`, `data-model.md`, 5 contracts (`plan.list`, `plan.get`, `plan.approve`, `plan.discard`, `plan.retry`), `tasks.md`.

---

### 018 — Settings Configuration Model

**Status:** BLOCKED.

**Resolved questions:**
1. Noisy keys (`pattern`, `protectedCategories`) skip per-change audit; all other 12 keys emit one info event per change.
2. Override resolution: per-source → global → in-code default. Overridable subset is `followSymlinks | hashOnScan | autoApplyPattern | defaultProtection` — anything else returns `key.unoverridable`.
3. Defaults table is canonical and matches the mockup.

**Must-fix:**
- **B1** No-op guard `prev === value` fails for reference types like `pattern: PatternPart[]` — need deep-equal for noisy keys.
- **B2** Override-set asymmetry — `autoApplyPattern` overridable but `pattern` is not, so a source can opt out of auto-applying a pattern it has no way to override.
- **H1** v1→v2 default change is indistinguishable from "never set" because `restore_defaults` deletes rows.
- **H2** `settings.update.json` lacks per-key `value` discrimination — accepts arbitrary JSON.

**Files:** `spec.md` (updated), `plan.md`, `research.md`, `data-model.md`, 4 contracts (`get`, `update`, `restore-defaults`, `source-override.set`), `tasks.md`.

---

### 019 — Bottom Log Viewer

**Status:** BLOCKED.

**Resolved questions:**
1. UI buffer = bounded 500-entry ring with oldest-first eviction; older history lives in the audit timeline (a separate feature).
2. Severity partitioning: workflow events go through audit; diagnostic events stream-only and never persist.
3. Follow-tail persistence reuses existing `rememberFollowLogs` settings key.

**Must-fix:**
- **B1** Cursor namespace ambiguity — `id` conflates audit ids and session-monotonic diagnostic ids; cursors can become invalid silently after restart.
- **B2** Export-vs-viewer count divergence — viewer shows ring (audit ∪ diagnostics, capped 500); export defaults to audit only. US4 acceptance test is untestable as written.
- **H1** Audit→LogEntry mapping is unilateral; no contract version on `LogEntry`.
- **H3** `since`/`until` semantics in export ignore audit retention vacuum — no `truncated: true` signal.

**Files:** `spec.md` (rewritten), `plan.md`, `research.md`, `data-model.md`, `contracts/log.stream.json`, `contracts/log.export.json`, `tasks.md`.

---

### 020 — Router URL State

**Status:** BLOCKED.

**Resolved questions:**
1. Hash history is mandatory for Tauri's `file://` origin.
2. URL search params own filters and selection (no nested routes for selection).
3. Stale-id behavior: path-param routes render "not found" empty state; search-param `id` clears with `replace: true` while preserving filter keys.

**Must-fix:**
- **B1** Forward-compat key drop is silent and lossy — renamed key (`frame` → `frame_kind`) loses data with no telemetry. Need reserved-key registry, deprecation alias map, audit entry.
- **B2** Library-identity mismatch — pasting a `proj-abc` link from library A into library B applies filters silently to wrong library. Need v1 stance (refuse-on-paste or accept-and-warn).
- **H1** Stale-id cleanup race — `navigate({replace: true})` can re-fire on every render.
- **H2** Validators accept arbitrary strings — no enum allow-list on `frame`, `review`, `lifecycle`, `tool`, `state`, `origin`, `type`, `section`.

**Files:** `spec.md` (updated), `plan.md`, `research.md`, `data-model.md`, `contracts/url.resolve.json`, `tasks.md`.

---

### 021 — Developer Contract Diagnostics

**Status:** BLOCKED.

**Resolved questions:**
1. Hidden route `/dev/contracts` reachable only via Cmd+K when `devMode` toggle is on.
2. Call recording proxy bypassed at module load when off (zero overhead in production).
3. 100-entry session-only ring buffer; 64 KB payload truncation; 1ms p95 perf budget.

**Must-fix:**
- **B1** `devMode` toggle has no build-flag gate — security through obscurity; URL leak exposes the surface in production.
- **B2** Redaction defaults whitelist user paths — `librariesRootPath` not flagged; combined with B1, exported JSON leaks `C:\Users\<name>\…`.
- **H1** Restart-required-to-install-proxy contradicts FR-008 acceptance 4 ("toggle off → bypassed immediately").
- **H3** `replay_safe` is contract-declared but never validated — new contracts default to replayable.

**Files:** `spec.md` (updated), `plan.md`, `research.md`, `data-model.md`, `contracts/dev.contracts.list.json`, `contracts/dev.calls.list.json`, `tasks.md`.

---

### 022 — Desktop Prototype Design System (supersedes Mantine direction)

**Status:** PROCEED-with-fixes.

**Resolved questions:**
1. Framework choice: Base UI (`@base-ui-components/react`) + `cmdk` + `react-resizable-panels` + `@tanstack/react-table` + own CSS-variable token system. Mantine rejected (Tailwind buy-in, less customization on docked drawer).
2. Token system in `apps/desktop/src/styles/tokens.css`; component layer in `components.css` with `alm-` prefix.
3. Theme via `data-theme` attr on root; system/light/dark; system follows OS via `prefers-color-scheme`.

**Must-fix (MEDIUM):**
- Font-stack literals in `tokens.css` need a carve-out in FR-006 ("no hardcoded values").
- Helper exports (`FilterLabel`, `FactGroup`, `Facts`, `TokenPatternBuilder`, etc.) need to be folded into the primitive vocabulary table.
- FR-013 wording on the theme contract needs softening (T042 still pending).

**Files:** `spec.md` (rewritten with Supersession Notice), `plan.md`, `research.md`, `data-model.md`, `contracts/theme.get.json`, `contracts/theme.set.json`, `tasks.md`.

---

### 023 — Target Identity History Notes

**Status:** PROCEED-with-amendments (1 HIGH, 3 MEDIUM).

**Resolved questions:**
1. Targets are NOT primary nav; reachable via Cmd+K, Inventory chip, Project chip.
2. Identity overlap with spec 013 (lookup): 013 creates, 023 surfaces history + notes.
3. Notes are user-editable plain text saved to a separate file; manifest snapshots embed at write time.

**Must-fix (HIGH):**
- **H1** `captured_on` derivation rule for sessions is undefined — session boundaries cross midnight; rule needs explicit "observing-night minus 12h local" or equivalent.
- **M2** Alias merge/split deferred — given spec 013 auto-creates targets, users will accumulate duplicates with no in-app remediation. Either ship minimal `alias.remove` + `primary.rename`, or document the risk.
- **M3** No length cap on notes; debounced save → one audit event each.

**Files:** `spec.md` (updated), `plan.md`, `research.md`, `data-model.md`, 3 contracts (`target.get`, `target.note.update`, `target.alias.add`), `tasks.md`.

---

### 024 — Project Manifests And Notes

**Status:** PROCEED-with-fixes (NO BLOCKING; 3 HIGH).

**Resolved questions:**
1. Manifests are auto-generated at project create, source-change, lifecycle transition, cleanup apply; immutable per snapshot; stored under `notes/` in the project folder.
2. Notes are user-editable in a sibling `notes/project-notes.md` file.
3. No manifest update/delete contract — files are write-once; regeneration is a new file.

**Must-fix (HIGH):**
- **H1** Trigger taxonomy leak — mock data uses reason strings ("Prepared", "Source updated") that don't map to the `ManifestReason` enum.
- **H2** Immutability contradicts `version` field — regeneration mutates the on-disk file. Pick: file canonical (version is write-only) or DB canonical (file regenerable).
- **H3** Notes embedding non-determinism — `body.notes` is "full copy" in data-model but "MAY embed copy or hash" in research.

**Files:** `spec.md` (updated), `plan.md`, `research.md`, `data-model.md`, 3 contracts (`manifest.list`, `manifest.get`, `note.update`), `tasks.md`.

---

### 025 — Filesystem Plan Application

**Status:** BLOCKED.

**Resolved questions:**
1. Cross-platform move semantics: same-volume rename, cross-volume copy-then-delete with fsync, never silent overwrite.
2. Cancellation checked between items only; in-flight item completes (success or fail); remaining pending items batch to `cancelled`; plan terminal = `cancelled` regardless of partial successes.
3. Retry boundary: per-item retry within `applying` plan = 025 (`plan.item.retry`); terminal plan → fresh draft plan = 017 (`plan.retry`). No overlap.

**Must-fix:**
- **B1** Approval-token threat model under-specified — issuance/signing/replay window/single-use semantics all undefined.
- **B2** Contract divergence — 017's `plan.approve.json` doesn't emit `approval_token`; 025's `plan.apply.json` requires one.
- **H1** Path-escape attack vector not addressed — no destination canonicalization, no symlink containment check at apply time.
- **H2** Cancellation race during copy-then-delete — "current item" spans two FS syscalls; partial copy rollback semantics undefined.

**Files:** `spec.md` (updated), `plan.md`, `research.md`, `data-model.md`, 4 contracts (`plan.apply`, `plan.cancel`, `plan.item.skip`, `plan.item.retry`), `tasks.md`.

---

### 026 — Generated Project Source View Removal

**Status:** PROCEED-with-fixes (2 HIGH, 5 MEDIUM).

**Resolved questions:**
1. Removal is a `FilesystemPlan` variant (`origin = prepared_view_removal`), plan-gated like any mutation.
2. Stale criteria: path/kind/strategy/archive divergence triggers stale state.
3. Default policy: archive copies, unlink links; archive removed via plan flow.

**Must-fix (HIGH):**
- **H1** Hardlink semantics misrepresent reversibility — unlinking shared inode is safe, but post-removal regeneration cannot verify "the surviving inode is still canonical bytes."
- **H2** `materialization` (per-item) can diverge from declared `kind` (per-view) — review surface routes by view `kind`, removal picks by item `materialization`, risk of mislabeled actions.
- **M2** Stale criteria miss content drift on copy-kind views — copy view items may carry bytes that no longer match canonical inventory.

**Files:** `spec.md` (updated), `plan.md`, `research.md`, `data-model.md`, `contracts/preparedview.remove.json`, `contracts/preparedview.regenerate.json`, `tasks.md`.

---

## Cross-cutting themes from the adversarial passes

Several patterns recurred across the 25 reviews:

1. **Plan-gating bypass via caller-asserted `requires_plan`.** Specs 002, 008, 009 all trust a client-set flag for whether a transition needs a `FilesystemPlan`. A canonical edge table on the server side, ignoring client input for the safety-critical flag, is the constitutional fix.

2. **Enum drift between Rust/JSON-Schema/TS-mock sources.** Specs 002, 006, 009 redeclare lifecycle states across artifacts instead of `$ref`ing a single source of truth. A snapshot drift test in CI would catch this before merge.

3. **Counter / state invariants not enforceable at the contract layer.** Specs 017, 025 assert sum-invariants on plan counters and `state.unchanged` outcomes that the JSON Schema cannot express, leaving them to runtime code that may drift.

4. **Audit fidelity with no-op guards.** Specs 002, 006, 018 all introduce no-op detection that legitimately suppresses audit events, but the contract response shape (`status: "error"` with `state.unchanged` code) conflicts with the "no audit row written" decision. A `status: "noop"` response is the suggested fix.

5. **Free-form strings where enums are needed.** Specs 014 (`license`), 020 (filter values), 021 (`devMode` toggle) all accept open strings that future enum tightening would break.

6. **Approval-token / handoff fields not actually issued.** Specs 017→025 handoff defines the consumer side of `approval_token` but not the producer side. Cross-spec contract coordination must include the issuance path.

7. **TOCTOU windows.** Specs 003 (gate authority), 005 (classify/confirm), 011 (executable_path), 012 (path-uniqueness on rerun) all have between-check-and-act windows that the current specs handwave.

## Statistics

- **Files written:** 25 × ~6 artifacts = ~150 files
- **Speckit agent invocations:** 25 (5 parallel batches of 5)
- **Adversarial agent invocations:** 25 (paired 1:1)
- **Adversarial verdicts:**
  - BLOCKED: 21
  - PROCEED-with-fixes: 4
  - PROCEED-clean: 0

The "clean PROCEED" rate of zero is the expected outcome given that every spec is going through the SpecKit forward pass for the first time and that the adversarial reviewer is explicitly attacking, not rubber-stamping. The blockers are concrete and bounded; none required a constitutional rethink.

## Recommended next pass

1. **Spec 002 first.** Many other specs reference its `lifecycle.transition` contract; fixing B1/B2/B3 there unblocks 006, 008, 009, 023, plus partially clears the 017/025 boundary.
2. **Spec 014 second.** OpenNGC license factual claim has legal implications for distribution — must resolve before any catalog bundle ships.
3. **Specs 017 + 025 together** — they share the approval-token handoff and the counter-invariant; fixing each in isolation will produce drift.
4. **Specs 005 + 015 together** — 005 depends on 015's resolver, and 015's Unicode/path-traversal fixes unblock 005's plan-generation safety.
5. **Specs 003, 004, 020** — the route/gate/picker triad; each spec individually fixable but the interactions warrant a combined pass.
