# Implementation Decisions Log

**Feature**: 027-frontend-implementation
**Started**: 2026-05-24

## Decisions Made During Unattended Execution

| # | Decision | Rationale | Discuss? |
|---|----------|-----------|----------|
| 1 | Used `Group`/`Panel`/`Separator` API for react-resizable-panels v4.11.1 instead of `PanelGroup`/`PanelResizeHandle` | The installed version (4.11.1) exports these names — the older names don't exist. TypeScript compilation confirmed. | No — API mismatch was a factual error, fix is deterministic. |
| 2 | Ran `pnpm install` during Phase 2 to resolve `react-joyride` and `@tanstack/react-virtual` into lockfile | Agents added deps to package.json but couldn't install. TypeScript would fail without resolved node_modules. | No — mechanical necessity. |
| 3 | Created `LogPanelContext.tsx` as shared context between StatusBar and LogPanel | StatusBar click triggers LogPanel expand — needs shared state. Context avoids prop drilling through Shell. | No — standard React pattern for sibling communication. |
| 4 | Track A agent created stub page components (one-liner exports) in all 16 feature directories | Router's lazy imports would fail at runtime without matching exports. Stubs get replaced by each track's real implementation. | No — temporary scaffolding, replaced by real code. |
| 5 | Panel sizes passed as plain numbers (percentages) not `{ value, unit }` objects | react-resizable-panels v4.11.1 types expect `number | string | undefined` for size props, not the object form some docs show. | No — driven by installed package's actual type definitions. |
| 6 | Font loading via Google Fonts CDN preload links in index.html | Spec says Inter + JetBrains Mono. CDN approach is simplest for dev; production may want self-hosted. | **Maybe** — if you want self-hosted fonts for offline-capable Tauri app, this needs revisiting. Tauri apps may not have internet. |
| 7 | Fixtures use hardcoded UUIDs in `550e8400-*` namespace with cross-file consistency | Mock data needs stable IDs for cross-references (session→project, calibration→session). Random UUIDs would break relationships. | No — standard fixture practice. |
| 8 | Mock invoke adds 50-150ms artificial delay | Simulates realistic Tauri command latency so UI loading states are testable during development. | No — removed automatically when USE_MOCKS=false. |
| 9 | DataTable uses @tanstack/react-virtual for 250+ row virtual scrolling | Spec requires "smooth 60fps scroll on 250+ row tables". Virtual scrolling is the standard solution. | No — directly implements SC-008 performance requirement. |
| 10 | Keyboard shortcuts in ReviewPage use `metaKey` (Mac) OR `ctrlKey` (Windows/Linux) | Cross-platform desktop app needs both modifier keys. Spec says "Cmd+1" but Windows users expect Ctrl+1. | No — standard cross-platform handling for Tauri apps. |

| 11 | Refactor all interactive primitives to Base UI before continuing | design-system-architect agent ignored @base-ui-components/react and built everything from raw HTML. User caught this — Base UI is specified in plan.md as the headless primitive layer for a11y and focus management. | No — user-directed correction. |
| 12 | Future agent prompts will explicitly require Base UI usage | Prevents recurrence. Added to context for Track G and H prompts. | No — process improvement. |

## Pending Decisions (will be made as tracks complete)

- Track G: Whether TourProvider should wrap Shell or be rendered conditionally inside it
- Track H: Whether performance validation should use Playwright MCP or manual browser testing
