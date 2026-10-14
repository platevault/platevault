# Harness v5: information architecture for the amended contract

Status: plan (2026-10-09). The v5 harness is the clickable mockup the user reviews before the production frontend gets built. It keeps everything harness v4 settled about the look (`HARNESS-V4.md`: tokens, desktop shell, source list, toolbar, status bar, density, native menus, frame plate, glyph-plus-word status). It replaces v4's structure with the amended workflow contract.

Integrated (2026-10-09): the five screen slices are merged on `ui-harness-v5`, no screen or sheet is a placeholder, and the helpers two slices built twice are promoted into the foundation (see § Promoted at integration).

Contract sources: `specs/063-clean-rebuild-contract/workflow-decisions.md` (D-W1 to D-W75) and the amended specs 064 to 072 on main. Where this file and the contract disagree, the contract wins. "Run" is the UI word for the domain's View (D-W3).

## Mental model

```
Library (Sessions, Calibration, Storage, Targets)
   └─ candidate sessions ─┐   derived: the session's Target is a Project subject AND its rig is one of the Project's rigs (D-W33, D-W37)
Project (campaign)        │
   ├─ subjects (Targets or mosaics; a mosaic subject has explicit panels)   D-W9, D-W38, D-W73
   ├─ rigs (optical trains; one or more)                                    D-W37
   ├─ goals per subject and channel (in project / captured)                 D-W29, D-W36, D-W44, D-W66
   ├─ processing runs (one subject, one rig)                                D-W8, D-W50
   │     steps: Select → Review → Calibrate → Prepare → Results → Done       D-W3
   ├─ run groups (one panel run per mosaic panel; one shared setup)          D-W38, D-W41, D-W73
   ├─ Trash (trashed runs: Restore or Empty Trash)                          D-W72, D-W75
   └─ Wrap up stage (Clean up runs, Trash, Archive, Done; each step approved separately)  D-W26, D-W43, D-W70, D-W74, P-WRAP1
```

There is no Inbox (D-W24, D-W33). Sessions are assigned only to runs (D-W34). Planning works on Targets, independently of Projects (D-W16).

## Window

The minimum window is 1280 × 640 (owner, Q35, 2026-10-14). Widths below 1280 are not a supported layout. The app frame and the setup frame keep that size (`--window-min-w`, `--window-min-h` in `tokens/comp.json`), so below it the page scrolls instead of reflowing. Walks and table measurements use 1440 and 1280; they used 1024 and 768 before. Two viewport queries still answer to the window below the minimum: the toolbar search folds to an icon under 1200 px, and the sidebar becomes a drawer under 768 px (a 1280 window at 200 % zoom).

## Source list (sidebar)

| Group | Item | Route | Notes |
|---|---|---|---|
| Primary | **Home** | `/` | Start page: the control-panel dashboard (D-W39). |
| Primary | **Projects** | `/projects` | Projects list. Show done filter (D-W48). |
| Primary | **Targets** | `/targets` | My targets is the default (D-W17, D-W60). |
| Library | Sessions | `/sessions` | Library sessions; filters Needs a Target / Not in any Project / Trashed (D-W25, D-W43). |
| Library | Calibration | `/calibration` | Calibration library: masters only; raw sessions by their calibration process (P-CAL3). |
| Toolbar | **Import** | sheet over `/import` | Lightroom-style workflow entry (D-W11, D-W24). It is also on Home and in the toolbar. |
| Footer | Activity, Settings | `/activity`, `/settings/*` | Settings: Equipment (rigs with filter lists, D-W31), Goal templates (D-W30, D-W47), Naming (D-W20), Locations, Sites, Applications, Target lookup, Appearance. |

Round 2 (2026-10-09): the source list is navigation only. The Project outline is gone; an optional Recent group lists up to three recently opened Projects without children, and Sessions and Projects carry count badges. The Project page owns its runs and stages; a run's six steps live in its step bar.

Round 5 (2026-10-10): Plan and Storage leave the source list and the go-keys (G L, G O). `/plan` redirects to the Targets page's Planned view (`/targets?view=planned`, P-PLAN2), and `/plan?project=<id>` to `/targets?project=<id>`; `/storage` redirects to Settings › Locations (P-STO2).

## Screens

