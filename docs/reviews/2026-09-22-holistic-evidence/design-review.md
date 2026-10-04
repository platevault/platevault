# Desktop UX/design source review

## Scope and evidence

Model identity exposed by the harness: `openai-codex/gpt-6-astra`. Requested role: `@max`; the harness does not expose an independently verifiable role selector.

This review covers the supplied snapshot, using read-only source inspection. No tests, builds, formatters, linters, database operations, server startup, browser sessions, or native-app sessions ran. All proposed reproducers and verification steps below remain unexecuted. Visual appearance, computed contrast, actual focus behavior, clipping and assistive-technology output are **unverified**. Findings distinguish deterministic source defects from their runtime consequences.

The structured file inventory lists inspected files; large files were read in relevant ranges, not exhaustively. Additional targeted reads covered `lib/useHotkeys.ts`, `lib/lifecycle.ts`, `features/projects/ProjectDetail.tsx` call-site matches, and `features/inbox/InboxDetail.tsx:198-223` feedback behavior. No existing graph artifact was found in the scoped graph-path lookup; no graph generation was attempted.

## Concrete strengths

- **One review surface exposes operational detail.** `features/plans/PlanReviewOverlay.tsx:425-502,600-739` renders source/destination, protection, link kind, per-item results and failure reasons, with protection acknowledgement, destructive confirmation and running/paused recovery controls. This is substantive expert information, not just a confirmation prompt.
- **Destructive actions have explicit gates.** `features/archive/ArchivePage.tsx:191-196,318-354` requires the typed DELETE token before permanent deletion. The shared plan overlay refuses closing while its busy predicate is true (`PlanReviewOverlay.tsx:231-232,263-279`). Data Sources explicitly guards close callbacks during disable/delete (`DataSources.tsx:99-112`). These are useful counterexamples to UX-02.
- **Navigation has accessible structure.** `app/Sidebar.tsx:65-125,157-183` groups Capture/Library/Work and gives collapsed navigation accessible labels and active-page state. The collapse action preserves the rail rather than removing navigation.
- **Dense tables have keyboard affordances in source.** `ui/Table.tsx:29-83,217-263` supports row activation, Up/Down and Home/End. `ProjectsTable.tsx:193-207` puts sort state on table headers through the shared sort helpers. `SessionsTable.tsx:352-394` uses a bounded virtualized viewport. These mechanisms still need keyboard/AT verification.
- **Loading and empty states are explicitly distinguished.** `components/TableStateGate.tsx:76-94` separates initial loading, error, filter misses and true emptiness. It keeps existing rows through a refetch when data remains available. Archive supplies different empty/filter-empty content (`ArchivePage.tsx:279-302`).
- **Motion and local-first typography are addressed centrally.** `styles/reset.css:73-85` reduces CSS animation/transition durations and disables smooth scrolling under reduced motion. `styles/tokens.css:1-50` bundles Inter locally; semantic tokens, density and shared motion durations are declared at `:56-114`. No contrast or visual-quality verdict is inferred from those declarations.

## Findings

### UX-01 — P2 · High confidence · Defect: archive destructive failures have no user-visible error path

**Evidence:** `apps/desktop/src/features/archive/ArchivePage.tsx:127-130,191-196,228-248,311-354`; `apps/desktop/src/features/archive/store.ts:119-141`; `apps/desktop/src/data/queryClient.ts:15-25`.

**Trace:** Send to Trash calls `mutate` without an error callback. Permanent Delete supplies only an on-success close callback. Both hooks invalidate the archive list on success but define no on-error feedback. The page does not render either mutation's error. The shared QueryClient supplies query defaults, not a global mutation-error notification mechanism.

**Impact:** Permission denial, offline storage or backend refusal can return the UI to an enabled action with no explanation. For permanent deletion, the confirmation remains open without distinguishing a rejected attempt from an untouched operation.

**Counterevidence:** Restore-plan generation explicitly emits an error toast (`ArchivePage.tsx:153-170`), and the plan overlay renders apply errors. The defect is specific to the two direct archive mutation paths.

