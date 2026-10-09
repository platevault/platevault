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
   └─ Done / Archive sheet (Archive; move rejected, intermediate, duplicate copies to the Trash)  D-W26, D-W43, D-W70, D-W74
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
| Library | Calibration | `/calibration` | Calibration library: masters and raw sets. |
| Library | Storage | `/storage` | Storage overview: locations, footprints, duplicates, transfers (STO-FR-11). |
| Toolbar | **Import** | sheet over `/import` | Lightroom-style workflow entry (D-W11, D-W24). It is also on Home and in the toolbar. |
| Footer | Activity, Settings | `/activity`, `/settings/*` | Settings: Equipment (rigs with filter lists, D-W31), Goal templates (D-W30, D-W47), Naming (D-W20), Locations, Sites, Applications, Target lookup, Appearance. |

When a Project is open, the source list shows its outline under Projects: its subjects, its runs and run groups (each with its current step glyph), and Trash with a count. When a run is open, the outline shows the run's six steps with their gate glyph and short status. This is v4's pipeline navigator, moved to the run.

## Screens

| # | Screen | Route | Contract | Must show |
|---|---|---|---|---|
| S1 | Home | `/` | D-W39, D-W35, D-W48, PRJ-FR-17/18/19 | **Top line:** "N sessions need a Target · M not in any Project". **Six sections in order:** 1 actions (Import, New Project, Plan tonight); 2 Projects (goals in project / captured, stage, Next); 3 new sessions needing work (needs a Target / not in a Project / unreviewed / ready to add to a run), each with a one-click action; 4 Tonight (best windows, Moon, darkness); 5 Target status (unmet goals per channel); 6 running work. **Next rule order (D-W35):** review N new frames, then a blocked run, then Plan tonight, then Start a processing run. **Filter:** Show done. |
| S2 | Projects list | `/projects` | D-W1, D-W48 | One row per Project: subjects, rigs, goal progress, open runs, stage, Next. Show done. New Project. |
| S3 | Project | `/projects/$id` | D-W9, D-W29, D-W33, D-W36, D-W37, D-W38, D-W16, D-W59 | **Header:** state (Open / Done / Archived) and its actions (Mark Done, Reopen, Done / Archive sheet). **Subjects:** Target or mosaic; for a mosaic, panels by centre and rotation. **Rigs.** **Goals per subject and channel:** "Ha 6h10 in project · 9h15 captured · goal 10h", plus the exposure-mismatch warning (per rig). **Candidates:** derived; flagged when "no longer matches subject" (D-W45). **Runs:** each run with its step rail and run groups. **Planning for its subjects:** windows, gaps, Open in Planner. **Trash:** count and link. |
| S4 | New Project | sheet | D-W30, D-W47, D-W9, D-W37 | Name, subjects (search across My targets, the catalogues and SIMBAD, D-W17), rigs, and a goal template (HOO / SHO / LRGB / OSC broadband / OSC dual-band) whose values are copied in and stay editable. |
| S5 | Run | `/projects/$id/runs/$runId/$step` | D-W3, D-W50, D-W49, D-W54, D-W5, D-W55, D-W51, D-W4, D-W56, D-W26, D-W72 | **Header:** subject and rig (fixed, D-W50), status (Open / Complete / Trashed), and Complete, Reopen, Move to Trash, Restore, Clean up. **Steps:** Select (subject candidates on the run's rig, all preselected, D-W49; refresh flags); Review (S6); Calibrate (readiness line, Review matches, automatic policy, a master found in Results is offered once); Prepare (profile, mode, layout preview `<output>/<Project>/<Run>/`, `(rev N)`, Partial lists, Open re-verifies); Results (discovered in the recorded Results folder, attach, accept, use as an input to another run, product inputs with their rig); Done (Complete, Clean up review: prepared entries only, preselected). **Refusals** name their blockers: Trash is refused while a Result is an input, or while an operation is Running. |
| S6 | Review (frame review) | Run step `review` | D-W13, D-W14, D-W22, D-W40, D-W42, D-W53, D-W54, D-W15 | The frame table spans the full width at the top; T cycles three heights. Preview with zoom, pan and F for fullscreen. Plots across the session in the bottom strip; histogram and star cutouts. Three views of the same list: table, filmstrip and grid (G). Filters: All / Picked / Rejected / Unreviewed. Hotkeys: ←/→ or J/K, P, X, U, Z, F, C, ⌘A, and Shift+P / Shift+X with auto-advance. Two-level quality: Library P/X/U, plus a secondary "Reject for this Project only". Display-name template. |
| S7 | Run group (mosaic) | `/projects/$id/groups/$groupId/$step` | D-W38, D-W41, D-W73, D-W75 | Panels with per-panel status. Shared setup (profile, input mode, calibration policy). Review all with a Panel column and a Panel filter. Calibration readiness per panel. Prepare all: `<Mosaic>/Panel N/`, `<Mosaic> Results/Panel N/` and `Assembled/`; group outcome; Open only when every panel is verified. A trashed panel is listed as Trashed and its frames leave the counts (D-W75). |
| S8 | Project Trash | `/projects/$id/trash` | D-W72 | Trashed runs. Restore brings a run back exactly as it was. Empty Trash (per run or all) shows what goes (prepared folders, ticked Results) and what stays. |
| S9 | Done / Archive sheet | sheet on the Project | D-W26, D-W43, D-W46, D-W69, D-W70, D-W74 | **Offers, each approved separately:** Archive (template paths; keeps sessions another non-Done Project uses); move N rejected frames to the Trash (Library-Unusable candidates only); move N intermediates to the Trash; move N duplicate copies to the Trash (keeps the Captures copy, otherwise the earliest). Each offer shows its size and the refusals with reasons. A Reopened Project shows Archived sessions until they are restored. |
| S10 | Targets | `/targets`, `/targets/$id` | D-W17, D-W18, D-W19, D-W23, D-W60, D-W61, D-W62 | My targets (the ★ favourites plus open-Project subjects, with a badge). Browse needs a catalogue or a preset. Unified search with Add to targets. Columns: ★, Designation, Type, Max alt, Lunar, Img time, Filters (7-band strip), Opposition, Sessions, plus a compact Captured per channel. Moon in the toolbar. Rig selector: none / each rig / this Project's rigs, with the Fit column (fits / N panels / tiny / –) and the band strip. Presets: built-in plus saved; narrowband presets hidden without a narrowband filter; Mosaic candidates and Fits nicely only with a rig. |
| S11 | Plan | `/plan` | D-W16, D-W63, PLAN-FR-02/09/10/11 | Tonight: best window per subject and favourite, Moon, darkness, and the site with its time zone. A mosaic uses its centre. Night timeline (twilight bands, Moon band, altitude curve, window blocks). Opening it from a Project scopes it to that Project's subjects and gaps. With no site: "Add an observing site in Settings". |
| S12 | Sessions | `/sessions`, `/sessions/$id` | D-W24, D-W25, D-W43, D-W59 | Library sessions: lights only (calibration frames are in the Calibration library). Filters: Needs a Target, Not in any Project, Trashed. Actions: Add to Project (also adds the rig, with a visible note) and Create Project (prefilled). |
| S13 | Import | sheet | D-W11, D-W12, D-W24, D-W20 | Pick a source; a saved source offers Import new. Templated preview of destinations in Captures or Calibration. Holds: Unclassified, still being written, duplicate (skipped). Copy or Move (Move verifies, then sends the source to the OS Trash). Writability and free space. Add existing library folder (index in place). |
| S14 | Calibration library | `/calibration` | CAL | Masters and raw sets, adoption, and the runs that use each master. |
| S15 | Storage | `/storage` | STO-FR-11/12 | Separate sections for location availability, run and group footprints, duplicate candidates (live copies only) and transfers. Read-only. |
| S16 | Settings | `/settings/*` | D-W31, D-W30, D-W47, D-W20 | Equipment (a rig is an optical train: camera kind mono or OSC, sensor, field of view, and a simple filter list), Goal templates, Naming templates (9 tokens, chip editor, live preview), Locations, Sites, Applications. |
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

- **Project**: `subjects: Subject[]`, where a Subject is `{ targetId, mosaic: { name, centre, panels: MosaicPanel[] } | null }` and a panel is `{ n, ra, dec, rotationDeg }`. Also `rigIds`, `goals: Goal[]` (`subjectId`, `panelId`, `channel`, `integrationS`, `frameCount`, `qualityBar`), `goalTemplateId`, `state: "open" | "done"`, `doneAt`, `archive: { at, sessionIds } | null`, and `rejections` (the Project-only reject).
- **Run** (the domain's View): `projectId`, `subjectId`, `panelId`, `groupId`, `rigId` (fixed), `setup: RunSetup | null` (profile, input mode, calibration policy; null for a panel run), `revisions: MembershipRevision[]`, `draft`, `calibration` (assignment overrides), `masterOffers`, `outputParent`, `completion: "open" | "complete"`, `completedAt`, `stageBeforeComplete`, and `trashedAt`. `RunStep` is `select | review | calibrate | prepare | results | done`.
- **MembershipContent**: `sessions` (each with a reason), `included`, `excluded`, `rejected` (removed in Review, D-W54), `unresolved`, and `productInputs` (Results of other runs).
- **RunGroup**: `runIds` (panel runs, in panel order), the shared `setup` and `outputParent`.
- **Preparation**: `runId`, `groupId`, `prepRevision` (`(rev N)`), `folderPath`, `resultsPath`, `state`, `blocked` and `unverified`. **ResultRecord**: `runId` or `groupId`, `intermediate`, `discovered`, `fromPrepRevision`, `association`, `lineage`, `acceptance` and `trashed`.
- **Two-level quality**: `Asset.quality` (library P/X/U) plus `Project.rejections`. Asset `trashed: { at, episodeId } | null`. **TrashEpisode**: `kind` (rejected-frames, intermediates, duplicate-copies, empty-trash, import-move, run-cleanup) and `items`, each trashed or refused with a reason.
- **Rigs**: `OpticalTrain.filters: RigFilter[]`, each `{ name, matches, bands }`. `Camera.kind` is `"mono" | "osc"`. Also `GoalTemplate`, `ImportSource`, `NamingFrameType`/`NamingToken`, `settings.naming`, `settings.lastOutputParent`, `Volume.network`, `Disk.apps` and `faults.noSite`.
- **Removed**: View, ViewOrigin, ChecklistItem, SelectionCriteria, FilterDef and `catalog.filters`, `Location.managed` (filing), and the onboarding tour and checklist flags.

Related modules: `templates.ts` holds the built-in goal templates (D-W47) and naming tokens, defaults, validation and resolution (D-W20), plus `namingValues(facts)` and `headerNamingValues(header, frameType)`, the one way token values are formatted. `labels.ts` holds `RUN_STEPS`, `STEP_LABEL`, `MODE_LABEL`, `RESULT_KIND_LABEL` and `BANDS`. `planning.ts` adds `tonightAt(site, nowMs)` (Moon, darkness) and `bestWindowTonight`, and exports its sky primitives `sunPosition`, `moonPosition`, `altitudeDeg`, `julianDay`, `norm360` and `SAMPLE_MIN`. `sky.ts` holds the bundled catalogues (`BUNDLED_CATALOGUE`, `CATALOGUES`), the `SIMBAD_FIXTURE`, `entryKeys`, `bundledEntryFor`, `resolverEntryFor`, `matchesQuery` and `targetFromEntry`; indexing, Target lookup, New Project and Targets all read them. `disk.ts` adds `trashRefusal(disk, path)`, the one OS Trash refusal check. `calibration.ts` holds `calibrationPlan(catalog, disk, run, policy, content)` and `readinessLine`. `membership.ts` holds the pure membership transforms plus `runSummary`. `library.ts` holds the library totals, availability and coverage. `src/lib/format.ts` adds `fileName(path)`.

### Derive functions (`src/domain/derive.ts`)

- **Associations and rigs**: `sessionTargetId`, `sessionNamingValues` (a session's naming token values), `sessionRigId`, `liveAssetIds`, `isTrashedSession`, `liveLightSessions`, `rigName`, `rigCameraKind`, `rigBands`, `bandUnion`, `rigFieldOfView`, `rigFilterFor`, `unknownFilterValues` and `goalChannel`.
- **Subjects and panels**: `subjectTarget`, `subjectName`, `findSubject`, `findPanel`, `panelLabel`, `subjectCentre`, and `panelForSession` (with its flags).
- **Projects**: `projectStatus`, `projectRuns`, `projectTrash`, `projectGroups`, `candidateSubject`, `projectCandidates`, `projectMemberSessionIds`, `goalProgress` (with the `line` text "Ha 6h10 in project · 9h15 captured · goal 10h"), `projectWarnings` (exposure mismatch and missing calibration per rig), `markDoneBlockers`, `projectNext` (the D-W35 rule order; "Review N new frames" opens the Project's candidate review) and `projectStage`.
- **Runs**: `latestRevision`, `workingContent`, `savedContent`, `runSetup`, `runCandidates`, `runRefresh` (new candidates, "no longer matches subject"), `runPreparations`, `runResults`, `runOperations`, `runPipeline` (steps, gates, current, next, blocker, calibration), `trashRefusals`, `completeRefusals`, `groupCandidates`, `groupPipeline`, the link builders `runStepLink`, `groupStepLink` and `projectLink`, and their string forms `runHref` and `groupHref`. `GateState` and `GATE_LABEL` hold the v4 gate vocabulary.
- **Home and targets**: `sessionsNeedingWork`, `homeTopLine`, `planningSite`, `targetStatus`, `runningWork`, `myTargets`, `targetFit`, `fitsNicely`, `isMosaicCandidate`, `bandStrip`, `frameQuality` and `formatHours`.

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
- Sheets: call `openSheet({ kind: "import" | "new-project" | "done-archive" | "start-run", … })` (`src/app/ui-state.ts`). The host components mount through each slice's `shell.tsx` (`ShellContribution.Overlay`), and palette commands come from `useCommands`.
- Frame review is slice D's `src/features/v5/d-review/` (`ReviewStep`, `GroupReviewStep`, `CandidateReview`), built on the v4 pieces kept in `src/features/t3/` (frame-preview, raster, measure, measurement-plot, csv, import-dialog, fields).
- v4 code removed by this cutover can be read at commit `6ef221b1`: `src/features/t2` (Sessions, Targets, Projects, Activity), `src/features/t4` (calibration library, prepare, calibration area), `src/features/t5` (Results, Cleanup, Storage, transfers, plans) and `src/features/t3` (workspace, sessions, refresh, Views pages).

### Slice files

| Slice | Files under `src/features/v5/` |
|---|---|
| A | `a-home/home.tsx` (S1), `a-home/sessions.tsx` and `a-home/session.tsx` (S12), `a-home/import.tsx` (S13 sheet and `/import`), `a-home/shell.tsx` |
| B | `b-projects/projects.tsx` (S2), `b-projects/project.tsx` (S3), `b-projects/new-project.tsx` (S4), `b-projects/start-run.tsx`, `b-projects/trash.tsx` (S8), `b-projects/done-archive.tsx` (S9), `b-projects/shell.tsx` |
| C | `c-runs/run.tsx` (S5; it renders slice D's `ReviewStep` for `review`), `c-runs/group.tsx` (S7; it renders `GroupReviewStep`), `c-runs/shell.tsx` |
| D | `d-review/review.tsx` (S6: `ReviewStep`, `GroupReviewStep`), `d-review/shell.tsx` |
| E | `e-targets-plan-settings/targets.tsx` and `e-targets-plan-settings/target.tsx` (S10), `e-targets-plan-settings/plan.tsx` (S11), `e-targets-plan-settings/settings-equipment.tsx`, `e-targets-plan-settings/settings-goal-templates.tsx` and `e-targets-plan-settings/settings-naming.tsx` (S16), `e-targets-plan-settings/calibration.tsx` (S14), `e-targets-plan-settings/storage.tsx` (S15), `e-targets-plan-settings/activity.tsx` (S17), `e-targets-plan-settings/shell.tsx` |

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
