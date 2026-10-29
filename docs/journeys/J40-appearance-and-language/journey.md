---
id: J40
title: Choose a theme and language in Settings › Appearance and keep them across restarts
version: 6
status: draft
last_reviewed: 2026-10-29
actors: [primary-user]
surfaces: [settings, appearance, i18n, shell, status-bar, home, activity, keyboard]
interfaces: [desktop-ui, desktop-ui-macos]
trace: [HARNESS-V5-IA.md#S16, HARNESS-V5-IA.md#round-2-foundation, HARNESS-V5-IA.md#fix-pass, HARNESS-V5-FEEDBACK-R1.md#shell-and-navigation, HARNESS-V5-FEEDBACK-R1.md#round-1b, HARNESS-V5-FEEDBACK-R1.md#copy-rules, I18N.md, themes-contrast.md, apps/prototype/src/features/t1/settings/appearance-page.tsx, apps/prototype/src/app/appearance.tsx, apps/prototype/src/app/preferences.ts, apps/prototype/src/app/themes.ts, apps/prototype/src/lib/i18n.ts, apps/prototype/src/lib/format.ts, apps/prototype/messages/en-GB.json, apps/prototype/messages/pt-BR.json, ui-harness-v5@b5e813a5, ui-harness-v5@d9255cff, ui-harness-v5@277fc2ac, docs/journeys/J10-settings-appearance-i18n/journey.md, LIB-FR-21, LIB-AC-01, FR-030, D-W86, D-W93 to D-W106, D-W170]
---

## Goal

The user chooses how PlateVault looks and reads: they set its appearance mode, choose a theme, and choose the interface language. They expect the choices to apply across screens and persist after a restart. Choosing appearance is personal and must never touch the library. Done means:

- Settings › Appearance sets the mode to Dark, Light or Match system and offers 13 themes and a language select with two languages. Match system picks one dark theme and one light theme. Theme, mode, language and single-key shortcut choices apply immediately and persist in PlateVault's per-user settings store outside every library; they are in effect before the first frame after restart. The app uses one density and offers no density setting.
- With Português (Brasil) chosen, the shell, every screen visited and the copy recorded earlier (Activity) read in Portuguese, with pt-BR month names and number separators, and no English UI word is left.
- Restore defaults returns the theme to PlateVault Dark, the language to English (UK) and single-key shortcuts to on.
- No appearance change writes a catalog record, an Activity entry, or a library or user file; only PlateVault's own settings store changes.

## Preconditions

- P1: Fresh replay of J19 and J20: the catalogue holds the J19 sessions and the open Project `NGC 7000 HOO` (subject NGC 7000, rig `RedCat`), and Activity lists `Project created: NGC 7000 HOO`. Appearance is at its defaults: mode Match system, with PlateVault Dark as its dark theme and PlateVault Light as its light theme, language English (UK), single-key shortcuts on. Setup saved Home's planning criteria (J19/S5).
- P2: The PlateVault window is sized to 1280 × 640 (the minimum on macOS, Windows and Linux). At start-up, a restored window is moved and shrunk to fit fully on a connected screen. The OS appearance can be switched between Dark and Light during the run.
- P3: The J19/P5 manifest is available, and the catalog's session, Project and Activity entry counts are recorded before S1.

## Steps

### S1 — Open Settings › Appearance {#S1}

- **Do:** Open Settings and choose Appearance.
- **Expect:** Settings lists its sections in groups: General (Appearance, Help, About), Library (Locations, Equipment, Naming, Calibration, Sites, Target lookup), Projects (Goal templates) and Processing (Applications). Appearance sets the mode and theme, then the language and keyboard preferences. The app has one density and no density setting. A **Restore defaults** button is disabled with the tooltip "Already at the defaults". There is no Save button.
- **Trace:** LIB-FR-21 · LIB-AC-45 · D-W86, D-W143, D-W166
- **Trace:** HARNESS-V5-IA.md §Screens S16 · settings-layout.tsx · navigation.ts SETTINGS_SECTIONS

### S2 — Read the theme picker {#S2}

- **Do:** Read the Theme section.
- **Expect:** It offers 13 themes: PlateVault Dark, PlateVault Light, Gruvbox Dark, Gruvbox Light, Nord, Dracula, Solarized Dark, Solarized Light, Catppuccin Mocha, Catppuccin Latte, Tokyo Night, One Dark and Rosé Pine. Each option shows a swatch: a miniature window painted in that theme's own colours, with a source list and its selection, a toolbar, text lines, a primary button and four status dots (success, warning, danger, info). PlateVault Dark is selected. Match system is an appearance mode, not a theme option.
- **Trace:** LIB-FR-21 · LIB-AC-45 · D-W86, D-W143, D-W166 · Feedback §Shell 5 · themes-contrast.md
- **Trace:** Feedback §Shell 5 · IA §Round 2 foundation Themes · appearance.tsx ThemePicker, ThemeSwatch · themes.ts

### S3 — Switch themes and check legibility {#S3}

- **Do:** Choose Nord, then open Home, Sessions and the `NGC 7000 HOO` Project page. Return to Appearance and choose Catppuccin Latte, then Solarized Light.
- **Expect:** Each choice repaints the whole window, including the toolbar, source list and status bar, before the next action, with no reload. Nord, Catppuccin Latte and Solarized Light each match their swatch. In every theme chosen, body text and status-pill text measure at least 4.5:1 against the surface behind them, and UI glyphs and control borders at least 3:1.
- **Expect (negative):** Activity gains no entry. Home, Sessions and the Project page show the same sessions, counts and goals as before the switch.
- **Trace:** Feedback §Shell 5 (4.5:1 on every surface) · themes-contrast.md §Summary · preferences.ts setTheme

### S4 — Follow the OS appearance {#S4}

- **Do:** Choose Match system as the appearance mode, with its dark theme PlateVault Dark and its light theme PlateVault Light. Switch the OS appearance to Light. Switch it to Dark.
- **Expect:** With Match system selected, PlateVault shows PlateVault Light when the OS is in Light mode and PlateVault Dark when it is in Dark mode. Each switch takes effect while PlateVault stays open, without touching any PlateVault control.
- **Trace:** LIB-FR-21 · LIB-AC-23, LIB-AC-45 · D-W86, D-W143, D-W166

### S5 — Confirm the single density {#S5}

- **Do:** Open Sessions, then Settings › Appearance, and inspect the density controls.
- **Expect:** Appearance offers no density control. Sessions and the other visited screens use the app's single density.
- **Expect (negative):** No density choice is available, and opening Appearance or Sessions changes no column, filter or sort.
- **Trace:** LIB-FR-21 · D-W86

### S6 — Read the language picker {#S6}

- **Do:** Read the Language section.
- **Expect:** The language is a select that offers exactly two languages, each named in its own language: English (UK) and Português (Brasil). Português (Brasil) is marked machine-generated. English (UK) is selected.
- **Trace:** LIB-FR-21 · D-W143 · Feedback §Shell 6 · IA §Screens S16 ("pt-BR marked machine-generated") · I18N.md §pt-BR · i18n.ts LOCALE_META

### S7 — Switch to Português (Brasil) {#S7}

- **Do:** Choose Português (Brasil). Without restarting, visit Home, Projects, the `NGC 7000 HOO` Project page, Sessions, a session detail, Targets, Calibration, Activity and each Settings section.
- **Expect:**
  - The switch takes effect on the open screen at once.
  - The source list reads Início, Projetos, Alvos, Sessões, Calibração and Atividade.
  - The Settings section list reads Aparência, Locais, Nomenclatura, Modelos de metas and Aplicativos.
  - Appearance has one density across screens and no density setting, and its button reads Restaurar padrões.
  - The machine-generated pill reads "Tradução automática", and the idle status bar reads "Ocioso".
  - Observing nights use pt-BR month names ("18 set", "30 set"), and decimal numbers and sizes use a decimal comma ("12,4 GB"). Activity's earlier entry reads `Projeto criado: NGC 7000 HOO`.
  - Every button, heading, column header, status word, tooltip, empty state and refusal on the visited screens is in Portuguese. Proper names stay as written: PlateVault, theme names, Target, rig, Project and file names, paths, header values, filter names and palette names (HOO, SHO, LRGB).
- **Expect (negative):** No English UI word remains on any visited screen. No reload, re-index or rescan starts. Session names, Project names and file paths are not translated or changed.
- **Trace:** 063 FR-040 · Feedback §Shell 6 · §Round 1b i18n gate · I18N.md §Using a message (MessageRef worded at render) · format.ts (MONTHS, Intl locale) · ui-harness-v5@d9255cff, @277fc2ac

### S8 — Check the layout in Portuguese {#S8}

- **Do:** At 1280 × 640, with Português (Brasil) active, open Home, Projects,
  the `NGC 7000 HOO` Project page, Sessions and Settings › Appearance.
- **Expect:** On each screen the toolbar, page header and its actions, and the status bar stay fully visible. Only content panes scroll; the window itself never scrolls and shows no horizontal scrollbar. Any label cut short (the toolbar's Next) shows its whole text in its tooltip.
- **Trace:** 063 FR-041 · README §Notes (layout invariant at 1280×640) · IA §Fix pass (toolbar truncation with tooltip)

### S9 — Turn single-key shortcuts off {#S9}

- **Do:** Switch back to English (UK). In Keyboard, turn **Single-key shortcuts** off.
- **Expect:** The switch reads off, and its ⓘ tip reads "?, /, [ and G sequences. ⌘K and Ctrl+K always work." (J42 owns what each shortcut does.)
- **Trace:** appearance-page.tsx (Keyboard section) · J42 · 063 FR-042

### S10 — Restart and find the choices kept {#S10}

- **Do:** Set theme Gruvbox Dark and language Português (Brasil). Quit PlateVault and launch it again.
- **Expect:** The first frame after launch is already painted in Gruvbox Dark and Portuguese, with no flash of PlateVault Dark or English. Settings › Aparência shows Gruvbox Dark, Português (Brasil) and single-key shortcuts off.
- **Trace:** LIB-FR-21 · LIB-AC-45 · D-W166 · preferences.ts (stored preferences; pre-paint script)

### S11 — Restore the defaults {#S11}

- **Do:** In Aparência click **Restaurar padrões**, read the confirmation, and confirm.
- **Expect:** After confirming, PlateVault reads English (UK) in PlateVault Dark with single-key shortcuts on, and **Restore defaults** is disabled again with "Already at the defaults". Cancelling the confirmation instead changes nothing.
- **Trace:** LIB-FR-21 · LIB-AC-45 · D-W143 (the theme pair) · appearance-page.tsx (Restore defaults, ConfirmDialog)

### S12 — Confirm the library is untouched {#S12}

- **Do:** Outside PlateVault, recompute the J19/P5 manifest. In PlateVault, count sessions, Projects and Activity entries.
- **Expect:** Every path, size and SHA-256 matches P5. The session, Project and Activity entry counts equal the P3 counts.
- **Expect (negative):** No appearance or language change in S2 to S11 created, edited or removed a catalog record or an Activity entry, or wrote, moved or renamed a library or user file. Only PlateVault's own settings store changed.
- **Trace:** LIB-FR-21 · LIB-AC-45 · D-W166 · preferences.ts (preferences stored outside the catalog)

## Success criteria

- SC1: S2 lists exactly 13 themes, each with a swatch, and PlateVault Dark is selected at start. Appearance has no density setting.
- SC2: In each theme chosen in S3 and S4, the measured contrast is at least 4.5:1 for text and status-pill text and at least 3:1 for UI glyphs and control borders.
- SC3: In S7, 0 English UI words remain on the 9 screens visited plus every Settings section; months and decimals follow pt-BR.
- SC4: In S8, on 5 screens at 1280 × 640, the window scroll height equals the viewport height and there is no horizontal scroll.
- SC5: After the S10 restart, the selected theme, language and keyboard shortcut preference equal the values chosen before quitting, from the first frame.
- SC6: After S11, the theme is PlateVault Dark, the language is English (UK), single-key shortcuts are on and Restore defaults is disabled.
- SC7: S12 manifest matches P5 for 100% of files, and the catalog and Activity counts are unchanged from P3.

## Known gaps

- G1: Not validated. The rebuilt application does not implement Settings › Appearance yet; the behavior follows the harness v5 design (ui-harness-v5 @ b5e813a5: HARNESS-V5-IA.md §S16 and §Round 2 foundation, HARNESS-V5-FEEDBACK-R1.md §Shell and navigation and §Round 1b, I18N.md, themes-contrast.md).
- G2: Unresolved implementation qualification: SC2 needs a contrast measurement over computed colours in the real webview; no validator script exists for it, and the harness figures in themes-contrast.md were computed from tokens, not from the running app. Blocks readiness.
- G3: Unresolved implementation qualification: S4 needs the validator to switch the OS appearance during journey validation on each desktop lane. Blocks readiness.
- G4: Out of scope: what each keyboard shortcut does (J42); per-library settings such as naming, goal templates, locations and applications (J41); equipment and sites (J15).

## Delta log
- **Δ2** 2026-10-15 · S1, S2, S4, S5, S7, S10, S11 · behavior-change
  Appearance has one density and no density setting. Dark, Light and Follow system are modes; Match system is no longer a theme option.
  Evidence: D-W86 and LIB-FR-21 · by: SpecF4Writer2 (intent-gated)
- **Δ3** 2026-10-26 · P1, S2, S4, S6 · behavior-change
  Follow system is named Match system and picks one dark and one light theme, and the language is a select.
  Evidence: HARNESS-V5-FEEDBACK-R1.md §Round 11 (OWNER, 2026-10-23) on ui-harness-v5 @ 5dc245244; D-W143, LIB-FR-21, LIB-AC-23 · by: SpecAmend (intent-gated)
- **Δ4** 2026-10-26 · P2, S8, SC4 · behavior-change
  The minimum window is now 1280×640 on macOS, Windows and Linux; a restored
  window is moved and shrunk at start-up to fit a connected screen.
  Evidence: D-W163, astro-plan-ocyuc.2, PR #1889 · by: WindowDocs (intent-gated)
- **Δ5** 2026-10-28 · S1, S2, S4, S5, S6, S9-S12 · behavior-change
  Appearance and language use the per-user settings store outside every library, apply at once and load before the first frame after restart; J40 stays density-free. S3's contrast-ratio check remains without an owning requirement in specs 063-072.
  Evidence: LIB-FR-21, LIB-AC-45, D-W166 · astro-plan-0v2o0.3, astro-plan-ocyuc.5 · by: SpecOwner2 (intent-gated)
- **Δ6** 2026-10-29 · P1 · behavior-change
  P1 starts after setup saved Home's planning criteria. The setup wizard sets them, and they have no defaults.
  Evidence: D-W170, LIB-FR-01, LIB-AC-01 · owner's answer, 2026-10-29, astro-plan-0v2o0.4 · by: Amend5Fix (intent-gated)
