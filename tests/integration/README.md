# Integration Test Layout

Integration tests prove user-story flows across crates and contract boundaries.

Planned files:

```text
integration/
├── us1_index_existing_library.rs
├── us2_metadata_extraction.rs
├── us2_session_ingest.rs
├── us2_calibration_matching.rs
├── us3_project_mapping.rs
├── us4_source_views.rs
├── us5_cleanup_policy.rs
├── us6_rules_root_recovery.rs
├── us7_target_history.rs
└── performance_inventory_scan.rs
```

Rules:

- Tests use temporary directories for any filesystem writes.
- Tests must distinguish read-only scan operations from plan-generating and
  plan-applying operations.
- No integration test may perform permanent deletion outside a temporary test
  root.
- Large-file hashing tests must prove disabled/lazy behavior by default.
- User-story tests should remain independently runnable.
