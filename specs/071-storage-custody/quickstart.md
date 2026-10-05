# Storage custody acceptance guide

## Inputs

Use a fresh disposable catalog, generated FITS and XISF frames and disposable volumes, never a real library. The [library acceptance guide](../064-library-inventory/quickstart.md) describes the fixture writers. Create Views, preparations, Results and masters through the real 066, 068, 069 and 070 operations. Build this worked subset:

- Five RedCat sessions of NGC 7000 on `Astro-T7/Captures`, and Complete View `NGC7000 HOO - Siril` with 208 hardlink entries under `Work/Processing/NGC7000-HOO-Siril`. Its output holds calibrated and registered intermediates, temporary files, a log, the manifest and one unrecognized file. It also holds accepted Ha and OIII stacks, the OIII stack used by View `NGC7000 HOO combine`, and a generated master adopted into Calibration.
- One prepared symbolic link entry and one prepared copy entry, and a Direct-source View with outputs.
- View `28 Sep Ha copy check`, Prepared on `Scratch`, a volume whose Trash probe reports unsupported.
- One 30 Sep capture unlinked from its source folder, so its hardlink entry holds the last copy.
- A View with a replaced preparation revision that is not Complete.
- Disk image `Archive` registered as a Captures location, a second image mounted under the same name, and `Astro-T7/Library` registered as a Captures location.

Record every path, size and SHA-256 before running, and record the isolated account's Trash contents without deleting anything. Read [the data model](data-model.md) and [the IPC contract](contracts/storage.md) for fields and states.

## Backend proof

1. Preview cleanup of `NGC7000 HOO - Siril`. Intermediates and temporary files are preselected. Prepared entries, the log, the manifest and the unknown file are unselected, and Keep holds both stacks and the master source. No original appears in any group (STO-AC-01, STO-FR-01, STO-FR-03).
2. Preview the Direct-source View. No original sub appears in any group (STO-AC-02).
3. Read each file's path, role, references, retained-original evidence, size and reclaim class. Hardlink sizes read `shared_link`, never expected reclaim (STO-FR-02).
4. Select the accepted OIII stack and review. The review names the product and `NGC7000 HOO combine`. Deselect it (STO-FR-01).
5. Review cleanup with every intermediate and all prepared inputs. The 30 Sep hardlink is blocked for insufficient proof; the other 207 entries show a verified original. `Work` shows movable and blocked counts (STO-AC-04, STO-FR-04).
6. Confirm. Per-item outcomes and a partial summary name the blocked entry. Trashed items appear in the isolated account's Trash. The symbolic link target stays byte-identical and no directory is followed. `storage_view_custody` lists removed and remaining entries, and the View still reads Complete with unchanged membership (STO-AC-08, STO-AC-09, STO-FR-05).
7. Review and confirm cleanup of `28 Sep Ha copy check`. Every item reads refused with `keep_files` and `reveal_location`, and zero files leave `Scratch` (STO-AC-03).
8. Preview the not-Complete View with scope `replaced_entries`. Only superseded entries are listed, and the proof, protection, no-follow and Trash rules apply (STO-AC-11, STO-FR-10).
9. Open the Storage overview. Locations, availability, View footprints, duplicate groups and transfers appear separately, and no duplicate offers removal (STO-AC-12, STO-FR-11).
10. Review an archive of the five sessions to `Archive/NGC7000` with the impostor mounted. The review blocks with IdentityConflict. Remount the real image: identity, free space and writability read correct. The hardlink reference requires a mode choice; choose `symlink` (STO-AC-10, STO-FR-06).
11. Make one 24 Sep entry folder unwritable, start the transfer and detach `Archive` during copying. Every item shows its phase. No source whose destination or references are unverified is retired, and those sources match the manifest (STO-AC-05, STO-FR-08).
12. Reattach and retry. Retry revalidates the volume, snapshots and recorded destination identities, and a partial file is not taken as verified. The 24 Sep reference reads blocked and its source stays (STO-AC-10, STO-FR-07).
13. Change one destination file's bytes before its re-read in a separate run. The item holds at `hash_mismatch` and its source stays (STO-AC-05).
14. Restore the folder's permission and retry. The reference repairs and verifies, then the source is retired. Expected and observed reclaim read separately (STO-FR-07).
15. Detach `Archive` and read the session, coverage and View. Totals and membership are unchanged and archived inputs read Offline. Prepare refusal is verified with 069 (STO-AC-07).
16. Review filing of 26 Sep and 30 Sep into `Astro-T7/Library`. Every source and destination path keeps its basename and the files read already indexed. Create a file at one 26 Sep destination: that item is blocked and the start is refused. The file stays byte-identical (STO-AC-13, STO-AC-06, STO-FR-12).
17. Remove 26 Sep, review and start. The 48 files reach the previewed paths with their hashes, 30 Sep stays one session and the View membership is unchanged (STO-FR-09).
18. File 24 Sep to `Archive/Library` and detach during the transfer. The sources stay at their original paths (STO-FR-09, STO-FR-07).
19. Close and reopen the catalog during a transfer. The operation reads interrupted, in-flight items read uncertain, and claimed paths are absent from a rescan. Force SQLITE_FULL through the catalog unit test and observe PersistenceFailure with nothing persisted.
20. Compare every original manifest and hash exactly (PV-STO-SC-03).

Run the focused catalog, filesystem, policy and storage tests, then `cargo test --workspace`, `just db-boundary` and `bash scripts/check-dev-surface-absent.sh` after integration. Tests that move files into a real OS Trash run only in an isolated account or disposable VM. These checks do not certify the UI or other platforms.

## Real development application

Launch `cargo run -p desktop_shell --features dev-tools --bin platevault-library` with a fresh `PV_LIBRARY_DATA_DIR`. Leave `PV_MCP_BRIDGE_BIND` unset so the bridge binds `127.0.0.1`. Through Tauri MCP `ipc_execute_command`, repeat steps 1 to 18 with the `storage_*` commands and confirm the committed state after restart. The Cleanup, Archive, Filing and Storage surfaces, J27, J28 and J30 stay pending on the final clean-slate frontend and fresh journey validation.

Windows Recycle Bin and Linux Trash qualification, and any untested profile, platform or fixture, stay explicit acceptance gaps. After five failed fixes, an issue gets a reproducible backlog entry; this guide is never weakened to pass.
