# R9 spike: Slint + Rust core (bead astro-plan-9p595)

Copied from the throwaway spike repo /Users/sjors/tmp/platevault-spikes/slint (commit cfc2cfb, not in this repository).

# PlateVault UI-stack spike: Slint 1.18 + Rust core

Throwaway spike for bead `astro-plan-9p595`, next to the Tauri (`../tauri-native`) and Flutter
(`../flutter-frb`) spikes. It implements the shared spike spec with Slint 1.18.1 (released
2026-09-21, crates.io) on a framework-agnostic Rust core. The findings feed `astro-plan-2ckn9`.

- `crates/spike-core`: a copy of the Tauri spike's core, taken 2026-10-12, with the serde derives
  removed. It covers `scan`, `Library` (rename, trash), `index`, and the self_update manifest check.
  It adds `desktop.rs`, which holds the window-free services: `notify` (notify-rust) and
  `open_in_file_manager`.
- `app/`: the Slint host. `ui/app.slint` holds the UI. `src/main.rs` owns the event loop and the
  windows, menus, tray and dialogs. `src/sessions.rs` handles sort and formatting.
  `src/control.rs` is an opt-in automation hook.

## Run

```sh
cargo build --release              # works with Command Line Tools only; no Xcode needed
scripts/bundle-macos.sh            # target/release/bundle/PlateVault spike.app (ad-hoc signed)
open "target/release/bundle/PlateVault spike.app"
cargo test                         # 10 core + 4 host unit tests
scripts/measure.sh                 # bundle size, exec→first paint ×6, idle RSS/footprint
scripts/drive.sh main|folder|about # scripted walkthrough + screenshots (see "How it was verified")
```

All test hooks are optional environment variables:

| Variable | Effect |
|---|---|
| `SPIKE_EXIT_AFTER_FIRST_PAINT=1` | Logs `first paint … unix_ms=` on the first rendered frame, then quits (cold-start runs) |
| `SPIKE_CONTROL=stdin` | Reads one command per stdin line (`toggle-theme`, `index`, `cancel`, `select N`, `sort C asc\|desc`, `row-menu`, `rename N`, `rename-text S`, `trash N`, `about`, `open-folder`, `hide`, `tray-show`, `quit`) and runs it through the same Slint callbacks the UI uses |
| `SPIKE_SELECT_ROW=N` | Preselects a row. The AX tree has no selectable rows |
| `SPIKE_OPEN_DIR=/path` | Opens a library at startup. The folder panel runs out of process |
| `SPIKE_DIALOG_DIR=/path` | Sets the start folder of the File › Open folder… panel |

## What maps to the spec

