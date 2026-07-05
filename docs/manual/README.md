# PlateVault user manual

PlateVault is a local-first desktop app for organizing an astrophotography
library. It catalogs your FITS/XISF frames, maps them to targets, sessions,
and projects, prepares inputs for processing tools such as PixInsight/WBPP,
and plans filesystem changes — moves, archives, cleanup — as reviewable plans
that you approve before anything happens on disk.

Two things PlateVault will never do:

- **Process your images.** Calibration, registration, integration, and
  editing belong to PixInsight/WBPP (or another processing tool). PlateVault
  organizes, documents, and prepares; your processing tool processes.
- **Change files behind your back.** Every move, copy, archive, or delete is
  proposed as a plan first, applied only when you approve it, and recorded in
  the audit log. See [The safety model](./09-safety-model.md).

## Chapters

| # | Chapter | What it covers |
|---|---------|----------------|
| 1 | [Getting started](./01-getting-started.md) | First-run setup wizard, registering data sources, protection defaults, managing sources over time |
| 2 | [The Inbox](./02-inbox.md) | Scanning for new files, reviewing and reclassifying items, the metadata gate, confirming (move or catalogue-in-place), applying plans |
| 3 | [Sessions](./03-sessions.md) | Acquisition sessions as a derived, always-current view; filtering, grouping, notes |
| 4 | [Projects](./04-projects.md) | Creating projects, attaching sources, manifests and notes, launching a processing tool, tracking output artifacts |
| 5 | [Cleanup and archive](./05-cleanup-and-archive.md) | Reclaiming disk space safely, archiving finished projects, deleting from the archive |
| 6 | [Calibration](./06-calibration.md) | Master frames, fingerprint columns, matching masters to sessions, tolerances |
| 7 | [Targets and planning](./07-targets-and-planning.md) | The target catalog, SIMBAD lookups, aliases and notes, and what the planner columns show today |
| 8 | [Settings](./08-settings.md) | Every settings pane: appearance and themes, data sources, ingestion, planner tunables, and more |
| 9 | [The safety model](./09-safety-model.md) | Reviewable plans, no silent overwrites, the audit log, archive-before-delete, protected sources |
| 10 | [Troubleshooting](./10-troubleshooting.md) | Common error messages and what they mean, the log panel, gathering support data |

## Conventions used in this manual

- **Bold text in quotes** matches the app's on-screen labels exactly — for
  example, the **Rescan** button on the Inbox page.
- Screenshots are marked as placeholders like
  `[screenshot: the Inbox with a plan open]` until captured.
- Features that are designed but not yet available in the current build are
  called out in **Not yet available** notes rather than silently omitted.
- Each chapter ends with a **Related journeys** section linking to the
  product-level walkthroughs in
  [`docs/product/user-journeys.md`](../product/user-journeys.md) and the
  click-by-click scenario scripts under `e2e-agentic-test/`.

## Where to start

New install? Read [Getting started](./01-getting-started.md), then
[The Inbox](./02-inbox.md) — those two chapters take you from an empty
database to files catalogued in your library. If you want to understand why
PlateVault asks for review so often before touching your files, read
[The safety model](./09-safety-model.md) first.
