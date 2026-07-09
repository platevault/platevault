# PlateVault — Windows Validation: MASTER JOURNEY TRACKER

**This is the source of truth for the Windows real-app validation campaign.**
Any agent continuing this work MUST:

1. **Read this file first** and find the first journey/test not marked ✅/❌.
2. **Continue from there** — do not restart completed work.
3. **Update this file** (status per test) and the matching **GitHub epic** as you go.
4. Keep the detailed run log + persistent backlog in
   `docs/development/windows-validation-run-2026-07-09.md` in sync (issue IDs, evidence).

## Status legend

| Mark | Meaning |
|------|---------|
| ✅ | PASS (verified on the real app) |
| ❌ | FAIL (bug found; issue filed) |
| ⚠️ | PASS-with-findings / partial (issue filed but not blocking) |
| 🔬 | Verified via code/backend, not full UI |
| ⬜ | Not started |
| ⏳ | In progress / blocked |

## Environment & mechanics

- Windows checkout `C:\dev\astro-plan`; commit under test **`8097d9c6`** (≡ origin/main
  for app behaviour — the gap is docs/ci/release only).
- Real backend `VITE_USE_MOCKS=false`, `VITE_E2E=1`. Bridge: `driver_session
  host=localhost port=9223` (mirrored networking).
- **Fresh first-run reset needs BOTH** `Remove-Item wizard-test.db*` **AND**
  `localStorage.clear()` (see backlog B6 — DB wipe alone rehydrates stale wizard
  buffer/theme).
- Commands use underscores (`roots_list`, `roots_register_batch`, `firstrun_state`…),
  invoked via `window.__TAURI__.core.invoke('<name>', {args})`.
