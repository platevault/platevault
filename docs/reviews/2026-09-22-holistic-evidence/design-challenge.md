# Independent design challenge

Model exposed: openai-codex/gpt-6-astra. Requested role: @max; an independent role selector is not exposed. This is a holistic snapshot review, not a patch-introduction assessment. All citations below are relative to the permitted worktree. No files were written; no application, tests, builds, linters, formatters or validation ran. A read-only git diff --stat returned no changes. Rendered appearance, actual focus fallback, assistive-technology output and clipping remain unverified.

## UX-01 — ACCEPT, P2

The two direct archive mutations lack a user-visible failure path. ArchivePage.tsx:127-130 sends to trash without callbacks; :191-196 supplies only permanent-delete success handling. Both hooks in features/archive/store.ts:119-141 invalidate on success and omit onError. The page's error UI at ArchivePage.tsx:279-302 consumes the list-query error, not either mutation error. The IPC helpers at store.ts:39-49 call unwrap; api/ipc.ts:120-137 throws the error rather than notifying the user. data/queryClient.ts:15-25 installs no global mutation-error handler. Consequently a rejected mutation resets pending without explanatory feedback.

Counterevidence inspected: restore generation has an explicit error toast at ArchivePage.tsx:153-170; reveal also catches errors. ArchivePage.test.tsx:73-80 fixes destructive isPending to false, :179-210 exercises invocation/typed confirmation, and :338-359 covers restore errors—not these destructive failures. This narrows the finding to trash and permanent delete, not all Archive operations. Remaining verification: separately reject both operations against disposable data; observe visible/announced errors and retry behavior.

## UX-02 — ACCEPT, P2, with narrower consequences

The footer-only pending restriction is bypassable. ArchivePage.tsx:122-125 closes and clears confirmation unconditionally, while :318-334 disables footer controls during deletion. Modal.tsx:143-159 routes Escape/backdrop to onClose and :176-179 provides the header close. RemapRootDialog.tsx:84-107 continues applyRootRemap independently of dismissal; :115 disables Cancel but DataSources.tsx:239-242 passes an unconditional state-clearing callback. Thus closing hides non-cancellable work and, for a rejected remap, its only inline error surface.

Counterevidence: DataSources.tsx:99-112 guards other destructive close handlers. PlanReviewOverlay.tsx:227-228,263-279 guards its busy close path. RemapRootDialog.test.tsx:172-259 covers normal apply, post-preview invalidation and verification failure, not dismissal while pending. Source-view generation shares the disabled-Cancel inconsistency at GenerateSourceViewDialog.tsx:110-132, but its success and failure toasts at :87-102 provide outcome feedback even after closure. Do not claim all three flows lose all completion/error feedback, or that clicking close actually cancels a backend request. Remaining verification: hold each request pending, use Escape/backdrop/header close independently, then resolve or reject and inspect surviving feedback.

## UX-03 — DOWNGRADE, P3 pending runtime proof

The application's explicit invoker capture is indeed skipped for initially-open mounts: Modal.tsx:127-134 initializes wasOpen from open and captures only a transition; :164 passes a callback returning the still-null invoker. GenerateSourceViewDialog.tsx:67,110-112 and RemapRootDialog.tsx:59,104-107 mount the Modal only when already open. ProjectDetail.tsx:458-465 independently conditionally mounts generation. Modal.test.tsx:46-70 tests only the continuously mounted false-to-true pattern.

However, a null explicit target does not by itself prove actual failure to return focus. The report expressly leaves Base UI fallback behavior unverified; this challenge also has not established that behavior for the pinned @base-ui-components/react 1.0.0-rc.0 dependency (apps/desktop/package.json:49). Shared dialog initial focus, Escape and containment have tests at Modal.test.tsx:19-43,79-135, though none was run. Retain the missing-capture concern visibly, but reduce severity until a keyboard reproduction proves the user-visible consequence. For remap launched through a menu, the appropriate surviving return target may be the menu trigger rather than an unmounted menu item. Remaining verification: keyboard-open both production dialogs, dismiss each route, inspect activeElement and surviving trigger; separately test successful handoff to plan review.

## UX-04 — ACCEPT, P2

CommandPalette.tsx:249 disables cmdk filtering globally, but :287-331 renders all static pages/actions for every query. Only remote targets/global entities are searched at :170-203. Therefore typing a page/action label cannot narrow static commands. This is a genuine expert-search defect; exact first-selection/Enter behavior remains unverified rather than guaranteed to select Sessions.

Counterevidence: preserving server-filtered alias-only target matches is intentional and justified at CommandPalette.tsx:40-48. CommandPalette.test.tsx:361-405 exercises the alias-only case; :323-340 exercises empty-query keyboard navigation. A fix must not simply enable indiscriminate client-side filtering and drop alias results. Existing tests inspected cover route validity, debounce, basic focus/navigation and aliases, not static-query filtering. Remaining verification: search Settings and Create project in en-GB and pt-BR, nonsense input and alias-only entities; inspect candidate set and Enter selection after async results arrive.

