# Design

## Register

Product application UI. Design serves repeated source review, project setup,
calibration matching, processing preparation, and safe filesystem planning.

## Intent

Astro Library Manager should feel precise, calm, technical, and safety-first.
The interface is an expert workbench for source-of-truth decisions, not a
marketing dashboard and not a decorative astronomy showcase.

The primary user is an astrophotographer working at a desktop with filesystem
tools, capture exports, PixInsight, Siril, and local project folders open nearby.
They need dense but legible review surfaces, predictable actions, and clear
distinction between observed files, inferred metadata, reviewed decisions,
generated project views, and planned mutations.

## Component Policy

- Mantine is the primary UI component system.
- Use standard Mantine components before custom wrappers or custom CSS.
- Use Mantine `AppShell`, `Stack`, `Group`, `Box`, `Paper`, `Text`, `Title`,
  `Table`, `Tabs`, `Accordion`, `Modal`, `Button`, `ActionIcon`, `Menu`,
  `Select`, `MultiSelect`, `Switch`, `Checkbox`, `Tooltip`, `Alert`, `Loader`,
  and related primitives for normal UI composition.
- Use TanStack Table for table behavior: row models, selection, filters,
  column state, and visible cell rendering.
- Use Mantine `Table` for table presentation.
- Use TanStack Router for routing, links, route state, and future loaders.
- Avoid raw `<p>`, `<h1>`, `<h2>`, `<h3>`, and generic layout wrappers where
  Mantine `Text`, `Title`, `Stack`, `Group`, `Box`, or `Paper` can express the
  structure.
- Raw semantic HTML is acceptable when it materially improves accessibility or
  semantics and Mantine would obscure the intent.
- Custom CSS is limited to global theme variables, app shell integration,
  Tauri/browser glue, accessibility helpers, and rare layout cases Mantine
  cannot express cleanly.
- Every custom CSS selector should have a reason. Do not rebuild Mantine
  components in local CSS.

## Visual System

The product uses restrained neutral desktop surfaces with only functional accent
color. The palette should feel like calibrated local software: neutral canvas,
quiet panels, low-contrast borders, restrained selection, and semantic warning,
danger, and info colors. Avoid dark-blue admin templates, purple gradients,
decorative nebula effects, saturated marketing greens, and identical card grids.

Use OKLCH tokens for global color values. Do not use pure black or pure white.
Keep accent color for current selection, primary actions, focus, and important
state. Use low-chroma selection tints. Do not use accent color as decoration.

Light and dark themes should preserve the same component hierarchy. Theme
switching is an icon-only action in the app shell and may also be represented as
a persisted appearance setting.

## Typography

Use a desktop application font stack optimized for dense table work:
`Aptos`, `Segoe UI Variable Text`, `Segoe UI`, `Inter`, `Noto Sans`, system UI,
and sans-serif fallback. Product UI should use a compact fixed type scale, not
viewport-scaled headings. Body-sized application text should sit around 12px,
with secondary/meta text around 10.5-11px. Headings inside panels are modest and
task-sized. The app shell should not use web-page hero sizing. Route labels in
the command bar are compact context, not large page headings.

Use Mantine `Title` for headings and `Text` for body, labels, help, and status
copy. Keep label copy functional and short. Avoid generated-sounding names such
as "local-first workbench", "project envelope", "prepared sources layout", or
"retry marker write" in the user interface.

All table cells, inspector fields, settings rows, modal content, and log entries
must use the smallest legible size for the job. Long paths, request ids, and
metadata values may truncate in routine ledgers when the full value is available
in the detail panel or tooltip. Text must not overlap adjacent controls.

## Layout

Use predictable desktop application layout:

- Persistent app shell with primary navigation.
- Compact command bar rather than a tall web page header.
- Compact breadcrumbs in the command bar so users understand route and selected
  context without route-title cards.
- Main workspace for Inbox, Inventory, Projects, Settings, and diagnostics.
- Detail panels show only the selected item or project.
- Logs are globally attached to the bottom of the app shell as a subtle overlay
  strip. They expand upward over the workspace instead of pushing the layout.
- Settings use one setting per line.
- Wizard/setup flows use page-by-page progression, not permanent main-screen
  panels.

Do not put cards inside cards. Use cards or papers for repeated items, modals,
and framed tools only. Prefer table-like structured rows for item details over
side-by-side content boxes.

