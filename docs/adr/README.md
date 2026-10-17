# Architecture Decision Records

MADR-format ADRs for PlateVault. One decision per file, `NNNN-title-with-dashes.md`.
Never edit an accepted ADR to reverse it — write a new one that supersedes it, and mark the
old one `Superseded`.

## Index

| ADR | Title | Status | Date |
| --- | --- | --- | --- |
| [0001](0001-astronomy-compute-boundary.md) | Planner astronomy math runs in the frontend (astronomy-engine), not a Rust core crate | Historical spec 044; superseded for the rebuild by [0003](0003-use-rust-scientific-execution-and-a-clean-local-catalog-for-the-platevault-rebuild.md) | 2026-07-04 |
| [0002](0002-lock-and-infotip-stay-separate.md) | Lock and InfoTip stay separate components | Accepted | 2026-07-20 |
| [0003](0003-use-rust-scientific-execution-and-a-clean-local-catalog-for-the-platevault-rebuild.md) | Rust scientific execution and a clean local catalog for the rebuild | Accepted | 2026-10-04 |
| [0004](0004-decision-distribution-strategy-per-os-nsis-signpath-later-macos-self-signed-linux-unchanged-winget-store-later-update-check-setting.md) | Distribution strategy per OS: NSIS with SignPath later, macOS self-signed, Linux unchanged, winget, Store later, update-check setting | Accepted | 2026-10-13 |
| [0005](0005-components-and-one-step-flow.md) | Standard components and one step flow | Accepted | 2026-10-12 |
| [0006](0006-tauri-react-and-backend-services.md) | Stay on Tauri and React, with backend-owned services | Accepted | 2026-10-12 |
| [0007](0007-home-dashboard.md) | Home dashboard without duplicating other pages | Accepted | 2026-10-13 |
| [0008](0008-goal-conditions.md) | Goal conditions beyond time or frames | Accepted | 2026-10-12 |

## Status values

- **Proposed** — under discussion
- **Accepted** — decided, implementing
- **Superseded** — replaced by a later ADR (link it)
- **Deprecated** — no longer relevant
- **Rejected** — considered, not adopted (kept for the record)
