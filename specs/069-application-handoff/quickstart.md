# Application handoff acceptance guide

## Inputs

Use a fresh disposable catalog and generated FITS and XISF frames, never a real library. The [library acceptance guide](../064-library-inventory/quickstart.md) describes the fixture writers. On the macOS host, build this worked subset on disk images so volumes can be attached and detached:

- An APFS image `Work` holding `Captures/` with five NGC 7000 sessions of 300 s Ha and OIII lights, `Calibration/` with matching darks and Ha and OIII flats, and empty `Processing/` and `Outputs/`. The 30 Sep OIII folder holds 48 frames, six of which the View excludes, so the confirmed membership is 208 lights.
- A second APFS image `Other` for a cross-volume hardlink, and an MS-DOS (FAT32) image `Scratch` with `Processing/NGC7000-HOO-Siril/keep.txt`. FAT32 supports neither links nor clones.
- A catalog FILTER correction on one session, and Confirmed equipment whose focal length the 28 Sep headers lack.
- An executable script that records its argv to a file and exits, used as the generic application and, in core tests, as the located Siril executable.

Index `Captures` and `Calibration`, then create the View `NGC7000 HOO - Siril` with 066 and accept its calibration with 068. Record every path, size and SHA-256 before running. Read [the data model](data-model.md) and [the IPC contract](contracts/handoff.md) for fields and states.

## Backend proof

1. List profiles. Every class of PixInsight/WBPP, Siril and SETI Astro Suite Pro shows its state and evidence, and no class reads verified without a cited reference. Locate the script as a generic Open in... application with `{viewFolder}`. It reads not verified, Linked and Direct source read refused with the input-write risk named, and Copy or Clone is offered. Nothing is launched (PREP-FR-01, PREP-FR-02, PREP-AC-07, PREP-AC-11).
2. In the core tests, inject a manifest whose Siril entry records read-only input, file-list input and folder rules with test evidence, and locate the script as Siril. Save settings with mode Linked and parent `Work/Processing`. Review shows `Work/Processing/NGC7000-HOO-Siril`, its `output/` subfolder, 208 light entries, symlink and its limits, the footprint and free space, the saved criteria and the accepted calibration (PREP-AC-01, PREP-FR-07, PREP-FR-08).
3. Choose Direct source with the folder rule only. The 30 Sep folder handoff is refused because it holds six excluded frames, and file-list Direct source, Copy and Clone are offered (PREP-AC-04, PREP-FR-05).
4. Choose hardlinks for an item whose chosen copy lies on `Other`. It is blocked as hardlink-ineligible and is not copied. A same-volume hardlink needs the explicit choice, and its limits are named (PREP-AC-08, PREP-FR-04).
5. Choose parent `Scratch/Processing` with the name `NGC7000-HOO-Siril`. Review asks for another name or location, and `keep.txt` and its folder hash unchanged (PREP-AC-02). Detach `Scratch`: review reads the parent unavailable and suggests no other drive (PREP-AC-09, PREP-FR-06).
6. Reattach `Scratch` and review Linked View there. Linking reads unsupported; Copy and Direct source are offered with footprints, and Clone reads unsupported. Nothing exists on `Scratch` beyond `keep.txt` (PREP-AC-03).
7. Take one copy's location offline and review again. That member reads unresolved and blocked, membership and criteria need confirmation, and quality decisions are unchanged (PREP-AC-13). Restore it and confirm the review.
8. Prepare. The start reads Running, then Prepared only after 208 entries match the membership; Open and Reveal are offered. The hash manifest is unchanged and no quality state changed (PREP-FR-09, PREP-FR-10).
9. Create the standalone View `28 Sep Ha copy check` with 56 frames. Choose Copy with patched copies for the focal length, and the output parent `Work/Outputs`. Review shows a full-copy footprint, the catalog and header values side by side and the output `Work/Outputs/28 Sep Ha copy check/` (PREP-FR-03, PREP-FR-07).
10. Confirm, remove read permission from three sources and Prepare. The outcome is Partial with 53 prepared and 3 blocked, each named with its path; Open is refused (PREP-AC-05). Restore permission and Retry. The View reads Prepared with 56 entries, only the copies carry the patched focal length and the originals hash unchanged (PREP-AC-06).
11. Repeat step 10 with Pause and then Cancel during Running. Each takes effect at an item boundary and keeps every journaled item; Retry completes the revision. Interrupt the process during Prepare and reopen: the operation reads Paused with uncertain items, and Retry reconciles them by recorded identity and digest.
12. Move the script and Open. The launch reads executable missing and offers Choose application and Reveal View, and the preparation stays Prepared. Restore it and Open: the script records its argv, exits, and the preparation and View are unchanged and not Complete (PREP-AC-10). Change one byte of a fixture source and Open the Linked revision: the launch is blocked and names the drift.
13. Accept a refresh in 066 that adds a session and review again. A new preparation revision in a new folder is proposed, and revision 1 and its entries are unchanged. After revision 2 reads Prepared, revision 1 reads superseded (PREP-AC-12, PREP-FR-11).
14. Review Retire location for `Other`. The review names the preparation, and changing the preparation afterward refuses confirmation.
15. Close and reopen the catalog: every committed record returns. Force SQLITE_FULL on a PREP write through the catalog unit test and observe PersistenceFailure with nothing persisted. Compare the original manifest and hashes exactly (PV-PREP-SC-03).

Run the focused catalog and core PREP tests, then `cargo test --workspace`, `just db-boundary` and `bash scripts/check-dev-surface-absent.sh` after integration. These checks do not certify the UI or other platforms.

## Real development application

Launch `cargo run -p desktop_shell --features dev-tools --bin platevault-library` with a fresh `PV_LIBRARY_DATA_DIR`. Leave `PV_MCP_BRIDGE_BIND` unset so the bridge binds `127.0.0.1`. Through Tauri MCP `ipc_execute_command`, repeat steps 1 and 3 to 13 with the `prep_*` commands and the bundled manifest, and confirm the committed state after restart. Steps that need verified Linked or Direct-source evidence run only for a profile the qualification task verified; otherwise the refusal path is the observed result and the gap is reported. The Mark processing complete refusal of J24 S15 is verified with 070, and removal of replaced entries with 071. The preparation surface and J23 S8 to S11 and J24 S1 to S16 stay pending on the final clean-slate frontend and fresh journey validation.

Any untested profile, platform or fixture stays an explicit acceptance gap. After five failed fixes, an issue gets a reproducible backlog entry; this guide is never weakened to pass.
