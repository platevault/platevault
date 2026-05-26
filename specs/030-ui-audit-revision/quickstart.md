# Quickstart: UI Audit & Revision

## Prerequisites

- Node.js 20+, pnpm
- Rust toolchain (for backend command changes)
- `just` task runner

## Development

```bash
just dev                    # Start Vite dev server (mock mode)
VITE_USE_MOCKS=true just dev  # Explicit mock mode
just build                  # Build Tauri desktop app
```

## Testing

```bash
just test                   # Rust + Vitest
just typecheck              # TypeScript type check
just lint                   # Cargo fmt + clippy + pre-commit
```

## Key Files

| What | Where |
|------|-------|
| Router | `apps/desktop/src/app/router.tsx` |
| Shell layout | `apps/desktop/src/app/Shell.tsx` |
| Sidebar | `apps/desktop/src/app/Sidebar.tsx` |
| Status bar | `apps/desktop/src/app/StatusBar.tsx` |
| Setup wizard | `apps/desktop/src/features/setup/` |
| Inbox (review) | `apps/desktop/src/features/review/` → rename to `inbox/` |
| Sessions | `apps/desktop/src/features/sessions/` |
| Calibration | `apps/desktop/src/features/calibration/` |
| Targets | `apps/desktop/src/features/targets/` |
| Projects | `apps/desktop/src/features/projects/` |
| Settings | `apps/desktop/src/features/settings/` |
| Preferences | `apps/desktop/src/data/preferences.ts` |
| Design tokens | `apps/desktop/src/styles/` |

## Mock Data

The app uses mock data when `VITE_USE_MOCKS=true`. Mock providers are in
the feature directories. All UI work can be done in mock mode — no Tauri
backend required for layout/component changes.

## Implementation Order

1. Shared components (ListSidebar, FilterBar, TopActionBar, PropertyTable)
2. App shell (router, sidebar, status bar)
3. Setup wizard (4-step rewrite)
4. Inbox & Sessions (core review workflow)
5. Calibration, Targets, Projects
6. Settings & Archive