| Spec item | How Slint does it | Evidence |
|---|---|---|
| Window "PlateVault spike"; File › Open folder…, Quit; View › Toggle theme; Help › About | Slint `MenuBar` in the `Window`. On macOS the winit backend turns it into a native NSMenu bar through its bundled muda 0.19 and adds the standard app menu (About, Services, Hide, Quit ⌘Q). `MenuItem.shortcut: @keys(Control + O)` maps Control to ⌘ on Apple | `docs/evidence/ax-tree-start.txt` (AX dump: ⌘O, ⇧⌘T, File › Quit without a shortcut on macOS because the app menu owns ⌘Q). Toggle theme was also pressed through AX while the screen was unlocked |
| Sessions table from Rust `scan`, sortable headers | `StandardTableView` with `sort-ascending`/`sort-descending`. Rust sorts numerically (`sessions.rs`, unit-tested) | `light-system.png`, `sorted-frames-desc.png`, `trashed.png` (real fixture folder) |
| Per-row action menu: Open, Rename…, Move to Trash | `ContextMenuArea` → a native NSMenu popup (muda `show_context_menu_for_nsview`), opened by right-click (`row-pointer-event`) or the "Row actions" button. Open and Trash are disabled on sample rows | `row-menu-during-index.png` (sample row), `row-menu-on-disk.png` (dark run). Rename… and Move to Trash were picked in the native menu with Down/Return key events → `rename-dialog-1.png`, `renamed.png`, `trashed.png` |
| Native folder dialog → `scan` | rfd 0.17 `AsyncFileDialog::set_parent(window_handle)` → an NSOpenPanel **sheet**, awaited with `slint::spawn_local` on the UI thread | `folder-sheet.png`. **Not exercised end to end**: the panel is a remote view service, so a Return posted to the app does not reach it. `Library::open` → `scan` ran through `SPIKE_OPEN_DIR` (log `opened /tmp/platevault-slint-fixture (3 sessions)`) |
| Tray icon: Show, Quit | Slint's **built-in** `SystemTrayIcon` (new in 1.18; NSStatusItem / Shell_NotifyIcon / StatusNotifierItem). Its glyph is picked per `Palette.color-scheme`, because AppKit does not template-tint it | `docs/evidence/ax-tray.txt` (AXMenuExtra, help "PlateVault spike"). `hide` then tray Show → window back (`drive-main.log`) |
| `index()` 0..100 over ~5 s with Cancel; OS notification | A `std::thread` runs `spike_core::index`. Each percent goes back through `Weak::upgrade_in_event_loop`; Cancel sets an `AtomicBool`. notify-rust is called **from the worker thread** | `index-progress.png`, `index-cancelled.png`, `index-complete.png`; log `index Cancelled after 1511 ms`, `index Completed after 5284 ms`, `notification sent`. The banner was **not seen** because the screen was locked |
| Backend-owned update check → "Update available" | A thread at startup runs `check_for_update` on the bundled mock manifest and pushes a `Notice` into the `VecModel` through `upgrade_in_event_loop` | The notice is in every screenshot; log `update available: 0.2.0` |
| Follows system dark/light; Toggle theme | Slint follows the winit theme and the macOS appearance observer by default. Toggle theme sets **both** `winit::Window::set_theme` (title bar and sheets) and `Palette.color-scheme` | `light-system.png` → `dark-toggled.png`. **System-follow not verified live**: the screen was locked, the system appearance was not changed on the user's desktop, and the `-AppleInterfaceStyle Dark` launch argument did not flip it (`trashed.png` stayed light) |
| About | rfd `AsyncMessageDialog` with a parent → an NSAlert sheet | `about-sheet.png` |
| Rename dialog | Slint `Dialog`: a second OS window whose `StandardButton`s Slint orders per platform (Cancel, OK on macOS) | `rename-dialog-1.png` |

## Metrics

Machine: Apple M4 Pro (14 cores), macOS 26.7.1, rustc 1.99.0. The release profile matches the
Tauri spike: fat LTO, `codegen-units=1`, `opt-level="s"`, `panic=abort`, stripped. Other agents
were building throughout, with load averages of 82–105 on 14 cores. Treat the build times as
upper bounds. Raw output is in `metrics/`.

| Metric | Slint | Tauri spike, for reference (its README) |
|---|---|---|
| Release `.app` bundle | **10.2 MB** (10,168 KiB on disk; the binary is 10.4 MB; the bundle adds Info.plist and a 347-byte manifest) | 4.9 MB |
| Cold start → first paint | First launch **550 ms**; warm median **426 ms** (runs 2–6: 460, 389, 432, 426, 399). Exec to the first rendered frame (`RenderingState::AfterRendering`), which already contains the table | 1,533 ms / 489 ms |
| Idle memory, 10 s after launch | **RSS 101 MB, phys_footprint 79 MB**, in one process with no helper processes | 100 MB RSS (28 MB footprint) + 113 MB WebKit XPC |
| Clean release build | **158 s** wall (user 87 s, sys 131 s), from `cargo clean` | 138 s |
| Incremental release build | **48 s** after touching a Rust file; **48 s** after touching `app.slint`. Both are dominated by the fat-LTO relink | 77 s / 66 s |
| LOC (code lines, `scc`) | UI `app.slint` 269. Host Rust 415 (`main.rs`) + 97 (`sessions.rs`, incl. 4 tests). Automation hook 63 (`control.rs`). Core 497 (incl. 10 tests) | UI 476 + seam 161; bridge 424; core 471 |
| Accessibility | See the section below | — |

The startup and memory figures were measured with the screen locked. Tauri's were not.

## Dependencies added (and why)

- `slint` 1.18.1 (default features plus `raw-window-handle-06` and `unstable-winit-030`), with
  `slint-build` 1.18.1. The defaults give the winit backend, which brings muda for the native menu
  bar and context menus, the femtovg and software renderers, AccessKit 0.24, and the built-in
  `SystemTrayIcon` (ksni on Linux).
  - `raw-window-handle-06` lets rfd attach its sheets to the window.
  - `unstable-winit-030` is semver-exempt. It is the only way to set the OS window appearance.
- `rfd` 0.17.2 provides the folder panel and the About alert. Slint has neither a file dialog nor
  a message box.
