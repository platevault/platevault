# R9 UX audit — part C (bead astro-plan-uhqov)

Scope: Calibration library; Settings (shell, Appearance, Locations + duplicates review, Equipment, Naming, Calibration, Observing site, Target lookup, Goal templates, Applications, About); Welcome/setup; onboarding walk + checklist; design-system page; shared component inventory.
Base: `ui-harness-v5` @ 44adaf33. Paths are relative to `apps/prototype/`. en-GB = `messages/en-GB.json`.
Evidence: source and en-GB strings only. I had no browser/eval tool, so rendered layout and layout shift are inferred from code; those rows say [INFERENCE]. User observations count as ground truth. Where the code looks different, the row gives the likely cause.

---

## 1. Shared component inventory

Consumer counts are the number of import sites across `src/features` and `src/app` (`git grep @/components/...`).

### 1a. `src/components/ui` (shadcn / Base UI)

| Component | Variants / parts | Consumers | Notes |
|---|---|---|---|
| button | variant `default` `outline` `secondary` `ghost` `destructive` `link`; size `xs` `sm` `default` `lg` `icon` `icon-xs` `icon-sm` `icon-lg` (`ui/button.tsx:14-50`) | 65 | `render={<Link>}` keeps it a link (`:62-85`). |
| badge | variant `default` `secondary` `destructive` `outline` `ghost` `link` (`ui/badge.tsx:6-25`) | 2 direct (`t1/settings/about-page.tsx`, `t4/badges.tsx`) + `app/status` | It is one of three bubble primitives (see 1c). |
| dropdown-menu | Menu, Item (`variant default/destructive`), RadioGroup/RadioItem, Label, Group, Separator | 8 | No shared "⋯ row actions" wrapper, so 3 local copies exist (see 1c). |
| context-menu | the same set | via `app/row-menu`, `app/data-table` | |
| popover | Trigger/Content | 5 | |
| select | Trigger (`size sm/default`), Content, Item | 13 | It has no labelled wrapper. The de-facto wrapper is `t3/fields.tsx SelectField`. |
| combobox | Input/List/Item/Empty | 1 (`sites-page.tsx`) | |
| field | Field (`orientation vertical/horizontal`), FieldLabel/Title/Description/Content/Legend/Set | 6 | The horizontal Field fits a label + control setting row, but most settings rows are built by hand (see 1c). |
| input, textarea, label, checkbox, switch, radio-group | — | 16 / 2 / 23 / 9 / 13 / 13 | |
| toggle, toggle-group | `variant default/outline`, `size sm/default/lg` | 3 / 6 | This is the right primitive for segmented filters such as Calibration All/Dismissed. Calibration does not use it. |
| tabs | List/Trigger/Content | 2 | |
| dialog, sheet, alert-dialog | Sheet `side` | 17 / 9 / via ConfirmDialog | |
| tooltip | — | 3 direct + `app/tips` | |
| progress, spinner, kbd, collapsible | — | 3 / 1 / 6 / 2 | Collapsible is used only for fold-outs (`t4/prototype-controls.tsx`, `app/issues-hub.tsx`). |
| empty, skeleton, alert, input-group, separator | — | only through app components | |
| **table** | Table/Header/Row/Head/Cell | **0** | Unused. `DataTable` renders its own `<table>`, and 14 more raw `<table>` elements exist in features (see 1c). |
| **card, breadcrumb, button-group, scroll-area** | — | **0** | Unused. They need a decision: delete, or adopt. Breadcrumb would suit the PageHeader eyebrow path. |

### 1b. `src/components/app` (product primitives)

| Component | Props / variants | Consumers |
|---|---|---|
| `page.tsx`: PageHeader (`level 1/2`, title, description, eyebrow, meta, actions), Section (`level 2/3`, actions), PageBody, ListDetail, StepIndicator, useDocumentTitle (`page.tsx:34-209`) | the page shell | 29 |
| `box.tsx`: Box (title, `level`, actions, `flush`) | the hairline panel | 19 |
| `data-table.tsx`: DataTable (sortable via `Column.sortValue`, selection, groups, `contextMenu`, `onRowClick`, `stickyFirstColumn`, `scroll frame/none`), TableToolbar, SelectionBar (`data-table.tsx:38-102,430-517`) | | 17 |
| `data.tsx`: KeyValueList (`columns 1/2/3`), EvidenceList, Stat, PathText, ChannelCoverage, FilterChips (removable chips + match count) | | 17 |
| `feedback.tsx`: Notice (`tone info/offline/warning/refusal`), EmptyState, ActionError, SaveState, UnknownValue, TableSkeleton, DetailSkeleton, LiveAnnouncer/announce | | 39 |
| `pill.tsx`: Pill (`tone neutral/muted/info/success/warning/danger`; **also renders a link or button when given `link` or `onClick`**), pillClass, CountBadge (`pill.tsx:44-102`) | | 38 |
| `status.tsx`: StatusBadge + STATUS (32 kinds: availability, access, scanScope, role, quality, … checklist; `status.tsx:61-230`) | | 29 |
| `tips.tsx`: HelpTip (ⓘ), NoteMarker (①, rows) | | 31 |
| `row-menu.tsx`: MenuEntry, MenuEntries, RowContextMenu, ContextMenuArea, menuKey, openMenuFromKeyboard | **right-click only** | 27 |
| `confirm-dialog.tsx`: ConfirmDialog (title, description, `changes[]`, confirmLabel) | | 27 |
| `refusal.tsx`: Refusal (`<Action> blocked · N reason ▸` + blocker chips), refusalFrom | | 22 |
| `operation-panel.tsx` OperationPanel; `folder-picker.tsx` FolderPicker; `clearable-input.tsx` ClearableInput | | 10 / 6 / 4 |

### 1c. Gaps in the shared set, and the feature-local components that fill them