**Recommended fix:** Render localized mutation errors beside the affected action/confirmation, announce them, and preserve enough context to retry safely. Reuse existing error formatting rather than exposing raw exception objects.

**Verification still needed:** Reject each IPC request separately; confirm visible and announced errors, correct pending reset, and a successful retry without duplicate mutation.

### UX-02 — P2 · High confidence · Defect: pending destructive/remap work can be dismissed despite disabled Cancel

**Evidence:** `apps/desktop/src/features/archive/ArchivePage.tsx:122-125,311-334`; `apps/desktop/src/features/settings/RemapRootDialog.tsx:78-96,104-135`; `apps/desktop/src/components/Modal.tsx:143-159,176-179`.

**Trace:** The permanent-delete modal disables its footer Cancel during `isPending`, but `closeDeleteModal` is unconditional. Modal Escape, backdrop and header-close paths invoke that same callback. Remap similarly disables Cancel during apply while passing an unguarded `onClose` to Modal. Source-view generation has the same inconsistency at `GenerateSourceViewDialog.tsx:110-132`.

**Impact:** Users can hide an irreversible deletion or root-remap request while it continues. Dismissal can imply cancellation even though the underlying request is not cancelled; later outcome/error context becomes harder to follow.

**Counterevidence:** Data Sources and PlanReviewOverlay already guard the close callback itself, covering every dismissal route. This demonstrates an existing convention to reuse.

**Recommended fix:** Guard the controlling close handler for the non-cancellable phase, or explicitly allow background continuation with durable progress and completion/error feedback. Do not rely only on disabling a footer button.

**Verification still needed:** Hold each request pending and try Escape, backdrop, header close and Cancel separately; resolve/reject afterward and inspect outcome visibility.

### UX-03 — P2 · High confidence in source cause · Defect: conditionally mounted modals never capture their invoking control

**Evidence:** `apps/desktop/src/components/Modal.tsx:127-134,164`; `apps/desktop/src/features/projects/GenerateSourceViewDialog.tsx:67,110-112`; `apps/desktop/src/features/settings/RemapRootDialog.tsx:59,104-107`; `apps/desktop/src/features/projects/ProjectDetail.tsx:458-462`; `apps/desktop/src/components/Modal.test.tsx:46-70`.

**Trace:** Modal initializes `invoker` to null and `wasOpen` to the current `open` prop. It captures `document.activeElement` only when `open !== wasOpen`. A newly mounted `<Modal open>` therefore skips capture, and supplies `finalFocus={() => null}`. GenerateSourceViewDialog and RemapRootDialog both return no Modal while closed, then mount it already open. The inspected return-focus test covers a continuously mounted Modal whose `open` flips false→true, not this production pattern.

**Impact:** The intended focus-return target is absent after closing these dialogs. Exact fallback behavior depends on Base UI and the browser and is **unverified**, but the application's explicit restoration mechanism cannot work for this mount pattern.

**Recommended fix:** Capture the invoker on the initial-open mount as well as the closed→open transition, or provide the invoking ref explicitly. Preserve the existing controlled-modal convention without forcing every feature to invent focus logic.

**Verification still needed:** Open each dialog from the keyboard, close through every route, and assert focus returns to the same surviving trigger. Include conditional mounting and stacked plan-review handoff.

### UX-04 — P2 · High confidence · Defect: command-palette search does not filter navigation or actions

**Evidence:** `apps/desktop/src/app/CommandPalette.tsx:73-96,249,287-331`.

**Trace:** `Command` receives `shouldFilter={false}`. Only remote entity results are searched. Pages and actions are always mapped directly into the list without query filtering or ranking.

**Proposed reproducer:** Open Ctrl/Cmd+K and enter the localized word for Settings, or enter a nonsense string. Sessions, Calibration, Targets, Projects and unrelated actions remain candidates. A page-only match is not promoted through an explicit filtering path.

