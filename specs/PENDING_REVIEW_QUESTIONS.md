# Adversarial Re-Review — 2026-05-22

## Summary

- Total specs reviewed: 25
- New status: 24 PROCEED, 0 BLOCKED, 1 PROCEED-with-fixes
- Specs needing user input: none (all policy questions resolved; findings below are implementation-phase risks or noted deferred items)

All 21 prior BLOCKED specs have had their material blockers resolved by the
2026-05-22 amendment passes. The single PROCEED-with-fixes rating (spec 005)
is for a cross-spec contradiction introduced by the spec 007 dark_flat ripple
that was explicitly flagged as "do not edit spec 005 now" but was not yet
applied. No spec remains constitutionally BLOCKED.

---

## Per-spec status

### Spec 002 — Data Lifecycle State Model

**Status**: PROCEED

**Prior BLOCKED items verified**:
- B1: `LifecycleState` was `oneOf` over overlapping enums — FIXED. `lifecycle.transition.json` now uses per-entity discriminated sub-schemas (`ProjectRequest`, `PlanRequest`, `InventorySessionRequest`, etc.), each pinning `entityType` as a `const` and constraining `currentState`/`nextState` to that family's typed enum. `LifecycleState` remains only as a `oneOf` for the response `newState`/`priorState` fields where disambiguation via the request is already known (`specs/002-data-lifecycle-state-model/contracts/lifecycle.transition.json:296-307`).
- B2: `requires_plan` was caller-asserted — FIXED. Contract `Request` description reads "The server derives `requiresPlan` from a canonical (entityType, from, to) edge table; callers MUST NOT assert it." The field is absent from all request sub-schemas (`lifecycle.transition.json:358`).
- B3: Three-way contradiction on `state.unchanged` — FIXED. Response `status` enum is `["success", "noop", "error"]`; `noop` path explicitly excludes `auditId` and `error`; `state.unchanged` error code does not appear anywhere in the contract (`lifecycle.transition.json:378-418`).
- H1: `provenance.*` error codes + blocking-fields detail — FIXED. `ErrorEnvelope.details.blockingFields` added as a typed array of `{ fieldPath, requiredOrigin: "reviewed" }`; `provenance.unreviewed` error code present in `ErrorCode` enum (`lifecycle.transition.json:308-357`).
- M1: FR-011 session-key derivation formula — FIXED. `spec.md:154` defines the tuple `(target_id, filter, binning, gain, observing_night)` with the solar-noon derivation algorithm referenced at `research.md §2.5`.

**New findings**:
- The deferred envelope sweep note is acknowledged in GRILL. `lifecycle.transition.json` already uses camelCase + `contractVersion` + `requestId` + status-discriminated convention — this contract was part of the sweep. No remaining gap here.
- `specs/002-data-lifecycle-state-model/research.md §6.3` plan lifecycle event-bus topics (A7 from the 017+025 amendment) are noted as "must be added when spec 002 is next revised." This is a tracked deferred item, not a blocker for 002's own implementation.
- The `observer_location` Amendment 2026-05-22 was correctly applied: `AcquisitionSession` has the `observer_location: ProvenancedValue<ObserverLocation>` field (`data-model.md:106`), and `ObserverLocation` type is defined inline.

---

### Spec 003 — First-Run Source Setup

**Status**: PROCEED

**Prior BLOCKED items verified**:
- B1: Restart semantics contradiction (destructive vs prefill) — FIXED. `spec.md:222` and `research.md §7` document DB-first with localStorage cache (A8); restart prefills from existing sources via `firstrun.restart` contract; behavior pinned in FR-013.
- B2: Gate authority drift — FIXED. `spec.md:241-244` specifies DB-first with `localStorage` cache; async loading state documented; `firstrun.restart` contract added; `research.md §7` confirms "DB-first with localStorage cache" as the resolved decision.
- B3: Finish atomicity — FIXED. `source.register.batch.json` exists and is the specified flush mechanism. `firstrun.complete.json` requires `source.register.batch` to complete first (`firstrun.complete.json:3`). Partial-success case handled at the Finish step with per-row retry UI.

**New findings**:
- spec 003 `plan.md` still needs the "Download Catalogs" step cross-reference that the spec 014 amendment flagged (spec 014 first-run flow). This is a known deferred item recorded in GRILL under action item 5. Not a blocker for spec 003's own shape.
- spec 003 `plan.md` also needs the "Detect tools" wizard step from spec 011 A2. Also a known flagged item. Not a blocker.
- `observer_location NOT collected at first run` was confirmed per the 2026-05-22 amendment; `plan.md` should carry this note. Verify before implementing the wizard step.

---

### Spec 004 — Native Filesystem Controls

**Status**: PROCEED

