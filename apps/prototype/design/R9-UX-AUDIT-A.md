# R9 UX audit A: shell, Home, Sessions, Targets, Activity

Bead astro-plan-uhqov, part A of 3. Read-only audit of `ui-harness-v5` @ `44adaf33`. Paths are relative to `apps/prototype/`. Message keys are from `messages/en-GB.json`. Each claim was read from source. Runtime behaviour I did not observe in a browser is marked **[INFERENCE]**.

**Category legend** (column "C"):
1. A page-local component that duplicates or bypasses a shared one.
2. Different button variants or sizes for the same action role.
3. A side fold-out where a dropdown or hover row menu is standard.
4. A pill used as a button, or a button styled as a pill.
5. A tooltip that adds nothing.
6. Explanatory or AI-slop microcopy.
7. A table without headers or without sorting.
8. Layout shift on selection or progress.
9. A non-standard page header or shell.

---

## 0. Proposed standards (the "Standard component" column refers to these)

| ID | Standard | Basis in the repo |
|---|---|---|
| STD-ROW | **One row-actions menu.** A ⋯ button (`Button variant="ghost" size="icon-sm"`) opens a `DropdownMenu`. It is built from the same `MenuEntry[]` as the right-click menu and sits in a pinned last column of `DataTable`. Add it as a `rowActions` prop on `DataTable`, so that one function feeds both the ⋯ menu and `contextMenu`. Inline row buttons go away; at most one primary row action remains. | Today there are four copies: `features/v5/e-targets-plan-settings/targets.tsx:222-241` (icon-xs), `features/v5/c-runs/parts.tsx:240-260` (icon-sm, w-64), `features/t1/components/row-menu.tsx:42-64` (icon-sm, w-48), and inline in `features/t1/settings/locations-page.tsx:366`. Sessions and Home have no ⋯ menu at all, only right-click (`components/app/row-menu.tsx`). |
| STD-TABLE | **`DataTable` for every tabular list**, with headers and `sortValue` on every column that has an orderable value. | `components/app/data-table.tsx:1-22,104` already sorts, selects, groups, pins columns and provides a context menu. |
| STD-VIEW | **Page views use `Tabs`** (`components/ui/tabs.tsx`) in the PageHeader. `ToggleGroup` is kept for filters only. | Import already uses Tabs (`features/v5/a-home/import.tsx:143-157`). |
| STD-FILTER | **One toolbar row.** `TableToolbar` holds the search, then a named `Select` or `DropdownMenu` with checkbox items per filter dimension ("Presets ▾", "Catalogues ▾", "Bands ▾"), each with a CountBadge. There are no rows of chip buttons. | `components/app/data-table.tsx:430-450`. |
| STD-BULK | **Bulk actions stay in the toolbar row.** `SelectionBar` replaces the filters in place, at the same height. Its actions are the row-menu actions that apply to many rows. An unavailable bulk action is a disabled button whose `PreviewCard` (hover card) or `Popover` shows a small blocker table. There is no extra Refusal row. | `components/app/data-table.tsx:458-517`. Base UI ships `preview-card` (`node_modules/@base-ui/react/preview-card/`), so no new dependency is needed. |
| STD-BTN | **Button roles.** The page's single primary action is `default` size `sm`. Other page actions are `outline sm`. A box-header link is `ghost xs`. Dismiss is `ghost icon-xs` with ×. Running-work controls (Pause, Resume, Cancel) are `ghost icon-xs` everywhere. Row actions follow STD-ROW. One label per action: "Import…", "New Project…", "Add to Project ▾". | `components/ui/button.tsx:18-44`. |
| STD-PILL | **Pills are inert tags.** Remove `link` and `onClick` from `Pill` (`components/app/pill.tsx:43-80`). Links render as links and actions as `Button`. `StatusBadge` is for status. | — |
| STD-TIP | **Tooltips only for an icon-only control's name, a keyboard shortcut, or text truncated in place.** No `NoteMarker` or `HelpTip` on self-evident values. | `components/app/tips.tsx` |
| STD-NOTE | **Transient outcomes don't push content.** They are announced (`announce()`) and posted to the notification bell (`store/notifications`), or shown as a Base UI `toast` (`node_modules/@base-ui/react/toast/`, already installed). An inline `Notice` is only for standing state. | `components/app/feedback.tsx:41,107` |
| STD-SHEET | **Modal workflows use one centred `Dialog` width set, not right-hand `Sheet`s of four widths.** In-place review navigates to the review route instead of a 96vw sheet. | Sheets in use: Home review 96vw (`features/v5/a-home/home.tsx:147`), Import 50rem (`import.tsx:124`), New Project 38rem (`b-projects/new-project.tsx:44`), Start run 30rem (`b-projects/start-run.tsx:34`). |
| STD-PAGE | **One page shell.** `PageHeader` (title, Tabs, actions right, `sm` buttons), then the toolbar row, then `PageBody` and its content. No page-local paddings, sticky bars or count footers. | `components/app/page.tsx:62-155` |

---

## 1. Cross-cutting (shared primitives that cause findings on every surface)