- `notify-rust` 4.18.2 (in the core) provides the OS notification. Slint has no notification API.
- `trash` 5.2 and `self_update` 1.3 come unchanged from the Tauri spike's core.
- No tokio: a `std::thread` and Slint's `upgrade_in_event_loop` / `spawn_local` were enough.
- Tooling, not dependencies: the hand-written `scripts/bundle-macos.sh`, because Slint has no
  bundler; `screencapture`, `osascript` (JXA) and `sample` from macOS; `scc` for LOC.

## Which OS surfaces needed main-thread or backend tricks

| Surface | Provided by | Threading |
|---|---|---|
| Menu bar, context menus | Slint (muda inside the winit backend) | None needed. Slint owns the main thread and menu callbacks arrive as normal Slint callbacks |
| Tray | Slint `SystemTrayIcon` | None. It is created on the main thread by Slint (`expect("SystemTrayIcon must be created on the main thread on macOS")`) |
| Folder panel, alert | rfd | None in practice. Slint callbacks and `spawn_local` futures run on the main thread, which rfd's macOS backend requires (`run_on_main`, `MainThreadMarker`). The parent handle needs the `raw-window-handle-06` feature |
| Notifications | notify-rust | Runs on any thread, so backend-ownable. macOS needs `set_application(bundle id)`, or notifications are attributed to Finder (`mac-notification-sys` default) |
| Window appearance | winit via `slint::winit_030::WinitWindowAccessor` | An unstable API, and Palette has to be set separately (friction 4) |

Because Slint already uses muda internally, adding the muda or tray-icon crates directly would also
mean sharing muda's single global `MenuEvent` handler, which Slint installs (`muda.rs:384-394`).
The built-in tray avoids that.

## Friction notes

