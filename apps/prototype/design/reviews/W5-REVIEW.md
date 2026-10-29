# W5 review — composition round

**Target:** `origin/ui-harness-v5` at `5dc24524434a6ce15ed8ebfd1422267a64f21311`; integrated prototype diff `edb05dbf..5dc24524434a6ce15ed8ebfd1422267a64f21311` (`apps/prototype`). Plan: `design/R9-COMPOSITION-PLAN.md`, §§2b–3.6 and 7.6. **Live preview:** `http://127.0.0.1:5181/` (Vite on the review worktree). Demo fixture was loaded only into the managed browser’s local storage, not user data.

## Findings

### Blockers

1. **WCAG 1.4.10 (AA) — minimum-window CSS forces horizontal scrolling at 320 CSS px.** `src/components/templates/app-frame.tsx:90` applies `min-w-(--window-min-w)` and `src/themes.css:98` sets the minimum to `80rem` (1280 CSS px). At a 320-CSS-px viewport, measured `documentElement.clientWidth=320`, `scrollWidth=1280` (960 px overflow); 375 px gives 1280 (905 px overflow), and 768 gives 1280 (512 px overflow). The owner-selected minimum native window is 1280×640 (`design/HARNESS-V5-IA.md:29`), but does not waive reflow at 400% browser zoom. 1.4.10 requires content at an effective 320 CSS px without two-dimensional scrolling, except content whose meaning requires two dimensions. The app shell and ordinary page content are not such exceptions. Preserve native minimum if required, but support reflow at zoomed CSS widths.

2. **WCAG 4.1.2 (A) — Time zone combobox trigger in Add site dialog has an empty accessible name.** At `/#/settings/sites`, open **Add site…**; the Time zone field exposes an unnamed focusable combobox trigger (the ARIA tree reports `combobox "Time zone"` for the input, while the adjacent trigger button itself has no name). The audit measured the menu trigger as a Tab stop and its CDP accessibility name as empty. Source: `src/components/ui/combobox.tsx:62-70` renders `ComboboxTrigger` through `InputGroupButton` without a name; this is reached by the named `ComboboxField` at `src/features/t1/settings/sites-page.tsx:106-112`. Give the trigger an accessible name or remove the redundant trigger from this mode.

3. **MAJOR UI defect — design-system catalogue mounts five open frame inspectors that steal focus and trap keyboard use.** At `/#/design-system` 1280×800, catalogue startup places scroll position at 13,765 px, leaving the page title 13,022 px above the viewport; active focus is in an off-screen Frame inspector around page y=31,288. Tabbing cycles the inspector’s “Close” and “Picked” controls rather than navigating the catalogue; Escape leaves focus on body. The inspector tooltip drives document scrollHeight to 31,289 px against clientHeight 800, scrolls the whole app frame (hiding toolbar and producing blank space). Root: catalogue Workspace specimens render overlays initially open; `src/components/app/workspace.tsx:126-131` auto-focuses the inspector overlay. Initialize catalogue specimens closed or only open/focus overlays after the user acts. This affects the design system route, not the five product templates.

### Should fix

4. **WCAG 4.1.2 (A) — two input-group combobox specimens render unnamed trigger buttons.** On `/#/design-system`, axe-core 4.14.0 reports `button-name` critical for two controls matching `[data-slot="input-group-button"][aria-haspopup="listbox"]`; code is the same trigger implementation in `src/components/ui/combobox.tsx:62-70`. These two are catalogue specimens, but the same shared control renders on product forms (including Time zone above), so fix the shared component once.

5. **WCAG 4.1.2 (A) — catalogue loading example has `aria-label` on a generic div.** `/#/design-system` axe reports `aria-prohibited-attr` at `.w-64.space-y-2[aria-label="Loading"]`, from `src/app/catalogue/primitives.tsx:576`. Remove the unsupported name or use a valid named status/region semantic appropriate to the example. Catalogue-only.

6. **WCAG 2.5.3 (A) — frame thumbnail examples have visible labels that do not fully match accessible names.** Axe 4.14.0 reported `label-content-name-mismatch` on 16 `button[data-frame-item]` controls in the design-system FrameThumbnails specimen. Manual comparison shows the accessible name includes the visible filename (`Light_0001.fits` etc.) but omits visible status text. Preserve the action name while including the complete visible label in the accessible name. Catalogue-only; the sampled product templates did not show this component.

