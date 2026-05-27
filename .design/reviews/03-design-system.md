# Design System Patterns Review

**Scope**: `apps/desktop/src/styles/tokens.css` (104 lines), `components.css` (5237 lines)
**React components**: `src/components/` (5 files), `src/features/` (65 files), `src/app/` (shell)
**Date**: 2026-05-26 | **Branch**: 030-ui-audit-revision

---

## Token Audit

### Current Token Coverage

`tokens.css` defines 50 custom properties across 6 categories:

| Category | Token count | Assessment |
|----------|------------|------------|
| Colors (raw palette) | 15 | Adequate raw palette |
| Colors (semantic) | 14 | Missing semantic status backgrounds |
| Typography | 9 | Missing line-height and font-weight tokens |
| Spacing | 9 | Scale is functional but non-standard |
| Density | 2 | Good infrastructure, tokens need expansion |
| Radii | 3 | Complete |
| Shadows | 2 | Missing elevated/overlay shadow |
| Z-indices | 4 | Complete |
| Transitions | 0 | **Not tokenized at all** |

### Missing Token Categories

**1. Transition / Animation tokens** -- Zero tokens defined. The CSS uses 16 different transition declarations with hardcoded durations:

- `0.1s` for background/border-color hover effects
- `0.15s` for transforms (chevron rotate, sidebar width, switch)
- `0.3s` for width transitions (progress bars)

Recommended tokens:
```css
--alm-transition-fast: 0.1s;
--alm-transition-base: 0.15s;
--alm-transition-slow: 0.3s;
```

**2. Font-weight tokens** -- Weights `400`, `500`, `600`, `700` are hardcoded throughout. No tokens.

Recommended tokens:
```css
--alm-font-normal: 400;
--alm-font-medium: 500;
--alm-font-semibold: 600;
--alm-font-bold: 700;
```

**3. Line-height tokens** -- Only `1.5` in `:root`. Values `1.2`, `1.4`, `1.45`, `1.5`, `1.6`, `1.8` appear hardcoded.

**4. Status background/border tokens** -- The pill variants (lines 31-52) use hardcoded hex colors for status backgrounds and borders:

| Status | Background | Border | Should be token |
|--------|-----------|--------|-----------------|
| ok | `#e6efe2` | `#cdd9c5` | `--alm-ok-bg`, `--alm-ok-border` |
| warn | `#f3ead0` | `#dccfa0` | `--alm-warn-bg`, `--alm-warn-border` |
| danger | `#f0d8d2` | `#d9b5a8` | `--alm-danger-bg`, `--alm-danger-border` |
| info | `#e0e4e8` | `#c3cbd3` | `--alm-info-bg`, `--alm-info-border` |

These same colors recur in blocking banners (line 2387: `#f8f1d8`), approval gates (line 3372: `#f7e8e2`), offline rows (line 1457: `#fef3c7`), and step confirm blocked (line 5225: `#f0d8d2`).

**5. Accent hover token** -- `#1d4ed8` appears at lines 89-90 as the primary button hover color. Not tokenized.

**6. White constant** -- `#ffffff` / `#fff` appear 5 times (btn-primary, btn-danger, lifecycle-past, proj-chip-active, switch-thumb). Should be `--alm-on-accent` or similar.

**7. Overlay/backdrop token** -- `rgb(0 0 0 / 0.3)` at line 666 is not tokenized.

### Hardcoded Value Counts in components.css

| Value type | Hardcoded count | Using tokens |
|-----------|----------------|--------------|
| Hex colors (`#xxx`) | 30 occurrences | N/A |
| `rgb()` colors | 2 occurrences | N/A |
| Font-size (px) | 65 declarations | Rest use `var(--alm-text-*)` |
| Padding (px) | 66 declarations | Rest use `var(--alm-space-*)` |
| Margin (px) | 66 declarations | Rest use `var(--alm-space-*)` |
| Gap (px) | 43 declarations | Rest use `var(--alm-space-*)` |

The non-tokenized font sizes are predominantly `10px`, `10.5px`, `11px`, `12px`, `13px`, `14px`, `16px`, `17px`, `22px`, `24px`. Many of these map to existing tokens but use raw values instead:

