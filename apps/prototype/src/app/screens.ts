/**
 * The harness v5 screen table (HARNESS-V5-IA.md § Screens), as data the
 * placeholders and the design notes read. Each screen belongs to one slice;
 * its screen agent replaces the placeholder file listed in
 * HARNESS-V5-IA.md § Foundation contract.
 */
export type SliceLetter = "A" | "B" | "C" | "D" | "E"

export interface ScreenRow {
  id: string
  title: string
  route: string
  slice: SliceLetter
  contract: string
  mustShow: string
}

const row = (id: string, title: string, route: string, slice: SliceLetter, contract: string, mustShow: string): ScreenRow => ({ id, title, route, slice, contract, mustShow })

export const SCREENS = {
  S1: row(
    "S1",
    "Home",
    "/",
    "A",
    "D-W39, D-W35, D-W48, PRJ-FR-17/18/19",
    'Top line: "N sessions need a Target · M not in any Project". Six sections in order: 1 actions (Import, New Project, Plan tonight); 2 Projects (goals in project / captured, stage, Next); 3 new sessions needing work (needs a Target / not in a Project / unreviewed / ready to add to a run), each with a one-click action; 4 Tonight (best windows, Moon, darkness); 5 Target status (unmet goals per channel); 6 running work. Next rule order (D-W35): review N new frames, then a blocked run, then Plan tonight, then Start a processing run. Filter: Show done.',
  ),
  S2: row("S2", "Projects", "/projects", "B", "D-W1, D-W48", "One row per Project: subjects, rigs, goal progress, open runs, stage, Next. Show done. New Project."),
  S3: row(
    "S3",
    "Project",
    "/projects/$projectId",
    "B",
    "D-W9, D-W29, D-W33, D-W36, D-W37, D-W38, D-W16, D-W59",
    'Header: state (Open / Done / Archived) and its actions (Mark Done, Reopen, Done / Archive sheet). Subjects: Target or mosaic; for a mosaic, panels by centre and rotation. Rigs. Goals per subject and channel: "Ha 6h10 in project · 9h15 captured · goal 10h", plus the exposure-mismatch warning (per rig). Candidates: derived; flagged when "no longer matches subject" (D-W45). Runs: each run with its step rail and run groups. Planning for its subjects: windows, gaps, Open in Planner. Trash: count and link.',
  ),
  S4: row("S4", "New Project", "sheet", "B", "D-W30, D-W47, D-W9, D-W37", "Name, subjects (search across My targets, the catalogues and SIMBAD, D-W17), rigs, and a goal template (HOO / SHO / LRGB / OSC broadband / OSC dual-band) whose values are copied in and stay editable."),
  S5: row(
    "S5",
    "Run",
    "/projects/$projectId/runs/$runId/$step",
    "C",
    "D-W3, D-W50, D-W49, D-W54, D-W5, D-W55, D-W51, D-W4, D-W56, D-W26, D-W72",
    "Header: subject and rig (fixed, D-W50), status (Open / Complete / Trashed), and Complete, Reopen, Move to Trash, Restore, Clean up. Steps: Select (subject candidates on the run's rig, all preselected, D-W49; refresh flags); Review (S6); Calibrate (readiness line, Review matches, automatic policy, a master found in Results is offered once); Prepare (profile, mode, layout preview <output>/<Project>/<Run>/, (rev N), Partial lists, Open re-verifies); Results (discovered in the recorded Results folder, attach, accept, use as an input to another run, product inputs with their rig); Done (Complete, Clean up review: prepared entries only, preselected). Refusals name their blockers: Trash is refused while a Result is an input, or while an operation is Running.",
  ),
  S6: row(
    "S6",
    "Review",
    "/projects/$projectId/runs/$runId/review",
    "D",
    "D-W13, D-W14, D-W22, D-W40, D-W42, D-W53, D-W54, D-W15",
    'The frame table spans the full width at the top; T cycles three heights. Preview with zoom, pan and F for fullscreen. Plots across the session in the bottom strip; histogram and star cutouts. Three views of the same list: table, filmstrip and grid (G). Filters: All / Picked / Rejected / Unreviewed. Hotkeys: ←/→ or J/K, P, X, U, Z, F, C, ⌘A, and Shift+P / Shift+X with auto-advance. Two-level quality: Library P/X/U, plus a secondary "Reject for this Project only". Display-name template.',
  ),
  S7: row(
    "S7",
    "Run group",
    "/projects/$projectId/groups/$groupId/$step",
    "C",
    "D-W38, D-W41, D-W73, D-W75",
    "Panels with per-panel status. Shared setup (profile, input mode, calibration policy). Review all with a Panel column and a Panel filter. Calibration readiness per panel. Prepare all: <Mosaic>/Panel N/, <Mosaic> Results/Panel N/ and Assembled/; group outcome; Open only when every panel is verified. A trashed panel is listed as Trashed and its frames leave the counts (D-W75).",
  ),
  S8: row("S8", "Project Trash", "/projects/$projectId/trash", "B", "D-W72", "Trashed runs. Restore brings a run back exactly as it was. Empty Trash (per run or all) shows what goes (prepared folders, ticked Results) and what stays."),
  S9: row(
    "S9",
    "Done / Archive",
    "sheet",
    "B",
    "D-W26, D-W43, D-W46, D-W69, D-W70, D-W74",
    "Offers, each approved separately: Archive (template paths; keeps sessions another non-Done Project uses); move N rejected frames to the Trash (Library-Unusable candidates only); move N intermediates to the Trash; move N duplicate copies to the Trash (keeps the Captures copy, otherwise the earliest). Each offer shows its size and the refusals with reasons. A Reopened Project shows Archived sessions until they are restored.",
  ),
  S10: row(
    "S10",
    "Targets",
    "/targets",
    "E",
    "D-W17, D-W18, D-W19, D-W23, D-W60, D-W61, D-W62",
    "My targets (the ★ favourites plus open-Project subjects, with a badge). Browse needs a catalogue or a preset. Unified search with Add to targets. Columns: ★, Designation, Type, Max alt, Lunar, Img time, Filters (7-band strip), Opposition, Sessions, plus a compact Captured per channel. Moon in the toolbar. Rig selector: none / each rig / this Project's rigs, with the Fit column (fits / N panels / tiny / –) and the band strip. Presets: built-in plus saved; narrowband presets hidden without a narrowband filter; Mosaic candidates and Fits nicely only with a rig.",
  ),
  S11: row(
    "S11",
    "Plan",
    "/plan",
    "E",
    "D-W16, D-W63, PLAN-FR-02/09/10/11",
    'Tonight: best window per subject and favourite, Moon, darkness, and the site with its time zone. A mosaic uses its centre. Night timeline (twilight bands, Moon band, altitude curve, window blocks). Opening it from a Project scopes it to that Project\'s subjects and gaps. With no site: "Add an observing site in Settings".',
  ),
  S12: row("S12", "Sessions", "/sessions", "A", "D-W24, D-W25, D-W43, D-W59", "Library sessions: lights only (calibration frames are in the Calibration library). Filters: Needs a Target, Not in any Project, Trashed. Actions: Add to Project (also adds the rig, with a visible note) and Create Project (prefilled)."),
  S13: row(
    "S13",
    "Import",
    "sheet over /import",
    "A",
    "D-W11, D-W12, D-W24, D-W20",
    "Pick a source; a saved source offers Import new. Templated preview of destinations in Captures or Calibration. Holds: Unclassified, still being written, duplicate (skipped). Copy or Move (Move verifies, then sends the source to the OS Trash). Writability and free space. Add existing library folder (index in place).",
  ),
  S14: row("S14", "Calibration", "/calibration", "E", "CAL", "Masters and raw sets, adoption, and the runs that use each master."),
  S15: row("S15", "Storage", "/storage", "E", "STO-FR-11/12", "Separate sections for location availability, run and group footprints, duplicate candidates (live copies only) and transfers. Read-only."),
  S16: row(
    "S16",
    "Settings",
    "/settings/*",
    "E",
    "D-W31, D-W30, D-W47, D-W20",
    "Equipment (a rig is an optical train: camera kind mono or OSC, sensor, field of view, and a simple filter list), Goal templates, Naming templates (9 tokens, chip editor, live preview), Locations, Sites, Applications.",
  ),
  S17: row("S17", "Activity", "/activity", "E", "", "Operations and refusals, as in v4."),
} as const satisfies Record<string, ScreenRow>

export type ScreenId = keyof typeof SCREENS
