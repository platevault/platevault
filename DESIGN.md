# Astro Library Manager — Design Specification

> Authoritative design spec for an implementor (Claude Code or human). Wireframes in this project illustrate every page. This document explains the **why** and the **contracts** between pages.

---

## 0. Stack & framing

- **Tauri** (Rust backend) + **React** (front-end) + **Base UI** primitives (`@base-ui-components/react`)
  - Base UI + a CSS-variable token layer **supersedes** the earlier Mantine-first
    direction (spec 022; the design pass rejected Mantine to keep the token system
    and `alm-` CSS canonical). Historical "Mantine" references resolve here.
- Desktop-first. Windows / macOS / Linux. Windows is a first-class target.
- **Local-first**, no network required. No cloud sync.
- Read-only by default. Every filesystem mutation is staged in a reviewable Plan.
- Dense, professional information design. No marketing-style chrome.

---

## 1. Product principles (these drive every decision)

1. **Sessions and projects are the unit of work, not files.** The user does not browse individual FITS files. The library is indexed at the file level for metadata, but every list view aggregates to the session / master / target / project level.
2. **Source identity is immutable.** Once a session is confirmed, its identity is locked. Corrections produce new reviewed values without rewriting history.
3. **Plan → Review → Approve → Apply.** Every filesystem mutation goes through this loop. No silent moves, no auto-cleanup. Permanent delete is double-gated.
4. **Provenance is visible inline.** Every metadata value carries an origin glyph (●reviewed ◐inferred ○observed ◇generated ▢planned ▣applied) and a confidence level (unknown / low / medium / high / confirmed).
5. **Confidence and review state are separate columns.** The app's guess and the user's signoff are not the same thing.
6. **Protected items appear in cleanup views, greyed and locked.** Hiding them looks safer; *showing* them and marking them protected proves they're safe.
7. **Tool-agnostic.** PixInsight/WBPP, Siril, planetary tools are *profiles*. Nothing in the UI assumes a single tool.

---

## 2. Information architecture

```
Sidebar nav (collapsible, sticky)
├── Review queue        (only shows if there are sessions awaiting review)
├── Sessions            (acquisition sessions — primary working surface)
├── Calibration         (masters + calibration sessions)
├── Targets             (target list with coverage + linked projects)
├── Projects            (project list + per-project detail)
├── Plans               (filesystem plans awaiting review or in progress)
├── Audit log
└── Settings
```

- **No "Library" or "Home" page.** Sessions is the landing surface — it's where the user works.
- **Sidebar is collapsible.** Default expanded (184 px wide); collapsed mode (44 px) shows letter glyphs only. State persists per-user.
- **Three-pane layouts** (icon rail + list + detail) are used for Review queue, Calibration, and Targets — sections where a list+detail relationship dominates.

---

## 3. Visual system

### Color tokens (grayscale; status hues are utility-only)
```
ink         #1a1a1a    primary text, headings, active borders
ink2        #3a3a3a    secondary text
ink3        #6a6a6a    muted text, captions, table headers
ink4        #9a9a9a    placeholders, separators
rule        #d4d4d2    primary borders
rule2       #e4e3e0    subtle dividers (table rows)
bg          #fafaf8    primary background
bg2         #f3f2ee    panel / toolbar backgrounds
bg3         #ebeae5    active row, deeper panels
chip        #ebeae5    neutral pill background
warn        #7a5a1a    warning text + accents (with #f8f1d8 bg)
danger      #8a2a1a    destructive text + accents (with #f0d8d2 bg)
ok          #1f5a3a    confirmed text + accents (with #e6efe2 bg)
```

Status backgrounds are tinted but desaturated — never bright. Don't use color alone to convey state; always pair with text labels (`needs review`, `accepted`, `DELETE`).

### Typography
- **UI**: `Inter` 400/500/600 — body 11.5–12 px, headings 13–22 px, table headers 10.5 px uppercase tracked +.04em
- **Monospace**: `JetBrains Mono` for paths, metadata values, IDs, sizes
- Tabular numerals on for sizes/counts/timestamps (`font-feature-settings: 'tnum' 1`)
- Avoid pictogram icons except a small reserved set (see §4.2)