- `10px` -- no token (below `--alm-text-xs: 11.5px`)
- `10.5px` -- no token (used 15+ times for secondary text)
- `11px` -- no token (close to `--alm-text-xs: 11.5px`)
- `12px` = `--alm-text-sm` but hardcoded
- `13px` = `--alm-text-base` but hardcoded
- `16px` = `--alm-text-lg` but hardcoded
- `17px` -- no token (used for pane titles)
- `22px` = `--alm-text-2xl` but hardcoded

Recommended new size tokens:
```css
--alm-text-2xs: 10px;
--alm-text-caption: 10.5px;
```

---

## Component CSS Inventory

68 component sections in components.css, organized by section headers:

| Component Family | Lines | Class count | Notes |
|-----------------|-------|-------------|-------|
| Pill (`alm-pill`) | 1-52 | 8 | **Dead** -- not used by any React component |
| Button (`alm-btn`) | 54-123 | 8 | Used in app shell only |
| Key-Value Row (`alm-kv-row`) | 125-150 | 3 | **Dead** |
| Box (`alm-box`) | 152-163, 3644-3669 | 7 | **Dead** (replaced by inline) |
| Section (`alm-section`) | 164-197 | 6 | **Dead** |
| Toolbar (`alm-toolbar`) | 200-218 | 3 | **Dead** |
| Filter Chip (`alm-filter-chip`) | 220-257 | 5 | **Dead** |
| Shell Layout (`alm-shell`) | 259-328 | 4 | Used in app/Shell.tsx |
| Title Bar (`alm-titlebar`) | 269-310 | 5 | **Dead** (shell has custom) |
| Sidebar (`alm-sidebar`) | 330-546 | 22 | Used in app/Sidebar.tsx |
| Status Bar (`alm-statusbar`) | 548-584 | 5 | Partially used |
| Log Panel (`alm-logpanel`) | 586-660 | 11 | Used in app/Shell.tsx |
| Command Palette (`alm-palette`) | 662-741 | 9 | Used in app/Shell.tsx |
| Sessions Search (`alm-sessions-search`) | 743-765 | 1 | **Dead** |
| Sessions Bars/Filter (`alm-sessions-*`) | 767-885 | 18 | **Dead** (new components built differently) |
| Page (`alm-page`) | 899-912 | 3 | Partially used |
| Detail Header/Body (`alm-detail-*`) | 914-967 | 5 | **Dead** |
| Tabs (`alm-tabs`) | 929-956 | 3 | **Dead** |
| Provenance (`alm-provenance-*`) | 969-980 | 2 | **Dead** |
| Simple Table (`alm-simple-table`) | 982-1002 | 1 | Used |
| Empty (`alm-empty`) | 1004-1010 | 1 | Used |
| Detail Pills (`alm-detail-pills`) | 1012-1018 | 1 | **Dead** |
| Timeline (`alm-timeline`) | 1020-1051 | 4 | **Dead** |
| GroupBy (`alm-groupby`) | 1053-1059 | 1 | **Dead** |
| Calendar (`alm-calendar`) | 1061-1125 | 8 | Partially dead |
| Target List (`alm-target-list`) | 1127-1225, 3564-3591 | 17 | **Dead** (replaced by `alm-list-sidebar`) |
| Target Detail (`alm-target-detail`) | 1227-1258 | 4 | **Dead** (replaced inline) |
| Coverage Chart (`alm-coverage-chart`) | 1260-1326, 3593-3610 | 8 | Partially used |
| Page Empty (`alm-page__empty`) | 1328-1336 | 1 | Used |
| Settings (`alm-settings`) | 1338-1424 | 10 | Partially dead |
| Data Sources (`alm-datasources`) | 1431-1478, 3612-3641 | 12 | Partially dead |
| Naming Structure (`alm-naming`) | 1480-1647, 3683-3691 | 18 | **Dead** |
| Source View Strategy (`alm-svs`) | 1649-1689 | 5 | **Dead** |
| Cleanup Policy (`alm-cleanup`) | 1691-1718, 3671-3681 | 4 | **Dead** (replaced inline) |
| Root Recovery (`alm-recovery`) | 1720-1817 | 12 | **Dead** |
| Equipment (`alm-equipment`) | 1819-1867 | 6 | Partially dead |
| Tools (`alm-tools`) | 1869-1904 | 5 | **Dead** |
| Logs (`alm-logs`) | 1906-1931 | 4 | **Dead** |
| Catalogs (`alm-catalogs`) | 1932-1975 | 5 | Partially dead |
| Protection (`alm-protection`) | 1977-2065 | 10 | **Dead** |
| Form Elements (`alm-select`, `alm-input`) | 2067-2109 | 5 | Partially used |
| Density Selector (`alm-density-selector`) | 2111-2178 | 8 | Used |
| Empty State (`alm-empty-state`) | 2180-2222 | 5 | **Dead** |
| Review Queue (`alm-review-queue`) | 2224-2326 | 14 | **Dead** |
| Evidence Pane (`alm-evidence-pane`) | 2328-2453 | 18 | **Dead** |
| Decision Panel (`alm-decision-panel`) | 2455-2543 | 12 | **Dead** |
| Masters List (`alm-masters-list`) | 2545-2648 | 12 | Partially dead |
| Master Detail (`alm-master-detail`) | 2650-2779 | 16 | Used |
| Helper Classes (`alm-text-*`, `alm-mono`) | 2781-2789 | 3 | `alm-mono` used; text helpers dead |
| Projects Page (`alm-projects-*`) | 2791-2831 | 6 | **Dead** |
| Project Detail (`alm-project-sub`) | 2833-2847 | 2 | **Dead** |
| View Toggle (`alm-view-toggle`) | 2848-2879, 3174-3205 | 3x2 | **Duplicate** -- defined twice |
| Project Section (`alm-project-section`) | 2881-2904 | 4 | **Dead** |
| Project Grid (`alm-project-grid`) | 2906-2923 | 4 | **Dead** |
| Kit Grid (`alm-kit-*`) | 2925-3012 | 10 | Used |
| Lifecycle (`alm-lifecycle`) | 3014-3043 | 4 | **Dead** (component uses inline) |
| Pipeline (`alm-pipeline`) | 3045-3115 | 9 | Used |
| Combined Connector (`alm-combined-*`) | 3117-3140 | 3 | **Dead** |
| Output Card (`alm-output-card`) | 3142-3152 | 1 | **Dead** |
| Plan Review (`alm-plan-*`) | 3154-3288 | 12 | **Dead** |
| Diff View (`alm-diff-*`) | 3289-3357 | 7 | **Dead** |
| Approval Gate (`alm-approval-gate`) | 3359-3417 | 9 | **Dead** |
| Target Header (`alm-target-header`) | 3419-3452 | 4 | Used |
| Target Columns (`alm-target-columns`) | 3454-3473 | 3 | Used |
| Target Section (`alm-target-section`) | 3475-3504 | 4 | **Dead** |
| Target Plans List (`alm-target-plans-list`) | 3506-3525 | 2 | Used |
| Target Outputs (`alm-target-outputs`) | 3527-3562 | 4 | **Dead** |
| Session Detail Grid (`alm-session-detail-*`) | 3693-3735 | 6 | **Dead** |
| Audit Table (`alm-audit-table`) | 3737-3748 | 1 | **Dead** |
| Project List 3-pane (`alm-proj-list`) | 3750-3968 | 22 | **Dead** |
| Project Inspector (`alm-proj-inspector`) | 3970-4040 | 10 | **Dead** |
| Session List 3-pane (`alm-session-list`) | 4042-4228 | 19 | **Dead** |
| Session Detail Inline (`alm-session-detail-inline`) | 4230-4294 | 7 | **Dead** |
| Session Inspector (`alm-session-inspector`) | 4296-4368 | 10 | Used |
| Shared List Pane (`alm-list-pane`) | 4370-4520 | 20 | **Dead** |
| Shared Inspector (`alm-inspector`) | 4522-4669 | 20 | **Dead** |
| Audit Detail (`alm-audit-detail`) | 4671-4745 | 12 | **Dead** |
| Setup Wizard (`alm-wizard-*`) | 4747-4789 | 5 | Used |
| Step: Sources (`alm-step-sources`) | 4791-4898 | 14 | Used |
| Step: Tools (`alm-step-tools`) | 4920-5010 | 11 | Used |
| Switch (`alm-switch`) | 5012-5044 | 3 | Used |
| Step: Catalogs (`alm-step-catalogs`) | 5046-5110 | 8 | Used |
| Step: Confirm (`alm-step-confirm`) | 5112-5237 | 16 | Used |