| Local component (file:line) | Duplicates / should be | Consumers | Action |
|---|---|---|---|
| `t1/components/row-menu.tsx:42` RowMenu + `rowMenuColumn` (⋯ DropdownMenu) | missing shared "row actions" | Equipment, Sites | Promote **one** `RowActions` into `components/app/row-menu.tsx`, fed by the same `MenuEntry[]` as the context menu. |
| `v5/c-runs/parts.tsx:240` RowActions (⋯ DropdownMenu over `MenuEntry[]`) | same | select-step and others | Merge into the shared one above. |
| `t1/settings/locations-page.tsx:370-385` inline ⋯ DropdownMenu | same | Locations | Replace with the shared one. |
| `t3/fields.tsx:17` SelectField, `:63` NumberField (Label + Select/Input, not `ui/field`) | `ui/field` + select | 8 files across b-projects, c-runs, d-review | Move to `components/app/fields.tsx` and build on `Field`. |
| `t1/components/form-field.tsx:32` TextField, `:72` FieldMessage | `ui/field` (it composes it); FieldMessage duplicates `ActionError` | 4 files in `e-targets-plan-settings` | Same module as SelectField. This leaves one form-field convention, not two. |
| `v5/d-review/frame-review.tsx:103` MiniSelect | Select `size="sm"` | 1 | Drop it and use the shared SelectField `size` prop. |
| `v5/e-targets-plan-settings/equipment-records.tsx:177` RecordSelect | SelectField / Combobox | Equipment | Same. |
| `equipment-records.tsx:39-50` CameraKindField (hand-built `role=radiogroup` of buttons) | RadioGroup or ToggleGroup | Camera and Rig dialogs | Replace with ToggleGroup. |
| `v5/c-runs/parts.tsx:179` OptionCard (label + RadioGroupItem) | `Field orientation=horizontal` inside `FieldLabel` (the pattern used at `target-lookup-page.tsx:165-175`) | Prepare, others | One radio-card convention. |
| Hand-built settings rows `rounded-md border p-3` + label + control: `appearance-page.tsx:83`, `target-lookup-page.tsx:148`, `about-page.tsx:79,85`, `app/shortcuts.tsx:114`, `d-review/shortcuts.tsx:72`, `t4/prototype-controls.tsx:14` PrototypeToggle | missing `SettingRow` = Box + `Field orientation=horizontal` | 7 | Add a shared `SettingRow` (label, optional HelpTip, control). |
| `v5/b-projects/project-sections.tsx:84` SimpleTable + 14 raw `<table>` (`calibration.tsx:218`, `settings-equipment.tsx:373`, `settings-goal-templates.tsx:143`, `design-system-page.tsx:260`, `activity.tsx:272`, `target.tsx:387,493,529`, `targets.tsx:916`, `moon-limits.tsx:97`, `d-review/list.tsx:258`, `t3/frame-preview.tsx:174,234`, `t3/import-dialog.tsx:129`) | DataTable (sortable) or `ui/table` (static) | — | Rule: tabular data uses DataTable; a fixed reference grid uses `ui/table`. None of these raw tables can sort. |
| `calibration.tsx:687` FilterChip (`<button>` + `pillClass(…, true)`) | ToggleGroup | Calibration | This is a pill used as a button. |
| `e-targets-plan-settings/parts.tsx:208,222` FilterPill / FilterChips | has the **same name** as `app/data.tsx:223` FilterChips but does something else (grade strip) | Targets, Plan | Rename it (e.g. `GradeStrip`) to remove the name clash. |
| `t4/badges.tsx:36` T4Badge (its own META table on Badge) | StatusBadge (its comment says "replace once STATUS additions land", `badges.tsx:1-8`) | Applications, Prepare | Add the kinds to STATUS and delete T4Badge. |
| `about-page.tsx:47` raw `<Badge variant="outline">` | Pill / StatusBadge | About | Remove it (see About). |
| `v5/b-projects/wrap-up.tsx:130` StepBox, `v5/a-home/import.tsx:161` Part, `a-home/home.tsx:380` WorkGroup | Box / Section | — | Box with a numbered title is a legitimate composition. `Part` re-implements Section with a different heading size. |
| `t1/settings/settings-layout.tsx:16` SettingsMenu vs `app/shell.tsx:114` NavLink | two side-nav implementations with different active styles | Settings, Shell | Use one `NavList` for both, so highlight and hover match (the user also flagged sidebar highlighting). |
| Three prototype-control containers: `t4/prototype-controls.tsx:29` PrototypeControls (Collapsible fold-out, **hard-coded English** "Prototype: ", "Simulates changes outside PlateVault for review. Not part of the product.", `:34-36`), `c-runs/parts.tsx:205` PrototypeMenu, `app/simulation-panel.tsx` | one prototype surface | — | Keep only the toolbar Prototype sheet. Delete the fold-out and its sentence. |
| Three theme pickers: `app/appearance.tsx:46-69` (radio grid), `app/shell.tsx:367` ThemeItems (More menu), `shell.tsx:396` ThemeMenu (setup) | one ThemePicker | — | See Appearance A1. |

Problems inside the shared primitives themselves:
- **Pill is a button/link primitive.** `pill.tsx:44-50,60-75` accepts `link` and `onClick`. That builds "pills as buttons" into the standard: 13 call sites use it, including `duplicates-review.tsx:215`, `a-home/import.tsx:841,851`, `b-projects/goals.tsx:112`, `c-runs/calibrate-step.tsx:109,207,443`, `calibration.tsx:447`, `parts.tsx:278`, `targets.tsx:744`. Proposal: Pill becomes display-only; navigation uses `Button variant="link"`.
- **Three bubble primitives:** `ui/badge`, `app/pill`, and `app/status` StatusBadge (which renders on Badge). Proposal: StatusBadge for states, Pill for chips, and no direct Badge use.
- **No visible row-action menu.** `row-menu.tsx:1-14` covers only the context menu (right-click). Lists whose only menu is right-click have no visible affordance. Calibration masters is one (C3).
- **Density only sets `--row-h`.** `index.css:92-103` sets 24 / 26 / 32 px. Nothing else (padding, control size, type) responds. This explains the user's "density only does something inside Appearance" (A2).

---

## 2. Button-variant inconsistencies in scope

| Action kind | What it uses (file:line) | Proposed standard |
|---|---|---|
| Page/section "Add …" | `sm outline`: Locations `locations-page.tsx:437`, Equipment ×3 `settings-equipment.tsx:483-491`, Sites `sites-page.tsx:206`. `default` size: Goal templates `settings-goal-templates.tsx:206` (filled default) and `:220` (outline). Calibration Import `calibration.tsx:791` (default-size outline). Applications `applications.tsx:158` (default outline). | One rule. Page-header primary action = `default` (filled) `sm`. Section add = `outline sm` with a Plus icon. |
| Row action | `xs outline` inline (`calibration.tsx:309` process primary, `:560` Restore); `xs ghost` text (`sites-page.tsx:247` Make default, `settings-equipment.tsx:321,409,413`, `settings-goal-templates.tsx:169`); `sm ghost` text (`locations-page.tsx:386` Make default); `sm outline` (Rescan `locations-page.tsx:391`); ⋯ `icon-sm ghost` (3 local copies) | At most one inline primary row action (`xs outline`). Everything else goes in the shared ⋯ RowActions. |
| Remove | Trash2 + "Remove" text `xs ghost` (`settings-equipment.tsx:413-415`); Trash2 + "Delete" `xs ghost` (`settings-goal-templates.tsx:169`); X `icon-sm ghost` (`b-projects/goals.tsx:135-137`); raw hidden X on naming chips (`settings-naming.tsx:239-241`); menu text only | Inside a menu: the item "Remove", destructive. Inline: a `ghost icon-xs` Trash2 with aria-label and no text. Never an X for delete (X means clear or close). |
| Cross-page navigation | `ghost` "Settings" in the Calibration header (`calibration.tsx:803`); `outline sm` ReturnNotice (`settings-layout.tsx:91`); text links (`settings-calibration.tsx:63-83`, `locations-page.tsx:424`) | Navigation is `Button variant="link"` or a menu item. Page headers carry no navigation buttons. |
| Dismiss / Restore (Calibration details) | `outline` Dismiss vs `default` Restore (`calibration.tsx:656-662`) | Move both into the row/detail ⋯ menu (C1). |