### Density
- Three modes: compact (24 px row), comfortable (32 px row, default), spacious (40 px row)
- Per-user setting in Appearance; per-page override via the density toggle in the toolbar

### Spacing
- 4 / 6 / 8 / 10 / 12 / 14 / 16 / 18 px scale
- Section padding 14 px, box padding 10–12 px
- Toolbars: 6 px vertical, 12 px horizontal

### Token & class conventions (spec 022)

- **Source of truth**: `apps/desktop/src/styles/tokens.css` is the canonical token
  set. The color/typography/spacing values listed above are *illustrative*; when
  they drift, `tokens.css` wins. The full token taxonomy (categories, light/dark
  scopes) is documented in `specs/022-mantine-prototype-design-system/data-model.md`.
- **`--alm-` prefix**: every design token is a CSS custom property named
  `--alm-<category>-<name>` (e.g. `--alm-ink`, `--alm-sp-4`, `--alm-radius-md`,
  `--alm-shadow-sm`). Component CSS lives in `components.css` and uses `alm-`
  prefixed class names (`.alm-btn`, `.alm-section`, `.alm-pill`).
- **Token-only rule**: `components.css` MUST reference tokens for every color,
  shadow, and motion duration — no raw hex/rgb/named colors or `ms` literals.
  Component-intrinsic pixel geometry (icon/badge sizes, 1px hairlines, fixed
  panel widths) is exempt — it is geometry, not spacing-scale. (See the policy
  comment at the top of `components.css`.)
- **Headless-library policy**: interactive primitives wrap a headless library —
  Base UI (`@base-ui-components/react`) for menu/dialog/tooltip/select/switch,
  `cmdk` for the command palette, `react-resizable-panels` for docked drawers,
  `@tanstack/react-table` for data tables. Primitives own the `alm-` visual
  layer only; accessibility/interaction comes from the headless library.
- **Density**: `.density-compact` (24px row), default comfortable (32px), and
  `.density-spacious` (40px) toggle `--alm-row-height`; set on a container.
- **Adding a token**: add the variable to `tokens.css` (all relevant scopes),
  reference it from `components.css`, and update this section + `data-model.md`
  if it introduces a new category. Primitives must forward `className` and spread
  remaining props onto their root element so callers can extend them.

---

## 4. Component primitives

These are the building blocks. Implement them once; reuse everywhere.

### 4.1 Layout
- **`AppFrame`**: window chrome (title bar 28 px, status bar 22 px) + selected nav. Props: `title`, `active` (nav id), `breadcrumb`, `navOverride` (`sidebar`/`tabs`/`three-pane`), `listPane` (for three-pane mode), `sidebarCollapsed`.
- **`Toolbar`**: thin horizontal bar with optional sub-bar (status / shortcuts). Slot: any children.
- **`Section`**: titled content block. Props: `title`, `sub`, `right` (actions), `noPad`.
- **`Box`**: bordered card with optional titled header. Props: `title`, `right`.

### 4.2 Status
- **`Pill`**: small badge. Variants: `neutral`, `ghost`, `ok`, `warn`, `danger`, `info`. Sizes: `xs` (10 px), `sm` (10.5 px).
- **`Confidence`**: small bar + label. Levels: `unknown / low / medium / high / confirmed / rejected`. Always shown inline next to a value.
- **`Provenance`**: single glyph + tooltip. Origins: `reviewed / inferred / observed / generated / planned / applied`.
- **`Lock`**: 🔒 glyph for protected items.
- **`KV`**: key-value row with optional provenance glyph + confidence bar.

### 4.3 Inputs
- **`DirPicker`**: directory selector. Folder icon + path display + "Choose folder…" button. **Never use a text input for a directory path.** Opens the native OS file picker in `directory` mode.
- **`Btn`**: button. Props: `primary` (filled black), `danger`, `small`, `active`.
- **Token chip + separator chip**: for the naming-pattern builder. Draggable; click × to remove. Token chip = #dde3ea bg, monospace; separator = bg3, click to edit value.

