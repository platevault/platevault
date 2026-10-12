# R9: OS-native web UI kits behind a per-OS abstraction

Bead `astro-plan-9rzjs`. Parent: `astro-plan-0drm0`. It blocks the decision bead `astro-plan-2ckn9`. Researched 2026-10-12, read-only.

**Question.** Should PlateVault load Fluent UI inside Tauri's webview on Windows, and a macOS kit (Photon Kit, "Macaron UI" or similar) on macOS, with the frontend choosing per OS? Or should it keep one component set and adapt it per OS?

**Evidence base.**
- Prototype `ui-harness-v5` @ `795274d5` (`/Users/sjors/tmp/worktrees/platevault/ui-harness-v5/apps/prototype`, called *P* below).
- Desktop app in the canonical checkout (`apps/desktop`, called *D* below).
- npm, GitHub (`gh api`) and pub.dev metadata, pulled live on 2026-10-12.
- Bundle sizes measured with esbuild 0.25.12 on Node 26.8.2 in a scratch directory outside the repo (`/tmp/r9nk`). See §3.
- `[INFERENCE]` marks anything not observed directly.
- §10 holds an independent critique by a read-only scout. It was not a dedicated adversarial-challenger agent, because none is available here.

---

## 0. Answer in brief

**1. There is no mature, full-coverage React macOS kit comparable to Fluent.**

| macOS candidate | Status |
|---|---|
| Photon Kit | Last commit 2017. Its only npm release (`photonkit` 0.1.2) dates from 2016. |
| react-desktop | Last release 2019. Supports React 15/16 only. |
| "Macaron UI" | Does not exist under that name (§4). |
| Puppertino 2.0 | Active, but plain CSS plus vanilla-JS helpers. Released **6 days ago**, one maintainer, about 92 downloads a week. Its table is styling only. |
| Darwin UI | Active, but small: 42 downloads a week. |

The "macOS half" of a per-OS abstraction would therefore be PlateVault's own Base UI components with a macOS skin. That is the token approach in all but name.

