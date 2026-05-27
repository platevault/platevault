# Design System Architect Validation

Validator: Design System Architect (spec 030 Phase 2b)
Date: 2026-05-26
Branch: 030-ui-audit-revision
Scope: tokens.css, components.css, 6 new components/utilities, 2 enhanced components

---

## Stage 1: Web Component Design

### Passed

- **ListDetailLayout API** -- Clean, minimal interface. Two-pane vs three-pane
  selection via presence/absence of `sidebar` prop is idiomatic and avoids a
  boolean mode flag. Props are `ReactNode` slots exactly where they should be.
  Matches the DESIGN-SYSTEM.md contract precisely.

- **PageShell API** -- Well-structured priority chain (loading > error > empty >
  children). Default `hasData = true` is the correct safe default. `testId` prop
  enforces testability from the start. Uses `EmptyState` from ui/ correctly.

- **ListSidebar API** -- Comprehensive yet flexible. Group/sort/filter/dropdown
  are all optional, making it usable by both simple (Targets) and complex
  (Sessions) list screens. Base UI Select and Toggle/ToggleGroup usage delegates
  accessibility to the component library. The Ctrl+F keyboard shortcut for search
  focus is a strong UX detail.

- **TopActionBar API** -- Children slot for arbitrary content is the right call for
  screens that need custom center content. `ActionDef` with hotkey and variant is
  well-typed. Uses existing `Btn` primitive correctly.

- **ListItem API** -- Minimal, composable. Children-based content allows any list
  row shape. `useCallback` for click/keydown prevents unnecessary re-renders in
  long lists.

- **Component index** -- Clean barrel export with both value and type exports.
  All new components are registered. No default exports (good for tree-shaking).

- **useSetToggle** -- Correct immutable Set update pattern. Callback stability
  via `useCallback` with empty deps. Return tuple matches React convention.

- **format.ts / display.ts** -- Pure functions with no side effects. Complete
  coverage of the states mentioned in DESIGN-SYSTEM.md. `PillVariant` type
  exported for downstream consumers.

- **Composition contracts** -- The page composition trees described in
  DESIGN-SYSTEM.md section 4 are fully implementable with the component APIs
  provided. No missing slots or props for the documented page structures.

- **State boundaries** -- All state is managed by the page (consumer), not the
  shared components. Components are controlled. This is correct for this
  architecture.

### Issues

1. **ListItem uses `role="listitem"` on a `div` but the parent `role="list"` is
   on `ListSidebar.__list` not on a `ul`/`ol`** -- The semantic relationship is
   correct (list > listitem), but `ListItem` children are passed via
   `ListSidebar`'s `children` prop, so there is no compile-time guarantee that
   `ListItem` instances always appear inside a `role="list"` container. If a
   consumer renders `ListItem` outside of `ListSidebar`, the ARIA relationship
   breaks silently.
   Severity: **NICE_TO_HAVE** -- mitigated by the composition contract
   documentation, and the design system spec explicitly says ListItems live
   inside ListSidebar.

2. **Deprecated components (ThreePane, FilterBar, Confidence) still exported
   from `ui/index.ts` and still imported in feature files** --
   `InboxPage.tsx` imports `ThreePane`, `CleanupPlan.tsx` and `SessionsList.tsx`
   and others import `Confidence`. The comment says "kept until feature pages are
   migrated" which is the correct approach, but there is no deprecation marker
   that tooling can catch (e.g., `@deprecated` JSDoc on the export).
   Severity: **SHOULD_FIX** -- Add `/** @deprecated Use ListDetailLayout */`
   JSDoc annotations so lint or IDE warnings surface during migration.

3. **TopActionBar has no ARIA landmark or role** -- It serves as a toolbar but
   has no `role="toolbar"` or `aria-label`. Pages that use it in the two-pane
   `topBar` slot will have a semantically anonymous div as the action bar.
   Severity: **SHOULD_FIX** -- Add `role="toolbar"` and
   `aria-label="Page actions"` (or accept it as a prop).

4. **ListDetailLayout has no landmark roles** -- The three-pane and two-pane
   containers are plain `div` elements. The list pane could benefit from being
   a `nav` or having `role="region"` with an `aria-label`, and the detail pane
   could be `role="main"` or `role="region"`.
   Severity: **NICE_TO_HAVE** -- Landmarks improve screen reader navigation but
   are not blocking since the shell already provides the primary landmark
   structure.