---

## 3. Findings per surface

Columns: # · file:line · key(s) · violation (checklist 1 local component, 2 button, 3 fold-out, 4 pill-as-button, 5 tooltip, 6 slop, 7 table, 8 layout shift, 9 page shell) · evidence · standard component · proposed copy/fix.

### 3.1 Calibration library (`v5/e-targets-plan-settings/calibration.tsx`)

| # | file:line | key(s) | viol. | evidence | standard | proposed |
|---|---|---|---|---|---|---|
| C1 | `:619-664` (MasterDetails), `store/actions/calibration.ts:419-429` | `run_dismiss` "Dismiss" (en-GB:2681), `calibration_restore`, `store_saved_dismissed` "Dismissed {name}" (6311), `calibration_cant_dismiss` "Can't dismiss" (7127) | 2, 9 | The details Sheet ends in a single `outline` Dismiss button. Dismiss only sets `dismissedAt`: it hides the master and keeps the file. Nowhere else in the app uses "Dismiss" for this. There is no trash or remove action for masters. | Shared ⋯ RowActions + ConfirmDialog; details Sheet has no action bar | Rename to **"Hide"** with **"Show"** to undo, or replace with **"Move to Trash"** through the Trash flow used elsewhere. Put it in the ⋯ menu and remove the button from the details panel. |
| C2 | `:102-105` (ProcessSteps tip), `:288-319` | `calibration_raws_kept` "Kept" (2535), `status_trashed` | 8, 5 | After "Trash raws", the only sign is the word "Trashed" inside the Raws step's `title` tooltip and sr-only text. The row's State pill stays generic. | StatusBadge `kind="trash"`-style status in the State column | Show the visible status **"Raws trashed"**, or **"Raws kept"**. The cleanup itself should go through the existing Trash review, the same as runs (user: "do we need a cleanup stage here as well?"). |
| C3 | `:475-488`, `:508-517`, `:457-461` (OpenMaster) | `settings_details` "Details" | 1, 9 | The masters DataTable has a right-click menu only, with no visible ⋯ column. Details opens three ways: `OpenMaster` (a local underline `<button>`), `onRowClick`, and the context menu. | Shared RowActions column + DataTable `contextMenu` | Add a ⋯ column with **Details · Replace… · Hide · Open raw session**. Remove `onRowClick` and `OpenMaster`, as the user asked ("explicit menu option to select detail"). |
| C4 | `:475-488`, `store/actions/calibration.ts:367-445` | — (absent) | — | There is no replace or update action anywhere in the menu or the store. | ⋯ menu item → dialog | Add **"Replace…"**: pick the new master and show its matching criteria (camera, gain, offset, temperature, binning). Runs that use the old master are re-pointed after a ConfirmDialog listing those runs. This is also how import→replace works (C8). |
| C5 | `:497-506` columns, `:792-794` | `calibration_key_*`, `calibration_frames`, `calibration_state`, `calibration_used_by` | 7 | No column supplies `sortValue`, so no header can sort. The order is a fixed `sortKey`. | DataTable `sortValue` | Make every key column sortable (night, exposure, temperature, gain, frames). |
| C6 | `:218-245`, `:95-129` | `calibration_steps` "Steps", `calibration_process` | 7 | User: "the calibration table has no headers". The Processes table has headers, but its Steps cell is five glyphs (Stack → Detect → Import → Register → Raws). Below 1280 px only the current step has a word (`:121`). The step names and states live in tooltips. [INFERENCE: this is what reads as "no headers / vague process".] | StepIndicator or a column per step | Give each step its own narrow column with the step name as header (Stack · Detect · Import · Register · Raws). Each cell shows glyph + word, with no tooltip. |
| C7 | `:860-867` → `components/app/folder-picker.tsx:94-101` | `folder_picker_description` "Prototype folder chooser: volumes and folders come from the simulated disk." (en-GB:400) | 6 | The FolderPicker falls back to its default description because Calibration passes none. The same text appears in every picker that omits a description. | FolderPicker | **Delete the key.** Description = none. Title **"Import masters"**, verb **"Import"**. |
| C8 | `:19-21`, `:704-724`, `:860-873` | `calibration_import_masters` "Import masters" (2632), `shell_import` | 6, 9 | The action imports files *into* the library (`importFolder` → `importMasterFile`), but the user cannot tell that from a bare folder chooser. Nothing shows the parsed headers or the categorisation before import. | Import sheet (the same pattern as the app-wide Import: source → preview → import) | Use a 2-step dialog. (1) Choose folder. (2) Preview table: File · Kind · Camera · Gain/Offset · Temp · Exposure · Match. Each row's status is **New**, **Replaces {master}** or **Duplicate**. Button: **"Import {n}"**. Replacements reuse C4. |
| C9 | (absent on page) `a-home/import.tsx:547-565,890-908` | `status_role_calibration` | 9 | "How do I import raws?" Raw calibration frames only arrive through the global Import (toolbar). The Calibration page has no entry point for them. | PageHeader actions → shared Import sheet | Add one header menu: **Import ▾ → Raw frames… / Masters…**. Raw frames opens the global Import sheet with role = Calibration. |
| C10 | `:798-808` | `nav_settings` "Settings" | 9, 2 | This is the only page whose PageHeader has a "Settings" ghost link (`:803`). Activity, Targets and Projects have none. | PageHeader (actions = page tasks only) | **Remove.** If the Keep raws toggle stays, it moves into the Processes Box (see S-CAL1). |
| C11 | `:821-834`, `:679-683` | `calibration_filter_label`, `calibration_filter_placeholder`, `activity_filter_all`, `calibration_dismissed` | 4, 1 | Filters are two local `FilterChip` buttons styled as pills, plus free-text search over kind/channel/camera/rig/path. There are no facets. | ToggleGroup (All / Hidden) + TableToolbar `filters` with Select facets (as in Targets) | Facets: **Kind · Camera · Rig · Filter · Temp · Gain · Age**. |
| C12 | (absent) `domain/calibration.ts:133-145,219-220` | — | — | There is no age check, only digest drift. Matching never compares temperature (`calibration.ts:219-220`). | StatusBadge + Issues hub | Add the status **"Old · {n} d"** to darks, bias and dark-flats past a threshold (setting, e.g. 180 d). Flats are exempt. List these masters in the Issues hub. |
| C13 | `:795-800` | `calibration_masters_imported` | 8 | The import outcome (Pill + Refusal) is inserted at the top of PageBody, which pushes Processes and Masters down. A refusal also inserts an extra table row under its process (`:322-336`). [INFERENCE: visual] | `announce()` toast / Notice in a reserved slot | Report the outcome through a notification. Process refusals go in a popover on the State pill. |
| C14 | `:540-564` (DismissedBox) | `calibration_restore` | 2 | Hidden rows show an inline `xs outline` Restore plus a Restore menu item. The details panel uses a `default` Restore. | RowActions | Restore appears only in ⋯ and the context menu. |
| C15 | `:447` | `calibration_offered_in` | 4 | `<Pill tone="info" link=…>` acts as a link to the run. | `Button variant="link"` | Keep the display text; render it as a link button. |
| C16 | `:404` UsedBy | `calibration_used_by_runs` | 4 | A PopoverTrigger is styled with `pillClass(…, true)`. | Button `variant="link" size="xs"` + Popover | Show "{n} runs" as link text and open the list in a Popover. Keep the popover. |

