# Interface Design Review

**Date**: 2026-05-26
**Branch**: `030-ui-audit-revision`
**Reviewer scope**: Panel architecture, layout patterns, navigation, action placement, desktop UX

---

## Panel Architecture Assessment

### CSS vs. Code Reality

The spec 030 implementation introduced several new layout patterns in TSX
components, but **the corresponding CSS class definitions were never created**.
The result is that the new shared components and page layouts render with no
structural styling -- they fall back to browser defaults (stacked block
elements) rather than the intended flex-based panel arrangements.

**Classes referenced in TSX with zero CSS definitions** (0 matches in
`apps/desktop/src/styles/components.css`):

| Class name | Used by | Purpose |
|---|---|---|
| `.alm-list-detail-layout` | SessionsPage, CalibrationPage, TargetsPage | Two-column list+detail split |
| `.alm-list-detail-layout__list` | SessionsPage, CalibrationPage, TargetsPage | Left list pane |
| `.alm-list-detail-layout__detail` | SessionsPage, CalibrationPage, TargetsPage | Center detail pane |
| `.alm-hybrid-layout` | ProjectsPage | Three-column list+detail+sidebar |
| `.alm-hybrid-layout__list` | ProjectsPage | Left list pane |
| `.alm-hybrid-layout__content` | ProjectsPage | Center detail pane |
| `.alm-hybrid-layout__sidebar` | ProjectsPage | Right lifecycle sidebar |
| `.alm-top-action-bar` | TopActionBar component | Page-level action toolbar |
| `.alm-top-action-bar__heading` | TopActionBar component | Title area |
| `.alm-top-action-bar__title` | TopActionBar component | Page title |
| `.alm-top-action-bar__subtitle` | TopActionBar component | Subtitle text |
| `.alm-top-action-bar__actions` | TopActionBar component | Right-aligned action buttons |
| `.alm-top-action-bar__hotkey` | TopActionBar component | Keyboard shortcut hint |
| `.alm-list-sidebar` | ListSidebar component | Composite left panel |
| `.alm-list-sidebar__search` | ListSidebar component | Search input area |
| `.alm-list-sidebar__controls` | ListSidebar component | Group/sort dropdowns |
| `.alm-list-sidebar__filters` | ListSidebar component | Filter pill row |
| `.alm-list-sidebar__list` | ListSidebar component | Scrollable list area |
| `.alm-list-sidebar__footer` | ListSidebar component | Item count footer |
| `.alm-property-table` | PropertyTable component | Key-value property grid |
| `.alm-property-table__header` | PropertyTable component | Column headers |
| `.alm-property-table__row` | PropertyTable component | Data rows |
| `.alm-property-table__cell` | PropertyTable component | Individual cells |
| `.alm-property-table__source-badge` | PropertyTable component | Source indicator |
| `.alm-action-sidebar` | ActionSidebar (Inbox) | Right-side action panel |
| `.alm-action-sidebar__header` | ActionSidebar (Inbox) | Panel header |
| `.alm-action-sidebar__buttons` | ActionSidebar (Inbox) | Button stack |
| `.alm-action-sidebar__btn` | ActionSidebar (Inbox) | Same-width buttons |
| `.alm-action-sidebar__hotkey` | ActionSidebar (Inbox) | Hotkey badge |
| `.alm-lifecycle-sidebar` | LifecycleSidebar (Projects) | Right lifecycle panel |
| `.alm-lifecycle-sidebar__phase` | LifecycleSidebar (Projects) | Phase badge area |
| `.alm-lifecycle-sidebar__actions` | LifecycleSidebar (Projects) | Phase action buttons |
| `.alm-lifecycle-sidebar__stats` | LifecycleSidebar (Projects) | Quick stats area |
| `.alm-inbox-page` | InboxPage | Page wrapper |
| `.alm-inbox-page__toolbar` | InboxPage | Filter toolbar |
| `.alm-archive-page` | ArchivePage | Page wrapper |
| `.alm-session-detail` | SessionDetailContent | Detail content wrapper |
| `.alm-session-detail__header` | SessionDetailContent | Header with actions |
| `.alm-session-detail__summary` | SessionDetailContent | Stats bar |
| `.alm-session-review` | SessionReview (Inbox) | Review panel wrapper |
| `.alm-project-detail` | ProjectDetailInline | Project detail wrapper |
| `.alm-source-map` | SourceMap component | Column layout grid |

