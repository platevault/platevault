# PlateVault: Tauri → Flutter migration deep dive

- **Bead:** astro-plan-m4obu (parent epic astro-plan-0drm0)
- **Date:** 2026-10-12
- **Evidence base:**
  - product repo `main` @ `94a3dc95`
  - prototype `ui-harness-v5` @ `795274d5`
  - registry APIs fetched 2026-10-12: pub.dev `/api/packages/<p>` and `/score`, crates.io `/api/v1/crates/<c>` and `/versions`
  - official docs and GitHub issues, linked inline
- **Labels:**
  - **[repo]** = file and line in this checkout
  - **[reg]** = registry API value on 2026-10-12
  - **[docs]** = official docs, release post or issue
  - **[INFERENCE]** = my reasoning, not verified
- **Scope:** Flutter as the UI for the existing Rust core; bridges FRB v2, gRPC and raw FFI. The user's "other options" angle (backend-owned OS integration; Slint, Dioxus, Iced, egui, GPUI) is covered briefly. Per-OS web kits are a sibling bead and are only mentioned where they bear on Flutter.
- **Builds on:** `docs/research/2026-08-17-gui-toolkit-evaluation.md` and `docs/research/2026-08-17-slint-vs-tauri.md` [repo]. Versions there are refreshed and one licence line is corrected (§9).
- **Spikes:** `/Users/sjors/tmp/platevault-spikes/flutter-frb` and `tauri-native` were still being built when I wrote this. They have no metrics yet. Every size, startup, RSS and VoiceOver statement below either cites a published source or is marked for the spike.
- **Critique:** independent devil's-advocate pass by a read-only scout (`R9Flutter.FlutterChallenger`), merged in §7.8–7.9.

---

## 0. Bottom line

1. **Flutter does not give PlateVault an OS-native look.**
   - It draws every pixel itself.
   - `fluent_ui` and `macos_ui` are look-alike widget sets, the same as Fluent or mac CSS kits inside a webview.
   - The two kits have different widget vocabularies, so "per-OS kit" means two UI layers, not a theme swap (§4.3).
   - Natively, only macOS gets a real menu bar. The docs say: "Flutter only includes support for macOS out of the box, but support for other platforms may be provided via plugins" [docs].
2. **What Flutter fixes:** one rendering engine. That removes browser-engine divergence (WebView2 vs WKWebView vs WebKitGTK), which has already cost this repo CI time (§7.1). It does **not** remove per-OS divergence in input, accessibility bridges, windowing or plugins. Flutter has its own per-OS embedder bugs, for example a Windows-only Impeller start-up regression (§4.1).
3. **What it costs:**
   - rewriting about 61 k code lines of non-test TS/TSX plus 7.5 k of CSS;
   - rewriting 272 test files, 38 Playwright specs and 19 WebDriver journey files;
   - giving up the 42.5 k-line React prototype as code;
   - rebuilding the signed updater and packaging flow;
   - accepting open Flutter desktop a11y defects around text-field focus and announcement (§4.2), against a WCAG AA commitment (`PRODUCT.md:53`) [repo]. Whether those defects bite PlateVault's own flows is not yet measured.
4. **If Flutter is chosen, use flutter_rust_bridge v2, not gRPC.**
   - FRB runs in-process, is async, and streams via `StreamSink`.
   - `Vec<u8>` is zero-copy in async and stream mode, and Rust errors surface as Dart exceptions.
   - gRPC only pays if the core must run out-of-process or remotely (§3).
5. **Verdict (conditional, §8): stay on Tauri for now** (Medium confidence, ~65%).
   - The simplest viable move is almost nothing architectural.
   - Fix the window-capability bug found here as its own change (§10).
   - Move the update check to Rust only if a product requirement appears. Tauri's updater already has a Rust API.
   - Track Tauri 3's CEF runtime as the targeted fix for divergence.
   - Flutter becomes sensible only if all of these hold:
     - a ground-up UI rebuild is happening anyway;
     - matched VoiceOver and Narrator checks pass on PlateVault-like screens;
     - divergence keeps biting where CEF cannot help.

---

## 1. Inventory: what PlateVault uses from Tauri today

