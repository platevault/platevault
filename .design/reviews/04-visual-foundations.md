# Visual Design Foundations Review

Reviewed: 2026-05-26
Files: `tokens.css` (104 lines), `components.css` (5237 lines), `Sidebar.tsx`
Scope: Typography, color, spacing, iconography, hierarchy, and density

---

## Typography Audit

### Type Scale

The current type scale uses 7 named tokens with irregular intervals:

| Token | Value | Delta from previous |
|-------|-------|---------------------|
| `--alm-text-xs` | 11.5px | -- |
| `--alm-text-sm` | 12px | +0.5px |
| `--alm-text-base` | 13px | +1px |
| `--alm-text-md` | 14px | +1px |
| `--alm-text-lg` | 16px | +2px |
| `--alm-text-xl` | 18px | +2px |
| `--alm-text-2xl` | 22px | +4px |

**Problems:**

1. **xs to sm gap is only 0.5px.** At screen rendering this difference is
   invisible on most displays. These two sizes are perceptually identical,
   which means the scale effectively has only 6 usable steps.
2. **11.5px is a fractional value.** Subpixel font rendering causes blurry
   text on non-Retina displays. Desktop apps must assume 1x screens exist.
3. **Base font is 13px.** This is uncommon and slightly small for a desktop
   productivity tool. Industry standard desktop apps (VS Code, Figma,
   Lightroom) use 13-14px base, so this is acceptable but on the lower end.
4. **Missing heading sizes.** The scale jumps from 18px to 22px with nothing
   between. Page headings at 22px are appropriate, but section headings need
   a clear intermediate step (20px) currently absent from tokens.

### Hardcoded Font Sizes (Token Leakage)

65 of 284 font-size declarations (23%) bypass the token system. The most
common offenders:

| Hardcoded value | Count | Should map to |
|-----------------|-------|---------------|
| 10.5px | 28 | Not in scale -- orphan size |
| 10px | 14 | Not in scale -- orphan size |
| 12px | 7 | `--alm-text-sm` |
| 12.5px | 3 | Not in scale -- orphan size |
| 11px | 3 | Not in scale -- orphan size |
| 17px | 2 | Not in scale -- orphan size |
| 9px | 1 | Below minimum -- accessibility risk |

**10.5px is the single most-used hardcoded size** (28 occurrences). It
appears across sidebar footer, status bar, list item metadata, master list
items, pipeline stages, and session list metadata. This is a de-facto token
that was never formalized. The result is a phantom type size that exists
everywhere but cannot be controlled centrally.

There are **8 distinct font sizes used outside the token system** (9px, 10px,
10.5px, 11px, 12px, 12.5px, 16px, 17px, 20px, 22px, 24px). Combined with the
7 token sizes, the app uses **15+ distinct font sizes**. A professional
desktop tool should use 6-8.

### Font Weight Usage

| Weight | Count | Usage |
|--------|-------|-------|
| 600 | 65 | Headings, labels, selected items, section titles |
| 500 | 26 | Semi-bold for names, labels, chips |
| 400 | 3 | Normal weight (brand version, titlebar) |
| 700 | 2 | Bold for recovery icons only |

Weight 600 is overused. When 68% of weight declarations are semi-bold, the
hierarchy flattens. Weight 500 and 600 are nearly indistinguishable at small
sizes (10-12px). The system needs clearer weight differentiation:
- 400 for body text
- 500 for emphasis within body
- 600 for headings and section titles only
- 700 reserved for critical emphasis (alerts, warnings)

### Line Height

7 distinct line-height values are used: 1, 1.2, 1.4, 1.45, 1.5, 1.6, 1.8.
The root declares `line-height: 1.5` but components override with arbitrary
values. There is no token for line-height. This should be reduced to 3 values:

- Tight (1.2) -- for headings and single-line labels
- Normal (1.5) -- for body text and table cells
- Relaxed (1.6) -- for descriptive paragraphs

### Text Truncation

