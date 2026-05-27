# Visual Validation Report

**Validator**: UI Visual Validator (Spec 030)
**Date**: 2026-05-26
**Viewport**: 1440x900
**Branch**: 030-ui-audit-revision
**Screenshots**: `.design/validation/spec030-{screen}.png`

---

## Per-Screen Results

### Sessions (`/#/sessions`)

**Screenshots**: `spec030-sessions.png`, `spec030-sessions-detail.png`

- **Layout**: PASS -- Two-pane layout. List on left (width 279px starting at x=184), detail on right (width 976px starting at x=464). Horizontal split, not stacked.
- **TopActionBar**: PASS -- Present at top (box 184,0,1256,49). Contains heading "Sessions", subtitle "10 sessions / 4 confirmed / 2 needs review", and a "Calendar" action button.
- **List sidebar**: PASS -- Contains search box (263x32), group/sort comboboxes, filter chip buttons (Confirmed, needs_review, discovered, candidate, Rejected, ignored), additional filter comboboxes, scrollable list, and "10 items" count at bottom.
- **Detail pane (empty)**: PASS -- EmptyState with heading "Select a session" and description text, centered in the detail area.
- **Detail pane (selected)**: PASS -- Shows session header "NGC 7000 / SII / 2026-04-18" with status badges, action buttons (Re-open to review, Move to Inbox, Use in project), metadata table, calibration matches, framesets, and history sections.
- **Sidebar nav**: PASS -- Active state indicator (left border) on "Sessions". Count badge "247" displayed.
- **Status bar**: PASS -- Visible at bottom (box 0,874,1440,26). Shows "0 sessions / 0 cal" and "Log" toggle button.
- **Styling**: PASS -- Consistent cream/warm background. Borders between list items. Filter chips with outlined style. Status badges with appropriate colors (green for Confirmed, red for Rejected).

### Calibration (`/#/calibration`)

**Screenshot**: `spec030-calibration.png`

- **Layout**: PASS -- Two-pane layout. List on left (279px), detail on right. Horizontal split.
- **TopActionBar**: PASS -- Present (box 184,0,1256,49). Contains heading "Calibration", subtitle "11 masters / 4 darks / 5 flats / 2 bias / 2 aging", and action buttons (Use in Project, Reveal in Explorer, Archive).
- **List sidebar**: PASS -- Search box (263x32) at same position as Sessions. Group/sort comboboxes. Filter chips (Darks, Flats, Bias, Aging >90d). List grouped by kind (Darks, Flats, Bias sections with headers). "11 items" count at bottom.
- **Detail pane**: PASS -- Auto-selected first item. Shows master dark detail with matching fingerprint card (8 fields), provenance card, usage card (2 sessions matched, 4 projects), linked projects table, and compatible acquisition sessions table. Detail area includes a sub-toolbar with tabs (Masters, Calibration sessions, Match candidates, Import master, Re-run matching).
- **Sidebar nav**: PASS -- Active state on "Calibration". Count "84".
- **Status bar**: PASS -- Same position and style as Sessions.
- **Styling**: PASS -- Provenance data confidence indicators (filled circle = Reviewed, empty circle = Observed, half-filled = Inferred, diamond = Generated) consistently rendered. Tables well-structured with column headers.

### Targets (`/#/targets`)

**Screenshot**: `spec030-targets.png`

- **Layout**: PASS -- Two-pane layout. List on left (279px), detail on right. The detail pane itself is split into two columns (left identity/coverage/plans at x=484 width=320, right sessions/projects at x=824 width=596).
- **TopActionBar**: PASS -- Present (box 184,0,1256,49). Contains heading "Targets", subtitle "6 targets", and action buttons (Edit aliases, Link plan, New project). "New project" has a distinct filled/primary button style.
- **List sidebar**: PASS -- Search box, group/sort comboboxes, filter chips (Deep sky, Planetary, Lunar, Solar). List items show target name, common name, session count, integration hours, project count. "6 items" count at bottom.
- **Detail pane**: PASS -- Auto-selected NGC 7000. Shows identity section (primary name, aliases, catalog IDs, kind, RA/Dec, constellation with confidence indicators), coverage-at-a-glance with filter coverage meter bars, observing plans list, sessions table (expandable), and projects table (expandable). Coverage warning displayed for OIII.
- **Sidebar nav**: PASS -- Active state on "Targets". Count "53".
- **Status bar**: PASS -- Consistent.
- **Styling**: PASS -- Coverage meter bars with subtle gradient fills. Expandable sections with chevron toggle icons. Tables styled identically to Calibration page.

### Projects (`/#/projects`)

**Screenshot**: `spec030-projects.png`

