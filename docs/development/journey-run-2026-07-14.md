# PlateVault user-journey validation run — 2026-07-14

Driven against the real Windows dev app via the Tauri MCP bridge, origin/main @ commit 7e522c16, validating `docs/product/user-journeys.md` Journeys 1–17.

## Summary

| Journey | Verdict | Steps (P/F/PA/S) | Issues filed | Notes |
|---------|---------|------------------|--------------|-------|
| 1. First-run setup → data sources | PARTIAL | 11P/6F/1PA/1S | #704, #707 | 6-step wizard (Observing Site added); Project required not optional; partial-commit + remap-verify bugs; #557 infinite-render observed |
| 2. Ingest → review/reclassify → confirm (move) | ⏳ pending | | | |
| 3. Ingest → confirm (catalogue-in-place) | ⏳ pending | | | |
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
