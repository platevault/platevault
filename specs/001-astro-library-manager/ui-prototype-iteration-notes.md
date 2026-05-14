# UI Prototype Iteration Notes

## Purpose

This document records the current frontend prototype decisions that came out of
the design iteration after the first mockup pass. It complements
`data-states-contracts-lifecycle.md` and `user-stories-ui-model.md`.

## First-Run Wizard

The first-run setup is a one-time app-level wizard. It is not a main navigation
screen and it is not embedded in Inbox.

Wizard pages are sequential:

- Overview.
- Raw Sources.
- Calibration Sources.
- Project Sources.
- Inbox Sources.
- Scan Preview.

Users can skip the whole setup, but individual wizard pages are not skipped.
Optional work is handled inside each page:

- Source pages allow multiple rows.
- Each source row represents an active source. There is no include/exclude
  checkbox. Empty rows must be completed or removed.
- Source roots are always directories. Production must use the native Tauri
  directory picker. The prototype may use a text/path shortcut only when it is
  clearly marked in source code as a Tauri replacement point.
- Source validation blocks Next when a row has no directory, a duplicate source
  name, a duplicate source root, or a file-like path.
- Preview is a row action. It shows an expanded results panel with the
  directories/files that would be included and per-entry warnings.
- The initial project is not part of the wizard. It is created from the guided
  Projects workflow after setup.

The summary/preview page must run a scan preview, show loading while it runs,
and block Finish until it completes. It must show, for each source, the full
included directory/file list and warnings before the user finishes setup. It
must not imply marker writes or ingestion have already occurred.

Guided first steps are not selectable in the wizard. After setup completes, the
first guide point can be skipped. Otherwise the guide points to real app
sections and advances only when the user performs the relevant action:

- scan Inbox;
- create or reveal sample Inbox placeholders for darks, bias, flats, and
  lights;
- require the user to select each Inbox item before move actions are shown;
- move the selected master darks, master bias, flats, and lights into
  Inventory one at a time;
- select each moved Inventory item and verify its structured details;
- confirm darks, bias, flats, and lights separately in Inventory;
- add and create the first Project from the Projects setup pane.

Project setup asks for source selection separately:

- one or more light sessions;
- optional flats per selected light session;
- dark master;
- bias master.

Dark flats are not exposed in the first project setup flow.

The wizard can be restarted from Settings.

## Projects

Project top actions:

- `Add project`: opens the project setup flow.

Project table row actions:

- `Open`: reveal the project location in the native OS file browser.
- `Edit`: open the compact project setup/edit flow.
- `Open in PixInsight` or `Open in Siril`: shown only when the selected
  workflow supports direct tool launch.
- Arrow menu: small icon-only alternatives menu for uncommon non-destructive
  actions.

Do not place vague actions such as `Continue mapping`, `Preview manifest`, or
`Create plan` in the side detail panel. Actions belong with the project row or
inside an explicit operation dialog. Filesystem-changing project operations
must be represented as reviewable plans before they can be applied.

Do not show the lifecycle stage strip (`Candidate`, `Source Mapping`,
`Prepared`, etc.) as a top menu. State can be shown as plain text and filtered
through a multiselect control.

The right side detail is a structured selected-project panel. It combines
summary facts, source rows, and expandable channel detail:

- total integration;
- exposure count;
- acquisition dates;
- immutable metadata extraction state;
- source list with direct source rows;
- per-channel integration;
- per-channel frame count;
- mixed exposure-length notation;
- gain, offset, binning;
- camera and temperature.

Project actions include an `Open location` prototype action. Production must
replace this with a native Tauri file-browser reveal command.

## Inbox And Inventory

Inbox and Inventory use the same action vocabulary:

- a primary row action;
- a small arrow-only overflow menu;
- selected-item detail panel with structured facts;
- `Open location` prototype action for native file browser reveal.

Inbox does not show summary metric boxes above the ledger and does not include
`Review next`. Status/review information is plain text, not a bubble. Inventory
does not show Tags or Handling columns and does not show a separate review queue
panel in the side column. The side panel only describes the selected item and
its actions.

## Settings

Settings must be editable, aligned, and purposeful.

`Data Sources` shows actual sources, not counts. Each row includes:

- name;
- type;
- root;
- state;
- scan rule or source-specific help;
- reconnect;
- rescan;
- enable/disable;
- remove.

Settings use a narrow left section list and a dense right pane. Controls appear
on their own lines with no side-by-side option blocks. Changes save
automatically; there are no section-local Save buttons. Each setting has an
info affordance for hover/focus help.

Avoid navigation buttons that do not belong in Settings, such as `Open Inbox`.
API Contracts are not a normal Settings section.

Naming templates are edited through a pattern builder. Users click metadata
tokens such as target, project, date, camera, telescope, filter, and workflow,
then add separators such as `/`, `-`, or `_`. The pattern is not a freeform
text box.

Calibration matching is configurable per calibration type. Darks, bias, and
flats have their own matching fields for automatic recommendations, while users
can still assign calibration manually.

Log settings contain only log level. The log viewer itself remembers whether it
is following logs. Request ids/entity metadata are always shown, and logs export
as JSON.

## Overlays

Every overlay must state what the operation does and whether it mutates files.
Current overlays:

- first-run wizard;
- guided first-step coach;
- data source remove warning;
- project rename/archive/cleanup warnings;
- bottom structured log foldout.

All non-destructive actions should run directly. Destructive or
filesystem-changing paths must show a warning and remain review-plan based.

## Framework Review

The framework comparison artifacts are historical review evidence. The live
framework route is now a Mantine-only decision/reference page:

```text
#/framework-review?page=inbox
```

The selected stack is captured in
[`framework-selection-review.md`](framework-selection-review.md).

Use Mantine as the primary styled component framework. Use TanStack Table when
ledger behavior needs sorting, filtering, row selection, column visibility,
pagination, or virtualization. Use TanStack Router with hash history for app
routing in the Tauri shell.
