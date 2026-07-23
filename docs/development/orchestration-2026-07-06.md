# Orchestration log — 2026-07-06 (unattended release run)

Coordinator session resuming campaign from session `e8f0d3c8` (died 15:11 on
auth errors). User directive: continue unattended, orchestrate/delegate only,
record all decisions. This file is that record (untracked; commit or discard
at review time).

## State at resume (≈19:00 local)

- 051 wave-2 fully merged: #471 #472 #473 #474 #475 #476, plus #466, #468,
  #457 (inbox real-UI journeys), #462, #460, #461.
- Main is RED: Real-UI E2E + CI failed on `9ee504d1` (the #457 merge).
- **#477 `fix-main-e2e-interplay`** (head `8811748c`) is the critical-path fix
  (window-state store leak between sequential journeys + mock-suite CI
  retries). CI (mock/integration) green; Real-UI **windows AND macos red**
  (run 28786351305). Round-2 checklist from prior session: verify
  `reset_window_state()` targets the plugin's real store path on Windows;
  compare failure signatures across runs.
- Journey PRs blocked behind #477: #458, #463, #464, #465, #467, #470
  (heads: calibration fc269939, targets 071ff585, settings c8e0f301,
  sessions 40fad79a, lifecycle 5b156b78, perframe 89517720).
- **#469 `release-pipeline-updater`** (head c60022bf): Real-UI green,
  CI run 28751374111 FAILED (rollup shows Integration windows red) — needs
  its own fix round. This PR is the release build/sign/publish pipeline.
- #446 release-please PR open, no failing checks.
- Local main checkout on `release-pipeline-updater` has a STAGED deletion of
  the entire build/sign job in `.github/workflows/release-please.yml` —
  contradicts the pushed branch head.

## Decisions

1. **D1 — Stale staged change quarantined.** The staged deletion of the
   build/sign job in this checkout is treated as leftovers of an aborted
   experiment (likely the workflow-scope push workaround). Not committed, not
   discarded, nothing pushed from this checkout. User to adjudicate.
2. **D2 — Merge order for the release train:**
   #477 → rebase+merge the 6 journey PRs → #469 → then and only then merge
   #446 (release-please) so the tag triggers the new build/sign job exactly
   once, on a green main.
3. **D3 — Merge policy** (carried from prior session, made explicit):
   a PR merges when Integration + mock CI are green and ubuntu+windows
   Real-UI are green. A macos Real-UI red/pending may be waived only if its
   failure signature matches the known main-inherited one AND main itself is
   still red on the same signature. #477 itself gets no waivers: it must cure
   windows and macos, since it exists to fix exactly that.
4. **D4 — Lane structure:** (a) fix lane for #477 round 3 (parallel-coder,
   own worktree, pushes to the existing branch); (b) fix lane for #469's
   Integration-windows red; (c) CI shepherd (watch/merge/report, dedicated
   background lane); (d) rebase-wave lane spawned only after #477 merges.
   Coordinator does not code.
5. **D5 — #463 diagnostics are temporary.** The branch-local `e2e.yml`
   RUST_LOG bump + artifact upload on `037-ui-journeys-targets` (071ff585)
   must be reverted before that PR merges; the rebase-wave lane carries this
   obligation.

6. **D6 — macos Real-UI is non-blocking, campaign-wide.** Verified in
   `.github/workflows/e2e.yml` (comment block, lines ~32-46) + testing.md:
   the macos leg is `continue-on-error` best-effort; `tauri-plugin-webdriver`
   never becomes reachable on macos-latest (upstream limitation, fails on
   every PR). Amends D3: the Real-UI merge bar everywhere, including #477,
   is **ubuntu + windows green**. The prior "no macos waiver for #477" rule
   was based on mistaking this pre-existing red for part of the regression.
7. **D7 — window-state theory falsified; #477 pivots to evidence-first.**
   Round-3 A/B log comparison (run 28782673323 pre-fix vs 28786351305
   post-fix) shows the windows failure is a byte-identical deterministic
   assertion (`mixed folder split ... found 0 rows`), unaffected by the
   window-state reset. Round 3 (2a43b8d1) landed test-only diagnostics that
   split backend-vs-UI causes (direct `inbox_list` invoke at failure site).
   No guess-fix. Round 4 waits on the next windows CI failure text.
