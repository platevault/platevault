# Impeccable UI Audit

Audit date: 2026-05-26
Auditor: Claude Opus 4.7 (automated impeccable review)
Branch: `030-ui-audit-revision`
Scope: All feature pages, shared components, app shell, design tokens, and CSS

---

## Critical Issues (blocking quality)

### C1. Dozens of CSS classes referenced in components are never defined

The following CSS class namespaces are used across TSX components but have
**zero** definitions in `components.css` or any other stylesheet. These
components render with no styling at all -- browser defaults only.

| Class prefix | Used in | Impact |
|---|---|---|
| `alm-list-detail-layout` | `SessionsPage.tsx:105-113`, `CalibrationPage.tsx:27-37`, `TargetsPage.tsx:49-58` | Sessions, Calibration, Targets show list and detail stacked vertically or collapsed; no side-by-side layout |
| `alm-hybrid-layout` | `ProjectsPage.tsx:67-86` | Projects three-pane layout has no structure at all |
| `alm-top-action-bar` | `TopActionBar.tsx:27-53` | Title/action bar has no height, padding, or alignment |
| `alm-list-sidebar` | `ListSidebar.tsx:84-176` | Shared list sidebar (search, group, sort, filters, scrollable list) has no width, borders, or scroll behavior |
| `alm-action-sidebar` | `ActionSidebar.tsx:71-96` | Inbox right sidebar has no width, background, or button layout |
| `alm-session-review` | `SessionReview.tsx:88-172` | Inbox detail panel has no padding, header styling, frames grid, or conflict box styling |
| `alm-session-detail` (non-inline) | `SessionDetail.tsx:194-304` | Session detail header, summary stats, and section structure unstyled |
| `alm-project-detail` | `ProjectDetail.tsx:51-108` | Project detail header, name, path, and section wrapper unstyled |
| `alm-lifecycle-sidebar` | `LifecycleSidebar.tsx:77-151` | Lifecycle sidebar has no width, padding, or vertical layout |
| `alm-property-table` | `PropertyTable.tsx:107-181` | Property table has no grid/column layout, header row, source badge colors, or row borders |
| `alm-confirm-overlay` | `ConfirmOverlay.tsx:35-70` | Modal overlay has no backdrop, centering, max-width, or footer alignment |
| `alm-enhanced-filter-bar` | `EnhancedFilterBar.tsx:48-120` | Filter bar has no horizontal layout, search width, or pill spacing |
| `alm-archive-page` | `ArchivePage.tsx:68-126` | Archive page has no side-by-side layout |
| `alm-inbox-page` | `InboxPage.tsx:182-255` | Inbox page toolbar has no styling |
| `alm-target-coverage-controls` | `TargetDetailPane.tsx:177` | Coverage optical-train dropdown row unstyled |
| `alm-target-coverage-warn` | `TargetDetailPane.tsx:198` | Coverage warning text unstyled |
| `alm-target-detail__stacked-projects` | `TargetDetailPane.tsx:261` | Stacked project names in session table unstyled |
| `alm-target-detail__no-project` | `TargetDetailPane.tsx:259` | No-project placeholder unstyled |

**File**: `/home/sjors/dev/astro-plan/apps/desktop/src/styles/components.css`
**Evidence**: `grep -c` of all the above class prefixes in components.css returns 0.

### C2. ThreePane layout component uses inline styles instead of CSS

**File**: `/home/sjors/dev/astro-plan/apps/desktop/src/ui/ThreePane.tsx:19-28`

The ThreePane component (used by InboxPage) defines all its layout via inline
`style` attributes. This means:
- It cannot respond to density modifiers
- It cannot be overridden by the design system
- Its column widths are hardcoded per-use (InboxPage passes `listWidth={280}`,
  `detailWidth={220}`)
- It has no responsive behavior

### C3. SessionsList builds its own filter/sort UI instead of using ListSidebar

**File**: `/home/sjors/dev/astro-plan/apps/desktop/src/features/sessions/SessionsList.tsx:182-349`

SessionsList builds its own search input (line 185-193), group/sort controls
(lines 196-223), filter chips (lines 226-279), and count footer (lines 283-285)
using raw `<input>`, `<select>`, and `<button>` elements with `alm-session-list__*`
classes. It does **not** use the `ListSidebar` shared component.