5. **ListSidebar filter pill toggle logic uses type casting** -- Line 91-96 uses
   `as string[]` casts. The `ToggleGroup.onValueChange` callback type from
   Base UI returns `unknown[]`, requiring the cast, but a runtime type guard
   would be safer.
   Severity: **NICE_TO_HAVE** -- Low risk since the values are always strings
   in this context.

---

## Stage 2: Design Review

### Passed

- **Token file (tokens.css)** -- Complete and well-organized. All categories
  from DESIGN-SYSTEM.md section 1 are present: colors (core, status, status
  backgrounds, semantic), typography (scale, weights, line heights), spacing
  (10-step scale), transitions, layout dimensions, density, radii, shadows,
  z-indices. Base font declaration at the end of `:root` is correct.

- **Density modifiers** -- `density-compact` and `density-spacious` classes
  correctly override `--alm-row-height` and `--alm-cell-padding` tokens. New
  component CSS includes density variants for TopActionBar, ListSidebar, and
  ListItem. This is thorough.

- **Layout CSS** -- Two-pane and three-pane classes match the DESIGN-SYSTEM.md
  contracts exactly (flex directions, widths, min-widths, overflow, borders).
  All dimension values reference `var(--alm-list-width)`,
  `var(--alm-detail-min-width)`, etc.

- **New component CSS follows BEM** -- `alm-list-sidebar__search`,
  `alm-list-sidebar__controls`, `alm-list-sidebar__filters`, etc. Modifier
  pattern: `alm-list-item--selected`, `alm-filter-chip--active`. Consistent
  with the existing codebase BEM usage.

- **All font-size values use tokens** -- Zero hardcoded font sizes found in the
  entire components.css. Every `font-size` references a `var(--alm-text-*)`.

- **All transitions use tokens** -- Zero hardcoded transition values. Every
  `transition` references `var(--alm-transition-*)`.

- **Dead CSS removed** -- The `DELETED` comment markers confirm removal of
  `.alm-review-queue`, `.alm-evidence-pane`, `.alm-decision-panel`,
  `.alm-list-pane`, `.alm-session-list`, `.alm-proj-list`, and duplicate
  `.alm-view-toggle`. This matches the cleanup plan from DESIGN-SYSTEM.md
  section 5.1.

- **Status color system** -- Complete with text colors, background tints, and
  border colors for ok/warn/danger/info. Pills use all three layers correctly.

- **Focus ring consistency** -- All focus-visible rules use the shared
  `var(--alm-focus-ring)` token with `outline: none`. Consistent pattern
  across btn, sidebar items, select, input, checkbox, list items, view toggle.

- **Typography weight guidance** -- The weight rules from DESIGN-SYSTEM.md
  (medium for emphasis, semibold for titles/headers) are followed in the new
  CSS. TopActionBar title uses `var(--alm-weight-semibold)`, general content
  uses `var(--alm-weight-medium)`.

- **No inline styles in new components** -- All 6 new components use className
  exclusively. Zero `style=` attributes found.

- **Selected state tokens** -- List items use `var(--alm-selected-bg)` and
  `var(--alm-hover-bg)` for interactive states, matching the token definitions.

### Issues

6. **70 hardcoded `font-weight: 500/600` values in pre-existing CSS** -- While
   all NEW CSS from spec 030 correctly uses `var(--alm-weight-*)` tokens, the
   pre-existing component CSS has ~70 instances of raw `500` and `600` values.
   The DESIGN-SYSTEM.md explicitly says "use these, not raw numbers."
   Severity: **SHOULD_FIX** -- The scope of this spec is the new/modified CSS.
   The pre-existing values should be migrated but were not part of the UI
   Designer's brief. Flag for a follow-up pass.

7. **Hardcoded spacing in pre-existing CSS** -- ~30 instances of raw pixel
   values for padding, gap, and margin in the pre-existing sidebar, titlebar,
   masters-list, and settings CSS (e.g., `padding: 10px 12px 8px`, `gap: 6px`,
   `padding: 8px 0`, `padding: 6px 14px`). New CSS from spec 030 correctly
   uses spacing tokens.
   Severity: **SHOULD_FIX** -- Same scope note as above. The pre-existing code
   was not fully migrated. Flag for follow-up.

