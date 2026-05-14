---
page: settings-workbench
---
Generate the Astro Library Manager Settings workbench after the UI/domain grilling pass. This is an information-architecture mockup for advanced configuration, not a decorative reskin.

**DESIGN SYSTEM (REQUIRED):**
- Platform: desktop-first cross-platform product UI for a local-first technical desktop app.
- Palette: restrained light theme with tinted near-white app background, white active work surfaces, cool blue-gray borders, deep slate primary actions, muted amber/green/red only for semantic status. Avoid decorative astronomy theming, dark blue admin dashboards, gradients, glassmorphism, and ornamental imagery.
- Typography: Inter or native system sans. Compact 12-14px product scale, 16px section headings, tabular numeric metadata for counts, dates, exposure times, and file sizes. No display fonts, no gradient text, no negative letter spacing.
- Layout: fixed left navigation around 248px, compact top toolbar around 40px, split-pane workbench with a primary list/table and contextual inspector. Use 4px/8px spacing rhythm and 12px gutters for dense operational workflows.
- Elevation: tonal layering and 1px borders only. Avoid shadows except for future transient overlays. No nested cards.
- Shape: 6px to 8px radius for controls and containers, 2px to 4px radius for status chips.
- Iconography: simple 16px line icons, paired with labels in navigation and important actions. Icons clarify action type, they do not replace critical text.
- Interaction tone: every filesystem mutation is plan-first, explicit, and auditable. Destructive or cleanup flows must never look casual.

**CURRENT PRODUCT MODEL:**
- Primary navigation remains Library, Projects, Inbox, Settings. Settings is active.
- Settings uses internal subnavigation, not a giant scrolling page.
- Data Sources are managed here, but operational source browsing remains in Library.
- Source reconnect/root recovery belongs under Data Sources settings, not primary nav.
- Global Sweep belongs under Cleanup & Archive or Advanced, not primary nav.
- Application Log is one structured log rendered for user-facing and technical views.
- API Contracts are v1 scope and show schema/contract version, export, and diagnostics.

**SETTINGS SECTIONS:**
1. Data Sources
2. Ingestion & Review
3. Naming & Structure
4. Calibration
5. Tool Workflows
6. Cleanup & Archive
7. Application Log
8. API Contracts
9. Advanced

**PAGE STRUCTURE:**
1. Left app sidebar: Library, Projects, Inbox with badge, Settings active. No extra primary nav items.
2. Main Settings workbench with an internal settings subnav column. Data Sources is selected.
3. Data Sources panel:
   - Table of sources: Poseidon-C PRO (Raw), Flats Library (Calibration Frames), Dark Masters (Calibration Masters), Active Projects (Projects), To Process (Inbox).
   - Columns: Name, Type, Path, Marker, Last Scan, State, Actions.
   - Actions: Add Data Source, Disable, Reconnect, Scan Rules, Remove.
   - Show identity fields locked after creation: path, source type, calibration kind/material kind.
4. Right detail panel for selected source:
   - Marker status: `.astro-library-source.json` present.
   - Editable fields: Display name, Notes, Enabled, Include Extensions, Ignore Patterns, Follow Symlinks.
   - Immutable identity: Path, Type, Calibration subtype/material kind.
   - Reconnect Source button as explicit workflow.
5. Include compact cards or rows for other settings sections:
   - Cleanup & Archive: protected categories, rejected frame cleanup, global sweep advanced workflow.
   - Application Log: structured events with filters.
   - API Contracts: contract version, export schema, diagnostics.
6. Do not put Global Sweep as a large front-page call-to-action. It should look like an advanced settings/tool entry.

**VISUAL GOAL:**
Make Settings feel like a sober control room for irreversible and global configuration. It should be dense, cautious, and easy to scan without hiding important safety boundaries.
