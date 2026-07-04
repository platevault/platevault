# Protection defaults actually take effect (PR #405)

> Two-stage verification plan. Runner mechanics: see
> `e2e-agentic-test/AGENT-RUNNER.md`. Stage 1 must fully PASS before Stage 2.

## Coverage

- Spec: `specs/016-source-protection-defaults/spec.md` — FR-001 (per-source
  configurability), FR-002 (global defaults applied to newly added sources),
  FR-003 (source-level overrides visible in source settings), FR-006
  (protection settings auditable).
- PR #405 (**MERGED** into `redesign-ui-platevault`, 2026-07-04): previously,
  changing the global protection default (level / block-permanent-delete /
  protected categories) in Settings appeared to save but the plan-safety
  checks kept reading the original seeded values — a silent no-op. After #405,
  saves go through a single `app_core_settings::update_setting` path, the
  value the safety checks read is updated, every change emits a
  `protection.default.changed` audit event, and the permanent-delete gate no
  longer reads a stale `blockPermanentDelete`.
- Surfaces: Settings → Cleanup pane ("Source Protection" section: "Block
  permanent delete" toggle + default-protection select with
  Protected/Normal/Unprotected), Settings → Data Sources (per-root
  `SourceProtectionOverride` pill + Override control), Settings → Audit Log,
  bottom log panel.
- Backend commands: `settings_update` (scope `cleanup`), `settings_get`,
  `source_protection_get`, `source_protection_set`, `roots_register`,
  `plan_protection_check_cmd`.

## Preconditions and fixtures

- Branch: `redesign-ui-platevault` tip (#405 already merged — verify with
  `git log --oneline | grep 405` equivalent or just confirm the branch is at
  or past 2026-07-04). **Rust changed in #405** — if the Windows checkout was
  reset, apply the recompile-trap touch (AGENT-RUNNER) before trusting
  results.
- Setup completed with at least one registered raw root (reuse the
  `003 wizard-fresh-db-journey` end state).
- One extra fixture folder NOT yet registered:
  `C:\dev\astro-plan\test-data\raw-lights-2` (PowerShell `New-Item`).
- Real backend; bridge overlay on; window 1100×720.

## Stage 1 — Agent validation via Tauri MCP

Start `ipc_monitor` before step 1.

1. **Baseline read.** Via bridge, invoke `settings_get` with scope `cleanup`.
   **Expected:** response contains `defaultProtection` (default `protected`)
   and `blockPermanentDelete` (default `true`). Record both values.
2. **Change the default level (FR-002 write path).** Navigate Settings →
   Cleanup. In "Source Protection", change the default-protection select from
   its current value to `Normal`.
   **Expected (IPC):** a `settings_update` call with scope `cleanup` and
   `{ defaultProtection: "normal" }` succeeds (auto-save on change — no
   explicit Save button required). [SCREENSHOT cleanup-default-normal]
3. **Persistence round-trip (the #405 core).** Invoke `settings_get` scope
   `cleanup` again.
   **Expected:** `defaultProtection` is now `"normal"`. Then reload the app
   (Ctrl+R) and re-check the pane: the select still shows "Normal" (survives
   reload, i.e. persisted in DB, not component state).
4. **Audit event emitted (FR-006, #405).** Open Settings → Audit Log (and/or
   expand the bottom log panel).
   **Expected:** a new `protection.default.changed` audit entry exists for the
   change in step 2, carrying key `defaultProtection`, old value, and new
   value. In the bottom log panel the row's source tag reads "audit"
   (settings-save row "settings" may also appear). [SCREENSHOT audit-default-changed]
5. **New sources inherit the changed default (FR-002 effect).** Register the
   fixture folder: Data Sources → "+ Add source folder" → path
   `C:\dev\astro-plan\test-data\raw-lights-2` (native picker or type via E2E
   convention), category Raw → Add. Then invoke `source_protection_get` for
   the new root's id (get the id from `roots_list`).
   **Expected:** the effective protection level for the NEW root is `normal`
   (the changed default), while the pre-existing root (registered when the
   default was `protected`) keeps its previous effective level. On the new
   root's card, the protection pill reflects "Normal". **This is the
   regression #405 fixes — before the fix the backend kept using the seeded
   default.**
6. **Block-permanent-delete gate is live (#405 stale-read fix).** Toggle
   "Block permanent delete" OFF in the Cleanup pane.
   **Expected (IPC):** `settings_update` scope `cleanup`
   `{ blockPermanentDelete: false }` succeeds; `settings_get` confirms
   `false`; a second `protection.default.changed` audit entry appears for key
   `blockPermanentDelete`. Then toggle it back ON and confirm the same
   round-trip (leave the system in the safe state: ON).
7. **Safety check reads the live value.** Via bridge, invoke
   `plan_protection_check_cmd` with a minimal request referencing the NEW
   root's id (shape per `crates/contracts/core/src/protection.rs`; if request
   construction fails validation, record the exact error and mark this step
   DEFERRED to a plan-generation flow instead of guessing payloads).
   **Expected:** the response's evaluation is consistent with the CURRENT
   settings (level `normal` for the new root → item not blocked as
   `protected`), and includes only blocking items per FR-008.
8. **Per-source override still wins (FR-001/FR-003).** On the new root's
   card, click "Override", select `Protected`, save.
   **Expected (IPC):** `source_protection_set` succeeds;
   `source_protection_get` now returns effective `protected` for that root
   with override provenance; an audit row (source "audit") appears in the log
   panel.
9. **Cleanup.** Restore `defaultProtection` to its step-1 baseline via the UI;
   confirm one more `protection.default.changed` audit entry. `read_logs`:
   no ERROR-level backend entries during the whole stage.

### Stage 1 verdict

- **PASS**: every round-trip persisted and re-read correctly; audit entries
  present for EVERY default change (steps 2, 6×2, 9); new-root effective
  level tracked the changed default; override supersedes default.
- **FAIL** (fatal, the #405 regression): `settings_get` or
  `source_protection_get` returning the OLD value after a successful-looking
  save; missing `protection.default.changed` audit entries; new root
  inheriting the seeded default instead of the changed one.

## Stage 2 — Final Claude Desktop pass

1. **Comprehensibility.** Read the "Source Protection" section copy
   ("Controls the starting protection level assigned to newly ingested
   sources…"). Judge: does a user understand that this affects NEW sources and
   that cleanup plans skip protected sources? No raw i18n keys or placeholder
   leakage anywhere in Cleanup, Data Sources override UI, or Audit Log rows.
2. **Feedback on save.** Changing level/toggle gives perceivable feedback
   (state changes immediately, log panel row appears). No dead "did it save?"
   moments; no error toasts during normal saves.
3. **Audit readability.** The `protection.default.changed` entries in the
   Audit Log pane are human-readable (old → new values visible, not opaque
   JSON blobs), timestamps sane.
4. **Layout + themes.** At 1100×720: Cleanup pane section headers and the
   settings nav stay visible; only pane content scrolls. Repeat the
   [SCREENSHOT cleanup-default-normal] checkpoint in a second theme; the
   protection pills (Protected/Normal) remain legible in both.
5. **Sign-off.** PASS requires all items PASS plus a re-confirmation that the
   system was left in baseline state (defaultProtection restored,
   blockPermanentDelete ON).