**2. Fluent UI React v9 is mature, but it is the Microsoft 365 web look, not WinUI.**
- Release 9.74.9 shipped 2026-09-23; about 407k downloads a week; it covers nearly every PlateVault need, including a sortable, resizable DataGrid.
- Microsoft points Windows apps to WinUI ([Fluent 2 › Windows](https://fluent2.microsoft.design/components/windows)). Fluent React lists "Used By: Microsoft 365" ([fluentui README](https://github.com/microsoft/fluentui/blob/master/README.md)).
- So Fluent React looks like the Fluent design language, but not identical to Windows 11 apps.

**3. A component kit delivers none of the most noticeable "native" signals.** The signals users notice most are window chrome and the app menu, context menus, file and alert dialogs, and notifications. These are OS surfaces that Tauri provides directly, under any UI option. What remains (scrollbars, focus rings, button order, accent colour, density) is a short list of platform tokens.

**4. Cost estimates** (`[INFERENCE]`, about ±50%):

| Option | Up front | Ongoing UI cost |
|---|---|---|
| Two kits behind one API | ~11–17 person-weeks | ~1.6–2× |
| One set, OS-adaptive tokens, native Tauri surfaces | ~3–5 person-weeks | +5–10% |

The native-surface work is needed in both cases.

**5. Verdict (conditional, §11).** Do not adopt per-OS kits.
- Keep shadcn/Base UI.
- Add a `data-platform` token layer.
- Use Tauri's native menus, notifications and simple dialogs where the OS has them.
- Treat "Fluent (or TanStack Table) for the data grid only" as a separate, single-kit decision, to be taken on grid-capability evidence.

---

## 1. Kit survey

The release date is the latest published version. Downloads are npm's last-week figure (2026-10-12).

| Kit | Look | Latest release | Activity | Licence | React 19? | Weekly downloads |
|---|---|---|---|---|---|---|
| **Fluent UI React v9** `@fluentui/react-components` | Fluent 2 web (M365) | 9.74.9, 2026-09-23 | Daily commits (last 2026-10-12); monorepo has 802 open issues | MIT; fonts and icons fall under a separate assets licence | Yes (peer `react <20`) | 407,090 |
| **Fluent UI Web Components v3** `@fluentui/web-components` | Fluent 2 web (Edge) | 3.1.3, 2026-08-25 | Same monorepo | MIT | Custom elements | 54,224 |
| **Photon Kit** `connors/photon` (`photonkit`) | OS X Yosemite, built for Electron | 0.1.2, 2016-12-18 | Last commit 2017-02-24; 81 open issues | MIT | CSS only | 57 |
| **"Macaron UI"** | — | Not found (§4) | — | — | — | — |
| **react-desktop** `gabrielbull/react-desktop` | macOS High Sierra and Windows 10 | 0.3.9, 2019-02-18 | Last commit 2022-02 (README only) | MIT | **No**: peer `react ^15‖^16`, depends on `radium 0.19.6` | 798 |
| **Puppertino 2** `@codedgar/puppertino` | macOS 27 / iOS 27 HIG, Liquid Glass | 2.0.0, 2026-10-06 | Last commit 2026-10-07; one maintainer | MIT (the v1 package `puppertino` was ISC, last released 2021-04) | CSS works anywhere; JS helpers are vanilla and DOM-global | 92 |
| Darwin UI `@pikoloo/darwin-ui` | "MacOS'esk" React | 2.1.0, 2026-07-18 | Last commit 2026-07-26; 70 stars | MIT | Yes; mixes Base UI, Radix and framer-motion | 42 |
| CoderableOfficial/react-desktop | macOS Monterey and Windows 11 | None ("Work in progress") | Last commit 2022-05 | **No licence**, so unusable | — | — |
| react-windows-ui | Windows 11 | 4.2.4, 2024-07-10 | Last commit 2024-07 | MIT | Peer `react *`; requires `react-router-dom` | — |
| Framework7 / Konsta UI | iOS and Material (mobile) | 9.2.0 / 5.5.0, 2026-09-28 | Active | MIT | — | — |
| *(current)* **Base UI** `@base-ui/react` with shadcn | Unstyled behaviour, PlateVault tokens | 1.9.0, 2026-10-09 | Active | MIT | Yes | 17,179,377 |

Notes on the entries above:
- Framework7 removed its desktop "Aurora" theme in v8 "to focus exclusively on mobile" ([migration v7→v8](https://framework7.io/docs/migration-from-v7-to-v8.html)).
- Every usable candidate is MIT-licensed, so all are AGPL-3.0-compatible.
- Fluent's fonts and icons fall under a separate assets licence ([aka.ms/fluentui-assets-license](https://aka.ms/fluentui-assets-license)). The Fluent System Icons repository itself is MIT. Segoe UI is never bundled; it comes from Windows.

Sources: `npm view <pkg> version time license peerDependencies dependencies`; `gh api repos/<o>/<r>` and `…/commits?per_page=1`; `api.npmjs.org/downloads/point/last-week/<pkg>`; [Puppertino v2.0.0 release](https://github.com/codedgar/Puppertino/releases/tag/v2.0.0).

---

## 2. Coverage against PlateVault's needs

**What PlateVault needs.** P's shared layer is 35 primitives in `src/components/ui/` (3,278 LOC) and 14 app components in `src/components/app/` (2,597 LOC). The app components include `data-table.tsx`, `row-menu.tsx`, `confirm-dialog.tsx`, `feedback.tsx` and `operation-panel.tsx`. About 80 files import them, out of 137 `.tsx` files (31,376 LOC).

Legend: ✔ built in · ◐ partial or styling only · ✗ none.

| Need | Fluent React v9 | Fluent WC v3 | Puppertino 2 | Photon | react-desktop | Base UI 1.9 (current) |
|---|---|---|---|---|---|---|
| Table with sorting | ✔ `Table`/`DataGrid`: sort, resizable columns, selection, virtualisation, composite and cell keyboard navigation | ✗ no table or grid element | ◐ `.p-table` styles `th[aria-sort]`, no sort logic | ◐ static `.table-striped` | ◐ `ListView` | ✗ PlateVault's own `DataTable` |
| Row / context menu | ✔ `Menu openOnContext` | ✔ `menu` | ◐ `context_menus.js` | ✗ relies on Electron native menus | ✗ | ✔ `ContextMenu` |
| Menus / menu bar | ✔ Menu, MenuButton, SplitButton | ✔ menu, menu-button | ✔ `.p-menu` + `menus.js`, `.p-menubar` | ✗ | ✗ | ✔ `Menu`, `Menubar` |
| Dialogs / alerts | ✔ `Dialog` (modal, alert) | ✔ `dialog` | ✔ `.p-alert`, sheets, `modals.js` | ✗ | ✔ `Dialog` | ✔ `Dialog`, `AlertDialog` |
| Toasts / notices | ✔ `Toast`, `Toaster`, `MessageBar` | ◐ `message-bar` only | ✔ `.p-notification` | ✗ | ✗ | ✔ `Toast`; notices are P's `Notice` |
| Forms | ✔ Field, Input, Select, Combobox, Dropdown, SpinButton, Switch, Slider, TagPicker | ◐ text-input, dropdown, checkbox, radio, switch, slider | ✔ text, select, stepper, search, combo, switch | ◐ basic | ◐ TextInput, Checkbox, Radio, SearchField | ✔ Field, Form, Input, NumberField, Select, Combobox, Autocomplete |
| Tabs | ✔ `TabList` | ✔ tablist | ✔ | ✔ `.tab-group` | ◐ SegmentedControl | ✔ `Tabs` |
| Split views | ✗ no splitter (`Drawer` can resize) | ✗ | ✔ `adaptive.css` | ✔ `.pane-group` | ✔ `MasterDetailsView` | ✗ |
| Sidebars | ✔ `Nav`/`NavDrawer`, `Tree` | ◐ `drawer`, `tree` | ✔ `.p-sidebar` | ✔ `.nav-group` | ✔ `NavPane` | ✗ own source list |
| Toolbars | ✔ `Toolbar` with overflow | ✗ | ✔ `.p-toolbar-btn` | ✔ `.toolbar` | ✔ `Toolbar`, `TitleBar` | ✔ `Toolbar` |

Where each column comes from:
- **Fluent React:** the dependency list of `@fluentui/react-components@9.74.9`, plus the story index at `https://react.fluentui.dev/index.json` (68 component groups). DataGrid stories include `sort`, `resizable-columns`, `composite-navigation` and `virtualization`; there is no splitter story.
- **Fluent WC:** the `dist/esm` directories in the 3.1.3 tarball.
- **Puppertino:** class inventory of `dist/css/*.css` and `src/js/*.js` in 2.0.0. There is no `tables.css`; `.p-table` lives in `lists.css`.
- **Photon:** `connors/photon/sass/`.
- **react-desktop:** `gabrielbull/react-desktop/src/`.
- **Base UI:** the package directories of 1.9.0.

**Reading.**
- Fluent React v9 is the only candidate that covers the list. It beats the current stack on tables.
- Every macOS candidate is either missing behaviour (CSS only) or dead.
- Per-OS kits would therefore pair a full React kit on Windows with Base UI plus a hand-written macOS skin on macOS. The two sides would not be symmetric.

---

## 3. Accessibility, theming and bundle cost

### Accessibility

**Fluent React v9**
- Marketed as "accessible by default" ([Fluent UI Insights EP06](https://learn.microsoft.com/en-us/shows/fluent-ui-insights/fluent-ui-insights-accessible-by-default)).
- Focus management through `@fluentui/react-tabster`.
- DataGrid supports composite and cell keyboard navigation.
- Ships high-contrast themes (`createHighContrastTheme`, `teamsHighContrastTheme` in `@fluentui/tokens`).
- Strongest of the set.

**Fluent WC v3**
- Requires the peer dependency `@microsoft/focusgroup-polyfill`.
- `aria-labelledby` and similar references that cross shadow roots need care `[INFERENCE]`.

**Puppertino 2**
- Claims CSS handling for reduce motion, reduce transparency, increase contrast and forced colours, plus arrow-key and Escape handling in menus, popovers and dialogs ([release notes](https://github.com/codedgar/Puppertino/releases/tag/v2.0.0)).
- Its helpers register document-level listeners, e.g. `document.addEventListener('keydown', …)` in `@codedgar/puppertino@2.0.0/src/js/menus.js` (read from the npm tarball). These would compete with React-owned state.
- Its CSS can serve as a skin reference; its JS cannot.

**Photon / react-desktop**
- Photon is CSS only, with no ARIA or keyboard behaviour. It predates macOS dark mode (Mojave, 2018).
- react-desktop's accessibility is undocumented `[INFERENCE: minimal]`.

**Base UI (current)**
- Uses WAI-ARIA patterns.
- P already opens row menus with Shift+F10 or the Menu key, because macOS WebKit fires no `contextmenu` event for those keys (P `src/components/app/row-menu.tsx:113-128`).

### Theming and dark mode

**PlateVault today**
- 13 user-selectable themes, each with 43 colour variables (P `src/themes.css`, one `[data-theme]` block each).
- One `--radius` and a `--row-h` density setting (P `src/index.css:89-102`).
- The platform font stack: SF Pro on macOS, Segoe UI on Windows (P `src/index.css:21-22`).

**Fluent v9**
- A theme is a JS object of **459 tokens, 366 of them colours** (measured with `Object.keys(webLightTheme)`).
- `createLightTheme(brandRamp)` derives only the brand ramp; neutrals stay Microsoft greys.
- Defaults (measured from `@fluentui/tokens`): 4/6/8 px radii, 14 px base text, brand colour `#0f6cbd` rather than the user's Windows accent, font `'Segoe UI', 'Segoe UI Web (West European)', …`.
- Carrying the 13 themes over means mapping each one onto Fluent's colour tokens. A single mapping object whose values are `var(--background)` and similar may work, because FluentProvider emits tokens as CSS variables `[INFERENCE: untested]`. Otherwise custom themes are dropped on Windows.

**Puppertino**
- `--p-*` custom properties.
- `.p-auto-dark-mode` follows the system appearance.

### Bundle cost (measured)

**Method.** Each entry renders an equivalent component set: toolbar, tabs, table, context and row menu, dialog, field, input, select, combobox, switch, checkbox, tooltip, progress and toast. The Fluent entry also adds Nav, Drawer and MessageBar. Each was built with `esbuild --bundle --minify --format=esm --jsx=automatic --define:process.env.NODE_ENV='"production"'` and compressed with `gzip -9`.

| Bundle | Minified | Gzip |
|---|---|---|
| React 19 + ReactDOM baseline | 224 KB | 69 KB |
| + Base UI 1.9.0 | 612 KB | 199 KB |
| + Fluent React 9.74.9 (styles included via Griffel) | 795 KB | 225 KB |
| Base UI + Fluent together | 1,172 KB | 349 KB |
| Fluent WC 3.1.3, 18 elements, no React | 204 KB | 53 KB |
| Puppertino 2 `puppertino-desktop.min.css` | — | 56 KB |

**What this means.** A desktop app loads from disk, so only parse cost at cold start and installer size matter. A per-OS split adds about +150 KB gzip (+560 KB minified) to the installer. It also adds that to each launch unless code is split by OS. This is minor next to the maintenance cost `[INFERENCE: cold-start impact not measured; the spike records it]`.

---

## 4. "Macaron UI"

No UI library by that name exists:
- npm returns 404 for `macaron-ui`, `macaronui` and `@macaron/ui`.
- GitHub repository search for "macaron ui" on 2026-10-12 finds only unrelated repositories, mostly with 0 stars.

Closest matches:
- [`macos_ui`](https://pub.dev/packages/macos_ui): the Flutter macOS widget set, MIT, 2.2.2 released 2025-10-19. This is the most plausible intended name `[INFERENCE]`, and it belongs to the Flutter question.
- [`macaron-css`](https://github.com/macaron-css/macaron): a zero-runtime CSS-in-JS compiler, not a macOS look. Last release 1.5.2, 2024-04.
- Darwin UI (§1).

None of these changes the conclusion.

---

## 5. HIG and Windows fidelity inside a webview

### Matchable in CSS
- **System font.** Already done.
- **Light/dark following the system.** Uses `prefers-color-scheme`; D also calls `getCurrentWindow().setTheme()` (D `src/data/theme.ts:312-313`).
- **Density, control heights, radii.**
- **Reduce-motion and contrast** media queries.
- **Dialog button order.**
  - macOS puts the default button on the trailing side and Cancel on the leading side ([HIG › Alerts](https://developer.apple.com/design/human-interface-guidelines/alerts)).
  - Windows puts "do it" buttons leftmost and the safe action rightmost ([Microsoft Learn › Dialogs](https://learn.microsoft.com/en-us/windows/apps/design/controls/dialogs-and-flyouts/dialogs)).
  - The orders are opposite. A shared footer must reorder the **DOM** per platform; a visual-only reversal breaks focus order (WCAG 2.4.3).

### Needs OS help, or untested
- **Accent colour.**
  - CSS `AccentColor` is a fixed blue in Safari, and in Chrome outside installed web apps (MDN BCD `css.types.color.system-color.accentcolor`).
  - WebKit has Cocoa-only keywords such as `-apple-system-control-accent` (`WebKit/Source/WebCore/css/CSSValueKeywords.in`). Whether Tauri's WKWebView reports the user's accent through them is `[INFERENCE: untested, spike item]`.
  - The reliable route is to read the accent in Rust (`NSColor.controlAccentColor` on macOS, WinRT `UISettings` on Windows) and push it as a CSS variable `[INFERENCE: standard OS APIs; no Tauri API for it found]`.
- **Scrollbars.**
  - P styles them on purpose: `scrollbar-width: thin` and `scrollbar-color` (P `src/index.css:116-117`), plus `::-webkit-scrollbar` width 10 px (P `src/index.css:362-365`).
  - WebKit says the presence of `::-webkit-scrollbar` turns off built-in scrollbar rendering ([WebKit blog: Styling scrollbars](https://webkit.org/blog/363/styling-scrollbars/)).
  - Chrome's guidance says macOS overlay scrollbars ignore custom colours unless `scrollbar-width` is set, which then forces custom rendering ([GoogleChrome/modern-web-guidance-src › scrollbar-color](https://github.com/GoogleChrome/modern-web-guidance-src/blob/main/features/scrollbar-color.md)).
  - So P has opted out of the stock macOS scrollbar look. Whether auto-hide and the "Show scroll bars" setting still apply in WKWebView is `[INFERENCE: device-level check, spike item]`.
- **Window-modal sheets, vibrancy, Mica.**
  - True sheets are impossible in the DOM.
  - Tauri's `windowEffects` provides vibrancy and Mica, but needs a transparent window and is unsupported on Linux ([Tauri config reference](https://v2.tauri.app/reference/config/)).
- **Unified title bar.**
  - On macOS, `titleBarStyle: "Overlay"` plus `trafficLightPosition` gives the Finder/Xcode look; `trafficLightPosition` requires Overlay and decorations (same reference).
  - On Windows, a custom title bar means `decorations: false` and hand-drawn controls. `tauri-controls` is **archived** (last release 0.4.0, 2024-03). `tauri-plugin-decorum` exists (MIT, last release 1.1.0 in 2024-09).
  - Keeping native Windows decorations is the low-risk choice.
- **Tab focus on macOS.** `WKPreferences.tabFocusesLinks` controls whether Tab reaches links and form controls, and Option temporarily reverses it ([Apple docs](https://developer.apple.com/documentation/webkit/wkpreferences/tabfocuseslinks)). This mirrors the Keyboard Navigation setting users already have for native apps. wry's default was not checked `[INFERENCE]`.

---

## 6. What users perceive as "native"

"Native" here means OS-owned chrome and behaviour first, and visual fidelity of controls second.

The ranking below is `[INFERENCE]`, reasoned from platform conventions. Widely accepted desktop apps such as VS Code, Slack, Figma and Teams use custom web design systems but native chrome, menus and dialogs. That suggests chrome and behaviour matter more than control skins.

| # | Signal | PlateVault today | Cheapest native route |
|---|---|---|---|
| 1 | Window chrome; app menu bar with standard Edit and Window menus, ⌘, Settings, ⌘Q | Native: D `src-tauri/src/bootstrap/menu.rs:15-60` (About, Settings…, Quit, Edit, Window) | Add File and View menus as the spike spec does |
| 2 | Context and row menus (timing, typeahead, submenu behaviour, VoiceOver) | Base UI `ContextMenu` in the webview | Tauri `Menu.popup()` "to replace the webview context menu with a native one" ([JS API › menu](https://v2.tauri.app/reference/javascript/api/namespacemenu/)) |
| 3 | File and folder pickers, simple alerts, OS notifications | Native pickers via `@tauri-apps/plugin-dialog` (D `src/app/LogPanel.tsx:144-148`, `src/features/settings/AuditLog.tsx:261-264`, setup wizard) | `plugin-dialog` `ask`/`message` for simple confirms; `plugin-notification` |
| 4 | Keyboard conventions (⌘ vs Ctrl, Shift+F10, Esc, Home/End, typeahead) | Partly done (P `src/app/shortcuts.tsx:17-19`; `row-menu.tsx:113-128`) | Apply them consistently |
| 5 | Scrolling (overlay scrollbars, elastic bounce) | Custom-styled (§5) | Leave scrollbars unstyled on macOS (spike check) |
| 6 | Focus ring (macOS accent halo vs Windows double ring) | One 2 px accent ring, 1 px offset | Platform token |
| 7 | Accent and selection colour from OS settings | Brand blue | Rust reads the accent and sets a CSS variable (optional) |
| 8 | Control skins (shape, radius, heights) | Desktop-dense, OS-neutral | Platform tokens: radius, heights, 13 px vs 14 px body |

**Mapping the row-menu contract to Tauri.**

P's row menus are data, not JSX: `MenuEntry = {label, onSelect, icon?, shortcut?, destructive?, disabled?} | {separator} | {heading}` (P `row-menu.tsx:20-22`). Tauri's JS menu items take a `text`, an `action` callback, an `accelerator` and an `enabled` flag (`MenuItemOptions`, [JS API › menu](https://v2.tauri.app/reference/javascript/api/namespacemenu/)). So a native adapter fits behind the existing contract.

Known gaps:
- **Icons.** `NativeIcon` is macOS-only ("Windows / Linux: Unsupported", same page). Lucide icons would have to be rasterised into `IconMenuItem` images, or dropped, which is the native convention on Windows and macOS anyway `[INFERENCE]`.
- **Destructive styling.** It has no native equivalent.
- **Lifetime.** Menus live on the Rust side, and the frontend must keep a reference while one is open (same page).
- **Not yet verified:** staleness when rows change while a menu is open, Shift+F10 invocation, and VoiceOver/Narrator behaviour.

**Rich confirms stay in the webview.** PlateVault's ConfirmDialogs read as previews ("what changes beside what stays": P `design/HARNESS-V4.md`, direction B). Native alerts hold only a title, a message and buttons, so only the simple yes/no confirms should become native.

---

## 7. Linux

- Linux is a shipped platform: AppImage, `.deb` and `.rpm` (`README.md:58-60`).
- Neither Fluent nor any macOS kit targets GNOME or KDE. A per-OS abstraction needs a third mapping, or ships a Microsoft or Apple look to Linux users.
- Engine and native support:
  - The engine is WebKitGTK.
  - `windowEffects` is unsupported on Linux (Tauri config reference).
  - Native menus and dialogs still come from GTK through Tauri, so signals #1–#3 work there too.
  - `NativeIcon` menu icons are unsupported on Linux (§6).
- With platform tokens, Linux gets a neutral block (system-ui font, about 6 px radius, GNOME-style button order `[INFERENCE: GNOME HIG not re-checked]`) for about a day's work.
- D already treats native theme calls as best-effort on Linux desktop environments (D `src/data/theme.test.ts:7-11`).

---

## 8. Cost and risk

All figures are `[INFERENCE]` estimates in person-days, with roughly ±50% uncertainty.

### Option A: per-OS kits

Fluent React v9 on Windows; Base UI plus a Puppertino-derived macOS skin on macOS; one PlateVault API in front.

| Work item | Days |
|---|---|
| Kit-neutral component API. Today's API is shadcn compound components (e.g. P `src/app/shell.tsx:23-36`), while Fluent uses other structures: `MenuTrigger`/`MenuPopover`/`MenuList`, DataGrid's `createTableColumn` against `DataTable`'s `Column`, `Toaster` ids, `Select` vs `Dropdown`. A shared API must be prop-level, so about 80 call-site files change. | 8–12 |
| Fluent adapters for 35 primitives: 12 trivial at ~0.5 d; about 15 behavioural at 1–2 d (menus, select, combobox, dialogs, sheet to drawer, popover, tooltip, tabs, toggle group, field, input group, scroll area, progress) | 25–35 |
| `DataTable` rebuilt on `DataGrid` (sort, selection, row menu, density, Shift+F10 parity) | 4–6 |
| macOS skin over Base UI. Puppertino classes don't match Base UI's `data-*` state attributes, so the CSS has to be rewritten. | 8–15 |
| 13 themes mapped onto Fluent tokens (2 d if the `var()` mapping in §3 works) | 2–6 |
| Two visual baselines, two accessibility audits (VoiceOver, Narrator), E2E on both | 6–10 |
| **Total** | **≈ 53–84 d ≈ 11–17 person-weeks** |

Ongoing costs of Option A:
- Every new primitive or variant is built twice.
- Focus and positioning bugs differ by engine (Tabster vs Floating UI).
- Fluent publishes a minor release every 1–2 weeks, so there are two upgrade streams.
- Estimated ×1.6–2 on all UI work.
- Round 9's "standard components only" rule would then mean two standards.

### Option B: one set, OS-adaptive tokens and native surfaces

| Work item | Days |
|---|---|
| Set `html[data-platform]` from `@tauri-apps/plugin-os`, or from the existing `navigator.platform` test | 0.5 |
| Per-platform token blocks: radius, control and row heights, body size (13 px macOS / 14 px Windows), focus ring, menu highlight, scrollbar policy, Linux block | 3–5 |
| Platform-ordered dialog footer in `confirm-dialog.tsx` and `alert-dialog.tsx` (DOM order) | 1 |
| Native row menus via `Menu.popup()` behind the `MenuEntry` contract: paraglide labels, rasterised icons or none, staleness handling, Shift+F10, VoiceOver/Narrator checks; Base UI fallback kept for the browser prototype | 5–8 |
| Native notifications for finished jobs; simple confirms via `plugin-dialog` | 1–2 |
| Visual QA on three platforms | 3–5 |
| *Optional:* macOS `titleBarStyle: Overlay` unified toolbar | 1–2 |
| *Optional:* OS accent read in Rust and pushed as a CSS variable | 1–2 |
| **Total** | **≈ 14–25 d ≈ 3–5 person-weeks** |

Ongoing for Option B: one component set, one behaviour layer, one accessibility audit. Per-platform visual checks add about 5–10%.

### Matched-scope check

The native-surface items (#1–#3 in §6, plus the row-menu adapter) are needed under **every** option, because no web kit provides OS menus, dialogs or notifications. Option A buys only control skins, and its cost is everything in the A table.

### Risks

| Risk | A | B |
|---|---|---|
| Maintenance multiplier | High | Low |
| Behaviour drift between OSes (focus, typeahead, dismiss) | High | None |
| macOS kit abandonment | High (one maintainer, 6 days old) | n/a |
| Custom themes | Costly, or dropped, on Windows | Unaffected |
| "Almost native" uncanny valley | Medium (Fluent web ≠ WinUI) | Medium (still a webview) |
| Lock-in | High: about 80 call sites on a lowest-common-denominator API | Low: token blocks delete cleanly |
| Native row-menu gaps (icons, destructive style, lifetime) | Same under A | Medium, contained in `row-menu.tsx` |

---

## 9. Debate

### Problem validation

The problem is partly real.
- Round 9's themes are standard components and consistency, not a per-OS look (`astro-plan-0drm0`).
- P already aims at a native desktop studio: platform font, desktop density, source list, unified toolbar, native-style tables and menus, chrome that cannot be text-selected (P `design/HARNESS-V4.md`, "Desktop conventions used").
- The non-native gaps are signals #2 and #5–#7 in §6. None of them needs a second component library.

### Pros of per-OS kits

| Pro | Evidence strength |
|---|---|
| Windows users get a familiar Microsoft 365 look ("Used By: Microsoft 365", fluentui README) | Moderate |
| Fluent DataGrid outperforms today's DataTable: resize, cell navigation and virtualisation built in | Strong (story index), but this does not require a per-OS split |
| Fluent's accessibility is well funded and documented | Strong |
| Each OS gets its brand look | Weak: Fluent web ≠ WinUI, and macOS would be custom work |

### Cons

| Con | Severity |
|---|---|
| No mature, full-coverage React macOS kit, so the abstraction is asymmetric | **Blocker** to the "two real kits" premise |
| About 2× UI cost for the product's lifetime on a single-maintainer project | Major |
| Two behaviour layers diverge, giving one-OS-only bugs | Major |
| 13 custom themes against Fluent's 366-colour-token model | Major |
| Linux is shipped and needs a third look | Major |
| Kits deliver none of signals #1–#3 | Major |
| Fluent web ≠ Windows 11 app look | Minor to Major, depending on expectations |
| +150 KB gzip in the installer | Minor |

### Tradeoffs

- **Per-OS kits:** buy a recognisable Microsoft 365 skin on Windows. The cost is a permanent second UI layer, the custom themes, and a macOS look PlateVault must still build.
- **Tokens plus native surfaces:** give up pixel-level kit fidelity. They keep one behaviour layer, the themes and Linux, and they deliver the OS-owned signals users notice most.

### Alternatives

1. **Do nothing.** P is already desktop-native in spirit (system font, density), and D has a native app menu and dialogs. This is adequate for most users `[INFERENCE]`. It leaves the custom scrollbars and in-webview context menus in place.
2. **Simplest viable approach.** Use native surfaces where the OS has them: the File and View menus already in the spike spec, `Menu.popup()` row menus, `plugin-notification`, and `plugin-dialog` for simple confirms. Add three tokens: macOS scrollbars unstyled, platform focus ring, platform dialog order. About 2–3 person-weeks.
3. **Option B in full.** Alternative 2 plus radius, heights and body size per platform, OS accent from Rust, and the macOS unified title bar. About 3–5 person-weeks.
4. **Targeted grid upgrade, single kit, every OS.** Adopt Fluent `DataGrid` alone inside a scoped `FluentProvider` themed from PlateVault's CSS variables, *or* the headless `@tanstack/react-table` (9.2.8, 2026-10-08, MIT) under the existing `DataTable`.
   - Fluent gives keyboard grid navigation out of the box, at the price of a second styling system and +156 KB gzip.
   - TanStack keeps one design system but leaves cell navigation to PlateVault.
   - Roughly 1.5–3 person-weeks either way `[INFERENCE]`.
   - Decide this on grid-capability evidence, independently of the per-OS question.
5. **Fluent React v9 everywhere.** One kit, a Microsoft 365 look on every OS. It means a full migration and re-theming (about 7–11 person-weeks `[INFERENCE]`) and a Microsoft look on macOS. Only worth it if Windows dominates.
6. **Per-OS kits (the proposal).** 11–17 person-weeks plus about 2× ongoing.
7. **Truly native shells** (SwiftUI/AppKit, WinUI, GTK over the Rust core). The only route to real HIG or WinUI fidelity, but it means three UIs. Out of scope here; Flutter is a separate bead.

### Overengineering assessment

1. **Would doing nothing solve it?** Mostly. What remains is behavioural: menus, scrolling, focus ring, button order.
2. **What is the simplest thing that works?** Alternative 2: Tauri native menus, notifications and simple dialogs, plus three platform tokens.
3. **What solves a problem we don't have yet?** The kit-neutral API, the second kit and the dual theme mapping. No round-9 feedback asks for Microsoft 365 styling or pixel-perfect HIG controls.
4. **What would a 48-hour ship cut?** Everything except native row menus, unstyled macOS scrollbars and platform-ordered dialog footers.
5. **How hard is it to undo?** Per-OS kits are close to a one-way door: about 80 call sites on a lowest-common-denominator API, plus two test baselines. Tokens and the native-menu adapter are two-way doors.

### Reversibility

| Option | Door |
|---|---|
| A (per-OS kits) | One-way, or reversible only at about the original cost |
| B / Alternative 2 | Two-way |
| Alternative 4 (grid only) | Reversible at moderate cost, contained in `DataTable` |
| Alternative 5 (Fluent everywhere) | Reversible at high cost |

---

## 10. Devil's advocate (independent critique)

**Reviewer.** A read-only scout received the finished §0–9 and spot-checked sources: P `row-menu.tsx`, D `menu.rs`, Tauri menu docs, Fluent's Windows page, WebKit's scrollbar post. Each point below is either incorporated or deflected.

1. **Strongest argument against the verdict.** The draft conflated "two complete kits" with "targeted Fluent adoption"; Fluent's DataGrid and accessibility are real capability gains, not skin. **Incorporated** as Alternative 4, decided on grid evidence and independent of the per-OS question.
2. **Steelman for per-OS kits.** They win if Windows is the dominant market, users ask for Fluent/M365 controls, DataGrid replaces bespoke table work, macOS deliberately stays Base UI with a token skin, Linux stays neutral, and the cost is funded. **Incorporated** into §11's "makes sense IF". Note that this is in effect "Fluent on Windows plus tokens elsewhere". It keeps the 2× behaviour layer, so it still loses on maintenance without the funding condition.
3. **Native row-menu estimate (3–5 d) was optimistic.** Per-row closures, icons, headings, disabled items and Rust-side lifetime all need proving. **Incorporated**: raised to 5–8 d, with the gaps listed in §6 (icons macOS-only, destructive styling, lifetime). Made a spike gate.
4. **The A vs B estimates were fragile, and B excluded QA and plumbing.** **Incorporated**: three-platform QA added to B (now 3–5 person-weeks), the ±50% band stated, and the matched-scope check added in §8. **Deflected in part:** A's total is a sum of named items. Cutting A down to "grid and forms only" is Alternative 4, not a per-OS abstraction.
5. **The scrollbar claim was stated as fact.** **Incorporated**: §5 now cites WebKit (custom pseudo-elements turn off built-in rendering) and Chrome's guidance (`scrollbar-width` forces custom rendering on macOS). Whether auto-hide survives is a spike check. Also softened: "Fluent web ≠ WinUI", not "cannot feel Windows-like".
6. **"No maintained React macOS kit" was too categorical.** **Incorporated** as "no mature, full-coverage React macOS kit comparable to Fluent". The Puppertino helper behaviour is cited to its `src/js/menus.js`. The bundle method is spelled out so the figures can be reproduced.
7. **Define "native", and say where Linux stands.** **Incorporated**: §6 now defines native as chrome and behaviour first, and §7 records Linux as shipped (`README.md:58-60`).

---

## 11. Synthesis and conditional verdict

**Per-OS kits (Fluent on Windows, a macOS kit on macOS, behind one abstraction) make sense IF all of these hold:**
- Windows is the dominant or paying user base.
- Those users ask for a Microsoft 365 look.
- A maintainer can fund about 2× UI work indefinitely.
- The 13 custom themes are dropped or reduced on Windows.
- Linux can ship a foreign look.
- Ideally, a mature React macOS kit exists. None does today.

**They do NOT make sense IF any of these hold:**
- The project stays single-maintainer.
- The custom themes stay.
- Linux remains a shipped target, as it is today.
- The aim is "feels native". Kits deliver none of the OS-owned signals (chrome, menus, dialogs, notifications), and Tauri provides those under any option.

**Recommended direction: Alternative 2, then Option B.**
1. Native `Menu.popup()` row menus behind the existing `MenuEntry` contract.
2. Native notifications, and `plugin-dialog` for simple confirms.
3. A platform token layer for scrollbars, focus ring, dialog button order, radius, heights and body size.
4. Optional: OS accent and the macOS unified title bar.

**Grid capability is a separate decision.** Choose Fluent DataGrid alone or TanStack Table (Alternative 4) only if the spike or product needs show `DataTable` falling short: column resizing, cell keyboard navigation, or virtualisation at the library's session counts.

**Confidence:**

| Claim | Confidence |
|---|---|
| Per-OS dual kits are the wrong investment for PlateVault now | High (~80%) |
| Native row menus via `Menu.popup()` reach parity with today's menus (icons, staleness, accessibility) | Medium (~55%), pending the spike |
| The cost figures | Low-to-medium; use them as ratios, not schedules |

---

## 12. Dependencies and spike inputs

**Relationships:**
- `blocks` → `astro-plan-2ckn9`, the UI-stack decision. That edge already exists, and this report is its required input.
- `related` → the OS-native web-kit spike. The spike can follow its spec as written; this report only informs it.
- `discovered-from` (`astro-plan-9rzjs`), possible follow-ups for the prototype:
  - (a) unstyle macOS scrollbars and verify on a device;
  - (b) DOM-ordered platform dialog footer;
  - (c) native row-menu adapter.

The dispatcher owns the graph; none of these are created here.

**Spike inputs.** Make the "Windows look / macOS look" switch realistic:
- **Windows look:** Fluent React v9.
- **macOS look:** Base UI with a Puppertino-derived token skin, not Puppertino's JS. This is the only viable macOS option.
- **Third variant:** the same Base UI tree with `data-platform` tokens only, so tokens can be compared against kits.

**Measurements to add to the spike's list:**
- VoiceOver and Narrator on Fluent `DataGrid` against the Base UI table.
- `Menu.popup()` row menu with paraglide labels, rasterised icons, accelerators, disabled items and Shift+F10.
- Whether WKWebView overlay scrollbars auto-hide with and without P's scrollbar CSS.
- Whether `-apple-system-control-accent` reports the user's accent in Tauri's WKWebView.
- Cold-start difference with Fluent loaded.

---

## Sources

**Prototype** (`ui-harness-v5` @ 795274d5, under `apps/prototype`):
- `package.json:20,37-38`
- `src/index.css:21-22,89-102,112-117,362-365`
- `src/themes.css`
- `src/components/app/row-menu.tsx:20-22,113-128`
- `src/app/shortcuts.tsx:17-19`
- `src/app/shell.tsx:23-36`
- `design/HARNESS-V4.md:1-60`

**Canonical checkout:**
- `README.md:58-60`
- `apps/desktop/package.json`
- `apps/desktop/src-tauri/tauri.conf.json`
- `apps/desktop/src-tauri/src/bootstrap/menu.rs:15-60`
- `apps/desktop/src/data/theme.ts:312-315`
- `apps/desktop/src/data/theme.test.ts:7-11`
- `apps/desktop/src/app/LogPanel.tsx:144-148`
- `apps/desktop/src/features/settings/AuditLog.tsx:261-264`

**Fluent:**
- https://github.com/microsoft/fluentui (README, MIT)
- https://aka.ms/fluentui-assets-license
- https://react.fluentui.dev/index.json
- https://fluent2.microsoft.design/components/windows
- https://learn.microsoft.com/en-us/shows/fluent-ui-insights/fluent-ui-insights-accessible-by-default

**npm** (version, publish date):

| Package | Version | Published |
|---|---|---|
| `@fluentui/react-components` | 9.74.9 | 2026-09-23 |
| `@fluentui/web-components` | 3.1.3 | 2026-08-25 |
| `@base-ui/react` | 1.9.0 | 2026-10-09 |
| `@tanstack/react-table` | 9.2.8 | 2026-10-08 |
| `photonkit` | 0.1.2 | 2016-12-18 |
| `react-desktop` | 0.3.9 | 2019-02-18 |
| `puppertino` | 1.5.1 | 2021-04-23 |
| `@codedgar/puppertino` | 2.0.0 | 2026-10-06 |
| `@pikoloo/darwin-ui` | 2.1.0 | 2026-07-18 |
| `react-windows-ui` | 4.2.4 | 2024-07-10 |
| `tauri-controls` | 0.4.0 | 2024-03-23 |
| `@macaron-css/core` | 1.5.2 | 2024-04-12 |

**GitHub:**
- https://github.com/connors/photon
- https://github.com/gabrielbull/react-desktop
- https://github.com/codedgar/Puppertino/releases/tag/v2.0.0
- https://github.com/surajmandalcell/darwin-ui
- https://github.com/CoderableOfficial/react-desktop
- https://github.com/agmmnn/tauri-controls (archived)
- https://github.com/clearlysid/tauri-plugin-decorum
- https://github.com/macaron-css/macaron
- https://github.com/GoogleChrome/modern-web-guidance-src/blob/main/features/scrollbar-color.md

**pub.dev:** https://pub.dev/packages/macos_ui

**Framework7:** https://framework7.io/docs/migration-from-v7-to-v8.html

**Tauri:**
- https://v2.tauri.app/reference/javascript/api/namespacemenu/ (`Menu.popup`, `MenuItemOptions.action`/`accelerator`/`enabled`, `NativeIcon` macOS-only)
- https://v2.tauri.app/reference/config/ (`titleBarStyle`, `trafficLightPosition`, `windowEffects`)
- https://v2.tauri.app/learn/window-menu/

**Apple and WebKit:**
- https://developer.apple.com/design/human-interface-guidelines/alerts
- https://developer.apple.com/documentation/webkit/wkpreferences/tabfocuseslinks
- https://webkit.org/blog/363/styling-scrollbars/
- WebKit `Source/WebCore/css/CSSValueKeywords.in`

**Microsoft:** https://learn.microsoft.com/en-us/windows/apps/design/controls/dialogs-and-flyouts/dialogs

**MDN browser-compat data:**
- `css.types.color.system-color.accentcolor`
- `css.properties.scrollbar-width` (Safari 18.2)
- `css.properties.scrollbar-color` (Safari 26.2)
- https://developer.mozilla.org/en-US/docs/Web/CSS/system-color
