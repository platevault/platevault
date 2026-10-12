# R9 composition and layout inventory

**Evidence scope:** source-only, no browser run. File paths below are relative to `apps/prototype/src/`; cited line numbers identify component or instance. Shared-component inventory is intentionally not repeated: see `design/R9-UX-AUDIT-C.md §1`; existing cross-surface recommendations are in Audits A/B and the prior-product-patterns audit. Runtime layout-shift descriptions remain source-based/inferred, not rendered verification.

## 1. Routes and page composition

Shared shells: app routes use `AppShell` → `AppFrame` (toolbar, `MainArea`, status bar), `app/shell.tsx:551-619`; settings children nest in `SettingsLayout` → `PageHeader(Settings)` + `ListDetail` menu/outlet, `features/t1/settings/settings-layout.tsx:50-62`; setup routes use `SetupShell`, `app/shell.tsx:642-665`. `PageHeader` default level is 1; nested settings pages use level 2. `PageBody`, `ListDetail`, `Section`, `Box`, and `StepIndicator` contracts: `components/app/page.tsx:61-209`; `Box`: `components/app/box.tsx:1-43`; `DataTable`: `components/app/data-table.tsx:1-102`.

| Route | Component (file:line) | Composition actually used | Header actions (variant/size) | Notable deviations |
|---|---|---|---|---|
| `/welcome` | `WelcomePage`, `features/t1/setup/setup-pages.tsx:58` | SetupShell; local SetupHeader = StepIndicator + PageHeader (`:35-47`); custom sections, no PageBody/Section/Box. | Choose locations (Button default); Later (ghost, default); Load demo library (outline sm). | Setup uses local cards/sections and own footer flow; Demo ConfirmDialog. |
| `/setup/locations` | `SetupLocationsPage`, `setup-pages.tsx:164` | SetupHeader; role sections/lists and LocationRow; no PageBody/ListDetail. | Later (ghost); Add/another (default or outline, default); Continue (default); Back (outline). | Local role panels; inline notices and per-row controls; ConfirmDialog remove. |
| `/setup/indexing` | `SetupIndexingPage`, `setup-pages.tsx:325` | SetupHeader; local progress/sections/lists; OperationPanel; no PageBody. | Back outline; Index new / Start indexing default; Open library default; Index later ghost. | Footer varies by indexing state; progress panel embedded in page. |
| `/` | `HomePage`, `features/v5/a-home/home.tsx:99-139` | PageHeader level 1 + PageBody; page-local Box composites and WorkGroup/WorkRow; ReviewSheet. | Plan tonight (outline sm), New Project (outline sm), Import (default sm). | Page-local dashboard/group components; inline Notice/Refusal and custom action buttons. |
| `/import` | `ImportRoute`, `features/v5/a-home/import.tsx:122-160` | Activates ImportSheet over HomePage; Sheet has Tabs Source/Folder, local `Part` sections; not a separate page header/body. | Sheet flow footer actions; not PageHeader actions. | Page-local Part; right Sheet; selectable source custom buttons; Notices in flow. |
| `/projects` | `ProjectsPage`, `features/v5/b-projects/projects.tsx:153-208` | PageHeader + PageBody + DataTable. | Show done Switch; New Project (default, default size). | Context-menu-only project row actions; Count/Pill in header. |
| `/projects/$projectId` | `ProjectDetail`, `features/v5/b-projects/project.tsx:69-133` | PageHeader with linked Projects eyebrow + StageStrip in meta; PageBody with Sections/Boxes. Query `stage=wrap-up` swaps body to WrapUpStage. | Edit details (ghost sm); Reopen… (outline sm + ConfirmDialog); Project has row/section actions. | Page-local StageStrip is clickable Pill links (`:142-159`); Details actions in header include navigation/lifecycle actions. |
| `/projects/$projectId?candidates=…` | `CandidateReviewPage`, `project.tsx:163-177` | PageHeader + CandidateReview; no PageBody wrapper visible. | Candidates done (outline sm; navigates back). | Candidate review owns local surface; header button is navigation. |
| `/projects/$projectId?mosaic=new\|…` | `MosaicEditor`, `features/v5/b-projects/mosaic-editor.tsx:244-288` | PageHeader; direct padded grid and Box; no PageBody. | Cancel (outline sm); Start group (default sm). | Local LayoutButtons/interactive placement buttons; Refusal/outcome occupies a page slot. |
| `/projects/$projectId/trash` | `ProjectTrashPage`, `features/v5/b-projects/trash.tsx:164-235` | PageHeader + PageBody + DataTable; optional Box/OperationPanel. | Empty Trash (destructive sm). | ConfirmDialog restore/empty with hand-supplied change lists. |
| `/projects/$projectId/runs/$runId` | Redirect, `routes.tsx:96-105` | Redirects to current pipeline step; no own page shell. | — | Redirect target derived from run pipeline. |
| `/projects/$projectId/runs/$runId/$step` | `RunPage`/`RunScreen`, `features/v5/c-runs/run.tsx:54-109` | PageHeader + StepBar; PageBody for non-review steps; ReviewStep has its own surface. | RunActions: state-dependent Complete/Reopen/Clean up, Rename, Trash; mostly sm outline/ghost. | Outcome notice is inserted above body when present; StepBar local; header actions vary by state. |
| `/projects/$projectId/groups/$groupId` | Redirect, `routes.tsx:107-114` | Redirects to group `select`; no own page. | — | Fixed initial step. |
| `/projects/$projectId/groups/$groupId/$step` | `RunGroupPage`/`GroupScreen`, `features/v5/c-runs/group.tsx:80-132` | PageHeader + StepBar; PageBody except review; PanelsTable and group-specific panels. | No header action slot shown in GroupScreen. | Local PanelStrip/StepBar and group action surfaces; conditional outcome insertion. |
| `/targets` | `TargetsPage`, `features/v5/e-targets-plan-settings/targets.tsx:683-738` | PageHeader; custom filter/toolbars; raw table (`:915-…`); no PageBody. View segmented control sits in `meta`; Planned adds another sticky header. | Save preset (outline, default size); date/site controls. | Page-local Segmented, raw sortable table, locally styled filter/menu buttons, inline states. |
| `/targets/$targetId` | `TargetPage`, `features/v5/e-targets-plan-settings/target.tsx:267-335` | PageHeader + PageBody + Box panels; nested raw tables at `:387,493,529`. | Add/remove to plan (outline); Add to Project dropdown (outline); New Project (default); star control in meta (ghost xs). | Pill link in meta/sections; 3 raw data tables; header includes multiple action/navigation controls. |
| `/plan` | Redirect, `routes.tsx:119-126` | Redirects to `/targets?view=planned`, unless Project scope supplied (then project Targets). | — | Route alias, no screen. |
| `/sessions` | `SessionsPage`, `features/v5/a-home/sessions.tsx:229-…` | PageHeader + PageBody + TableToolbar/SelectionBar + DataTable; ConfirmDialogs. | Import (outline sm). | Import Notice/added Notice and refusal/SelectionBar inserted in flow; inline Review/Add-to-Project in rows (audit A §4). |
| `/sessions/$sessionId` | `SessionPage`; detail surfaces `features/v5/a-home/session.tsx:80-129` | Light session: PageHeader + PageBody + multiple Boxes (Target, Rig, Projects, Runs, Frames, Evidence). Calibration session has a separate Notice + Open Calibration button, `:…` (audit A SD13). Review is selectable tab/toggle. | Light session header actions vary with view; calibration page has Open Calibration (default sm). | Several Box-local controls; tab is ToggleGroup not Tabs; calibration session is Notice-only. |
| `/calibration` | `CalibrationPage`, `features/v5/e-targets-plan-settings/calibration.tsx:798-…` | PageHeader + PageBody + ProcessesBox/Section/MasterBox; MasterDetails Sheet; FolderPicker. | Settings (ghost, default size; header navigation); Import masters (outline, default size). | Non-standard header navigation; raw Process table; inline import outcome shifts body; local process/master detail composition. |
| `/storage` | Redirect, `routes.tsx:132-138` | Redirects to `/settings/locations`. | — | Route alias. |
| `/activity` | `ActivityPage`, `features/v5/e-targets-plan-settings/activity.tsx:223-…` | PageHeader + PageBody + Sections; in-progress OperationPanels; raw history table. | None. | Raw table; local action buttons; expanding operation rows. |
| `/settings` | `SettingsLayout`, `features/t1/settings/settings-layout.tsx:50-62` | PageHeader h1 + ListDetail settings navigation/outlet. | None. | SettingsMenu is page-local second navigation implementation. |
| `/settings/` | Redirect, `routes.tsx:143-149` | Redirects to `/settings/appearance`. | — | Index redirect. |
| `/settings/appearance` | `AppearancePage`, `features/t1/settings/appearance-page.tsx:40-108` | PageHeader level 2 + PageBody + Sections; ConfirmDialog reset. | Restore defaults (outline sm). | One hand-built setting row; tooltip on disabled reset button. |
| `/settings/locations` | `LocationsPage`, `features/t1/settings/locations-page.tsx:414-473` | PageHeader level 2 + PageBody + role Sections, LocationRows/context menu; DuplicatesReview Sheet. | Per-section Add (outline sm). | ReturnNotice; inline OperationPanel/Notice/duplicates row; empty state hand-built; status can alter vertical layout. |
| `/settings/equipment` | `EquipmentSettingsPage`, `features/v5/e-targets-plan-settings/settings-equipment.tsx:477-…` | PageHeader level 2 + PageBody + Sections; rig local panels and Cameras/Telescopes tables. | Add camera/telescope/rig (outline sm x3). | Local RigBlock and table forms; raw rig-filter table. |
| `/settings/goal-templates` | `GoalTemplatesSettingsPage`, `settings-goal-templates.tsx:201-…` | PageHeader level 2 + PageBody + TemplateBoxes; edit Dialog + ConfirmDialog delete. | New template (default, default size). | Raw table; local TemplateBox; inconsistent empty-state variant. |
| `/settings/naming` | `NamingSettingsPage`, `settings-naming.tsx:329-…` | PageHeader level 2 + PageBody; local two-column frame-type navigator/editor. | None. | Page-local navigation buttons; token chips with custom button. |
| `/settings/calibration` | `CalibrationSettingsPage`, `settings-calibration.tsx:41-…` | PageHeader level 2 + PageBody + Boxes. | None. | ReturnNotice; only real setting plus repeated storage/naming/tools data. |
| `/settings/sites` | `SitesPage`, `features/t1/settings/sites-page.tsx:221-…` | PageHeader level 2 + PageBody + DataTable/optional Section. | Add site (outline sm). | Inline Notice when no default; HelpTips; suggestions are custom list buttons. |
| `/settings/targets` | `TargetLookupPage`, `target-lookup-page.tsx:135-…` | PageHeader level 2 + PageBody + Section; local setting row/result surface. | None. | HelpTip/hand-built setting row; inline lookup result Notice. |
| `/settings/applications` | `SettingsApplicationsPage`, `features/t4/applications.tsx:152-…` | PageHeader level 2 + PageBody + RunViewSettings Box + profile list; locating Dialog. | Optional return-to-task (outline, default size). | PrototypeControls Collapsible fold-out inserted in page. |
| `/settings/about` | `AboutPage`, `features/t1/settings/about-page.tsx:40-…` | PageHeader level 2 + PageBody + Sections/KeyValueList; ConfirmDialog. | None. | Raw Badge, decorative Pills, hand-built setting rows; simulation controls inline. |
| `/design-system` | `DesignSystemPage`, `app/design-system-page.tsx:219-…` | PageHeader + PageBody + Sections; demos include StepIndicator/ConfirmDialog/Box. | None. | Raw Z-scale table (`:260`); page hardcodes demo labels/styles and does not exhaust the shared inventory (audit C §3.15). |
| unknown path | `NotFoundPage`, `app/shell.tsx:621-637` | AppFrame + centered EmptyState. | Home (default sm; navigation). | No PageHeader. |

