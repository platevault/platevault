# Results, reuse and completion acceptance guide

## Inputs

Use a fresh disposable catalog and generated files, never a real library. The [library acceptance guide](../064-library-inventory/quickstart.md) describes the FITS and XISF fixture writers, and the [Project guide](../065-project-goals/quickstart.md) builds the NGC 7000 subset. Build on it:

- Project `NGC 7000 HOO` framing saved Target NGC 7000, and its View `NGC7000 HOO - Siril` with the confirmed 208-light membership, prepared through PREP. Its recorded output location is `NGC7000-HOO-Siril/output/`.
- In `output/`: calibrated and registered intermediates under the paths that the profile's recognized-output rules name, an Ha linear stack (FITS, `STACKCNT` 111), an OIII linear stack (XISF, `STACKCNT` 97), a generated master flat, a log and one unknown file. A helper thread appends to one more file during discovery.
- `Work/Finals/NGC7000-HOO.tif` and `Work/Finals/NGC7000-HOO-crop.tif` outside the View.
- A standalone Prepared View `28 Sep Ha copy check` with no Result, and an unrelated third View.
- Profile records from PREP: one with unknown `productInput` and `recognizedOutput` capability, and one whose recorded evidence lists the two linear kinds and the intermediate rules. Use PREP's qualified profile record when it exists; otherwise label the second a disposable fixture record. It proves the supported branch and claims nothing about a real application.

Record every path, size and SHA-256, including every file in `output/`, before running. Read [the data model](data-model.md) and [the IPC contract](contracts/results.md) for fields and states.

## Backend proof

1. Run `results_discover` for `NGC7000 HOO - Siril` with a short settle window. Intermediates are listed apart from candidates, the stacks are unaccepted candidates, and the appended file reads Pending. Every Result reads lineage `unknown`, and no field claims the 208 frames were used (RES-AC-01, RES-FR-01, J26/S1).
2. Repeat discovery with the unknown-capability profile. Every file is a candidate and none is hidden.
3. Accept the Pending file: Conflict, and nothing is written.
4. Attach the TIFF as `final_image` to the View. Its association reads `user_linked` and its lineage `unknown` (RES-AC-02, RES-FR-02, RES-FR-03, J26/S2).
5. Accept the Ha stack, the OIII stack and the TIFF. Each reads Keep, and association and lineage are unchanged. `results_accepted` returns them for the View, for the Project and for Target NGC 7000 with their bases, and `project_detail.acceptedProducts` lists them. Target coverage and Project progress equal their values before step 1 (RES-AC-03, RES-FR-04, J26/S3).
6. Read `results_picker`, grouped by originating View. Run `results_create_view` for `NGC7000 HOO combine` with the Ha and OIII acceptances. The new View lists two product inputs naming `NGC7000 HOO - Siril`, has no session and counts zero frames (RES-AC-04, RES-FR-05, J26/S4).
7. Read `results_product_support` and PREP review with the unknown-capability profile. Both name each product input as unsupported, and prepare is refused with nothing converted. With the second profile both entries are listed with paths and no calibration item (RES-AC-05, J26/S5).
8. Overwrite the OIII stack outside PlateVault. `results_view_inputs` reads it `drifted`, a product assignment and PREP prepare refuse it with the drift named, and nothing replaces it (J26/S7).
9. Mark `28 Sep Ha copy check` complete. It reads Complete with no Result; every file and its hash is unchanged, and no cleanup operation exists (RES-AC-06, RES-FR-06, J27/S1).
10. Start a PREP preparation for the third View and mark it complete while Running: Conflict naming that preparation. Mark `NGC7000 HOO - Siril` complete at the same time: it succeeds (RES-AC-07, J24/S15).
11. On the Complete `NGC7000 HOO - Siril`, request a VSEL exclusion, a new preparation and `results_update_view_inputs`: each is Conflict until `results_reopen`. Edit its notes, attach and accept the crop TIFF, and apply a verified LIB remap of a member location: each succeeds, the View stays Complete and its membership revision and asset IDs are unchanged (RES-AC-08, RES-FR-07, J27/S2, J27/S3).
12. Close and reopen the catalog. Every Result, decision, product input and completion row returns unchanged. Force SQLITE_FULL on a RES write through the catalog unit test and observe PersistenceFailure with nothing persisted.
13. Compare the original manifest and hashes exactly; the overwritten OIII stack is the only change, made by the test itself.

Run the focused catalog and core RES tests, then `cargo test --workspace`, `just db-boundary` and `bash scripts/check-dev-surface-absent.sh` after integration. These checks do not certify the UI or other platforms. The storage-mutation blocker, cleanup Keep and cleanup or reference repair without reopen are verified with 071.

## Real development application

Launch `cargo run -p desktop_shell --features dev-tools --bin platevault-library` with a fresh `PV_LIBRARY_DATA_DIR`. Leave `PV_MCP_BRIDGE_BIND` unset so the bridge binds `127.0.0.1`. Through Tauri MCP `ipc_execute_command`, repeat steps 1 to 11 with the `results_*` commands, then confirm the committed state after restart. The Results surface, J26/S1 to S7, J27/S1 to S3 and J24/S15 stay pending on the final clean-slate frontend and fresh journey validation.

Any untested profile, platform or fixture stays an explicit acceptance gap. After five failed fixes, an issue gets a reproducible backlog entry; this guide is never weakened to pass.
