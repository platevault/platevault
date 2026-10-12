# R9 — Which desktop services the Rust backend can own (bead astro-plan-kver6)

## Scope

Every desktop integration PlateVault ships or plans, mapped to the owner that can hold it under each UI option:
- **Tauri webview** (today);
- **Flutter** via flutter_rust_bridge (FRB);
- **an OS-native web kit** (Fluent/macOS-style CSS components) inside Tauri.

## Notation

- `R:<crate>-<ver>/<path>:<lines>` cites crate source unpacked under `~/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/`.
- `PV:<path>:<lines>` cites the PlateVault main checkout at `/Users/sjors/personal/dev/platevault`, read 2026-10-12.
- **[INFERENCE]** marks my reasoning, not something observed in a source.

## Crate versions

The locked column is the version in PlateVault's Cargo.lock, or the version I read for crates PlateVault doesn't use. The latest column comes from the crates.io API, fetched 2026-10-12.

| crate | locked / read | latest (last update) |
|---|---|---|
| tauri | 2.11.5 | — |
| tauri-plugin-updater | 2.10.1 | 2.13.3 (2026-10-10) |
| tauri-plugin-single-instance | 2.4.3 | 2.5.3 (2026-10-10) |
| tauri-plugin-deep-link | read 2.6.1 (not used) | 2.6.1 (2026-10-01) |
| tauri-plugin-autostart | read 2.7.0 (not used) | 2.7.0 (2026-10-01) |
| self_update | read 1.3.0 (not used) | 1.3.0 (2026-09-02); MSRV 1.88 |
| cargo-packager-updater | read 0.2.3 (not used) | 0.2.3 (2025-07-21); no release for about 15 months |
| notify-rust | 4.18.0 (via tauri-plugin-notification) | 4.18.2 (2026-10-07) |
| mac-notification-sys | 0.6.15 | 0.6.15 (2026-06-16) |
| tauri-winrt-notification | 0.7.3 | 0.8.1 (2026-07-17) |
| rfd | 0.16.0 (via tauri-plugin-dialog 2.7.2) | 0.17.2 (2026-01-12) |
| muda | 0.19.3 (via tauri) | 0.21.2 (2026-10-08) |
| tray-icon | 0.24.1 (via tauri) | 0.26.1 (2026-10-07) |
| single-instance | read 0.3.3 (not used) | 0.3.3 (2021-12-16); unmaintained |
| notify / notify-debouncer-full | 8.2.0 / 0.7.0 | 8.2.0 (2026-08-30) |
| opener | read 0.9.0 (not used) | 0.9.0 (2026-09-29) |
| auto-launch | read 0.6.0 (not used) | 0.6.0 (2026-01-10) |
| irondash_engine_context / irondash_run_loop | not used | 0.7.0-dev.0 (2026-08-05) |

I didn't diff the newer muda, tray-icon and rfd releases. Their module docs state the same threading rules. **[INFERENCE: the rules are unchanged.]**

---

## 1. Who owns the event loop under each UI option

This is the constraint behind every row in §2.

### Tauri (webview, and the native-kit variant)

- tao/wry owns the process main thread from `App::run` (PV:apps/desktop/src-tauri/src/main.rs:38-46,132).
- Backend code runs on tokio and moves work onto the main thread with `AppHandle::run_on_main_thread` (R:tauri-2.11.5/src/app.rs:494-499).
- Tauri's own menu and tray are thin wrappers over muda and tray-icon that make exactly this move (R:tauri-2.11.5/Cargo.toml:344-355; src/tray/mod.rs:363-366,504-640).
- Result: hosting a backend service costs nothing extra.

### Flutter + FRB

The runner owns the main thread:
- **Windows:** `wWinMain` creates the HWND and runs a plain `GetMessage/TranslateMessage/DispatchMessage` loop (flutter/flutter `packages/flutter_tools/templates/app/windows.tmpl/runner/main.cpp.tmpl` @416d09af).
- **macOS:** `FlutterAppDelegate` plus the template `MainMenu.xib` (`.../macos.tmpl/Runner/AppDelegate.swift`, `.../Base.lproj/MainMenu.xib`).
- **Linux:** GTK.

