# Settings

Settings groups twelve panes into three sections — **Library**,
**Processing**, and **Application**. Every pane auto-saves as you change it;
there is no global Save button anywhere in the app.

[screenshot: the Settings page with the three-section pane navigation]

## Library

### Data Sources

"Library roots the app indexes. Files are read in read-only mode; nothing is
modified outside an approved plan." Covered in depth in
[Getting started](./01-getting-started.md#managing-data-sources-over-time):
add, rescan, remap, disable/enable, and delete registered roots.

### Equipment

"Cameras, telescopes, and optical trains used across your sessions."
**Cameras**, **Telescopes**, **Filters** (categorized **Broadband**,
**Narrowband**, **Dual-band**, **Custom**, **Other**), and **Optical Trains**
that combine them with a focal length. Items detected from your file headers
are tagged **Auto-detected**; your own entries are **Manual**. An item still
referenced by an optical train cannot be removed until you edit that train.

### Ingestion

"Controls how the app scans source folders and groups newly discovered
files."

- **Scan defaults** — **Scan on startup** ("Scan all roots each time the
  application opens.").
- **Follow symbolic links** — "Disabled by default to prevent scan loops."
- **Follow NTFS junctions** — for Windows libraries using junctions to
  external drives.
- **File hashing** — **Hashing mode**: "Lazy defers hashing until a feature
  needs it (e.g. duplicate detection). Eager hashes every file on first
  scan. Off disables hashing entirely."

> **Not yet available:** these ingestion values persist and survive a
> restart, but the scan pipeline does not consume them yet — changing them
> has no effect on scanning behavior in the current build.

### Naming & Structure

"Token patterns used when files are confirmed from Inbox to Inventory." Build
a destination folder pattern per frame type (including master kinds) from
tokens, literals, and separators — e.g. `{target}/{filter}/{date}/light/` —
with a live preview against real values, warnings for problems such as
consecutive separators, and an explicit note of which tokens fell back to
defaults. An empty pattern means the built-in default. This is the pattern
the [Inbox](./02-inbox.md#confirming--move-mode) resolves destinations from.

### Target Resolution

"How object names in your files are resolved to canonical targets — online
SIMBAD resolution plus the bundled seed and local cache." Toggle **Online
SIMBAD resolution** ("Targets not in the bundled seed or local cache are
resolved on demand from SIMBAD, then cached." — or, when off, "Online
resolution is off — only the bundled seed and local cache are used. Unknown
objects are marked unresolved."), tune the **SIMBAD endpoint**, **Request
timeout (s)**, and **Typeahead debounce (ms)**, and choose which catalogues
the Planner filter shows by default.

### Target Planner

"Observation planning preferences — altitude threshold and filter visibility
settings for the Planner table." The **Usable altitude threshold (°)**
(0–90, default 30) is the "minimum elevation above the horizon (in degrees)
considered acceptable for imaging" and drives the Visible-tonight and
imaging-time columns of the [Targets](./07-targets-and-planning.md) table.
Out-of-range input is clamped. (Until the planner columns switch from
placeholders to real astronomy, the threshold's visible effect is limited —
see the honest-stub warning in that chapter.)

## Processing

### Processing Tools

"Configure executable paths and directory templates for each processing
tool." Each tool (PixInsight, Siril) shows its detection status
(**Available** / **Missing**), its executable path, and **Re-detect**. This is
where **Open in {tool}** on a [project](./04-projects.md#launching-your-processing-tool)
gets its executable from.

### Calibration Matching

"Tolerances and requirements for automatic calibration frame matching." The
**Matching criteria** table is described in
[Calibration → Tolerances](./06-calibration.md#tolerances).

### Cleanup

"Default actions for each data type when a cleanup plan is generated after
processing." Also home of **Source Protection**: the **Default protection**
level (**Protected** / **Normal** / **Unprotected**) applied to newly
ingested sources — see [The safety model](./09-safety-model.md#protected-sources).

## Application

### Appearance

"Theme, font size, and display density."

- **Theme** — four named themes shown as live preview swatches: **Warm
  Clay** (light), **Warm Slate** (light), **Observatory** (dark), and
  **Espresso** (dark), plus **System**, which follows your OS light/dark
  preference ("auto · dark" / "auto · light"). Switching applies instantly,
  no reload, and survives a restart.
- **Display Density** — **Compact (24px row)**, **Comfortable (32px row)**
  (default), **Spacious (40px row)**.
- **Font Size** — **Small (13px)**, **Default (14px)**, **Large (16px)**.

[screenshot: the Appearance pane with the four theme swatches]

> **Not yet available:** the **Font Size** control is currently visual-only
> within this pane — it does not yet change text size elsewhere in the app.

### Advanced

"Logging level, database information, and reset options."

- **Logging** — **Log level** (**Error** / **Warn** / **Info** / **Debug**):
  "Controls application log verbosity. Debug emits diagnostic detail; Info
  is the default; Warn and Error progressively quieter." See
  [Troubleshooting](./10-troubleshooting.md#the-log-panel).
- **Database** — engine, location, size, schema version, record counts, and
  **Export database**.
- **Guided Tour** — **Restart guided flow** replays the first-project
  walkthrough.
- **Source Setup Wizard** — **Restart first-run setup** reopens the setup
  wizard with your sources pre-filled (confirm-gated; "nothing is deleted").
  Note this is distinct from the guided-tour restart above it.
- **Danger Zone** — **Reset preferences**: "Resets all UI preferences
  (theme, density, font size) to defaults. Library roots, equipment, and
  session data are not affected."

### Audit Log

"Searchable history of every state change, plan application, and system
event." Described in
[The safety model → The audit log](./09-safety-model.md#the-audit-log).

## Related journeys

- [Journey 10 — Settings, appearance, and i18n](../product/user-journeys.md#journey-10--settings-appearance-and-i18n)

Click-by-click scenario scripts:

- `e2e-agentic-test/018-settings-configuration-model/appearance-themes/scenario.md`
- `e2e-agentic-test/018-settings-configuration-model/panes-and-persistence/scenario.md`