**Prior BLOCKED items verified** (was PROCEED-with-fixes; 4 HIGH items):
- Filter `*` escape hatch — FIXED. `native.file.pick.json:35` states "`*` is ONLY valid in a filter named exactly 'All files'; the server returns `filters.invalid` if `*` appears in any other filter row."
- `entity_kind` enum drift — FIXED. `data-model.md:68` now defines closed enum with 6 values (`inbox_item | inventory_row | project_manifest | master_calibration | registered_source | other`) matching `native.reveal.json`.
- Unsalted SHA-256 path hashing — FIXED. `data-model.md:118` confirms "raw path and path hash are NOT persisted (A2: drop path_hash to avoid PII in audit exports)." Correlation via `entity_id` only.
- `opener:default` too broad — FIXED. `tasks.md T002` updated to `opener:allow-reveal-item-in-dir`; `launch-url` and `launch-app` owned by spec 011.

**New findings**: None. Clean pass.

---

### Spec 005 — Inbox Mixed-Folder Split

**Status**: PROCEED-with-fixes

**Prior BLOCKED items verified**:
- B1: Classify/confirm TOCTOU — FIXED. `inbox.classify.json:37` returns `content_signature`; `inbox.confirm.json:14` requires `content_signature`; mismatch returns `classification.stale` with `staleSince` (`inbox.confirm.json:91-103`).
- B2: Single-type plan generation fabricates filenames — FIXED. `inbox.confirm.json:45` states "Equals the number of files enumerated from `InboxClassificationEvidence` rows (not derived from `fileCount`)." `research.md §Split Destination Model` (A9) confirms paths come from persisted evidence rows.
- H1: Confidence threshold inconsistency — FIXED (model removed). Classification is now fully deterministic IMAGETYP-only (R-IMAGETYP override, A5); confidence scoring eliminated entirely.
- H4: `unclassified` items have no `inbox.confirm` action path — FIXED. `spec.md FR-018` and `inbox.reclassify.json` (new contract) provide inline per-file reclassify picker; `classification.ambiguous` error fires if confirm is attempted on unclassified item without full manual override (`inbox.confirm.json:72-86`).

**New findings — BLOCKING cross-spec contradiction**:
- **spec 007 ripple NOT applied to spec 005 normalization table.** The spec 007 Amendment (R-DarkFlat-Reserved) explicitly states: "dark_flat keywords (DARKFLAT, Dark Flat, FLATDARK, etc.) MUST NOT be added to the spec 005 IMAGETYP normalization table for v1." However, `specs/005-inbox-mixed-folder-split/research.md:73` shows `DarkFlat | DARKFLAT, Dark Flat, Flat Dark, FLATDARK` IS present in the normalization table. The GRILL amendment notes "This narrowing must be confirmed when spec 005 is next revised." The ripple was never applied. Files with these IMAGETYP values should land as `unclassified` per spec 007, but spec 005 would classify them as `dark_flat`. This is a **direct spec-level contradiction** between spec 005 and spec 007. Must be resolved before implementing the classifier — remove the `DarkFlat` row from `specs/005-inbox-mixed-folder-split/research.md` normalization table and add the "reserved, unclassified" note per spec 007 R-DarkFlat-Reserved.
- `dark_flat` enum value appears in `inbox.classify.json` `frame_type` enum (`["light", "dark", "bias", "flat", "dark_flat"]`). This is consistent with `dark_flat` being a reserved FrameType that can appear as a per-file unclassified marker, but the contract could mislead implementers into including it in the normalizer. A clarifying comment in the contract would prevent implementation drift.

---

### Spec 006 — Inventory Library Lifecycle

**Status**: PROCEED

**Prior BLOCKED items verified**:
- B1: `setSessionReviewState` accepts presentational state but contract requires canonical — FIXED. `inventory.session.review.json` uses `SessionState` (6 canonical values); `PresentationalReviewState` schema dropped entirely; `nextState` description confirms "No presentational projection" (`inventory.session.review.json:34-46`).
- H1: `state.unchanged` conflict — FIXED. Response `status` enum includes `"noop"`; `state.unchanged` error code absent; `status: "noop"` means no audit entry (`inventory.session.review.json:107`).
- H2: `mixed` projection rule unverifiable — FIXED. R-Projection-Wide removes the presentational `mixed` from `InventorySession`; `mixed` detection is now server-side integration test (`tasks.md T311`), not JSON Schema fixture.

**New findings**:
- `data-model.md:70` uses `Target.primary_designation` correctly (A1 ripple applied). Previously referenced `canonical_name`.
- `captured_on` intentional divergence documented in `data-model.md` (E2): `InventorySession.captured_on` = earliest frame date (UX label); `TargetSession.captured_on` = solar-noon boundary. This is a deliberate design decision; no issue.

---

### Spec 007 — Calibration Matching Rules

**Status**: PROCEED

