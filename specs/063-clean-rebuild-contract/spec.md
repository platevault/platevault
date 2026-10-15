# Feature Specification: Clean rebuild product contract

**Feature Branch**: `063-clean-rebuild-contract`

**Created**: 2026-10-03

**Status**: Draft; conservative product decisions and all human-approval gate waivers are authorized. Requirements analysis and implementation verification remain required.

**Input**: Rebuild PlateVault cleanly, preserve the old code as a recoverable reference, and reuse code where it satisfies the agreed product contract.

The [product flow](../../docs/reviews/2026-10-03-product-flow-and-journeys.md) supplies the interaction details and worked example. The [workflow redesign](decisions.md#workflow-redesign-2026-10-06) of 2026-10-06 (decisions D-W1 through D-W74) amends it: every processing run (View) belongs to a Project, and Home is a dashboard rather than the Targets list. Where the product flow and a D-W decision disagree, the decision governs. This specification defines shared behavior and feature ownership. It does not authorize product implementation or claim that the redesigned flows run.

## User Scenarios & Testing

### User Story 1 - Inspect captures without reorganizing files (Priority: P1)

The user registers capture folders and inspects their sessions while indexing proceeds. A Project and a processing application are optional for inspection, Import and planning; only a processing run needs a Project (D-W1).

**Why this priority**: Library inspection is the first useful workflow and requires no file mutation.

**Independent Test**: Register a capture folder, index its headers, and inspect sessions without creating a Project or a processing run (View).

**Acceptance Scenarios**:

1. **Given** only a Captures location, **When** onboarding continues without Calibration or Results locations, **Then** indexing is available and the omitted roles show as unset.
2. **Given** Ha and OIII captures from one night, **When** indexing completes, **Then** separate metadata-homogeneous sessions appear; grouping the display by night preserves those boundaries.
3. **Given** a registered folder, **When** indexing and catalog corrections complete, **Then** source paths and bytes remain unchanged.
4. **Given** an unreadable descendant or an offline location, **When** indexing runs, **Then** its unobserved files retain last-observed information and show uncertainty rather than Missing.

### User Story 2 - Review a processing run's input selection (Priority: P1)

The user creates a Project with a subject and a rig, starts a processing run in it, selects sessions from the run's candidates, saves the run, and prepares exact inputs for an external application. Every candidate session was fully reviewed when it came in, so the run reviews no frames (D-W1, D-W3, D-W37, D-W78).

**Why this priority**: An exact handoff makes library inspection useful. The Project is a light container: a name, its subjects and its rigs are enough to start a run.

**Independent Test**: Create a Project with one subject and one rig, start a run, review its membership, prepare supported inputs, and open the application after verification.

**Acceptance Scenarios**:

1. **Given** selected sessions, **When** filters, sort order, or paging change, **Then** the selected identities remain fixed and hidden selected rows are counted.
2. **Given** six excluded frames, **When** the run is saved, **Then** those files remain on disk and other runs and library quality decisions remain unchanged. (D-W3)
3. **Given** a run whose membership excludes frames of a session, **When** it is prepared, **Then** its run folder holds Symlinks or Copies of the members only, so the application never reads an excluded frame. (D-W3, D-W81)
4. **Given** selected inputs become unreadable during preparation, **When** the operation settles, **Then** blocked inputs are named and verified Open is unavailable.
5. **Given** a destination collision, **When** preparation is reviewed, **Then** unrelated existing entries remain unchanged and require another path or a revised plan.
6. **Given** no Project exists, **When** the user tries to start a processing run, **Then** the product asks for a Project (new or existing), one of its subjects and one of its rigs before the run exists; no standalone run is created. (D-W1, D-W8, D-W9, D-W37)
7. **Given** a Project with rigs A and B, **When** a run on rig A opens its session picker, **Then** only candidate sessions of the run's subject captured with rig A are offered. (D-W33, D-W37)

### User Story 3 - Review measurements without changing capture data (Priority: P2)

The user inspects pixels and measurements while retaining the original scientific samples. Display settings do not influence measured quality.

**Why this priority**: Measurements support review decisions but do not replace the user's judgment.

**Independent Test**: Inspect a frame, change display stretch, select a star, and compare native and imported measurement provenance.

**Acceptance Scenarios**:

1. **Given** a frame with valid measurements, **When** display stretch changes, **Then** measurement values and source bytes remain unchanged.
2. **Given** a failed or saturated-star fit, **When** its details open, **Then** failure and warnings are visible without a substitute fitted-width number.
3. **Given** ambiguous imported measurement rows, **When** import is reviewed, **Then** mappings require confirmation and no rejection or membership decision is imported.
4. **Given** computed measurements, **When** review completes, **Then** no frame becomes Usable or excluded without a separate scoped action.

### User Story 4 - Finish processing and recover storage safely (Priority: P2)

The user accepts reusable products, finishes a run, and chooses its Clean up independently. When every run is Finished, the user wraps the Project up in one ordered flow, Clean up runs → Trash → Archive, and closes it at the end (D-W26, D-W43, D-W80).

**Why this priority**: Completion must not hide unaccepted outputs or authorize file removal.

**Independent Test**: Finish a run with no Result, review its Clean up, interrupt an archive transfer, and review the Project's trash offer using disposable fixtures.

**Acceptance Scenarios**:

1. **Given** no accepted Result, **When** the user finishes the run, **Then** the run becomes Finished, and only the run view the user left selected in the confirmation is removed. (D-W26, D-W81)
2. **Given** a run prepared with links and copies, with accepted products and unknown files in its Results folder, **When** the user chooses Finish run…, **Then** its confirmation offers removing only the run's prepared links and copies, with the copies ticked and the links unticked. The products and unknown files stay off the list. (D-W26, D-W81)
3. **Given** a location without safe OS Trash support, **When** approved cleanup runs, **Then** affected files are retained and no permanent-delete fallback executes.
4. **Given** an archive verification or reference-repair failure, **When** transfer settles, **Then** sources are retained and completed, pending, and uncertain phases remain visible.
5. **Given** a Project whose runs are all Finished, **When** the user opens Wrap up, **Then** it shows Clean up runs, Trash and Archive in that order, with "Move N rejected frames to Trash (size)" in Trash. Archive keeps every session that is a member of a run in another Project that is not Closed. Nothing moves until the user confirms a step, and the Project closes only from Archive's Close project…. (D-W26, D-W43, D-W46, D-W80)
6. **Given** the trash offer, **When** its frames are listed, **Then** it covers only the Project's candidate frames that are library-Unusable and lists each refused frame with its reason. (D-W43, D-W79)

### User Story 5 - Plan observing independently of processing (Priority: P2)

The user chooses a planning site, reviews observing windows, and explicitly opts into reminders or exports a calendar snapshot.

**Why this priority**: Planning supports capture goals without changing library membership or starting processing. The Planner works on Targets and needs no Project (D-W16).

**Independent Test**: Switch planning sites, enable default-site reminders explicitly, and export selected windows.

**Acceptance Scenarios**:

1. **Given** sessions from multiple capture sites, **When** the planning site changes, **Then** session sites and Project membership remain unchanged.
2. **Given** reminders disabled, **When** the user browses plans, **Then** no reminders or indexing jobs start.
3. **Given** selected observing windows, **When** calendar export is confirmed, **Then** the snapshot contains exactly those windows with the displayed site and time-zone basis.
4. **Given** a Project page, **When** it opens, **Then** it shows planning for its own subjects with "Open in Planner", and the Planner itself lists Targets regardless of Projects. (D-W16)

### User Story 6 - Work Projects from the Home dashboard (Priority: P1)

The user opens Home and sees, on one page, what needs them, what is running and when to capture next: pending ingestions, pending work, open work with each Project's next step, status, tonight's goals and a five-week calendar. Each row opens the page that owns it (D-W35, D-W89).

**Why this priority**: Home is the control panel for capture and processing. It must show what to do next without hiding the library.

**Independent Test**: Index sessions for two Projects plus one session with no confirmed Target, then read Home's sections and Next actions.

**Acceptance Scenarios**:

1. **Given** indexed sessions, **When** Home opens at 1280 px or wider, **Then** it shows Pending ingestions, Pending work and Open work in the left column and Status, Tonight and the calendar in the right column, each with at most 5 rows and then "All N ›". (D-W89)
2. **Given** three sessions with no confirmed Target and two with a confirmed Target that no Project lists, **When** Home opens, **Then** Pending work lists the three under needs a Target and the two under not in a Project, and Home shows no summary line above its sections. (D-W35, D-W89)
3. **Given** a Project whose subjects and rigs match sessions that still need review, and a blocked run, **When** Home computes its Next action, **Then** it shows "N sessions need review", which opens Sessions filtered to Needs review. (D-W27, D-W35, D-W78)
4. **Given** a goal of Ha 10h with 6h10 in the Project's runs and 9h15 across all candidates and run members, **When** progress shows, **Then** it reads "Ha 6h10 in project · 9h15 captured · goal 10h", and the goal is unmet. (D-W36, D-W66)

### Edge Cases

- Missing OBJECT never substitutes for missing coordinates or controls capture identity. A session without a confirmed Target is never a candidate; Home lists it under "need a Target". (D-W33, D-W35)
- Unknown geometry does not become zero distance or automatic inclusion. Geometry never decides candidacy; it orders candidates and assigns mosaic panels. (D-W33, D-W38)
- A session captured with a rig the Project does not list is not a candidate, even when its confirmed Target is a subject. (D-W37)
- A Trashed frame disappears from candidates, run pickers, frame review, goals, totals and Home. The Sessions "Trashed" filter shows it, and so does the fixed membership of a run that was Finished when the frame was trashed, marked "Trashed". (D-W43, D-W52)
- Failed catalog writes remain visibly unsaved with Retry.
- Start acknowledgments do not imply durable operation success.
- Refresh never removes an offline member as though it were absent.
- Source corrections never patch originals or write through prepared links.
- Cleanup never follows link targets or removes the last retained copy without proof.
- External application exit does not imply processing success or run completion. (D-W3)

## Requirements

### Functional Requirements

- **FR-001**: The product MUST allow indexing in place without a Project, a processing profile, or compulsory file organization.
- **FR-002**: Sessions MUST group homogeneous capture evidence. OBJECT is a label or filter; Target enrichment MUST NOT change capture identity.
- **FR-003**: A processing run (View) MUST belong to exactly one Project and use exactly one of its subjects and one of its rigs. A run MUST retain reviewed input identities independently of browsing filters. Refresh MUST present changes for approval. Reuse across Projects MUST go through Results as inputs, never through sharing a run. (D-W1, D-W8, D-W9, D-W37)
- **FR-004**: Preparation MUST account for every selected input. Unsupported modes, missing inputs, and collisions MUST have explicit outcomes without silent omission or fallback.
- **FR-005**: Profiles that can write into inputs, or whose input-write behavior is unknown, MUST refuse Symlinks and offer Copies instead. A run view MUST be Symlinks (the default) or Copies, with no Direct-source or file-list mode, no hard links, no junctions and no silent fallback between modes. Copies MUST be made as copy-on-write clones where the volume supports them, and the footprint MUST say so. On Windows, Symlinks MUST be refused with a way to turn on Developer Mode or use Copies when symlinks cannot be created. (D-W81)
- **FR-006**: Library quality (P/X/U) MUST be global, and run exclusions MUST stay scoped to their run. There is no Project-scoped reject. Measurements MUST NOT make those decisions automatically. (D-W79)
- **FR-007**: Pixel review MUST retain scientific input semantics and invalid-sample evidence. Measurement MUST use linear samples independently of display stretch.
- **FR-008**: Measurements MUST identify method, units, source, and input basis. Failed fits MUST remain failures; imported values MUST NOT silently replace built-in values.
- **FR-009**: Observed artifacts, accepted Results, reusable masters, and a run's Finished state MUST remain separate states. Finish run MUST require neither a Result nor Clean up. A run that is no longer wanted MAY be moved to its Project's Trash instead (soft delete). Move run to Trash MUST be refused while an operation affecting the run is Running, and while one of its accepted Results is an input to another run; the refusal MUST name each blocker. Moving a run to Trash MUST move no file. A run in the Project's Trash MUST be hidden everywhere except the Project's Trash list, and Restore MUST bring it back exactly as it was. Only Empty Trash, for one run or for all, MAY remove a run. Before it does, it MUST show what goes: the run record, its prepared folders and, only when the user ticks it, its Results folder. Those files MUST go to the OS Trash only. Library frames and quality decisions MUST NOT change, and after Empty Trash, Put back in the OS Trash restores files only. (D-W26, D-W72)
- **FR-010**: A run's Clean up MUST operate on approved run-scoped entries (prepared links and copies) through OS Trash, except that links the run created MUST be deleted, only after a no-follow check that each is still the recorded symlink with its recorded target. Unsafe or unavailable Trash MUST retain affected files without permanent deletion. Trashing rejected capture frames, processing intermediates or duplicate copies MUST NOT be part of a run's Clean up. Only the Trash step of the Project's Wrap up offers it, with two exceptions for processing intermediates: the unticked option in the run's Finish run… confirmation, and the Results folder of a run emptied from the Project's Trash when the user ticks that folder (FR-009). (D-W26, D-W43, D-W70, D-W72, D-W74, D-W80)
- **FR-011**: Archive MUST verify destinations and affected references before source retirement. Interruption MUST preserve recoverable phases and fixed membership. Project Archive MUST keep every session that is a member of a run in another Project that is not Closed; being another Project's candidate MUST NOT count. Reviewed filing is withdrawn with "File into library": Import (PV-STO) replaces it, and Import Move MUST keep each source until its destination verifies. (D-W11, D-W26, D-W46)
- **FR-012**: Failed writes and incomplete operations MUST remain visible. Unknown, unreadable, and offline evidence MUST NOT be represented as absence or success.
- **FR-013**: Every processing run MUST belong to a Project; a Project holds one or more subjects (Targets or mosaics, at any separation), the rigs taking part, and goals per subject and channel. Meeting goals MUST NOT close a Project; only the user does. Library inspection, Import and the Planner MUST NOT require a Project. (D-W1, D-W9, D-W16, D-W26)
- **FR-014**: Planning-site selection, capture sites, and Project membership MUST remain independent. Reminders MUST require opt-in and name the default site.
- **FR-015**: Core library use MUST remain local-first without an account. External applications own calibration, registration, integration, and final image production.
- **FR-016**: The old application and existing uncommitted work MUST remain recoverable during rebuilding. Source-code reuse MUST NOT imply importing old catalog decisions.
- **FR-017**: Assigning, opening, preparing, reusing, cleaning, archiving or trashing a recorded file, or retiring it as a source after archive, MUST re-verify its recorded identity and SHA-256 immediately before the effect. A mismatch MUST name the drift and block that item. Counting a file toward a decision- or proof-bound total MUST use its last completed verification, from review, inspection, acceptance, readable rescan or reuse, and MUST label that verification time. Counts MUST exclude an item whose latest verification found drift or is pending, and showing a total MUST NOT start a rehash. Metadata-only captured totals of Unreviewed captures, and labelled last-observed counts of offline or unreadable inputs of locations that are not retired, MUST stay visible as D19 scopes them. Catalog-only Retire location reads no file bytes and is exempt from rehashing; it MUST still commit only against its review, expected revision and unchanged availability (D19). (D-W11, D-W43)
- **FR-018**: A Project's candidates MUST be derived, never assigned: every Ready session (fully reviewed at intake) whose confirmed Target is one of the Project's subjects and whose rig is one of the Project's rigs. A run's session picker MUST offer only candidates of the run's subject on the run's rig. A session that still needs review MUST NOT be a candidate. (D-W33, D-W37, D-W78)
- **FR-019**: Sessions MUST be assigned only to runs, as each run's revisioned membership. A Project's members MUST be inherited from its runs outside its Trash. Goal progress MUST show "in project" and "captured". "in project" counts the frames in the latest saved memberships of the Project's runs outside its Trash, minus each run's exclusions. "captured" counts the frames of all candidates plus the members of those runs. A member that stops being a candidate MUST stay in its run and still count "in project". The members of a run in the Project's Trash MUST stop counting in both, unless they are still candidates, and MUST count again after Restore. Goal met and Home's Next action MUST use "in project" only. (D-W34, D-W36, D-W44, D-W45, D-W66, D-W72, D-W79)
- **FR-020**: Home MUST be one dashboard of what needs the user, what is running and when to capture next, with no tabs and no header buttons. Its sections, in this fixed order, MUST be:
  1. Pending ingestions.
  2. Pending work.
  3. Open work, with each Project's next step.
  4. Status.
  5. Tonight.
  6. A five-week calendar.

  Each row MUST open the page that owns it, and each section MUST show at most 5 rows, then "All N ›". Problems MUST show on the row they affect; Home MUST have no alerts list. One-click buttons MUST be offered only for actions that need no further input and can be undone. Home MUST have no summary line above its sections. PV-PRJ owns the section contents and the Next rule. (D-W27, D-W35, D-W89)
- **FR-021**: Moving rejected frames to the OS Trash MUST be offered only from the Trash step of a Project's Wrap up. It MUST cover only that Project's library-Unusable candidate frames, MUST list refused frames with their reason, and MUST NOT permanently delete. A Trashed record MUST stay for traceability. It MUST appear only under the Sessions "Trashed" filter and, marked "Trashed", in the fixed membership of a run that was Finished when the frame was trashed. The same step MUST also offer "Move N processing intermediates to Trash (size)" and "Move N duplicate copies to Trash (size)" under the same trash rules. It MUST keep final Results and adopted masters, and it MUST keep one copy of every frame. When the Project's Trash holds runs, Wrap up MUST also offer Empty Trash under FR-009. (D-W43, D-W52, D-W70, D-W72, D-W74, D-W79, D-W80)
- **FR-022**: Each run's stage MUST be one of Select, Calibrate, Prepare, Results or Finished. Finish run MUST offer to remove the run's view, ticked for Copies and unticked for Symlinks, and a kept view MUST be offered again only in Wrap up's Clean up runs step; Clean up MUST NOT be required. At any stage the user MAY move the run to the Project's Trash under FR-009. A run in the Trash leaves the stage rail and is listed in the Project's Trash list with its stage. The Project page MUST show a stage rail with each run's stage. A Project MUST end with Wrap up: Clean up runs → Trash → Archive, in that order, each step optional, and Close project as Archive's Proceed. Archive MUST be offered and MUST NOT be required. (D-W3, D-W7, D-W26, D-W72, D-W78, D-W80, D-W81)
- **FR-023**: The interface MUST call a View a "processing run". It MUST label goal progress "in project" and "captured", MUST NOT say "not in a run", and MUST never show an "in project" value above its "captured" value. A run ends with **Finish run** and is then **Finished**; a Project ends with **Close project** and is then **Closed**, or **Archived** once its Archive succeeds. A calibration master the user no longer wants offered is **Hidden**, with Show hidden and Restore. Editing an object's details MUST use one **Edit…** verb. Moving files to the OS Trash MUST use the destructive action style. (D-W3, D-W36, D-W66, D-W76)
- **FR-024**: Every staged flow (a run, a run group, a Project's wrap-up, Import, a calibration process) MUST advance with one **Proceed** control per step, and the last step MUST name its action instead (for example Finish run… or Close project…). A step whose work is one operation MUST be recorded Finished only when that operation succeeds. An unmet gate MUST disable Proceed and name what is missing. A selection step MUST record Skipped when the user proceeds with nothing selected, and offers no separate Skip. In an ordered flow, later steps MUST stay read-only until the earlier ones are Finished or Skipped; an earlier step MAY be reopened until the flow finishes, and reopening MUST mark the steps after it Redo. A finished flow MUST be read-only, with Reopen in the object's menu. (D-W77)

### UI conventions

The visual system, tokens and component catalogue are documented as a DESIGN.md in the standard DESIGN.md design-system format, generated from `apps/prototype/design/HIGH-LEVEL-DESIGN.md` on branch `ui-harness-v5`. That DESIGN.md replaces the legacy root `DESIGN.md` when the final frontend lands. Until it exists, the current source is `HIGH-LEVEL-DESIGN.md` §6 to §10 (layout patterns, tokens, component inventory, state conventions and copy conventions), with `HARNESS-V5-IA.md` and `R9-COMPOSITION-PLAN.md` §2b, §6.1 and §8.6. The legacy root `DESIGN.md` is not a source for these conventions. The requirements below are the behavior every surface keeps whatever the stack. They follow FR-023 for terms and FR-024 for staged flows. (D-W91)

- **FR-025**: Each view MUST have at most one primary action. An action's style MUST follow what it does (primary, standard or destructive), never its place in a flow. Object, add and view commands MUST sit in named menus ("Project ▾", "Add ▾", "Display ▾"), and `⋯` MUST be reserved for row actions. (D-W77, D-W91)
- **FR-026**: Every row with actions MUST offer them in its `⋯` menu, and its context menu MUST list the same actions. Selecting rows MUST replace the toolbar with a batch bar of the same height, so nothing on the page moves. (D-W91)
- **FR-027**: Tabular data MUST show in tables with sortable headers and with empty, loading and error states. Label and value facts MUST show as a key-value list. (D-W91)
- **FR-028**: A task MUST open in a centered dialog, details in a docked detail panel, a preview on hover or focus, and a long flow as a step page. Side fold-out sheets MUST NOT be used, apart from the navigation drawer at narrow widths. Status badges and pills MUST be inert; navigation MUST use links or tabs. Help MUST appear only on demand. (D-W91)
- **FR-029**: An irreversible action MUST ask for confirmation in a dialog that lists the affected files in groups. A reversible action MUST run at once and offer Undo. (D-W91)
- **FR-030**: Interface copy MUST be microcopy. Buttons MUST be a verb and an object in 1 to 3 words, in sentence case, ending in "…" only when more input or a confirmation follows. Headings MUST be 1 or 2 words and MUST NOT restate the content below. A refusal MUST read "{Action} blocked · {count} {reason} ▸" or "Can't {verb} · {reason} ▸". Each state MUST have one status word, used everywhere. An absent value MUST read "–", and an empty state MUST be one line plus one action. (D-W91)
- **FR-031**: The `⋯` button and Shift+F10 MUST open the same menu, Escape MUST return focus to where it came from, and pointer targets MUST be at least 24 px (WCAG 2.5.8). (D-W91)
- **FR-032**: The product MUST have no Issues hub. A problem MUST show on the row it affects, with its action, on each page that lists that row, and Home follows the same rule (FR-020). The status bar's severity counters MUST show counts only and open the owning page filtered to the affected rows, or, when there are several, a menu naming those pages with their counts; they MUST NOT list the issues themselves. Dismiss and Restore MUST act on the rows, and the counters MUST count only issues that are not dismissed. (D-W89, D-W92)

### Feature ownership

The stable feature keys identify contract owners. They are not a chronological implementation order.

| Feature key | Owned behavior | Primary journey steps |
| --- | --- | --- |
| PV-LIB | Locations, indexing (including what Import lands), homogeneous sessions (including the "Trashed" filter), the Target page, Target/equipment and rig evidence, coverage | A1, A2, A3, A4, B1 |
| PV-PRJ | Projects (required for runs): subjects, rigs, derived candidates, inherited members, goals and goal templates, Home dashboard, Project page with its stage rail and Trash list, Project Wrap up and its trash offers | B2, Home, Project page, Wrap up |
| PV-VSEL | Run creation inside a Project, session picker over candidates, mosaic run groups and panel assignment, run exclusions, saved membership, refresh | B4, C1, C2, C3, C4, C5, C6, D4, D5, G |
| PV-PIX | Frame review in a session's intake, P/X/U marks, measurements, star details, metric imports | D1, D2, D3, D6 |
| PV-CAL | Automatic calibration matching, explanations, exceptions, master adoption | E1, E2, H4 |
| PV-PREP | Profiles, modes, paths, preparation, verified external handoff | E3, E4, F1, F2, F3, F4, F5, F6 |
| PV-RES | Result discovery, acceptance, provenance, reuse, Finish run, Move run to Trash, Restore and Empty Trash | H1, H2, H3, H3a, I1 |
| PV-STO | Import (sources, preview, Copy or Move, naming templates), run Clean up, retained-original proof, verified archive, OS Trash custody for Import Move, emptied runs, trashed frames and duplicate copies | I2, I3, I4, I5, J, L (withdrawn), Import |
| PV-PLAN | Planner on Targets, the Targets list (My targets, Browse catalogues, presets, rig selector), Settings > Equipment (cameras, telescopes, filters and the rigs that select them), sites, windows, Tonight and calendar data for Home, reminders, calendar export | B3, K, Targets list |

The journey step IDs come from the product flow. Home, the Project page with its Trash list, Wrap up, Import and the Targets list are surfaces added or redefined by the 2026-10-06 redesign; they have no product-flow step ID yet. Step L (reviewed filing) is withdrawn and Import replaces it. (D-W7, D-W11, D-W17, D-W39, D-W72)

### Cross-spec flow

The stage model of the 2026-10-06 redesign runs across the feature specs (D-W1, D-W3, D-W26):

1. Library: Import (PV-STO) or Add existing library folder, then indexing (PV-LIB); sessions appear in Sessions and on the Target page. The Planner works on the Targets list without a Project (PV-PLAN, D-W11, D-W16).
2. Project: the user creates a Project with subjects, rigs and goals, optionally from a goal template. Candidates follow from confirmed Target and rig; Home and the Project page show progress and Next (PV-PRJ, D-W30, D-W33, D-W39).
3. Each processing run, inside one Project with one subject and one rig fixed at creation, moves through these stages (D-W50):
   1. Select: session picker over candidates, which are Ready sessions, and saved membership (PV-VSEL). A mosaic subject creates a run group with one run per panel (D-W38, D-W78).
   2. Calibrate: automatic matching with a readiness line (PV-CAL, D-W5).
   3. Prepare: verified handoff (PV-PREP).
   4. Results: discovered from the run's sibling Results folder and accepted (PV-RES, D-W4, D-W51).
   5. Finish run: the user finishes the run, and its confirmation offers to remove the run's view, ticked for Copies and unticked for Symlinks (PV-RES, PV-STO, D-W81). It also offers trashing the run's processing intermediates, unticked (D-W80). At any stage the user can instead move a run that is no longer wanted to the Project's Trash, where it is hidden until the user restores it or empties the Trash. Moving it moves no file. Empty Trash sends its prepared folders to the OS Trash, and its Results folder only when the user ticks it (PV-RES, D-W72).
4. Project Wrap up: once every run is Finished or in the Project's Trash, the user works through Clean up runs (views that were kept), Trash and Archive, in that order; each step can be skipped by proceeding with nothing selected. Trash has four groups: three moves to the OS Trash (rejected frames, processing intermediates and duplicate copies) and Empty Trash for the runs in the Project's Trash. Archive's Proceed, Close project…, runs the archive transfer and closes the Project when it succeeds. PV-PRJ owns the steps, eligibility and refusals; PV-STO executes the custody steps. A Closed Project can be Reopened, even after Archive, and reopening moves no files (D-W26, D-W43, D-W46, D-W69, D-W70, D-W72, D-W74, D-W80).

### Key Entities

- **Library**: Indexed files, locations, evidence, quality decisions, and relationships.
- **Session**: A metadata-homogeneous acquisition group with one rig; night grouping changes display only.
- **Catalog**: The library database of locations, files, sessions and decisions. "Catalogue" names an astronomical catalogue, as in the Targets list's Browse catalogues (PV-PLAN).
- **Target**: A sky subject or region with coverage, plans, Projects, and Results. Several objects in one field are one Target, with the others listed as aliases or "also in field". (D-W9)
- **Rig**: An optical train. A Project lists the rigs taking part; each run uses one. (D-W37)
- **Project**: The required container for processing runs. It holds one or more subjects (Targets or mosaics), its rigs, goals per subject and channel, and an Open, Closed or Archived state; a Closed Project can be Reopened, even after Archive. Its candidates are derived and its members are inherited from its runs. (D-W1, D-W9, D-W33, D-W34, D-W46, D-W69)
- **Processing run (View)**: Named reviewed input membership with one Project, and one subject and one rig fixed at creation, plus a stage and preparation revisions. A run that is no longer wanted can be moved to its Project's Trash, restored from it unchanged, or removed by Empty Trash; none of these changes library frames or quality decisions. Runs of one mosaic subject form a run group, one run per panel. (D-W3, D-W8, D-W38, D-W50, D-W72)
- **Result**: A manually accepted final or reusable product with actual lineage.
- **Operation**: Reviewed intent and per-item outcomes for preparation, Clean up, archive, Import, or trashing. (D-W11, D-W43)

## Success Criteria

### Measurable Outcomes

- **SC-001**: Each of the 44 interaction steps (40 numbered steps plus G, J, K, and L) has exactly one primary feature owner, and so does each redesign surface (Home, Project page, Wrap up, Import, Targets list). Journeys B, D, E, H, and I span owning features. (D-W11, D-W17, D-W39)
- **SC-002**: Indexing and review fixtures leave 100% of original paths and file bytes unchanged.
- **SC-003**: Every requested handoff input is verified or explicitly blocked; zero selected inputs disappear silently.
- **SC-004**: Given confirmed membership of the worked five-session selection, its 208 lights and 17h20m integration remain fixed across sorting, filtering, explicit saving, and restart.
- **SC-005**: Display-stretch changes produce zero changes in saved quality values or source samples.
- **SC-006**: Finishing a run without a Result removes no original source, library frame or Result file; it removes only the prepared entries of the view the user confirmed. An unsupported-Trash fixture removes zero files even after approved cleanup. (D-W81)
- **SC-007**: Archive failure fixtures retain source data until destination and reference verification succeed.
- **SC-008**: Every displayed measurement has method, units, and source, or an explicit unavailable state.
- **SC-009**: In the worked fixture, zero runs exist outside a Project and zero runs contain sessions from more than one rig. (D-W1, D-W37)
- **SC-010**: In a Wrap up trash fixture, zero refused frames reach the OS Trash, and zero files are permanently deleted. (D-W43)
- **SC-011**: Across Home fixtures covering each Next rule, Home shows the first applicable action every time, and no goal reads met while its "in project" value is below the goal. (D-W35, D-W36)

## Assumptions

- The linked product flow is the functional interview record. Existing implementation labels are evidence about the old application only.
- PV-LIB owns the usable local-first Sessions, Target page and Activity navigation, catalog failed-write and external-drift rules. PV-PLAN owns the Targets list and PV-PRJ owns Home. PV-PREP owns external-launch lifecycle separation; PV-STO owns Import, no-follow cleanup and reviewed collisions. Baseline preservation is verified against source commit `94a3dc958c13e297baf501aa2721efa2c2628622` and the separately retained dirty review worktree, not through a user-interface assertion. (D-W11, D-W17, D-W39)
- Existing preparation-mode and platform scope remains intact. A delivery slice does not redefine release scope.
- Pixel review and scientific measurement are read-only; the product does not produce calibrated, registered, integrated, or stretched output images.
- Optional future capabilities listed in the product flow remain deferred.

## Scoped decisions before feature approval

The user authorized conservative product defaults and, on 2026-10-04, waived every repository human-approval gate with no human signoff. The [autonomous objective](autonomous-objective.md) records the instruction; the [decision register](decisions.md) records defaults. Analysis, tests, independent exact-head review, Sniff and original-file protection remain required.

| Decision area | Consuming owners |
| --- | --- |
| Candidate rule and geometry use (D01 as amended by D-W33, D-W37, D-W38) | PV-VSEL, PV-PRJ |
| Untouched-frame inclusion default | PV-VSEL |
| Raw/CFA and imported measurement semantics | PV-PIX |
| Exact profile and per-item input-mode support | PV-PREP, PV-RES |
| Adopted master storage | PV-CAL |
| Archive failure sequencing | PV-STO |
| Reminder defaults and app-closed behavior | PV-PLAN |
| Draft persistence and concurrent edits | PV-VSEL |
| Run revisions, retries, reopening, and completion blockers | PV-VSEL, PV-PREP, PV-RES, PV-STO |
| Quality precedence and Project progress (D10 as amended by D-W36, D-W42, D-W44, D-W66, D-W72, D-W79) | PV-LIB, PV-PRJ, PV-VSEL |
| Content-bound consumption of recorded files | All feature owners |
| Workflow redesign 2026-10-06 (D-W1 through D-W74) | All feature owners |
| Harness v5 round 9, 2026-10-12 to 2026-10-14 (D-W76 to D-W92) | All feature owners |

The existing constitution prohibits debayering. A raw/CFA review specification must define supported read-only channel handling or seek an explicit constitutional amendment before adding debayered preview behavior.

## Autonomous acceptance

The [approved objective](autonomous-objective.md) requires all non-deferred requirements in specs 064 through 072, backend integration and restart proof, followed by a clean-slate frontend. A functional Tauri MCP bridge is mandatory in development builds and is the means of application verification. Production MCP shipping is an optional future feature. After five failed fixes per issue, record a reproducible deferred backlog item and continue independent work; there is no global time cap.
