# Spec 031: Design V3 Implementation

**Status**: Closed (2026-06-11) — Design V3 shipped, then superseded by
[Spec 032 — Design V4](../032-design-v4-implementation/spec.md), which unified the
detail layout, sidebar, and status bar. V4 is the current UI truth; this spec is
retained as historical record of the V3 redesign.
**Source**: Claude Design artifact "Astro-plan v3.zip" (design_handoff/)

## Summary

Implement the high-fidelity UI redesign from the Design V3 artifact. The design
is the authoritative layout spec — implement pixel-perfectly, changing only React
constructs to meet project conventions (TypeScript, tanstack-router, Base UI,
proper hooks).

## Scope

### Token & CSS System
- Clean swap: replace tokens.css, components.css, reset.css with design's system
- New `--alm-*` warm-gray token palette, geometric base-4 spacing, Inter/JetBrains Mono typography
- Three density modes via CSS class (compact/comfortable/spacious)

### UI Primitives (src/ui/)
- Rewrite: Pill, Btn, Section, Box, KV, EmptyState
- New: Banner, Toggle, SegControl, RadioGroup, CoverageBar, Table
- Delete: Confidence, Provenance, FilterBar, ThreePane

### Layout Components (src/components/)
- Rewrite: ListSidebar, ListItem, TopActionBar, PageShell, ListDetailLayout
- New: DetailHeader, DetailPane

### App Shell
- Rewrite Shell, Sidebar, StatusBar visual styling
- Nav order: Inbox, Sessions, Calibration, Targets, Projects, Archive, Settings
- Keep current brand text and footer content

### Feature Pages (all 7)
- Two-pane: Sessions, Calibration, Targets, Archive
- Three-pane: Projects (+ LifecycleSidebar), Inbox (+ ActionSidebar)
- Settings: all 11 panes (Data Sources, Equipment, Ingestion, Naming, Processing Tools, Cal Matching, Target Catalogs, Cleanup, General, Advanced, Audit Log)

### Fixtures
- Update all fixture files to match design's mock data

## Decisions

- TweaksPanel: skip (density lives in Settings > General)
- CSS: clean swap, not incremental migration
- Interactivity: visual layout only, no backend wiring
- Dead code: delete unused components, extract shared ones
- Sidebar chrome: keep current brand/footer, change styling and nav order
- SpecKit: tinyspec — this document is the spec

## Not In Scope

- macOS title bar / traffic light dots (Tauri native)
- Provenance glyphs on calibration detail
- Calibration match scores (binary match only)
- "Mark superseded" button
- Tabs inside calibration detail
- Combined/Pipeline view toggle on projects
- "Manual cleanup only" toggle in cleanup settings
- Metadata extraction section in ingestion settings
- Filter chips in list sidebars (use select dropdowns)
- Framesets section in session detail
