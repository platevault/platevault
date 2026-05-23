//! `generate-contracts` — regenerate JSON Schemas from canonical Rust DTOs.
//!
//! Usage: `cargo run -p contracts_core --bin generate-contracts`
//!
//! Each Rust type is source-of-truth. The generated JSON is written to
//! `specs/<NNN>/contracts/<name>.json`. After generation, diff against the
//! committed JSON; committed JSON is updated only when the drift is intentional.
//!
//! Currently covers spec 002's two contracts:
//! - `lifecycle.transition.json` — `TransitionRequest` / `TransitionResponse`
//! - `provenance.read.json`      — `ProvenanceReadRequest` / `ProvenanceReadResponse`
//!
//! Other specs' contracts will be wired here as their Rust DTOs land.

use std::fs;
use std::path::{Path, PathBuf};

use schemars::{schema_for, JsonSchema};

fn project_root() -> PathBuf {
    // Walk up from the binary's manifest dir to the workspace root.
    // CARGO_MANIFEST_DIR = crates/contracts/core; go up 3 levels.
    let manifest = std::env::var("CARGO_MANIFEST_DIR")
        .expect("CARGO_MANIFEST_DIR must be set by cargo");
    PathBuf::from(manifest)
        .ancestors()
        .nth(3)
        .expect("workspace root must be 3 levels above crate manifest")
        .to_path_buf()
}

fn write_schema<T: JsonSchema>(root: &Path, spec_dir: &str, name: &str) {
    let schema = schema_for!(T);
    let json = serde_json::to_string_pretty(&schema)
        .unwrap_or_else(|e| panic!("failed to serialise schema for {name}: {e}"));

    let out_path = root.join("specs").join(spec_dir).join("contracts").join(name);
    fs::write(&out_path, format!("{json}\n"))
        .unwrap_or_else(|e| panic!("failed to write {}: {e}", out_path.display()));

    println!("  wrote {}", out_path.display());
}

fn main() {
    let root = project_root();
    println!("generate-contracts — workspace root: {}", root.display());
    println!();

    // ── spec 002 ──────────────────────────────────────────────────────────────
    println!("spec 002 — data lifecycle state model");

    write_schema::<contracts_core::lifecycle::TransitionRequest>(
        &root,
        "002-data-lifecycle-state-model",
        "lifecycle.transition.generated.json",
    );

    write_schema::<contracts_core::provenance::ProvenanceReadRequest>(
        &root,
        "002-data-lifecycle-state-model",
        "provenance.read.generated.json",
    );

    println!();
    println!("done. diff generated files against committed JSON to verify alignment.");
    println!("committed JSON is updated only when drift is intentional.");
}
