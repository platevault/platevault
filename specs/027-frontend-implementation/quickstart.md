# Quickstart: Desktop Frontend Implementation

## Prerequisites

- Node.js 20+
- pnpm (workspace package manager)
- Rust toolchain (for Tauri, but not required for frontend-only dev)

## Development (frontend only, with mocks)

```bash
cd apps/desktop
pnpm install
pnpm dev          # Starts Vite dev server with HMR (mock mode)
```

Opens at `http://localhost:5173`. All Tauri commands are mocked — no Rust backend needed.

## Development (full Tauri app)

```bash
just dev          # Starts Tauri dev mode (Rust backend + React frontend)
```

## Verify a milestone

### M1: Shell + Sessions

1. App launches showing Sessions page with mock data (10 sessions)
2. Sidebar shows all nav items with Review queue badge
3. Click collapse (<<) — sidebar shrinks to 44px icons
4. Select "group by target" — sessions regroup without page change
5. Click "Calendar" — 3-month grid shows session cards on nights
6. Click a session row — detail opens with tabs, provenance glyphs, confidence bars
7. Press Cmd+K — command palette opens, type "NGC" — sessions filter

### M2: Targets + Plans + Projects + Wizard

1. Navigate to Targets — three-pane layout, coverage bars visible
2. Click "New project →" on a target — wizard opens with target pre-filled
3. Complete all 6 wizard steps (name, sources, calibration, views, layout, review)
4. Step 6 shows filesystem plan — click Approve & create
5. Navigate to Projects — new project visible with lifecycle pill
6. Open project detail — toggle between Command center / Pipeline / Combined

### M3: Calibration + Settings + Audit

1. Navigate to Calibration — three-pane, masters grouped by kind
2. Select a master — fingerprint, provenance, usage, compatible sessions visible
3. Navigate to Settings → Naming — token builder renders with live preview
4. Navigate to Settings → Cleanup — per-tool matrix renders with action dropdowns
5. Navigate to Audit — events table with dot-notation names, outcome pills

### M4: Review Queue + Setup + Tour

1. Navigate to Review queue — three-pane with queue items
2. Press J/K to navigate, Cmd+1 to confirm — decisions persist
3. Filter to "Unclassified files" — file-level items appear
4. Trigger first-run state (clear localStorage) — setup wizard appears
5. Complete setup — tour hint anchors to first confirmable session

## Running tests

```bash
cd apps/desktop
pnpm test         # Vitest unit/component tests
pnpm test:e2e     # Playwright integration tests
```

## Key files for orientation

| Purpose | Path |
|---------|------|
| Design tokens | `src/styles/tokens.css` |
| Shared primitives | `src/ui/` |
| App shell | `src/app/Shell.tsx` |
| Route config | `src/app/router.tsx` |
| Mock data | `src/data/fixtures/` |
| Tauri command types | `src/api/types.ts` |
| Wireframe reference | `docs/design/canvas-wireframes-2026-05-24/` |
| Visual spec | `/DESIGN.md` |
