# Two-stage verification — FULL PROJECT LIFECYCLE JOURNEY
# create → attach data → manifests & notes → tool launch/outputs → cleanup → archive

> Area: PROJECTS capstone journey across specs 008 / 024 / 011 / 012 / 017.
> Shared runner mechanics: see `e2e-agentic-test/AGENT-RUNNER.md`.
> **PRECONDITIONS (convoy): requires PRs #392 #394 #400 #409 #401 (merged on
> `redesign-ui-platevault`) AND #396 (channel aggregation) AND #413 (cleanup
> review UI) AND #415 (Archive page polish + platform-native reveal labels)
> merged into the branch under test.** If any is missing, run only the
> per-feature scenarios instead and report this journey BLOCKED on the
> missing PR number(s).
> Stage 1 MUST fully pass before Stage 2.
>
> This journey deliberately re-uses the per-feature scenarios' deep checks by
> reference; here each phase asserts only its journey-critical outcomes, plus
> the CROSS-PHASE invariants that the per-feature scenarios cannot see
> (manifest history accumulating across phases, cleanup seeing the watcher's
> artifacts, archive seeing what cleanup left behind).

## Fixture recipe (one pass, from zero)

1. Deploy the convoy branch; Rust changed in #396 ⇒ apply the RECOMPILE TRAP
   (touch `crates/app/projects/src/project_setup.rs`, relaunch).
