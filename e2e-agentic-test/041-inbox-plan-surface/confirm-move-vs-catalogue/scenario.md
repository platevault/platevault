# 041 confirm — move vs catalogue-in-place, with on-disk assertions

> Two-stage verification plan. Stage 1: agent via Tauri MCP bridge; Stage 2:
> Claude Desktop human pass, only after Stage 1 passes.
> Runner mechanics: `../../AGENT-RUNNER.md`. Fixtures: `../FIXTURES.md`.

## Coverage

| Requirement | Assertion in this scenario |
|---|---|
| FR-017 / US4 | Organization state (not kind, not frame type) decides move vs catalogue |
| FR-018 / SC-007 | Catalogue-in-place: DB record, zero file movement (on-disk hash+location proof) |
| FR-027 / FR-028 / US8 | Inbox items MUST target a library root; non-inbox default is in-place |
| FR-029 / FR-030 | >1 valid root → forced picker; exactly 1 → auto-selected, no prompt |
| FR-031 | Full absolute destination path shown per action |
| FR-024 / FR-025 / FR-026 | Destination resolved from per-type patterns (`light: {target}/{filter}/{date}/light/`) |
| FR-005 / SC-001 | Files move only at Apply, never at confirm |
| FR-019b | Organization state is an explicit choice in the wizard source rows |

Convoy preconditions: none (on `redesign-ui-platevault`).

## Preconditions

