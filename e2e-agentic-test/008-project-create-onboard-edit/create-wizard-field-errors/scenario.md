# Two-stage verification — New-project wizard: per-field errors + live duplicate-name check

> Area: PROJECTS · Spec 008 (project-create-onboard-edit) · PR #392 (merged)
> Shared runner mechanics (bridge connection, launch/reset/deploy, screenshots):
> see `e2e-agentic-test/AGENT-RUNNER.md` — do not duplicate them here.
> Stage 1 MUST fully pass before Stage 2 is attempted.

## Change facts (context — you do not act on this section)

- Spec / feature: 008 project-create-onboard-edit, US1 (create), WP-008-B.
- PR: #392 `fix: surface per-field errors in the new-project wizard` — MERGED
  into `redesign-ui-platevault`. No extra "requires PR merged" precondition.
- Frontend only (no Rust changes).
- Surfaces: `/projects/new` (WizardPage), steps `step-name`, `step-sources`,
  `step-calibration`, `step-views`, `step-layout`, `step-review`;
  create button `wizard-create-btn`.
- Commands: `projects_list` (live duplicate pre-check), `projects_create`
  (submit). Error contract: `ContractError { code, message }` with codes
  `name.empty | name.too_long | name.duplicate | tool.unknown | path.invalid |
  path.collision`, mapped per-field by `projectCreateErrorField()`
  (`name.*`→ name step, `tool.*`→ name step's tool field, `path.*`→ review
  path row, anything else → general).
- User-facing English strings (exact, from `apps/desktop/messages/en.json`):
  - `name.duplicate` → "A project with this name already exists."
  - `name.empty` → "Project name is required."
  - `name.too_long` → "Project name is too long (max 120 characters)."
  - `tool.unknown` → "Unknown processing tool selected."
  - `path.invalid` → "Folder path is required."
  - `path.collision` → "Another project already uses this folder path."
  - generic fallback → "Could not create project ({code})."
- Behavior added by #392: (a) the wizard runs a case-insensitive duplicate-name
  pre-check against `projects_list` while typing on the Name step, before any
  submit; (b) submit failures render `role="alert"` text next to the field they
  belong to (name/tool errors on the Name step, path errors on the Review
  step), never one generic toast; (c) the post-create toast no longer has a
  "View plan" link (it pointed at the wrong page).
- Related spec FRs to cite in verdicts: FR-001 (functional labels), FR-002
  (single-form create semantics — the wizard collects name+tool as required),
  FR-003 (tool required at create), FR-004 (sources optional →
  `setup_incomplete`), FR-006 (failure MUST notify).

## Preconditions — setup / reset

1. Deploy: per AGENT-RUNNER.md, `git reset --hard origin/redesign-ui-platevault`
   on `C:\dev\astro-plan` (or the convoy integration branch under test).
   Frontend-only — no forced Rust rebuild needed.
2. Fixture recipe (needs at least ONE existing project so a duplicate name is
   possible):
   a. Fresh DB (`Remove-Item 'C:\dev\astro-plan\wizard-test.db*' -Force`),
      launch, complete first-run setup with a Light-frames folder and a
      Projects folder (empty throwaway dirs are fine — see AGENT-RUNNER.md).
   b. Navigate to **Projects** (left nav) → click the page's add/new-project
      action (navigates to `/projects/new`). On the Name step enter name
      `Alpha Test` and pick any available tool; click through remaining steps
      with defaults; click the create button (`wizard-create-btn`). Confirm a
      success toast and that `Alpha Test` appears in the Projects table.
3. Window at 1100×720 (AGENT-RUNNER.md `manage_window` step).

## Stage 1 — Agent validation via Tauri MCP

Connect per AGENT-RUNNER.md (`driver_session host=<NAT gateway> port=9223`),
then start IPC capture with `ipc_monitor` before Test 1. Mock mode is
FORBIDDEN: verify `.env` has `VITE_USE_MOCKS=false` and confirm via
`ipc_get_captured` that real `projects_list` traffic flows.