7. **WCAG 1.4.3 (AA) — one catalogue tabs specimen’s inactive label is under contrast threshold in the light theme.** The accessibility auditor measured the default-variant inactive “Targets” tab at `#6e7072` on `#eef0f3`, ratio `4.34:1`, below the `4.5:1` requirement for 13 px normal text. The product `line` variant passes; change the shared/default-state token or specimen styling so the demonstrated reusable default meets AA. The reported violation is the component catalogue, not the product routes.

8. **Potential partial-selection status ambiguity in table header checkboxes (Sessions and Wrap-up).** The shared `src/components/ui/checkbox.tsx:24` renders a `CheckIcon` for mixed and checked states. With partial row selection, the header control remains a check rather than a distinct mixed-state dash. The accessible state remains `aria-checked="mixed"`, but sighted users may read it as all-selected. Use a distinct indeterminate glyph to make the visible state match the programmatic state.

9. **Settings › Locations at 1280 px: the registered-folders table clips its right columns.** On the supported 1280 px minimum width, 710 px of the 841 px table is visible: Free is cut off at the right edge and Size digits appear beneath the pinned Actions column. The scroll frame is not a labelled, keyboard-reachable region (`HARNESS-V5-IA.md:71` notes this as open). Ensure the table is navigable, labelled and its columns remain distinguishable.

10. **Sessions empty search leaves table columns resizing and redundant clear actions.** On `/#/sessions` at 1440, searching for a no-match query moves column left edges (Target 614→518, Frames 773→715, Calibration 1087→1134) and the empty UI offers ×, “Clear filters” and “Clear search” for overlapping reset actions. The “No match” line omits the active query. Preserve column alignment and make the empty state’s recovery action singular and contextual.

11. **Form/dialog controls shift while busy; Enter can drop focus.** In the catalogue dialog specimen, when a busy indicator appears the Archive button grows from 69→89 px and Rename from 72→92 px, moving Cancel by 20 px; submitting a form disables its input and focus falls to `body` throughout the busy period (10/10 samples in one second). Keep action geometry stable and focus on a meaningful dialog status/control while submitting.

12. **Sessions calibration status chip is vertically misaligned.** At 1280 and 1440 the “No darks” chip in the Calibration cell is 4 px lower than “Pinned automatically” in the same row (tops 738.5 vs 734.5 in measured sample). Align status indicators in the shared row.

13. **Home “Open work” progress text is truncated at the supported 1280 px width.** The Progress cell is 274 px wide; three rows have content widths 328, 452 and 282 px, truncating “Next: Review …” text. A hover tooltip exposes the full title, but the next action is not available without hover. Keep the complete next-step text reachable without hover or wrap it.

14. **Sessions shows duplicate Import actions with inconsistent labels.** At 1280 px, toolbar “Import…” and page-header “Import” navigate to the same `/#/import` route. Align placement and ellipsis copy, or keep only the single whole-page action.

15. **Two durable design records disagree on supported widths.** `design/HIGH-LEVEL-DESIGN.md:714` says 1024 px and above are supported; `design/HARNESS-V5-IA.md:29` declares minimum 1280 px. Source implements the latter. Update the stale record so later UI decisions and audits use one contract.

16. **Welcome setup list punctuation is inconsistent.** Of the four visible list items, only one ends with a full stop. Use consistent list-item punctuation.

### Visual walkthrough evidence

