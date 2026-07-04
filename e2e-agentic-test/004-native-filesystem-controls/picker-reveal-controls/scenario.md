# Native filesystem controls — pickers, cancellation, reveal

> Two-stage verification plan. Runner mechanics: see
> `e2e-agentic-test/AGENT-RUNNER.md`. Stage 1 must fully PASS before Stage 2.

## Coverage

- Spec: `specs/004-native-filesystem-controls/spec.md` — FR-001/FR-002
  (source-root selection uses the OS-native DIRECTORY picker; files rejected
  by construction), FR-005 (Reveal uses a native reveal/open-location
  affordance), FR-006 (failed picker/reveal operations are logged), FR-008
  (picker cancellation is a graceful no-op, not an error), FR-010 (reveal
  failures emit BOTH a user-facing toast and a log entry), FR-014 (pickers
  remember the last-chosen directory).
- Surfaces: setup wizard Source Folders step, Settings → Data Sources
  "+ Add source folder" form (both use the shared `DirPicker`), and any
  visible "Show in File Explorer" affordance (OS-native label rule: Windows
  copy must read "Show in File Explorer", never generic "explorer").
- Backend commands: the dialog/reveal contract commands invoked by
  `DirPicker`/reveal (capture actual names via `ipc_get_captured` — assert the
  UI goes through the contract surface, not the ad-hoc
  `@tauri-apps/plugin-dialog` JS API; FR-007/FR-009).

## Preconditions and fixtures

- Branch: `redesign-ui-platevault` tip. Setup already completed once (run the
  `003-first-run-source-setup/wizard-fresh-db-journey` preconditions, or reuse
  its end state) so Settings → Data Sources lists at least one root.
- Real backend (`VITE_USE_MOCKS=false`). Launch with the bridge overlay.
  VITE_E2E may be on, but the tests below exercise the NATIVE picker paths —
  the E2E inputs are only a fallback for fixture setup.
- Fixture folder: `C:\dev\astro-plan\test-data\picker-target` (create via
  PowerShell `New-Item`).
- Window sized to 1100×720.

## Stage 1 — Agent validation via Tauri MCP

The native dialog itself cannot be driven by the bridge; Stage 1 therefore
asserts everything AROUND the dialog (IPC traffic, cancellation semantics,
logging) and leaves in-dialog interaction to Stage 2.

1. **Add-form picker goes through the contract command (FR-001/FR-009).**
   Navigate to Settings → Data Sources; click "+ Add source folder". Start
   `ipc_monitor`, then click the folder-picker button in the add form
   ("Folder" field). When the native dialog opens, press Escape (via real
   keyboard — the dialog is native; if the agent cannot key into it, ask the
   operator to cancel it once, or perform this step in Stage 2 and mark it
   DEFERRED).
   **Expected (IPC):** exactly one directory-picker command invocation is
   captured (a contracts-surface command, NOT a raw
   `plugin:dialog|open` call); its response encodes cancellation as a
   non-error outcome (FR-008). No error toast appears; the add form's path
   field remains unchanged; the form stays open. [SCREENSHOT picker-cancelled]
2. **Cancellation is not logged as failure (FR-006/FR-008).** `read_logs`
   after step 1.
   **Expected:** no ERROR/WARN entry for the cancelled picker.
3. **Reveal affordance uses native reveal (FR-005) and correct label.**
   Locate any "Show in File Explorer" control (e.g. on a source/root card or
   file detail surface; if none is reachable in this build, record
   NOT-PRESENT and skip 3–4).
   With `ipc_monitor` on, click it.
   **Expected (IPC):** a reveal contract command fires with an
   `entity_kind` from the closed enum (FR-013) and the target path; response
   is success. Windows File Explorer opens (verify via PowerShell
   `Get-Process explorer` window count or operator observation — else defer
   the window-open confirmation to Stage 2). Button label text is exactly
   "Show in File Explorer".
4. **Reveal failure path (FR-010).** Via `webview_execute_js`, invoke the
   reveal command directly with a path that does not exist
   (`C:\does-not-exist-e2e\nope`).
   **Expected:** the command returns a `ContractError` (not a crash); if
   triggered through a UI affordance the same failure shows a toast naming the
   path AND `read_logs` shows a corresponding log entry (both, per FR-010).
   Direct-invoke runs assert at minimum the typed error + log line.
5. **Last-chosen directory memory (FR-014) — IPC half.** Complete one real
   pick in the add form (operator assist or Stage 2 deferral): choose
   `C:\dev\astro-plan\test-data\picker-target`.
   **Expected (IPC):** the picker request carries a starting-directory hint on
   the NEXT invocation (open the picker again and inspect the captured request:
   it should reference the previously chosen directory / its `lastPathKind`
   persistence). Cancel the second dialog.
6. **Registration from picked path.** With the path from step 5 in the field,
   pick category "Raw" and click "Add".
   **Expected (IPC):** `roots_register` fires with the picked absolute path
   and category `raw`; the new root card renders in the Raw group after the
   list reloads. No mutation of the folder's contents (WSL: folder still
   empty).

### Stage 1 verdict

- **PASS**: all IPC assertions hold; cancellation is error-free and unlogged;
  reveal failure produces typed error + log (+ toast when UI-triggered);
  steps legitimately deferred to Stage 2 are marked DEFERRED, not skipped
  silently.
- **FAIL**: raw `plugin:dialog|open` traffic observed (FR-007 regression);
  cancellation surfaces an error; reveal failure is silent (missing toast or
  missing log); wrong reveal label (e.g. "Reveal in explorer").

## Stage 2 — Final Claude Desktop pass

1. **In-dialog behavior (FR-001/FR-002).** Open the picker from both surfaces
   (wizard card "Add folder"; Data Sources add form). Confirm it is the
   native Windows directory dialog, files are not selectable (directory
   picker), and picking a folder round-trips the exact path into the field.
2. **Last-chosen memory, human check (FR-014).** Pick a folder, reopen the
   picker: it opens in the last-chosen location, on both surfaces.
3. **Failure UX (FR-010).** Trigger the reveal-failure toast (e.g. reveal a
   root whose drive was disconnected, or accept the Stage-1 direct-invoke
   evidence if not reproducible via UI). Toast copy is human-readable English
   naming the path — no raw error code, no Paraglide key leakage.
4. **Layout + themes.** At 1100×720 the add form and its picker button are
   fully visible without scrolling the page bar; repeat in a second theme.
   [SCREENSHOT addform-theme-a / addform-theme-b]
5. **Sign-off.** PASS requires all items (including any Stage-1 DEFERRED
   items) confirmed. Record exact observed copy for every error/toast.
