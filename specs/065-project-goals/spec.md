# Feature Specification: Projects, goals and Home

**Feature Branch**: `063-clean-rebuild-contract`

**Spec ID**: `065-project-goals`

**Created**: 2026-10-03

**Amended**: 2026-10-06, to the [workflow redesign](../063-clean-rebuild-contract/decisions.md#workflow-redesign-2026-10-06) decisions D-W1 through D-W71, and on 2026-10-07 to the answers D-W72 through D-W74.

**Status**: Draft; product defaults and all human-approval gate waivers follow the root autonomous objective. Requirements analysis, implementation and verification remain required.

**Input**: Clean rebuild with selective reuse of verified code and the agreed PlateVault product flow, as amended by the 2026-10-06 workflow decisions.

## User Scenarios & Testing

### User Story 1 - Projects, goals and Home (Priority: P1)

A Project is the required container for processing runs (Views). It names its subjects (Targets or mosaics), the rigs (optical trains) taking part, and goals per subject and channel. Its candidate sessions are derived from confirmed Target and rig, and its members come from its runs. Home is a dashboard that shows every Project's progress, stage and one Next action. When every run is Finished, the user wraps the Project up in one ordered flow: clean up runs, trash what is no longer needed, archive, then close the Project (D-W1, D-W3, D-W26, D-W39, D-W80).

**Why this priority**: This feature owns the workflow steps listed below without imposing unrelated product features.

**Independent Test**: Exercise the acceptance scenarios through the running product with isolated inputs. Existing baseline code does not prove the redesigned behavior.

**Acceptance Scenarios**:

- **PRJ-AC-01**: Given the NGC 7000 Target and a rig, when the user creates 'NGC 7000 HOO' with that rig and Ha 10h and OIII 10h goals, then NGC 7000 is prefilled as a subject and each goal shows two labelled numbers, "in project" and "captured". (D-W9, D-W36, D-W37)
- **PRJ-AC-02**: Given a Project is created and edited, then no file changed, no processing run exists, and every frame's quality state is unchanged. (D-W3)
- **PRJ-AC-03**: Given Ha reaches 10h "in project", when progress is recalculated, then that goal shows met and the Project stays open. Given instead 6h10 in project and 9h15 captured, the goal reads `Ha 6h10 in project · 9h15 captured · goal 10h` and stays unmet. (D-W36)
- **PRJ-AC-04**: Given candidate sessions from Backyard and a second site, then the Project shows each session with its own capture site and has no single-site field.
- **PRJ-AC-05**: Given unmet goals, when the user chooses "Start a processing run" and picks one subject and one rig of the Project, then the run is created inside the Project without changing any goal or closing the Project. (D-W1, D-W9, D-W37)
- **PRJ-AC-06**: Given a Project with runs and accepted Results, when the Project page opens, then it shows the subjects, rigs, goals, candidates, each run on a stage rail, the members and the Results, plus planning for its own subjects with "Open in Planner". Editing the Project, its subjects or its rigs does not change any run's membership. (D-W7, D-W16, D-W34, D-W37)
- **PRJ-AC-07**: Given integration, frame-count and quality-bar goals and a subject with missing calibration, when progress is calculated, then integration and frame counts show "in project" and "captured", the quality bar limits which members count in project, and missing calibration and exposure mismatch appear as warnings, not goals. No exposure-preference, equipment or mixed-equipment item exists. (D-W29)
- **PRJ-AC-08**: Withdrawn (D-W79). "Reject for this Project only" is removed; library quality is the only quality scope.
- **PRJ-AC-09**: Given sessions with confirmed Target NGC 7000 on rigs A and B, a session on rig A whose OBJECT header reads NGC 7000 but has no confirmed Target, and a Project with subject NGC 7000 and rig A, then the candidates are exactly the confirmed NGC 7000 sessions on rig A. Adding rig B adds its sessions; the unconfirmed session is never a candidate. (D-W33, D-W37)
- **PRJ-AC-10**: Given a candidate session, when it is saved into a run's membership revision, then it becomes a Project member and counts in project; when a later revision removes it, it stops counting. The Project offers no action that assigns a session to the Project itself. (D-W34)
- **PRJ-AC-11**: Given a run in Project P, when the user works in Project Q, then the run cannot be moved or shared into Q; Q can take P's accepted Results as inputs to a new run. A session can still be a candidate and member of both Projects through runs of each. (D-W8)
- **PRJ-AC-12**: Given a Project with subjects NGC 7000 and M 81 far apart, and M 82 recorded as "also in field" of the M 81 Target, then each subject has its own goals per channel, each run has exactly one subject, and sessions confirmed as M 81 count under the M 81 subject. (D-W9)
- **PRJ-AC-13**: Given a mosaic subject with two panels, then each panel has its own integration goals and counts the sessions assigned to it by pointing. A session flagged ambiguous or off-panel counts toward no panel until the user assigns it. (D-W29, D-W38)
- **PRJ-AC-14**: Given the built-in HOO template, when the user applies it to a Project, then Ha 10h and OIII 10h are copied into the Project as goals. A later edit of the template changes no Project, and the Project's copied goals stay editable. The template list is the same whatever rig the Project uses. (D-W30, D-W47)
- **PRJ-AC-15**: Given an open Project whose runs are all Finished and whose Trash holds one run, when the user opens Wrap up, then it shows Clean up runs → Trash → Archive with Clean up runs current. Trash offers "Move N rejected frames to Trash (size)", "Move N processing intermediates to Trash (size)" and "Move N duplicate copies to Trash (size)", and Wrap up offers Empty Trash for the one run. Archive stays read-only until Trash is Finished or Skipped. No file moves until the user confirms a step. Archive keeps every session that is a member of a run in another Project that is not Closed. Reaching every goal never closes a Project. (D-W26, D-W43, D-W46, D-W70, D-W72, D-W74, D-W80)
- **PRJ-AC-16**: Given an open Project in Wrap up whose candidates include library-Unusable frames. One library-Unusable frame is in a prepared revision of a run at Prepare in another Project, one is in a prepared revision of a Finished run, and one is a recorded input of a Result. When the Trash step lists the rejected-frames offer, then N counts the remaining library-Unusable frames, including the Finished run's frame, and the other two are listed as not selectable with their reasons. (D-W43, D-W79, D-W80)
- **PRJ-AC-17**: Given approved trashing, when it completes, then the files are in the OS Trash and nothing is permanently deleted. The Trashed records are hidden from candidates, run pickers, goals, totals, the Project page and Home. Put back from the OS Trash followed by a rescan restores each record as Unusable. (D-W43)
- **PRJ-AC-18**: Given indexed sessions and two Projects, when Home opens, then it shows the six sections of PRJ-FR-17 in order. The new-sessions section has four groups, "Needs a Target", "Not in a Project", "Unreviewed" and "Ready to add to a run", and each row has a one-click action. (D-W39)
- **PRJ-AC-19**: Given one Project in each Next state, when Home computes Next, then each Project shows the first rule of PRJ-FR-18 that applies. A Project whose subjects and rigs match sessions that still need review shows "N sessions need review", which opens Sessions filtered to Needs review. (D-W27, D-W35, D-W78)
- **PRJ-AC-20**: Given three sessions with no confirmed Target, and two sessions with a confirmed Target that are neither a Project's candidate nor a member of any Project's run. When Home opens, then the top line reads "3 sessions need a Target · 2 not in any Project", and each "not in a Project" row offers Create Project and Add to Project. (D-W35, D-W39, D-W45)
- **PRJ-AC-21**: Given a Project with one Finished run and one run at Prepare, when the user opens Wrap up, then it reads "Finish every run first · 1 open ▸", which leads to the run at Prepare. Once that run is Finished or moved to Trash, Wrap up opens at Clean up runs. After the Project is Closed, Reopen returns it to open with its runs, goals and members unchanged. (D-W46, D-W72, D-W80)
- **PRJ-AC-22**: Given one open and one Closed Project, when Home opens, then only the open Project is listed until the user turns on "Show done". (D-W48)
- **PRJ-AC-23**: Given an open Project with no matching session that needs review and a run whose calibration needs review. When Home computes Next, then that run is the blocked run of PRJ-FR-18 rule 2, opened at Calibrate. (D-W48, D-W78)
- **PRJ-AC-24**: Withdrawn (D-W72).
- **PRJ-AC-25**: Given rig Esprit and subject IC 1396 that no run uses, and rig RedCat and subject NGC 7000 used by one Finished run and one open run. When the user removes each from the Project, then removing Esprit and IC 1396 succeeds, and their sessions leave the candidates. Removing RedCat or NGC 7000 is refused, and each refusal names both runs. (D-W37, D-W65)
- **PRJ-AC-26**: Given a member session whose Target is re-confirmed as another Target, when progress is recalculated, then it still counts "in project" and "captured", and no goal shows "in project" above "captured". (D-W45, D-W66)
- **PRJ-AC-27**: Given a Closed Project whose Archive moved sessions S1 and S3, when the user chooses Reopen, then the Project is open again and no file moves. S1 and S3 show as Archived until the user restores them. (D-W69)
- **PRJ-AC-28**: Given a Project in Wrap up whose run Results folders hold 120 recognized intermediates, two accepted Results and an adopted master's generated source. When the Trash step opens, it offers "Move 121 processing intermediates to Trash (size)", counting the 120 intermediates and the generated source, which it lists as a verified duplicate that names the kept library copy. The accepted Results and the adopted library master are not offered. Proceeding with that offer selected moves all 121 under one confirmation. (D-W70, D-W80)
- **PRJ-AC-29**: Given runs Ha-only and HOO in one Project that hold different Ha sessions. One Ha-only member was re-confirmed as another Target and is no longer a candidate. When the user moves Ha-only to Trash, then its frames stop counting "in project". Its other members still count "captured" as candidates, and the re-confirmed session counts in neither. Ha-only leaves the stage rail and is listed in the Project's Trash list, no file moves, and no library frame or quality decision changes. After Restore, Ha-only is back on the stage rail at its stage, and both goal numbers read as they did before the move. (D-W45, D-W66, D-W72)
- **PRJ-AC-30**: Given a Project in Wrap up with three frames that have byte-identical extra copies. F1 has copies in Captures location A and in a Results location. F2 has copies in Captures location A and in Captures location B, which was registered later. F3 has copies in A and B, and its B copy is the source path of a Direct-source run at Prepare in another Project. When the Trash step opens, it offers "Move 2 duplicate copies to Trash (size)": the Results copy of F1 and the B copy of F2. It names the kept A copy of each frame and lists F3's B copy as not selectable with its reason. Every frame keeps its record, quality and memberships. (D-W43, D-W74, D-W80)
- **PRJ-AC-31**: Given a Project in Wrap up at the Trash step, when the user proceeds with nothing selected, then Trash reads Skipped and Archive becomes current. Expanding an Archive row lists each of its files with its from and to paths. The user reopens Trash from the step strip, selects the rejected frames and proceeds, and Archive reads Redo. When the user chooses Close project… on Archive, the confirmation lists the archive moves and the outcome of Clean up runs and Trash. The Project reads Closing while the archive transfer runs and Archived once it succeeds, and Wrap up is then read-only. (D-W77, D-W80)
- **PRJ-AC-36**: Given a Project whose runs are all Finished and whose Trash holds run R, when the Trash step of its Wrap up opens, then its fourth group reads "Empty Trash for 1 run (size)" with R's Results folder unticked. Confirming it runs Empty Trash for R under RES-FR-10, and an intermediate already moved from R's Finish run… confirmation is not offered again in the intermediates group. (D-W80)

### Edge Cases

The [root contract](../063-clean-rebuild-contract/spec.md) governs file custody, uncertainty, exact membership, failed writes, and independent lifecycle decisions. Each acceptance scenario tests observable outcomes; no mock acknowledgment counts as terminal success.

- A session whose OBJECT header names a subject but whose Target is not confirmed is not a candidate. Home lists it under "needs a Target". (D-W33, D-W35)
- A session with a confirmed subject Target on a rig the Project does not list is not a candidate. Adding that rig to the Project makes it one without changing any run. (D-W37)
- Removing a subject or a rig is refused while any run uses it, and the refusal names each run that uses it. (D-W9, D-W37, D-W65)
- A run member that stops being a candidate stays in its run and still counts "in project" and "captured". That happens only when the session's own Target or rig association changes, because the Project cannot remove a subject or rig that a run uses. The run's Refresh then flags the member "no longer matches subject" and offers to remove it (VSEL). (D-W45, D-W65, D-W66)
- Moving a run to the Project's Trash stops its members counting "in project" and "captured", unless they are still candidates, and Restore makes them count again. Neither moves a file or changes a library frame or quality decision. (D-W66, D-W72)
- Geometry never decides candidacy. It orders candidates and assigns mosaic panels; unknown geometry is listed for manual panel assignment, never read as zero distance. (D-W33, D-W38)
- A content-identical frame in two runs of one Project counts once in project.
- A drifted frame leaves "in project" until its reviewed bytes return or it is reconfirmed. Offline or unreadable frames keep their labelled last-observed contribution (root D19).
- A Trashed frame counts in neither "in project" nor "captured" for any Project. A frame trashed after its run was Finished still shows, marked "Trashed", in that run's fixed membership. (D-W43, D-W52)
- The interface never says "not in a run". (D-W36)

## Requirements

### Functional Requirements

- **PRJ-FR-01**: New Project takes a name, optional notes, one or more subjects, and one or more rigs. A subject is a Target or a mosaic, with no limit on how far apart subjects are; a mosaic defines its panels by centre and rotation. Opening New Project from a Target prefills that Target. A Project is required for every processing run, and never required for library inspection, Import or the Planner. (D-W1, D-W9, D-W16, D-W37, D-W38)
- **PRJ-FR-02**: A Project lists every rig taking part. Each run uses exactly one of them, so no run mixes equipment. Adding or removing a rig changes candidates only, never an existing run's membership. A rig cannot be removed while any run uses it; the refusal names each run that uses it. The Targets rig selector can choose "this Project's rigs". (D-W37, D-W65)
- **PRJ-FR-03**: Goals are set per subject and channel, and per panel for a mosaic subject. Goal kinds are integration per channel, frame count per channel, and a quality bar that names one criterion, for example a median FWHM limit or Usable frames only. A member without the measurement the quality bar needs reads unknown and does not count toward that goal. Exposure preference, equipment goals, spread over nights and Moon limits are not goal kinds. (D-W9, D-W29)
- **PRJ-FR-04**: Every integration and frame-count goal shows two labelled numbers. "in project" counts the frames in the latest saved memberships of the Project's runs outside its Trash, each content-identical frame once. It leaves out each run's exclusions, Trashed frames and frames the goal's quality bar does not admit. A member stays in "in project" after it stops being a candidate. "captured" counts the frames of all candidate sessions plus the members of the Project's runs outside its Trash, each content-identical frame once and Trashed frames aside, so "in project" never exceeds "captured". The members of a run in the Project's Trash stop counting in both, unless they are still candidates, and count again after Restore. Goal met and Home's Next action use "in project" only. An unmet goal never blocks starting a run, and met goals never close the Project. (D-W36, D-W43, D-W44, D-W45, D-W66, D-W72, D-W79)
- **PRJ-FR-05**: Creating or editing a Project writes only catalog Project records (subjects, rigs, goals, notes): no file changes, no run creation, no quality-state changes. (D-W3)
- **PRJ-FR-06**: A Project has no single capture site; its sessions keep their own capture sites.
- **PRJ-FR-07**: The Project page shows subjects, rigs, goals with progress and warnings, candidates, runs (mosaic run groups together) on a stage rail, members, accepted Results, and planning for its own subjects with "Open in Planner". (D-W7, D-W16, D-W38)
- **PRJ-FR-08**: A Project assigns no sessions itself. Candidates are derived and members are inherited from its runs' saved membership revisions; each candidate and member shows why it is one (subject, rig, run). Project edits and goal changes never rewrite source files, library quality decisions, or run membership. (D-W33, D-W34)
- **PRJ-FR-09**: A Project's candidates are every Ready session (LIB-FR-20) whose confirmed Target is one of its subjects and whose rig is one of its rigs. A session that still needs review is not a candidate. An OBJECT label alone confirms no Target. Trashed sessions and frames are never candidates. The Project hands a run's session picker the candidates of the run's subject on the run's rig. (D-W33, D-W37, D-W43, D-W78)
- **PRJ-FR-10**: "Start a processing run" asks for one subject and one rig of the Project and creates the run inside it. A run belongs to exactly one Project and cannot move to another; reuse across Projects goes through Results as inputs. A session may be a candidate or member of several Projects. (D-W1, D-W8, D-W9)
- **PRJ-FR-11**: Missing calibration and exposure mismatch are automatic warnings per subject and channel, computed from calibration-matching evidence (PV-CAL). They are not goals and never block a run. The product shows no mixed-equipment warning. (D-W29)
- **PRJ-FR-12**: Settings > Goal templates lists the built-in templates plus user templates the user can create, edit and delete. Each template defines its channels and goal values. The built-in templates and their values are:
  - HOO: Ha 10h and OIII 10h.
  - SHO: Ha, OIII and SII 10h each.
  - LRGB: L 6h, and R, G and B 2h each.
  - OSC broadband: 10h.
  - OSC dual-band: 15h.

  Applying a template to a Project copies its values into the Project, where they stand alone and stay editable. Templates are never filtered by rig. (D-W30, D-W47)
- **PRJ-FR-13**: Withdrawn (D-W79). Project-scoped rejects are removed; "in project" leaves out only run exclusions, Trashed frames and frames outside a goal's quality bar (PRJ-FR-04).
- **PRJ-FR-14**: Only the user closes a Project, and only through its **Wrap up**, a step flow (FR-024) that replaces the Done / Archive sheet. Wrap up opens once every run outside the Project's Trash is Finished; until then it reads "Finish every run first · N open ▸", leading to those runs. Its steps run in a fixed order: Clean up runs → Trash → Archive. A later step stays read-only until the earlier ones are Finished or Skipped, and an earlier step can be reopened until the Project is closed. Each step is a table of what it offers, with the recommended rows preselected, and each row expands to the exact files it moves; Archive rows show each file's from and to paths. Proceeding with nothing selected records a step Skipped, so every step, Archive included, is optional. A step with nothing left to offer says so, and Proceed records it Finished. A row that cannot be selected says why in its status, such as "Linked by {run} ▸", "Read-only", "Offline" or "Used by {project} ▸". Clean up runs lists the runs whose prepared view was kept (STO-FR-01). Trash holds the four groups of PRJ-FR-15; the fourth is Empty Trash for the runs in the Project's Trash (RES-FR-10). Archive lists the member sessions it moves (STO-FR-13). It keeps every session that is a member of a run in another Project that is not Closed, and being another Project's candidate does not count. PV-STO executes each step under the root custody and archive rules. Archive's Proceed is **Close project…**: its confirmation lists the archive moves and the outcome of the first two steps. The archive transfer runs in the background, and the Project reads Closing until it succeeds, then Archived, or Closed when nothing was archived. A Closed or Archived Project can be Reopened. Reopening moves no files, and archived sessions show as Archived until the user restores them. (D-W26, D-W46, D-W69, D-W72, D-W77, D-W80)
- **PRJ-FR-15**: Wrap up's Trash step is the only place that offers trashing capture frames or duplicate copies. Processing intermediates have two routes: this step, and an unticked option in a run's Finish run… confirmation that covers that run's own intermediates (RES-FR-06). A run's Results folder goes only when the user ticks it in Empty Trash (RES-FR-10). PV-PRJ owns what each offer covers and refuses; PV-STO executes the approved moves (STO-FR-14 to STO-FR-17). The step has four groups. It offers "Move N rejected frames to Trash (size)", covering the Project's candidate frames whose applicable library quality is Unusable. ChangedContent frames (LIB-FR-09) and Trashed frames are never included. It lists each refused frame with its reason: used in a prepared revision of a run that is not Finished (any Project), or a recorded input of a Result. It also offers "Move N processing intermediates to Trash (size)", covering the recognized intermediates (RES-FR-01) in the Results folders of the Project's runs. Accepted Results and adopted masters are kept, candidate masters stay protected (CAL-FR-06), and unknown files, unaccepted Result candidates and prepared entries are never included. It lists each refused intermediate with its reason, such as a recorded input of a Result. An adopted master's generated source counts in that N and moves under the same approval, listed as a verified duplicate that names the kept library copy. The Finish run… option applies the same coverage and refusals to one run, and an intermediate it moved is not offered again. The step also offers "Move N duplicate copies to Trash (size)", covering the byte-identical (SHA-256) extra physical copies of the Project's frames: its candidate and member frames and the calibration frames its runs use. It keeps one copy of each frame and names it. The kept copy is the one in a Captures or Calibration location, the earliest-registered such location when there are several, and otherwise the copy in the earliest-registered location. It refuses an extra copy that is the source of a prepared entry or a Direct-source path of a run that is not Finished (any Project), and lists each refused copy with its reason. Its fourth group is "Empty Trash for N runs (size)", covering every run in the Project's Trash, each with its Results folder unticked; confirming runs Empty Trash for them under RES-FR-10. All four groups follow the D-W43 trash rules: approved items go to the OS Trash only under the PV-STO custody rules, with no permanent delete. Every refusal is listed with its reason, including each custody refusal of STO-FR-15. (D-W43, D-W70, D-W72, D-W74, D-W79, D-W80)
- **PRJ-FR-16**: A Trashed record stays in the catalog for traceability. It is hidden from candidates, members, run pickers, goals, totals, the Project page and Home. Only the Sessions "Trashed" filter (PV-LIB) shows it, and so does the fixed membership of a run that was Finished when the frame was trashed, marked "Trashed". Put back from the OS Trash followed by a rescan restores the record as Unusable. (D-W43, D-W52)
- **PRJ-FR-17**: Home is a dashboard with six sections, in this order:
  1. Actions: Import, New Project, Plan tonight.
  2. Projects, each with goals ("in project" / "captured"), stage and one Next action. Closed Projects stay hidden behind a "Show done" filter.
  3. New sessions needing work, grouped as needs a Target, not in a Project, unreviewed, and ready to add to a run, each with a one-click action.
  4. Tonight: best windows for subjects and favourites, the Moon, and the darkness window (PV-PLAN, PLAN-FR-11).
  5. Target status: unmet goals and what each channel still needs in project.
  6. Running work. (D-W39, D-W48)
- **PRJ-FR-18**: A Project's Next action is the first rule that applies:
  1. Sessions that match its subjects and rigs still need review: "N sessions need review", which opens Sessions filtered to Needs review (LIB-FR-17).
  2. One of its runs is blocked: that run, opened at its blocked stage. A run is blocked when it waits on the user with unresolved inputs, calibration needing review, or a failed preparation. A run in the Project's Trash is never blocked.
  3. A goal is unmet in project and tonight has an observing window for that subject (PLAN-FR-11): "Plan tonight".
  4. Otherwise: "Start a processing run". (D-W27, D-W35, D-W48, D-W72)
- **PRJ-FR-19**: Home's top line reads "N sessions need a Target · M not in any Project". A session needs a Target when it has no confirmed Target. A session is not in any Project when it has a confirmed Target but is neither a Project's candidate nor a member of any Project's run. Its row offers Create Project, or Add to Project, which adds its Target as a subject and, when the Project lacks it, its rig. A visible note names the added rig before saving (LIB-FR-17). A session is ready to add to a run when it is a candidate of a Project but a member of none of that Project's runs. (D-W35, D-W37, D-W39, D-W45, D-W59)
- **PRJ-FR-20**: The Project page stage rail shows each run's stage: Select, Calibrate, Prepare, Results, Finished or Clean up. A run moved to the Project's Trash leaves the stage rail. The Project page's Trash list shows each run in the Trash with its stage and offers Restore and Empty Trash for it, plus Empty Trash for all of them (RES-FR-10). A Project is open until the user closes it; Archive follows Close, and Reopen returns a Closed or Archived Project to open. (D-W3, D-W7, D-W26, D-W46, D-W69, D-W72, D-W78)
- **PRJ-FR-21**: The interface calls a View a "processing run" and labels goal progress "in project" and "captured". It never says "not in a run" and never shows "in project" above "captured". (D-W3, D-W36, D-W66)

### Owned interaction steps

- B2
- Projects surface (Project page with stage rail and planning)
- Project Trash list
- Home dashboard
- Project Wrap up: Clean up runs → Trash → Archive, then Close project (D-W80)
- Settings > Goal templates

### Key Entities

Use the [root vocabulary](../063-clean-rebuild-contract/spec.md#key-entities). Feature-specific evidence and decisions retain their input identity, scope, and revision.

- **Subject**: A Target or a mosaic (panels by centre and rotation) that a Project names. Each run has exactly one. (D-W9, D-W38)
- **Project rig list**: The rigs taking part in a Project. (D-W37)
- **Goal**: An integration, frame-count or quality-bar target for one subject and channel, or one mosaic panel. (D-W29)
- **Goal template**: A built-in or user set of channels and values that is copied into a Project when applied. (D-W30)
- **Candidate**: A derived session: it is Ready (fully reviewed), its confirmed Target is a subject and its rig is a Project rig. (D-W33, D-W37, D-W78)
- **Member**: A session in the latest saved membership revision of at least one of the Project's runs outside its Trash. Moving a run to Trash suspends the membership it gave, Restore brings it back, and Empty Trash ends it. (D-W34, D-W66, D-W72)
- **Project state**: Open, Closed or Archived, with Archive after Close; Reopen returns a Closed Project to open, even after Archive, and moves no files. (D-W26, D-W46, D-W69)

## Success Criteria

### Measurable Outcomes

- **PV-PRJ-SC-01**: Every acceptance scenario produces its stated outcome and refusal behavior.
- **PV-PRJ-SC-02**: Every owned interaction step has a requirement and independently observable acceptance evidence.
- **PV-PRJ-SC-03**: Original inputs remain unchanged except through separately reviewed and approved filesystem operations.
- **PV-PRJ-SC-04**: In the candidate fixture, 100% of candidates have a confirmed subject Target and a Project rig, and zero sessions without a confirmed Target are candidates. (D-W33, D-W37)
- **PV-PRJ-SC-05**: Across Home fixtures for each Next state, the Next action matches the first applicable rule every time. (D-W35)
- **PV-PRJ-SC-06**: In the trash fixture, zero refused frames reach the OS Trash, and zero files are permanently deleted. (D-W43)

## Assumptions

- [Product flow](../../docs/reviews/2026-10-03-product-flow-and-journeys.md) supplies the confirmed interactions and illustrative worked example. Where it describes optional Projects, standalone Views or Targets as home, the 2026-10-06 decisions govern.
- This feature is independently specified; dependencies on other feature contracts are resolved in planning.
- Conservative defaults and all human-approval gate waivers follow the root autonomous objective and decision register. Tests, requirements analysis, independent review and delivery evidence remain mandatory.

## Decisions before feature approval

- Root decision D10, as amended by D-W36, D-W44, D-W66, D-W72 and D-W79, defines the two progress labels and the single, library-wide quality scope. Root decisions D01 and D12, as amended by D-W33, D-W34, D-W37 and D-W38, define candidates, members and mosaic panel assignment.
- Root decision D19 removes a drifted frame from Project progress until its reviewed bytes return or it is reconfirmed. Offline or unreadable frames keep their labelled last-observed contribution.
- The workflow decisions D-W1, D-W3, D-W7, D-W8, D-W9, D-W16, D-W26, D-W27, D-W29, D-W30, D-W33 to D-W37, D-W39, D-W42 to D-W48, D-W50, D-W52, D-W54, D-W59, D-W65, D-W66, D-W69, D-W70, D-W72 and D-W74 are encoded above.
- Workflow decisions D-W78 and D-W79 (Round 9, 2026-10-12) make only fully reviewed (Ready) sessions candidates and remove the Project-only reject.
- Workflow decision D-W80 (Round 9, 2026-10-12) replaces the Done / Archive sheet with Wrap up (PRJ-FR-14): a strict Clean up runs → Trash → Archive flow with every step optional, ending in Close project.
