# Two-stage verification — Cleanup: scan → review → apply with live progress

> Area: PROJECTS · Spec 017 (cleanup-archive-review-plans), WP-E review UI
> PR #413 (OPEN at authoring time) — **PRECONDITION: requires PR #413 merged**
> (`impl-017-cleanup-review-ui`). If the project detail's Cleanup section has
> no "Scan for cleanup candidates" button, STOP and report "blocked on #413".
> Shared runner mechanics: see `e2e-agentic-test/AGENT-RUNNER.md`.
> Stage 1 MUST fully pass before Stage 2.

## Change facts (context)

- Spec 017 FRs/SCs: FR-001 (plans are explicit review objects), FR-002 (plan
  generation read-only), FR-003 (items show action, source path, destination,
  protection), FR-014 (approve refused for zero-item plans), FR-016
  (destructive destination choice), SC-001 (every mutation inspectable before
  apply), SC-002 (no permanent delete without warning). Two-step generation
  per decision D11: `cleanup_scan` (read-only preview, NO plan row) then
  `cleanup_plan_generate` (creates the reviewable plan). Progress UI merged
  from spec 025 per D17.
- Commands: `cleanup_scan`, `cleanup_policy_get`, `cleanup_plan_generate`,
  `plans_get`, `plan_protection_check_cmd`, `protection_plan_acknowledged`,
  `plans_approve` (returns a one-time token), `plans_apply_real`,
  `plans_apply_status`, `plans_discard`.
- Testids: `cleanup-scan-btn`, `cleanup-generate-btn`, `cleanup-reclaimable`,
  `cleanup-protected`, `project-cleanup-preview`, `project-outputs`;
  overlay: `plan-review-overlay`, `plan-review-items`,
  `plan-review-approve-apply`, `plan-review-progress`.
