# R9 spike: Tauri 2 + web UI + Rust core (bead astro-plan-29lpg)

Copied from the throwaway spike repo /Users/sjors/tmp/platevault-spikes/tauri-native (commit 68239fc, not in this repository).

# PlateVault UI-stack spike: Tauri 2 + Rust core + web UI

This is a throwaway spike for the `d-ui-stack` decision (bead `astro-plan-29lpg`). It implements
the shared spike spec using a framework-agnostic Rust core (`crates/spike-core`), a thin Tauri 2
shell (`src-tauri`) and a React 19 + Fluent UI v9 frontend (`src/`).

## Run

```sh
pnpm install
pnpm tauri build                 # release .app + .dmg in target/release/bundle/
open "target/release/bundle/macos/PlateVault spike.app"
cargo test -p spike-core         # 10 core unit tests (scan, library, index, update)
```

Environment variables (all optional):

| Variable | Effect |
|---|---|
| `SPIKE_UI_LOOK=windows\|macos` | Forces the token theme for one OS on another OS (comparison only) |
| `SPIKE_THEME=dark\|light` | Pins the window appearance at launch. Otherwise the window follows the system |
| `SPIKE_UPDATE_MANIFEST=/path.json` | Uses this manifest instead of the bundled `mock-release.json` |
| `SPIKE_DIALOG_DIR=/path` | Sets the folder the first Open folder… dialog starts in (test hook) |
| `SPIKE_PASSIVE=1` | Launches without taking keyboard focus and floats the window (measurement hook, see friction) |
| `SPIKE_EXIT_AFTER_PAINT=1` | Prints `SPIKE_METRIC first_paint …` and quits (cold-start runs) |

Test harness: `pnpm tauri build --debug --features dev-tools --config src-tauri/tauri.dev-tools.conf.json`
embeds `tauri-plugin-mcp-bridge`, bound to 127.0.0.1 only, so the Tauri MCP server can drive and
snapshot the webview. `scripts/ax.sh` drives native menus through the macOS accessibility API. Neither
tool moves the pointer or types. `scripts/metrics.sh` produces the numbers below.

## What maps to the spec

| Spec item | Where | Evidence |
|---|---|---|
| Window "PlateVault spike", menu bar: File › Open folder…, Quit; View › Toggle theme; Help › About | `src-tauri/src/shell.rs` (Tauri `menu` API, muda) | `docs/evidence/ax-menus.txt` is the AX dump of the live menu bar, with ⌘O and ⌘⇧L accelerators. macOS also gets the app menu, an Edit menu (needed for ⌘C/⌘V in text fields) and system-added items |
| Sessions table from Rust `scan(dir)`, sortable headers | `crates/spike-core/src/scan.rs`; Fluent `DataGrid` in `src/SessionsTable.tsx` | `docs/screenshots/macos-look-light-window.png` (real window, Night sorted descending) |
| Per-row action menu: Open, Rename, Move to Trash | `src/ui/RowActions.tsx`: an OS-drawn `NSMenu` (Win32 popup menu on Windows) via `@tauri-apps/api/menu`, opened from the ••• button or by right-clicking the row | `index-progress-and-native-row-menu.png` shows the native menu; Open and Trash are disabled on sample rows |
| Native folder dialog → `scan` | `shell.rs` `pick_and_scan_folder` (tauri-plugin-dialog → NSOpenPanel sheet) | `open-folder-dialog.png`. **Not exercised end to end**: the panel's buttons are not in the app's AX tree (remote view service), and pressing Open would have needed real input. `scan` itself is covered by unit tests |
| Tray icon: Show, Quit | `shell.rs` `install_tray` | The AX dump lists the status item. Closing the window hides it; Show and the Dock icon restore it |
| Rust `index()` 0..100 over ~5 s, Cancel, OS notification | `crates/spike-core/src/index.rs`; `commands.rs` `start_index` streams over a Tauri `Channel` | `index-progress-and-native-row-menu.png` (19 %), `index-cancelled.png`; log lines `[spike] index Completed` / `Cancelled` |
| OS notification when indexing finishes | `tauri-plugin-notification`, called from Rust | macOS showed its first-use permission request, "“PlateVault spike” Notifications" (read from the Notification Center AX tree). Permission was not granted on the user's behalf, so the banner itself was not seen |
| Backend-owned update check pushing "Update available" | `crates/spike-core/src/update.rs`: self_update 1.3 `manifest` backend with an injected `file://` transport, run off the main thread at startup, stored in state, emitted as `update-available` | Log `[spike] update available: 0.2.0 (running 0.1.0)` and the Fluent `MessageBar` in every screenshot |
| Follows system dark/light; Toggle theme | `app.set_theme()` in Rust → the webview's `prefers-color-scheme` follows the window appearance | `macos-look-dark-webview.png` after View › Toggle theme was pressed through AX |
| Windows and macOS looks | `src/ui/themes.ts` (token themes); `SPIKE_UI_LOOK` | `windows-look-light-webview.png`, `macos-look-*`. Optional finding only, see below |
| Move to Trash confirmation | `commands.rs` `trash_session`: an OS-drawn alert (NSAlert sheet) with platform button order, then the `trash` crate | Code path only; not screenshotted |