| # | Capability | Tauri mechanism | Evidence [repo] | Notes |
|---|---|---|---|---|
| 1 | Typed command surface | `#[tauri::command]` + `#[specta::specta]`; `tauri-specta` generates TS bindings | 203 `#[tauri::command]` attributes in `src-tauri/src/commands/*.rs` (ast-grep count; `bootstrap/specta.rs:19` says "~185 commands"). Generated `apps/desktop/src/bindings/index.ts` is 10,650 lines. `tauri-specta = "2.0.0-rc.25"` (root `Cargo.toml:105`). | I/O are `contracts_core` DTOs; JSON Schemas in `packages/contracts/schemas`. |
| 2 | Streaming long-op progress | `tauri::ipc::Channel<OperationEvent>` | `commands/plan_apply.rs:33,46-67`; `features/plans/planApply.ts:16`; `bindings/index.ts:4` | Started / Progress / ItemApplied / ItemFailed / Completed |
| 3 | Backend → UI events | `Emitter::emit` | `watcher.rs:90` (`inbox:file-change`); `lib.rs:305` (`menu:open-settings`); splash `listen` in `src/splash/main.ts:16-17` | Small surface |
| 4 | Windows | `tauri.conf.json` windows: `main` hidden until boot-ready; `splash` transparent, undecorated, always-on-top, skip-taskbar | `tauri.conf.json` `app.windows`; `bootstrap/window.rs` (min-size clamp and off-screen recentre, unit-tested) | Splash → main handshake |
| 5 | Extra windows | `WebviewWindow` from JS | `src/lib/window.ts:35-41`, called from `app/CommandPalette.tsx:323` | **Side finding (§10).** Label is `pv-win-*`; capability grants `alm-win-*` (`capabilities/default.json:5`). Consequence not run. |
| 6 | Engine zoom | `getCurrentWebview().setZoom()` | `src/data/theme.ts:559-574`; capability `core:webview:allow-set-webview-zoom` | Webview-specific |
| 7 | Native app menu | `tauri::menu` (muda): App / Edit (predefined roles) / Window; Settings… on `CmdOrCtrl+,` | `bootstrap/menu.rs:15-59`; `lib.rs:302-327` | Edit roles are native predefined items |
| 8 | Folder/file pickers, save dialog | `tauri-plugin-dialog` | Rust: `commands/native.rs:28-101`. JS `save`: `app/LogPanel.tsx:144-148`, `features/settings/AuditLog.tsx:261-264` | |
| 9 | Reveal in Finder/Explorer, open path | `tauri-plugin-opener` | `commands/native.rs:117-185` (Linux `xdg-open` fallback + audit); `features/settings/Attribution.tsx:68-71` | |
| 10 | Single instance + focus | `tauri-plugin-single-instance` | `lib.rs:178-200`; skipped under `PV_E2E_INSTANCE_ID` | Guards the canonical SQLite |
| 11 | Window-state persistence | `tauri-plugin-window-state` (VISIBLE excluded) | `lib.rs:219-245` | E2E path override |
| 12 | Signed auto-update | `tauri-plugin-updater` (minisign pubkey, GitHub `latest.json`) + `tauri-plugin-process` relaunch; `createUpdaterArtifacts: true` | `tauri.conf.json` `plugins.updater`; `lib.rs:255-256`; JS state machine `src/data/updateSubscription.ts:7-11,102,145` | Frontend-driven: check → download+verify → deferred relaunch |
| 13 | OS notifications | `tauri-plugin-notification`, called **from Rust** with a focus gate | `bootstrap/notify.rs` (topic → notification, unit-tested); `lib.rs:265` | Already backend-owned |
| 14 | Logging | `tauri-plugin-log` with `skip_logger()`; Rust `tracing` + `tracing-appender` own the files | `lib.rs:279`; `main.rs` subscriber; JS `lib/diagnosticLog.ts:7-33` | Plugin is only a JS → tracing bridge |
| 15 | Real-UI E2E | `tauri-plugin-webdriver` 0.2 (feature `e2e`) + `tauri-webdriver` CLI + thirtyfour | `Cargo.toml:72,103`; `crates/e2e-tests/README.md`; 19 test files, 5,551 code lines | Out-of-process W3C WebDriver against the real binary, real SQLite and real filesystem |
| 16 | Agent-driven UI automation (dev) | `tauri-plugin-mcp-bridge` 0.11 (feature `dev-tools`) | `Cargo.toml:58,95`; `capabilities/dev/mcp-bridge.json` | |
| 17 | Bundling | `tauri build`, `bundle.targets: "all"`, resources (font licences), icons | `tauri.conf.json` `bundle` | dmg/app, msi/nsis, deb/rpm/AppImage + updater artifacts |
| 18 | Capability ACL | `capabilities/default.json` + build-time dev widening | `capabilities/default.json:1-21`; `Cargo.toml:88-95` | Exists because a webview runs JS |

**Plugin count.** 10 Tauri plugins in total:
- 8 from `tauri-apps/plugins-workspace`: dialog, opener, single-instance, window-state, log, updater, process, notification;
- `tauri-plugin-webdriver` (Choochmeque);
- `tauri-plugin-mcp-bridge` (@hypothesi).

Evidence: `Cargo.toml:53-72` [repo].

**Not used today:** no hits in `apps/desktop` for tray, deep links, OS drag-and-drop, global shortcuts or a custom URI-scheme protocol. Filesystem watching (`notify`) and trash (`trash`) are plain Rust crates in `crates/` and carry over unchanged [repo].

**Sizes** (scc code lines, so blanks and comments excluded) [repo]:

| Area | Measure |
|---|---|
| `apps/desktop/src` non-test (excludes `*.test.*`, `bindings/`, `paraglide/`) | **61,009 TS/TSX + 7,522 CSS** |
| Frontend tests | 272 test files, 56,281 raw lines |
| Playwright (`tests/e2e`) | 38 specs, 5,157 code lines |
| Shell (`src-tauri/src`) | 7,010 Rust code lines |
| `crates/` | 146,378 Rust code lines (includes e2e-tests) |
| Prototype (`apps/prototype/src`) | 42,475 TS/TSX + 874 CSS; 135 `.tsx`, 36 UI primitives |
| i18n | 2 locales; `messages/en-GB.json` is 3,074 lines |

The 2026-08-17 evaluation counted **total** lines: 90,419 non-test TS/TSX, 55,285 test. That is a different measure, so it is not directly comparable to the code-line figures above.

---

## 2. Tauri → Flutter mapping table

Registry columns [reg]: **ver** latest · **rel** latest release · **♥** pub.dev likes · **dl/30d** 30-day downloads · **pts** pub points out of 160.