Text truncation (`text-overflow: ellipsis`) is used consistently across list
items and metadata. This is correct for a data-dense desktop tool. No issues
found here.

### Recommendations

1. Replace `--alm-text-xs: 11.5px` with `11px` (whole pixel, clear separation
   from sm).
2. Add `--alm-text-2xs: 10px` for metadata, timestamps, and status text
   (currently 42 hardcoded instances of 10px/10.5px).
3. Replace all 28 instances of `10.5px` with the new `--alm-text-2xs` token.
4. Add `--alm-text-h2: 20px` between xl and 2xl for section headings.
5. Add line-height tokens: `--alm-leading-tight: 1.2`,
   `--alm-leading-normal: 1.5`, `--alm-leading-relaxed: 1.6`.
6. Audit all 65 hardcoded font-size declarations and replace with tokens.
7. Remove 9px usage entirely -- below WCAG minimum for comfortable reading.

---

## Color System Audit

### Palette Structure

The token file defines three color layers:

1. **Wireframe palette** (raw values): `--alm-ink` through `--alm-wf-bg3`
2. **Grayscale palette** (legacy): `--alm-gray-50` through `--alm-gray-950`
3. **Semantic aliases**: `--alm-bg`, `--alm-text`, `--alm-border`, etc.

**Problem: Two parallel gray scales.** The wireframe palette (`--alm-ink`,
`--alm-ink2`, etc.) and the gray scale (`--alm-gray-50` through `950`) are
defined independently with overlapping values. Some components use wireframe
tokens, others use gray tokens directly. This dual system creates confusion
about which to use and makes theming harder.

### Semantic Color Coverage

| Category | Tokens | Assessment |
|----------|--------|------------|
| Background | `--alm-bg`, `--alm-surface` | Missing: elevated surface, overlay, input background |
| Text | `--alm-text`, `-secondary`, `-muted`, `-faint` | Good 4-level hierarchy |
| Border | `--alm-border`, `--alm-border-subtle` | Adequate |
| Status | `--alm-ok`, `--alm-warn`, `--alm-danger`, `--alm-info` | Missing: active/processing state |
| Interactive | `--alm-accent` only | Missing: hover, pressed, focus ring, disabled |

**Missing semantic tokens:**
- `--alm-surface-elevated` -- for cards, modals, popovers
- `--alm-surface-overlay` -- for modal backdrops
- `--alm-bg-input` -- for form inputs (currently using `--alm-bg`)
- `--alm-accent-hover` -- hover state for accent (hardcoded as `#1d4ed8`)
- `--alm-accent-subtle` -- light accent background for selected states
- `--alm-focus-ring` -- for focus-visible outlines
- `--alm-text-on-accent` -- white text on accent backgrounds (hardcoded 5x as `#ffffff`)
- `--alm-processing` / `--alm-active` -- for active/in-progress states

### Hardcoded Colors in Components

12 distinct hardcoded hex background colors appear in components.css. These
represent pill backgrounds, warning banners, approval gates, and status
indicators that bypass the token system:

| Hex | Usage | Should be |
|-----|-------|-----------|
| `#fef3c7` | Warning filter bar background | `--alm-warn-bg` |
| `#f8f1d8` | Blocking banner background | `--alm-warn-bg` |
| `#f3ead0` | Warn pill background | `--alm-warn-bg-subtle` |
| `#f0d8d2` | Danger pill/blocked background | `--alm-danger-bg` |
| `#f7e8e2` | Danger approval gate | `--alm-danger-bg` |
| `#e6efe2` | OK pill background | `--alm-ok-bg` |
| `#e0e4e8` | Info pill background | `--alm-info-bg` |
| `#dbeafe` | Token chip background (blue) | `--alm-accent-bg` |
| `#c8c6c1` | Titlebar dots | `--alm-titlebar-dot` |
| `#92400e` | Warning filter text | `--alm-warn-text` |
| `#1e40af` | Token chip text | `--alm-accent-text` |

