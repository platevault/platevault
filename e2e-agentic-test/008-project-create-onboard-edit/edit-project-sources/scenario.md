# Two-stage verification — Edit project: add/remove sources after creation

> Area: PROJECTS · Spec 008 (project-create-onboard-edit) · PR #394 (merged)
> Shared runner mechanics: see `e2e-agentic-test/AGENT-RUNNER.md`.
> Stage 1 MUST fully pass before Stage 2 is attempted.

## Change facts (context)

- Spec / feature: 008, FR-008 (single edit pane for fields + source mappings),
  FR-010 (channel drift flag after source additions), FR-011 (source remove
  allowed in `setup_incomplete|ready|blocked`, refused `lifecycle.read_only`
  otherwise), FR-012 (`project.source.add` requires a `confirmed` session,
  else `source.not_confirmed`).
- PR: #394 `feat: add or remove sources from an existing project` — MERGED.
- Frontend surface: `EditProjectPane`
  (`apps/desktop/src/features/projects/edit/EditProjectPane.tsx`), opened from
  a project's detail/edit affordance on `/projects`; session picker component
  `data-testid="session-source-picker"` (shared with the create flow).
- Commands: `projects_get`, `projects_update`, `projects_source_add`,
  `projects_source_remove` (remove takes `confirmLastSource: bool`),
  `sessions_list` (picker), `projects_channels_reinfer`,
  `projects_channels_dismiss_drift`.
- Exact English strings:
  - Add button: "Add sources"; picker-empty: "All sessions are already linked
    to this project."; selected CTA: "Add {count} selected".
  - Sources empty: "No sources linked yet."
  - Last-source inline confirm hint: "You can't remove the last confirmed
    source." (key `err_lifecycle_last_confirmed_source`; the row swaps its
    Remove button for an inline Confirm step when the backend answers
    `lifecycle.last_confirmed_source`).
  - Drift banner: "New sources were added since the last channel review."
  - Update errors: "Project not found." / "Tool cannot be changed in the
    current lifecycle state." / "This project is archived and cannot be
    edited." / "No fields were changed." / generic "Update failed ({code})."
- Behavior added by #394: sources are editable post-create (list with
  per-row Remove; "Add sources" opens the session picker pre-filtered to
  unlinked sessions; removing the LAST source requires an inline confirm).

## Preconditions — setup / reset + fixture recipe

1. Deploy `origin/redesign-ui-platevault` per AGENT-RUNNER.md (frontend-only
   PR, no Rust rebuild required for this scenario itself).
2. Fixture: you need a project with ≥2 linked confirmed sessions.
   a. Fresh DB; first-run setup registering: a Light-frames folder AND an
      Inbox folder AND a Projects folder.
   b. Copy real FITS fixtures into the Inbox folder (Windows checkout ships
      them): `Copy-Item 'C:\dev\astro-plan\tests\fixtures\mock-fits-library\light\poseidon-nina\*' 'C:\dev\astro-plan\test-data\inbox\' -Recurse`
      (two filters → two session groups). More can be generated with
      `python scripts\gen-mock-fits.py` if needed.
   c. In the app: Inbox → confirm/ingest the detected items (catalogue-in-
      place is fine) so Sessions shows ≥2 confirmed sessions.
   d. Create project `Edit Sources Test` via `/projects/new`, attaching ONE
      of the sessions during create (or none — attach in Test 1.1).
3. Window at 1100×720.

## Stage 1 — Agent validation via Tauri MCP

Connect per AGENT-RUNNER.md; `ipc_monitor` on. Real backend mandatory
(`VITE_USE_MOCKS=false`; confirm real `projects_get` traffic).

### Test 1.1 — Add a source to an existing project
1. Projects → select `Edit Sources Test` → open its Edit pane
   (aria-label "Edit project").
2. Click the button labeled "Add sources".
3. Expected: the session picker (`[data-testid="session-source-picker"]`)
   opens listing ONLY sessions not already linked (compare against
   `sessions_list` capture). Select one; click "Add 1 selected".
4. Expected:
   - `projects_source_add` captured with the chosen `inventoryId`/session ref
     and a success result; the pane's source list refetches
     (`projects_get`) and now shows the new row with a Remove action.
   - If the project previously had manually-overridden channels: drift banner
     "New sources were added since the last channel review." appears
     (FR-010); `projects_get` response carries
     `channelDrift.hasNewSources: true`. If channels were auto-inferred,
     record "banner not applicable" — not a FAIL.
   - Screenshot: `s1-source-added.png`.