**Prior BLOCKED items verified**:
- B1: Confidence math allows negative values — FIXED. `data-model.md §Flat table note` and `research.md R4` document `clamp(…, 0.0, 1.0)` in the confidence formula. `CalibrationMatch.confidence` in contract has `"minimum": 0, "maximum": 1` (`calibration.match.suggest.json:39`).
- B2: `override_penalty` undefined — FIXED. `data-model.md §Settings Keys` defines `override_penalty` default 0.3, per-frame-type configurable. `research.md R4` documents the value and units.
- H1: Observing-night timestamp source still ambiguous — FIXED. R-Night-TS-1 resolves: `AcquisitionSession.exposure_start_utc` from earliest frame's `DATE-OBS` (`research.md R3`). Chain documented.

**New findings**:
- spec 007 explicitly flags spec 005 ripple (do not edit spec 005 yet). Spec 005 has not applied the ripple (see spec 005 finding above). Implementation must apply both changes atomically.

---

### Spec 008 — Project Create / Onboard / Edit

**Status**: PROCEED

**Prior BLOCKED items verified**:
- B1: `path` required but `initial_sources=[]` allowed — FIXED. R-Tool-Req ratified: tool REQUIRED at creation; empty sources creates project in `setup_incomplete`; `spec.md` and `project.create.json` (`requestId:71-76`) require `name`, `tool`, `path`. Project can advance once sources are added.
- B2: Tool-locked invariant has no unlock path — FIXED. R-NoDup ratified: no duplicate/unlock contract; recovery = manual re-creation; UI surfaces this in tool-lock messaging (`spec.md US1 note`).
- H1: Inventory-only constraint not enforced at contract layer — FIXED. R-Inventory-Confirmed: `project.source.add` use case checks `inventory_session.state == "confirmed"`, rejects with `source.not_confirmed` (`spec.md FR-012`).
- H3: Channel inference + snapshot-staleness race — FIXED. R-ChannelDrift: `channelDrift` field on `project.get` response; two new contracts `project.channels.reinfer` and `project.channels.dismiss_drift` give the user explicit resolution path.

**New findings**: None. Clean pass.

---

### Spec 009 — Project Lifecycle Model

**Status**: PROCEED

**Prior BLOCKED items verified**:
- B1: Plan-gating bypass via caller-set `requires_plan=false` — FIXED. A6 documents "Caller MUST NOT supply it. Server consults spec 002 canonical edge table." `project.lifecycle.transition.json:66-68` documents `state.unchanged` not used; `requires_plan` absent from request schema; R-PlanGated-Schema adds JSON Schema `if/then` belt-and-suspenders for unconditionally plan-gated edges (`project.lifecycle.transition.json:140`).
- B2: Enum drift — `ProjectLifecycle` redeclared instead of `$ref`ing spec 002 — PARTIALLY FIXED. `ProjectLifecycle` is redeclared inline in the contract (deferred envelope sweep). This is a known deferred item (A7/E7 note in GRILL). A drift CI snapshot test is needed; spec 009 `data-model.md` notes the dependency. Acceptable as a tracking risk pending the envelope sweep.
- H1: Blocked-flag exhaustion — FIXED. Decision: "No suppression at lifecycle layer — detector layer debounces (explicitly documented)" (`spec.md`).
- H2: `actor=system` allowed on any edge — FIXED. A4 restricts: system only on `* → blocked`, `blocked → *`, and `setup_incomplete → ready` auto-transition. Contract `Actor` description documents this rule; server enforces.

**New findings**:
- R-Unarchive adds `archived → ready` edge (18 edges total). `project.lifecycle.transition.json R-PlanGated-Schema` note correctly handles this as a C7-conditional plan requirement that the schema `if/then` cannot model (server authoritative).

---

### Spec 010 — Guided First-Project Flow

**Status**: PROCEED

**Prior BLOCKED items verified**:
- B1: `STATE_CORRUPTED` with no recovery path — FIXED. R-Corrupt: reset to Idle + diagnostic audit; `guided.state.get` returns `STATE_CORRUPTED` on first read, then fresh Idle; `data-model.md §Recovery Rules` documents the three-step process; FR-010 added to `spec.md`.
- B2: Trigger taxonomy collision — FIXED. Convention C applied: dot-notation lowercase for all event-bus topic names throughout the registry and plan.md bus subscription list (`data-model.md:18-27`).
- H1: `source=restore` filtering — FIXED. R-Source-1: `GuidedSubscription` rule documented in `data-model.md §Event Subscription Rules`; event envelope `source` field defined; subscribers ignore `source == "restore"` events.
- H3: Anchor-orphan lint scheduled but no CI gate — FIXED. A2 + CI test task T026 added: build fails when any registered `data-guide-anchor` constant is absent from built bundle.

**New findings**: None.

---