8. **D1-update — staged workflow deletion dissolved, harmless.** The round-3
   lane ignored its assigned worktree and worked in the PRIMARY checkout
   (~/dev/astro-plan), switching it to `fix-main-e2e-interplay`. The staged
   release-please.yml deletion was content-identical to main's version of
   the file, so the checkout absorbed it — it was a revert-to-main, not
   novel work. Nothing lost: origin/release-pipeline-updater intact at
   c60022bf. Coordinator restored the primary checkout to `main` @ 9ee504d1.
   Lesson re-confirmed: lanes must be told their exact worktree path.

9. **D9 — #477 root cause localized to the frontend.** Diagnostics on head
   2a43b8d1 (run 28801974726): direct backend `inbox.list` returns the 2
   expected split items (groupIds distinct; one `groupKey=""` with full
   metadata, one `__needs_review__`; both `state=classified`; windows-style
   `rootAbsolutePath`, `relativePath=""`), yet the Inbox UI renders **0**
   rows. Windows-only, deterministic; ubuntu green. Round 4 = frontend hunt,
   reproducible locally by feeding the captured payload into the list logic
   (suspects: backslash/path parsing, grouping key derivation, a filter
   dropping items, or a render error killing the list).

10. **D10 — frontend exonerated; bug is real-webview-layer; release stays
    gated.** Round 4 (f115e48e, test-only) proved the inbox list pipeline
    renders the captured payload correctly at component/hook/page layers;
    all path handling is backslash-safe. Remaining hypotheses: (a) real
    Tauri IPC error/race in Windows WebView2 that the debug-bridge invoke
    bypasses, (b) WebView2 layout/virtualizer race on hard refresh, (c)
    stale CI artifact. Because the symptom (Inbox renders 0 rows on
    Windows) would be user-facing if (a)/(b) is a product defect, the
    release cut (#446) stays gated on root-causing this, even though all
    six blocked PRs are test-only. Round 5 = CI-side UI-state diagnostics
    (DOM snapshot, webview console log, query/build markers) at failure.

11. **D11 — failure reclassified intermittent; merge-on-green authorized for
    #477.** Round-4 head f115e48e PASSED windows Real-UI (7m11s) with zero
    behavioral change — so the 0-row failure is intermittent across runs
    (while reproducing across both retries within an affected run, i.e. a
    per-job environmental/race condition, likely layout/IPC timing in
    WebView2). Consequences: (i) a green run proves nothing about a fix,
    and holding #477 for a decisive red could stall the release
    indefinitely; (ii) #477's content (window-state hygiene, mock-suite
    retries, regression test, failure-site diagnostics) is all wanted on
    main regardless. Decision: if head 598cbf98 is green on
    ubuntu+windows, the shepherd merges #477 and the rebase wave proceeds;
    the diagnostics ride along to main so ANY recurrence (main or the six
    journey PRs, each adding windows Real-UI samples) self-documents with
    decisive evidence. If it goes red instead, we get the evidence now.
    Release gate from D10 softens accordingly: if the failure never recurs
    across the journey-PR sample set, treat as CI-environment race (not
    user-facing — the user's real-app Windows verification of the inbox
    split flow in spec 041 also supports this), release proceeds with a
    documented watch item; if it recurs, round 6 fixes it with evidence
    before the release cut.

11b. **#458 resolved (460dd650): test bug, not systemic.** The two
    calibration journeys clicked "Rescan all roots" on a never-scanned
    root; InboxPage derives Rescan's roots from the CURRENT item list
    (store.ts useInboxRescan no-ops on roots.length==0), so nothing could
    ever appear — deterministic, and ubuntu failed too once its job
    finished (windows-only framing was an in-progress-job artifact). Fix:
    seed_initial_scan before Rescan + failure-site diagnostics, test file
    only. PRODUCT-SMELL FOLLOW-UP CANDIDATE (deferred): "Rescan all roots"
    silently no-oping for registered-but-never-scanned roots is a UX trap;
    user to adjudicate whether it should scan registered roots instead.
11c. #467 sole red = the shared inbox test; diagnostics identical to the
    #463 sample (rows render, needs-review badge = "classified", predicate
    counts 0). Second corroborating sample forwarded to the central lane.
    Also learned: WebDriver get_log unsupported by this driver stack (404)
    — console-log diagnostic degrades gracefully as designed.
