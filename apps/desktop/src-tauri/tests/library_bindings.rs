// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! The library-shell bindings agree with the registered command list.
//!
//! `apps/desktop/src/bindings/library-index.ts` is generated from
//! `desktop_shell::library_shell::library_specta_builder()`, the same
//! `library_commands!` list `run` registers, and committed. This test exports
//! it again and fails on any difference from the committed file, which leaves
//! the committed file untouched, so `just check-generated` rejects drift
//! instead of repairing it. With `PV_LIBRARY_BINDINGS=write` it writes the
//! export over the committed file instead (`just library-bindings`); review
//! that diff and commit it. It stays separate from the legacy `index.ts`
//! (`tests/bindings.rs`).
//!
//! Like `index.ts`, the file carries no SPDX header: the exporter never emits
//! one, and adding one by hand makes this test fail.

use specta_typescript::Typescript;

/// Set to `write` to regenerate the committed bindings rather than check them.
const MODE_ENV: &str = "PV_LIBRARY_BINDINGS";

#[test]
fn library_bindings_match_the_committed_file() {
    let committed_path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("src")
        .join("bindings")
        .join("library-index.ts");
    let scratch = tempfile::tempdir().expect("scratch directory");
    let export_path = scratch.path().join("library-index.ts");

    desktop_shell::library_shell::library_specta_builder()
        .export(Typescript::default(), &export_path)
        .expect("export the library-shell bindings");

    let exported = std::fs::read_to_string(&export_path).expect("read the export");
    match std::env::var_os(MODE_ENV) {
        None => {
            let committed = std::fs::read_to_string(&committed_path).unwrap_or_default();
            let first_difference = exported
                .lines()
                .zip(committed.lines())
                .position(|(exported, committed)| exported != committed)
                .unwrap_or_else(|| exported.lines().count().min(committed.lines().count()));
            assert!(
                exported == committed,
                "{} differs from the library-shell command list from line {}; regenerate it \
                 with `just library-bindings`, then review and commit the diff",
                committed_path.display(),
                first_difference + 1
            );
        }
        Some(mode) if mode == "write" => {
            std::fs::write(&committed_path, &exported).expect("write the regenerated bindings");
        }
        Some(other) => panic!("{MODE_ENV}={other:?}: the only mode is `write`"),
    }
}
