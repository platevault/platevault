# R9 spike: Flutter desktop + flutter_rust_bridge + Rust core (bead astro-plan-rfxtf)

Copied from the throwaway spike repo /Users/sjors/tmp/platevault-spikes/flutter-frb (commit 0f7b110c, not in this repository). Built without Xcode (Command Line Tools only).

# PlateVault UI-stack spike: Flutter desktop + flutter_rust_bridge

A throwaway spike for decision `d-ui-stack` (bead `astro-plan-rfxtf`). It implements the
shared spike spec with Flutter 3.47.7 (stable) on macOS, a Rust core crate behind
flutter_rust_bridge 2.13.0, and two widget sets: macos_ui (macOS look) and fluent_ui
(Windows look), picked by OS or forced with `SPIKE_LOOK=windows|macos`.

> On 2026-10-12 the user dropped per-OS control looks: "native" now means OS-drawn
> surfaces and platform conventions only. Both looks are kept as built; neither got
> further work.

**This machine has no Xcode (Command Line Tools only), so `flutter build macos` cannot
run.** `tool/build_macos_clt.sh` builds the same app by hand with the CLT: `flutter
assemble`, then `swiftc` for the Swift plugins and runner. Every runtime number below
comes from that bundle. Numbers that need Xcode are marked NOT MEASURED.

## Run

```sh
mise install flutter@3.47.7                     # SDK install only; no global config change
cargo binstall --root .tools flutter_rust_bridge_codegen@2.13.0
PATH=$PWD/.tools/bin:$PATH mise exec flutter@3.47.7 -- flutter_rust_bridge_codegen generate
(cd rust && cargo test)                         # Rust core: scan, update check (3 tests)
cargo build --release --manifest-path rust/Cargo.toml
SPIKE_UPDATE_MANIFEST=$PWD/assets/mock-release.json \
  mise exec flutter@3.47.7 -- flutter test      # FRB bridge (7) + look goldens (9)
tool/build_macos_clt.sh                         # -> build/clt/PlateVault spike.app
open "build/clt/PlateVault spike.app"           # SPIKE_LOOK=windows for the fluent look
python3 tool/measure.py [--builds]              # metrics/metrics.json, metrics/*.log, screenshots/
```

With Xcode installed, `mise exec flutter@3.47.7 -- flutter build macos --release` is the
normal path. It uses `macos/Runner` and cargokit (`rust_builder/`). That path is NOT
VERIFIED here.

## What it does and how each spec item was checked

| Spec item | Implementation | Evidence |
|---|---|---|
| Window "PlateVault spike" + OS menu bar (File › Open folder…, Quit; View › Toggle theme; Help › About) | `PlatformMenuBar` (native NSMenu) built from one menu model (`lib/app_menus.dart`); fluent look also draws an in-window `MenuBar` from the same model | `metrics/drive-macos-menus.log`: the NSMenu dump shows `Open folder… ⌘O`, `Quit`, `Toggle theme ⌘⇧T`, `About`. The driver ran the native items: Toggle theme → `screenshots/macos-dark.png`; About → `macos-about-dialog.png` |
| Sessions table from Rust `scan(dir)`, sortable headers, per-row menu (Open, Rename, Move to Trash) | `rust/src/api/library.rs`; `lib/sessions_table.dart`; row menu is `MacosPulldownButton` / fluent `DropDownButton`; right-click opens an **OS-drawn** NSMenu via nativeapi (`lib/native_menu.dart`) | goldens `test/goldens/*_row_menu.png`; widget tests sort by Frames and trash a row; bridge test scans a real temp folder. The right-click NSMenu was NOT exercised (no input permission) |
| Native folder dialog → `scan` | `file_selector` `getDirectoryPath(confirmButtonText: 'Scan')` | the driver ran File › Open folder…: a native NSOpenPanel sheet with Cancel/Scan appeared. The screenshot was deleted because it showed the user's Documents folder |
| Tray icon with Show / Quit | `tray_manager` 0.8 native API (nativeapi FFI); Show = `window_manager.show/focus`, Quit = `exitApplication` | menu dump lists a visible `NSStatusBarWindow "Item-0"`. Capturing it failed (`could not create image from window`, off-screen coordinates). Clicking it was NOT exercised |
| Rust `index()` with progress 0..100 over ~5 s, Cancel, notification on finish | `IndexJob` (opaque) with `run(StreamSink)` + `cancel()`; `flutter_local_notifications` on finish | bridge tests: 101 running events then `finished` in >4 s; cancel ends with `cancelled` before 100; a second run errors. `screenshots/windows-look-light-indexing.png` shows 41%. `drive-macos-update-index.log`: delivered notification "Indexing finished — 8 sessions indexed." |
| Backend-owned update check pushing an event | Rust `watch_updates(StreamSink)` uses the `self_update` 1.3 **manifest** backend with a `file://` `HttpClient` (`rust/src/file_client.rs`), manifest in `Contents/Resources` or `SPIKE_UPDATE_MANIFEST` | Rust + bridge tests return 0.2.0. In the app: macOS look shows an alert (`macos-update-alert-and-indexing.png`); Windows look shows an `InfoBar` |
| System dark/light + both looks | `ThemeMode.system`, toggled by View › Toggle theme; `SPIKE_LOOK` | `macos-light/dark.png`, `windows-look-light-indexing/dark.png`, goldens for both looks in light and dark |

## Metrics (macOS 26.7.1, arm64; CLT build; other agents were building in parallel)