| # | Screen | Route | Contract | Must show |
|---|---|---|---|---|
| S1 | Home | `/` | D-W39, D-W35, D-W48, PRJ-FR-17/18/19 | **Header actions:** Plan tonight, New Project, Import. No issues strip (round 5: the toolbar Issues button and the status-bar counters carry them). **Boxes:** Projects (goals in project / captured, stage, Next; Done Projects behind Show done; clicking a row opens the Project, its row menu holds Next, Start a run and Plan); Sessions (needs a Target / not in a Project / unreviewed / ready to add to a run, each with one action; an Unreviewed session is reviewed in a sheet over Home, `?review=<sessionId>`, library marks only); Tonight (darkness, the Moon, and the best windows for open-Project subjects and ★ favourites, or the no-site state); Goals (unmet goals of open Projects per subject and channel); Work (running operations with Pause, Resume or Retry, and Cancel). **Next rule order (D-W35):** review N new frames, then a blocked run, then Wrap up once every run is Complete, then Plan tonight, then Start a processing run; a Done Project has no Next. |
| S2 | Projects list | `/projects` | D-W1, D-W35, D-W48 | One row per Project: subjects, rigs, goal progress, open runs, stage, Next; right click opens the row's menu. Done Projects behind Show done. New Project. |
| S3 | Project | `/projects/$id` | D-W9, D-W29, D-W33, D-W36, D-W37, D-W38, D-W16, D-W59, P-WRAP1 | **Header:** the stage strip Open → Runs → Wrap up → Done (or Archived); Runs and Wrap up switch the page between the Project's work and its Wrap up stage (`?stage=wrap-up`, S9). A Done Project offers Reopen, which moves no file. The toolbar Next is the one primary action. **Sections in order:** Runs (each run with its step rail, run groups, Start a run, and Trash with its count); Candidates (derived; filters All / Unreviewed / Not in a run; a mosaic session's panel or placement flag; Review frames opens `?candidates=unreviewed`; start a run from a selection); Goals per subject and channel ("Ha 6h10 in project · 9h15 captured · goal 10h", structured kinds and channel chips, exposure-mismatch and missing-calibration warnings per rig); Subjects (Target or mosaic; New mosaic and a mosaic subject open the mosaic editor, `?mosaic=new\|<subjectId>`) and Rigs; Planning (tonight at the planning site, best window and goal gaps per subject, Planner); Archived sessions (Restore while Open). |
| S4 | New Project | dialog | D-W30, D-W47, D-W9, D-W37 | A FormDialog: name and notes, subjects (search across My targets, the catalogues and SIMBAD, D-W17), rigs, and goals, added per channel or From template (HOO / SHO / LRGB / OSC broadband / OSC dual-band and the user's own), whose values are copied in and stay editable; a template's subject conditions (panel balance, window) go with it. A session prefills its Target and rig; a Target prefills itself as a subject. Mosaic subjects are added on the Project page. |
| S5 | Run | `/projects/$id/runs/$runId/$step` | D-W3, D-W50, D-W49, D-W54, D-W5, D-W55, D-W51, D-W4, D-W26, D-W72, D1, C2 | A StepPage (§5.4 of R9-COMPOSITION-PLAN.md) on the run flow. **Header:** subject and rig (fixed, D-W50) and the run's status; the Run ▾ menu holds Edit run…, Open in {app}, Reopen run… and Move to Trash…. **Steps:** Select → Calibrate → Prepare → Results. There is no Review step (review happens at session intake, S12, P-REV2) and no Done step. Select (subject candidates on the run's rig, all preselected, D-W49; refresh flags); Calibrate (readiness line, Review matches, automatic policy, a master found in Results is offered once; each assigned master is a MasterPreview to the Calibration library: its name as the link in a read-only step, an Open master icon beside the master picker in an editable one); Prepare (profile, mode, layout preview `<output>/<Project>/<Run>/`, `(rev N)`, Partial lists, Open re-verifies; Run view is a Symlinks · Copies choice, free space is the volume's); Results (discovered in the recorded Results folder, attach, accept or reject; a product is never a run input, and only a per-channel kind carries a channel). Results' Proceed is **Finish run**, confirmed with what finishing keeps or releases (Products, then Run view). A finished run is read-only, Results reads "Finished {date}" with no Proceed, and Reopen run… brings it back. Clean up of prepared entries moved to the Project's Wrap up (S9). **Refusals** name their blockers: Move to Trash is refused while an operation is Running; a trashed run is read-only with Restore in its notice (D-W72). |
| S6 | Review (frame review) | Session intake step `review` (S12) | D-W13, D-W14, D-W22, D-W40, D-W42, D-W53, D-W54, D-W15, P-REV2 | The review workspace is the body of a session's intake Review step (`/sessions/$id?step=review`); runs no longer review. The frame table spans the full width at the top; T cycles three heights. Preview with zoom, pan and F for fullscreen. Plots across the session in the bottom strip; histogram and star cutouts. Three views of the same list: table, filmstrip and grid (G). Filters: All / Picked / Rejected / Unreviewed. Hotkeys: ←/→ or J/K, P, X, U, Z, F, C, ⌘A, and Shift+P / Shift+X with auto-advance. Two-level quality: Library P/X/U, plus a secondary "Reject for this Project only". Display-name template. Finish review needs 0 Unreviewed, then opens the next session in the review queue, or this session's detail when the queue is empty. |
| S7 | Run group (mosaic) | `/projects/$id/groups/$groupId/$step` | D-W38, D-W41, D-W73, D-W75 | Panels with per-panel status. Shared setup (profile, input mode, calibration policy). Review all with a Panel column and a Panel filter. Calibration readiness per panel. Prepare all: `<Mosaic>/Panel N/`, `<Mosaic> Results/Panel N/` and `Assembled/`; group outcome; Open only when every panel is verified. A trashed panel is listed as Trashed and its frames leave the counts (D-W75). |
| S8 | Project Trash | `/projects/$id/trash` | D-W72, D-W75 | Trashed runs with the stage they were at. Restore brings a run back exactly as it was. Empty Trash (all from the header, or one run from its row menu) previews what goes (the run record, prepared folders, and the Results folder only when ticked) and what stays, then runs one "trash" operation. |
| S9 | Wrap up | `/projects/$id?stage=wrap-up` | P-WRAP1, P-ARC1, D-W26, D-W43, D-W46, D-W69, D-W70, D-W74, C3 | The Project's Wrap up tab once every run is finished; it replaces the Done / Archive sheet. A StepPage with three steps in strict order: Clean up runs → Trash → Archive. Each is a selection step: its DataTable preselects the recommended rows, a row expands to its files, and rows that cannot move say why in their Status cell. Proceed confirms the selection with its file groups and starts the step's work; nothing selected records the step Skipped, and nothing left records it Finished. Clean up runs takes each finished run's prepared entries; Trash takes rejected frames, intermediates and duplicate copies; Archive moves member sessions to the chosen archive location (the Default unless the Project picks another; sessions another Project uses stay). Archive's Proceed is **Close project…**: the Project closes when its transfer succeeds, or at once with nothing to move. A settled step shows its record, and an earlier one reopens from the footer until Close. A closed Project's Wrap up is read-only; Reopen brings the Project back and its Archived sessions show on the Project page until they are restored. |
| S10 | Targets | `/targets`, `/targets/$id` | D-W17, D-W18, D-W19, D-W23, D-W60, D-W61, D-W62 | My targets (the ★ favourites plus open-Project subjects, with a badge). Browse needs a catalogue or a preset. Unified search (My targets, the library, the bundled catalogues and SIMBAD) with Add to targets. Columns: ★, Designation, Type, Max alt, Lunar, Img time, Suitable filters (one badge per grade tonight, good then marginal, each listing its filters; poor filters hidden, Q36), Opposition, Sessions, Captured; Fit with a rig selected; Source while searching. Moon in the toolbar. Rig selector: none / each rig / this Project's rigs (`?project=`, the default there). Filters: good tonight per band with its Moon limits editable in place; a Target qualifies when any picked band suits, longest Moon-clear time of the picked bands first (Q16); built-in presets (Best tonight, Narrowband (Moon up), Emission nebulae Ha, Galaxies dark sky, Planetary nebulae OIII; Mosaic candidates and Fits nicely only with a rig; narrowband presets hidden without a narrowband filter) and saved presets (rename, delete). The view lives in the URL. **Target detail:** tonight (values, the full per-filter grade strip, and a one-row night timeline with its filter sub-rows), identity, Fit on every rig, the Projects that use it with their goal lines, captured time per channel with its sessions; Add to Plan, Add to Project (previewed first) or New Project. |
| S11 | Plan | `/plan` | D-W16, D-W63, PLAN-FR-02/09/10/11 | Tonight at the planning site on one compact night timeline (twilight and Moon bands, altitude curve, minimum-altitude line, window blocks), with darkness, the Moon, the site and its time zone, and a site picker when there are several. The list: the Plan list (add from the search, remove with × or right click), else My targets while it is empty; Show all lists My targets with it. Each row: best window, Img time and Moon separation; Per filter expands one sub-row per filter, graded good tonight, with its Moon-clear windows; Moon limits edit the constraints behind the grades. A mosaic uses its centre and lists its panels. `?project=` scopes the page to that Project's subjects with their unmet goals. With no site: "Add site". |
| S12 | Sessions | `/sessions`, `/sessions/$id` | D-W24, D-W25, D-W43, D-W59, P-REV2, C10, C14, C15 | Library light sessions only (raw calibration frames go to a calibration process, S14). Filters with counts: All, Needs a Target, Not in any Project, Trashed. Row actions: Choose Target, Review and Add to Project (also adds the rig, with a visible note); `?import=<operation>` highlights what an Import filled. **Session intake** (`/sessions/$id?step=`): a StepPage Target → Rig → Review. Target holds the picker, preselected from the session's own association or its pointing, with its evidence as a sortable table (OBJECT is a label, never evidence); Proceed confirms it, or files an Unclassified session's frames under it (File into Target). Rig is the rig select with its header evidence; a FILTER value the rig does not list links to Equipment. Both list the corrections intake recorded. Review is S6. A settled step stays editable, with Confirm Target or Confirm rig in its toolbar. A session joins a Project or run only once Ready. **Session detail:** Target and rig, candidate Projects, runs, frames and headers, Add to Project or Create Project prefilled. |
| S13 | Import | `/import?step=source\|preview` | D-W11, D-W12, D-W24, D-W20, P-IMP2 | A StepPage. **Source:** a removable device (its capture layout recognised), a saved source (Import new) or Choose folder, which can be saved as a source. **Preview:** each file's destination: lights become sessions filed under their Target, raw calibration frames go to a calibration process awaiting Stack, masters go to the Calibration library. Holds: Unclassified, still being written. Skips: SHA-256 duplicates. Copy or Move (Move verifies, then sends the source to the OS Trash). Writability and free space. Its Proceed is Import…, with every file in the confirm, unavailable while the preview has a blocking row. The import runs as an operation (a vanished source pauses it as Interrupted until Retry), then opens the first imported session the review queue holds, or Sessions with the imported sessions marked. An existing library folder is added in Settings › Locations (index in place). `?location=` presets the source to a location's folder. |
| S14 | Calibration library | `/calibration` | CAL, P-CAL2, P-CAL3, C2, C9 | Header: Import masters… (files a folder's masters straight into storage) and the Calibration ▾ menu with Calibration settings… (Keep raw calibration frames, off by default, and the master age limit in days). Three views: **Masters**, one table grouped by kind, filtered by search, Kind, Camera and Age. Darks, bias and dark flats older than the age limit carry the **Old · {n} d** badge; flats never age. A master row opens its details panel (kind, camera, optical train, filter, exposure, gain · offset, temperature, binning, frames, created, age, source, stored path, SHA-256, Used by, state) with **Replace…** and **Hide**. Replace… re-points the unfinished runs to the newer master; finished runs keep the old one, which leaves the list as replaced. Hide (P-CAL2) is refused while a run uses or offers the master; a hidden master is never matched. "Used by" is a count ("2 runs") opening a scrollable popover of the runs; the row never grows. **Processes**: each raw session's calibration process with its steps (Stack → Detect → Import → Register → Raws), each step's state and reason, a tool picker, Stack / Retry / Detect now / Cancel / Trash raws, and a failure as a terse Refusal. **Hidden**: hidden masters, replaced masters and dismissed master offers, each with Show (Restore) unless replaced. `?view=`, `?process=` highlights a process, `?master=` opens a master's details, `?filter=dismissed` opens Hidden. |
| S15 | Storage | `/storage` | P-STO2 | Gone (round 5): `/storage` redirects to Settings › Locations, which shows each location's disk use (footprint, its volume's used and free) and the Duplicates review; transfers are Activity entries (the Transfers filter). |
| S16 | Settings | `/settings/*` | D-W31, D-W30, D-W47, D-W20, P-ARC1, P-STO2 | Every section is a SettingsPage. **General:** Appearance (the theme: mode first, Light / Dark / Match system, then that mode's themes as swatches; the language, with pt-BR marked machine-generated; Restore defaults; no density setting), Help (single-key shortcuts, the Shortcuts table, Tips, Restart walk and Restart setup). **Library:** Locations (one DataTable: Name, Role, State when it needs attention, Indexed, Frames, Size, Disk free; Rescan inline, Make default, Edit, Locate or remap, Choose folder again, Retire and Remove in the row menu; a Default archive select; the Duplicates review at `?duplicates=review`: groups of byte-identical copies with the copy to keep preselected, through the OS Trash), Equipment (records in five sortable tables, Cameras, Telescopes, Reducers, Filters and Rigs, plus Unknown filters when a session's FILTER matches no filter; a rig is camera, telescope, optional reducer and its filters, chosen from those records; Remove is refused while a record is in use), Naming (one folder template per frame type with a live preview, and the Tokens table with its When missing choice), Sites (a Default site select and the Sites table, the editor with a map), Target lookup (online lookup, provider, a Test). **Projects:** Goal templates (Built-in and Yours tables: goals, panel balance and window; the shared goal editor). **Processing:** Applications (Run view and the profiles table; Add application). **Prototype:** About (version, licence, data, catalog, clock). The Calibration settings moved to the Calibration library (S14). |
| S17 | Activity | `/activity` | P-STO2 | A ListPage with one table of what runs now and what was recorded (operations, refusals, failed and refused writes, saves, delivered reminders): What, Outcome and When sortable, Detail. Running, paused and interrupted operations sit in an In progress group above the History, with their panel open. The Entries facet filters by kind, including Transfers (imports, archive moves, OS Trash moves and clean-ups). A row's ⋯ menu (and right-click) opens the surface that owns it; its disclosure shows the full detail, a refusal's reasons and an operation's items. |

**Not built yet, or not as written (2026-10-14, `ui-harness-v5` d337de87; spec amendments PR #1804):**

- S10, S16, S14: at the 1280 minimum some DataTables still scroll inside their frame, even with truncation: Targets › My targets (en-GB 145 px, pt-BR 133) and its Browse view, Settings › Locations (134 / 214; pt-BR also 54 at 1440) and pt-BR Calibration Masters (1). Their column priorities wait on the owner (astro-plan-v5h3j).
- Store actions: `dismissMaster` still exists beside `hideMaster`, marked deprecated and unused. W4 removes it (astro-plan-o1wsa). The domain names `dismissBlockers`, `dismissals` and `CalibrationMaster.dismissedAt` keep the old word for the Hide state.
- The § Round 2 and Fix pass notes below record the harness as it was then: their Done / Archive sheet, a run's Done and Review steps, and the density setting are gone (S5, S9, S16).

Every screen is reachable from the source list or from the screen that owns it. Every Next and every refusal names where it leads.

## Seed (demo data)

A single demo seed shows every state the review needs:

- **Project "Cygnus HOO 2026" (open):** subjects NGC 7000 and a mosaic "IC 5070 mosaic" with 3 panels; rigs RedCat+ASI2600MM (mono with Ha, OIII and SII) and Esprit+ASI533MC (OSC); HOO goals; one exposure-mismatch warning on the OSC rig. Its runs:
  - one Complete run with Cleanup available;
  - one run at Review with unreviewed frames;
  - one run blocked at Calibrate;
  - a run group of 3 panels where panel 2 is Partial and panel 3 is in the Trash;
  - one trashed run in the Project Trash.
- **Project "M 31 LRGB" (Done):** archive offers pending (rejected, intermediate and duplicate copies).
- **Project "Heart and Soul" (open):** no runs yet, with candidates waiting.
- **Library:** sessions that need a Target, sessions in no Project, a Trashed session, an offline volume, and a running scan.
- **Targets:** favourites, a southern Target with no window tonight, and a default site. A "no site" toggle in the simulation panel.

## Fan-out

The foundation is owned by one agent: domain types, seed, derive functions, routes, the navigation and outline, and placeholders that read "built next". Then five screen slices run in parallel, each in its own worktree from the foundation head:

| Slice | Screens |
|---|---|
| A | S1 Home, S12 Sessions, S13 Import |
| B | S2 Projects list, S3 Project, S4 New Project, S8 Trash, S9 Done / Archive |
| C | S5 Run (Select, Calibrate, Prepare, Results, Done) and S7 Run group |
| D | S6 Review (frame review) |
| E | S10 Targets, S11 Plan, S16 Settings (Equipment, Goal templates, Naming), with S14, S15 and S17 carried over from v4 |

## Out of scope for v5

- Real IPC: the prototype keeps its simulated store.
- Final copy polish.
- Light-theme measurement, unless it is cheap.

## UI conventions

The UI conventions live in two places that agree (user, 2026-10-14; D-W91 in `specs/063-clean-rebuild-contract`, PR #1804):

- **Design system:** documented as a DESIGN.md in the standard DESIGN.md design-system format, generated from `HIGH-LEVEL-DESIGN.md`. It replaces the legacy root `DESIGN.md` when the final frontend lands. Until that DESIGN.md exists, the source is `HIGH-LEVEL-DESIGN.md` §6 to §10 (layout patterns, tokens, component inventory, state conventions and copy conventions), with `R9-COMPOSITION-PLAN.md` §2b, §6.1 and §8.6. The legacy root `DESIGN.md` is not a source.
- **Behavior:** the UI conventions section of the 063 spec (FR-025 to FR-032): one primary action per view, named menus, row actions in `⋯` and the context menu, a batch bar that replaces the toolbar, sortable tables, dialogs instead of side sheets, inert pills, confirmation only for irreversible actions, microcopy, keyboard access, and issues on the rows they affect with no issues hub.

This document keeps the screens, routes and foundation contract. Where it disagrees with either source, the source wins.

## Foundation contract

Read this before editing. The foundation owns every shared file below; a screen agent edits only its own slice files and messages the integration owner for a shared change. Route patterns live in `src/routes.tsx`. Run the app on port 5505 with `pnpm exec vite --host 127.0.0.1 --port 5505 --strictPort` and load the demo through Prototype › Load demo library.

### Domain types (`src/domain/types.ts`)

- **Project**: `subjects: Subject[]`, where a Subject is `{ targetId, mosaic: { name, centre, panels: MosaicPanel[] } | null }` and a panel is `{ n, ra, dec, rotationDeg }`. Also `rigIds`, `goals: Goal[]` (`subjectId`, `panelId`, `channel: GoalChannel`, `integrationS`, `frameCount`, `qualityBar`), `archiveLocationId`, `wrapUp`, `state: "open" | "done"`, `doneAt`, `archive: { at, sessionIds } | null`, and `rejections` (the Project-only reject). Round 2 removed `goalTemplateId` (see § Round 2 foundation).
- **Run** (the domain's View): `projectId`, `subjectId`, `panelId`, `groupId`, `rigId` (fixed), `setup: RunSetup | null` (profile, input mode, calibration policy; null for a panel run), `revisions: MembershipRevision[]`, `draft`, `calibration` (assignment overrides), `masterOffers`, `outputParent`, `completion: "open" | "complete"`, `completedAt`, `stageBeforeComplete`, and `trashedAt`. `RunStep` is `select | review | calibrate | prepare | results | done`.
- **MembershipContent**: `sessions` (each with a reason), `included`, `excluded`, `rejected` (removed in Review, D-W54) and `unresolved`. Round 9 removed `productInputs`: a product is never a run input.
- **RunGroup**: `runIds` (panel runs, in panel order), the shared `setup` and `outputParent`.
- **Preparation**: `runId`, `groupId`, `prepRevision` (`(rev N)`), `folderPath`, `resultsPath`, `state`, `preparedAssetIds`, `preparedCalibrationCount`, `blocked` and `unverified`. **ResultRecord**: `runId` or `groupId`, `intermediate`, `discovered`, `fromPrepRevision`, `association`, `lineage`, `acceptance` (`candidate | accepted | rejected`) and `trashed`.
- **Two-level quality**: `Asset.quality` (library P/X/U) plus `Project.rejections`. Asset `trashed: { at, episodeId } | null`. **TrashEpisode**: `kind` (rejected-frames, intermediates, duplicate-copies, empty-trash, import-move, run-cleanup) and `items`, each trashed or refused with a reason.
- **Rigs**: `OpticalTrain.filters: RigFilter[]`, each `{ name, matches, bands }`. `Camera.kind` is `"mono" | "osc"`. Also `GoalTemplate`, `ImportSource`, `NamingFrameType`/`NamingToken`, `settings.naming`, `settings.lastOutputParent`, `Volume.network`, `Disk.apps` and `faults.noSite`.
- **Removed**: View, ViewOrigin, ChecklistItem, SelectionCriteria, FilterDef and `catalog.filters`, `Location.managed` (filing), and the onboarding tour and checklist flags.

Related modules: `templates.ts` holds the built-in goal templates (D-W47) and naming tokens, defaults, validation and resolution (D-W20), plus `namingValues(facts)` and `headerNamingValues(header, frameType)`, the one way token values are formatted. `labels.ts` holds `RUN_STEPS`, `STEP_NAME`, `MODE_NAME`, `RESULT_KIND_NAME` and `BANDS`. `planning.ts` adds `tonightAt(site, nowMs)` (Moon, darkness) and `bestWindowTonight`, and exports its sky primitives `sunPosition`, `moonPosition`, `altitudeDeg`, `julianDay`, `norm360` and `SAMPLE_MIN`, the night grid `skyNight(site, night, darkness)`, and `clearStretches` (the Moon-clear `Stretch`es that `filterSuitability` and Targets read). `sky.ts` holds the bundled catalogues (`BUNDLED_CATALOGUE`, `CATALOGUES`), the `SIMBAD_FIXTURE`, `entryKeys`, `bundledEntryFor`, `resolverEntryFor`, `matchesQuery` and `targetFromEntry`; indexing, Target lookup, New Project and Targets all read them. `disk.ts` adds `trashRefusal(disk, path)`, the one OS Trash refusal check. `calibration.ts` holds `calibrationPlan(catalog, disk, run, policy, content)` and `readinessLine`. `membership.ts` holds the pure membership transforms plus `runSummary`. `library.ts` holds the library totals, availability and coverage. `src/lib/format.ts` adds `fileName(path)`.

### Derive functions (`src/domain/derive.ts`)

- **Associations and rigs**: `sessionTargetId`, `sessionNamingValues` (a session's naming token values), `sessionRigId`, `liveAssetIds`, `isTrashedSession`, `liveLightSessions`, `rigName`, `rigCameraKind`, `rigBands`, `bandUnion`, `rigFieldOfView`, `rigFilterFor`, `unknownFilterValues` and `goalChannel`.
- **Subjects and panels**: `subjectTarget`, `subjectName`, `findSubject`, `findPanel`, `panelLabel`, `subjectCentre`, and `panelForSession` (with its flags).
- **Projects**: `projectStatus`, `projectRuns`, `projectTrash`, `projectGroups`, `candidateSubject`, `projectCandidates`, `projectMemberSessionIds`, `goalProgress` (with the `line` ref "Ha 6h10 in project · 9h15 captured · goal 10h" and `amounts`, the line without its channel), `markDoneBlockers`, `projectNext` (the D-W35 rule order; "Review N new frames" opens the Project's candidate review) and `projectStage`. Calibration coverage is not a goal: it shows only in a run's Calibrate step (round 9 removed `projectWarnings` from goal rows).
- **Runs**: `latestRevision`, `workingContent`, `savedContent`, `runSetup`, `runCandidates`, `runRefresh` (new candidates, "no longer matches subject"), `runPreparations`, `runResults`, `runOperations`, `runPipeline` (steps, gates, current, next, blocker, calibration), `trashRefusals`, `completeRefusals`, `groupCandidates`, `groupPipeline`, the link builders `runStepLink`, `groupStepLink` and `projectLink`, and their string forms `runHref` and `groupHref`. `GateState` and `GATE_WORD` hold the v4 gate vocabulary.
- **Home and targets**: `sessionsNeedingWork`, `planningSite`, `targetStatus`, `runningWork`, `myTargets`, `targetFit`, `fitsNicely`, `isMosaicCandidate`, `frameQuality` and `formatHours`.

### Store actions (`src/store/actions/`)

Every action writes through `commit()`. A contract refusal returns `{ ok: false, reason: "refused", reasons }` and records it in Activity.

- **`projects.ts`**: `createProject` (goal values typed or prefilled from a template), `updateProjectDetails`, `addSubject`, `changeSubjectTarget` (Edit; refused while a run uses the subject), `removeSubject`, `addRig`, `removeRig`, `setGoals`, `applyGoalTemplate`, `addSessionToProject` (returns the added-rig note), `markProjectDone`, `reopenProject`, `setProjectRejection`, `prefillFromSession`, `goalTemplate` and `goalsFromTemplate`. A closed (Done or Archived) Project is read-only: every Project and run write but Reopen is refused with `closedRefusal` (`shared.ts`), and its Review opens read-only.
- **`runs.ts`**: `startRun` (a mosaic subject gets a run group), `editRun` (patch one run in one commit, with `step`, `record` and `also` options), `updateRunDraft`, `addRunSessions`, `removeRunSessions`, `excludeRunFrames`, `restoreRunFrames`, `saveRun`, `discardRunDraft`, `renameRun`, `setRunSetup`, `setGroupSetup`, `completeRun`, `reopenRun` (returns its step), `trashRun`, `restoreRun` and `emptyTrash`.
- **`library.ts`**: `markFrames` (P/X/U; with a run, X rejects in its draft), `rejectForProjectOnly`, `confirmTarget`, `confirmRig`, `setFavourite` and `addTarget` (a catalogue or resolver entry as a Target; reuses a Target with one of its names).
- **`settings.ts`**: `setRigFilters`, `addFilterToRig`, `renameRig`, `saveGoalTemplate`, `deleteGoalTemplate`, `setNamingTemplate`, `locateExecutable`, `checkExecutable`, `setLaunchArgs`, `observeExecutable` and `updateApp`.
- **`trash.ts`**: `moveToOsTrash` (records a TrashEpisode, enforces D-W57, re-checks every item with `trashRefusal`, lists per-item outcomes, and with `pruneFolders` removes emptied folders; the "run-cleanup" kind runs as the "cleanup" operation, every other kind as "trash"), `preparedEntryItems` and `resultItems`.
- **`src/store/simulation.ts`** (Prototype panel): adds `insertAsiairCard`, `asiairCardInserted` and `settleGrowingFiles`; the card's volume and files are `ASIAIR_CARD` and `asiairCardFiles` in `domain/seed.ts`.

Slice-owned (not provided): calibration decisions and master offers, Prepare, Open, Results discovery, attach and accept (slice C; Clean up calls `moveToOsTrash`); Import (A); Archive and the Done-sheet offer lists (B). Register their operation handlers in your slice definition. A slice handler replaces a foundation handler of the same kind.

### Promoted at integration

| Helper | From | To |
|---|---|---|
| OS Trash refusal check | B `custodyRefusal`, C `cleanupRefusal`, the trash engine's private check | `trashRefusal` in `domain/disk.ts` |
| Clean up engine | C "cleanup" handler | `moveToOsTrash` kind "run-cleanup" (`store/actions/trash.ts`) |
| Run patch | C private `editRun` | exported `editRun` in `store/actions/runs.ts` |
| Run and group hrefs | C, D, t3, operations, palette and runs.ts string builders | `runHref`, `groupHref` in `domain/derive.ts` |
| Project state badge | B `ProjectStateBadge` | `StatusBadge kind="project"` (`components/app/status.tsx`) |
| Run state label | C `RunStatusLabel`, ad-hoc words in B and C | `StatusBadge kind="run"` |
| Six-step rail | B `StepRail` | `StepRail` in `app/run-ui.tsx` |
| Naming token values | A import, B archive paths, D review names, E Settings preview | `namingValues`, `headerNamingValues` (templates), `sessionNamingValues` (derive) |
| Catalogues and SIMBAD | foundation `SKY_OBJECTS`, B `SIMBAD_ONLY`, E `catalogues.ts` | `domain/sky.ts` |
| Target writer | B `addTargetRecord`, E `addToMyTargets` body, indexing's builder | `targetFromEntry` (sky) and `addTarget` (library actions) |
| Sun, Moon, altitude | E copies in `sky-tonight.ts` | exports of `domain/planning.ts` |
| ASIAIR card | A `insertCard`, `settleGrowingFiles` | `store/simulation.ts` and Prototype › Outside PlateVault › Insert ASIAIR card |
| Path file name | four private `fileName` copies | `fileName` in `lib/format.ts` |

Kept in their slice, with one reader each: A `planImport`; B `doneOffers`, `archivePlan`, `keptCopy` and `rigChannels`; C run layouts and `cleanupReview`; D's review shortcuts sheet (Review has its own keys and the auto-advance setting, and the app sheet is a static list; the review sheet links to it).

### Slices, sheets and contributions

- `src/store/slices/{a,b,c,d,e}.ts`: one state module per slice. Slice d holds the frame UI and the "measure" handler; slice e holds the setup and Target-lookup state.
- Sheets: call `openSheet({ kind: "import" | "new-project" | "start-run", … })` (`src/app/ui-state.ts`). The host components mount through each slice's `shell.tsx` (`ShellContribution.Overlay`), and palette commands come from `useCommands`. Wrap up and the mosaic editor are Project pages, not sheets.
- Frame review is slice D's `src/features/v5/d-review/` (`ReviewStep`, `GroupReviewStep`, `CandidateReview`). The v4 pieces it was built on (frame-preview, raster, measure, measurement-plot, csv, import-dialog) moved out of `src/features/t3/` in P4, and its last file, `fields.tsx`, was deleted once `components/app/fields.tsx` replaced it.
- v4 code removed by this cutover can be read at commit `6ef221b1`: `src/features/t2` (Sessions, Targets, Projects, Activity), `src/features/t4` (calibration library, prepare, calibration area), `src/features/t5` (Results, Cleanup, Storage, transfers, plans) and `src/features/t3` (workspace, sessions, refresh, Views pages).

### Slice files

| Slice | Files under `src/features/v5/` |
|---|---|
| A | `a-home/home.tsx` (S1), `a-home/sessions.tsx` and `a-home/session.tsx` (S12), `a-home/session-model.ts` (the session rows and filter buckets Home and Sessions share), `a-home/import.tsx` (S13 sheet and `/import`), `a-home/import-model.ts` (the import plan) and `a-home/import-run.ts` (the "import" operation handler), `a-home/parts.tsx` (Add to Project, Create Project, Confirm Target / Confirm rig), `a-home/shell.tsx` |
| B | `b-projects/projects.tsx` (S2), `b-projects/project.tsx` (S3) with `b-projects/project-sections.tsx` (its sections) and `b-projects/goals.tsx` (structured goal editing), `b-projects/mosaic-editor.tsx` (S3 `?mosaic=`), `b-projects/wrap-up.tsx` (S9), `b-projects/new-project.tsx` (S4), `b-projects/start-run.tsx`, `b-projects/trash.tsx` (S8), `b-projects/model.ts` (Wrap up trash offers, archive and restore plans, goal gaps), `b-projects/actions.ts` (the "archive" operation, Archive and Restore), `b-projects/subject-actions.ts` (subject and mosaic writes), `b-projects/parts.tsx`, `b-projects/shell.tsx` |
| C | `c-runs/run.tsx` (S5; it renders slice D's `ReviewStep` for `review`), `c-runs/group.tsx` (S7; it renders `GroupReviewStep`), `c-runs/shell.tsx` |
| D | `d-review/review.tsx` (S6: `ReviewStep`, `GroupReviewStep`), `d-review/shell.tsx` |
| E | E1: `e-targets-plan-settings/targets.tsx` and `e-targets-plan-settings/target.tsx` (S10) with `e-targets-plan-settings/targets-model.ts` (rows, Fit, built-in presets) and `e-targets-plan-settings/targets-presets.ts` (saved presets), `e-targets-plan-settings/plan.tsx` (S11) with `e-targets-plan-settings/plan-add.tsx` (Add to the Plan list), and their shared `e-targets-plan-settings/good-tonight.ts` (filter grades), `e-targets-plan-settings/sky-tonight.ts` (the night grid), `e-targets-plan-settings/night-timeline.tsx`, `e-targets-plan-settings/moon-limits.tsx`, `e-targets-plan-settings/parts.tsx` and `e-targets-plan-settings/dialogs.tsx`. E2: `e-targets-plan-settings/settings-equipment.tsx`, `e-targets-plan-settings/settings-goal-templates.tsx` and `e-targets-plan-settings/settings-naming.tsx` (S16), `e-targets-plan-settings/calibration.tsx` (S14), `e-targets-plan-settings/storage.tsx` (S15), `e-targets-plan-settings/activity.tsx` (S17). `e-targets-plan-settings/shell.tsx` |

The v4 Settings sections (Appearance, Locations, Sites, Target lookup, Applications, About) and onboarding stay at their v4 paths under `src/features/t1` and `src/features/t4`.

Foundation evidence (2026-10-09, demo seed, private headless Chrome at 1280×800, `/Users/sjors/tmp/pv-v5-foundation/smoke.mjs`): all 31 routes have document scroll 800/800 and the run produced 0 console errors. Observed results:

- The NGC 7000 HOO run reads "Next: Clean up run".
- The OSC run is blocked at Calibrate.
- Panel 2 reads "Partial 24/54".
- Cygnus shows "Next: Review 124 new frames".
- M 31 shows "Next: Open Done / Archive".
- The status bar shows "Cold-1 captures offline" and "Index NAS captures 17%".

Integrated evidence (2026-10-09, demo seed, private headless Chrome, `/Users/sjors/tmp/pv-v5-integrated/smoke.mjs`): 34 routes at 1440×900, 1280×800 and 1024×768 each have document scroll equal to the viewport, none reads "built next", and the run produced 0 console errors. Screenshots at 1280 are in `design/harness-v5-shots/integrated/`. The journey observed:

- Home › Cygnus "Review 124 new frames" opens the Project's candidate review (`?candidates=unreviewed`, 373 frames, 124 Unreviewed).
- X on the current frame reads Rejected 1 · Unreviewed 123.
- NGC 7000 OIII deep: Select "Saved r1"; Calibrate "dark ✓ · flat ✓ · bias ✓"; Prepare with SETI Astro Suite Pro and Copy prepares 80 inputs (Prepared); Results finds the simulated outputs and refuses Accept of a file still being written; Complete; Clean up moves 81 prepared entries (4.3 GB) to the OS Trash and Done reads "Cleaned up".
- Project Mark Done names 3 runs not Complete; Complete on each, then Mark Done reads Done.
- The Done / Archive sheet offers Archive 7 sessions (11.5 GB), 2 intermediates and Empty Trash (2 runs); Archive leaves the Project Archived.

### Round 2 foundation (2026-10-09)

Work order: `design/HARNESS-V5-FEEDBACK-R1.md` (Copy rules, Shell and navigation, Domain and seed). Slices build their screens on these; use them instead of local copies.

**Primitives (`src/components/app/`)**

| Primitive | File | Use |
|---|---|---|
| `ClearableInput` | `clearable-input.tsx` | Every filter or search field: × clears, Escape clears; `search` adds the magnifier and `data-page-search` (`/`). `TableToolbar` uses it. |
| `HelpTip` | `tips.tsx` | ⓘ with a tooltip for the rare rule that needs it. Default to none. |
| `NoteMarker` | `tips.tsx` | ① beside a measured value; `rows: [{ label, value }]` for method, basis and time. No inline paragraphs. |
| `Refusal`, `refusalFrom(result, action, links?)` | `refusal.tsx` | `<Action> blocked · <reason>` with a disclosure of blocker chips (linked). `refusalFrom` turns a refused `CommitResult` into props. |
| `Pill`, `CountBadge` | `pill.tsx` | Tone pills (`link` or `onClick` makes them interactive) for issues, channels, filters, blockers; count badges capped at 99+ with an sr-only label. |
| `Box` | `box.tsx` | Hairline group panel with a small heading, optional actions, `flush` for tables. A Box in a Box loses its frame. |
| `MenuEntry`, `MenuEntries`, `RowContextMenu`, `ContextMenuArea` + `menuKey(id)` | `row-menu.tsx` | Right-click on every list. `DataTable`'s `contextMenu` may now return `MenuEntry[]`. |

**Shell (`src/app/`)**: `issues-hub.tsx` (`IssuesButton` in the toolbar, `IssuePill` and `issueText` for Home's pills), `history.tsx` (`HistoryControl`: Back and Forward at the toolbar's leading edge), `appearance.tsx` (`ThemePicker` with live swatches, `ThemeSwatch`, `LanguagePicker`; Settings › Appearance mounts them), `themes.ts` (theme registry), `active-route.ts` (`useActiveRoute`, moved from the deleted `outline.tsx`), `ui-state.ts` (`rememberProject`, `recentProjectIds`). The toolbar's Next shows only the gate glyph and word beside it; the reason is in its tooltip. The status bar is § Round 2b.

**Hooks**: `useIssues()` and `useNavCounts()` (`src/store/issues.ts`); `useT()` and `t()` (`src/app/preferences.ts`); `usePreferences()` now has `theme` (a theme id or `"system"`), `resolvedTheme`, `scheme` and `locale`. Status-bar hooks (`useStatusIssues`, `useStatusSelection`, `useNotices`) are in § Round 2b.

**Themes**: PlateVault Dark (default) and Light, Gruvbox Dark and Light, Nord, Dracula, Solarized Dark and Light, Catppuccin Mocha and Latte, Tokyo Night, One Dark, Rosé Pine. `html[data-theme]` selects one (`.dark` marks dark schemes for the `dark:` variant). Token values are generated: `pnpm themes` (`scripts/themes.mjs`) maps each published palette onto the token set, raises text and tone tokens to 4.5:1 on every surface (tone text on its 16% tint, destructive-button text on a 30% tint; UI glyphs 3:1), keeps hover fills 0.05 OKLCH lightness from their surface, and writes `src/themes.css` and `design/themes-contrast.md`. Never edit `src/themes.css` by hand. Pills use `bg-<tone>/12` (hover `/16`) so they stay inside the checked range.

**Language**: `src/lib/i18n.ts` (`LOCALES`: en-GB source, pt-BR machine-generated; `translate`), table `src/lib/messages/pt-BR.ts`. The key is the en-GB string with `{name}` placeholders. The shell, nav, toolbar, Issues hub, StatusBadge words and gate words are translated; screens route only shell-shared words through `t()` and add keys to the table when they do.

**Domain (`src/domain/`)**

- `types.ts`: `Goal.channel: GoalChannel` (`Band | "OSC" | "Dual-band"`, never free text); `QualityBar` adds `usable-max-fwhm`; `GoalTemplateValue` holds `qualityBar`; `Project.goalTemplateId` is removed ("Applied in" is gone), `Project.archiveLocationId` (P-ARC1) and `Project.wrapUp` (P-WRAP1 step records) are added; `MasterOffer.state` `"declined"` is now `"dismissed"` (P-CAL2); `Volume.removable`; `AppSettings.defaultArchiveLocationId` and `moonConstraints`; operation kind `duplicate-scan`. P-CAL1's `integrated` origin, `masterIntegration` and `integrate-master` are replaced by P-CAL3 (§ Round 2b).
- `labels.ts`: `GOAL_CHANNELS`, `isGoalChannel`, `qualityBarLabel`, `DEFAULT_MOON_CONSTRAINTS`, `WRAP_UP_STEPS`, `WRAP_UP_LABEL`.
- `derive.ts`: `goalChannel` returns a `GoalChannel | null`; `projectNext` offers "Wrap up" when every run is Complete and no Next for a Done Project; `projectStage` reads "Wrap up"; new `archiveLocations`, `defaultArchiveLocation`, `archiveDestination` (P-ARC1), `projectWrapUp`, `projectStageStrip` (Open → Runs → Wrap up → Done / Archived), `defaultSite`, `planList`, `goodTonight(world, target, night, bands?)`, `projectGoalSet`.
- `planning.ts`: `filterSuitability` (per-band Moon constraints over one night's samples); each band also returns its Moon-clear `stretches` (`{ start, end }`, § Round 2b).
- `calibration-library.ts`: `masterUsage` (Used by), `dismissBlockers` (what refuses Hide), `dismissals` (the Calibration library's Hidden view: hidden and replaced masters and dismissed offers). The calibration process is `calibration-process.ts` (§ Round 2b).
- `storage.ts`: `preparationFootprint`, `runFootprint` (for a run's Done step and Wrap up), `locationDiskUse` (Settings › Locations), `liveCopies`, `keptCopy` (the copy a frame keeps: library storage over a capture card, then the oldest), `duplicateCopies` (what a duplicate scan records), `duplicateFindings(world)` (the latest succeeded scan narrowed to copies still live: `{ scan, groups, copies, bytes }`), `keepChoice`, `runningDuplicateScan`.
- `devices.ts`: `removableDevices`, `recognizeLayout` (ASIAIR, N.I.N.A., SharpCap, Ekos, SGP, Voyager by folder structure), `isRemovablePath`, `DEVICE_LAYOUT_LABEL`. It replaces `ASIAIR_CARD`.
- `issues.ts`: `deriveIssues` (groups Sessions, Locations, Work, Runs, Calibration, Drift; each issue one action), `worstSeverity`, `isDismissable` and `issueFingerprint` (P-ISS1: kind, subject, count and bytes), `blockedProjectCount`.
- `sites.ts`: removing the default site makes the first remaining site the default.

**Store actions**: `restoreMasterOffer(runId, masterId)`, `hideMaster(masterId)`, `restoreMaster(masterId)` (`actions/calibration.ts`; `CalibrationMaster.dismissedAt` marks a hidden master, never matched; the calibration process actions are in § Round 2b); `startDuplicateScan()` (Scan again) and `cleanUpDuplicates(cleanUps)` (the Duplicates review's OS Trash move, Trash episode kind `duplicate-copies`) (`actions/storage.ts`); `addDuplicateScan(state)` (`store/operations.ts`: every index and import that settles succeeded or partial starts the `duplicate-scan` in the background unless one runs); `addToPlan`, `removeFromPlan` (`actions/planning.ts`); `setDefaultArchiveLocation`, `setMoonConstraint` (`actions/settings.ts`); `setProjectArchiveLocation`, `setWrapUpStep`, `goalsFromValues` (`actions/projects.ts`; `addSubject` copies the Project's goal set); `connectDevice`, `ejectDevice` (`store/simulation.ts`, replacing `insertAsiairCard`). The `duplicate-scan` handler is foundation-owned and survives a restart.

**Seed**: M 31 LRGB is open in Wrap up (Clean up done, Trash and Archive to do, archives to the NAS archive) with every goal kind; Archive and NAS archive are archive locations, Archive the Default; M 31's 120 s master dark offer is dismissed; an ASIAIR card (recognised) and a USB stick (generic) are connected; the Plan list holds NGC 7000 and M 33; Heart and Soul has a frame-count OIII goal. Calibration: § Round 2b.

**Left to the slices**: Home's pills (A, `IssuePill`), the Removable devices section of Import (A), the Project stage strip and Wrap up UI replacing the Done / Archive sheet (B), structured channel chips in goal editors (B, E2), Restore offer and the calibration process UI (E2, § Round 2b), Storage without footprints and with Scan for duplicates (E2), Plan list and good-tonight chips (E1).

Evidence (2026-10-09, demo seed, private headless Chrome, port 5530): `/Users/sjors/tmp/pv-v5-r2f/smoke.mjs routes` passes 34 routes at 1440×900, 1280×800 and 1024×768 with document scroll equal to the viewport, no "built next" and 0 console errors. Home renders in all 13 themes and pt-BR switches the shell; screenshots are in `design/harness-v5-shots/r2-foundation/`.

### Round 2b foundation: status bar and P-CAL3 (2026-10-09)

Work order: `design/HARNESS-V5-FEEDBACK-R1.md` § Round 1b (Status bar, P-CAL3). Units A, C and E2 build on this head.

**Status bar** (`src/app/status-bar.tsx`, the window's full bottom bar; `AppFrame` mounts `StatusBar`). Round 5 (P-SB3) replaced the issue pills, chips, "+N" chip overflow, inline notifications and the ruler that fitted them; plain text and glyphs only, no pill backgrounds:

- Left: locations online (links to Settings › Locations; "No locations" with none), then the selection: "3 selected" while a list reports a selection.
- Middle: running and paused work, newest first (two from 1440 px, one below; the rest under a plain "+N", accessible name "+N more running"), each as its title with a mini progress bar (an unknown size pulses) and Cancel (×) on hover or focus; cancelling moves focus to the next operation, else to the notifications trigger, else the first issue counter. "Idle" when nothing runs.
- Right: one counter per severity, ⛔ errors, ⚠ warnings and ℹ info, each its glyph and count, shown only when non-zero, accessible name "2 errors". Each opens a popout listing that severity's issues in hub order (`IssueRow`, with its action), so the counters sum to the Issues button's count. With no issues, a muted ✓ (accessible name "No issues") and nothing else. Then the bell with the unread count, opening the notification history (latest 12, each linked to its surface, plus Activity); opening it marks every notification read. The live region's words are fixed per notice id, so a language switch does not re-announce.
- Test hooks: `[data-status-locations]`, `[data-status-selection]`, `[data-status-work] [data-operation] [data-cancel]`, `[data-status-more=work]`, `[data-status-idle]`, `[data-status-issues=none|<total>]`, `[data-status-counter=danger|warning|info][data-count=n]`, `[data-status-popout=danger|warning|info] [data-issue]`, `[data-status-notice][data-unread]`.

**Status-bar hooks and helpers**

| API | File | Use |
|---|---|---|
| `useStatusSelection(count, total?)` | `src/app/status-selection.ts` | Report a list's selection while mounted; the bar reads "3 selected" (or "3 of 120 selected"). `DataTable` reports its controlled selection itself, so call it only for lists that are not a DataTable (filmstrip, grid). The latest non-zero report wins; unmounting clears it. |
| `useIssues()`, `dismissIssue(issue)`, `restoreIssue(issue)`, `restoreAllIssues()` | `src/store/issues.ts` | `{ issues, dismissed, worst }`: the issues not dismissed (hub order) and their worst severity, which every count, badge and tint reads, and the dismissed ones (P-ISS1). Dismissals are fingerprints in `PrototypeState.issuesDismissed` (persisted); one whose issue ends or changes is dropped, so the issue comes back. `run-blocked` and `calibration-review` cannot be dismissed. |
| `Issue.kind`, `Issue.about`, `Issue.link`, `Issue.bytes` | `src/domain/issues.ts` | `IssueKind`: needs-target, not-in-project, location-denied, location-offline, duplicates, work-failed, work-interrupted, calibration-review, run-blocked, master-offer, calibration-waiting, calibration-failed, drift. `duplicates` (warning, round 5) comes from `duplicateFindings(world)`: `count` is the extra copies still live (every copy beyond the one each frame keeps), `bytes` their bytes ("3 duplicate copies · 2.1 GB"), linking to `/settings/locations?duplicates=review`; a clean-up clears it as the copies leave. `about` is the one record's id (location, run, session, master, process), null for a count. `link` is where the one action leads. An issue carries no copy: `issueCopy(m, issue)` words it. |
| `useNotices()`, `noticeText(m, notice)`, `markNoticesRead(id?)` | `src/store/notifications.ts` | `{ notices, unread }`: the latest 12 Activity events as `Notice` (`title`, `outcome`, `done`, `detail`, `tone`, `href`, `at`), and those not yet seen (`PrototypeState.noticesRead`, persisted). `noticeText` words one: "<title> finished · 54 frames". |
| `IssueRow`, `SEVERITY_ICON`, `SEVERITY_TEXT` | `src/app/issues-hub.tsx` | One issue with its action and × (Dismiss; `[data-dismiss]`), shared by the hub and the status bar's severity popouts; the severity glyph and its text tint. The hub ends with "Dismissed (N)" (`[data-issues-dismissed]`), each row with Restore, plus Restore all (`[data-restore-all]`). |
| `pillClass(tone, interactive)` | `src/components/app/pill.tsx` | Pill classes for a control that renders its own element (a popover trigger). |
| `useMediaQuery(query)` | `src/lib/use-media-query.ts` | Shared by the shell and the status bar. |
| `addOperation(state, init)`; `OperationHandler.cancel`, `.href`, `.survivesRestart`; `SETTLED_WORD` | `src/store/operations.ts` | Start an operation inside a `commit` mutator or another step; kind-specific cancel bookkeeping; work that resumes by itself after a restart stays running. |
| `queueOsTrash(state, input)`; `MoveToOsTrash.calibrationProcessId` | `src/store/actions/trash.ts` | The OS Trash move as a state change; the episode settles a calibration process's Raws step. |

**P-CAL3: masters only**

- Runs are assigned masters only. `CalibrationInput` is `{ type: "master"; masterId }`; raw-set sources, `rawSetSource` and `CalSource.isMaster` are gone; candidates sort compatible first, then the nearest night.
- `types.ts`: `CalibrationProcess` (`kind`, `sessionId` (null for a master stacked elsewhere), `profileId`, `outputFolder`, `detected { path, sha256, ncombine }`, `storagePath`, `masterId`, `raws: "trashed" | "kept" | null`, `steps: Record<CalibrationStepId, { state, at, reason }>`, `operationId`), `CalibrationStepId` (`stack`, `detect`, `import`, `register`, `raws`), `CalibrationStepState` (`todo`, `running`, `done`, `failed`, `skipped`), `Catalog.calibrationProcesses`, `AppSettings.keepRawCalibration` (false), `CalibrationMaster.origin.kind` `library | generated | stacked | imported` (`sessionId` is the lineage to the raw session), `ProfileCapability.masterStacking`, operation kind `stack-master`, Trash episode kind `calibration-raws`, image and naming type `master-dark-flat`, `FrameHeader.ncombine` (NCOMBINE), naming tokens `train` and `offset`. `SCHEMA_VERSION` is 8.
- `calibration-process.ts`: `CALIBRATION_STEPS`, `CALIBRATION_STEP_LABEL`, `isRawCalibrationType`, `processIdFor(sessionId)`, `awaitingStackProcess`, `routeRawCalibration`, `rawFrameIds`, `processView` / `calibrationProcesses(catalog)` (`ProcessView`: `name`, `status` (`awaiting-stack | stacking | importing | trashing-raws | failed | done`), `current`, `failure { step, reason }`, `frames`, `master`; failed and awaiting first), `processName`, `processForSession`, `processForMaster`, `stackProfiles`, `calibrationStorage`, `stackOutputFolder` (`<output parent or calibration storage>/Stacking/<process>`), `stackRefusals`, `findStackedMaster(disk, folder, kind)`, `sessionMasterValues`, `masterStoragePath`.
- Structured storage (`templates.ts` `DEFAULT_NAMING`, relative to the Calibration location): flats `Flats/{train}/{filter}/{date}/`, darks `Darks/{camera}/{exposure}_g{gain}_o{offset}_{set_temp}/`, bias `Bias/{camera}/g{gain}_o{offset}/`, dark flats `Dark flats/{camera}/{exposure}_g{gain}_o{offset}_{set_temp}/`; the file is `Master<Kind>_<night>.<ext>`. Raw calibration frames wait under `Raw/Flats/{filter}/{date}/`, `Raw/Darks/{exposure}/{date}/` and `Raw/Bias/{date}/`. `headerNamingValues` reads `train` from TELESCOP.
- Routing: `readFiles` (indexing and Import) gives every new raw calibration session a process awaiting Stack. A master in a Calibration location is a library master; a master flat takes its rig from the header, and NCOMBINE is its frame count.
- Store actions (`actions/calibration.ts`), each a `CommitResult` (refused with reasons, "Stack blocked · …"):
  - `startStack(sessionId, profileId)` → `{ result, operationId }`: hands the raws to the profile, creates the output folder and starts the `stack-master` watch (indeterminate progress, cancelable). The watch survives a restart and detects the master by itself when the output folder changes; Detect, Import, Register and Raws then run in order. Cancel puts Stack back to todo ("Canceled").
  - `detectMasters(processId)`: look now; none there fails Detect with "Tool output not found".
  - `importMaster(processId)`: resume Import and Register after a failure (offline storage, "Name taken", "Copy did not verify" under the hash fault, "Write permission removed").
  - `discardRaws(processId)` / `keepRaws(processId)`: move the raws to the OS Trash (a `calibration-raws` episode) or keep them; Raws fails with "N frames kept · <reason>" when a frame is refused.
  - `importMasterFile(path)` → `{ result, processId }`: a master stacked elsewhere goes straight to structured storage (Stack and Detect skipped, Raws n/a).
  - `setKeepRawCalibration(keep)`: the Settings toggle "Keep raw calibration frames" (off by default).
- Simulation: `toolFinishedStacking(processId)` (`store/simulation.ts`) writes the WBPP-named master (IMAGETYP master, NCOMBINE) into the output folder; Prototype › Outside PlateVault shows "Tool finished stacking" for each stacking process.
- Issues: `calibration-waiting` ("{n} to stack", info, Stack → `/calibration`) and `calibration-failed` ("{name} failed", danger); a `stack-master` operation is not listed under Work.
- Seed: the Ha flat of 18 Sep awaits Stack; the 120 s darks of 8 Sep are mid-stack in PixInsight (`op_stack_dark120`); the 300 s darks finished with their raws in the OS Trash; the bias finished with its raws kept; the OIII flat of 26 Sep failed at Detect ("Tool output not found"). The library holds masters only, in structured storage: RedCat Ha and OIII flats (12 Sep), FRA400 LRGB flats, the ASI2600MM 300 s dark and bias, and the Esprit / ASI533MC darks (120 s, 300 s), bias and L-eXtreme flat; the Esprit run stays blocked at Calibrate for its missing 180 s dark.
- The Calibration library page (`features/v5/e-targets-plan-settings/calibration.tsx`) got the minimal cutover: the raw-set table became a "Raw sessions" process table with one action per row (Stack with the first set-up profile, Detect, Import, Keep raws, Trash raws). E2 owns the real UI.

**Left to the units**: E2: the Calibration library's process UI (profile picker, step strip, refusals), Import master (`importMasterFile`), the Settings toggle (`setKeepRawCalibration`), and Settings › Naming for `{train}`, `{offset}` and the master dark flat type. C: Calibrate copy for masters only; Add to calibration library may file into structured storage with `masterStoragePath`. A: Import already files masters through the master templates and routes raw calibration frames into processes through `readFiles`.

**Foundation fixes (round 2 requests)**: `MenuEntries` (`row-menu.tsx`) wraps each heading and the items after it in `ContextMenuGroup`, so a heading no longer throws "MenuGroupContext is missing" (the design-system table's row menu exercises it); `filterSuitability` returns each band's Moon-clear `stretches`.

Evidence (2026-10-09, demo seed, private headless Chrome, port 5544, `/Users/sjors/tmp/pv-v5-r2f-unitf/smoke.mjs`): 35 routes at 1440×900, 1280×800 and 1024×768 with document scroll equal to the viewport, no status-bar overflow and 0 console errors; each changed interaction once (chip popover, notification history, Cancel on hover, the selection slot, the row-menu heading, Stack → Tool finished stacking → registered with raws trashed, Detect failing again, Cancel of a watch, the 1024 "+N" popover). Screenshots: `design/harness-v5-shots/r2/f/`.

## Fix pass (2026-10-09)

The design critique and the WCAG 2.2 AA audit of the integrated harness were fixed on `ui-harness-v5`. The window, source list, toolbar, status bar and gate vocabulary keep their v4 names; what changed:

- **Toolbar:** one 40 px row at every width. The Next label and its caption truncate with the whole text in the tooltip; Search folds to an icon under 1200 px and Import under 1280 px; Prototype and Theme live in the More menu.
- **Next never points at the screen it is on** (`nextFrom` in `derive.ts`): on an advisory step (Review) Next moves on to the following step and the caption keeps the step's progress; on a blocking step Next is replaced by the reason; a Save run Next focuses the Save button. A Complete run only offers Clean up.
- **Gate words:** the review gate reads *Needs review* with its own glyph (circle with dots); the warning triangle is kept for warnings; Partial is the dashed circle in rails and badges alike. Home and Projects reuse the rail's word ("Partial at Prepare").
- **Review drafts:** X in a run's Review changes Review, not Select: Select keeps "Saved r1", Review reads "2 rejected, unsaved" with Save run and Discard in Review's status line. Review's counts cover the frames it lists, as its filters do.
- **Review layout:** the table takes the space left after a preview stage of at least 26rem; under 1000 px of pane the inspector opens over the preview (I); Measure frames, the Trash and Complete notes and Import measurements sit in the status line; labels fold to icons below 62rem. Roving focus follows the current frame in the table, filmstrip and grid (one Tab stop each); Measure frames hands focus to Cancel and back to the status line, announcing the start and the summary.
- **Pane header and sections:** pane titles 17 px, section headings 15 px, captions 11 px on one line; the sticky pane header publishes `--pane-header-h`, which `#main`'s scroll padding uses.
- **Projects list:** column priority keeps Next in view from 1024 px; rows have a context menu. **Project page:** Runs first, then Goals, Subjects, Rigs, Candidates (summarised, one link to the candidate review), Planning, Archived sessions and Trash; the toolbar Next is the one primary action.
- **Sheets:** right sheets hang below the toolbar and take their caller's width (Done / Archive 52rem); offers confirm inline, never in a second dialog; Mark Done stays disabled while runs are not Complete, and Complete on a run with open steps previews them first.
- **Source list:** the deepest current row takes the accent fill and is the only `aria-current="page"` (`CurrentLink` in `app/run-ui.tsx`); the step bar is a gate bar (glyph and step name, gate word and status in the name, a visible Next marker, `aria-current="step"`).
- **Tokens:** `--destructive-foreground` gives the one destructive button style 5.5:1 or better in dark; pressed toggles draw the ring colour bar in dark.
- **Seed:** one rejected M 31 L frame and one duplicate copy on Spare lost write permission, so the Done / Archive sheet shows refused items with reasons.

Evidence (2026-10-09, demo seed, private headless Chrome; scripts in `/Users/sjors/tmp/pv-v5-fix/`): the integrated smoke passes 34 routes at 1440, 1280 and 1024 with document scroll equal to the viewport and 0 console errors; axe-core 4.14.0 finds 0 serious or critical issues on 27 screens. Before and after screenshots are in `design/harness-v5-shots/fixed/`.
