# Harness v5: feedback round 1 (user, 2026-10-09)

The user reviewed `186686b8`. This file is the work order for round 2. Its proposals beyond the contract ("P-" items) are mocked so the user can judge them. They become contract decisions only when the user accepts them.

## Copy rules (every screen, every slice)

- **Microcopy only.** Labels, values, status words. No sentences that explain how the product works. Never show captions such as "Each session has one action that moves it on", "Unmet goals of open projects", "Every run and its membership" or "Library quality and captured frames".
- **Help on demand only.** If a rule truly needs explaining, put it in a `HelpTip` (a small ⓘ with a tooltip). Default to no help.
- **Errors and refusals are terse.** Format: `<Action> blocked · <count> <reason>`, with the details in a disclosure or popover listing the blockers as chips or rows. Example: `Can't remove rig · used by 6 runs ▸`. Never one long semicolon line.
- **No "Unchanged / What stays" lists** in previews unless something non-obvious stays. Previews show what changes.
- **Measured values:** the value, plus a ① note marker whose tooltip carries method, basis and time. No inline paragraphs. Example: "PlateVault PSF (Moffat β=4) proto-0.1 · linear, mono · input SHA-256 … measured …" goes into the tooltip, shortened. An absent import reads "–", never a sentence.
- **Use bubbles and boxes:** status pills, count badges, chips for channels, filters and blockers, and grouped panels with a hairline box instead of separator text. Tables keep the native look.
- Every text field that filters or searches gets a clear (×) button.
- Term budget: buttons 1 to 3 words, headings 1 to 2 words, empty states one line plus one action.

## Shell and navigation (foundation)

1. **Issues hub.** The toolbar gets an Issues button with a count badge, tinted by worst severity. It opens a popover or panel listing every issue across the app, grouped and each one actionable:
   - sessions that need a Target, and sessions in no Project;
   - offline locations, and interrupted or failed work;
   - blocked runs;
   - calibration that needs review;
   - drift.
   Home's top line becomes the same issues as clickable pills (`2 need a Target` `3 not in a Project` `1 offline`).
2. **Menu highlighting.**
   - The source list gets count badges (Sessions: needs-attention count; Projects: open blocked count) and clearer selected and hover states.
   - Remove the Project outline from the source list (subjects, runs, trash): the source list stays navigation only. The Project page owns its runs and stages; a run's six steps live in the run's own step bar.
   - Recent Projects may appear as a short "Recent" group (max 3) without outline children.
3. **Back.** An icon-only ← (and →) history control at the toolbar's leading edge, outside the source list, with tooltips "Back" and "Forward".
4. **Primitives** (shared, so slices use one convention):
   - `ClearableInput` (search with ×).
   - `HelpTip`.
   - `Refusal` (terse line plus a disclosure list of blockers as chips with links).
   - `Pill` / `CountBadge`.
   - `NoteMarker` (① with tooltip).
   - `Box` (a hairline panel with an optional small heading).
   - Context-menu helpers for tables and list rows, so right-click works on every list.
5. **Themes.** Restore multiple themes alongside the v4 dark and light:
   - PlateVault Dark and PlateVault Light (current);
   - Gruvbox Dark and Light;
   - Nord;
   - Dracula;
   - Solarized Dark and Light;
   - Catppuccin Mocha and Latte;
   - Tokyo Night;
   - One Dark;
   - Rosé Pine.
   Every theme maps the existing token set; status tones must keep at least 4.5:1 on every surface of each theme (computed). Settings › Appearance offers a picker with live swatches.
6. **Language.** Settings › Appearance (or Settings › Language) offers a language picker: English (UK) and Português (Brasil), matching the legacy app's locales. The prototype ships en-GB strings and a pt-BR string table for the shell, nav and Home at least, so switching is visible. The rest falls back to en-GB, marked as machine-generated.

## Domain and seed (foundation)