---

## Coverage Gaps

**31 component families** are used in React but have **no CSS definitions** in components.css:

| Missing component | Used in | Inline style count |
|-------------------|---------|-------------------|
| `alm-action-sidebar` (8 classes) | `inbox/ActionSidebar.tsx` | 0 |
| `alm-archive-list` (5 classes) | `archive/ArchiveList.tsx` | 0 |
| `alm-archive-page` (8 classes) | `archive/ArchivePage.tsx` | 0 |
| `alm-audit-log` (16 classes) | `settings/AuditLog.tsx` | 0 |
| `alm-calendar-scroll` (7 classes) | `sessions/CalendarScroll.tsx` | 3 inline |
| `alm-cal-matching` (8 classes) | `settings/CalibrationMatching.tsx` | 0 |
| `alm-checkbox` (2 classes) | multiple settings panes | 0 |
| `alm-cleanup-plan` (10 classes) | `projects/CleanupPlan.tsx` | 0 |
| `alm-confirm-overlay` (6 classes) | `components/ConfirmOverlay.tsx` | 0 |
| `alm-enhanced-filter-bar` (3 classes) | `components/EnhancedFilterBar.tsx` | 0 |
| `alm-hybrid-layout` (4 classes) | `projects/ProjectsPage.tsx` | 0 |
| `alm-inbox-confirm` (13 classes) | `inbox/InboxConfirmOverlay.tsx` | 0 |
| `alm-inbox-list` (8 classes) | `inbox/InboxList.tsx` | 0 |
| `alm-inbox-page` (2 classes) | `inbox/InboxPage.tsx` | 0 |
| `alm-ingestion` (7 classes) | `settings/Ingestion.tsx` | 0 |
| `alm-lifecycle-sidebar` (4 classes) | `projects/LifecycleSidebar.tsx` | 0 |
| `alm-list-detail-layout` (3 classes) | multiple pages | 0 |
| `alm-list-sidebar` (14 classes) | `components/ListSidebar.tsx` | 0 |
| `alm-merge-search` (7 classes) | `inbox/MergeSearch.tsx` | 0 |
| `alm-pipeline-stats` (4 classes) | `projects/PipelineStatsBar.tsx` | 0 |
| `alm-processing-tools` (7 classes) | `settings/ProcessingTools.tsx` | 0 |
| `alm-project-detail` (5 classes) | `projects/ProjectDetail.tsx` | 0 |
| `alm-project-notes` (8 classes) | `projects/ProjectNotes.tsx` | 0 |
| `alm-property-table` (6 classes) | `components/PropertyTable.tsx` | 0 |
| `alm-radio` (2 classes) | settings panes | 0 |
| `alm-select__popup/item/icon/group` | custom select in multiple | 0 |
| `alm-session-detail` (6 classes) | `sessions/SessionDetail.tsx` | 0 |
| `alm-session-review` (12 classes) | `inbox/SessionReview.tsx` | 0 |
| `alm-source-map` (7 classes) | `projects/SourceMap.tsx` | 0 |
| `alm-source-views` (7 classes) | `projects/SourceViewStatus.tsx` | 0 |
| `alm-split-preview` (8 classes) | `inbox/SplitPreview.tsx` | 0 |
| `alm-top-action-bar` (5 classes) | `components/TopActionBar.tsx` | 0 |
| `alm-target-coverage-*` (2 classes) | `targets/CoverageChart.tsx` | 0 |
| `alm-advanced` (5 classes) | `settings/Advanced.tsx` | 0 |
| `alm-general` (6 classes) | `settings/General.tsx` | 0 |
| `alm-svs` (new set, 5 classes) | `settings/SourceViewStrategy.tsx` | 0 |

