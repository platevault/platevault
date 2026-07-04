# Two-stage verification — Manifests & notes, with OS-native reveal labels

> Area: PROJECTS · Spec 024 (project-manifests-and-notes) + reveal-label rule
> Shared runner mechanics: see `e2e-agentic-test/AGENT-RUNNER.md`.
> Stage 1 MUST fully pass before Stage 2.
>
> **PRECONDITION for the reveal-label tests (1.5): requires PR #415 merged**
> (`impl-043-polish-a`, the platform-native reveal-label sweep via shared
> `revealLabel()`). The manifests/notes functional tests (1.1–1.4) run on
> plain `redesign-ui-platevault` (spec 024 is shipped there).

## Change facts (context)

- Spec 024 FRs: FR-001 (manifest documents source mappings, calibration,
  workflow profile, source views, lifecycle state), FR-002 (manifests are
  generated documentation, not canonical truth), FR-003 (notes editable from
  project detail), FR-004 (note changes auditable), FR-005 (manifest exports
  record success/failure), FR-007 (manifests reference stable ids).
- Commands: `manifest_list`, `manifest_get`, `manifest_reveal_in_os`
  (`{ path }`), `note_get`, `note_update` (`{ projectId, content }` →
  `{ updatedAt }`).
- Manifest reasons rendered: created / source_change / lifecycle_transition /
  cleanup_applied / workflow_run; timestamps formatted `YYYY-MM-DD HH:MM` UTC.
- Notes: client cap 16 384 bytes (`MAX_NOTE_BYTES`), 5 000 ms debounce before
  `note_update`, byte counter + saved indicator.
- Testids (project detail bottom panel): `manifests-list`, `manifests-empty`,
  `manifests-error`, `manifests-loading`, `manifest-reveal-<manifestId>`;
  notes: `notes-textarea`, `notes-byte-counter`, `notes-saved-indicator`,
  `notes-field-error`, `notes-body`, `notes-empty`.
