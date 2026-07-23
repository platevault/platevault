# Contracts: Adaptive Detail-Panel Dock

**N/A — this feature introduces no UI↔core transport changes**, in both the
original design and the shipped implementation.

The adaptive dock is a pure frontend layout + client-side UI-preference
feature. It adds:

- **No** Tauri command.
- **No** contract DTO (`crates/contracts/core`, `packages/contracts`, or
  generated `apps/desktop/src/bindings`).
- **No** SQLite schema or migration.

All new state is local UI-preference state. As shipped, it lives in raw
`localStorage` keys (`alm-dock-placement-<dockId>`, `alm-dock-width-<dockId>`
— see [../data-model.md](../data-model.md)), not in the originally designed
`AppPreferences.detailDock` typed field. Either shape is outside the durable
relationship/audit record per Constitution §V.

No generated bindings need regeneration for this feature. `just
check-generated` remains clean without any contract edits — confirmed true
for the shipped PRs (#1003, #1035, #1060) as well as the original design.
