# Calibration inputs acceptance guide

## Inputs

Use a fresh disposable catalog and generated FITS and XISF files, never a real library. The [library acceptance guide](../064-library-inventory/quickstart.md) describes the fixture writers. Build this worked subset, all from RedCat 51 / ASI2600MM: gain 100, offset 50, binning 1, 6248 × 4176, setpoint −10 °C.

- `Astro-T7/Captures`: 300 s lights of 18 Sep Ha, 28 Sep Ha and 24 Sep OIII, with TELESCOP and FOCALLEN.
- `Astro-T7/Calibration`, with an existing `masters/` folder, holding:
  - raw darks at 300 s and −10 °C;
  - raw darks at 120 s;
  - raw Ha flats with TELESCOP and FOCALLEN;
  - 26 Sep raw OIII flats without TELESCOP, FOCALLEN or a Confirmed Equipment association;
  - a PixInsight XISF with `IMAGETYP = 'Master Dark'`.
- A Results location `Work/Processing` holding `NGC7000-HOO-Siril/output/master_flat_Ha.fit` with `IMAGETYP = 'Flat'` and `STACKCNT = 30`, plus `masterFlat_OIII.fit` with no stack count (name only).
- Saved equipment RedCat 51 / ASI2600MM, Confirmed on the three light Sessions. Its telescope and focal length equal the flats' TELESCOP and FOCALLEN.

Record every path, size and SHA-256 before running. Read [the data model](data-model.md) and [the IPC contract](contracts/calibration.md) for fields and states.

## Backend proof

1. Index the three locations and list inputs. Raw darks and flats group by kind, camera, settings, channel and geometry. The 26 Sep flats list missing optical-train evidence. Both masters list as candidates with their evidence basis and origin. None reads reusable (CAL-FR-01, CAL-FR-06).
2. Save the View `NGC7000 HOO - Siril` with the three light Sessions through VSEL and read its plan. The required kinds are dark and flat. These are preselected and read suggested: the 300 s darks for all three Sessions, and the Ha flats for 18 and 28 Sep. No candidate master is preselected (CAL-AC-01, CAL-AC-04).
3. Open Why this match on an Ha flat suggestion. It lists each criterion with values, sources and tolerance `none`; measured temperature and readout are evidence only. The 120 s darks read exposure incompatible (CAL-FR-03).
4. Read the handoff before accepting. `ready` is false. Every suggested requirement reads `suggestion_unaccepted`, and 24 Sep flat reads `criterion_unknown` because the 26 Sep flats' optical train is unknown (CAL-AC-02, CAL-AC-06).
5. Accept the five suggestions. Each input file is hashed and its basis recorded. The requirements read accepted, Why this match stays available, and the Ha flat assignment reads form `raw_set` (CAL-FR-02, CAL-FR-04, CAL-FR-08).
6. Accept the 26 Sep flats for 24 Sep. The request is refused with InvalidInput naming `optical_train`. Record an exception instead, with reason `Same rotation as 26 Sep; train not changed`. The handoff now reads ready, and the exception carries the unknown criterion and the reason. The flat Session's evidence and corrections are unchanged (CAL-FR-05, CAL-AC-03).
7. Save a standalone View from 24 Sep only. Its plan shows the 26 Sep flats unknown, with no exception (CAL-AC-03).
8. Change one raw dark's bytes, then accept darks on the standalone View. The request is refused, naming that file's drift, and nothing is recorded. In the first View, exclude one 28 Sep frame through VSEL and save. The 18 Sep and 24 Sep decisions still apply, and 28 Sep reads `light_membership_changed`.
9. Review adoption of `master_flat_Ha.fit` into `Astro-T7/Calibration/masters/`. The review records the source SHA-256 and writes no file. Confirm it. The operation reaches `registered`, and the destination re-read digest equals the source. The master lists with origin and provenance, and the source stays in place (CAL-AC-05, CAL-AC-07, CAL-FR-07).
10. Save `28 Sep Ha copy check` from 28 Sep. The adopted master lists as a compatible candidate awaiting acceptance, beside the raw Ha flats, with the preselection following the R10 order. The handoff names no input until one is accepted (CAL-AC-05).
11. Exercise the failures. Each one leaves the candidate listed, registers nothing and leaves other files unchanged (CAL-AC-07):
    - Review into a path that already exists: IdentityConflict.
    - Change the source after review, then confirm: `failed` with last phase `temp_created`, and the temporary file removed.
    - Corrupt the copy through the test hook, then confirm: `failed` with last phase `installed`, with the installed copy named and not registered.
    - Take the Calibration location offline, then review: refused.
12. Interrupt an adoption after `installed` through the test hook, then reopen the catalog. It reads `interrupted`. Retrying the same review resumes by recorded identity and registers once.
13. Read custody facts for the first View. The Ha candidate's source and the adopted master are listed with fingerprints (CAL-FR-06, CAL-FR-07). Review Retire location for `Work/Processing`: it names the adopted master. Review Retire location for `Astro-T7/Calibration`: it names `NGC7000 HOO - Siril`. Withdraw one decision on that View, and confirmation is refused until a new review.
14. Close and reopen the catalog. Every plan, decision, review, operation and master returns unchanged. Force SQLITE_FULL on an accept through the catalog unit test. It returns PersistenceFailure and persists nothing.
15. Compare the manifest. Only the adopted copy and the deliberate step 8 and step 11 changes differ (PV-CAL-SC-03).

Run the focused rules, catalog and core calibration tests. After integration, run `cargo test --workspace`, `just db-boundary` and `bash scripts/check-dev-surface-absent.sh`. These checks do not certify the UI or other platforms.

## Real development application

Launch `cargo run -p desktop_shell --features dev-tools --bin platevault-library` with a fresh `PV_LIBRARY_DATA_DIR`. Leave `PV_MCP_BRIDGE_BIND` unset so the bridge binds `127.0.0.1`. Through Tauri MCP `ipc_execute_command`, repeat steps 1 to 10 and 13 with the `calibration_*`, `library_*` and VSEL `view_*` commands. Confirm the committed state after restart. The Calibration surface, J23 S1 to S7 and J26 S8 to S9 stay pending on the final clean-slate frontend and fresh journey validation. RES output sources and STO custody consumption are verified with 070 and 071.

Any untested profile, platform or fixture stays an explicit acceptance gap. After five failed fixes, an issue gets a reproducible backlog entry; this guide is never weakened to pass.