### 3.2 Settings shell (`t1/settings/settings-layout.tsx`)

| # | file:line | key(s) | viol. | evidence | standard | proposed |
|---|---|---|---|---|---|---|
| S0a | `:16-45` | `settings_sections` | 1 | SettingsMenu is a second side-nav with its own active style (`inset 2px primary`), separate from the shell NavLink (`app/shell.tsx:114`). | shared NavList | One NavList for both. |
| S0b | `:84-96` + every child page | `settings_back_to_*` | 9 | `ReturnNotice` is an `outline sm` button placed as the first item of PageBody. It sits above the content and moves it. | Toolbar Back (← history, already in the shell) | Remove it. Toolbar Back covers the return. |
| S0c | `routes.tsx:159-170` | — | — | There is no Help route. The `?` ShortcutsDialog (`app/shortcuts.tsx:84-140`) lists keys only. | Settings section or a menu item | Add **Help**: Shortcuts table · Tips · Guide, plus "Restart walk" moved from About (S-AB2). |

### 3.3 Appearance (`t1/settings/appearance-page.tsx`, `app/appearance.tsx`, `app/themes.ts`)

| # | file:line | key(s) | viol. | evidence | standard | proposed |
|---|---|---|---|---|---|---|
| A1 | `app/appearance.tsx:46-69`, `themes.ts:19-40` | `shell_theme`, `shell_theme_match_system` | 9 | One radio grid holds 13 themes plus "Match system" as peers. Theme lists are also duplicated in `shell.tsx:367,396`. | ToggleGroup (scheme) + RadioGroup (theme), one ThemePicker | **Mode: Light · Dark · System**, then **Theme**: only the themes of the chosen scheme (System shows a light/dark pair). Remove the theme list from the More menu and keep the mode toggle there. |
| A2 | `appearance-page.tsx:59-77`, `index.css:92-103` | `settings_density`, `settings_density_*` | — | The user's observation is accurate: density changes only `--row-h` (24 / 26 / 32 px). Its only clear effect is on the page's own mock rows (`:67-72`). | — | Either make density scale row padding, control height and list spacing app-wide, or remove the setting. |
| A3 | `appearance-page.tsx:41-47` | `settings_at_defaults` "Already at the defaults" (4037) | 5 | This is the `title` tooltip on the disabled Restore defaults button. It repeats what the disabled state already shows. | — | Remove the tooltip. |
| A4 | `appearance-page.tsx:82-90` | `settings_shortcuts_about`, `settings_shortcuts_help` "?, /, [ and G sequences. ⌘K and Ctrl+K always work." (4042) | 1 | A hand-built bordered setting row. | SettingRow | Keep the copy. Move the row into Help (S0c). |

### 3.4 Locations + duplicates review (`t1/settings/locations-page.tsx`, `t1/components/*`)

| # | file:line | key(s) | viol. | evidence | standard | proposed |
|---|---|---|---|---|---|---|
| L1 | `locations-page.tsx:420-426` | `nav_activity` "Activity", `location_last_indexing` | 9 | The "Last indexing … Activity" line ends in an inline text link to /activity. | Notifications / status bar | Remove the line and the link. Indexing state lives in the status bar and Activity. |
| L2 | `location-row.tsx:85-90,108` | `status_readable` "Readable" (258), `status_online` "Online" (252), `status_complete_scope` "Complete scope" (262) | 6 | A grey "nominal" line on every healthy row: "Readable · Online · Complete scope". | StatusBadge only when not OK | **Remove the nominal line.** Show a badge only for exceptions. |
| L3 | `location-row.tsx:79-84,128-137` | `location_indexed` "Indexed {date}" (3883), `location_frames`, `location_footprint` "Footprint {bytes}" (7131), `location_volume_use` "{volume}: {used} used · {free} free" (7132) | 7, 6 | Four facts are joined with "·" into one wrapping paragraph. | KeyValueList (`columns=2`) in the row's right column, or a Locations DataTable | Labelled cells: **Indexed** · **Frames** · **Size** · **Disk free**. Drop "Footprint" and the volume sentence. |
| L4 | `locations-page.tsx:415-419` with `:391` | `location_rescan` "Rescan" | 8 | Rescan swaps the one-line "Last indexing" `<p>` for a multi-line `OperationPanel` above all sections, which pushes every row (and its ⋯ menu) down. In the row, "Indexing" replaces the nominal text in the flex-wrap badge group, which can re-wrap the actions (`location-row.tsx:101-110`). [INFERENCE: visual; the remap Notice at `location-actions.tsx:91-103` is a second inserter] | Status bar progress + in-row StatusBadge in a fixed slot | Show progress only in the status bar and the row's own State cell. Do not insert anything above the list. |
| L5 | `locations-page.tsx:370-385` | `location_more_actions` | 1 | A third local ⋯ DropdownMenu. | shared RowActions | Replace it. |
| L6 | `locations-page.tsx:386-393` | `settings_make_default`, `location_rescan` | 2 | Make default is `sm ghost` text and Rescan is `sm outline`, both inline beside ⋯. Sites uses `xs ghost` for Make default (`sites-page.tsx:247`). | RowActions | Rescan stays inline (`xs outline`). Make default goes in ⋯. |
| L7 | `locations-page.tsx:428-435`, `duplicates-review.tsx:37-43` (Sheet 46 rem), `domain/issues.ts:98-107` | `issue_duplicates`, `verb_review`, `duplicates_scope_help` "Library locations only; capture cards are never scanned. Keeps the copy in the earliest-registered location." (7291) | 9, 6, 4 | A warning Pill + Review button sit inline at the top of Locations and open a 46 rem side Sheet. The issue already exists in the Issues hub. The Sheet shows a refusal Pill with `link` (`duplicates-review.tsx:215`). | Issues hub row → its own page or dialog (DataTable: File · Copies · Size · Keep) | Move duplicates out of Locations into **Issues → Duplicates**. Remove the help sentence, or shorten it to the HelpTip "Library locations only". |
| L8 | `locations-page.tsx:219` RetireReviewPanel | — | 1, 8 | An inline red-bordered section expands inside the page. | ConfirmDialog with `changes[]` | Use a dialog. |
| L9 | `locations-page.tsx:460` | `settings_none` | 1 | A hand-built dashed empty box. | EmptyState | Use EmptyState. |

