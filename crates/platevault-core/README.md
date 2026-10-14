# PlateVault core

The library core composes read-only inventory, deterministic capture grouping, offline target search and the SIMBAD adapter. Canonical records live in `platevault_model`; `persistence_library` owns all SQL and durable corrections. Native path payloads define identity. Observations, availability and decision revisions stay separate. Reviewed quality binds a content digest to its fingerprint; IPC nanosecond timestamps are decimal strings.

Format metadata adapts the existing read-only `metadata_core`, FITS and XISF extractor contracts. Fixture tests create real small images, decode their headers and compare before/after source hashes. Run `cargo test -p platevault_core --test model` and `cargo clippy -p platevault_core --all-targets -- -D warnings`.

New-capture discovery (`new_captures::CaptureWatch`) walks and live-watches every online Captures location and counts, per location, the supported frames the catalog does not hold yet. It reads no header and writes nothing; a finished scan recounts. The library shell serves the counts as the `library_new_captures` query and event (`contracts_core::captures`).

The isolated `platevault-library` Tauri binary registers the real library commands without legacy jobs. Its debug-only MCP bridge binds loopback; development runtime scenarios exercise committed decisions, restart, interrupted scans and byte-verified remap. Native XISF geometry adoption and final integrated acceptance remain pending. Final UI criteria require the clean-slate frontend and fresh journey validation.