This means Sessions has a completely different search/filter/sort UI from
Targets, Projects, Archive, and Inbox -- violating FR-005 ("All list screens
MUST share identical search, group-by, sort-by, and filter controls in the
same layout position").

### C4. MastersList builds its own filter/sort UI instead of using ListSidebar

**File**: `/home/sjors/dev/astro-plan/apps/desktop/src/features/calibration/MastersList.tsx:164-311`

MastersList uses its own `alm-masters-list__*` and `alm-proj-list__*` classes
(borrowing from the projects CSS) instead of using the `ListSidebar` shared
component. It has its own search, group, sort, and filter chip UI.

This is a second violation of FR-005.

### C5. ArchivePage has no actual layout -- list and detail are not side-by-side

**File**: `/home/sjors/dev/astro-plan/apps/desktop/src/features/archive/ArchivePage.tsx:67-126`

ArchivePage wraps a `ListSidebar` and a detail div in `alm-archive-page` which
has no CSS definition. The result is that the ListSidebar and detail area stack
vertically instead of being side-by-side. The page is essentially broken.

---

## Layout Inconsistencies

### L1. Four different layout patterns across six list screens

The spec mandates two layout patterns:
1. **List + Detail** (Sessions, Calibration, Targets, Archive) using TopActionBar
2. **List + Detail + Right Sidebar** (Inbox, Projects) using lifecycle/action sidebar

The actual implementation uses four different patterns:

| Screen | Pattern | Layout class | Uses ListSidebar? | Uses TopActionBar? |
|---|---|---|---|---|
| Sessions | `alm-page` > `alm-list-detail-layout` (undefined CSS) | Yes (undefined) | Yes | No -- SessionsList builds its own |
| Calibration | `alm-page` > `alm-list-detail-layout` (undefined CSS) | Yes (undefined) | No | No -- MastersList builds its own |
| Targets | `alm-page` > `alm-list-detail-layout` (undefined CSS) | Yes (undefined) | Yes | Yes |
| Projects | `alm-page--hybrid` > `alm-hybrid-layout` (undefined CSS) | Undefined | Yes | No -- no TopActionBar |
| Archive | `alm-archive-page` (undefined CSS) | Undefined | Yes | Yes (inside detail) |
| Inbox | `alm-inbox-page` (undefined CSS) | Uses ThreePane (inline styles) | Yes | No -- FilterSelect toolbar |

### L2. TopActionBar is placed differently across pages

- Sessions, Calibration, Targets: TopActionBar is rendered **above** the
  list-detail split (correct per spec)
- Archive: TopActionBar is rendered **inside** the detail panel (line 99), so
  it only appears when a detail is selected
- Inbox: No TopActionBar at all; uses a `FilterSelect` toolbar instead
- Projects: No TopActionBar at all

### L3. Inconsistent empty state components

- Sessions, Targets, Projects: use `EmptyState` from `@/ui`
- Calibration: uses raw `<div className="alm-page__empty">` (line 42)
- Archive: uses `EmptyState` inside list but raw empty state inside detail

---

## Missing Polish

### P1. No spacing system discipline

The token file defines `--alm-space-1` (4px) through `--alm-space-9` (24px) but
the scale is non-standard: 4, 6, 8, 10, 12, 14, 16, 18, 24. This is neither
a power-of-2 scale nor a consistent ratio. The jump from 18 to 24 (space-8 to
space-9) breaks the rhythm.

Many components use raw pixel values instead of tokens:
- `MasterDetail.tsx:82` inline `style={{ flex: 1 }}`
- `MasterDetail.tsx:152,157` inline `style={{ fontSize: 10 }}`
- `MasterDetail.tsx:262,293-295,300` inline `style={{ fontSize: 11 }}`
- `MasterDetail.tsx:269,315` inline `style={{ textAlign: 'right' }}`
- `MasterDetail.tsx:327` inline `style={{ marginTop: 14 }}`
- Multiple components use `gap: 6px`, `padding: 10px 12px`, etc. as hardcoded
  values in CSS rather than referencing tokens

### P2. Inconsistent typography scale usage

The token file defines 7 text sizes (11.5px to 22px) but many CSS rules use
hardcoded sizes outside the scale:
- `10px` used in at least 15 places (components.css lines 17, 250, 309, 475,
  3003, 3007, 3093, 3796, 3800, 3872, 4106, 4128, etc.)
- `10.5px` used in at least 20 places (lines 309, 488, 535, 569, 575, 584,
  2246, 2565, 2637, 2779, 3069, 3079, etc.)
- `12.5px` used for section titles (lines 2770, 3497, 3621)
- `17px` used for evidence pane title (line 2363) and audit detail title (4689)
- `16px` used for master detail name (line 2699)
- `22px` used for usage number (line 2742)

None of these map to the defined `--alm-text-*` tokens.

### P3. No focus ring consistency

Some components have `:focus-visible` styles (target list items at line 1175,
project list items at line 3907) but most interactive elements lack them:
- `ListSidebar` items have no focus styles
- `MastersList` items have no focus styles
- `SessionsList` items have no focus styles
- `ActionSidebar` buttons rely on browser defaults
- Filter chips have no focus styles

### P4. Inconsistent border treatment

Three different border colors are used for item separators:
- `--alm-border` (heavier, used for major boundaries)
- `--alm-border-subtle` (lighter, used for within-panel separators)
- `1px dotted` borders (used in timeline/plan entries)

But the usage is inconsistent: some list items use `border-subtle` while
equivalent items in other panels use `border`. No documented rule exists for
when to use which.

### P5. Color hardcoding outside the token system

Multiple color values are hardcoded inline or in CSS instead of using tokens:
- `#f8f1d8` (blocking banner background, line 2388)
- `#fef3c7` / `#92400e` (page filter bar, lines 895-896)
- `#f7e8e2` / `#d9b5a8` (approval gate danger, line 3373)
- `#f0d8d2` / `#d9b5a8` (step confirm blocked, line 5226)
- `#dbeafe` / `#1e40af` / `#93c5fd` (naming token chip, lines 1529-1531)
- `#1d4ed8` (button hover, line 89)
- `#b91c1c` (danger button hover, line 100)

---

## UX Friction

### UX1. Calibration page shows confidence scores (spec explicitly removes them)

**File**: `/home/sjors/dev/astro-plan/apps/desktop/src/features/calibration/MasterDetail.tsx:98`
**File**: `/home/sjors/dev/astro-plan/apps/desktop/src/features/calibration/MasterDetail.tsx:294`

The `Confidence` component is rendered in the calibration detail header, and
compatibility scores (0.92, 0.88, 0.71) are shown in the compatible sessions
table. FR-063 says "Compatible sessions MUST be shown as binary match (match
or no match, no scores)."