### 3.5 Equipment (`settings-equipment.tsx`, `equipment-records.tsx`)

| # | file:line | key(s) | viol. | evidence | standard | proposed |
|---|---|---|---|---|---|---|
| E1 | `settings-equipment.tsx:281-288` | `equipment_rename`, `equipment_edit_optics` "Edit optics" (4502) | 2, 6 | The rig header has two text buttons (`sm ghost` Rename, `sm outline` Edit optics). There is no rig Remove. | RowActions on the rig header | ⋯ menu: **Edit · Rename · Remove**. "Edit optics" becomes **"Edit"**. |
| E2 | `settings-equipment.tsx:161-225`, `settings-actions.ts:82-100` | `equipment_optics_title`, `equipment_shared_camera` "Shared camera", `equipment_shared_camera_help` "Camera values change for {rigs}." (4491) | — | The rig editor edits camera kind, sensor size and pixel size, and writes them to the shared Camera (`updateRigOptics`). That is why it needs the warning tooltip. | Rig dialog of Selects | The rig dialog becomes **Camera ▾ · Telescope ▾ · Reducer ▾ · Filters ▾ (multi)**. Camera properties are edited only on the Camera. Delete `equipment_shared_camera_help`. |
| E3 | `equipment-records.tsx:302-303,324-325` | `settings_edit` | 9 | Camera and Telescope tables have `onRowClick={setEditing}`, so a click opens the editor immediately. Rigs do not. | DataTable + RowActions | Remove `onRowClick` and use ⋯ → Edit. A click selects the row or shows details. |
| E4 | `settings-equipment.tsx:354` | `calibration_used_by` | 8 | "Used by" joins every project name into one KeyValueList value, so it grows without bound. | Popover | Show **"{n} projects ▸"**, opening a Popover list of links. |
| E5 | `settings-equipment.tsx:359-417` | `equipment_filter`, `equipment_matches_filter`, `equipment_bands`, `settings_remove`, `settings_edit` | 7, 2 | The per-rig filter table is a raw `<table>` without sorting. Remove is Trash2 + "Remove" text (`xs ghost`, `:413-415`). The user likes the trash icon but not the text. | Filters as a top-level Equipment section (DataTable: Name · Band · Matches FILTER) + RowActions | Add a **Filters** section beside Cameras and Telescopes. Rigs *select* filters. Inline remove = Trash2 `icon-xs ghost` with aria-label. |
| E6 | `settings-equipment.tsx:291-312` | `equipment_unknown_filter`, `equipment_add_filter`, `equipment_not_now` | 8, 2 | An unknown-FILTER Notice is inserted between the rig header and its details. Add filter is `default` here and `outline` at `:362`. | Issues hub / reserved slot | Move it to Issues ("Unknown filter FILTER=Ha-3nm · 2 sessions"). Use one Add filter variant (outline). |
| E7 | `equipment-records.tsx:39-50` | `equipment_camera_kind`, `equipment_mono`, `equipment_osc_colour` | 1 | A hand-built radiogroup of buttons. | ToggleGroup | Replace it. |
| E8 | `equipment-records.tsx:290-300` | `equipment_sensor` | 7 | The sensor column has no `sortValue`. | DataTable | Make it sortable by pixel size. |

### 3.6 Naming (`settings-naming.tsx`)

| # | file:line | key(s) | viol. | evidence | standard | proposed |
|---|---|---|---|---|---|---|
| N1 | `:329-351` | `naming_frame_types` "Frame types" (4479) | 9, 1 | A page-local 11 rem column of frame-type buttons beside one editor. | One form: a Field per frame type | One page with a row per type: **Light / Flat / Dark / Bias / Dark flat / Master …**, each with a text Input and a live preview. |
| N2 | `:156-177,213-257` | `naming_chip_hint` "← and → move between chips, ⌥← and ⌥→ move a chip, Delete removes it." (4464), `naming_move_left/right`, `naming_insert_token` | 1, 8 | Token chips are keyboard-reorderable but not draggable. The move buttons appear only once a chip has focus, which inserts controls and shifts content. The chip's X is a raw hidden button. | Input | Replace the chips with a **text template input** (`{target}/{night}_{filter}`), validated against a token whitelist. Unknown tokens get an inline error. Delete the hint text. |
| N3 | `:265`, `domain/templates.ts:52-63,178-190` | `naming_token_title` "{label}; falls back to “{fallback}”" (4468), `naming_tokens_about` "Tokens and fallbacks" (4459), `naming_no_fallbacks` "No fallbacks" (4455), `naming_fallbacks` | 5, 6 | Every token has a `title` tooltip, and a HelpTip repeats the same list. "No fallbacks" is a pill shown when nothing falls back. | `ui/table` | **Tokens table**: Token · Example · When missing (fallback text or "Omit segment" option). Remove the per-token tooltips, the HelpTip and the "No fallbacks" pill. |

### 3.7 Calibration settings (`settings-calibration.tsx`)

| # | file:line | key(s) | viol. | evidence | standard | proposed |
|---|---|---|---|---|---|---|
| S-CAL1 | `:57-87` | `settings_masters`, `nav_storage`, `settings_layout`, `settings_tools` | 9, 6 | The Masters box only echoes the storage path, naming templates and tools, with links to Locations, Naming and Applications, which already show the same data. The page's only real setting is the Keep raws toggle (`:45-55`). | — | **Delete the page.** Move **Keep raw frames** into Locations (Calibration role section) or the Calibration page's Processes box header. Remove the route and C10's button. |
| S-CAL2 | `:47-53` | `settings_keep_raws_help` "Off: raws go to the OS Trash once their master registers." (4411) | 5 | The HelpTip is short and states the consequence. | HelpTip | Keep it if the toggle moves. |