2. `Remove-Item 'C:\dev\astro-plan\wizard-test.db*' -Force`; launch; complete
   first-run setup registering: Lights folder, Inbox folder, Projects folder
   (throwaway dirs under `C:\dev\astro-plan\test-data\`).
3. Seed the Inbox folder with fixture lights covering 2 filters with KNOWN
   math, e.g. from `C:\dev\astro-plan\tests\fixtures\mock-fits-library\light\poseidon-nina\`
   (or generate exact counts with `python scripts\gen-mock-fits.py`); record
   frames × exposure per filter. Ingest/confirm via Inbox so ≥2 confirmed
   sessions exist.
4. Configure the processing tool's executable to
   `C:\Windows\System32\notepad.exe` in Settings.
5. Window 1100×720; real backend only (`VITE_USE_MOCKS=false` — mock mode is
   forbidden for the whole journey); `ipc_monitor` on for the whole run.

## Stage 1 — Agent validation via Tauri MCP

### Phase A — Create (spec 008 / PR #392)
1. `/projects/new`: first type the name of an EXISTING project if one exists
   (else skip); expect the inline duplicate alert ("A project with this name
   already exists.") — then use the real name `Journey M42`.
2. Pick the tool, attach ONE of the two sessions, create
   (`wizard-create-btn`).
3. Assert: `projects_create` success; success toast WITHOUT a "View plan"
   link; project listed; lifecycle `ready` (tool + confirmed source ⇒
   auto-`ready` per 008 FR-004; if it shows `setup_incomplete`, attach the
   source now and re-check).
4. Screenshot `j-a-created.png`.

### Phase B — Attach more data (PR #394) + channel truth (PR #396)
1. Edit pane → "Add sources" → add the second session
   (`projects_source_add` captured).
2. Project detail → Sources · Channels: each channel row shows real
   `subFrames` and formatted integration ("Xh"/"Xm", never "—" for populated
   channels); values match the fixture math AND the captured `projects_get`
   `channels[]` payload.
3. Cross-phase: Manifests accordion now contains ≥2 manifests — reason
   "Created" AND reason "Source change" (024 checkpoint history is
   accumulating).
4. Screenshot `j-b-channels.png`.

### Phase C — Manifests & notes (spec 024) + reveal rule
1. Notes: type `Journey notes — verify persistence.`; wait for the debounced
   `note_update`; saved indicator appears.
2. Manifest reveal: the manifest row's reveal control label MUST be
   "Show in File Explorer" (**FAIL on any generic "explorer"/"Reveal in OS"
   label**); clicking it captures `manifest_reveal_in_os` and opens Explorer.
3. Project detail action-bar reveal (`action-reveal`) label: same rule.
4. Screenshot `j-c-manifests-notes.png`.

### Phase D — Tool launch + observed outputs (specs 011/012)
1. Click `tool-launch-btn` ("Open in {tool}"): toast "Launched {tool}";
   captured `tools_launch` response has a `launch_id`; notepad process
   exists (kill it after); lifecycle UNCHANGED by the launch (011 FR-005).
2. With the project open, write into its output folder: 2 intermediate-like
   files, 1 `master_*.xisf`, 1 final image — rows appear in the Tool
   Launches accordion (per-project watcher, #400) with kinds + confidence.
3. Navigate away and back: a file written while closed is picked up by the
   reopen rescan.
4. Walk lifecycle forward via the action-bar transitions to `completed`
   (use the non-plan edges; any plan-required refusal on this path must show
   the plan-required info toast, not flip state).
5. Cross-phase: a lifecycle-transition manifest checkpoint is appended.
6. Screenshot `j-d-outputs.png`.

### Phase E — Cleanup (spec 017 / PR #413)
1. Cleanup section: BEFORE scan, no numbers. Click "Scan for cleanup
   candidates" → grouped preview (Intermediates/Masters/Finals) with
   "{size} reclaimable"; the candidates are exactly the Phase-D artifacts
   (cross-phase attribution check: watcher rows feed the scan).
2. Protected rows (master/final) are locked, not selectable.
3. Destination "Archive folder" (default) → "Generate cleanup plan" →
   review overlay: every item inspectable; protected items must be
   acknowledged before "Approve & apply" enables.
4. Approve & apply: live progress "Applying {applied} of {total}…" →
   "Cleanup plan applied."; intermediates physically moved under
   `.astro-plan-archive\<planId>\`; masters/finals per acknowledgement; a
   re-scan shows the applied candidates gone; a `cleanup_applied` manifest
   checkpoint is appended (cross-phase, 024 FR-001).
5. Screenshot `j-e-cleanup-applied.png`.

### Phase F — Archive (spec 017 WP-B / PRs #401/#415)
1. On the completed project, "Archive" transition alone is REFUSED with the
   plan-required toast (no silent flip).
2. Generate the archive plan (UI CTA if the convoy shipped one; else bridge:
   `invoke('archive_plan_generate', { projectId, title: null })`),
   acknowledge protected items, approve, apply to terminal success.
3. Assert: remaining project files moved under the archive folder;
   `projects_get` → `lifecycle: "archived"`; Edit pane shows "This project
   is archived. Settings are read-only.".
4. `/archive`: `Journey M42` listed with real audit history; D7/D14/D15
   ABSENCES hold (no Masters/Targets tabs, no Sessions tab, no enabled
   Restore control); "Unarchive" on the detail is refused plan-required.
5. Reveal button on Archive page: disabled, label "Show in File Explorer",
   tooltip "Reveal isn't available yet — the archive location isn't exposed
   by the backend."
6. Optional teardown: "Send to trash" the archive entry (Recycle Bin gains
   the plan folder), or leave state for Stage 2.
7. Screenshot `j-f-archived.png`.

### Journey-wide checks
1. `read_logs` at the end: zero panics, zero uncaught JS errors across all
   phases.
2. IPC ledger: the captured sequence contains, in order,
   `projects_create` → `projects_source_add` → `note_update` →
   `tools_launch` → artifact detections → `cleanup_scan` →
   `cleanup_plan_generate` → `plans_approve` → `plans_apply_real` →
   `archive_plan_generate` → `plans_approve` → `plans_apply_real` →
   `archive_list`. Save the capture with the report.
3. No mock traffic anywhere.

Stage 1 verdict rubric: PASS only if every phase's asserts hold AND the three
cross-phase invariants held (manifest history A→F, watcher→cleanup candidate
identity, cleanup/archive disk custody with zero lost files). Any lost or
silently-moved file, any absence violation (D7/D14/D15), or any generic
reveal label is an automatic journey FAIL — report which phase.

## Stage 2 — Final Claude Desktop pass (human judgment)

Run the SAME journey end-to-end by hand (fresh DB), without the bridge,
judging the experience:

1. Narrative coherence: at each phase, could a real astrophotographer predict
   what the next click does? Note any moment the app moved files or state
   without an explicit, understandable decision (constitution principle II —
   this is the sign-off's core question).
2. Copy quality across the journey: toasts, gates, confirmations, empty
   states — flag anything that leaks codes, jargon, or wrong OS idioms
   (reveal labels must be Windows-native everywhere encountered).
3. Progress + waiting states: creation, scan, apply, archive all give
   feedback; nothing feels hung.
4. Theme pass: run Phases E–F once in `warm-slate` and once in
   `observatory-dark` (theme switch mid-journey is allowed and should not
   break layout).
5. Layout: 1100×720 throughout; action bars pinned on every surface touched;
   only content scrolls; no horizontal scrollbars.
6. Final sign-off: PASS/FAIL per phase + overall, with screenshots; the
   journey is the release gate for the projects convoy — an overall FAIL
   blocks sign-off even if all per-feature scenarios passed.