8. **Five hardcoded `border-radius` values** -- Lines 297 (`6px`), 418 (`4px`),
   522 (`3px`), 654 (`2px`), 1335 (`1px`). These are in pre-existing CSS for
   titlebar dot, sidebar logo icon, warn dot, logpanel progress, and coverage
   chart target mark. The `4px` and `2px` match `--alm-radius-md` and
   `--alm-radius-sm` but are not using the tokens.
   Severity: **SHOULD_FIX** -- Migrate to token references in follow-up.

9. **Four hardcoded `#fff` values** -- Lines 90, 101 (btn--primary/danger text),
   4168 (switch thumb), 5346 (checkbox indicator). White text on colored
   backgrounds is a legitimate use case, but there is no `--alm-text-inverse`
   token defined.
   Severity: **NICE_TO_HAVE** -- Consider adding a `--alm-text-inverse: #fff`
   token. Not blocking because the value is stable.

10. **One hardcoded `box-shadow` on switch thumb** -- Line 4170:
    `box-shadow: 0 1px 2px rgb(0 0 0 / 0.15)`. Should use `var(--alm-shadow-sm)`
    or a dedicated switch shadow token.
    Severity: **NICE_TO_HAVE**

11. **One hardcoded `z-index: 1`** -- Line 3423 for sticky audit table header.
    Not covered by the z-index token scale, but `1` for local stacking context
    is a common pattern that does not need a global token.
    Severity: **NICE_TO_HAVE** -- Acceptable as a local stacking context value.

12. **Coverage chart has duplicate/overriding rules** -- `.alm-coverage-chart__track`
    and `.alm-coverage-chart__bar` are defined twice (lines ~1309-1322 and
    ~3274-3289). The second definition at line 3274 overrides the first with
    different border-radius and min-width values. This is intentional (wireframe
    style) but the first definition becomes dead code.
    Severity: **SHOULD_FIX** -- Remove the first definition or merge them.

---

## Stage 3: Interaction Design

### Passed

- **ListItem keyboard support** -- Handles Enter and Space key presses with
  `preventDefault()` on Space (correct -- prevents page scroll). `tabIndex={0}`
  makes items focusable. Focus-visible style uses the shared focus ring token.

- **ListSidebar Ctrl+F shortcut** -- Global keydown listener with proper cleanup
  in useEffect. `preventDefault()` prevents browser's native find dialog.
  `useCallback` with empty deps ensures stable handler reference.

- **Hover states** -- All interactive elements (buttons, list items, filter
  chips, sidebar items, calendar days, tabs, palette items) have `:hover`
  styles using token-based colors.

- **Selected state** -- ListItem uses `aria-selected` attribute and visual
  indicator (left border + background color). Consistent with pre-existing
  target-list and masters-list selected patterns.

- **Transition usage** -- All transitions use `var(--alm-transition-fast)` for
  immediate feedback (hover, background changes) and `var(--alm-transition-slow)`
  for animated elements (progress bars, coverage chart bars).
  `var(--alm-transition-base)` for medium transitions (sidebar width, section
  chevron rotation). Correct semantic usage.

- **Loading state** -- PageShell renders a `role="status"` div for loading.
  Screen readers will announce loading state changes.

- **Error state** -- PageShell renders a `role="alert"` div for errors. Screen
  readers will announce errors immediately.

- **Select dropdown accessibility** -- ListSidebar uses Base UI Select which
  provides built-in ARIA roles, keyboard navigation (arrow keys, Enter, Escape),
  and focus management for dropdown menus.

- **Toggle group accessibility** -- Filter pills use Base UI ToggleGroup which
  provides built-in ARIA toggle button semantics and keyboard support.

- **Disabled state** -- Buttons have `:disabled` styling (opacity 0.5,
  cursor not-allowed) and hover is excluded via `:not(:disabled)`. ActionDef
  supports `disabled` prop.

- **Modal overlay** -- ConfirmOverlay CSS uses `z-index: var(--alm-z-modal)` for
  both backdrop and content. Backdrop covers the full viewport with
  `position: fixed; inset: 0`.

### Issues