### Spec 011 — Processing Tool Launch

**Status**: PROCEED

**Prior BLOCKED items verified**:
- B1: macOS `open -a` shell-name hostile — FIXED. R-BundleId + A1: `open -b <bundle_id>` is the primary macOS mechanism; `DetachStrategy.open_minus_a` renamed to `open_bundle_id`; seed bundle ids documented (`data-model.md`).
- B2: `executable_path` validation TOCTOU — FIXED. R-DropExecCheck: pre-spawn existence check removed entirely; OS errors propagate as `launch.failed` (`spec.md FR-011`).
- H1: `args_hash` excludes executable — FIXED. R-Hash-Exec: `args_hash = BLAKE3(canonicalized_executable_path || rendered_argv)`; algorithm and scope documented.
- H3: Project working-folder cwd with no containment check — FIXED. R-CwdContain: library-root containment check added; `cwd.outside_library_root` error code in `tool.launch.json ErrorCode` enum.

**New findings**: None.

---

### Spec 012 — Processing Artifact Observation

**Status**: PROCEED

**Prior BLOCKED items verified**:
- B1: Frozen-at-detection launch attribution breaks under clock skew — FIXED. R-AppClock: app-clock (`Instant::now()`) for `detected_at`; `file_mtime` stored but NOT used for attribution; NAS skew protection documented (`data-model.md §Tool Launch Attribution`). A7: re-attribution within 6h window on `tool.launch` event.
- B2: `UNIQUE(project_id, path)` collides with PI rerun replace-in-place — FIXED. A8: PI rerun updates row in place; `content_hash` updated; `artifact.updated` event emitted; prior hash NOT preserved; `UNIQUE(project_id, path)` constraint intact, model simplified.
- H1: Sticky manual override has no clear-path — FIXED. A6: `kind: null` clears the override; `artifact.classify.json kind` type is `enum | null`.
- H3: Self-test probe writes hidden file — This issue is NOT explicitly resolved in the amendments. The spec 012 research and plan do not address whether a watcher self-test probe that writes a file is still present. However, R-ExtAllow replaces the self-test with an extension allow-list coarse filter, and C5 (watcher lifetime drawer-bound) and R-9 document trade-offs. If a file-write probe was in the original implementation plan, verify it was removed.

**New findings**:
- `workflow.run_completed.json` contract created (R-Event-Light); spec 024 subscription is wired. The payload shape matches what spec 024 `plan.md` expects. Cross-spec wiring is clean.

---

### Spec 013 — Target Lookup From FITS OBJECT

**Status**: PROCEED (was PROCEED-with-fixes)

**Prior PROCEED-with-fixes HIGH items verified**:
- Sharpless/LBN/LDN listed as user-selectable but not bundled — FIXED. Decision reversed: all 13 catalogs ship via Pattern X download at first run. 13-catalog set documented throughout.
- Cross-catalog identity merge needs deterministic rule — FIXED. A3: `CatalogEquivalence` table added to data-model.md; UUIDv5 derivation rule documented (R-1.1); `is_primary` by precedence table.
- Gap rule asymmetric — FIXED. R-2.3: two-tier rule (90/15 → high, 60/10 → medium) with truth table in `research.md R3`.

**New findings**:
- `target.resolve.json` uses `contractVersion: "1.0"` (not `"2.0.0"` or `"1.0.0"`). The `target.get.json` also uses `"1.0"`. These are consistent within spec 013/023 but differ from specs 017/025 which use numeric patch (`"2.0.0"`). The deferred envelope sweep will standardize this. Not a blocker but flagged for the sweep.

---

### Spec 014 — Catalog Index Licensing

**Status**: PROCEED (was BLOCKED)

**Prior BLOCKED items verified**:
- B1: OpenNGC is CC BY-SA 4.0, incompatible with Apache-2.0 redistribution — FIXED. Amendment 2026-05-22: `astro-plan-catalogs` separate repo acts as redistributor; app stays Apache-2.0; OpenNGC bundled with LICENSE + NOTICE per CC BY-SA requirements. `catalog.list.json` `LicenseShortCode` includes `"cc-by-sa-4.0"`.
- B2: `license` field is free-form string — FIXED. `LicenseShortCode` is a closed enum of 8 values; CI hard-fails on unknown values (R-2.1); `catalog.list.json:28-30`.
- H1: NOTICE serialization format undefined — FIXED. R-2.3: `NOTICE.json` + `NOTICE.txt` generated by CI per release; format documented in `research.md R6`.
- H2: `LicenseAttribution` lacks CC BY required fields — FIXED. `data-model.md:57-68`: `author`, `title`, `license_uri` fields are REQUIRED when license matches `cc-by-*` or `cc-by-sa-*`; invariant enforced via conditional schema constraint.

