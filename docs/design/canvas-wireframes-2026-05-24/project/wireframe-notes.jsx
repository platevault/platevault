// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

// wireframe-notes.jsx — All DesignNotes annotation arrays, one per wireframe.
// These are read by WfWrap and rendered as a numbered band at the bottom of each artboard.
// Each entry: { n, title, body }. Use short, implementor-facing language.

window.NOTES = {

  setup: [
    { n: 1, title: 'Centered single-column layout', body: 'Max 720 px wide. Setup is conventional onboarding — keep it boring and confidence-inspiring.' },
    { n: 2, title: '4-step rail at top', body: 'Linear progress. Current step is filled-black; completed are filled-grey; future are outlined.' },
    { n: 3, title: 'Sources categorized up front', body: 'Raw / Calibration / Project / Inbox — determines how the scanner treats each root. Required vs optional pills on the header.' },
    { n: 4, title: 'DirPicker not text input', body: 'Always use the native OS directory picker. Never expose a path text field anywhere in the app.' },
    { n: 5, title: 'Estimated file count', body: 'Pre-scan estimate (filesystem stat traversal) so users catch wrong picks before kicking off a full scan.' },
    { n: 6, title: 'Empty state', body: 'Dashed-border placeholder when no folder is added; explicit "No folders added" copy.' },
    { n: 7, title: 'No project sources required for v1?', body: 'Projects can be created in any registered directory later. Project source is technically optional but recommended for organization.' },
    { n: 8, title: 'Footer always shows totals', body: '"3 folders selected · ~62k files" — reinforces what is committed before user clicks Continue.' },
    { n: 9, title: 'Continue is primary CTA', body: 'Black/filled button on the right. Back is secondary. No tertiary nav inside the wizard.' },
    { n: 10, title: 'Setup is restartable', body: 'From Settings → Data sources, the user can re-enter the same flow with existing roots pre-filled. Setup never blocks the rest of the app.' },
  ],

  review: [
    { n: 1, title: 'Session-centric, not file-centric', body: 'Queue items are acquisition or calibration SESSIONS, not individual FITS files. Reviewing a session implicitly applies to all frames in it.' },
    { n: 2, title: 'Three-pane layout', body: 'Icon rail (44 px) + queue list (220 px) + focus pane (flex) + decision panel (320 px). All four columns are persistent — no modals.' },
    { n: 3, title: 'Default sort: confidence ↑', body: 'Lowest-confidence items first. Other sort options: date, target, kind.' },
    { n: 4, title: 'Acq vs cal pills', body: 'Tiny "acq" / "cal" pills distinguish acquisition vs calibration sessions in the queue. Same review verbs apply to both.' },
    { n: 5, title: 'Blocking-reason banner', body: 'Yellow inset that names the SPECIFIC reason the session can\'t be confirmed (e.g. observer_location not reviewed). Action-gated transitions are surfaced here.' },
    { n: 6, title: 'Session key + equipment as KV', body: 'Each KV row shows the provenance glyph (●reviewed ◐inferred ○observed) inline. User sees how the value got there at a glance.' },
    { n: 7, title: 'Frames summarized, not listed', body: 'Time span, exposure consistency, temp range, HFR mean/max. "View frame stats →" drills into per-frame details if the user needs them.' },
    { n: 8, title: 'Calibration availability shown here', body: 'Inline panel: which masters match, which are missing. Sets expectations before confirmation.' },
    { n: 9, title: 'Decisions panel = persistent right rail', body: 'Three primary verbs (Confirm / Reject / Skip) always visible. Secondary actions (reassign target, split, merge) below. Notes textarea persists across reviews.' },
    { n: 10, title: 'Keyboard-first', body: '⌘1 confirm, ⌘2 reject, ⌘3 skip, J/K next/prev. Shortcut hints in the toolbar, never hidden.' },
    { n: 11, title: 'Corrections create reviewed entries', body: 'Source FITS headers are never modified. Corrections are stored as reviewed metadata layered on top of observed values.' },
    { n: 12, title: 'Queue progress is visible', body: 'Thin bar at bottom of decision panel — encourages completion without nagging.' },
  ],

  'sess-list': [
    { n: 1, title: 'Sessions is the landing surface', body: 'Default page when the app opens (not a "home" or "library" page). Where the user spends most of their time.' },
    { n: 2, title: 'Flat list, sorted by date ↓', body: 'Newest first. All columns sortable; column header click toggles sort direction.' },
    { n: 3, title: 'Group-by chip row', body: 'Above the table: none / target / month / filter / optical train. Selecting a group does not navigate — same data, different shape.' },
    { n: 4, title: 'View toggle: List / Calendar', body: 'Calendar is a separate layout for nightly-scope work. List remains primary.' },
    { n: 5, title: '⚠ glyph + reason on hover', body: 'Per-row warnings shown as a glyph with tooltip. Critical issues (like missing OBJECT) also appear as a secondary line under the target name.' },
    { n: 6, title: 'Projects (re-used) column', body: 'Pills for every project this session is linked to. A confirmed session can appear in 0 / 1 / many projects — never duplicated, always referenced.' },
    { n: 7, title: 'Cal match summary column', body: 'Quick view of "2/3 ok" or "—" for unmatched. Click drills into match candidates for that session.' },
    { n: 8, title: 'Confidence ≠ State', body: 'Two separate columns. App\'s guess (confidence) vs user\'s signoff (state). Never collapse these.' },
    { n: 9, title: 'Bulk actions in toolbar', body: 'Confirm / Split / Merge / Use in project act on the multi-selected rows. Checkbox per row + Shift-click range select.' },
    { n: 10, title: 'No project assignment from this view', body: '"Use in project →" opens the project picker — does not directly assign. Routes the user toward intentional project setup.' },
    { n: 11, title: 'Search is metadata-aware', body: 'Searches target name + aliases, filter, optical train, equipment name. Not just substring on labels.' },
  ],

  'sess-by-target': [
    { n: 1, title: 'Same data, target-grouped', body: 'Identical underlying query — only the visual collapse changes. Group rows can be folded.' },
    { n: 2, title: 'Per-group total integration', body: 'Header shows total hours and session count per target — useful for planning.' },
    { n: 3, title: 'Project pills on group header', body: 'Aggregates every project across the group\'s sessions into one row at the top. Quick "what does this target feed into?" view.' },
    { n: 4, title: 'Target column hidden in rows', body: 'Redundant when grouped — the header carries it. Frees horizontal space for the train + state columns.' },
    { n: 5, title: 'New session candidate not shown here', body: 'New-candidate actions live at the top toolbar — adding to a target happens via the target detail, not this list.' },
  ],

  'sess-by-month': [
    { n: 1, title: 'Reverse-chronological by default', body: 'Newest months at top. Each month renders as a stacked group; the rows inside are sub-sorted by date.' },
    { n: 2, title: 'Per-month aggregates', body: 'Sessions count, total integration, unique-target count. Lets the user see "how productive was December?"' },
    { n: 3, title: 'Quarter / year groups possible later', body: 'Same component supports {month, quarter, year} grouping; default to month.' },
    { n: 4, title: 'Gaps are NOT highlighted here', body: 'Use the calendar view for gap analysis. Month grouping shows what existed, not what didn\'t.' },
  ],

  'sess-by-train': [
    { n: 1, title: 'Optical train as the group key', body: 'Train fingerprint (camera + scope + reducer + filter wheel) is the actual technical lineage. Useful for "what was I using when?"' },
    { n: 2, title: 'Per-train target & filter diversity', body: 'Header counts unique targets and filters used with that train.' },
    { n: 3, title: 'Most useful before a project', body: 'Projects usually share a single train across all sessions. This view helps enforce that without manual checking.' },
    { n: 4, title: 'Equipment changes visible', body: 'Switching gear mid-night produces a new train fingerprint and a new group. Surfaces silent equipment swaps.' },
  ],

  'sess-cal': [
    { n: 1, title: 'Three months at once', body: 'Current month + previous two. Prev / Next steps by one month each.' },
    { n: 2, title: 'Day cells are sessions, not files', body: 'A cell can hold multiple sessions (different filters). Each shows target + filter + integration.' },
    { n: 3, title: 'Gaps are obvious', body: 'Empty cells = no acquisition. The PRIMARY value of calendar view over a date-sorted list.' },
    { n: 4, title: 'Click a day to filter list', body: 'Selecting a day filters the list view to that night. Calendar is a navigation aid, not a separate database.' },
    { n: 5, title: '⚠ glyph per day with issues', body: 'Top-right of the cell when any session needs review.' },
    { n: 6, title: 'Day numbers tabular', body: 'tnum so columns align across months. Greyed cells before first / after last day of month.' },
  ],

  'session-detail': [
    { n: 1, title: 'Sticky header with identity', body: 'Target · filter · night never scrolls off. State pill + frame count + integration in the sub-bar.' },
    { n: 2, title: 'Tab navigation, not separate pages', body: 'Overview / Framesets / Calibration matches / Linked projects / History. Each tab is the same session, different facet.' },
    { n: 3, title: 'Session key (read-only after confirm)', body: 'Target / filter / binning / gain / night / fingerprint. Cannot edit after confirmation; corrections come via "Re-open to review".' },
    { n: 4, title: 'Equipment + site KV with provenance', body: 'Each value carries its origin glyph. observer_location confidence chip is visible because it gates confirmation.' },
    { n: 5, title: 'Provenance summary tile', body: 'Counts of reviewed / inferred / observed / missing fields. Single-glance health check.' },
    { n: 6, title: 'Frames table is a sample', body: '5 representative rows + "… N more". Per-frame stats are an inventory drill-down, not the primary surface.' },
    { n: 7, title: 'Cal matches in right inspector', body: 'Each match is a small card: kind + score + confidence + decision pill. Click → match candidate detail.' },
    { n: 8, title: 'Used by projects', body: 'A session can power many projects (HOO + SHO + tutorial). Each is a clickable card. NEVER shows project-private state — just name + lifecycle.' },
    { n: 9, title: 'Immutability callout in right rail', body: 'Constant reminder that re-opening creates new metadata records, never rewrites history.' },
    { n: 10, title: 'Action toolbar always visible', body: 'Split / Use in project / Re-open visible regardless of scroll position.' },
  ],

  calibration: [
    { n: 1, title: 'Masters are the primary entity', body: 'Three-pane: masters list (left) + master detail (main). Calibration sessions are a tab, not the default surface.' },
    { n: 2, title: 'Grouped by kind in list', body: 'Darks → Flats → Bias. Sub-headers within the same list. Group-by chip lets the user change to camera / age / none.' },
    { n: 3, title: 'Age-on-glyph in list', body: '"23d" / "12d" / "180d" inline. ⚠ shown when > 90 days.' },
    { n: 4, title: 'No matching matrix', body: 'A matrix grows quadratically. Replaced with two directional tables: "Compatible sessions" (per master) and "Calibration matches" (per session).' },
    { n: 5, title: 'Fingerprint card', body: 'Camera / sensor mode / exposure / temp / gain / binning / offset / filter. The hash-key for matching. Provenance glyphs on every value.' },
    { n: 6, title: 'Provenance card', body: 'Where the master came from: source calibration session, creation date, tool that produced it, imported by user, age, hash.' },
    { n: 7, title: 'Usage card (counts)', body: 'Quick "this master is used by N sessions and M projects" view. Most-recent project link below.' },
    { n: 8, title: 'Linked projects table', body: 'Per project: workflow profile, lifecycle, role, how it was selected (auto-match score or user override), date selected.' },
    { n: 9, title: 'Compatible sessions table', body: 'Same master, the OTHER direction: what sessions would this master serve? Score, soft mismatches, decision. Click → override.' },
    { n: 10, title: 'Mark superseded action', body: 'Lifecycle for a master: confirmed → superseded (when a newer one replaces it). Superseded masters stay visible for historical projects.' },
    { n: 11, title: 'Import master button in toolbar', body: 'For users who produce masters in PixInsight outside the app. Brings the file in with computed fingerprint.' },
  ],

  targets: [
    { n: 1, title: 'Three-pane: nav + target list + detail', body: 'Target list left (200 px), detail flex. List shows session count, integration hours, project count inline.' },
    { n: 2, title: 'Coverage at a glance', body: 'The single most important panel — filter × hours horizontal bars. Direct answer to "what do I have / what do I need?"' },
    { n: 3, title: '⚠ when coverage is below recommended', body: 'Per filter recommended floors (e.g. SHO needs ≥3h SII). Warning text below the bars.' },
    { n: 4, title: 'Aliases + catalog IDs as KV', body: 'Editable via "Edit aliases" — used to match inconsistent OBJECT values across scans.' },
    { n: 5, title: 'Observing plans as links', body: 'NINA / SharpCap plan files linked to a target. App stores references, not the plans themselves.' },
    { n: 6, title: 'Sessions table per target', body: 'Filtered to this target. Includes "In project" column showing which projects use each session.' },
    { n: 7, title: 'Outputs gallery', body: 'Aggregate across all projects for this target. Useful for retrospective ("what does my best M31 look like?").' },
    { n: 8, title: '"New project →" header CTA', body: 'Pre-fills target context in the wizard. The fastest path from "I have data" to "I have a project".' },
  ],

  'projects-list': [
    { n: 1, title: 'Lifecycle pill is the key column', body: 'setup_incomplete → ready → prepared → processing → completed → archived. Plus blocked (danger). Color + position + text — never color alone.' },
    { n: 2, title: 'blocked projects stay visible', body: 'Never hide them. Show ⚠ + reason in a secondary line under the project name.' },
    { n: 3, title: 'Cleanup column shows readiness', body: '"2.1 GB candidate" / "4.8 GB ready" / "—". Click → cleanup preview. Tells user where they can reclaim space.' },
    { n: 4, title: 'Updated column is most recent activity', body: 'Source map change, plan applied, output recorded — anything that bumps the project mtime.' },
    { n: 5, title: 'Workflow profile column', body: 'Tool-agnostic. PixInsight / Siril / planetary — same project shape, different processing-tool expectations.' },
    { n: 6, title: 'Footer aggregates', body: 'Active project totals (integration, on-disk, cleanup-eligible). Status-bar-style strip below the table.' },
    { n: 7, title: 'View toggle: Table / Cards', body: 'Table is default. Cards for visual scanning (output thumb + state pill + integration).' },
    { n: 8, title: 'Filter by lifecycle', body: 'Hide archived / show only blocked / etc. Filter chips visible above the table.' },
    { n: 9, title: '+ New project = wizard', body: 'Routes directly to the 6-step wizard, no intermediate modal.' },
  ],

  'proj-center': [
    { n: 1, title: 'Header with view toggle', body: 'Three-way pill segments: Command center / Pipeline / Combined. Selection persists per project. Default: Combined for existing projects; Command center for new.' },
    { n: 2, title: 'Persistent project identity', body: 'Name + lifecycle pill + profile + project root path. Always visible regardless of view.' },
    { n: 3, title: 'Kit grid: 4 role columns', body: 'Lights / Darks / Flats / Bias. Each card = one session or master with a checkbox. Drag-between-columns changes role.' },
    { n: 4, title: 'Selected vs candidate state', body: 'Selected = filled border. Candidate = dimmed. Warning chips inline for issues (newer night, aging master, etc.).' },
    { n: 5, title: 'Empty role hint inline', body: 'When a role lacks anything (e.g. SII flat missing), dashed-warning card appears in that column with the specific reason.' },
    { n: 6, title: 'Source views box', body: 'Lists generated views with strategy + plan reference. + New view opens the source-view sub-wizard.' },
    { n: 7, title: 'Artifacts box (summary)', body: 'By type: registered / calibrated / drizzle / logs. Not a file list — drilldown via Artifacts page.' },
    { n: 8, title: 'Outputs box', body: 'Per-output row: filename, size, date, verification pill. Lock for protected items. "+ Record output" attaches files outside the project.' },
    { n: 9, title: 'Lifecycle ladder', body: 'Visual progression of states. Current state bolded. Below: action-gated transitions named.' },
    { n: 10, title: 'Cleanup card → settings', body: 'Shows current reclaimable bytes. Link sends user to the global cleanup-policy page (not per-project).' },
  ],

  'proj-pipeline': [
    { n: 1, title: 'Same header, same toggle', body: 'View toggle moves between variants without losing context.' },
    { n: 2, title: '4-stage horizontal flow', body: '① Sources → ② Source views → ③ Processing → ④ Outputs. Arrows between. Stage = bordered card with title bar.' },
    { n: 3, title: 'Stage state pill in header', body: 'selected / applied / observed / verified. Quick health check per stage.' },
    { n: 4, title: 'Stage shows summary + key items', body: 'No drilldown lists — counts and a few representative rows. Stage cards are dashboards, not tables.' },
    { n: 5, title: 'Click a stage = drill in', body: 'Routes to the relevant detail page (source map, source view detail, artifacts, outputs).' },
    { n: 6, title: 'Observed, not owned', body: 'Stage ③ shows what the app sees in the processing dir. Reminder text "observed, not owned" — implementor should never write here outside a plan.' },
    { n: 7, title: 'Lifecycle + Cleanup + Manifests row', body: 'Same row across all three variants. Consistency = familiarity.' },
  ],

  'proj-combined': [
    { n: 1, title: 'Recommended default landing', body: 'For an existing project. Combines source map (top) + pipeline (bottom). Both shape and flow visible.' },
    { n: 2, title: 'Vertical "feeds into" connector', body: 'Visual arrow from source map down to pipeline. Reinforces the relationship.' },
    { n: 3, title: 'Compact kit grid', body: 'Smaller card padding than Command center. Pipeline stages also compact. Both fit on one screen.' },
    { n: 4, title: 'Same data, two representations', body: 'Kit answers "what feeds this?" Pipeline answers "where does it go?" The connector ties them.' },
    { n: 5, title: 'Lifecycle / Cleanup / Notes-manifests row', body: 'Identical bottom row across variants. Switching variants never moves the bottom row.' },
    { n: 6, title: 'Hover-reveal columns?', body: 'Future: drag/drop sessions between role columns. v1: explicit + Add buttons.' },
  ],

  'wiz-3': [
    { n: 1, title: 'Step rail at top, persistent', body: '6 steps · current is bordered + bold. Done steps show ✓. Can jump backward at any time.' },
    { n: 2, title: 'Right rail = running summary', body: 'What\'s selected so far. Coming-up list. Estimated on-disk footprint. Persists across all steps.' },
    { n: 3, title: 'Flats per filter row', body: 'Each light filter gets its own master-flat dropdown. NOT a single global flat — filter-mismatched flats produce useless calibration.' },
    { n: 4, title: 'Lights covered column', body: 'Shows which sessions a flat applies to. Reinforces the per-filter scope.' },
    { n: 5, title: 'Score per flat selection', body: '0-1 match score visible inline. Soft mismatches in notes column.' },
    { n: 6, title: '"+ Add another flat (for a future filter)"', body: 'Lets the user pre-select flats for filters they will add later. Avoids returning to the wizard.' },
    { n: 7, title: 'Shared calibration table below', body: 'Darks / bias / dark flats. These apply to all lights matching the fingerprint, regardless of filter.' },
    { n: 8, title: 'Aging warning surfaces inline', body: '180-day bias gets a soft mismatch chip. User can proceed; the plan will record this.' },
    { n: 9, title: 'Why-recommended box', body: 'Plain-English explanation of how the auto-picks were chosen. Builds trust in the algorithm.' },
    { n: 10, title: 'Back / Next as right-rail buttons', body: 'Primary "Next" CTA at the bottom of the summary rail. Back is secondary.' },
    { n: 11, title: 'Save draft preserves state', body: 'Closing the wizard keeps the draft. Resume from the projects list.' },
  ],

  'wiz-4': [
    { n: 1, title: 'Strategy comes from settings', body: 'NTFS junction default on Windows. Show the current default with a chip; "Override for this project" link opens the per-project override.' },
    { n: 2, title: 'Per-platform reasoning visible', body: 'Compact callout explaining why this strategy was chosen (no admin, WBPP-compatible, cleanup-safe).' },
    { n: 3, title: 'Views to generate table', body: 'For mosaic projects: one view per panel. Default: a single wbpp_input. Editable view name (mono input).' },
    { n: 4, title: 'Conflict policy = explicit', body: 'fail-if-exists default. Three other options (rename, skip, manual). Defaults inherited from settings; overridable here.' },
    { n: 5, title: 'Estimated footprint', body: '~12 KB for junctions/symlinks. GB if copy. Helps user spot accidental "copy" selection.' },
  ],

  'wiz-6': [
    { n: 1, title: 'Plan summary in safety banner', body: 'Green panel when no destructive items. Red when permanent delete is included. Single-glance state.' },
    { n: 2, title: 'Plan items table', body: 'Per row: action / destination / source. Action pill (mkdir / write / junction / move / etc.). 5-7 sample rows then "… N more".' },
    { n: 3, title: 'What-will-exist box', body: 'Tree ASCII of the resulting filesystem. Concrete preview of the outcome.' },
    { n: 4, title: 'After-creating list', body: '4-step next-actions. Reinforces user agency — "you process in PixInsight; we observe".' },
    { n: 5, title: 'Approve & create primary', body: 'Black/filled CTA in the toolbar. Generates the plan, immediately applies. (For destructive plans, requires extra checkbox first.)' },
  ],

  'plan-table': [
    { n: 1, title: 'Plan kind + ID + target in header', body: 'Always visible. Plan ID (mono) is the audit-log anchor.' },
    { n: 2, title: 'View toggle: Table / Diff', body: 'Pill segments in the header. Table = operations. Diff = before/after filesystem. Both represent the SAME plan.' },
    { n: 3, title: 'State pill: READY FOR REVIEW', body: 'Big visible pill. Other states: applying (info, animated dot), applied (ok), failed (danger), paused (warn).' },
    { n: 4, title: 'Summary bar = key counts', body: 'Items / Reclaim / Trash / Archive / Permanent delete / Protected (skipped). Sub-bar below toolbar; never scrolls.' },
    { n: 5, title: 'Per-row Status pill', body: 'pending / protected / applied / failed / skipped. Separate from Action — what the operation IS vs what HAPPENED.' },
    { n: 6, title: 'Tinted row backgrounds', body: 'Destructive (red), archive (yellow), protected/skipped (grey). Color reinforces text — never the sole signal.' },
    { n: 7, title: 'Provenance origin on every item', body: 'Where the item came from in the plan generator (generated / reviewed). Lets a sceptic verify the plan didn\'t fabricate items.' },
    { n: 8, title: 'Dry-run ✓ column', body: 'Per-item precondition check. If any ✕, the Approve button is disabled.' },
    { n: 9, title: 'Permanent delete approval', body: 'Separate "I understand and accept" checkbox below the table. Approve disabled until checked. Plus, app-wide permanent-delete must be enabled per cleanup policy.' },
    { n: 10, title: 'Discard returns to draft', body: 'Plans aren\'t lost — they go to a discarded list (retained for audit). Approve & apply is irreversible only for delete; trash and archive can be reverted.' },
    { n: 11, title: 'Edit policy →', body: 'Opens the global cleanup policy (settings) that produced this plan. Tighten or loosen policy then regenerate.' },
  ],

  'plan-diff': [
    { n: 1, title: 'Same header, view toggle = Diff', body: 'Diff is a representation, not a separate plan. All state (approve gate, summary bar, permanent-delete approval) is shared.' },
    { n: 2, title: 'Two-column before / after', body: 'Before = current FS state. After = projected post-apply. Always equal heights via grid.' },
    { n: 3, title: 'Glyph + tint per status', body: '− removed (red), + added (green), → archived (yellow), ✕ deleted (red), 🔒 protected (grey). Glyph in column 1, monospace name in column 2.' },
    { n: 4, title: 'Indented tree', body: 'depth × 14px left padding. Mimics a filesystem tree. Same children grouped under parent dirs.' },
    { n: 5, title: 'Size reductions explicit', body: 'After-column size delta vs before (−2.1 GB). Footer line: how many dirs added / removed / files archived / permanently deleted.' },
    { n: 6, title: 'Use Diff for visual review', body: 'Better than table when user wants "show me what will SURVIVE". Use Table when filtering / searching for specific operations.' },
  ],

  artifacts: [
    { n: 1, title: 'Per-project, not global', body: 'Artifacts is always shown in the context of a single project. Cross-project artifacts view does not exist (would be too noisy).' },
    { n: 2, title: 'Outputs section first', body: 'What the user actually cares about appears at the top. Artifacts (intermediates) below.' },
    { n: 3, title: 'Lock glyph on protected outputs', body: 'Accepted / superseded outputs are protected from cleanup. Lock + green pill makes the protection obvious.' },
    { n: 4, title: 'Verify... button per row', body: 'Inline verification action. accepted / rejected / superseded states. Verification persists in the project record.' },
    { n: 5, title: 'Artifacts grouped by type', body: 'Not a file list. By type: registered / calibrated / debayered / normalized / drizzle / cache / temp / logs / process icons / tool projects / notes / unknown.' },
    { n: 6, title: 'Cleanup-eligibility pill per type', body: 'eligible / archive / keep / —. Reflects the global policy + processing-tool combination.' },
    { n: 7, title: 'Confidence per artifact group', body: 'For some types (unknown, tool projects), classification confidence matters. Shown inline.' },
    { n: 8, title: '"Observed, not owned"', body: 'Banner reminder. Critical contract: implementor must NEVER write inside processing/ outside an approved plan.' },
    { n: 9, title: 'Re-observe action', body: 'Manual trigger to refresh the artifact registry (e.g. after running WBPP). Optional auto-watch via OS file events later.' },
    { n: 10, title: 'List files → drilldown', body: 'Opens an inventory-style file list filtered to that artifact group. Useful for spot-checks.' },
  ],

  audit: [
    { n: 1, title: 'Append-only, immutable', body: 'No edit, no delete, no truncate. The audit log is the source of truth for every state change. Visible retention messaging: "forever".' },
    { n: 2, title: 'Toolbar filters', body: 'Search, event type, outcome, actor, date range. All work together — chips are applied filters.' },
    { n: 3, title: 'Timestamp first column', body: 'Mono, full precision. Sortable. Each row is a single event — no aggregation, no summary rows.' },
    { n: 4, title: 'Event name uses dot notation', body: 'plan.approved / planitem.applied / session.confirmed / classification.confirmed / project.transition / etc. Discoverable namespace.' },
    { n: 5, title: 'State change shown as from → to', body: 'When applicable. Hyphens when not (e.g. classification creation has no prior state).' },
    { n: 6, title: 'Outcome pill', body: 'applied / ok / refused / failed / paused. Refused = "user tried, app blocked". First-class row, not an error log.' },
    { n: 7, title: 'Actor column', body: 'user vs system. System only acts at edges (entering/leaving blocked). All other actions are user-driven.' },
    { n: 8, title: 'Tinted rows for danger / pause', body: 'Failed rows red, paused rows yellow. Plus normal rows for routine events.' },
    { n: 9, title: 'Detail = structured', body: 'JSON-ish info: "cleanup plan · 148 items · 2.1 GB reclaim" — easy to scan, machine-readable for export.' },
    { n: 10, title: 'Export to JSONL', body: 'Top-right button. One event per line. Lets users diff / archive their audit history.' },
  ],

  'set-sources': [
    { n: 1, title: 'Left rail of category settings', body: 'Sticky categories list. Active item highlighted; vertical bar accent. Active rail item matches the open page.' },
    { n: 2, title: 'Roots table with DirPicker', body: 'Each path row is a DirPicker (folder icon + path + Choose folder button). NEVER a text input.' },
    { n: 3, title: 'Online / offline state', body: 'Reachability check at app start + on demand. Offline roots can be reconnected via the workflow.' },
    { n: 4, title: 'Category pill per root', body: 'Raw / Calibration / Project / Inbox. Determines how the scanner treats material under that root.' },
    { n: 5, title: 'Re-scan vs Reconnect', body: 'Online roots: Re-scan re-indexes. Offline roots: Reconnect opens the path-verification workflow.' },
    { n: 6, title: 'Scan defaults card', body: 'follow-symlinks default off · follow-junctions default off · lazy hashing default · metadata extraction depth.' },
    { n: 7, title: 'Inbox handling explanation', body: 'Files are NOT moved. Inbox roots are scanned in place; new material appears in the Review queue.' },
    { n: 8, title: '+ Add root opens picker', body: 'Native directory picker. Category dropdown shown alongside before commit.' },
  ],

  'set-naming': [
    { n: 1, title: 'Patten for Inbox → Inventory ONLY', body: 'Not a project-name template. Used when files transition from inbox state to inventory state.' },
    { n: 2, title: 'Token + separator builder', body: 'Tokens (blue): dynamic from FITS/session metadata. Separators (grey): static text the user can edit. Both drag-rearrangeable.' },
    { n: 3, title: 'Live preview using recent fits', body: 'Three example expansions below the builder. Updates as the user edits the pattern.' },
    { n: 4, title: 'Per-frame-type override toggles', body: 'Light / Dark / Flat / Bias / Dark flat. Off = inherit global. On = this frame-type uses its own pattern.' },
    { n: 5, title: 'Disabled patterns dimmed', body: 'When toggle is off, the override builder grays out + becomes uneditable. Pattern still shown for context.' },
    { n: 6, title: '+ Token vs + Separator', body: 'Token = pick from a list of available metadata fields. Separator = type any literal text.' },
    { n: 7, title: 'Token has a × to remove', body: 'Drag handle on left, × on right. Both visible at rest — no hover-reveal.' },
    { n: 8, title: 'Trailing separator allowed', body: 'Ending with / creates a trailing slash in the path. Useful but not required.' },
    { n: 9, title: 'Pattern result is a directory tree', body: 'NOT a filename. The pattern places files into directories; original filename is preserved.' },
  ],

  'set-views': [
    { n: 1, title: 'Default strategy table', body: 'Six strategies as radio rows. Recommended highlighted yellow.' },
    { n: 2, title: 'Per-strategy tradeoff columns', body: 'Disk usage / portability / tool compat / safety. Lets the user understand WHY a recommendation is made.' },
    { n: 3, title: 'Per-platform overrides', body: 'Windows uses junctions; macOS/Linux use symlinks; cross-volume falls back to copy with confirm.' },
    { n: 4, title: 'Conflict policy defaults', body: 'fail-if-exists default. Three other modes. Per-project override available in the wizard.' },
    { n: 5, title: 'Strategy = global default', body: 'Per-project overrides in the wizard step 4. This is the starting point.' },
  ],

  'set-cleanup': [
    { n: 1, title: 'Processing directory section first', body: 'The user must define WHAT counts as the processing workspace before policy can apply. Three workflow rows.' },
    { n: 2, title: 'DirPickers default to processing/', body: 'No tool-specific subdirectory by default. Keeps the path simple. User can change to processing/pixinsight/ etc.' },
    { n: 3, title: 'Inside = cleanup-eligible', body: 'Banner: anything inside processing/ is candidate for cleanup. Everything outside (sources, manifests, outputs, notes) is protected.' },
    { n: 4, title: 'Policy matrix is the main surface', body: 'Rows = data types. Columns = processing tools (PI / Siril / Planetary). Cells = default action.' },
    { n: 5, title: '— means tool does not produce', body: 'e.g. Siril has no "local normalized"; planetary has no "calibrated". Don\'t force a policy where there\'s no data.' },
    { n: 6, title: '🔒 cells are locked', body: 'Process icons / tool config files are never cleanup-eligible — they\'re needed to re-open the project in the tool.' },
    { n: 7, title: 'DESTRUCTIVE pill on permanent-delete rows', body: 'Temporary files default to DELETE. Highlighted red row tint. Per-plan approval still required.' },
    { n: 8, title: 'Shared categories section', body: 'Below the per-tool rows. Sources / masters / outputs / notes — single column, locked keep.' },
    { n: 9, title: 'When does cleanup run?', body: 'Three radios. Default: manual only. Auto-suggest options for after-verified / after-completed.' },
    { n: 10, title: 'Approval requirements card', body: 'Lays out the verification ladder for trash / archive / DELETE. Reduces "why is the button greyed?" confusion.' },
  ],

  'set-recovery': [
    { n: 1, title: 'Centered single-column workflow', body: 'Like setup. The user is doing one task; minimize chrome.' },
    { n: 2, title: 'Trigger: offline root', body: 'Entered from Data sources → Reconnect. Cannot be opened standalone.' },
    { n: 3, title: 'What-this-does numbered list', body: '4-step explanation up front. Sets expectations BEFORE the user picks a path.' },
    { n: 4, title: 'Original mount card', body: 'Read-only summary of the root being remapped. Records-tied count is the key number — 18,420 file records depend on this.' },
    { n: 5, title: 'New path = DirPicker', body: 'Native directory picker. Verify button triggers sample-file lookup.' },
    { n: 6, title: 'Sample verification mandatory', body: '4 samples. All must match path + size (+ optional hash). Any failure aborts the remap.' },
    { n: 7, title: 'No file movement', body: 'The remap updates the stored path only. Files stay where they are. Audit row: root.remapped.' },
    { n: 8, title: 'What-will-change list', body: 'Bullet list of every change before the user clicks Apply. Reinforces transparency.' },
  ],

  'density-study': [
    { n: 1, title: 'Reference page, not a real screen', body: 'Lives in the design canvas as a study. The actual density toggle in app settings affects every page.' },
    { n: 2, title: 'Same data, three densities', body: 'Compact (24 px row) / Comfortable (32 px, default) / Spacious (40 px). Picked per user preference.' },
    { n: 3, title: 'Per-page override possible', body: 'Toolbar density toggle on dense data views (sessions list, library inventory). Persists per page.' },
    { n: 4, title: 'Row visibility heuristic', body: 'Footer text shows approximate rows-per-screen at each density. Helps user pick a default.' },
  ],
};