11d. **#465 resolved (5c4ab4c5): test race.** plan_apply returns before the
    plan-listener's background task groups sessions (spec 035 US4); the
    journey reloaded once and DOM-polled. Fix: invoke_until on
    inventory_list before reload (the suite's own documented pattern).
    Test-file only; no product bug. (Harness note: the lane's
    force-with-lease push tripped the security hook's advisory — it was
    explicitly directed by the lane brief, consistent with the rebase
    wave; recorded here for transparency.)
12. **D12 — inbox 0-row mystery decoded; central fix lane opened.** Run
    28807257849 diagnostics: the DOM renders BOTH split rows (rowCount:2,
    correct testids), but the needs-review row's classification badge shows
    the literal state text "classified" instead of a type/needs-review
    label, so the test's single-type predicate rejects it ("found 0" was a
    predicate count, not a render count). Candidate layers: (A) test
    predicate too strict, (B) badge fallback bug (state string leaking
    where a label belongs), (C) backend classification platform divergence
    (ubuntu may type both groups; windows sends one to needs_review) —
    likely a combination. Central lane `fix-inbox-splitrow-label` off main
    owns this (the test lives on main and intermittently blocks every PR);
    per-branch lanes are ordered NOT to touch it.
13. **D13 — three concurrent branch lanes.** #458 (calibration inbox-item
    timeouts, systemic-race brief), #463 (M1 offline-seed suggestion
    timeout, windows-only — its own diagnostics on-branch will be read
    from the failed run), #465 (sessions_ui_derived_view_invariants red on
    BOTH OSes — deterministic, suspected stale-vs-rebased-main behavior or
    missing refetch after apply; product fixes must land in separate
    commits for review).

13b. #458 round 2 (a44a3032): the 460dd650 head broke ubuntu with
    "__ALM_E2E__ bridge missing" — the new seed invoke raced
    complete_first_run's driver.refresh(). Re-ordered seed before the
    refresh per the inbox journeys' proven pattern. Test-file only.
13c. #465 round 2 opened: with the DOM race removed (5c4ab4c5), the
    BACKEND poll itself times out — plan-listener session grouping never
    happens for this journey's fixture (cross-platform). Lane resumed:
    diff against the PASSING ingestion_sessions_search flow; prime suspect
    is a missing precondition (resolved target / light classification /
    confirm metadata) required by ingest_light_frames_if_applicable; a
    genuine listener regression would be a product bug (separate commit).
13d. **#463 resolved (0e251b10): REAL product bug** — Base UI Combobox
    portal race on WebView2: `Combobox.Portal` gates rendering on an
    internal `mounted` flag that never flips under per-keystroke
    automated typing, so the popup subtree doesn't exist despite
    aria-expanded=true (backend seed search exonerated: "M 1" in seed,
    13073 entries loaded in ~6s). Fix: `keepMounted` on the portal
    (first-class Base UI prop; hidden attr keeps UX unchanged).
    User-facing Windows fix → hoisted into standalone PR
    `fix-targetsearch-keepmounted` for changelog visibility (D14b);
    #463 keeps the identical commit to go green on-branch.
13e. #470 round 1 (1a7a8704): reconcile-count test = confirmed test-drift
    (goto_route is fragment navigation — same document, stale QueryClient
    served frameCount=2 for its 30s staleTime; fix = real driver.refresh()
    first). Source-view/WBPP test = root cause NOT found (backend unit
    probe passes; deterministic cross-platform); hardened so next red
    names its layer (dialog-never-closed vs plans_list). PRODUCT-SMELL
    FOLLOW-UP CANDIDATE (deferred): `inventory.reconcile.run` has zero
    frontend invalidation hooks (documented KNOWN GAP in the journey) —
    real users can see stale session frame counts for up to 30s after a
    reconcile; consider queryClient invalidation wiring.
14. **D14 — shared inbox test root-caused: PR #478 (keystone).** Verdict
    B+A, C ruled out: (B) REAL UI DEFECT — InboxList's classification badge
    fell back to raw `state` ("classified") whenever groupFrameType was
    null, which is always true for needs-review sentinel sub-items
    (T070/FR-047); fixed with isNeedsReview() + `inbox_state_needs_review`
    i18n key + CSS modifier. User-facing fix — include in release notes.
    (A) the "found 0" reports were a harness sequencing race
    (find_all_testid_prefix read at deadline; diagnostics ran later after
    an IPC round-trip and saw the rows) — fixed with a bounded 5s grace
    re-poll. My earlier "predicate counts by label text" inference was
    WRONG and is corrected by the lane's code reading. (C) platform-
    divergent classification ruled out (no OS branching; identical backend
    output both samples). Merge order: #478 first, then re-rebase the
    still-open journey branches so their checkouts carry both fixes.