**351 CSS class names** are used in React components but have no matching rule in `components.css`.

---

## Dead/Unused CSS

**355 CSS class selectors** in components.css are not referenced by any React component (including app shell). These span **38 component families**:

### Fully dead component blocks (all classes unused)

| Component | Line range | Dead class count | Notes |
|-----------|-----------|-----------------|-------|
| `alm-inspector` | 4522-4669 | 20 | Shared inspector was written but components built their own |
| `alm-list-pane` | 4370-4520 | 19 | Shared list pane unused -- components built custom |
| `alm-proj-list` | 3750-3968 | 18 | Projects list superseded by `alm-list-sidebar` |
| `alm-evidence-pane` | 2328-2453 | 18 | Inbox evidence pane never adopted |
| `alm-naming` | 1480-1647 | 15 | Naming structure settings rebuilt inline |
| `alm-target-list` | 1127-1225 | 14 | Superseded by `alm-list-sidebar` |
| `alm-review-queue` | 2224-2326 | 14 | Inbox review queue rebuilt |
| `alm-recovery` | 1720-1817 | 12 | Root recovery settings not connected |
| `alm-decision-panel` | 2455-2543 | 12 | Inbox decision panel rebuilt |
| `alm-audit-detail` | 4671-4745 | 12 | Audit detail rebuilt |
| `alm-protection` | 1977-2065 | 10 | Cleanup protection settings rebuilt |
| `alm-proj-inspector` | 3970-4040 | 10 | Project inspector rebuilt |
| `alm-approval-gate` | 3359-3417 | 9 | Plan approval gate not connected |
| `alm-pill` | 1-52 | 8 | Pill component never used in React |
| `alm-datasources` (partial) | 1431-1478 | 8 | Data sources partially rebuilt |
| `alm-session-detail-inline` | 4230-4294 | 7 | Session detail rebuilt |

