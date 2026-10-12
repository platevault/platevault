# R9 — Updater: keep tauri-plugin-updater or switch? (bead astro-plan-ewpid)

Read 2026-10-12. Notation: `PV:<path>:<lines>` = PlateVault main checkout (`/Users/sjors/personal/dev/platevault`). `R:<crate>-<ver>/<path>:<lines>` = crate source in `~/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/`. `[n]` = numbered source in §11. **[INFERENCE]** = my reasoning, not observed. Builds on R9-BACKEND-SERVICES.md §3 (not repeated). Method follows skill://debate; an independent scout critique is folded into §9.

## 0. Answer

**Keep the current update scheme for now: the minisign key, the `latest.json` manifest and GitHub Releases. Do not switch to Velopack, MSIX or WinSparkle now.**

- **The serious alternative is Velopack.** It adds real features:
  - delta updates;
  - channels;
  - a downloaded update that survives a restart;
  - a quiet apply-after-exit on Windows.
- **It costs two things PlateVault cannot absorb yet.**
  - It has **no package signature**: it checks only the sha256 in the feed, and native signing is "future work" [V7]. Windows and macOS builds are not OS-signed today [PV-c]. So the switch would remove the only cryptographic check on updates.
  - Linux updates cover AppImage only; deb/rpm support is still an open request [V8].
- **The usability problems I found are integration and pipeline bugs, not updater limits.** All four (D1–D4, §1) can be fixed inside the current plugin. D1 is the worst: on Windows the app quits at launch whenever an update exists.
- **Your services-crate decision (2026-10-12) rules out `tauri-plugin-updater` inside that crate.** The plugin is a `tauri` crate and its builder needs an `AppHandle`. When the crate is created, swap the client library to **`cargo-packager-updater`**:
  - it is the framework-agnostic fork maintained by the Tauri/CrabNebula team;
  - it uses the same minisign scheme, **key and `.sig` files**, so no key bridge is needed;
  - it needs a second manifest file;
  - it does no in-app deb/rpm install.
- **Two conditional switches:**
  - **Sparkle 2 on macOS** is the one option that gives an OS-drawn update UI with release notes, auto-download-and-install, phased rollout and delta updates. That fits your "native = platform conventions". It must live in the window owner (it runs on the main thread with AppKit). It adds a second manifest and a second key.
  - **Velopack on Windows only** is the first switch to make once Authenticode exists and Windows is a main audience.
- **One owner decision is needed first.** J17 S2 says nothing is downloaded until the user clicks Install. Issue #888 (later) says download and verify immediately, then defer install. See D1.

Confidence: Medium-High (70%). Conditions: §8. Risks: §7.5.

## 1. What PlateVault ships today

| Item | Evidence |
|---|---|
| Pipeline | release-please creates the release. `tauri-action@v1` builds macOS, Windows and Linux, minisign-signs the bundles and uploads them plus `latest.json` (`uploadUpdaterJson`, `updaterJsonPreferNsis`). PV:.github/workflows/release-please.yml:14-23,144-170 |
| Manifest/key | `createUpdaterArtifacts: true`, `targets: all`. Endpoint `releases/latest/download/latest.json`. Minisign key ID `C332EF435C16EA58`. PV:apps/desktop/src-tauri/tauri.conf.json:44-45,60-64 |
| Signature format | The published `.sig` decodes to algorithm `ED`: minisign prehashed (Ed25519 over BLAKE2b-512). Checked by decoding v0.6.0's `latest.json`. |
| Client | `tauri-plugin-updater` 2.10.1 (locked) with `tauri-plugin-process` 2.3.1 (PV:Cargo.lock:6778-6806). The latest is 2.13.3, 2026-10-10 [C1]. The flow is frontend-driven: `check()` then `downloadAndInstall()` at app start, then `relaunch()` on user action (PV:apps/desktop/src/data/updateSubscription.ts:97-115,140-146). |
| Homebrew | Cask pinned to the 0.5.0 `.dmg`, `auto_updates true`, "ad-hoc signed but not Apple-notarized" [H1]. |
| Downloads (not installs) | GitHub asset counts, all six releases. Installers: 4 in total (v0.5.0 dmg 3, v0.2.0 setup.exe 1). Update payloads (`.app.tar.gz`, `setup.exe`, AppImage, deb, rpm): 0. `latest.json`: 5,853 (v0.6.0) and 9,636 (v0.5.0). **[INFERENCE]** The base installed from GitHub is very small, and the manifest hits are mostly CI/E2E/dev launches. Counts are not unique installs and miss source builds or other channels. |

**Defects found while reading. They are independent of the updater choice; classify each as `discovered-from` this bead.**

