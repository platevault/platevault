//! Bundled-seed loader: populates the local cache at first run.
//!
//! Loads the bundled seed index (≈14k+ popular catalogue objects: NGC/IC, M/C,
//! named, and popular survey objects) into the cache with `source = seed`
//! (spec 035). Seed rows are superseded by `resolved`/`user-override` entries
//! per the source-precedence rules in [`super::cache`].

// TODO(T016): implement bundled-seed load at first run. Skeleton stub for now.