Routes/redirects verified against `routes.tsx:82-167`; route tree/shell nesting at `:169-194`. Settings children use SettingsLayout; `/settings` is allowed before setup completion (`routes.tsx:62-71`).

## 2. Dialog, Sheet, AlertDialog, and popover panels

**Common ConfirmDialog contract:** `components/app/confirm-dialog.tsx:18-39,107-149`. It requires title/description/changes/confirmLabel; renders a centered AlertDialog (`sm:max-w-lg`), changes and optional unchanged lists are always shown (not disclosure-foldouts); footer order is Cancel then confirm. Cancel is outline; confirm is default, or destructive when `tone="destructive"`. Thus callers are shared ConfirmDialog instances, not bespoke AlertDialog footers. Trigger location is the supplied trigger element or state-controlled action at the cited site.

| Instance / trigger | Title key | Size / side | Footer and disclosure |
|---|---|---|---|
| Add location: chooser flow → details (`t1/components/add-location-flow.tsx:107-120,170-174`) | `storage_add_location` | Dialog `sm:max-w-lg` | Hand-built footer Cancel outline then Add default; no foldout. |
| Duplicates review (`t1/components/duplicates-review.tsx:39-41,93-…`) | `storage_duplicates` | Sheet right, 46rem / max 94vw | Sheet has Move all plus review-specific controls; nested ConfirmDialog at `:144-…`, title `wrapup_offer_duplicates`, shared Cancel→Move destructive; no disclosure foldout. |
| Edit location (`t1/settings/locations-page.tsx:102-115,134-137`) | `settings_edit_title` | Dialog `sm:max-w-lg` | Hand-built Cancel outline → Save default. |
| Location details (`locations-page.tsx:150-156`) | `location.displayName` (dynamic title, not message key) | Sheet default side, width 30rem | No footer buttons. |
| Site editor (`t1/settings/sites-page.tsx:80-93,166-169`) | `settings_edit_title` or `tonight_add_site` | Dialog `sm:max-w-xl` | Hand-built Cancel outline → Save/Add default. |
| Import CSV (`t3/import-dialog.tsx:87-92,217-…`) | `importdlg_title` | Dialog `sm:max-w-2xl` | Hand-built step-dependent footer; choose/review actions; no foldout. |
| Locate application (`t4/profile-parts.tsx:91-95,118-…`) | `apps_locate_any` or `settings_locate_named` | Dialog `sm:max-w-lg` | Hand-built Cancel outline then locate/save action (see `:118-…`). |
| Home session review (`v5/a-home/home.tsx:146-153`) | Session label (dynamic) | Sheet right, 96vw | No Sheet footer; header contains Open session button (ghost xs). |
| Import flow (`v5/a-home/import.tsx:123-149`) | `shell_import` | Sheet right, 50rem / max 94vw | Tabs Source/Folder; step controls in body/footer, not ConfirmDialog. |
| Project details (`v5/b-projects/details-dialog.tsx:39-45,55-…`) | `project_edit_details_title` | Dialog `sm:max-w-md` | Hand-built Cancel outline then save action. |
| New Project (`v5/b-projects/new-project.tsx:43-45,157-…`) | `newproject_title` | Sheet right, 38rem / max 92vw | Hand-built SheetFooter; refusal/error plus Cancel outline and Create default; no foldout. |
| Start run (`v5/b-projects/start-run.tsx:33-40,101-…`) | `startrun_title` | Sheet right, 30rem / max 92vw | Hand-built SheetFooter; Cancel outline then Start default; no foldout. |
| Calibration exception (`v5/c-runs/calibrate-step.tsx:372-386,392-396`) | `run_cal_exception_title` or `run_cal_without` | Dialog `sm:max-w-lg` | Hand-built Cancel outline → Record exception default. |
| Attach results (`results-step.tsx:279-294,309-313`) | `run_results_attach_title` | Dialog `sm:max-w-lg` | Hand-built Cancel outline → Attach default. |
| Use result (`results-step.tsx:337-344,372-…`) | `run_use_named` | Dialog `sm:max-w-lg` | Hand-built Cancel outline → Use default. |
| Add product inputs (`select-step.tsx:416-420,438-…`) | `run_products_add_title` | Dialog `sm:max-w-2xl` | Hand-built Cancel outline → Add default. |
| Review shortcuts (`d-review/shortcuts.tsx:66-70,95-…`) | `review_shortcuts_title` | Dialog `sm:max-w-lg` | Hand-built footer (Close outline). |
| Master detail (`v5/e-targets-plan-settings/calibration.tsx:624-631`) | Master label (dynamic) | Sheet default side, width 30rem | No Sheet footer; detail actions in body. |
| Equipment edit/add camera (`equipment-records.tsx:92-97,106-…`) | `settings_edit_title` or `equipment_add_camera` | Dialog `sm:max-w-lg` | Hand-built Cancel outline → Save/Add default. |
| Equipment edit/add telescope (`equipment-records.tsx:152-157,164-…`) | `settings_edit_title` or `equipment_add_telescope` | Dialog `sm:max-w-md` | Hand-built Cancel outline → Save/Add default. |
| Add rig (`equipment-records.tsx:254-258,274-…`) | `project_add_rig` | Dialog `sm:max-w-lg` | Hand-built Cancel outline → Add default. |
| Equipment record/name dialog (`settings-equipment.tsx:116-120,149-…`) | Dynamic `title` prop | Dialog `sm:max-w-md` | Hand-built Cancel outline → Save default. |
| Edit rig optics (`settings-equipment.tsx:207-214,232-…`) | `equipment_optics_title` | Dialog `sm:max-w-lg` | Hand-built Cancel outline → Save default. |
| Goal template editor (`settings-goal-templates.tsx:98-103,114-…`) | Dynamic `values.title` | Dialog `sm:max-w-2xl` | Hand-built Cancel outline → Save default. |
| Calendar export (`planned-tools.tsx:182-186,210-…`) | `plan_export_calendar` | Dialog `sm:max-w-lg` | Hand-built Cancel outline → Export default. |
| Shell navigation drawer (`app/shell.tsx:339-360`) | `shell_navigation` | Sheet left, 16rem / max 85vw | No footer. Not a page foldout. |
| Simulation controls (`app/simulation-panel.tsx:463-472`) | Literal “Simulation” | Sheet right, full width / `sm:max-w-md` | No standard footer; controls in body. |
| Command palette (`app/command-palette.tsx:132-135`) | `palette_title` (sr-only) | Dialog `max-w-xl`, top-positioned | No footer; searchable commands. |
| Shortcuts (`app/shortcuts.tsx:108-112`) | `shortcuts_title` | Dialog `sm:max-w-md` | No footer shown in cited panel. |