- The W5 follow-up for 1.4.10 is implemented on branch `w5-zoom-reflow` (commit `e4a0480a6321f910488c5e50867a6a6ac3d5bb75`): `app-frame.tsx` no longer imposes a CSS width floor; native minimum remains 1280×640 and the 640 px CSS height floor remains. Worker evidence: app/setup frames measured 320/320 document width at 320 CSS px, 1280/1280 and 1440/1440, and focused AppFrame tests 5/5 pass. Follow-up testing found toolbar/tab overflows still open on several pages; see bead `astro-plan-409cm.13`.
- On the five template surfaces, most observed product-route issues were MINOR. There were no reported overlapping siblings. The list sample shows dense table rows and actionable statuses; detail has several boxed sections; step retains footer and a large file list; Settings table has the cut-off columns described above. Five screenshots from the independent pass are under `/var/folders/bh/7xlmzbf129dgx99tm2fythnh0000gq/T/` with suffixes `15b9042dd1c035b0.png` (List), `15b9042e728035b1.png` (Detail), `15b9042ef38035b2.png` (Step), `15b9042f910035b3.png` (Settings), `15b9042fbe0035b4.png` (setup).
- Focus traversal on Sessions followed the visible shell → page toolbar → controls → row-selection sequence; focused controls showed a settled 2 px solid `oklch(0.72 0.13 250)` outline. Hover on “Status” changed its computed background from translucent white 7% to 12%. Confirmation specimen opened an alertdialog, Escape closed it and restored focus to the trigger. Design-system’s five workspace inspectors are the exception described above.
- UI review states: default, hover, focus-visible, active, disabled, selected, empty, and dialog loading/error were driven by the design critic. Page-level loading state is synchronous/not present. Screen-reader output was not exercised in the visual review.

## Accessibility audit method and coverage

- **Scanner:** `accessibility-scanner` MCP connected; server-reported axe-core **4.14.0**, WCAG **2.2 A & AA** ruleset. Automated axe run in a populated managed browser reported zero violations on Sessions (31 passing rules), Project Sessions (34), Wrap-up review (32), Settings Locations (28), and Welcome (24). `/#/design-system` (40 passing rules) had the catalogue violations above. It also reported incomplete checks for contrast on pseudo-elements/gradients and table-header associations; these are not claimed as passes.
- **Important environment note:** early standalone scanner invocations lacked the managed browser’s local fixture store. Their zero-violation results for sessions, project, wrap-up and `/design-system` described first-run Language; Settings Locations had an empty library. Those results are excluded. Reported route counts are from a separate injected axe-core run after verifying the demo store and route.
- **Manual:** the auditor also measured Add-site dialog Time zone combobox name, focus/Escape/restoration; product-route text contrast in dark/light; Sessions row arrow-key navigation; target size/spacing and contrast; zoom-reflow at 320 CSS px. Sessions unchecked checkbox border is 4.68:1 against the dark table surface; its 16×16 border box is enlarged to 38×24 effective hit area, adjacent centres 25.75–26.25 px apart, satisfying 2.5.8 spacing exception in the measured list. Forced-colors, screen-reader platform narration, and exhaustive error/loading/disabled states across every route were not exercised.
- **Width contract:** declared native minimum is 1280×640; 1280 and 1440 fit. The zoom worker removed the CSS width floor, measured 320 px document width at a 320-CSS-px viewport, and passed 5 focused frame tests. Separate post-change measurements exposed remaining toolbar/tab overflow (e.g. facets/Columns collision); bead `astro-plan-409cm.13` tracks that residual responsive-layout follow-up.

## Independent code review

The reviewed range was `git diff edb05dbf..origin/ui-harness-v5 -- apps/prototype`, at head `5dc24524434a6ce15ed8ebfd1422267a64f21311`. The independent reviewer checked W4 contract removals and composition/lint wiring. Its checked findings:

17. **P2 — Duplicating a mosaic with Goals included but Groups omitted duplicates panel goals as project-wide goals.** `src/store/actions/projects.ts:550-551` copies every goal and maps each groupId to `null` when groups are omitted. Trigger: duplicate the seeded IC 5070 mosaic (three panels) with Groups unticked and Goals ticked. Three Ha and three OIII per-panel goals become project-wide, duplicating goal rows and progress. This breaks the invariant in `setGroupPanel` (`projects.ts:432-450`), which restores one subject-wide goal set when the last panel is removed. Normalize copied goals when panels are omitted.

18. **P2 — Finishing Review while Target/Rig is current executes that step’s Proceed.** `src/features/v5/a-home/session-intake.tsx:104-118` renders Review for `?step=review` but passes current-flow `proceed` as `onFinished`. Intake is unordered and Proceed dispatches on `state.current` (`src/store/actions/flows.ts:108-129`); Review calls `onFinished` once no frames are unreviewed (`src/features/v5/d-review/frame-review.tsx:304-307`). Thus an early-opened Review can confirm/file a target or confirm a rig instead of finishing Review and advancing. Gate the callback on `flow.current === "review"` or invoke the Review-specific action.

