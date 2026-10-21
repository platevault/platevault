# astro-plan-upd82 evidence

- Branch: `fix/f4-r2-refusal-cache`
- Base: `17743e902`
- `cargo test -p platevault_core correction_entry_refusal_cache_evicts_older_previews` (with `CARGO_BUILD_JOBS=4`): passed; 1 test.
- `cargo test -p platevault_core correction_entry` (with `CARGO_BUILD_JOBS=4`): passed; 3 correction-entry tests.
- `cargo test -p platevault_core patched_copy` (with `CARGO_BUILD_JOBS=4`): passed; 14 tests.
- `cargo test -p platevault_core --test project_apply` (with `CARGO_BUILD_JOBS=4`): passed; 35 tests.
- `cargo clippy -p platevault_core -- -D warnings` (with `CARGO_BUILD_JOBS=4`): passed after replacing contains-then-insert with HashMap::entry.
- `cargo fmt --check -- crates/platevault-core/src/library.rs`: passed.
- Fail-first evidence: the initial regression test failed with 32 cached entries instead of 1 before implementation.
- Changed: `crates/platevault-core/src/library.rs`, `CHANGELOG.md`.
- Diagnosis: `diagnosis-astro-plan-upd82.md`.
