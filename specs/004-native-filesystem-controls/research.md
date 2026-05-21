# Research: Native Filesystem Controls

**Branch**: `004-native-filesystem-controls` | **Date**: 2026-05-20

This document captures the decisions and open questions that gate the
implementation plan. Each section names the question, the options
considered, the recommended default, and the open follow-up.

## 1. Directory Picker Semantics Per OS

**Question**: What are the per-OS semantics of opening a native
directory picker through `@tauri-apps/plugin-dialog`, and which
options actually constrain the user to a single existing directory?

**Options Considered**:

- **`@tauri-apps/plugin-dialog` with `directory: true, multiple: false`** —
  on macOS this maps to `NSOpenPanel` with `canChooseDirectories=YES,
  canChooseFiles=NO`. On Windows it maps to the
  `IFileOpenDialog` with `FOS_PICKFOLDERS`. On Linux it uses GTK or
  xdg-desktop-portal, both of which honor directory-only mode.
- **`rfd` crate directly from Rust** — works, exposes the same
  underlying dialogs, but duplicates the plugin's surface and requires
  hand-rolling the Tauri command. Worth keeping as a fallback only.
- **HTML `<input type="file" webkitdirectory>`** — returns synthetic
  `File` objects without real paths. Fails the local-first principle.

**Decision (default)**: `@tauri-apps/plugin-dialog` with
`directory: true, multiple: false`. It is the only option that
combines real absolute paths with cross-platform parity. The
`defaultPath` option SHOULD be honored where supported.

**Per-OS Notes**:

- **macOS**: `defaultPath` anchors `NSOpenPanel` reliably.
  Sandboxed builds require an entitlement (`com.apple.security.files.user-selected.read-only`)
  which Tauri already supplies through its default capability set.