**Classes that DO have CSS definitions** (existing from pre-030 work):

- `.alm-shell`, `.alm-shell__body`, `.alm-shell__main` -- app shell (lines 261-328)
- `.alm-sidebar` and variants -- nav sidebar (lines 330-546)
- `.alm-statusbar` -- status bar (lines 548-584)
- `.alm-page`, `.alm-page__empty` -- basic page wrapper (lines 900-1336)
- `.alm-settings` and variants -- settings two-pane layout (lines 1338-1425)
- `.alm-toolbar` -- generic toolbar (lines 199-218)
- `.alm-wizard-wrapper`, `.alm-wizard-footer` -- wizard (lines 4749-4786)
- `.alm-master-detail` -- calibration detail (20 definitions around line 3700+)
- `.alm-target-list` -- target left pane (lines 1128-1225)
- `.alm-target-detail` -- target right pane (lines 1227-1258)
- `.alm-calendar` -- calendar view (lines 1062-1125)
- `.alm-session-detail-grid`, `.alm-session-detail-inline` -- older session layouts (lines 3695, 4232)

### Impact

The ThreePane component (`apps/desktop/src/ui/ThreePane.tsx`) uses **inline
styles** rather than CSS classes -- it works but bypasses the design token
system entirely. This is the only layout component that actually renders a
visible multi-column arrangement. All other layout patterns are broken.

---

## Layout Pattern Catalog

### Per-Page Layout Analysis

| Page | Spec layout | Current implementation | CSS exists? | Status |
|---|---|---|---|---|
| **Inbox** | ThreePane: list + detail + right action sidebar | `ThreePane` with `ListSidebar` + `SessionReview` + `ActionSidebar` | ThreePane uses inline styles; ListSidebar/ActionSidebar classes missing | PARTIAL -- structure is correct via inline styles, but no token-based styling |
| **Sessions** | TwoPane: list + detail, TopActionBar above | `alm-list-detail-layout` div wrapping list + detail, `TopActionBar` above | NO -- both `.alm-list-detail-layout` and `.alm-top-action-bar` are undefined | BROKEN -- renders as stacked blocks, not side-by-side |
| **Calibration** | TwoPane: list + detail, TopActionBar above | Same `alm-list-detail-layout` pattern + `TopActionBar` | NO | BROKEN |
| **Targets** | TwoPane: list + detail, TopActionBar above | Same `alm-list-detail-layout` pattern + `TopActionBar` | NO | BROKEN |
| **Projects** | ThreePane: list + detail + right lifecycle sidebar | `alm-hybrid-layout` div wrapping list + content + sidebar | NO -- `.alm-hybrid-layout` undefined | BROKEN -- three children render stacked, not as columns |
| **Archive** | TwoPane: ListSidebar + detail area with TopActionBar | `ListSidebar` is a sibling of `.alm-archive-page__detail`, no wrapping layout div | NO -- `.alm-archive-page` undefined | BROKEN -- no flex container |
| **Settings** | TwoPane: nav rail + content | Uses `.alm-settings` class | YES -- fully defined | OK |
| **Setup Wizard** | Standalone, no shell | Uses `.alm-wizard-wrapper` | YES -- partially defined | OK |

### Inconsistencies Across Pages

1. **Three different layout div patterns**:
   - InboxPage: uses `ThreePane` component (inline styles)
   - SessionsPage/CalibrationPage/TargetsPage: uses `.alm-list-detail-layout` class (no CSS)
   - ProjectsPage: uses `.alm-hybrid-layout` class (no CSS)
   - ArchivePage: uses `.alm-archive-page` with no layout wrapper at all

2. **TopActionBar placement varies**:
   - Sessions/Calibration/Targets: TopActionBar is a sibling above the list-detail div (correct per spec)
   - Archive: TopActionBar is nested inside the detail pane (wrong -- should be page-level)
   - Inbox/Projects: no TopActionBar (correct -- they use right sidebars)

