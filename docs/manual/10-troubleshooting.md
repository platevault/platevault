# Troubleshooting

PlateVault reports problems in plain language, never as raw codes. This
chapter lists the messages you are most likely to meet, what each one means,
and what to do — plus where to look (the log panel, the audit log) when the
message alone doesn't explain enough.

## Common messages and what to do

### Setup and data sources

| Message | What it means / what to do |
|---|---|
| "This directory is already registered" | You already added this folder as a source. Check **Settings → Data Sources**. |
| "This directory is registered under a different category" | The folder is already a source of another kind (e.g. Calibration vs Raw). Use it where it is registered, or delete that registration first. |
| "This directory does not exist" / "This path is not a directory" | The path is wrong, or the drive isn't mounted. If a drive moved, use **Remap…** instead of re-adding. |
| "Cannot read this directory — check permissions" | PlateVault can't read the folder. Fix filesystem permissions and retry. |
| "This source still has related records (sessions, plan items, or inbox items) and can't be deleted." | Deleting a source is refused while other records depend on it. This protects your history; disable the source instead if you just want it out of the way. |
| "Finish the initial setup before using this feature." | The first-run wizard hasn't been completed. See [Getting started](./01-getting-started.md). |
| "macOS has quarantined this app. Approve it in System Settings, then try again." | macOS Gatekeeper blocked the app. Approve it under System Settings → Privacy & Security. |

### Inbox and confirmation

| Message | What it means / what to do |
|---|---|
| "This item is missing the details needed to plan a move." | The missing-metadata gate. Assign the missing value(s) via bulk reclassify — see [The Inbox](./02-inbox.md#needs-review--the-missing-metadata-gate). |
| "Choose a destination library before continuing." / "A destination library is required for this move." | More than one root can host this frame type — pick one in the destination picker. |
| "No library root is registered for this frame type." | Nothing can receive these files. Register a suitable library root under **Settings → Data Sources**. |
| "This item already has an open plan. Review or cancel it first." | You confirmed this item earlier. Find the plan under **Review plans** and apply or discard it. |
| "This classification is out of date. Re-scan to refresh it." | The folder changed since PlateVault classified it. **Rescan**. |
| "This file could be more than one type — confirm how to classify it." | Headers were ambiguous. Assign the frame type yourself. |

### Plans

| Message | What it means / what to do |
|---|---|
| "Approve the plan before applying it." | Plans require explicit approval — open the review overlay and approve. |
| "The plan changed since you reviewed it. Review it again." | The plan's contents changed after your review; re-review before applying. |
| "Source files changed — discard and re-confirm to regenerate this plan." | The plan went stale. Discard, then confirm the item again. |
| "Another plan is currently working on the same files or folders. Wait for it to finish, then try again." | Overlap protection — plans never race each other. |
| "This plan is blocked by a protected item. Resolve the protection first." | A protected file is in the plan. Acknowledge it during review, or change the source's protection level. See [The safety model](./09-safety-model.md#protected-sources). |
| "Something already exists at the destination." / "A file or folder with that name already exists here." | Collision refusal — PlateVault never overwrites. Resolve the conflict on disk or adjust your naming pattern. |
| "This plan has no items to apply." | An empty plan can't be approved. Select at least one item before generating. |
| "The destination folder doesn't exist." / "Couldn't write to that location — check permissions." | Filesystem problems at the destination. Verify the drive is mounted and writable. |

### Projects and tools

| Message | What it means / what to do |
|---|---|
| "A project with this name already exists." / "That name is already in use." | Names are unique regardless of letter case. Pick another. |
| "You can't remove the last confirmed source." | A project must keep at least one confirmed source; add a replacement before removing this one. |
| "This project is archived and cannot be edited." / "This project is read-only and can't be changed." | Archived projects are read-only by design. |
| "A filesystem plan is required before this transition. Create or approve a plan first." | Lifecycle transitions that imply file moves (like archiving) are plan-gated. See [Cleanup and archive](./05-cleanup-and-archive.md#archiving-a-finished-project). |
| "Tool path not configured" / "Tool executable missing" | Set the executable under **Settings → Processing Tools**. |
| "Couldn't launch the external tool." / "Failed to launch {tool}: {error}" | The OS could not start the process — check the path points at a runnable executable. |
| "The confirmation text doesn't match." | Typed confirmations (like `DELETE`) must match exactly, including case. |

### Targets

| Message | What it means / what to do |
|---|---|
| 'Could not resolve target "{query}". Try a different name.' | Not in the seed catalog and SIMBAD couldn't resolve it (or you're offline / online resolution is disabled). Check **Settings → Target Resolution**. |
| "That alias already exists for this target." / "Only user-added aliases can be removed." | Alias bookkeeping rules — catalog aliases are fixed; yours are editable. |

### General

| Message | What it means / what to do |
|---|---|
| "Something went wrong. Please try again." | The generic fallback. If it repeats, check the log panel (below) and gather support data. |
| "Couldn't reach the local database. Please try again." / "Couldn't read from the local database. Please try again." | The app's local database hiccuped. Restart the app; if persistent, check disk health and free space. |
| "A file read/write error occurred. Please try again." | A low-level I/O error — often a disconnected external drive. |

If you ever see a raw untranslated code or key instead of a sentence like the
ones above, that itself is a bug worth reporting.

## The log panel

The **Activity** panel — the collapsible strip at the bottom of the window —
is your live view of what the app is doing. It is a layout participant, not
an overlay: expanding it shrinks the content area rather than covering your
work.

[screenshot: the expanded Activity log panel with severity chips]

- Severity chips filter by **Error** / **Warn** / **Info** / **Debug**.
- Sources are restricted to a fixed, known set — the panel never shows
  arbitrary noise.
- **Diagnostics** detail only appears once the log level is set to **Debug**
  (**Settings → Advanced → Log level**).
- **Follow** keeps the newest entries in view; scrolling up pauses it.
- **Export** writes the currently visible log window to a JSON file.
- "History gap — {count} entries older than this point are no longer
  retained." is normal: the panel keeps a bounded window, not forever.

## Gathering support data

When reporting a problem, three exports tell most of the story:

1. **The log panel's JSON export** (set **Log level** to **Debug** first,
   reproduce the issue, then **Export**).
2. **The audit log export** (**Settings → Audit Log → Export**) — shows what
   was applied, refused, or failed, with timestamps.
3. **Database facts** from **Settings → Advanced → Database** (size, schema
   version, record counts) — and **Export database** if asked for it.
   The database contains only metadata about your files, never the images
   themselves.

Include your OS, the app version, and — for anything involving moves or
cleanup — the plan you were applying and whether the source folders live on
an external drive.

## Related journeys

- [Journey 10 — Settings, appearance, and i18n](../product/user-journeys.md#journey-10--settings-appearance-and-i18n) (log panel, i18n guarantees)

Click-by-click scenario scripts:

- `e2e-agentic-test/019-bottom-log-viewer/severity-filter-and-sources/scenario.md`
- `e2e-agentic-test/019-bottom-log-viewer/event-source-class/scenario.md`
- `e2e-agentic-test/046-i18n-error-codes/no-raw-keys-and-translated-errors/scenario.md`