- **D1. A launch-time update check interrupts the user on Windows, MSI and deb/rpm.**
  - `checkForUpdate()` calls `downloadAndInstall()` straight after `check()` (updateSubscription.ts:114).
  - On Windows, install runs the NSIS/MSI installer through `ShellExecuteW` and then `std::process::exit(0)` (R:tauri-plugin-updater-2.10.1/src/updater.rs:787-866). So the app quits at startup.
  - On deb/rpm, install runs `pkexec dpkg -i` / `rpm -U` (updater.rs:1049-1122), so a polkit prompt appears at startup.
  - Only macOS and AppImage swap the bundle on disk and wait for the deferred relaunch (updater.rs:976-1047,1217-1300).
  - This breaks both written intents:
    - J17 S1: the check "never interrupts in-progress library work". S2: "nothing is ever downloaded, staged, or installed as a side effect of the passive startup check" (PV:docs/journeys/J17-software-update-install/journey.md:63-67,75-81).
    - #888, owner decision 2026-07-15, recorded as J17 G4 (journey.md:126): "download + signature-verify immediately, then let the user defer the restart/install".
  - **The two texts conflict, and the owner must pick one:**
    - (a) #888: call `download()` at check and `install()` on consent;
    - (b) J17 as written: check only, then download, verify and install on click.
  - Both are one call change. The plugin exposes `download()` and `install(bytes)` separately in JS and Rust (updater.rs:652-720) [T1].
  - [INFERENCE from source; not reproduced on Windows.]
- **D2. macOS users cannot update to 0.6.0.**
  - The v0.6.0 macOS leg failed at `security import: failed to import keychain certificate` (Actions run 29794487254).
  - So the published `latest.json` has no `darwin-*` keys (checked).
  - `get_urls` then returns `TargetsNotFound` (updater.rs:560-597): 0.5.0 Macs get "check failed", and the cask stays at 0.5.0.
- **D3. Turning on Windows signing (SignPath) would break Windows auto-update.**
  - The NSIS `setup.exe` is itself the updater artifact [T1]. Its `.sig` and `latest.json` are made over the unsigned bytes.
  - `sign-windows` then replaces the `.exe` and `.msi` with `gh release upload --clobber` (release-please.yml:263-329) and regenerates neither.
  - `code-signing.md:85-94` claims "enabling one does not touch the other". That is wrong for the updater artifact.
  - Fix: sign inside the build (`bundle.windows.signCommand`, PV:docs/development/code-signing.md:48-51), or re-sign with `tauri signer sign` and regenerate `latest.json` after Authenticode.
