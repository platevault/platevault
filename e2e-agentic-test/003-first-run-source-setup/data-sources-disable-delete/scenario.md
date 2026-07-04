# Data Sources — Disable/Enable and Delete (P6b, PR #404)

> Two-stage verification plan. Runner mechanics: see
> `e2e-agentic-test/AGENT-RUNNER.md`. Stage 1 must fully PASS before Stage 2.

## PRECONDITION — requires PR #404 merged

**This scenario requires PR #404 (`impl-p6b-roots-disable-delete`) merged into
`redesign-ui-platevault`.** On the current branch tip the Disable and Delete
buttons are `console.log` stubs; running this scenario before the merge will
(correctly) fail at step 1. PR #404 changes Rust (new migration
`0052_registered_sources_active.sql`, commands `sources_set_active` /
`roots_delete`) — after deploying, apply the RECOMPILE TRAP touch including
`crates/persistence/db/src/lib.rs` (forces the sqlx migration re-embed;
symptom of staleness: "command not found" or "no such column: active").

## Coverage

- PR #404: Disable/Enable = visibility flag (`registered_sources.active`),
  history untouched; Delete = registration removal only, **blocked** with
  typed `root.has_dependents` when dependent records exist (decision D8 — no
  cascade); files on disk never touched (constitution I); audit events
  `root.active_changed` / `root.deleted`.