- **Reveal-label rule (USER RULE, explicit pass/fail):** every reveal
  affordance must use the platform-native label — on Windows EXACTLY
  **"Show in File Explorer"** (macOS: "Reveal in Finder", Linux: "Show in
  file manager"; catalog keys `reveal_label_windows|macos|linux`). A generic
  label containing "Explorer"-as-generic or "Reveal in OS" — specifically the
  legacy strings "Reveal in Explorer" (`projects_detail_reveal_btn`,
  `calibration_action_reveal_explorer`), "Reveal in file manager" used on
  Windows (`projects_manifests_reveal_title`), "Reveal in OS"
  (`sessions_reveal_btn`) — **is a FAIL**. PR #415 removed these keys and
  swept callers onto shared `revealLabel()`.

## Preconditions — setup / reset + fixture recipe

1. Deploy branch (see banner). Frontend-only for #415; spec 024 backend is
   already on base — no Rust rebuild unless the convoy branch says otherwise.
2. Fixture: a project with at least one manifest:
   a. Fresh DB → first-run setup (Lights + Inbox + Projects folders).
   b. Ingest fixture lights (`tests\fixtures\mock-fits-library\light\...`)
      via Inbox; create project `Manifest Test` with one source (creation
      writes the first manifest, reason `created`).
3. Window 1100×720; real backend only.

## Stage 1 — Agent validation via Tauri MCP

Connect per AGENT-RUNNER.md; `ipc_monitor` on.

### Test 1.1 — Manifest list renders real snapshots (FR-001/FR-002/FR-007)
1. Open `Manifest Test` detail → bottom panel → Manifests accordion.
2. Expected:
   - `manifest_list` captured with the project id; UI shows
     `[data-testid="manifests-list"]` with ≥1 row, reason label "Created",
     timestamp in `YYYY-MM-DD HH:MM` form.
   - Expanding a row issues `manifest_get`; the structured body references
     the project and source ids present in `projects_get` (stable ids,
     FR-007) and records lifecycle state.
   - Screenshot: `s1-manifests-list.png`.
3. FAIL if: list is empty despite a created project; `manifests-error`
   renders; body lacks source-mapping/lifecycle content.

### Test 1.2 — Manifest appended on lifecycle-relevant change (FR-001/FR-005)
1. Add or remove a project source (Edit pane), return to Manifests.
2. Expected: after refetch a NEW manifest row appears with reason
   "Source change" (`source_change`); the previous row is retained
   (checkpoint history, not overwrite).
3. FAIL if: no new manifest, or the old one was replaced in place.

### Test 1.3 — Notes edit, byte counter, debounce, persistence (FR-003/FR-004)
1. In the Notes section, type `Processing notes for M42 — round 1.` into
   `[data-testid="notes-textarea"]`.
2. Expected:
   - `notes-byte-counter` updates immediately; NO `note_update` is captured
     within the first ~4 s (debounce), then exactly one `note_update` fires
     with the full content; `notes-saved-indicator` appears with the saved
     state after the success response (`updatedAt`).
3. Restart the app (or hard-refresh), reopen the project.
4. Expected: `note_get` returns the saved content; textarea pre-filled.
5. FAIL if: an update fires per keystroke; content lost after restart; saved
   indicator shows without a captured successful `note_update`.

### Test 1.4 — Note size cap error path
1. Via `webview_execute_js`, set the textarea to a >16 384-byte string using
   the native value setter + `input` event (see AGENT-RUNNER.md React-input
   recipe).
2. Expected: `notes-field-error` renders (client-side), NO `note_update` is
   sent with oversized content; shrinking the text clears the error and
   re-enables saving.
3. FAIL if: oversized content reaches the backend or the error never shows.

### Test 1.5 — Reveal affordances: labels + command (REQUIRES PR #415)
1. Enumerate reveal controls via `webview_dom_snapshot`:
   a. Project detail action bar `[data-testid="action-reveal"]`.
   b. Manifest row `[data-testid="manifest-reveal-<id>"]` (+ its `title`).
2. Expected on Windows:
   - Every visible reveal label reads EXACTLY "Show in File Explorer".
   - **FAIL (explicit) if any reveal label reads "Reveal in Explorer",
     "Reveal in OS", "Reveal in file manager", or any other generic
     "explorer" phrasing.**
3. Click a manifest row's reveal control.
4. Expected: `manifest_reveal_in_os` captured with the manifest's `path`; a
   File Explorer window opens showing the manifest file (verify via
   screenshot / window enumeration); on failure an error message surfaces
   (fallback copy "Reveal failed.") rather than a silent no-op (FR-005
   spirit: outcomes recorded/surfaced).
5. Screenshot: `s1-reveal-labels.png`.

### Test 1.6 — Logs & layout
1. `read_logs`: no uncaught errors during 1.1–1.5.
2. 1100×720: bottom panel scrolls within the content area; the detail action
   bar stays pinned while scrolling the manifests/notes sections.

Stage 1 verdict: PASS = 1.1–1.4 and 1.6 green, and 1.5 green when #415 is
merged (if #415 is not yet merged, 1.5 must be reported as BLOCKED — not
skipped silently — and Stage 2 must not run for the reveal checks).

## Stage 2 — Final Claude Desktop pass (human judgment)

1. Read a manifest body as a user: is it comprehensible documentation
   (sources, calibration, lifecycle) rather than raw JSON dump? (FR-001/002)
2. Reveal UX: click "Show in File Explorer" and confirm Explorer opens with
   the manifest selected/visible — judge that the label matches what Windows
   users expect (OS-native naming rule).
3. Notes UX: typing feels unthrottled; the saved indicator is noticeable but
   not intrusive; the byte counter only alarms near the cap.
4. Error copy: trigger the oversized-note error and judge clarity.
5. Themes: manifests accordion + notes in `warm-clay` and `espresso-dark`;
   counter/error/saved states legible in both.
6. Layout 1100×720: accordion expansion does not push the action bar off
   screen; only content scrolls.
7. Sign-off PASS/FAIL + screenshots.
