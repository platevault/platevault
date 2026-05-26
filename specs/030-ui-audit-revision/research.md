# Research: UI Audit & Revision

## R1: Markdown Editor Component

**Decision**: Use `@uiw/react-md-editor` (v4.x, ~45kB gzipped)

**Rationale**: Best balance of features and size for inline project notes in
Tauri. Supports split-pane and preview toggle via `preview` prop
(`"edit" | "live" | "preview"`). No SSR dependency, no ProseMirror/Lexical
stack. Works in Tauri's WebView without server APIs.

**Alternatives considered**:
- `react-simplemde-editor` (~90-120kB): wraps full CodeMirror 5 via EasyMDE.
  Heavier, upstream maintenance slowed.
- `@mdxeditor/editor` (~200+kB): Lexical-based, over-engineered for simple
  notes.
- `milkdown`: ProseMirror-based, disqualified by heavy dependency constraint.
- Plain textarea + `react-markdown` (~12kB): minimal but no toolbar,
  keybindings, or syntax highlighting. Viable fallback if notes are low
  priority.

## R2: Calendar Scroll Component

**Decision**: Custom component using `@tanstack/react-virtual` (already in the
ecosystem) with date-grouped sections and sticky headers.

**Rationale**: No calendar library provides a vertical scrolling timeline. The
component is a virtualized list where each item is a date, and sessions are
rendered as cards within dates. Sticky month headers use CSS `position: sticky`.

**Alternatives considered**:
- Full calendar libraries (FullCalendar, react-big-calendar): render month
  grids, not vertical timelines. Wrong paradigm.
- Custom without virtualization: fine for small libraries, but 1000+ sessions
  would cause scroll performance issues.

## R3: Per-Tool Directory Structure Defaults

**Decision**: Provide vendor-convention defaults, allow user rename.

### Project Directory Structure (what our app creates)

The app creates a project directory with folder-level junctions/symlinks
pointing to session folders on disk. Each session gets its own junction.
Lights and flats are grouped by filter, with a `DATE_` prefix keyword on the
session folder name so WBPP can use it as a custom grouping keyword.

**PixInsight/WBPP project layout**:

```
<project_root>/                                     # e.g., NGC7000_HOO/
├── Lights/                                         # App creates
│   ├── Ha/
│   │   ├── DATE_2024-11-30/  →  junction to light session folder
│   │   └── DATE_2024-12-15/  →  junction to light session folder
│   └── OIII/
│       └── DATE_2024-11-30/  →  junction to light session folder
├── Calibration/                                    # App creates
│   ├── Dark/
│   │   └── 300s_-10C/        →  junction to dark session/master folder
│   ├── Flat/
│   │   ├── Ha/
│   │   │   └── DATE_2024-11/ →  junction to flat session folder
│   │   └── OIII/
│   │       └── DATE_2024-11/ →  junction to flat session folder
│   └── Bias/
│       └── 2024-11/          →  junction to bias session folder
├── processing/                                     # App creates empty, WBPP fills
├── outputs/                                        # App creates empty
└── notes/                                          # App creates, synced from DB
    └── processing-notes.md
```

**Siril project layout** (same structure, lowercase names):

```
<project_root>/
├── lights/
│   ├── ha/
│   │   └── DATE_2024-11-30/  →  junction
│   └── oiii/
│       └── DATE_2024-11-30/  →  junction
├── calibration/
│   ├── darks/
│   │   └── 300s_-10C/        →  junction
│   ├── flats/
│   │   ├── ha/
│   │   │   └── DATE_2024-11/ →  junction
│   │   └── oiii/
│   │       └── DATE_2024-11/ →  junction
│   └── biases/
│       └── 2024-11/          →  junction
├── process/                                        # Siril fills, disposable
├── outputs/
└── notes/
```

Key design decisions:
- **Junctions at folder level**, not per-file — one junction per session.
- **Filter grouping** is mandatory for lights and flats. If no filter, use
  `No Filter/`.
- **`DATE_` prefix** on light and flat session folders enables WBPP custom
  grouping by date. Darks and bias don't need the prefix.
- **`Calibration/`** parent folder groups Dark/Flat/Bias so each can be a
  junction independently.
- **Notes** are DB-leading but synced to disk in the project's `notes/`
  folder.
- **`processing/`** is tool-owned — the app creates it empty and never
  manages its contents.

### What WBPP creates inside `processing/`

For reference only (we don't manage these):

```
processing/
├── calibrated/          # Calibrated light frames
├── cosmetized/          # (optional) Cosmetic correction
├── debayered/           # (OSC only) Demosaiced frames
├── registered/          # Aligned frames + .xdrz drizzle data
├── master/              # Master bias/dark/flat/light .xisf
├── drizzle/             # (optional) Drizzle integration data
└── logs/                # Processing logs
```

### What Siril creates inside `process/`

```
process/
├── bias_stacked.fit     # Master bias
├── dark_stacked.fit     # Master dark
├── pp_flat_stacked.fit  # Master flat
├── pp_light_*.fit       # Calibrated lights
├── r_pp_light_*.fit     # Registered lights
└── *.seq                # Sequence descriptors
```

The `process/` folder is disposable — Siril docs recommend deleting it
between runs.

Sources: PixInsight Forum, Stargazers Lounge, Siril official tutorials.

## R4: Token Pattern Defaults Per Frame Type

**Decision**: Each frame type gets a default pattern using only tokens relevant
to that type.

| Type | Default Pattern | Example Output |
|------|----------------|---------------|
| Light | `{object}/{date}/{filter}/` | `M31/2026-01-15/Ha/` |
| Dark | `darks/{date}/{exposure}_{temp}/` | `darks/2026-01-15/300s_-10C/` |
| Flat | `flats/{date}/{filter}/` | `flats/2026-01-15/Ha/` |
| Bias | `bias/{date}/` | `bias/2026-01-15/` |

**Rationale**:
- Lights always have a target, so `{object}` leads.
- Darks have no target or filter but are keyed by exposure + temperature.
- Flats have no target but are keyed by filter (each flat matches a specific
  filter/optical-train combination).
- Bias frames have minimal distinguishing metadata — date is sufficient.

These defaults apply to the Inbox → Sessions/Calibration confirmation path
(where files are moved into the library). The processing tool directory
template (R3) is separate — it defines the source view layout for the tool.

## R5: Shared List Component Design

**Decision**: Extract a `ListSidebar` composite component from the Sessions
implementation and parameterize it.

**Current state**:
- Sessions has `SessionsFilterBar.tsx` and `GroupByBar.tsx` — the most complete
  implementation.
- Calibration, Targets, Projects each have inline filter/group logic in their
  page components.

**Shared component interface**:

```typescript
interface ListSidebarProps {
  // Search
  searchPlaceholder: string;
  onSearch: (query: string) => void;

  // Group
  groupOptions: { value: string; label: string }[];
  onGroupChange: (value: string) => void;

  // Sort
  sortOptions: { value: string; label: string }[];
  onSortChange: (value: string) => void;

  // Filter pills (state badges)
  filterPills?: { value: string; label: string; active: boolean }[];
  onFilterToggle?: (value: string) => void;

  // Dropdown filters
  dropdownFilters?: {
    label: string;
    options: { value: string; label: string }[];
    onChange: (value: string) => void;
  }[];

  // List content
  itemCount: number;
  children: React.ReactNode;
}
```

Each screen provides its own group/sort/filter options but gets identical
layout and behavior. The component handles consistent spacing, control
ordering, and accessibility.
