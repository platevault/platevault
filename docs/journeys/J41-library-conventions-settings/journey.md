---
id: J41
title: Set library conventions in Settings: naming templates, goal templates, locations and applications
version: 2
status: draft
last_reviewed: 2026-10-12
actors: [primary-user]
surfaces: [settings, naming, goal-templates, locations, applications, import, projects, wrap-up, activity]
interfaces: [desktop-ui, desktop-ui-macos]
trace: [HARNESS-V5-FEEDBACK-R1.md#round-6, HARNESS-V5-IA.md#S16, HARNESS-V5-IA.md#round-2-foundation, HARNESS-V5-IA.md#round-2b-foundation, HARNESS-V5-FEEDBACK-R1.md#domain-and-seed, HARNESS-V5-FEEDBACK-R1.md#e2, HARNESS-V5-FEEDBACK-R1.md#round-5, P-ARC1, P-STO2, P-CAL3, D-W20, D-W29, D-W30, D-W47, apps/prototype/src/domain/templates.ts, apps/prototype/src/features/v5/e-targets-plan-settings/settings-naming.tsx, apps/prototype/src/features/v5/e-targets-plan-settings/settings-goal-templates.tsx, apps/prototype/src/features/t1/settings/locations-page.tsx, apps/prototype/src/features/t4/applications.tsx, apps/prototype/src/store/actions/settings.ts, apps/prototype/src/store/actions/projects.ts, apps/prototype/messages/en-GB.json, ui-harness-v5@b5e813a5, specs/063-clean-rebuild-contract/workflow-decisions.md]
---

## Goal

The user sets the conventions the library follows: how imported and stored files are named, which goal sets a new Project starts from, where archives go, and which processing applications PlateVault hands runs to. They need each change to take effect for future work only, without renaming files that already exist or rewriting Projects already set up. Done means:

- A custom Lights naming template is saved, previewed against a real session, used by the next Import's destination preview, and restored to its default; no existing file is renamed.
- A user goal template `HOO deep` is created from the built-in HOO, its values are copied into a new Project, and later editing or deleting the template leaves that Project's goals unchanged.
- `Backup archive` becomes the Default archive location, while the Project that picked `Cold-1 archive` keeps it.
- PixInsight / WBPP has a located, checked executable, and Open in… has saved launch arguments, with nothing launched.
- No step writes, moves or renames a file.

## Preconditions

- P1: A development catalog seeded to the state of J32/P1 to J32/P4: the rigs `RedCat` and `Esprit`, the five Projects of J32/P2 and the J19 sessions. `IC 1396 Ha`'s only run `IC1396-Ha-Siril` is Complete, so the Project is at its Wrap up stage (J34), with its Archive step not yet approved (G2).
- P2: Settings › Naming holds every default template. Settings › Goal templates holds only the built-in templates. No application profile has a located executable.
- P3: Three Archive locations are registered and online: `Archive` (volume `Archive`, the Default), `Backup archive` (`Backup/Archive`) and `Cold-1 archive` (`Cold-1/Archive`). In `IC 1396 Ha`'s Wrap up, the Archive step's destination was changed to `Cold-1 archive`. `Astro-T7 captures` and `Cold-1 captures` (`Cold-1/Captures`, holding the J19/P3 `12 Sep` session) are the Captures locations and `Astro-T7/Calibration` the Calibration location.
- P4: Removable volume `Card-2` holds the J31/P4 lights and has not been imported.
- P5: PixInsight is installed at `/Applications/PixInsight/PixInsight.app`, and its bundle can be renamed and renamed back outside PlateVault for S15 (a stand-in bundle at that path is acceptable). PixInsight is not running.
- P6: Manifests (relative path, size, SHA-256) of `Astro-T7`, `Cold-1`, `Backup`, `Archive` and `Card-2`, recorded outside PlateVault before S1.
- P7: On volume `Cold-1`, `Captures/` holds only the 24 `12 Sep` OIII lights, each 52,191,360 bytes (1,252,592,640 bytes in all, every one catalogued), and `Archive/` holds no file. `Cold-1/Other/backup.dmg`, a 1,000,000,000-byte file outside every registered location, is not catalogued. Immediately before S13 the validator records `Cold-1`'s free space as the OS reports it (for example `df -k`), and nothing writes to `Cold-1` between that reading and S13.

## Steps

### S1 — Open Settings › Naming {#S1}

- **Do:** Open Settings and choose Naming.
- **Expect:** Frame types are listed in this order, each with its current template underneath: Lights `{target}/{filter}/{date}/light/`; Flats `Raw/Flats/{filter}/{date}/`; Darks `Raw/Darks/{exposure}/{date}/`; Bias `Raw/Bias/{date}/`; Master flats `Flats/{train}/{filter}/{date}/`; Master darks `Darks/{camera}/{exposure}_g{gain}_o{offset}_{set_temp}/`; Master bias `Bias/{camera}/g{gain}_o{offset}/`; Master dark flats `Dark flats/{camera}/{exposure}_g{gain}_o{offset}_{set_temp}/`. Lights is selected and shows a "Default" pill.
- **Trace:** IA §Screens S16 (Naming: the master types including dark flats) · IA §Round 2b (structured storage) · templates.ts DEFAULT_NAMING · P-CAL3

### S2 — Read the chip editor and its preview {#S2}

- **Do:** Read the Lights editor.
- **Expect:** The template is a row of chips: tokens, `/` folder separators and literal text. A token palette offers exactly 11 tokens: `{target}`, `{filter}`, `{date}`, `{frame_type}`, `{train}`, `{camera}`, `{exposure}`, `{gain}`, `{offset}`, `{binning}` and `{set_temp}`; each one's tooltip names the fallback it uses when metadata lacks it (for example `{target}` falls back to "unclassified"). Beside them are "/ folder" and "Add text". The Preview reads "Library · " plus one light session of the catalog, and shows that session's folder resolved under the Captures root as `<Target>/<filter>/<night as YYYY-MM-DD>/light/` (for a 18 Sep Ha session of NGC 7000: `NGC 7000/Ha/2026-09-18/light/`), with a "No fallbacks" pill.
- **Trace:** IA §Screens S16 (11 tokens, chip editor, live preview) · D-W20 · settings-naming.tsx · templates.ts NAMING_TOKENS

### S3 — Edit and save the Lights template {#S3}

- **Do:** Insert `{train}` and move its chip with the keyboard (⌥← and ⌥→) until it sits between `{target}` and `{filter}`. Read the preview, then click **Save**.
- **Expect:** While edited, an "Unsaved" pill shows beside Preview, and the preview already resolves the new template for the same session, with the rig name as the second folder (`NGC 7000/RedCat/Ha/2026-09-18/light/` for the 18 Sep example). After Save, the template reads `{target}/{train}/{filter}/{date}/light/`, the pill reads "Custom", the Frame types list shows the new template under Lights, and Activity records `Naming template saved` with the template text.
- **Expect (negative):** No file under `Astro-T7/Captures` is renamed or moved. No session's path in the catalog changes.
- **Trace:** settings-naming.tsx (moves, Save, Unsaved) · settings.ts setNamingTemplate

### S4 — Try an invalid template {#S4}

- **Do:** In the As text field, change the template to `{rig}/../{date}/` without saving.
- **Expect:** The editor shows "Not saved · Unknown token {rig}, A folder cannot be `..`", the `{rig}` part is shown as literal text, not a token chip, and **Save** is disabled. Click **Discard**: the field returns to `{target}/{train}/{filter}/{date}/light/`.
- **Expect (negative):** The saved template does not change and no Activity entry is recorded.
- **Trace:** templates.ts validateNamingTemplate · settings-naming.tsx (inline refusal)

### S5 — Preview a master type with no library example {#S5}

- **Do:** Choose Master dark flats.
- **Expect:** The template reads `Dark flats/{camera}/{exposure}_g{gain}_o{offset}_{set_temp}/`. Because the library holds no master dark flat, the Preview reads "No metadata" and lists one fallback pill per missing token, including `{camera} → unknown-camera`, `{gain} → unknown-gain`, `{offset} → unknown-offset` and `{set_temp} → untempered`.
- **Trace:** settings-naming.tsx sampleValues · templates.ts resolveNamingTemplate · P-CAL3

### S6 — See the next Import use the new template {#S6}

- **Do:** Connect `Card-2`, open Import and pick `Card-2`. In the preview, read the `4 Oct` Ha session's Target, then choose NGC 7000 as its Target and read the destination preview for its lights. Close Import without importing.
- **Expect:**
  - Before the pick, the preview lists the `4 Oct` Ha session with no Target prefilled, because its lights carry no pointing (J31/P4); `OBJECT NGC7000` is shown only as a hint, and no destination under `NGC 7000/` or `NGC7000/` is listed.
  - After choosing NGC 7000, the lights' destination folder resolves through the saved Lights template, with the optical train from the files' TELESCOP header: `NGC 7000/RedCat 51/Ha/2026-10-04/light/` under `Astro-T7 captures`.
- **Expect (negative):** Closing Import copies, moves and renames nothing on `Card-2` or `Astro-T7`, and confirms no Target: no session from `Card-2` appears in Sessions. Files indexed before S3 keep their paths.
- **Trace:** templates.ts headerNamingValues (`train` from TELESCOP) · import-model.ts · HARNESS-V5-FEEDBACK-R1.md §Round 6 P-IMP2 "confirm Targets in the Import preview" · J31/S9

### S7 — Restore the default {#S7}

- **Do:** Back in Settings › Naming, choose Lights and click **Restore default**.
- **Expect:** The template reads `{target}/{filter}/{date}/light/` again, the pill reads "Default", and Activity records `Naming default restored`.
- **Trace:** settings.ts setNamingTemplate(type, null)

### S8 — Read the goal templates {#S8}

- **Do:** Open Settings › Goal templates.
- **Expect:** A Built-in box lists exactly five templates with their goals as channel chips and kinds: HOO (Ha 10h, OIII 10h); SHO (Ha 10h, OIII 10h, SII 10h); LRGB (L 6h with quality "Usable, FWHM ≤ 3″", R, G and B 2h each); OSC broadband (OSC 10h); OSC dual-band (Dual-band 15h). Every channel other than L reads quality Usable. Built-in rows offer only **Duplicate**. A Yours box reads "No templates of yours" with **New template**. No column or row names the Projects a template was applied in.
- **Trace:** Feedback §Domain and seed (goal kinds, structured channels, no Applied in) · D-W30 · D-W47 · templates.ts BUILT_IN_GOAL_TEMPLATES

### S9 — Create `HOO deep` from HOO {#S9}

- **Do:** Duplicate HOO. In the dialog, rename it `HOO deep`, set Ha to 15 hours and OIII to 15 hours with a frame count of 120, set OIII's quality to Usable with FWHM ≤ 3.5″, and save.
- **Expect:** The dialog opens titled "Duplicate HOO" with the name "HOO copy" and HOO's values. Channels are chips from the band set (L, R, G, B, Ha, OIII, SII, OSC, Dual-band), never free text. After saving, Yours lists `HOO deep` with Ha 15h (Usable) and OIII 15h · 120 frames ("Usable, FWHM ≤ 3.5″"), offering Edit, Duplicate and Delete. Activity records `Goal template saved: HOO deep`. HOO is unchanged.
- **Trace:** settings-goal-templates.tsx (duplicate, TemplateDialog) · Feedback §Domain and seed (structured channels) · D-W29

### S10 — Try invalid template values {#S10}

- **Do:** Click **New template** and save it empty. Then name it `HOO` and add an SII channel with neither hours nor frames, and save again. Cancel the dialog.
- **Expect:** The first save shows "Name required" and "Add a channel". The second shows "Name taken" and "Hours or frames needed · SII". The dialog stays open each time.
- **Expect (negative):** No template is added and no Activity entry is recorded.
- **Trace:** settings-goal-templates.tsx submit validation

### S11 — Copy `HOO deep` into a new Project {#S11}

- **Do:** Start a New Project named `IC 1396 HOO deep` with subject IC 1396, rig `RedCat` and goal template `HOO deep`, and create it (J20 owns the New Project sheet).
- **Expect:** The Project page's Goals read IC 1396 Ha goal 15h and OIII goal 15h with 120 frames and the quality bar "Usable, FWHM ≤ 3.5″".
- **Trace:** IA §Screens S4 (template values copied in and stay editable) · D-W30 · projects.ts goalsFromValues

### S12 — Edit, then delete, the template {#S12}

- **Do:** In Settings › Goal templates, edit `HOO deep` to Ha 20 hours and save. Open `IC 1396 HOO deep`. Then delete `HOO deep` and confirm.
- **Expect:** The template reads Ha 20h after the edit. The confirmation is titled "Delete HOO deep?". After deleting, Yours reads "No templates of yours" and Activity records `Goal template deleted: HOO deep` with "Projects keep the values copied from it."
- **Expect (negative):** After the edit and after the delete, `IC 1396 HOO deep` still reads Ha goal 15h and OIII goal 15h · 120 frames. No other Project's goals change.
- **Trace:** settings.ts saveGoalTemplate, deleteGoalTemplate · D-W30

### S13 — Read Settings › Locations {#S13}

- **Do:** Open Settings › Locations.
- **Expect:** Locations are grouped by role (Captures, Calibration, Results, Archive). Each row names the location, its path, its availability and access, and its disk use as two figures: the bytes PlateVault catalogues under that location, and its volume's free space. The Archive group lists `Archive` with a "Default" pill, and `Backup archive` and `Cold-1 archive` each offering **Make default**. Every row's More actions menu, and right-click, offers the location's actions. There is no Storage page in the source list. On volume `Cold-1` (P7):
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

### S17 — Confirm nothing changed on disk {#S17}

- **Do:** Recompute the P6 manifests, outside PlateVault, with PixInsight's bundle back at its path.
- **Expect:** Every path, size and SHA-256 matches P6.
- **Expect (negative):** No Settings change in S1 to S16 wrote, moved, renamed or trashed a file.
- **Trace:** HLD trust rules · README §Product rules (every move is proposed as a plan first)

## Success criteria

- SC1: S1 lists exactly 8 frame types with the default templates, and S2's palette offers exactly 11 tokens.
- SC2: After S3, 1 Lights template is saved and the S6 Import preview, once NGC 7000 is picked, resolves to `NGC 7000/RedCat 51/Ha/2026-10-04/light/`; after S7, 0 naming templates are custom.
- SC3: S4 and S10 save 0 changes and record 0 Activity entries.
- SC4: S8 lists exactly 5 built-in templates with the D-W47 values, and 0 Applied in references.
- SC5: `IC 1396 HOO deep` reads Ha 15h and OIII 15h · 120 frames after S11, after the S12 edit and after the S12 delete.
- SC6: After S14, exactly 1 Archive location carries the Default pill (`Backup archive`) and `IC 1396 Ha`'s destination is `Cold-1 archive`.
- SC7: After S15 and S16, PixInsight / WBPP reads Found and Open in… holds the saved arguments, with 0 application processes started.
- SC8: S17 manifests match P6 for 100% of files.
- SC9: At S13, `Cold-1 captures` shows 1,252,592,640 catalogued bytes and `Cold-1 archive` 0, both at display rounding, and both show the P7 free space.

## Known gaps

- G1: Not validated. The rebuilt application does not implement these Settings sections in this form yet; the behavior follows the harness v5 design (ui-harness-v5 @ b5e813a5: HARNESS-V5-IA.md §S16 and §Round 2/2b foundations, HARNESS-V5-FEEDBACK-R1.md §Domain and seed, §E2 and §Round 5) and workflow decisions D-W20, D-W29, D-W30 and D-W47, with S6 and S13 following HARNESS-V5-FEEDBACK-R1.md §Round 6 (ui-harness-v5 @ 4f470775), which the prototype does not yet implement.
- G2: Unresolved implementation qualification: P1 needs a seeded catalog (J32's fixture world plus P3's three Archive locations and the Wrap up destination). No fixture builder exists. Blocks readiness.
- G3: (dissolved 2026-10-12): answered by Round 6 "Disk use per location"; S13 now asserts each row's catalogued bytes plus its volume's free space, with the `Cold-1` figures of P7 and an uncatalogued file that must not be counted.
- G4: Out of scope: equipment, sites and Target lookup (J15); Settings › Calibration "Keep raw calibration frames" (J36); appearance and language (J40); adding, rescanning, retiring and remapping locations (J19, J28); choosing the destination inside Wrap up and approving Archive (J34); a profile's launch failure inside a run's Prepare (J24).
- G5: The validation lane must be able to rename the PixInsight bundle (P5) without affecting the user's own install; on a machine with PixInsight in use, a stand-in bundle is required.

## Delta log

- **Δ2** 2026-10-12 · S6, S13 · behavior-change
  Settings › Locations shows each location's disk use as the bytes PlateVault catalogues there plus its volume's free space.
  The Import preview prefills no Target for Card-2's no-pointing session (OBJECT is a hint only); the destination resolves once the user picks NGC 7000.
  Evidence: HARNESS-V5-FEEDBACK-R1.md §Round 6 (user, 2026-10-10) "Disk use per location", "P-IMP2: confirm Targets in the Import preview" (apps/prototype/design/ on ui-harness-v5 @ 4f470775); user answers to the PR #1788 journey questions · by: JourneysV5.R6G (intent-gated)