| PlateVault need | Tauri today | Flutter / pub.dev candidate (publisher · ver · rel · ♥ · dl/30d · platforms) | Rust-side alternative (crates.io ver · date) | Maturity verdict |
|---|---|---|---|---|
| Typed commands (~203) | tauri-specta | **flutter_rust_bridge** (cjycode.com · 2.13.0 · 2026-08-23 · 664 · 623 k · all) | same crate; 2.14.0-beta.2 · 2026-09-12 | Mature (§3); repo 5.4 k stars, updated daily |
| Progress streams | `ipc::Channel` | FRB `StreamSink<T>` → Dart `Stream<T>` [docs] | — | Direct analogue |
| Backend events | `emit`/`listen` | FRB stream held for app lifetime ("you can hold that StreamSink forever") [docs] | — | Equivalent |
| Window size/min/position, hide-until-ready | config + window APIs | **window_manager** (leanflutter.dev · 0.5.2 · 2026-07-04 · 1126 · 775 k · win/mac/linux) | — | Mature; de facto standard |
| Splash window (transparent, undecorated, on-top) | second window | Official windowing API is **experimental, main channel, behind `--enable-windowing`** (blog 2026-08-24) [docs]. **desktop_multi_window** (mixin.dev · 0.3.1 · 2026-08-26 · 290 · 60 k): "Each window … has its own dedicated Flutter engine" [docs] | — | **Gap.** Use an in-window loading state instead. |
| Open route in new window | `WebviewWindow` | same as splash | — | **Gap.** Experimental API, or one engine per window with no shared state |
| Engine zoom | `setZoom` | `MediaQuery` text scaler / app-level scale | — | Re-implement [INFERENCE] |
| Window-state persistence | plugin + `bootstrap/window.rs` | window_manager bounds + own store (`shared_preferences` flutter.dev · 2.5.6 · 2026-10-05) | Keep `Rect`/clamp as pure Rust behind FRB | Hand-roll (small); tested geometry logic reusable |
| Single instance + focus | plugin | **windows_single_instance** (Windows only · 1.2.0 · 2026-06-16 · 55); **unix_single_instance** (0.0.4 · 2024-04-29 · 3); flutter_single_instance (1.7.0 · 2025-11-04 · 23) | **interprocess** 2.4.5 · 2026-10-10 (local socket, forward argv); `single-instance` 0.3.3 stale (2021-12-16) | **Weak.** Hand-roll in Rust, focus via window_manager |
| Native menu bar + Edit roles | muda via Tauri | **PlatformMenuBar** (SDK): macOS only "out of the box … other platforms … via plugins" [docs]. Windows/Linux get an in-window `MenuBar` widget. `menu_bar` (0.5.3 · 2023-06-18 · 74) stale | `muda` 0.21.2 · 2026-10-08; needs host event loop / main thread under Flutter's runner [INFERENCE] | macOS native; **Windows non-native** |
| Row/context menus | HTML menu | `MenuAnchor` (drawn); **super_context_menu** (nativeshell.dev · 0.9.1 · 2025-06-11 · 288) native but no release for 16 months; 3.47 popup windows (Win/Linux) experimental [docs] | — | Drawn OK; native risky |
| Folder/file pick, save | plugin-dialog | **file_selector** (flutter.dev · 1.1.0 · 2025-11-21 · 439 · 778 k · all) or **file_picker** (13.1.0 · 2026-09-15 · 4953 · 4.4 M) | `rfd` 0.17.2 · 2026-01-12 (macOS panels need main thread; FRB calls run on workers [INFERENCE]) | Mature; macOS sandbox entitlements (§5) |
| Reveal / open path | plugin-opener | **url_launcher** (flutter.dev · 6.3.3 · 2026-10-02 · 8183) opens but does not reveal | **opener** crate `reveal()` ("reveals a file or folder in its containing folder") [docs] | Keep Rust-side; `native.rs` logic ports [INFERENCE] |
| OS notifications | plugin, Rust-side | **flutter_local_notifications** (dexterx.dev · 22.3.2 · 2026-10-12 · 7354 · 3.2 M · win/mac/linux); local_notifier (0.1.6 · 2024-04-05) stale | `notify-rust` 4.18.2 · 2026-10-07 | Mature either way; Rust-side keeps `notify.rs` |
| Signed auto-update | plugin-updater + process | **auto_updater** (Sparkle/WinSparkle · 1.0.0 · **2024-10-27** · 218 · 130 pts · win/mac); desktop_updater (3.2.1 · 2026-10-03 · 53) | **self_update** 1.3.0 · 2026-09-02: zipsign `signatures`, `.app` bundle mode, `restart` module; "never signs, notarizes" [docs]. **velopack** 1.2.161 · 2026-09-29: installers, delta updates, Rust SDK [docs] | Rust-side best (user's angle); **loses** the wired minisign + `latest.json` + `createUpdaterArtifacts` flow |
| Tray (unused) | — | **tray_manager** (leanflutter.dev · 0.8.0 · 2026-10-08 · 291 · 221 k); system_tray (2.0.3 · 2023) stale | `tray-icon` 0.26.1 · 2026-10-07 | Fine if needed |
| Deep links (unused) | — | **app_links** (7.2.2 · 2026-10-06 · 1323 · 3.2 M · all) | — | Fine |
| Drag-and-drop folders (unused) | — | **desktop_drop** (mixin.dev · 0.8.4 · 2026-09-01 · 469 · 850 k); super_drag_and_drop (0.9.1 · 2025-06-11) | — | desktop_drop OK |
| Logging | plugin-log bridge | Dart `logging` → FRB call into Rust `tracing` | `tracing` unchanged | Trivial |
| System dark/light | webview + theme sync | `MediaQuery.platformBrightness`; **system_theme** (bdlukaa.dev · 3.3.0 · 2026-05-26) for accent | — | Mature |
| i18n (paraglide; ICU plural/match; 2 locales; CI drift guards) | paraglide-js | **gen-l10n ARB + intl** (dart.dev · 0.20.3 · 2026-06-25 · 6109 · 12 M) or **slang** (4.19.2 · 2026-09-12 · 792), both typed | — | Mature; catalogue converts, 3 CI guard scripts rewritten [INFERENCE] |
| Data tables (sortable, row menus, virtualised) | React + TanStack Virtual | **two_dimensional_scrollables** TableView (flutter.dev · 0.5.5 · 2026-09-25 · 491); data_table_2 (3.0.0 · 2026-08-17 · 984); trina_grid (2.3.0); syncfusion_flutter_datagrid (commercial licence) | — | Workable; still 0.x at flutter.dev |
| Real-UI E2E (out-of-process, real binary) | plugin-webdriver + thirtyfour | **integration_test** (SDK, in-process; `flutter test integration_test -d macos`) [docs]. **patrol** (leancode.co · 4.10.0 · 2026-09-15 · 728; platforms android/ios/macos/web) — **Windows support is open issue #2470** [docs]. Note this is a Patrol gap, not a gap in every Flutter Windows test route. | — | **Major gap:** no W3C WebDriver path; 19 journey files rewritten in Dart, in-process |
| Unit/component tests | Vitest + RTL; Playwright mock mode | `flutter_test` widget and golden tests | — | Mature; full rewrite |
| Agent-driven UI (dev) | mcp-bridge | **Dart and Flutter MCP server** (`dart mcp-server`, "Experimental"): "runtime introspection … of a running Flutter application during active debugging sessions" [docs] | — | Comparable for debug builds; experimental |
| Packaging/signing | `tauri build` (all targets) | `flutter build macos/windows/linux`; Xcode signing; notarise "following Apple's documentation" [docs]. **msix** (3.18.0 · 2026-06-27 · 990); **fastforge** (leanflutter.dev · 0.6.12 · 2026-07-29 · 49). `flutter_distributor` is discontinued [reg]. | `cargo-packager`; velopack | **Assemble from parts** |
| Capability ACL | capabilities | none needed (no JS engine) | dev/E2E Cargo feature gates stay | Simplification |

---

## 3. Bridge comparison: FRB v2 vs gRPC vs raw FFI

Components compared:
- **FRB v2:** flutter_rust_bridge 2.13.0.
- **gRPC:** tonic 0.14.6 + prost 0.14.4 on the Rust side; grpc 5.1.0 (dart.dev, 2025-12-09) + protobuf 6.1.0 + protoc_plugin 25.1.0 on the Dart side.
- **Raw FFI:** a C ABI called through `dart:ffi`, with ffigen 23.0.0 (2026-10-06).

| Dimension | FRB v2 | gRPC | Raw FFI |
|---|---|---|---|
| Process model | In-process dylib/staticlib | In-process tonic on loopback/UDS, or a sidecar. grpc-dart UDS exists (#299, closed 2020) but **not on Windows** (#735) [docs], so TCP loopback there | In-process |
| Codegen | Parses Rust API modules; Dart classes, `freezed` sealed classes for enums, records for tuples [docs]. External-crate types need "third-party" scanning ("may not follow semver yet") or mirrored types [docs]. | `.proto` becomes a **third** schema language next to JSON Schema and the Rust DTOs; two generators | ffigen covers C bindings only; DTO marshalling is yours (e.g. JSON + `json_serializable`) |
| Contract reuse | High: `contracts_core` serde DTOs → Dart types; `serde_json::Value`/`uuid`/`chrono` via features [docs]. specta derives become UI-redundant. | Low: DTOs re-declared in proto; parity tests must cover proto [INFERENCE] | Medium: reuse serde JSON as today's Tauri IPC does; Dart types from JSON Schema [INFERENCE] |
| Async | `async fn`; pluggable runtime (`BaseAsyncRuntime`), tokio default [docs] | Native (HTTP/2) | Hand-rolled (`NativeCallable.listener` / `Dart_PostCObject`) |
| Streams | `StreamSink<T>` → `Stream<T>`; sink can outlive the call; `add_error` [docs] | Server-streaming / bidi | Hand-rolled |
| Cancellation | Not built in. Docs suggest a CancelToken (copy from PR #333) or tokio `CancellationToken` [docs] | Built in: `call.cancel()`; server sees stream drop | Hand-rolled |
| Errors | Rust `Result` → Dart exception; custom handlers; stack-trace guide [docs] | `Status` code + details | Hand-rolled |
| Zero-copy (FITS preview bytes) | `Vec<u8>` Rust → Dart zero-copy "using asynchronous Dart mode or streaming in Android/iOS/Windows/MacOS/Linux"; not in sync mode [docs] | No: proto `bytes` copied on encode, framing and decode [INFERENCE] | Possible with external typed data, by hand |
| Build/packaging | Cargokit (default) or Native Assets backend (`--integration-backend native-assets`); Rust built inside `flutter build` [docs] | Two build systems; a sidecar must be signed, notarised and lifecycle-managed [INFERENCE] | Own CMake/Xcode glue |
| Hot reload | Dart hot reload works. **Rust changes need a full restart.** FRB #1966 closed (Dart VM cannot reload FFI libraries); Flutter docs say native-code changes need a full restart [docs] | Same for the UI; a sidecar restarts separately | Same as FRB |
| CI | `flutter_rust_bridge_codegen generate` + drift check; Rust toolchain inside Flutter builds on 3 OSes [INFERENCE] | protoc + plugins on 3 OSes | Minimal codegen, more bespoke code |
| Security | No listening port | **Loopback port reachable by every local process**, needs an auth token [INFERENCE] | No port |
| Maturity / bus factor | 5,446 stars, updated 2026-10-12; primarily one maintainer (`fzyzcjy` personal account) [docs/INFERENCE] | Google-published (dart.dev / google.dev); repo 891 stars | SDK-level |

**Other option:** **rinf** (cunarist.com · 8.11.0 · 2026-10-07 · 130 likes · 2.8 k dl/30d), a message-passing model with small adoption [reg].

**Verdict:** use FRB v2 for an in-process desktop app. Choose gRPC only if Constitution V's "future local or remote service" (`.specify/memory/constitution.md:83-87`) becomes a real requirement. Even then, generate the contract from JSON Schema rather than adding proto as a third schema language [INFERENCE].

---

## 4. Rendering and UX

### 4.1 Impeller on desktop

- **Flutter 3.47** (stable 3.47.7 · 2026-10-08 [reg]) changed the desktop renderer [docs: flutter.dev/blog/whats-new-in-flutter-3-47]:
  - Impeller is now the default on macOS, Windows and Linux;
  - SDF text and vector rendering are on for desktop;
  - wide-gamut colour is on for macOS;
  - the Skia opt-out "will be removed in a future release".
- **Windows cold-start regression:** flutter/flutter#191860 (open, P2, team-engine) [docs]. All numbers are reporter measurements, not universal:
  - minimal app on 3.47.1: first frame 1232 ms (Impeller) vs 165 ms (Skia);
  - same app on the main channel: 618 vs 134 ms;
  - a real app (MarkText Plus): 2130–3330 ms vs 291–634 ms.
  - Logs show Windows runs OpenGLES via ANGLE ("OpenGLESSDF"), although the blog names Vulkan.
  - A maintainer says "we might have to just rely on a vulkan/dx12 backend".
- **Maintenance:** Canonical became "lead maintainer and 'strategic steward' of Flutter desktop" (Google I/O 2026; omgubuntu, 2026-05-29) [docs]. This is an investment signal, but also Google handing desktop to a partner.

### 4.2 Accessibility (decisive for a WCAG-AA product)

**Open issue counts** (searched 2026-10-12) [docs]. These counts measure backlog, not user-visible severity in PlateVault (critique §7.8).

*macOS: 23 open* (`a: accessibility` + `platform-macos`), including:
- #191001 — VoiceOver fails to follow Tab focus and announce TextField semantics. P2, opened 2026-08-12, reproduced on 3.44.4 with a login form.
- #120779 — VoiceOver does not read a TextField's label. Open since 2023-02.
- #191013 — VoiceOver cursor jumps to the first element after a dialog closes.
- #193588 — AX-bridge crash after a failed AXTree update. Opened 2026-09-30.
- #160348 — VoiceOver reads scrollable items out of order.
- #177500 — toggles do not report their state.

*Windows: ≥30 open* (`a: accessibility` + `platform-windows`; the search capped at 30), including:
- #172438 — text cannot be focused via keyboard.
- #178024 — page titles are not read (Windows/Linux).
- #189125 — a disabled button reports IsEnabled=true to UIA.
- #189124 — stale bounding rects after scrolling.
- #182876 — dictation tools cannot detect TextFields.

**Roles.** `SemanticsRole` includes `table`, `row`, `cell`, `columnHeader`, `menuBar`, `menu`, `menuItem` and dialog roles, which "are translated into native accessibility roles in each platform" [docs]. Whether VoiceOver and Narrator actually announce a Flutter `TableView` as a table with headers and sort state is **unverified**.

**Webview baseline.** It uses the browser's AX tree. The repo gates on it: 541 `aria-*` uses, `eslint-plugin-jsx-a11y`, axe, and the J16 keyboard journey (2026-08-17 evaluation §1) [repo]. Those are **web conformance checks, not a comparative screen-reader audit**. The webview's actual VoiceOver/Narrator behaviour on PlateVault screens is also unmeasured.

**Reading** [INFERENCE]:
- Flutter desktop a11y is real; UIA and NSAccessibility bridges exist.
- It shows open framework-level defects on text-field focus, which form-heavy PlateVault depends on, and app code cannot fix those.
- The fair test is a **matched** VoiceOver + Narrator keyboard script run on both spikes.

### 4.3 Native feel and per-OS kits

- **fluent_ui** (bdlukaa.dev · 4.16.1 · 2026-08-03 · 3,227 likes · 3.5 k stars) is active.
- **macos_ui** (macosui.dev · 2.2.2 · 2025-10-19 · 1,071 likes · 2.1 k stars) has had no release for 12 months [docs]:
  - macOS 26 design requests were closed (#576, #578);
  - #593 (2026-09-27): a hidden Sidebar still takes input.
- The two kits expose different widget sets (`NavigationView`/`CommandBar` vs `MacosWindow`/`Sidebar`/`ToolBar`). A per-OS look therefore needs a PlateVault primitive layer with two implementations, the same cost as two CSS kits [INFERENCE].
- 3.47 split `material_ui` (1.6.0) and `cupertino_ui` (1.1.2) into standalone packages and aims for a style-neutral core [docs, reg].
- Every control is Flutter-drawn, so platform behaviours are re-implementations: text-selection menus, context menus, scroll physics, dictation, the Services menu. Examples: macOS #191503 and #182803 [docs].

### 4.4 Text input and IME

- 3.47 fixed Korean composition caret placement on Windows (#186353) [docs].
- Dictation and assistive-input tools not seeing TextFields is the live defect class: macOS #191503 and #182803, Windows #182876 [docs].

### 4.5 Image-heavy views (FITS previews)

- **No preview pipeline exists yet.** There are no `thumbnail`, `image::` or `png::` hits in `crates/` [repo], so performance claims are prospective.
- **Flutter route:**
  - Rust stretches and downsamples the image.
  - RGBA8 or PNG bytes go zero-copy over an FRB async or stream call [docs].
  - Dart shows them with `decodeImageFromPixels` or `Image.memory`.
  - For GPU-resident previews, a `Texture` widget can be fed from Rust via **irondash_texture**. Its stable 0.5.0 dates from 2023-12-26 and 0.6.0-dev.0 from 2026-08-05; adoption is low (≈1.9 k recent downloads) [reg].
- **Tauri route:** a custom URI scheme serving PNG/WebP to `<img>`, or `Channel<Vec<u8>>` into a canvas. Browser decoders are mature [INFERENCE].
- **Reading** [INFERENCE]: no winner without a benchmark.

---

## 5. Packaging, signing, size, cold start

| Topic | Tauri (today) | Flutter |
|---|---|---|
| Bundles | `bundle.targets: "all"`: app/dmg, msi/nsis, deb/rpm/AppImage, updater artifacts [repo] | Per-OS `flutter build`. macOS: Xcode signing and notarisation by hand [docs]. Windows: `msix` or Inno Setup via fastforge. Linux: fastforge AppImage/deb [reg]. |
| macOS sandbox | Not enabled by default [INFERENCE] | Template is "signed, and sandboxed with App Sandbox" by default; file access needs `user-selected` entitlements [docs]. Watched roots need security-scoped bookmarks, or no sandbox for direct distribution [INFERENCE]. |
| Updater | Integrated, signed, wired | Rust self_update / velopack or auto_updater (§2) |
| Empty-app size | ≈3 MB (Windows x64) | ≈25 MB (Windows x64); macOS not measured. Source: Elanis/web-to-desktop-framework-comparison, GitHub-CI numbers [docs]. Real PlateVault binaries are larger on both because the Rust core dominates [INFERENCE]. **Spike to measure.** |
| Cold start | Webview spin-up | Windows + Impeller #191860 (§4.1). **Spike to measure.** |
| Minimum OS | per webview | macOS 12+; warnings for Intel builds (3.47) [docs] |

---

## 6. Migration cost

**Kept:**
- `crates/` (≈141 k Rust code lines excluding e2e-tests);
- `app_core` use-cases and `contracts_core` DTOs;
- `packages/contracts` schemas;
- `notify.rs` topic logic and `bootstrap/window.rs` geometry;
- specs and journeys **as behaviour documents** (68 `specs/` dirs, 24 `docs/journeys` files) [repo].

**Rewritten or replaced** [repo]:

| Item | Size | Becomes |
|---|---|---|
| UI | 61,009 TS/TSX + 7,522 CSS | Dart; token pipeline (style-dictionary → vanilla-extract) re-targeted to `ThemeExtension` |
| Prototype | 42,475 TS/TSX | Visual reference only |
| Unit/component tests | 272 files | Widget/golden tests |
| Playwright | 38 specs | Integration tests |
| WebDriver journeys | 19 files | In-process `integration_test` |
| Shell | 7,010 Rust lines | FRB API crate + Flutter runner glue |
| i18n tooling | catalogue + 3 CI guards | Catalogue → ARB; guards rewritten |

**Effort estimate** [INFERENCE]. Solo developer with agent assistance. The rates are **assumed, not measured**; the spike should recalibrate them:
- 250–500 net ported-and-reviewed UI lines per day;
- 600–900 test lines per day;
- Flutter code size ≈ the TSX it replaces.

*Scenario A — port today's production frontend to Flutter:*

| Work | Estimate |
|---|---|
| FRB API crate wrapping 203 commands + streams/events | 3–5 weeks |
| Shell parity (window, menu, single-instance, notifications, logging) | 2–3 weeks |
| Packaging, signing, notarisation and updater on 3 OSes | 3–6 weeks |
| UI port (61 k lines) | 6–12 months |
| Test harness (≈48 k lines) | 2–4 months |
| a11y parity | **unbounded** (upstream issues, §4.2) |
| **Total** | **≈10–18 person-months** before a11y parity |

*Scenario B — the production UI is rebuilt from the prototype design anyway:*
- Both stacks pay for the rebuild.
- Flutter's **marginal** cost over React is roughly 6–12 person-months:
  - re-implementing ≈42.5 k prototype lines instead of reusing them;
  - a new test harness instead of extending Playwright/WebDriver;
  - shell and packaging parity.
- This is the scenario where Flutter is least unattractive.

Which scenario applies is a **product decision not stated in the repo**. The prototype's own manifest says "Not the production frontend" (`apps/prototype/package.json` description) [repo].

---

## 7. Debate

### 7.1 Problem validation

| Claimed motivation | Real? | Does Flutter solve it? |
|---|---|---|
| OS-native look per OS | Wanted by the user | **No.** Look-alike widgets; native menu bar on macOS only (§4.3) |
| WebView engine divergence | **Yes, evidenced:** `docs/development/orchestration-2026-07-06.md:106` ("a green run proves nothing about a fix"); `:212-216` (WebView2 localStorage flush loss vs WebKitGTK); `:313-318` (Linux reset no-op, so "journeys share webview state on ubuntu") [repo] | **Browser-engine divergence: yes.** OS-level divergence (input, AX bridges, windowing, plugins) remains. Tauri 3 CEF also targets this (§7.5). |
| Dependence on Tauri plugins | Partly: 10 plugins (§1) | **Swaps** them for ~10 pub.dev plugins of mixed maturity (§2) |
| Desktop-only interactions are few | **Yes** (user's point). Most OS work is already Rust-side: pickers, reveal, notifications, watcher, trash, logging [repo] | Neutral; the shell is thin in **either** stack |

### 7.2 Pros of Flutter + FRB

| Pro | Evidence strength |
|---|---|
| One renderer removes browser-engine divergence (§7.1) | **Strong** (narrower than "all divergence") |
| In-process typed bridge with streams and zero-copy bytes (§3) | **Strong** (docs) |
| Stateful hot reload for UI; widget previews stable in 3.47 [docs] | Moderate (Vite HMR already good) |
| Active desktop plugins from leanflutter.dev (window_manager 775 k/30d; screen_retriever 1.06 M/30d; tray_manager) [reg] | Moderate |
| Investment signals: Impeller desktop default, windowing API, Canonical stewardship [docs] | Moderate (new, regressions) |
| No capability ACL or JS attack surface | Weak–moderate |

### 7.3 Cons

| Con | Severity |
|---|---|
| Rewrite + harness ≈10–18 person-months (A) or ≈6–12 marginal (B); prototype code discarded (§6) | **Major**; blocker unless a rebuild is planned |
| Desktop a11y defects in text-field focus/announcement on VoiceOver and Narrator vs WCAG AA (§4.2) | **Major**; blocker if a11y is a release gate and the spike reproduces them |
| No native look; two widget vocabularies for per-OS kits; macos_ui no release for 12 months (§4.3) | **Major** for the user's motivation 1 |
| Lose the out-of-process WebDriver E2E; Patrol lacks Windows (§2) | **Major** |
| Packaging and updater assembled from parts (§5) | Major |
| Multi-window experimental; splash and new-window regress (§2) | Minor |
| Windows Impeller cold start (§4.1) | Minor–major (open) |
| Size ≈25 MB vs ≈3 MB empty-app baseline (§5) | Minor |
| Still two languages (Dart + Rust) | Minor |
| FRB bus factor (§3) | Minor–moderate |

### 7.4 Tradeoffs

You gain:
- one renderer;
- a typed in-process bridge;
- no JS/ACL surface.

You give up:
- the browser AX tree and its web tooling;
- the CSS/token pipeline and its skill market;
- the WebDriver real-binary harness;
- Tauri's integrated bundler and updater;
- the React prototype as code;
- 6–18 person-months.

### 7.5 Alternatives

1. **Do nothing.** Stay on Tauri 2.12 + React and keep iterating the prototype. Divergence persists as a known, partly mitigated class.
2. **Simplest viable (revised after critique).** Keep the architecture.
   - Fix the window-capability mismatch as an independent bug (§10). It is not a prerequisite for the renderer decision.
   - Move the update check to Rust **only when a requirement exists**, e.g. checking while the window is hidden. tauri-plugin-updater already exposes a Rust API (`UpdaterExt`, `app.updater()?.check()`) [docs: v2.tauri.app/plugin/updater]. Notifications are already Rust-owned (`notify.rs`) [repo].
   - The per-OS look is a separate design objective (sibling bead), not part of this.
3. **Tauri 3 + CEF runtime when stable.**
   - Status: tauri 3.0.0-alpha.4 on 2026-10-01; stable line is 2.12.3 (2026-10-10) [reg].
   - What CEF gives: "the same Chromium version on Windows, macOS, and Linux".
   - Costs [docs: v3.tauri.app/develop/cef]:
     - bundles "hundreds of megabytes larger" and more runtime memory;
     - desktop only;
     - a ~1 GB first-build download;
     - "Windows currently runs unsandboxed regardless of the policy".
   - It is a **major-version upgrade**, not a Tauri 2 setting.
   - It removes engine divergence without a UI rewrite.
4. **Flutter + FRB** (this bead).
5. **Flutter + gRPC.** Dominated by FRB for in-process use (§3).
6. **Slint 1.18.1.** Ships `fluent`, `cupertino`, `material`, `cosmic` and `qt` styles, plus `native` ("cupertino on macOS, fluent on Windows"), chosen at compile time [docs]. The licence is OK (§9). Widget gaps in the 2026-08-17 Slint doc §3: rich table cells, tree, charts, maps [repo].
7. **Dioxus, Iced, egui, GPUI, Freya.** See §9.

### 7.6 Overengineering assessment

1. **Would doing nothing solve it adequately?**
   - Divergence: partly; mitigations exist.
   - Native look: no, but Flutter doesn't either.
   - OS integration: yes; it is mostly Rust-side already.
2. **Simplest thing that could work?** Fix the capability bug and keep the stack. Everything else waits for a stated requirement.
3. **Which part solves a problem we don't have yet?**
   - gRPC's remote capability: no remote client exists.
   - Flutter mobile reach: PlateVault is a desktop library manager.
   - Multi-window: there is one call site.
   - A Rust-owned update check: no stated requirement (critique).
4. **If we had to ship in 48 hours, what would we cut?** Everything except the capability fix.
5. **How hard is this to undo if we're wrong?**
   - Flutter is near one-way: the TS frontend and tests go, and coming back means a second rewrite.
   - Staying is fully reversible.

### 7.7 Reversibility

| Option | Reversibility |
|---|---|
| Flutter migration | **One-way in practice.** Core and contracts survive, so it is "reversible at full rewrite cost". |
| Stay / thin shell | Two-way |
| Tauri 3 CEF | Reversible with cost: a major upgrade plus a runtime choice, with no UI rewrite (corrected after critique) |

### 7.8 Devil's advocate (independent critique, scout `R9Flutter.FlutterChallenger`)

**Strongest argument against staying** (verbatim from the critique):

> "A single rendering engine eliminates an entire recurring compatibility matrix. PlateVault already pays CI and investigation costs for WebView-specific state and behavior, so staying preserves an evidenced source of uncertainty rather than merely avoiding speculative migration. If CEF remains alpha or its Windows sandbox gap is unacceptable, Flutter's rewrite may buy a durable simplification that incremental Tauri fixes cannot."

**Critique points and how I handled them:**

| Critique point | Status | Change made |
|---|---|---|
| The divergence pro is narrower than claimed: Flutter removes browser-engine divergence, not OS input, AX bridges, windowing or plugin divergence | **Accepted** | §0 item 2, §7.1, §7.2 |
| The cost estimate rests on assumed LOC/day rates, and "port existing React" vs "rebuild from the prototype" are different scopes | **Accepted** | Scenarios A/B in §6; rates labelled assumed |
| Issue counts are not severity. #191001 was reproduced on 3.44.4 with a login form, not PlateVault flows. ARIA/axe is web conformance, not a comparative screen-reader audit. | **Accepted** | §4.2 qualified; matched VoiceOver/Narrator script made a verdict condition |
| "Simplest viable" was a bundle. The capability fix is independent; a Rust update check lacks a stated requirement; per-OS tokens are a separate objective. | **Accepted** | §7.5 item 2 and §7.6 revised |
| CEF is not "a dependency swap": it needs the Tauri 3 runtime and has a Windows sandbox gap | **Accepted** | §7.5 item 3 and §7.7 corrected; quote verified on v3.tauri.app |
| The GPLv3 §13 conclusion is conditional: GPL terms continue on the covered part, and AGPL §13 network terms apply to the combination | **Accepted as nuance** | §9 wording kept; the verdict is not legal advice |
| Citation spot-check: #191860, #191001, PlatformMenuBar, patrol #2470, FRB zero-copy, window.ts:35 / default.json:5, GPLv3 §13 | **All accurate**; two needed scoping, now applied | PlatformMenuBar quote completed; patrol gap scoped |

**Deflected:** none. The critique's suggested confidence (65%) is adopted.

**Self-corrections found while revising:**
- The Tauri 3 alpha date was wrong: alpha.4 is 2026-10-01, not 2026-10-10.
- The `irondash_texture` version/date was wrong: stable 0.5.0 is 2023-12-26.
- The plugin count was misworded: it is 10 plugins.

### 7.9 Synthesis

- Staying on Tauri keeps a **concrete, evidenced advantage**: cost and reversibility. Flutter has one **concrete, evidenced advantage**: removing browser-engine divergence.
- The two premises that would decide it are both **unmeasured** for PlateVault:
  - comparative screen-reader behaviour on PlateVault-like screens;
  - real porting throughput.
- The user's stated motivation 1 (native look per OS) is **not** served by Flutter.
- The user's motivation 3 (a thin, backend-owned shell) is served **equally** by both stacks, and is already mostly true in this repo.
- **Confidence that staying is the right call today: Medium, ~65%.**

---

## 8. Conditional verdict

**Flutter + flutter_rust_bridge v2 makes sense IF all of these hold:**
1. A ground-up production UI rebuild is planned anyway (scenario B), so rewrite cost is shared, and the owner accepts ≈6–12 person-months of marginal cost.
2. The shared spike's **matched** keyboard + VoiceOver (macOS) + Narrator (Windows) script passes on Flutter ≥3.47 **and is not worse than the Tauri spike**. It must cover:
   - the sessions table: headers announced, sort state;
   - row action menus;
   - menu bar;
   - text fields;
   - status notices.
3. Browser-engine divergence keeps producing CI or shipped failures that Tauri 3 CEF cannot address. Reasons CEF might not help: still alpha, the Windows sandbox gap is unacceptable, or bundles of hundreds of MB are unacceptable.
4. The owner accepts assembling packaging, signing, notarisation and the updater (fastforge/msix/notarytool + self_update or velopack), and an in-process `integration_test` harness in place of out-of-process WebDriver.
5. Spike cold start on Windows is acceptable despite #191860, or that issue is closed.

**It does NOT make sense IF any of these hold:**
- The goal is an OS-native look per OS. Flutter can't deliver it; see the per-OS-kit bead or truly native toolkits.
- The React prototype is meant to become production code (scenario A, or a prototype-to-production port).
- WCAG AA is a release gate and the spike reproduces the open VoiceOver/Narrator text-field and focus defects (§4.2).
- The only gain sought is "fewer Tauri plugins". Flutter swaps them for pub.dev plugins of mixed maturity.

**Within Flutter:** use FRB v2, not gRPC, unless an out-of-process or remote core becomes a requirement (Constitution V).

**Revisit triggers:**
- the two spikes report metrics;
- Tauri 3 CEF reaches stable, or the Windows sandbox gap closes;
- the Flutter windowing API leaves the experimental flag;
- #191001, #120779 or #172438 close;
- a decision is made to rebuild the frontend.

---

## 9. Other options (brief)

| Option | Version · date [reg] | Licence | Desktop look | Accessibility evidence | Maturity notes |
|---|---|---|---|---|---|
| **Slint** | 1.18.1 · 2026-09-21; 1.97 M total dl | GPL-3.0-only OR royalty-free OR commercial | `fluent`/`cupertino`/`material`/`cosmic`/`qt`; `native` alias = cupertino on macOS, fluent on Windows; compile-time; follows system dark/light [docs] | AccessKit backend; richest documented role set among Rust toolkits (2026-08-17 evaluation) [repo] | 1.x semver; gaps in rich table cells, tree, charts, maps (Slint doc §3) [repo]. See licence note below. |
| **Dioxus** | 0.7.10 · 2026-07-30; 0.8.0-alpha.1 · 2026-07-31 | MIT/Apache-2.0 | Desktop via `wry` (same webviews as Tauri); native renderer Blitz experimental (evaluation) [repo] | As webview today | Not an exit from webviews |
| **Iced** | 0.14.0 · 2025-12-07 | MIT | Custom-drawn | **None shipped:** #552 "Implement accessibility support" open since 2020-10-05 [docs] | Not viable for WCAG AA |
| **egui** | 0.36.2 · 2026-09-08; 26 M total dl | MIT/Apache-2.0 | Immediate-mode, custom | AccessKit always on; live regions open (evaluation) [repo] | Misfit for a form-heavy app |
| **GPUI** | 0.2.2 · **2025-10-22** (no release in ~12 months) | Apache-2.0 | Custom | No AccessKit in the published crate (evaluation) [repo] | No widget library; tracks Zed's monorepo |
| **Freya** | 0.4.3; 0.5.0-rc.10 · 2026-10-11 | MIT | Skia, Dioxus-style | AccessKit current major (evaluation) [repo] | Small community; weekly rc churn |
| **Tauri 3 (CEF)** | tauri 3.0.0-alpha.4 · 2026-10-01 | MIT/Apache-2.0 | Same web UI | Browser AX tree | Alpha; removes engine divergence; large bundles; Windows unsandboxed [docs] |

**Slint licence note.** GPLv3 §13: "you have permission to link or combine any covered work with a work licensed under version 3 of the GNU Affero General Public License into a single combined work, and to convey the resulting work". GPL terms continue to apply to the covered part, and the AGPL §13 network terms apply to the combination [docs: gnu.org/licenses/gpl-3.0.txt]. So GPL-3.0-only Slint inside AGPL-3.0-only PlateVault is permitted. This **corrects** the 2026-08-17 toolkit evaluation's "incompatible" line. The Slint-vs-Tauri doc already "settled" it this way [repo]. Not legal advice.

---

## 10. Dependency classification for the dispatcher

| Finding | Class | Note |
|---|---|---|
| Spike metrics: size, cold start, RSS, matched VoiceOver/Narrator script on table, menus and text fields, for **both** spikes | **blocks** the final stack decision | Required input for §8 conditions 2 and 5 |
| Per-OS web-kit research (sibling bead) | **related** | Shared conclusion: a per-OS look means two component layers in any stack |
| `pv-win-*` window label (`apps/desktop/src/lib/window.ts:35`) vs `alm-win-*` capability glob (`apps/desktop/src-tauri/capabilities/default.json:5`) | **discovered-from** | Probable bug: windows opened from the command palette get no capability, so plugin and event APIs are denied. Static evidence only; reproduce before fixing. Independent of this decision. |
| Licence line in `docs/research/2026-08-17-gui-toolkit-evaluation.md` saying GPL-3.0-only is incompatible with AGPL-3.0-only | **discovered-from** | Contradicted by GPLv3 §13 and the Slint-vs-Tauri doc; needs a correction note |
| Bead acceptance says "saved under apps/prototype/design/" | **tracks** | This report is at `local://r9-flutter.md` per the dispatch brief; copying it into the repo is the dispatcher's call |
