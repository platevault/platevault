# PlateVault user-journey validation run — 2026-07-14

Driven against the real Windows dev app via the Tauri MCP bridge, origin/main @ commit 7e522c16, validating `docs/product/user-journeys.md` Journeys 1–17.

## Summary

| Journey | Verdict | Steps (P/F/PA/S) | Issues filed | Notes |
|---------|---------|------------------|--------------|-------|
| 1. First-run setup → data sources | PARTIAL | 11P/6F/1PA/1S | #704, #707 | 6-step wizard (Observing Site added); Project required not optional; partial-commit + remap-verify bugs; #557 infinite-render observed |
| 2. Ingest → review/reclassify → confirm (move) | PARTIAL | 7P/6F/3PA/2S | #711, #724, #765, #766, #767 | needs-review gate works; reclassify sentinel bug #724 blocks confirm; cross-root move lands wrong #765; zero audit rows #766; plan-review overlay stuck #767 |
| 3. Ingest → confirm (catalogue-in-place) | PARTIAL | 3P/1F/1PA/0S | #768, #769 | catalogue plan structure valid; destination-root picker shown wrongly #768; approval-token missing #769 blocks apply; zero audit rows #766 reproduces |
| 4. Sessions review (derived) | PARTIAL | 6P/6F/1PA/2S | #770, #771, #772, #773 | filter/camera dropdowns + grouping work; unresolved values indistinguishable #770; detail Escape fails #771; no calibration field #772; no notes field #773; sessionKey parse bug #564 |
| 5. Project lifecycle: create → artifacts | PARTIAL | 2P/0F/4PA/0S | #775, #776, #778, #780 | create+mkdir+lifecycle work; integration always 0s #775; manifests never generated #665; artifact tracking broken #780; tool workdir \\?\ path fails #778 |
| J1-5 UX diff-check | PASS | 6P/0F | #783 | 6 surfaces audited; Inbox render-loop recovers; Sessions/Projects/Edit surfaces clean except documented dupes |
| 6. Cleanup: scan → review → apply | PARTIAL | 2P/1F/1PA/0S | #804, #806, #807 | scan/UI fully works; protected-item ack cosmetic #807; default-protected fails apply unconditionally; zero audit #766 reproduces |
| 7. Archive → delete from archive | PARTIAL | 2P/0F/2PA/3S | | plan-generation wired; archive page clean; 0-item plan from #780; empty plan no reason #603 |
| 8. Calibration: ingest → masters → matching | PARTIAL | 2P/1F/2PA/0S | | masters register+ingest work; fingerprint extraction fails #620; matching blocked #664; tolerances dont persist #639; 0 audit #766 |
| 9. Targets & planning (real vs. stub) | PARTIAL | 3P/0F/2PA/0S | #815, #816 | logic correct; detail+modal overflow clips controls #815
| 10. Settings, appearance, and i18n | PARTIAL | 8P/5F/2PA/0S | #820, #822, #823, #825, #827 | theme persists; naming/resolution/altitude dont persist; unhandled validation #825; #794 contradiction flagged
| 11. Mistake recovery | PARTIAL | 1P/2F/0PA/1S | | plan-discard works; bulk-override has NO warning #611; calibration un-assign blocked #664
| 12. Failure | 12. Failure & refusal handling | ⏳ pending | | | | refusal handling | PARTIAL | 0P/3F/2PA/0S | #829, #830 | SAFETY: plan approval never snapshots FS #829 (CAS check dead code); partial fail silently succeeds; refusals not surfaced at control
| 13. Audit & activity investigation | PARTIAL | 4P/2F/3PA/0S | #831, #832, #833 | HEADLINE: 10 successful plan-applies produce ZERO durable audit rows (#766/#647); Activity shows sequences live then disappears
| 14. Target-first project start | ⏳ pending | | | |
| 15. Equipment & observing-site setup | ⏳ pending | | | |
| 16. Keyboard-first navigation & windows | ⏳ pending | | | |
| 17. Software update & install | ⏳ pending | | | |

## Per-journey detail

### Journey 1 — First-run setup → data sources

**Verdict:** PARTIAL
**Steps:** 11 PASS / 6 FAIL / 1 PARTIAL / 1 SKIPPED
**Issues filed:** #704 (backend — restart-first-run stuck on Confirm with misleading "Batch registration failed" banner while partial writes silently commit), #707 (backend — roots.remap.apply ignores the verified flag and applies an unverified remap unconditionally)

**Dupes hit (not re-filed):** #501, #502, #512, #515, #557, #559, #560, #646, #662

**Key evidence:** DB `registered_sources` = exactly 5 roots with correct kind+organization_state; `first_run_state`=complete; `settings.observingSites` has "Home Backyard" (52.0907, 5.1214, Europe/Amsterdam) default+active; #707 repro'd path change darks→lights\5 via verified:false then reverted; #704 repro'd via DOM "Batch registration failed" + DB row diff proving silent partial commit; screenshots at scratchpad/shots/j1-*.png.

**Doc-drift / unexpected-but-intended:**
- Wizard is 6 steps, not 5 — a new "Observing Site" step (map picker + Name/Lat/Lon/Elevation/Timezone/Night-def/Horizon; code apps/desktop/src/features/setup/steps/StepSite.tsx) inserted after Configuration. Executor configured it (adapted).
- "Projects" is a REQUIRED category (REQUIRED_KINDS=['light_frames','project'] at apps/desktop/src/features/setup/sources-store.ts:32), not optional as the doc states.

**JOURNEY-DOC UPDATE:** Journey 1 (cross-ref Journey 15) must document the 6-step wizard incl. the Observing Site step, and correct "Calibration, Project outputs, and Inbox (all optional)" — Project outputs is required alongside Light frames.

