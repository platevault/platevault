# Feature Specification: Inbox Confirmation & Reviewable Plan Surface

**Feature Branch**: `041-inbox-plan-surface`

**Created**: 2026-06-20

**Status**: Draft

**Input**: User description: "Rework the inbox confirmation experience and the file-organization plan model so confirming an item produces a visible, reviewable plan; the review surface is structured (no overflowing pills, multi-level grouping) and shows per-file metadata; users can override header-derived values beyond frame type and apply overrides to a multi-selection; and whether files are moved or catalogued in place depends on where they came from (inbox vs already-organized library root)."

## Context & Motivation

Hands-on use of the Inbox surfaced a cluster of problems that, together, break two constitutional principles and make the confirmation surface hard to use:

- **Reviewable Filesystem Mutation (Principle II)** — confirming an item silently generates a plan the user cannot see. The item disappears from the queue, the only "View plan" affordance navigates away to the unrelated Archive page, and there is no in-context way to review the scheduled actions before they run.
- **Local-First File Custody (Principle I)** — the move-vs-leave-in-place decision is inconsistent (light frames generate a move plan, calibration masters are "added directly"), and there is no notion of "this folder is already organized, catalogue it in place rather than moving it."

### Observed problems (from hands-on review)

1. The review list uses status **pills that overflow outside the visible sidebar**; the list is not structured and does not follow the standard sidebar layout.
2. The list cannot be **grouped by more than one dimension** (e.g. by target, then by frame type).
3. The central panel exposes **only the frame type** for override and **hides the rest of the FITS metadata** (filter, exposure, binning, gain, temperature, object, date).
4. There is **no multi-select**: a user cannot set a value once and apply it to many files/items.
5. The **destination preview is always empty** during review.
6. Folders with more than one frame type show a **"mixed" label with no explanation** of what the mix is.
7. **Calibration masters hang on "Loading classification"** because they are a single file, not a folder.
8. The right action sidebar holds essentially **one button plus two radios** ("Archive folder" / "System Trash") whose **purpose is unclear** in context.
9. The queue footer shows a **bare "N folders"** with no per-type breakdown.
10. After confirm, **items (especially lights) vanish** with no feedback; the generated plan is effectively invisible.

This feature reworks the Inbox confirmation surface and plan model to make every filesystem mutation reviewable and visible in-context, to surface and let users correct per-file metadata, to organize the review list with multi-level grouping, and to make the move-vs-catalogue decision predictable and consistent. It extends and folds in prior work: spec 005 (mixed-folder split), spec 039 (cross-root inbox), and spec 040 (calibration master detection).

### Relationship to recent bug fixes