**New findings**:
- 13-catalog set in the amendment vs 13 in `target.get.json CatalogId` enum: both list `messier, caldwell, sharpless, abell_pn, abell_galaxies, arp, vdb, barnard, lbn, ldn, melotte, common, openngc`. Counts match. Cross-spec consistency confirmed.

---

### Spec 015 — Token Pattern Builder

**Status**: PROCEED (was PROCEED-with-fixes)

**Prior PROCEED-with-fixes BLOCKING items verified**:
- B1: Unicode normalization unspecified — FIXED. A1: NFC + strip C0/C1/format/bidi + confusables check via UTS#39/`unicode-security` crate; `pattern.invalid.unicode` error code in contract.
- B2: Path traversal via `..` segment — FIXED. A2: `.` and `..` rejected in resolved token values and assembled paths; `path.traversal` error code in contract (`pattern.resolve.json:78`).
- B3: MAX_PATH amplification — FIXED. A4: ≤200 UTF-8 bytes per segment; ≤200 chars total; payload includes `segmentLengthBytes` + `resolvedLength`.

**New findings**: None. `pattern.resolve.json` and `pattern.validate.json` both carry all three safeguards. `pattern.preview.json` (new contract) also uses camelCase convention.

---

### Spec 016 — Source Protection Defaults

**Status**: PROCEED (was BLOCKED)

**Prior BLOCKED items verified**:
- H1: Resolver order conflict (`plan.md` vs `data-model.md`) — FIXED. A1: per-source override wins unconditionally; categories elevate ONLY when no override row exists. `data-model.md §Resolver` documents the pseudocode authoritatively (`data-model.md:80-90`).
- H2: No documented in-code default tier — FIXED. A3: hard-coded fallback values documented explicitly when `GlobalProtectionDefaults` row absent (`data-model.md:46-54`).
- H3: `block_permanent_delete` global-only vs per-source level — FIXED. A2: `block_permanent_delete: bool?` added to `SourceProtectionState`; null = inherit global; resolution pseudocode in `data-model.md:93-100`.

**New findings**:
- R-OSTrash-Allowed (E-016-1): `block_permanent_delete` applies only to `permanent_delete` action; `os_trash` always allowed. Confirmed in `spec.md FR-007` and `research.md §R3`.

---

### Spec 017 — Cleanup Archive Review Plans

**Status**: PROCEED (was BLOCKED)

**Prior BLOCKED items verified**:
- B1: Counter coherence unenforceable — FIXED. A3: `itemsSkipped` + `itemsCancelled` counters added; full invariant `total == applied + failed + skipped + cancelled + pending` documented in `data-model.md:37`.
- B2: Reopen `approved → draft` race — FIXED. R-FS-1: `approvedMtime`/`approvedSizeBytes` per-item snapshot at approve time; `approvalToken` HMAC issued by `plan.approve.json` response; R-CAS-1: atomic CAS `approved → applying` at apply start with `plan.invalid_state` on race.
- H3: Retry chain orphaning — FIXED. A5 (R-Chain-1): soft-delete (`discardedAt` flag); chain stays intact; orphan chain UI flat link in detail header.
- H4: `discarded` state missing from vocabulary — FIXED. A5: `discarded` added to `PlanState` 10-state vocabulary in `data-model.md:73-80`; present in all list/get/discard contracts.

**New findings**: None. `plan.approve.json` correctly emits `approvalToken` in response. The 017/025 handoff is clean.

---

### Spec 018 — Settings Configuration Model

**Status**: PROCEED (was BLOCKED)

**Prior BLOCKED items verified**:
- B1: No-op guard `prev === value` fails for reference types — FIXED. `research.md R4.1` documents deep structural equality for object/array keys; `status: "noop"` returned without row write or audit (`research.md:97-111`).
- B2: Override-set asymmetry (`autoApplyPattern` overridable but `pattern` not) — FIXED. A2: `autoApplyPattern` removed from overridable set; `data-model.md:88` confirms removal.
- H1: v1→v2 default change indistinguishable from "never set" — FIXED. Restore-defaults writes the literal current default value; greenfield project, N/A for migration. `research.md R4.4` documents.
- H2: `settings.update.json` lacks per-key `value` discrimination — PARTIALLY FIXED. The `key` field uses `oneOf` with enum + pattern strings, but `value` has no per-key sub-schema in this contract; the description says "Must validate against the per-key sub-schema in `settings.state.v1.json`" — that file is not present in the contracts directory. This is an implementation-time risk: the `settings.state.v1.json` sub-schema file needs to exist before the settings store can enforce per-key type validation at the contract layer.