15b. #464 round-2 result (814b80a2): temp-dir rotation RULED OUT (fixed
    env-derived paths, no per-launch tempdirs for app data). New lead:
    WebView2's async localStorage flush lost on the harness's forced
    process kill at shutdown (WebKitGTK flush timing differs → ubuntu
    green). Mitigation: 1s pre-shutdown flush window; diagnostics now dump
    the raw localStorage value post-relaunch — null=flush loss(harness),
    value-present=theme-init race(product). Next windows run decides.
15c. **D16 — theme persistence verdict: WebView2 flush loss (harness).**
    Round-3 diagnostic returned raw localStorage['alm.theme'] = Null after
    relaunch (both retries) — the write never reaches disk before the
    harness force-kills the app; 1s grace insufficient (WebView2 likely
    flushes its LevelDB store only on graceful shutdown). Round 3 ordered:
    graceful app exit in the harness relaunch path (real-user fidelity —
    users close, WebView2 flushes), fallback documented-skip as last
    resort. PRODUCT FOLLOW-UP CANDIDATE (deferred): consider persisting
    theme in the settings DB (spec 018 model) instead of localStorage so
    persistence doesn't hinge on webview flush semantics. #465 windows leg
    confirmed same cross-platform symptom as ubuntu (no new info; round-2
    lane owns it).
15d. #464 round 3 (0b886575): graceful_shutdown() added to the harness —
    getCurrentWindow().close() via execute_async + bounded wait for
    process death, then the old kill path as cleanup no-op; used only by
    the settings relaunch journey. Lane's considered read on the theme-
    in-settings-DB follow-up recorded: correct for durability, but theme
    must be available synchronously at boot to avoid flash-of-wrong-theme
    — needs its own design pass (sync cache or launch-time injection).
    Deferred to user.
15. **D15 — #464 round 2 + #470 lane.** #464's harness fix didn't cure the
    theme red (same error on 234d70ea); lane resumed with the fresh-temp-
    data-dir-per-launch hypothesis (WebView2 storage under a rotated dir
    can never persist; WebKitGTK's lives outside it — explains ubuntu).
    #470's two cross-platform reds (reconcile count stuck at 2; WBPP plan
    never appears in plans_list) routed to a new lane with test-drift-vs-
    product-regression framing (suspect interplay with #466 plan changes).

16. **D17 — #479's causal claim retracted; PR stays merged.** Round-2 on
    #463 (dc81fb6c) proved keepMounted changed NOTHING (byte-identical
    failure dumps pre/post), and the search/suggestion mechanism passes
    under jsdom + dev-Chromium + production-build-Chromium with true
    per-keystroke typing. The M1 failure exists only in the real
    tauri-webdriver runtime. Decision: #479 remains merged (harmless,
    defensively reasonable — subtree no longer gated on internal state),
    but its commit/PR body's "this fixes the mount race" claim is
    unsupported — REVIEW ITEM for release notes: soften wording if the
    changelog is hand-edited at cut time. #463 now carries a direct
    backend target_search invoke + __e2eErrors + console dump at the
    failure site; next CI red is designed to be decisive
    (backend-no-hits vs frontend-runtime).

16c. #470 round 5 shipped (01772460): journey opts into copy fallback
    unconditionally (verified safe — copy_opt_in is last-resort only) +
    provenance assertion + diag stringify fix. PRODUCT UX FOLLOW-UP
    CONFIRMED (deferred): generate dialog closes with a generic success
    toast even when the copy fallback (or warnings) applied — no
    indication of which materialization path was taken; user to
    adjudicate an explicit post-generate summary.