Several defects encountered during this review were already repaired (PR #298): masters now classify (file-not-folder), the per-item override state no longer leaks across selections, the breakdown no longer blanks after applying overrides, the empty destination cell now reads "computed on confirm", and the Calibration page no longer crashes. Those fixes restored basic function; **this spec defines the redesigned behavior** that supersedes those stopgaps (e.g. the destination is shown for real during review, not "computed on confirm").

## Clarifications

### Session 2026-06-20

- Q: For an item whose files are partly already-organized-in-place and partly not, how is move-vs-catalogue decided? → A: Per file by provenance — already-organized files are catalogued in place, the rest get move actions (one item's plan may contain both).
- Q: How is the move-vs-catalogue decision determined for a source? → A: By an explicit per-source **organization state** (organized → catalogue-in-place; unorganized → propose move plan) that is **orthogonal to content kind** (`light_frames`/`calibration`/`project`/`inbox`). It is the field the decision keys on, not `kind`.
- Q: Can the same content kind have both organized and unorganized sources? → A: Yes — e.g. an organized `light_frames` library and an unorganized `light_frames` capture dump can coexist. This is the reason `kind` alone cannot drive the decision.
- Q: How is organization state set, and what is the default for non-inbox sources? → A: The user must **explicitly choose** organized vs unorganized **when adding** each non-inbox source (no silent default — a forced choice). `inbox`-kind sources are unorganized by definition (no choice needed). The state is changeable later and affects only future confirms.
- Q: How is the organization-state choice communicated? → A: The source-add / setup wizard flow must **explain** the choice and its consequence, ideally with a small flow diagram, so the user understands organized → leave-in-place vs unorganized → propose-moves.
- Q: Which dimensions can the multi-level grouping use? → A: The full common set — **target, frame type, filter, exposure, date, and source** — freely orderable into nested levels.
- Q: Do manual metadata overrides persist across a rescan? → A: Yes — overrides **persist keyed to the file's content** and re-apply automatically across rescans; they are invalidated only when the file's content changes.
- Q: Can the user apply more than one plan at once? → A: Yes — the user can apply a single item's plan **or batch-apply all pending planned items** in one action; each action is still individually audited.

## Iterations

### Iteration 2026-06-21: Inbox destination model

**Change**: Per-type configurable destination patterns (light/flat/master-flat/bias/master-bias/dark/master-dark with sensible defaults), explicit destination-root selection (in-place default; inbox must target a root; multi-root requires user choice), full absolute-path preview, and a mandatory gate on missing path-load-bearing attributes.
**Scope**: Feature-wide (additive requirements + behavioral change to the merged move-destination computation).
**Artifacts updated**: spec.md (US8, US9, FR-025–FR-033), data-model.md, plan.md, tasks.md, research.md, quickstart.md.
**Tasks added**: T048–T060.
**Context**: Follows the merged spec 041 (apply executor now resolves root_id via registered_sources; breakdown layout stable; move-preview double-slash fixed). Found during Windows real-app E2E (T046).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Reviewable, visible plan on confirm (Priority: P1)

When a user confirms an inbox item, the app produces a **reviewable plan** describing exactly which files will be moved (or catalogued) and where. The confirmed item does **not** vanish: it stays in the queue, distinctly marked as **"planned"** (e.g. greyed with a planned badge), and remains selectable for review. The scheduled filesystem actions are listed in an **in-context plan panel** (at the bottom of the central detail area — **not** by navigating to the Archive page). The user takes an **explicit Apply** step to execute them, and can **review the full plan and cancel** it before applying.

**Why this priority**: This is the core constitutional fix (Reviewable Filesystem Mutation). Without it the product's central promise — making large library changes safe and reversible — is broken. Highest-value slice.

**Independent Test**: Confirm one inbox item; verify the item stays visible as "planned", a plan with one or more actions appears in the in-context plan panel (no navigation away), the files have not moved on disk, Apply executes the actions and writes an audit record, and Cancel discards the plan leaving files untouched.

**Acceptance Scenarios**:

1. **Given** an unconfirmed inbox item, **When** the user confirms it, **Then** a plan listing the intended file actions appears in an in-context plan panel, the item is shown as "planned" (still visible and selectable, not removed), and no files have moved yet.
2. **Given** a planned item, **When** the user opens "View plan", **Then** the plan is shown in-context within the inbox surface (the user is NOT taken to the Archive page or any unrelated page).
3. **Given** a planned item, **When** the user clicks Apply, **Then** the planned filesystem actions execute, each action's outcome is recorded in the audit log, no existing file is overwritten silently, and the item leaves the queue only after the plan is applied.
4. **Given** a planned item, **When** the user cancels the plan, **Then** the plan is discarded, no files are moved, and the item returns to the unconfirmed state.
5. **Given** a planned item whose source files changed on disk since planning, **When** the user clicks Apply, **Then** the app refuses to apply silently and surfaces that the plan is stale and must be regenerated.
6. **Given** several planned items, **When** the user chooses "apply all", **Then** every pending plan is applied in one action and each action is individually recorded in the audit log.

---

### User Story 2 - Structured, groupable review list and per-file metadata detail (Priority: P1)

The inbox review list (left) presents each item in a **structured, tabular layout** that fits the sidebar — item type(s), file count, format, and a clear master indicator — using **no pills** and following the standard page/sidebar layout (pinned controls, scrolling content, nothing overflowing). The user can **group the list by one or more dimensions in a chosen order** — e.g. group by target, then by frame type, then by filter — with collapsible groups. Selecting an item shows a **restructured central detail panel** that lists the item's files with their extracted **FITS/XISF metadata** (image type, filter, exposure, binning, gain, temperature, object, observation date). When a folder holds more than one frame type, the panel makes the **composition explicit** (which types and how many of each) rather than showing a bare "mixed" label.

**Why this priority**: The review surface is currently unusable for real decisions (overflowing pills, single-level grouping, only frame type visible, opaque "mixed"). A structured, groupable, metadata-rich surface is a prerequisite for trustworthy confirmation and for the override flow (US3). Independently valuable even without US1.

**Independent Test**: Open an item with a folder of sub-frames; verify the list row shows type/count/format/master indicator with no pills and no overflow; apply a two-level grouping (e.g. target → frame type) and verify the list nests accordingly; verify the detail panel lists each file with its metadata fields populated, and that a multi-type folder shows its explicit per-type composition.

**Acceptance Scenarios**:

1. **Given** the inbox has items, **When** the user views the list, **Then** each row shows the item's type(s), file count, format, and master indicator in a structured (non-pill) layout that fits the sidebar width without clipped or overflowing content.
2. **Given** the list, **When** the user chooses to group by dimension X and then by dimension Y, **Then** the list is organized into nested, collapsible groups (X at the top level, Y within each X group), and the chosen grouping persists while navigating.
3. **Given** an item is selected, **When** the detail panel renders, **Then** it shows per-file metadata (image type, filter, exposure, binning, gain, temperature, object, date), displaying each field as unavailable when absent.
4. **Given** a folder containing more than one frame type, **When** it is selected, **Then** the detail panel shows the explicit composition (each frame type and its count), not just a "mixed" label.
5. **Given** a calibration master (a single file), **When** it is selected, **Then** the detail panel resolves and shows its metadata and master type (it does not hang on a loading state).

---

### User Story 3 - Override header values beyond type, with multi-select apply-to-all (Priority: P2)

In the detail panel the user can correct header-derived values the app inferred — frame type **and other header fields** (at minimum filter, exposure, binning; ideally the full surfaced set including gain, object, temperature) — for one or more files before confirming. The user can **select multiple files** (within an item and/or across items, including via the grouped list) and **apply an override to the entire selection at once**. The "Apply N overrides" action applies exactly the overrides for the selected scope, reports an **accurate count**, and the classification breakdown **stays visible and updates** afterwards. Overrides are reflected in the destination/plan before applying.

**Why this priority**: Real libraries have missing or wrong headers; correcting only the frame type is insufficient. Multi-select apply-to-all is a major time-saver for large folders. Depends on US2's metadata surface but delivers standalone value.

**Independent Test**: Select several files with a wrong/blank filter (spanning more than one item via the grouped list), apply a filter override to the whole selection, and verify every selected file reflects the new value, the reported count equals the selection size, the breakdown stays visible, and the resulting destinations use the corrected values.

**Acceptance Scenarios**:

1. **Given** files with a blank or wrong inferred value, **When** the user overrides frame type / filter / exposure / binning (or another surfaced header) on a file, **Then** the override is recorded for that file and reflected in its metadata and destination.
2. **Given** multiple selected files (within or across items), **When** the user applies an override to the selection, **Then** every selected file receives the override and the reported applied-count equals the number of selected files.
3. **Given** the user has applied overrides, **When** the detail re-renders, **Then** the type/breakdown stays visible and reflects the overrides (it does not blank out), and only the current scope's overrides are applied (no leakage from previously-viewed items).

---

### User Story 4 - Move vs catalogue-in-place based on a source's organization state (Priority: P2)

Whether confirming an item generates a **move plan** or **catalogues the files in place** depends on the **organization state of the source the files came from**, not on their frame type. Each source carries an explicit **organization state** — *organized* (already-sorted library; catalogue in place, no move) or *unorganized* (capture dump / inbox dropzone; propose a reviewable move plan) — set by the user when adding the source and orthogonal to its content `kind`. So an organized `light_frames` library and an unorganized `light_frames` dump can coexist, treated differently. This applies uniformly to calibration and light frames alike — removing today's inconsistency where lights get a plan but masters are added directly. The user explicitly chooses the organization state when adding any non-inbox source (inbox sources are unorganized by definition), the choice is explained in the add-source/wizard flow (ideally with a flow diagram), and it can be changed later (affecting only future confirms).

**Why this priority**: This is the Local-First File Custody fix and removes the calibration-vs-light inconsistency. Essential for users with existing organized libraries who must not have their files moved.

**Independent Test**: Confirm an item from an inbox source and verify a move plan is produced; confirm an item from an already-organized library root and verify it is catalogued in place (recorded in the database, no move plan, no file movement) — for both a light item and a calibration master.

**Acceptance Scenarios**:

1. **Given** an item from an inbox-designated source, **When** the user confirms it, **Then** a reviewable move plan is generated (US1 flow).
2. **Given** an item from an already-organized library root, **When** the user confirms it, **Then** the files are catalogued in place — recorded in the database with no move plan and no file movement.
3. **Given** a calibration master from an unorganized source, **When** confirmed, **Then** it both gets a reviewable move plan and is registered as a master (consistent with light frames getting a plan).
4. **Given** a calibration master from an organized source, **When** confirmed, **Then** it is registered as a master in place with no move plan.
5. **Given** the user is adding a non-inbox source, **When** they reach the organization-state step, **Then** they are required to explicitly choose organized vs unorganized and are shown an explanation of the consequence (no silent default).
6. **Given** an organized and an unorganized source of the same content kind, **When** items from each are confirmed, **Then** the organized source's item is catalogued in place and the unorganized source's item gets a move plan.

---

### User Story 5 - Confirm auto-splits mixed folders (Priority: P3)

When the user confirms a folder containing more than one frame type, the app **automatically** separates it into per-category plan actions (each type routed to its correct destination). There is **no separate manual "Split" step** — splitting is implicit in confirm.

**Why this priority**: Removes a confusing extra step (folds spec 005). Valuable but secondary to the core plan surface and override flow.

**Independent Test**: Confirm a folder containing both light and dark frames and verify the resulting plan contains separate per-type move actions routing each frame type to its own destination, with no manual split required.

**Acceptance Scenarios**:

1. **Given** a folder with multiple frame types, **When** the user confirms it, **Then** the generated plan contains a distinct action per frame type, each with its own destination, without the user invoking a separate Split action.
2. **Given** a folder with a single frame type, **When** confirmed, **Then** a single move action is generated.

---

### User Story 6 - Richer inbox queue statistics (Priority: P3)

The inbox queue summary replaces the bare "N folders" figure with a **breakdown**: counts of folders per type, masters per type, and images per type, so the user can gauge what is waiting at a glance.

**Why this priority**: Improves situational awareness; lowest priority as it is informational and does not block any task.

**Independent Test**: With a known mix of items in the queue, verify the summary shows folder, master, and image counts broken down by type that match the actual queue contents.

**Acceptance Scenarios**:

1. **Given** a populated inbox, **When** the user views the queue summary, **Then** it shows counts broken down by type (folders per type, masters per type, images per type) consistent with the items present.

---

### User Story 7 - Understandable destructive destination choice (Priority: P3)

When a plan includes a **destructive action** (e.g. archiving or trashing rejected, duplicate, or superseded files), the user can choose the destructive destination — **Archive folder** (app-managed archive, the safe default) vs **System Trash** — from a **clearly labelled, well-placed control within the plan/review surface** (not an unexplained pair of radios in a sidebar that is being removed). The choice and its meaning are explained at the point of use, and the safe archive option is the default.

**Why this priority**: The control already exists but is unclear and orphaned by the removal of the right sidebar. Correctly placing and explaining it preserves the constitution's preference for archive/trash over permanent deletion.

**Independent Test**: Generate a plan that includes a destructive action; verify the destructive-destination control appears in the plan/review surface with clear labels, defaults to Archive, and that switching to System Trash is reflected in the plan actions before Apply.

**Acceptance Scenarios**:

1. **Given** a plan with a destructive action, **When** the user reviews it, **Then** a clearly labelled Archive-vs-System-Trash control is shown in context, defaulting to Archive.
2. **Given** the user selects System Trash, **When** the plan is applied, **Then** the destructive files are routed to the system trash (never permanently deleted without a recoverable step), recorded in the audit log.

### Edge Cases

- A folder is confirmed, then its files change on disk before the plan is applied → Apply must detect staleness and refuse rather than move the wrong/changed files (US1 scenario 5).
- A file has no readable header / unreadable metadata → the detail panel shows it as unclassified and allows manual override rather than hanging or crashing.
- A destination collision (target file already exists) at Apply time → the plan/apply must not overwrite silently; it surfaces the conflict for the user to resolve.
- An item spans files of mixed source provenance (some already organized in place, some not) → the plan is split **per file by provenance**: files already under an organized root are catalogued in place, while the rest receive move actions (so one item's plan may contain both catalogue and move actions).
- The active naming pattern is unset/incomplete on a fresh setup → destination preview must degrade gracefully (clear "destination unavailable until a pattern is configured" rather than a blank field).
- Multi-level grouping where some items lack a grouping dimension (e.g. no target) → such items are gathered under a clear "unknown/none" group rather than dropped.
- A multi-select override spans files across different source designations (inbox vs in-place) → the override applies to metadata uniformly, but the move-vs-catalogue decision still follows each item's source (US4).

### User Story 8 - Destination-root selection for moves (Priority: P2)

When a move plan is generated, the destination **root** is resolved explicitly. For a non-inbox source the default is to reorganize **in place** within the source's own root. Inbox sources are never a destination, so an inbox item **must** be moved into a chosen library root. When more than one registered root is a valid destination for the item's frame type, the user is **required to pick** the destination root during plan review; when exactly one valid root exists, it is selected automatically with no prompt.

**Why this priority**: Makes consolidation predictable and prevents inbox items from having no home; required for libraries with multiple roots of the same type.

**Independent Test**: With two light roots registered, confirm an inbox light item and verify a root-selection prompt appears and apply is blocked until a root is chosen; with a single calibration root, confirm a calibration item and verify the destination root is chosen automatically (no prompt); confirm a non-inbox unorganized item and verify it defaults to in-place.

#### Acceptance Scenarios

1. **Given** an inbox item and >1 valid destination root for its type, **When** confirming, **Then** the user must select the destination root before the plan can be applied.
2. **Given** exactly one valid destination root for the type, **When** confirming, **Then** the root is selected automatically with no prompt.
3. **Given** a non-inbox unorganized source, **When** confirming, **Then** the default destination is the source's own root (in place).

### User Story 9 - Mandatory capture of missing path attributes (Priority: P2)

A plan cannot be generated or applied while any attribute used to build a file's destination path is missing. Such a file routes through the same needs-review/unclassified gate as a missing image type, and the user must supply the value before the plan proceeds.

**Why this priority**: Prevents files landing in placeholder paths like "undated"/"nofilter"; ensures every moved file has a meaningful, complete destination.

**Independent Test**: Confirm a light frame missing its observation date and verify the plan is blocked and the file is surfaced for input; supply the date and verify the gate clears and the destination updates.

#### Acceptance Scenarios

1. **Given** a file missing a path-load-bearing attribute (e.g. a light with no date), **When** the user attempts to confirm, **Then** plan generation is blocked and the file is surfaced in the needs-review flow.
2. **Given** that file, **When** the user supplies the missing value, **Then** the gate clears and the resolved destination updates accordingly.

## Requirements *(mandatory)*

### Functional Requirements

**Reviewable plan surface (US1)**

- **FR-001**: Confirming an inbox item MUST produce a reviewable plan describing each intended filesystem action (source → destination, or catalogue-in-place) before any file is moved.
- **FR-002**: A confirmed (planned) item MUST remain visible and selectable in the queue, distinctly marked as planned (e.g. greyed with a planned badge), rather than being removed.
- **FR-003**: The system MUST present the plan's actions in an in-context plan panel within the inbox surface (at the bottom of the central detail area) and MUST require an explicit Apply step to execute them.
- **FR-003a**: The system MUST let the user apply a single item's plan or batch-apply all pending planned items in one action; each applied action MUST be individually recorded in the audit log.
- **FR-004**: "View plan" and plan review MUST keep the user within the inbox surface and MUST NOT navigate to the Archive page or any unrelated page.
- **FR-005**: Applying a plan MUST execute its actions, MUST never overwrite existing files silently, and MUST write an audit record for each attempted action and its outcome.
- **FR-006**: Users MUST be able to review the full plan and cancel a plan before applying, leaving all files untouched.
- **FR-007**: The system MUST refuse to apply a plan whose source files have changed since the plan was generated, and MUST surface the staleness to the user.

**Structured, groupable review + metadata (US2)**

- **FR-008**: The review list MUST present each item in a structured layout (type(s), file count, format, master indicator) using no pills, following the standard sidebar layout, with no overflowing or clipped content.
- **FR-009**: The review list MUST support grouping by one or more dimensions in a user-chosen order (multi-level / nested grouping), with collapsible groups, and items missing a grouping dimension gathered under an explicit "none" group. The available grouping dimensions MUST include target, frame type, filter, exposure, date, and source.
- **FR-010**: The detail panel MUST display, per file, the extracted header metadata: image type, filter, exposure, binning, gain, temperature, object, and observation date (showing each as unavailable when absent).
- **FR-011**: When an item contains more than one frame type, the detail panel MUST show the explicit composition (each frame type and its count) rather than only a "mixed" label.
- **FR-012**: The detail panel MUST resolve and display classification/metadata (including master type) for single-file calibration master items without hanging.

**Overrides (US3)**

- **FR-013**: Users MUST be able to override the inferred frame type and other surfaced header fields (at minimum filter, exposure, and binning) for a file before confirming.
- **FR-014**: Users MUST be able to select multiple files (within an item and across items, including via the grouped list) and apply an override to all selected at once, with an accurate applied-count.
- **FR-015**: Overrides MUST be reflected in the item's classification breakdown and in the destination/plan, the breakdown MUST remain visible after overrides are applied, and overrides MUST be scoped to the intended files only (no leakage across items).
- **FR-016**: Overrides MUST be recorded as app-side metadata only and MUST NOT modify the user's files (header values in the files are never rewritten).
- **FR-016a**: Overrides MUST persist across rescans of the same files — keyed to the file's content so they re-apply automatically — and MUST be invalidated only when the file's content changes.

**Move vs catalogue-in-place (US4)**

- **FR-017**: The system MUST decide between generating a move plan and cataloguing in place based on the **organization state** of the file's source (organized → catalogue in place; unorganized → move plan), independent of the source's content `kind` and of the frame type. For an item spanning files of mixed provenance, the decision MUST be made per file (files from organized sources catalogued in place; files from unorganized sources moved), so a single item's plan MAY contain both catalogue and move actions.
- **FR-018**: Cataloguing in place MUST record the files in the database with no move plan and no file movement.
- **FR-019**: Calibration masters and light frames MUST follow the same organization-state rule; a master from an unorganized source gets a reviewable move plan and is registered as a master, while a master from an organized source is registered without a move.
- **FR-019a**: Each source MUST carry an explicit organization state (organized / unorganized) that is orthogonal to its content `kind`; the same kind MAY have both organized and unorganized sources simultaneously.
- **FR-019b**: When adding a non-inbox source, the system MUST require the user to explicitly choose its organization state (no silent default) and MUST explain the consequence of the choice in the add-source / wizard flow (ideally with a flow diagram). `inbox`-kind sources are unorganized by definition. The organization state MUST be changeable later, affecting only future confirmations.

**Auto-split (US5)**

- **FR-020**: Confirming a folder containing more than one frame type MUST automatically produce a distinct plan action per frame type, each routed to its own destination, without a separate manual split step.

**Statistics (US6)**

- **FR-021**: The inbox queue summary MUST present counts broken down by type (folders per type, masters per type, images per type) consistent with the queue contents.

**Destructive destination (US7)**

- **FR-022**: When a plan includes a destructive action, the system MUST present a clearly labelled destructive-destination control (Archive folder vs System Trash) within the plan/review surface, defaulting to Archive, with its meaning explained at the point of use.
- **FR-023**: Destructive actions MUST prefer a recoverable destination (archive or system trash) over permanent deletion and MUST record the chosen destination in the audit log.

**Destination preview (cross-cutting)**

- **FR-024**: During review (before applying), the system MUST show the resolved destination for each file/group based on the active naming pattern, and MUST degrade gracefully (a clear message, not a blank field) when no pattern is configured.

**Per-type destination patterns (iteration 2026-06-21)**

- **FR-025**: The destination path structure MUST be configurable per frame-type class, with a distinct token-based pattern for at least: light, flat, master flat, bias, master bias, dark, master dark. Patterns use the shared path-token vocabulary and are editable in Settings.
- **FR-026**: Each per-type pattern MUST have a sensible built-in default reflecting the attributes meaningful for that type; calibration types MUST NOT include a target segment. Default intent — light: target/filter/date; flat: filter/date; dark: exposure (+gain/temp/binning as configured); bias: gain/temp/binning; master flat/bias/dark: as their raw counterpart minus date (masters are not per-night).
- **FR-026a**: The resolver MUST select the pattern by the file's resolved type including master-vs-raw (a master dark uses the master-dark pattern, etc.).
- **FR-026b**: Per-type patterns MUST be persisted in settings and user-overridable; an invalid/empty pattern falls back to that type's built-in default. (Light-master / integration routing is out of scope for this iteration — TBD.)

**Destination root selection (iteration 2026-06-21)**

- **FR-027**: For a move from a non-inbox source, the default destination root is the source's own root (reorganize in place).
- **FR-028**: Inbox-kind sources MUST move into a chosen library root (never catalogued/left in place); a destination root is always required for inbox items.
- **FR-029**: When more than one registered root is a valid destination for the item's frame type, the user MUST explicitly select the destination root before the plan can be applied.
- **FR-030**: When exactly one valid destination root exists for the frame type, it MUST be selected automatically with no prompt.
- **FR-031**: The plan/review surface MUST display the full absolute destination path (selected root path + relative path) for each action, not just the root-relative path.

**Mandatory path-attribute capture (iteration 2026-06-21)**

- **FR-032**: Plan generation MUST be gated on the presence of every path-load-bearing attribute for each file; a missing value MUST block the plan and surface the file in the needs-review flow, consistent with how missing IMAGETYP is handled.
- **FR-033**: The set of path-load-bearing attributes MUST be defined per frame type (enumerated in research.md) and MUST drive both the gate (FR-032) and the per-type destination structure (FR-025/FR-026).

### Key Entities *(include if feature involves data)*

- **Inbox item**: A unit awaiting review (a sub-frame folder or a single master file) with a source, classification state (unclassified / classified / planned / applied), and a per-type composition.
- **Source organization state**: A per-source flag — *organized* (catalogue-in-place) vs *unorganized* (eligible for move plans) — orthogonal to the source's content `kind` (`light_frames`/`calibration`/`project`/`inbox`). Set explicitly by the user when adding a non-inbox source (inbox is unorganized by definition), changeable later. Drives FR-017.
- **File metadata record**: Per-file extracted header values (image type, filter, exposure, binning, gain, temperature, object, date) surfaced for review and override.
- **Override**: A user-supplied correction to one or more header-derived values for one or more files; app-side only, never written to the file.
- **Grouping**: An ordered list of dimensions (e.g. target, then frame type, then filter) used to nest the review list.
- **Plan**: A reviewable, named set of filesystem actions (move / catalogue / archive / trash) generated on confirm, with a state (open / applied / cancelled / stale) and an audit trail.
- **Plan action**: A single intended filesystem operation (source → destination, catalogue-in-place, or destructive) with a resolved destination preview.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of confirm operations that move files do so only after an explicit Apply on a reviewable plan; zero files are moved at confirm time.
- **SC-002**: After confirming an item, the user can review the resulting plan and its actions without leaving the inbox surface (no navigation to the Archive or any unrelated page) in 100% of cases.
- **SC-003**: A confirmed item remains visible (as "planned") until its plan is applied or cancelled; zero confirmed items vanish without trace.
- **SC-004**: A user can see each file's frame type, filter, exposure, and binning, and correct any of them, for every reviewable item (no metadata field is permanently hidden).
- **SC-005**: Applying an override to a selection of N files updates exactly those N files and the reported count equals N in 100% of cases.
- **SC-006**: The review list can be grouped by at least two dimensions in a chosen order, and the resulting nesting matches the data in 100% of cases.
- **SC-007**: Confirming an item from an already-organized library root results in zero file movements and a catalogue record, for both light and calibration items.
- **SC-008**: Confirming a mixed-type folder yields one plan action per distinct frame type with no separate user action, in 100% of cases.
- **SC-009**: The Calibration page and the inbox detail panel render without runtime errors for freshly-confirmed masters (zero crash reports for the master/detail views).
- **SC-010**: The inbox summary's per-type counts match the actual queue contents exactly.
- **SC-011**: No status pills overflow the sidebar; the review list and detail panel follow the standard pinned-bar/scrolling-content layout at the supported window sizes.

## Out of Scope / Non-Goals

- Rewriting FITS/XISF file headers from user overrides (overrides are app-side only — FR-016).
- Any image processing (calibration, stacking, registration, etc.) — the PixInsight boundary is unchanged.
- Designing a new naming-pattern editor; this feature consumes the existing active pattern for destination resolution.
- A general cross-page "Plans/Archive" management redesign beyond surfacing the inbox-generated plan in-context.
- Automatic application of plans without explicit user Apply.

## Assumptions

- **Organization state is a new per-source field**: Today's `SourceKind` (`light_frames`/`calibration`/`project`/`inbox`) describes content role, not organization, so a new explicit per-source organization-state field is introduced. FR-017 keys on it. There is no silent default for non-inbox sources — the user chooses at add-time; `inbox` sources are unorganized by definition.
- **Overrides never modify files**: Consistent with the PixInsight boundary and Local-First custody, overrides are stored as application metadata and never written back into FITS/XISF headers (FR-016).
- **Plans remain the mutation mechanism**: This feature changes the *visibility, placement, and triggering* of plans, not the underlying reviewable-plan/audit machinery, which already exists.
- **Destination resolution reuses the active naming pattern**: Destination previews and plan destinations are resolved from the already-configured naming pattern, surfaced earlier (at review) rather than via a new resolver.
- **Metadata is already extracted**: Per-file FITS/XISF header values are already extracted during scan/classify; this feature surfaces, persists, and lets users correct them rather than adding new extraction capability.
- **Standard layout convention applies**: The list and detail follow the project's established page layout convention (pinned bars, scrolling content) so nothing overflows.
- **Folds prior specs**: The mixed-folder split (spec 005) becomes implicit in confirm; cross-root inbox (spec 039) and master detection (spec 040) remain in force and are extended, not replaced.
- **Recent bug fixes are stopgaps**: PR #298 restored basic function (masters classify, override scope, breakdown persistence, destination placeholder, calibration crash); this spec defines the intended behavior that supersedes those stopgaps.

## Dependencies

- Existing reviewable-plan and audit subsystem (plan generation, apply, audit records, archive/trash safeguards).
- Existing FITS/XISF metadata extraction (frame type, filter, exposure, binning, gain, temperature, object, date).
- Existing naming-pattern resolver for destination computation.
- Existing calibration master detection/registration (spec 040) and cross-root inbox (spec 039).
