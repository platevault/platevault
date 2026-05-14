# Stitch Design System

## Design System Notes For Stitch Generation

**DESIGN SYSTEM (REQUIRED):**
- Platform: desktop-first cross-platform product UI for a local-first technical desktop app.
- Palette: restrained light theme with tinted near-white app background, white active work surfaces, cool blue-gray borders, deep slate primary actions, muted amber/green/red only for semantic status. Avoid decorative astronomy theming, dark blue admin dashboards, gradients, glassmorphism, and ornamental imagery.
- Typography: Inter or native system sans. Compact 12-14px product scale, 16px section headings, tabular numeric metadata for counts, dates, exposure times, and file sizes. No display fonts, no gradient text, no negative letter spacing.
- Layout: fixed left navigation around 248px, compact top toolbar around 40px, split-pane workbench with a primary list/table and contextual inspector. Use 4px/8px spacing rhythm and 12px gutters for dense operational workflows.
- Elevation: tonal layering and 1px borders only. Avoid shadows except for future transient overlays. No nested cards.
- Shape: 6px to 8px radius for controls and containers, 2px to 4px radius for status chips.
- Iconography: simple 16px line icons, paired with labels in navigation and important actions. Icons clarify action type, they do not replace critical text.
- Interaction tone: every filesystem mutation is plan-first, explicit, and auditable. Destructive or cleanup flows must never look casual.

## App-Specific IA Rules

- Primary app navigation is small: Library, Projects, Inbox, Settings. Inbox is conditional when queue items or Inbox sources exist.
- Ingest is not a primary sidebar destination. Use contextual actions: Add Data Source, Scan, Add Folder to Queue, Create Project.
- Library is a data-source explorer. It shows registered sources and immediate child session/set/master candidates under each source.
- Data source root previews are central: for Raw and Calibration Frames, immediate child folders become candidates; for Calibration Masters, files become candidates.
- Inbox is a Review Queue fed by scan results, optional Inbox data sources, and ad hoc Add Folder to Queue.
- Project lifecycle is contextual to Projects and project detail only.
- Targets are project metadata. Do not make Targets a dominant primary navigation item.
- Plans are not primary navigation. Reviewed filesystem plans appear contextually when an action needs review.
- Global Sweep and Root Reconnect belong under Settings, not in the primary nav or front page.
- Application Log and API Contracts belong under Settings.
- Prepared Sources is the user-facing term for app-owned `sources/`; avoid exposing "views" as a top-level concept.
- Context inspectors should change based on selected data source, candidate, project, source map, or settings section. Avoid generic panels named Source Truth.