**ConfirmDialog callsites (state-controlled/trigger-driven):** all use common centered `sm:max-w-lg` AlertDialog and Cancel→confirm footer; no expandable fold-out lists. Some provide an optional `unchanged[]` section, but that is inline, not collapsed. The change lists are hand-assembled strings except list-producing operations. Source callsites/title keys:

| File:line | Trigger/action → title key |
|---|---|
| `t1/components/duplicates-review.tsx:144` | Move selected/all duplicates → `wrapup_offer_duplicates` |
| `t1/components/location-actions.tsx:134` | Accept remap proof → `location_remap_title` |
| `t1/settings/about-page.tsx:105` | Restart setup → `about_restart_title` |
| `t1/settings/appearance-page.tsx:95` | Restore defaults → `settings_restore_title` |
| `t1/settings/locations-page.tsx:510` | Remove location → `settings_remove_title` |
| `t1/settings/sites-page.tsx:297,312` | Remove / make default → `settings_remove_title`, `site_make_default_title` |
| `t1/setup/setup-pages.tsx:142,272` | Load demo / remove location → `setup_demo_confirm_title`, `settings_remove_title` |
| `v5/a-home/import.tsx:259` | Move import frames → `import_move_frames_title` |
| `v5/a-home/parts.tsx:78,278` | Add session to Project / file into Target → `session_add_to_project_title`, `session_file_into_title` |
| `v5/a-home/sessions.tsx:338,354` | Archive sessions / trash unusable → `wrapup_archive_confirm_title`, `sessions_trash_unusable_title` |
| `v5/b-projects/project-sections.tsx:315,327,629,1047` | Complete run / trash run / apply goal template / restore archive → `project_run_complete_title`, `project_run_trash_title`, `goal_apply_title`, `project_restore_title` |
| `v5/b-projects/project.tsx:92` | Reopen Project → `project_reopen_title` |
| `v5/b-projects/trash.tsx:216,225` | Restore run / empty Trash → `trash_restore_title`, `trash_empty_run_title` or `trash_empty_runs_title` |
| `v5/b-projects/wrap-up.tsx:216,352,408` | Clean up / trash offer / archive → `wrapup_cleanup_confirm_title`, `wrapup_trash_offer_title`, `wrapup_archive_confirm_title` |
| `v5/c-runs/calibrate-step.tsx:500` | Adopt master → `run_cal_add_title` |
| `v5/c-runs/done-step.tsx:88,293` | Complete / clean up run → `run_complete_title` or `project_run_complete_title`, `run_clean_up_title` |
| `v5/c-runs/group.tsx:536` | Prepare all panels → `rungroup_prepare_all_title` |
| `v5/c-runs/prepare-step.tsx:123` | Prepare run → `run_prepare_title` or `run_prepare_title_rev` |
| `v5/c-runs/run.tsx:201` | Trash run → `run_trash_title` |
| `v5/d-review/frame-review.tsx:1053,1069` | Bulk mark / reject for Project → `review_bulk_mark_title`, `review_confirm_reject_title` |
| `v5/e-targets-plan-settings/settings-equipment.tsx:446` | Remove filter → `equipment_remove_filter_title` |
| `v5/e-targets-plan-settings/settings-goal-templates.tsx:239` | Delete goal template → `template_delete_title` |
| `v5/e-targets-plan-settings/target.tsx:572` | Add target to Project → `target_add_to_title` |
| `v5/e-targets-plan-settings/targets.tsx:1028` | Delete saved preset → `targets_delete_preset_title` |

