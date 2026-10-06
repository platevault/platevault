# Library acceptance guide

## Inputs

Use disposable capture/calibration folders and a fresh catalog. Generate valid FITS and XISF images with Ha/OIII lights, separate cameras/exposures/gain/offset/binning/readout/dimensions, missing OBJECT/coordinates and malformed headers. Record paths, sizes and SHA-256 before running. Include a denied subtree and a source that can be taken offline; no real libraries.

## Backend proof

1. Register multiple Captures locations and optional Calibration; leave Results unset. No file changes or scan starts occur during registration.
2. Index through the core API. Observe progressive sessions and counts; unknown or malformed evidence remains explicit. Separate channels/equipment/settings remain separate sessions.
3. Deny a subtree or take a location offline, then rescan. Complete siblings reconcile, while unreadable/offline members keep last-observed metadata and are never treated as absence.
4. Apply a catalog filter/Target/equipment correction and explicit quality action. Source hashes remain unchanged; grouping revisions and association provenance remain inspectable.
5. Attempt stale per-record revisions during indexing and force SQLITE_FULL with `max_page_count` on the disposable catalog. Verify atomic Conflict/PersistenceFailure rather than saved success. Assert WAL/FULL and macOS fullfsync settings on the actual writer connection.
6. Close and reopen the same file-backed catalog. Committed user decisions and identities persist; interrupted scans remain incomplete.
7. Search the bundled local catalog without networking, resolve a provider candidate when available, and observe an explicit provider failure without losing local functionality.
8. Review remap with differing same-name content, an offline original without prior digest, and a root replaced by a readable empty directory. Refuse missing/mismatched proof and leave every original location/path and decision unchanged; zero files become Missing. Verify equivalent all-asset remap atomically preserves IDs.
9. Compare original inventories and hashes exactly.

Run the focused core integration tests after implementation, followed by `cargo test --workspace` after integrating the active feature's independent work. These commands do not certify UI or other platforms by themselves.

## Real development application

Launch the rebuilt desktop with `--features dev-tools`, `src-tauri/tauri.dev.conf.json` and `PV_MCP_BRIDGE_ENABLE=1`. Bind only to loopback. Use Tauri MCP to register inputs, index, inspect sessions/Targets, navigate Settings/Activity, record corrections and restart. Observe both actual IPC state and real webview results. Validate J19 through a fresh journey-validator context; authoring is not validation. Verify release builds exclude the development bridge.

Any profile, platform or numerical method not yet exercised remains an explicit acceptance gap. Five failed fixes per issue lead to reproducible backlog deferral, never weakening this guide or fabricating a successful result.
