# PlateVault core

Shared library records retain native paths and original header evidence. Catalog corrections, decision revisions, observations and availability stay separate. Quality applies only to the fingerprint reviewed. `NativePath` JSON carries encoding, payload and derived display. Identity uses the payload.

Format metadata adapts the existing read-only `metadata_core`, FITS and XISF extractor contracts. Fixture tests create real small images, decode their headers and compare before/after source hashes. Run `cargo test -p platevault_core --test model` and `cargo clippy -p platevault_core --all-targets -- -D warnings`.

This module provides shared types for the active 064 implementation. Inventory, catalog, target provider and application integration are still pending. Full acceptance requires restart/custody scenarios and real development Tauri MCP. Final UI criteria require validation of the clean-slate frontend.