3. **ListSidebar usage varies**:
   - InboxPage: `ListSidebar` passed as `list` prop to `ThreePane`
   - ArchivePage: `ListSidebar` used directly as a top-level child (not inside any layout component)
   - Sessions/Calibration/Targets: custom list components (`SessionsList`, `MastersList`, `TargetList`) wrapped in `.alm-list-detail-layout__list` divs, NOT using `ListSidebar`

---

## Shared Layout Contracts

The spec defines exactly two layout patterns (FR-004). The implementation
should use exactly two reusable layout components with CSS-class-based styling
tied to the design token system.

### Layout A: TwoPane (Sessions, Calibration, Targets, Archive)

```
+-----+------------------------------------------+
| Top | TopActionBar (full width)                 |
+-----+------------------------------------------+
| List|                  Detail                   |
|     |                                           |
|280px|               flex: 1                     |
|     |                                           |
+-----+------------------------------------------+
```

**CSS contract**:
```css
.alm-layout-two-pane {
  display: flex;
  flex-direction: column;
  flex: 1;
  overflow: hidden;
}
.alm-layout-two-pane__body {
  display: flex;
  flex: 1;
  min-height: 0;
}
.alm-layout-two-pane__list {
  width: 280px;
  flex-shrink: 0;
  overflow-y: auto;
  border-right: 1px solid var(--alm-border);
}
.alm-layout-two-pane__detail {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
}
```

**Pages**: Sessions, Calibration, Targets, Archive.

### Layout B: ThreePane (Inbox, Projects)

```
+------+---------------------------+-------+
| List |         Content           | Action|
|      |                           |Sidebar|
|280px |        flex: 1            | 220px |
|      |                           |       |
+------+---------------------------+-------+
```

**CSS contract**:
```css
.alm-layout-three-pane {
  display: flex;
  flex: 1;
  min-height: 0;
}
.alm-layout-three-pane__list {
  width: 280px;
  flex-shrink: 0;
  overflow-y: auto;
  border-right: 1px solid var(--alm-border);
}
.alm-layout-three-pane__content {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
}
.alm-layout-three-pane__sidebar {
  width: 220px;
  flex-shrink: 0;
  overflow-y: auto;
  border-left: 1px solid var(--alm-border);
}
```

**Pages**: Inbox (action sidebar), Projects (lifecycle sidebar).

### Current ThreePane Component Problem

The existing `ThreePane` component at `apps/desktop/src/ui/ThreePane.tsx` uses
inline styles (`style={{ display: 'flex', ... }}`). This bypasses the design
token system and prevents responsive adjustments via CSS. It should be replaced
with the CSS-class-based Layout B above. Key differences:

- Inline `width: 260px` / `width: 380px` hardcoded per usage vs. consistent
  token-based widths.
- Inline `borderRight` / `borderLeft` vs. CSS vars `--alm-border`.
- No density-mode adjustments possible.
- No media query support for narrow windows.

---

## Navigation & Routing Issues

### Sidebar Navigation (Sidebar.tsx)

**Correct per spec**: 7 nav items matching FR-001 (Inbox, Sessions, Calibration,
Targets, Projects, Archive, Settings). "Review Queue" has been renamed to
"Inbox" (FR-002). Plans and Audit Log have been removed from top-level nav
(FR-003).

**Issues found**:

1. **No glyph icons** -- The sidebar uses text characters as glyphs (`'S'`,
   `'C'`, `'P'`, `'⬇'`, `'⌖'`, `'▣'`, `'⚙'`). These are placeholders, not
   proper icons. The collapsed sidebar renders single characters that are hard
   to distinguish.

2. **Sidebar footer** (lines 155-173): Correctly shows root health with colored
   dots and links to Data Sources settings. However, the spec says offline roots
   should show "NAS-Astro offline" (naming the specific root) with an amber dot,
   but the implementation shows the last path segment which could be cryptic
   (e.g., `E:` instead of a meaningful name).

3. **No counts badge on Inbox** in the sidebar when collapsed -- the warn dot
   appears but not the count number. The expanded sidebar does show counts.

### Routing (router.tsx)

**Issues found**:

1. **Calibration and Target detail routes exist as standalone pages**
   (`/calibration/$id`, `/targets/$id`) but the actual page components use
   inline detail rendering within the list-detail layout. The standalone
   routes render `CalibrationDetail` and `TargetDetail` components outside
   the list-detail context, which means they lack the list pane entirely.
   Sessions handle this with a redirect (`/sessions/$id` redirects to
   `/sessions?selected=id`), but calibration and targets do not.