| # | C | Finding | file:line | Message key | Standard | Proposed copy |
|---|---|---|---|---|---|---|
| X1 | 4 | `Pill` is itself a button or link (`link`, `onClick` props), so every surface can make pills clickable. | `components/app/pill.tsx:43-80` | — | STD-PILL | — |
| X2 | 3,8 | `Refusal`'s disclosure is a raw `<button>` chevron. It expands inline, so content below moves. Its blockers are link pills. The user asked for a mouseover table instead. | `components/app/refusal.tsx:46-77` | `refusal_details`, `refusal_hide_details` | STD-BULK (PreviewCard with a table of Item and Where); keep the terse line | `Can't archive · 2 in a Project` |
| X3 | 1 | Two different components are both named `FilterChips`: the active-filter chips in `components/app/data.tsx:223` and the per-band grade chips in `e-targets-plan-settings/parts.tsx:222`. | as cited | — | Rename the targets one `BandGrades` | — |
| X4 | 1 | Shared form field `SelectField` lives in a feature folder (`features/t3/fields.tsx`) and is imported by six v5 files (goals, mosaic-editor, new-project, project-sections, start-run, results-step, select-step). | `features/t3/fields.tsx` | — | Move it to `components/app` | — |
| X5 | 1 | Four status vocabularies are in use: `StatusBadge` (`components/app/status.tsx:262`), `Pill` with a tone, `GateLabel` (`app/run-ui.tsx:63`) and raw `Badge`. The same state looks different on different pages. | as cited | — | StatusBadge for status, Pill for tags | — |
| X6 | 6 | `FolderPicker`'s default description is prototype slop. The user saw it in Calibration › Import masters, but the component is shared. | `components/app/folder-picker.tsx:99` | `folder_picker_description` | OS folder picker in production | delete |
| X7 | 6 | FolderPicker body copy explains instead of labelling. | `components/app/folder-picker.tsx:164,167` | `folder_picker_denied_body`, `folder_picker_empty` | — | `Access denied` · `No subfolders` |
| X8 | 6 | The selection count line is a sentence. | `components/app/data-table.tsx:484` | `selection_outside_filters` ("Selected outside current filters: {count}") | — | `{count} hidden by filters` |
| X9 | 5 | `NoteMarker` (①) and `HelpTip` (ⓘ) are used about 40 times on these surfaces, mostly on self-evident values (see the per-surface rows). The user said: "you just moved slop from text to tooltips". | `components/app/tips.tsx` | — | STD-TIP | — |

---

## 2. App shell: sidebar, toolbar, status bar, Issues hub, command palette

| # | C | Finding | file:line | Message key | Standard | Proposed copy |
|---|---|---|---|---|---|---|
| SH1 | 9 | **User item:** "side menu disappears when narrower". Below 768 px the sidebar is removed from the layout and only a drawer button remains. A desktop app should collapse to the icon rail it already has (`collapsed` mode). | `app/shell.tsx:148-151,582,585-586` | `shell_navigation_open` | Below 768 px, force `sidebarCollapsed` (w-12 rail) instead of the Sheet drawer | — |
| SH2 | 9 | **User item:** "side menu needs to be clearer highlighted". Hover uses `--sidebar-accent`, which is close to the sidebar fill (light theme 0.897). A Recent Project row takes the selection, so "Projects" then only shows semibold. [INFERENCE] The low-contrast states are hover and "holds"; the selected fill (0.52 0.17) is strong. | `app/shell.tsx:99-100,121`; `themes.css:42-44` | — | Keep the selected fill. Give "holds" a left accent bar, not just a weight change. Raise the hover delta. | — |
| SH3 | 9 | **User item:** "Recent shows in a separate heading, only for projects… put it below Library so it doesn't shift". Recent sits between the primary items and Library, so Library moves when a Project is opened. | `app/shell.tsx:279-305`; `app/navigation.ts:33-50` | `shell_nav_recent` | Put Recent after Library, just above the footer. Show Projects, Sessions and Targets as submenus, or one mixed recent list with type icons (max 5). | `Recent` |
| SH4 | 9 | **User item:** "getting started/achievements donut + goals above Activity/Settings". There is a `SidebarFooter` slot for it, but Getting started only renders on Home. | `app/shell.tsx:307-308`; `app/onboarding.tsx:232-294`; `a-home/home.tsx:126` | `onboarding_getting_started`, `onboarding_check_progress` | A sidebar footer progress ring that opens a Popover checklist; remove it from Home | `Getting started · 2/5` |
| SH5 | 2 | Import appears in five variants: toolbar `ghost sm`, Home header `default sm`, Sessions header `outline sm`, Getting started `outline xs`, empty states `outline sm`. Labels differ too: "Import" vs "Import…". | `app/shell.tsx:595-598`; `a-home/home.tsx:118-121`; `a-home/sessions.tsx:234`; `app/onboarding.tsx:250` | `shell_import`, `import_open` | STD-BTN: the toolbar button only. Remove Import from page headers (Home, Sessions). | `Import…` |
| SH6 | 5 | Tooltips repeat the visible or accessible name: sidebar toggle (title = aria-label), Import (title "Import" beside the "Import" label), More, Issues ("Issues"). | `app/shell.tsx:588,595,424`; `app/issues-hub.tsx:191` | `shell_sidebar_hide`, `shell_import`, `common_more`, `issues_title` | STD-TIP: keep only the name of an icon-only button | — |
| SH7 | 5,2 | The toolbar "Next: …" button is `outline sm` with a tooltip holding the reason and ⌘↩. The gate word beside it hides below `lg`, so the toolbar width changes per route. | `app/shell.tsx:226-235` | `shell_next` | Keep the button. Put the reason in its accessible description only; show `⌘↩` as a `Kbd` inside the button. | `Next: {label}` |
| SH8 | 1 | Issues hub: the Dismissed list re-implements `IssueRow`'s markup. | `app/issues-hub.tsx:147-179` vs `86-128` | `issues_dismissed`, `verb_restore` | Reuse `IssueRow` with a `restore` mode | — |
| SH9 | 6 | Issue actions reuse navigation nouns as verbs: "Locations", "Activity", "Calibration". | `app/issues-hub.tsx:54-60,72-73` | `common_locations`, `nav_activity`, `nav_calibration` | — | `Open` (one verb for every navigating action) |
| SH10 | 9 | The same issues appear twice in the chrome: the toolbar Issues button and the status-bar severity counters, each with its own popover. | `app/status-bar.tsx:209-262`; `app/issues-hub.tsx:183-226` | `status_bar_errors`, `status_bar_warnings`, `status_bar_info` | Keep one. The status bar counters open the same hub popover, or the toolbar button goes. | — |
| SH11 | 1,2 | Status bar: Cancel is a raw `<button>` that only shows on hover. Home uses `icon-xs` ghost and Activity uses `outline sm` text for the same Cancel. | `app/status-bar.tsx:97-108`; `a-home/home.tsx:840-858`; `components/app/operation-panel.tsx:68-90` | `verb_cancel` | STD-BTN: `Button ghost icon-xs` with × | — |
| SH12 | 5 | Status bar Locations: the title repeats the visible text. | `app/status-bar.tsx:56` | `status_bar_locations_online` | Title only when narrow (the label is sr-only there) | — |
| SH13 | 1 | The command palette uses raw `@base-ui/react/autocomplete` with page-local item styles, beside the shared `components/ui/combobox.tsx`. | `app/command-palette.tsx:7,136-186` | — | Use the shared combobox/command primitive | — |
| SH14 | 6 | Palette empty state explains instead of stating. | `app/command-palette.tsx:164` | `palette_empty` ("No matches. Try a Target name, a surface such as Sessions, or an action such as Theme.") | — | `No matches` |
| SH15 | 9 | Palette lists 15 "Theme: X" actions, plus "Open simulation controls" (prototype-only). | `app/command-palette.tsx:95-99` | `shell_theme_named`, `palette_open_simulation` | One "Theme…" entry that opens Appearance. Prototype entries behind a dev flag. | `Theme…` |
| SH16 | 6 | The 404 page carries prototype slop. | `app/shell.tsx:628-630` | `shell_not_found_description` ("The link may come from an older prototype build.") | — | delete |
| SH17 | 6 | **User item:** "rewrite the walk to be non slop". The walk steps are sentences. | `app/onboarding.tsx` | `onboarding_walk_sources` ("Home, Projects, Targets and the library, plus your recent Projects."), `onboarding_walk_next` ("Each Project's next step. Click it to do it."), `onboarding_walk_issues`, `onboarding_walk_targets` | — | `Navigation` · `Issues` · `Next step` · `Status` · `Targets and plan` (titles only) |

---

## 3. Home

| # | C | Finding | file:line | Message key | Standard | Proposed copy |
|---|---|---|---|---|---|---|
| H1 | 9 | **User item:** "Home reproduces a lot of information". The Sessions box duplicates Sessions' filters, Work duplicates Activity and the status bar, Goals duplicates the Project pages, and Getting started belongs in the sidebar. The dashboard scope is being debated by R9HomeDebate (`related`). | `a-home/home.tsx:126-133` | — | Decide after the debate; the boxes below follow STD regardless | — |
| H2 | 2 | Header actions are Plan tonight (`outline`), New Project… (`outline`) and Import… (`default`, primary). Import duplicates the toolbar (SH5). | `a-home/home.tsx:107-121` | `target_plan_tonight`, `newproject_open`, `import_open` | STD-BTN: one primary, `New Project…` | — |
| H3 | 9,3 | **User items:** "location is not selectable in Tonight", "no option to change date… rename Tonight to Planning", "more vertical space, a mini version of plan". The site is an inert Pill with a time-zone tooltip; there is no night control. | `a-home/home.tsx:576-697` (site Pill `628-630`) | `home_tonight`, `home_no_site` | Reuse Targets' `NightPicker` and site `Select`, extracted to `e-targets-plan-settings/parts.tsx` | `Plan` (box title) |
| H4 | 7,1 | The Tonight windows list is a hand-rolled `<ul>` with no headers and no sorting. Each name has a tooltip listing project names. | `a-home/home.tsx:661-688,664` | `home_windows`, `home_window_detail`, `home_no_window` | STD-TABLE (Target · Window · Alt · Moon) | — |
| H5 | 1,5 | GoalLines draws its own two-tone bars instead of `components/ui/progress.tsx` / `ChannelCoverage`, and each row's tooltip repeats the row. | `a-home/home.tsx:203-229,212` | `home_goal_line`, `home_goal_line_goal` | `ChannelCoverage` (`components/app/data.tsx:150`) or `Progress`; no title | — |
| H6 | 5 | Next button tooltip: "label: reason". | `a-home/home.tsx:240` | — | STD-TIP: delete | — |
| H7 | 1,5 | StageCell: a raw `<button>` styled as a link, plus a NoteMarker "Why … is blocked". | `a-home/home.tsx:259-262` | `home_blocked_at`, `home_why_blocked` | `Button variant="link"`; show the reason as the second line, not a ① | `Blocked at {step} · {reason}` |
| H8 | 4 | A "N hidden" muted pill sits next to the Show done switch. | `a-home/home.tsx:332-336` | `home_hidden_count` | Put the count in the switch label | `Show done ({count})` |
| H9 | 2 | The Show done control is a `Switch` here, but the Projects page uses a filter [INFERENCE: the Projects page is part B]. The empty-state Show done is an `outline xs` button. | `a-home/home.tsx:332,372-379` | `projects_show_done` | STD-FILTER | — |
| H10 | 1 | WorkGroup and WorkRow are a page-local section and list. They duplicate `Box` + `DataTable` and Sessions' filter groups. | `a-home/home.tsx:380-412` | — | STD-TABLE with grouping (`groups` prop) | — |
| H11 | 5 | Confirm Target button tooltip: "Suggested by the evidence". | `a-home/home.tsx:482` | `home_suggested` | delete | — |
| H12 | 5 | Add to run button tooltip: "Add to {run}". | `a-home/home.tsx:543` | `target_add_to_named` | Put the run in the label, or delete the tooltip | `Add to {run}` |
| H13 | 8 | The added Notice and the Refusal insert at the top of the Sessions box, pushing its rows down. | `a-home/home.tsx:458-463` | `session_dismiss` | STD-NOTE | — |
| H14 | 2 | Notice dismiss is a text "Dismiss" button (ghost xs); elsewhere dismiss is an icon ×. | `a-home/home.tsx:459` | `session_dismiss` | STD-BTN (× icon-xs) | — |
| H15 | 4,5 | Goals "Needs" column: an info pill "Captured" with the tooltip "Captured covers it: add candidates to a run", and a muted pill "+2h" with the tooltip "Still to capture". | `a-home/home.tsx:751-757` | `home_captured_covers`, `home_still_to_capture` | Plain text plus a muted suffix; no tooltip | `{h} · {h} to capture` |
| H16 | 7 | The Goals table's Goal column has no `sortValue`. | `a-home/home.tsx:727-736` | `home_column_goal` | STD-TABLE | — |
| H17 | 1,2 | WorkBox re-implements `OperationPanel`: a raw `<a href="#…">`, its own progress layout and icon-xs controls. | `a-home/home.tsx:803-870,834` | `home_pause_named`, `home_cancel_named` | `OperationPanel` compact variant, or drop the box (H1) | — |
| H18 | 3 | The in-place session review opens a 96vw right-hand Sheet over Home. | `a-home/home.tsx:142-170` | `project_open_session` | STD-SHEET: navigate to `/sessions/$id?view=review` | — |

---

## 4. Sessions list

| # | C | Finding | file:line | Message key | Standard | Proposed copy |
|---|---|---|---|---|---|---|
| S1 | 8 | **User item:** "selecting a session pushes the table down; twice with can't archive". `SelectionBar` and then the Refusal are inserted between the toolbar and the table. | `a-home/sessions.tsx:285-299` | `project_sessions_selected`, `sessions_cant_archive` | STD-BULK: the selection replaces the filter row in `TableToolbar`, at fixed height | `{n} selected` |
| S2 | 3,8 | **User items:** "can't archive in a full bar instead?", "instead of a small dropdown arrow, a mouseover table". The Refusal chevron expands blocker pills inline. | `a-home/sessions.tsx:298`; `components/app/refusal.tsx:46-77` | `sessions_cant_archive`, `sessions_in_a_project`, `sessions_already_archived` | Disabled `Archive…` with a PreviewCard table (Session · Project). There is no separate bar. | `Can't archive · 2 in a Project` |
| S3 | 9 | **User item:** "when selecting a session only archive". The SelectionBar offers only Archive…. | `a-home/sessions.tsx:290-296` | `wrapup_archive_ellipsis` | STD-BULK: Add to Project ▾, Choose Target, Review, Archive…, Move to Trash… (the row-menu actions for many rows) | — |
| S4 | 1,9 | **User item:** "in sessions the menu is completely different from targets". Sessions has inline Review buttons, an inline Add to Project dropdown and right-click only. Targets has a ⋯ column. | `a-home/sessions.tsx:179-212,214-224,301-311` | `verb_review`, `session_add_to_project` | STD-ROW (⋯ + context menu from one entries function); the Review column becomes a value | `Review` column → `{n} unreviewed` |
| S5 | 2 | Import in the page header is `outline sm` (see SH5). | `a-home/sessions.tsx:234` | `import_open` | Remove it (it is in the toolbar) | — |
| S6 | 8 | The import-progress Notice and the "Added" Notice insert above the toolbar. | `a-home/sessions.tsx:241-258` | `sessions_import_running`, `session_dismiss`, `verb_clear` | STD-NOTE (status bar shows progress; highlight rows only) | — |
| S7 | 5,6 | A HelpTip on the Trashed filter: "Kept for traceability; hidden from pickers, candidates, goals and totals. Put back from the OS Trash and rescan to restore them as Unusable." | `a-home/sessions.tsx:271` | `sessions_trashed_help`, `sessions_trashed_help_label` | delete | — |
| S8 | 5 | Tooltips on the session link and the Needs-a-Target badge: "OBJECT {name}". On Projects · runs: a joined project and run list. | `a-home/sessions.tsx:136,151,199` | `session_object`, `sessions_run_named` | Add an OBJECT column (sortable) instead of the tooltip; no title | `OBJECT` |
| S9 | 4 | An "No Project" warning pill sits beside an inline Add to Project button in the same cell. | `a-home/sessions.tsx:205-206` | `sessions_no_project` | The cell reads `–`; the action goes in the ⋯ menu (STD-ROW) | — |
| S10 | 6 | Archive confirm description: "Each session moves whole or stays." The user flagged it ("doesn't show WHAT is moved"). The change line "Prepared links follow the move" is also slop. | `a-home/sessions.tsx:341-345` | `wrapup_archive_description`, `wrapup_archive_links_follow` | ConfirmDialog with a From → To file table (fold-out) | delete description; `{n} sessions → {dest} · {size}` ▸ file list |
| S11 | 6 | Trash-unusable confirm: "To the OS Trash only. Each item is re-verified first." | `a-home/sessions.tsx:358` | `wrapup_trash_offer_description` | Show the file list fold-out | delete |
| S12 | 2 | Empty-state actions are all `outline sm`, while Targets' empty-state primary actions are `default sm` (`targets.tsx:641,644`). | `a-home/sessions.tsx:318-333` | `sessions_clear_search`, `sessions_show_all` | STD-BTN | — |