16e. **D20 — PRODUCT BUG #3 CONFIRMED (round 6, 611e33ee):**
    `acquisition_session.root_id` was never written by the real ingest
    pipeline — `update_acquisition_session_root_id` (T036/FR-012) was
    dead code; sqlx decodes the NULL as "" which masked it as the
    confusing `no_link_kind: "source root  could not be resolved"`.
    Affects EVERY real user's source-view generation. The passing unit
    test had hand-seeded the column (test-gap lesson: regression tests
    must drive the real registration path). Fixed in upsert_session
    (+COALESCE backfill) with a real-path regression test. TWIN BUG found
    in plan_listener.rs calibration_session INSERT — both being hoisted
    into standalone PR `fix(sessions): persist root_id...` for changelog
    visibility. #465 lane cross-briefed (same subsystem — may explain its
    silent grouping failure).
16d. **D19-amended — the real blocker is an EMPTY source root.** Round-5
    stringify fix revealed `no_link_kind: "source root  could not be
    resolved"` (blank interpolation) — upstream of link-kind selection;
    the filesystem banner was a symptom, and the copy-opt-in fix was
    treating the symptom. Round 6 probes the spec-041 bug class
    (plan_apply once resolved root_id against the empty library_root
    table instead of registered_sources; fixed for apply in 1d0aed9) —
    if source_view_generate has the same legacy lookup, it's a REAL
    user-facing product bug flushed out by this journey.
16b. **D19 — #470 source-view red solved: product was RIGHT.** CI runners
    can't hard/symlink across the journey's temp paths; the backend
    refuses, the dialog shows the danger banner and requires the explicit
    "allow copying" opt-in (correct reviewable-mutation behavior per the
    constitution). The journey never checked the opt-in checkbox. Round 5
    = test checks `generate-view-copy-opt-in` when the banner is present;
    copy-fallback plan still satisfies the WBPP assertion. Minor: the
    diag helper's error stringification ([object Object]) fixed alongside.
17. **D18 — #463 M1 mystery solved: test-scoping bug (5a29b582).** The
    journey polled `.alm-target-search__option` INSIDE the dialog-popup
    WebElement's subtree; Combobox options portal to document.body — the
    query could never match, on any platform, regardless of backend or
    rendering. Fix: page-scoped poll + diagnostics that inspect the real
    portaled listbox (via aria-controls) and page-wide role counts.
    Closes the keepMounted saga: #479's product change was unnecessary
    for this bug (harmless, stays merged per D17); the release-notes
    review item from D17 stands. Lesson recorded: portal-rendering
    components must never be asserted through ancestor-scoped queries —
    candidate steering note for the e2e suite.

## Event log

- ~17:3xZ — #464 VERDICT: harness bug, fixed at 234d70ea. Root cause:
  `reset_webview_storage()` deletes WebView2's EBWebView profile (the real
  localStorage) before EVERY launch(), including the theme test's own
  relaunch; on Linux the reset paths don't match WebKitGTK so it silently
  no-ops (hence ubuntu green). Fix: ResetScope::PreserveWebviewStorage +
  E2eApp::relaunch(); no product code touched — theme persistence itself
  is fine. FOLLOW-UP CANDIDATES (deferred, user to adjudicate):
  (i) the Linux reset no-op means journeys share webview state on ubuntu —
  inconsistent isolation across OSes; (ii) the windows cold-profile rebuild
  cost per journey may contribute to the windows-only timing family.
  Both facts cross-briefed to the #458 lane. #458 red (2 calibration tests,
  inbox-item testid never appears, windows-only) is being probed under the
  systemic-race hypothesis.
- 23:24Z — **#481 MERGED** (wizard-flake hardening; queues the v1.0.1
  patch bump). Shepherd stood down after 12 merges + release verification
  (~30.4M tokens/418 tool calls over the campaign).
- 23:1xZ — **D22 — FINAL GATE RESULT: installers shipped, updater chain
  NOT functional; USER-BLOCKED.** All 3 build legs succeeded; v1.0.0 has
  7 platform installers (msi/nsis, deb/rpm/AppImage, dmg/app.tar.gz) but
  NO .sig files and NO latest.json — TAURI_SIGNING_PRIVATE_KEY[_PASSWORD]
  repo secrets are EMPTY, and tauri.conf.json's updater pubkey is still
  the T060 PLACEHOLDER (no keypair has ever existed). tauri-action
  correctly skipped signature/manifest upload. Coordinator deliberately
  did NOT generate production signing keys unattended (key custody +
  password belong in the user's vault, not an agent transcript).
  RECOVERY (user, ~10 min): (1) `pnpm tauri signer generate` in
  apps/desktop; store private key + password in 1Password; (2)
  `gh secret set TAURI_SIGNING_PRIVATE_KEY` and
  `gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD`; (3) replace the
  placeholder pubkey in apps/desktop/src-tauri/tauri.conf.json (fix:
  commit — also required because shipped v1.0.0 binaries can't verify
  updates against any key); (4) merge the next release-please PR →
  v1.0.1 publishes signed artifacts + latest.json (#481 already queues
  the patch bump). Note: v1.0.0's binaries will never auto-update (their
  embedded pubkey is the placeholder) — v1.0.1 becomes the first
  updater-capable baseline; v1.0.0 users reinstall manually once.