- **Layout**: PASS -- Three-pane layout. List on left (279px), detail center (756px from x=464 to x=1220), lifecycle sidebar on right (219px from x=1221).
- **TopActionBar**: PASS (absent as expected) -- Three-pane pages do not have a TopActionBar. Correct behavior.
- **List sidebar**: PASS -- Search box at y=8 (top, since no TopActionBar). Group/sort comboboxes. Filter chips (Processing, Ready, Completed, Archived, Blocked). List items show project name with lifecycle badge, target name, integration time, and disk size. "+ New project" button at bottom. "7 items" count.
- **Detail pane**: PASS -- Shows project header "NGC 7000 / HOO" with lifecycle badge "Processing" and file path. Pipeline stats bar (Sources:7 | Views:2 | On disk:8.4 GB | Outputs:4). Expandable sections: Source map (grouped by Lights/Darks/Flats/Bias with selection states), Source views, Notes, and Cleanup opportunities with artifact table.
- **Lifecycle sidebar**: PASS -- Contains "Lifecycle" section with lifecycle state diagram (setup -> ready -> processing -> completed -> archived), "Actions" section (Mark complete, Re-generate view), and "Quick stats" section with key/value pairs (Integration, On disk, Profile, Targets, Cleanup, Outputs, Notes, Manifests).
- **Sidebar nav**: PASS -- Active state on "Projects". Count "19".
- **Status bar**: PASS -- Consistent.
- **Styling**: PASS -- Lifecycle badges use distinct colors. Source map uses indented tree-like structure. Cleanup table is compact with eligibility badges.

### Inbox (`/#/inbox`)

**Screenshots**: `spec030-inbox.png`, `spec030-inbox-detail.png`

- **Layout**: PASS -- Three-pane layout. List on left (279px), detail center, action sidebar on right (219px from x=1221).
- **TopActionBar**: PASS (absent as expected) -- Three-pane page, no TopActionBar. Correct.
- **List sidebar**: PASS -- Search box at y=8. Group/sort comboboxes. Filter chips (Lights, Darks, Flats, Bias). Additional filter-by-filter-type combobox. List items show target name, filter badge, date, integration time, disk size, frame type label, and frame count. "7 items" count.
- **Detail pane (empty)**: PASS -- EmptyState centered with "Select a session" heading and description text.
- **Detail pane (selected)**: PASS -- Shows session header "IC 1396 - 2025-10-10 - Ha" with badges (light, Ha). "Conflicts Detected" warning banner. Properties table with editable fields (Object, Frame Type, Filter, Gain, Binning, Exposure, Temperature, Set Temperature) showing VALUE, SOURCE, and CONFIRM columns. Frames summary section. Location section.
- **Action sidebar**: PASS -- "Actions" heading. Confirm (C) and Reject (R) buttons with colored fill (green/red), Split (S), Merge (M), and Edit (E) buttons. Buttons are disabled when no selection, enabled when item selected. Helpful text "Select a session from the list to enable actions."
- **Sidebar nav**: PASS -- Active state on "Inbox". Count "12".
- **Status bar**: PASS -- Consistent.
- **Styling**: PASS -- Conflict banner uses warm/yellow tone. Editable property values appear in input fields. Confirm checkboxes on right side of property rows.

### Archive (`/#/archive`)

**Screenshot**: `spec030-archive.png`

- **Layout**: PASS WITH NOTES -- Shows full-page EmptyState because `hasData` is false (empty items array). The two-pane layout with TopActionBar is defined in code but not rendered because PageShell gates children behind `hasData`. This is intentional design behavior.
- **TopActionBar**: N/A -- Not rendered because PageShell shows EmptyState before children.
- **Empty state**: PASS -- EmptyState component with heading "Archive is empty" and description "Items moved to archive will appear here." Centered in the main content area.
- **Sidebar nav**: PASS -- Active state on "Archive". No count badge (correct -- archive has no count).
- **Status bar**: PASS -- Consistent.
- **Styling**: PASS -- EmptyState styling consistent with empty states on other pages.

### Settings (`/#/settings`)

**Screenshot**: `spec030-settings.png`

- **Layout**: PASS -- Settings layout with category navigation on left (220px wide starting at x=184) and content area on right (1036px starting at x=404). No TopActionBar or list/detail split -- this is a distinct settings layout pattern.
- **Settings categories nav**: PASS -- 11 categories listed vertically: Data Sources, Equipment, Ingestion, Naming & Structure, Processing Tools, Calibration Matching, Target Catalogs, Cleanup, General, Advanced, Audit Log. Active state highlighting on "Data Sources".
- **Content area**: PASS -- Shows "Data Sources" heading (h2), description text, "Add source folder" button, and a table with PATH, TYPE columns and Reveal/Remove action buttons. 6 data source rows with monospace path text and type badges (raw, calibration, project, inbox, archive, overflow).
- **Sidebar nav**: PASS -- Active state on "Settings". No count badge (correct).
- **Status bar**: PASS -- Consistent.
- **Styling**: PASS -- Clean table layout. Type badges with outlined pill style. Paths rendered in code/monospace font. Reveal/Remove buttons as ghost actions.