Default density is compact desktop density. Use `xs` and Mantine compact button
sizes for routine controls, tables, menus, settings, and toolbars. Keep row
height near native desktop data grids: no decorative second lines in ledger
columns unless the extra line is required for the immediate decision. Columns
should narrow-fit their data and give remaining width to path/message fields.
Reserve larger spacing for destructive confirmation dialogs, first-run wizard
pages, and places where readability would otherwise suffer. Avoid web-page
section cards that only repeat the route name.

Responsive behavior should prioritize structure: collapse or stack panels,
preserve table scanning, and keep action menus reachable. Do not scale font size
with viewport width.

## Navigation

Primary routes are Inbox, Inventory, Projects, Settings, and Framework Review
while the prototype route remains useful. TanStack Router owns navigation.
Do not manually mutate `window.location.hash` for app navigation.

Main navigation should feel like desktop application chrome: compact rows,
icons, subtle active state, stable sectioning, and a small system/footer area.
Avoid oversized brand blocks, decorative badges, and marketing-style sidebars.

Top navigation includes compact breadcrumbs. Breadcrumbs are for current route
and selected workflow context, not marketing copy. Avoid duplicate route titles
below the command bar unless a page truly needs a local section label.

## Copy Discipline

The UI is minimalist and every visible item must serve a workflow purpose.
Remove low-value guidance such as "Select an Inventory item to review its
details" when the surrounding layout already communicates the action. Status
copy appears only when it confirms a completed action, explains a blocker, or
changes the user's next decision. Avoid permanent instructional sentences,
restated headings, and filler descriptions under routine rows.

Important filters and selected entity ids should move toward route/search state
so users can restore workflow context. Guided first-step flows should navigate
through routes using router APIs.

## Tables

Ledgers are data workflows, not metric dashboards. Use TanStack Table for logic
and Mantine Table for presentation.

Routine ledger rows should show direct workflow fields only. Do not show
confidence or evidence columns. Do not add descriptions under every item.
Use plain state text where a state field is necessary. Avoid decorative state
bubbles.

Columns should be fitted deliberately. Fixed-width columns belong on type,
state, workflow, timestamps, frame counts, and action cells. Name/path/message
columns receive the leftover space and truncate with hover access where needed.
Routine item columns should not use two-line name + path stacks; the path belongs
in its own column or the selected detail panel.

Inbox, Inventory, and Projects should share the same action model:

- Primary inline action for the most likely next step.
- Small arrow/menu action for alternatives.
- Destructive actions show a warning modal.
- Non-destructive actions perform immediately.
- Project rows use the same action placement and iconography as Inbox and
  Inventory. At minimum they expose Open, Edit, and the workflow tool open action
  when supported, plus the same small alternative menu.

## Data And Lifecycle Language

Use these state concepts consistently:

- Observed: data read from filesystem or metadata.
- Inferred: value derived from observations.
- Reviewed: user-confirmed or corrected value.
- Generated: app-owned projection such as project source view, marker, or
  manifest.
- Planned: proposed filesystem mutation pending review.
- Applied: mutation completed and logged.
- Blocked or failed: operation could not continue and needs user attention.

Do not collapse these states into one generic "status" field. Detail views can
show provenance and lifecycle history; routine table rows should remain focused.

## Inbox

Inbox is for newly observed source material that needs a decision. It should not
show "review next" metric boxes or unexplained counters. Rows should show frame
type, source/session, path, and direct action. If nothing is selected, the
detail area explains that the user needs to select an item or add source data.

Mixed folders cannot move into Inventory. A mixed folder must show a warning
and provide a split action inside Inbox. Split results remain in Inbox until
they can be moved separately.

## Inventory

Use "Inventory", not "Observed inventory" or "Library" in the active product
surface. Inventory is the stable working library after Inbox review.

Inventory should filter by frame type. Do not use Tags or Handling as primary
workflow controls. The selected detail panel shows the selected item, metadata,
warnings, source references, actions, and linked projects.

## Projects

Project creation and onboarding are single workflows. They ask for required
information once: path, project name, project type/workflow, light sessions,
optional flats per light session, darks, and bias. Creating a project also
creates required project resources such as folder structure, source mappings,
workflow resources, and the project marker.

Do not expose separate user actions named Create project envelope,
Generate/update prepared sources, Project label, or Retry marker write.
Failures roll back where possible, log an error, and notify the user.