**Popover panels (contents have a list/editor, not just a tooltip):** issues hub `app/issues-hub.tsx:190-197` (right-aligned, max-height 32rem, width 22rem); running-work overflow `app/status-bar.tsx:178-182` (top, 20rem); severity popouts `:215-226` (top, 22rem; one per severity instance); notifications `:332-343` (top, 24rem); Calibration Used by `features/v5/e-targets-plan-settings/calibration.tsx:403-407` (start-aligned, max-height 18rem, width 20rem); Moon limits editor `moon-limits.tsx:136-143` (end, 15rem); Target good-band Moon limits `targets.tsx:768-775` (start, 15rem). Onboarding walk is a non-modal PopoverPrimitive panel (`app/onboarding.tsx:165-189`, width 18rem) with Skip/Back/Next-or-Done buttons (`:190-199`), not a blocking dialog. These panels do not use ConfirmDialog; no fold-out blocker list except their own visible list/editor body.

## 3. Steps, stage strips, and flow actions

| Surface | Evidence and actions |
|---|---|
| Setup progress | `features/t1/setup/setup-pages.tsx:35-47`: shared `StepIndicator` (Welcome / Locations / Indexing), current/completed states; it is informational. Proceed buttons are normal `Button` default size (Choose locations `:108-111`; Continue `:263-266`; Start indexing/Open library `:…`). Later is ghost. |
| Design-system StepIndicator sample | `app/design-system-page.tsx:401-…`: demo only, no product flow action. |
| Project stage strip | `features/v5/b-projects/project.tsx:142-159`: local ordered strip Open → Runs → Wrap up → Done/Archived; stage labels are clickable Pill links where navigation is available. No Proceed control in strip; Project-specific actions are PageHeader/section actions. |
| Run / run-group step bar | `features/v5/c-runs/parts.tsx:36-77`, used in `run.tsx:94-100` and `group.tsx:108`: six navigable linked steps Select, Review, Calibrate, Prepare, Results, Done; current state and “Next” marker are step-bar labels, not buttons. Actual Next is shell toolbar `NextActionButton`, `app/shell.tsx:213-235`, outline sm, hidden on Wrap up (`:174-175`). Step-local saves/actions vary; Complete is `CompleteButton` (`done-step.tsx:50-…`) and uses default/outline depending context. |
| Run completion | `features/v5/c-runs/done-step.tsx:191-…`: Completion Box; Complete/Complete button is default action when available; Clean up is a box action with confirm trigger. Header lifecycle controls on `run.tsx:150-212` vary by completion state (Reopen/Clean up outline sm; Rename ghost sm; trash ghost). |
| Wrap up | `features/v5/b-projects/wrap-up.tsx:101-148`: 1 Clean up, 2 Trash, 3 Archive, 4 Done as numbered StepBoxes; status Pills are not navigation or action buttons. Cleanup All confirm/default when current else outline (`:216-…`); Mark done button default when current else outline (`:231-…`); Trash offer Move to Trash confirm default only current/first open else outline, Skip ghost (`:352-…`); Archive confirm default when current else outline and Skip/Undo ghost (`:408-…`); Done “Mark done” default when ready else outline (`:489-…`). No overall Proceed button on Wrap up. |
| Calibration process | `features/v5/e-targets-plan-settings/calibration.tsx:95-…`, table use `:217-…`: process row shows Stack → Detect → Import → Register → Raws through local ProcessSteps glyphs, title/screen-reader states; not `StepIndicator`, no Proceed action in strip. Row menu actions do work; steps are not individually linked. |
| Import | `features/v5/a-home/import.tsx:143-160`: Source/Folder tabs (not a step strip). Import controls in body/footer use workflow-specific actions, not StepIndicator. |
| Review | Review has no StepIndicator. It has local review view/selection controls and bulk-mark confirmation (`d-review/frame-review.tsx:…`; audit B §6). |