13. **Focus-visible coverage gap** -- 34 CSS rules set `cursor: pointer`
    (indicating interactive elements) but only 11 have `:focus-visible` styles.
    Missing focus-visible on: `.alm-filter-chip`, `.alm-tabs__tab`,
    `.alm-calendar__day--has-data`, `.alm-naming__chip` (draggable),
    `.alm-equipment__aliases`, `.alm-settings__nav-item`,
    `.alm-target-list__footer`, `.alm-palette__item`,
    `.alm-masters-list__item`, `.alm-svs__table tr`,
    `.alm-naming__override-toggle`, `.alm-catalogs__toggle`,
    `.alm-tools__toggle`, `.alm-density-selector__option`,
    `.alm-sessions-filter__add`, `.alm-plan-filter__add`,
    `.alm-protection__item label`, `.alm-statusbar` (has it),
    `.alm-step-sources__advanced-btn`.
    Severity: **SHOULD_FIX** -- DESIGN-SYSTEM.md validation criterion 10
    requires "all interactive elements have `:focus-visible` styles." Many of
    these are pre-existing, but the spec calls for consistent focus rings across
    all components.

14. **No arrow-key navigation in list** -- ListItem handles Enter/Space but not
    ArrowUp/ArrowDown for moving between items. The `role="list"` /
    `role="listitem"` pattern does not inherently provide arrow-key navigation
    (unlike `role="listbox"` / `role="option"`). Users must Tab between items.
    Severity: **SHOULD_FIX** -- For a list-detail UI where the list is the
    primary navigation mechanism, arrow-key support is expected. This can be
    implemented in the consumer (page component) or via a `useRovingTabIndex`
    pattern. Not blocking because Tab navigation works, but degrades keyboard
    UX in long lists.

15. **ListSidebar search does not clear on Escape** -- The Ctrl+F handler
    focuses the search input, but there is no Escape handler to clear the
    search or blur the input. This is a standard pattern users expect.
    Severity: **NICE_TO_HAVE** -- Can be added during page implementation.

16. **TopActionBar hotkey hints are visual-only** -- The `<kbd>` elements show
    hotkey text but there is no actual keyboard event handler registered.
    Hotkey registration is expected to happen at the page level, but there is
    no documented contract for how pages should wire hotkeys to ActionDef
    callbacks.
    Severity: **NICE_TO_HAVE** -- Hotkey implementation is a page-level concern.
    The visual hint is correct.

17. **ListSidebar `aside` landmark may conflict with sidebar `nav`** -- The
    component uses `<aside aria-label="List sidebar">`. If the page shell
    already has a sidebar with a `nav` landmark, screen readers may present
    confusing landmark navigation. The semantic role of the list panel is closer
    to `role="region"` than `aside`.
    Severity: **NICE_TO_HAVE** -- The `aria-label` differentiates it, and screen
    readers handle multiple landmarks well in practice.

---

## Overall Verdict

**APPROVED_WITH_CONDITIONS**

The UI Designer's work is high quality. The new components match the
DESIGN-SYSTEM.md contracts precisely. The token system is comprehensive and
correctly applied in all new CSS. The composition model is sound and will support
all six page types documented in the spec. The dead CSS cleanup was executed
correctly. Density support is thorough across the new components.

The conditions for approval are the two SHOULD_FIX items that affect the
frontend developer's ability to produce correct work:

1. Deprecated component JSDoc annotations (issue 2) -- prevents silent
   re-adoption during migration.
2. TopActionBar toolbar role (issue 3) -- a one-line fix that the frontend
   developer should not have to work around.

All other SHOULD_FIX items (issues 6, 7, 8, 12, 13, 14) are pre-existing
technical debt or enhancements that can be addressed during or after the page
migration phase without blocking frontend implementation.

---

## Required Fixes Before Frontend Implementation

1. Add `role="toolbar"` and `aria-label="Page actions"` to the TopActionBar
   root `div` in `TopActionBar.tsx`.

2. Add `/** @deprecated Use ListDetailLayout from @/components */` JSDoc to
   the `ThreePane` export in `ui/index.ts`, and similarly for `FilterBar`
   ("Use ListSidebar") and `Confidence` ("Removed in spec 030").

---

## Recommended Follow-Up (Non-Blocking)

These items should be tracked for the next iteration but do not block Phase 3:

- Migrate ~70 hardcoded `font-weight` values to `var(--alm-weight-*)` tokens
- Migrate ~30 hardcoded spacing values to `var(--alm-space-*)` tokens
- Migrate 5 hardcoded `border-radius` values to `var(--alm-radius-*)` tokens
- Add `--alm-text-inverse: #fff` token and use it in 4 places
- Remove duplicate `.alm-coverage-chart__track`/`__bar` definitions
- Add `:focus-visible` styles to ~20 interactive elements missing them
- Consider `role="listbox"` / `role="option"` with roving tabindex for list
  keyboard navigation
- Add Escape-to-clear on ListSidebar search input