### 3.8 Observing site (`t1/settings/sites-page.tsx`)

| # | file:line | key(s) | viol. | evidence | standard | proposed |
|---|---|---|---|---|---|---|
| O1 | `:267-291` | `site_from_headers`, `site_headers_help` | — | Coordinates are entered as numbers. There is no map. The previous product had a click-to-set map: `apps/desktop/src/features/settings/ObservingSites.tsx:414-440` → `apps/desktop/src/shared/observing-sites/SiteLocationPicker.tsx:150-210` (canonical checkout, read-only). | Port SiteLocationPicker | Add a **clickable map** in the site dialog that sets lat/lon. Keep the fields. |
| O2 | `:222-247` | `settings_make_default` | 2, 7 | Make default is `xs ghost` text, while Locations uses `sm ghost`. Only Name and Zone sort. | RowActions; DataTable sortValue | Put it in ⋯. |
| O3 | `:225` | `site_no_default` | 8 | An info Notice is inserted above the table when there is no default. | Badge in the table | Mark the first row "Default", or show a StatusBadge in the PageHeader meta. |

### 3.9 Target lookup (`t1/settings/target-lookup-page.tsx`)

| # | file:line | key(s) | viol. | evidence | standard | proposed |
|---|---|---|---|---|---|---|
| T1 | `:141-147` | `settings_lookup_local` "Local search" (4201), `settings_lookup_targets`, `settings_lookup_catalogue_objects` | 6 | A success Pill "Local search" followed by counts: a "bubble" that does nothing. | KeyValueList | **Local: {n} Targets · {m} catalogue objects**, as plain text or remove it. No pill. |
| T2 | `:150-156` | `settings_lookup_online_about`, `settings_lookup_online_help` "Sends Target names to the provider. A failed lookup never blocks indexing." (4236) | 5, 1 | The user calls this tooltip useless. It sits in a hand-built bordered row. | SettingRow | **Remove the HelpTip.** Label: **"Online lookup"**. |
| T3 | `:180` | `settings_lookup_fixture` "Fixture" (4239) | 6 | A muted Pill "Fixture" in the Test section actions. It is prototype jargon. | — | **Remove it.** |
| T4 | `:196-230` (test result), `:38-41` | `settings_lookup_failed` "{provider} did not respond: the lookup failed as if offline. No Target was changed; local Targets and indexed sessions stay usable." (4198), `settings_lookup_query_empty` "Name to look up: enter a Target name or alias, for example NGC 7000." (4200), `settings_lookup_resolved` "Resolved by {provider}." | 6 | Test-result and validation copy explains the behaviour. Provider cards are fine ("SIMBAD, NED, VizieR" / "SIMBAD only", 4194-4195). [INFERENCE: the result lines render under Test at `:196-230`] | ActionError / Refusal | "{provider} not responding", "Enter a name", "Resolved · {provider}". |

### 3.10 Goal templates (`settings-goal-templates.tsx`, `b-projects/goals.tsx`)

| # | file:line | key(s) | viol. | evidence | standard | proposed |
|---|---|---|---|---|---|---|
| G1 | `domain/derive.ts:581-593`, `settings-goal-templates.tsx:38-41,85-90` | `template_hours_or_frames` "Hours or frames needed · {channels}" (4433) | 6 | When both are set, evaluation is **AND**: met only when time *and* frames are reached (`derive.ts:582-593`). The validation copy says "or". | — | Copy: **"Set hours, frames or both · {channels}"**. If both are set, both must be met. |
| G2 | `b-projects/goals.tsx:45-95`, `derive.ts:517-524,540-602` | `goal_quality` "Quality" (1338), `status_usable` "Usable" (271) | 6 | "Usable" means only frames whose review quality is Usable count towards the goal. The UI does not say so. | Select | Label: **"Counts"**, as a Select: **All frames · Usable only · FWHM ≤ …**. |
| G3 | `:143-179` | `template_column_template`, `template_goals`, `template_delete` | 7, 2 | A raw table without sorting. Trash2 + "Delete" text `xs ghost`, duplicating the context menu. | DataTable + RowActions | Show Name (sortable); actions go in ⋯. |
| G4 | `b-projects/goals.tsx:111-115` | `goal_add_channel_goal` | 4 | Channel "+ Ha" Pills with onClick add goals. | Button `outline xs` / Select "Add channel ▾" | Use **Add channel ▾**. |
| G5 | `:206`, `:220` | `template_new` | 2 | The same "New template" action uses a filled default button in the header and outline in the empty state. | Button | Header = `default sm`. |

### 3.11 Applications (`t4/applications.tsx`, `t4/profile-parts.tsx`, `t4/badges.tsx`)

| # | file:line | key(s) | viol. | evidence | standard | proposed |
|---|---|---|---|---|---|---|
| AP1 | `profile-parts.tsx:73-130` | `apps_locate_any` "Locate an application" (4388), `apps_locate_description` "Prototype: simulated application chooser. It lists application bundles on the simulated computer and records the path only; nothing is launched." (4389), `apps_none_present` "No application bundle is present. Restore one in this step's prototype controls." (4390) | 6 | A simulated chooser with sentences. There is no autodetect and no OS file picker. The previous product autodetected tools and used a file picker: `apps/desktop/src/features/settings/ProcessingTools.tsx:13-14,164-198`, `apps/desktop/src/features/setup/steps/StepTools.tsx:75-90,312-353`. | OS file dialog (Tauri) + detection list | **"Detected"** list (registry/standard paths) + **"Add application…"** (file picker with an executable filter). Delete 4389 and 4390. Empty state: **"No applications found"** + **Add application…**. |
| AP2 | `profile-parts.tsx:24-29`, `badges.tsx:27-32` | `apps_input_writes` "Input writes" (4380), `apps_badge_read_only`, `apps_badge_writes_unknown`, `apps_badge_write_prone` | 6 | An "Input writes" row and badge on every profile. The user calls it useless. | — | **Remove.** |
| AP3 | `applications.tsx:34-77,107-109` | `apps_launch_arguments` "Launch arguments" (4396), `apps_launch_placeholder`, `apps_save_arguments` | — | Launch arguments render only for `profile.application === "generic"`. | Input (Field) | Show launch arguments on **every** application. |
| AP4 | `applications.tsx:31,80-98,151-174` | `apps_generic_description` "Launches any application with your arguments. It is not a verified preparation profile." (4392), `apps_change`, `apps_locate` | 6, 9 | "Open in…" is a fixed generic profile. You cannot add an application. | PageHeader action | Replace it with **Add application…** (name, executable, arguments). Delete 4392. |
| AP5 | `applications.tsx:174-196`, `prototype-controls.tsx:29-40` | `apps_controls_title` "applications on this computer" (4400) + hard-coded "Prototype: " / "Simulates changes outside PlateVault for review. Not part of the product." | 3, 6 | A Collapsible fold-out with an explanatory sentence, and untranslated English. | the toolbar Prototype sheet | Move it into the Simulation sheet and delete the fold-out. |
| AP6 | `applications.tsx:92-97` | `apps_check_again`, `apps_change`/`apps_locate` | 2 | `sm ghost` vs `sm outline` side by side for peer actions. | RowActions | Use one primary (`outline xs`) and put the rest in ⋯. |
| AP7 | `badges.tsx:36` | — | 1 | T4Badge duplicates StatusBadge. | StatusBadge | Add the kinds to STATUS. |

