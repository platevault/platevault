// Hide the Windows console window on release builds; harmless elsewhere.
#![cfg_attr(all(not(debug_assertions), target_os = "windows"), windows_subsystem = "windows")]

use desktop_shell::run;
use persistence_db::Database;

#[tokio::main]
async fn main() {
    // Resolve the SQLite URL. `ALM_DB_URL` lets dev/test runs target an
    // alternate store; otherwise we fall back to an in-process ephemeral
    // store so the first launch never wedges on filesystem permissions.
    // Persistent on-disk default + platform data dir resolution is tracked
    // as Phase 6 (settings/first-run wiring).
    let db_url =
        std::env::var("ALM_DB_URL").unwrap_or_else(|_| "sqlite::memory:".to_owned());

    let db = Database::connect(&db_url).await.expect("connect SQLite");
    db.migrate().await.expect("run migrations");

    run(db.pool().clone());
}