**Impact:** The keyboard command interface does not narrow its static choices as the user types. Selecting the first item can navigate somewhere unrelated to the query. This undermines the expert-density benefit of a palette.

**Recommended fix:** Filter/rank static pages and actions by their current localized labels while retaining deliberate backend ranking for entity results. Ensure item identity and selection remain stable as result groups change.

**Verification still needed:** Page-only, action-only, entity-only and no-match searches in English and a second locale; verify first selection and Enter behavior after asynchronous results arrive.

### UX-05 — P2 · High confidence · Defect: command-palette loading and failures are presented as no results or stale results

**Evidence:** `apps/desktop/src/app/CommandPalette.tsx:170-203,258-266`.

**Trace:** A non-empty query waits 200 ms before a `Promise.all` search. No loading/error state exists. The catch replaces results with an empty list. Existing results are not cleared when one non-empty query changes to another, so the prior query's results remain selectable until the replacement resolves. Failure of either target or global search removes both sets.

**Impact:** A backend error is indistinguishable from a genuine no-match, and a user can act on results from a previous query. The empty-state text can also misrepresent the initial debounce/pending period; exact cmdk Empty visibility needs runtime confirmation.

**Counterevidence:** Abort signalling correctly prevents superseded requests from overwriting newer results. That protects response ordering, not the stale visible-result interval.

**Recommended fix:** Track pending/error state for the current query, associate results with that query, and deliberately choose whether old results remain visible but unavailable or are replaced by loading content. Preserve partial results if one search source fails where appropriate.

**Verification still needed:** Delay both calls, reject each independently, change the query before completion and use Enter during the delay. Inspect status announcements and empty/error copy.

### UX-06 — P2 · High confidence · Defect: safety-relevant plan labels bypass localization

**Evidence:** `apps/desktop/src/features/plans/PlanReviewOverlay.tsx:446-447,474-487`; `apps/desktop/src/app/CommandPalette.tsx:277`; `apps/desktop/src/data/locale.tsx:234-248,304-313`.

**Trace:** Plan actions render raw `item.action`; completed/failed/skipped states render raw `item.state`. Palette result kinds similarly render raw `r.kind`. These are contract identifiers, not message-catalog lookups, even though the surrounding headings and controls use Paraglide and the locale layer changes document language.

**Impact:** A localized application still asks users to interpret English/internal identifiers at the point they review filesystem actions and outcomes. This is more consequential than an untranslated decorative label.

**Recommended fix:** Add exhaustive typed message mappings for user-facing action/state/kind values. Retain raw identifiers only in explicit diagnostic metadata. Do not translate paths or user-supplied names.

**Verification still needed:** Render a mixed-action plan in a non-English locale before apply and after succeeded/failed/skipped outcomes; search mixed entity kinds in the palette. Confirm locale changes refresh these labels.

### UX-07 — P2 · High confidence · Defect: side-dock resizing has no keyboard equivalent

**Evidence:** `apps/desktop/src/ui/ResizeHandle.tsx:10-25`; `apps/desktop/src/ui/useAdaptiveDock.ts:127-146`; `apps/desktop/src/components/ListPageLayout.tsx:337-343`.

**Trace:** The separator exposes a label and orientation but no tabIndex, key handler or adjustable-value semantics. Its only operation is pointer-down followed by window pointer-move/up listeners.

**Impact:** Keyboard-only users cannot adjust the width of the detail surface, although pointer users can. The Auto/Bottom/Right placement control is an alternative placement choice, not an equivalent width control.

**Recommended fix:** Implement the keyboard-adjustable separator pattern with focusability, current/min/max values and bounded arrow-key resizing. Reuse the same width-setting path as pointer resizing.

**Verification still needed:** At 1440 px width, Tab to the divider, resize with keyboard, verify bounds and persistence, and inspect the accessibility tree and visible focus indicator. Visual and AT behavior remain **unverified**.

### UX-08 — P2 · High confidence in source cause · Defect: persisted side-dock width is not clamped when the window shrinks