2. **Project detail route** (`/projects/$id`) exists separately from
   `ProjectsPage`, rendering `ProjectDetail` in isolation without the
   project list or lifecycle sidebar.

3. **Index route** (`/`) renders `SessionsPage` directly, which is reasonable
   as a default landing page but is not documented in the spec.

4. **No breadcrumb support** -- The router uses flat routes with no nested
   route tree that would enable breadcrumb generation. Each detail view is
   either inline (correct) or a standalone route (orphaned from context).

---

## Action Placement Audit

### Spec Requirements (FR-004, FR-006)

- **Inbox + Projects**: right action sidebar with same-width buttons and hotkeys
- **Sessions, Calibration, Targets, Archive**: top action bar, no right sidebar

### Current State

| Page | Spec action location | Actual action location | Matches spec? |
|---|---|---|---|
| **Inbox** | Right action sidebar | `ActionSidebar` component in ThreePane `detail` slot | YES -- correct pattern |
| **Sessions** | Top action bar | Actions in `SessionDetailContent` header (`.alm-session-detail__header-actions`) -- buttons are inside the detail pane header, not in TopActionBar | PARTIAL -- TopActionBar exists but only has List/Calendar toggle; session-level actions (Re-open, Move to Inbox, Use in project) are embedded in the detail content header |
| **Calibration** | Top action bar | TopActionBar has "Import master" and "Re-run matching" -- but spec says NO import master and NO re-run matching buttons (section 4.4 Removed Elements) | WRONG -- contains removed actions |
| **Targets** | Top action bar | TopActionBar has "+ New target" -- but spec says no "New target" button (section 5.5: "targets come from catalogs and FITS metadata, not manual creation") | WRONG -- contains removed action |
| **Projects** | Right lifecycle sidebar | `LifecycleSidebar` in `alm-hybrid-layout__sidebar` | YES -- correct pattern |
| **Archive** | Top action bar | TopActionBar nested inside detail pane, has Re-queue and Delete | PARTIAL -- correct actions but wrong placement (should be page-level, not detail-level) |

### Action Button Consistency (FR-006)

The spec requires all action buttons within a view to be the **same width**
with hotkeys shown.

- **Inbox ActionSidebar**: Buttons use `className="alm-action-sidebar__btn"`
  with hotkey `<kbd>` elements -- structurally correct but CSS is missing,
  so same-width constraint is not enforced.
- **TopActionBar**: Buttons use `Btn` component with natural width (no
  same-width constraint). Hotkeys are rendered via `<kbd>` in the TopActionBar
  but the per-page action definitions in CalibrationPage, TargetsPage, and
  SessionsPage do not provide `hotkey` props -- they pass `undefined`.
- **LifecycleSidebar**: Uses `Btn size="sm"` with no hotkeys at all.

### Missing "Reveal in Explorer" Action

The spec explicitly adds "Reveal in Explorer" as a standard action on **all**
detail views backed by files (FR-056, sections 2.3, 3.4, 4.3, 4.5). This
action is not present on any page in the current implementation.

---

## Desktop UX Patterns

### Keyboard Navigation

**Implemented**:

- `Ctrl+F` / `Cmd+F` focuses search input in `ListSidebar` (line 53-58 of
  `ListSidebar.tsx`)
- Single-key hotkeys in Inbox `ActionSidebar` (`C`, `R`, `S`, `M`, `E`) with
  proper input element exclusion (lines 43-63 of `ActionSidebar.tsx`)
- `Ctrl+K` / `Cmd+K` opens command palette (in `CommandPalette.tsx`)

**Missing**:

- No `Up`/`Down` arrow key navigation in any list panel. All lists render
  items as `<button>` or `<li>` elements without `role="listbox"` or
  `aria-activedescendant` patterns. Users must click to select.
- No `Escape` to deselect or close panels.
- No `Tab` cycling between list, detail, and sidebar panes.
- No hotkeys on TopActionBar actions (the `hotkey` prop exists but is never
  provided by any page).
- No keyboard shortcut for sidebar collapse/expand.
- No keyboard shortcuts for navigating between top-level screens (e.g.,
  `Ctrl+1` through `Ctrl+7`).