### 3.12 About this prototype (`t1/settings/about-page.tsx`)

| # | file:line | key(s) | viol. | evidence | standard | proposed |
|---|---|---|---|---|---|---|
| AB1 | `:43-55` | `settings_about` "About this prototype" (48), `common_prototype`, `about_simulated_data` "Simulated data" (3950), `about_no_files_touched` "No files touched" (3951), `about_no_network` "No network" (3952) | 6, 1 | The heading carries a raw Badge and is followed by a row of three Pills, which the user calls bubbles. | PageHeader + KeyValueList | Title **"About"**. Delete the Badge and all three Pills. |
| AB2 | `:58-75,78-98,100-102` | `about_version_value` "{version} · prototype build" (3955), `about_onboarding`, `about_simulation` | 6, 1, 9 | Shows version, data and storage key (useful). Also has an Onboarding section of hand-built bordered rows and a Simulation section embedding the simulation controls. | KeyValueList; Help page; Prototype sheet | Keep **Version · Build date · Data · Library location · Licences**. Version reads as `{version}`. Restart walk / Restart setup move to Help (S0c). Simulation moves to the Prototype sheet. |

### 3.13 Welcome / setup (`t1/setup/setup-pages.tsx`, `t1/lib/locations.ts`)

The setup shell is consistent (SetupHeader = StepIndicator + PageHeader, `setup-pages.tsx:35-50`). The problem is the copy. Every row below is checklist 6.

| # | file:line | key (en-GB line) | current | proposed |
|---|---|---|---|---|
| W1 | `:70-72` | `setup_welcome_description` (4253) | "PlateVault catalogs your astrophotography captures where they already are, groups them into sessions and prepares exact inputs for PixInsight, Siril and other processing apps." | Remove it, or use a tagline: "Catalogue · Sessions · Processing inputs" |
| W2 | `:104-106` | `setup_next_empty` (4264) | "Next, choose the folders that hold your captures. Only a Captures location is required." | Remove it. The button "Choose capture folders" carries the step. |
| W3 | `:104-106` | `setup_next_registered` (4265) | "Your locations are registered. Continue to review them and start indexing." | "Locations registered" |
| W4 | `:120-124` | `setup_later_hint` (4269) | "Opens the library now. Add locations any time in Settings › Locations." | Remove it. |
| W5 | `:132-139` | `setup_demo_body` (4272) | "Skips setup and loads a realistic indexed library: M 31, NGC 7000, a mosaic Project and an offline drive. It replaces the prototype data in this browser." | "Demo library: M 31 · NGC 7000 · mosaic · offline drive" |
| W6 | `:145-149` | `setup_demo_confirm_description`, `setup_demo_unchanged_*` (4274, 4277-4278) | "Prototype only. The demo replaces everything in this browser's prototype data." + "unchanged" list | Description: none. Change list: "Prototype data is replaced". Drop the Unchanged list (copy rule). |
| W7 | `:182-184` | `setup_locations_description` (4280) | "Register the folders that already hold your files. Registering only records access and indexing intent: nothing is copied, renamed, moved or deleted." | "Choose folders to index". HelpTip: "Files are never moved". |
| W8 | `:214-221` | `setup_deferred`, `setup_optional_unset` (4284-4285) | "You chose to set this up later. Add it any time in Settings › Locations." / "Leave it unset if you do not keep these files in one place yet." | "Later" / "Optional" |
| W9 | `:270-278` | `setup_nothing_else_body` (4287) | "View folders are chosen when you prepare a View. Setup asks for no workspace folder, processing app, Project or account." | Remove it. |
| W10 | `:258-263` | `setup_continue_reason` (4288) | "Add a capture location to continue. Captures is the only required role." | "Add a capture location" |
| W11 | `:276-279` | `setup_remove_description` (4290) | "Removes the registration only. Nothing was indexed from this folder yet." | Change list: "Registration only · nothing indexed" |
| W12 | `:340-348` | `setup_footer_running/interrupted/canceled/unindexed/finished` (4293-4312) | e.g. "You can browse sessions already read while indexing continues." / "Indexing was canceled. Sessions already read are kept; rescan the rest here or later in Settings › Locations." | Status + action: "Indexing · Browse sessions" / "Interrupted · Resume" / "Cancelled · {n} sessions kept" / "{n} not indexed · Index" / "Indexed · Open library" |
| W13 | `:367-369` | `setup_indexing_description` (4314) | "PlateVault reads metadata from each location. Files stay where they are and are never changed." | Remove it (or the HelpTip "Files are never changed"). |
| W14 | `:407-409` | `setup_index_all_hint` (4344) | "Every registered location is read. Calibration frames are indexed too; they never appear as light sessions." | "All locations · calibration included" |
| W15 | `:437-441` | `setup_index_later_hint` (4363) | "Index later keeps the locations registered: start indexing from Settings › Locations." | Remove it. |
| W16 | `:204-220` | `setup_captures_needed` (4283) | "Add at least one folder with light frames to continue." | "Add a light-frame folder" |
| W17 | `t1/lib/locations.ts:33-44` | `location_role_*_description` (e.g. 3654, 3662) | "Light frames to index. Add as many folders as you like." / "Finished images and processing products PlateVault should find. Output folders can also be chosen per View." | "Light frames" / "Finished images · products" |

### 3.14 Onboarding walk + checklist (`app/onboarding.tsx`, `app/shell.tsx`)