---

## Cross-Screen Consistency

### Navigation Sidebar
- **Width consistent across all screens?** YES -- 184px on every screen (box 0,0,184,874).
- **All 7 items present?** YES -- Inbox (12), Sessions (247), Calibration (84), Targets (53), Projects (19), Archive (no count), Settings (no count).
- **Count badges present on correct items?** YES -- Inbox, Sessions, Calibration, Targets, Projects show counts. Archive and Settings correctly omit counts.
- **Active state indicator consistent?** YES -- Left border accent on the active nav item visible on every screen.
- **Collapse button present?** YES -- "Collapse sidebar" button with chevron character consistently at top right of sidebar.
- **Footer link present?** YES -- "0 roots / 0 online" link to settings/data-sources at bottom of sidebar on all screens.

### List Panels
- **All list panels the same width?** YES -- 279px on all screens that have a list panel (Sessions, Calibration, Targets, Projects, Inbox).
- **All search boxes in the same position?** YES within categories:
  - Two-pane screens (Sessions, Calibration, Targets): search at (192, 57, 263, 32) -- positioned below TopActionBar.
  - Three-pane screens (Projects, Inbox): search at (192, 8, 263, 32) -- positioned at top since no TopActionBar.
  - Search box dimensions are identical (263x32) across all screens.
- **All search boxes same dimensions?** YES -- 263x32 on every screen.
- **Group/sort comboboxes consistent?** YES -- Present on all list screens in the same relative position below the search box.
- **Filter chips present?** YES -- Every list screen has a `group` element with filter chip buttons. Styles are consistent (outlined pill buttons).
- **Item count at bottom?** YES -- "N items" text at bottom of every list panel.

### TopActionBars
- **Present on correct screens?** YES:
  - Two-pane (Sessions, Calibration, Targets): TopActionBar present with height 49px.
  - Three-pane (Projects, Inbox): No TopActionBar. Correct.
  - Archive: N/A (empty state).
  - Settings: N/A (different layout pattern).
- **Styled identically?** YES -- Same height (49px), same background, heading on left with subtitle, action buttons on right.

### Sidebars (Three-Pane)
- **Present on correct screens?** YES:
  - Projects: LifecycleSidebar (complementary "Project lifecycle sidebar") at x=1221, width=219.
  - Inbox: ActionSidebar (complementary "Session actions") at x=1221, width=219.
  - Two-pane screens: No sidebar. Correct.
- **Same width?** YES -- Both 219px wide at same x position.

### Empty States
- **Using EmptyState component?** YES:
  - Sessions empty detail: heading "Select a session", description text.
  - Inbox empty detail: heading "Select a session", description text.
  - Archive full page: heading "Archive is empty", description text.
  - All use the `EmptyState` component with `role="status"` (Sessions, Inbox detail) or direct rendering (Archive via PageShell).

### Status Bar
- **Visible at bottom on all screens?** YES -- box (0, 874, 1440, 26) on every screen. Height 26px.
- **Content consistent?** YES -- "0 sessions / 0 cal" and "Log" toggle button on every screen.

---

## Issues Found

### MAJOR Issues

1. **MAJOR -- Archive page shows no list/TopActionBar structure when empty**
   - **Screen**: Archive
   - **Observation**: When the archive has no items, PageShell renders a full-page EmptyState instead of showing the two-pane layout with an empty list. This means users cannot see the TopActionBar, search box, or any structural UI until data exists.
   - **Impact**: Users visiting Archive for the first time see a drastically different layout from all other screens. Once data arrives, the entire visual structure changes, which may be disorienting.
   - **Recommendation**: Consider rendering the ListDetailLayout even when empty, with an empty state inside the list or detail area (as Sessions and Inbox already do). This would maintain structural consistency.
   - **Severity**: MAJOR -- structural inconsistency vs. other screens.

2. **MAJOR -- Calibration TopActionBar actions appear context-dependent without selection**
   - **Screen**: Calibration
   - **Observation**: The TopActionBar on Calibration shows "Use in Project", "Reveal in Explorer", and "Archive" buttons at all times. On Sessions, the TopActionBar only shows "Calendar" (a page-level action). On Targets, it shows "Edit aliases", "Link plan", "New project". The Calibration bar has item-specific actions that should arguably be disabled or hidden when no item is selected.
   - **Impact**: Users may click item-specific actions without having selected an item, leading to confusion or errors.
   - **Note**: The Calibration page auto-selects the first item, so this may be partially mitigated, but the pattern differs from Sessions where no auto-selection occurs.
   - **Severity**: MAJOR -- behavioral inconsistency across screens.