- **P-CAL1: calibration lives outside Projects.** Index and Import detect calibration frames as **calibration sessions** (dark, flat, bias and dark-flat groups) in the Calibration library. A Project only assigns them (through run calibration). A master is built from a calibration session, with an `Integrate master` action that hands off to a configured tool profile (Siril / PixInsight), or later a built-in stacker. The result is registered as a master.
- **P-CAL2: dismiss is reversible.** A dismissed master offer goes to a Dismissed filter in the Calibration library with Restore offer, never gone permanently.
- **P-ARC1: archive locations.** There can be several archive locations; one is marked Default in Settings › Locations. The Archive step picks the destination, defaulting to the Default and changeable per Project.
- **P-WRAP1: wrap-up is part of the Project flow.** When every run is Complete, the Project gets a Wrap up stage: Clean up runs → Trash rejects / intermediates / duplicates → Archive → Done. Each step is optional and skippable, with sizes shown. This replaces the separate "Open Done / Archive" sheet. A run's own Clean up stays on its Done step.
- **Goals:**
  - Restore the goal kinds: integration time, frame count, quality bar (median FWHM limit, Usable only, or both), per panel for mosaics.
  - Channels are structured: chips from the band set (L, R, G, B, Ha, OIII, SII, plus OSC broadband / dual-band), not free text.
  - Goal templates hold these kinds. Remove "Applied in" from templates.
- **Sites:** one default site (radio / "Make default"), shown in the Sites list. Plan and Tonight use the default unless one is picked.
- **Planning:**
  - Per-filter moon constraints. Each filter or band has a minimum Moon separation and a maximum illumination; broadband needs a dark Moon, narrowband tolerates more.
  - Derived per target and night: which filters are "good tonight".
  - Planning keeps a **Plan list** of Targets (add or remove), with a "Show all" toggle that lists My targets.