### UX2. Sessions list shows confidence component (spec removes it)

**File**: `/home/sjors/dev/astro-plan/apps/desktop/src/features/sessions/SessionsList.tsx:341-343`

Each session list item renders `<Confidence level={session.confidence} />`.
The spec says "No confidence-based sorting or display" (spec line 542).

### UX3. Review Queue CSS still present (should be "Inbox")

**File**: `/home/sjors/dev/astro-plan/apps/desktop/src/styles/components.css:2224-2327`

Over 100 lines of CSS for `.alm-review-queue__*` classes remain. FR-002 says
"Review Queue MUST be renamed to Inbox throughout the app." While the
components were renamed, the old CSS was never removed and some may still be
referenced.

### UX4. Decision panel CSS still present (old right panel)

**File**: `/home/sjors/dev/astro-plan/apps/desktop/src/styles/components.css:2455-2543`

The `.alm-decision-panel__*` CSS (90+ lines) is for the old Review Queue right
panel pattern. It was replaced by `ActionSidebar` but the old CSS remains.

### UX5. Evidence pane CSS still present (old center panel)

**File**: `/home/sjors/dev/astro-plan/apps/desktop/src/styles/components.css:2328-2453`

The `.alm-evidence-pane__*` CSS (125+ lines) is for the old Review Queue center
panel. It was replaced by `SessionReview` but the old CSS remains.

### UX6. StatusBar receives no live data

**File**: `/home/sjors/dev/astro-plan/apps/desktop/src/app/Shell.tsx:39`

`<StatusBar />` is rendered with no props, so all counts default to 0 and no
volumes are shown. The status bar will always appear empty. It receives its
counts via props but Shell never passes them.

