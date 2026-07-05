# Getting started

The first time you launch PlateVault, it knows nothing about your library.
The setup wizard fixes that: it asks where your data lives, which processing
tools you use, and a few defaults — then runs an initial scan. Your files are
never moved or copied during setup; the wizard only builds an index. As the
confirmation step puts it: "The scan only reads file headers and builds an
index — your files stay exactly where they are. **Nothing is moved or
modified.**"

## The setup wizard

The wizard runs on first launch (or after **Restart first-run setup**, see
below). The header shows your progress as "Setup · Step 1 of 5".

[screenshot: setup wizard on Step 1 with the four source folder categories]

### Step 1 — Source Folders ("Where does your data live?")

Add the folders where your light frames, calibration frames, projects, and
incoming captures are stored. Four categories are shown as compact cards:

- **Light frames** (required)
- **Calibration frames** (optional)
- **Project** outputs (optional)
- **Inbox** (optional) — the drop folder where new captures land before they
  are sorted.

Use **+ Add folder…** on a category to pick a directory with your operating
system's native folder picker. For each folder you also choose its
organization state:

- **Already organized** — files stay in place; PlateVault will only catalogue
  them (see [Catalogue-in-place](./02-inbox.md#confirming-catalogue-in-place)).
- **Needs organizing** — files will be moved into a library structure when
  you confirm them from the Inbox.

The Inbox category has no such choice — an inbox is unorganized by
definition. You can also pick the scan depth for each folder (**Recursive**
or **Single level**). Duplicate paths are rejected inline ("This directory is
already added" / "This directory is registered under {kind}"). Nothing is
registered yet at this step — it is a working list you can still edit.

### Step 2 — Processing Tools

PlateVault detects installed processing tools (**PixInsight**, **Siril**)
automatically and shows their status (**Detected** / **Not detected**). You
can enable a tool, point at its executable with **Select binary…**, or
**Redetect**. This step is skippable: "You can skip this step. Tool
configuration can be changed later in Settings."

### Step 3 — Configuration

A few defaults you can change later in Settings:

- **Appearance / theme** — the app's color theme (see
  [Settings → Appearance](./08-settings.md#appearance)).
- Display density — **Compact**, **Comfortable**, or **Spacious**.
- **Default source protection** — the "protection level applied to newly
  added source folders. Protected sources are skipped by cleanup plans unless
  explicitly approved." If in doubt, leave this on its protective default;
  you can relax it per source later. The safety implications are explained in
  [The safety model](./09-safety-model.md#protected-sources).

### Step 4 — Confirm ("Ready to go")

A summary of your folders and tools. This is the point where things become
real: pressing **Start scan →** registers your folders as library roots and
starts the initial scan. The step also spells out what happens next: your
selected folders are registered as library roots, an initial scan reads file
headers to build the index, and light frames are grouped into acquisition
sessions.

If a required folder type is missing, the wizard blocks here: "Cannot
complete setup: missing required folder types — {kinds}. Go back to Step 1 to
add them."

### Step 5 — Scan ("Scanning your library")

Each registered folder is scanned and detected files are listed by folder,
format, and detected type. An empty folder is fine — it simply completes with
nothing detected. **Finish** only becomes available once every source's scan
has finished.

[screenshot: setup wizard Step 5 with per-folder scan results]

Finishing lands you on the Inbox. Setup completion sticks: the next launch
goes straight to the app.

### Restarting setup later

**Settings → Advanced → Restart first-run setup** reopens the wizard: "This
reopens the source setup wizard and clears its completed status. Your
existing sources will be pre-filled for you to review and adjust — nothing is
deleted." This is a confirm-gated control, distinct from the guided-tour
restart button.

## Managing data sources over time

After setup, your registered folders live under **Settings → Data Sources**,
one card per root, with its category (**Raw**, **Calibration**, **Project**,
**Inbox**), path, and last-scanned date.

[screenshot: Settings → Data Sources with several source cards]

From each card you can:

- **Rescan** — pick up files added to the folder since the last scan.
- **Remap…** — for a folder whose drive letter or mount point changed. The
  **Remap root** dialog shows the **Current path**, lets you enter a **New
  path**, and **Verify** checks a sample of known files at the new location
  (marking each **Found** or **Not found**) without touching anything. Only
  after verification does **Apply remap** re-point PlateVault's record.
  PlateVault never moves files to follow a remap — it updates its own
  bookkeeping only.
- **Disable** / **Enable** — temporarily exclude a source: "The source will
  be excluded from scans and ingest until re-enabled. Its history is kept."
  Disabled sources show a **Disabled** pill; re-enabling needs no
  confirmation.
- **Delete** — un-register a source permanently. The confirmation is
  explicit about scope: "…will no longer be tracked. Files on disk are never
  touched — this only removes the registration." Deletion is refused while
  other records (sessions, projects, plans) still depend on that root.

Folder selection throughout the app uses your operating system's native
pickers rather than ad-hoc dialogs; reveal actions elsewhere open your
system's file manager.

## Source protection defaults

The default protection level you chose in Step 3 lives under
**Settings → Cleanup → Source Protection** (**Default protection**:
**Protected**, **Normal**, or **Unprotected**). It "controls the starting
protection level assigned to newly ingested sources" — protected sources are
skipped by cleanup plans unless you explicitly approve their inclusion during
plan review. You can override the level per source from its Data Sources
card. Details in [The safety model](./09-safety-model.md#protected-sources).

> **Note:** an earlier design described an eight-step wizard (with separate
> welcome, per-category, catalog-download, and tool-detection steps). The
> shipped wizard is the five-step flow described above; if you find older
> screenshots or notes referring to eight steps, they describe a design that
> never shipped.

## Related journeys

- [Journey 1 — First-run setup → data sources](../product/user-journeys.md#journey-1--first-run-setup--data-sources)

Click-by-click scenario scripts:

- `e2e-agentic-test/003-first-run-source-setup/wizard-fresh-db-journey/scenario.md`
- `e2e-agentic-test/003-first-run-source-setup/restart-first-run/scenario.md`
- `e2e-agentic-test/003-first-run-source-setup/data-sources-remap-rescan/scenario.md`
- `e2e-agentic-test/003-first-run-source-setup/data-sources-disable-delete/scenario.md`
- `e2e-agentic-test/004-native-filesystem-controls/picker-reveal-controls/scenario.md`
- `e2e-agentic-test/016-source-protection-defaults/protection-defaults-take-effect/scenario.md`
