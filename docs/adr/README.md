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

## Status values

- **Proposed** — under discussion
- **Accepted** — decided, implementing
- **Superseded** — replaced by a later ADR (link it)
- **Deprecated** — no longer relevant
- **Rejected** — considered, not adopted (kept for the record)
