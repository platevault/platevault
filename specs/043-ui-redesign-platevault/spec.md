# Spec 043 — PlateVault UI Redesign (theming + consistency)

Status: in progress (foundation landed; per-page work ongoing)
Branch: `redesign-ui-platevault` (Windows checkout `/mnt/c/dev/astro-plan`, the
running dev app). Validated live via the Tauri MCP across light + dark.

## 1. Goal

Make the desktop UI consistent, fluid, professional, and themeable. Treat it as
a **desktop application**, not a web page (dock real estate, dense tables,
resizable panes, persistent toolbars — no centered "web" empty states floating
in whitespace). Two hard rules from the product owner:

- **No element-level CSS.** Every style comes from the shared stylesheet via
  `--alm-*` tokens + `alm-` component classes. No `style={{…}}` color/spacing.
- **Centralized React components.** Every primitive comes from the shared `ui/`
  (and `components/`) library. No page-local re-implementations — no exception.
- **No unthemed elements.** Everything must read correctly in all 4 themes.

## 2. Theming system (DONE)

Four shippable themes + System (follow-OS), user-switchable, persisted.

| Theme | Mode | Accent |
|---|---|---|
| Warm Clay | light | terracotta `#b25a35` |
| Warm Slate | light | slate-blue `#3f6b7a` |
| Observatory Dark | dark | amber `#d98a3d` |
| Espresso Dark | dark | caramel `#cf9d63` |

- `styles/tokens.css`: `[data-theme="…"]` scope per theme overriding raw palette
  tokens only; semantic aliases (`--alm-text`, `--alm-border`, `--alm-link`,
  `--alm-focus-ring`) resolve at use-site and inherit automatically.
- `data/theme.ts`: appearance runtime — `data-theme` on `<html>`, persisted in
  `localStorage` (`alm.theme`), `system` resolves via `prefers-color-scheme`
  (light→Warm Slate, dark→Observatory). `applyDensity()` mirrors
  `AppPreferences.density` as an `<html>` class. `main.tsx` calls
  `initAppearance()` at boot.
- Settings → **Appearance** (renamed from General): token-driven theme swatch
  picker (System + 4); swatch previews re-scope tokens via `data-theme` so each
  shows its own palette with no element-level color. Font size + density rows.

## 3. Cross-cutting rules / shared primitives

- **Anchor reset** (`reset.css`): `a { color: inherit; text-decoration: none }`
  kills browser-default underline/purple (was leaking on sidebar nav + the
  status-bar root link). `.alm-link` opts into link styling. (DONE)
- **Quiet sidebar nav**: active = accent text+icon + subtle tint, no boxed
  border, no underline. Brand = "PlateVault" + "P" mark. (DONE)
- **Primary button = theme accent** (`.alm-btn--primary` → `--alm-accent`). Was
  `--alm-ink`, which inverts to a light button in dark themes; this also unifies
  the previously-divergent black-vs-blue primaries into one. (DONE)
- **PropertyTable** styled (`.alm-property-table`): was unstyled → run-on
  `PropertyValueSource` text on Session/Calibration/Project/Archive detail. Now
  a proper PROPERTY · VALUE · SOURCE grid with themed source badges. (DONE)
- **Settings form-row grid**: label · control · help-**below** (help was a 3rd
  flex column → collided with the control on Ingestion/Calibration). (DONE)
- **Vibe-coded page descriptions removed.** Per-option help becomes on-demand
  `ⓘ` tooltips only where genuinely non-obvious (NOT on obvious controls like a
  file picker; no page-level/crumb info bubble — it clips in scroll panes).
  (mock done; component impl PENDING)
- **One pill system** with semantic variants (neutral/accent/ok/warn/danger/
  info) + sizes — replace ad-hoc category/flag/outcome pills. (PENDING)
- **Bottom inspector** is a shared app-wide dock (Inbox file metadata, Session
  frames, etc.). (mock done; impl PENDING)
- **Detail pane = overview-by-default** where it adds value; for queues that are
  empty a plain teaching prompt (no empty dashboards). Desktop **resizable
  splitters** with remembered widths. (PENDING)
- Reference patterns to reuse (already good in-app): Audit Log (top filters +
  table + pagination), Advanced (good KV + DANGER ZONE), Target Resolution
  (form-row), Equipment (multi-table), Archive list (compact rows).

## 4. Per-page decisions (from page-by-page grilling)

### Inbox
- Detail pane is the model (keep): frame-type breakdown, file-metadata table,
  context-aware primary, destination preview.
- List rows: classification-forward + structurally aligned (one shared grid):
  name · classification·confidence·hint · count · type pill. (PENDING)