**Evidence:** `apps/desktop/src/ui/useAdaptiveDock.ts:79-108,120-125,150-155`; `apps/desktop/src/components/ListPageLayout.tsx:306-310`; `apps/desktop/src/components/ListPageLayout.css.ts:78-88`; `apps/desktop/src-tauri/tauri.conf.json:16-20`.

**Trace:** Stored width initializes state directly. Resizing the window updates only `windowWidth`. Clamping happens only inside `setWidth`, which a window resize does not call. ListPageLayout injects that unchanged width into the fixed-basis side panel. A pinned side placement remains eligible down to 640 px, below the native window minimum.

**Proposed reproducer:** At 2560 px, pin Right and grow the dock to 1200 px. Shrink the native window to its supported 1100 px minimum, or reopen the persisted layout on that smaller window. The hook still returns 1200 px rather than the intended half-window ceiling.

**Impact:** The source permits a detail width larger than the window and leaves no guaranteed working width for the table. Actual clipping/overflow at 1100 px is **unverified** pending rendering.

**Recommended fix:** Derive a clamped effective width from current window size on every relevant change, including initial hydration. Decide separately whether shrinking the effective width should overwrite the user's larger-screen preference.

**Verification still needed:** Wide→minimum→wide and reopen-on-smaller-display scenarios with Auto and pinned Right, expanded/collapsed sidebar, font-size settings and zoom.

### UX-09 — P3 · High confidence · Defect: root design intent gives obsolete navigation and unsafe token-authoring instructions

**Evidence:** `DESIGN.md:35-48,126-155`; `apps/desktop/src/app/Sidebar.tsx:65-125`; `apps/desktop/src/styles/tokens.css:1-3,56-114`; `apps/desktop/src/ui/Table.tsx:4-5`; `apps/desktop/src/ui/useAdaptiveDock.ts:71-78`.

**Trace:** DESIGN describes Review queue, standalone Plans and Audit log navigation, `--alm-*` tokens, and direct editing of `tokens.css`. The inspected sidebar exposes Inbox and Archive instead. Actual tokens use `--pv-*`, and the file explicitly states it is generated from `apps/desktop/tokens/`. DESIGN also promises react-resizable-panels and TanStack Table ownership while the inspected table/dock implementations use custom code plus TanStack Virtual.

**Impact:** A contributor following the nominal design source can edit generated output or implement obsolete navigation/components. This is not merely historical naming: the token-authoring procedure points at the wrong ownership layer.

**Recommended fix:** Reconcile the document with the current product decisions and DTCG ownership; identify superseded sections explicitly. Preserve valid principles such as local-first operation, density and reviewable mutations rather than rewriting the product around the stale document.

**Verification still needed:** Source-to-document review of current navigation, primitive ownership, token generation commands and supported design states. No implementation rollback is recommended.

## Exact surfaces/states for wave-two rendering

All entries below are requested render targets, **not observed visuals**.

1. **Shell and dense Sessions list:** 1100×720 native minimum, 1280×820 default, 1440×900 and 1920×1080; expanded/collapsed sidebar; compact/comfortable/spacious density; each theme; larger font and whole-app zoom. Inspect table/detail scroll ownership and pinned action visibility.
2. **Sessions/Projects selected detail:** Auto, Bottom and Right placement. Resize the Right dock at 2560 px, shrink to 1100 px and reopen with the saved preference. Keyboard-operate row selection, Home/End, sort headers, close control, Escape and dock-placement controls.
3. **Archive:** true empty list, filtered no-match, list-load error, selected project and selected calibration master. Render typed-delete empty/wrong/correct input, pending success, permission failure and offline-storage failure. Try every dismissal path during pending deletion.
4. **Plan review overlay:** zero-item diagnostic, mixed move/copy/archive/delete actions, protected items unacknowledged/acknowledged, destructive confirmation pending/failure, insufficient-space advisory, running/cancel/pause/resume-stalled, partially applied with per-item failure reasons, cancelled retry and completed state. Render at 1100×720 with long paths and expanded localized text.
5. **Settings → Data Sources:** loading, empty, offline root, disable/delete confirmation and backend refusal. Open Remap from its root action menu, test verify/apply pending and error states, and inspect focus return to the invoking action.
6. **Projects → selected project → source-view generation:** open from keyboard, cancel, Escape, background click, pending generation, failure and successful handoff to plan review. Verify conditional-mount focus restoration.
7. **Command palette:** empty query; localized Settings query; create-project query; matching target alias; nonsense query; delayed query; target-only failure; global-only failure; fast query replacement followed by Enter. Inspect result kind translations and announcements.
8. **Feedback and motion:** reduced-motion on/off during loading, opening overlays and toast arrival; Inbox reveal failure with Copy path toast action; success/error notifications while keyboard focus is elsewhere. Toast actions currently share the default five-second lifetime (`shared/toast.ts:85-91`), so assess discoverability and focus timing without assuming it passes.
9. **Localization:** compare English with a shipped non-English locale, including long labels, dates, counts, plan actions/results and palette kinds. Document-language synchronization is implemented, but complete live rerender and translation coverage were not established by this slice.

