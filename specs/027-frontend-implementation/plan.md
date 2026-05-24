# Implementation Plan: Desktop Frontend Implementation

**Branch**: `027-frontend-implementation` | **Date**: 2026-05-24 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/027-frontend-implementation/spec.md`

## Summary

Implement the complete React frontend for Astro Library Manager as a Tauri 2 desktop application, matching the canvas wireframes (DESIGN.md + 15 JSX wireframe files). The frontend delivers 16 pages across 4 milestones, starting with the app shell and session workflow (the primary surface), progressing through project management, then configuration/audit, and finally onboarding/review. All backend operations are consumed via Tauri commands with mock implementations until the Rust crates are wired.

## Technical Context

**Language/Version**: TypeScript 5.x, React 19, CSS (custom properties)

**Primary Dependencies**:
- `@base-ui-components/react` — headless UI primitives
- `@tanstack/react-router` — hash-mode routing with URL state
- `@tanstack/react-table` — table primitive for sortable/groupable data views
- `cmdk` — command palette
- `react-resizable-panels` — split panes and resizable layouts
- `lucide-react` — icon set (sparingly, per DESIGN.md §4.4)
- `react-joyride` v3 — guided tour overlay hints
- `@tauri-apps/api` v2 — native dialog, window, event APIs
- `clsx` — conditional class merging

**Storage**: N/A for frontend (backend SQLite via Tauri commands)

**Testing**: Vitest (unit/component), Playwright (integration/e2e via MCP)

**Target Platform**: Desktop (Windows first-class, macOS, Linux) via Tauri 2

**Project Type**: Desktop application (frontend layer)

**Performance Goals**: <100ms route transitions, <200ms command palette response, smooth 60fps scroll on 250+ row tables

**Constraints**: Offline-capable (no network required), must work with Tauri native dialog APIs for DirPicker, single global density setting

**Scale/Scope**: 16 pages, ~50 components, 4 milestones

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Local-First File Custody | ✅ PASS | Frontend never touches files directly. All filesystem mutations go through plan-review-approve-apply via Tauri commands. DirPicker uses native OS dialog. |
| II. Reviewable Filesystem Mutation | ✅ PASS | Plan review page (FR-045–050) implements full 3-tier approval gate. No silent mutations possible from the UI. |
| III. PixInsight Boundary | ✅ PASS | Frontend organizes and displays data. No image processing. "Observed, not owned" banners on artifacts (FR-053). |
| IV. Research-Led Domain Modeling | ✅ PASS | Frontend consumes domain models from specs 002-026. No new domain modeling — visual presentation only. |
| V. Portable Contracts | ✅ PASS | Frontend communicates via Tauri commands (typed invoke calls). The command interface is the contract boundary — portable to future HTTP/gRPC transport. |

**Product Constraints**:
- ✅ Supports messy libraries (sessions/targets aggregate from whatever the scanner found)
- ✅ Cross-platform path display (DirPicker native, monospace path rendering)
- ✅ No eager hashing in frontend (backend decision)
- ✅ Protected categories visible in plan review (FR-046, 🔒 glyph)

## Project Structure

### Documentation (this feature)

```text
specs/027-frontend-implementation/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output (frontend state shapes)
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output (Tauri command interface)
└── tasks.md             # Phase 2 output (/speckit-tasks command)
```

### Source Code (repository root)

```text
apps/desktop/
├── src/
│   ├── main.tsx                    # Entry point (tokens + router mount)
│   ├── app/
│   │   ├── router.tsx              # TanStack Router config (hash mode)
│   │   ├── Shell.tsx               # AppFrame: title bar + sidebar + content + status bar
│   │   ├── Sidebar.tsx             # Collapsible nav with items and badges
│   │   ├── StatusBar.tsx           # Thin bar + expandable LogPanel
│   │   ├── LogPanel.tsx            # Expanded operation log
│   │   └── CommandPalette.tsx      # cmdk global search + actions
│   ├── api/
│   │   ├── commands.ts             # Typed Tauri invoke wrappers
│   │   ├── mocks.ts                # Mock command responses (dev mode)
│   │   └── types.ts                # Shared DTO types from contracts
│   ├── data/
│   │   ├── store.ts                # useSyncExternalStore pub/sub
│   │   ├── fixtures/               # Static mock data per entity
│   │   └── preferences.ts          # Local preferences (density, sidebar, view modes)
│   ├── styles/
│   │   ├── tokens.css              # Design tokens from DESIGN.md §3
│   │   ├── reset.css               # Base reset
│   │   └── components.css          # Shared component styles (alm-* classes)
│   ├── ui/                         # Shared primitives (FR-008)
│   │   ├── Pill.tsx
│   │   ├── Confidence.tsx
│   │   ├── Provenance.tsx
│   │   ├── Lock.tsx
│   │   ├── KV.tsx
│   │   ├── Box.tsx
│   │   ├── Section.tsx
│   │   ├── Btn.tsx
│   │   ├── DirPicker.tsx
│   │   ├── FilterBar.tsx
│   │   ├── Toolbar.tsx
│   │   ├── DataTable.tsx           # TanStack Table wrapper
│   │   ├── ThreePane.tsx           # Three-pane layout container
│   │   ├── WizardShell.tsx         # Step rail + content + summary rail
│   │   └── index.ts
│   └── features/                   # Page modules (one per nav destination)
│       ├── sessions/
│       │   ├── SessionsPage.tsx    # List + group-by + calendar
│       │   ├── SessionDetail.tsx
│       │   ├── CalendarView.tsx
│       │   └── GroupByBar.tsx
│       ├── review/
│       │   ├── ReviewPage.tsx      # Three-pane review queue
│       │   ├── ReviewQueue.tsx     # Left list
│       │   ├── EvidencePane.tsx    # Center evidence
│       │   └── DecisionPanel.tsx   # Right decisions
│       ├── calibration/
│       │   ├── CalibrationPage.tsx # Three-pane masters
│       │   ├── MastersList.tsx
│       │   └── MasterDetail.tsx
│       ├── targets/
│       │   ├── TargetsPage.tsx     # Three-pane targets
│       │   ├── TargetList.tsx
│       │   ├── TargetDetail.tsx
│       │   └── CoverageChart.tsx
│       ├── projects/
│       │   ├── ProjectsPage.tsx    # List
│       │   ├── ProjectDetail.tsx   # 3-way view toggle
│       │   ├── CommandCenter.tsx   # Kit grid view
│       │   ├── PipelineView.tsx    # Horizontal flow view
│       │   ├── CombinedView.tsx    # Both
│       │   └── wizard/
│       │       ├── WizardPage.tsx  # 6-step orchestrator
│       │       ├── StepName.tsx
│       │       ├── StepSources.tsx
│       │       ├── StepCalibration.tsx
│       │       ├── StepViews.tsx
│       │       ├── StepLayout.tsx
│       │       └── StepReview.tsx
│       ├── plans/
│       │   ├── PlansPage.tsx       # Plans list
│       │   ├── PlanReview.tsx      # Table + Diff toggle
│       │   ├── PlanTable.tsx
│       │   ├── PlanDiff.tsx
│       │   └── ApprovalGate.tsx    # 3-tier approval logic
│       ├── audit/
│       │   └── AuditPage.tsx
│       ├── settings/
│       │   ├── SettingsPage.tsx    # Left-rail + pane container
│       │   ├── DataSources.tsx
│       │   ├── NamingStructure.tsx
│       │   ├── SourceViewStrategy.tsx
│       │   ├── CleanupPolicy.tsx
│       │   ├── RootRecovery.tsx
│       │   ├── Equipment.tsx
│       │   ├── Tools.tsx
│       │   ├── LogSettings.tsx
│       │   ├── Catalogs.tsx
│       │   └── Protection.tsx
│       ├── setup/
│       │   ├── SetupWizard.tsx     # 4-step first-run
│       │   └── steps/
│       └── tour/
│           └── TourProvider.tsx    # react-joyride wrapper + step definitions
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
└── vitest.config.ts
```

**Structure Decision**: Feature-based organization under `src/features/` with shared primitives in `src/ui/`. Each feature is a self-contained module with its own page components. The `src/api/` layer provides the contract boundary between frontend and Tauri backend — swappable between mocks and real commands.

## Implementation Phases (Milestones)

### Milestone 1: Shell + Primitives + Sessions + Detail

**Goal**: A working app shell with the primary interaction surface.

| Phase | Deliverable | Dependencies |
|-------|-------------|--------------|
| 1.1 | `src/styles/tokens.css` — full design token set from DESIGN.md §3 | None |
| 1.2 | `src/ui/*` — all shared primitives (Pill, Confidence, Provenance, etc.) | tokens.css |
| 1.3 | `src/app/Shell.tsx` + Sidebar + StatusBar + Router | primitives |
| 1.4 | `src/features/sessions/SessionsPage.tsx` — list + group-by + calendar | shell, primitives, DataTable |
| 1.5 | `src/features/sessions/SessionDetail.tsx` — tabbed detail with provenance | sessions page |
| 1.6 | `src/app/CommandPalette.tsx` — basic search + navigation | shell |
| 1.7 | `src/app/LogPanel.tsx` — expandable status bar | shell |

**Exit criteria**: User can launch app, see sessions table, switch group-by modes, open calendar view, click into session detail with provenance display, use Cmd+K to navigate.

### Milestone 2: Targets + Plans + Projects + Wizard

**Goal**: The project workflow end-to-end.

| Phase | Deliverable | Dependencies |
|-------|-------------|--------------|
| 2.1 | `src/features/targets/TargetsPage.tsx` — three-pane + coverage bars | ThreePane, primitives |
| 2.2 | `src/features/plans/PlanReview.tsx` — table + diff + approval gates | primitives, ApprovalGate |
| 2.3 | `src/features/projects/ProjectsPage.tsx` — list with lifecycle pills | primitives, DataTable |
| 2.4 | `src/features/projects/ProjectDetail.tsx` — 3-way view toggle | projects page |
| 2.5 | `src/features/projects/wizard/*` — 6-step wizard | WizardShell, DirPicker, plan review |
| 2.6 | `src/features/projects/artifacts/` — per-project artifacts + outputs | project detail |

**Exit criteria**: User can browse targets with coverage, create a project via wizard (all 6 steps), review and approve the creation plan, see project detail in all 3 view modes, browse artifacts.

### Milestone 3: Calibration + Settings + Audit

**Goal**: Configuration and historical record surfaces.

| Phase | Deliverable | Dependencies |
|-------|-------------|--------------|
| 3.1 | `src/features/calibration/CalibrationPage.tsx` — three-pane masters | ThreePane, primitives |
| 3.2 | `src/features/settings/SettingsPage.tsx` — all 10 panes | DirPicker, token builder, policy matrix |
| 3.3 | `src/features/settings/NamingStructure.tsx` — token drag builder | Specific — drag/drop + live preview |
| 3.4 | `src/features/settings/CleanupPolicy.tsx` — per-tool matrix | Policy matrix UI |
| 3.5 | `src/features/audit/AuditPage.tsx` — log table + filters + export | DataTable, FilterBar |

**Exit criteria**: User can browse calibration masters with fingerprints, configure all settings panes (sources, naming, cleanup, equipment, tools), view and filter audit log, export JSONL.

### Milestone 4: Review Queue + First-Run + Tour

**Goal**: Onboarding and review workflow.

| Phase | Deliverable | Dependencies |
|-------|-------------|--------------|
| 4.1 | `src/features/review/ReviewPage.tsx` — three-pane + keyboard shortcuts | ThreePane, DecisionPanel |
| 4.2 | `src/features/setup/SetupWizard.tsx` — 4-step first-run | WizardShell, DirPicker |
| 4.3 | `src/features/tour/TourProvider.tsx` — react-joyride integration | All pages exist (anchor points) |

**Exit criteria**: User can review sessions via keyboard (J/K/Cmd+1/2/3), filter unclassified files in review queue, complete first-run setup wizard, see guided tour hints after initial scan.

## Research Summary

No Phase 0 research needed — all technical decisions are resolved:

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Component library | Base UI (headless) | Inherited from spec 022. Headless = full control over DESIGN.md visual system |
| Routing | TanStack Router (hash mode) | Inherited. Hash mode works in Tauri without server config |
| Table primitive | TanStack Table wrapped in app-local DataTable | Inherited from spec 022. Canvas confirms dense table pattern |
| State management | useSyncExternalStore pub/sub | Inherited. Minimal overhead, Tauri command responses as event source |
| Token architecture | CSS custom properties in tokens.css | Inherited. alm-* class naming convention |
| Tour library | react-joyride v3 | Research from spec 010 (Shepherd disqualified due to AGPL) |
| Mock strategy | Tauri command mocks in src/api/mocks.ts | Allows frontend development independent of Rust backend crate progress |
| Density implementation | CSS custom property `--alm-density` toggling row heights/padding | Single global preference stored in local prefs |

## Complexity Tracking

No constitution violations. All principles satisfied by design.