### 4.4 Reserved iconography
Use sparingly; no emoji elsewhere.
- ⚠ warning (warn color)
- ✓ ok (ok color)
- ✕ remove / fail (danger color)
- 🔒 protected
- ▸ ▾ tree expand/collapse
- ● ○ ◐ ◇ ▢ ▣ provenance glyphs

---

## 5. Navigation patterns

| Pattern | When to use |
|---|---|
| **Sidebar** (default) | Primary navigation surface. Always use for top-level pages. Collapsible to 44 px. |
| **Three-pane** | List + detail relationship is the dominant interaction. Used: Review queue (queue + item + decision), Calibration (masters + detail), Targets (target list + detail). |
| **Top tabs** | Reserved — used for sub-navigation within a page (e.g. Project detail's view-toggle uses pill segments, NOT top tabs). |

**Collapsing the sidebar collapses, never hides — the icon rail always shows so the user can still navigate.**

---

## 6. Page specifications

> Pages are listed in nav order. Each lists the **layout**, **primary interactions**, **state contract**, and **non-obvious decisions**.

### 6.1 First-run setup

- **When**: app launched and no library roots are registered.
- **Layout**: centered single column, max 720 px. 4-step rail at top (Welcome → Sources → Scan settings → Confirm).
- **Sources are categorized** before they're added (Raw / Calibration / Project / Inbox). This determines how the scanner treats them.
- **Estimated file counts** are shown pre-scan so users catch wrong picks before committing.
- Directory selection: **DirPicker only**, never a text input.

### 6.2 Review queue

- **When**: sessions need user attention (low confidence, missing reviewed provenance, mixed folders).
- **Layout**: three-pane. Left = queue list (sorted by confidence ↑ by default). Middle = focused session with evidence. Right = decision panel.
- **Session-centric**, not file-centric. The user reviews acquisition / calibration sessions, not individual files.
- **Evidence-first**: the middle pane explains *why* the session was flagged (e.g. "observer_location not reviewed", "OBJECT keyword missing on all 22 frames"). Bullet list with ✓/✕/⚠ glyphs.
- **Frames are summarized**, not listed individually (e.g. "Time span 03:11→05:02", "HFR mean/max 2.7/4.4"). Drill-down link to per-frame stats.
- **Keyboard-first**: ⌘1 confirm, ⌘2 reject, ⌘3 skip, J/K next/prev.
- **Decisions persist as reviewed metadata** without modifying source FITS headers.

### 6.3 Sessions

- **Primary working surface.** This is the app's home.
- **Layout**: full-width table. Group-by toolbar: none / target / month / filter / optical train. Toggle: List / Calendar.
- **Multi-project re-use is visible inline** via the "Projects (re-used)" column — same session can be linked to multiple projects (pills).
- **Group-by changes only the visual grouping**, not the data. Each variant is a saved view, not a separate page.
- **Calendar view** is for "what nights did I shoot" — useful for spotting gaps. Click a day to filter the list to that night.
- **No board view.** Boards don't add value over a target-grouped list.

### 6.4 Session detail

- **Layout**: top toolbar with session identity + actions, left content pane (tabs: Overview / Framesets / Cal matches / Linked projects / History), right inspector (linked target, cal matches, used-by-projects).
- **Sessions are immutable after confirmation.** "Re-open to review" creates a new reviewed metadata entry — never silently rewrites.
- **Provenance summary box** counts how many fields are reviewed vs inferred vs observed.
- **Action-gated transitions** are surfaced explicitly: confirming requires `observer_location` to be reviewed. If not, the confirm button is disabled and the missing field is named.

### 6.5 Calibration

- **Layout**: three-pane. Left = masters list, grouped by kind (darks / flats / bias). Middle/right = selected master detail.
- **No match matrix.** It looks dense but reads poorly. Instead, each master shows its **fingerprint** (camera / exposure / temp / gain / binning), **provenance**, and **usage** (sessions matched, projects linked, last used).
- **Compatible acquisition sessions table** is the dynamic equivalent of the matrix — for the *selected* master, list every session with score / soft mismatches / decision.
- **Calibration sessions** are tab-accessible (not primary) — masters are what the user works with.
- **Aging detection**: masters older than 90 days are flagged ⚠ in the list.

### 6.6 Targets

- **Layout**: three-pane. Left = target list (search + count badges). Right = target detail.
- **Coverage at a glance** (filter × hours bars) is the single most important panel — the user's "do I have enough Ha yet?" view.
- **Observing plans** (NINA / SharpCap plan files) link from the target.
- **Sessions and Projects sections** mirror data the user can see elsewhere — but here it's filtered to a single target for planning.
- **"New project →"** primary button in the header — target context pre-populates the wizard.

### 6.7 Projects (list)

- **Layout**: full-width table.
- **Columns** include lifecycle (pill), verification, integration hours, on-disk size, cleanup eligibility, last updated.
- **Lifecycle pills** use a 7-state palette: `setup_incomplete (warn) → ready (ghost) → prepared (info) → processing (info) → completed (ok) → archived (neutral)`, plus `blocked (danger)`.
- **`blocked` projects stay visible** — never hidden. Always show the warning + reason.
- **Footer aggregates** total integration / on-disk / cleanup-eligible across active projects.

### 6.8 Project detail

- **Header includes a 3-way view-toggle** (Command center / Pipeline / Combined). User preference persists per project, falls back to global default.
- **All three variants share the same toolbar**. Header always shows project name, lifecycle pill, profile (PixInsight/WBPP/etc), root path, action buttons.

#### 6.8.a Command center view (default)
- **Source map as a kit-grid** — 4 columns (Lights / Darks / Flats / Bias). Each card is a session or master with a checkbox for selection.
- Below the kit: 3-up boxes for Source views, Artifacts, Outputs.
- Bottom row: Lifecycle (state pills) + Cleanup preview + Manifests.

#### 6.8.b Pipeline view
- Horizontal flow: ① Sources → ② Source views → ③ Processing → ④ Outputs.
- Each stage shows count + state pill + key facts.
- Use when the user wants to spot where things stall.

#### 6.8.c Combined view
- Source map (compact kit) on top, downward arrow connector, pipeline strip below. Then lifecycle/cleanup/manifests.
- **This is the recommended default landing for an existing project** — shows both shape and flow.

### 6.9 New project wizard

6 steps. End-to-end, no detours:
1. **Name & profile** — user types project name (no template). Picks workflow profile (PI/Siril/planetary).
2. **Sources (lights)** — pick acquisition sessions. Multi-select. Can also create a new session candidate from inbox.
3. **Calibration** — **flats per filter** (each light filter gets its own master flat selection). Shared darks/bias/dark-flats below. Auto-recommendations with score + reason.
4. **Source views** — strategy from settings (junction default). Per-view name, conflict policy.
5. **Naming & layout** — review the project skeleton (`.alm/`, `sources/`, `processing/`, `outputs/`, `notes/`). User can rename the project folder but the skeleton is fixed.
6. **Review plan & create** — full filesystem plan in table form. No mutations until the user clicks Approve.

**The wizard right rail** persists a running summary (selected counts, estimated footprint, what's coming up). Don't make the user navigate back to remember decisions.

### 6.10 Filesystem plan review

- **Single page**, two views toggleable in the header: **Table** and **Diff**.
- **Table** is the operational view — one row per operation, filterable, sortable. Skipped/protected items appear greyed at the bottom.
- **Diff** is the proof-of-safety view — before/after filesystem panes side by side with `+ / − / → / ✕ / 🔒` glyphs.
- **Summary bar** under the toolbar: Items / Reclaim / Trash / Archive / Permanent delete / Protected.
- **Permanent delete requires a separate checkbox** below the Approve button. The Approve button stays disabled until both the main checkbox AND the per-plan delete checkbox are checked.
- **Dry-run result** is shown per item ✓/✕. Plans cannot be approved if any precondition fails.

### 6.11 Artifacts & outputs

- **Per project.** Not a global page.
- **Outputs section first** (it's what the user cares about). Per-row: filename, kind (final/preview/drizzle), size, recorded date, verification pill (accepted / unreviewed / superseded), 🔒 if protected.
- **Artifacts grouped by type** (registered / calibrated / drizzle / logs / process icons / etc.) — counts and total sizes, not file lists. Drill-down via "List files →".
- **Observed, not owned** — banner reminder that the app doesn't modify these files.

### 6.12 Audit log

- **Append-only, immutable.** Never edit, never delete.
- **Columns**: timestamp · event type · entity · state change (from → to) · actor (user/system) · outcome (applied / refused / failed / paused) · detail.
- **Refused transitions are first-class rows** — when the app blocked a user action, it shows up here with `outcome: refused` and the blocking reason in detail.
- **Filterable**: event type, outcome, actor, date range.
- **Export to JSONL**.

### 6.13 Settings

Sidebar of categories. Currently specified panes:

#### Data sources
- Roots table — each row is a DirPicker, category pill, online/offline state, file count, last scan, action.
- **Inbox sources are scanned in place** — no migration page. New material appears in the Review queue.
- Scan defaults: follow symlinks (off), follow junctions (off), hashing mode (lazy), metadata extraction depth.

#### Naming & structure
- **Pattern used when files are confirmed from Inbox to Inventory.** This is a folder-organization pattern; it does NOT rename source files in place.
- **Token + separator builder**. Tokens (`{target}`, `{filter}`, `{date}`, `{frame_type}`, etc.) are blue draggable chips. Separators are static text (`/`, `_`, `-`) the user can edit inline.
- **Live preview** below the builder, using recent FITS metadata.
- **Per-frame-type overrides** with toggles (Light / Dark / Flat / Bias / Dark flat). When off, the global pattern applies; when on, that frame type's row is editable.
- **No project-name template** — projects are user-named.

#### Source view strategy
- **Default per-platform**: NTFS junction on Windows, symlink on macOS/Linux, copy as fallback across volumes.
- **Strategy table** with disk usage / portability / tool compat / safety columns. Recommended row highlighted.
- This is a **default** — projects can override in step 4 of the wizard.

#### Cleanup & archive policy
- **Processing directory section at the top.** Three rows (PixInsight / Siril / Planetary), each with a DirPicker for the processing dir and a DirPicker for the output dir. **Default is `processing/`** (no tool subdir) — keep it simple.
- **Policy matrix below**: rows = data types, columns = processing tools. Each cell shows the default action (`keep / archive / trash / DELETE`) with a dropdown caret. `—` means the tool doesn't produce that type. Locked cells (🔒) cannot be changed.
- **Shared categories** (source frames, masters, outputs, notes) collapse to a single column — they apply regardless of tool, and they're always `keep` (locked).
- **When does cleanup run?** Three radios: manual / after output verified / after project completed.
- **Approval requirements** box explains the verification ladder (trash needs recorded output; archive needs accepted output; DELETE needs accepted output + explicit per-plan approval).

#### Root recovery (drive remap)
- Triggered from Data sources → an offline root.
- **Sample verification** is mandatory: app picks 4 sample files from the original root, looks for them under the new path, confirms match (path + size + optional hash).
- **No remap if any sample fails.** Show what failed; let user pick a different path.
- Updates the root's stored path; **does not move any files**.

### 6.14 Density study

- Side-by-side: same Sessions table at compact / comfortable / spacious densities.
- Reference page — not part of the normal flow.

---

## 7. Behavior contracts

These are the non-negotiable rules. Implement them once, in shared logic.

### 7.1 Plan lifecycle
```
draft → ready_for_review → approved → applying → applied
                                              ├ partially_applied
                                              ├ failed
                                              └ paused (volume unavailable / disk full / stale)
```
- Terminal: `applied`, `partially_applied`, `failed`, `cancelled`, `discarded`.
- Retry creates a new plan (with a new id). Never mutate a terminal plan.
- Every transition writes an audit row.

### 7.2 Session lifecycle
```
discovered → candidate → needs_review → confirmed
         ├ ignored                  └ rejected
```
- `confirmed` and `rejected` are soft-terminal — can re-open to `needs_review`.
- Re-opening does NOT erase the prior confirmation; it stacks a new reviewed entry.

### 7.3 Project lifecycle
```
setup_incomplete → ready → prepared → processing → completed → archived
                                                  └ blocked (with reason)
```
- `ready → prepared` requires a source-views plan to be applied.
- `processing → completed` requires at least one output recorded AND verification = `accepted`.
- `completed → archived` always requires a plan (minimum: manifest write).
- `blocked` can be reached from any non-archived state and requires a reason string.

### 7.4 Provenance
- Origins, in priority order: `reviewed > inferred > observed > generated > planned > applied`.
- User corrections create a new `reviewed` entry; prior observations are preserved in history.
- Some transitions are action-gated by provenance — block the transition, name the field that needs review.

### 7.5 Protection (cleanup-immune)
- Always protected: original source frames, calibration masters, final outputs, project manifests, user notes, audit records, app config, user-configured protected globs.
- Protected items are **always visible** in cleanup views, with 🔒 and a "skipped — protected" pill.
- Override-to-cleanup is a per-resource explicit action; the app does not have a "force delete protected" mode.

### 7.6 Plan approval gates
- All non-destructive plans: single Approve button.
- Plans containing **trash / archive / remove_link**: Approve button + standard confirmation.
- Plans containing **permanent delete**: Approve button + separate **per-plan** "I understand and accept" checkbox. The Approve button is disabled until the checkbox is checked.
- Permanent delete is **globally disabled by default**. Enabling it per cell in the cleanup matrix is required before such a plan can even be generated.

### 7.7 Long-running operations
- Scans, metadata extraction, calibration matching, plan application.
- Emit progress events: `{discovered, total, current_item, elapsed_ms, warnings, completion_state}`.
- Show in status bar + dedicated progress UI for long ops (>5s).
- Support pause / cancel where safe (scans, metadata; not mid-write of a plan item).
- On crash recovery, paused plans resume from the last applied item.

---

## 8. State shapes (high-level — for backend contract)

Not exhaustive; see entity diagram in product spec for full relations. These are the shapes that the UI binds to.

```ts
type LibraryRoot = {
  id: string;
  path: string;           // absolute
  category: 'raw' | 'calibration' | 'project' | 'inbox';
  state: 'online' | 'offline';
  scan_settings: ScanSettings;
  last_scan_at: ISODate | null;
  file_count: number;
};

type AcquisitionSession = {
  id: string;
  session_key: { target: string; filter: string; binning: string; gain: number; night: ISODate };
  state: 'discovered' | 'candidate' | 'needs_review' | 'confirmed' | 'rejected' | 'ignored';
  confidence: 'unknown' | 'low' | 'medium' | 'high' | 'confirmed';
  optical_train_id: string;
  frame_count: number;
  total_integration_seconds: number;
  total_size_bytes: number;
  metadata: Record<string, MetaValue>;   // key → { value, raw, origin, confidence, evidence_ref }
  target_ids: string[];
  project_ids: string[];                 // reverse — what projects use this session
};

type CalibrationMaster = {
  id: string;
  kind: 'dark' | 'flat' | 'bias' | 'dark_flat' | 'bad_pixel_map';
  fingerprint: { camera: string; sensor_mode: string; exposure_s: number | null; temp_c: number; gain: number; binning: string; filter?: string };
  source_calibration_session_id: string;
  created_at: ISODate;
  age_days: number;
  size_bytes: number;
  hash?: string;
  used_by_session_ids: string[];
  used_by_project_ids: string[];
};

type Project = {
  id: string;
  name: string;                          // user-supplied, no template
  workflow_profile_id: 'pixinsight' | 'siril' | 'planetary' | string;
  root_path: string;                     // absolute
  state: 'setup_incomplete' | 'ready' | 'prepared' | 'processing' | 'completed' | 'archived' | 'blocked';
  blocked_reason?: string;
  verification_state: 'unreviewed' | 'has_accepted' | 'all_rejected';
  cleanup_state: { reclaimable_bytes: number };
  target_ids: string[];
  source_map: SourceMap;                 // sessions + cal + roles + selection
  source_view_ids: string[];
  output_ids: string[];
  processing_directory: string;          // relative to project root, default 'processing/'
  output_directory: string;              // relative, default 'outputs/'
};

type FilesystemPlan = {
  id: string;
  kind: 'project_structure' | 'source_view' | 'source_view_removal' | 'archive' | 'cleanup' | 'root_remap' | 'manifest';
  state: 'draft' | 'ready_for_review' | 'approved' | 'applying' | 'applied' | 'partially_applied' | 'failed' | 'paused' | 'cancelled' | 'discarded';
  items: PlanItem[];
  dry_run_result: { passed: boolean; warnings: string[]; failures: string[] };
  has_destructive: boolean;              // gates the extra approval checkbox
  reclaim_bytes: number;
  created_at: ISODate;
  approved_at?: ISODate;
  applied_at?: ISODate;
};
```

---

## 9. Implementation order (suggested)

1. **Shell** — AppFrame, sidebar (with collapse), toolbar, status bar, breadcrumb
2. **Primitives** — Pill, Confidence, Provenance, KV, Box, Section, Btn, DirPicker
3. **Sessions** (list + group-by + calendar) — this is the primary surface
4. **Session detail** — proves the immutability + provenance contracts
5. **Targets** — proves three-pane layout works
6. **Plans** — implement the plan model end-to-end (dry-run, approve, apply, audit) BEFORE wiring it to creation flows
7. **Project list + detail** (start with Combined view)
8. **New project wizard** — composes everything above
9. **Calibration** — masters + linkage
10. **Settings panes** — data sources, naming, view strategy, cleanup, root recovery
11. **Audit log**
12. **Review queue** — needs sessions to exist, so build after sessions/detail
13. **First-run setup** — last; only matters once per user

---

## 10. Hard nos

These should be impossible to do in the implemented product:

- ❌ Modify a source FITS file or write to a source root without an applied plan
- ❌ Apply a plan without explicit user approval
- ❌ Permanent delete without (a) per-cell policy enablement, (b) per-plan checkbox, (c) verified output where the data came from
- ❌ Lose audit history on session re-open or correction
- ❌ Show a directory path as a text input
- ❌ Use marketing-style elements (gradients, hero treatments, oversized cards)
- ❌ Hide protected items from cleanup views
- ❌ Auto-classify ambiguous OBJECT values as confirmed (must stay `low` until reviewed)
- ❌ Block on network access for any core function

---

## 11. Wireframes index

| Section | Artboard | File |
|---|---|---|
| Onboarding | First-run setup | `wireframes/setup.jsx` |
| Onboarding | Review queue | `wireframes/review-queue.jsx` |
| Sessions | List + 4 group-by + calendar | `wireframes/sessions.jsx` |
| Sessions | Session detail | `wireframes/session-detail.jsx` |
| Calibration | Masters (three-pane) | `wireframes/calibration.jsx` |
| Targets | List + detail (three-pane) | `wireframes/targets.jsx` |
| Projects | List | `wireframes/projects.jsx` |
| Projects | Detail (Command center / Pipeline / Combined) | `wireframes/project-detail.jsx` |
| Wizard | Steps 3 / 4 / 6 | `wireframes/project-wizard.jsx` |
| Plans | Table view, Diff view | `wireframes/plan-review.jsx` |
| Lifecycle | Artifacts & outputs | `wireframes/artifacts.jsx` |
| Lifecycle | Audit log | `wireframes/audit.jsx` |
| Settings | Data sources / Naming / View strategy / Cleanup | `wireframes/settings.jsx` |
| Settings | Root recovery | `wireframes/root-recovery.jsx` |
| Density | Density study | `wireframes/density-study.jsx` |

---

## 12. Out of scope (v1)

- Image preview / thumbnails (the app doesn't process images)
- CLI
- Cloud sync, multi-user, web access
- In-app metadata editing of source FITS headers (corrections live in app-owned records, never the file)
- Importing brownfield projects that don't match the supported structure (they're visible as "project-like material" only)
- Automatic mosaic stitching (mosaic is just a per-panel source-map concept)