1. Deploy `redesign-ui-platevault`; clean DB + fixtures.
2. Generate **RECIPE-MIXED** (inbox drop), **RECIPE-ORGANIZED**
   (`test-data\organized-lights\NGC 7000\Ha\2026-06-20\light\` with 2
   complete lights), and **RECIPE-DEST** (`test-data\library-lights`,
   empty).
3. Baseline for on-disk assertions (WSL):
   `find /mnt/c/dev/astro-plan/test-data -name '*.fits' | sort > $SCRATCH/tree-before.txt`
   and `sha256sum /mnt/c/dev/astro-plan/test-data/organized-lights/**/*.fits
   | sort > $SCRATCH/organized-hashes.txt`
   (`$SCRATCH` = the session scratchpad dir).
4. Launch with bridge + `VITE_E2E=1`; window 1100×720; real backend.
5. Wizard (this scenario also verifies FR-019b here): register
   - inbox root `test-data\inbox-drop` — Expected: the row shows **no**
     organization-state select (inbox is unorganized by definition);
   - light-frames root `test-data\library-lights` — the row's
     organization-state select is present and REQUIRED; choose
     **organized**;
   - light-frames root `test-data\organized-lights` — choose **organized**.
   FAIL (precondition-level) if a non-inbox row registers without an
   explicit organized/unorganized choice being visible.
6. Finish the wizard → `/inbox` → Rescan → select each folder row once so
   classification runs. Resolve any needs-review residue (there should be
   none with these recipes — if there is, STOP and report; the fixtures are
   designed to classify cleanly except darks' destination, below).

## Stage 1 — Agent validation via Tauri MCP

### Part A — inbox item ⇒ move plan into the chosen library root

1. **Confirm the `light · Ha · 300s` sub-item** (from `night1`): select it,
   click `[data-testid="inbox-confirm-btn"]`.
   - Expected: since TWO valid light destination roots are registered
     (`library-lights`, `organized-lights`), confirm blocks with the
     destination-root prompt (FR-029): toast "Choose a destination library
     root to generate the plan.", and the root picker
     `[data-testid="inbox-root-picker"]` with options
     `[data-testid="inbox-root-option-<rootId>"]` renders (in the plan
     panel / overlay area). No plan exists yet
     (`inbox_plan_list_open` unchanged).
   - IPC assertion: the `inbox_confirm` call rejected with code
     `inbox.destination_root_required` carrying `candidates[]` (paste it).
   - FAIL if: a plan is generated without the choice, or the picker never
     appears.
2. **Pick `library-lights`.** Click its root option.
   - Expected: re-confirm succeeds; toast "Plan created (2 items)…"; item
     state becomes `plan_open`; exactly one open plan for the item.
   - FAIL if: the pick is ignored or errors.
3. **Plan actions are moves with full absolute destinations (FR-031,
   FR-024–026).** Open the plan review (top-bar
   `[data-testid="inbox-review-plans-btn"]` → overlay
   `[data-testid="plan-approval-overlay"]` wrapping
   `[data-testid="plan-panel"]`). Expand the item's group
   (`[data-testid="plan-group-toggle-<itemId>"]`).
   - Expected: 2 move actions; each row's absolute destination
     (`[data-testid="inbox-dest-absolute-<rowIdx>"]`) starts with
     `C:\dev\astro-plan\test-data\library-lights\` and contains the
     pattern-resolved segments `NGC 7000`, `Ha`, a date, and `light`
     (default light pattern `{target}/{filter}/{date}/light/`). Record the
     exact paths — they are asserted on disk in step 5.
   - FAIL if: destinations are root-relative only, blank, in the source
     root, or missing pattern segments.
4. **No movement at confirm (SC-001).** WSL:
   `find /mnt/c/dev/astro-plan/test-data -name '*.fits' | sort` vs
   `tree-before.txt`.
   - Expected: identical — confirming created a plan only.
   - FAIL if: anything moved.
5. **Apply and assert on disk.** In the overlay click the item's
   `[data-testid="plan-apply-one-<itemId>"]`; wait for the progress
   (`[data-testid="plan-progress-<itemId>"]`) to finish and the toast
   "Plan applied.".
   - Expected on disk (WSL):
     - the two 300s light files now exist at EXACTLY the absolute
       destination paths recorded in step 3 (path-for-path);
     - they are GONE from
       `/mnt/c/dev/astro-plan/test-data/inbox-drop/night1/`;
     - their sha256 hashes equal the pre-move hashes (content preserved by
       the move).
   - Expected in app: the item leaves the queue (or shows applied); the
     plan disappears from `inbox_plan_list_open`.
   - FAIL if: files remain in the inbox folder, land at a different path,
     are duplicated (copy instead of move), or hashes differ.

### Part B — organized-root item ⇒ catalogue in place

6. **Confirm the organized-lights item.** In the inbox list select the item
   originating from the `organized-lights` root (cross-root inbox lists it;
   its row `organizationState` is `organized` — group by `orgState` if
   needed to find it). Click `[data-testid="inbox-confirm-btn"]`.
   - Expected: confirm succeeds directly with **no** destination-root
     prompt; the `inbox_confirm` response has
     `organizationState: "organized"` and `actionsSummary` with
     `moveCount: 0` and `catalogueCount: 2` (paste it).
   - FAIL if: a move plan is proposed for an organized source, or a root
     picker appears.
7. **Catalogue plan actions.** Open the plan review for this item.
   - Expected: 2 actions of catalogue-in-place kind (no source→destination
     move; destination equals the current location / action reads as
     catalogue), destructive controls untouched.
   - FAIL if: any action is a move.
8. **Apply catalogue plan; zero movement (FR-018/SC-007).** Apply the item's
   plan; after the applied toast, WSL:
   `sha256sum /mnt/c/dev/astro-plan/test-data/organized-lights/**/*.fits | sort`
   vs `organized-hashes.txt`, and `find … organized-lights -name '*.fits'`.
   - Expected: file set and hashes IDENTICAL — cataloguing recorded the
     files without touching disk; the item left the queue; sessions/library
     inventory now knows the files (visible on `/sessions` after
     derivation, or via `sessions_list` returning a session for
     2026-06-20 NGC 7000 Ha).
   - FAIL if: any file in the organized root moved, or no inventory/DB
     evidence of the catalogue exists.
9. **Kind does not decide (FR-017/FR-019 spot-check).** Confirm the
   `dark · 300s` inbox sub-item.
   - Expected: darks from the UNORGANIZED inbox get a MOVE plan too
     (uniform rule). With no registered calibration root, record the
     actual outcome: either a valid-destination error
     (`inbox.no_destination_root` — acceptable and expected with this
     setup; paste the code) or a move into a permitted root. Either way it
     must NOT be silently "added directly" without a plan.
   - FAIL if: the master/dark path bypasses the plan mechanism entirely.
10. **Log check.** `read_logs`: apply operations logged; no ERROR-level
    entries besides the expected structured refusals of steps 1 and 9.

Screenshot checkpoints: `S1-mvc-01` (root picker), `S1-mvc-02` (move plan
with absolute destinations), `S1-mvc-03` (catalogue plan), `S1-mvc-04`
(post-apply inbox).

### Stage 1 verdict

PASS = Parts A and B fully pass, including all three on-disk assertions
(steps 4, 5, 8). Otherwise FAIL with step, recorded paths, `find`/hash
diffs, and IPC payloads.

## Stage 2 — Final Claude Desktop pass

1. Redo Part A by hand (fresh fixtures or the 120s sub-item). Judge: is the
   forced root choice understandable — does the picker explain WHY you are
   choosing (FR-029), and does the wizard's organized/unorganized choice
   (precondition 5) explain its consequence (FR-019b: "explained, ideally
   with a flow diagram" — note if the explanation is missing or thin)?
2. Compare the two plan reviews (move vs catalogue). Judge: can a user tell
   at a glance that one will move files and the other will not?
3. Theme pass: plan overlay, root picker, and destination paths in
   **Warm Clay** and **Espresso**; long absolute paths must ellipsize or
   wrap without breaking layout at 1100×720.
4. i18n: toasts, picker labels, action labels are catalog strings.
5. Layout: the plan overlay is a focused overlay (content behind is
   inert/dimmed), its own action bar pinned, only the action list scrolls.
6. Sign-off: PASS/FAIL per point + screenshots (both themes). Overall PASS
   requires Stage 1 PASS and no unresolved defect.