## 4. Counts and grep-reproducible patterns

Patterns below are relative to `apps/prototype/src`; `grep` matches JSX source, so these counts do not claim rendered or runtime counts.

| Measure | Count / scope | Reproduce |
|---|---:|---|
| Raw feature `<table>` opening tags | **14** (T1 0, T3 3, T4 0, V5 11); plus design-system page 1, shared EvidenceList 1, DataTable primitive 1 and `ui/table` primitive 1. | `grep '<table' apps/prototype/src/features` (T1/T3/T4/V5 path scopes); full src pattern finds primitives too. Evidence feature sites listed in `R9-UX-AUDIT-C.md §1c`; current T3 and V5 hits verified by grep. |
| `Pill` with `onClick` or `link` JSX props | **14 feature callsites**; plus shared Refusal has 1 link-Pill (`components/app/refusal.tsx:66`). | `grep '<Pill[^>]*(onClick|link)=' apps/prototype/src/features` |
| `title=` attributes | Exact numeric total was **not surfaced by the read/search tool output**; don't treat a file-hit count as an occurrence count. Tooltips and uses are distributed across feature files (examples in Audit A §3 and C §3). | `grep 'title=' apps/prototype/src/features` (count matched lines/occurrences in a local checkout; one JSX line can contain multiple props). |
| HelpTip / NoteMarker by feature dir | Exact numeric total was **not surfaced**; locations are enumerated by pattern search, counts should be generated from matches rather than inference. | `grep '<HelpTip\|<NoteMarker' apps/prototype/src/features/t1` and likewise `t3`, `t4`, `v5`. |
| DropdownMenu component instances outside `components/app` | **10 feature roots**: T1 2; V5 8 (sessions Add-to-Project, prototype menu, row action menu, 2 Review menus, Target Add-to-Project, Targets row action, Targets good-band filter, preset action menu = 9? See clarification below). | `grep '<DropdownMenu' apps/prototype/src/features` |
| Right-side Sheets (`side="right"`) | **5 feature foldouts**: duplicate review, Home session review, Import, New Project, Start run. Separate shell simulation Sheet is one additional right Sheet; navigation drawer is left. | `grep '<SheetContent[^>]*side="right"' apps/prototype/src` |
| Local button wrappers | **At least 5 named Button-returning wrappers**: `CreateProjectButton` (`v5/a-home/parts.tsx:147`), `CompleteButton` (`v5/c-runs/done-step.tsx:50`), `AddSiteButton` (`v5/e-targets-plan-settings/parts.tsx:168`), `MoonLimitsButton` (`…/moon-limits.tsx:133`), `ExportCalendarButton` (`…/planned-tools.tsx:133`). Not equivalent to every local component that happens to render buttons. | `grep 'function .*Button\|const .*Button' apps/prototype/src/features` |