### Density Modes

The shell applies `density-${prefs.density}` as a class on `.alm-shell`
(Shell.tsx, line 31). The Settings > General pane exposes a density selector
with three options (compact/comfortable/spacious).

However, `tokens.css` defines density-responsive CSS variables but the
new components (TopActionBar, ListSidebar, PropertyTable, ActionSidebar,
LifecycleSidebar) have no CSS at all, so density has no effect on them.
Only the pre-existing components (toolbar, sidebar nav, status bar) respond
to density changes.

### Resize Behavior

- The main nav sidebar has a fixed width (184px expanded, 44px collapsed) with
  no drag-to-resize. This is acceptable for a sidebar nav.
- The ThreePane inline styles use fixed pixel widths (`listWidth`, `detailWidth`)
  with no min/max constraints. On narrow windows, the center content pane
  could shrink to zero.
- The `.alm-list-detail-layout` pattern (if CSS existed) would also need
  min-width constraints on both panes.
- No panel resize handles exist anywhere -- all splits are fixed-width.

### Focus Management

- No focus trap in overlays. `InboxConfirmOverlay`, `SplitPreview`, and
  `MergeSearch` render as overlays but do not trap focus.
- `ConfirmOverlay` (shared component) also lacks focus trapping.
- When a list item is selected, focus does not move to the detail pane.
- When an overlay closes, focus does not return to the triggering element.

---

## Recommendations

### P0 -- Critical (Layout is broken)

1. **Write CSS definitions for all missing layout classes**. The 35+ CSS class
   names listed in the Panel Architecture Assessment have zero CSS. Without
   these, the list-detail and three-pane layouts render as stacked blocks.
   Priority classes:
   - `.alm-list-detail-layout` and children (fixes Sessions, Calibration,
     Targets)
   - `.alm-hybrid-layout` and children (fixes Projects)
   - `.alm-top-action-bar` and children (fixes all top action bars)
   - `.alm-list-sidebar` and children (fixes all list panels)
   - `.alm-property-table` and children (fixes all property displays)
   - `.alm-action-sidebar` and children (fixes Inbox right panel)
   - `.alm-lifecycle-sidebar` and children (fixes Projects right panel)
   - `.alm-inbox-page`, `.alm-archive-page`, `.alm-session-detail`,
     `.alm-session-review`, `.alm-project-detail`, `.alm-source-map`

2. **Replace ThreePane inline styles with CSS classes**. The `ThreePane`
   component at `apps/desktop/src/ui/ThreePane.tsx` should use CSS classes
   from the design token system instead of inline `style` props. This enables
   density mode support and responsive behavior.

### P1 -- Structural (Wrong actions, wrong placement)

3. **Remove spec-deleted actions from CalibrationPage** (line 23-24): Remove
   "Import master..." and "Re-run matching" from the TopActionBar. Replace
   with the spec actions: "Use in Project", "Reveal in Explorer", "Archive".

4. **Remove "+ New target" from TargetsPage** (line 47): The spec explicitly
   says targets come from catalogs and FITS metadata, not manual creation.
   Replace with spec actions: "Edit aliases", "Link plan", "New project".

5. **Move session-level actions from SessionDetailContent header into
   TopActionBar**. Currently "Re-open to review", "Move to Inbox", "Use in
   project" are in the detail header. Per spec, these should be in the
   TopActionBar: "Use in Project", "Move to Inbox", "Reveal in Explorer",
   "Archive".

6. **Fix Archive TopActionBar placement**. The TopActionBar in ArchivePage is
   nested inside `.alm-archive-page__detail`. It should be at the page level,
   above the list-detail split, consistent with Sessions/Calibration/Targets.

7. **Add "Reveal in Explorer" to all detail views**. FR-056 and section 4.5
   require this on Inbox, Sessions, Calibration, Targets, Projects, and
   Archive detail panels.

### P1 -- Consistency

8. **Standardize ListSidebar usage**. Currently only InboxPage and ArchivePage
   use the shared `ListSidebar` component. Sessions, Calibration, and Targets
   use their own custom list components (`SessionsList`, `MastersList`,
   `TargetList`) that duplicate search/sort/group/filter controls. All pages
   should compose their list items inside `ListSidebar` for FR-005 (identical
   controls in the same position).

