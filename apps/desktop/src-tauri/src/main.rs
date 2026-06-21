// Hide the Windows console window on release builds; harmless elsewhere.
#![cfg_attr(all(not(debug_assertions), target_os = "windows"), windows_subsystem = "windows")]

use desktop_shell::{build_app, run_app};
use persistence_db::Database;
use tauri::Manager;

#[tokio::main]
async fn main() {
    // Initialise structured logging before anything else so startup `tracing`
    // events (seed load, migrations) and downstream `tracing::error!` audit
    // signals reach stderr. Honours `RUST_LOG`; defaults to `info`.
    // `try_init` is used so a pre-existing subscriber (e.g. in a test harness)
    // does not cause a panic.
    let _ = tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .try_init();

    // Build the Tauri app first so we can access the platform path resolver.
    // The event loop is NOT started yet — that happens in `run_app` after the
    // database is ready.
    let app = build_app();

    // Resolve the SQLite URL.
    //
    // `ALM_DB_URL` lets dev/test runs target an alternate store.  When unset
    // we derive a persistent on-disk path from Tauri's platform data directory
    // so the database survives across launches.
    let db_url = if let Ok(url) = std::env::var("ALM_DB_URL") {
        url
    } else {
        let data_dir =
            app.path().app_data_dir().expect("failed to resolve platform data directory");

        std::fs::create_dir_all(&data_dir).expect("failed to create app data directory");

        let db_path = data_dir.join("alm.db");

        format!("sqlite://{}?mode=rwc", db_path.display())
    };

    let db = Database::connect(&db_url).await.expect("connect SQLite");
    db.migrate().await.expect("run migrations");

    // Spec 035 FIX-1: load the bundled target seed into the resolution cache on
    // first run (after migrations, before the UI starts). First-run-guarded and
    // fast (~487 rows), so a synchronous call here is fine. Seeding failure must
    // NOT block startup — the resolver degrades to online/empty cache.
    match targeting_resolver::seed::load_bundled_on_first_run(db.pool()).await {
        Ok(Some(count)) => tracing::info!("loaded {count} bundled target seed entries"),
        Ok(None) => tracing::debug!("target seed already present; skipping first-run load"),
        Err(e) => tracing::warn!("failed to load bundled target seed: {e}"),
    }

    run_app(app, db.pool().clone());
}
