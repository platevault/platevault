//! Desktop shell crate boundary.
//!
//! Owns the Tauri 2 runtime, the shared `AppState`, and the typed command
//! surface declared in [`commands::lifecycle`]. Type-safe TypeScript bindings
//! are emitted at test time by `tests/bindings.rs` via tauri-specta.

pub mod commands;

use tauri_specta::{collect_commands, Builder};

use crate::commands::lifecycle::{
    lifecycle_ledger_list, lifecycle_transition_apply, provenance_read,
};

pub const CRATE_NAME: &str = "desktop_shell";

/// Build the tauri-specta [`Builder`] populated with every typed command.
///
/// Reused by the production binary (once it lands) and by `tests/bindings.rs`
/// for TS emission. The binary entry point is intentionally deferred until
/// the desktop icon set and `tauri.conf.json` bundle config land — keeping
/// `cargo build --workspace` green without requiring image assets.
#[must_use]
pub fn specta_builder() -> Builder<tauri::Wry> {
    Builder::<tauri::Wry>::new()
        // Several contract DTOs carry `serde_json::Value` "details" payloads;
        // their `Number` inner type erases width info, so specta would block
        // export by default. Casting BigInts to JS `number` is acceptable for
        // these debug payloads (no numeric precision is required here).
        .dangerously_cast_bigints_to_number()
        // Register `serde_json::Value` as a named (recursive) type so specta
        // emits it once instead of inlining its self-referential shape, which
        // would otherwise fail with "infinitely recursive inline reference".
        .typ::<serde_json::Value>()
        .commands(collect_commands![
            provenance_read,
            lifecycle_transition_apply,
            lifecycle_ledger_list,
        ])
}