### Partially dead (some classes used, others not)

| Component | Dead count | Used count | Notes |
|-----------|-----------|-----------|-------|
| `alm-settings` | 3 | 7 | Nav items dead; content/pane used |
| `alm-sidebar` | 0 | 22 | Fully used (app shell) |
| `alm-coverage-chart` | 3 | 5 | Warning/target-mark/bar-below unused |
| `alm-master-detail` | 0 | 16 | Fully used |
| `alm-session-inspector` | 0 | 10 | Fully used |

### Duplicate definition

`alm-view-toggle` is defined **twice** in components.css:
- Lines 2848-2879 (under Project Detail)
- Lines 3174-3205 (under Plan Review)

The second definition silently overrides the first with slightly different styles (border-radius `3px` vs `var(--alm-radius-md)`, different `:last-child` vs `:not(:last-child)` patterns).

---

## BEM Structure Issues

### 1. Inconsistent block naming depth

Some blocks use single-word names (`alm-pill`, `alm-box`, `alm-tabs`) while others use hyphenated compound names (`alm-session-detail-inline`, `alm-evidence-pane`, `alm-combined-connector`). This makes the block/element boundary ambiguous -- is `alm-session-detail-inline__header` an element of `alm-session-detail-inline` or an element of a hypothetical `alm-session-detail` with modifier `inline`?

**Pattern used**: `alm-{feature}-{role}` where role is optional. The `__` separator is consistently used for elements, `--` for modifiers.

### 2. Non-BEM state selectors

Several components use `[data-selected]` or `[aria-selected]` attribute selectors instead of BEM modifiers (line 713-714: `.alm-palette__item[data-selected="true"]`). This is fine for accessibility-driven state but is inconsistent with the `--active` / `--selected` modifier pattern used elsewhere.

### 3. Modifier naming inconsistency

Active/selected state naming is inconsistent across components:
- `--active`: sidebar, btn, tabs, filter-chip, view-toggle, proj-list chip, review-queue item
- `--selected`: target-list item, masters-list item, proj-list item, session-list item, svs row, kit-card
- `--checked`: density-selector radio (via `[data-checked]`)