### UX7. Sidebar nav items use text glyphs instead of icons

**File**: `/home/sjors/dev/astro-plan/apps/desktop/src/app/Sidebar.tsx:13-21`

Nav items use Unicode characters ('S', 'C', 'P', etc.) as glyphs in collapsed
mode. This looks amateurish compared to proper icons.

---

## Recommendations

### Priority 1 -- Fix broken layouts (blocks all visual testing)

1. **Define `alm-list-detail-layout` CSS** in `components.css`:
   ```css
   .alm-list-detail-layout {
     display: flex;
     flex: 1;
     min-height: 0;
     overflow: hidden;
   }
   .alm-list-detail-layout__list {
     width: 280px;
     flex-shrink: 0;
     border-right: 1px solid var(--alm-border);
     overflow: hidden;
     display: flex;
     flex-direction: column;
   }
   .alm-list-detail-layout__detail {
     flex: 1;
     min-width: 0;
     overflow-y: auto;
   }
   ```

2. **Define `alm-hybrid-layout` CSS** for the three-pane (list + content +
   sidebar) pattern used by Projects and Inbox.

3. **Define all missing component CSS** for: `alm-top-action-bar`,
   `alm-list-sidebar`, `alm-action-sidebar`, `alm-session-review`,
   `alm-session-detail`, `alm-project-detail`, `alm-lifecycle-sidebar`,
   `alm-property-table`, `alm-confirm-overlay`, `alm-enhanced-filter-bar`,
   `alm-archive-page`.

4. **Replace ThreePane inline styles** with proper CSS classes.

### Priority 2 -- Enforce shared components (blocks consistency)

5. **Refactor SessionsList** to use `ListSidebar` instead of its own search/
   group/sort/filter UI. Move the Sessions-specific filter chips (state filters,
   filter name dropdown, optical train dropdown) into `ListSidebar`'s `filterPills`
   and `dropdowns` props, or extend `ListSidebar` to support them.

6. **Refactor MastersList** to use `ListSidebar` instead of its own search/
   group/sort/filter UI.

7. **Fix ArchivePage layout** to use the shared `alm-list-detail-layout` pattern
   with `TopActionBar` above the split (not inside the detail panel).

### Priority 3 -- Design system cleanup

8. **Remove dead CSS**: Delete the `alm-review-queue__*` (lines 2224-2327),
   `alm-evidence-pane__*` (lines 2328-2453), and `alm-decision-panel__*`
   (lines 2455-2543) blocks. They are from the old Review Queue and are no
   longer referenced.

9. **Normalize typography**: Replace all hardcoded font sizes (10px, 10.5px,
   12.5px, 17px) with `--alm-text-*` tokens or add explicit tokens for them.
   Consider adding `--alm-text-2xs: 10px` and normalizing.

10. **Extract hardcoded colors** into semantic tokens: warning backgrounds,
    success backgrounds, chip variant colors.

11. **Fix spacing scale**: Either make the scale consistent (e.g., 4, 8, 12,
    16, 20, 24) or document why the irregular scale exists. Stop using raw
    pixel values in component CSS.

### Priority 4 -- Remove spec violations

12. **Remove Confidence component** from SessionsList items and MasterDetail
    header.

13. **Replace calibration match scores** with binary match/no-match indicators
    per FR-063.

14. **Wire StatusBar to real data** or at least to mock data that shows the
    status bar's purpose.

---

## Shared Component Gaps

### Exists but not used consistently

| Component | Location | Used by | NOT used by |
|---|---|---|---|
| `ListSidebar` | `src/components/ListSidebar.tsx` | Targets, Projects, Archive, Inbox | Sessions (builds own), Calibration (builds own) |
| `TopActionBar` | `src/components/TopActionBar.tsx` | Sessions, Calibration, Targets, Archive | Inbox (no action bar), Projects (no action bar) |
| `PropertyTable` | `src/components/PropertyTable.tsx` | SessionReview (inbox), SessionDetail | Calibration (uses KV+Box instead), Targets (uses KV+Box instead) |
| `EmptyState` | `src/ui/EmptyState.tsx` | Sessions, Targets, Projects, Archive, Inbox | Calibration (raw div) |
| `EnhancedFilterBar` | `src/components/EnhancedFilterBar.tsx` | **Nothing** -- this component exists but is never imported anywhere |

