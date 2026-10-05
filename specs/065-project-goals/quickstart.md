# Project goals acceptance guide

## Inputs

Use a fresh disposable catalog and generated FITS and XISF frames, never a real library. The [library acceptance guide](../064-library-inventory/quickstart.md) describes the fixture writers. Build this worked subset:

- Six RedCat sessions of NGC 7000 with 300 s Ha and OIII lights. One session carries a different OBJECT label, one carries the second site's SITELAT/SITELONG and the others carry Backyard.
- One session of the same field from another camera, which stays unlinked.
- A second Captures location holding byte-identical copies of two Ha frames, then taken offline.
- Saved Target NGC 7000 and saved equipment RedCat 51 / ASI2600MM.

Record every path, size and SHA-256 before running. Read [the data model](data-model.md) and [the IPC contract](contracts/projects.md) for fields and states.

## Backend proof

1. Index both locations and read Target coverage. Record captured, usable and Unreviewed seconds per channel.
2. Create `NGC 7000 HOO` with the prefilled Target, a note and one panel. Framing shows the Target's coordinates and provenance (PRJ-AC-01).
3. Link the six RedCat sessions through their `ExpectedSession` values. The other-camera session stays unlinked. A stale grouping revision is refused with Conflict (PRJ-FR-08).
4. Choose the equipment and add Ha 10h, OIII 10h, a 300 s exposure preference, an Ha frame count, panel coverage, equipment and missing flats. Ha and OIII show captured, usable and Project-accepted progress separately and unmet. The exposure item lists 300 s per session with no hour total. Missing flats reads unknown with its reason (PRJ-AC-01, PRJ-AC-07).
5. Recompute the hash manifest and read every asset, session, association and quality decision. All are unchanged, and no View record exists (PRJ-AC-02, PRJ-FR-05).
6. Read linked sessions: each shows its own capture-site coordinates, and the Project has no site field (PRJ-AC-04).
7. Mark 111 linked Ha frames Usable through `library_set_quality`. Accepted Ha reads 9h 15m and Ha 10h stays unmet. Edit the goal to 9h: Ha reads met, and the Project still accepts edits (PRJ-AC-03).
8. Reject one Usable and one Unreviewed linked frame for the Project. Accepted progress falls by the Usable frame only. Captured, library-usable and Target coverage totals stay equal to step 1 plus the step 7 decisions (PRJ-AC-08).
9. Read the Project context while OIII is unmet. The read changes no revision and starts no View (PRJ-AC-05, Project side).
10. Correct the FILTER of one linked session. Its link reads NeedsReview with successors and leaves progress until the successor is linked.
11. Take the copy location offline. Captured progress keeps the last-observed contribution, labeled Offline, and the duplicates count once.
12. Review Retire location for the offline copy location. The review names the Project; editing the Project afterward refuses confirmation.
13. Close and reopen the catalog. Every Project, item, link and rejection returns unchanged. Force SQLITE_FULL on a Project write through the catalog unit test and observe PersistenceFailure with nothing persisted.
14. Compare the original manifest and hashes exactly.

Run the focused catalog and core Project tests, then `cargo test --workspace`, `just db-boundary` and `bash scripts/check-dev-surface-absent.sh` after integration. These checks do not certify the UI or other platforms.

## Real development application

Launch `cargo run -p desktop_shell --features dev-tools --bin platevault-library` with a fresh `PV_LIBRARY_DATA_DIR`. Leave `PV_MCP_BRIDGE_BIND` unset so the bridge binds `127.0.0.1`. Through Tauri MCP `ipc_execute_command`, repeat steps 2 to 10 with the `project_*` commands and confirm the committed state after restart. The Projects surface, J20 S2 to S5 and S8, and J22 S12 and S13 stay pending on the final clean-slate frontend and fresh journey validation. Views and accepted products are verified with 066 and 070.

Any untested profile, platform or fixture stays an explicit acceptance gap. After five failed fixes, an issue gets a reproducible backlog entry; this guide is never weakened to pass.