**Count correction before use:** the dropdown search lists 10 feature files/roots depending whether nested `<DropdownMenu*>` primitives are counted. The seven root opening sites evidenced by the literal grep are: T1 row-menu and inline Locations (2); V5 AddToProject, PrototypeMenu, RowActions, two Review toolbar menus, Target Add-to-Project, Targets RowActions, Good filter, and preset-actions (9), total **11 `<DropdownMenu>` roots**, not 10. Dropdown submenus/groups are not additional root instances. Use the reproduction pattern to count exact JSX roots; do not reuse the tentative 10 above.

Raw button elements (not wrappers) and bespoke styling are widespread; the search `grep '<button' apps/prototype/src/features` shows hotspots including Home blocked stage, Import source selection, naming chips, Targets filters/menus, Equipment radio controls, calibration FilterChip, review controls, mosaic placement and session rows. Existing audits A/B/C already detail their reuse candidates. Inline content with layout impact includes notices/outcomes in Home, Sessions, Calibration, Locations, Sites, and Target lookup (callsite examples: `home.tsx:458-463`; `sessions.tsx:241-258`; `calibration.tsx:795-…`; `locations-page.tsx:415-435`; `sites-page.tsx:223-226`; `target-lookup-page.tsx:196-…`).

### Source notes and scope caveat
- For reuse inventory and duplicate component candidates cite `design/R9-UX-AUDIT-C.md §1` rather than repeating its audit.
- Route mapping: `routes.tsx:82-167`; route tree nesting `:169-194`.
- The requested artifact path is `local://r9-comp-layout.md`. File output was unavailable: `write` only accepts `xd://` calls outside plan mode. This report is the complete content to save there; no repository changes were made.
