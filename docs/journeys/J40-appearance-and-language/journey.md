---
id: J40
title: Choose a theme, density and language in Settings › Appearance and keep them across restarts
version: 1
status: draft
last_reviewed: 2026-10-12
actors: [primary-user]
surfaces: [settings, appearance, i18n, shell, status-bar, home, activity, keyboard]
interfaces: [desktop-ui, desktop-ui-macos]
trace: [HARNESS-V5-IA.md#S16, HARNESS-V5-IA.md#round-2-foundation, HARNESS-V5-IA.md#fix-pass, HARNESS-V5-FEEDBACK-R1.md#shell-and-navigation, HARNESS-V5-FEEDBACK-R1.md#round-1b, HARNESS-V5-FEEDBACK-R1.md#copy-rules, I18N.md, themes-contrast.md, apps/prototype/src/features/t1/settings/appearance-page.tsx, apps/prototype/src/app/appearance.tsx, apps/prototype/src/app/preferences.ts, apps/prototype/src/app/themes.ts, apps/prototype/src/lib/i18n.ts, apps/prototype/src/lib/format.ts, apps/prototype/messages/en-GB.json, apps/prototype/messages/pt-BR.json, ui-harness-v5@b5e813a5, ui-harness-v5@d9255cff, ui-harness-v5@277fc2ac, docs/journeys/J10-settings-appearance-i18n/journey.md]
---

## Goal

The user makes PlateVault look and read the way they want: they pick a theme from live swatches, a row density, and the interface language, and they expect every screen to follow at once and to come back the same after a restart. Choosing appearance is personal and must never touch the library. Done means:

- Settings › Appearance shows the 13 themes plus Match system, three densities and two languages, and each choice applies to every screen immediately.
- With Português (Brasil) chosen, the shell, every screen visited and the copy recorded earlier (Activity) read in Portuguese, with pt-BR month names and number separators, and no English UI word is left.
- After a restart, the chosen theme, density and language are in effect from the first frame.
- Restore defaults returns all four appearance settings to PlateVault Dark, English (UK), Comfortable and single-key shortcuts on.
- No appearance change writes a catalog record, an Activity entry or a file.

## Preconditions

- P1: Fresh replay of J19 and J20: the catalog holds the J19 sessions and the open Project `NGC 7000 HOO` (subject NGC 7000, rig `RedCat`), and Activity lists `Project created: NGC 7000 HOO`. Appearance is at its defaults: theme PlateVault Dark, language English (UK), density Comfortable, single-key shortcuts on.
- P2: The PlateVault window is sized to 1100 × 720 (README validator rule). The OS appearance can be switched between Dark and Light during the run.
- P3: The J19/P5 manifest is available, and the catalog's session, Project and Activity entry counts are recorded before S1.

## Steps

### S1 — Open Settings › Appearance {#S1}

- **Do:** Open Settings and choose Appearance.
- **Expect:** Settings lists its sections in groups: General (Appearance), Library (Locations, Equipment, Naming, Calibration, Sites, Target lookup), Projects (Goal templates) and Processing (Applications). Appearance has the sections Theme, Language, Density and Keyboard, and a **Restore defaults** button that is disabled with the tooltip "Already at the defaults". There is no Save button.
- **Trace:** HARNESS-V5-IA.md §Screens S16 · settings-layout.tsx · navigation.ts SETTINGS_SECTIONS

### S2 — Read the theme picker {#S2}

- **Do:** Read the Theme section.
- **Expect:** It offers 14 options, in this order: PlateVault Dark, PlateVault Light, Gruvbox Dark, Gruvbox Light, Nord, Dracula, Solarized Dark, Solarized Light, Catppuccin Mocha, Catppuccin Latte, Tokyo Night, One Dark, Rosé Pine, and **Match system**. Each theme option shows a swatch: a miniature window painted in that theme's own colours, with a source list and its selection, a toolbar, text lines, a primary button and four status dots (success, warning, danger, info). Match system shows the PlateVault Dark and PlateVault Light swatches side by side. PlateVault Dark is the selected option.
- **Trace:** Feedback §Shell 5 · IA §Round 2 foundation Themes · appearance.tsx ThemePicker, ThemeSwatch · themes.ts

### S3 — Switch themes and check legibility {#S3}

- **Do:** Choose Nord, then open Home, Sessions and the `NGC 7000 HOO` Project page. Return to Appearance and choose Catppuccin Latte, then Solarized Light.
- **Expect:** Each choice repaints the whole window, including the toolbar, source list and status bar, before the next action, with no reload. Nord, Catppuccin Latte and Solarized Light each match their swatch. In every theme chosen, body text and status-pill text measure at least 4.5:1 against the surface behind them, and UI glyphs and control borders at least 3:1.
- **Expect (negative):** Activity gains no entry. Home, Sessions and the Project page show the same sessions, counts and goals as before the switch.
- **Trace:** Feedback §Shell 5 (4.5:1 on every surface) · themes-contrast.md §Summary · preferences.ts setTheme

### S4 — Follow the OS appearance {#S4}

- **Do:** Choose Match system. Switch the OS appearance to Light, then to Dark.
- **Expect:** With the OS in Light, PlateVault shows PlateVault Light; with the OS in Dark, PlateVault Dark. Each switch takes effect while PlateVault stays open, without touching any PlateVault control.
- **Trace:** appearance.tsx (system option) · preferences.ts (media listener, SYSTEM_THEMES)

### S5 — Change density {#S5}

- **Do:** In Density, choose Compact, open Sessions, then return and choose Spacious and open Sessions again.
- **Expect:** The three density options read Compact (28 px), Comfortable (32 px) and Spacious (40 px), each with a three-row preview. With Compact, Sessions table rows are 28 px tall; with Spacious, 40 px. The selected density's radio is checked.
- **Expect (negative):** Changing density changes no column, filter or sort in Sessions.
- **Trace:** IA §Screens S16 (density) · appearance-page.tsx DENSITIES

### S6 — Read the language picker {#S6}

- **Do:** Read the Language section.
- **Expect:** It offers exactly two languages, each named in its own language: English (UK) and Português (Brasil). Português (Brasil) carries a "Machine-generated" pill. English (UK) is selected.
- **Trace:** Feedback §Shell 6 · IA §Screens S16 ("pt-BR marked machine-generated") · I18N.md §pt-BR · i18n.ts LOCALE_META

### S7 — Switch to Português (Brasil) {#S7}

- **Do:** Choose Português (Brasil). Without restarting, visit Home, Projects, the `NGC 7000 HOO` Project page, Sessions, a session detail, Targets, Calibration, Activity and each Settings section.
- **Expect:** The switch takes effect on the open screen at once. The source list reads Início, Projetos, Alvos, Sessões, Calibração and Atividade; the Settings section list reads Aparência, Locais, Nomenclatura, Modelos de metas and Aplicativos; Appearance's sections read Tema, Idioma and Densidade, and its button Restaurar padrões; the machine-generated pill reads "Tradução automática"; the idle status bar reads "Ocioso". Observing nights use pt-BR month names ("18 set", "30 set"), and decimal numbers and sizes use a decimal comma ("12,4 GB"). Activity's earlier entry reads `Projeto criado: NGC 7000 HOO`. Every button, heading, column header, status word, tooltip, empty state and refusal on the visited screens is in Portuguese. Proper names stay as written: PlateVault, theme names, Target, rig, Project and file names, paths, header values, filter names and palette names (HOO, SHO, LRGB).
- **Expect (negative):** No English UI word remains on any visited screen. No reload, re-index or rescan starts. Session names, Project names and file paths are not translated or changed.
- **Trace:** Feedback §Shell 6 · §Round 1b i18n gate · I18N.md §Using a message (MessageRef worded at render) · format.ts (MONTHS, Intl locale) · ui-harness-v5@d9255cff, @277fc2ac

### S8 — Check the layout in Portuguese {#S8}

- **Do:** At 1100 × 720, with Português (Brasil) active, open Home, Projects, the `NGC 7000 HOO` Project page, Sessions and Settings › Appearance.
- **Expect:** On each screen the toolbar, page header and its actions, and the status bar stay fully visible. Only content panes scroll; the window itself never scrolls and shows no horizontal scrollbar. Any label cut short (the toolbar's Next) shows its whole text in its tooltip.
- **Trace:** README §Notes (layout invariant at 1100×720) · IA §Fix pass (toolbar truncation with tooltip)

### S9 — Turn single-key shortcuts off {#S9}

- **Do:** Switch back to English (UK). In Keyboard, turn **Single-key shortcuts** off.
- **Expect:** The switch reads off, and its ⓘ tip reads "?, /, [ and G sequences. ⌘K and Ctrl+K always work." (J42 owns what each shortcut does.)
- **Trace:** appearance-page.tsx (Keyboard section) · J42

### S10 — Restart and find the choices kept {#S10}

- **Do:** Set theme Gruvbox Dark, density Compact and language Português (Brasil). Quit PlateVault and launch it again.
- **Expect:** The first frame after launch is already painted in Gruvbox Dark, at Compact density and in Portuguese, with no flash of PlateVault Dark or English. Settings › Aparência shows Gruvbox Dark, Compacta, Português (Brasil) and single-key shortcuts off.
- **Trace:** preferences.ts (stored preferences; pre-paint script)

### S11 — Restore the defaults {#S11}

- **Do:** In Aparência click **Restaurar padrões**, read the confirmation, and confirm.
- **Expect:** The confirmation lists exactly the four changes: theme PlateVault Dark, language English (UK), density Comfortable and single-key shortcuts on. After confirming, PlateVault reads English (UK) in PlateVault Dark at Comfortable density with single-key shortcuts on, and **Restore defaults** is disabled again with "Already at the defaults". Cancelling the confirmation instead changes nothing.
- **Trace:** appearance-page.tsx (Restore defaults, ConfirmDialog)

### S12 — Confirm the library is untouched {#S12}

- **Do:** Outside PlateVault, recompute the J19/P5 manifest. In PlateVault, count sessions, Projects and Activity entries.
- **Expect:** Every path, size and SHA-256 matches P5. The session, Project and Activity entry counts equal the P3 counts.
- **Expect (negative):** No appearance or language change in S2 to S11 created, edited or removed a catalog record or an Activity entry, or wrote, moved or renamed a file.
- **Trace:** preferences.ts (preferences stored outside the catalog)

## Success criteria

- SC1: S2 lists exactly 14 theme options (13 themes plus Match system), each theme with a swatch, and PlateVault Dark selected at start.
- SC2: In each theme chosen in S3 and S4, the measured contrast is at least 4.5:1 for text and status-pill text and at least 3:1 for UI glyphs and control borders.
- SC3: In S7, 0 English UI words remain on the 9 screens visited plus every Settings section; months and decimals follow pt-BR.
- SC4: In S8, on 5 screens at 1100 × 720, the window scroll height equals the viewport height and there is no horizontal scroll.
- SC5: After the S10 restart, all 4 appearance settings equal the values chosen before quitting, from the first frame.
- SC6: After S11, all 4 settings equal their defaults and Restore defaults is disabled.
- SC7: S12 manifest matches P5 for 100% of files, and the catalog and Activity counts are unchanged from P3.

## Known gaps

- G1: Not validated. The rebuilt application does not implement Settings › Appearance yet; the behavior follows the harness v5 design (ui-harness-v5 @ b5e813a5: HARNESS-V5-IA.md §S16 and §Round 2 foundation, HARNESS-V5-FEEDBACK-R1.md §Shell and navigation and §Round 1b, I18N.md, themes-contrast.md).
- G2: Unresolved implementation qualification: SC2 needs a contrast measurement over computed colours in the real webview; no validator script exists for it, and the harness figures in themes-contrast.md were computed from tokens, not from the running app. Blocks readiness.
- G3: Unresolved implementation qualification: S4 needs the validator to switch the OS appearance during a run on each desktop lane. Blocks readiness.
- G4: Out of scope: what each keyboard shortcut does (J42); per-library settings such as naming, goal templates, locations and applications (J41); equipment and sites (J15).

## Delta log

- No entries (initial draft, version 1).