- **Windows**: `IFileOpenDialog` honors `defaultPath` only when the
  path exists. Long paths (>260 chars) require the `\\?\` prefix; the
  plugin normalizes this on return.
- **Linux**: GTK 3 portal honors `defaultPath`; the xdg-desktop-portal
  backend may ignore it on some compositors. Tested compositors:
  GNOME, KDE Plasma, XFCE.

**Open**: Confirm the capability allowlist entry needs both
`dialog:default` and `dialog:allow-open` for the chosen Tauri version.
Verify behavior on Wayland with `xdg-desktop-portal` versions older
than 1.16.

## 2. File Picker Filters For Calibration Masters

**Question**: How should the file-type filter list be shaped for
master calibration file selection so that users can find their
existing FITS, XISF, and TIFF files without being railroaded into one
format?

**Options Considered**:

- **One combined filter (`*.fit;*.fits;*.xisf;*.tif;*.tiff`) only** —
  minimal UI, but users with mixed libraries cannot narrow to just
  XISF when scrubbing a directory full of FITS files.
- **Separate filters per format only** — clean buckets, but the user
  has to manually switch to find a TIFF when most files are FITS.
- **Combined `All supported` first + per-format filters + `All files`
  escape** — covers all three flows: quick start, narrowed scrub, and
  the rare "I named my file weirdly" rescue.

**Decision (default)**: Option 3. Filter list, in order:

1. `All supported (*.fit, *.fits, *.xisf, *.tif, *.tiff)` — default.
2. `FITS (*.fit, *.fits)`.
3. `XISF (*.xisf)`.
4. `TIFF (*.tif, *.tiff)`.
5. `All files (*.*)`.

`Tauri plugin-dialog` requires each filter to be specified as
`{ name, extensions: string[] }`. Extensions MUST omit the leading
`.` per the plugin's contract.

**Per-OS Notes**:

- **macOS**: `NSOpenPanel` uses `allowedFileTypes`; the plugin merges
  the per-filter extension lists when `All supported` is active.
- **Windows**: `IFileOpenDialog` renders filters as a dropdown labeled
  by the filter name. Case-insensitive matching is automatic.
- **Linux**: GTK uses MIME-style filters but the plugin translates
  extension lists into glob filters that work across portal backends.

**Open**: Decide whether to include `.fts` as a FITS alias (some
legacy DSLR-FITS converters used it). Recommend yes — add it to both
`FITS` and `All supported` lists in a v1.1 follow-up.

## 3. Reveal-In-OS Cross-Platform Commands

**Question**: Which cross-platform mechanism reliably opens the OS
file browser at a given path with the target selected/highlighted?

**Options Considered**:

- **`tauri-plugin-opener` `revealItemInDir(path)`** — official
  plugin, dispatches to `NSWorkspace.activateFileViewerSelectingURLs`
  on macOS, `SHOpenFolderAndSelectItems` on Windows, and the
  freedesktop `org.freedesktop.FileManager1` D-Bus interface on Linux
  when available. Falls back to opening the parent directory if
  selection is unsupported.
- **Hand-rolled per-platform commands via `@tauri-apps/api/shell`** —
  works but requires three platform branches:
  - macOS: `open -R "/abs/path"`.
  - Windows: `explorer.exe /select,"C:\abs\path"` (note the comma,
    not a space; quoting is critical for paths with spaces).
  - Linux: try `dbus-send` to `org.freedesktop.FileManager1`'s
    `ShowItems`, then fall back to `xdg-open` on the parent directory.
- **OS-specific Rust crates (e.g. `opener`)** — overlaps with
  `tauri-plugin-opener`; no advantage.

**Decision (default)**: `tauri-plugin-opener` `revealItemInDir`.
Fallback to hand-rolled commands only if the plugin is unavailable on
a target platform.

**Per-OS Notes**:

- **macOS `open -R`**: highlights the file in Finder. Opens a new
  Finder window if Finder is closed.
- **Windows `explorer.exe /select,`**: highlights the file in
  Explorer. Spawns a new Explorer window if none is open. Long paths
  must use the `\\?\` prefix.
- **Linux freedesktop `ShowItems`**: GNOME Files, Nautilus, Nemo,
  Dolphin (recent versions), and PCManFM-Qt all implement this
  interface. XFCE Thunar implements it as of 4.18.
- **Linux fallback**: when `ShowItems` is unavailable, open the
  parent directory with `xdg-open`. Record the result as
  `revealed: true, selection: "directory_only"` in the response so
  the UI can adjust copy.

**Open**: Decide whether to canonicalize symlinks before reveal.
Default is no — pass the user-visible path through so the file browser
shows it where the user expects, not at the symlink target. Revisit
if users report confusion when the symlinked drive is offline.

## 4. Cancellation As Non-Error

**Question**: How should picker cancellation be modeled in the
contract — as an error, as a typed null response, or as an empty path
string?

**Options Considered**:

- **Error code `picker.cancelled`** — explicit but pollutes the error
  channel with a non-failure case, encouraging callers to swallow all
  errors.
- **Typed null response `{ path: null }`** — clear, ergonomic, and
  matches `plugin-dialog`'s native return convention.
- **Empty string `""`** — ambiguous with "empty path", which is
  invalid input on some platforms.

**Decision (default)**: Typed null response. The JSON Schema marks
`path` as nullable in the response. Callers branch on `path === null`
to decide whether to add a row.

**Open**: Confirm the audit log handler ignores null-response picker
operations. Default behavior: do not emit an audit event for
cancellation.

## 5. Default Path Anchoring

**Question**: Should the directory picker remember the last-chosen
parent directory per source kind to make subsequent picks faster?

**Options Considered**:

- **No memory** — every picker open starts at the OS default.
  Simplest, but annoying when users add multiple raw sources from the
  same external drive.
- **Single global last-path** — remember one "last successful pick"
  path across all kinds. Reduces clicks for sequential adds.
- **Per-kind last-path** — remember `last_raw`, `last_calibration`,
  `last_project`, `last_inbox` separately. Most useful for users who
  organize each kind on a different drive.

**Decision (default)**: Per-kind last-path, stored in
`localStorage` under `alm.native.last-path.<kind>`. The Tauri command
does not see the cached value; the React hook passes it as
`default_path` on each open. On macOS and Linux the OS dialog may
override this with its own session memory; that's acceptable.

**Open**: Decide whether to also seed the master-file picker from the
calibration source root. Default yes — when adding a master and a
calibration source root is registered, pass it as `default_path`.

## 6. Reveal Failures: User Notification Plus Audit

**Question**: Should reveal failures show a user-facing toast, write
an audit-log entry, or both?

**Options Considered**:

- **Toast only** — quick feedback, no durable record.
- **Audit log only** — durable record, but the user gets no feedback
  and may think the click did nothing.
- **Toast plus audit log** — quick feedback and a durable record.

**Decision (default)**: Both. The toast carries the error code's
human-readable copy plus a "Copy path" action. The audit log entry
carries `{ kind: "native.reveal.failed", error_code, path_hash,
entity_kind?, entity_id?, request_id, timestamp }`. Path hash, not
the raw path, is used in the audit log to avoid surfacing PII when
the audit log is exported.

**Open**: Confirm the toast component supports a secondary action
("Copy path"). If not, the toast offers only the error message and
the audit entry carries the rest.