## Repo-proven launch commands — not executed

Run only in an authorized environment with provisioned dependencies and disposable fixture data. No dependency installation is proposed here.

- Browser/mock app: `VITE_USE_MOCKS=true pnpm desktop:dev`, then `http://127.0.0.1:5173`. Root forwarding: `package.json:17`; desktop Vite script: `apps/desktop/package.json:7`; mock opt-in and server configuration: `apps/desktop/vite.config.ts:15-22,58-65`. Browser-only development defaults to the real backend unless the mock flag is explicitly set.
- Native app: `pnpm --dir apps/desktop tauri dev`, as documented at `README.md:105`; Tauri delegates frontend startup through `apps/desktop/src-tauri/tauri.conf.json:6-10`.
- Native development-tools recipe: `just tauri-dev`, defined at `justfile:202-203` with the development config and `dev-tools` feature.
- Component exploration: `pnpm --filter @astro-plan/desktop storybook`; `apps/desktop/package.json` defines `storybook dev -p 6106 --no-open`. Confirm the resulting localhost URL from startup output rather than assuming native behavior from Storybook.

These commands are source-backed, not execution-proven. Startup can generate ignored Paraglide output, so none was run under this assignment's no-write constraint.

## Prioritized roadmap

1. **Destructive-flow feedback and continuity:** UX-01 and UX-02. Make refusal, pending state and completion unmistakable before expanding the surface.
2. **Keyboard operation:** UX-03 and UX-07. Cover both modal mount shapes and every adjustable dock operation.
3. **Supported-window robustness:** UX-08, then render the density/font/zoom matrix at 1100×720 and larger sizes.
4. **Expert search reliability:** UX-04 and UX-05. Separate navigation filtering from remote-result lifecycle and errors.
5. **Localization and maintainability:** UX-06 and UX-09. Translate safety vocabulary and correct token/component ownership instructions.

## Exclusions and limitations

No source-only claim establishes rendered visual quality, contrast compliance, WCAG conformance, actual screen-reader announcements or native focus behavior. No mobile-width requirement is inferred: the native application explicitly declares a 1100×720 minimum. Backend filesystem correctness, atomicity, authorization, archive semantics and data recovery were not audited; IPC calls were traced only far enough to understand UI state and feedback. Not every feature, dialog, story, translation or stylesheet was inspected. Existing test source is counterevidence about intended coverage, not proof that tests pass. No tests or validation ran, and no files were written.

## Inspection inventory

