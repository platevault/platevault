---
id: J41
title: Set library and Project conventions in Settings for naming, goals, grouping, locations and applications
version: 6
status: draft
last_reviewed: 2026-10-12
actors: [primary-user]
surfaces: [settings, naming, goal-templates, grouping, locations, applications, import, projects, wrap-up, activity]
interfaces: [desktop-ui, desktop-ui-macos]
trace: [HARNESS-V5-FEEDBACK-R1.md#round-6, HARNESS-V5-IA.md#S16, HARNESS-V5-IA.md#round-2-foundation, HARNESS-V5-IA.md#round-2b-foundation, HARNESS-V5-FEEDBACK-R1.md#domain-and-seed, HARNESS-V5-FEEDBACK-R1.md#e2, HARNESS-V5-FEEDBACK-R1.md#round-5, HARNESS-V5-FEEDBACK-R1.md#round-7, P-ARC1, P-STO2, P-CAL3, P-PREP3, D-W20, D-W29, D-W30, D-W47, apps/prototype/src/domain/templates.ts, apps/prototype/src/features/v5/e-targets-plan-settings/settings-naming.tsx, apps/prototype/src/features/v5/e-targets-plan-settings/settings-goal-templates.tsx, apps/prototype/src/features/t1/settings/locations-page.tsx, apps/prototype/src/features/t4/applications.tsx, apps/prototype/src/store/actions/settings.ts, apps/prototype/src/store/actions/projects.ts, apps/prototype/messages/en-GB.json, ui-harness-v5@b5e813a5, specs/063-clean-rebuild-contract/workflow-decisions.md, LIB-FR-21, PLAN-EQ-FR-07, PLAN-EQ-FR-08, PRJ-FR-07, PRJ-FR-31, PRJ-FR-12, PRJ-FR-27, PRJ-FR-28, PREP-FR-04, PREP-FR-06, PREP-FR-15, PREP-FR-16, RES-FR-01, STO-IMP-FR-03, STO-IMP-FR-05, STO-IMP-FR-07, D-W84, D-W86, D-W93 to D-W106, D-W114]
---

## Goal

The user sets how imported files are named, which goals a new Project starts with, how its sessions are grouped, where archived sessions go, and which application opens its View. These conventions guide future work without renaming existing library files or changing a Project's current settings. Done means:

- A custom Lights naming template is saved, previewed against a real session, used by the next Import's destination preview, and restored to its default; no existing file is renamed.
- A user goal template `HOO deep` is created from the built-in HOO, its values are copied into a new Project, and later editing or deleting the template leaves that Project's goals unchanged.
- `Backup archive` becomes the Default archive location, while the Project that picked `Cold-1 archive` keeps it.
- PixInsight / WBPP has a located, checked executable, and Open in… has saved launch arguments, with nothing launched. The Default Project input mode is Symlinks, and on Windows the Developer Mode check reads On once the user turns it on.
- No step writes, moves or renames a file.

## Preconditions

- P1: A development catalog seeded to the state of J32/P1 to J32/P4: the rigs `RedCat` and `Esprit`, the five Projects of J32/P2 and the J19 sessions. Project `IC 1396 Ha` is open at Wrap up, with its Archive step not yet approved (G2).
- P2: Settings › Naming holds every default template. Settings › Goal templates holds only the built-in templates. No application profile has a located executable.
- P3: Three Archive locations are registered and online: `Archive` (volume `Archive`, the Default), `Backup archive` (`Backup/Archive`) and `Cold-1 archive` (`Cold-1/Archive`). In `IC 1396 Ha`'s Wrap up, the Archive step's destination was changed to `Cold-1 archive`. `Astro-T7 captures` and `Cold-1 captures` (`Cold-1/Captures`, holding the J19/P3 `12 Sep` session) are the Captures locations and `Astro-T7/Calibration` the Calibration location.
- P4: Removable volume `Card-2` holds the J31/P4 lights and has not been imported.
- P5: PixInsight is installed at `/Applications/PixInsight/PixInsight.app`, and its bundle can be renamed and renamed back outside PlateVault for S15 (a stand-in bundle at that path is acceptable). PixInsight is not running.
- P6: Manifests (relative path, size, SHA-256) of `Astro-T7`, `Cold-1`, `Backup`, `Archive` and `Card-2`, recorded outside PlateVault before S1.
- P7: On volume `Cold-1`, `Captures/` holds only the 24 `12 Sep` OIII lights, each 52,191,360 bytes (1,252,592,640 bytes in all, every one catalogued), and `Archive/` holds no file. `Cold-1/Other/backup.dmg`, a 1,000,000,000-byte file outside every registered location, is not catalogued. Immediately before S13 the validator records `Cold-1`'s free space as the OS reports it (for example `df -k`), and nothing writes to `Cold-1` between that reading and S13.
- P8: Settings › Applications' Default Project input mode reads Symlinks. On the `desktop-ui` (Windows) lane, Windows Developer Mode is off at the start, and the validator can turn it on in Windows Settings. The `desktop-ui-macos` lane has no Developer Mode prerequisite.

## Steps

### S1 — Open Settings › Naming {#S1}

- **Do:** Open Settings and choose Naming.
- **Expect:** The seven frame types are listed in this order with their default templates, and Lights is selected:
  - Lights `{target}/{filter}/{date}/light/`
  - Flats `flats/{filter}/{date}/`
  - Darks `darks/{exposure}/`
  - Bias `bias/`
  - Master flats `masters/flats/{filter}/`
  - Master darks `masters/darks/{exposure}/`
  - Master bias `masters/bias/`
- **Trace:** STO-IMP-FR-07 · D-W84 · D-W93

### S2 — Read the template field and its preview {#S2}

- **Do:** Read the Lights editor.
- **Expect:** A plain text field edits the Lights template, with a live preview beside it and a table of nine tokens: `{target}`, `{filter}`, `{date}`, `{frame_type}`, `{camera}`, `{exposure}`, `{gain}`, `{binning}` and `{set_temp}`. The table shows each token's rendering when its value is available and when it is not, and lets the user leave a token out when unavailable. The preview resolves a sample 18 Sep Ha session of NGC 7000 to `NGC 7000/Ha/2026-09-18/light/`.
- **Trace:** STO-IMP-FR-07 · STO-IMP-AC-08 · D-W84

### S3 — Edit and save the Lights template {#S3}

- **Do:** Set the Lights template to `{target}/{date}/{filter}/`. Read the live preview, then save.
- **Expect:** The live preview resolves the 18 Sep Ha session to `NGC 7000/2026-09-18/Ha/`. After saving, the Lights template reads `{target}/{date}/{filter}/`, and Activity records `Naming template saved` with the template text.
- **Expect (negative):** No file under `Astro-T7/Captures` is renamed or moved. No session's path in the catalog changes.
- **Trace:** STO-IMP-FR-07 · STO-IMP-AC-08 · D-W84

### S4 — Try an invalid template {#S4}

- **Do:** In the As text field, change the template to `{rig}/../{date}/` without saving.
- **Expect:** Typing `{rig}` shows an inline validation error because it is not a listed token, and the template cannot be saved. The `..` in the same template also shows an inline error and cannot be saved. Discard restores `{target}/{date}/{filter}/`.
- **Expect (negative):** The saved template does not change and no Activity entry is recorded.
- **Trace:** templates.ts validateNamingTemplate · settings-naming.tsx (inline refusal)

### S5 — Read the Master bias template {#S5}

- **Do:** Choose Master bias.
- **Expect:** The template reads `masters/bias/`. Its live preview is shown beside the template, and the token table lists available and unavailable renderings and the option to leave a token out when unavailable.
- **Trace:** STO-IMP-FR-07 · D-W84

### S6 — See the next Import use the new template {#S6}

- **Do:** Connect `Card-2`, open Import and pick `Card-2`. In the preview, read the `4 Oct` Ha session's Target, then choose NGC 7000 as its Target and read the destination preview for its lights. Close Import without importing.
- **Expect:**
  - Before the pick, the preview lists the `4 Oct` Ha session with no Target prefilled, because its lights carry no pointing (J31/P4); `OBJECT NGC7000` is shown only as a hint, and no destination under `NGC 7000/` or `NGC7000/` is listed.
  - After choosing NGC 7000, the lights' destination resolves through the saved Lights template to `NGC 7000/2026-10-04/Ha/` under `Astro-T7 captures`.
- **Expect (negative):** Closing Import copies, moves and renames nothing on `Card-2` or `Astro-T7`, and confirms no Target: no session from `Card-2` appears in Sessions. Files indexed before S3 keep their paths.
- **Trace:** STO-IMP-FR-03 · STO-IMP-FR-05 · STO-IMP-FR-07 · D-W20 · D-W24 · D-W84 · J31/S9

### S7 — Restore the default {#S7}

- **Do:** Back in Settings › Naming, choose Lights and click **Restore default**.
- **Expect:** The template reads `{target}/{filter}/{date}/light/` again, the pill reads "Default", and Activity records `Naming default restored`.
- **Trace:** settings.ts setNamingTemplate(type, null)

### S8 — Read the goal templates {#S8}

- **Do:** Open Settings › Goal templates.
- **Expect:** A Built-in box lists exactly five templates with their goals as channel chips and kinds: HOO (Ha 10h, OIII 10h); SHO (Ha 10h, OIII 10h, SII 10h); LRGB (L 6h with quality "Usable, FWHM ≤ 3″", R, G and B 2h each); OSC broadband (OSC 10h); OSC dual-band (Dual-band 15h). Every channel other than L reads quality Usable. Built-in rows offer only **Duplicate**. A Yours box reads "No templates of yours" with **New template**. No column or row names the Projects a template was applied in.
- **Trace:** Feedback §Domain and seed (goal kinds, structured channels, no Applied in) · D-W30 · D-W47 · templates.ts BUILT_IN_GOAL_TEMPLATES

### S9 — Create time and frame-count template goals {#S9}

- **Do:** Duplicate HOO. In the dialog, rename it `HOO deep`. Set Ha to 15 hours with a quality bar of FWHM ≤ 3.5″, set OIII to 120 frames with the same quality bar, and save.
- **Expect:** The dialog opens titled "Duplicate HOO" with the name "HOO copy" and HOO's values. Channels are chips from the band set (L, R, G, B, Ha, OIII, SII, OSC, Dual-band), never free text. After saving, Yours lists `HOO deep` with Ha 15h and OIII 120 frames, each with quality "Usable, FWHM ≤ 3.5″", offering Edit, Duplicate and Delete. Each goal has one unit, time or frames, never both. Activity records `Goal template saved: HOO deep`. HOO is unchanged.
- **Trace:** settings-goal-templates.tsx (duplicate, TemplateDialog) · PRJ-FR-03, PRJ-FR-12, PRJ-AC-32 · D-W29, D-W90 · HARNESS-V5-FEEDBACK-R1.md Round 9 C7

### S10 — Try invalid template values {#S10}

- **Do:** Click **New template** and save it empty. Then name it `HOO` and add an SII channel with neither hours nor frames, and save again. Cancel the dialog.
- **Expect:** The first save shows "Name required" and "Add a channel". The second shows "Name taken" and "Hours or frames needed · SII". The dialog stays open each time.
- **Expect (negative):** No template is added and no Activity entry is recorded.
- **Trace:** settings-goal-templates.tsx submit validation · PRJ-FR-03, PRJ-AC-32 · D-W90

### S11 — Copy `HOO deep` into a new Project {#S11}

- **Do:** Start a New Project named `IC 1396 HOO deep` with subject IC 1396, rig `RedCat` and goal template `HOO deep`, and create it (J20 owns the New Project sheet).
- **Expect:** The Project page's Goals read IC 1396 Ha goal 15h and OIII goal 120 frames, each with the quality bar "Usable, FWHM ≤ 3.5″". Each goal has one unit, time or frames.
- **Trace:** IA §Screens S4 (template values copied in and stay editable) · PRJ-FR-03, PRJ-AC-32 · D-W30, D-W90

### S11a — Give the subject a Finish by date {#S11a}

- **Do:** On `IC 1396 HOO deep`, edit the IC 1396 subject's goals, set **Finish by** to the date 12 nights from today, and save.
- **Expect:** The subject's goal progress shows "12 nights left". The goal values stay Ha 15h and OIII 120 frames.
- **Expect (negative):** Setting the date changes no file, no other subject and no template.
- **Trace:** PRJ-FR-23, PRJ-AC-33 · D-W90 · HARNESS-V5-FEEDBACK-R1.md "Goals, grilling round 4" (deadline or season window)

### S12 — Edit, then delete, the template {#S12}

- **Do:** In Settings › Goal templates, edit `HOO deep` to Ha 20 hours and save. Open `IC 1396 HOO deep`. Then delete `HOO deep` and confirm.
- **Expect:** The template reads Ha 20h after the edit. The confirmation is titled "Delete HOO deep?". After deleting, Yours reads "No templates of yours" and Activity records `Goal template deleted: HOO deep` with "Projects keep the values copied from it."
- **Expect (negative):** After the edit and after the delete, `IC 1396 HOO deep` still reads Ha goal 15h and OIII goal 120 frames with FWHM ≤ 3.5″. No other Project's goals change.
- **Trace:** settings.ts saveGoalTemplate, deleteGoalTemplate · D-W30 · PRJ-FR-03, D-W90

### S13 — Read Settings › Locations {#S13}

- **Do:** Open Settings › Locations.
- **Expect:** Locations lists registered Captures, Calibration and Archive locations. Each row names the location, its path, its availability and access, and its disk use as two figures: the bytes PlateVault catalogues under that location, and its volume's free space. The Archive group lists `Archive` with a "Default" pill, and `Backup archive` and `Cold-1 archive` each offering **Make default**. Every row's More actions menu, and right-click, offers the location's actions. There is no Storage page in the source list. On volume `Cold-1` (P7):
  - `Cold-1 captures` reads 1,252,592,640 bytes catalogued, shown at the display's rounding (`1.25 GB` to three significant figures), and `Cold-1 archive` reads zero bytes catalogued.
  - Both `Cold-1` rows show the same free space, equal at display rounding to the P7 reading.
- **Expect (negative):** Neither `Cold-1` row counts `backup.dmg`: `Cold-1 captures` does not read 2.25 GB or more, and `Cold-1 archive` does not read 1 GB. No row shows the volume's used space in place of the catalogued bytes. Opening Locations starts no rescan or index.
- **Trace:** HARNESS-V5-FEEDBACK-R1.md §Round 6 "Disk use per location: bytes PlateVault catalogues there, plus the volume's free space" · IA §Screens S16 (Locations: several archive locations, one Default pill, Make default) · Feedback §Round 5 P-STO2 · P-ARC1 · locations-page.tsx

### S14 — Make `Backup archive` the Default {#S14}

- **Do:** Click **Make default** on `Backup archive`. Then open `IC 1396 Ha`'s Wrap up and read the Archive step's destination.
- **Expect:** The "Default" pill moves to `Backup archive`; `Archive` and `Cold-1 archive` now offer Make default. Activity records `Default archive: Backup archive`. In `IC 1396 Ha`'s Wrap up, the destination still reads `Cold-1 archive`, and the destination picker marks `Backup archive` as the Default.
- **Expect (negative):** `IC 1396 Ha`'s chosen destination does not change. Nothing is archived or moved; the Archive step stays unapproved.
- **Trace:** P-ARC1 · settings.ts setDefaultArchiveLocation · projects.ts setProjectArchiveLocation · J34

### S15 — Locate and check PixInsight {#S15}

- **Do:** Open Settings › Applications. On PixInsight / WBPP click **Locate…**, choose `PixInsight.app` and confirm. Outside PlateVault, rename the bundle away, then click **Check again**; rename it back and click **Check again**.
- **Expect:** Applications lists four profiles in order: PixInsight / WBPP, Siril, SETI Astro Suite Pro and Open in…. Each names its capability claims as label and value rows with a profile badge, and an Application row that reads "Not configured" with "No application located". After locating, PixInsight / WBPP's Application row reads "Found" with `/Applications/PixInsight/PixInsight.app`, and its buttons read **Check again** and **Change…**. With the bundle renamed away, Check again shows "Missing"; with it back, "Found".
- **Expect (negative):** Locating and checking start no PixInsight process and launch nothing.
- **Trace:** IA §Screens S16 (Applications) · applications.tsx · settings.ts locateExecutable, checkExecutable · J23 (Siril)

### S16 — Save launch arguments for Open in… {#S16}

- **Do:** On Open in…, type `--input "{viewFolder}"` in Launch arguments and click **Save arguments**.
- **Expect:** Save arguments is disabled until the field differs from the saved value. After saving, the field holds `--input "{viewFolder}"` and Save arguments is disabled again. The ⓘ beside Open in… states that it is not a verified preparation profile.
- **Expect (negative):** Saving starts no application.
- **Trace:** applications.tsx LaunchArguments · settings.ts setLaunchArgs

### S16a — Set the default Project input mode and check Windows Developer Mode {#S16a}

- **Do:** In Settings › Applications, choose **Copies** under Default input mode, then **Symlinks** again. On the `desktop-ui` lane, read the Windows Developer Mode row, choose **Open Windows settings**, turn Developer Mode on, return to PlateVault and click **Check again**.
- **Expect:**
  - Default input mode reads Symlinks and offers Copies. After each choice it reads the chosen mode.
  - On the `desktop-ui` lane, Windows Developer Mode reads Off, with **Open Windows settings** and **Check again**. **Open Windows settings** opens Windows Settings at its Developer Mode setting. After **Check again** the row reads On.
  - On the `desktop-ui-macos` lane, the Processing group shows no Windows Developer Mode row.
- **Expect (negative):** Choosing a default copies, links or moves no file and changes no existing Project's input mode or View entries. **Open Windows settings** alone does not change the row: it reads On only after **Check again**.
- **Trace:** PREP-FR-04 · PREP-FR-15 · D-W98 · D-W100

### S16b — Read global Project grouping defaults {#S16b}

- **Do:** In Settings, open the global Project grouping preferences. Read the framing and mosaic-panel thresholds and the GROUP and PANEL keyword names.
- **Expect:** Same framing requires at least 90 % coverage, the centre limit in D-W114 and rotation within 5°. Each setting can be adjusted. Import review can override the centre limit per import for that import's session split only. It does not affect Project grouping. The mosaic-panel overlap default is 5 % to 40 %. GROUP is the default folder keyword and PANEL marks mosaic groups; both names can be configured globally and per Project. A Project gets group folders only when it has multiple groups. (PRJ-FR-31; D-W114; owner's answer, 2026-10-20)
- **Expect (negative):** Reading these defaults changes no existing Project group or View.
- **Trace:** PRJ-FR-31 · PRJ-FR-28 · PRJ-FR-29 · PREP-FR-16 · D-W95 · D-W100 · D-W114

