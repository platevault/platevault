# Astro Library Manager Stitch Mockups

## 1. Vision

Mock up the core desktop information architecture for Astro Library Manager
before committing the React app shell. Designs should help decide navigation,
context panels, action placement, lifecycle visibility, font scale, iconography,
and review/safety affordances.

## 2. Stitch Project

- Project ID: `1255501662478508239`
- Title: `Astro Library Manager Mockups`

## 3. Current IA Decision

- Primary navigation: Library, Projects, Inbox, Settings. Inbox may be hidden
  until queue items or an Inbox source exists.
- Library is a recursive data-source explorer: source rows are parents and
  discovered immediate children are session/set/master candidates.
- Data source setup uses a type-specific preview before the source is saved.
- Scanning and ingestion are contextual actions: Add Data Source, Scan, Add
  Folder to Queue, and Create Project.
- Inbox is the Review Queue, not merely a filesystem folder.
- Projects are list-first. Rows show lifecycle and mapped-source summaries; the
  selected project shows more detail below.
- Targets are project metadata, with one primary target and optional additional
  targets/panels.
- Project lifecycle appears only in project context.
- Global Sweep, source reconnect/root recovery, Application Log, API Contracts,
  and advanced cleanup live under Settings.
- Prepared Sources are app-owned `sources/` links generated from immutable
  confirmed source mappings. Avoid exposing "views" in the UI.

## 4. Sitemap

- [x] `inventory-workbench`: initial mockup, superseded by revised IA.
- [x] `project-library-shell`: revised primary Library shell with contextual actions.
- [x] `project-library-shell-v2`: denser revised Library shell; preferred reference, but row-action overflow and "Add Folder to Queue" copy need correction during implementation.
- [ ] `project-detail-lifecycle`: project detail page with lifecycle and source mapping.
- [ ] `settings-workbench`: Settings page with Data Sources, Cleanup, Log, API Contracts.

## 5. Roadmap

- Generate Settings workbench with Data Sources, Cleanup & Archive, Application
  Log, API Contracts, and Advanced tools.
- Generate project detail screen with lifecycle and Prepared Sources only when a
  project is selected.

## 6. Creative Freedom

- Explore whether Inbox should appear disabled or hidden when empty/unconfigured.
- Explore whether Library default row density should be tree-table or grouped
  sections.
- Explore a source creation preview modal from the Library toolbar.
