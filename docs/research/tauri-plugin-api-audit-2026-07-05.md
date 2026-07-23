# Tauri Plugin & JS-API Adoption Audit — PlateVault

Date: 2026-07-05
Scope: Every official Tauri v2 plugin, notable community plugins, and every
Tauri v2 JS-API namespace, graded against PlateVault's actual codebase and
architecture (Tauri v2 + React desktop shell; Rust core + SQLite canonical;
UI↔core via language-neutral contracts).

Evidence is cited as `path:line`. All paths are repo-relative. Nothing in this
document changes code — it is a triage input for backlog items.

---

## 0. Architecture lens (how every candidate is graded)

Per the constitution (`.specify/memory/constitution.md`):

- **SQLite + the Rust core are canonical.** Every UI→core call goes through the
  contract boundary (`packages/contracts` / `crates/contracts/core` /
  tauri-specta typed `commands`).
- **Reviewable filesystem mutation** — every move/copy/delete is a reviewable
  plan applied through the core, with an audit record.
- **Local-first custody + PixInsight boundary** — the app never processes
  images; it organizes, maps, plans.

Therefore:

- **Shell-level plugins** (dialog, opener, window-state, single-instance,
  updater, notification, native menu/tray, `app.setTheme`, global-shortcut,
  autostart, deep-link, log, positioner) do **not** cross the contract boundary
  — this is where the wins are.
- **Data-path plugins that let the webview talk directly to disk/db/state**
  (sql, fs, fs-pro, store-for-canonical-data, stronghold, cache, persisted-scope)
  are **BOUNDARY RISKS** — they would bypass the Rust core, its contracts, and
  the audit/reviewable-plan guarantees. Flagged, not recommended for core data.

---

## 1. Executive summary

### Top recommended adoptions (ranked by value ÷ effort)

| # | Item | Verdict | Effort | Why it's worth it |
|---|------|---------|--------|-------------------|
| 1 | **plugin-single-instance** | ADOPT-enhance | S | Two app instances open the same canonical SQLite store simultaneously → lock contention / racey writes to the durable record. A single-instance guard is the cheapest protection for the canonical store. No frontend change. |
| 2 | **plugin-window-state** | ADOPT-enhance | S | We persist *no* window geometry today (`tauri.conf.json` hard-codes 1280×820; no `window_state`/`WindowState` anywhere). One `.plugin(init())` line + one capability gives remembered size/position across restarts. |
| 3 | **`app.setTheme` (JS `app` namespace)** | ADOPT-enhance | S | We have 4 CSS themes via `data-theme` only (`apps/desktop/src/data/theme.ts:73`); the **native OS window chrome/titlebar** never follows (setTheme is desktop-only and affects native chrome ONLY — never our webview CSS, so it complements rather than replaces our themes). Calling `setTheme('dark'\|'light'\|null)` from `initAppearance()` maps our 4 themes → nearest light/dark for the titlebar. |
| 4 | **plugin-log** | ADOPT-enhance | S | Rust logging is stdout-only via `tracing_subscriber` (`apps/desktop/src-tauri/src/main.rs:15`); nothing is persisted to a log file on disk. plugin-log writes rotating logs to the app log dir for user bug reports. (Audit trail already lives in SQLite — this is diagnostics, not the audit record.) |
| 5 | **plugin-notification** | ADOPT-enhance | M | We run long background tasks (ingest-resolution drain `lib.rs:637`, manifest workflow subscriber `lib.rs:732`, 5-min settings snapshot `lib.rs:767`) and long plan-applies, but never fire an OS notification on completion (no `plugin-notification`/`sendNotification` anywhere). Native "Scan complete / Plan applied" toasts improve the long-running-op UX. |
| 6 | **plugin-updater** | ADOPT-enhance | L | Only a manual CI/release pipeline exists (`.github/workflows/ci.yml`, `e2e.yml`; no `updater`/`checkUpdate` wired). In-app update check closes the loop, but needs signing keys + release-asset/endpoint infrastructure — hence L. |
| 7 | **plugin-autostart** | ADOPT-enhance | S | Optional "launch at login" for users who want the background resolver drain warm. Low effort, opt-in setting. Nice-to-have, not essential. |
| 8 | **plugin-global-shortcut** | ADOPT-enhance | S | Optional global hotkey to summon/focus the window (we already have an in-app Command Palette, `CommandPalette.tsx`). Marginal for a non-tray desktop app; lowest of the eight. |