- **D4. Locked plugin is behind.** Fixed since 2.10.1 [T3]:
  - 2.13.2: on macOS, a failed install no longer deletes the installed app (needed for J17's "no partial install left on disk");
  - 2.11.0: an error is returned when the Windows installer fails to spawn (2.10.1 ignores the `ShellExecuteW` result), and a `restartAfterInstall` option;
  - 2.12.0: `allowDowngrades` moved into config;
  - 2.13.3: stricter Ed25519 checks via `minisign-verify` 0.3.

## 2. Comparison table

Cells are short; the numbers in brackets point to §11.

### 2a. Cross-platform engines

| Criterion | tauri-plugin-updater 2.13.3 (current) | cargo-packager-updater 0.2.3 | self_update 1.3.0 | Velopack 1.2.161 (`velopack` crate + `vpk`) |
|---|---|---|---|---|
| Delta updates | No; open request [T5] | No [INFERENCE: code mirrors Tauri] | No | **Yes**: zstd per-file patches, chains several, falls back to full [V2] |
| Background download / staged install | Download in memory. macOS/AppImage swap on disk, apply on relaunch. Windows, MSI and deb/rpm install = run installer; Windows exits [T1][T2] | Same model; Windows exits too (R:cargo-packager-updater-0.2.3/src/lib.rs:795-927) | Binary/`.app` swap; caller picks the moment (R:self_update-1.3.0/src/lib.rs:249-304) | Download persists in a packages dir (`get_update_pending_restart`). `wait_exit_then_apply_updates(silent)` applies after exit [V4] |
| Release notes UI | `notes` string; the app renders it [T1] | `notes`; the app renders | None | Markdown + HTML in the feed; the app renders [V5] |
| Channels | No built-in. Endpoints can be set at runtime in Rust, e.g. a `latest-beta.json` [T1] | Same (endpoints) | Per release asset | **Built-in** `--channel`, `ExplicitChannel` [V3][V4] |
| Staged rollout | No; needs a dynamic server [T1] or client bucketing [INFERENCE] | No | No | Paid **Velopack Flow** only [V6] |
| Rollback (downgrade to a known-good build) | `version_comparator` / `allowDowngrades` (2.12+). macOS restores the old app on a failed install (2.13.2) [T1][T3] | Comparator [INFERENCE] | Pin a version | `AllowVersionDowngrade`. A failed Windows apply relaunches the old version [V4][V10] |
| Signature | **Minisign (Ed25519), mandatory**. Pubkey settable at runtime for rotation [T1] | **Minisign**: same key and `.sig` files (lib.rs:145) | zipsign Ed25519ph, optional; accepts several keys (lib.rs:89-90,1021-1026) | **None**: feed sha256 only [V7]. Relies on OS code signing [V9] |
| Formats it updates | `.app` (via `.app.tar.gz`), NSIS, MSI, AppImage, **deb, rpm** [T1][T2] | NSIS, MSI, AppImage, `.app` (lib.rs:236-245) | Binary or archive, `.app`; "hand … to `dpkg -i` / `msiexec /i` yourself" (lib.rs:249-304) | Windows: Velopack `Setup.exe` (per-user) or MSI. macOS: `.pkg`/`.zip`, no DMG. Linux: **AppImage** [V9][V10][V11][V12]; deb/rpm request open [V8] |
| Elevation | macOS: AppleScript admin prompt if not writable. Windows: NSIS currentUser by default (no UAC), MSI per-machine. Linux: `pkexec` for deb/rpm (updater.rs:1112-1122,1260-1290; R:tauri-utils-2.10.1/src/config.rs:825-832) | osascript; NSIS/WiX installers | **Never escalates** (lib.rs:449-451) | None per-user on Windows; AppleScript in `/Applications`; `pkexec` for a privileged AppImage [V10][V11][V12] |
| Relaunch | `tauri-plugin-process` `relaunch()`; NSIS relaunches unless `restartAfterInstall: false` [T3] | Host restarts | `restart` module | `apply_updates_and_restart` or exit-apply with restart [V4] |
| Linux | AppImage, deb, rpm | AppImage | Binary | AppImage |
| CI change vs today | None | Second manifest (`macos-*` keys plus `format`, lib.rs:264-271,1124-1132) generated from `latest.json` | Replace pipeline | Replace bundler: .NET 8 + `vpk download/pack/upload --merge`; signing inside `vpk pack` [V1][V9][V13] |
| Maintenance / adoption | 2.13.3, 2026-10-10; 228 contributors (workspace); 11.8 M downloads [C1][G1] | Last release 2025-07-21. The `crates/updater` repo had commits on 2026-10-12 by Tauri/CrabNebula maintainers. 30 contributors; 53 k downloads [C1][G2] | 1.3.0, 2026-09-02; 38 contributors; 12.4 M downloads (CLI tools) [C1][G1] | 1.2.161, 2026-09-29; 207 contributors; 2.4 k stars; 122 k crate downloads; Squirrel successor [C1][G1][V14] |
| Services crate (no tauri types) | **No**: a `tauri` crate whose builder needs `AppHandle`; async | **Yes**; blocking `reqwest` client (lib.rs:147-148), so `spawn_blocking` | Yes; sync, optional async | **Yes**; blocking `UpdateManager` [V4] |
| Tauri / Flutter / Slint | Tauri only | All (Rust side; Flutter via FRB) | All | All; Flutter via FRB |
| Accessibility | App-drawn UI: the team owns WCAG | App-drawn | App-drawn | App-drawn; Windows install/update progress window [V10] |

### 2b. Platform-native and OS-managed

| Criterion | Sparkle 2.10 (macOS) | WinSparkle 0.9.4 (Windows) | MSIX + App Installer | Hydraulic Conveyor 22.3 |
|---|---|---|---|---|
| Delta | **Yes** (`BinaryDelta`, generated by `generate_appcast`; falls back to full) [S3] | No (full installer) [W2] | **Yes**: 64 KB block map [K1] | Yes [K1] |
| Background / staged | Background checks every 24 h; download and install on quit [S1] | Runs the installer; the app must quit [W2] | OS updates in the background, even when the app is closed [M1][K1] | Silent background, or update on launch [K1] |
| Release notes UI | **OS-drawn** dialog with HTML or Markdown (2.9+), localizable [S2] | Native dialog [W1] | None | Sparkle on macOS |
| Channels | `sparkle:channel`; requires every feed reader to run Sparkle 2 [S2] | Not in WinSparkle's extension list; "not all options are currently supported" [W2] | Separate `.appinstaller` [INFERENCE] | One site per update stream [K2] |
| Staged rollout | `phasedRolloutInterval`, 7 groups; **skipped for manual checks and critical updates** [S2] | No [W2] | No (Store flights only) [INFERENCE] | No [INFERENCE] |
| Rollback | None documented [INFERENCE] | No | `ForceUpdateFromAnyVersion` [M1] | Per platform |
| Signature | **EdDSA (Ed25519), required.** Optional signed feed (2.9+). Key rotation only for Developer ID-signed apps, EdDSA or certificate but not both [S1] | EdDSA, Sparkle-compatible [W1] | **Authenticode with a trusted cert, required** [M2] | Native per OS; self-signing needs a root-cert script [K1] |
| Formats | dmg/zip/tar/aar/pkg → swap `.app` [S1] | Any installer (NSIS `/S`, MSI `/passive`) [W2] | `.msix`/`.appinstaller`. Tauri cannot build MSIX (tauri#4818 open) [T6] | MSIX + EXE, macOS zip (no DMG), deb + apt repo; no RPM/AppImage [K1] |
| Linux | — | — | — | deb/apt only |
| Host fit | **Host-owned** (main thread, AppKit). Tauri: `tauri-plugin-sparkle-updater` 0.3.0 (one maintainer, 29 stars) or its host-agnostic `sparkle-updater` crate [S4]. Flutter: `auto_updater` 1.0.0, stale since 2024-10-27 (R9-FLUTTER-MIGRATION.md:120). Slint: `sparkle-updater` | C DLL with its own UI thread [W1] | Packaging change | Replaces all packaging; aimed at Electron/JVM/Flutter [K1] |
| Accessibility | AppKit dialog; VoiceOver support expected from AppKit [INFERENCE, unverified] | Win32 dialog [INFERENCE] | OS UI | OS UI |
| Maintenance | 2.10.0, 2026-09-13; 231 contributors; 9.8 k stars [G1] | v0.9.4, 2026-07-21; 60 contributors [G1] | OS component; `ms-appinstaller:` protocol disabled by default since Dec 2023 [M2] | Proprietary tool, free for OSI-licensed projects [K2] |

**Squirrel successors.** Squirrel.Windows has had no push since 2024-07-24. Clowd.Squirrel is archived (2024-03-03); Velopack is its migration target [G1][V14]. Squirrel.Mac is Electron's internal updater. None of these is a separate candidate.

**Linux convention.** The platform norm is a package repository (apt/dnf) or Flathub, not an app updating itself through `pkexec dpkg -i`. Conveyor's apt-repo model [K1] illustrates it. [INFERENCE]

## 3. Problem validation

- **Real problems:**
  - D1–D4, each fixable within the current scheme.
  - Your services-crate decision needs a client with no tauri types, which tauri-plugin-updater cannot meet.
- **Not shown to be needed yet:**
  - Delta updates. Payloads are 11 MB (NSIS) and 13.7 MB (`.app.tar.gz`); only the AppImage is large, at 88 MB (release asset sizes).
  - Staged rollout, given the download counts.
  - Velopack's silent apply-after-exit. J17 as written wants an explicit, user-started install.
- **Partly real.** OS-drawn macOS update UI matches your "native" definition. Among the evaluated options, only Sparkle (macOS) and WinSparkle (Windows) draw it.

## 4. Pros and cons of each serious switch

**Velopack, all platforms.**
- Pros:
  - Delta updates, channels, a downloaded update that survives a restart, and silent apply-after-exit (moderate) [V2][V4].
  - One host-agnostic Rust crate for every UI candidate (strong).
  - Active (strong).
- Cons:
  - **No update signature while builds are not OS-signed: a blocker** [V7]. The issue comment notes an app-side check on Windows comes "too late" for `Update.exe`.
  - deb/rpm users lose updates. That is an unknown-size product cost, not a measured minor one (major) [V8].
  - Replaces the Tauri NSIS/MSI/DMG outputs and the Homebrew `.dmg` URL, and changes the Windows install layout (major) [V9][V10][H1].
  - Signing must happen inside `vpk pack`, which may not fit SignPath's submit-artifact-then-wait flow (major) [V9] [INFERENCE on SignPath].
  - .NET in CI (minor).
  - Staged rollout is paid (minor).

**Velopack, Windows only (the critique's strongest counter-case).**
- Pros:
  - Persistent staging, silent apply-after-exit, deltas and channels where D1 hurts most.
  - Linux and macOS stay as they are.
- Cons:
  - The Windows payload loses its only package signature until Authenticode exists.
  - Two update engines behind one services-crate port.
  - NSIS/MSI installs have no in-place route; a bridge needs custom uninstall/reinstall code [V10].
- What fixing D1 already gives: no exit at launch, and install at a moment the user picks. Velopack adds the silent apply and deltas on an 11 MB payload.

**Sparkle on macOS.**
- Pros:
  - OS-drawn dialog, release notes, auto-download-and-install, a standard menu item, phased rollout (scheduled checks only), channels and deltas (strong) [S1][S2][S3].
  - EdDSA keeps the security level (strong).
- Cons:
  - Two update systems, manifests and keys (major).
  - Host-owned, so it sits outside the services crate (moderate).
  - The thin Tauri wrapper has one maintainer (moderate) [S4].
  - Key rotation needs Developer ID (moderate) [S1].
  - Not yet proven on this Tauri app: framework embedding, rpath, CI tools. Prototype needed.

**cargo-packager-updater (library swap for the services crate).**
- Pros:
  - No tauri types; same key and `.sig` files (strong).
- Cons:
  - No crates.io release for 15 months despite repo activity, so release cadence and security response are unproven (major).
  - No deb/rpm install (unknown size).
  - Blocking API (minor).
  - Second manifest (minor).

## 5. Alternatives

1. **Do nothing.**
   - Adequate on macOS (apart from D2) and AppImage.
   - Not adequate on Windows (D1 exit), MSI or deb/rpm (D1 prompts).
   - Blocks Windows signing (D3) and conflicts with the services-crate decision.
2. **Simplest viable.**
   - Fix D1–D4 inside tauri-plugin-updater.
   - Move the orchestration to Rust (`app.updater()?.check()`, then download and install per the D1 decision; R9-BACKEND-SERVICES §5 option 2).
   - No new dependency.
3. **When the services crate is created.** Same scheme, client swapped to cargo-packager-updater, plus a second manifest made in CI.
4. **Conditional.** Sparkle on macOS (window owner); Velopack on Windows.
5. **Rejected for now:**
   - MSIX: needs a trusted cert; Tauri cannot build it; AppData is containerized [K1].
   - WinSparkle: re-runs the full installer like NSIS today, so little gain.
   - Conveyor: proprietary; replaces every format; no DMG/AppImage/RPM.
   - self_update: no installer support.

## 6. Overengineering check

1. **Would doing nothing work?** No. D1 breaks Windows and deb/rpm usability today, and D3 blocks code signing.
2. **What is the simplest thing that works?** Alternative 2.
3. **Which parts solve problems we don't have yet?** Deltas, staged rollout, Velopack Flow, MSIX, and swapping the client before the services crate exists.
4. **What would a 48-hour ship cut?** Everything except D1 (one call change, after the owner picks J17 or #888) and D2 (repair the macOS signing step or turn it off).
5. **How hard is this to undo?**
   - Keeping the scheme: two-way door.
   - Swapping to cargo-packager-updater: reversible, since the key and `.sig` files are shared.
   - Velopack or Sparkle: each needs a bridge release per platform, and going back needs a second bridge. Velopack also drops the package signature while in use.

## 7. Migration steps

### 7.1 Keep the scheme and fix in place (recommended now)

1. Bump `tauri-plugin-updater` to 2.13.x (D4).
2. Move check, download and install into Rust and keep the phases (#873, #869). The UI subscribes to a `watch` state. On Windows, set `on_before_exit` to flush state before the installer runs [T1].
3. D1: owner picks (a) #888 or (b) J17 S2.
   - (a) `download()` at check; hold the bytes; `install()` on consent.
   - (b) `check()` only; `download()` and `install()` on click.
   - On Windows, `install()` exits the app, so call it only after consent.
   - Update the J17 text or close #888 to match.
4. D2: fix the certificate import, or set `ENABLE_MACOS_SIGNING` false so ad-hoc builds and `darwin-*` entries ship again. Then bump the cask.
5. D3: before turning on SignPath, sign in-build via `signCommand`, or re-sign `.exe`/`.msi` with `tauri signer sign` and regenerate `latest.json` after Authenticode. Correct code-signing.md:85-94.
6. Optional beta channel: on prereleases (a release-please prerelease config) publish `latest-beta.json`, and pick the endpoint in Rust from a setting [T1].
7. Minisign key rotation, if ever needed:
   - release N is signed with the old key and embeds the new pubkey (runtime `pubkey()` [T1]);
   - from N+1, sign with the new key;
   - keep the old secret until no pre-N clients remain.

### 7.2 Swap to cargo-packager-updater when the services crate exists (no key bridge)

1. CI: after `tauri-action`, a `jq` step turns `latest.json` into `update.json`:
   - `darwin-*` → `macos-*`;
   - NSIS → `format: "nsis"`; MSI → `"wix"`; `.app.tar.gz` → `"app"`; AppImage → `"appimage"`;
   - the same `signature` strings (lib.rs:236-271,1124-1132).
2. Release N ships the services-crate updater reading `update.json`, embedding the **same** minisign pubkey.
3. Old clients get N through `latest.json`, as now. Keep uploading `latest.json`; tauri-action emits it at no cost.
4. deb/rpm: show "update available" with a link (no in-app install), or publish an apt/dnf repo later.
5. Hedge: if no new release lands by the time of extraction, pin a git revision. The other option is to keep tauri-plugin-updater in the Tauri adapter behind the services crate's update port.

### 7.3 Add Sparkle on macOS (conditional)

1. Generate a Sparkle EdDSA key (`generate_keys`, export `-x`) and store it as a CI secret.
   - **[INFERENCE]** Reusing the minisign Ed25519 key would work mathematically: same curve, and the 32-byte public key is inside the minisign pubkey.
   - Avoid it. Minisign `ED` signs a BLAKE2b-512 hash while Sparkle signs raw bytes; one key across two protocols invites cross-protocol confusion.
2. App changes (window owner):
   - embed `Sparkle.framework` via `bundle.macOS.frameworks` (R:tauri-utils-2.10.1/src/config.rs:620);
   - add `SUFeedURL` and `SUPublicEDKey` to `src-tauri/Info.plist`, plus the `@loader_path/../Frameworks` rpath [S1][S4];
   - create `SPUStandardUpdaterController` on the main thread and add "Check for Updates…" to the app menu;
   - compile tauri-plugin-updater out on macOS.
   - Developer ID is recommended but not required for EdDSA updates; it is required for key rotation [S1].
3. CI macOS leg:
   - `ditto -c -k --keepParent` the `.app`;
   - fetch the previous archives;
   - write the release-please body to `PlateVault-<v>.md`;
   - run `generate_appcast --ed-key-file`;
   - upload `appcast.xml`, the zip and the `.delta` files. Feed URL: `releases/latest/download/appcast.xml` [S1]. [INFERENCE: Sparkle follows the GitHub redirect.]
4. **Bridge.**
   - Release N stays listed under `darwin-*` in `latest.json`, signed with minisign, so old Macs swap to N, which contains Sparkle.
   - Keep emitting `darwin-*` minisign entries, so Macs that skip N still reach a Sparkle build.
   - From N on, EdDSA covers macOS.

### 7.4 Switch to Velopack (only under §8 conditions; Windows first)

1. Prerequisites:
   - Authenticode (and Developer ID if macOS moves too), or Velopack native package signatures (#975) [V7][V9];
   - an owner decision on losing deb/rpm updates [V8].
2. CI per OS:
   - `tauri build --no-bundle` (`--bundles app` on macOS);
   - `actions/setup-dotnet` 8 and a pinned `vpk`;
   - `vpk download github` (previous release, for deltas);
   - `vpk pack -u PlateVault -v $V -p <dir> --channel <os>-<arch>-stable --releaseNotes notes.md` (`--framework webview2` and sign flags on Windows);
   - `vpk upload github --merge --tag $TAG`, merging into the release-please release [V1][V3][V13].
3. **Bridge.** The last minisign hop is the bridge. **After it there is no update-signing key**: sha256, HTTPS and OS code signing only.
   - **Windows NSIS/MSI.** No in-place route. Release N's Rust code:
     1. downloads Velopack `Setup.exe` and a minisign `.sig` signed with the current key;
     2. verifies it and runs it;
     3. silently uninstalls the NSIS/MSI copy, keeping the data dir;
     4. re-points autostart, shortcuts and file associations at `%LocalAppData%\PlateVault` [V10].
   - **macOS and AppImage.** `latest.json` for release N points at the Velopack-built `.app` (tarred) and AppImage, minisign-signed. Tauri's updater swaps them in place. Velopack bundles still update after being moved [V11][V12]. [INFERENCE: a Velopack `.app` updates without the `.pkg` having run.]
   - With today's download counts, a one-time "please reinstall" notice in N is a defensible substitute [INFERENCE].
4. Optional app-side Ed25519 check of the `.nupkg` before apply. It is partial on Windows [V7].

### 7.5 Risks

1. **Trust downgrade (Velopack).** Without Authenticode or Developer ID, a stolen GitHub token could ship a malicious Velopack update; today minisign blocks that [V7].
2. **D3 is latent.** Enabling `ENABLE_WINDOWS_SIGNING` as wired breaks every Windows update, because the signature no longer matches.
3. **D2 spreads.** Every release with a failed macOS leg strands Mac clients and the cask; nothing stops the release.
4. **cargo-packager-updater release gap.** Its fixes may not reach crates.io (§7.2 hedge).
5. **Two-updater drift (Sparkle).** Separate manifests and keys can diverge, and a missed `darwin-*` entry strands pre-bridge Macs.
6. **Bridge failure is permanent for affected clients.** A broken bridge leaves them on manual reinstall. Prototype each bridge on a VM before release N.
7. **Key custody.** Losing the minisign secret strands all clients (no rotation possible) [T1]. A Sparkle key loss without Developer ID is the same [S1].
8. **Homebrew.** A DMG→zip/pkg change (Velopack/Conveyor) breaks `homebrew-bump.yml` and the cask URL [H1].

## 8. Conditional verdict

- **Keep the scheme (7.1), and do 7.2 when the services crate is created, IF any of these hold:**
  - Windows and macOS remain unsigned in the near term;
  - deb/rpm remain supported;
  - deltas and rollout are not measured needs.
- **Add Sparkle (7.3) IF all hold:**
  - macOS is a primary audience;
  - a prototype on this Tauri app passes (embedding, CI appcast, VoiceOver check);
  - the native dialog is preferred over one shared in-app notice;
  - Developer ID is ideally in place.
- **Switch Windows to Velopack (7.4) IF all hold:**
  - Authenticode is live, or Velopack ships native package signatures (#975);
  - Windows is the main audience;
  - silent apply-after-exit or deltas are wanted beyond the D1 fix.
  - Extend to Linux/macOS only when #370 (deb/rpm) lands or deb/rpm are dropped.
- **Revisit MSIX IF** Tauri ships MSIX (#4818) and a trusted Windows cert exists.
- **This does NOT make sense IF** one in-app update UI on every OS with no per-OS packaging work is the goal. Then 7.1/7.2 is the end state.

**Confidence**

| Claim | Confidence |
|---|---|
| Fix rather than switch | High (80%) |
| cargo-packager-updater as the services-crate client | Medium (60%) |
| Sparkle as the right future macOS step | Medium (55%) |

**Dependency edges for the dispatcher**

| Edge | Type |
|---|---|
| This finding → services-crate updater implementation (choice of client) | `blocks` |
| This finding ↔ UI-stack beads | `related` |
| D1–D4 | `discovered-from` this bead |
| D3 → enabling `ENABLE_WINDOWS_SIGNING` | `blocks` |
| J17-vs-#888 owner decision → the D1 fix | `blocks` |

## 9. Independent critique (scout `UpdaterCritic`, read-only)

**Strongest counterargument.** Switch Windows to Velopack now behind the Rust services boundary: Windows is where the startup check quits the app, and Velopack gives persistent staging, apply-after-exit, deltas and channels. Linux can stay on its current path.

**Disposition**

| Point | Disposition |
|---|---|
| J17 S2 says no download until the user clicks; that contradicts #888 and my "hold bytes" fix | **Accepted.** D1 now records the conflict as an owner decision; both fixes are listed (7.1 step 3) |
| Download counts are not unique installs; Linux base unknown | **Accepted.** Relabelled [INFERENCE]; deb/rpm loss is now "unknown size", not minor |
| Sparkle does not require Developer ID for EdDSA updates | **Accepted.** Developer ID is recommended, and required only for key rotation |
| Sparkle phased rollout skips manual checks and critical updates; channels need Sparkle 2 clients | **Accepted.** Added to table 2b |
| Tauri install-on-quit is speculative; `ShellExecuteW` result unchecked in 2.10.1 | **Accepted.** Claim removed from §3; 2.11.0 spawn-error fix added to D4 |
| cargo-packager-updater repo commits do not prove release support | **Accepted.** Rated major; hedge added (7.2 step 5) |
| Services-crate fit lacks API-style and a11y comparison | **Accepted.** Blocking/async noted; accessibility row added |
| "Only Sparkle provides native UX", "one-way" and "handful" overreach | **Accepted.** Reworded |
| Windows-only Velopack now | **Partly deflected.** The D1 fix removes the exit-at-launch harm with no trust change. The remaining gain (silent apply, deltas on 11 MB) does not outweigh dropping the only package signature while Authenticode is absent. Kept as the first conditional switch (§8) |

**Citation check.** 8 of 8 passed: updater.rs:787-866, updateSubscription.ts:114, release-please.yml:263-329, cargo-packager-updater lib.rs:236-271 and 1124-1132, velopack#975, Sparkle publishing (rollout/channels), self_update lib.rs:449-451.

## 10. What was not checked

- **No runtime check.** The D1 Windows and deb/rpm behaviour comes from source and was not reproduced.
- **No prototype.** No Sparkle or Velopack bridge was built.
- **No VoiceOver/Narrator check** of any updater UI.
- **SignPath fit is inferred.** Whether SignPath supports per-file synchronous signing for `signCommand` or `vpk --signTemplate` was not checked.

## 11. Sources

- [T1] Tauri updater docs, https://v2.tauri.app/plugin/updater/ (read 2026-10-12): signing mandatory; artifacts ("setup.exe … will be re-used by the updater"); runtime endpoints and pubkey; `version_comparator`; Windows quit-before-install and `on_before_exit`; `download()`/`install()` split.
- [T2] R:tauri-plugin-updater-2.10.1/src/updater.rs:560-597 (target lookup), 652-731 (download in memory, verify, install), 787-866 (Windows `ShellExecuteW` + `exit(0)`), 976-1122 (AppImage; deb/rpm via pkexec), 1217-1300 (macOS swap, osascript); src/commands.rs:98-182.
- [T3] Updater CHANGELOG, https://github.com/tauri-apps/plugins-workspace/blob/v2/plugins/updater/CHANGELOG.md (2.11.0 spawn error + `restartAfterInstall`; 2.12.0 `allowDowngrades`; 2.13.2 macOS restore; 2.13.3 minisign-verify 0.3).
- [T5] tauri-apps/tauri#11863 "binary diff updater for tiny updates" (open, updated 2026-09-27).
- [T6] tauri-apps/tauri#4818 "Build MSIX Packages" (open, updated 2026-09-06).
- [V1] https://docs.velopack.io/getting-started/rust (`vpk` needs the .NET 8 SDK).
- [V2] https://docs.velopack.io/packaging/deltas.
- [V3] https://docs.velopack.io/packaging/channels.
- [V4] https://docs.rs/velopack/latest/velopack/struct.UpdateManager.html and `struct.UpdateOptions.html`.
- [V5] https://docs.velopack.io/integrating/release-notes.
- [V6] https://docs.velopack.io/distributing/Flow/tiered-rollout.
- [V7] https://github.com/velopack/velopack/issues/975 (open; "the only thing we've verified about that bundle is the sha256 from the feed"; native package signature is future work; app-side check "comes too late" for `Update.exe`).
- [V8] https://github.com/velopack/velopack/issues/370 (deb/rpm, open).
- [V9] https://docs.velopack.io/packaging/signing ("signing needs to be performed by Velopack itself").
- [V10] https://docs.velopack.io/packaging/operating-systems/windows.
- [V11] https://docs.velopack.io/packaging/operating-systems/macos.
- [V12] https://docs.velopack.io/packaging/operating-systems/linux.
- [V13] https://docs.velopack.io/distributing/github-actions; `--merge` in https://docs.velopack.io/reference/cli/content/vpk-windows.
- [V14] https://docs.velopack.io/migrating/squirrel.
- [S1] https://sparkle-project.org/documentation/.
- [S2] https://sparkle-project.org/documentation/publishing/.
- [S3] https://sparkle-project.org/documentation/delta-updates/.
- [S4] https://github.com/ahonn/tauri-plugin-sparkle-updater (0.3.0 on crates.io 2026-09-19; `sparkle-updater` crate; pins Sparkle 2.9.6).
- [W1] https://github.com/vslavik/winsparkle (README).
- [W2] https://winsparkle.org/guides/publishing-updates/.
- [M1] https://learn.microsoft.com/en-us/windows/msix/app-installer/auto-update-and-repair--overview.
- [M2] https://learn.microsoft.com/en-us/windows/msix/app-installer/installing-windows10-apps-web.
- [K1] https://conveyor.hydraulic.dev/latest/package-formats/ and https://conveyor.hydraulic.dev/latest/.
- [K2] https://hydraulic.dev/pricing.html.
- [C1] crates.io API, read 2026-10-12: tauri-plugin-updater 2.13.3 (2026-10-10, 11.8 M downloads); cargo-packager-updater 0.2.3 (2025-07-21, 53.5 k); self_update 1.3.0 (2026-09-02, 12.4 M); velopack 1.2.161 (2026-09-29, 121.7 k); minisign-verify 0.3.0 (2026-09-25).
- [G1] GitHub API, read 2026-10-12.
  - velopack/velopack: 1.2.161, 207 contributors, 2,383 stars.
  - sparkle-project/Sparkle: 2.10.0, 231 contributors, 9,827 stars.
  - vslavik/winsparkle: v0.9.4, 60 contributors.
  - tauri-apps/plugins-workspace: 228 contributors.
  - jaemk/self_update: 38 contributors.
  - Squirrel.Windows: last push 2024-07-24. Clowd.Squirrel: archived 2024-03-03.
- [G2] crabnebula-dev/cargo-packager commits under `crates/updater`, 2026-10-12.
- [H1] platevault/homebrew-tap `Casks/platevault.rb` (0.5.0, `auto_updates true`, ad-hoc/not notarized).
- [PV-c] PV:docs/development/code-signing.md:3-8 (no OS signing), 48-51 (`signCommand`), 85-94 (coexistence claim); PV:.github/workflows/release-please.yml:263-329.