### S17 — Confirm nothing changed on disk {#S17}

- **Do:** Recompute the P6 manifests, outside PlateVault, with PixInsight's bundle back at its path.
- **Expect:** Every path, size and SHA-256 matches P6.
- **Expect (negative):** No Settings change in S1 to S16b wrote, moved, renamed or trashed a file.
- **Trace:** HLD trust rules · README §Product rules (every move is proposed as a plan first)

## Success criteria

- SC1: S1 lists exactly 7 frame types with the default templates, and S2's token table offers exactly 9 tokens.
- SC2: After S3, 1 Lights template is saved and the S6 Import preview, once NGC 7000 is picked, resolves to `NGC 7000/2026-10-04/Ha/`; after S7, 0 naming templates are custom.
- SC3: S4 and S10 save 0 changes and record 0 Activity entries.
- SC4: S8 lists exactly 5 built-in templates with the D-W47 values, and 0 Applied in references.
- SC5: `IC 1396 HOO deep` reads Ha 15h and OIII 120 frames with FWHM ≤ 3.5″ after S11, after the S12 edit and after the S12 delete.
- SC6: After S14, exactly 1 Archive location carries the Default pill (`Backup archive`) and `IC 1396 Ha`'s destination is `Cold-1 archive`.
- SC7: After S15 and S16, PixInsight / WBPP reads Found and Open in… holds the saved arguments, with 0 application processes started.
- SC8: S17 manifests match P6 for 100% of files.
- SC9: At S13, `Cold-1 captures` shows 1,252,592,640 catalogued bytes and `Cold-1 archive` 0, both at display rounding, and both show the P7 free space.
- SC10: After S16a the Default Project input mode reads Symlinks, and no existing Project changes its input mode. On the `desktop-ui` lane, the Developer Mode row reads On only after **Check again**.

