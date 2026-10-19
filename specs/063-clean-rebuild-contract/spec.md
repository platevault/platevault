# Feature Specification: Clean rebuild product contract

**Feature Branch**: `063-clean-rebuild-contract`

**Created**: 2026-10-03

**Amended**: 2026-10-16, to the owner's answers of 2026-10-15/16 (D-W107 to D-W116) and the second batch (D-W117 to D-W121). The second batch also amends D-W107, D-W108, D-W110 and D-W113 in place. On 2026-10-17, Round 9 C15 added D-W122 and provisional D-W123. Amended 2026-10-19, to the owner's answers in astro-plan-rzbzu.1 (D-W100, D-W107, D-W110, D-W113, D-W114, D-W118 and D-W123).

**Status**: Draft; conservative product decisions and all human-approval gate waivers are authorized. Requirements analysis and implementation verification remain required.

**Input**: Rebuild PlateVault cleanly, preserve the old code as a recoverable reference, and reuse code where it satisfies the agreed product contract.

The [product flow](../../docs/reviews/2026-10-03-product-flow-and-journeys.md) supplies interaction details and the worked example. The [workflow redesign](decisions.md#workflow-redesign-2026-10-06), from 2026-10-06 through D-W123, amends it. The Project is the processing unit; its sessions sit in groups and its input folder is the View. Home is a dashboard, not the Targets list. D-W123 records corrected metadata delivery through patched copies, including FITS alias and HIERARCH updates and XISF FITSKeywords. The Apply wording confirms copies were patched but does not claim that a tool reads the correction. Values FITS cannot represent in printable-ASCII cards are refused at entry and backend. A corrected non-FITS route beyond XISF remains open. (Owner's answer, 2026-10-19, astro-plan-rzbzu.1.) When a D-W decision conflicts with the product flow, the decision governs. This specification defines shared behavior and feature ownership. It does not authorize product implementation or claim that the redesigned flows run.

## User Scenarios & Testing

### User Story 1 - Inspect captures without reorganizing files (Priority: P1)

The user registers capture folders and inspects their sessions while indexing proceeds. A Project and a processing application are optional for inspection, Import and planning; only processing needs a Project (D-W1, D-W94).

**Why this priority**: Library inspection is the first useful workflow and requires no file mutation.

**Independent Test**: Register a capture folder, index its headers, and inspect sessions without creating a Project.

**Acceptance Scenarios**:

1. **Given** only a Captures location, **When** onboarding continues without Calibration or Results locations, **Then** indexing is available and the omitted roles show as unset.
2. **Given** Ha and OIII captures from one night, **When** indexing completes, **Then** separate metadata-homogeneous sessions appear; grouping the display by night preserves those boundaries.
3. **Given** a registered folder, **When** indexing and catalog corrections complete, **Then** source paths and bytes remain unchanged.
4. **Given** an unreadable descendant or an offline location, **When** indexing runs, **Then** its unobserved files retain last-observed information and show uncertainty rather than Missing.

### User Story 2 - Build a Project's View from reviewed sessions (Priority: P1)

The user creates a Project with a subject and a rig, adds Ready sessions whose calibration is settled, checks their groups and calibration, and chooses Apply to build the View, the exact inputs for an external application. Every session was fully reviewed and its calibration matched when it came in, so the Project reviews no frames and matches no calibration (D-W78, D-W94, D-W101).

**Why this priority**: An exact handoff makes library inspection useful. The Project is a light container: a name, its subjects, its rigs and its sessions are enough to apply a View.

**Independent Test**: Create a Project with one subject and one rig, add two sessions, apply the View, and open the application after verification.

**Acceptance Scenarios**:

1. **Given** selected sessions, **When** filters, sort order, or paging change, **Then** the selected identities remain fixed and hidden selected rows are counted.
2. **Given** six excluded frames, **When** the change is applied, **Then** those files remain on disk and other Projects and library quality decisions remain unchanged. (D-W94, D-W100)
3. **Given** a Project that excludes frames of a session, **When** Apply builds the View, **Then** the View holds Symlinks or Copies of the included frames only, so the application never reads an excluded frame. (D-W81, D-W100)
4. **Given** an original that the build needs is offline, **When** the user chooses Apply, **Then** nothing changes and the sheet lists the offline originals. (D-W100)
5. **Given** a destination collision, **When** Apply is reviewed, **Then** unrelated existing entries remain unchanged and require another path or a revised plan.
6. **Given** a Project whose View exists, **When** the user adds a session or moves one to another group, **Then** nothing in the View changes until Apply, and the Apply sheet lists the change. (D-W100)
7. **Given** a Project with sessions from rigs A and B and two framings on rig A, **When** the sessions are added, **Then** PlateVault puts them in three groups, one per rig and framing, and the Apply sheet shows a `GROUP_` folder for each. (D-W95)

### User Story 3 - Review measurements without changing capture data (Priority: P2)

The user inspects pixels and measurements while retaining the original scientific samples. Display settings do not influence measured quality.

**Why this priority**: Measurements support review decisions but do not replace the user's judgment.

**Independent Test**: Inspect a frame, change display stretch, select a star, and compare native and imported measurement provenance.

**Acceptance Scenarios**:

1. **Given** a frame with valid measurements, **When** display stretch changes, **Then** measurement values and source bytes remain unchanged.
2. **Given** a failed or saturated-star fit, **When** its details open, **Then** failure and warnings are visible without a substitute fitted-width number.
3. **Given** ambiguous imported measurement rows, **When** import is reviewed, **Then** mappings require confirmation and no rejection or membership decision is imported.
4. **Given** computed measurements, **When** review completes, **Then** no frame becomes Usable or excluded without a separate scoped action.

### User Story 4 - Close a Project and recover storage safely (Priority: P2)

The user saves finished images in the Project's `Output/` folder or copies a tool's file there, then wraps the Project up in one ordered flow, Clean up → Trash → Archive, and closes it at the end. A Closed or Archived Project is locked for good; to continue, the user duplicates it (D-W80, D-W97, D-W98).

**Why this priority**: Closing must not hide Results or authorize file removal.

**Independent Test**: Close a Project with an empty `Output/`, review its Clean up, interrupt an archive transfer, and review the Project's trash offer using disposable fixtures.

**Acceptance Scenarios**:

1. **Given** an empty `Output/`, **When** the user closes the Project, **Then** it reads Closed, and only the View entries the user left ticked in Clean up are removed. (D-W81, D-W97)
2. **Given** a Project whose View is in Copies mode, files in `Output/` and unknown files in `Processing/`, **When** Clean up opens, **Then** it offers removing the View, ticked. `Output/` is never listed. (D-W81, D-W97, D-W98)
3. **Given** a Project whose View is in Symlinks mode, files in `Output/` and unknown files in `Processing/`, **When** Clean up opens, **Then** it offers removing the View, unticked. `Output/` is never listed. (D-W81, D-W97, D-W98)
4. **Given** a location without safe OS Trash support, **When** approved cleanup runs, **Then** affected files are retained and no permanent-delete fallback executes.
5. **Given** an archive verification or reference-repair failure, **When** transfer settles, **Then** sources are retained and completed, pending, and uncertain phases remain visible.
6. **Given** an open Project with no pending change, **When** the user opens Wrap up, **Then** it shows Clean up, Trash and Archive in that order, with "Move N rejected frames to Trash (size)" in Trash. Archive keeps every session that another open Project holds. Nothing moves until the user confirms a step, and the Project closes only from Archive's Close project…. (D-W26, D-W43, D-W80, D-W97)
7. **Given** the trash offer, **When** its frames are listed, **Then** it covers only the Project's frames that are library-Unusable and lists each refused frame with its reason. (D-W43, D-W79)
8. **Given** a Closed or Archived Project, **When** the user opens it, **Then** nothing can be edited or applied, and its menu offers Duplicate. It offers no Reopen; that part is provisional. (D-W97)

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
3. **Given** a Project whose subjects and rigs match sessions that still need review, and an Apply that waits on offline originals, **When** Home computes its Next action, **Then** it shows "N sessions need review", which opens Sessions filtered to Needs review. (D-W27, D-W35, D-W78)
4. **Given** a goal of Ha 10h with 6h10 in the Project's sessions and 9h15 across those and its matching suggestions, **When** progress shows, **Then** it reads "Ha 6h10 in project · 9h15 captured · goal 10h", and the goal is unmet. (D-W36, D-W96)

### Edge Cases

- Missing OBJECT never substitutes for missing coordinates or controls capture identity. A session without a confirmed Target is never suggested; Home lists it under "need a Target". (D-W33, D-W35, D-W96)
- Unknown geometry does not become zero distance or automatic inclusion. Geometry never decides which sessions a Project suggests; it orders suggestions and forms groups by framing. (D-W33, D-W95)
- A session captured with a rig the Project does not list is not suggested, even when its confirmed Target is a subject. (D-W37, D-W96)
- A Trashed frame disappears from suggestions, Project sessions, frame review, goals, totals and Home. The Sessions "Trashed" filter shows it, and so does a Closed or Archived Project that held it when it was trashed, marked "Trashed". (D-W43, D-W52, D-W97)
- Failed catalog writes remain visibly unsaved with Retry.
- Start acknowledgments do not imply durable operation success.
- Apply never treats an offline original as absent: it refuses and lists it. (D-W100)
- Source corrections are delivered only through patched copies or supported tool configuration. The original is never edited; only the copy's header changes. Apply's patched-copy report states the number of corrected values written to patched copies (D-W123; owner's answer, 2026-10-19, astro-plan-rzbzu.1).
- Cleanup never follows link targets or removes the last retained copy without proof.
- External application exit does not imply processing success or that the Project is done. (D-W3)

## Requirements

### Functional Requirements

- **FR-001**: The product MUST allow indexing in place without a Project, a processing profile, or compulsory file organization.
- **FR-002**: Sessions MUST group homogeneous capture evidence, including framing: intake MUST split a night's frames into separate sessions by framing within the Project group margins. Each frame MUST be compared with its session's first frame in capture-time order, never chained frame to frame. Frames with no pointing evidence MUST form their own session flagged "Framing unknown", not join a session with pointing. A meridian flip MUST NOT split a session; sessions stay split by exposure time. OBJECT is a label or filter; Target enrichment MUST NOT change capture identity. PV-LIB owns the rules. (D-W107; owner's answer, 2026-10-19, astro-plan-rzbzu.1)
- **FR-003**: The Project MUST be the processing unit: it holds the sessions the user adds, in groups, and one input folder, its View, which Apply builds. There MUST be no processing runs, run revisions or Start processing lock. A Project MUST retain reviewed input identities independently of browsing filters, and every change after its View exists MUST stay pending until Apply. Outputs MUST NOT be inputs, and two Projects share a session only by each holding it. (D-W93, D-W94, D-W100)
- **FR-004**: Apply MUST account for every included input. Unsupported modes, missing or offline originals, and collisions MUST have explicit outcomes without silent omission or fallback. (D-W100)
- **FR-005**: Profiles that can write into inputs, or whose input-write behavior is unknown, MUST refuse Symlinks and offer Copies instead. A View MUST be Symlinks (the default) or Copies, with no Direct-source or file-list mode, no junctions and no silent fallback between modes, and switching mode MUST go through Apply. Copies MUST be made as copy-on-write clones where the volume supports them, and the footprint MUST say so. PlateVault MUST NOT create a hard link, to an original or between its own copies. Each Copies entry MUST be an independent file, so a tool that writes one entry changes no other. On Windows, Symlinks MUST be refused with a way to turn on Developer Mode or use Copies when symlinks cannot be created. Provisional: a Siril Project, whose `Processing/Siril/` sets are symlinks in either mode, MUST be refused in Copies mode too, with only the way to turn on Developer Mode (PREP-FR-17). (D-W81, D-W98, D-W99)
- **FR-006**: Library quality (P/X/U) MUST be global, and a Project's frame exclusions MUST stay scoped to that Project. There is no Project-scoped reject. Measurements MUST NOT make those decisions automatically. (D-W79, D-W94)
- **FR-007**: Pixel review MUST retain scientific input semantics and invalid-sample evidence. Measurement MUST use linear samples independently of display stretch.
- **FR-008**: Measurements MUST identify method, units, source, and input basis. Failed fits MUST remain failures; imported values MUST NOT silently replace built-in values.
- **FR-009**: Observed artifacts, Results, reusable masters and a Project's Closed state MUST remain separate states. Close project MUST require neither a Result nor Clean up. The Project's Results MUST be the files in its `Output/` folder, which the user saves there or copies there with Copy to Output; PlateVault MUST NOT point a tool's output at `Output/`, and no Result needs accepting. PlateVault MUST NOT record the lineage or provenance of a Result. A tool rerun MAY overwrite earlier tool files in `Processing/`, and duplicating the Project is the way to keep them. (D-W93, D-W97, D-W98)
- **FR-010**: Removing View entries MUST act only on approved entries PlateVault placed (links and copies), and on files in `View (previous)/` that the user ticks in Clean up (provisional), through the OS Trash, with two exceptions. Links PlateVault created MUST be deleted only after a no-follow check that each is still the recorded symlink with its recorded target, and Apply MUST delete old copies outright only once each copy's original is verified to exist and match its recorded digest. Unsafe or unavailable Trash MUST retain affected files without permanent deletion. Trashing rejected capture frames, `Processing/` files or duplicate copies MUST be offered only by the Trash step of the Project's Wrap up. (D-W43, D-W74, D-W80, D-W81, D-W97, D-W100)
- **FR-011**: Archive MUST verify destinations and affected references before source retirement. Interruption MUST preserve recoverable phases and fixed membership. Project Archive MUST keep every session that another open Project holds; a Closed or Archived Project, or being another Project's suggestion, MUST NOT keep a session. When Archive moves originals that a Closed or Archived Project's kept View links to, it MUST repoint those symlinks, record the repoint and change nothing else in that Project. Reviewed filing is withdrawn with "File into library": Import (PV-STO) replaces it, and Import Move MUST keep each source until its destination verifies. (D-W11, D-W26, D-W46, D-W94, D-W111)
- **FR-012**: Failed writes and incomplete operations MUST remain visible. Unknown, unreadable, and offline evidence MUST NOT be represented as absence or success.
- **FR-013**: Processing MUST happen in a Project. A Project names one or more subjects (Targets, at any separation), a rig list, its sessions in groups, and goals per subject and channel, and per panel group in a mosaic (subjects and rig list provisional, D-W94). Meeting goals MUST NOT close a Project; only the user does. Library inspection, Import and the Planner MUST NOT require a Project. (D-W1, D-W9, D-W16, D-W26, D-W94, D-W95)
- **FR-014**: Planning-site selection, capture sites, and Project membership MUST remain independent. Reminders MUST require opt-in and name the default site.
- **FR-015**: Core library use MUST remain local-first without an account. External applications own calibration, registration, integration, and final image production.
- **FR-016**: The old application and existing uncommitted work MUST remain recoverable during rebuilding. Source-code reuse MUST NOT imply importing old catalog decisions.
- **FR-017**: Assigning, opening, applying, cleaning, archiving or trashing a recorded file, or retiring it as a source after archive, MUST re-verify its recorded identity and SHA-256 immediately before the effect. A mismatch MUST name the drift and block that item. Counting a file toward a decision- or proof-bound total MUST use its last completed verification, from review, inspection, readable rescan or Apply, and MUST label that verification time. Counts MUST exclude an item whose latest verification found drift or is pending, and showing a total MUST NOT start a rehash. Metadata-only captured totals of Unreviewed captures, and labelled last-observed counts of offline or unreadable inputs of locations that are not retired, MUST stay visible as D19 scopes them. Catalog-only Retire location reads no file bytes and is exempt from rehashing; it MUST still commit only against its review, expected revision and unchanged availability (D19). (D-W11, D-W43, D-W100)
- **FR-018**: A Project's suggestions MUST be derived: every Ready session (fully reviewed at intake) that the Project doesn't hold, whose confirmed Target is one of its subjects and whose rig is on its rig list (provisional, D-W96). Suggestions MUST show on the Project and on Home and MUST NOT be added automatically. A suggested session whose calibration is not settled MUST read "Choose its flats first" (or its darks or bias) and MUST NOT be added until it is settled. A drifted pinned calibration file is settled for Project membership, so a session whose pin changed or is missing MAY be added; Apply waits until the pin is reassigned or its recorded bytes return. A session that still needs review MUST NOT be suggested. (D-W33, D-W37, D-W78, D-W96, D-W105, D-W113; owner's answer, 2026-10-19, astro-plan-rzbzu.1)
- **FR-019**: A session MUST join a Project only when the user adds it, and PlateVault MUST group the Project's sessions by rig and framing (FR-033). Each Project MUST count its own sessions, and Target and library totals MUST count a session once. Goal progress MUST show "in project" and "captured". "in project" counts the frames of the Project's sessions, minus its exclusions. "captured" adds the frames of every matching suggestion, settled or not (provisional, D-W96). Goal met and Home's Next action MUST use "in project" only. (D-W34, D-W36, D-W66, D-W79, D-W96)
- **FR-020**: Home MUST be one dashboard of what needs the user, what is running and when to capture next, with no tabs and no header buttons. Its sections, in this fixed order, MUST be:
  1. Pending ingestions.
  2. Pending work.
  3. Open work, with each Project's next step.
  4. Status.
  5. Tonight.
  6. A five-week calendar.

  Each row MUST open the page that owns it, and each section MUST show at most 5 rows, then "All N ›". Problems MUST show on the row they affect; Home MUST have no alerts list. One-click buttons MUST be offered only for actions that need no further input and can be undone. Home MUST have no summary line above its sections. PV-PRJ owns the section contents and the Next rule. (D-W27, D-W35, D-W89)
- **FR-021**: Moving rejected frames to the OS Trash MUST be offered only from the Trash step of a Project's Wrap up. It MUST cover only that Project's library-Unusable frames, MUST list refused frames with their reason, and MUST NOT permanently delete. A Trashed record MUST stay for traceability. It MUST appear only under the Sessions "Trashed" filter and, marked "Trashed", in a Closed or Archived Project that held the frame when it was trashed. The same step MUST also offer "Move N processing files to Trash (size)" for `Processing/` and "Move N duplicate copies to Trash (size)" under the same trash rules. It MUST keep `Output/` and adopted masters, and it MUST keep one copy of every frame. When copies tie for the keeper, the copy PlateVault catalogued first MUST be preselected, and nothing MUST be removed without review. (D-W43, D-W52, D-W74, D-W79, D-W80, D-W97, D-W116)
- **FR-022**: The Project page MUST offer the steps Sessions, Calibrate, View, Output and Wrap up (provisional step list, from the F4 prototype plan the owner approved on 2026-10-15/16). While the Project is open, Sessions, View and Output MUST stay editable, and Calibrate MUST stay a read-only check (FR-035). A Project MUST end with Wrap up: Clean up → Trash → Archive, in that order, each step optional, with Close project as Archive's Proceed. Wrap up MUST open only when no change is pending (provisional, D-W97). Clean up MUST offer removing the View, ticked for Copies and unticked for Symlinks (D-W81). Provisional: Clean up also lists whatever `View (previous)/` still holds, including files PlateVault didn't place, each unticked. Archive MUST be offered and MUST NOT be required. A Closed or Archived Project MUST be locked for good: no edits, no Apply, and Library or calibration changes MUST NOT touch it; Duplicate is the way to continue. There MUST be no Reopen (provisional, D-W97). (D-W7, D-W26, D-W80, D-W81, D-W97, D-W101)
- **FR-023**: The interface MUST call the Project's input folder the View. It MUST label goal progress "in project" and "captured", and MUST never show an "in project" value above its "captured" value. A Project ends with **Close project** and is then **Closed**, or **Archived** once its Archive succeeds. A calibration master the user no longer wants offered is **Hidden**, with Show hidden and Restore. Editing an object's details MUST use one **Edit…** verb. Moving files to the OS Trash MUST use the destructive action style. (D-W36, D-W66, D-W76, D-W94)
- **FR-024**: Every staged flow (a Project's wrap-up, a session's intake, Import, a calibration process) MUST advance with one **Proceed** control per step, and the last step MUST name its action instead (for example Finish review or Close project…). A step whose work is one operation MUST be recorded Finished only when that operation succeeds. An unmet gate MUST disable Proceed and name what is missing. A selection step MUST record Skipped when the user proceeds with nothing selected, and offers no separate Skip. In an ordered flow, later steps MUST stay read-only until the earlier ones are Finished or Skipped; an earlier step MAY be reopened until the flow finishes, and reopening MUST mark the steps after it Redo. A finished flow MUST be read-only. Reopen sits in the object's menu where the object allows it, and a Closed or Archived Project allows none (provisional, FR-022). (D-W77, D-W97)

### UI conventions

The visual system, tokens and component catalogue are documented as a DESIGN.md in the standard DESIGN.md design-system format, generated from `apps/prototype/design/HIGH-LEVEL-DESIGN.md` on branch `ui-harness-v5`. That DESIGN.md replaces the legacy root `DESIGN.md` when the final frontend lands. Until it exists, the current source is `HIGH-LEVEL-DESIGN.md` §6 to §10 (layout patterns, tokens, component inventory, state conventions and copy conventions), with `HARNESS-V5-IA.md` and `R9-COMPOSITION-PLAN.md` §2b, §6.1 and §8.6. The legacy root `DESIGN.md` is not a source for these conventions. The requirements below are the behavior every surface keeps whatever the stack. They follow FR-023 for terms and FR-024 for staged flows. (D-W91)

- **FR-025**: Each view MUST have at most one primary action. An action's style MUST follow what it does (primary, standard or destructive), never its place in a flow. Object, add and view commands MUST sit in named menus ("Project ▾", "Add ▾", "Display ▾"), and `⋯` MUST be reserved for row actions. (D-W77, D-W91)
- **FR-026**: Every row with actions MUST offer them in its `⋯` menu, and its context menu MUST list the same actions. Selecting rows MUST replace the toolbar with a batch bar of the same height, so nothing on the page moves. (D-W91)
- **FR-027**: Tabular data MUST show in tables with sortable headers and with empty, loading and error states. Label and value facts MUST show as a key-value list. (D-W91)
- **FR-028**: A task MUST open in a centered dialog, details in a docked detail panel, a preview on hover or focus, and a long flow as a step page. Side fold-out sheets MUST NOT be used, apart from the navigation drawer at narrow widths. Status badges and pills MUST be inert; navigation MUST use links or tabs. Help MUST appear only on demand. (D-W91)
- **FR-029**: An irreversible action MUST ask for confirmation in a dialog that lists the affected files in groups. A reversible action MUST run at once and offer Undo, with one exception: a frame mark made on a ⌘A or threshold selection MUST ask for confirmation first, whatever its count; "Mark rest usable" also asks and names the number of frames. Single-frame and hand-picked marks do not ask. (D-W91, D-W118; owner's answer, 2026-10-19, astro-plan-rzbzu.1)
- **FR-030**: Interface copy MUST be microcopy. Buttons MUST be a verb and an object in 1 to 3 words, in sentence case, ending in "…" only when more input or a confirmation follows. Headings MUST be 1 or 2 words and MUST NOT restate the content below. A refusal MUST read "{Action} blocked · {count} {reason} ▸" or "Can't {verb} · {reason} ▸". Each state MUST have one status word, used everywhere. An absent value MUST read as an en dash (U+2013), and an empty state MUST be one line plus one action. (D-W91)
- **FR-031**: The `⋯` button and Shift+F10 MUST open the same menu, Escape MUST return focus to where it came from, and pointer targets MUST be at least 24 px (WCAG 2.5.8). (D-W91)
- **FR-032**: The product MUST have no Issues hub. A problem MUST show on the row it affects, with its action, on each page that lists that row, and Home follows the same rule (FR-020). The status bar's severity counters MUST show counts only and open the owning page filtered to the affected rows, or, when there are several, a menu naming those pages with their counts; they MUST NOT list the issues themselves. Dismiss and Restore MUST act on the rows, and the counters MUST count only issues that are not dismissed. (D-W89, D-W92)
- **FR-037**: Each table whose rows the user can open, select or act on MUST be one Tab stop, on its current row, followed by that row's own controls. ↑ and ↓ MUST move between rows, Home and End to the first and last row, and Page Up and Page Down by one screen. Space MUST select or clear the focused row, and only while single-key shortcuts are on. Enter MUST open the row, and Shift+F10 or the Menu key MUST open the row's menu (FR-031). Focus MUST return to the row after its menu or a dialog it opened closes, and after a confirmed action removes a row, focus MUST move to the next row. Provisional: after the last row is removed, focus moves to the previous row, and a table's header controls, such as select-all and the sort buttons, keep their own Tab stops. (D-W121)

### Project model

The feature specs hold the detailed rules; these requirements are the part every surface keeps.

- **FR-033**: PlateVault MUST group a Project's sessions by rig and framing, and the user MUST be able to create, split and rename groups and move sessions between them. A Project MUST add whole sessions to its groups and MUST NOT divide a session's frames between groups. Marking a group as a mosaic panel MUST make the Project a mosaic; there is no mosaic mode chosen up front. PV-PRJ owns the rules. (D-W95, D-W107)
- **FR-034**: Apply MUST build a complete new View from the originals only and swap it in, keeping the old one as `View (previous)/`, and MUST change nothing when any original it needs is offline or any pinned calibration file has changed or is missing. Apply MUST wait while `View (previous)/` holds files the user hasn't reviewed, and MUST NOT ask again about a file the user kept. On the next Apply, kept files move to a separate kept folder; a `-2` suffix is added on name clashes. A frame set back to Unreviewed in reopened review, or a grouping correction that re-splits a held session, reaches every open Project holding it as a labelled pending change; the session reads Needs review there, and Apply waits until it is Ready again. A Project MUST discard only its own pending edits. One PlateVault operation runs per Project at a time (provisional). PV-VSEL, PV-PREP and PV-STO own the rules. (D-W100, D-W110, D-W113; owner's answers, 2026-10-19, astro-plan-rzbzu.1)
- **FR-035**: Flats, darks and bias MUST be matched to light sessions at ingestion and pinned on the session, and a session MUST be settled before a Project can add it. A Project's Calibrate step MUST be a read-only check. A pin MUST stay when its file changes or goes missing, the session MUST then wait in "Needs calibration", and nothing MUST switch to another file by itself. A drifted pinned calibration file remains settled for Project membership, so a session with that pin MAY be added; Apply MUST wait until it is reassigned or its recorded bytes return. Dark flats MUST be ignored. PV-LIB and PV-CAL own the rules. (D-W93, D-W101 to D-W106, D-W113; owner's answer, 2026-10-19, astro-plan-rzbzu.1)
- **FR-036**: Duplicate MUST copy what the user chose (sessions, groups and overrides, goals, notes and settings) and no files, and MUST use each session's current calibration pins. The duplicate MUST be fully independent, with no link to the original. Result lineage, outputs as inputs, tool caches and stacking inside PlateVault are out of scope. (D-W93, D-W96, D-W112)

### Feature ownership

The stable feature keys identify contract owners. They are not a chronological implementation order.

| Feature key | Owned behavior | Primary journey steps |
| --- | --- | --- |
| PV-LIB | Locations, indexing (including what Import lands), homogeneous sessions (including the "Trashed" filter), the Target page, Target/equipment and rig evidence, coverage, calibration pinned on sessions at ingestion and the "Needs calibration" queue | A1, A2, A3, A4, B1 |
| PV-PRJ | Projects: subjects, the rig list, sessions in groups, suggestions, Duplicate, goals and goal templates, Home dashboard, the Project page and its steps, Project Wrap up and its trash offers, the locked Closed state | B2, Home, Project page, Wrap up |
| PV-VSEL | Adding sessions, frame exclusions, pending changes and the Apply sheet | B4, C1, C2, C3, C4, C5, C6, D4, D5, G |
| PV-PIX | Frame review in a session's intake, P/X/U marks, measurements, star details, metric imports | D1, D2, D3, D6 |
| PV-CAL | Matching rules for flats, darks and bias, the Calibrate check and its diagram, the calibration library, master adoption | E1, E2, H4 |
| PV-PREP | Profiles, input modes, the View and tool layouts, building and swapping the View, verified external handoff | E3, E4, F1, F2, F3, F4, F5, F6 |
| PV-RES | The Output step: Results in `Output/`, Copy to Output and the master offer from `Processing/` | H1, H2, H3, H3a (withdrawn), I1 |
| PV-STO | Import (sources, preview, Copy or Move, naming templates), removing old View copies and links, `View (previous)/`, retained-original proof, verified archive, OS Trash custody for Import Move, the View at Close, `Processing/` files, trashed frames and duplicate copies | I2, I3, I4, I5, J, L (withdrawn), Import |
| PV-PLAN | Planner on Targets, the Targets list (My targets, Browse catalogues, presets, rig selector), Settings > Equipment (cameras, telescopes, filters and the rigs that select them, with rig versions and camera aliases), sites, windows, Tonight and calendar data for Home, reminders, calendar export | B3, K, Targets list |

The journey step IDs come from the product flow. Home, the Project page with its steps, Wrap up, Import and the Targets list are surfaces added or redefined by the 2026-10-06 redesign and the F4 Project model; they have no product-flow step ID yet. Step L (reviewed filing) is withdrawn and Import replaces it. (D-W7, D-W11, D-W17, D-W39, D-W94)

### Cross-spec flow

The stage model runs across the feature specs (D-W1, D-W94, D-W101):

1. Library: Import (PV-STO) or Add existing library folder, then indexing (PV-LIB); sessions appear in Sessions and on the Target page. Calibration is matched at ingestion and pinned on each light session, and a session whose calibration is not settled waits in "Needs calibration". The Planner works on the Targets list without a Project (PV-PLAN, D-W11, D-W16, D-W101, D-W105).
2. Project: the user creates a Project with subjects, rigs and goals, optionally from a goal template, and adds Ready, settled sessions; matching sessions are suggested and never added automatically. PlateVault groups the sessions by rig and framing. Home and the Project page show progress and Next (PV-PRJ, D-W30, D-W39, D-W95, D-W96).
   A pointing-associated Target counts as confirmed for Ready, Needs a Target, and Not in any Project. My targets includes any Target with an indexed session (PV-LIB, PV-PLAN; D-W124, D-W125; owner's answers, 2026-10-19, astro-plan-rzbzu.1). A removed subject's goals stay hidden and return when the subject is added again (PV-PRJ; D-W128; owner's answer, 2026-10-19, astro-plan-rzbzu.1).
3. The Project's steps (provisional step list, from the approved F4 prototype plan). While the Project is open, Calibrate is a read-only check and the other steps stay editable:
   1. Sessions: its sessions in groups, its suggestions, exclusions and pending changes (PV-PRJ, PV-VSEL).
   2. Calibrate: a read-only check with the calibration diagram (PV-CAL, D-W101).
   3. View: the application, the input mode and Apply, which builds the View from the originals and swaps it in, then Open in {app} (PV-VSEL, PV-PREP, PV-STO, D-W100).
   4. Output: the Results in `Output/`, Copy to Output and the master offer from `Processing/` (PV-RES, D-W98).
4. Project Wrap up: once no change is pending (provisional), the user works through Clean up, Trash and Archive, in that order; each step can be skipped by proceeding with nothing selected. Clean up lists the View, and provisionally whatever `View (previous)/` still holds. Trash has three moves to the OS Trash: rejected frames, `Processing/` files and duplicate copies. Archive's Proceed, Close project…, runs the archive transfer and closes the Project when it succeeds. A Closed or Archived Project is locked for good, and Duplicate continues it; provisionally, it has no Reopen. PV-PRJ owns the steps, eligibility and refusals; PV-STO executes the custody steps (D-W26, D-W43, D-W74, D-W80, D-W97).

### Key Entities

- **Library**: Indexed files, locations, evidence, quality decisions, and relationships.
- **Session**: A metadata-homogeneous acquisition group with one rig, one exposure time and one framing; night grouping changes display only. (D-W107)
- **Catalog**: The library database of locations, files, sessions and decisions. "Catalogue" names an astronomical catalogue, as in the Targets list's Browse catalogues (PV-PLAN).
- **Target**: A sky subject or region with coverage, plans, Projects, and Results. Several objects in one field are one Target, with the others listed as aliases or "also in field". (D-W9)
- **Rig**: An optical train with dated versions; each session keeps the version it was captured with. A Project lists the rigs whose sessions it suggests (provisional, D-W94). (D-W37, D-W96, D-W104)
- **Project**: The processing unit. It names one or more subjects (Targets) and a rig list (both provisional, D-W94), and it holds goals per subject and channel, its sessions in groups, its settings and one View. It is Open, Closed or Archived; Closed and Archived are locked for good. (D-W1, D-W9, D-W94, D-W97)
- **Group**: A set of a Project's sessions with one rig and framing, or one mosaic panel, with a name and a GROUP or PANEL keyword. (D-W95)
- **View**: The Project's input folder, `View/`, which Apply builds from the originals as Symlinks or Copies in the layout PV-PREP defines. (D-W98, D-W99, D-W100)
- **Calibration assignment**: The flats, darks and bias pinned on a light session at ingestion, or a No choice for a kind. (D-W101, D-W105)
- **Result**: A file in the Project's `Output/` folder. PlateVault records no lineage for it. (D-W93, D-W98)
- **Operation**: Reviewed intent and per-item outcomes for Apply, Clean up, archive, Import, or trashing. (D-W11, D-W43, D-W100)

## Success Criteria

### Measurable Outcomes

- **SC-001**: Each of the 44 interaction steps (40 numbered steps plus G, J, K, and L) has exactly one primary feature owner, and so does each redesign surface (Home, Project page, Wrap up, Import, Targets list). Journeys B, D, E, H, and I span owning features. (D-W11, D-W17, D-W39)
- **SC-002**: Indexing and review fixtures leave 100% of original paths and file bytes unchanged.
- **SC-003**: Every Apply input is verified or explicitly blocked; zero included inputs disappear silently.
- **SC-004**: Given the worked five sessions in a Project, its 208 lights and 17h20m integration remain fixed across sorting, filtering, explicit saving, and restart.
- **SC-005**: Display-stretch changes produce zero changes in saved quality values or source samples.
- **SC-006**: Closing a Project without a Result removes no original source, library frame or `Output/` file; it removes only the View entries the user confirmed. An unsupported-Trash fixture removes zero files even after approved cleanup. (D-W81, D-W97)
- **SC-007**: Archive failure fixtures retain source data until destination and reference verification succeed.
- **SC-008**: Every displayed measurement has method, units, and source, or an explicit unavailable state.
- **SC-009**: In the worked fixture, zero sessions join a Project without the user adding them, and zero groups mix rigs. (D-W94, D-W95, D-W96)
- **SC-010**: In a Wrap up trash fixture, zero refused frames reach the OS Trash, and zero files are permanently deleted. (D-W43)
- **SC-011**: Across Home fixtures covering each Next rule, Home shows the first applicable action every time, and no goal reads met while its "in project" value is below the goal. (D-W35, D-W36)
- **SC-012**: In Apply fixtures, an offline original changes zero View entries, and zero old copies are deleted before their originals verify. (D-W100)

## Assumptions

- The linked product flow is the functional interview record. Existing implementation labels are evidence about the old application only.
- PV-LIB owns the usable local-first Sessions, Target page and Activity navigation, catalog failed-write and external-drift rules. PV-PLAN owns the Targets list and PV-PRJ owns Home. PV-PREP owns external-launch lifecycle separation; PV-STO owns Import, no-follow cleanup and reviewed collisions. Baseline preservation is verified against source commit `94a3dc958c13e297baf501aa2721efa2c2628622` and the separately retained dirty review worktree, not through a user-interface assertion. (D-W11, D-W17, D-W39)
- Existing input-mode and platform scope remains intact. A delivery slice does not redefine release scope.
- Pixel review and scientific measurement are read-only; the product does not produce calibrated, registered, integrated, or stretched output images.
- Optional future capabilities listed in the product flow remain deferred.
- The rebuild starts from a fresh catalog, with no catalog migration and no requirement to read or upgrade an earlier catalog. (D-W115)

## Scoped decisions before feature approval

The user authorized conservative product defaults and, on 2026-10-04, waived every repository human-approval gate with no human signoff. The [autonomous objective](autonomous-objective.md) records the instruction; the [decision register](decisions.md) records defaults. Analysis, tests, independent exact-head review, Sniff and original-file protection remain required.

| Decision area | Consuming owners |
| --- | --- |
| Suggestion rule, framing groups and geometry use (D01 as amended by D-W33, D-W37, D-W95, D-W96) | PV-VSEL, PV-PRJ |
| Untouched-frame inclusion default | PV-VSEL |
| Raw/CFA and imported measurement semantics | PV-PIX |
| Exact profile and per-item input-mode support | PV-PREP, PV-RES |
| Adopted master storage | PV-CAL |
| Archive failure sequencing | PV-STO |
| Reminder defaults and app-closed behavior | PV-PLAN |
| Draft persistence and concurrent edits | PV-VSEL |
| Apply, retries and Close blockers (D09 as amended by D-W94, D-W97, D-W100) | PV-VSEL, PV-PREP, PV-STO, PV-PRJ |
| Quality precedence and Project progress (D10 as amended by D-W36, D-W42, D-W44, D-W66, D-W72, D-W79, D-W96) | PV-LIB, PV-PRJ, PV-VSEL |
| Content-bound consumption of recorded files | All feature owners |
| Workflow redesign 2026-10-06 (D-W1 through D-W74) | All feature owners |
| Run-group trash listing, 2026-10-08 (D-W75, superseded by D-W94) | PV-VSEL |
| Harness v5 round 9, 2026-10-12 to 2026-10-14 (D-W76 to D-W92) | All feature owners |
| F4 Project model, 2026-10-14 (D-W93 to D-W106) | All feature owners |
| F4 owner's answers, 2026-10-15/16 (D-W107 to D-W116) | All feature owners |
| Owner's second batch, 2026-10-16 (D-W117 to D-W121, and D-W107, D-W108, D-W110 and D-W113 amended in place) | All feature owners |
| Round 9 C15 and provisional FITS header mapping, 2026-10-17 (D-W122, D-W123) | PV-LIB, PV-PREP |

The existing constitution prohibits debayering. A raw/CFA review specification must define supported read-only channel handling or seek an explicit constitutional amendment before adding debayered preview behavior.

## Autonomous acceptance

The [approved objective](autonomous-objective.md) requires all non-deferred requirements in specs 064 through 072, backend integration and restart proof, followed by a clean-slate frontend. A functional Tauri MCP bridge is mandatory in development builds and is the means of application verification. Production MCP shipping is an optional future feature. After five failed fixes per issue, record a reproducible deferred backlog item and continue independent work; there is no global time cap.
