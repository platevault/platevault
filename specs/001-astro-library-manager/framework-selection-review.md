# UI Framework Selection Review

## Scope

This is a focused selection review for the Astro Library Manager desktop UI. It
compares the main React UI framework choices against the current Spec 001
workflow: Inbox, Inventory, Projects, Settings, first-run setup, guided first
steps, detail panels, action menus, destructive confirmations, logs, and dense
table-like review surfaces.

The historical screenshot matrix is in
[`framework-review-screenshots/`](framework-review-screenshots/). The live
review route is now a Mantine-only decision/reference screen:

```text
#/framework-review?page=inbox
```

Supported query value:

- `page`: `inbox`, `library`, `projects`, `settings`

## Decision

Use **Mantine** as the primary styled component framework.

Use **TanStack Table** as the table behavior engine when a table needs sorting,
column visibility, persisted filters, row selection, grouping, pagination, or
virtualization. Use Mantine `Table` directly for simple static tables and
two-column detail tables.

Use **Base UI or shadcn-style copied components only for gaps** where Mantine is
not a good fit, especially bespoke command menus, advanced dialogs, or highly
custom selectors. Do not mix multiple styled frameworks in the product UI.

## Why Mantine

Mantine fits this app's workbench shape without imposing a strong consumer-app
brand. It has standard styled components for the controls we need now: tables,
menus, accordions, buttons, action icons, selects, alerts, drawers, modals,
tooltips, tabs, forms, and layout primitives. Its component APIs are compact
enough for repeated desktop workflows, and the styling system can be tuned into
the current precise, calm, technical visual language without rebuilding every
primitive.

The important fit is not that Mantine is the prettiest default. The fit is that
it lets us stop hand-rolling ordinary controls while keeping enough control over
density, borders, spacing, and detail panels.

## Candidate Review

| Candidate | Fit | Notes |
| --- | --- | --- |
| Mantine | Strong default choice | Broad styled React component set, good menus/selects/accordions/tables, low visual lock-in, fast to standardize. |
| MUI | Strong but heavier | Very mature and MUI X Data Grid is powerful, but Material visual language is obvious and MUI X introduces more product/licensing surface for advanced grids. |
| Chakra UI | Good primitives, weaker data fit | Accessible composable API and clear table/menu primitives, but data-heavy app surfaces require more owned layout/table work. |
| Ant Design | Excellent enterprise tables/forms, poor product fit | Tables, descriptions, dropdowns, and forms are strong, but the default enterprise visual language is hard to make feel like this app without fighting it. |
| Tailwind + shadcn | Maximum control, more ownership | Good when we want to own the component source. It is not a single styled framework, so it shifts long-term design-system burden back into the app. |
| Base UI | Useful headless gap-filler | Strong primitive base for custom controls, but not a complete styled framework. Use selectively, not as the main UI system. |

## Tables

Framework-native tables are enough for:

- short static rows
- two-column detail panes
- setup summaries
- settings reference lists
- simple read-only previews

TanStack Table should be used for:

- Inventory, Inbox, and Project ledgers once filters and row selection become
  real
- multiselect state filters
- frame-type filters
- column visibility or persisted user layout
- sorting by target/date/session/type/path
- batch actions
- pagination or virtualization

This should be a visual/behavior split:

- Mantine supplies the visual table, controls, menus, pagination, checkboxes,
  and density.
- TanStack Table supplies row models, sorting, filtering, selection, and column
  state.

Do not use MUI X Data Grid or Ant Design Table in the product UI. They were
evaluated during the review, but Mantine is the selected styled framework.

## Routing

Use **TanStack Router** for app routing. URL state should become a first-class
product surface as we add page-level filters, selected item deep links, setup
steps, drawer state, project IDs, and route-scoped search parameters. The useful
parts for this app are:

- typed routes and navigation
- typed search parameters for filters and selected rows
- nested routes for project detail, item detail, settings sections, and setup
  flows
- code-based route trees without committing to file-based route generation yet
- `createHashHistory()` support, which fits a Tauri/static desktop shell
- route loaders later, if we want route-scoped async DB/Tauri command loading

Routing implementation policy:

1. Use `@tanstack/react-router`.
2. Use code-based routes plus `createHashHistory()` for the Tauri shell.
3. Use typed search params for filters and selected IDs.
4. Defer `@tanstack/router-plugin` file-based route generation until route count
   or nested ownership makes it worth the generated-file workflow.

Latest checked package versions during this review:

- `@tanstack/react-router`: `1.169.2`
- `@tanstack/router-plugin`: `1.167.35`
- `@tanstack/router-devtools`: `1.166.13`

## Source Basis

- Mantine component docs: https://mantine.dev/core/table/,
  https://mantine.dev/core/menu/, https://mantine.dev/core/select
- MUI Table and MUI X Data Grid docs: https://mui.com/material-ui/react-table/,
  https://mui.com/x/react-data-grid/
- Chakra UI Table and Menu docs: https://chakra-ui.com/docs/components/table,
  https://chakra-ui.com/docs/components/menu
- Ant Design React docs and components: https://ant.design/docs/react/introduce/,
  https://ant.design/components/table, https://ant.design/components/descriptions
- shadcn Data Table docs: https://v3.shadcn.com/docs/components/data-table
- Base UI docs: https://base-ui.com/react/components/select,
  https://base-ui.com/react/components/dialog
- TanStack Table docs: https://tanstack.com/table/v8/docs/guide/features
- TanStack Router docs: https://tanstack.com/router/router/docs,
  https://tanstack.com/router/latest/docs/framework/react/guide/data-loading