- Exact English strings (from the PR branch's `en.json`):
  - Scan CTA: "Scan for cleanup candidates" · busy "Scanning…"
  - Prompt: "Scan this project to preview cleanup candidates. Scanning is
    read-only — nothing is removed without explicit plan approval."
  - Empty: "No cleanup candidates" / "The cleanup policy keeps every data
    type, or no processing artifacts have been observed for this project."
  - Groups: "Intermediates" / "Masters" / "Finals"; per-group
    "{size} reclaimable"; columns File · Size · Confidence · Protection.
  - Protected row hint: "Protected — requires explicit acknowledgement during
    plan review before it can be applied".
  - Destination radio: "Destructive destination" — "Archive folder"
    ("App-managed archive folder — reversible until you empty it") vs
    "System trash" ("OS-native recycle bin / trash").
  - Generate CTA: "Generate cleanup plan" · busy "Generating…" · failure
    "Could not generate the cleanup plan."
  - Overlay: title "Review cleanup plan"; note "Nothing has been changed on
    disk. Review every proposed item below; applying requires explicit
    approval."; "Requires {size} at the destination."; buttons
    "Approve & apply" / "Discard plan"; progress
    "Applying {applied} of {total}…"; toasts "Cleanup plan applied." /
    "Plan discarded." / failure "Plan apply failed.".
  - Protection gate: "Review and acknowledge each protected item below before
    running the plan."
- Frontend-only PR (no Rust changes) — backend generators shipped earlier
  (#401 convoy); no forced rebuild for #413 itself.

## Preconditions — setup / reset + fixture recipe

1. Deploy the post-merge branch per AGENT-RUNNER.md.
2. Fixture — a project with observed artifacts of mixed kinds:
   a. Fresh DB → setup → ingest fixture lights → create project
      `Cleanup Test` with one source.
   b. With the project open, write output files into its output folder so the
      watcher records them (see the 012 scenario): at least
      2 intermediate-classified files (e.g. `r_light_001_c.xisf`), 1
      master-classified (`master_flat_Ha.xisf`), 1 final
      (`M42_final.jpg`) — exact classification depends on workflow-profile
      rules; verify each row's kind via `artifact_list` and adjust names
      until you have ≥1 protected (master/final) and ≥1 unprotected
      (intermediate) candidate.
3. Window 1100×720; real backend only (mock mode would fabricate candidates
   and MUST NOT be used); `ipc_monitor` on.

## Stage 1 — Agent validation via Tauri MCP

### Test 1.1 — Scan is on-demand and read-only (D11, FR-002)
1. Open `Cleanup Test` → bottom panel → Cleanup section.
2. Expected BEFORE scanning: the teaching prompt (exact copy above) and the
   "Scan for cleanup candidates" button; NO candidate numbers anywhere (the
   section never invents data).
3. Click `cleanup-scan-btn`.
4. Expected:
   - Captured `cleanup_scan` request/response; NO `cleanup_plan_generate`,
     NO plans_* call, and `plans_list` (invoke via bridge) shows NO new plan
     row (scan creates no plan — D11).
   - Grouped preview renders (`project-cleanup-preview`): groups from
     {Intermediates, Masters, Finals} with per-file confidence and
     protection, per-group "{size} reclaimable" and a total
     (`cleanup-reclaimable`).
   - Filesystem untouched: every fixture output file still on disk,
     mtime unchanged.
   - Screenshot: `s1-scan-preview.png`.
5. FAIL if: numbers shown without a scan; scan mutates disk; a plan row
   appears; groups/confidence/protection missing.

### Test 1.2 — Protected candidates are marked and not selectable
1. Locate a protected row (master/final) in the preview.
2. Expected: lock marker + warning highlight (`cleanup-protected`), hint
   title "Protected — requires explicit acknowledgement during plan review
   before it can be applied"; the row exposes NO selection checkbox/toggle
   (protected items enter plans only via policy).
3. FAIL if: protected rows are selectable or unmarked.

### Test 1.3 — Destination choice fixed at generate time (FR-016, D24)
1. In the "Destructive destination" radio, verify both options with their
   hints (Archive folder default; System trash).
2. Select "Archive folder"; click `cleanup-generate-btn`
   ("Generate cleanup plan").
3. Expected: captured `cleanup_plan_generate` carries the destination; a
   plan id returns; the review overlay opens showing the destination
   READ-ONLY (no destination editing inside the overlay — it was fixed at
   generate time per the shipped contract).
4. FAIL if: no destination in the request; overlay lets you change it.

### Test 1.4 — Review overlay: full inspectability (FR-001/FR-003/SC-001)
1. In `plan-review-overlay`, snapshot `plan-review-items`.
2. Expected:
   - Title "Review cleanup plan"; the no-mutation note (exact copy above);
     "Requires {size} at the destination." when bytes are known.
   - Every item row shows Item · Action · Source path · Protection, matching
     the captured `plans_get` payload 1:1 (same count, same paths).
   - Protection gate: with ≥1 protected item in the plan, the gate text
     "Review and acknowledge each protected item below before running the
     plan." renders and **"Approve & apply" is DISABLED** until each
     protected item is individually acknowledged
     (`protection_plan_acknowledged` captured per acknowledgement).
   - Filesystem still untouched.
   - Screenshot: `s1-review-overlay.png`.
3. FAIL if: any plan item is not inspectable; approve enabled before all
   acknowledgements; UI count ≠ `plans_get` count.

### Test 1.5 — Discard path (FR-013 vocabulary)
1. Click "Discard plan".
2. Expected: `plans_discard` captured; toast "Plan discarded."; overlay
   closes; disk untouched; re-scanning still works.
3. FAIL if: discard applies anything or wedges the section.

### Test 1.6 — Approve & apply with live progress (D17)
1. Re-generate a plan (repeat 1.3), acknowledge protected items, click
   "Approve & apply".
2. Expected:
   - Captured sequence: `plans_approve` (response carries the one-time
     token) → `plans_apply_real` (consuming that token) → progress via
     `plans_apply_status` polling or apply events feeding
     `plan-review-progress` with "Applying {applied} of {total}…" and a
     terminal done state; success toast "Cleanup plan applied.".
   - On disk: each unprotected+acknowledged-protected item's file MOVED to
     the app-managed archive folder (`.astro-plan-archive\<planId>\...` under
     the archive destination) — verify at least one source path no longer
     exists and its file exists under the archive folder; NO file was
     permanently deleted (SC-002; destination was Archive folder).
   - `cleanup_scan` re-run afterwards shows those candidates gone.
   - Audit/log records per item outcome (FR-006 of 017 / `read_logs`).
   - Screenshot: `s1-apply-progress.png` (captured DURING apply if timing
     allows, else the terminal state).
3. FAIL if: apply proceeds without the approve token; progress never
   renders; files deleted instead of archived; leftover ambiguous state
   (item neither at source nor archive).

### Test 1.7 — Empty plan cannot be approved (FR-014)
1. On a project with NO candidates (fresh project without outputs), scan →
   expected empty state ("No cleanup candidates" + desc). If the UI offers
   generate anyway, generating an empty plan must yield an overlay whose
   "Approve & apply" is refused/disabled (backend refuses zero-item
   approve). Record which layer enforced it.
2. FAIL if: an empty plan can be approved.

### Test 1.8 — Logs & layout
1. `read_logs`: no panics/uncaught errors.
2. 1100×720: overlay is a focused layer over the detail; underlying action
   bar not interactable while open; overlay content scrolls, its own action
   row stays visible.

Stage 1 verdict: PASS = 1.1–1.6 and 1.8 green; 1.7 green or explicitly
refused at backend with evidence. Any disk-state anomaly is an automatic
FAIL + immediate stop (constitution principle II).

## Stage 2 — Final Claude Desktop pass (human judgment)

1. Trust walk: as a user, run scan → review → apply and judge at every step
   whether you always knew what WOULD happen vs what HAD happened (the
   product's core safety promise).
2. Protected-file comprehension: is it obvious why a master is locked, and
   what acknowledging means?
3. Destination comprehension: archive-vs-trash copy is unambiguous;
   reversibility hint reads correctly.
4. Progress feel: live counter updates visibly for multi-item plans; terminal
   success/failure states unmistakable.
5. Error path: judge "Plan apply failed." presentation if reproducible (e.g.
   lock a candidate file with an open handle and apply).
6. Themes: preview groups + overlay + progress in `warm-slate` and
   `espresso-dark`; the danger/warning colors must survive both.
7. Layout 1100×720: overlay fits; no clipped buttons; only content scrolls.
8. Sign-off PASS/FAIL + screenshots.