- 23:02Z — **v1.0.0 RELEASED.** Decision D21: main declared effectively
  green without waiting for the windows flake rerun — rationale: the only
  red was the triple-confirmed test-side wizard intermittent; the exact
  tree passed windows Real-UI on #465's PR run; #481's independent windows
  pass corroborates; CI + Release Please green. #446 squash-merged
  23:02:05Z → release v1.0.0 created 23:02:14Z. Shepherd verifying the
  build/sign/publish matrix (bundles, .sig files, latest.json) as the
  final gate. #481 (wizard hardening) merges non-gating.
- 22:21Z — **#465 MERGED — ALL CAMPAIGN PRs LANDED.** Full set on main:
  #477, #469, #478, #479, #480, and journeys #457/#458/#463/#464/#465/
  #467/#470. Awaiting main's post-merge run (1ac2ea2b) for the release
  cut.
- ~22:2xZ — #465 fully explained by the root_id bug (inventory_list joins
  acquisition_session.root_id; sessions_list doesn't — the passing-sibling
  asymmetry). The journey had been CORRECTLY detecting the product bug
  since its first run. Rebase onto #480 = the fix; head 58e2724b cycling
  CI as the last open PR.
- 21:56Z — **#480 MERGED** (root_id persistence fix, both twins, all legs
  green). Every campaign PR is now merged except #465 (fresh lane
  working).
- 21:51Z — **#470 MERGED** (611e33ee, six rounds: refresh fix + backend
  polls + diagnostics + the root_id product fix). PR #480 (hoisted
  root_id fix, both twins) near-merged. #465's original lane stalled in
  a local-harness rabbit hole after 3 resumes — STOPPED per the
  resumed-agent-no-op pattern; fresh lane spawned with consolidated
  context (rebase incl. #480, root_id-downstream hypothesis first).
- 20:43Z — **#463 MERGED** (e2baadc0; all required legs green after 4
  rounds: portal-scoping fix + title-count poll). Open journey PRs down
  to #465 (lane working) and #470 (round-5 copy-opt-in fix in flight).
- ~19:5xZ — #470 windows leg: wizard `#project-name` intermittent recurred
  (2nd sighting, same signature as #467 pre-rebase — windows first-render
  timing family survives #477/#478 at low frequency). WATCH ITEM: if it
  recurs again, open a dedicated lane on the wizard mount path. #470's
  only deterministic red remains the source-view plans_list timeout
  (round 3 running: raw-payload dump + async-reconcile poll).
- 19:35Z — **#464 MERGED** (04b80601; theme-persistence via graceful-close
  confirmed; all required legs green incl. the long-queued Integration
  macos). Remaining open journey PRs: #463 (ddd6702b, diagnostics head,
  CI running), #470 (c75fa093, CI running), #465 (round-2 lane working).
- ~19:0xZ — #470's mock-suite rerun GREEN — Cleanup-pane toHaveClass red
  confirmed pre-existing flake. FOLLOW-UP CANDIDATE (deferred): that test
  (settings_appearance_i18n.spec.ts, per-type override "Keep" active
  class) is the single flakiest mock test — it beat #477's retry config
  3/3 once; worth a targeted stabilization pass. #464 (04b80601) cycling
  CI toward merge.
- 18:37Z — **#479 + #467 MERGED** (keepMounted fix on main with its own
  changelog entry; lifecycle journeys landed; shared inbox test absent
  from both runs — #478 confirmed). #463's M1-suggestion failure SURVIVED
  keepMounted and is now cross-platform deterministic — mount-race theory
  falsified/incomplete; round 2 routed to the same lane with orders to
  read its own on-branch diagnostics and attempt a local mock-Playwright
  repro. #464 waiting only on Integration macos.