**App-state left for later journeys:** 5 roots registered+scanned — lights\1 (light_frames, organized), lights\2 (light_frames, unorganized), darks (calibration, unorganized), pv-projects (project, organized), inbox (inbox, unorganized); first-run complete; Inbox shows 7 pending items; site "Home Backyard" active. WARNING: known #557 Inbox infinite-render-loop reproduced live ~28min (stopped on navigate-away).

### Journey 2 — Ingest → review/reclassify → confirm (move mode)

**Verdict:** PARTIAL
**Steps:** 7 PASS / 6 FAIL / 3 PARTIAL / 2 SKIPPED
**Issues filed:** #711 (UI/backend — list-row badge disagrees with detail/inbox_classify, both directions), #724 (backend — reclassify never clears the __needs_review__ sentinel, so Confirm is permanently blocked even after full resolution), #765 (backend — cross-root inbox move silently lands under the SOURCE root, not the picked destination, yet apply reports success), #766 (backend — inbox plan-apply writes ZERO audit_log_entry rows), #767 (UI — Review-plans overlay stuck open+empty after Apply-all; Escape/X/backdrop all fail)

**Dupes hit (not re-filed):** #644, #549, #550, #552, #569, #605, #606, #643, #647, #715

**Key evidence:** direct IPC inbox_confirm on a fully-reclassified item (inbox_classify → single_type/dark/unclassifiedFiles:[]) still returns inbox.missing_path_attributes (root cause: confirm gates on stale group_key sentinel per test t070; reclassify() never clears it); applied move plan recorded to_root_id=lights\1 + item_state=succeeded in DB but files physically landed at C:\Temp\pv-journeys\inbox\M 51\... (root cause: ExecutorItem resolves library_root only from from_root_id, crates/app/core/src/plan_apply.rs:658); audit_log_entry had 0 rows after a real succeeded apply; needs-review gate (banner/badge/disabled-Confirm/typed-IPC-rejection) and Files-popover/FileInspector parity both PASSED with screenshots at scratchpad/shots/j2-*.png.

**Doc-drift / unexpected-but-intended:** the destination-root picker (step 4) is NOT an inline modal at Confirm click — it surfaces inside the "Review plans" overlay (opened via toast + "Review plans (N)" button) after inbox.destination_root_required. JOURNEY-DOC UPDATE: Journey 2 should say the destination-root picker lives in the plan-review overlay, not at the point of Confirm.