### Test 1.1 — Live duplicate-name pre-check (no submit involved)
1. Navigate to `/projects/new` (Projects page → new-project action).
2. `webview_find_element` the Name step (`[data-testid="step-name"]`).
3. Type `alpha test` (deliberately different case) into the project-name
   input.
4. Expected:
   - Within ~1s an inline `role="alert"` element appears under the name field
     with EXACT text "A project with this name already exists."
   - `ipc_get_captured` shows a `projects_list` invocation (the pre-check) and
     NO `projects_create` invocation.
   - Screenshot checkpoint: `s1-duplicate-precheck.png`.
5. FAIL if: no inline error; error only appears after clicking create; text
   differs; a toast is used instead of a field-adjacent alert; or a
   `projects_create` call was issued.

### Test 1.2 — Duplicate submit path still surfaces on the Name field
1. Clear the name, type `Alpha Test` quickly and advance steps to Review
   before the pre-check debounce fires (if the wizard blocks advancing while
   the inline error shows, record that as the equivalent PASS behavior and
   skip to Test 1.3).
2. Click `wizard-create-btn`.
3. Expected: `projects_create` is captured returning an error result with
   `code: "name.duplicate"`; the wizard routes back/points to the Name step
   with the same `role="alert"` message; NO generic "Could not create project"
   text; no project row is added (verify via a `projects_list` call returning
   exactly one `Alpha Test`).
4. FAIL if: a second project is created; error is a generic toast; error lands
   on the wrong step/field.

### Test 1.3 — Empty-name validation
1. Clear the name field, attempt to advance / create.
2. Expected: `role="alert"` with "Project name is required." attached to the
   name input (`aria-invalid="true"`, `aria-describedby="project-name-error"`),
   and NO `projects_create` IPC call for the empty submit.
3. FAIL if: submit reaches the backend with an empty name, or no field error.

### Test 1.4 — Successful create has no "View plan" link
1. Set name `Bravo Test`, keep the selected tool, continue to Review, click
   `wizard-create-btn`.
2. Expected:
   - `projects_create` captured with a success result; response contains the
     new project id.
   - A plain success toast appears; the toast contains NO link/button labeled
     "View plan" (assert via `webview_dom_snapshot` of the toast container).
   - App navigates to the Projects surface; `Bravo Test` is listed with
     lifecycle `setup_incomplete` (FR-004 — no sources attached yet).
   - Screenshot checkpoint: `s1-create-success.png`.
3. FAIL if: toast contains a "View plan" affordance; create silently fails;
   lifecycle is not `setup_incomplete`.

### Test 1.5 — Log & layout checks
1. `read_logs`: no uncaught JS errors / Rust panics during Tests 1.1–1.4.
2. At 1100×720 verify the wizard shell (`wizard-shell`): the step
   header/action bar stays pinned, only the step content scrolls
   (`.alm-page` conventions).
3. FAIL if: console errors attributable to the wizard, or the action bar
   scrolls out of view.

Stage 1 verdict rubric: PASS only if 1.1–1.5 all pass. Any FAIL blocks
Stage 2 and must be reported with the captured IPC payload + screenshot.

## Stage 2 — Final Claude Desktop pass (human judgment)

Only after Stage 1 passes. Visual/UX validation on the real Windows app:

1. Repeat Test 1.1 by eye: the duplicate warning must be legible, adjacent to
   the name field, and not cause layout shift that hides the Continue button.
2. Error copy review: all field errors read as complete sentences, no raw
   error codes visible anywhere except the generic fallback's "({code})".
3. i18n: switch app language (if a second locale is enabled) — field errors
   must come from the catalog, not hardcoded English.
4. Theme pass: repeat the duplicate + empty-name checks in one light theme
   (`warm-slate`) and one dark theme (`observatory-dark`); error text must
   meet contrast and the alert styling must be visibly error-colored in both.
5. Layout: 1100×720, confirm the wizard never shows a horizontal scrollbar
   and step navigation stays visible while a long error message renders.
6. Sign-off: record PASS/FAIL per item + screenshots; a Stage-2 FAIL reopens
   the lane even though Stage 1 passed.