---

## 5. Session detail (with the Target box)

| # | C | Finding | file:line | Message key | Standard | Proposed copy |
|---|---|---|---|---|---|---|
| SD1 | 9 | The Detail/Review view switch is a `ToggleGroup` in the actions slot. Targets uses a custom `Segmented` in the meta slot, and Import uses `Tabs`. | `a-home/session.tsx:146-152` | `session_detail`, `step_review` | STD-VIEW (Tabs) | — |
| SD2 | 2 | The header has Create Project (`outline sm`, "Create Project") beside Add to Project ▾ (`outline sm`). Elsewhere the same action is "New Project…" or "Create Project…". | `a-home/session.tsx:141-142`; `a-home/parts.tsx:160-167` | `newproject_create`, `newproject_open`, `session_create_project_menu` | One label | `New Project…` |
| SD3 | 5 | CreateProjectButton tooltip: "Prefilled with this Target and rig" / "Confirm a Target to prefill it". | `a-home/parts.tsx:164` | `session_prefilled`, `session_confirm_to_prefill` | delete | — |
| SD4 | 6,7 | **User item:** "the result agrees should be removed from the session target page; just show where the sources come from and which one wins". EvidenceList has a Result column ("Agrees"/"Conflicts") and is a raw `<table>`. | `components/app/data.tsx:73-108` (Result `84,89`); used at `a-home/session.tsx:218,225` | `evidence_column_result`, `evidence_agrees`, `evidence_conflicts` | DataTable: Source · Value, with a ✓ "Used" mark on the winning row | `Used` |
| SD5 | 5,4 | Pointing mismatch: a warning Pill plus a NoteMarker holding the angle. | `a-home/session.tsx:210-211` | `session_pointing_mismatch`, `indexing_pointing_from_centre` | StatusBadge with the angle inline | `Pointing {angle} off` |
| SD6 | 8 | The confirmation note line (`targetNote`) and the Refusal appear under the Target controls, so the box grows. | `a-home/session.tsx:220`; `a-home/parts.tsx:233` | `session_target_value` | STD-NOTE; the header pill already shows the new Target | — |
| SD7 | 1 | TargetSelect is a plain `Select` over every Target with no search. A combobox exists. | `a-home/parts.tsx:184-212` | `session_choose_a_target` | `components/ui/combobox.tsx` | `Choose Target` |
| SD8 | 5,6 | **User item:** "remove the mouseover on Projects; what does candidate mean". Each Project row has a "Candidate" info pill plus a NoteMarker "Why {name} considers it". | `a-home/session.tsx:251-252` | `status_candidate`, `session_why_candidate`, `session_reason` | Delete the NoteMarker. Show the run status instead: "In run {name}" or "Not in a run". | `Not in a run` (replaces `Candidate`) |
| SD9 | 7,1 | The Projects and Runs boxes are hand-rolled `<ul>` lists with no headers or sorting. | `a-home/session.tsx:243-255,307-330` | — | STD-TABLE (one table: Project · Run · Step) | — |
| SD10 | 7 | The Frames table's Exposure, Availability and SHA-256 columns have no `sortValue`. The file and copies cells have path tooltips. | `a-home/session.tsx:335-353` | `session_column_exposure`, `session_column_availability`, `session_column_sha` | STD-TABLE; show the path as a column or in a fold-out | — |
| SD11 | 5 | Headers box: every value carries a ① NoteMarker "Source of X → Header OBJECT". | `a-home/session.tsx:371-375` (used `379-394`) | `session_source_of`, `session_header_source`, `session_typed_at_import` | DataTable Keyword · Value · Source, or a plain key/value list with FITS keyword labels | `OBJECT`, `DATE-OBS`… as labels |
| SD12 | 2 | Frames box "Review" is `outline sm` with an Eye icon. That duplicates the Review tab in the header. | `a-home/session.tsx:286-289` | `verb_review` | Remove it (the Tab covers it) | — |
| SD13 | 9 | A raw calibration session renders as a Notice-only page with an Open Calibration primary button. | `a-home/session.tsx:69-104` | `session_open_calibration` | STD-PAGE redirect to the Calibration detail [`related` to part B] | — |