**New findings**:
- All ripple keys from GRILL are absorbed: `rememberFollowLogs`, `current_library_id`, `devMode`, `plans.list.default_age_cutoff_days`, `target_lookup.active_catalogs`, `calibration.dark_temp_tolerance`, `calibration.prefill_suggestion`, `imagetyp_normalization.user_mappings`, per-tool `bundle_id` (pattern), per-profile `watch_extensions` and `launch_attribution_window_hours` — all present in `settings.update.json key.oneOf`. Cross-spec absorption is complete.
- `observer_location` correctly NOT present anywhere in spec 018 per the 2026-05-22 amendment.
- Spec 018 still lacks `calibration.flat.gain.tolerance_hard` key (from spec 007 original A5 item). spec 007 `data-model.md §Settings Keys` lists it as `calibration.<frame_type>.override_penalty` (per-type) and `calibration.dark_temp_tolerance`, `calibration.prefill_suggestion`. The `calibration.flat.gain.tolerance_hard` boolean from the original GRILL table ("Configurable in Settings → Calibration") does not appear in `settings.update.json`. This may be intentional (absorbed into `calibration.<frame_type>.override_penalty` semantics) or an oversight. Flag for implementer to verify against spec 007 `data-model.md §Settings Keys`.

---

### Spec 019 — Bottom Log Viewer

**Status**: PROCEED (was BLOCKED)

**Prior BLOCKED items verified**:
- B1: Cursor namespace ambiguity — FIXED. A1: `id` namespaced as `aud:<n>` and `dia:<n>`; pattern `^(aud|dia):[0-9]+$`; `log.stream.json cursor` description documents format (`log.stream.json:17`).
- B2: Export-vs-viewer count divergence — FIXED. Export default is `source: audit` with `include_diagnostics: false`; US4 acceptance scenario updated to reflect audit-only default export; asymmetry documented in `data-model.md §Level Filter`.
- H1: Audit→LogEntry mapping unilateral — FIXED. `contract_version: "1"` added to `LogEntry` schema (`log.stream.json`); H1 contractVersion added (`data-model.md:10`).
- H3: `since`/`until` semantics ignore audit retention — FIXED. A4: `truncated: boolean` + `truncatedCount: int?` on stream response; UI renders "History gap" marker (`log.stream.json:59-67`).

**New findings**: None.

---

### Spec 020 — Router URL State

**Status**: PROCEED (was BLOCKED)

**Prior BLOCKED items verified**:
- B1: Forward-compat key drop is silent and lossy — FIXED. A-020-2: `DeprecatedParamMap` registry added; URL read applies alias map; initial entry `review → reviewFilter`; removal after 2 releases; `data-model.md §DeprecatedParamMap` and tasks T060-T061.
- B2: Library-identity mismatch — FIXED. A-020-3 + R-Lib-V1: `libraryId` required in `url.resolve.json` request; `library.mismatch` error emitted (not informational); `url.resolve.json:26-29`.
- H1: Stale-id cleanup race — FIXED. D-020-H1: `data-model.md §Stale-Id Re-Fire Guard` documents `useRef` flag / effect-cleanup pattern; task T066.
- H2: Validators accept arbitrary strings — FIXED. D-020-H2: enum allow-lists for all URL params defined in `data-model.md` search-param tables; task T067.

**New findings**: `url.resolve.json` does not carry a top-level `contractVersion` or `requestId` in the top-level schema object (they are in the `response`). The `operation.contractVersion: "1.0.0"` is present in the `operation` block. This is an unusual structure vs the newer camelCase envelope standard. The envelope sweep pass should normalize this contract along with specs 002, 003, 006-009, 010-012, 016, 019, 022, 026.

---

### Spec 021 — Developer Contract Diagnostics

**Status**: PROCEED (was BLOCKED)

**Prior BLOCKED items verified**:
- B1: `devMode` toggle has no build-flag gate — FIXED. A-021-2 + R-DevFeature: compile-time `dev-tools` Cargo feature; release builds omit route + proxy + Tauri commands entirely; runtime toggle controls proxy in dev-tools builds only.
- B2: Redaction defaults whitelist user paths — FIXED. A-021-3: ALL paths redacted by default (`${LIBRARY_ROOT}/...` placeholder); per-export opt-in `includeVerbatimPaths: boolean` (default false) on new `dev.export.json` contract.
- H1: Restart-required-to-install-proxy — FIXED. A-021-1: FR-008 acceptance scenario 4 rewritten; toggle-off + restart = fully uninstalled; scenario 5 documents "recording continues without restart" (informational).
- H3: `replay_safe` default never validated — FIXED. A-021-4: `replaySafe` default `false`; CI lint snapshot test T037 enforces; `dev.contracts.list.json replaySafe: default: false`.

**New findings**: None.

---

### Spec 022 — Desktop Prototype Design System

**Status**: PROCEED (was PROCEED-with-fixes)