- Single group-by + sort in a **top toolbar** (drop 3-level group + the stacked
  left column). (PENDING)
- Breakdown rows act as **filters** on the file table (drop "sample files").
- Warnings = **alert with inline action** (e.g. mixed → Generate split plan).
- File/frame detail → **bottom inspector** (full FITS header). Mixed folders
  don't block confirm; **missing required metadata (e.g. image type) blocks**.
- Confirm: per-item review + **bulk-confirm for clean detections**.
- Summary bar: fix "1+1M folders" (masters miscounted as folders) + pluralization.

### Sessions
- **Dense sortable table** primary surface (Target · Filter · Frames ·
  Integration · Night · Camera · State · Projects), grouped **by target**.
- Consistency with Inbox: top filter toolbar, top bar, bottom inspector.
- **Target identity is the row headline** — currently every row reads
  "Session — <date>" because the inventory projection's `target_name` is always
  NULL and the mapping ignores the parsed `session_key.target`. **FIX LIVES IN
  `crates/app/core/src/inventory.rs`** (use session_key target for name/target).
  ⚠ This is the **other agent's lane** (035-us4 ingest/target linkage) — leave
  it to their ingest work; do not edit concurrently.
- Dedupe date (shown 3×), use observing night not created_at, unify the
  "needs review" pill (gray title-case vs yellow lowercase). (PENDING)
- Session detail: top-bar actions only (remove duplicate right-rail set);
  content = integration & frame stats (header-derived; **no fabricated quality
  metrics** — HFR/stars only if present in headers, never FWHM/accept-reject =
  PixInsight boundary), equipment & optics, **per-frame table = pure acquisition
  fields**, calibration matches + linked projects + history. Quiet stat strip
  (no hero numbers). (PENDING)

### Calibration
- List rows: readable fingerprint title (`Master Dark · 300s`) + aging + usage.
  (DONE — title) usage count PENDING.
- Detail hero = **compatible-sessions match table**; fingerprint shown once
  (kill duplicate rail); humanize the `Suggestion error: Session … not found`;
  top filter toolbar. (PENDING)

### Targets
- = **My Targets** (objects with sessions/projects) + a **Target Planner**
  (search catalog → details → start project). Restrict catalogs to Messier /
  NGC / IC / Sharpless / LBN / LDN / Caldwell / Barnard (no 13k double-star dump).
