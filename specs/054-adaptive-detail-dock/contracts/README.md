# Contracts: Adaptive Detail-Panel Dock

**N/A — this feature introduces no UI↔core transport changes.**

The adaptive dock is a pure frontend layout + client-side UI-preference
feature. It adds:

- **No** Tauri command.
- **No** contract DTO (`crates/contracts/core`, `packages/contracts`, or
  generated `apps/desktop/src/bindings`).
- **No** SQLite schema or migration.

All new state is local UI-preference state persisted in `localStorage` under
the existing `alm-preferences` key (see [../data-model.md](../data-model.md)),
which is explicitly outside the durable relationship/audit record per
Constitution §V.

No generated bindings need regeneration for this feature. `just check-generated`
must remain clean without any contract edits.