9. **Fix LifecycleSidebar actions to match spec**. The current phase actions
   include spec-removed items:
   - `processing` phase has "Record output" and "Observe artifacts" (removed
     per spec section 6.6)
   - `ready` phase has "Edit source map" (not in spec)
   - Missing: "Mark sources complete" (Setup), "Mark complete" (Processing)
   - Missing: "Reveal source views" (Processing)
   - Still references `prepared` state (removed per FR-081)

10. **Unify detail route handling**. Calibration (`/calibration/$id`) and
    Targets (`/targets/$id`) have standalone detail routes that render without
    list context. Either redirect to the list page with a `?selected=id`
    parameter (like Sessions does) or remove the standalone routes.

### P2 -- Desktop Polish

11. **Add arrow key navigation to list panels**. Implement `role="listbox"` on
    list containers and `role="option"` on items with `Up`/`Down` arrow key
    support and `aria-activedescendant`.

12. **Add hotkeys to TopActionBar actions**. The `hotkey` prop exists in the
    `ActionDef` interface but no page provides values. Add hotkey definitions
    per spec and register global keyboard listeners.

13. **Add focus trapping to overlays**. `ConfirmOverlay`, `InboxConfirmOverlay`,
    `SplitPreview`, and `MergeSearch` need focus trap behavior and
    return-focus-on-close.

14. **Add panel min-width constraints**. Both layout patterns need CSS
    `min-width` on the list and detail panes to prevent collapse on narrow
    windows. Suggested: list min 200px, detail min 300px, sidebar min 180px.

15. **Replace text glyph placeholders with proper icons**. The sidebar nav
    uses literal characters (`'S'`, `'C'`, `'P'`) as icon placeholders.
    These should be replaced with SVG icons or an icon font for visual
    clarity, especially in the collapsed sidebar state.

### P3 -- Enhancement

16. **Add screen-level keyboard shortcuts** (`Ctrl+1` through `Ctrl+7`) for
    navigating between top-level screens.

17. **Add Escape key handling** to deselect the current item in list-detail
    views and to close overlays.

18. **Consider drag-to-resize panel dividers** for the list-detail split,
    particularly for users with ultra-wide monitors who want more list space.

---

## File Reference

| File | Role |
|---|---|
| `apps/desktop/src/app/Shell.tsx` | App shell -- correct, applies density class |
| `apps/desktop/src/app/Sidebar.tsx` | Nav sidebar -- correct structure, needs icons |
| `apps/desktop/src/app/StatusBar.tsx` | Status bar -- correct structure |
| `apps/desktop/src/app/router.tsx` | Route tree -- orphaned detail routes |
| `apps/desktop/src/styles/components.css` | CSS -- missing 35+ class definitions |
| `apps/desktop/src/ui/ThreePane.tsx` | Layout -- inline styles, needs CSS migration |
| `apps/desktop/src/components/ListSidebar.tsx` | Shared list panel -- correct API, no CSS |
| `apps/desktop/src/components/TopActionBar.tsx` | Shared action bar -- correct API, no CSS |
| `apps/desktop/src/components/PropertyTable.tsx` | Shared property table -- correct API, no CSS |
| `apps/desktop/src/features/inbox/InboxPage.tsx` | Uses ThreePane (partial fix) |
| `apps/desktop/src/features/inbox/ActionSidebar.tsx` | Right sidebar -- correct, no CSS |
| `apps/desktop/src/features/sessions/SessionsPage.tsx` | Uses undefined layout classes |
| `apps/desktop/src/features/sessions/SessionDetail.tsx` | Actions in wrong location |
| `apps/desktop/src/features/calibration/CalibrationPage.tsx` | Wrong actions in TopActionBar |
| `apps/desktop/src/features/targets/TargetsPage.tsx` | Wrong action in TopActionBar |
| `apps/desktop/src/features/projects/ProjectsPage.tsx` | Uses undefined layout classes |
| `apps/desktop/src/features/projects/LifecycleSidebar.tsx` | Wrong phase actions |
| `apps/desktop/src/features/archive/ArchivePage.tsx` | TopActionBar in wrong position |
| `apps/desktop/src/features/settings/SettingsPage.tsx` | OK -- has CSS definitions |