## Known gaps

- G1: Not validated. The rebuilt application does not implement these Settings sections in this form yet. The expected behavior follows LIB-FR-21, PLAN-EQ-FR-07, PLAN-EQ-FR-08, PRJ-FR-31, PRJ-FR-28, PREP-FR-04, PREP-FR-15, STO-IMP-FR-07 and D-W84 to D-W116, including the D-W114 defaults that S16b reads.
- G2: Unresolved implementation qualification: P1 needs a seeded catalog (J32's fixture world plus P3's three Archive locations and the Project's Wrap up destination). No fixture builder exists. Blocks readiness.
- G3: (dissolved 2026-10-12): answered by Round 6 "Disk use per location"; S13 now asserts each row's catalogued bytes plus its volume's free space, with the `Cold-1` figures of P7 and an uncatalogued file that must not be counted.
- G4: Out of scope:
  - equipment, sites and Target lookup (J15);
  - Settings › Calibration "Keep raw calibration frames" (J36);
  - appearance and language (J40);
  - adding, rescanning, retiring and remapping locations (J19, J28);
  - choosing the destination inside Wrap up and approving Archive (J34);
  - a profile's launch failure when opening a Project's View (J24).
- G5: The validation lane must be able to rename the PixInsight bundle (P5) without affecting the user's own install; on a machine with PixInsight in use, a stand-in bundle is required.

## Delta log

- **Δ2** 2026-10-12 · S6, S13 · behavior-change
  Settings › Locations shows each location's disk use as the bytes PlateVault catalogues there plus its volume's free space.
  The Import preview prefills no Target for Card-2's no-pointing session (OBJECT is a hint only); the destination resolves once the user picks NGC 7000.
  Evidence: HARNESS-V5-FEEDBACK-R1.md §Round 6 (user, 2026-10-10) "Disk use per location", "P-IMP2: confirm Targets in the Import preview" (apps/prototype/design/ on ui-harness-v5 @ 4f470775); user answers to the PR #1788 journey questions · by: JourneysV5.R6G (intent-gated)
- **Δ3** 2026-10-12 · +S16a · behavior-change
  Settings › Applications holds the Default run view (Symlinks or Copies) and, on Windows, a Windows Developer Mode check with Open Windows settings and Check again.
  Evidence: HARNESS-V5-FEEDBACK-R1.md §Round 7 (user, 2026-10-12) P-PREP3 (apps/prototype/design/ on ui-harness-v5 @ 12638a7c); Settings placement as the U9 prototype slice builds it (R7U9Views, 2026-10-12) · by: JourneysV5.R7Prep3 (intent-gated)
- **Δ4** 2026-10-15 · S1, S2, S3, S4, S5, S6, S13, S16a, +S16b · behavior-change
  Naming uses plain text templates and a token table; the Project input mode replaces the run view. Global Settings cover Project framing and GROUP/PANEL folder keywords.
  Evidence: D-W84 to D-W106, STO-IMP-FR-07, PRJ-FR-31, PRJ-FR-28 and PREP-FR-04 · by: SpecF4Writer2 (intent-gated)
- **Δ5** 2026-10-16 · S16b · behavior-change
  The framing and mosaic-panel defaults are settled values, adjustable in Settings, and a one-group Project has no group folder even when its group is a mosaic panel.
  Evidence: D-W114 (owner's answers of 2026-10-15/16) in PR #1804, PRJ-FR-28, PRJ-FR-29, PRJ-FR-31 · by: SpecF4Answers (intent-gated)
- **Δ6** 2026-10-17 · S9, S10, S11, +S11a, S12 · behavior-change
  Each goal is time or frames, never both, with an optional quality bar: `HOO deep` now holds Ha 15h and OIII 120 frames, each with FWHM ≤ 3.5″, and the Project copies them unchanged. New S11a sets a Finish by date on the subject, whose progress then shows the nights left.
  Evidence: HARNESS-V5-FEEDBACK-R1.md Round 9 C7 and "Goals, grilling round 4" · D-W90 · PRJ-FR-03, PRJ-FR-23, PRJ-AC-32, PRJ-AC-33 · by: JourneysR9c (intent-gated)