---

## 6. Import (sheet)

| # | C | Finding | file:line | Message key | Standard | Proposed copy |
|---|---|---|---|---|---|---|
| I1 | 3,9 | Import is a 50rem right-hand Sheet. Other sheets are 30, 38 and 96 rem/vw wide. | `a-home/import.tsx:123-127` | — | STD-SHEET (Dialog) | — |
| I2 | 1 | `Part` is a page-local section heading that duplicates `Box`/`Section`. | `a-home/import.tsx:161-173` | — | `Box` | — |
| I3 | 1,8 | The source pickers (devices and saved sources) are hand-made selectable lists: a raw `<button>` per name plus a row `onClick`. Selection appends a "Selected" pill to the row, so the row content shifts. | `a-home/import.tsx:327-403,277-283,364,400,416` | `import_selected` | A `Select`/combobox "Source" with grouped items (Devices, Saved, Choose folder…), or a `RadioGroup` | `Source` |
| I4 | 5 | A layout pill plus a NoteMarker "How {name} was recognised". | `a-home/import.tsx:350-351` | `import_how_recognised`, `import_layout` | delete the NoteMarker | — |
| I5 | 5 | Saved-source title: "Last import {date}". | `a-home/import.tsx:393` | `import_last_import`, `import_never_imported` | A column/value, not a tooltip | `Last {date}` |
| I6 | 2 | "Choose folder…" is `outline xs` on the source tab and `outline sm` on the folder tab. | `a-home/import.tsx:409,914` | `import_choose_folder` | STD-BTN | — |
| I7 | 6,9 | A "Prototype controls" button inside the production flow. | `a-home/import.tsx:447-449` | `import_prototype_controls` | Behind a dev flag | delete |
| I8 | 4,5 | A Fallback pill with the tooltip "No value for {tokens}: its fallback is used". | `a-home/import.tsx:498-500` | `import_fallback_used`, `import_fallback` | Show the token inline | `No {token}` |
| I9 | 5 | A naming NoteMarker per destination. | `a-home/import.tsx:570` | `import_naming_of` | Show the template preview inline | — |
| I10 | 4 | The destination shows three pills (Writable · {size} free · needs {size}). | `a-home/import.tsx:586-591` | `import_writable`, `import_free`, `import_needs` | Plain text; one StatusBadge on a problem | `{free} free · needs {size}` |
| I11 | 5 | Held rows: "Why it is held" NoteMarkers. | `a-home/import.tsx:625,669` | `import_why_held`, `import_until_settled` | delete | `Still writing` |
| I12 | 5,6 | Skipped: NoteMarkers "SHA-256 of a library frame" and "holds different bytes; nothing is overwritten". The other-files pill has a path-list tooltip. | `a-home/import.tsx:696,717,722` | `import_match_sha`, `import_name_taken_detail` | Use a fold-out list (the existing toggle) for detail | delete |
| I13 | 4 | Clickable pills: "Library frames" (`onClick`), and route pills "Calibration → stack" / "Calibration library" (`onClick`). | `a-home/import.tsx:733-743,841-853` | `import_library_frames`, `import_route_stack`, `import_route_masters` | `Button variant="link"` | `Open in Calibration` |
| I14 | 1,6 | Copy or Move is a RadioGroup with a NoteMarker per option ("verified by SHA-256; the source stays", "…then the source goes to the OS Trash"). | `a-home/import.tsx:757-774` | `import_copy_detail`, `import_move_detail` | Segmented `ToggleGroup` with two items; no ① | `Copy` · `Move` |
| I15 | 5,6 | Library-folder tab: HelpTip "Indexed where it is: nothing in it is copied, moved or renamed, and no naming template applies." | `a-home/import.tsx:912` | `import_index_help`, `import_index_help_label` | delete | — |
| I16 | 8 | Footer: the Refusal text replaces the count line, and the start button label length changes with the mode. [INFERENCE: minor shift] | `a-home/import.tsx:236-255` | `import_cant_import` | Keep the button label fixed, `Import {n}` | — |