Additionally, pill border colors (`#cdd9c5`, `#dccfa0`, `#d9b5a8`, `#c3cbd3`,
`#93c5fd`) are all hardcoded. Every status color needs a three-part token set:
background, foreground, and border.

### Contrast Concerns

1. **`--alm-text-faint` (#9a9a9a) on `--alm-bg` (#fafaf8):** Contrast ratio
   is approximately 2.8:1. Fails WCAG AA for normal text (requires 4.5:1).
   This is used for counts, version numbers, timestamps, and metadata --
   non-decorative text that users need to read.
2. **`--alm-text-muted` (#6a6a6a) on `--alm-bg` (#fafaf8):** Contrast ratio
   is approximately 5.1:1. Passes AA but is marginal for the small text sizes
   (10-11px) where it is typically used.
3. **`--alm-ok` (#1f5a3a) on `#e6efe2` pill background:** Approximately
   4.8:1. Passes AA.
4. **`--alm-warn` (#7a5a1a) on `#f3ead0` pill background:** Approximately
   4.2:1. Marginal, fails AA by a small margin.
5. **White (#fff) on `--alm-accent` (#2563eb):** Approximately 4.6:1. Passes
   AA.

### Recommendations

1. Darken `--alm-text-faint` from `#9a9a9a` to `#858585` for 3.5:1 minimum
   (large text AA), or `#767676` for 4.5:1 full AA compliance.
2. Darken `--alm-warn` from `#7a5a1a` to `#6b4d14` for better pill contrast.
3. Add status background tokens (see Specific Token Changes below).
4. Add interactive state tokens for accent color.
5. Consolidate the dual gray scale -- pick one system and alias the other.
6. Tokenize all hardcoded hex colors in components.css.

---

## Spacing System Audit

### Scale Analysis

| Token | Value | Delta | Ratio to previous |
|-------|-------|-------|--------------------|
| `--alm-space-1` | 4px | -- | -- |
| `--alm-space-2` | 6px | +2 | 1.5x |
| `--alm-space-3` | 8px | +2 | 1.33x |
| `--alm-space-4` | 10px | +2 | 1.25x |
| `--alm-space-5` | 12px | +2 | 1.2x |
| `--alm-space-6` | 14px | +2 | 1.17x |
| `--alm-space-7` | 16px | +2 | 1.14x |
| `--alm-space-8` | 18px | +2 | 1.13x |
| `--alm-space-9` | 24px | +6 | 1.33x |

**Problems:**

1. **Linear increments from 6-18px.** Steps 2-8 increase by exactly 2px each.
   This is too fine-grained -- the difference between 10px and 12px padding is
   not perceptible. A geometric scale (4, 8, 12, 16, 24, 32, 48) creates
   clearer visual distinctions.
2. **Jump from 18px to 24px.** After 7 consecutive +2px steps, the scale
   suddenly jumps +6px. This creates an awkward gap -- there is no 20px or
   32px token.
3. **Missing large spacing.** The maximum is 24px. Page-level margins,
   section gaps, and modal padding need 32px, 40px, and 48px tokens.
4. **9 tokens for spacing is too many** for such a narrow range (4-24px).
   Components struggle to choose between space-4 (10px) and space-5 (12px)
   because the difference is negligible.

### Hardcoded Spacing

99 padding declarations and 35 margin declarations use hardcoded pixel values
(vs 95 padding and 2 margin using tokens). Approximately 58% of spacing
declarations bypass the token system. Common hardcoded values:

- `2px` -- used 30+ times for micro-spacing (chip padding, gap adjustments)
- `3px` -- used 10+ times
- `6px` -- used 15+ times (same as `--alm-space-2` but not referenced)
- `10px` -- used 10+ times (same as `--alm-space-4`)
- `12px` -- used 10+ times (same as `--alm-space-5`)

Many of these are `--alm-space-N` equivalents written as raw pixels, making
central control impossible.

### Vertical Rhythm

There is no vertical rhythm system. Section spacing within components uses a
mix of `margin-top: 16px`, `margin-top: 14px`, `margin-top: 10px`, and
token-based values interchangeably. The `.alm-section` component uses
`--alm-space-3` (8px) for header padding but `--alm-space-5` (12px) for body
left padding -- these should relate systematically.

### Recommendations

1. Replace the linear scale with a geometric base-4 scale:
   - `--alm-space-0: 2px` (micro)
   - `--alm-space-1: 4px`
   - `--alm-space-2: 8px`
   - `--alm-space-3: 12px`
   - `--alm-space-4: 16px`
   - `--alm-space-5: 24px`
   - `--alm-space-6: 32px`
   - `--alm-space-7: 48px`
   - `--alm-space-8: 64px`
2. This is a **breaking change** that requires updating all spacing references.
   Consider renaming to avoid confusion: `--alm-sp-0` through `--alm-sp-8`.
3. Add `--alm-space-0: 2px` for the ubiquitous micro-spacing needs.
4. Replace all hardcoded spacing values with token references.

---

## Iconography Assessment

### Current Approach

The sidebar uses Unicode glyphs as navigation icons:

| Nav Item | Glyph | Assessment |
|----------|-------|------------|
| Inbox | `⬇` (U+2B07) | Arrow down -- not semantically related to an inbox |
| Sessions | `S` | Plain letter -- not an icon |
| Calibration | `C` | Plain letter -- not an icon |
| Targets | `⌖` (U+2316) | Position indicator -- reasonable but obscure |
| Projects | `P` | Plain letter -- not an icon |
| Archive | `▣` (U+25A3) | Square with inner square -- abstract |
| Settings | `⚙` (U+2699) | Gear -- universally understood |

**Problems:**

1. **Three items use plain letters (S, C, P).** These are not icons -- they
   are text abbreviations. In the collapsed sidebar (44px width), these
   single letters provide no visual affordance beyond being the first letter
   of the label. A user cannot glance at the sidebar and understand what each
   item does.
2. **Inconsistent visual weight.** Unicode glyphs render at inconsistent
   sizes and weights across operating systems. `⬇` is a heavy filled arrow,
   `⌖` is a thin crosshair, `⚙` is medium weight. The sidebar looks
   unbalanced.
3. **No color differentiation.** All glyphs use the same text color. Active
   state only changes the left border, not the icon.
4. **Missing icon for expanded mode.** In expanded mode, glyphs are not shown
   at all -- only text labels. The sidebar lacks visual anchoring.

### Recommendations

1. **Replace Unicode glyphs with an SVG icon set.** Lucide is the recommended
   choice: MIT license, consistent 24px grid, 1.5px stroke weight, and a
   comprehensive set that covers all needed concepts:
   - Inbox: `inbox` or `mail`
   - Sessions: `image` or `layers`
   - Calibration: `sliders-horizontal` or `ruler`
   - Targets: `crosshair` or `target`
   - Projects: `folder-kanban` or `briefcase`
   - Archive: `archive`
   - Settings: `settings`
2. Show icons in both collapsed and expanded sidebar modes.
3. Use a consistent 18px icon size with 1.5px stroke in the sidebar.
4. Add `--alm-icon-size: 18px` and `--alm-icon-stroke: 1.5px` tokens.

---

## Visual Hierarchy Assessment

### Heading Hierarchy

The current system has weak heading differentiation:

| Context | Size | Weight | Assessment |
|---------|------|--------|------------|
| Wizard step heading | 22px / 600 | Clear page title |
| Settings pane title | 18px / 600 | Clear section title |
| Detail header title | 16px / 600 | Adequate |
| Evidence pane title | 17px / 600 | Hardcoded, not on scale |
| Audit detail title | 17px / 600 | Hardcoded, not on scale |
| Target header name | 20px / 600 | Hardcoded, not on scale |
| Section titles | 12.5px / 600 | Too close to body text |
| Box heading | 14px / 600 | Adequate |

**Problem: Section titles at 12.5px are nearly indistinguishable from body
text at 12-13px.** When weight is the only differentiator and both are 600,
the hierarchy collapses. Section titles should be at least 14px with clear
spacing above.

### Emphasis Patterns

- **Primary emphasis:** `font-weight: 600` (overused -- 65 declarations)
- **Secondary emphasis:** `font-weight: 500` (26 declarations)
- **Color-based emphasis:** `--alm-text` vs `--alm-text-secondary` vs
  `--alm-text-muted` (good 3-tier system)
- **Missing:** No italic usage for metadata or annotations. No letter-spacing
  variation beyond uppercase labels. No background-based emphasis for
  highlighted rows or active states.

### De-emphasis

- **Uppercase + small size + muted color** for section labels -- effective
  but overused. At least 20 component classes use this exact pattern
  (`text-transform: uppercase; letter-spacing: 0.04em; font-size: text-xs;
  color: text-muted; font-weight: 600`). The weight 600 on de-emphasized
  labels contradicts their intended low-hierarchy role.
- **Opacity 0.6/0.85** used for disabled states and candidates -- appropriate.

### Recommendations

1. Reserve weight 600 for true headings (h1-h3 equivalents). Use 500 for
   emphasis and 400 for body text.
2. Increase section title sizes to minimum 14px with 600 weight.
3. Drop uppercase section labels from 600 to 500 weight -- they already have
   3 visual cues (uppercase, small size, muted color) and do not need a
   fourth (bold).
4. Add a subtle background highlight token for selected/active rows instead
   of relying solely on left-border indicators.

---

## Density & Professional Feel

### Current Density

- **Row height:** 32px default, 24px compact, 40px spacious
- **Cell padding:** `8px 12px` default
- **Sidebar width:** 184px expanded, 44px collapsed
- **Status bar height:** 22px
- **Title bar height:** 28px
- **Search input height:** 24-28px
- **List item padding:** `8px 12px`

The default density is appropriate for a professional desktop tool. The 32px
row height and 8px/12px cell padding are comparable to VS Code (22px compact
rows) and Lightroom (28-36px rows). The system correctly leans toward data
density rather than spacious web-style layouts.

### Problems

1. **Sidebar is narrow at 184px.** With counts displayed, labels can truncate
   early. 200-220px would be more comfortable for longer labels like
   "Calibration" with a 3-digit count.
2. **Status bar at 22px is very compact.** The 10.5px text inside has minimal
   vertical breathing room. 24-26px would be more readable.
3. **Settings rail at 220px vs main sidebar at 184px.** These two navigation
   rails should share the same width for visual consistency, or the difference
   should be intentional and documented.
4. **List item gap is 3px.** The gap between meta lines in list items
   (`gap: 3px`) is extremely tight. At 10.5px text, this creates a dense blob
   of text that is hard to scan. 4px minimum.
5. **Inspector stat numbers at 18-22px** are disproportionately large compared
   to surrounding 10-12px text. They create visual "holes" in the layout.
   16-18px would be sufficient.

### What Works

- Three-pane layouts with left list, center detail, right inspector -- standard
  professional pattern.
- Collapsible sidebar with keyboard shortcut.
- Density modifiers (compact/spacious) as CSS classes -- good architecture.
- Consistent use of `border-bottom: 1px solid` for row separation rather than
  alternating row colors.

---

## Specific Token Changes

### Typography Tokens (additions and modifications)

```css
/* Replace fractional size */
--alm-text-xs: 11px;           /* was 11.5px */

/* Add missing sizes */
--alm-text-2xs: 10px;          /* new: metadata, timestamps, status text */
--alm-text-h2: 20px;           /* new: section headings */

/* Line height tokens */
--alm-leading-tight: 1.2;      /* headings, single-line labels */
--alm-leading-normal: 1.5;     /* body text, table cells */
--alm-leading-relaxed: 1.6;    /* paragraphs, descriptions */
```

### Color Tokens (additions and modifications)

```css
/* Fix contrast issue */
--alm-text-faint: #767676;     /* was #9a9a9a -- now 4.5:1 on white */

/* Fix warn contrast */
--alm-wf-warn: #6b4d14;        /* was #7a5a1a -- improved pill contrast */

/* Status background tokens */
--alm-ok-bg: #e6efe2;
--alm-ok-border: #cdd9c5;
--alm-warn-bg: #f3ead0;
--alm-warn-border: #dccfa0;
--alm-warn-bg-strong: #fef3c7;
--alm-warn-text: #92400e;
--alm-danger-bg: #f0d8d2;
--alm-danger-border: #d9b5a8;
--alm-info-bg: #e0e4e8;
--alm-info-border: #c3cbd3;

/* Interactive state tokens */
--alm-accent-hover: #1d4ed8;
--alm-accent-bg: #dbeafe;
--alm-accent-text: #1e40af;
--alm-accent-border: #93c5fd;
--alm-text-on-accent: #ffffff;
--alm-focus-ring: #2563eb;

/* Surface tokens */
--alm-surface-elevated: var(--alm-bg);
--alm-bg-input: var(--alm-bg);

/* Active/processing state */
--alm-active: #2563eb;
--alm-active-bg: #eff6ff;
```

### Spacing Tokens (proposed replacement scale)

```css
/* Geometric base-4 scale (proposed, breaking change) */
--alm-sp-0: 2px;     /* micro: chip padding, inline gaps */
--alm-sp-1: 4px;     /* tight: icon gaps, small inline spacing */
--alm-sp-2: 8px;     /* compact: cell padding, small gaps */
--alm-sp-3: 12px;    /* default: standard padding, list item gaps */
--alm-sp-4: 16px;    /* comfortable: section padding, card padding */
--alm-sp-5: 24px;    /* spacious: section margins, large gaps */
--alm-sp-6: 32px;    /* page: page padding, modal padding */
--alm-sp-7: 48px;    /* large: page margins, major section breaks */
--alm-sp-8: 64px;    /* extra-large: hero spacing, top-of-page */
```

### Iconography Tokens

```css
--alm-icon-size: 18px;
--alm-icon-size-sm: 14px;
--alm-icon-size-lg: 24px;
--alm-icon-stroke: 1.5;
```

### Density Adjustments

```css
/* Status bar */
--alm-statusbar-height: 24px;  /* was 22px */

/* Sidebar */
--alm-sidebar-width: 200px;    /* was 184px */
```

---

## CSS Changes

### 1. Eliminate 10.5px Ghost Size

Replace all 28 instances of `font-size: 10.5px` with `font-size: var(--alm-text-2xs)`.
Key locations:

- `.alm-sidebar__count` (line 490)
- `.alm-sidebar__footer` (line 535)
- `.alm-statusbar__text`, `__sep`, `__root` (lines 570-582)
- `.alm-masters-list__item-name`, `__item-meta` (lines 2624, 2641)
- `.alm-masters-list__counts`, `__kind-header` (lines 2567, 2591)
- `.alm-pipeline__stage-title`, `__stage-right` (lines 3070, 3079)
- `.alm-session-list__item-meta` (line 4214)
- `.alm-list-pane__item-meta`, `__item-time` (lines 4497, 4502)
- `.alm-review-queue__counts`, `__item-reason` (lines 2246, 2321)
- `.alm-target-list__alias` (line 3567)
- `.alm-cleanup__group-header` (line 3677)

### 2. Eliminate 10px Instances

Replace all 14 instances of `font-size: 10px` with `font-size: var(--alm-text-2xs)`.
Key locations:

- `.alm-pill--sm` (line 16)
- `.alm-calendar__session-pill` (line 1121)
- `.alm-kit-card__meta`, `__warn` (lines 3002, 3009)
- `.alm-pipeline__label` (line 3091)
- `.alm-proj-list__control-label` (line 3797)
- `.alm-proj-list__group-header` (line 3873)
- `.alm-proj-list__chip` (line 3839)
- `.alm-filter-chip--xs` (line 4127)
- `.alm-target-list__warn` (line 3576)

### 3. Tokenize Hardcoded Heading Sizes

```css
/* Evidence pane and audit detail titles: use token */
.alm-evidence-pane__title { font-size: var(--alm-text-xl); }     /* was 17px */
.alm-audit-detail__title { font-size: var(--alm-text-xl); }      /* was 17px */
.alm-target-header__name { font-size: var(--alm-text-h2); }      /* was 20px */
.alm-master-detail__name { font-size: var(--alm-text-lg); }      /* was 16px */
.alm-master-detail__usage-num { font-size: var(--alm-text-h2); } /* was 22px */
```

### 4. Reduce Section Label Weight

All uppercase section labels should use weight 500 instead of 600:

```css
.alm-kv-row__label,
.alm-inspector__section-label,
.alm-session-inspector__section-label,
.alm-session-detail-inspector__label,
.alm-decision-panel__section-label,
.alm-naming__section-label,
.alm-naming__preview-label,
.alm-naming__overrides-label,
.alm-naming__builder-label,
.alm-naming__palette-label,
.alm-logs__label,
.alm-kit-col__title,
.alm-density-selector__legend {
  font-weight: 500; /* was 600 */
}
```

### 5. Tokenize Pill Backgrounds

Replace all hardcoded pill/banner backgrounds with new tokens:

```css
.alm-pill--ok { background: var(--alm-ok-bg); border-color: var(--alm-ok-border); }
.alm-pill--warn { background: var(--alm-warn-bg); border-color: var(--alm-warn-border); }
.alm-pill--danger { background: var(--alm-danger-bg); border-color: var(--alm-danger-border); }
.alm-pill--info { background: var(--alm-info-bg); border-color: var(--alm-info-border); }
```

### 6. Tokenize Interactive States

```css
.alm-btn--primary:hover:not(:disabled) {
  background: var(--alm-accent-hover);
  border-color: var(--alm-accent-hover);
}

.alm-naming__chip--token {
  background: var(--alm-accent-bg);
  color: var(--alm-accent-text);
  border-color: var(--alm-accent-border);
}
```

### 7. Standardize Hardcoded Spacing

Priority targets (highest impact):

```css
/* Sidebar header -- use tokens */
.alm-sidebar__header { padding: var(--alm-sp-2) var(--alm-sp-3); }

/* Box body -- use tokens */
.alm-box__body { padding: var(--alm-sp-2) var(--alm-sp-3); }

/* Decision panel groups -- use tokens */
.alm-decision-panel__group { margin-top: var(--alm-sp-4); }

/* Section margins -- use tokens */
.alm-master-detail__section { margin-top: var(--alm-sp-4); }
.alm-session-inspector__section { margin-top: var(--alm-sp-3); }
```

---

## Summary of Priority Actions

| Priority | Action | Impact |
|----------|--------|--------|
| P0 | Fix `--alm-text-faint` contrast (WCAG fail) | Accessibility compliance |
| P0 | Add `--alm-text-2xs: 10px` token and migrate 42 hardcoded instances | Token system integrity |
| P1 | Replace Unicode sidebar glyphs with Lucide SVG icons | Visual credibility |
| P1 | Fix `--alm-text-xs` from 11.5px to 11px (subpixel rendering) | Text clarity |
| P1 | Add status background/border tokens and migrate hardcoded hex values | Theming readiness |
| P2 | Add line-height tokens and standardize usage | Vertical rhythm |
| P2 | Reduce font-weight 600 overuse -- reserve for true headings | Hierarchy clarity |
| P2 | Add interactive state tokens (hover, focus, accent-bg) | Design system completeness |
| P3 | Restructure spacing scale to geometric progression | Long-term maintainability |
| P3 | Consolidate dual gray scale (wireframe + legacy) | Token simplification |
| P3 | Migrate remaining 99 hardcoded padding values to tokens | Full token coverage |