## UX-05 — ACCEPT, P2, rejecting the definitive empty-message claim

CommandPalette.tsx:170-203 has no current-query pending/error state. For a non-empty query replacement it retains the old results until the new Promise.all settles; those rows remain enabled and select their old routes at :267-284. Either promise's rejection clears both result sets with no error indicator. The abort guard prevents older responses from overwriting newer state, but is not request cancellation and does not prevent selection of already-visible stale rows.

Correction: the report cannot establish that cmdk's Command.Empty at :258-263 actually displays its no-results sentence. Static pages/actions always remain registered, and cmdk controls Empty visibility internally. Phrase the established failure as missing loading/error feedback plus selectable previous-query results, not a proven displayed false no-results message. CommandPalette.test.tsx:129-160,361-422 covers debounce/alias delivery but not delayed replacement or independent search failure. Whether preserving partial results is desired is a product decision, not separately proved bug. Remaining verification: delay replacements, reject each source independently and press Enter/click a prior-query row while pending; inspect actual Empty and status announcements.

## UX-06 — ACCEPT, P2

PlanReviewOverlay.tsx:446-447 renders item.action directly; :474-487 renders non-pending item.state directly. These rows are passed to the shared Table at :619-628. The adjacent column headings and protection labels use message lookups, so the safety vocabulary is not localized by its surrounding context. CommandPalette.tsx:277 likewise renders r.kind directly. Locale switching and document-language synchronization at data/locale.tsx:234-239,298-318 cannot translate raw strings. project.inlang/settings.json:3-4 confirms en-GB and pt-BR, so pt-BR is the concrete second-locale target, not an invented locale.

Counterevidence: pending results intentionally use localized common_none, protection labels are localized, and a delete destination has localized explanatory text at PlanReviewOverlay.tsx:453-464. Do not claim every safety instruction is untranslated or that raw paths should be translated. P2 is justified by mixed-language filesystem action/outcome review; the palette-kind portion alone is lower consequence. No dedicated localization test for these cells was established. Remaining verification: render a mixed plan in pt-BR before and after success/failure/skipping, including protected/delete rows, and inspect palette entity-kind labels.

## UX-07 — ACCEPT, P2

ResizeHandle.tsx:16-25 renders a non-focusable separator with only onPointerDown. useAdaptiveDock.ts:127-146 listens only to pointer movement/up; the actual ListPageLayout.tsx:337-343 consumer passes no keyboard path. The hook exposes setWidth but this consumer does not provide an alternate width control. Consequently keyboard users cannot perform the width adjustment available to pointer users.

Counterevidence: ListPageLayout.tsx:346-357 offers Auto/Bottom/Right placement, which is a useful workaround for presentation but not an equivalent adjustable width control. The separator already has a label and orientation; the defect is operation, not complete absence of semantics. No dedicated resize-keyboard test was found by the scoped test lookup. Remaining verification: at a wide window, Tab through the dock, inspect its accessibility tree, then verify arrow resizing, bounds, focus appearance and persistence after correction. No WCAG conformance or rendered focus-ring claim is made here.

## UX-08 — ACCEPT, P2

The stored width is read directly at useAdaptiveDock.ts:83-85. Window resize updates only windowWidth (:89-92); clamping is confined to setWidth (:94-108). The returned width at :150-155 can therefore exceed the current window. A pinned side remains selected at :120-125. The consumer injects that width at ListPageLayout.tsx:306-310 and ListPageLayout.css.ts:78-88 uses a nonshrinking flex basis and explicit width, while :18-30 bounds overflow and permits the main region to shrink to zero. The native minimum is 1100×720 (src-tauri/tauri.conf.json:16-20).

Counterevidence: dragging clamps to half the current window, Auto falls back to bottom under its threshold, and below 640 pixels a side override is no longer honored. Those guards do not protect pinned Right at the supported native minimum. Thus a 1200-pixel preference saved at 2560 pixels remains oversized after shrinking/reopening at 1100 pixels. Actual clipping and exact remaining table geometry are still unverified, not measured. No focused window-resize regression test was established. Remaining verification: pin Right at 2560, set width 1200, shrink to 1100, reopen there, then expand again; compare Auto and sidebar states without overwriting the large-screen preference unless deliberately specified.

## UX-09 — ACCEPT, P3, documentation-only

DESIGN.md:35-48 describes obsolete navigation; current Sidebar.tsx:68-125 exposes Inbox/Archive and no standalone Plans/Audit entry. DESIGN.md:126-155 instructs editing tokens.css and uses --alm ownership conventions, while styles/tokens.css:1-3 explicitly declares generated output from apps/desktop/tokens and :56-114 uses --pv tokens. The token-authoring instruction is demonstrably stale, not merely an alternative visual aspiration. DESIGN.md:144-147 also attributes table/dock interaction to libraries not used by the inspected custom Table/useAdaptiveDock implementations.