### Should exist but does not

| Gap | Description | Benefit |
|---|---|---|
| `ListDetailLayout` | A shared layout component that renders `ListSidebar` + detail area side by side, with consistent widths and borders. Currently each page reinvents this with different class names. | Single source of truth for the two-pane layout that Sessions, Calibration, Targets, and Archive all need |
| `HybridLayout` | A shared layout component for the three-pane pattern (list + content + right sidebar) used by Inbox and Projects. Currently Inbox uses `ThreePane` with inline styles and Projects uses `alm-hybrid-layout` with no CSS. | Single source of truth for the three-pane layout |
| `DetailHeader` | A shared component for the detail pane header pattern (title + badges/pills + actions). Currently `SessionDetail`, `ProjectDetail`, `TargetDetailPane`, and `MasterDetail` each build their own header with different class names and layouts. | Consistent visual weight and action button placement |
| `StatsBar` | A shared component for the compact stats row pattern (key-value pairs in a horizontal bar). Used by `SessionDetail` (summary stats), `PipelineStatsBar`, and could be used by status bar segments. | Reuse instead of rebuilding |
| `PageShell` | A component that wraps a page with its TopActionBar (for non-sidebar pages) or header region, then renders children. Currently each page manually composes `<div className="alm-page">` + `<TopActionBar>` + content. | Eliminates boilerplate and ensures TopActionBar is always in the right position |

### Duplicate implementations (should be consolidated)

| Pattern | Copies | Files |
|---|---|---|
| `formatBytes()` | 3 | `StatusBar.tsx:14`, `SessionDetail.tsx:63`, `ProjectsList.tsx:44` |
| `formatIntegration()` | 4 | `SessionsList.tsx:50`, `SessionDetail.tsx:71`, `SessionReview.tsx:19`, `TargetDetailPane.tsx:28` |
| `stateVariant()` mapping | 4 | `SessionsList.tsx:33`, `SessionDetail.tsx:77`, `TargetDetailPane.tsx:32`, `ProjectDetail.tsx:23` |
| `lifecycleVariant()` mapping | 2 | `ProjectsList.tsx:28`, `LifecycleSidebar.tsx:15` |
| `stateLabel()` formatting | 3 | `SessionsList.tsx:43`, `ProjectDetail.tsx:36`, `LifecycleSidebar.tsx:28` |
| Filter/sort/group state management | 6 | Every list component reimplements useState+useMemo for search, group, sort, and filter state |

### CSS bloat from orphaned/duplicate class families

| Class family | Lines | Status |
|---|---|---|
| `.alm-review-queue__*` | 2224-2327 (103 lines) | Dead -- old Review Queue |
| `.alm-evidence-pane__*` | 2328-2453 (125 lines) | Dead -- old evidence panel |
| `.alm-decision-panel__*` | 2455-2543 (88 lines) | Dead -- old decision panel |
| `.alm-list-pane__*` | 4372-4520 (148 lines) | Duplicates ListSidebar; check if still referenced |
| `.alm-proj-list__*` | 3750-3968 (218 lines) | Used by MastersList (should migrate to ListSidebar) |
| `.alm-session-list__*` | 4042-4228 (186 lines) | Used by SessionsList (should migrate to ListSidebar) |
| `.alm-view-toggle` | Defined twice (lines 2849-2879 and 3176-3204) | Duplicate definition |

Total dead/duplicate CSS: approximately 870 lines out of 5237 (16.6%).

---

## Summary

The spec 030 autonomous run produced functionally correct React components but
left the visual layer severely broken:

1. **17+ CSS class families** used by components have no definitions at all
2. **2 of 6 list screens** bypass the shared `ListSidebar` component
3. **1 shared component** (`EnhancedFilterBar`) exists but is never used
4. **~870 lines of CSS** are dead or duplicated
5. **Hardcoded values** (colors, font sizes, spacing) appear in ~60+ places
   outside the token system
6. **No layout components** exist for the two recurring layout patterns

The result is that the app, when rendered in a browser, would show unstyled
stacked content on most screens rather than the side-by-side list-detail layouts
the spec describes.