Recommendation: standardize on `--selected` for items in a selectable list, `--active` for toggle/tab state.

### 4. Feature-specific vs generic component names

The CSS has both generic primitives and feature-specific versions:

- Generic: `alm-list-pane`, `alm-inspector` (lines 4370-4669)
- Feature-specific: `alm-proj-list`, `alm-session-list`, `alm-target-list`, `alm-review-queue`

The generic versions are dead because feature-specific versions or `alm-list-sidebar` replaced them. This suggests the generic primitives were written after the fact but never retrofitted.

### 5. Missing modifier patterns

Several components lack states that the UI logically needs:
- `alm-btn` has no `--loading` or `--icon-only` modifier
- `alm-pill` has no `--lg` modifier (only `--sm`)
- `alm-input` has no `--error` or `--disabled` state
- `alm-select` has no `--error` state
- `alm-switch` has no `--disabled` state

---

## New Tokens Needed

### Priority 1 -- Status background palette

```css
--alm-ok-bg: #e6efe2;
--alm-ok-border: #cdd9c5;
--alm-warn-bg: #f3ead0;
--alm-warn-border: #dccfa0;
--alm-danger-bg: #f0d8d2;
--alm-danger-border: #d9b5a8;
--alm-info-bg: #e0e4e8;
--alm-info-border: #c3cbd3;
```

### Priority 2 -- Transition tokens

```css
--alm-duration-fast: 0.1s;
--alm-duration-base: 0.15s;
--alm-duration-slow: 0.3s;
--alm-ease-default: ease;
```

### Priority 3 -- Typography weight tokens

```css
--alm-weight-normal: 400;
--alm-weight-medium: 500;
--alm-weight-semibold: 600;
--alm-weight-bold: 700;
```

### Priority 4 -- Missing size tokens

```css
--alm-text-2xs: 10px;
--alm-text-caption: 10.5px;
```

### Priority 5 -- Accent palette

```css
--alm-accent-hover: #1d4ed8;
--alm-accent-bg: #dbeafe;
--alm-accent-border: #93c5fd;
--alm-accent-text: #1e40af;
--alm-on-accent: #ffffff;
```

### Priority 6 -- Overlay / backdrop

```css
--alm-backdrop: rgb(0 0 0 / 0.3);
--alm-shadow-lg: 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1);
```

---

## New Component CSS Needed

### From the coverage gap analysis -- 351 classes used but undefined

These classes are currently "working" because they either rely on reset + inline styles, or are simple enough that no styling is needed. But they should be defined for consistency and maintainability.

**High priority** (shared components used across features):

1. **`alm-list-sidebar`** (14 classes) -- the actual shared list component replacing the dead `alm-target-list`/`alm-proj-list`/`alm-session-list`. Used by projects, targets, sessions, calibration.

2. **`alm-list-detail-layout`** (3 classes) -- master-detail split layout wrapper. Used by multiple pages.

3. **`alm-top-action-bar`** (5 classes) -- shared page-level action toolbar.

4. **`alm-property-table`** (6 classes) -- shared property display table.

5. **`alm-confirm-overlay`** (6 classes) -- confirmation dialog.

6. **`alm-enhanced-filter-bar`** (3 classes) -- shared filter bar.

7. **`alm-checkbox`** / **`alm-radio`** (4 classes) -- form primitives.

8. **`alm-select__popup`** / `alm-select__item` / `alm-select__icon` (5 classes) -- custom select dropdown.

**Medium priority** (feature-specific but well-used):

9. `alm-inbox-*` (23 classes across inbox-list, inbox-page, inbox-confirm)
10. `alm-session-detail` / `alm-session-review` (18 classes)
11. `alm-project-detail` / `alm-project-notes` (13 classes)
12. `alm-source-map` / `alm-source-views` (14 classes)
13. `alm-archive-*` (13 classes)
14. `alm-audit-log` (16 classes)
15. Settings panes: `alm-general`, `alm-advanced`, `alm-ingestion`, `alm-cal-matching`, `alm-processing-tools` (~35 classes total)

---

## Architecture Recommendations

### 1. Eliminate dead CSS (immediate)

