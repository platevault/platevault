# PlateVault user-journey validation run — 2026-07-14

Driven against the real Windows dev app via the Tauri MCP bridge, origin/main @ commit 7e522c16, validating `docs/product/user-journeys.md` Journeys 1–17.

## Summary

| Journey | Verdict | Steps (P/F/PA/S) | Issues filed | Notes |
|---------|---------|------------------|--------------|-------|
| 1. First-run setup → data sources | PARTIAL | 11P/6F/1PA/1S | #704, #707 | 6-step wizard (Observing Site added); Project required not optional; partial-commit + remap-verify bugs; #557 infinite-render observed |
| 2. Ingest → review/reclassify → confirm (move) | PARTIAL | 7P/6F/3PA/2S | #711, #724, #765, #766, #767 | needs-review gate works; reclassify sentinel bug #724 blocks confirm; cross-root move lands wrong #765; zero audit rows #766; plan-review overlay stuck #767 |
| 3. Ingest → confirm (catalogue-in-place) | PARTIAL | 3P/1F/1PA/0S | #768, #769 | catalogue plan structure valid; destination-root picker shown wrongly #768; approval-token missing #769 blocks apply; zero audit rows #766 reproduces |
| 4. Sessions review (derived) | ⏳ pending | | | |
| 5. Project lifecycle: create → artifacts | ⏳ pending | | | |
| 6. Cleanup: scan → review → apply | ⏳ pending | | | |
| 7. Archive → delete from archive | ⏳ pending | | | |
| 8. Calibration: ingest → masters → matching | ⏳ pending | | | |
| 9. Targets & planning (real vs. stub) | ⏳ pending | | | |
| 10. Settings, appearance, and i18n | ⏳ pending | | | |
| 11. Mistake recovery | ⏳ pending | | | |
| 12. Failure & refusal handling | ⏳ pending | | | |
| 13. Audit & activity investigation | ⏳ pending | | | |
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
