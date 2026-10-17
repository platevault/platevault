// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! The library-shell bindings agree with the registered command list.
//!
//! `apps/desktop/src/bindings/library-index.ts` is generated from
//! `desktop_shell::library_shell::library_specta_builder()`, the same
//! `library_commands!` list `run` registers, and committed. This test exports
//! it again and fails on any difference from the committed file. On a
//! difference it also writes the export over the committed file, so the fix is
//! to review that diff and commit it. It stays separate from the legacy
//! `index.ts` (`tests/bindings.rs`).
//!
//! Like `index.ts`, the file carries no SPDX header: the exporter never emits
//! one, and adding one by hand makes this test fail.

use specta_typescript::Typescript;

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
    let committed = std::fs::read_to_string(&committed_path).unwrap_or_default();
    if exported != committed {
        std::fs::write(&committed_path, &exported).expect("write the regenerated bindings");
        panic!(
            "{} differs from the library-shell command list; it was regenerated: review and commit it",
            committed_path.display()
        );
    }
}
