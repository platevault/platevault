//! `schema-agreement-test` — CI-only binary that fails if a committed
//! `.generated.json` schema has drifted from what `schemars::schema_for!()` now
//! produces from the Rust types.
//!
//! Run: `cargo run -p contracts_core --bin schema-agreement-test`
//!
//! The test mirrors how `generate-contracts` works: it serialises the schema
//! from the live Rust types, then byte-compares with the committed file.  Any
//! structural change in the Rust type that affects the JSON-Schema output will
//! cause this to fail, prompting the developer to regenerate and review.
//!
//! This is the JSON-Schema↔Rust snapshot drift guard.  The committed
//! `.generated.json` files (draft-2020-12 since spec 042 T116a upgraded
//! schemars to 1.x) are the snapshot; when intentional changes are made, run
//! `generate-contracts` to update them, review the diff, and commit both.
//!
//! The complementary FR-005/SC-004 **specta↔schemars** agreement test (T116)
//! lives in `tests/contract/envelope_specta_schemars_agreement.rs`.

use std::path::PathBuf;
use std::process;

use schemars::{schema_for, JsonSchema};

fn project_root() -> PathBuf {
    let manifest =
        std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR must be set by cargo");
    PathBuf::from(manifest)
        .ancestors()
        .nth(3)
        .expect("workspace root must be 3 levels above crate manifest")
        .to_path_buf()
}

fn check_schema<T: JsonSchema>(root: &std::path::Path, spec_dir: &str, name: &str) -> bool {
    let schema = schema_for!(T);
    let generated = serde_json::to_string_pretty(&schema)
        .unwrap_or_else(|e| panic!("failed to serialise schema for {name}: {e}"));
    let generated = format!("{generated}\n");

    let committed_path = root.join("specs").join(spec_dir).join("contracts").join(name);

    let committed = match std::fs::read_to_string(&committed_path) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("MISSING  {}: {e}", committed_path.display());
            return false;
        }
    };

    if generated == committed {
        println!("OK       {}", committed_path.display());
        true
    } else {
        eprintln!("DRIFT    {}", committed_path.display());
        eprintln!(
            "  Committed and generated schemas differ. Run:\n  \
             cargo run -p contracts_core --bin generate-contracts\n  \
             then review the diff and commit both the type change and the updated snapshot."
        );
        false
    }
}

fn main() {
    let root = project_root();
    println!("schema-agreement-test (T116) — workspace root: {}", root.display());
    println!();

    let mut all_ok = true;

    // ── spec 002 ──────────────────────────────────────────────────────────────
    println!("spec 002 — data lifecycle state model");

    if !check_schema::<contracts_core::lifecycle::TransitionRequest>(
        &root,
        "002-data-lifecycle-state-model",
        "lifecycle.transition.generated.json",
    ) {
        all_ok = false;
    }

    if !check_schema::<contracts_core::provenance::ProvenanceReadRequest>(
        &root,
        "002-data-lifecycle-state-model",
        "provenance.read.generated.json",
    ) {
        all_ok = false;
    }

    println!();
    if all_ok {
        println!("All schema snapshots match — no drift detected.");
    } else {
        eprintln!("Schema drift detected. See messages above.");
        process::exit(1);
    }
}