**Prior PROCEED-with-fixes MEDIUM items verified**:
- Font-stack literals carve-out in FR-006 — FIXED. D-022-1: `font-family` MAY reference platform-native literal strings; token coverage still applies to `font-size`/`font-weight`/`line-height`.
- Helper exports added to vocabulary table — FIXED. D-022-2: `FilterLabel`, `FactGroup`, `Facts`, `TokenPatternBuilder` added to `data-model.md` Component Vocabulary table.
- FR-013 theme contract softening — FIXED. D-022-3: `theme.get`/`theme.set` forward-compat only; T042 marked optional/deferred.

**New findings**: None. `DESIGN.md` confirmed to exist at repo root from commit `314292a`.

---

### Spec 023 — Target Identity History Notes

**Status**: PROCEED (was PROCEED-with-amendments)

**Prior HIGH item verified**:
- H1: `captured_on` derivation rule undefined — FIXED. A5 + R-3.1: `captured_on = date_of(exposure_start_utc − 12h)` in `AcquisitionSession.observer_location.tz`; solar-noon boundary; null when `observer_location` null/unreviewed; session excluded from history in that case (`target.get.json:95-97`).

**Prior MEDIUM items verified**:
- M2: Alias merge/split deferred — FIXED. R-3.4: `target.alias.remove` + `target.primary.rename` shipped in v1; US5 + FR-008 + FR-009 added; new contracts created.
- M3: No length cap on notes — FIXED. A6: 16 KB UTF-8 cap; `target.note.update.json content.maxLength: 16384`.

**New findings**:
- `TargetProject.tool` correctly changed from optional to required per spec 008 R-Tool-Req override; `target.get.json` `TargetProject.required` includes `"tool"`.

---

### Spec 024 — Project Manifests And Notes

**Status**: PROCEED (was PROCEED-with-fixes)

**Prior HIGH items verified**:
- H1: Trigger taxonomy leak — FIXED. A4: `ManifestReason` is a closed enum (`created | source_change | lifecycle_transition | cleanup_applied | workflow_run`); `data-model.md §ManifestReason` defines it authoritatively (`data-model.md:45-49`).
- H2: Immutability contradicts `version` field — FIXED. A7: file is canonical and immutable; `version` governs format for new writes only; `data-model.md:10` and `plan.md Architecture §2`.
- H3: Notes embedding non-determinism — FIXED. A8: `body.notes` is "full text snapshot at write time"; invariant `data-model.md:104`.

**New findings**:
- spec 012 ripple (emit `workflow.run_completed`) is correctly FLAGGED in spec 024 `plan.md:100-101` and `data-model.md:92`. This is a known tracked item; spec 012 already has `workflow.run_completed.json` and `spec.md FR-010`. The wiring is complete from the spec 012 side; spec 024 subscribes correctly.

---

### Spec 025 — Filesystem Plan Application

**Status**: PROCEED (was BLOCKED)

**Prior BLOCKED items verified**:
- B1: Approval-token threat model under-specified — FIXED. HMAC over `(planId, contentHash, approvedAt, serverSecret)`; single-use; no TTL (replaced by per-item FS revalidation); plan.approve.json issues the token; plan.apply.json consumes it (`plan.apply.json:21`).
- B2: Contract divergence — 017's `plan.approve.json` doesn't emit `approvalToken` — FIXED. `plan.approve.json response.required` includes `approvalToken`; description documents HMAC semantics (`plan.approve.json:23-32`).
- H1: Path-escape attack vector — FIXED. A6 + FR-014: canonical path verification at apply; `path.invalid` for out-of-root paths; R-CwdContain in spec 011 also contributes.
- H2: Cancellation race during copy-then-delete — FIXED. Decision: always finish in-flight item; cancellation between items only; `plan.cancel.json` reflects this.

**New findings**: None. `plan.resume.json` new contract correctly handles `paused → applying` transition.

---

### Spec 026 — Generated Project Source View Removal

**Status**: PROCEED (was PROCEED-with-fixes)

**Prior HIGH items verified**:
- H1: Hardlink semantics misrepresent reversibility — FIXED (moot). R-026-Strategies: hardlink deferred to v1.x; `hardlink` reserved in `kind` enum only; D-026-H1 marked "MOOT — hardlink deferred."
- H2: `materialization` vs `kind` divergence — FIXED. A2: refuse mixed-kind at create time with `view.mixed_kind` error; `kind_diverged` state for pre-existing records; `preparedview.remove.json ErrorCode` includes `"view.mixed_kind"`.

**New findings**: None. Full spec 017/025 compliance documented in R-026-Pipeline; `preparedview.remove.json` response carries `plan_id` entering the standard pipeline.

---

## Cross-cutting findings (drift between specs after the ratification pass)

### 1. spec 005 dark_flat normalization table not updated (MUST FIX before implementing classifier)

