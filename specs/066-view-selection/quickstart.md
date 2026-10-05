# View selection acceptance guide

## Inputs

Use a fresh disposable catalog and generated FITS and XISF frames, never a real library. The [library acceptance guide](../064-library-inventory/quickstart.md) describes the fixture writers; research R30 covers footprint-sized geometry. Build the worked set from the [product flow](../../docs/reviews/2026-10-03-product-flow-and-journeys.md#worked-example):

- `Astro-T7/Captures` with five RedCat sessions of NGC 7000 at 300 s:
  - 18 Sep Ha, 55 frames: RA/DEC only, so it is pointing-only.
  - 28 Sep Ha, 56 frames: RA/DEC and OBJCTROT without FOCALLEN or XPIXSZ, so its field of view comes from confirmed equipment.
  - 24 Sep OIII, 20 frames: no pointing and no OBJECT.
  - 26 Sep OIII, 35 frames: full geometry and OBJECT `Cygnus field`.
  - 30 Sep OIII, 48 frames: full geometry; six named frames are the exclusion set.
- One session of the same field from another camera, with its own confirmed equipment.
- `Cold-1/Captures` with the 12 Sep OIII session, observed but not confirmed equipment, then taken offline.
- Saved Target NGC 7000, saved equipment RedCat 51 / ASI2600MM, and the 065 Project `NGC 7000 HOO` framing that Target with that equipment.
- Two later RedCat sessions, Ha and OIII, ten frames each with full geometry, kept outside the locations until the refresh steps.

Overlap fixtures sit at coverage of at least 0.9 or at most 0.1. Record every path, size and SHA-256 before running. Read [the data model](data-model.md) and [the IPC contract](contracts/views.md) for fields and states.

## Backend proof

1. Index both locations and confirm RedCat equipment for the five Astro-T7 sessions. Dump the sessions, associations, quality decisions and Target rows.
2. Create a View from the Project. 26, 28 and 30 Sep are preselected with their evidence, including `Cygnus field`. The other-camera and 12 Sep sessions are listed and unselected. The dumped rows are unchanged (VSEL-AC-01, VSEL-AC-08).
3. Read candidate evidence. 28 Sep shows FOV from confirmed equipment with its inputs. 18 Sep is pointing-only with a distance and no footprint. 24 Sep reads Position unknown with a null distance. Neither was preselected. Select both: five sessions read with reason manual (VSEL-AC-02).
4. Filter to Ha: `selectedOutsideFilters` is 3 and five stay selected. Missing OBJECT matches only 24 Sep. Sort by sky distance and page: 24 Sep sorts last with no distance. `selectedOnly` lists five. The draft revision is unchanged, and no measurement or rehash started (VSEL-AC-03).
5. Read the draft summary: Ha 111 / 9h 15m, OIII 103 / 8h 35m, total 214 / 17h 50m, all Unreviewed, no unresolved member.
6. Select 12 Sep. It reads unresolved with Offline availability, unverified last-observed counts, and reconnect, locate and remove actions. Deselect it: the summary returns to 214 / 17h 50m (VSEL-AC-09).
7. Name the View `NGC7000 HOO - Siril` and save revision 1. Create a View from 18 and 28 Sep: no Project exists for it, and it holds those two. Clear its selection: zero selected, and revision 1 is unchanged. Create a View from the Target: zero selected, and suggestions are readable (VSEL-AC-07, VSEL-AC-14).
8. Exclude the six 30 Sep frames, restore one and exclude it again. The summary reads OIII 97 / 8h 05m and 208 / 17h 20m. Files, library quality, Target coverage, the other Views and the Project are unchanged (VSEL-AC-04).
9. Save revision 2. No quality decision changed (VSEL-AC-05, View side).
10. Read the scope of Mark included frames usable: library, 208 frames. Confirm it: those frames read Usable, and NGC 7000 usable reads Ha 9h 15m and OIII 8h 05m (VSEL-AC-05).
11. Mark one excluded frame Unusable in library and reject another for the Project. Target usable stays as in step 10. The Project shows the rejection. Revision 2 and the draft keep 208 included (VSEL-AC-11).
12. Make one included 30 Sep frame unreadable and rescan, then create a View from 30 Sep. Unreviewed and Usable frames are included, the Unusable frame reads excluded, and the unreadable frame is unresolved. Include the Unusable frame: only that draft changes. Discard the draft, restore the frame's permission and rescan (VSEL-AC-13).
13. Change the Project equipment and framing, and a member's quality. Revision 2 rows are unchanged, and `projectContextChanged` reads true (VSEL-AC-10).
14. Add the two later sessions, rescan and confirm their RedCat equipment. Deny the 18 Sep folder and rescan. Refresh: two sessions read added with reasons. 18 and 24 Sep read as manual inclusions, the six exclusions are kept, and 18 Sep reads unavailable with no removal. Membership is unchanged. Keep it unchanged, refresh again, accept Ha and decline OIII, and save revision 3. Its new Ha members carry `addedInRevision`. Revision 2 rows are unchanged (VSEL-AC-06, VSEL-AC-12, View side).
15. Restore the 18 Sep folder and rescan. 18 Sep is still a member of revisions 2 and 3 with no duplicate session. Remap a member location to a verified copy, then refresh: it lists no change.
16. Edit with a stale draft revision and save with a stale base: both are Conflict with the current revision. Force SQLITE_FULL on save through the catalog unit test: PersistenceFailure, nothing persists, and the retry succeeds. Restore one frame without saving, close and reopen: revision 3 and the unsaved draft return separately (VSEL-FR-13).
17. Review Retire location for `Cold-1`: it names Views that hold its copies. After retiring, those members read unresolved and no revision changed.
18. Compare the original manifest and hashes exactly (PV-VSEL-SC-03).

Run the focused catalog and core View tests, then `cargo test --workspace`, `just db-boundary` and `bash scripts/check-dev-surface-absent.sh` after integration. These checks do not certify the UI or other platforms.

## Real development application

Launch `cargo run -p desktop_shell --features dev-tools --bin platevault-library` with a fresh `PV_LIBRARY_DATA_DIR`. Leave `PV_MCP_BRIDGE_BIND` unset so the bridge binds `127.0.0.1`. Through Tauri MCP `ipc_execute_command`, repeat steps 2 to 16 with the `view_*`, `library_*` and `project_*` commands, and confirm the committed state after restart. The View review surface and the J20 S8, J21, J22 and J25 steps stay pending on the final clean-slate frontend and fresh journey validation. The prepared-revision and external-input parts of VSEL-AC-05 and VSEL-AC-12 are verified with 069.

Any untested profile, platform or fixture stays an explicit acceptance gap. After five failed fixes, an issue gets a reproducible backlog entry; this guide is never weakened to pass.
