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

## Source list (sidebar)

| Group | Item | Route | Notes |
|---|---|---|---|
| Primary | **Home** | `/` | Start page: the control-panel dashboard (D-W39). |
| Primary | **Projects** | `/projects` | Projects list. Show done filter (D-W48). |
| Primary | **Targets** | `/targets` | My targets is the default (D-W17, D-W60). |
| Primary | **Plan** | `/plan` | Planner: Tonight plus the night timeline (v4's not-done item). |
| Library | Sessions | `/sessions` | Library sessions; filters Needs a Target / Not in any Project / Trashed (D-W25, D-W43). |
| Library | Calibration | `/calibration` | Calibration library: masters only; raw sessions by their calibration process (P-CAL3). |
| Library | Storage | `/storage` | Storage overview: locations, footprints, duplicates, transfers (STO-FR-11). |
| Toolbar | **Import** | sheet over `/import` | Lightroom-style workflow entry (D-W11, D-W24). It is also on Home and in the toolbar. |
| Footer | Activity, Settings | `/activity`, `/settings/*` | Settings: Equipment (rigs with filter lists, D-W31), Goal templates (D-W30, D-W47), Naming (D-W20), Locations, Sites, Applications, Target lookup, Appearance. |

Round 2 (2026-10-09): the source list is navigation only. The Project outline is gone; an optional Recent group lists up to three recently opened Projects without children, and Sessions and Projects carry count badges. The Project page owns its runs and stages; a run's six steps live in its step bar.

## Screens

| # | Screen | Route | Contract | Must show |
|---|---|---|---|---|
| S1 | Home | `/` | D-W39, D-W35, D-W48, PRJ-FR-17/18/19 | **Header actions:** Plan tonight, New Project, Import. **Top line:** every hub issue as a pill linking to its action (the list the Issues hub and the status bar read), or "No issues". **Boxes:** Projects (goals in project / captured, stage, Next; Done Projects behind Show done); Sessions (needs a Target / not in a Project / unreviewed / ready to add to a run, each with one action; an Unreviewed session is reviewed in a sheet over Home, `?review=<sessionId>`, library marks only); Tonight (darkness, the Moon, and the best windows for open-Project subjects and ★ favourites, or the no-site state); Goals (unmet goals of open Projects per subject and channel); Work (running operations with Pause, Resume or Retry, and Cancel). **Next rule order (D-W35):** review N new frames, then a blocked run, then Wrap up once every run is Complete, then Plan tonight, then Start a processing run; a Done Project has no Next. |
| S2 | Projects list | `/projects` | D-W1, D-W35, D-W48 | One row per Project: subjects, rigs, goal progress, open runs, stage, Next; right click opens the row's menu. Done Projects behind Show done. New Project. |
| S3 | Project | `/projects/$id` | D-W9, D-W29, D-W33, D-W36, D-W37, D-W38, D-W16, D-W59, P-WRAP1 | **Header:** the stage strip Open → Runs → Wrap up → Done (or Archived); Runs and Wrap up switch the page between the Project's work and its Wrap up stage (`?stage=wrap-up`, S9). A Done Project offers Reopen, which moves no file. The toolbar Next is the one primary action. **Sections in order:** Runs (each run with its step rail, run groups, Start a run, and Trash with its count); Candidates (derived; filters All / Unreviewed / Not in a run; a mosaic session's panel or placement flag; Review frames opens `?candidates=unreviewed`; start a run from a selection); Goals per subject and channel ("Ha 6h10 in project · 9h15 captured · goal 10h", structured kinds and channel chips, exposure-mismatch and missing-calibration warnings per rig); Subjects (Target or mosaic; New mosaic and a mosaic subject open the mosaic editor, `?mosaic=new\|<subjectId>`) and Rigs; Planning (tonight at the planning site, best window and goal gaps per subject, Planner); Archived sessions (Restore while Open). |
| S4 | New Project | sheet | D-W30, D-W47, D-W9, D-W37 | Name and notes, subjects (search across My targets, the catalogues and SIMBAD, D-W17), rigs, and a goal template (HOO / SHO / LRGB / OSC broadband / OSC dual-band) whose values are copied in and stay editable. A session prefills its Target and rig; a Target prefills itself as a subject. Mosaic subjects are added on the Project page. |
| S5 | Run | `/projects/$id/runs/$runId/$step` | D-W3, D-W50, D-W49, D-W54, D-W5, D-W55, D-W51, D-W4, D-W56, D-W26, D-W72 | **Header:** subject and rig (fixed, D-W50), status (Open / Complete / Trashed), and Complete, Reopen, Move to Trash, Restore, Clean up. **Steps:** Select (subject candidates on the run's rig, all preselected, D-W49; refresh flags); Review (S6); Calibrate (readiness line, Review matches, automatic policy, a master found in Results is offered once); Prepare (profile, mode, layout preview `<output>/<Project>/<Run>/`, `(rev N)`, Partial lists, Open re-verifies); Results (discovered in the recorded Results folder, attach, accept, use as an input to another run, product inputs with their rig); Done (Complete, Clean up review: prepared entries only, preselected). **Refusals** name their blockers: Trash is refused while a Result is an input, or while an operation is Running. |
| S6 | Review (frame review) | Run step `review` | D-W13, D-W14, D-W22, D-W40, D-W42, D-W53, D-W54, D-W15 | The frame table spans the full width at the top; T cycles three heights. Preview with zoom, pan and F for fullscreen. Plots across the session in the bottom strip; histogram and star cutouts. Three views of the same list: table, filmstrip and grid (G). Filters: All / Picked / Rejected / Unreviewed. Hotkeys: ←/→ or J/K, P, X, U, Z, F, C, ⌘A, and Shift+P / Shift+X with auto-advance. Two-level quality: Library P/X/U, plus a secondary "Reject for this Project only". Display-name template. |
| S7 | Run group (mosaic) | `/projects/$id/groups/$groupId/$step` | D-W38, D-W41, D-W73, D-W75 | Panels with per-panel status. Shared setup (profile, input mode, calibration policy). Review all with a Panel column and a Panel filter. Calibration readiness per panel. Prepare all: `<Mosaic>/Panel N/`, `<Mosaic> Results/Panel N/` and `Assembled/`; group outcome; Open only when every panel is verified. A trashed panel is listed as Trashed and its frames leave the counts (D-W75). |
| S8 | Project Trash | `/projects/$id/trash` | D-W72, D-W75 | Trashed runs with the stage they were at. Restore brings a run back exactly as it was. Empty Trash (all from the header, or one run from its row menu) previews what goes (the run record, prepared folders, and the Results folder only when ticked) and what stays, then runs one "trash" operation. |
| S9 | Wrap up | `/projects/$id?stage=wrap-up` | P-WRAP1, P-ARC1, D-W26, D-W43, D-W46, D-W69, D-W70, D-W74 | The Project stage once every run is Complete; it replaces the Done / Archive sheet. Steps in order, each optional and skippable (Skip, Undo), each with its size: 1 Clean up runs (each Complete run's prepared entries, through the run's Clean up); 2 Trash (rejected frames, intermediates and duplicate copies, each its own approval, with the refusals and their reasons); 3 Archive (member sessions to the chosen archive location, the Default unless the Project picks another; sessions another Project uses stay); 4 Done (Mark Done, refused while runs are not Complete). Nothing moves until an approval. A Reopened Project shows Archived sessions on the Project page until they are restored. |
| S10 | Targets | `/targets`, `/targets/$id` | D-W17, D-W18, D-W19, D-W23, D-W60, D-W61, D-W62 | My targets (the ★ favourites plus open-Project subjects, with a badge). Browse needs a catalogue or a preset. Unified search (My targets, the library, the bundled catalogues and SIMBAD) with Add to targets. Columns: ★, Designation, Type, Max alt, Lunar, Img time, Filters (one chip per filter, graded good tonight), Opposition, Sessions, Captured; Fit with a rig selected; Source while searching. Moon in the toolbar. Rig selector: none / each rig / this Project's rigs (`?project=`, the default there). Filters: good tonight per band with its Moon limits editable in place; built-in presets (Best tonight, Narrowband (Moon up), Emission nebulae Ha, Galaxies dark sky, Planetary nebulae OIII; Mosaic candidates and Fits nicely only with a rig; narrowband presets hidden without a narrowband filter) and saved presets (rename, delete). The view lives in the URL. **Target detail:** tonight (values and a one-row night timeline with its filter sub-rows), identity, Fit on every rig, the Projects that use it with their goal lines, captured time per channel with its sessions; Add to Plan, Add to Project (previewed first) or New Project. |
| S11 | Plan | `/plan` | D-W16, D-W63, PLAN-FR-02/09/10/11 | Tonight at the planning site on one compact night timeline (twilight and Moon bands, altitude curve, minimum-altitude line, window blocks), with darkness, the Moon, the site and its time zone, and a site picker when there are several. The list: the Plan list (add from the search, remove with × or right click), else My targets while it is empty; Show all lists My targets with it. Each row: best window, Img time and Moon separation; Per filter expands one sub-row per filter, graded good tonight, with its Moon-clear windows; Moon limits edit the constraints behind the grades. A mosaic uses its centre and lists its panels. `?project=` scopes the page to that Project's subjects with their unmet goals. With no site: "Add site". |
| S12 | Sessions | `/sessions`, `/sessions/$id` | D-W24, D-W25, D-W43, D-W59 | Library light sessions only (raw calibration frames go to a calibration process, S14). Filters with counts: All, Needs a Target, Not in any Project, Trashed. Row actions: Choose Target, Review and Add to Project (also adds the rig, with a visible note); `?import=<operation>` highlights what an Import filled. **Session detail:** Detail (Target and rig evidence with Confirm Target / Confirm rig, candidate Projects, runs, frames and headers, Add to Project or Create Project prefilled) and Review (`?view=review`, library marks only). |
| S13 | Import | sheet over `/import` | D-W11, D-W12, D-W24, D-W20 | Pick a source: a removable device (its capture layout recognised), a saved source (Import new) or Choose folder. Templated preview of destinations: lights become sessions in Captures, raw calibration frames go to a calibration process awaiting Stack, masters go to structured calibration storage. Holds: Unclassified, still being written. Skips: SHA-256 duplicates. Copy or Move (Move verifies, then sends the source to the OS Trash). Writability and free space. The import runs as an operation, then lists what it filled. A second tab adds an existing library folder (index in place). |
| S14 | Calibration library | `/calibration` | CAL, P-CAL2, P-CAL3 | Process: each raw session's calibration process with its steps (Stack → Detect → Import → Register → Raws), each step's state and reason, a tool picker, Stack / Retry / Detect now / Cancel / Trash raws, and a failure as a terse Refusal. Masters grouped by kind in their structured-storage keys (flats: train, filter, night; darks and dark flats: camera, exposure, gain, offset, temperature; bias: camera, gain, offset), "Used by" behind a disclosure. Dismissed filter with Restore. Import masters files a folder's masters straight into storage. `?process=` highlights a process, `?filter=dismissed` opens Dismissed. |
| S15 | Storage | `/storage` | STO-FR-11/12 | Location availability, Duplicates (none listed until Scan for duplicates runs the `duplicate-scan` operation, then its groups) and transfers. No footprints (they live on a run's Done step and in Wrap up). Read-only. |
| S16 | Settings | `/settings/*` | D-W31, D-W30, D-W47, D-W20, P-ARC1, P-CAL3 | Appearance (theme picker with swatches, language picker with pt-BR marked machine-generated, density, shortcuts), Equipment (a rig is an optical train: camera kind mono or OSC, sensor, field of view, and a simple filter list), Goal templates (structured kinds and channel chips, no Applied in), Naming templates (11 tokens, chip editor, live preview, the master types including dark flats), Calibration (Keep raw calibration frames, off by default), Locations (several archive locations, one Default pill, Make default), Sites (one Default pill, Make default), Applications. |
| S17 | Activity | `/activity` | | Operations and refusals, as in v4. |

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

## Foundation contract

Read this before editing. The foundation owns every shared file below; a screen agent edits only its own slice files and messages the integration owner for a shared change. Route patterns live in `src/routes.tsx`. Run the app on port 5505 with `pnpm exec vite --host 127.0.0.1 --port 5505 --strictPort` and load the demo through Prototype › Load demo library.

### Domain types (`src/domain/types.ts`)

- **Project**: `subjects: Subject[]`, where a Subject is `{ targetId, mosaic: { name, centre, panels: MosaicPanel[] } | null }` and a panel is `{ n, ra, dec, rotationDeg }`. Also `rigIds`, `goals: Goal[]` (`subjectId`, `panelId`, `channel: GoalChannel`, `integrationS`, `frameCount`, `qualityBar`), `archiveLocationId`, `wrapUp`, `state: "open" | "done"`, `doneAt`, `archive: { at, sessionIds } | null`, and `rejections` (the Project-only reject). Round 2 removed `goalTemplateId` (see § Round 2 foundation).
- **Run** (the domain's View): `projectId`, `subjectId`, `panelId`, `groupId`, `rigId` (fixed), `setup: RunSetup | null` (profile, input mode, calibration policy; null for a panel run), `revisions: MembershipRevision[]`, `draft`, `calibration` (assignment overrides), `masterOffers`, `outputParent`, `completion: "open" | "complete"`, `completedAt`, `stageBeforeComplete`, and `trashedAt`. `RunStep` is `select | review | calibrate | prepare | results | done`.
- **MembershipContent**: `sessions` (each with a reason), `included`, `excluded`, `rejected` (removed in Review, D-W54), `unresolved`, and `productInputs` (Results of other runs).
- **RunGroup**: `runIds` (panel runs, in panel order), the shared `setup` and `outputParent`.
- **Preparation**: `runId`, `groupId`, `prepRevision` (`(rev N)`), `folderPath`, `resultsPath`, `state`, `blocked` and `unverified`. **ResultRecord**: `runId` or `groupId`, `intermediate`, `discovered`, `fromPrepRevision`, `association`, `lineage`, `acceptance` and `trashed`.
- **Two-level quality**: `Asset.quality` (library P/X/U) plus `Project.rejections`. Asset `trashed: { at, episodeId } | null`. **TrashEpisode**: `kind` (rejected-frames, intermediates, duplicate-copies, empty-trash, import-move, run-cleanup) and `items`, each trashed or refused with a reason.
- **Rigs**: `OpticalTrain.filters: RigFilter[]`, each `{ name, matches, bands }`. `Camera.kind` is `"mono" | "osc"`. Also `GoalTemplate`, `ImportSource`, `NamingFrameType`/`NamingToken`, `settings.naming`, `settings.lastOutputParent`, `Volume.network`, `Disk.apps` and `faults.noSite`.
- **Removed**: View, ViewOrigin, ChecklistItem, SelectionCriteria, FilterDef and `catalog.filters`, `Location.managed` (filing), and the onboarding tour and checklist flags.

Related modules: `templates.ts` holds the built-in goal templates (D-W47) and naming tokens, defaults, validation and resolution (D-W20), plus `namingValues(facts)` and `headerNamingValues(header, frameType)`, the one way token values are formatted. `labels.ts` holds `RUN_STEPS`, `STEP_NAME`, `MODE_NAME`, `RESULT_KIND_NAME` and `BANDS`. `planning.ts` adds `tonightAt(site, nowMs)` (Moon, darkness) and `bestWindowTonight`, and exports its sky primitives `sunPosition`, `moonPosition`, `altitudeDeg`, `julianDay`, `norm360` and `SAMPLE_MIN`, the night grid `skyNight(site, night, darkness)`, and `clearStretches` (the Moon-clear `Stretch`es that `filterSuitability` and Targets read). `sky.ts` holds the bundled catalogues (`BUNDLED_CATALOGUE`, `CATALOGUES`), the `SIMBAD_FIXTURE`, `entryKeys`, `bundledEntryFor`, `resolverEntryFor`, `matchesQuery` and `targetFromEntry`; indexing, Target lookup, New Project and Targets all read them. `disk.ts` adds `trashRefusal(disk, path)`, the one OS Trash refusal check. `calibration.ts` holds `calibrationPlan(catalog, disk, run, policy, content)` and `readinessLine`. `membership.ts` holds the pure membership transforms plus `runSummary`. `library.ts` holds the library totals, availability and coverage. `src/lib/format.ts` adds `fileName(path)`.

### Derive functions (`src/domain/derive.ts`)

- **Associations and rigs**: `sessionTargetId`, `sessionNamingValues` (a session's naming token values), `sessionRigId`, `liveAssetIds`, `isTrashedSession`, `liveLightSessions`, `rigName`, `rigCameraKind`, `rigBands`, `bandUnion`, `rigFieldOfView`, `rigFilterFor`, `unknownFilterValues` and `goalChannel`.
- **Subjects and panels**: `subjectTarget`, `subjectName`, `findSubject`, `findPanel`, `panelLabel`, `subjectCentre`, and `panelForSession` (with its flags).
- **Projects**: `projectStatus`, `projectRuns`, `projectTrash`, `projectGroups`, `candidateSubject`, `projectCandidates`, `projectMemberSessionIds`, `goalProgress` (with the `line` ref "Ha 6h10 in project · 9h15 captured · goal 10h" and `amounts`, the line without its channel), `projectWarnings` (exposure mismatch and missing calibration per rig), `markDoneBlockers`, `projectNext` (the D-W35 rule order; "Review N new frames" opens the Project's candidate review) and `projectStage`.
- **Runs**: `latestRevision`, `workingContent`, `savedContent`, `runSetup`, `runCandidates`, `runRefresh` (new candidates, "no longer matches subject"), `runPreparations`, `runResults`, `runOperations`, `runPipeline` (steps, gates, current, next, blocker, calibration), `trashRefusals`, `completeRefusals`, `groupCandidates`, `groupPipeline`, the link builders `runStepLink`, `groupStepLink` and `projectLink`, and their string forms `runHref` and `groupHref`. `GateState` and `GATE_WORD` hold the v4 gate vocabulary.
- **Home and targets**: `sessionsNeedingWork`, `planningSite`, `targetStatus`, `runningWork`, `myTargets`, `targetFit`, `fitsNicely`, `isMosaicCandidate`, `frameQuality` and `formatHours`.

### Store actions (`src/store/actions/`)

Every action writes through `commit()`. A contract refusal returns `{ ok: false, reason: "refused", reasons }` and records it in Activity.

- **`projects.ts`**: `createProject`, `updateProjectDetails`, `addSubject`, `removeSubject`, `addRig`, `removeRig`, `setGoals`, `applyGoalTemplate`, `addSessionToProject` (returns the added-rig note), `markProjectDone`, `reopenProject`, `setProjectRejection`, `prefillFromSession`, `goalTemplate` and `goalsFromTemplate`.
- **`runs.ts`**: `startRun` (a mosaic subject gets a run group), `editRun` (patch one run in one commit, with `step`, `record` and `also` options), `updateRunDraft`, `addRunSessions`, `removeRunSessions`, `excludeRunFrames`, `restoreRunFrames`, `setProductInputs`, `saveRun`, `discardRunDraft`, `renameRun`, `setRunSetup`, `setGroupSetup`, `completeRun`, `reopenRun` (returns its step), `trashRun`, `restoreRun` and `emptyTrash`.
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
- Frame review is slice D's `src/features/v5/d-review/` (`ReviewStep`, `GroupReviewStep`, `CandidateReview`), built on the v4 pieces kept in `src/features/t3/` (frame-preview, raster, measure, measurement-plot, csv, import-dialog, fields).
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
- `calibration-library.ts`: `dismissedOffers`. The calibration process is `calibration-process.ts` (§ Round 2b).
- `storage.ts`: `preparationFootprint`, `runFootprint` (for a run's Done step and Wrap up; not the Storage overview), `liveCopies`, `duplicateCopies`, `lastDuplicateScan`.
- `devices.ts`: `removableDevices`, `recognizeLayout` (ASIAIR, N.I.N.A., SharpCap, Ekos, SGP, Voyager by folder structure), `isRemovablePath`, `DEVICE_LAYOUT_LABEL`. It replaces `ASIAIR_CARD`.
- `issues.ts`: `deriveIssues` (groups Sessions, Locations, Work, Runs, Calibration, Drift; each issue one action), `worstSeverity`, `sessionsNeedingAttention`, `blockedProjectCount`.
- `sites.ts`: removing the default site makes the first remaining site the default.

**Store actions**: `restoreMasterOffer(runId, masterId)` (`actions/calibration.ts`; the calibration process actions are in § Round 2b); `startDuplicateScan()` (`actions/storage.ts`); `addToPlan`, `removeFromPlan` (`actions/planning.ts`); `setDefaultArchiveLocation`, `setMoonConstraint` (`actions/settings.ts`); `setProjectArchiveLocation`, `setWrapUpStep`, `goalsFromValues` (`actions/projects.ts`; `addSubject` copies the Project's goal set); `connectDevice`, `ejectDevice` (`store/simulation.ts`, replacing `insertAsiairCard`). The `duplicate-scan` handler is foundation-owned.

**Seed**: M 31 LRGB is open in Wrap up (Clean up done, Trash and Archive to do, archives to the NAS archive) with every goal kind; Archive and NAS archive are archive locations, Archive the Default; M 31's 120 s master dark offer is dismissed; an ASIAIR card (recognised) and a USB stick (generic) are connected; the Plan list holds NGC 7000 and M 33; Heart and Soul has a frame-count OIII goal. Calibration: § Round 2b.

**Left to the slices**: Home's pills (A, `IssuePill`), the Removable devices section of Import (A), the Project stage strip and Wrap up UI replacing the Done / Archive sheet (B), structured channel chips in goal editors (B, E2), Restore offer and the calibration process UI (E2, § Round 2b), Storage without footprints and with Scan for duplicates (E2), Plan list and good-tonight chips (E1).

Evidence (2026-10-09, demo seed, private headless Chrome, port 5530): `/Users/sjors/tmp/pv-v5-r2f/smoke.mjs routes` passes 34 routes at 1440×900, 1280×800 and 1024×768 with document scroll equal to the viewport, no "built next" and 0 console errors. Home renders in all 13 themes and pt-BR switches the shell; screenshots are in `design/harness-v5-shots/r2-foundation/`.

### Round 2b foundation: status bar and P-CAL3 (2026-10-09)

Work order: `design/HARNESS-V5-FEEDBACK-R1.md` § Round 1b (Status bar, P-CAL3). Units A, C and E2 build on this head.

**Status bar** (`src/app/status-bar.tsx`, the window's full bottom bar; `AppFrame` mounts `StatusBar`):

- Left: locations online (links to Settings › Locations), then the context slot: "3 selected" while a list reports a selection.
- Middle (P-SB2, round 2c): every hub issue, worst first, then hub group order, at the densest level that fits: (1) one named pill per issue, linking to its action; (2) one chip per kind (offline, failed, blocked, need a Target, not in a Project, calibration waiting, masters offered, changed), a chip of several opening a popover of `IssueRow`s; (3) those chips with the trailing ones under "+N". An invisible ruler measures every level, re-fitting on resize and when the issues, the unread notifications or the language change. No issues reads a muted "No issues".
- Right: running and paused work, newest first, each with a mini progress bar (an unknown size pulses) and Cancel (×) on hover or focus; two inline from 1440 px, one below, the rest under "+N". Then up to three unread notifications inline, newest first, after dividers, and the history trigger with the unread count (latest 12, each linked to its surface, plus Activity). Opening the history marks every notification read; following one inline marks that one. The chips and the inline notifications share the room: the named pills give way first, then the notifications (oldest first; the oldest shown truncates to the room left, down to 128 px, before it drops), then the trailing chips. Below 768 px: chips by kind and the last notification. Idle reads "Idle".
- Test hooks: `[data-status-locations]`, `[data-status-selection]`, `[data-status-chips][data-level=1|2|3|none]` (`none`: no issues), `[data-chip-issues]` (issues a pill, chip or "+N" covers), `[data-status-more=chips|work]`, `[data-status-work] [data-operation] [data-cancel]`, `[data-status-notices] [data-notice-inline]`, `[data-status-notice][data-unread]`.

**Status-bar hooks and helpers**

| API | File | Use |
|---|---|---|
| `useStatusSelection(count, total?)` | `src/app/status-selection.ts` | Report a list's selection while mounted; the bar reads "3 selected" (or "3 of 120 selected"). `DataTable` reports its controlled selection itself, so call it only for lists that are not a DataTable (filmstrip, grid). The latest non-zero report wins; unmounting clears it. |
| `useStatusIssues()` | `src/store/issues.ts` | `StatusIssues` from `statusIssues(issues)` in `domain/issues.ts`: `pills` (each issue, bar order) and `chips` (`StatusChip`: `id`, `count`, `severity`, `issues`). `STATUS_CHIP_OF: Record<IssueKind, StatusChipId>` maps every kind to a chip, so a new kind fails to compile until it has one and the chips cover exactly the hub's issues. Issues are derived once per state version for the hub, Home and the bar. |
| `Issue.kind`, `Issue.about`, `Issue.link` | `src/domain/issues.ts` | `IssueKind`: needs-target, not-in-project, location-denied, location-offline, work-failed, work-interrupted, calibration-review, run-blocked, master-offer, calibration-waiting, calibration-failed, drift. `about` is the one record's id (location, run, session, master, process), null for a count. `link` is where the one action leads. An issue carries no copy: `issueCopy(m, issue)` words it. |
| `useNotices()`, `noticeText(m, notice)`, `markNoticesRead(id?)` | `src/store/notifications.ts` | `{ notices, unread }`: the latest 12 Activity events as `Notice` (`title`, `outcome`, `done`, `detail`, `tone`, `href`, `at`), and those not yet seen (`PrototypeState.noticesRead`, persisted). `noticeText` words one: "<title> finished · 54 frames". |
| `IssueRow`, `SEVERITY_TONE`, `SEVERITY_ICON` | `src/app/issues-hub.tsx` | One issue with its action, shared by the hub and the chip popovers. |
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
