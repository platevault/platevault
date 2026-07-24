## Summary

- `sessions::SessionKey(String)` newtype replaces the four-positional-`&str` free fns `session_key`/`parse_session_key`; positional-same-type swap hazard eliminated at the type level. `SessionKey::new` (write) + `SessionKey::parse` (read) are the new API. 8 call sites migrated across 6 crates.
- `app/inbox/grouping/engine.rs`: private `optic_train` fn deleted; `Dimension::OpticTrain` now routes through `sessions::optic_train_key` (the canonical implementation). FR-019 silent-drift risk closed.
- `calibration_core::SessionInfo::is_mixed()` predicate method extracted; the two duplicated `session_type == "mixed"` string guards in `suggest()` and `evaluate_assign()` replaced with method calls.

## Coordination note (DS-18 / kyo7.87)

kyo7.87 (unclaimed at branch time) owns DS-18: "parse session_key once in project_row_to_session, thread fields". That work touches `ingest_sessions.rs:derive_session_key`, which this branch also touched (migrated `session_key()` → `SessionKey::new()`). The newtype API surface is stable — DS-18's rebase will be mechanical (`SessionKey::new(...)` call unchanged, only the surrounding plumbing moves).

## Test plan

- [ ] `cargo test -p sessions` — 48 pass
- [ ] `cargo test -p calibration_core` — 91 pass
- [ ] `cargo test -p app_core_inbox` — 243 pass
- [ ] `cargo test -p app_core_targets` — 117 pass
- [ ] `cargo test -p app_core_projects` — 92 pass
- [ ] `cargo clippy -p sessions -p calibration_core -p app_core_inbox -p app_core_targets -p app_core_projects -- -D warnings` — 0 warnings
- [ ] `cargo fmt --check` on all 5 crates — clean

🤖 Generated with Claude Code