5. FAIL if: picker lists already-linked sessions; add succeeds in UI without a
   captured `projects_source_add`; row does not appear; error toast.

### Test 1.2 — Reject unconfirmed sessions (FR-012) — IPC-level probe
The shipped UI only offers confirmed sessions, so drive the contract directly:
1. `webview_execute_js`:
   `window.__TAURI__.core.invoke('projects_source_add', { request: { projectId: '<id>', inventoryId: '00000000-0000-0000-0000-000000000000' } })`
   (use the real project id from `projects_get`; the nonexistent inventory id
   must be rejected — acceptable codes: `source.not_found` /
   `source.not_confirmed` family).
2. Expected: promise rejects with a ContractError carrying a typed `code`
   (NOT a panic, NOT a success). `read_logs` shows no backend panic.
3. FAIL if: the call succeeds, or the app crashes/logs a panic.
   NOTE: if the exact args shape differs, read it from the captured
   `projects_source_add` payload in Test 1.1 and reuse it.

### Test 1.3 — Remove a non-last source
1. In the Edit pane, click Remove on one of the (now ≥2) source rows.
2. Expected: `projects_source_remove` captured with
   `confirmLastSource: false`, success; row disappears; remaining count
   drops by one; NO confirmation step required.
3. FAIL if: an inline confirm appears for a non-last source, or removal
   silently fails.

### Test 1.4 — Last-source removal requires inline confirm
1. Remove sources until one remains, then click Remove on the last row.
2. Expected:
   - First call captured with `confirmLastSource: false` → error
     `lifecycle.last_confirmed_source`.
   - The row swaps to an inline confirm: hint text EXACTLY "You can't remove
     the last confirmed source." plus a Confirm button (and the working label
     while pending).
   - Clicking Confirm issues a second `projects_source_remove` with
     `confirmLastSource: true` → success; sources list shows "No sources
     linked yet."; project lifecycle returns to `setup_incomplete`
     (verify via `projects_get`).
   - Screenshot: `s1-last-source-confirm.png`.
3. FAIL if: the last source is removed on first click without the confirm
   round-trip; the hint text differs; lifecycle does not fall back to
   `setup_incomplete`.

### Test 1.5 — Read-only lifecycle refusal (FR-011)
1. Via bridge, force-check the contract: on a project in `setup_incomplete`
   this cannot be exercised through the UI, so this is IPC-level. If a
   `prepared|processing|completed|archived` project exists in this DB, open
   its Edit pane instead and attempt a removal; expect the mapped message
   "This project is archived and cannot be edited." (archived) or error code
   `lifecycle.read_only` in the captured response.
2. If no such project exists yet, mark SKIPPED with reason (it is covered by
   the archive-lifecycle scenario) — a SKIP here does not block Stage 2.

### Test 1.6 — Logs & layout
1. `read_logs`: no uncaught errors during 1.1–1.5.
2. 1100×720: the Edit pane's Save bar stays visible; only the pane content
   scrolls; "Save changes" button reachable with a long source list.
3. FAIL on console errors or a scrolled-away action bar.

Stage 1 verdict: PASS = 1.1, 1.3, 1.4, 1.6 pass and 1.2 shows a typed
rejection; 1.5 may be SKIPPED. Otherwise FAIL (report payloads/screenshots).

## Stage 2 — Final Claude Desktop pass (human judgment)

1. Walk add → remove → last-source confirm by eye; the inline confirm must be
   obviously tied to the row being removed (no ambiguity about which source).
2. Copy review: no raw codes on screen; picker empty-state ("All sessions are
   already linked to this project.") shows when everything is linked.
3. Error path: disconnect plausibility — with the picker open, add a source
   twice quickly; the second attempt must produce a clear message, not a
   duplicate row.
4. Themes: repeat 1.4's confirm state in `warm-clay` and `espresso-dark`;
   the destructive/confirm affordance must be visually distinct in both.
5. Layout at 1100×720: session picker fits without clipping; no horizontal
   scroll; drift banner (if shown) does not overlap the channels editor.
6. Sign-off with PASS/FAIL + screenshots.