### Top boundary-risk "do NOT adopt for X" warnings

1. **plugin-sql — do NOT use for app data.** Lets the webview run SQL directly
   against SQLite, bypassing the Rust core + contracts + audit. Direct
   constitution violation (canonical store must stay behind the core). The
   backend already owns SQLite via `sqlx` (`lib.rs:647`).
2. **plugin-fs / tauri-plugin-fs-pro — do NOT use for library data.** Frontend
   direct disk access bypasses reviewable-plan mutation and the audit record
   (Principle II). All FS work already flows through the planner/core. fs-pro's
   extras (metadata, size, compression) belong in the Rust metadata crates, not
   the webview.
3. **plugin-store — only for ephemeral UI prefs, never canonical data.** Note
   `apps/desktop/src/features/setup/sources-store.ts` stashes the source list in
   `localStorage` (`:78`,`:110`,`:131`) — that is registration-shaped state; if
   anything canonical lives there it should move *into the core*, not sideways
   into plugin-store.
4. **tauri-plugin-cache — do NOT adopt.** A frontend cache layer duplicates
   state the Rust core + SQLite already own (e.g. the SIMBAD resolver cache lives
   in the DB, `lib.rs:669`). Caching belongs behind the contract boundary.
5. **stronghold / persisted-scope — not applicable.** No secrets vault need; and
   persisted-scope is only relevant if we granted the webview an fs scope (we do
   not, and should not).

### Where a thin Rust crate beats the plugin (third axis)