355 dead classes (~2,800 lines) should be removed from components.css. This is 53% of the file. The truly dead component families (list-pane, inspector, proj-list, evidence-pane, decision-panel, review-queue, approval-gate, etc.) were superseded by spec 030's rewrite but never cleaned up.

**Action**: Delete all fully-dead component blocks listed above. Keep partially-used blocks but remove individual dead classes within them.

### 2. Extract inline styles to CSS (immediate)

153 inline `style={}` declarations exist across 15 files. The worst offenders:

| File | Inline styles | Pattern |
|------|--------------|---------|
| `wizard/WizardPage.tsx` | 23 | Layout, typography, spacing |
| `wizard/StepViews.tsx` | 20 | Layout, typography |
| `wizard/StepCalibration.tsx` | 17 | Layout, typography |
| `wizard/StepReview.tsx` | 16 | Layout, typography |
| `PipelineStrip.tsx` | 14 | Conditional padding, typography |
| `MasterDetail.tsx` | 13 | Font-size overrides, flex layout |
| `wizard/StepSources.tsx` | 11 | Layout, borders |
| `SessionInspector.tsx` | 10 | Typography, layout |
| `wizard/StepName.tsx` | 10 | Layout, typography |
| `wizard/StepLayout.tsx` | 10 | Layout, typography |

The wizard components alone account for 76 inline styles. They should use dedicated `alm-wizard-step-*` CSS classes.

### 3. Consolidate duplicate patterns (short-term)

**View toggle**: Remove the duplicate at lines 3174-3205 and keep only the canonical definition at lines 2848-2879 (or vice versa).

**Table patterns**: `alm-simple-table`, `alm-datasources__table`, `alm-equipment__table`, `alm-svs__table`, `alm-cleanup__matrix`, `alm-audit-table` all share identical th/td styling. Extract a shared `alm-table` base class.

**List item patterns**: `alm-proj-list__item`, `alm-session-list__item`, `alm-review-queue__item`, `alm-list-pane__item`, `alm-masters-list__item` are structurally identical (flex column, gap 3px, padding 8px 12px, border-left selection indicator). The living replacement `alm-list-sidebar` should be the canonical shared list-item pattern.

**Section header patterns**: Multiple components (alm-target-section, alm-project-section, alm-master-detail__section, alm-inspector__section) repeat the same section-header pattern. Extract an `alm-section-header` primitive.

### 4. Theming readiness (medium-term)

The current system is **not ready for dark mode**. Issues:

- 30 hardcoded hex colors that would need inversion
- Semantic color layer is incomplete (missing status backgrounds, accent palette)
- `#ffffff` white is hardcoded rather than being `var(--alm-on-accent)` or `var(--alm-bg)`
- Shadows use hardcoded `rgb(0 0 0 / ...)` that would need adjustment

**Path to dark mode**:
1. Add all missing tokens (status bg/border, accent palette, overlay)
2. Replace all hardcoded hex in components.css with tokens
3. Add a `[data-theme="dark"]` or `.theme-dark` selector that overrides the `:root` values
4. The density modifier pattern (`.density-compact` / `.density-spacious`) is already correct and could serve as the template

### 5. Density mode readiness (ready)

Density support via `.density-compact` / `.density-spacious` is already token-based and working. Only `--alm-row-height` and `--alm-cell-padding` change per density. Components that use these tokens automatically adapt. Components using hardcoded px values (66 padding, 43 gap) will not adapt.

### 6. File organization (long-term)

At 5,237 lines with 53% dead code, `components.css` is a monolith. After dead code removal (~2,400 lines remaining), consider splitting by layer:

```
styles/
  tokens.css          -- design tokens (keep)
  reset.css           -- reset (keep)
  primitives.css      -- pill, btn, input, select, switch, checkbox, radio, table
  layouts.css         -- shell, sidebar, page, list-detail, hybrid
  components.css      -- shared components (toolbar, filter-bar, section, empty-state, etc.)
  features/           -- per-feature CSS if needed (wizard, pipeline, etc.)
```

This makes ownership clear and avoids the current problem where dead feature CSS accumulates in a shared file.
