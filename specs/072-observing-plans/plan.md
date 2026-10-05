# Implementation Plan: Observing plans, reminders, calendar export

**Branch**: `072-observing-plans`
**Spec**: [072-observing-plans](spec.md)
**Date**: 2026-10-05

## Summary

Implement the PLAN contract on the rebuilt 064 backend and the planned 065 Projects. Saved sites, the default site, the Planned mark, reminder subscriptions and reminder delivery records are Tier 1 rows in the clean library catalog. Rust computes observing windows for a saved Target from skymath 0.7.2 primitives in a pure core module. A window names its site, its IANA time zone and the local offsets at its boundaries. Reminders need an explicit review and activation against the default site, explicit criteria and an explicit lead time. They run only inside the running application and only while a subscription is enabled. Each target, site and window start produces at most one reminder, and the application never claims app-closed delivery. Calendar export confirms a snapshot, saves an RFC 5545 file through the native save dialog and never changes that file again. [Research](research.md) records the source evidence and the conservative defaults R1 through R27.

## Technical Context

- Language: Rust workspace toolchain, edition 2021, on the 064 crates `platevault_model`, `platevault_core`, `persistence_library` and `desktop_shell`, plus the 065 Project modules.
- Dependencies: existing skymath 0.7.2, serde, sqlx SQLite, Tokio, UUID and time. The plan adds `jiff` 0.2 with its bundled time-zone database to `platevault_core` (R3). On macOS, `desktop_shell` gains direct dependencies on `objc2-user-notifications` 0.3.2 and its `objc2` and `block2` companions, which `Cargo.lock` already resolves (R13). The shell registers the existing `tauri-plugin-dialog` and `tauri-plugin-opener` through their Rust APIs only.
- Storage: the clean library catalog with planning tables from `planning.sql`. The schema version is one above the version on the integration base. With 064 at 6 and 065 at 7 as the only dependencies, that is 8 when no other sibling lands first (R1). One FULL-synchronous serialized writer applies. Older development catalogs are refused and reset. The plan imports no legacy setting.
- Platform: desktop Tauri 2 isolated library shell on macOS, Windows and Linux. Host proof is macOS. Windows and Linux notification adapters report unavailable until a platform qualification passes (R13).
- Testing: failing-first behavior tests in the files listed under Source. Window accuracy is checked against an independent astroplan reference fixture (R9). After integration, run `cargo test --workspace`, `just db-boundary` and the dev-surface guard. Real development Tauri MCP scenarios follow, with host automation for the native save dialog and the OS permission prompt (R25).
- Performance: one window request covers at most 366 nights and runs off the async workers. Reading windows, status or the Target overview writes nothing. The scheduler exists only while at least one subscription is enabled, and it re-reads the wall clock at least every 30 seconds.
- Constraints: SQL only under `crates/persistence`. Windows are astronomical only. The frontend computes no position, crossing, time-zone offset or window.

## Constitution Check

Pre-research gate: pass. Post-design recheck: pass.

- I Local-first custody: planning reads no image file and writes none. Calendar export creates only the user-chosen `.ics` file. Hash manifests before and after every scenario prove that originals stay unchanged (PV-PLAN-SC-03).
- II Reviewable mutation: export writes one new user-chosen file after an explicit snapshot review and the native save dialog. It touches no library input, so no filesystem plan or audit operation applies. The native dialog confirms any replacement, and a failed write leaves the existing file intact.
- III PixInsight boundary: the feature adds no image processing.
- IV Research-led modeling: research.md compares the alternatives for time zones, window composition, permission handling, scheduling, repeat identity and calendar encoding, and records the defaults.
- V Portable contracts: [contracts/planning.md](contracts/planning.md) is a versioned language-neutral command contract with revisions, states and errors. Sites, the default site, Planned marks, subscriptions and delivery records are Tier 1 and commit synchronously before acknowledgment. Windows and upcoming reminders are recomputed on read and never stored.

The all-human-gate waiver leaves analysis, tests, independent review and Sniff mandatory.

## Project Structure

### Documentation

```text
specs/072-observing-plans/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── planning.md
│   └── modules.md
└── checklists/requirements.md
```

No `tasks.md`: executable task state lives under the molecule implement step in Beads.

### Source

- `crates/platevault-model/src/planning.rs`: shared planning types and input validation, re-exported from `lib.rs`.
- `crates/platevault-core/src/notifier.rs`: the `Notifier` and `Clock` ports and the system clock.
- `crates/persistence/library/src/planning.sql` and `src/planning.rs`: planning tables, CAS writes, delivery identities and recovery. `lib.rs` wires the module and the schema version.
- `crates/platevault-core/src/planning.rs`: pure window computation, criteria and time-zone handling.
- `crates/platevault-core/src/reminders.rs`: pure due and upcoming rules and the in-app scheduler.
- `crates/platevault-core/src/calendar.rs`: RFC 5545 rendering and the atomic snapshot write.
- `crates/platevault-core/src/library.rs`: planning methods, the Target overview with Project gaps, and the scheduler lifecycle.
- `apps/desktop/src-tauri/src/library_notifier.rs`: the macOS notification adapter and the unavailable adapter for unqualified platforms.
- `apps/desktop/src-tauri/src/commands/observing_plans.rs`: the thirteen `planning_*` handlers, registered in `library_shell.rs`.
- Tests: `crates/persistence/library/tests/planning.rs`, and `crates/platevault-core/tests/{planning_windows.rs,reminders.rs,calendar.rs,planning_library.rs}` with the astroplan fixture under `tests/fixtures/planning/`.

[contracts/modules.md](contracts/modules.md) defines signatures and file ownership.

## Independent units and integration

The foundation owner lands the model types, the core ports, the `jiff` dependency and the reference fixture first. The windows, catalog and calendar units then work in separate linked worktrees from that recorded commit. The reminders unit needs the catalog unit and the windows unit. The notifier unit needs only the foundation. No unit edits the model, the ports or another unit's files. The integration owner waits for every unit and for the 065 integration. It owns `library.rs`, IPC, the shell wiring, the composed tests and the schema-version assignment on the integration base.

Workers skip repository-wide builds, tests, lint and formatters. The lead runs the focused planning tests and one integrated workspace verification, then exact-head independent review and Sniff. Original hashes are checked before and after. The Plan area, the Settings sites section, J29 and J20 S6 and S7 stay open on the final-frontend acceptance task. After five failed fixes, an issue gets a reproducible backlog entry, never a stub.

## Complexity Tracking

Planning tables join the library catalog crate instead of a new persistence crate. Subscriptions and delivery records reference saved Targets, and the Target overview reads coverage and Project progress in the same catalog. A second crate would need a second writer connection. The notification adapter lives in the shell because macOS authorization depends on the application bundle, which the core cannot observe.
