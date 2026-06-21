//! FR-005 / SC-004 — specta ↔ schemars agreement test (spec 042 CB2 / T116).
//!
//! This is the core deliverable of T116: a single automated check that FAILS
//! when the two generators that project the Rust contract DTOs disagree:
//!
//!   * **schemars** (this crate, `schema_for!`) → the language-neutral
//!     JSON-Schema (draft-2020-12) projection consumed by `ajv` and
//!     `build-schemas.mjs`.
//!   * **tauri-specta** → the live TypeScript surface in
//!     `apps/desktop/src/bindings/index.ts` that the desktop app imports.
//!
//! Both are derived from the *same* Rust types in `contracts_core`. Before this
//! test, nothing guarded that the two projections stayed in agreement: a Rust
//! enum-variant rename would silently diverge the schemars enum from the specta
//! union until a runtime payload failed validation. This test makes that
//! divergence a build failure.
//!
//! Scope: the **envelope** enums that are live on *both* projections —
//! `ErrorSeverity` (carried by every `ContractError` on every fallible
//! command) and `OperationEventType` (carried by every `OperationEvent` over
//! the plan-apply `tauri::ipc::Channel`). These are the cross-cutting enums
//! that flow through the IPC boundary, so agreement here is load-bearing.
//!
//! `OperationStatus` and `ResponseStatus` are intentionally **not** asserted:
//! specta only emits a named TypeScript type for a Rust type that some live
//! `#[tauri::command]` references in its signature, and neither of those two
//! enums currently appears in a command signature (the response envelope is
//! flattened into specta's per-command `typedError<T, E>` result, and
//! `OperationStatus` rides inside `OperationHandle`, which the app reads off
//! the channel rather than via a typed command return). They therefore have no
//! `export type … = …` line to agree against. The schemars side still derives
//! them (the `*.generated.json` snapshot + `contract_schema_parity` cover the
//! JSON-Schema↔Rust direction); only the specta↔schemars cross-check is
//! scoped to the two enums that exist on both sides. See the T116 report.

use std::collections::BTreeSet;
use std::fs;
use std::path::PathBuf;

use schemars::{schema_for, JsonSchema};
use serde_json::Value;

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(std::path::Path::parent)
        .expect("contract test package should live under tests/contract")
        .to_path_buf()
}

/// Extract the `enum` string members of a unit-enum schema produced by
/// `schema_for!`. schemars 1.x renders a serde unit enum as a top-level
/// `{ "type": "string", "enum": [...] }` (or, for renamed variants, as a
/// `oneOf`/`anyOf` of `const` strings). This walks both shapes so the test is
/// robust to schemars' representation choice.
fn schemars_enum_values<T: JsonSchema>() -> BTreeSet<String> {
    let schema = schema_for!(T);
    let value = serde_json::to_value(&schema).expect("schema serialises to JSON");
    let mut out = BTreeSet::new();
    collect_enum_strings(&value, &mut out);
    assert!(
        !out.is_empty(),
        "no enum string members found in schemars schema for {}:\n{}",
        std::any::type_name::<T>(),
        serde_json::to_string_pretty(&value).unwrap_or_default()
    );
    out
}

fn collect_enum_strings(value: &Value, out: &mut BTreeSet<String>) {
    match value {
        Value::Object(map) => {
            if let Some(Value::Array(items)) = map.get("enum") {
                for item in items {
                    if let Some(s) = item.as_str() {
                        out.insert(s.to_owned());
                    }
                }
            }
            if let Some(Value::String(s)) = map.get("const") {
                out.insert(s.clone());
            }
            for (key, child) in map {
                // Recurse only into composition keywords; avoid descending into
                // `properties` of object schemas (not relevant for unit enums).
                if matches!(key.as_str(), "oneOf" | "anyOf" | "allOf" | "$defs") {
                    collect_enum_strings(child, out);
                }
            }
        }
        Value::Array(items) => {
            for item in items {
                collect_enum_strings(item, out);
            }
        }
        _ => {}
    }
}

fn bindings_source() -> String {
    let path = repo_root().join("apps/desktop/src/bindings/index.ts");
    fs::read_to_string(&path).unwrap_or_else(|error| {
        panic!(
            "failed to read specta bindings at {}: {error}; \
             run `cargo run -p desktop_shell --bin generate-bindings` (or the app build) to regenerate",
            path.display()
        )
    })
}

/// Extract the string-literal members of a specta-emitted TS union type, e.g.
/// `export type ErrorSeverity = "info" | "warning" | "blocking" | "fatal";`.
fn specta_union_values(source: &str, type_name: &str) -> BTreeSet<String> {
    let needle = format!("export type {type_name} = ");
    let line = source.lines().find(|l| l.trim_start().starts_with(&needle)).unwrap_or_else(|| {
        panic!("specta bindings do not define a union `export type {type_name} = ...`")
    });

    let rhs = line.split_once('=').map(|(_, r)| r).unwrap_or_default().trim().trim_end_matches(';');

    let values: BTreeSet<String> = rhs
        .split('|')
        .filter_map(|part| {
            let part = part.trim();
            // Keep only quoted string literals; skip references to other types.
            let part = part.strip_prefix('"')?.strip_suffix('"')?;
            Some(part.to_owned())
        })
        .collect();

    assert!(
        !values.is_empty(),
        "no string-literal members parsed from specta union `{type_name}`: {rhs:?}"
    );
    values
}

fn assert_enum_agrees<T: JsonSchema>(type_name: &str, source: &str) {
    let schemars_values = schemars_enum_values::<T>();
    let specta_values = specta_union_values(source, type_name);
    assert_eq!(
        schemars_values, specta_values,
        "AGREEMENT FAILURE ({type_name}): the schemars-derived JSON-Schema enum and the \
         specta-generated TypeScript union disagree.\n\
         schemars (JSON-Schema): {schemars_values:?}\n\
         specta   (TypeScript):  {specta_values:?}\n\
         Both project the same Rust enum in `contracts_core`; a divergence means one \
         generator drifted. Regenerate the specta bindings and rerun.",
    );
}

#[test]
fn error_severity_agrees_between_specta_and_schemars() {
    let source = bindings_source();
    assert_enum_agrees::<contracts_core::ErrorSeverity>("ErrorSeverity", &source);
}

#[test]
fn operation_event_type_agrees_between_specta_and_schemars() {
    let source = bindings_source();
    assert_enum_agrees::<contracts_core::OperationEventType>("OperationEventType", &source);
}

/// Sanity guard for the parser itself: a deliberately wrong type name must
/// fail to resolve, proving the assertion is not vacuously passing.
#[test]
#[should_panic(expected = "do not define a union")]
fn parser_rejects_unknown_union() {
    let source = bindings_source();
    let _ = specta_union_values(&source, "ThisTypeDoesNotExist");
}