- Rows: density toggle (single ⇄ two-line). Library-wide "visible tonight"
  filter (min-elevation + min-hours, Telescopius's key mechanic).
- Planner detail (Telescopius-class, information-dense): data sheet; tonight
  altitude graph + **yearly opposition**; moon phase/illumination/separation;
  moon-aware **per-filter best-imaging** guidance (NB vs broadband); FOV/framing
  vs optical train; **linked sessions + projects**; New project here / Add to
  plan. Needs FITS OBJECT → target_id linkage (other agent's ingest work).
  (mock done; impl PENDING)

### Projects
- Rich list rows (tool · target · integration · size · cleanup · updated).
- Detail: consolidated top-bar actions (no duplicate top+bottom); quiet stat
  strip; **Sources section** (sessions+masters, clickable → navigate; **no
  junction/source-views shown**); **Channels** (HOO/SHO/LRGB palette mapping
  with drift); Outputs (verification pills); Manifests; Cleanup preview (themed
  alert, protected locked); rail = lifecycle stepper + next + history (keep).
- Fix raw error leak `Failed to load source views: Command preparedview.list
  not found` (gen-2/gen-3 command name). (PENDING)

### Archive
- Single-column detail (no rail): title + quiet key-facts + Audit history table;
  top-bar actions (Restore / Delete permanently danger / Reveal). Kill the
  triple redundancy (Details KV ≈ rail ≈ audit). (mock done; impl PENDING)

### Settings (all panes grilled)
- IA: **grouped sub-nav** Library / Processing / Application. (DONE)
- Rename General → **Appearance** (theme swatches + follow-OS + font + density).
  (DONE)
- Data Sources: **group roots by type** (Raw/Calibration/Project/Inbox); no
  "online" pill (warn only when offline); per-root **Disable** (keep links, no
  ingest), **Delete** (only if nothing linked), **Move/remap**; style the "Add
  source folder" button. (PENDING; partial — add button styled in mock)
- Equipment: auto-add cameras+telescopes from FITS; optical trains user-composed.
- Ingestion: hashing = a normal **select** (no bespoke radio-card menu); global
  defaults + **per-root overrides**.
- Naming & Structure: all 8 frame types; consistent separators; **working live
  preview per type**; pattern + buttons on separate lines; "Reset to default" →
  "Reset".
- Processing Tools: **auto-detect + version + OS exec chooser** (no bare text).
- Calibration Matching: Camera/Binning/Gain/**Offset** toggleable (offset
  default ON); temp tolerance default **5 °C**; dark/bias age default **365 d**;
  drop the out-of-place Notes column.
- Cleanup: full per-type list; intermediates **Delete-by-default**.
- Cosmetic: form-row grid (DONE), styled select/toggle/segmented consistent,
  one pill system, token-locked spacing.

## 5. Implementation status

Done & validated (commits on `redesign-ui-platevault`):
- 4-theme tokens + runtime + Appearance picker
- shell rebrand + quiet nav; anchor reset (link leaks)
- PropertyTable styling (4 detail pages)
- Calibration fingerprint labels (+ test update)
- Settings IA grouping + Appearance rename + removed ledes
- primary button → accent (dark-leak + standardization)
- settings form-row grid (collision fix)
- branding copy → PlateVault
- Sessions "needs review" pill unified (color + title-case)
- Archive single-column detail (dropped redundant rail + hero MetricLine, -10 inline styles)
- MetricLine quieted globally (no hero numbers)
- Inbox undefined-token fixes (--alm-radius-md, --alm-warn-bg)

- Calibration master detail: readable title + deduped fingerprint (rail only)
- **Sessions target identity (BACKEND)**: `inventory.rs` effective_target() —
  every session now shows its object (M42 · Ha, NGC 7000 · SII…) instead of
  "Session — date". Validated live after backend recompile; 12/12 inventory tests.
- **Projects preparedview command (BACKEND-adjacent)**: invoke underscore
  command names (was dotted → "command not found" on every project's Source
  Views). Now a proper empty state.
- Calibration suggest `session.not_found` humanized (neutral empty state)
- Calibration Matching settings: dropped out-of-place Notes column
- Targets: compact single-line rows (52→34px) — long catalog scannable
- Inbox stats strip: count folders/masters separately (was "N+MM folders") +
  fixed undefined --alm-text-primary token
- SessionsList inline styles → classes (+ fixed undefined --alm-surface-subtle)

Verification gate (all green): `tsc --noEmit` 0 errors · `check-tokens.sh` pass ·
`eslint` 0 errors (1 pre-existing PlanPanel warning) · vitest **738/738 pass**
(77 files) · `cargo check -p app_core` + 12/12 inventory tests · live MCP
validation across all 4 themes + every page. Default theme reset to `system`.

Backend items now DONE (were "other agent's lane" — done with conflict
acceptance per the owner's directive): Sessions target identity, preparedview
command name, calibration-suggest error humanization. Still pending/backend:
FITS OBJECT→target_id linkage (enables My-Targets), toggleable match criteria +
default changes (offset/365/5), inbox folder-vs-master count.

DONE — inline-`style={{}}` sweep (the hard rule "No CSS at the element level"):
every static element-level inline style across the app converted to shared
`alm-` classes in `components.css` (token-only). ~40 files in batches via
delegate-then-validate (InboxDetail, PlanPanel, WizardPage, MatchCandidatesPanel,
all 6 project-wizard steps + WizardShell, all 4 setup steps + SetupWizard +
StepCatalogs, 6 settings panes, project accordions/notes/lists, sessions
detail/inspector/calendar, calibration master/match, targets detail, dialogs,
toast, error boundary, dir picker, all 4 dev-tools surfaces, misc). Real leaks
fixed along the way: raw-hex/rgba in ToastContainer + AppErrorBoundary + SchemaViewer
scrim, `--alm-success`→`--alm-ok` (dev lists), `--alm-space-N`→`--alm-sp-N`,
`--alm-surface2`→`--alm-bg3`, `#dc2626` fallback in DirPicker, undefined-token
leaks in TargetDetailV2/NamingStructure. Only genuinely-dynamic inline styles
remain (virtualizer transforms, computed progress widths, conditional colors) —
all resolve to `--alm-*` tokens; **zero raw hex/rgb/ms remain in any inline
style**. Verified: `tsc` 0 · `check-tokens` pass · `biome` 0 · vitest **738/738** ·
live MCP walk of inbox detail+plan, full 6-step project wizard, sessions
detail+inspector, calibration master, settings (data sources + advanced),
projects list+detail. Setup wizard is mechanically verified only (its `/setup`
route guard-redirects when roots exist; shell + patterns validated elsewhere).

## 5b. Redesign round 2 — per-page consistency + features (DONE, verified)

Every item below was implemented and INDEPENDENTLY verified by a fresh
code-reviewer subagent (read vs mock + gates) before being marked done.
Gate after the round: `tsc` 0 · `check-tokens` pass · `eslint` 0 errors ·
`biome` 0 · vitest **747/747**. Commits b7d90c9, ffb7748, 125550e.

- **Shared kit**: new `InfoTip` (ⓘ hover/focus tooltip, token-only) + `SettingsKit`
  (`SettingsSection` uppercase title + right action + rule; `SettingsRow` 200px
  label + ⓘ info + control). Settings mock = authoritative.
- **Settings — Data Sources**: roots grouped by kind (Raw/Calibration/Project/
  Inbox), header "+ Add source folder" primary (wired to real registerRoot),
  per-root Rescan (real startScan) + Disable/Remap/Delete (clearly `// STUB:`,
  no fake IPC).
- **Settings — Ingestion**: standard form-rows; RadioGroup→select; help→ⓘ.
- **Settings — every pane**: SettingsSection/SettingsRow + ⓘ tooltips replace
  always-on help prose (Naming/Tools/Resolver/Cleanup/Advanced/Equipment/Audit).
- **Settings — Calibration Matching**: toggleable criteria table (Camera/Binning/
  Gain/Offset required + Temp/Age tolerances) wired to real
  `calibrationTolerancesGet/Update`; Offset toggle is local `STUB-OFFSET-REQUIRED`
  (needs a Rust `requireSameOffset` field).
- **Calibration rail**: master-fingerprint now uses shared `RailCard` + `KV`
  (was bespoke PropertyTable box) — matches TargetDetail; bespoke classes deleted.
- **Sessions review-state**: Confirm/Reject live only in the top action bar;
  rail shows a read-only state Pill; dead `SessionInspector.tsx` removed.
- **Inbox counts**: header/footer/stats all split folders vs masters via
  `isMaster` (no more "6 folders" when 3 are masters).
- **Projects detail**: consolidated `MetricLine` (no hero-number blocks), Sources
  `Table`, RailCard rail; **Channels palette** (derived from source filters,
  `// STUB:` dedicated channel model); source-views = clickable source links, no
  junction label (user override).
- **Targets**: dense/rich row density toggle (list endpoint lacks coords/mag/
  coverage → omitted + marked); **planner detail** = identity KV table + linked
  projects/sessions + per-filter coverage + a **Tonight altitude SVG graph**
  driven by a marked `altitudeCurve()` stub (placeholder 52.1°N) + Add-to-plan/
  +New-project actions.
- **Inbox bottom inspector**: click metadata rows → docked inspector with the
  file's full fields; multi-select shows shared values + min→max ranges.
- **Sessions sortable table**: dense table, clickable sortable headers (caret +
  aria-sort), grouped by source, selection/detail preserved; full-width+inspector
  inbox-parity left as a marked stub.
- **Inline-style lint rule**: `eslint no-restricted-syntax` forbids every JSX
  `style={…}` prop; ~41 genuinely-dynamic sites carry per-line
  `eslint-disable … -- dynamic: <reason>`; wired into `just lint`; proven to
  fail on a planted static style and pass on the clean tree.

STUBS left for future agents (all clearly `// STUB:`-marked in code): Rust
`requireSameOffset` field; dedicated channel-mapping model + per-channel integ;
Targets list-endpoint enrichment (constellation/coords/mag/coverage); altitude
ephemeris + observer location; target↔project/session linkage; observing-plan
("Add to plan"); project Outputs/Cleanup-preview sections (orphaned CSS present).

Pending (largest first): Archive single-column redesign, full Sessions inbox-
parity (full-width + bottom inspector), pill-system unification,
info-tooltip component, pill-system unification, the Settings per-pane content
changes, the inline-`style={{}}` sweep across ~30 files, resizable splitters.

Backend (coordinate / other agent's lane — do not edit concurrently):
- Sessions target identity (`app_core/inventory.rs` session_key→name/target)
- `preparedview.list` command-not-found (gen-2/gen-3)
- FITS OBJECT → target_id linkage (enables My Targets + per-target coverage)
- calibration suggestion lookup (treats master id as session id)

## 6. Mocks (reference artifacts, in repo root, Windows checkout)
`platevault-palettes.png`, `platevault-inspector-mock.png`,
`platevault-targets-mock.png`, `platevault-project-detail-mock.png`,
`platevault-archive-detail-mock.png`, `platevault-settings-kit.html`,
`platevault-settings-menu.html` (interactive, theme-switching).
