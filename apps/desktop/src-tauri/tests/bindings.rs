//! Regenerate the TypeScript bindings on every `cargo test`.
//!
//! The bindings file lives at `apps/desktop/src/bindings/index.ts` and is
//! committed to the tree. CI is expected to run this test then
//! `git diff --exit-code apps/desktop/src/bindings/` to catch unsynced
//! changes to the typed command surface (spec 002 plan, research.md §9.5).
//!
//! Failure modes:
//! - `Builder::export` errors: a derived `Type` for a contract DTO is broken
//!   (most often a generic bound or a missing `#[specta(rename_all = ...)]`
//!   matching the serde rename).
//! - `git diff` shows changes: regenerate by running this test locally and
//!   commit the resulting file.

use specta_typescript::Typescript;

#[test]
fn exports_typescript_bindings() {
    let out_path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("src")
        .join("bindings")
        .join("index.ts");

    if let Some(parent) = out_path.parent() {
        std::fs::create_dir_all(parent).expect("create bindings directory");
    }

    desktop_shell::specta_builder()
        .export(Typescript::default(), &out_path)
        .expect("export typescript bindings");

    let written = std::fs::read_to_string(&out_path).expect("read written bindings");
    assert!(written.contains("provenanceRead"), "binding contains provenance_read command");
    assert!(
        written.contains("lifecycleTransitionApply"),
        "binding contains lifecycle_transition_apply command"
    );
    assert!(
        written.contains("lifecycleLedgerList"),
        "binding contains lifecycle_ledger_list command"
    );
}