Counterevidence: the document says tokens.css wins when illustrative values drift, but then tells contributors to edit that generated file. Its sound product principles need not be replaced merely because implementation differs. package.json token scripts at apps/desktop/package.json:28-32 identify the actual build/check/type-generation entry points. No user-facing runtime defect or requirement to restore old navigation is inferred. Remaining verification: a source-to-design reconciliation covering token ownership, actual nav and primitive ownership; no build is required for that editorial decision.

## Material omission — separately identified, not added to the nine-finding tally

Remap verification can be repopulated with a stale path after the user edits the field. RemapRootDialog.tsx:61-65 clears verification on edit, but :68-81 unconditionally installs the outstanding request's result. The DirPicker remains editable while verifying (:147-153), and ui/DirPicker.tsx:49-57 has no disabled guard. Sequence: request verification for A; type B while waiting; response for A arrives; applying becomes available once verifying resets; handleApply uses verification.newPath at RemapRootDialog.tsx:84-96, not the visible B field. This defeats the report's stated stale-preview protection. The existing RemapRootDialog.test.tsx:214-241 tests editing only after verification has completed, so it does not cover this ordering. Proposed independent priority: P2. Remaining verification is a controlled delayed-response interaction; backend effects and cross-root variants were not audited. This is a source-established omission, not a runtime-tested failure.

## Exact render targets and launch commands

All are proposed, not executed. Use disposable fixtures and provisioned dependencies only.

• Archive, selected archived project and master: typed DELETE empty/wrong/correct; pending, rejected and successful delete/trash; all dismissal routes. Include empty, filtered-empty and list-error states.
• Settings → Data Sources → Remap: keyboard open/close, verify pending, edit path during pending, apply pending, rejection, reopen; compare guarded disable/delete confirmations.
• Projects → selected project → source-view generation: keyboard dismissal, pending generation, error toast and successful plan-review handoff.
• Shared plan review: mixed actions, protected rows, deletion acknowledgement, long paths, zero-item diagnostic, pending/running/partially-applied/failed/skipped outcomes in en-GB and pt-BR, at 1100×720.
• Command palette: empty query, Settings, Create project, Caldwell 20 alias, nonsense, slow query replacement and independent search failures; inspect actual selection, Empty, focus and announcements.
• Sessions/Projects selected detail: 1280×820 default, 1440×900, 2560 wide then 1100×720; expanded/collapsed sidebar, Auto/Bottom/Right, large saved width, keyboard-only operation, all density settings and larger text/zoom.
• All shipped themes plus reduced-motion preference: inspect modal, toast, spinner, table/detail scroll ownership and expert-density legibility. reset.css:73-85 provides a real reduced-motion rule, but visual/JS-motion completeness is not established. TableStateGate.tsx:76-94 distinguishes loading/error/empty/filter-empty; do not recast these implemented states as absent.

Repository-proven commands: from repository root, VITE_USE_MOCKS=true pnpm desktop:dev (package.json:17; apps/desktop/package.json:7; vite.config.ts:15-22,56-63), then http://127.0.0.1:5173. Native: pnpm --dir apps/desktop tauri dev (README.md:100-105; tauri.conf.json:6-10). Development tools: just tauri-dev (justfile:198-203); this does not itself open the optional MCP bridge. Components: pnpm --filter @astro-plan/desktop storybook (apps/desktop/package.json:44), port 6106. These are source-backed, not startup-proven; Vite can generate ignored locale artifacts and native startup compiles code, so none is permissible during this read-only assignment. Mock startup does not prove all requested failure fixtures exist.

## Prioritized roadmap and limitations

First address archive failure feedback and non-cancellable-operation continuity (UX-01/02), and investigate the independently identified remap stale-preview ordering. Next protect supported-window docking and keyboard width control (UX-08/07). Then fix palette static filtering/current-query feedback (UX-04/05) and safety-label localization (UX-06). Reproduce actual focus fallback before elevating UX-03; reconcile the design document without rolling back current UI (UX-09).

No backend filesystem atomicity, authorization, recovery, real data, production performance, full translation coverage, contrast or accessibility certification was assessed. Test source supplies intended coverage only, not passing-test evidence. No additional design-severity claim is inferred from filenames or unrendered visual taste. There are no fully rejected numbered findings; rejected subclaims are explicitly retained in UX-02 and UX-05. Overall snapshot verdict is incorrect because multiple operational UX defects remain, independent of the documentary and unverified-focus items.

| ID | Verdict | Severity |
|---|---|---|
| UX-01 | ACCEPT | P2 |
| UX-02 | ACCEPT | P2 |
| UX-03 | DOWNGRADE | P3 |
| UX-04 | ACCEPT | P2 |
| UX-05 | ACCEPT | P2 |
| UX-06 | ACCEPT | P2 |
| UX-07 | ACCEPT | P2 |
| UX-08 | ACCEPT | P2 |
| UX-09 | ACCEPT | P3 |

Totals: 8 accepted, 1 downgraded, 0 rejected; 9 numbered findings challenged. The separate remap omission is excluded from these totals.