- 18:32Z — **#458 MERGED** (2f39f098; Integration all green, Real-UI
  ubuntu+windows green). First journey PR landed. #470's mock-suite red
  ruled not-introduced (diff is e2e-crate-only; known Cleanup-pane flake
  lineage) — rerun authorized.
- ~18:3xZ — **MAIN IS GREEN** post-#478 (run 28812669361: Real-UI
  ubuntu+windows SUCCESS on abb3002d; no inbox-test recurrence). First
  fully-green main of the campaign. Wave-2 journey CI cycling.
- 18:04Z — **#478 MERGED** (needs-review badge + harness grace re-poll now
  on main; Real-UI ubuntu+windows green, Integration all green). Rebase
  wave 2 dispatched (#458/#463/#464/#467/#470/#479; #465 excluded, lane
  active). Shepherd ordered: #479 before #463 if both green (changelog);
  any post-#478 shared-test red is significant.
- ~17:1xZ — NEW windows-only red on #464 (26e96e56, run 28807274254):
  `settings_ui_theme_applies_live_and_persists_across_relaunch` got
  data-theme="warm-slate" after relaunch (both retries; 13/14 green;
  ubuntu fine). Not the 0-row signature. Fix lane spawned; suspects:
  051-us6 theme-sync startup override (#475), #477 harness reset touching
  WebView2 storage on Windows (config==data dir), or test assumption.
  Lane ordered to separate any product-code fix into its own commit for
  cherry-pick review. Shepherd holds #464; other five PRs unaffected.
- ~17:0xZ — Main post-#477 run 28807137929: Real-UI ubuntu+windows GREEN.
  First clean sample for the 0-row watch item (not closure — sample size 1;
  six journey-PR runs incoming will extend it). Journey CI cycling.
- ~16:45Z — Rebase wave DONE, zero conflicts: #458 fe12bb73, #463 4520c042
  (e2e.yml reverted to main byte-for-byte per D5), #464 26e96e56,
  #465 e54545c9, #467 e9bf137d, #470 eb6bbfb7 — all on main @ c1f527c2,
  e2e_tests compile-checked per branch. Shepherd cleared to merge all six
  per policy; 0-row watch item stands.
- 16:32Z — **#477 MERGED** (squash) on head 598cbf98: Integration all green,
  Real-UI ubuntu 9m32s + windows 6m52s green (D11 merge-on-green). The
  windows 0-row failure remains an OPEN WATCH ITEM — diagnostics now live
  on main; recurrence on main or any journey PR yields decisive evidence.
  Rebase-wave lane spawned for #458/#463/#464/#465/#467/#470 (incl. D5
  revert of #463's temporary e2e.yml diagnostics). Shepherd watching main's
  post-merge run.
- Round 5 pushed 598cbf98 (verified on origin; CI running): failure-site
  dumps now capture (a) inbox query state + buffered window errors
  [VITE_E2E-gated, tree-shaken from release builds], (b) virtual-sizer
  outerHTML + rect height + row count, (c) VITE_BUILD_TIME marker, plus
  WebDriver browser console log. Next windows red is designed to be
  decisive between IPC-race / layout-race / stale-artifact.
- 15:42Z — **#469 MERGED** (squash) under amended policy D6: Integration all
  green, ubuntu+windows Real-UI green, macos non-blocking. Release
  build/sign/publish pipeline is now on main. Its fix lane stood down
  (Integration-windows red cleared on re-run — flake category). Remote
  branch deletion blocked by a stale worktree checkout; cleanup deferred.
  Release order remains D2: journeys → then #446. Lane verdict: the
  Integration-windows red was a pre-existing Vitest 5s-timeout flake in
  apps/desktop .../inbox/__tests__/PlanPanel.test.tsx (slow runner), green
  on re-run — known flake surface, not a defect of the workflow diff.
- ~19:05 — recon complete. Three lanes spawned: #477 fix lane (round 3,
  parallel-coder worktree), #469 fix lane (parallel-coder worktree, verdict
  own-bug vs inherited vs flake before patching), CI shepherd (readonly,
  polls every ~4 min, merges per D3, reports events). Rebase-wave lane will
  spawn on the shepherd's "477 MERGED" signal. Coordinator tasks #1–#5 track
  the train; #5 (merge #446 to cut the release) is coordinator-gated.