For any capability that is **core/business/domain logic or crosses the contract
boundary**, a thin Rust crate in a narrow shared crate (per CLAUDE.md's "small
Rust crates with narrow responsibility") is the better, more portable choice than
a frontend plugin. Full per-capability 3-way verdicts are in **§2d**. The clear
"Rust crate wins" calls:

- **Caching → `moka` (already `0.12.15` in our workspace), NOT tauri-plugin-cache.**
  We already cache with moka in `crates/app/projects/src/project_health.rs`. A
  ~10-50-line shared wrapper (or reuse moka directly) keeps cache state canonical
  in Rust; a frontend cache plugin would fork state away from the DB/core.
- **FS watching → `notify` (already `7.0.0`), NOT any plugin.** Already used in
  `crates/fs/inventory/src/watcher.rs` + `artifact_watcher.rs`. Correct as-is.
- **Path handling → `camino` `Utf8Path` (already `1.2.2`), NOT `@tauri-apps/api/path`.**
  Already the core's path type across `crates/fs/*`. Frontend keeps `pathe` for
  display-only splitting.
- **SQL → `sqlx` (already `0.9.0`), NOT tauri-plugin-sql.** Canonical store; the
  plugin would breach the boundary.
- **HTTP → `reqwest` (already `0.13.3`), NOT tauri-plugin-http.** External calls
  (SIMBAD) belong in the core resolver, where they already are.
- **External process launch → `std::process::Command`, NOT tauri-plugin-shell.**
  Tool launch already uses std::process in `crates/workflow/profiles/src/launch.rs:143`;
  exposing a shell to the webview is a security/boundary risk.
- **Directory walking → `walkdir`/`ignore` in the core** if/when scan traversal is
  formalized (not currently a dependency) — a core concern, never a plugin.

Version note: the `mcp-package-version` MCP server has **no crates.io checker**
(npm/PyPI/Maven/Go/Gradle/Swift/Docker/GH-Actions only), so in-tree crate
versions are exact from `Cargo.lock`; out-of-tree candidate crates are cited at
last-known-stable and marked **"verify on crates.io before adding."**

### Already correctly adopted (no action)

- **plugin-dialog** — registered `lib.rs:595`; used by Rust pick commands
  (`commands/native.rs`, `native_file_pick`/`native_directory_pick`) and JS-side
  save dialog (`app/LogPanel.tsx:209`). Capability `dialog:default`,
  `dialog:allow-open` (`capabilities/default.json`).
- **plugin-opener** — registered `lib.rs:596`; reveal routes through the core
  command `native_reveal` which calls `app.opener().reveal_item_in_dir(...)`
  with a Linux `xdg-open` fallback (`commands/native.rs:118`,`:131`). Capability
  `opener:allow-reveal-item-in-dir`. Correctly routed through core for audit
  correlation (entityKind/entityId).
- **`@tauri-apps/api/webviewWindow`** — multi-window open
  (`apps/desktop/src/lib/window.ts:30`).
- **tauri-plugin-mcp-bridge** (dev only, `lib.rs:607`) and
  **tauri-plugin-webdriver** (e2e feature, `lib.rs:618`) — test tooling.

---

## 2. Full triage table

### 2a. Official plugins

| Item | What it does | Our current state (evidence) | Verdict | Rationale | Effort | Boundary note |
|------|--------------|------------------------------|---------|-----------|--------|---------------|
| **dialog** | Native open/save/message dialogs | Registered `lib.rs:595`; Rust `native_file_pick`/`native_directory_pick` (`commands/native.rs`); JS save `LogPanel.tsx:209`; caps `dialog:default`,`dialog:allow-open` | ALREADY-USE | Correctly wired both sides | — | Clean — dialogs return paths that the core validates |
| **opener** | Open files/URLs in external apps; reveal in file manager | Registered `lib.rs:596`; `native_reveal` → `opener().reveal_item_in_dir` + xdg-open fallback (`commands/native.rs:118`); cap `opener:allow-reveal-item-in-dir` | ALREADY-USE | Reveal routed through core for audit | — | Note: `lib/window.ts:25` uses raw `window.open` for the browser fallback only; Tauri path uses webviewWindow — fine |
| **single-instance** | One running instance; forwards argv to the primary | Not found (no `single_instance`/lock/mutex) | ADOPT-enhance | Protects canonical SQLite from concurrent-instance write races | S | Desktop-only; pure shell — no boundary issue |
| **window-state** | Persist window size/position | Not found; geometry hard-coded `tauri.conf.json` (`width:1280,height:820`) | ADOPT-enhance | Zero-cost UX win; no geometry persistence today | S | Shell-only; writes its own state file, not app data |
| **notification** | Native OS notifications | Not found (no `plugin-notification`/`sendNotification`); only in-app toasts | ADOPT-enhance | Notify on scan/plan-apply/background-drain completion | M | Shell-only; needs a permission prompt on first use |
| **updater** | In-app update check/apply | Not found; manual CI only (`.github/workflows/*.yml`) | ADOPT-enhance | Closes release loop | L | Needs signing keys + update endpoint/asset infra |
| **log** | Configurable logging to file/stdout/webview | Rust stdout-only `tracing_subscriber` (`main.rs:15`); webview log forwarder exists (`commands/log`, `lib.rs:724`); no file sink | ADOPT-enhance | Persist diagnostics to app log dir for bug reports | S | Diagnostics only — the *audit* record stays in SQLite |
| **autostart** | Launch at login | Not found | ADOPT-enhance | Opt-in; keeps resolver drain warm | S | Shell-only |
| **global-shortcut** | System-wide hotkeys | Not found; in-app Command Palette exists (`app/CommandPalette.tsx`) | ADOPT-enhance | Optional summon/focus hotkey | S | Marginal for non-tray app |
| **clipboard-manager** | Read/write system clipboard from JS/Rust | Hand-rolled `navigator.clipboard.writeText` (`shared/native/reveal.ts:115`, `dev/SchemaViewer.tsx:62`) | SKIP | Browser API already works in the webview; plugin adds a dependency for parity with little gain (only wins if we need clipboard *read* or non-secure-context support) | S | No boundary issue either way |
| **positioner** | Move window to screen corners / relative to tray | Not found; single normal main window (`tauri.conf.json`) | NOT-A-FIT | Only useful for tray/popover apps; we are a standard windowed app | — | — |
| **os** | Read OS info (platform, arch, version) | Not used from JS; Rust has `cfg!`/`std::env::consts` as needed | SKIP | Frontend rarely needs OS facts; `pathe` already handles cross-platform path display | S | — |
| **process** | Exit/relaunch the app | Not found | SKIP | No current need; would pair with updater (relaunch after apply) if #6 lands | S | Shell-only |
| **sql** | Frontend talks to SQLite via sqlx | Backend owns SQLite via `sqlx` (`lib.rs:647`); frontend never touches DB | NOT-A-FIT-boundary | Would bypass core + contracts + audit; constitution violation | — | **Boundary risk — do not adopt** |
| **fs** | Frontend filesystem access | All FS via core planner/inventory crates; frontend uses `pathe` for display only | NOT-A-FIT-boundary | Bypasses reviewable-plan mutation + audit (Principle II) | — | **Boundary risk — do not adopt for data** |
| **store** | Persistent key-value store (file-backed) | Many `localStorage` keys (see §3); no plugin-store | SKIP | `localStorage` already covers ephemeral UI prefs; migrating buys little. If adopted, restrict to ephemeral UI state only | M | **Never for canonical data** (see sources-store note) |
| **stronghold** | Encrypted secrets DB | Not found; no secrets stored | NOT-A-FIT | No credential/secret storage need (SIMBAD is unauthenticated) | — | — |
| **http** | Rust-backed HTTP client callable from JS | Rust uses `reqwest` for SIMBAD (`crates/targeting/resolver/Cargo.toml:32`); frontend makes no external HTTP | NOT-A-FIT-boundary | External calls belong in the core (resolver), not the webview | — | Keep network behind the core |
| **upload** | HTTP file up/download with progress | Not found; no upload feature | NOT-A-FIT | Local-first app; no server to upload to | — | — |
| **websocket** | Rust WS client from JS | Not found (MCP bridge WS is dev-only, `lib.rs:607`) | NOT-A-FIT | No product WS need | — | — |
| **cli** | Parse CLI args | Not found | SKIP | GUI app; no CLI surface planned | S | — |
| **localhost** | Serve frontend over localhost in prod | Not used; standard `frontendDist` bundling (`tauri.conf.json`) | SKIP | Only needed for specific asset-loading workarounds | — | — |
| **persisted-scope** | Persist runtime fs/asset scope grants | Not found | NOT-A-FIT | Only relevant if we granted the webview an fs scope (we don't) | — | Coupled to the fs boundary risk |
| **barcode-scanner** | Camera barcode/QR scan | n/a | NOT-A-FIT | Mobile-only; desktop app | — | — |
| **biometric** | Fingerprint/face auth | n/a | NOT-A-FIT | Mobile-only | — | — |
| **nfc** | NFC read/write | n/a | NOT-A-FIT | Mobile-only | — | — |
| **geolocation** | Device GPS | n/a | NOT-A-FIT | Mobile-only (astro coords come from FITS/user input, not device GPS) | — | — |
| **haptics** | Vibration feedback | n/a | NOT-A-FIT | Mobile-only | — | — |

### 2b. JS-API namespaces (`@tauri-apps/api`)

| Namespace | What it does | Our current state (evidence) | Verdict | Rationale | Effort | Boundary note |
|-----------|--------------|------------------------------|---------|-----------|--------|---------------|
| **app** | App metadata (`getVersion`/`getName`/`getIdentifier`) + `setTheme` + macOS `show`/`hide`/`setDockVisibility` | `setTheme` NOT used; theme is CSS `data-theme` only (`data/theme.ts:73`, `main.tsx:15`) | ADOPT-enhance | `setTheme('light'\|'dark'\|null)` sets the **native OS window chrome/titlebar ONLY** (never webview CSS), desktop-only. Map our 4 themes → nearest light/dark | S | Shell-only; complements (does not replace) our CSS themes |
| **event** | `emit`/`listen` app-wide events | Used implicitly via tauri-specta typed events (`builder.mount_events`, `lib.rs:623`) and log channel (`lib.rs:724`) | ALREADY-USE | Event bus already wired through specta | — | Typed events preserve the contract shape |
| **menu** | Native app/context menus | Not found (no `MenuBuilder`/`tauri::menu`) | ADOPT-enhance | A minimal native menu (About / Check for updates / Preferences / Quit) is expected desktop polish, esp. on macOS. Low priority but low effort | S | Desktop-only; shell |
| **path** | Async cross-platform path helpers + app dirs | Frontend uses `pathe` (sync) for basename/dirname (`shared/native/picker.ts:12`, `projects/ToolLaunchesAccordion.tsx:14`); some ad-hoc basename (`inbox/InboxDetail.tsx:76`, `inbox/InboxControls.tsx:33`) | SKIP (mostly) | `@tauri-apps/api/path` is *async* — worse DX than `pathe` for pure display splitting. Worth using only for app-dir discovery (`appLogDir`, `appDataDir`) if plugin-log/store land | S | Real path *resolution* must stay in the Rust `patterns` crate; frontend split is display-only, keep it that way |
| **window** | Current-window control (`getCurrentWindow`: title, size, theme, minimize) | Not directly used (config-driven window) | ADOPT-enhance (thin) | `getCurrentWindow().theme()`/`onThemeChanged` complements `app.setTheme` for `system` theme following; also enables custom titlebar later | S | Shell-only |
| **webviewWindow** | Create/manage webview windows from JS | Used for multi-window (`lib/window.ts:30`, `WebviewWindow(...)`); cap `core:webview:allow-create-webview-window` | ALREADY-USE | Multi-window ledger view (spec 020) | — | Clean |
| **webview** | Lower-level webview control | Not directly used | SKIP | webviewWindow covers our needs | — | — |
| **dpi** | Physical/logical pixel + size/position types | Not directly used | SKIP | Only needed alongside manual window/positioner math | — | — |
| **tray** | System tray icon + menu | Not found (no `TrayIconBuilder`) | SKIP | We are not a background/tray app; would only matter if a "minimize to tray + background resolver" feature is wanted later | M | Desktop-only |
| **image** | In-memory image type for icons/tray | Not used | NOT-A-FIT | Only needed by tray/menu icons; and image *processing* is out of scope (PixInsight boundary) | — | Note: this is icon plumbing, unrelated to astro image processing |
| **core** | `invoke<T>` (our IPC), `Channel<T>` (streaming), `convertFileSrc` (device path→webview asset URL), Resource handles, `isTauri`, `checkPermissions` | IPC via tauri-specta `commands` bindings; `Channel` already used for streaming `plans.apply`; `isTauri` hand-checked via `__TAURI_INTERNALS__` (`lib/window.ts:10`) and `VITE_USE_MOCKS` (`shared/native/reveal.ts:66`) | ALREADY-USE | All IPC + streaming already flow through the typed contract surface. Minor: could swap the hand-rolled `__TAURI_INTERNALS__` sniff for `core.isTauri()`; `convertFileSrc` is the sanctioned way if we ever render local image previews (device path → asset URL) without violating the boundary | S | Core of the contract boundary — keep all IPC typed |
| **mocks** | `mockIPC`/`mockWindows` for tests | Repo has its own mock runtime (`api/mocks.ts`, `VITE_USE_MOCKS`) | ALREADY-USE (equivalent) | Existing mock layer already serves this role; per testing guide the real-stack layers are preferred anyway | — | — |

### 2c. Community plugins (from awesome-tauri + user-flagged)

| Item | What it does | Verdict | Rationale | Boundary note |
|------|--------------|---------|-----------|---------------|
| **tauri-plugin-cache** (user-flagged) | Frontend key-value cache with TTL | NOT-A-FIT-boundary | Duplicates state the core + SQLite already own (e.g. SIMBAD cache in DB, `lib.rs:669`). A webview cache would drift from the canonical store | **Do not adopt** |
| **tauri-plugin-fs-pro** (user-flagged) | Extends official `fs`: richer metadata (size, mime, timestamps), path helpers, compression, transfer | NOT-A-FIT-boundary | All of these belong in the Rust metadata/fs crates behind the contract boundary; exposing them to the webview bypasses reviewable-plan mutation + audit. Its "extra metadata" overlaps our `crates/metadata/*` responsibilities | **Do not adopt for data**; if we ever want the *extras*, add them to the Rust core, not the webview |
| **tauri-plugin-window-state** | (Now an official plugin — see §2a window-state) | ADOPT-enhance | Same as official window-state | Shell-only |
| **tauri-plugin-drag / drag-drop** | Native OS drag-in/drag-out of files | ADOPT-enhance (future) | Could power "drag a folder onto the app to register a source". Note Tauri core already emits `tauri://drag-drop` webview events — evaluate the built-in event before adding a plugin | Files dropped must still be registered *through the core* |
| **tauri-plugin-prevent-default** | Disable browser shortcuts/context-menu/refresh in prod | ADOPT-enhance (quick) | Desktop apps typically suppress F5/reload, text-selection caret, native ctx-menu in release. Low effort polish | Shell-only |
| **tauri-plugin-theme** (community) | Dynamic runtime theme incl. native | SKIP | `app.setTheme` (official) covers the native-sync need; our CSS themes are already handled | Superseded by app.setTheme |

Note on sourcing: the official plugin set and JS namespaces were confirmed
against `https://v2.tauri.app/plugin/`. Community-plugin details are from
recollection of `awesome-tauri`; treat the community rows as leads to confirm
against each plugin's current repo before adoption (versions/maintenance vary).

### 2d. Third axis — Tauri plugin vs thin Rust crate vs hand-rolled

For every capability, a 3-way verdict. **Rule applied:** core/business/domain
logic or anything crossing the contract boundary → prefer a thin Rust crate in a
narrow shared crate; genuine desktop-shell / OS-UI edge concern → Tauri plugin.

Versions: `[in-tree]` = exact from our `Cargo.lock`; all other crate versions are
last-known-stable and must be **verified on crates.io before adding** (no
crates.io version-checker was available in this environment).

| Capability | Tauri plugin option | Rust-crate alternative (crate + one-line why) | Keep hand-rolled? | RECOMMENDED (3-way) | Rationale (architecture rule) |
|------------|--------------------|-----------------------------------------------|-------------------|---------------------|-------------------------------|
| **Caching** | tauri-plugin-cache | **`moka` 0.12.15 [in-tree]** — async/sync high-perf cache; already used in `crates/app/projects/src/project_health.rs`. (alts: `cached`, `quick_cache`) | n/a | **Rust crate (moka)** | Cache is core state; a ~10-50-line shared wrapper over moka keeps it canonical. Plugin would fork cache into the webview = boundary drift |
| **Reveal / open in file manager** | **tauri-plugin-opener** (in use) | `open` ~5.x or `opener` ~0.7.x — open a path in default app; but neither reliably *selects/highlights* the item like `opener().reveal_item_in_dir` | current: core cmd via plugin | **Tauri plugin (opener), already in use** | Genuine OS-UI edge; the plugin's per-OS "reveal + select" beats the bare crates. We already call it from a Rust command (`native.rs:118`) for audit — correct |
| **Open external URL / file** | tauri-plugin-opener/shell | `open` ~5.x from Rust core | current: `window.open` fallback + plugin | **Tauri plugin (opener)** | Edge concern; already integrated |
| **Desktop notifications** | tauri-plugin-notification | `notify-rust` ~4.x — native notifications from Rust; fires straight from core background tasks, no JS round-trip (macOS needs a bundled app id) | none today | **Tauri plugin (lean), notify-rust viable** | Toss-up: OS *permission model* favors the plugin, but our triggers are backend (drain/plan-apply) so `notify-rust` in the core is legit. Pick plugin for the permission UX; revisit if we want purely-backend notifications |
| **Single instance** | tauri-plugin-single-instance | `single-instance` ~0.13.x or `fslock` ~0.2.x — process lock only (no window-focus) | none today | **Tauri plugin** | Edge concern: the plugin *focuses the existing window* on 2nd launch via the Tauri event loop; a raw lock only blocks. Both protect the canonical SQLite store |
| **FS watching** | (none official) | **`notify` 7.0.0 [in-tree]** — already used in `crates/fs/inventory/src/watcher.rs` | n/a | **Rust crate (notify), already in use** | Core domain; no plugin exists or is wanted |
| **Directory walking / scan traversal** | (none) | `walkdir` ~2.5.x or `ignore` ~0.4.x — fast recursive walk with symlink control (constitution: don't follow symlinks by default) | possibly hand-rolled in `crates/fs/inventory` | **Rust crate (walkdir/ignore)** if traversal is formalized | Pure core concern; `ignore` gives gitignore-style excludes + symlink guards matching our scan rules |
| **Path handling** | (`@tauri-apps/api/path`, async) | **`camino` `Utf8Path` 1.2.2 [in-tree]** — already the core path type across `crates/fs/*`; std::path underneath | frontend `pathe` (display only) | **Rust crate (camino) for core; `pathe` for UI** | Path *resolution* is core; the async JS path API is worse DX and would pull logic across the boundary |
| **Self-update** | tauri-plugin-updater | `self_update` ~0.42.x — replaces the binary from GH releases, but no Tauri window relaunch / signing integration | none (manual CI only) | **Tauri plugin (updater)** | Update *UI + signed artifact + relaunch* is a shell concern the plugin integrates; `self_update` is CLI-shaped and misses the GUI relaunch story |
| **Global shortcut** | tauri-plugin-global-shortcut | `global-hotkey` ~0.6.x — the exact crate the plugin wraps | none today | **Tauri plugin** | Edge concern; the plugin adds capability-gated registration over the same crate |
| **Clipboard** | tauri-plugin-clipboard-manager | `arboard` ~3.x — full clipboard incl. images, from a Rust command | current: `navigator.clipboard.writeText` (`reveal.ts:115`, `SchemaViewer.tsx:62`) | **Keep hand-rolled (text)**; `arboard` if rich/image or non-secure-context needed | For copy-*text* the browser API is zero-dep and works in the webview; escalate to `arboard` (Rust) over the plugin only if we need image/rich clipboard |
| **Config / KV prefs** | tauri-plugin-store | `config`/`figment` ~0.10.x/`confy` ~0.6.x + serde — for app *config files* | current: `localStorage` (UI) + SQLite (canonical) | **Keep current split** | Ephemeral UI prefs stay in `localStorage`; canonical prefs stay in SQLite/contracts. `confy`/`figment` and plugin-store both add a redundant third store |
| **SQL** | tauri-plugin-sql | **`sqlx` 0.9.0 [in-tree]** — canonical store, already owns SQLite (`lib.rs:647`) | n/a | **Rust crate (sqlx), already in use** | Plugin lets the webview run SQL = direct constitution violation |
| **HTTP** | tauri-plugin-http | **`reqwest` 0.13.3 [in-tree]** — already the SIMBAD resolver client | n/a | **Rust crate (reqwest), already in use** | Network belongs in the core, not the webview |
| **Process / shell exec** | tauri-plugin-shell | **`std::process::Command`** (already used, `workflow/profiles/src/launch.rs:143`); `duct` ~0.13.x for pipelines | current: std::process in core | **std / Rust crate, already in use** | Tool launch is core; exposing a shell to the webview is a security + boundary risk. Keep std::process; add `duct` only if we need piped multi-process flows |
| **Image handling** | (`image` JS namespace = icon plumbing only) | `image` ~0.25.x — decode/thumbnail in Rust | none | **Neither now** (weigh PixInsight boundary) | We don't process images. If display *thumbnails* are ever wanted, `image` in the core (display-only, not processing) — never a frontend plugin |
| **Fuzzy / global search ranking** | (none) | `nucleo` ~0.5.x (fast, maintained) or `fuzzy-matcher` ~0.3.x (less active) | domain ranking already in core (`inbox/target_recommendations.rs`, coords/angular-separation; calibration ranking); palette fuzzy via `cmdk` (JS) | **cmdk (JS) for the palette; `nucleo` (Rust) only if we add server-side text search** | Current ranking is coordinate/domain math in the core (correct there). Fuzzy *text* search isn't hand-rolled today; if added, put `nucleo` in the core, not the frontend |

---

## 3. `localStorage` inventory (plugin-store candidates)

All are ephemeral UI prefs (fine to keep in `localStorage`; plugin-store would
be a lateral move). Evidence:

| Key/purpose | Evidence | Canonical? |
|-------------|----------|-----------|
| Inbox grouping dims | `lib/use-grouping.ts:46`,`:73` | No — UI |
| Picker last-used path per kind | `shared/native/picker.ts:77`,`:91` | No — UI convenience |
| Selected filter | `shared/native/picker.ts:124`,`:133` | No — UI |
| Project wizard draft | `features/projects/wizard/WizardPage.tsx:42`,`:52` | No — draft |
| Tool-launch cwd hint | `features/projects/tool-launch.ts:96`,`:107` | No — UI hint |
| Setup wizard state | `features/setup/SetupWizard.tsx:75`,`:108` | No — draft |
| **Source list** | `features/setup/sources-store.ts:78`,`:110`,`:131` | **Smells canonical — verify it is not the source of truth for registered sources; if it is, it belongs in the core, not localStorage/plugin-store** |
| Altitude threshold | `features/targets/altitude-settings.ts:34`,`:51` | No — UI pref |
| Favourites | `features/targets/useFavourites.ts:28`,`:41` | Borderline — user data; small. Consider core later |
| Cleanup actions | `features/settings/Cleanup.tsx:33`,`:57` | Verify vs. core cleanup rules |
| Theme + density | `data/theme.ts:43`,`:52` | No — UI pref |
| General preferences | `data/preferences.ts:37`,`:56` | No — UI pref |

Action: this is a data-ownership audit item, *not* a plugin-store adoption item.
The `sources-store`, `favourites`, and `cleanup` keys warrant a check that
canonical state lives in SQLite; UI-only keys can stay in `localStorage`.

---

## 4. Quick wins (< 1 day each, clear simplify/UX gain)

1. **plugin-window-state** — add `.plugin(tauri_plugin_window_state::Builder::default().build())` + capability; instantly remembers window size/position. (S)
2. **plugin-single-instance** — add the plugin + init callback that focuses the existing window; protects the canonical SQLite store from concurrent instances. (S)
3. **`app.setTheme` wiring** — in `initAppearance()` (`data/theme.ts:86`), after resolving the CSS theme, also call `setTheme(resolvedIsDark ? 'dark' : 'light')` (or `null` for `system`) so native chrome follows. (S)
4. **plugin-log** — add the plugin with a file target in the app log dir; keep stdout for dev. Gives users a shareable log file. (S)
5. **tauri-plugin-prevent-default** (community) — one-line adoption to suppress F5/reload, native context menu, and text-caret selection in release builds. (S)
6. **`core.isTauri()`** — optionally replace the hand-rolled `__TAURI_INTERNALS__` sniff (`lib/window.ts:10`) with the official helper for consistency. (S, cosmetic)

Larger follow-ups (notification, updater, native menu, drag-drop) are worth
backlog items but exceed the quick-win bar.
