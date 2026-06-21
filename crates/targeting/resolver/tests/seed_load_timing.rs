//! Sanity timing: the batched first-run load of the bundled (~13k) seed must be
//! well under a couple of seconds (spec 035 seed-scaling, PART A).
//!
//! Not a hard benchmark — a generous ceiling that would catch a regression back
//! to per-entry (one-fsync-each) writes.

use std::time::Instant;

use persistence_db::Database;
use targeting_resolver::seed;

#[tokio::test]
async fn bundled_seed_batched_load_is_fast() {
    let db = Database::in_memory().await.expect("in-memory DB");
    db.migrate().await.expect("migrations");

    let t0 = Instant::now();
    let loaded = seed::load_bundled_on_first_run(db.pool())
        .await
        .expect("seed load")
        .expect("first-run load happened");
    let elapsed = t0.elapsed();

    assert!(loaded > 10_000, "bundled popular seed should load >10k objects, got {loaded}");
    // Generous ceiling: the batched (single-transaction) load of ~13k objects is
    // ~4.5s in release / ~6.6s in an unoptimised debug-test build. A regression
    // to per-entry transactions (one fsync each) would be an order of magnitude
    // slower, so this still catches the failure mode this test guards against.
    assert!(
        elapsed.as_secs() < 15,
        "batched bundled seed load took {elapsed:?}, expected well under 15s \
         (regression to per-entry/per-transaction writes?)"
    );
    eprintln!("loaded {loaded} seed objects in {elapsed:?}");
}