| # | file:line | key(s) | viol. | evidence | standard | proposed |
|---|---|---|---|---|---|---|
| OB1 | `onboarding.tsx:78-79` | `onboarding_walk_sources_title` "Navigation", `onboarding_walk_sources` "Home, Projects, Targets and the library, plus your recent Projects." (7385-7386) | 6 | — | Popover | "Sources" / "Home · Projects · Targets · Library" |
| OB2 | `:80-81` | `issues_title`, `onboarding_walk_issues` "Everything that needs you, in one list." (7387) | 6 | — | — | "Issues" / "Needs attention" |
| OB3 | `:82-83` | `home_column_next`, `onboarding_walk_next` "Each Project's next step. Click it to do it." (7388) | 6 | — | — | "Next" / "Next step per Project" |
| OB4 | `:84-85` | `onboarding_walk_status_title` "Status bar", `onboarding_walk_status` "Running work, issue counters and notifications." (7389-7390) | 6 | — | — | "Status" / "Work · Issues · Notifications" |
| OB5 | `:86` | `nav_targets`, `onboarding_walk_targets` "Your Targets, the catalogues and each night's plan." (7391) | 6 | — | — | "Targets" / "Targets · Catalogues · Plan" |
| OB6 | `:159-170` | — | — | The walk is a `Popover modal={false}` (`:167`). The highlight ring is `pointer-events-none` (`:160`). Outside clicks are not blocked; only Escape closes. | modal overlay | Use a modal scrim with a cut-out around the target. Only Back / Next / Skip are active. |
| OB7 | `shell.tsx:307-311`, `shell-contract.ts:20-24`, `onboarding.tsx:231-287`, `a-home/home.tsx:125-130` | `onboarding_getting_started`, `onboarding_check_progress` | 8, 9 | "Getting started" is a Box inserted at the top of Home, which shifts the dashboard when it is dismissed or completed. Its checklist buttons are 5× `xs outline` (`onboarding.tsx:241-248`). The shell reserves a `SidebarFooter` slot above Activity/Settings, but no slice fills it. The previous product had a progress ring + checklist popover above Settings: `apps/desktop/src/app/Sidebar.tsx:239-253`, `apps/desktop/src/features/onboarding/ChecklistPopover.tsx:7-14,96-162`, `ChecklistSection.tsx:247-260`. | ShellContribution.SidebarFooter + Popover | Restore the **donut + "Getting started {done}/{total}"** in the sidebar footer, opening a checklist popover. Remove the Home box. [No "achievements" feature was found by that name in the old source; the checklist is the evidenced feature.] |

### 3.15 Design-system page (`app/design-system-page.tsx`)

| # | file:line | viol. | evidence | proposed |
|---|---|---|---|---|
| DS1 | `:10-20,219-225,277-459` | 1 | The page claims to show every shared component, but has no standalone demo of Badge, Breadcrumb, ButtonGroup, Card, Collapsible, Combobox, DropdownMenu, Field, Input, InputGroup, Kbd, Popover, RadioGroup, ScrollArea, Sheet, Switch, Table, Tabs, Textarea or Tooltip. App primitives Box, ListDetail, Pill/CountBadge, Refusal, RowContextMenu/ContextMenuArea, HelpTip, NoteMarker, ClearableInput and MenuEntries appear only inside composites. Buttons show all 6 variants but only `default` and `sm` sizes (`:280-297`). | Make this page the inventory of §1: every component and every variant/size, and nothing feature-local. Add the new shared RowActions, SettingRow, fields and NavList. |
| DS2 | `:282` | 2 | The "Inspect session" demo uses `variant="secondary"`, which no product action uses. | Show the standard: primary = default, secondary = outline, row = ⋯, destructive = destructive. |
| DS3 | `:259-272` | 7 | The Z-index reference table is a raw `<table>` with row headers but no column headers. The session DataTable demo leaves Target and Equipment without `sortValue` (`:67-89`). | Use `ui/table` with headers. Make the demo columns sortable. |

---

## 4. User-named items → rows

- Calibration masters "dismiss" in the details panel; inconsistent menus → C1, C3, C14
- Trashed raws not shown; cleanup stage? → C2
- Masters cleanup/remove/trash; why "dismiss" → C1
- Replace masters ("update the dark for 0C gain 100 offset 50 for camera X") → C4 (absent), C8
- Calibration table has no headers; process vague; how to import raws → C6, C9
- "Prototype folder chooser…" slop → C7
- What "Import masters" does → C8
- Calibration Settings button → C10, S-CAL1
- Better master filters (temperature) → C11
- Explicit menu option for details → C3
- Alerts for old non-flat masters → C12 (absent)
- Sort on columns → C5, E5, E8, G3, O2, DS3, plus the 14 raw tables in §1c
- Themes: mode first, then theme; density does nothing → A1, A2
- Help page → S0c
- Locations "Activity" link → L1
- "Readable · Online · Complete scope" → L2
- Rescan moves the menu → L4
- Location facts line into a table → L3
- Duplicates review layout → move to Issues → L7
- Equipment trash icon vs X → §2 Remove row, E5
- Rig "Remove" text / standard dropdown → E1, E5
- Rig "used by" grows → E4
- "Edit optics" → "Edit" → E1
- Rig edit changes camera properties; select Camera/Filters/Telescope → E2
- Clicking a camera goes straight to edit → E3
- Filters as their own section → E5
- Naming: layout, useless tooltip, not draggable, "No fallbacks", text input + preview + token table → N1-N3
- Calibration settings links / only one toggle → S-CAL1
- Observing site map → O1
- Target lookup bubble, tooltip, "fixture" → T1-T3
- Goal templates time AND frames; "usable" → G1, G2
- Applications autodetect + file picker, "input writes", launch args everywhere, "open in" → add application → AP1-AP4
- About → "About", no slop or bubbles → AB1, AB2
- Rewrite the walk; block clicks; restore the donut + goals above Activity/Settings → OB1-OB7
- "Only standardised components" → §1c (shared gaps to promote: RowActions, fields, SettingRow, NavList, ToggleGroup filters; Pill made display-only)

## 5. Dependency classification (for the dispatcher)

- **blocks**: the §1c shared-primitive work (one shared RowActions, a shared fields module, SettingRow, NavList, display-only Pill, StatusBadge kinds replacing T4Badge) must land before the per-surface fixes C3, C11, C14, L5, L6, E1, E3, E5, G3, AP6 and AP7. Each of those fixes consumes one of these primitives.
- **related**: C4/C8 (replace and import masters share one matching dialog); L7 and E6 (both move into the Issues hub, with the part A/B issues work); A2 density (app-wide); S-CAL1 removal pairs with C10.
- **discovered-from**: `folder_picker_description` (C7) is the fallback for every FolderPicker in the app (6 consumers). Removing the key fixes the other surfaces too.