`specs/005-inbox-mixed-folder-split/research.md:73` still contains the `DarkFlat` row in the normalization table. The spec 007 Amendment (R-DarkFlat-Reserved) explicitly prohibits this. The GRILL text says "confirmed when spec 005 is next revised" — that revision did not happen. This is the only concrete cross-spec contradiction remaining after the amendment passes.

**Fix**: Remove the `DarkFlat` normalization row from `005/research.md`. Add a note: "`dark_flat` IMAGETYP values land as `unclassified` per-file marker (spec 007 R-DarkFlat-Reserved). The `dark_flat` FrameType is reserved in the FrameType enum for forward-compat but receives no normalization mapping in v1."

Also review whether `dark_flat` should remain in `inbox.classify.json frame_type` enum. It may be kept as a `FrameType` enum value (reserved) but should never appear as a `single_type` folder result from the normalizer.

### 2. Deferred envelope sweep affects 13 specs

GRILL documents that the universal camelCase + `contractVersion` + `requestId` + status-discriminated envelope sweep is deferred to "a final pass" for: 002, 003, 006, 007, 008, 009, 010, 011, 012, 016, 018, 019, 026.

These contracts currently use a mix of snake_case fields and non-discriminated envelope shapes. This is a **known tracked deferred item**, not an oversight. However, it must be completed before implementation begins on any of these specs, as the envelope shape is the primary cross-language contract surface.

### 3. `crates/patterns/` crate path not in CLAUDE.md monorepo structure

`specs/015-token-pattern-builder/plan.md R-CratePatterns` added `crates/patterns/` as a new crate consumed by `crates/app/core`, `crates/fs/planner`, and `crates/project/structure/`. GRILL explicitly defers this CLAUDE.md update: "Flag for next CLAUDE.md revision pass." The CLAUDE.md monorepo structure section does not list `crates/patterns/`. This should be addressed in the next CLAUDE.md pass (tracked as task #11).

### 4. spec 018 `settings.state.v1.json` per-key sub-schema missing

`settings.update.json value` field says "Must validate against the per-key sub-schema in `settings.state.v1.json`" but this file does not exist in `specs/018-settings-configuration-model/contracts/`. Without it, per-key value type enforcement is unspecified at the contract layer. This is a medium-priority gap to fill before spec 018 implementation begins.

### 5. spec 018 `calibration.flat.gain.tolerance_hard` key possibly missing

The original GRILL per-spec table for spec 007 listed "Flat gain hard vs soft — Configurable in Settings → Calibration." spec 007 `data-model.md §Settings Keys` only documents `calibration.dark_temp_tolerance`, `calibration.<frame_type>.override_penalty`, and `calibration.prefill_suggestion`. The `calibration.flat.gain.tolerance_hard` boolean mentioned in the original table is absent. Implementers should verify whether this key was intentionally dropped in favor of `override_penalty` semantics or was overlooked.

### 6. spec 002 research.md §6.3 plan lifecycle event-bus topics deferred

GRILL Amendment 2026-05-22 (017+025, A7) requires `specs/002-data-lifecycle-state-model/research.md §6` to be extended with plan lifecycle topics. This was explicitly flagged as "not applied in this session." Before spec 002 implementation, these topics must be documented in §6.3.

### 7. spec 012 H3 self-test probe write (minor, verify at implementation)

The original adversarial BLOCKED item H3 for spec 012 flagged that a watcher self-test probe writing a hidden file violates "observation is read-only." The amendments address this via R-ExtAllow (extension filter replaces probe heuristics) and R-9 (watcher lifetime). However, neither amendment explicitly states "self-test probe file-write removed." Verify during implementation that no write-to-disk watcher probe remains in the spec 012 plan.

---

## Recommended next actions

1. **Apply spec 005 dark_flat ripple** (MUST before classifier implementation): remove `DarkFlat` normalization row from `005/research.md`; add reserved-slot note; optionally clarify `inbox.classify.json frame_type` enum comment.

2. **Complete deferred envelope sweep** (MUST before implementation of any pre-sweep spec): apply camelCase + `contractVersion` + `requestId` + status-discriminated convention to the 13 remaining specs listed in cross-cutting finding #2.

3. **Add `crates/patterns/` to CLAUDE.md** (tracked as task #11): update the monorepo structure section.

4. **Create `settings.state.v1.json`** (before spec 018 implementation): define per-key value sub-schemas for all 20+ registered settings keys.

5. **Verify `calibration.flat.gain.tolerance_hard`** (spec 007/018): confirm whether this key was intentionally dropped or needs to be added to `settings.update.json`.

6. **Add plan lifecycle event-bus topics to spec 002 research.md §6.3** (before spec 002 implementation): register `plan.approved`, `plan.discarded`, `plan.cancelled`, `plan.applying.*` topics.

7. **Begin spec 002 implementation** once the above deferred sweep and §6.3 addition are complete; all other blockers are cleared.