19. **P2 — Closing with no archive location can mark Archive complete without moving sessions.** `src/features/v5/b-projects/wrap-up.tsx:226-231` permits an empty archive plan with a blocker to reach Proceed; the step then reports “nothing left” and closes, leaving held sessions unmoved. Block Proceed or select an explicit skipped/blocked outcome.

20. **P2 — Setup can reach Start indexing or Index later without a capture location.** `src/features/t1/setup/setup-pages.tsx:359` and `src/features/t1/setup/setup-flow.tsx:62-68`: unordered navigation allows bypassing Locations; Indexing checks only that some location exists, and Skip has no gate. This breaks plan §5.2’s minimum capture-location requirement. Gate both exits or force required setup.

21. **P2 — Session row selection survives navigation to another Project.** `src/features/v5/b-projects/groups.tsx:297-303` stores selected rows in component state, but `src/features/v5/b-projects/project.tsx:59` does not key the page by project id. Duplicate navigates to a new Project on success (`src/features/v5/b-projects/duplicate-dialog.tsx:44-48`); previous ticks can survive, so bulk Remove may act on the new Project. Reset selection on project-id change.

22. **P2 — Dark-flat masters are excluded from the Old age badge.** `src/domain/calibration.ts:738-739,751` ages darks and bias but not dark-flats, although decision C9 includes dark-flats and exempts only flats. Older dark-flat masters are not flagged for review.

23. **P3 — Right-click opens an empty context menu where a row has no actions.** `src/components/app/data-table.tsx:685-697,920-926` enables the menu from table-level callback presence, even if the callback returns no items for a row. Retired locations have no actions (`src/features/t1/settings/locations-page.tsx:234`) but still open an empty menu. Do not open it when row actions are empty.

24. **P3 — Saving a Targets preset drops the sort order.** `src/features/v5/e-targets-plan-settings/targets.tsx:455-462,583`: preset shape supports `sort`, but saving omits current sort and the URL does not carry it. Reapplying a saved preset loses the chosen order. Persist the sort with the preset.

25. **P3 — Catalogue registry advertises a nonexistent `Tag` export.** `src/app/catalogue/registry.ts:52` lists `Tag` without a matching `src/components` export. `scripts/check-catalogue.mjs:58-67` detects missing registry entries, not names without exports, so this phantom component passes the catalogue gate.

The independent code review also checked W4 API/file removals, enforcement wiring, token definitions and i18n parity. Coverage was incomplete for component internals, store slices/simulation/operations/notifications, some domain modules, remaining feature files and catalogue stories; these areas are not represented as clean.

### Additional a11y best-practice note

The auditor identified a NightPicker popover with `role="dialog"` but no accessible name. This was reported as policy/best-practice, not a WCAG AA failure.

 
## Disposition

Findings 1–3 are blockers (WCAG A/AA or keyboard-operability failures). Findings 4–25 are should-fix. Follow-ups include `astro-plan-f747r` (zoom reflow), `astro-plan-s5t8q` (combobox name), `astro-plan-v3s5k` (catalogue semantics/contrast), `astro-plan-3s4fl` (catalogue initial focus), `astro-plan-n09aa` (Settings locations table), `astro-plan-ceg4g` (Sessions empty search), `astro-plan-u9k3r` (dialog busy behavior), `astro-plan-della` (mixed checkbox), `astro-plan-c081x` (calibration chip alignment), `astro-plan-ci1xw` (Home progress), `astro-plan-bavjw` (duplicate Import), `astro-plan-znkr2` (width docs), and `astro-plan-nmom4` (Welcome punctuation). Code findings are `astro-plan-409cm.5`–`.11` plus `astro-plan-409cm.4` review. The related W5 Settings-table bead `.12` was confirmed, but remains unclaimed because `astro-plan-n09aa` already covers the same feature table; the lead should reconcile those duplicate ownership scopes. The governing bead remains open for user walk and Round 10.
