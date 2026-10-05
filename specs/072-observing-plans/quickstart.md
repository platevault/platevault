# Observing plans acceptance guide

## Inputs

Use a fresh disposable catalog and generated FITS and XISF frames, never a real library. The [Project acceptance guide](../065-project-goals/quickstart.md) describes the NGC 7000 sessions, their two capture sites and the `NGC 7000 HOO` Project with Ha 10h and OIII 10h. Add these planning inputs:

- Backyard at 52.09 N, 5.12 E, elevation 5 m, zone `Europe/Amsterdam`.
- The second site at 37.98 N, 23.73 E, elevation 100 m, zone `Europe/Athens`, about 19 degrees of longitude and one zone from Backyard.
- Saved Target NGC 7000 with `icrs` coordinates, and one saved Target without coordinates.
- Criteria: altitude 30 degrees, astronomical darkness, Moon separation at least 30 degrees, minimum 60 minutes. Nights from 2026-10-20 for 30 nights, which include the 2026-10-25 DST change in both zones.

Record every image path, size and SHA-256 before running. Read [the data model](data-model.md) and [the IPC contract](contracts/planning.md) for fields and states.

## Backend proof

1. Index the fixtures and create the Project through the 065 commands. Record `library_list_operations`, `library_list_sessions`, each linked session's capture sites and `project_detail`.
2. Save both sites. The list shows no default site (PLAN-FR-01).
3. Read the Target overview. NGC 7000 is not Planned, has no subscription and shows its coverage with Ha 10h and OIII 10h listed as unmet Project gaps. The reminder status reads `schedulerRunning` false (PLAN-FR-02, PLAN-AC-05).
4. Compute windows at Backyard. Every window names Backyard and `Europe/Amsterdam`, and offsets change across 2026-10-25. Sampling each listed minute with skymath meets every criterion. Nights without a window state a reason. Windows match the astroplan fixture within research R9 (PLAN-FR-02, PLAN-FR-08).
5. Raise the minimum to 120 minutes and compute again. The list changes, and every window lasts at least 120 minutes. The Target without coordinates returns `target_coordinates_unknown`. No window field claims weather, equipment or readiness (PLAN-FR-05).
6. Compute the same query at the second site. Windows name it and `Europe/Athens`. The step 1 reads, the planning rows and the operations list are unchanged (PLAN-AC-01).
7. Mark NGC 7000 Planned. The Target decision revision and Project framing stay unchanged, and the scheduler stays stopped (PLAN-FR-03).
8. Review and enable reminders. Each returns InvalidInput naming `defaultSite`, and no subscription exists (PLAN-AC-04).
9. Make Backyard the default. Requests without criteria or without lead time are InvalidInput. A review with criteria and a 1440-minute lead names Backyard, the criteria, the lead time, the permission state and app-closed delivery as unavailable (PLAN-AC-06, PLAN-FR-06).
10. In the core scheduler tests, enable with a recording notifier and a controlled clock inside a due interval. Each due Backyard window is submitted once, and its notice names Backyard and the window. Windows computed at the second site add no subscription, upcoming entry or delivery. The operations list is unchanged (PLAN-AC-02, PLAN-AC-05).
11. Reopen the Library inside the same due interval. Windows are recomputed and no identity repeats. A row left `sending` reads `uncertain` and is not sent again (PLAN-AC-07).
12. With a notifier that reports denied, activation commits `blocked` with `permission_denied` and the actions `settings` and `retry`. No delivery row exists. Retry after the notifier grants reads `enabled` (PLAN-AC-08, PLAN-FR-07).
13. Make the second site the default. The Backyard subscription reads `needs_reconfirmation` and schedules nothing until it is enabled again.
14. Review an export of three Backyard windows and write it to a temporary `.ics` path. The file holds exactly three events with their UTC times, Backyard and `Europe/Amsterdam`. Change the criteria and edit the site: the file bytes stay identical, and exporting with the old digest is Conflict (PLAN-AC-03, PLAN-FR-04).
15. Close and reopen the catalog. Sites, the default, the Planned mark, the subscription and the delivery rows return unchanged. Force SQLITE_FULL on a planning write through the catalog unit test and observe PersistenceFailure with nothing persisted.
16. Compare the original manifest and hashes exactly (PV-PLAN-SC-03).

Run the focused catalog and core planning tests, then `cargo test --workspace`, `just db-boundary` and `bash scripts/check-dev-surface-absent.sh` after integration. These checks do not certify the UI or other platforms.

## Real development application

Launch `cargo run -p desktop_shell --features dev-tools --bin platevault-library` with a fresh `PV_LIBRARY_DATA_DIR`. Leave `PV_MCP_BRIDGE_BIND` unset so the bridge binds `127.0.0.1`. Through Tauri MCP `ipc_execute_command`, repeat steps 2 to 9 with the `planning_*` commands. This unbundled process reports permission `unavailable` with `unbundled_process`, and enabling commits `blocked` with that reason.

Repeat the reminder steps from the debug application bundle with `dev-tools` and a fresh data directory, in a macOS user session where PlateVault has never asked for notification permission:

1. Enable reminders for Backyard. Host automation answers Don't Allow in the OS prompt. The status reads `blocked` with `permission_denied`, the actions `settings` and `retry`, and no delivery (PLAN-AC-08).
2. Call `planning_open_notification_settings`, allow notifications through host automation, then repeat activation. The subscription reads `enabled` for Backyard (PLAN-FR-07).
3. With the 1440-minute lead, the next Backyard window is due. Its delivery row reads `submitted`, and a host screenshot shows a notification naming NGC 7000, Backyard and the window. No row names the second site (PLAN-AC-02).
4. Quit and relaunch. The status recomputes upcoming windows and the window keeps one delivery row (PLAN-AC-07).
5. Call `planning_export_calendar`, save through the native panel with host automation, and hash the file. Change the criteria and hash it again (PLAN-AC-03).
6. Confirm that `library_list_operations` lists no operation started by planning or reminders.

The Plan area, the Settings sites section, J29 S1 to S10 and J20 S6 and S7 stay pending on the final clean-slate frontend and fresh journey validation. If no debug bundle can carry the dev bridge, steps 1 to 4 stay an explicit gap (research R26).

Any untested profile, platform or fixture stays an explicit acceptance gap. After five failed fixes, an issue gets a reproducible backlog entry; this guide is never weakened to pass.
