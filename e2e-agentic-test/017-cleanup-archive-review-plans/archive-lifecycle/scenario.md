# Two-stage verification — Archive lifecycle: plan-gated archive, Archive page, D7/D14/D15 absences

> Area: PROJECTS · Spec 017 WP-B + C5 reconciliation
> PRs: #401 (archive generator + Archive page, MERGED) · #415 (single-column
> Archive page + platform-native Reveal label, OPEN at authoring time).
> **PRECONDITION: Tests 1.5–1.7 (page layout, reveal label, testid
> `archive-reveal-btn`) require PR #415 merged.** Tests 1.1–1.4 and the
> absence assertions run on plain `redesign-ui-platevault` (#401 is merged).
> Shared runner mechanics: see `e2e-agentic-test/AGENT-RUNNER.md`.
> Stage 1 MUST fully pass before Stage 2.

## Change facts (context)

- Spec 017 FRs: FR-004 (permanent delete needs destructive warning + typed
  confirmation), FR-005 (plan state vocabulary), SC-002 (no permanent delete
  without warning). Deviation D24: archive plans move files to the
  app-managed archive folder (`.astro-plan-archive/<planId>/`) instead of
  017 FR-008's token-pattern destination (documented deviation, not a bug).
- C5 reconciliation: `archived` lifecycle is reachable ONLY as the terminal
  step of a successfully applied origin=archive plan; `archive_list` returns
  projects with `lifecycle='archived'` (+ `archivedViaPlanId`); history via
  the entity-filtered `audit_list` (decision D6).
- **Absence decisions this scenario MUST assert (verbatim ground truth):**
  - **D7** — "Archive UI scope = Project/Session/Plan only. Master and Target
    tabs DROPPED until a real archival lifecycle concept for them is
    designed". → the Archive page has NO "Masters" tab and NO "Targets" tab.
  - **D14** — "Archive page ships WITHOUT a sessions tab." (spec 041 deleted
    the session review-state machine; an archived-session concept must not be
    invented). → NO "Sessions" tab / no session rows on the Archive page.
  - **D15** — "Restore (un-archive) REQUIRES its own reviewable plan and is
    DEFERRED … The Restore button ships hidden/disabled until an un-archive
    generator exists." → NO enabled Restore control anywhere on the Archive
    page; the project detail's "Unarchive" transition must be refused with a
    plan-required response, never a silent lifecycle flip.
- Commands: `archive_plan_generate` (`{ projectId, title }`), `plans_get`,
  `plan_protection_check_cmd`, `protection_plan_acknowledged`,
  `plans_approve`, `plans_apply_real`, `plans_apply_status`, `archive_list`,
  `archive_send_to_trash`, `archive_permanently_delete`, `audit_list`
  (entityType `project`), `lifecycle_transition_apply`.
- KNOWN UI GAP (record, don't fail on it): no shipped UI button calls
  `archive_plan_generate` yet — the project detail's "Archive" transition on
  a `completed` project returns plan-required and shows the info toast
  "A filesystem plan is required before this transition. Create or approve a
  plan first." Stage 1 therefore drives generation over the bridge.
- Archive page (`/archive`): search "Search archive…"; empty state
  "No archived projects yet" / "Projects appear here after they're
  archived."; actions "Send to trash", "Delete permanently" (typed
  confirmation: title "Delete permanently", body "This permanently deletes
  the archived files for {name}. Type DELETE to confirm — this cannot be
  undone.", input aria "Type DELETE to confirm", literal `DELETE`).
  With #415: full-width sortable table (Name · Type · Reason · Size ·
  Archived), detail docked below, top-bar actions, Reveal button DISABLED
  with title "Reveal isn't available yet — the archive location isn't
  exposed by the backend." and platform-native label
  ("Show in File Explorer" on Windows).

## Preconditions — setup / reset + fixture recipe

1. Deploy branch per banner. #401's Rust is on base; if deploying a convoy
   branch with Rust changes, apply the RECOMPILE TRAP (AGENT-RUNNER.md).
2. Fixture — a completable project with observed files:
   a. Fresh DB → setup → ingest fixture lights → create `Archive Test` with
      one source; write 2–3 output files into its output folder while open
      (watcher records them; include one master so a protected item exists).
   b. Walk the lifecycle to `completed` via the detail action-bar transition
      buttons (`transition-btn-*`): ready → prepared/processing → completed
      (transitions that demand a plan on this path are exercised in other
      scenarios; use the non-plan edges available in the UI).
3. Window 1100×720; real backend only; `ipc_monitor` on.

## Stage 1 — Agent validation via Tauri MCP

### Test 1.1 — Archive transition is plan-gated (no silent flip)
1. On `Archive Test` (completed), click the action-bar button "Archive"
   (`transition-btn-archived`).
2. Expected: captured `lifecycle_transition_apply` returns a plan-required
   error; info toast with EXACT text "A filesystem plan is required before
   this transition. Create or approve a plan first."; `projects_get` still
   reports `completed`.
3. FAIL if: lifecycle flips to archived without a plan.

### Test 1.2 — Generate + apply the archive plan (bridge-driven; UI gap noted)
1. `webview_execute_js`:
   `window.__TAURI__.core.invoke('archive_plan_generate', { projectId: '<id>', title: null })`
   → record the returned plan id.
2. `plans_get` the plan: items MUST cover the project's observed files
   (cross-check against `artifact_list`), each with action/source/protection;
   protected items require acknowledgement
   (`plan_protection_check_cmd` / `protection_plan_acknowledged`) before
   approve.
3. Approve + apply via the same command sequence as the cleanup scenario
   (`plans_approve` token → `plans_apply_real`; poll `plans_apply_status`
   to terminal success).
4. Expected:
   - Files physically moved under the archive destination
     `...\.astro-plan-archive\<planId>\...` (verify ≥1 source path gone and
     present under the archive folder); nothing deleted.
   - `projects_get` now reports `lifecycle: "archived"` — the ONE legitimate
     path to archived (C5).
   - The Edit pane for the project shows the read-only notice "This project
     is archived. Settings are read-only." (spec 008 FR-011 tie-in).
   - Screenshot: `s1-archived-state.png`.
5. FAIL if: apply succeeds but lifecycle stays non-archived (the C5 bridge
   is the point of this test); files vanish; approve works without
   acknowledging protected items.

### Test 1.3 — Archive page lists the archived project + real history
1. Navigate to `/archive`.
2. Expected: `archive_list` captured; `Archive Test` appears with its
   archived date/size/reason; selecting it loads details and an "Audit
   history" section fed by captured `audit_list`
   (`entityType: "project"`, the project's id) with real events (creation,
   transitions, archive apply) — no placeholder/fixture rows.
3. FAIL if: empty page despite an archived project; history is fabricated or
   absent.

### Test 1.4 — D7/D14/D15 absence assertions (explicit pass/fail)
1. `webview_dom_snapshot` the whole Archive page.
2. Expected — ALL of these must be ABSENT:
   - **(D7)** any tab/section/filter labeled "Masters" or "Targets";
   - **(D14)** any tab/section labeled "Sessions" or any session-typed rows;
   - **(D15)** any ENABLED control labeled "Restore", "Restore project",
     "Restore session", "Restore master", or "Unarchive" (the i18n catalog
     still contains `archive_restore_*` keys — presence of an enabled
     control using them is the failure signal; a hidden/disabled stub is
     acceptable per D15).
3. Back on the archived project's detail (`/projects` → `Archive Test`):
   click "Unarchive" (and "Unarchive & resume" if present).
4. Expected: refused with the plan-required toast; lifecycle stays
   `archived` (D15 — restore requires its own reviewable plan; no generator
   exists yet).
5. Screenshot: `s1-d7-d14-d15-absences.png`.
6. FAIL if: any of the three surfaces exists/functions — this would be
   silent product-scope invention, the exact thing D7/D14/D15 forbid.

### Test 1.5 — Send to trash (REQUIRES #415 for exact layout; action is #401)
1. Select `Archive Test` on the Archive page; click "Send to trash".
2. Expected: captured `archive_send_to_trash` keyed by the entry /
   `archivedViaPlanId`; the archive folder contents for that plan move to
   the OS Recycle Bin (verify the folder is gone from
   `.astro-plan-archive\<planId>` and the Recycle Bin gained items); the
   list refreshes. Button must be disabled when `archivedViaPlanId` is
   absent.
3. FAIL if: permanent deletion happened instead; entry remains actionable
   twice; disk state ambiguous.

### Test 1.6 — Delete permanently requires typed DELETE (FR-004/SC-002)
1. Re-create an archived fixture if needed (repeat 1.2 with a new project,
   e.g. `Archive Test 2`).
2. Click "Delete permanently".
3. Expected:
   - Modal titled "Delete permanently" with body "This permanently deletes
     the archived files for {name}. Type DELETE to confirm — this cannot be
     undone." and a text input (aria "Type DELETE to confirm").
   - The confirm button stays DISABLED for empty input, for `delete`
     (lowercase), and for a truncated token (all but the last letter); it
     enables ONLY for exact `DELETE`.
   - Cancel is a no-op (files intact).
   - Confirming captures `archive_permanently_delete` and removes the
     archived files from disk (gone, NOT in Recycle Bin).
   - Screenshot: `s1-delete-confirm.png`.
4. FAIL if: deletion possible without the exact typed token; cancel deletes;
   wrong copy.

### Test 1.7 — Reveal button: disabled + platform-native label (REQUIRES #415)
1. Inspect `[data-testid="archive-reveal-btn"]`.
2. Expected: DISABLED, `title` EXACTLY "Reveal isn't available yet — the
   archive location isn't exposed by the backend.", label EXACTLY
   "Show in File Explorer" (Windows).
   **FAIL (explicit) if the label is "Reveal in Explorer" or any other
   generic "explorer" phrasing, or if the button is enabled but does
   nothing** (the pre-#415 bug).

### Test 1.8 — Logs & layout
1. `read_logs`: no panics/uncaught errors across all tests.
2. 1100×720 (with #415): single-column layout — top action bar always
   visible; table + docked detail scroll as content; sortable headers expose
   `aria-sort`.

Stage 1 verdict: PASS = 1.1–1.4, 1.6, 1.8 green, plus 1.5/1.7 green when
#415 is merged (else report them BLOCKED, not skipped). Any D7/D14/D15
presence, silent lifecycle flip, or delete-without-token is an automatic
FAIL and stops the campaign.

## Stage 2 — Final Claude Desktop pass (human judgment)

1. Walk archive → list → trash/delete as a user; judge that at no point can
   files be lost without an explicit, comprehensible decision.
2. Delete-confirmation friction: typing DELETE must feel deliberate, not
   bureaucratic; copy names the project being deleted.
3. Absence review: scan the Archive page visually for any affordance that
   implies sessions/masters/targets archival or restore — flag even
   misleading copy (D7/D14/D15 are product decisions, not just DOM checks).
4. Reveal button: disabled state must look intentionally disabled (tooltip
   discoverable), not broken.
5. Themes: Archive table, detail dock, and the danger modal in `warm-clay`
   and `observatory-dark`; danger styling must read as danger in both.
6. Layout 1100×720: no horizontal scroll; action bar pinned; detail dock
   does not push actions off-screen.
7. Sign-off PASS/FAIL + screenshots.