- Launch/kill/relaunch mechanics: see the run log's Environment section.
- Real fixtures at `D:\astrophotography\ALM test\` (Lights/Darks/Flats/Project/Inbox);
  the 14-combo option matrix at `…\OptMatrix\` (built by
  `/mnt/c/Windows/Temp/build-optmatrix.ps1`). `D:\astrophotography` proper is
  READ-ONLY source — never register it.

## GitHub epics

One tracking issue per journey: **Epic: Journey N — <name>**. Each lists its tests
(checklist) + attached issues. Update/commented as journeys progress.
(Epic issue numbers filled in when created — see the "Epics" table at the bottom.)

## Campaign issues filed so far

| # | Title (short) | Journey | Type |
|---|---------------|---------|------|
| #491 | Observing Site map-based location picker | J1 | enhancement (spec:044) |
| #496 | Step 1 required categories ordered below optional | J1 | enhancement |
| #497 | Contextual (?) help tooltips app-wide | J1 | enhancement/a11y |
| #501 | register_source accepts overlapping roots + dup=warning | J1 | **bug** |
| #502 | Step 1 no add-time path validation | J1 | validation-gap |
| #504 | Wizard theme selector one option / doesn't apply | J1 | **bug** |
| #505 | Density no live effect in wizard | J1 | ux |
| #506 | Source-protection: evaluate/simplify + per-source placement | J1 | evaluation |
| #509 | scan depth `single` is a no-op → drop option | J1 | **bug** |
| #510 | Step 2 tools UI polish (pills/redetect/typography) | J1 | ux |
| #511 | Tool binary picker accepts any file (.zip) | J1 | **bug** |
| #512 | Make step-nav tabs clickable + a11y | J1 | enhancement |
| #513 | Scan-step preview: count vs types mismatch, empty root row | J1/J8 | **bug** |
| #514 | spec-040 comprehensive master-detection test matrix | J8 | test-coverage |
| #515 | Confirm shows depth not org state | J1 | minor |
| #516 | Observing Site name accepts empty | J1 | minor |

**Journey → Epic map:** J1 #518 · J2 #519 · J3 #520 · J4 #521 · J5 #522 · J6 #523
· J7 #524 · J8 #525 · J9 #526 · J10 #527.

---

# Journey 1 — First-run setup → Data Sources

**Epic:** #518 · Source doc: `windows-journeys/journey-01-first-run-setup.md`
**Status: in progress** (Tests 1–4 done; 5–9 pending). Wizard steps 2–5 also deep-validated.

| Test | Status | Notes / evidence |
|------|--------|------------------|
| T1 Fresh install → wizard (Step 1 of **6**) | ✅ | doc says 5 steps; app has 6 (Observing Site added, B1) |
| T2 Add Light folder (buffer-only, nothing registered) | ✅ | `roots_list=[]` pre-Confirm proven |
| — Path-validation matrix (backend `register_source`) | ⚠️ | rejects nonexistent/non-dir/dup cleanly; **accepts overlapping roots** (#501); no add-time UI validation (#502) |
| T3 Confirm registers + Scan runs | ✅ | no scan before Confirm; all reach terminal; Finish gated; re-scan idempotent |
| — Full org×depth×category matrix (14 roots) | ✅ | org persists per-source; **scan_depth is a no-op (#509)**; org IS consumed (catalogue vs move) |
| — Scan-step folder preview | ❌ | count vs detected-types mismatch, hidden unclassified/masters, empty root-row name (issue pending) |
| Step 2 Processing Tools | ⚠️ | detection real; enable/disable+redetect OK; **binary picker accepts any file** (#511); UI polish (#510) |
| Step 3 Configuration | ❌ | **theme selector broken** (#504); density no wizard preview (#505); protection eval (#506); SIMBAD toggle OK |
| Step 4 Observing Site | ✅ | lat/long range-validated with accessible errors; empty name allowed (B16); map picker (#491) |
| Step 5 Confirm | ✅ | summary accurate; shows depth not org (B15) |
| T4 Finish → Inbox + persistence | ✅ | Finish→Inbox ✅; density on main pages ✅; relaunch (no DB reset) → main page not `/setup`, `firstrun_state=complete`, 14 roots persisted ✅ |
| T5 Data Sources: Rescan | ⬜ | re-runs without re-prompting path |
| T6 Data Sources: Remap (verify→apply, no file move) | ⬜ | Apply only after Verify; no bytes move |
| T7 Data Sources: Disable (reversible, no confirm) | ⬜ | history stays; re-enable no dialog |
| T8 Data Sources: Delete (registration-only, dependents block) | ⬜ | files untouched; blocked w/ dependents |
| T9 "Show in File Explorer" reveal | ⬜ | opens exact folder; OS-native label |

---

# Journey 2 — Inbox ingest → review/reclassify → confirm (MOVE)

**Epic:** _(pending)_ · Source doc: `journey-02-inbox-ingest-move.md` · Backend: yes
(inbox.scan.folder/classify/confirm/plan.apply, plans.apply.status)

| Test | Status | Step → Expected / FAIL |
|------|--------|------------------------|
| T1 Mixed folder splits into single-type items | ⬜ | Rescan mixed folder → multiple single-type items grouped to source, breakdown matches. FAIL: one "mixed" row |
| T2 Needs-review gate blocks Confirm | ⬜ | Rescan w/ missing mandatory field → danger banner + "needs `<attr>`" badges, Confirm disabled. FAIL: Confirm clickable / generic banner |
| T3 Bulk reclassify resolves gate | ⬜ | Bulk-set missing value → re-partitions clean, Confirm re-enables, survives rescan. FAIL: stays disabled / rescan reverts |
| T4 Root-picker: prompt vs auto-select | ⬜ | ≥2 roots → picker; exactly 1 → auto, no prompt. FAIL: reversed |
| T5 Confirm never moves a file itself | ⬜ | Confirm → item "planned", file NOT moved. FAIL: file moved / item vanishes |
| T6 Apply moves file to resolved dest | ⬜ | Apply → file at exact shown path, gone from origin. FAIL: elsewhere / path unseen pre-Apply |
| T7 Stale-plan refusal | ⬜ | modify source after Confirm → Apply refused (stale). FAIL: applies anyway |

---

# Journey 3 — Inbox confirm (CATALOGUE-IN-PLACE)

**Epic:** _(pending)_ · Source doc: `journey-03-inbox-catalogue-in-place.md` · Backend: yes
(same inbox.* pipeline, gated on `organized` root)

| Test | Status | Step → Expected / FAIL |
|------|--------|------------------------|
| T1 Classification same as J2 | ⬜ | Rescan organized root → classifies identically. FAIL: differs (org leaked into classify) |
| T2 Confirm → catalogue plan not move | ⬜ | move count 0, catalogue count = files, no root picker. FAIL: picker appears / move>0 |
| T3 Review overlay shows catalogue actions | ⬜ | lists catalogue (not move), Archive-vs-Trash still shown. FAIL: move-style actions |
| T4 Apply leaves bytes untouched, in Sessions | ⬜ | size/timestamp unchanged, session appears. FAIL: bytes changed / never in Sessions |

---

# Journey 4 — Sessions review (derived, live)

**Epic:** _(pending)_ · Source doc: `journey-04-sessions-review.md` · Backend: yes
(sessions.list event-driven, session notes)

| Test | Status | Step → Expected / FAIL |
|------|--------|------------------------|
| T1 Nothing before a plan applies | ⬜ | Sessions empty for un-applied data. FAIL: session from raw scan |
| T2 Session auto-appears after apply, real counts | ⬜ | appears automatically, counts match, no review step. FAIL: needs approve / wrong counts |
| T3 No review-state controls/pills | ⬜ | no Confirm/Re-open/Reject/Ignore, no pills. FAIL: any appears |
| T4 Notes edit ≠ lifecycle transition | ⬜ | notes auto-save, no transition prompt. FAIL: triggers transition |
| T5 Rescan doesn't duplicate/resurrect | ⬜ | no dup sessions / review state. FAIL: dup or review UI resurfaces |

---

# Journey 5 — Project lifecycle

**Epic:** _(pending)_ · Source doc: `journey-05-project-lifecycle.md` · Backend: yes
(projects.create, lifecycle.transition/ledger, artifact watcher, tool-launch)
**Note:** verify open issue **#327** here (claim: Project-wizard Calibration renders
hardcoded mock masters).

| Test | Status | Step → Expected / FAIL |
|------|--------|------------------------|
| T1 Duplicate name blocks with inline error | ⬜ | existing name (any case) → inline field error, blocked. FAIL: toast / proceeds |
| T2 Unique name creates real folders in right place | ⬜ | lights/darks/flats under registered library root. FAIL: missing / wrong root |
| T3 Attach: unlinked-confirmed-only + last-source guard | ⬜ | picker=unlinked confirmed only; last-source removal guarded. FAIL: unconfirmed in picker / no guard |
| T4 Per-channel integration time real | ⬜ | real sub counts + total time. FAIL: dash despite data |
| T5 Manifests/notes append-only + auto-save | ⬜ | new manifest appended (never overwrite), notes auto-save. FAIL: overwrite / manual Save |
| T6 Tool launch spawns + containment-checked | ⬜ | exe spawns; out-of-root refused w/ message. FAIL: nothing spawns / out-of-root silently ok |
| T7 Artifact watcher observes only output folder | ⬜ | while-open live, while-closed on reopen, artifact untouched. FAIL: misses / modifies |

---

# Journey 6 — Cleanup: scan → review → apply

**Epic:** _(pending)_ · Source doc: `journey-06-cleanup-scan-apply.md` · Backend: yes
(cleanup.scan/plan.generate, plans.approve/apply_real; Apply may be UI-unwired — check)

| Test | Status | Step → Expected / FAIL |
|------|--------|------------------------|
| T1 Scan is read-only | ⬜ | preview grouped by kind, protected locked, nothing changes on disk. FAIL: files change |
| T2 Generate → real plan, fixed destination | ⬜ | plan created, destination read-only after. FAIL: still editable / no plan |
| T3 Protection ack gates Approve | ⬜ | Approve disabled until acknowledged. FAIL: clickable while unacknowledged |
| T4 Apply shows progress + moves files | ⬜ | live "Applying N of M", files moved (not deleted if Archive). FAIL: no progress / deleted / not moved |
| T5 Re-scan: applied items gone | ⬜ | no longer candidates. FAIL: still appear |
| T6 Empty plan can't be approved | ⬜ | deselect all → Approve stays disabled. FAIL: empty plan approvable |

---

# Journey 7 — Archive → delete from archive

**Epic:** _(pending)_ · Source doc: `journey-07-archive-delete.md` · Backend: yes
(archive.plan.generate — no UI button, use bridge; plans.approve/apply_real; trash/delete)

| Test | Status | Step → Expected / FAIL |
|------|--------|------------------------|
| T1 Archive refused without applied plan | ⬜ | refused w/ message, state unchanged. FAIL: silently archived |
| T2 Generate→approve→apply flips lifecycle | ⬜ | files → `.astro-plan-archive/<planId>/` then state=archived. FAIL: flips before apply / wrong path |
| T3 Archived Edit pane read-only | ⬜ | no editable controls. FAIL: any interactive |
| T4 Archive page real history, narrower scope | ⬜ | real audit, no Masters/Targets/Sessions tabs, Restore hidden (D15). FAIL: placeholder / Restore works |
| T5 Send to trash → OS Recycle Bin | ⬜ | recoverable in Recycle Bin. FAIL: permanent / nothing |
| T6 Permanent delete requires literal `DELETE` | ⬜ | disabled on wrong text, removes on `DELETE`. FAIL: enables on wrong text |
| T7 Reveal OS-native label | ⬜ | "Show in File Explorer", disabled when nothing. FAIL: generic label / clickable w/ nothing |

---

# Journey 8 — Calibration: cal frames → masters → matching

**Epic:** _(pending)_ · Source doc: `journey-08-calibration-masters-matching.md` · Backend: yes
(calibration_master_detect, confirm_master_integration, calibration.match.suggest, assignment)
**Note:** master-detection deep-dive done this campaign — see backlog B21/B22 + pending
spec-040 test issue. Detection is header-first (IMAGETYP), path/name fallback.

| Test | Status | Step → Expected / FAIL |
|------|--------|------------------------|
| T1 Masters ingest as individual items | ⬜ | each master its own item w/ fingerprint. FAIL: folder collapses to one item |
| T2 Confirm+apply, kind-conditional columns | ⬜ | one row/master, bias temp/gain dash by design, no master light. FAIL: master light appears / fabricated dashes |
| T3 Matching: ranked candidates, real context | ⬜ | ranked sessions w/ target/filter/night/count, mismatch flagged. FAIL: opaque ids / mismatch hidden |
| T4 Assignment advisory + confirmable | ⬜ | cancel = no backend/log; confirm records + usage++. FAIL: cancel records / confirm no usage |
| T5 Offset tolerance persists + affects matching | ⬜ | persists across restart, matching reflects immediately. FAIL: resets / no effect |

---

# Journey 9 — Targets & planning

**Epic:** _(pending)_ · Source doc: `journey-09-targets-planning.md` · Backend: yes
(target.resolve SIMBAD/seed, target CRUD; astronomy cols frontend-only)
**Note:** astronomy columns gated behind ObserverSite (pre-#440); expect disclosed
placeholders, not fabricated values. Also probe observing-site lat/long range validation here.

| Test | Status | Step → Expected / FAIL |
|------|--------|------------------------|
| T1 Catalog list/search/sort | ⬜ | thousands virtualized, "M31"+"Andromeda" hit same row, single sort. FAIL: miss / stutter / multi-sort |
| T2 Add target (local, no duplicate) | ⬜ | exactly one row after re-add. FAIL: second row |
| T3 SIMBAD resolve (success + failure) | ⬜ | success cached; failure inline "not found", never fabricated. FAIL: fabricated row / no failure msg |
| T4 Detail identity/aliases/notes | ⬜ | user alias searchable, catalog aliases non-removable. FAIL: catalog alias removable / alias not searchable |
| T5 Favourites localStorage-only (expected) | ⬜ | persists across relaunch. FAIL: doesn't persist |
| T6a Astronomy cols disclosed placeholder | ⬜ | "set up site" prompt/placeholder, Sessions dash. FAIL: concrete value w/o disclosure (constitutional) |
| T6b Site-setup prompt is only path (regression) | ⬜ | no functional site-creation on main. FAIL: working site flow (means #440 landed — report) |
| T6c (after #440) real astronomy w/ site | ⬜ | six cols compute from ephemeris. FAIL: still placeholder-like |

---

# Journey 10 — Settings, appearance, i18n

**Epic:** _(pending)_ · Source doc: `journey-10-settings-appearance-i18n.md` · Backend: yes
(settings persistence + translated error codes spec 046)

| Test | Status | Step → Expected / FAIL |
|------|--------|------------------------|
| T1 Pane grouping, no global Save | ⬜ | 12 panes, no Save, every field auto-saves. FAIL: Save exists / needs it |
| T2 Theme switch live + persists | ⬜ | 4 themes+System apply live, survive restart. FAIL: needs reload / resets |
| T3 Font-size visual-only (expected) | ⬜ | Density affects app; font-size no-op outside pane. FAIL: crash/surprise |
| T4 Ingestion settings persist (no consumer yet) | ⬜ | persist across restart. FAIL: don't persist |
| T5 Planner altitude clamp 0–90 | ⬜ | out-of-range clamps; valid affects planner. FAIL: accepts out-of-range |
| T6 Log panel is layout participant | ⬜ | expand shrinks content (no overlay); filtered export matches. FAIL: overlays / export unfiltered |
| T7 1100×720 pinned-header convention | ⬜ | header pinned, only content scrolls, all pages. FAIL: header scrolls out |
| T8 Translated errors, never raw code | ⬜ | human message, no `E_*`/keys. FAIL: raw code leaks |
| T9 Command palette (Ctrl+K) + keyboard nav | ⬜ | live backend search, keyboard-only reaches result. FAIL: fake data / nav stuck |
| T10 Sidebar collapse persists | ⬜ | collapsed survives reload. FAIL: resets |

---

## Epics index

Each epic carries labels `epic` + `journey-N`. Attached issues query:
`label:journey-N`.

| Journey | Epic issue | Status |
|---------|-----------|--------|
| J1 First-run setup | **#518** | in progress |
| J2 Inbox move | **#519** | not started |
| J3 Catalogue-in-place | **#520** | not started |
| J4 Sessions | **#521** | not started |
| J5 Project lifecycle | **#522** | not started |
| J6 Cleanup | **#523** | not started |
| J7 Archive/delete | **#524** | not started |
| J8 Calibration masters | **#525** | not started |
| J9 Targets/planning | **#526** | not started |
| J10 Settings/i18n | **#527** | not started |