1. **A native menu blocks Slint's event loop.** `ContextMenuArea` calls muda's synchronous
   `popUpMenu`, which runs a nested AppKit tracking loop. While the menu is open, closures posted
   with `upgrade_in_event_loop` / `invoke_from_event_loop` do not run. The UI stayed at 0 % for
   over 3 s while the backend job finished. Measured with `index` then `row-menu`; see
   `row-menu-during-index.png`, `after-row-menu.png` and the log. The work itself is unaffected.
   A production UI would see its progress and notices freeze while any context menu is open.
   Whether the same happens while a menu-bar menu tracks is **[INFERENCE: likely not, because that
   loop isn't entered from inside a winit callback; not tested]**.
2. **Rows swallow right-clicks.** `StandardTableView` rows are `TouchArea`s that grab every
   button. A wrapping `ContextMenuArea` therefore never sees a right-click over a row, so the menu is
   opened from `row-pointer-event` with `show(position)`.
3. **`StandardTableView` is text-only.** It has no per-row action button, no multi-select, and no
   API to set the header sort indicator from code. The menu key works only on Windows (Shift+F10)
   and through a physical Menu key, so macOS gets the "Row actions" button as its keyboard path.
4. **Theme is two settings.** Assigning `Palette.color-scheme` repaints the content but leaves
   the macOS title bar in the old appearance. `winit::Window::set_theme` changes the chrome, but
   winit sends no `ThemeChanged` for it, so the Palette stays. The spike sets both, which takes the
   unstable winit accessor.
5. **Dialogs are plain windows.** Slint has no modal or sheet API, and a `Dialog` has no parent.
   The OS places it, so the spike centres it by hand, and the main window is disabled through a
   `modal-open` property. Button order per platform is built in.
6. **No bundler, no app icon.** `.app` creation, `Info.plist` and signing are scripted by hand.
   cargo-bundle or cargo-packager would be the next step.
7. **Style.** Slint defaults to `cupertino` on Apple and `fluent` elsewhere. The build pins
   `fluent` everywhere, because per-OS looks were dropped. Fluent draws odd table rows in its
   secondary text colour, which lowers contrast (visible in every screenshot).
8. **Binary size.** At 10.4 MB the binary is about 2× Tauri's. It includes the femtovg and
   software renderers, AccessKit and ICU segmentation data
   **[INFERENCE from the dependency tree; no size breakdown done]**. Dropping `renderer-software`
   or switching to Skia changes this; not measured.
9. **App Nap stalls wakeups.** With the window invisible (screen locked), posted events ran only
   when the next event arrived. Automation launches pass `-NSAppSleepDisabled YES`.
10. **Locked desktop.** The screen locked partway through. That hides every window from the AX
    API (System Events reported 0 windows for every app) and denied activation. The `computer`
    harness also had no capture, input or AX permission. Verification therefore uses the stdin
    hook, `screencapture -l` and `CGEventPostToPid` key events posted to the app only, with no
    pointer movement and no global typing.
11. **Not covered.** A real right-click, a mouse click on a header, the tray icon itself (the
    status-item window isn't composited while locked), the notification banner, Dock-icon reopen,
    VoiceOver speech, and Windows or Linux builds.

## Accessibility (what Slint exposes to VoiceOver)

From the live AX tree (`docs/evidence/ax-tree-start.txt`, `ax-tray.txt`, read through System
Events while the screen was unlocked):

- **Menu bar and row menu: native.** Every item has a title, enabled state and key equivalent,
  because they are real NSMenus. The macOS View menu also gains the system's "Show Tab Bar" and
  "Enter Full Screen".
- **Buttons and notices are labelled.** Buttons appear as `AXButton` with their text, or with
  their `accessible-label` (for example "Dismiss Update available: 0.2.0"). A notice is an
  `AXGroup` titled by its label, and text appears as `AXStaticText`.
- **The table is weak.**
  - `StandardTableView` is an `AXTable` titled "Sessions", but its children are flat:
    - 4 `AXStaticText` column headers, which are not buttons, so sorting is not operable through
      AX;
    - an `AXList` of 20 `AXStaticText` cells, with no `AXRow` or `AXCell` and no
      row/column index.
  - The selected row is not marked `AXSelected`.
  - VoiceOver would read the cells as one long list with no table navigation
    **[INFERENCE from the AX roles; speech not recorded]**.
  - This is the largest WCAG 2.2 AA gap (1.3.1 Info and Relationships, 4.1.2 Name, Role, Value).
    A custom table built from `accessible-role` items would be needed.
- **The tray icon has no name.** It is an `AXMenuExtra` with an empty title and description; only
  `AXHelp` carries the tooltip, so VoiceOver may announce only "status menu".
- **The progress bar and status text are present**, as a Slint `ProgressIndicator` with
  `accessible-label`. Slint has no live-region equivalent, so phase changes are not announced.

## Licence (Slint vs PlateVault's AGPL-3.0-only)

Slint is licensed `GPL-3.0-only OR LicenseRef-Slint-Royalty-free-2.0 OR LicenseRef-Slint-Software-3.0`
(`slint-1.18.1/Cargo.toml`, texts in `slint-1.18.1/LICENSES/`).

- **GPL-3.0-only: compatible, and the recommended path.** GPL-3.0 §13 explicitly permits linking
  or combining a GPL-3.0 work with an AGPL-3.0 work and conveying the result. The GPL terms apply to
  the Slint part and the AGPL terms to PlateVault's code. Both are v3, so the "only" suffix is no
  obstacle. This spike's workspace is `AGPL-3.0-only` on that basis.
- **Royalty-free 2.0: usable, but adds conditions** (from `LicenseRef-Slint-Royalty-free-2.0.md`):
  - It covers desktop, mobile and web apps (§1), and excludes embedded systems (§3).
  - Attribution is required (§2): either the `AboutSlint` widget in an About dialog reachable
    from the top-level menu, or the "Made with Slint" badge on a public download page.
  - Distributing an application that "exposes the APIs" of Slint is forbidden (§3). That would
    matter if PlateVault ever offered Slint-based UI plugins or scripting.
  - It is not an OSI licence, and its limits would sit on top of the AGPL. Downstream recipients
    can still use Slint under the GPL option, so nothing is lost by choosing GPL
    **[INFERENCE; not legal advice]**.
  - It only matters if PlateVault wanted a non-copyleft or app-store channel, which PlateVault's
    own AGPL already constrains.
- **Slint Software License 3.0** is the paid licence (§2(a) Paid License Plan, per-seat). It is
  needed only for embedded use or proprietary distribution without attribution, so it is
  irrelevant to PlateVault.

## How it was verified

- `cargo build --release` and `cargo test`: 14 unit tests pass. `cargo clippy` reports no
  warnings.
- While the screen was unlocked: the AX dumps of the menu bar and window, and AX presses on
  View › Toggle theme.
- After the lock: `scripts/drive.sh main|folder|about` produced the screenshots in
  `docs/screenshots/` and the logs in `docs/evidence/drive-*.log`.
  - The native menu was driven with key events posted to the process (Down/Return/Escape).
  - The Rename dialog was submitted with Return in its `LineEdit`, after the text was set
    through the hook.
- Move to Trash moved a fixture folder made by `scripts/make-fixture.sh` into the user's Trash.