### MINOR Issues

3. **MINOR -- Inconsistent auto-selection behavior across screens**
   - **Screens**: Sessions vs. Calibration vs. Targets
   - **Observation**: Sessions does NOT auto-select the first item (shows EmptyState "Select a session"). Calibration and Targets DO auto-select the first/last item. This is inconsistent user experience.
   - **Recommendation**: Decide on a single pattern -- either all two-pane screens auto-select or none do.
   - **Severity**: MINOR -- UX inconsistency.

4. **MINOR -- List item date/time values run together without spacing**
   - **Screens**: Sessions, Inbox
   - **Observation**: In list items, values like "2026-04-182h 20m 0s" and "2025-10-101h 30m 0s" appear to run together without adequate spacing between the date and the duration value. The bounding boxes confirm these are separate text nodes but they visually abut.
   - **Recommendation**: Add a separator character (dot or pipe) or additional margin between date and duration in list item secondary lines.
   - **Severity**: MINOR -- readability concern.

5. **MINOR -- Inbox list missing filter chip "active" state indicator**
   - **Screen**: Inbox
   - **Observation**: The Inbox filter chips (Lights, Darks, Flats, Bias) have the same outlined style as unselected chips on other screens. There is no visual distinction between "all shown" and "filtered" states. Other screens have the same pattern, but Inbox additionally has a separate filter-by-filter-type combobox that is partially redundant.
   - **Severity**: MINOR -- no filter state feedback to user.

6. **MINOR -- Projects detail pane overflows viewport**
   - **Screen**: Projects
   - **Observation**: The detail pane content extends well beyond the 900px viewport height (cleanup table rows go to y=1189, far below visible area). The content scrolls but the extensive vertical content may indicate the need for a more compact layout or collapsible sections that start collapsed.
   - **Note**: Sections are already collapsible (expanded by default). This is a design choice, not a bug.
   - **Severity**: MINOR -- long vertical scroll on initial view.

7. **MINOR -- Projects lifecycle sidebar stats overflow horizontally**
   - **Screen**: Projects
   - **Observation**: The Quick Stats section in the lifecycle sidebar has key-value pairs where some values extend beyond the sidebar's right edge (e.g., box coordinates show content at x=1643 which is beyond the 1440px viewport). This suggests horizontal overflow clipping.
   - **Severity**: MINOR -- content may be clipped or require horizontal scroll.

8. **MINOR -- Status bar text appears truncated**
   - **All screens**
   - **Observation**: The status bar shows "0 sessions / 0 cal" followed by "Log" button. The "0 cal" text appears cut off (box width 115px from x=12). This may be intentional abbreviation but could confuse users.
   - **Severity**: MINOR -- possible text truncation.

---

## Accessibility Observations

- **ARIA roles**: All screens use semantic landmarks (navigation, main, complementary, toolbar, status). Search boxes use `searchbox` role. Lists use proper `list`/`listitem` structure.
- **Heading hierarchy**: Pages use h2 for page titles, h3 for section headings. Proper hierarchy.
- **Keyboard shortcuts**: Inbox action sidebar shows hotkey hints (C, R, S, M, E) on buttons. Good discoverability.
- **Focus indicators**: Not validated visually (would require keyboard interaction testing).
- **Color contrast**: Warm cream background with dark text appears to have adequate contrast. Badge colors (green for Confirmed, red for Rejected) have text labels alongside color coding, avoiding reliance on color alone.
- **Interactive states**: Buttons consistently use `cursor=pointer`. Disabled buttons properly marked with `[disabled]` attribute.

---

## Overall Verdict

**PASS_WITH_ISSUES**

The application demonstrates strong visual consistency across its seven screens. The navigation sidebar, list panel widths, search box dimensions, TopActionBar placement, status bar, and empty states all follow consistent patterns. The two-pane vs. three-pane distinction is clear and correctly applied (Projects and Inbox get sidebars; Sessions, Calibration, Targets, and Archive use TopActionBars).

Two MAJOR issues identified:
1. Archive's full-page empty state breaks structural consistency with other screens.
2. Calibration TopActionBar shows item-specific actions that differ from the page-level action pattern used by Sessions and Targets.

Six MINOR issues relate to auto-selection inconsistency, text spacing in list items, filter state feedback, vertical overflow, sidebar stat overflow, and status bar truncation.

The design system implementation is cohesive with consistent use of badges, tables, expandable sections, filter chips, and empty states across the application. Accessibility landmarks and ARIA roles are properly implemented.