## Metrics (macOS 26.7.1, Apple Silicon, release build, sccache disabled)

| Metric | Value | Notes |
|---|---|---|
| Release `.app` bundle | 4.9 MB (4,976 KB) | Binary 4.8 MB (LTO, `opt-level="s"`, stripped). Frontend `dist/` 580 KB, embedded in the binary |
| `.dmg` | 2.6 MB | `pnpm tauri build` default UDZO |
| Cold start → first content paint | First launch 1,533 ms; warm median 489 ms (runs 2–6: 488, 481, 516, 511, 489) | Wall clock from exec to the UI's `first_paint` IPC after the table has rendered (2× rAF). Run 1 is the first launch after the build, not a post-`purge` cold start |
| Idle memory (10 s after launch) | Main 100 MB RSS (28 MB phys_footprint) + WebKit XPC 113 MB RSS (WebContent 65, GPU 33, Networking 15) | RSS double-counts shared system frameworks. phys_footprint is the figure Activity Monitor shows for the main process |
| Clean release build | 138 s | `cargo clean` + `pnpm tauri build` (tsc + vite + cargo + bundle). `RUSTC_WRAPPER=""` disables sccache; `jobs=6` comes from the user's cargo config. Other agents were building concurrently |
| Incremental release build | 77 s (touch a Rust file), 66 s (touch a TSX file) | Dominated by the fat-LTO + `codegen-units=1` relink. Debug dev-tools rebuilds after small edits took 17–29 s, measured as wall time of whole build commands |
| LOC (code lines, no blanks/comments) | UI 476 + OS seam 161; Rust bridge 424; core 471 (incl. 10 unit tests) | `src/`, `src/ui/`, `src-tauri/src/`, `crates/spike-core/src/` |
| Accessibility | Native menu bar and row NSMenu exposed to AX (see `docs/evidence/ax-menus.txt`); Fluent grid with ARIA roles | VoiceOver speech was not recorded |

Raw output: `metrics/raw/metrics.txt` (gitignored). Rerun with `scripts/metrics.sh`.

## Dependencies added (and why)

- `tauri` 2.12 (`tray-icon`), `tauri-plugin-dialog`, `tauri-plugin-notification` and `tauri-plugin-opener` provide the OS surfaces the spec names. These are the same plugins the product already uses.
- `self_update` 1.3 (`manifest`, `ureq`, `rustls`; no default features) runs the backend update check. Its `manifest` backend reads a static JSON release list. The crate will not compile without an HTTP client feature, so the spike injects a `file://` transport through its `HttpClient` seam instead of running a server.
- `trash` 5.2 handles Move to Trash. On macOS it uses the NSFileManager method, because the default Finder-scripting method raises an Automation consent prompt.
- `@fluentui/react-components` 9.74 and `@fluentui/react-icons` provide the UI kit. `react` 19, `vite` 8 and `typescript` 7 are the toolchain.
- `tauri-plugin-mcp-bridge` 0.11 is an optional test harness behind the `dev-tools` feature and is never in the measured build.