**App-state left for later journeys:** DO NOT trust m51-mixed-session list badges (still genuinely mixed; confirm rejects classification.ambiguous) or the darks-root (root) needs-review item (permanently stuck per #724 — don't try to resolve it). One clean plan applied (j2-clean-light, 2 files) but landed inside the inbox root (inbox/M 51/LUM/2025-05-03/light/, now re-detected as a NEW pending item) rather than under lights\1 — so Journey 4 will find 0 real sessions from this apply. Journey 3's ORGANIZED root lights\1 is untouched, safe for catalogue-in-place. Inbox now shows 9 folders.

### Journey 3 — Ingest → confirm (catalogue-in-place)

**Verdict:** PARTIAL
**Steps:** 3 PASS / 1 FAIL / 1 PARTIAL / 0 SKIPPED
**Issues filed:** #768 (UI/backend — destination-root picker shown for an organized-root confirm; should never appear for catalogue-in-place), #769 (backend — per-plan Apply/live-progress path always fails with plan.invalid_state; approval-token wiring missing so plan stays ready_for_review, never approved)

**Dupes hit (not re-filed):** #765 (cross-root move mis-landing — explains why lights\1 was empty pre-test), #766 (zero audit rows on apply — REPRODUCES for catalogue too: audit_log_entry count stayed 0 after a succeeded catalogue apply)

**Key evidence:** DB plan_items (plan 698eb4f0…) both rows action='catalogue', from_root_id==to_root_id, unchanged relative_path; inbox_source_groups.lane=catalogue only for organized root vs move for every unorganized source group of the same frame type; sha256 of both fixture files identical before/after apply; acquisition_session row created (2 frames, root=lights\1); direct IPC replay of plans_apply_real → {"code":"plan.invalid_state","message":"plan must be in 'approved' state before apply; current state is 'ready_for_review'"}. Shots at scratchpad/shots/j3-*.png.

**Doc-drift / unexpected-but-intended:**
- lights\1 had ZERO files on disk at journey start (same root cause as #765 — J2's move stole them); executor SEEDED 2 fixture FITS into lights\1\M51\LUM\2025-05-03\ to make the precondition testable (baseline hashes recorded).
- Inbox page "Rescan all roots" only rescans category==='inbox' roots (InboxPage.tsx:161-167); surfacing a non-inbox root needs Settings → Data Sources → per-root Rescan. JOURNEY-DOC UPDATE: Journey 3 step 2 rescan instruction should say to use Settings → Data Sources per-root Rescan for non-inbox roots.
- Catalogue plan's destructive-destination control observed ABSENT (spec-compliant per the T&V bullet which allows absent-or-inert), though narrative step 3 implies "present" — minor narrative mismatch, not a defect.

**App-state left for later journeys:** app idle on #/sessions with 1 real session (id 11024d3c…, session_key "M 51|LUM|1x1|100|2025-05-03", root=lights\1, 2 frames, canonical_target resolved) — J4 can inspect it directly. J2's move produced NO session (landed nowhere per #765). Inbox still shows 10 items incl. the untouched poisoned ones (m51-mixed-session, darks-root needs-review).

### Journey 4 — Sessions review (derived groupings, live membership)

**Verdict:** PARTIAL
**Steps:** 6 PASS / 6 FAIL / 1 PARTIAL / 2 SKIPPED
**Issues filed:** #770 (UI — detail panel labels unresolved values with "FITS" source, indistinguishable from confirmed-empty), #771 (UI — Sessions detail panel doesn't close on Escape, only ✕), #772 (backend — Sessions detail never shows calibration linkage; InventorySession DTO lacks the field), #773 (UI/backend — no notes field anywhere on Sessions; journey-defined coverage failure)

**Dupes hit (not re-filed):** #564 (root cause confirmed: acquisition_session.session_key stored pipe-delimited at crates/sessions/src/key.rs:66 but parsed as JSON at crates/app/core/src/sessions.rs:220-252, silently dropping filter/binning/gain/night for every real session), #654 (indistinguishable "Session — date" rows), #567, #651 (Show in File Explorer reveals source root not session folder; InventorySession has no per-session path field)

**Key evidence:** live session 11024d3c-0f4d-4bb1-ad45-fdb55a989fb8 (M51/LUM, 2 frames) — sessions_list/sessions_get IPC both return sessionKey:{target:"M 51",filter:"",binning:"",gain:"",night:""}; detail shows Target=— (FITS); rescan via inbox_scan_folder re-confirmed same folder, session count stayed 1 (no dup); NO Confirm/Re-open/Reject/Ignore/review-pill controls anywhere (DOM+button scan); sort headers show working aria-sort; group-by + "Grouped by Target" footer hint live. Shots j4-01..03.

**Doc-drift / unexpected-but-intended:** JOURNEY-DOC UPDATE — PR #415 is MERGED (not open): filter/camera dropdowns, group+secondary sort, aria-sort on every header, and the "Grouped by X" footer hint are all live and working; Journey 4's "Known gaps (2026-07-04)" section is stale and should be removed. Also SessionsPage.tsx:14 documents the frame-type filter is intentionally removed (sessions are light frames; calibration lives on its own page) — journey text should clarify this rather than expecting a literal frame-type row.

**App-state left for later journeys:** app idle on #/sessions, no row selected, filters reset. Session 11024d3c… (M51, LUM, 2 frames, canonical_target resolved) is real, confirmed, attachable (projectIds:[]) — ready for Journey 5 to attach a project. Project-chip-navigation bullet SKIPPED (no project linked yet). Empty-before-apply step SKIPPED (no DB reset), inferred consistent from J2 (no session) vs J3 (session exists).

### Journey 5 — Project lifecycle: create → attach sources → manifests/notes → tool launch → artifacts

**Verdict:** PARTIAL
**Steps:** 2 PASS / 0 FAIL / 4 PARTIAL / 0 SKIPPED (step-3 "real numbers" effectively FAIL via known dupes)
**Issues filed:** #775 (backend — session/project integration time always 0s; sessions.rs:78 hardcoded stub), #776 (backend/UI — wizard step 4 Source-views hardcoded scope/items), #778 (backend — tool launch passes Windows \\?\ verbatim workdir → PixInsight "no file found"), #780 (backend — output/ artifacts lost on reopen; reconcile non-recursive vs live watcher recursive)

**Dupes hit (not re-filed):** #612 (fabricated "From target context" chip), #327 + #599 (wizard steps 3/6 mock calibration/review data), #663 (Sources table raw session UUID + dash cols), #665 (manifests never generated), #660 (Edit pane full-window overlay)

**Key evidence:** Create PASS — project bf6f5e26-… , mkdir plan c81e8913 auto-applied 7/7, real folders on disk under C:\Temp\pv-projects\j5-lifecycle-test, plan_apply_events + audit row present (NOT the #766 zero-audit case; project-create path writes durable events). Duplicate-name block PASS (bounced to Step 1, inline "A project with this name already exists.", case-insensitive, no dupe row). Notes PASS (autosave ~5s, counter 60/16384, cap guard). Source Views Generate PASS (reviewable plan d093373a ready_for_review, 0 applied; Cancel left 0 plans). Lifecycle stepper PASS incl. reverse (Re-open completed→processing). Tool-launch happy path PASS (contained cwd, tool_launches row + audit, lifecycle untouched). FAILs: integration 0s (#775); 0 channels/raw UUID sources (#663); 0 manifests after create+source+lifecycle (#665); \\?\ workdir breaks PixInsight (#778); while-closed artifact lost + existing falsely marked missing on reopen (#780).

**Doc-drift / unexpected-but-intended:** JOURNEY-DOC UPDATE — duplicate-name error fires at Create-time (bounces to Step 1 w/ inline field error), NOT "immediately as you type" as the journey states; correct step 1 wording. "From target context: J5" chip is fabricated from the typed name (already bug #612).

**Untested (noted, not defects):** last-source-guard inline-confirm (code exists EditProjectPane.tsx:338-365 but unreachable — Remove is lifecycle-locked in processing/completed, only 1 session); archived-state edit refusal (no archived project yet); tool-launch containment-refusal + OS-spawn-failure (couldn't misconfigure); Save-draft→resume + exact 1100×720 stepper (skipped for budget).

**App-state left for later journeys:** app idle on #/projects with "J5 Lifecycle Test" (id bf6f5e26-…) selected, lifecycle=completed, 1 attached source (M51 session 11024d3c…), tool=PixInsight, path C:\Temp\pv-projects\j5-lifecycle-test. On-disk outputs for J6/J7: output\J5_integration_master.xisf (recorded artifact, now state=missing per #780) and output\J5_final_closed.fits (on disk, unrecorded per #780). Detail shows Archive + Re-open ready for J7.

### J1–J5 UX diff-check — quick pass

**Verdict:** PASS
**Issues filed:** #783 (UI — New-project wizard "From target context" label fabricated from first word of the typed project name; WizardPage.tsx:480-485)

**Dupes hit (not re-filed):** #557 (Inbox render-loop, recovered), #564/#654 (Sessions dash rows), #622 (Projects Target column always "—"), #663 (raw session UUIDs in Sources/Edit/Calibration-readiness), #664 (raw match.observer_location_missing code leak), #562 (Data Sources raw ISO timestamp + duplicated pills + detached override editor), #327/#599 (wizard steps 3+6 hardcoded mock data — P0, still present), #776 (wizard step 4 hardcoded counts), #612

**Key evidence:** shots ux15-*.png; console "Maximum update depth exceeded" burst tied to Inbox visits only, silent elsewhere after navigate-away.

**Surface-by-surface audit:** Inbox NOT clean (#557 render-loop); Sessions clean@1100×720 (dash dupe #564/#654); Projects list clean (Target "—" dupe #622); J5 detail+Edit clean (raw-UUID/code dupes #663/#664); Data Sources clean (dupe #562); create-wizard step 2 bug new (#783), steps 3/4/6 mock-data dupes.

**Doc-drift / unexpected-but-intended:** Step 5 Naming preview uses a fixed example token (NGC7000) intentionally (StepLayout.tsx:20/47) — not a bug; distinguish from the genuinely-mock steps 3/6 (#599).

**Note:** A COMPREHENSIVE whole-app UX/design review (per-view impeccable analysts + cross-app synthesis) is now running as a follow-on; a consolidated "Comprehensive UX review" report block will arrive for its own section. App left clean, no mutations.

### Comprehensive UX/design review (per-view + cross-app, /impeccable-driven)

**Method:** Phase A live capture (all views, multi-viewport screenshots+DOM+console, non-destructive) → 7 parallel per-view impeccable analysts (inbox, sessions, calibration, targets, projects, settings, shell/archive/setup), each invoking /impeccable + frontend-design skills, reading captures + component/token source → Phase C cross-app synthesizer → Verify pass against the exact app build (commit 7e522c16).

**Verify outcome:** ALL 23 new issues reproduce at the exact build; 0 false-positives; 0 already-fixed-by-#530. (First 5 analysts read source ~12 commits stale, missing #530 + AGPL line-shifts — verify corrected 9 file:line refs via comments, confirmed 8 exact. No bad issues resulted.)

**New issues filed (23), by view:**

| View | Issue | Category |
|------|-------|----------|
| Inbox | #789 | raw unrounded float exposure |
| Inbox | #791 | status-bar "Mixed" bucket ≠ mixed-folder concept, misleads triage |
| Sessions | #798 | list "Integration" col shows raw exposure not total |
| Sessions | #800 | SessionFrameInventory hand-rolls settings class vs sibling's shared Section |
| Sessions | #801 | raw backend protection string in Pill |
| Calibration | #788 | Camera & Instrument group-by are identical dimension |
| Targets | #792 | Opposition col = detail "Best date": same value two labels + truncation clip |
| Targets | #796 | raw catalog cross-IDs unlabeled in header vs badged below |
| Projects | #790 | orphaned Edit-pane Notes field never displayed → user silently loses input |
| Projects | #793 | non-pluralized "1 sources" |
| Projects | #795 | dead "Save draft" button |
| Settings | #799 | pane selection not URL-synced → root of dead deep-links #735/#626 |
| Settings | #802 | RestoreDefaults missing on 3 panes |
| Settings | #803 | Audit Log raw UUID entity |
| Shell | #794 | Warm Clay theme not applying on nav |
| Shell | #797 | Sidebar nav lacks :focus-visible |
| Cross-app | #808 | static-plural i18n — StatusBar+Targets+Projects; ICU plural convention already exists, unused |
| Cross-app | #809 | raw entity-id→name; no shared resolver; Projects/Audit-log/Calibration |
| Cross-app | #810 | --alm-focus-ring token misused as outline-color in 3 selectors → focus rings silently never render |
| Cross-app | #811 | FITS formatter consolidation — lib/format.ts never absorbed exposure/temp/gain |
| Cross-app | #812 | EmptyState.action prop unused app-wide |
| Cross-app | #813 | .alm-session-detail2 JSX hand-copied into 4 files instead of a component |
| New (quick pass) | #783 | "From target context" label fabricated from first word of typed project name |

**Ruled out after source check (not filed):** unstyled-overlay beyond palette (ConfirmOverlay now wraps Modal — commented #640 for live re-verify); notes-fragmentation is Projects-only; no list/detail label drift beyond Targets.

**Design-system health:** Shared-component adoption is broadly STRONG (ListPageLayout/DetailPanel/PropertyTable/Table/SortHeader/Modal/FilterToolbar reused, token-only CSS, few clones). Standout gaps: CommandPalette fully unstyled (#581 dupe), and the cross-app consistency issues above.

### Journey 6 — Cleanup: scan → review → apply

**Verdict:** PARTIAL
**Steps:** 2 PASS / 1 FAIL / 1 PARTIAL / 0 SKIPPED
- Step 1 Scan (read-only preview): PASS — grouped by kind, protected lock icons, reclaimable total, idempotent, disk untouched, "no candidates" case verified.
- Step 2 Destination + Generate: PASS — Archive/System-trash both selectable, destination frozen+read-only in overlay (but System-trash plans still materialize an .astro-plan-archive path — #806).
- Step 3 Review overlay + protected-ack + Discard: PARTIAL — ack enables Approve (UI PASS), Discard leaves disk untouched + sets plans.state='discarded'; BUT ack is cosmetic at apply (#807), and "empty plan can't be approved, states why" has no UI path (Generate never renders at 0 candidates).
- Step 4 Apply: FAIL for default/realistic case, PASS for manually-unprotected item — with defaultProtection=protected, every candidate permanently fails apply (protected.source) regardless of ack (#807). With protection=Normal, apply succeeded end-to-end: plan pending→applying→applied, file moved to .astro-plan-archive/<planId>/ (not deleted), re-scan clear, disk verified.

**Issues filed:** #804 (backend/UI — Settings>Cleanup per-type table is a disconnected fixture; real policy has no UI control), #806 (backend — System-trash-destination plan still computes .astro-plan-archive item path), #807 (backend/UI — protected-item acknowledgement in cleanup review is cosmetic; apply unconditionally fails every protected+mutating item)

**Dupes hit (not re-filed):** #780 (artifact state flips present→missing via periodic reconciliation UPDATE ... SET state='missing' — reproduced live, blocked most real-candidate testing), #766 (zero audit_log_entry rows for plan apply — reproduced for BOTH failed and successful cleanup applies; added corroborating comment), #523 (J6 epic)

**UX/quality notes:** #804/#806/#807 are UI+backend mixed; also noted not-filed: size_bytes always 0 for detected artifacts ("0 B" everywhere) — likely same detection defect as #780.

**Doc-drift:** JOURNEY-DOC UPDATE — Journey 6 "Known gaps (2026-07-04)" PR #413 caveat is STALE; scan/review/generate UI is fully implemented (button, grouped UI, destination picker, review overlay). Real blocking gap now is the protection/audit backend (#780/#807/#766), not missing UI.

**Key evidence:** wizard-test.db plans 408d2bb0… (succeeded), 936ea14b… (failed), 151f994b… (discarded); shots j6-01..12; backend log UPDATE processing_artifacts SET state='missing' at 11:41:57.

**App-state left for J7:** project restored to lifecycle=completed, cleanup_policy=all-Keep, defaultProtection=protected (pre-J6 defaults). Output folder has extra harmless test files + one .astro-plan-archive/408d2bb0…/ from the successful apply (fine on C:\Temp copy). Journey 7 precondition (completed project) intact.

### Journey 7 — Archive → (delete from archive)

**Verdict:** PARTIAL
**Steps:** 2 PASS / 0 FAIL / 2 PARTIAL / 3 SKIPPED (blocked by #780)
**Issues filed:** none (all findings were dupes)

**Dupes hit (not re-filed):** #603 (empty archive plan gives no reason), #732 (send-to-trash/permanently-delete are audit-only stubs), #629 (Archive detail dup/missing outcome+actor), #664 (raw match.observer_location_missing leak), #663 (bare source UUID vs Sessions names), #780 (non-recursive reconcile = root cause of the empty plan; added comment tying archive-plan-generation to it as a new downstream consequence)

**Key evidence:**
- Archive refusal PASS: toast "A filesystem plan is required before this transition. Create or approve a plan first." then UI auto-calls archive.plan.generate and opens the Review overlay — DB plan 33a1f975 created_at matches click; source ProjectDetail.tsx:250-327 handleGenerateArchivePlan.
- Plan review modal: "0 items · Archive folder", Approve&apply disabled with zero explanatory text (dupe #603). Root cause: all 7 processing_artifacts rows state=missing while files verifiably present on disk (#780 non-recursive on-attach reconcile).
- Archive page empty state clean/well-styled ("No archived projects yet"). Settings>Cleanup "Block permanent delete" present, ON by default, tooltip explains routing through archive/trash. Console clean throughout. Shots j7-01..07.

**UX/quality notes:** none newly filed (bare-UUID #663, raw reason-code #664 both already tracked).

**Doc-drift:** JOURNEY-DOC UPDATE — Journey 7 Known-gap #1 ("no shipped UI button that generates an archive plan yet", user-journeys.md:626-630) is now FALSE: the project-detail Archive button refuses server-side then auto-generates the plan + opens the review overlay in ONE click (no backend IPC needed). Doc should say the UI path is wired; backend-only access no longer required.

**App-state left for J8:** archive plan 33a1f975 discarded (state=discarded, 0 items); project bf6f5e26 lifecycle unchanged=completed; nothing moved/trashed/deleted (apply/lifecycle-flip/read-only-edit/trash/permanent-delete steps UNTESTABLE — 0-item plan from #780, not a new defect). App idle on #/projects, bridge connected. J8 (Calibration) independent + unaffected.

### Journey 8 — Calibration: ingest cal frames → masters → matching

**Verdict:** PARTIAL
**Steps:** 2 PASS / 1 FAIL / 2 PARTIAL / 0 SKIPPED
**Issues filed:** none (every defect already open — referenced, not re-filed)

**Dupes hit (with sharper repros):** #620 (fake-zero: Master Dark shows Exposure 0s/Gain 0/Size 0 KB despite injected EXPTIME=120/GAIN=100/CCD-TEMP=-10 → fingerprint pipeline NEVER extracts gain/temp/binning; also reproduces in LIST view), #639 (Calibration Matching pane persists nothing — root cause: frontend always sends exposureToleranceS:null, backend rejects "invalid type: null, expected f64"; every toggle/tolerance silently no-ops), #642 (Use-in-project/Replace-master/Reveal all dead, byte-identical DOM pre/post-click), #664 (calibration_match_suggest/assign both error observer_location_missing because acquisition_fingerprint has 0 rows — blocks ALL matching/assign app-wide, even override:true), #669 (search no-match renders identical "No masters/Run a scan" empty-library state), #766 (0 audit_log_entry rows across all 3 master confirm+applies and both tolerance updates), #811 (Flat master real exposure_s=6.92 renders "—"), #557 (Inbox render-loop, navigated away)

**Key evidence:** 3 masters registered end-to-end (masterBias_g100_bin1 / masterDark_g100_-10C_bin1 / masterFlat_Ha_bin1) → moved on apply to masters/bias|darks/120.0|flats/LUM/; DB calibration_fingerprint has 3 rows (the calibration_master table is empty/unused — architectural dead end, noted not filed); inbox_items.is_master_item=1 for all 3 with distinct master_frame_type/filter/exposure. Matching blocked proven via IPC (match.observer_location_missing even override:true). Tolerances non-persist proven via IPC (null→reject, real float→ok; restored to temp=5/exp=2/aging=365). Shots j8-01..23.

**Doc-drift:** JOURNEY-DOC UPDATE — raw dark/flat fixtures are NOT master files per spec-040 MasterDetector (needs "master"/"_stacked" in name or IMAGETYP master); journey doc implies any calibration-root ingest yields masters. Executor created 3 master-named copies (disclosed) + hand-patched one FITS header (EXPTIME/GAIN/CCD-TEMP) to pass the correct inbox.missing_path_attributes:exposure gate (that gate is correct behavior, not a bug). Journey 8 should note masters need master-style filenames/IMAGETYP.

**App-state left for J9:** app on #/calibration showing 3 masters (bias/dark/flat, unused/unassigned), console clean. Inbox has 3 fewer master items (resolved). Tolerances at defaults. No assignments made (blocked by #664). Journey 9 (Targets) independent + unaffected.

### Journey 9 — Targets & planning (real vs stub)

**Verdict:** PARTIAL
**Steps:** 3 PASS / 0 FAIL / 2 PARTIAL / 0 SKIPPED
**Issues filed:** #815 (UI — Add-target dropdown/no-match message invisibly clipped by .alm-modal__body overflow; clientHeight 89 vs popover y489-527; blank where DOM has real content), #816 (UI — Target detail Aliases/Notes/Coverage/Links/back-btn silently clipped by .alm-detail--fill overflow-y:hidden, scrollHeight 1229 vs clientHeight 330; unreachable by any real user; DetailPane.tsx:18 / primitives.css:105-127 / TargetDetailV2.tsx:685-802)

**Dupes hit (not re-filed):** #658 (alias-search AND display-label propagation both need reload — reproduced twice), #792 (Opposition/Best-date dup label), #574 (seed catalog only searchable via typeahead, not materialized)

**Key evidence:** ALL underlying logic verified correct via DOM/JS bypass — local typeahead ("M 31 · seed"), dedupe on re-add (stays "2 targets"), SIMBAD-unresolvable inline message (role=status aria-live, no fabricated row), alias add ([user] tag), label set/clear (honest "Not set — showing primary designation"), notes save+persist across reload, favourites star + My-Targets filter, guidance popover (row+detail, per-filter thresholds, Escape/outside close) — all functionally PASS, just visually blocked by #815/#816. Sessions column correctly stays "—" (only genuine remaining stub).

**Doc-drift (JOURNEY-DOC UPDATE — major, not filed):**
1. Specs 044 Track B / 047 Track A have SHIPPED: Max alt / Tonight / Visible / Opposition / Lunar / Filters / Img time are now REAL per-site astronomy-engine computations against the configured site ("Home Backyard", 52.09°N via settings_get/observingSites) — the doc's entire "stubbed/pending" narrative (steps 4-5 + Known gaps) is STALE except Sessions.
2. Favourites are DB-backed (target_favourite table w/ timestamp), NOT localStorage-only as documented.
3. aria-sort works (PR #415 merged); doc's "requires PR #415 (open)" is stale.
4. Main Targets table = the user's added-target library (2 rows), NOT "the seeded catalog (thousands of rows)"; the ~13k seed is searched only via Add-target typeahead, never browsable rows — doc step 1 wording should be corrected.

**App-state left for J10:** 2 targets (M31 favourited★ + test alias "MyTestAliasJ9" + test note + cleared label; M51 not); filters/search reset; app idle on #/targets; console clean.

### Planner accuracy verification — M31 imaging time & opposition

**Trigger:** user observed "M31 shows 0 imaging time today yet the opposition graph shows imaging time."

**Verdict:** FRAMING/GRAPH-SHADING CONTRADICTION — NOT a calc bug. Both numbers individually correct; the graph contradicts itself.

**Method:** read real planner-derive/opposition/moon-avoidance + TargetDetailV2 graph; pulled app's live M31 values via bridge; independently recomputed with skyfield/DE421 at the same site/date. (Telescopius fetch was SKIPPED — physics deemed conclusive from two agreeing engines; noted as the one gap.)

**Side-by-side (App @ Home Backyard 52.0907°N/5.1214°E, twilight=astronomical, threshold 30°, date 2026-07-14):**
- App Max alt: 73°, Img time: 0.0h, Lunar: 89°, Best date: 5 Oct (~3mo)
- Independent (skyfield DE421, same site/date): Sun bottoms at −16.4° → astronomical darkness (−18°) NEVER reached → 0 dark minutes → 0 imaging minutes ✓. M31 true transit 79° ~04:50 UTC (app's in-window peak 73° correct for its sunset→sunrise span). Opposition/midnight-transit 2026-10-05 (~83d) ✓. Under NAUTICAL twilight same night = ~180 imaging min → the zero is a correct consequence of the astronomical-twilight setting, not a low-altitude target.

**Root cause of on-screen contradiction:** TargetDetailV2.tsx:177-197 omits twilight shading when there's no dark window, while the green usable-altitude fill (:201-211) still paints under M31's high curve → graph reads "imageable" while metric = 0.0h; disclosure lives only in an out-of-graph banner.

**Issue filed:** #817 (UI, spec:044) — recommends the no-dark-window graph shade the whole plot as non-dark (or grey the usable fill) so graph and metric agree.

**Context (not a calc bug):** the active site "Home Backyard" 52.09°N/5.12°E is the wizard's PLACEHOLDER default, not necessarily the user's real location — the source of the Telescopius mismatch; motivates surfacing the active site prominently + editable on the planner (candidate spec 044/047 iterate).

### Journey 10 — Settings, appearance, and i18n

**Verdict:** PARTIAL
**Steps:** 8 PASS / 5 FAIL / 2 PARTIAL / 0 SKIPPED
**Issues filed:** #820 (UI/backend — Naming & Structure literal-chip discards the default pattern instead of appending), #822 (backend — Target Resolution debounce/timeout number fields don't persist; also widens to catalogue toggles), #823 (backend — Target Planner altitude threshold doesn't persist / clamp unverifiable), #825 (UI/backend — Processing Tools path-save validation errors are unhandled rejections with zero UI feedback), #827 (UI — Advanced "Restart guided flow" has no confirm gate, asymmetric with "Restart first-run setup")

**Dupes hit (not re-filed):** #655 (frame_type fallback on default naming pattern), #645 (Default Catalogues toggles dead — same root cause as #822), #802, #804, #581/#617, #639, #601, #587, #604

**Key evidence:** Appearance theme (Warm Clay) SURVIVED a full app kill+relaunch (shots j10-40/41/42), DB + counts intact post-restart. Naming live preview shows "NGC7000/Ha/2026-04-12/unknown/ (fallback used for: frame_type)" on the UNTOUCHED default pattern (dupe #655). Processing Tools: backend console UNHANDLED_REJECTION {"message":"executable_path for 'pixinsight' must be absolute; got 'x'"} with zero surfaced UI. Command palette listed real routes but unstyled (#581/#617). Audit Log empty-range/search/pagination all work. 1100×720 clean (j10-68). NO raw i18n keys found across Targets/Inbox/Settings DOM scans.

**IMPORTANT CONTRADICTION:** #794 (Warm Clay "not applying", filed by the shell UX analyst, root cause self-flagged unconfirmed) is CONTRADICTED by J10's live restart test — the theme applied and persisted across restart. #794 likely needs re-verification / may be nav-specific or a false positive. (Not refiled; flagging for the issue record.)

**Systemic note (not a new issue):** settings-persistence failures cluster across ≥4 panes (Target Resolution #822, Target Planner #823, Cleanup #804-dupe, Naming chip #820) — likely ONE root cause (settings-descriptor registration gaps per #645); worth a consolidated backend sweep, not pane-by-pane.

**Doc-drift (JOURNEY-DOC UPDATE):** app has 13 panes, not the doc's "12"; the doc's pane list omits Target Resolution + Source Views and mislabels "Catalogs"/"General" (actually "Target Resolution"/"Appearance"). Update step 1's pane list.

**App-state left for J11:** Inbox has 10 folders (Dark 1, Light 5, Mixed 4 — plenty of heterogeneous items for mistake-recovery). Calibration has 3 masters (NO assignment made — and note #664 blocks assignment app-wide, so J11's un-assign step may be untestable). All settings J10 changed were restored. Bridge connected.

### Journey 11 — Mistake recovery: undo a wrong classification or assignment

**Verdict:** PARTIAL
**Steps:** 1 PASS / 2 FAIL / 0 PARTIAL / 1 SKIPPED (blocked by #664)
**Issues filed:** none (added corroborating evidence comment to existing #611)

**Dupes hit (not re-filed):** #611 (heterogeneous bulk override has NO warning + NO reset-to-detected UI — backend already models detected-vs-override, only UI missing), #664 (calibration assign blocked app-wide)

**Key evidence:** Inbox item 832eea19 (2 unclassified files) bulk-overridden to "light" with ZERO warning/confirm (handleBulkApply in InboxDetail.tsx has no heterogeneity check); DB inbox_classification_evidence.frame_type=NULL, manual_override='light'; no provenance pill/reset control in DOM (hasReset:false) — posted as evidence on #611. Plan-discard round-trip PASS: M51/LUM/2025-05-03 classified→plan→"Discard" (toast "Plan discarded. Item is available for re-confirmation."), DOM reverted to classified, DB plans.state='discarded'+discarded_at, item never moved. Calibration un-assign untestable: calibration_match_suggest returns match.observer_location_missing (#664) so no assignment can be created to un-assign; all 3 masters "USED BY: None".

**Doc-drift (JOURNEY-DOC UPDATE):** the bulk-override grid only renders for classType `unclassified` (files with unreadable/absent frame-type evidence), NOT for `classification.type==='mixed'` folders (which offer only "Confirm to inventory" split plan, no per-file override grid). Journey 11 wording should say "folders with unreadable/absent frame-type evidence" rather than "differing detected types".

**UX/quality note:** "Use in project" on Calibration master detail produces zero visible feedback when clicked (silent-failure smell; root cause = #664 upstream refusal, not filed separately — fold into #664 fix).

**App-state left for J12:** project "J5 Lifecycle Test" (completed, 0 channels) already has a RECORDED refused Archive transition (audit project bf6f5e26, trigger=Archive, outcome=refused, code=plan.required "edge (project, completed→archived) requires an approved FilesystemPlan") — ready-made "transition that can't satisfy" precondition for J12. NO partial-fail plan exists yet — J12 must construct one (confirm an item, then remove/modify its source file on disk before apply). Inbox item 832eea19 now permanently classified "light" (index-only). M51 plan discarded/reverted.

### Journey 12 — Failure & refusal handling: when the backend says no

**Verdict:** PARTIAL
**Steps:** 0 PASS / 3 FAIL / 2 PARTIAL / 0 SKIPPED
**Issues filed:** #829 (backend, **SAFETY** — plan approval NEVER snapshots FS metadata; the R-FS-1 CAS staleness check is entirely DEAD CODE across all plan types; approve_plan plans.rs:319 never calls update_item_fs_snapshot; approved_mtime NULL on all 26 plan_items DB-wide → check_cas permissive-skip is universal), #830 (backend/perf — background poll queries routinely exceed the 1s slow-query threshold)

**Dupes hit (not re-filed):** #600 (lifecycle refusal → zero UI feedback), #603 (empty archive plan unexplained), #742 (mid-run retry never re-executes), #749 (audit detail hidden in tooltip, no state-change column), #765, #766 (inbox plan-apply writes zero audit rows — confirmed live), #769 (per-plan Apply always fails/never approves), #803 (audit raw UUID entity)

**Key evidence:**
- Step1 (refused lifecycle): clicking Archive on J5 opens an EMPTY review dialog (0 items), NOT an inline refusal; DB audit row confirms outcome=refused code=plan.required "edge (project, completed→archived) requires an approved FilesystemPlan" — captured correctly but never surfaced at the control (dupe #600) and only visible via title= hover in Audit Log (dupe #749).
- Step2 (empty plan): "0 items", Approve disabled, zero explanatory text (exact dupe #603).
- Step3/4 (partial/stale): confirmed inbox group → plan 2bc2bab6 (catalogue, 2 files); DELETED one source file on disk (verified via ls); "Apply all" → plan reports state=applied itemsApplied=2 itemsFailed=0, both plan_items succeeded = **SILENT SUCCESS on a missing source**. Root cause #829 (approved_mtime NULL everywhere → CAS check universally skipped). The "stale plan refuses / partial-fail lists failures" guarantee is NOT enforced.
- Step5 (audit): refused lifecycle transitions ARE audited (reason matches DB, hover-only); plan-apply outcomes NOT audited (0 rows for plan 2bc2bab6, confirms #766).
- Provocations PASS (backend-verified via IPC; native pickers undrivable): disabled root then inventory_reconcile_run → calm {"code":"root.unavailable",...} AND inline Settings banner "Reconcile failed: That library root isn't available right now…" (minor: says "drive" for a user-disabled root, not filed); invalid path via roots_register → calm {"code":"path.not_exists",...}. No crash either way.

**Doc-drift (JOURNEY-DOC UPDATE):** a plan-gated transition (e.g. Archive) doesn't show a bare inline refusal — it auto-opens the plan-review dialog directly (reasonable UX evolution), but the dialog gives no reason when empty (#603). Journey 12 step 1 should say "a plan-gated transition opens its review dialog directly; the dialog (not an inline label) must carry the refusal/empty-plan reason."

**App-state left for J13:** an empty "Archive: J5 Lifecycle Test" plan (9d858be4, ready_for_review, 0 items) left OPEN as visible ongoing activity; archive refusal recorded TWICE in Audit Log (14:49 + 15:59 UTC); one inbox plan (2bc2bab6) applied (catalogue). NOTE one source file was deleted and NOT restored (C:\Temp\pv-journeys\lights\1\M51\LUM\2025-05-03\M 51_..._0000.fits gone; sibling ...0001.fits intact) — disposable copy, fine. Root lights\2 disabled then re-enabled (all 5 roots active). Inbox count now 10.

### Journey 13 — Audit & activity investigation: "what happened to my files?"

**Verdict:** PARTIAL
**Steps:** 4 PASS / 2 FAIL / 3 PARTIAL / 0 SKIPPED
**Issues filed:** #831 (UI — Audit Log rows have zero cross-link affordance), #832 (UI — Activity Follow re-enable doesn't scroll to newest row), #833 (UI/backend — Project detail History section shows only Created/Updated, no lifecycle transitions/outcomes/actor)

**HEADLINE:** audit_log_entry has exactly 12 rows total (all workflow/target.adopted), while plans/plan_apply_runs show 8 successfully-applied plans + 2 fresh attempts — NONE of the 10 produced a durable audit row. This is #766/#647 reproduced at scale: the Activity stream shows full plan.approved→applying.started→item.progress→applying.completed sequences LIVE, then the rows disappear and never persist to audit_log_entry. The constitution's audit guarantee (every attempted action + outcome) is violated at the plan-apply layer.

**Dupes hit (not re-filed):** #766 + #647 (durable audit gaps — headline), #769/#609 (per-row Apply always fails), #767 (Review-plans overlay stuck empty), #626 (LogPanel cross-links broken — plan link → #/sessions, reproduced live), #803 (raw UUID entity), #666 (category/source filter logic exists, no UI), #668 (housekeeping floods 500-row buffer — 941/1156 events = target.resolve_batch.completed), #669 (filtered-empty vs truly-empty — Error chip → "No log entries"), #582 (severity filter exact-level not floor), #667 (Activity export dialog titled "Export Audit Log", wrong surface)

**Key evidence:** PASSES: entity search (bf6f5e26 → 11/12 rows), all-excluding date range (2030 → "No matching audit events." 0 events, UNAMBIGUOUS), pagination (12 events, page 1 of 2, Next/Prev), panel collapse + Escape both close correctly.

**Doc-drift:** none — inbox confirm flow (detection groups → Confirm to inventory → Review plans destination-root picker → per-item Apply) matches the app; the journey's "perform a plan apply" undersells how many known-broken paths (#769, #767) sit in front of a successful apply.

**UX/quality notes:** filed #831/#832/#833; also reproduced live (not filed) #626/#666/#668/#669/#582/#667/#803/#769/#609/#767.

**App-state left for J14:** app on #/targets, no stuck dialogs, bridge connected. Inbox count 10 (2 confirm attempts failed/discarded, no net change; M51/LUM/2025-05-03/light group now blocked by stale conflict.destination_exists at C:\Temp\pv-journeys\inbox\M 51\...). Seeded catalog + confirmed M51 session (11024d3c) untouched for J14.