- `DESIGN.md`: Inspected design principles, information architecture, density, token authoring and primitive ownership contracts; found material drift against implementation.
- `apps/desktop/src/app/Shell.tsx`: Inspected shell composition, setup routing, zoom shortcuts, global palette and toast mounting.
- `apps/desktop/src/app/Sidebar.tsx`: Inspected workflow grouping, active navigation semantics, collapsed labels and source health.
- `apps/desktop/src/app/CommandPalette.tsx`: Traced shortcut registration, search requests, result lifecycle, filtering and navigation.
- `apps/desktop/src/components/Modal.tsx`: Traced initial/final focus and all dismissal paths; compared with Modal.test.tsx source without executing tests.
- `apps/desktop/src/components/ConfirmModal.tsx`: Inspected shared destructive confirmation, pending buttons and inline errors.
- `apps/desktop/src/features/archive/ArchivePage.tsx`: Traced trash, permanent deletion, restore-plan review, typed confirmation and list states.
- `apps/desktop/src/features/archive/store.ts`: Traced destructive mutation callbacks and error propagation.
- `apps/desktop/src/features/plans/PlanReviewOverlay.tsx`: Inspected item review, protection/destructive gates, busy handling, apply progress and terminal recovery.
- `apps/desktop/src/features/settings/DataSources.tsx`: Inspected settings loading/error/empty states and guarded deletion/disable confirmations.
- `apps/desktop/src/features/settings/RemapRootDialog.tsx`: Traced verification/apply requests, state reset and conditional modal mounting.
- `apps/desktop/src/features/projects/GenerateSourceViewDialog.tsx`: Traced conditional modal mounting, generation pending state and plan handoff.
- `apps/desktop/src/features/projects/SourceViewsSection.tsx`: Traced generate/remove/regenerate plan review entry points and toast actions.
- `apps/desktop/src/components/ListPageLayout.tsx`: Inspected detail placement, Escape overlay guard and adaptive width integration.
- `apps/desktop/src/components/ListPageLayout.css.ts`: Inspected bounded scrolling, fixed side width and dense table styles.
- `apps/desktop/src/ui/useAdaptiveDock.ts`: Traced responsive placement, persisted widths and pointer resizing.
- `apps/desktop/src/ui/ResizeHandle.tsx`: Inspected separator semantics and available input mechanisms.
- `apps/desktop/src/ui/Table.tsx`: Inspected row activation and arrow/Home/End navigation, semantic columns and virtualization setup.
- `apps/desktop/src/features/projects/ProjectsTable.tsx`: Inspected dense row rendering, lifecycle labels, sort headers and empty/loading states.
- `apps/desktop/src/features/sessions/SessionsTable.tsx`: Inspected grouped rows, selection, density and virtualization consumers.
- `apps/desktop/src/components/TableStateGate.tsx`: Inspected loading/error/empty/filter-empty precedence.
- `apps/desktop/src/ui/ToastContainer.tsx`: Inspected toast roles, action buttons and dismissal.
- `apps/desktop/src/shared/toast.ts`: Inspected default notification lifetime and imperative feedback store.
- `apps/desktop/src/data/queryClient.ts`: Checked global error-handling counterevidence for archive mutation feedback.
- `apps/desktop/src/data/locale.tsx`: Inspected locale persistence, document-language synchronization and provider updates.
- `apps/desktop/src/styles/tokens.css`: Inspected generated-token ownership, bundled fonts, sizing, density, semantic aliases and motion tokens.
- `apps/desktop/src/styles/reset.css`: Inspected global typography, bounded viewport and reduced-motion override.
- `apps/desktop/src/styles/motion.css.ts`: Inspected shared spinner animation definition.
- `apps/desktop/src/components/ListDetailLayout.css.ts`: Inspected secondary two-/three-pane sizing and scroll ownership.
- `apps/desktop/src/components/Lifecycle.tsx`: Inspected lifecycle display with lib/lifecycle.ts; no production usage established, so excluded its potential issue from findings.
- `apps/desktop/package.json`: Inspected desktop dependencies and Vite/Storybook launch scripts.
- `apps/desktop/vite.config.ts`: Verified browser mock opt-in, loopback host, port and locale compilation configuration.
- `apps/desktop/src-tauri/tauri.conf.json`: Verified native window dimensions and development frontend configuration.
- `package.json`: Verified root desktop launch forwarding and toolchain requirements.
- `justfile`: Located native development and opt-in MCP bridge recipes.
- `README.md`: Located documented native development command.
