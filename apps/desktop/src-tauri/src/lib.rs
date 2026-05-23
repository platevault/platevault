//! Desktop shell crate boundary.
//!
//! Owns the Tauri 2 runtime, the shared `AppState`, and the typed command
//! surface declared in [`commands::lifecycle`]. Type-safe TypeScript bindings
//! are emitted at test time by `tests/bindings.rs` via tauri-specta.

pub mod commands;

use std::sync::Arc;

use audit::bus::EventBus;
use persistence_db::repositories::lifecycle::SqliteLifecycleRepository;
use sqlx::SqlitePool;
use tauri_specta::{collect_commands, Builder};

use crate::commands::lifecycle::{
    lifecycle_ledger_list, lifecycle_transition_apply, lifecycle_transition_preview,
    provenance_read, AppState,
};

pub const CRATE_NAME: &str = "desktop_shell";

/// Build the tauri-specta [`Builder`] populated with every typed command.
///
/// Reused by `run` (production) and `tests/bindings.rs` (TS emission).
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
            lifecycle_transition_preview,
            lifecycle_ledger_list,
        ])
}

/// Launch the desktop shell.
///
/// Caller is responsible for providing an already-migrated [`SqlitePool`];
/// the persistence layer expects migrations to have run before commands hit
/// the database.
///
/// # Panics
/// Panics if the Tauri runtime fails to launch — there is no recovery path
/// once the GUI process is requested but cannot be started.
pub fn run(pool: SqlitePool) {
    let bus = EventBus::with_pool(pool.clone());
    let repo = Arc::new(SqliteLifecycleRepository::new(pool, bus.clone()));
    let state = AppState::new(repo, bus);

    let builder = specta_builder();

    tauri::Builder::default()
        .invoke_handler(builder.invoke_handler())
        .setup(move |app| {
            builder.mount_events(app);
            Ok(())
        })
        .manage(state)
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