Project detail panels list sources directly. Clicking a source opens the linked
Inventory item. Project state filtering should support multiselect.

The Projects page must not be a reduced table with missing actions. It follows
the same compact ledger + selected detail pattern as Inbox and Inventory:
left-side rows, right-side structured details, primary row action, and the small
alternatives menu.

## Calibration

Frame type is an enum: light, dark, flat, bias, and dark flat. The initial
project flow hides dark flats unless a later workflow enables them.

Master mode is a toggle for calibration sources that points to a single file.
The selector must allow files only and should filter FITS, XISF, and TIFF, with
all three selected by default.

Matching rules are configurable per calibration frame type. The user may enable
automatic recommendations but can always select calibration frames manually.
Matching differs by type; for example, darks do not care about filter while
flats usually do.

Flat recommendations first prefer flats from the same light session and
observing night. This is not plain calendar-date matching; it is session/night
matching so after-midnight flats can still belong with the same capture night.
When same-session or same-night flats are unavailable, flat recommendations fall
back to compatible flats that match the selected calibration fields.

## Settings

Settings should be organized by workflow domain: Sources, Calibration, Projects,
Tools, Catalogs, Safety, Logs, and Appearance or equivalent final labels.

Every setting appears on its own line with an information affordance next to the
label. Settings auto-save. There is no global Save button.

Information affordances must add real decision support. They should explain what
the setting changes, how the app uses it, what the options mean, and what risk
or workflow consequence follows from changing it. Do not use an info tooltip
that merely restates the label.

Settings must be compact and comprehensive. The settings screen uses a narrow
left section list and a dense right pane. It should not use oversized headings,
large cards, or comfortable web-form spacing. Each setting row uses a table-like
layout: compact label with info affordance, optional short description, and the
control aligned consistently to the right or below only when width requires it.
Controls use compact Mantine sizing and long values wrap instead of expanding
the row horizontally.

Avoid internal implementation controls as user settings. API contract references
belong in developer diagnostics, not normal Settings. Log settings should not
include export format or request/entity metadata toggles. Logs use JSON export
when exported and always include request/entity metadata.

## Onboarding

First-run setup is a page-by-page wizard for source configuration. It can be
skipped. It starts with a compact welcome page, then
clarifies source categories and the post-setup workflow before asking for
directories. These clarification pages explain what each source category means,
what the user should select for each category, and that project creation happens
after setup. Source pages must explain the immediate selection task for that
category instead of using defensive copy about unrelated actions. It validates
required directories, duplicate source names, duplicate roots, and directory-only
source paths before finish. It does not include a mock scan preview; scanning and
onboarding happen through the guided first-project workflow after setup.

The guided first-project flow is not a mock overlay. It guides real actions:
create sample Inbox placeholders, move darks, bias, flats, and lights into
Inventory, verify and confirm them, then create the first project.

The first hint can be skipped. The setup wizard itself should not expose a
"show guided hints" checkbox.

## Native Controls

Directory and file selection should use Tauri native controls in the desktop
implementation:

- Source roots are directories only.
- Master calibration mode selects files only.
- Master file filters include FITS, XISF, TIFF, and all supported extensions.
- Open location uses the native OS file browser.

Browser prototype workarounds must be commented where they stand in for Tauri
controls.

## Logs

Logs live in a global full-width bottom fold-out panel attached to the app
shell, not inside individual route content. The collapsed state is a subtle
bottom overlay strip showing the latest log message. Clicking it expands the log
viewer upward from the bottom over the workspace. Expanded logs use the full
available width so most entries fit on one line. If an entry cannot fit, truncate
it and expose the full entry on hover or focus. The expanded log viewer shows
logs only, stays dense and subdued, and includes compact log level filtering and
a follow logs control whose state is remembered in the log viewer.

Do not call it a rail in UI copy.

## Implementation Discipline

`DESIGN.md` is the source of truth for UI implementation work. The parent agent
updates this file. Implementation subagents must read it before editing UI and
must verify their result against it in their handoff. If the design document and
an implementation prompt disagree, the implementation prompt should call out the
conflict rather than silently inventing a third direction.

## Accessibility

Target WCAG AA. Support keyboard-first review flows, visible focus states,
semantic labels, hover and focus access to setting information, reduced motion,
and state differentiation that does not rely on color alone.

Destructive actions require explicit confirmation modals with clear object and
consequence text. Non-destructive actions execute directly and provide status
feedback.