---

## 7. Targets: My targets, Browse, Planned

| # | C | Finding | file:line | Message key | Standard | Proposed copy |
|---|---|---|---|---|---|---|
| T1 | 1,7 | **The whole table is hand-rolled.** It has its own `<table>`, its own sort buttons, its own keyboard handling and its own row click. It bypasses `DataTable` and wraps nothing shared. The Planned view disables sorting on every column. | `e-targets-plan-settings/targets.tsx:912-986` (sort `933-937`; `sortable && !planned` at `925`) | — | STD-TABLE (DataTable with `groups` for mosaic panels and `stickyFirstColumn`) | — |
| T2 | 1,9 | The view switch is a page-local `Segmented` radiogroup, placed in PageHeader's `meta` slot (meant for status badges). | `e-targets-plan-settings/targets.tsx:178-196,687-704` | `targets_view`, `project_search_my_targets`, `targets_browse_catalogues`, `targets_view_planned` | STD-VIEW (Tabs) | `My targets` · `Browse` · `Planned` |
| T3 | 1,4 | Catalogue and preset toggles are page-local `CHIP` buttons styled as pills. Saved presets are split-chips with a ⋯. **User item:** "presets fill up a lot of space → custom presets dropdown". | `e-targets-plan-settings/targets.tsx:170-173,789-882` | `targets_catalogues`, `targets_presets` | STD-FILTER: `Catalogues ▾` and `Presets ▾` DropdownMenus (checkbox items; saved presets in a group with Rename/Delete in a submenu) | `Presets ▾` |
| T4 | 5 | Built-in preset tooltips repeat their definitions. | `e-targets-plan-settings/targets.tsx:810`; definitions in en-GB | `targets_preset_best_definition` ("Img time above zero, a broadband filter ok tonight; longest first."), `…_narrowband_definition`, `…_emission_definition`, `…_galaxies_definition`, `…_planetary_definition`, `…_mosaic_definition`, `…_fits_definition` | delete | — |
| T5 | 6,9 | **User items:** "'Good tonight for' needs a different name", "should allow multiple selections". It is a single-select dropdown chip, and the active band becomes a separate pill-in-popover chip plus ×. | `e-targets-plan-settings/targets.tsx:764-781,820-841` | `targets_good_for`, `targets_good_for_menu`, `targets_good_for_heading`, `targets_good_chip` | `Bands ▾` DropdownMenu with checkbox items. Moon limits live in the existing `Moon limits` popover. | `Bands ▾` · item `Ha · Moon ≥60° · ≤80% lit` |
| T6 | 6 | **User item:** "we use both lunar distance and lunar phase, right?" Yes: per band a minimum separation and a maximum illumination (`moon-limits.tsx:120-125`). The chip text "≤ 80%" names neither. | `e-targets-plan-settings/moon-limits.tsx:104-127`; `targets.tsx:771` | `targets_good_chip`, `tonight_limit`, `tonight_limit_illumination_header` ("Lit ≤") | — | `Moon ≥{sep}° away · ≤{ill}% lit` |
| T7 | 5,6 | **User item:** "remove the tooltip on filters". A HelpTip sits on the Filters column header ("Each filter tonight under its Moon limits. Dashed: marginal. Struck: poor."), and every band chip has a reason tooltip. | `targets.tsx:443,947`; `parts.tsx:201-208` | `targets_filters_help`, `targets_about_column` | delete both | — |
| T8 | 9 | **User item:** "poor filters should be red, not gray". `GRADE_TONE.poor` is `"muted"`, struck through and unfilled. | `e-targets-plan-settings/parts.tsx:184-191` | — | `poor: "danger"`; keep the shape cue (struck through) for colour-blind users | — |
| T9 | 5 | **User item:** "remove the tooltip for Fit, Type, Coordinates". Here: a Type cell `title`, designation `title` (aliases), the 0h zero-reason title, the Moon cell title, the goals pill title, the ProjectBadge title "Project {name}". | `targets.tsx:404,436,466,503,527`; `parts.tsx:278` | `plan_moon_up_best`, `plan_moon_down_best`, `target_project_badge`, `tonight_zero_*` | delete. Put the zero reason inline as a word (already rendered at `437`). | — |
| T10 | 6 | Zero-reason sentences (tooltip and screen-reader text). | en-GB | `tonight_zero_short` ("Altitude: above {altitude}° for under {minutes} min of the darkness still ahead"), `tonight_zero_darkness`, `tonight_zero_low`, `tonight_zero_moon` ("Moon: too bright or too close while it is up") | — | `Too short` · `No darkness` · `Too low` · `Moon` |
| T11 | 9,6 | **User item:** "what does the star do in My targets? I see them with and without". The ★ column shows in My targets, where non-starred rows are open-Project subjects. | `e-targets-plan-settings/targets.tsx:477-496` | `targets_star_named`, `targets_unstar_named`, `targets_star` ("Add ★") | Star = "In My targets". Show it in Browse/search only. In My targets, mark Project subjects with the Project badge, and use a "Remove from My targets" row-menu item. | `Add to My targets` / `Remove from My targets` |
| T12 | 1 | The ⋯ RowActions is a fourth copy (icon-xs, no width, drops headings). | `e-targets-plan-settings/targets.tsx:222-241,446` | `targets_more_for` ("More for {name}") vs `location_more_actions` | STD-ROW | `Actions for {name}` |
| T13 | 1,9 | **User items:** "reset date to today", "next/previous week", "'clear' on the agenda doesn't do anything". The native `<input type="date">` drops an empty value (`event.target.value && pick(…)`), so the picker's own **Clear** is a no-op. "Tonight" appears only after moving, which shifts the header. There is no week jump and nights before tonight are blocked (`min`). | `e-targets-plan-settings/targets.tsx:198-219` (`208`, `212-216`) | `targets_night_previous`, `targets_night_next`, `target_tonight` | Shared `NightPicker`: «‹ date › Today», always rendered (disabled on tonight), ±7 d on Shift/«», empty = tonight | `Today` |
| T14 | 2 | Save preset is `outline` at default size, while every other header action is `sm`. It carries a disabled-reason tooltip. | `e-targets-plan-settings/targets.tsx:722-726` | `targets_save_preset`, `targets_clear_search_first` | STD-BTN; move it into `Presets ▾` ("Save current…") | `Save current…` |
| T15 | 4 | The Project scope is a link Pill plus an icon ×. | `e-targets-plan-settings/targets.tsx:741-751` | `targets_clear_project` | A filter chip (`components/app/data.tsx:223` FilterChips) | `{project}` × |
| T16 | 5,6 | SIMBAD status: a NoteMarker "Fixture data (prototype)". | `e-targets-plan-settings/targets.tsx:900-903` | `targets_simbad_fixture`, `targets_simbad_searched` | delete | — |
| T17 | 8 | The SIMBAD status line, the ActionError and the good-filter chip insert above the table or into the toolbar as state changes. | `e-targets-plan-settings/targets.tsx:764-781,884-912` | `targets_simbad_searching` | STD-NOTE; reserve the status in the table caption or footer | — |
| T18 | 9 | A page-local count and sort footer (`<p>` under the table) duplicates the status bar and the header sort indicator. | `e-targets-plan-settings/targets.tsx:988-998` | `plan_targets_count`, `targets_sort_ascending` | STD-PAGE (count in the PageHeader meta CountBadge) | — |
| T19 | 9 | The page skips `PageBody` and uses two different sticky toolbars: Planned (`data-planned-header`) and the others, each with px-5. | `e-targets-plan-settings/targets.tsx:729-883` | — | STD-PAGE + `TableToolbar` | — |
| T20 | 5 | A NoteMarker for the night's method (night, time zone, criteria, "Low-precision Sun and Moon, 10-min grid"). | `e-targets-plan-settings/targets.tsx:668-676` | `tonight_method`, `tonight_method_value` | delete, or move to Settings › Sites | — |
| T21 | 4 | Goals cell: Met / "N short" pills with a custom h-4 size override (`className="h-4 px-1.5 text-[0.625rem]"`), plus a title listing the gaps. | `e-targets-plan-settings/targets.tsx:520-531` | `status_met`, `plan_goals_short` | StatusBadge; no override sizes | — |
| T22 | 6 | **User item (Planned):** "reminders need more flexible windows; 30 min is way too short". The lead times are fixed at 15, 30, 60 and 120 min, default 30. | `store/actions/planning.ts:58-59`; `e-targets-plan-settings/planned-tools.tsx:93-104` | `plan_lead_option`, `plan_reminder_lead` | A `NumberField` (Base UI `number-field`, installed) with a unit Select (min/h); default 2 h [INFERENCE: value is the user's call] | `{n} before` |
| T23 | 6,9 | A prototype "jump to next reminder" flask button in the Planned toolbar, and the next-reminder text has a tooltip. | `e-targets-plan-settings/planned-tools.tsx:105-110` | `plan_proto_next_reminder` ("Prototype: jump to the next reminder") | Behind a dev flag; no title | delete |
| T24 | 1 | The Moon limits popover is a raw `<table>`. | `e-targets-plan-settings/moon-limits.tsx:97-126` | `tonight_filter`, `tonight_limit_separation_header` | Acceptable as a form grid; at least use `components/ui/table.tsx` | — |
| T25 | 6 | Name-field validation sentences. | en-GB | `targets_name_taken` ("{label}: "{name}" is already used. Choose another name."), `targets_name_empty`, `targets_result_gone` ("This result is no longer available. Search again.") | — | `Name taken` · `Name required` · `Result gone` |

---

## 8. Target detail and its finder side panel

| # | C | Finding | file:line | Message key | Standard | Proposed copy |
|---|---|---|---|---|---|---|
| TD1 | 3,9 | **User item:** "options to add to plan or add to project/new project directly from the target page in the side menu". The finder list has right-click only (no ⋯), and its menu lacks Add to Project. | `e-targets-plan-settings/target.tsx:88-97,128-160` | `targets_add_to_plan`, `newproject_open` | STD-ROW on the finder rows: Open · Add to Plan · Add to Project ▸ · New Project… · ★ | — |
| TD2 | 2 | Header actions use default size (Add to Plan `outline`, Add to Project ▾ `outline`, New Project… `default`). Every other page uses `sm`. The favourite toggle is a `ghost xs` button in the meta slot. | `e-targets-plan-settings/target.tsx:279-306` | `targets_add_to_plan`, `session_add_to_project`, `newproject_open`, `targets_favourite`, `targets_star` | STD-BTN (`sm`); the star toggles via `Toggle` beside the title | — |
| TD3 | 6 | The Add to Project dropdown's group label reuses `project_back_to_projects` ("Open Projects"), which is the wrong string. | `e-targets-plan-settings/target.tsx:297` | `project_back_to_projects` | — | `Open Projects` → `Add to` |
| TD4 | 5 | Tooltips: Add to Plan carries the night date; disabled Add to Project carries "In every open Project". | `e-targets-plan-settings/target.tsx:287,291` | `target_in_every_project` | Put the night in the label; disabled-reason via PreviewCard | `Add to plan · {night}` |
| TD5 | 5,6 | **User item:** "remove the tooltip for Fit, Type, Coordinates". A Fit HelpTip ("Major axis against the shorter side of each rig's field."), a Type source NoteMarker and a Coordinates source NoteMarker. | `e-targets-plan-settings/target.tsx:381,340,366` | `target_fit_help`, `target_about_fit`, `target_source_catalogue`, `target_source_resolver`, `target_source_user` | delete all three; show Source as a key/value row if needed | `Source · Catalogue` |
| TD6 | 5 | The tonight box: zero-reason titles on Best/Img time, plus a method NoteMarker (duplicate of T20). | `e-targets-plan-settings/target.tsx:221-222,241-249` | `tonight_method_value` | delete | — |
| TD7 | 7,1 | Three hand-rolled `<table>`s with headers but no sorting: Fit per rig, library facts and sessions. | `e-targets-plan-settings/target.tsx:387-421,493-523,529-560` | `targets_fit_per_rig`, `target_library_caption`, `target_sessions_caption` | STD-TABLE | — |
| TD8 | 9 | **User item:** "for the library on a target we don't need a separate Offline per channel". The library table has an Offline column. | `e-targets-plan-settings/target.tsx:506-508,519` | `status_offline` | Drop the column; one muted line under the table when any frames are offline | `{h} offline` |
| TD9 | 6 | The sessions table borrows keys from other areas: Frames header uses `calibration_frames`, the empty state uses `run_cal_no_sessions`. | `e-targets-plan-settings/target.tsx:526,540` | `calibration_frames`, `run_cal_no_sessions` | — | use `sessions_column_frames`, `sessions_empty_all` |
| TD10 | 4 | Projects box: a status pill, mosaic pills, panel and Met pills (custom h-4 sizes), and three link styles in one box (`text-link` vs plain hover-underline). | `e-targets-plan-settings/target.tsx:438-480` | `target_mosaic_panels`, `target_panel`, `status_met` | StatusBadge + DataTable; one link style | — |
| TD11 | 9 | The finder "Targets table" back-link sits in a footer. The PageHeader eyebrow already links back. | `e-targets-plan-settings/target.tsx:164-167` | `target_table_link` | delete | — |

---

## 9. Activity

| # | C | Finding | file:line | Message key | Standard | Proposed copy |
|---|---|---|---|---|---|---|
| A1 | 2,1 | **User item:** "the activity menu has buttons that are completely inconsistent… an 'open' header, with show items and open project/open session buttons that are not aligned; use the standardised menu". Each row has a `ghost sm` "Show items" plus an `outline sm` "Open {Project/Session/run/page}" whose label length varies, under a column headed "Open". | `e-targets-plan-settings/activity.tsx:165-178,285-287` | `activity_show_items`, `activity_hide_items`, `activity_open_destination`, `verb_open` | STD-ROW: ⋯ with "Open {destination}" and "Show items"; the row click opens the destination; the column header becomes sr-only "Actions" | `Actions` |
| A2 | 7,1 | The history is a raw `<table>` with no sorting and no `DataTable`. | `e-targets-plan-settings/activity.tsx:271-296` | `activity_when`, `activity_outcome`, `activity_what` | STD-TABLE | — |
| A3 | 8 | "Show items" inserts a full `OperationPanel` row under the entry, pushing the rest down. | `e-targets-plan-settings/activity.tsx:181-187` | — | Open the items in a PreviewCard or a Dialog, or use a detail pane (`ListDetail`) | — |
| A4 | 2 | Filter counts are plain muted text here, but `CountBadge` on Sessions. | `e-targets-plan-settings/activity.tsx:241-246` vs `a-home/sessions.tsx:264-268` | — | STD-FILTER | — |
| A5 | 6 | Empty filters read badly: "No not saved", "No saved". Destination names "run" and "page" are lowercase, which makes "Open run" and "Open page". | en-GB; `activity.tsx:47-48,79` | `activity_empty_not_saved`, `activity_empty_saved`, `activity_destination_run`, `activity_destination_page` | — | `Nothing unsaved` · `Nothing saved` · `Run` · `Open` |
| A6 | 5 | The detail line `title` repeats its text, which is useful only in compact mode where it truncates. | `e-targets-plan-settings/activity.tsx:129` | — | Title only when truncated (compact) | — |
| A7 | 2 | The in-progress OperationPanel uses `outline sm` text controls, while Home and the status bar use icons (SH11). | `components/app/operation-panel.tsx:68-90` | `verb_pause`, `verb_cancel` | STD-BTN | — |
| A8 | 9 | The page header has no actions and uses `Section` (h2 with a caption slot), while Home and target detail use `Box`. | `e-targets-plan-settings/activity.tsx:224-247` | `activity_in_progress`, `activity_history` | STD-PAGE: Tabs "In progress / History" or one table with a status filter | — |

---

## 10. User-named items for these surfaces → findings

| User item (round 9, verbatim gist) | Findings |
|---|---|
| Location not selectable in Tonight; Tonight → Planning, mini plan, date options | H3, T13 |
| Reminders: more flexible windows, 30 min too short | T22 |
| Star in My targets; "Good tonight for" name and multi-select; lunar distance vs phase | T11, T5, T6 |
| Presets → custom presets dropdown | T3, T14 |
| Reset date to today, next/previous week; "clear" on the agenda does nothing | T13 |
| Poor filters red, not gray | T8 |
| Add to plan / project / new project from the target side menu | TD1 |
| Remove tooltip on filters; on Fit, Type, Coordinates | T7, T9, TD5 |
| Library on a target: no separate Offline | TD8 |
| Side menu disappears when narrow; clearer highlight | SH1, SH2 |
| Recents: separate heading, Projects only, move below Library, submenus | SH3 |
| Session select pushes the table (twice with can't archive); full bar vs mouseover table | S1, S2 |
| Only Archive on selection | S3 |
| Session target page: remove "result agrees", show sources and the winner | SD4 |
| Remove mouseover on Projects; what does "candidate" mean | SD8 |
| Sessions menu differs from Targets; named menus and dropdowns | S4, T12, STD-ROW |
| Home reproduces a lot | H1 |
| Activity buttons inconsistent | A1 |
| Getting started donut in the menu | SH4 |
| Rewrite the walk | SH17 |
| Scan every page for microcopy; tooltips only when they add value | X9 and every C=5/6 row |
| No custom components; standard buttons | X1–X5, STD-BTN, T1–T3, I2–I3, H10, H17 |

Not in these surfaces (left to parts B and C): Start run "Unreviewed / Not in a run" buttons, the Projects page layout, Wrap up, Calibration, Review, Settings.

## 11. Dependency classification (for the dispatcher)

- `blocks`: STD-ROW (a `DataTable` `rowActions` prop), STD-PILL (the Pill API change) and a shared `NightPicker`/site picker are inputs the consumers need first. Every row tagged C=1 that adopts them waits on them. Each is one owned unit in `components/app/` or `e-targets-plan-settings/parts.tsx`.
- `blocks`: a new `components/ui/hover-card.tsx` (Base UI `preview-card`, already installed) blocks S2, X2 and TD4.
- `related`: H1 depends on R9HomeDebate's dashboard decision. SD13 and X6 overlap part B (Calibration). STD-SHEET overlaps part B (New Project, Start run sheets).
- `discovered-from`: X4 (move `SelectField` out of `features/t3`) and X3 (the `FilterChips` name clash) are refactors this audit found.