Rust code called over FRB never runs on that thread:
- The engine docs say "Interacting with the engine in any way must happen on the platform thread". On desktop, the UI, raster and IO threads are separate from the platform thread (https://github.com/flutter/flutter/blob/master/docs/about/The-Engine-architecture.md, "Platform Task Runner" and "Current Platform Specific Threading Configurations").
- FRB's default executor "creates an internal thread pool, and each call to a Rust function is executed in a different thread" (https://docs.rs/flutter_rust_bridge/2.13.0/flutter_rust_bridge/handler/struct.SimpleExecutor.html).

So any Rust code that needs the main thread or a window handle needs a bridge into the runner. Two options:
- `irondash_run_loop` ("platform-independent interface to system run loop") plus `irondash_engine_context` ("access to FlutterView … for FFI"). super_native_extensions, the Rust core behind `super_drag_and_drop` and `super_context_menu`, uses both (superlistapp/super_native_extensions `super_native_extensions/rust/Cargo.toml`).
- Hand-written runner code in C++ or Swift.

### OS-native web kit inside Tauri

- The host is the same as the Tauri column; the kit only changes DOM components.
- One relevant difference: a kit's in-DOM context menu competes with the native `Menu.popup` that Tauri already exposes to JS (R:tauri-2.11.5/src/menu/plugin.rs:667-708).
- Below, "Tauri" covers this option too.

## 2. Capability matrix

The **Backend-ownable** column answers: can this live in a framework-agnostic Rust services crate?
- **Yes:** no main thread, window handle or event loop is needed.
- **Split:** the logic and state can be backend-owned, but one step needs the host.
- **Host:** it belongs to whoever owns the window or event loop.

| # | Capability | Backend-ownable | OS constraints (main thread, event loop, handles, identity) | Tauri webview / native-kit hosting | Flutter + FRB hosting | Maturity / notes |
|---|---|---|---|---|---|---|
| 1 | **Self-update: check, download, verify** | **Yes** | Network and signature verification only; no thread constraint. | **Frontend-driven today:** `updateSubscription.ts` calls JS `check()` and `relaunch()` (PV:apps/desktop/src/data/updateSubscription.ts:7-16,97-148; PV:src-tauri/src/lib.rs:248-254). The Rust API `UpdaterExt::updater()` already exists (R:tauri-plugin-updater-2.10.1/src/lib.rs:33-117), so Rust can own the check with no new dependency. | `tauri-plugin-updater` can't be used: its builder needs `AppHandle<R: Runtime>` (R:tauri-plugin-updater-2.10.1/src/updater.rs:157-161). Use `cargo-packager-updater` or `self_update` instead. | See §3. |
| 2 | **Self-update: install and swap** | **Split** | **macOS:** swap the whole `.app` from `.app.tar.gz`; if not writable, elevate through AppleScript. Tauri runs that script on the main thread through the AppHandle (R:tauri-plugin-updater-2.10.1/src/updater.rs:1217-1290). cargo-packager-updater shells out to `osascript` and needs no main thread (R:cargo-packager-updater-0.2.3/src/lib.rs:1070-1079).<br>**Windows:** `ShellExecuteW` the NSIS/MSI installer, then `std::process::exit(0)` (R:tauri-plugin-updater-2.10.1/src/updater.rs:787-866). That hard exit is why the host has to be told first (`on_before_exit`, :288-291). | Plugin as today. The host contributes an `on_before_exit` hook that flushes window state. | The services crate does the swap. The host must offer "prepare to exit" (flush window_manager state, stop the engine) before the Windows installer exits the process. | — |
| 3 | **Relaunch** | **Yes**, at process level, with a host shutdown handshake | Spawn plus exit. `tauri::process::restart` spawns `current_binary`, exits, and on macOS re-reads `Info.plist` in case the binary was renamed (R:tauri-2.11.5/src/process.rs:74-128). `self_update::restart` uses `exec` on unix and spawn+exit on Windows (R:self_update-1.3.0/src/lib.rs:436-444). **[INFERENCE]** `exec` skips host cleanup, so call it only after the host has shut down. | `tauri-plugin-process` → `AppHandle::request_restart`, which runs exit handlers (R:tauri-plugin-process-2.3.1/src/commands.rs:12-15). | Services crate exposes `restart()`; Dart awaits graceful shutdown first. | — |
| 4 | **OS notifications (show)** | **Yes**, given an app identity | `tauri-plugin-notification`'s desktop backend **is notify-rust**: it builds `notify_rust::Notification`, sets the identity, and shows it on a spawned task (R:tauri-plugin-notification-2.3.3/src/desktop.rs:179-217). Showing a notification needs no event loop.<br>**macOS identity:** without `set_application`, mac-notification-sys falls back to a looked-up default bundle (R:mac-notification-sys-0.6.15/src/lib.rs:132-150). So delivery works, but correct attribution needs the real bundle id. Tauri passes `com.apple.Terminal` in dev, when the binary is unbundled (desktop.rs:207-213). The default backend is `NSUserNotificationCenter` (R:notify-rust-4.18.0/src/macos/mod.rs:1-18). The `UNUserNotificationCenter` backend is an opt-in preview that panics without a bundle id or authorisation (src/macos/unusernotifications.rs:33-34).<br>**Windows identity:** without an AppUserModelID, toasts fall back to `POWERSHELL_APP_ID` and "erroneously report its origin as powershell" (R:tauri-winrt-notification-0.7.3/src/lib.rs:327-340; R:notify-rust-4.18.0/src/windows.rs:76-81). Tauri sets `app_id = identifier` except when running from `target/{debug,release}` (desktop.rs:196-205). **[INFERENCE]** The installer must register that AUMID on the Start-menu shortcut. Tauri's NSIS/MSI bundler does this; a Flutter installer must do it explicitly. | Already Rust-driven: `bootstrap::notify` calls `app.notification()` from a tokio subscriber (PV:src-tauri/src/bootstrap/notify.rs:42-49,79-100). | notify-rust directly from the services crate. **[INFERENCE]** `flutter run` builds a real `.app`, so the bundle id exists in dev too. | notify-rust is active. |
| 5 | **Notification click / action callbacks** | **Split** | **macOS:** `wait_for_action` "Requires the main run loop to be running … if nothing is pumping the main run loop this call will block indefinitely" (R:notify-rust-4.18.0/src/macos/nsusernotifications.rs:31-35,70-73).<br>**Windows:** `on_activated` (src/windows.rs:26-31).<br>**Linux:** D-Bus signal (src/xdg/zbus_rs.rs:81-83,236). | Tauri pumps the loop. | The runner pumps NSApp. Bringing the window to the front is a host call. | Unused today (notify.rs:42-49 is fire-and-forget). |
| 6 | **"Is the window focused?"** (notification suppression) | **Host** (it's a query) | Window state. | `get_webview_window(..).is_focused()` (PV:bootstrap/notify.rs:32-34). | `window_manager` (0.5.2, 2026-07-04) or app lifecycle state passed into Rust. | The policy is already pure: `should_notify` and `notification_for` (notify.rs:27-29,108-116). The host passes `focused` in. |
| 7 | **File and folder dialogs** | **Split**: rfd is Rust but needs the main thread and a parent handle | **macOS:** rfd's `run_on_main` runs inline on the main thread; elsewhere it dispatches to the main queue if `NSApp.isRunning`, and otherwise **panics** (R:rfd-0.16.0/src/backend/macos/utils.rs:20-31). The sync fallback must run on the main thread (modal_future.rs:107-118). The docs advise "spawn on main and await in other thread" (src/lib.rs:81-85).<br>**Windows:** IFileDialog runs on an STA COM thread that rfd spawns; the parent `HWND` comes from `RawWindowHandle::Win32` (src/backend/win_cid/utils.rs:17-21; thread_future.rs:26; file_dialog/dialog_ffi.rs:148-170).<br>**Parent window:** `set_parent<W: HasWindowHandle + HasDisplayHandle>` (src/file_dialog.rs:96-99,222-225).<br>**Linux:** xdg-portal by default, GTK3 optional (src/lib.rs:46-60). | `tauri-plugin-dialog` = rfd `AsyncFileDialog` started inside `run_on_main_thread` (R:tauri-plugin-dialog-2.7.2/src/desktop.rs:12,145-211). PlateVault calls `blocking_pick_folder()` **without `set_parent`**, so today's dialogs are unparented (PV:src-tauri/src/commands/native.rs:39-45,75-87). | Dart `file_selector` (1.1.0, 2025-11-21, flutter/packages), or rfd. On macOS rfd works from an FRB thread because NSApp is running. On Windows, a parented dialog needs the HWND from `irondash_engine_context`. | rfd is active. |
| 8 | **OS menu bar** | **Host** (the menu model and action ids can be backend data) | muda: "On macOS, menus can only be used from the main thread, and most functionality will panic" otherwise. "On Windows, accelerators don't work unless the win32 message loop calls `TranslateAcceleratorW`" (R:muda-0.19.3/src/lib.rs:17-22). Setup calls are `init_for_hwnd`, `init_for_nsapp` and `init_for_gtk_window` (lib.rs:97-108). On Windows, `init_for_hwnd` calls `SetWindowSubclass` (src/platform_impl/windows/mod.rs:332-357). Microsoft: "You cannot use the subclassing helper functions to subclass a window across threads" (https://learn.microsoft.com/en-us/windows/win32/api/commctrl/nf-commctrl-setwindowsubclass, Remarks). | Tauri `Menu` = muda on the main thread; PlateVault builds its menu in `setup` (PV:src-tauri/src/lib.rs:298-330). | **macOS:** `PlatformMenuBar` — "Flutter only includes support for macOS out of the box" (https://api.flutter.dev/flutter/widgets/PlatformMenuBar-class.html).<br>**Windows/Linux:** either an in-window Material `MenuBar`, or muda with its init dispatched to the runner thread (cross-thread subclassing is forbidden) **plus** `TranslateAcceleratorW` added to the runner loop. The template loop has only Translate/DispatchMessage.<br>**[INFERENCE]** On macOS, muda's `init_for_nsapp` replaces the main menu that `MainMenu.xib`/`PlatformMenuBar` manage, so use one or the other. | muda is active. |
| 9 | **Context menus** (per-row action menus) | **Host** | muda's `show_context_menu_for_hwnd`, `show_context_menu_for_nsview` and `show_context_menu_for_gtk_window` need the view or HWND and the main thread (R:muda-0.19.3/src/lib.rs:111-142,366-447). | A DOM menu from the kit, or native via `Menu.popup` (R:tauri-2.11.5/src/menu/plugin.rs:667-708). In the native-kit option, a Fluent/macOS DOM menu *looks* native but isn't an OS menu. That's a UI-kit decision, not a backend one. | Flutter `MenuAnchor` (drawn in the canvas), or `super_context_menu` (0.9.1, 2025-06-11), which is Rust through irondash. | — |
| 10 | **Tray / menu-bar icon** | **Host** (backend-ownable on Windows/Linux only via a dedicated thread) | tray-icon: "On Windows and Linux, an event loop must be running on the thread … you have to create the tray icon on the same thread as the event loop. On macOS, an event loop must be running on the main thread … make sure that the event loop is already running" (R:tray-icon-0.24.1/src/lib.rs:17-18). On Windows it creates its own hidden window and re-registers on `TaskbarCreated` (src/platform_impl/windows/mod.rs:50-53,90-143). | Tauri `TrayIconBuilder` builds on the main thread (R:tauri-2.11.5/src/tray/mod.rs:363-366). PlateVault hasn't enabled the `tauri/tray-icon` feature (Cargo.toml:129): the workspace has `default-features = false, features = ["wry"]` (PV:Cargo.toml:81). | `tray_manager` (0.8.0, 2026-10-08). Or tray-icon itself: on Windows on a Rust thread with its own message pump; on macOS dispatched to the main queue. **[INFERENCE]** `system_tray` is stale (2.0.3, 2023-04-19). | — |
| 11 | **Single instance + argv forwarding** | **Yes**; only "focus the existing window" is host work | The Tauri plugin is pure IPC:<br>• Windows: named mutex + hidden window + `WM_COPYDATA` (R:tauri-plugin-single-instance-2.4.3/src/platform_impl/windows.rs:70-94,145).<br>• macOS: Unix socket (macos.rs:23-35,79,101).<br>• Linux: D-Bus name (linux.rs:37-86).<br>The `single-instance` crate only *detects*: no argv/cwd forwarding, last release 2021 (R:single-instance-0.3.3/src/lib.rs:6-8). Forwarding needs a local socket, e.g. `interprocess` 2.4.5.<br>Invariant: a redirected second launch must exit before DB connect/migrate (PV:src-tauri/src/lib.rs:157-162; main.rs:123-128). | Plugin; its callback focuses `main` (PV:lib.rs:178-208). | Rust check at process start, before engine startup or DB work. The focus callback uses `window_manager`. `windows_single_instance` (1.2.0) covers Windows only. | `PV_E2E_INSTANCE_ID` bypass carries over. |
| 12 | **Window state** | **Host** | Needs window move/resize events and monitor geometry. The plugin writes JSON on `RunEvent::Exit` and `CloseRequested`, and clamps to `available_monitors()` (R:tauri-plugin-window-state-2.4.1/src/lib.rs:121-145,194-200,447-506). | Plugin (PV:lib.rs:219-245). | `window_manager` plus a small persistence helper. | Keep host-owned. |
| 13 | **File watching** | **Yes** | The FSEvents backend runs its **own** CFRunLoop thread (R:notify-8.2.0/src/fsevent.rs:460-481). inotify and ReadDirectoryChangesW need no UI thread. | Already backend: `fs_inventory` owns notify and notify-debouncer-full (PV:crates/fs/inventory/Cargo.toml:14-15). The shell forwards a broadcast to `emit("inbox:file-change")` (PV:src-tauri/src/watcher.rs:7-10,83-103). | Same broadcast → FRB `StreamSink`. | Pattern to copy (see §6 on lag). |
| 14 | **Drag and drop (files in)** | **Host** | Needs the native drop target. | `WindowEvent::DragDrop` / `WebviewEvent::DragDrop` carry OS paths (R:tauri-2.11.5/src/app.rs:142-143,203-210). | `desktop_drop` (0.8.4, 2026-09-01) or `super_drag_and_drop` (0.9.1). | Backend receives the paths. |
| 15 | **Deep links / URL schemes** | **Split** | **Registration:** on macOS only at build time, via Info.plist. On Windows (registry) and Linux (`xdg-mime`) it can happen at runtime (R:tauri-plugin-deep-link-2.6.1/src/lib.rs:8-11,141-166,267-371).<br>**Delivery:** on macOS an Apple Event to the app delegate becomes `RunEvent::Opened` (lib.rs:588-592; R:tauri-2.11.5/src/app.rs:263-266); that's host work. On Windows/Linux the URL arrives as argv of a second launch (lib.rs:124-126), so it travels via row 11 (backend). | Plugin. | `app_links` (7.2.2, 2026-10-06) for the macOS delegate. Parsing, routing and Windows/Linux registration in the services crate. | Unused today. |
| 16 | **Autostart** | **Yes** | auto-launch:<br>• macOS: LaunchAgent, AppleScript, or SMAppService (macOS 13+) (R:auto-launch-0.6.0/src/macos.rs:15,33,89-93).<br>• Windows: HKLM, falling back to HKCU `Run`, plus `StartupApproved` (lib.rs:70-74; windows.rs:8).<br>• Linux: XDG or systemd (linux.rs:39-48).<br>**[INFERENCE]** SMAppService needs a signed `.app`. | `tauri-plugin-autostart` wraps auto-launch (R:tauri-plugin-autostart-2.7.0/src/lib.rs:13,223-266) but only exposes LaunchAgent and AppleScript (lib.rs:28-46). | auto-launch from the services crate; `launch_at_startup` (0.5.1) is the Dart alternative. | Unused today. |
| 17 | **Open / reveal in Finder or Explorer** | **Yes** | No UI thread needed.<br>• `tauri-plugin-opener`'s `reveal_item_in_dir` is a free function using NSWorkspace `activateFileViewerSelectingURLs`, `SHOpenFolderAndSelectItems`, or FileManager1 `ShowItems` (R:tauri-plugin-opener-2.5.4/src/reveal_item_in_dir.rs:12,110-131,215-253,289-304). Its open uses `open::that_detached` (src/open.rs:11-12).<br>• `opener` 0.9 `reveal` uses `open -R` / `SHOpenFolderAndSelectItems` / FileManager1 or the portal, falling back to opening the parent folder (R:opener-0.9.0/src/lib.rs:168-177; macos.rs:10-11; windows/reveal.rs:10-42). | Plugin. The domain check `validate_reveal_path` is already backend (PV:src-tauri/src/commands/native.rs:133-188). | `opener` + `open` in the services crate. **[INFERENCE]** opener's built-in fallback would replace PlateVault's hand-written `xdg-open` fallback. | — |
| 18 | **Move to Trash** | **Yes** | `trash` 5.2 (PV:Cargo.toml:118). The Windows Shell trash blocks without an interactive window-station, hence the e2e fake (PV:src-tauri/Cargo.toml, `e2e` feature comment). | Already `app_core`. | Same. | — |
| 19 | **Logging** | **Yes** | A global `tracing` subscriber plus a rolling `tracing-appender` file, set up in `main()` (PV:src-tauri/src/main.rs:46-96). `tauri-plugin-log` runs with `skip_logger()` and only forwards frontend logs (PV:src-tauri/src/lib.rs:266-279). | As today. | Same init; Dart logs go through one FRB fn into `tracing`. The log viewer stream (`log:entry`, PV:src-tauri/src/commands/log.rs:180,277) becomes a `StreamSink`. | — |
| 20 | **E2E automation and agent bridge** (`tauri-plugin-webdriver`, `tauri-plugin-mcp-bridge`) | **Host** | They drive the webview. | Feature-gated (PV:src-tauri/Cargo.toml, `dev-tools` and `e2e`). | Flutter `integration_test` / `flutter_driver`. **[INFERENCE]** Nothing carries over. | — |
| 21 | **Theme follow** | **Host** | Appearance events. | `WindowEvent::ThemeChanged` (R:tauri-2.11.5/src/app.rs:144-146). | `MediaQuery.platformBrightness`. | — |

## 3. Updater options

All three verify signatures before installing.

| | tauri-plugin-updater 2.10.1 (today) | cargo-packager-updater 0.2.3 | self_update 1.3.0 |
|---|---|---|---|
| Framework coupling | Needs `AppHandle<R: Runtime>` (updater.rs:157-161) | None. Authors are CrabNebula and the Tauri Programme (Cargo.toml); the logic mirrors the Tauri plugin | None |
| Signature | minisign (updater.rs:21,1453) | minisign (lib.rs:145,1187) | **zipsign** ed25519 (lib.rs:89,991-1029) |
| Manifest | Tauri `latest.json`; each platform entry is `{url, signature}` (updater.rs:71-77) | Each platform entry also needs `format` (lib.rs:263-271), so tauri-action's `latest.json` needs a post-process step. **[INFERENCE]** | Its own static `manifest.json` (with sha256), GitHub/GitLab/Gitea/Gitee/S3, or a custom `ReleaseSource` (lib.rs:82,136-146,695-708) |
| macOS `.app` | tar.gz bundle swap; AppleScript elevation on the main thread (updater.rs:1217-1290) | Same swap; elevation via an `osascript` subprocess (lib.rs:1070-1079) | Bundle swap with rollback, a `verify_binary` hook for `codesign --verify --deep`, App Translocation detection; **never elevates** (lib.rs:250-299,446-449) |
| Windows | NSIS/MSI via `ShellExecuteW`, then `exit(0)` (updater.rs:787-866) | NSIS and WiX; WiX relaunches via PowerShell `Start-Process` (lib.rs:792-928) | **No installer support**: "hand the downloaded file to … msiexec /i yourself". A directory swap fails if DLLs in it are open (lib.rs:300-304) |
| Linux | AppImage, deb, rpm (updater.rs:968-1178) | AppImage only (lib.rs:934-957) | Binary or directory swap; deb is your job (lib.rs:300-304) |
| Fit with PlateVault's release pipeline | Current: `tauri-action` minisign-signs and uploads `latest.json`, preferring NSIS (PV:.github/workflows/release-please.yml:16-23,144-170) | Same minisign key and pipeline, plus the `format` field | New key and tool (zipsign), new manifest, and a custom NSIS step on Windows |
| Maturity | Active (2.13.3, 2026-10-10) | Last release 2025-07-21; 24k recent downloads | Active; 1.0 shipped 2026-08-28, so the API is new |

### What this means

**If PlateVault stays on Tauri:**
- Keep `tauri-plugin-updater` and drive it from Rust: a startup/periodic task calls `app.updater()?.check()`, downloads and verifies, and publishes the result.
- The UI renders a standard notice and calls one `update_apply` command, which sets `on_before_exit` and then `request_restart`.
- No new dependency and no pipeline change.

**If a framework-agnostic updater is needed** (only when a Flutter host is chosen):
- `cargo-packager-updater` is the drop-in: same minisign key, NSIS installer and bundle swap. Its risk is maintenance (no release for 15 months).
- `self_update` is the better-maintained crate. Adopting it means rotating the signing scheme, which strands already-installed clients unless they get one bridge release, and owning the Windows NSIS step yourself.

## 4. Recommended backend services boundary

### The rule

- One crate, e.g. `crates/desktop/services`.
- Its contract is a dependency rule that Cargo enforces: **no `tauri*`, no FRB, no window-handle types.**
- Extract it only when a second host exists (see §5 verdict). Until then, the same rule applies to modules inside `desktop_shell` that hold no `AppHandle`.

### Public surface

1. **Lifecycle.** `Services::start(Config) -> Services` and `Services::shutdown().await`. Each service owns its tasks and cancels them on shutdown. The host calls `shutdown` from its prepare-exit step.

   `Config` carries the app identity: bundle id or AUMID, version, data dir, updater endpoint and public key.
2. **Commands.** Plain `async fn`s that return typed results. Every user-visible failure is a distinct error variant. The updater keeps today's `check-failed` / `download-failed` / `restart-failed` phases (PV:apps/desktop/src/data/updateSubscription.ts:97-148).
3. **State.** Use a `tokio::sync::watch` latest-value snapshot for anything the UI must not miss, such as `UpdateState` or job progress. A late or lagging subscriber still reads the current value.
4. **Events.** Use `broadcast` only for transient signals, accepting `Lagged` the way `watcher.rs:83-103` already does. Host adapters forward both: Tauri `emit` today, FRB `StreamSink` under Flutter.
5. **Host inputs.** Plain values, not traits: `focused: Option<bool>` for notification suppression, plus argv/cwd from the forwarded second instance.

### The services crate owns

- **Updates:** check, download, verify and stage. It installs only after an explicit user `update_apply`, which keeps today's consent step.
- **Notifications:** the policy (`should_notify` and `notification_for` move as-is) plus notify-rust delivery with the configured identity.
- **Single instance:** the lock and argv/cwd forwarding, run in `main()` before DB connect/migrate.
- **Deep links:** URL parsing and routing, plus Windows/Linux registration.
- **Autostart** (auto-launch).
- **Reveal, open and trash** (opener, open, trash).
- **File watching** (already `fs_inventory`).
- **Logging:** init and the log stream.
- **Relaunch:** the primitive only, called after host shutdown.

### The host adapter owns

- The event loop and windows.
- The menu bar and context menus. Action ids are shared constants; their handlers call service commands.
- The tray.
- Dialogs, with a parent handle.
- Window state.
- Drag-and-drop.
- macOS URL Apple Events. Packaging-time registration also lives here: Info.plist `CFBundleURLTypes`, entitlements, and the AUMID shortcut written by the installer.
- Theme.
- The E2E harness.
- The prepare-exit → `Services::shutdown` → apply/restart handshake.

### What to avoid

- **Don't pull muda, tray-icon or rfd into the services crate.** All three need the host's main thread or HWND/NSView (muda lib.rs:17-22; tray-icon lib.rs:17-18; rfd macos/utils.rs:20-31). Under Tauri, they are what Tauri already uses. Under Flutter, they need irondash or runner edits plus a `TranslateAcceleratorW` patch, duplicating `tray_manager`, `file_selector` and `PlatformMenuBar`.
- **Don't define a `trait DesktopHost` while only one host exists.** **[INFERENCE: YAGNI, per the quality-code-design simplicity guide.]**

### Dependency edge

This bead is `related` to the UI-stack decision beads, not `blocks`. The boundary holds under every option; only the updater crate choice depends on Flutter.

## 5. Debate

### Problem validation

The user's premise is largely true already:
- notifications, file watching, logging, trash and the reveal validation are already Rust-driven (notify.rs, watcher.rs, main.rs, native.rs);
- the real gap is the updater, which is frontend-driven (updateSubscription.ts:7-16).

### Alternatives

1. **Do nothing.** Adequate for the Tauri and native-kit options, except that the updater stays in the frontend.
2. **Simplest viable.** Move update orchestration into Rust (`UpdaterExt`, a `watch` state, and an `update_apply` command), drop `@tauri-apps/plugin-updater` and `@tauri-apps/plugin-process` from the frontend, and keep every plugin. **[INFERENCE: about one day.]**
3. **Extract the services crate.** Do it only when Flutter (or another host) is actually adopted.

### Pros and cons of the services crate

**Pros:**
- **Moderate:** host-independent service tests, without the `tauri::test` mock runtime.
- **Moderate:** one place for app identity.
- **Weak, once the critique is applied:** "Flutter only swaps the adapter." Packaging and runner work remains on top of the adapter.

**Cons:**
- **Major while only one host exists:** a second contract to maintain.
- **Minor:** the `AppHandle`-coupled bits (elevation, focus) need a shim.

### Overengineering check

1. **Would doing nothing work?** It fails only on updater ownership.
2. **Simplest thing that works?** Option 2 above.
3. **What solves a problem we don't have?** The crate extraction, a host trait, and Rust-owned menus, tray and dialogs.
4. **What to cut for a 48h ship?** Everything except option 2.
5. **How hard to undo?** Easy (two-way door). The exception is switching signing schemes, which is one-way for already-installed clients.

### Verdict (conditional)

- **This makes sense if** Flutter or another non-Tauri host is adopted: extract the §4 crate at that point, and pick cargo-packager-updater to keep the minisign key.
- **It does not make sense if** Tauri is kept, with either the webview or the native kit. In that case, do only option 2. All other plugins are already Rust-driven, and the §4 dependency rule can simply guide new code inside `desktop_shell`.
- **Confidence:** Medium-High (70%).

## 6. Independent critique

Reviewer: a read-only scout, `R9BackendServices.BackendServicesChallenger`, given the finished §1–§5.

**Citation check.** It verified rfd utils.rs:20-31, tray-icon lib.rs:17-18, tauri-plugin-notification desktop.rs:179-217, self_update lib.rs:300-304, cargo-packager-updater lib.rs:263-271, and updateSubscription.ts:7-16 / 97-146. It found **no errors**.

**Accepted and incorporated:**
- **Identity wording.** "set_application is mandatory" overstated it: mac-notification-sys falls back to a default bundle (lib.rs:132-150). Row 4 now says attribution, not delivery, needs the real id.
- **Broadcast loses events.** Broadcast drops events for lagging receivers (watcher.rs:83-103). §4 now uses `watch` for state that must not be missed and `broadcast` only for transient signals.
- **Missing lifecycle contract.** Added `start`/`shutdown` and the prepare-exit handshake.
- **Updater semantics.** Moving the updater must preserve the staged flow: separate failure phases and explicit consent before install. Added to §4.
- **"Flutter only swaps the adapter" understates the cost.** macOS URL delivery, Info.plist/entitlements and installer-time AUMID are packaging/runner work. They're now listed as host-owned, and that pro is downgraded to weak.

**Strongest counterargument, accepted.** The real extension point is Tauri, not a hypothetical second host. A broad "framework-neutral" crate either leaks runtime and packaging details or recreates them in adapters. Hence the verdict: extract only when a second host is real; until then, do the updater move only.

**Deflected:** none.