- Spec 016 FR-005 adjacency: destructive actions confirm-gated
  (`ConfirmOverlay` danger dialogs, mirroring the #386 restart convention).
- Spec 046 error codes: block reason surfaced via the error-code catalog
  (`err_root_has_dependents` copy), not a raw code, and NOT a silent close.
- Backend commands: `sources_set_active` `{ rootId, active }`, `roots_delete`
  `{ rootId }`, `roots_list` (roots gain an `active` field).

## Preconditions and fixtures

- Branch: `redesign-ui-platevault` WITH #404 merged; recompile-trap applied.
- Real backend; bridge overlay; window 1100×720.
- Setup completed. Fixture roots:
  1. **Root A (with dependents)** — the raw root from the remap/rescan
     scenario (or any root that has been rescanned with files present, so
     `inbox_items`/`file_record`/session rows exist for it).
  2. **Root B (dependent-free)** — register a brand-new EMPTY folder
     `C:\dev\astro-plan\test-data\raw-empty` (PowerShell `New-Item`, then
     Data Sources → "+ Add source folder" → category Raw). Do NOT rescan it.
  3. **Root C (offline)** — the Delete button renders only on OFFLINE root
     cards. Create `C:\dev\astro-plan\test-data\raw-tempgone`, register it,
     then rename the folder on disk
     (`Rename-Item ... raw-tempgone raw-tempgone-x`) and reload the pane so
     the card shows the "offline" pill. Prepare TWO such roots if possible —
     one rescanned before going offline (C1, has dependents), one never
     scanned (C2, dependent-free) — C2 is the deletable one.
- Start `ipc_monitor` before Stage 1.

## Stage 1 — Agent validation via Tauri MCP

### Disable / Enable

1. **Buttons are real (stub regression guard).** On Root A's card click
   "Disable" while watching captured IPC and the JS console.
   **Expected:** a `ConfirmOverlay` opens — title "Disable this source?",
   description "The source will be excluded from scans and ingest until
   re-enabled. Its history is kept.", danger-styled confirm labeled "Disable"
   + Cancel. **No IPC fires yet** and NO `console.log` "STUB" message appears
   (pre-#404 behavior = instant FAIL). [SCREENSHOT disable-confirm]
2. **Cancel is a no-op.** Click Cancel.
   **Expected:** overlay closes; no `sources_set_active` captured;
   card unchanged.
3. **Confirm disables.** Click "Disable" → confirm.
   **Expected (IPC):** `sources_set_active` `{ rootId: <A>, active: false }`
   succeeds; list reloads; Root A's card gains the neutral "Disabled" pill and
   the disabled card styling; its action button now reads "Enable".
   [SCREENSHOT root-disabled]
4. **Disabled root is excluded from scan/ingest surfaces.** Navigate to the
   Inbox page.
   **Expected:** Root A no longer appears among scannable sources /
   "Rescan all" scope (record the concrete surface observed). Its historical
   data (sessions, inbox items) remains visible wherever history is shown —
   nothing deleted. DB spot-check (read-only): `registered_sources.active = 0`
   for A, and its `inbox_items`/`file_record` rows still present.
5. **Audit trail.** Check the bottom log panel / Audit Log pane.
   **Expected:** a `root.active_changed` audit event for step 3.
6. **Re-enable is immediate (no confirm).** Click "Enable" on Root A.
   **Expected (IPC):** `sources_set_active` `{ active: true }` fires directly
   — NO ConfirmOverlay (restorative action); pill disappears; button reads
   "Disable" again; a second `root.active_changed` audit event exists.

### Delete

7. **Delete only offered on offline roots.** Inspect Root A (online) and
   Root C (offline).
   **Expected:** A's card has NO Delete button; C's card shows the danger
   "Delete" button (and, being offline, no Rescan button).
8. **Delete confirm gate.** On C1 (offline WITH dependents) click "Delete".
   **Expected:** ConfirmOverlay — title "Delete this source?", description
   quoting the exact path: '"<path>" will no longer be tracked. Files on disk
   are never touched — this only removes the registration.', danger confirm
   "Delete" + Cancel. Cancel first: overlay closes, no `roots_delete`
   captured. [SCREENSHOT delete-confirm]
9. **Dependents BLOCK deletion (D8).** Reopen the dialog on C1 and confirm.
   **Expected (IPC):** `roots_delete` returns a `ContractError` with code
   `root.has_dependents` (dependency counts in `details`). **The dialog stays
   OPEN** and shows the catalog copy: "This source still has related records
   (sessions, plan items, or inbox items) and can't be deleted." — not a raw
   code, not a silent close. The root is still listed after closing.
   [SCREENSHOT delete-blocked]
10. **Dependent-free delete succeeds, files untouched.** On C2 (offline,
    never scanned) — or, if only one offline root exists, on Root B after
    taking it offline the same way — Delete → confirm.
    **Expected (IPC):** `roots_delete` success; card disappears from the
    list; `roots_list` no longer contains the root; a `root.deleted` audit
    event exists. From WSL, confirm the renamed folder on disk still exists
    with its contents (constitution I: registration removal only).
11. **Log check.** `read_logs`: no ERROR-level entries other than the typed,
    handled `root.has_dependents` rejection.

### Stage 1 verdict

- **PASS**: both actions confirm-gated exactly as specified; disable is a
  reversible visibility flag with intact history; blocked delete keeps the
  dialog open with catalog copy; successful delete removes only the
  registration; all four audit events observed (2× active_changed, attempted
  + succeeded delete trail per implementation).
- **FAIL** (fatal): STUB console messages; delete cascading/removing
  dependent rows; dialog silently closing on `root.has_dependents`; any
  mutation of on-disk folders; disable losing history.

## Stage 2 — Final Claude Desktop pass

1. **Danger-zone feel.** The two ConfirmOverlays read as deliberate,
   danger-styled gates; Disable vs Delete cannot be confused; the delete copy
   explicitly reassures files are never touched. Re-enable being instant (no
   confirm) feels right, not accidental.
2. **Disabled-state visuals.** The "Disabled" pill + muted card styling are
   obvious at a glance in BOTH themes checked; an offline+disabled card shows
   both pills without layout breakage.
3. **Copy/i18n.** All labels (Disable / Enable / Disabling… / Deleting… /
   Disabled pill / confirm titles+descriptions / `err_root_has_dependents`
   catalog message) are real English with the path interpolated — no raw
   keys, no `{path}` leakage.
4. **Layout + themes.** At 1100×720 the overlays center without clipping;
   the pane header stays fixed; card action rows do not wrap into overflow.
   Repeat [SCREENSHOT root-disabled] and [SCREENSHOT delete-blocked] in a
   second theme.
5. **Sign-off.** PASS requires all items PASS; report must list which roots
   were left disabled/deleted and confirm on-disk fixtures are intact.