## Findings

1. **No maintained macOS-styled React kit exists.** The last releases on npm are: react-desktop 0.3.9 (2019-02), Photon 0.1.2 (2016-12), Puppertino 1.5.1 (2021-04) and react-macos 1.0.0 (2018-07). Konsta UI is maintained (5.5.0, 2026-09) but targets iOS/Material mobile and has no data table or desktop menus. The macOS "look" is therefore Fluent with macOS tokens: SF system font at 13 px, Apple accent ramp, 6 px radii, macOS surfaces and 24 px rows. *Optional finding; per-OS control looks were dropped on 2026-10-12.*
2. **Tauri owns the OS-drawn surfaces outright.** Rust builds the menu bar, tray, folder dialog, alerts and notifications, and the UI never needs a dialog or notification permission. The JS menu API also pops real NSMenus at a position, which gives native context menus with the web kit unchanged.
3. **The Rust bridge is small.** 9 commands, 3 events and 1 `Channel` stream come to about 420 lines, menu/tray/dialog wiring included. The core crate has no Tauri dependency, so FRB or gRPC could sit on top of it unchanged.
4. **Backend-owned updates are framework-independent.** The check, its state and the push all live in Rust, and the UI only renders a notice. self_update's apply step replaces a single binary, so a `.app`/MSI bundle would still need tauri-plugin-updater or cargo-packager-updater for signed whole-bundle swaps [INFERENCE from self_update's bundle-mode docs; not exercised].

## Friction notes

- **WebKit grid bug.** A `grid-template-rows: auto auto 1fr auto` shell, with a notice row that appears after first paint (`:empty`→`display:none` toggling), kept stale track sizes in the real window: the table collapsed to 0 px. Snapshots taken through the MCP bridge looked correct, which hid the bug. Switching to a flex column fixed it.
- **Occluded windows don't paint.** WKWebView skips rendering and `requestAnimationFrame` while the window is covered. A background launch reported its "first paint" 112 s late, only when a snapshot forced a render. Window screenshots of covered windows show stale or partial frames. `SPIKE_PASSIVE=1` (`Builder::activate_ignoring_other_apps(false)` plus always-on-top) keeps the window painting without taking keyboard focus.
- **macOS requires the menu shape:** the first submenu becomes the app menu; an Edit menu is needed for clipboard shortcuts in inputs; macOS injects AutoFill, Dictation, Emoji and Enter Full Screen into "Edit"/"View". There is no Window menu unless you build one.
- **Web defaults to undo:** the WebKit context menu (Reload / Inspect), the pointer cursor on buttons, text selection on chrome and rubber-band overscroll (`src/main.tsx`, `src/styles.css`).
- **Event race:** an event emitted before the webview listens is lost. The update result is therefore kept in Rust state and the UI pulls it after subscribing.
- **Notifications:** dev runs (`tauri dev`) post as Terminal. Bundled builds trigger the OS permission request on first use, which must be planned into onboarding.
- **The folder panel is remote:** NSOpenPanel content is not in the app's AX tree, so UI automation cannot confirm it. E2E tests need a dialog seam or a scan command.
- **Fluent bundle weight:** 651 kB JS (186 kB gzip) for this small UI. Segoe UI is absent on macOS, so the forced Windows look falls back to SF.
- **CSP vs the test harness:** the MCP bridge's injected helpers need CSP off, which only the `dev-tools` config overlay does.
- **Not captured:** the Windows look in dark mode, tray menu and About-panel screenshots, and VoiceOver speech. Window screenshots were limited to the app's own window because the desktop was in active use, and the agent had no input permission.

## Accessibility (VoiceOver-relevant AX)

The menu bar is native: every item, enabled state and accelerator appears in `docs/evidence/ax-menus.txt`. The row menu is a native NSMenu. The table is a Fluent `DataGrid` with role=grid, `aria-label="Sessions"`, `aria-sort` on sortable headers, and row buttons labelled "Actions for <session>". The status bar uses a polite live region that announces phase changes only, not every percent. The webview AX tree dump timed out with System Events at depth 14, so the grid roles are asserted from the DOM, not from VoiceOver output.