- **Storage:** drop run and group footprints from the overview (a footprint is the bytes of prepared copies per run, which only matters for Clean up; show it on the run's Done step and in Wrap up instead). Duplicates are not listed by default: a **Scan for duplicates** action runs an operation and lists results.
- **Import sources:** no named "ASIAIR card". **Removable devices** are detected when connected (USB / SD). Recognise common layouts (ASIAIR, NINA, SharpCap, Ekos/KStars, SGP, Voyager) by folder structure and name the device type when recognised. Seed one recognised device and one generic one.

## Screens (slices)

### A: Home, Sessions, Import
- Home:
  - The issues pill strip replaces the top line.
  - Strip every explanatory caption.
  - Make section headers one word.
  - Use boxes and pills.
  - Unreviewed sessions offer Review frames in place.
- Sessions:
  - Review frames from a session: open the frame review (d's `ReviewStep` in a session context) on the session detail, and as a row action.
  - Calibration sessions show in the Calibration library, not here.
- Import: Removable devices section (autodetected, layout recognised), plus Choose folder, Saved sources, Import new. Terse.

### B: Projects, Project, New Project, Start run, Trash, Wrap up
- Project page, with no outline in the source list:
  - The header carries a stage strip: Open → (runs) → Wrap up → Done / Archived.
  - Runs come first.
- Candidates: Review frames directly (mount `CandidateReview`) and Start run from a selection.
- **Mosaic flow (one frame).** "New mosaic subject" or "Start mosaic run" opens a single editor:
  - Left: the panel grid on the field, drawn from the rig's FOV; add or remove panels, and include or exclude each.
  - Right: sessions, auto-placed by pointing; drag or assign to a panel; flags for ambiguous or off-panel sessions.
  - Confirm creates the run group with only the included panels.
  - Remove the multi-step sheet.
- Start run sheet:
  - Fix the profile select bug ("Choose in Prepare" shows "Open in" as the first option).
  - Remove "What starts".
  - Keep it to subject, rig and profile (optional).
- Refusals: terse, using `Refusal` (for example, removing a rig).
- Apply goal template: remove the "Unchanged" list; the preview shows only the goal changes.
- Wrap up (P-WRAP1) replaces the Done / Archive sheet, with an archive destination picker (P-ARC1).
- Trash: one Empty Trash action plus per-row actions in a context menu; no stacked red buttons.

### C: Run and Run group
- Strip captions.
- Use terse refusals.
- Calibrate: master offers use the reversible Dismiss (P-CAL2); a calibration session can be assigned directly.
- Prepare: show the footprint (prepared bytes) there and on Done.
- Profile pickers get the same fix as B.

### D: Review
- **Corner inspector:** a 3×3 aberration inspector (Ctrl/⌘+I or a toolbar toggle). Nine tiles, the four corners, the edge centres and the centre, at 1:1, with optional FWHM and eccentricity per tile.
- Source notes become ① tooltips (NoteMarker), with no inline paragraphs.
- Absent imports read "–".
- Accept a session context (review from Sessions) in addition to run, group and candidates.
- Strip captions.

### E1: Targets, Plan
- Targets:
  - Clearable search.
  - Per-filter "good tonight" in the imaging columns: a filter chip strip coloured by tonight's suitability.
  - Filters for Moon distance and phase per filter (for example, "OIII ok with Moon ≥ 60°").
  - Right-click everywhere.
- Plan:
  - The Plan list with add / remove / Show all (default: the Plan list, else My targets).
  - A narrower timeline: compact rows, a smaller label column, and the hour axis at the top only.
  - Per-filter windows, with Moon separation per row.

### E2: Calibration, Storage, Settings
- Calibration library:
  - Calibration sessions, with Integrate master (P-CAL1).
  - Masters, with "Used by" behind a details disclosure.
  - Dismissed offers, with Restore.
- Storage: no footprints, plus Scan for duplicates (an operation).
- Settings:
  - Themes and Language (Appearance).
  - Goal templates (structured kinds and channels, no Applied in).
  - Sites (Default).
  - Locations (several archive locations, with Default).

## Answers to the user's questions (for the lead's reply)

- **Project outline in the source list:** removed. Navigation only; the Project page owns runs and stages.
- **Cleanup in the process:** yes, as the Wrap up stage (P-WRAP1).
- **Archive locations:** several are allowed; one is the Default; the destination is chosen at Archive (P-ARC1).
- **Calibration:** detected as calibration sessions at index or import, and kept outside Projects (P-CAL1). For auto-stacking into masters, see the lead's feasibility note.
- **Footprints:** low value in the overview; moved to Clean up.
- **Duplicates:** scan on demand.

## Round 1b decisions (user, 2026-10-09)

- **P-CAL3: masters only (user-chosen; supersedes P-CAL1's raw handling).**
  - The Calibration library holds masters only, and runs are assigned masters only. Raw-set assignment is dropped.
  - Raw calibration frames exist only as input to a separate **calibration process**, with these steps:
    1. Import or index detects a raw calibration session.
    2. **Stack** hands it to the configured tool (Siril / PixInsight).
    3. Watch the tool's output folder and **detect the master** (IMAGETYP master, NCOMBINE).
    4. **Auto-import it** into structured calibration storage, with a layout per kind:
       - flats per optical train + filter + night (flats are short-lived and night-specific);
       - darks per camera + exposure + gain/offset + temperature, and bias per camera + gain/offset (long-lived libraries).
    5. Register the master with lineage to its raw session.
    6. **Delete the raws** (OS Trash) on success, or keep them (a setting).
  - Each step is visible and resumable. A stacked master from elsewhere imports directly.
  - Stacking stays a tool hand-off for now. A built-in stacker is deferred.
- **i18n gate (user):** every user-visible string must come from the message catalogue, and a lint enforces it, as in the previous release. The previous app had:
  - Paraglide / inlang `messages/<locale>.json` accessed via `m.<key>()`;
  - ESLint rules `alm/no-user-string` and `alm/no-js-plural` (`apps/desktop/eslint-rules/no-user-string.js` on main);
  - `scripts/check-i18n-catalog.mjs` and `scripts/check-i18n-locale-drift.mjs`.

  The harness adopts that stack, replacing the foundation's interim `t()`. The migration (catalogue extraction plus the lint gate) runs once, after the round-2 slices integrate, so the slices don't conflict on shared catalogue files.
- **Status bar (user):** use the full bottom bar.
  - Left: locations.
  - Middle: issue chips by kind (offline, blocked runs, needs a Target, calibration waiting), each clickable.
  - Right: running work (each operation with progress, cancel on hover) and the last notification ("Import finished · 54 frames") with a history popover.
  - Context: the selection count when a list has a selection.
  - It shares its data with the Issues hub.

## Round 2c (user, 2026-10-10)

- **P-SB2: the status bar carries more issues and notifications (user: "we are wasting the majority of the bottom bar").** Measured on `1b2b70e5` with the demo library at 1920 px: the chip slot was 1356 px wide and its four chips used 510 px. Five of the twelve issue kinds (`not-in-project`, `work-failed`, `work-interrupted`, `master-offer` and `drift`) had no chip, so the bar showed 7 of the hub's 8 issues.
  - **Every issue kind has a chip.** New chips: "{n} failed" (work-failed + work-interrupted), "{n} not in a Project", "{n} masters offered", "{n} changed" (drift). Invariant: the issues the chips cover are exactly the hub's issues, so their counts agree.
  - **Order:** severity (danger, warning, info), then hub group order.
  - **Density follows the room:**
    1. Each issue becomes its own named pill ("M 31 LRGB blocked", "Cold-1 offline"), linking to its action.
    2. If those don't fit, group by kind ("2 blocked").
    3. If still short, the last chips go under "+N".

    The ruler measures every level, so the row never wraps or clips.
  - **Notifications inline:** the right slot shows up to three unread notifications, newest first, with dividers between them; when short of room, the oldest goes first. The history trigger has an unread count, and opening it marks them read.
  - **No issues:** a muted "No issues" with a check, rather than empty space.
  - **Check:** at 1024, 1440 and 1920 px with the demo library, nothing wraps, clips or overlaps. Below 768 px, unchanged.

## Round 5 (user, 2026-10-10)

The user reviewed `d6c9f1b2`. This section is the work order for round 5. Decisions marked (user) were chosen by the user; the rest are the lead's answers to the user's questions.

### Shell, status bar, Home
- **P-SB3: the status bar shows severity counters, not issue pills (user; supersedes P-SB2's pills and inline notices).** The user: "showing bubbles in the bottom bar is not great, plus I don't think it makes sense to show all of them there. Maybe just alert/warn/notify with popout."
  - Left: locations online, then the selection count when a list has a selection.
  - Middle: running work as plain text with a mini progress bar and Cancel on hover/focus; "Idle" when nothing runs.
  - Right: three plain-text counters with their glyph, ⛔ errors, ⚠ warnings and ℹ info, shown only when non-zero. Each opens a popout listing those issues (IssueRow, with its action). Then the bell with the unread count, opening the notification history. No pills, no inline notifications, no named issues.
  - With no issues: a muted ✓ and nothing else.
- **Home has no issues strip.** The toolbar Issues button and the status-bar counters already carry them.
- **Home rows open the Project page.** A Project row on Home links straight to `/projects/$projectId`; its row menu keeps the other actions.
- **Navigation:** Storage and Plan leave the source list (see below). `/plan` and `/storage` redirect to their new homes.

### Projects and runs
- **Runs read as one model.** Every run shows the same step strip and status vocabulary. A mosaic Run group shows its overall status (the worst across its panels, plus "N of M panels at <step>") and, per panel, exactly the status a single run shows. The Project page's Runs section lists single runs and groups in one table: name, step, status, updated.
- **Remove an unused rig.** A Project's rig row has Remove when no run uses it; otherwise the terse refusal "Can't remove rig · used by N runs ▸".

### Targets and planning
- **P-PLAN2: Targets and Plan merge into one Targets page (user).**
  - A date picker in the page header (default tonight) sets the night that suitability, altitude and windows use.
  - Views: All (catalogues and My targets, filters, presets) and Planned (the night's schedule in order, with windows).
  - A compact altitude column (a sparkline of altitude across the night, with the dark window shaded and the target's best window marked; a tooltip states max altitude and time) appears in both views. The wide altitude timeline goes.
  - Add to plan / Remove from plan remain row actions.
- **Best tonight shows nothing:** a bug. The preset must list targets with a usable window on the chosen night for the selected rig, best first.
- **Click a result to act.** In search results (adding a Target to a Project, the Targets search, the New Project subject search) and in general, clicking a result row performs its primary action. Explicit Add buttons on result rows go; the row's menu keeps the other actions.

### Sessions
- **OBJECT is a label, never evidence (HIGH-LEVEL-DESIGN.md glossary: "OBJECT: the header label; a filter, never identity or coordinates").** Every capture application writes OBJECT its own way, so target association uses pointing (RA/Dec within the target's footprint) and the user's confirmation only. Session detail shows OBJECT as a label. It is never listed as Target evidence, never preselects, and never counts towards confirmation.

### Calibration
- **Masters have details and can be dismissed.** A master row opens a details panel: kind, camera, optical train, filter, exposure, gain/offset, temperature, binning, frame count, created, source (stacked from which raw session, imported or indexed), storage path, SHA-256, and Used by. Actions: Dismiss (reversible, P-CAL2) and Restore.
- **Used by is a popover.** A count ("Used by 6 runs") opening a scrollable list; it never expands the row.

### Storage and duplicates
- **P-STO2: the Storage tab goes (user).** Locations and disk use per location live in Settings › Locations. Transfers are Activity entries.
- **Duplicates are scanned automatically** after each index and import, as a background operation. A non-zero result raises a ⚠ issue ("N duplicate copies · 2.1 GB"), which opens the Duplicates review.
- **Duplicates review has clean-up:** groups of byte-identical copies, each with the copy to keep preselected (a library location over a capture card, then the oldest), Keep this copy and Move the others to the OS Trash, per group and for all. Nothing is deleted permanently.


## Round 6 (user, 2026-10-10): decisions from the journey questions

Every decision below was made by the user while answering the v5 journeys' open questions (journeys PR #1788). Each item is a work order for the prototype and is reflected in the journeys. Supersedes earlier text where they disagree.

### Import and sessions
- **P-IMP2: confirm Targets in the Import preview.** The preview lists each incoming session with its Target, prefilled from pointing (the Target whose footprint contains the pointing; nearest centre wins), with OBJECT shown only as a hint. The user confirms or changes it there, or picks Unclassified. Importing confirms those Targets and files the frames under `{target}/…` at once: no Inbox and no later move. Unclassified sessions go to an Unclassified folder and can be filed later with one reviewed move.
- **Import source vanishes mid-import** (SD pulled, share dropped): the import pauses as Interrupted; reconnecting and choosing Retry resumes it.
- **Confirming a Target the pointing disagrees with** is allowed. The session's Target box then shows a mismatch warning.
- **Archive… from Sessions:** sessions in no Project can be archived from Sessions (select, then Archive…), using the same reviewed transfer as Wrap up.

### Frames
- **Reject is library-wide by default.** X marks a frame Unusable in the library, so it leaves every run, and Unusable frames become purge candidates: a library clean-up and Wrap up offer to move them to the OS Trash. "Reject for this Project only" stays in the frame menu for the rare case. There is no separate "Exclude from run".
- **Large bulk marks need confirmation** (⌘A then P/X/U on many frames): "Mark 120 frames Unusable?"

### Projects and runs
- **Rename runs and Projects:** Rename on the run header, plus Edit details (name, notes) on the Project header and in the Projects row menu. Start run stays subject + rig + profile, auto-named.
- **Select keeps the selection tools from spec 066:** sky coverage, distance from the Target, geometry ordering, filters and the hidden-selection count.
- **Results location override stays** in Prepare (default: beside the run folder).
- **Mosaic: an excluded panel keeps its goals** on the subject, so a later group can include it (its goals show as unmet).

### Calibration
- **Calibration Off:** compatible masters still show as Suggested and wait for acceptance.
- **Dismiss is refused while a run uses the master** ("Can't dismiss · used by N runs ▸"). A dismissed master is never matched; Restore brings it back.
- **Adopting a master** (Add to library) opens a confirmation with the destination path and SHA-256, and re-verifies the bytes at that moment.
- **No silent re-rank.** A run with masters assigned keeps them. When a better compatible master appears, Calibrate shows "Better match available".
- **Result revision:** tool evidence (header or recorded input list) decides; without it, the revision current when the file appeared, marked Inferred.

### Targets and planning
- **Targets opens on My targets** (yours plus favourites). A toggle switches to Browse catalogues.
- **Clicking a result:** a Target in My targets opens; a catalogue result is added.
- **Per-night plans.** Each night has its own plan, and Add to plan adds to the chosen night.
- **Reminders and calendar export stay.** A notification before a planned window, and a calendar export of everything upcoming (all planned nights, not just one). Both live in the Planned view header.
- **Target library facts:** the Target page shows usable, Unreviewed and Offline integration per channel, library-wide. Candidates gets a capture-site column.

### Equipment, storage, shell
- **Rigs: detection plus manual add.** Settings › Equipment can add a camera, telescope or rig by hand for gear not yet imaged with, as well as renaming and editing detected ones.
- **The duplicate scan covers registered library locations only.** Capture cards never raise the duplicates warning. The keeper is the copy in the earliest-registered location.
- **Disk use per location:** bytes PlateVault catalogues there, plus the volume's free space.
- **Quit asks** while an import, index or prepare runs.
- **Onboarding: walk plus checklist.** An orientation walk after setup, and a Getting started checklist on Home (setup, first import, first Project, first run) until done.

### Input modes (user, 2026-10-10; research: design/INPUT-MODES-RESEARCH.md)
- **P-PREP2: three Prepare modes, Automatic by default.**
  - **Independent copy (default):** Rust `std::fs::copy` clones where the filesystem can (APFS, Btrfs/XFS, ReFS/Dev Drive), uses server-side copy on NFS 4.2 and SMB, and otherwise copies. Entries are made read-only once verified.
  - **Link to originals (opt-in, with a warning):** symlinks; a hard link only on the same local volume when symlinks are unavailable. The originals are re-hashed after the run.
  - **Give PixInsight the file list:** WBPP only. Siril always needs a folder.
  - **Removed:** Hard links as a mode of their own, and junctions for files.
  - **Footprint is real:** each prepared item records whether it was cloned or copied, and Prepare and Done show the actual extra space ("0 B extra · cloned" vs "12.4 GB copied").
- **Prepared copies are cleaned up when a run is done (user).** Copies cost real space on volumes that can't clone. Completing a run offers Clean up prepared copies by default, showing the footprint; they go to the OS Trash after review. Wrap up's Clean up runs step covers any that are left. A run whose entries are all clones says so ("frees no space").
- **Archiving with links (Q-ARCHIVE-LINKS):** a symlinked entry is repointed when its session moves. Hard-linked entries no longer exist as a mode.

## Round 7 (user, 2026-10-12): run views (research: design/RUN-VIEWS-OPTIONS.md)

- **P-PREP3: two view modes, Symlinks by default (user; supersedes P-PREP2).** A run view is a projection of catalogue frames and masters. Siril, WBPP and DSS never write to FITS, camera RAW or TIFF inputs. The exception is Siril SER video: it opens SER read-write and can rewrite the header (RUN-VIEWS-OPTIONS.md).
  - **Symlinks (default):** the run folder holds symlinks to the catalogue originals. Footprint "Linked · 0 B".
  - **Copies:** the run folder holds temporary copies. Footprint "N frames copied · X GB". Copies are removed when the run completes.
  - The mode is chosen per run in Prepare, with a default in Settings. There is no Automatic, no file-list mode, and no hard links or junctions.
  - **Windows prerequisite:** Symlinks need Windows Developer Mode. PlateVault checks it in setup, in Settings and at Prepare. When it is off, Prepare in Symlinks mode is refused: "Can't prepare · symlinks need Windows Developer Mode ▸", offering Open Windows settings, Check again and Use copies for this run.
- **Import still copies** frames into the catalogue (unchanged).
- **No verification of originals after a run (user).** P-PREP2's re-hash of linked originals is dropped. Since PlateVault no longer records cloned vs copied, the per-item accounting that P-PREP2's "Footprint is real" required goes too.
- **Intermediates cleanup stays (user).** Wrap up offers it, and the run's Complete confirmation offers it next to removing the view, both through the OS Trash.
- **Locking originals: skipped (user, 2026-10-12).**
- **SER: out of scope (user, 2026-10-12).** Runs take FITS, XISF, DNG and camera RAW (CR2, CR3, NEF, ARW, …) only. SER handling is a future constraint (bead).

## Round 8 (user, 2026-10-12)

- **P-ISS1: issues can be dismissed (user).** Each issue in the issues hub and in the status-bar popouts has an × (Dismiss).
  - A dismissed issue stays hidden until it changes: the same kind, the same subject, and the same count and bytes. A new failure, another duplicate or a location going offline again brings it back.
  - The hub ends with "Dismissed (N)" and Restore. The counters and badges count only issues that are not dismissed.
  - Dismiss hides the issue only; the state behind it is unchanged, and its page still shows it.
  - **No × on issues that are a run's next step** (`run-blocked`, `calibration-review`): the run is waiting on the user, and the issue is how they find it.
  - **Superseded in part (user, 2026-10-14; D-W92 and FR-032 in `specs/063-clean-rebuild-contract`, PR #1804).** There is no issues hub: each issue shows on the row it affects, with its action, on every page that lists that row. The hub's "Dismissed (N)" list and its Restore go with the hub. What the status-bar counters and their popouts show without a hub, and where a dismissed issue is restored, are still open.
- **P-TRASH2: a frame linked by an unfinished run can't go to the Trash (user; resolves J34/G8, J44/G5).**
  - Every move to the OS Trash (Wrap up rejects, the Unusable purge, duplicates clean-up) refuses a frame or master that the view of a run that is not Complete links to: "Can't trash · linked by {run} ▸", leading to that run. Refreshing the run's view drops the link (rejected frames have already left its membership), and then the frame can go.
  - Completed runs: Complete removes the view by default. If the user kept it, the Trash review says "Also removes N links in kept run views", and the move takes those links with the frame.

## Round 9 (user, 2026-10-12)

Feedback walk of ~120 items; beads under epic astro-plan-0drm0. Research: R9-ANSWERS.md, R9-HOME-DEBATE.md, R9-PIXINSIGHT-STATS.md, R9-PREV-PRODUCT-PATTERNS.md, R9-UX-AUDIT-A/B/C.md. Proposed answers wait on the composition plan (astro-plan-blbjw) and the standards decision (astro-plan-42eka).

- **P-REV2: review happens at session ingestion (user; supersedes run-time review).** A session's frames must be fully reviewed before the session can be used in a Project or run. Runs no longer review unreviewed frames.
- **P-REJ2: Reject is library-wide only (user; supersedes "Reject for this Project only").** Project-only rejections are dropped.
- **Components (user):** only standard components, composed; no page-local lookalikes; reuse before rebuilding; one flow for staged work across the product. A single owner plans the rebuild (astro-plan-blbjw).

### UI stack, grilling round 1 (user, 2026-10-12; research R9-NATIVE-UI-KITS.md, R9-FLUTTER-MIGRATION.md, R9-BACKEND-SERVICES.md)
- **"Native" means OS-drawn surfaces and platform conventions** (menu bar, context menus, dialogs, notifications, tray, window chrome, button order, shortcuts). Per-OS control looks (Fluent on Windows, macOS controls on a Mac) were considered and then **dropped** (user). Speed is nice to have.
- **No dual web component kits** inside the webview (Fluent + a macOS kit behind one API): dropped.
- **WCAG 2.2 AA is a target, not a hard gate.** It does not by itself rule out Flutter.
- **Flutter: wait** for the spike results before deciding.
- **Backend services crate (user, scope confirmed).** Moves into a framework-agnostic Rust crate (no Tauri, no Flutter bridge, no window types): update check/download/verify/install and relaunch (library per the updater comparison), notifications, logging setup, and the shared state/event channels (latest-value state for update status and job progress; broadcast for transient events). Stay where they are: trash, file watching, open/reveal. Deferred: single instance, deep links, autostart. The window owner keeps menus, tray, dialogs, window state, drag and drop, macOS URL events and packaging.
- **Updater:** switch away from tauri-plugin-updater now if another option offers better functionality and usability; compare the options first.
- **Linux is a supported platform.**
- **Xcode** is not installed for now; the Flutter spike reports what it can without it.
- **Add a Slint spike** (Rust-native UI with Fluent/Cupertino styles) next to the Tauri and Flutter spikes.

### Components and flow, grilling round 2 (user, 2026-10-12; plan R9-COMPOSITION-PLAN.md §9)
- **C1 Dialog buttons:** Cancel, then the action, on every OS (one shared DialogFooter decides).
- **C2 Renames accepted:** Complete → Finish run (state Finished); the run's Done step goes; the final Mark done → Close project; Wrap up's first Mark done goes (Proceed replaces it); masters Dismiss → Hide / Show hidden; one Edit… verb; Tonight → Planning; About this prototype → About. "Good tonight for" → **Suitable filters**. **Move to Trash uses the destructive (red) style.**
- **C3 Wrap up order is strict:** Clean up → Trash → Archive; later steps stay read-only until earlier ones are finished or skipped; earlier steps reopen until Close.
- **C4 Step footer:** "Proceed" on every step; the last step names its action (Finish run…, Close project…, Finish review).
- **C5 Site map:** Leaflet + OpenStreetMap tiles (new dependency approved), plus a place search and "Use my location"; the number fields stay the source of truth, with a "map unavailable" fallback.
- **C6 Moon:** one Moon-avoidance curve per filter (required separation shrinks as the Moon dims); grades and Img time both use it. Verify the ACP / N.I.N.A. convention against a source before building.
- **C7 Goals:** each goal is time **or** frames. Extra conditions wanted: a quality bar on counted frames, channel balance, mosaic coverage, and a deadline or season window (set-up proposal pending the user's confirmation).
- **C8 Home (decided 2026-10-13, decision astro-plan-b66vy, which holds the full specification):** one dashboard of what needs you, what is running and when to capture next. Each row opens the page that owns it. One-click buttons are kept only for major actions that need no further input and can be undone. It is one page, with no tabs and no header buttons. From 1280 px, two columns: Pending ingestions, Pending work and Open work on the left; Status, Tonight and a 5-week calendar starting this week on the right. Each calendar night shows the Moon phase, the hours of darkness, the goals it suits and the targets planned. Hovering or focusing a night opens a card, and clicking it opens Targets for that night. Problems show on the row they affect; there is no alerts list. Each section shows at most 5 rows, then "All N ›". Not on Home: recent Projects, the activity log, charts, thumbnails, the setup checklist (it's the sidebar ring) and weather (backlog astro-plan-1tix3). The empty-state copy is in b66vy. Separate units: the cross-page Quick actions switch (One-click / Open page), rearranging sections (backlog astro-plan-28tz9), and the desktop capture watcher (astro-plan-ef440).
- **C9 Calibration:** Import masters selects **files** (multi-select; FITS/XISF filters), then a preview table with each file's match (New / Replaces {master} / Duplicate). Replace… on a master uses the same matching step and re-points unfinished runs after a confirm listing them; finished runs keep their recorded calibration. Darks, bias and dark-flats older than N days (default 90; flats exempt) get an "Old · {n} d" badge, with an issue only when an old master is assigned to an unfinished run.
- **C10 Fully reviewed:** every frame is Usable or Unusable, with "Mark rest usable" and "Select by threshold…". A session used by an unfinished run's prepared view is **locked**: reopening its review is refused until the run finishes or its view is removed (the user: a tool such as PixInsight may be using it). Before a run is prepared, changes show as "Inputs changed · Refresh ▸".
- **C11 Density: dropped** (one density; the setting goes).
- **C12 Test tooling:** Vitest + Testing Library **and** Storybook (dev dependencies approved).
- **C13 Typeface:** system font until the stack is decided.
- **C14 Review at ingestion:** the Sessions list's "Needs review" filter is the queue; each session has a review step page; "Finish review" opens the next one; Import ends by opening the first session that needs review.
- **C15 Metadata corrections** move to ingestion (a recorded vs corrected table in the session's review flow); Prepare applies them and shows "N corrected values".

### Copy rule (user, 2026-10-12)
- **Everything is i18n.** Every visible string goes through the message catalogue in en-GB and pt-BR: product pages, the component catalogue and its captions, the design-system page, the simulation panel and the Prototype controls. Nothing goes in the i18n ignores without a genuine reason; the only valid ones are catalogue names and other proper nouns (Messier, NGC, target designations, file names, paths, code identifiers), unit tests and fixtures, internal code and docs, debugging and logs (user).

### Stack and updates, grilling round 3 (user, 2026-10-12; R9-SPIKE-*.md, R9-UPDATER-OPTIONS.md)
- **S1 Stack: stay on Tauri + React.** The composition rebuild happens there; the services crate keeps a later switch possible.
- **S2 Updater path:** the user asked for the best of breed per OS and a check on SignPath's free certificate. Research: R10-UPDATER-BEST-OF-BREED.md (2026-10-13). Its decisions D1–D11 wait on the user.
- **S3 Update behaviour:** nothing downloads until the user chooses to install. When an update is available, a notification offers **Install now** or **Install on quit**. Never at launch.
- **S4:** fix the three release bugs now (macOS 0.6.0 build without a darwin manifest entry, Windows signing order breaking minisign, updater plugin bump).

### Goals, grilling round 4 (user, 2026-10-13)
- **C7 settled.** Each goal is time **or** frames. The conditions:
  - **Quality bar:** optional per goal: "count only frames with FWHM ≤ x″". Frames over the bar show as "+N h below bar".
  - **Channel balance: dropped as a goal (user).** The per-channel goals already set the ratio, and a ratio alone cannot say when a subject is done. The Project page shows each subject's channel ratio as counted, next to the ratio its goals imply.
  - **Mosaic coverage:** each panel keeps its own goals. The subject completes when every panel meets them, and progress shows the weakest panel.
  - **Mosaic panel balance (new, user):** per channel, panels stay within ±N % of each other in counted integration (Usable frames inside the quality bar; frames when the goal counts frames). The default is ±10 %, and the user can change it.
  - **Deadline or season window:** optional per subject: a "Finish by" date or a season window pre-filled from the target's visibility. Progress shows the nights left, and Planning raises the subject's priority as the date nears.
  - All of these are set in Settings › Goal templates and edited per subject. Goals freeze when the Project is closed.
