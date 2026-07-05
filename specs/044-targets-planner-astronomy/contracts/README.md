# Contracts — 044 Track B (Ephemeris & Observer-Location Engine)

Track B adds **one** contract surface: observing-site settings. Everything else is frontend,
non-persisted computation with no contract boundary (astronomy math runs in the React shell per
[ADR-0001](../../../docs/adr/0001-astronomy-compute-boundary.md) — the values are UI-derived, not
persisted and not audited, so Constitution Principle V's durable-record obligation does not attach).

## What's here

- **`settings.observing.json`** — value sub-schemas for the new `observing.*` settings keys
  (`observing.sites`, `observing.default_site_id`, `observing.active_site_id`,
  `observing.usable_altitude_deg`). These **extend** the existing spec-018 settings key set.

## Transport reuse (no new command)

Observing sites and the usable-altitude threshold are read and written through the **existing**
spec-018 settings operations — see `specs/018-settings-configuration-model/contracts/`
(`settings.get`, `settings.update`). Implementation adds the four keys above to the settings key
enum (dotted-key convention, cf. `target_lookup.active_catalogs`) and registers their value
sub-schemas in `settings.state.v1.json`. **No `planner.*` / astronomy Tauri command is added.**

## Explicitly NOT a contract

The night-observability engine outputs (`NightObservability`, `DerivedObservability`,
`PlanningContext` in [`../data-model.md`](../data-model.md)) are frontend TypeScript module
boundaries, not language-neutral UI-to-core contracts. They cross no process boundary and persist
nothing. The Track A (spec 047) Moon-avoidance rule Track B integrates is likewise a shared frontend
module, not an IPC contract.

## Revisit trigger (from ADR-0001)

If astronomy ever needs server-side / catalog-wide batch scoring, or any computed value becomes
persisted/audited, a real core operation + contract is introduced then (and the compute moves behind
the boundary). Not now.
