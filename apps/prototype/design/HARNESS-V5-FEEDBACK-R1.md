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
