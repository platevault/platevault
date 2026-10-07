# Feature Specification: Projects, goals and Home

**Feature Branch**: `063-clean-rebuild-contract`

**Spec ID**: `065-project-goals`

**Created**: 2026-10-03

**Amended**: 2026-10-06, to the [workflow redesign](../063-clean-rebuild-contract/decisions.md#workflow-redesign-2026-10-06) decisions D-W1 through D-W71.

**Status**: Draft; product defaults and all human-approval gate waivers follow the root autonomous objective. Requirements analysis, implementation and verification remain required.

**Input**: Clean rebuild with selective reuse of verified code and the agreed PlateVault product flow, as amended by the 2026-10-06 workflow decisions.

## User Scenarios & Testing

### User Story 1 - Projects, goals and Home (Priority: P1)

A Project is the required container for processing runs (Views). It names its subjects (Targets or mosaics), the rigs (optical trains) taking part, and goals per subject and channel. Its candidate sessions are derived from confirmed Target and rig, and its members come from its runs. Home is a dashboard that shows every Project's progress, stage and one Next action. When a Project is finished, the user marks it Done and decides on Archive and on trashing rejected frames in one sheet (D-W1, D-W3, D-W26, D-W39).

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
- **PRJ-AC-08**: Given a library-Usable member frame, when the user chooses "Reject for this Project only", then this Project's "in project" decreases while its "captured", the frame's library quality, other Projects' progress and every run's membership stay unchanged. (D-W42)
- **PRJ-AC-09**: Given sessions with confirmed Target NGC 7000 on rigs A and B, a session on rig A whose OBJECT header reads NGC 7000 but has no confirmed Target, and a Project with subject NGC 7000 and rig A, then the candidates are exactly the confirmed NGC 7000 sessions on rig A. Adding rig B adds its sessions; the unconfirmed session is never a candidate. (D-W33, D-W37)
- **PRJ-AC-10**: Given a candidate session, when it is saved into a run's membership revision, then it becomes a Project member and counts in project; when a later revision removes it, it stops counting. The Project offers no action that assigns a session to the Project itself. (D-W34)
- **PRJ-AC-11**: Given a run in Project P, when the user works in Project Q, then the run cannot be moved or shared into Q; Q can take P's accepted Results as inputs to a new run. A session can still be a candidate and member of both Projects through runs of each. (D-W8)
- **PRJ-AC-12**: Given a Project with subjects NGC 7000 and M 81 far apart, and M 82 recorded as "also in field" of the M 81 Target, then each subject has its own goals per channel, each run has exactly one subject, and sessions confirmed as M 81 count under the M 81 subject. (D-W9)
- **PRJ-AC-13**: Given a mosaic subject with two panels, then each panel has its own integration goals and counts the sessions assigned to it by pointing. A session flagged ambiguous or off-panel counts toward no panel until the user assigns it. (D-W29, D-W38)
- **PRJ-AC-14**: Given the built-in HOO template, when the user applies it to a Project, then Ha 10h and OIII 10h are copied into the Project as goals. A later edit of the template changes no Project, and the Project's copied goals stay editable. The template list is the same whatever rig the Project uses. (D-W30, D-W47)
- **PRJ-AC-15**: Given an open Project whose runs are all Complete or Abandoned, when the user marks it Done, then its Done / Archive sheet opens with Archive, "Move N rejected frames to Trash (size)" and "Move N processing intermediates to Trash (size)". No file moves until the user approves an action. Archive keeps every session that is a member of a run in another Project not marked Done. Reaching every goal never marks a Project Done. (D-W26, D-W43, D-W46, D-W64, D-W70)
- **PRJ-AC-16**: Given a Done Project whose candidates include library-Unusable frames and Project-only rejects. One library-Unusable frame is in a prepared revision of a run at Prepare in another Project, one is in a prepared revision of an Abandoned run, and one is a recorded input of a Result. When the sheet lists the trash offer, then N counts the remaining library-Unusable frames plus the Abandoned run's frame. Project-only rejects are absent, and the other two are listed as refused with their reasons. (D-W42, D-W43, D-W71)
- **PRJ-AC-17**: Given approved trashing, when it completes, then the files are in the OS Trash and nothing is permanently deleted. The Trashed records are hidden from candidates, run pickers, goals, totals, the Project page and Home. Put back from the OS Trash followed by a rescan restores each record as Unusable. (D-W43)
- **PRJ-AC-18**: Given indexed sessions and two Projects, when Home opens, then it shows the six sections of PRJ-FR-17 in order. The new-sessions section has four groups, "Needs a Target", "Not in a Project", "Unreviewed" and "Ready to add to a run", and each row has a one-click action. (D-W39)
- **PRJ-AC-19**: Given one Project in each Next state, when Home computes Next, then each Project shows the first rule of PRJ-FR-18 that applies. A Project whose candidates have Unreviewed frames shows "Review N new frames", which opens frame review filtered to Unreviewed. (D-W27, D-W35)
- **PRJ-AC-20**: Given three sessions with no confirmed Target, and two sessions with a confirmed Target that are neither a Project's candidate nor a member of any Project's run. When Home opens, then the top line reads "3 sessions need a Target · 2 not in any Project", and each "not in a Project" row offers Create Project and Add to Project. (D-W35, D-W39, D-W45)
- **PRJ-AC-21**: Given a Project with one Complete run and one run at Prepare, when the user chooses Mark Done, then PlateVault names the run at Prepare. It asks the user to complete or abandon that run, and the Project stays open until no run is left open. After the Project is Done, Reopen returns it to open with its runs, goals and members unchanged. (D-W46, D-W64)
- **PRJ-AC-22**: Given one open and one Done Project, when Home opens, then only the open Project is listed until the user turns on "Show done". (D-W48)
- **PRJ-AC-23**: Given an open Project with no Unreviewed candidate frames and a run whose calibration needs review. When Home computes Next, then that run is the blocked run of PRJ-FR-18 rule 2, opened at Calibrate. (D-W48)
- **PRJ-AC-24**: Given runs Ha-only and HOO in one Project that hold different Ha sessions, when the user marks Ha-only Abandoned at Calibrate, then its frames stop counting "in project" and its members still count "captured". Ha-only reads Abandoned on the stage rail and accepts no membership change. After Reopen it is back at Calibrate and its frames count "in project" again. (D-W64, D-W66, D-W71)
- **PRJ-AC-25**: Given rig Esprit and subject IC 1396 used only by an Abandoned run, and rig RedCat and subject NGC 7000 used by a Complete run. When the user removes each from the Project, then removing Esprit and IC 1396 succeeds. Removing RedCat or NGC 7000 is refused, and each refusal names the Complete run. Reopening the Abandoned run is then refused, and the refusal names Esprit and IC 1396 to add back. Once both are back on the Project, Reopen returns the run to the stage it was in. (D-W50, D-W65, D-W71)
- **PRJ-AC-26**: Given a member session whose Target is re-confirmed as another Target, when progress is recalculated, then it still counts "in project" and "captured", and no goal shows "in project" above "captured". (D-W45, D-W66)
- **PRJ-AC-27**: Given a Done Project whose Archive moved sessions S1 and S3, when the user chooses Reopen, then the Project is open again and no file moves. S1 and S3 show as Archived until the user restores them. (D-W69)
- **PRJ-AC-28**: Given a Done Project whose run Results folders hold 120 recognized intermediates, two accepted Results and an adopted master's generated source. When the Done / Archive sheet opens, it offers "Move 121 processing intermediates to Trash (size)", counting the 120 intermediates and the generated source, which it lists as a verified duplicate that names the kept library copy. The accepted Results and the adopted library master are not offered. Approving the offer moves all 121 under that one approval. (D-W70)

### Edge Cases

The [root contract](../063-clean-rebuild-contract/spec.md) governs file custody, uncertainty, exact membership, failed writes, and independent lifecycle decisions. Each acceptance scenario tests observable outcomes; no mock acknowledgment counts as terminal success.

- A session whose OBJECT header names a subject but whose Target is not confirmed is not a candidate. Home lists it under "needs a Target". (D-W33, D-W35)
- A session with a confirmed subject Target on a rig the Project does not list is not a candidate. Adding that rig to the Project makes it one without changing any run. (D-W37)
- Removing a subject or a rig is refused while any run that is not Abandoned uses it, and the refusal names the run. Reopen of an Abandoned run is refused while its subject or rig is not on the Project, and the refusal names the subject or rig to add back. (D-W9, D-W37, D-W50, D-W65, D-W71)
- A run member that stops being a candidate stays in its run and still counts "in project" and "captured". For a run that is not Abandoned, this happens only when the session's own Target or rig association changes, because the Project cannot remove that run's subject or rig. That run's Refresh then flags the member "no longer matches subject" and offers to remove it (VSEL). Removing a subject or rig that no run, or only an Abandoned run, uses takes the matching sessions out of the candidates. An Abandoned run's members still count "captured". (D-W45, D-W65, D-W66, D-W71)
- Geometry never decides candidacy. It orders candidates and assigns mosaic panels; unknown geometry is listed for manual panel assignment, never read as zero distance. (D-W33, D-W38)
- A content-identical frame in two runs of one Project counts once in project.
- A drifted frame leaves "in project" until its reviewed bytes return or it is reconfirmed. Offline or unreadable frames keep their labelled last-observed contribution (root D19).
- A Trashed frame counts in neither "in project" nor "captured" for any Project. A frame trashed after its run was Complete or Abandoned still shows, marked "Trashed", in that run's fixed membership. (D-W43, D-W52, D-W71)
- A Project-only reject never enters the trash offer, even when the Project is Done. (D-W42, D-W43)
- The interface never says "not in a run". (D-W36)

## Requirements

### Functional Requirements

- **PRJ-FR-01**: New Project takes a name, optional notes, one or more subjects, and one or more rigs. A subject is a Target or a mosaic, with no limit on how far apart subjects are; a mosaic defines its panels by centre and rotation. Opening New Project from a Target prefills that Target. A Project is required for every processing run, and never required for library inspection, Import or the Planner. (D-W1, D-W9, D-W16, D-W37, D-W38)
- **PRJ-FR-02**: A Project lists every rig taking part. Each run uses exactly one of them, so no run mixes equipment. Adding or removing a rig changes candidates only, never an existing run's membership. A rig cannot be removed while any run that is not Abandoned uses it; the refusal names the run. An Abandoned run whose rig or subject was removed keeps both and cannot be Reopened until both are back on the Project (RES-FR-09). The Targets rig selector can choose "this Project's rigs". (D-W37, D-W50, D-W65, D-W71)
- **PRJ-FR-03**: Goals are set per subject and channel, and per panel for a mosaic subject. Goal kinds are integration per channel, frame count per channel, and a quality bar that names one criterion, for example a median FWHM limit or Usable frames only. A member without the measurement the quality bar needs reads unknown and does not count toward that goal. Exposure preference, equipment goals, spread over nights and Moon limits are not goal kinds. (D-W9, D-W29)
- **PRJ-FR-04**: Every integration and frame-count goal shows two labelled numbers. "in project" counts the frames in the latest saved memberships of the Project's runs that are not Abandoned, each content-identical frame once. It leaves out each run's exclusions, frames rejected for this Project, Trashed frames and frames the goal's quality bar does not admit. A member stays in "in project" after it stops being a candidate. "captured" counts the frames of all candidate sessions plus the members of every Project run, Abandoned runs included, each content-identical frame once and Trashed frames aside, so "in project" never exceeds "captured". Goal met and Home's Next action use "in project" only. An unmet goal never blocks starting a run, and met goals never mark the Project Done. (D-W36, D-W42, D-W43, D-W44, D-W45, D-W64, D-W66, D-W71)
- **PRJ-FR-05**: Creating or editing a Project writes only catalog Project records (subjects, rigs, goals, notes): no file changes, no run creation, no quality-state changes. (D-W3)
- **PRJ-FR-06**: A Project has no single capture site; its sessions keep their own capture sites.
- **PRJ-FR-07**: The Project page shows subjects, rigs, goals with progress and warnings, candidates, runs (mosaic run groups together) on a stage rail, members, accepted Results, and planning for its own subjects with "Open in Planner". (D-W7, D-W16, D-W38)
- **PRJ-FR-08**: A Project assigns no sessions itself. Candidates are derived and members are inherited from its runs' saved membership revisions; each candidate and member shows why it is one (subject, rig, run). Project edits and goal changes never rewrite source files, library quality decisions, or run membership. (D-W33, D-W34)
- **PRJ-FR-09**: A Project's candidates are every session whose confirmed Target is one of its subjects and whose rig is one of its rigs. An OBJECT label alone confirms no Target. Trashed sessions and frames are never candidates. The Project hands a run's session picker the candidates of the run's subject on the run's rig. (D-W33, D-W37, D-W43)
- **PRJ-FR-10**: "Start a processing run" asks for one subject and one rig of the Project and creates the run inside it. A run belongs to exactly one Project and cannot move to another; reuse across Projects goes through Results as inputs. A session may be a candidate or member of several Projects. (D-W1, D-W8, D-W9)
- **PRJ-FR-11**: Missing calibration and exposure mismatch are automatic warnings per subject and channel, computed from calibration-matching evidence (PV-CAL). They are not goals and never block a run. The product shows no mixed-equipment warning. (D-W29)
- **PRJ-FR-12**: Settings > Goal templates lists the built-in templates plus user templates the user can create, edit and delete. Each template defines its channels and goal values. The built-in templates and their values are:
  - HOO: Ha 10h and OIII 10h.
  - SHO: Ha, OIII and SII 10h each.
  - LRGB: L 6h, and R, G and B 2h each.
  - OSC broadband: 10h.
  - OSC dual-band: 15h.

  Applying a template to a Project copies its values into the Project, where they stand alone and stay editable. Templates are never filtered by rig. (D-W30, D-W47)
- **PRJ-FR-13**: "Reject for this Project only" is a secondary action in frame review (PIX-FR-14) that writes a Project-scoped reject. It excludes the frame from this Project's "in project" only. It never changes library quality (P/X/U), "captured", other Projects, saved run membership, or trash eligibility; in an open run's Review step it removes the frame from that run's draft under D-W54 (VSEL-FR-15). (D-W42, D-W54)
- **PRJ-FR-14**: Only the user marks a Project Done. Mark Done first names each run that is neither Complete nor Abandoned and asks the user to complete or abandon it. Done opens the Project's Done / Archive sheet (STO-FR-13, STO-FR-14, STO-FR-16), which offers Archive and the two trash offers. Archive keeps every session that is a member of a run in another Project not marked Done; being another Project's candidate does not count. PV-STO executes it under the root archive rules. A Done Project can be Reopened, even after Archive. Reopening moves no files, and archived sessions show as Archived until the user restores them. (D-W26, D-W46, D-W64, D-W69)
- **PRJ-FR-15**: The Done / Archive sheet is the only place that offers trashing capture frames or processing intermediates. PV-PRJ owns what each offer covers and refuses; PV-STO executes the approved moves (STO-FR-14 to STO-FR-16). The sheet offers "Move N rejected frames to Trash (size)", covering the Project's candidate frames whose applicable library quality is Unusable. Project-only rejects, ChangedContent frames (LIB-FR-09) and Trashed frames are never included. It lists each refused frame with its reason: used in a prepared revision of a run that is neither Complete nor Abandoned (any Project), or a recorded input of a Result. It also offers "Move N processing intermediates to Trash (size)", covering the recognized intermediates (RES-FR-01) in the Results folders of the Project's runs. Accepted Results and adopted masters are kept, candidate masters stay protected (CAL-FR-06), and unknown files, unaccepted Result candidates and prepared entries are never included. It lists each refused intermediate with its reason, such as a recorded input of a Result. An adopted master's generated source counts in that N and moves under the same approval, listed as a verified duplicate that names the kept library copy. Both offers follow the D-W43 trash rules: approved items go to the OS Trash only under the PV-STO custody rules, with no permanent delete. Every refusal is listed with its reason, including each custody refusal of STO-FR-15. (D-W43, D-W70, D-W71)
- **PRJ-FR-16**: A Trashed record stays in the catalog for traceability. It is hidden from candidates, members, run pickers, goals, totals, the Project page and Home. Only the Sessions "Trashed" filter (PV-LIB) shows it, and so does the fixed membership of a run that was Complete or Abandoned when the frame was trashed, marked "Trashed". Put back from the OS Trash followed by a rescan restores the record as Unusable. (D-W43, D-W52, D-W71)
- **PRJ-FR-17**: Home is a dashboard with six sections, in this order:
  1. Actions: Import, New Project, Plan tonight.
  2. Projects, each with goals ("in project" / "captured"), stage and one Next action. Done Projects stay hidden behind a "Show done" filter.
  3. New sessions needing work, grouped as needs a Target, not in a Project, unreviewed, and ready to add to a run, each with a one-click action.
  4. Tonight: best windows for subjects and favourites, the Moon, and the darkness window (PV-PLAN, PLAN-FR-11).
  5. Target status: unmet goals and what each channel still needs in project.
  6. Running work. (D-W39, D-W48)
- **PRJ-FR-18**: A Project's Next action is the first rule that applies:
  1. Its candidates have Unreviewed frames: "Review N new frames", which opens frame review filtered to Unreviewed (PIX-FR-18).
  2. One of its runs is blocked: that run, opened at its blocked stage. A run is blocked when it waits on the user with unresolved inputs, calibration needing review, or a failed preparation. An Abandoned run is never blocked.
  3. A goal is unmet in project and tonight has an observing window for that subject (PLAN-FR-11): "Plan tonight".
  4. Otherwise: "Start a processing run". (D-W27, D-W35, D-W48, D-W64)
- **PRJ-FR-19**: Home's top line reads "N sessions need a Target · M not in any Project". A session needs a Target when it has no confirmed Target. A session is not in any Project when it has a confirmed Target but is neither a Project's candidate nor a member of any Project's run. Its row offers Create Project, or Add to Project, which adds its Target as a subject and, when the Project lacks it, its rig. A visible note names the added rig before saving (LIB-FR-17). A session is ready to add to a run when it is a candidate of a Project but a member of none of that Project's runs. (D-W35, D-W37, D-W39, D-W45, D-W59)
- **PRJ-FR-20**: The Project page stage rail shows each run's stage: Select, Review, Calibrate, Prepare, Results, Done, Clean up or Abandoned. A Project is open until the user marks it Done; Archive follows Done, and Reopen returns a Done or archived Project to open. (D-W3, D-W7, D-W26, D-W46, D-W64, D-W69)
- **PRJ-FR-21**: The interface calls a View a "processing run" and labels goal progress "in project" and "captured". It never says "not in a run" and never shows "in project" above "captured". (D-W3, D-W36, D-W66)

### Owned interaction steps

- B2
- Projects surface (Project page with stage rail and planning)
- Home dashboard
- Project Done / Archive sheet
- Settings > Goal templates

### Key Entities

Use the [root vocabulary](../063-clean-rebuild-contract/spec.md#key-entities). Feature-specific evidence and decisions retain their input identity, scope, and revision.

- **Subject**: A Target or a mosaic (panels by centre and rotation) that a Project names. Each run has exactly one. (D-W9, D-W38)
- **Project rig list**: The rigs taking part in a Project. (D-W37)
- **Goal**: An integration, frame-count or quality-bar target for one subject and channel, or one mosaic panel. (D-W29)
- **Goal template**: A built-in or user set of channels and values that is copied into a Project when applied. (D-W30)
- **Candidate**: A derived session: confirmed Target is a subject and rig is a Project rig. (D-W33, D-W37)
- **Member**: A session in the latest saved membership revision of at least one of the Project's runs. A member of an Abandoned run counts toward "captured" but not "in project". (D-W34, D-W64, D-W66, D-W71)
- **Project-only reject**: A Project-scoped reject that affects only that Project's "in project". (D-W42)
- **Project state**: Open or Done, with Archive after Done; Reopen returns a Done Project to open, even after Archive, and moves no files. (D-W26, D-W46, D-W69)

## Success Criteria

### Measurable Outcomes

- **PV-PRJ-SC-01**: Every acceptance scenario produces its stated outcome and refusal behavior.
- **PV-PRJ-SC-02**: Every owned interaction step has a requirement and independently observable acceptance evidence.
- **PV-PRJ-SC-03**: Original inputs remain unchanged except through separately reviewed and approved filesystem operations.
- **PV-PRJ-SC-04**: In the candidate fixture, 100% of candidates have a confirmed subject Target and a Project rig, and zero sessions without a confirmed Target are candidates. (D-W33, D-W37)
- **PV-PRJ-SC-05**: Across Home fixtures for each Next state, the Next action matches the first applicable rule every time. (D-W35)
- **PV-PRJ-SC-06**: In the trash fixture, zero Project-only rejects and zero refused frames reach the OS Trash, and zero files are permanently deleted. (D-W43)

## Assumptions

- [Product flow](../../docs/reviews/2026-10-03-product-flow-and-journeys.md) supplies the confirmed interactions and illustrative worked example. Where it describes optional Projects, standalone Views or Targets as home, the 2026-10-06 decisions govern.
- This feature is independently specified; dependencies on other feature contracts are resolved in planning.
- Conservative defaults and all human-approval gate waivers follow the root autonomous objective and decision register. Tests, requirements analysis, independent review and delivery evidence remain mandatory.

## Decisions before feature approval

- Root decision D10, as amended by D-W36, D-W42, D-W44, D-W64 and D-W66, defines the two progress labels and the two quality scopes. Root decisions D01 and D12, as amended by D-W33, D-W34, D-W37 and D-W38, define candidates, members and mosaic panel assignment.
- Root decision D19 removes a drifted frame from Project progress until its reviewed bytes return or it is reconfirmed. Offline or unreadable frames keep their labelled last-observed contribution.
- The workflow decisions D-W1, D-W3, D-W7, D-W8, D-W9, D-W16, D-W26, D-W27, D-W29, D-W30, D-W33 to D-W37, D-W39, D-W42 to D-W48, D-W50, D-W52, D-W54, D-W59, D-W64 to D-W66 and D-W69 to D-W71 are encoded above.