| Metric | Value | Notes |
|---|---|---|
| Release bundle size | **27.0 MiB** `.app`, **11.9 MiB** DMG (UDZO) | FlutterMacOS 14.8 MiB (arm64 only, thinned by `flutter assemble`), App.framework (Dart AOT + assets) 6.3 MiB, Rust core 3.7 MiB (unstripped, no LTO), cnativeapi 1.1 MiB, runner + static plugins 0.8 MiB. A universal Xcode build is larger: NOT MEASURED |
| Cold start → first rasterized frame | **510 ms** first run after a fresh build; **~512 ms** median of 5 relaunches (473–554 ms); an earlier clean run measured 1921 ms first, then 414–445 ms | from `exec` to `waitUntilFirstFrameRasterized`, `SPIKE_LAUNCH_NS` hook |
| Idle RSS | **152.7 MiB** after 15 s idle | `ps -o rss`, macOS look, sample data |
| Clean build | **100.5 s** in total (Rust release alone 25.0 s) | no sccache (`RUSTC_WRAPPER=`). Excludes the SDK download (2.3 GB) and `pub get`. Swift plugin compile was about 60% of the time |
| Incremental build | **45.0 s** after a Dart edit; **41.2 s** after a Rust edit | the CLT script recompiles every Swift plugin each run, so these numbers are pessimistic. Xcode incremental: NOT MEASURED |
| Hot reload with Rust | NOT MEASURED | `flutter run -d macos` needs Xcode |
| LOC: UI (Dart) | **1093** | both looks 481, shared table/menus/controller/desktop 612 |
| LOC: bridge/core (Rust, hand-written) | **272** (incl. tests) | + **1901** generated (`frb_generated.*`) |
| LOC: tests / CLT tooling | 240 / 429 | |
| Accessibility (VoiceOver) | NOT MEASURED | the `computer` helper has AX, capture and input permission denied, and Accessibility Inspector ships only with Xcode. The code exposes `SemanticsRole.table/row/cell/columnHeader`, labelled sort headers ("Frames, sorted ascending") and "Actions for <session>" labels; the menus are native NSMenus |

Raw data: `metrics/metrics.json`, `metrics/drive-*.log`.

## Dependencies added (all named in the brief unless noted)

Rust: `flutter_rust_bridge =2.13.0`, `anyhow` (FRB error type), `self_update 1.3` (no
default features; `manifest`, `ureq`, `rustls`). Same configuration as the Tauri spike.
Dart: `flutter_rust_bridge`, `macos_ui 2.2.2`, `fluent_ui 4.16.1`, `file_selector 1.1.0`,
`tray_manager 0.8.0`, `flutter_local_notifications 22.3.2`, `window_manager 0.5.2` (Show
for the tray; not in the brief), `cupertino_icons` (macos_ui needs CupertinoIcons but does
not depend on the package). Tools: `flutter_rust_bridge_codegen` in `.tools/` (local).

## Friction notes

- **Xcode is mandatory for the official path.** `flutter doctor`: "Xcode installation is
  incomplete". `flutter build macos` and `flutter run` need xcodebuild, ibtool (for
  MainMenu.xib) and actool. FRB's `rust_builder` ships only a **podspec** (cargokit
  runs as a CocoaPods script phase), so CocoaPods is required even though Flutter 3.47
  defaults to SwiftPM. The CLT workaround worked but has these gaps:
  - FlutterMenuPlugin takes the standard app-menu items (About, Hide, Quit) from the
    nib, so without MainMenu.xib the app menu holds only separators;
  - Driver code placed after `super.applicationDidFinishLaunching` in the FlutterAppDelegate subclass never ran; it runs when placed before that call. Cause not investigated;
  - no sandbox entitlements, ad-hoc signature.
- **FRB codegen** (6 s incremental) is smooth. Notes:
  - `u64` becomes `BigInt` in Dart;
  - it scans the whole crate and logs skips for private unit structs;
  - **a stream function's `Err` is dropped as an unhandled Dart async error**: the
    generated wrapper is `unawaited(...)`. Errors must go through `sink.add_error`;
  - the generated template `integration_test` and `test_driver` had to be deleted.
- **macos_ui 2.2.2** (last release 2025-10-19):
  - no table or banner widgets; the update notice became an alert;
  - the window is transparent because it relies on a native NSVisualEffectView, so
    headless goldens render black without a stand-in background;
  - it creates a hidden `NSColorPanel` at launch;
  - `MacosPulldownButton` overflows a 48 px cell;
  - pulldown menu text ignores the loaded test font in goldens (boxes).
- **fluent_ui** has no data grid either. Neither kit has a table, so the table is
  custom in both looks.
- **Window delegate clash** [INFERENCE]: both `macos_window_utils` and `window_manager`
  assign `NSWindow.delegate`, and the last one wins. No visible breakage in the spike.
- **tray_manager 0.8.0** (released 2026-10-08) moved to `nativeapi`, a C++ core built by a
  Dart native-assets hook. It built with the CLT alone. nativeapi also offers file
  dialogs, notifications, windows and context menus, so one FFI library could replace
  four plugins (not evaluated).
- **Notifications:** requesting permission during `initialize` blocked startup until the
  prompt was answered, so the first frame never came. The request now runs after the
  first frame. Authorization showed as *denied* (1), but the notification still appears
  in the delivered list.
- **No Accessibility or input permission** for automation, so `tool/macos-clt/Driver.swift`
  performs native menu items in-process and captures windows with `screencapture -l`.
  `SPIKE_DEMO=index` starts indexing. Clicks on the tray, the right-click menu and
  widgets are NOT exercised.
- `flutter_test` defaults to Android, so `PlatformProvidedMenuItem` throws in tests.
  The goldens run under `TargetPlatformVariant.only(macOS)` with the menu and
  accent-colour channels mocked.
