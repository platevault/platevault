//! Calibration matching and equipment use cases.
//!
//! Extracted from `app_core` (spec 042 / T253 O3b) as the cleanest leaf domain:
//! it has no cross-dependency on any other `app_core` domain group or root
//! module. `app_core` re-exports this crate's items at their original
//! `app_core::calibration::*` and `app_core::equipment` paths so the public
//! surface stays byte-identical for `desktop_shell` and every other consumer.
#![allow(clippy::doc_markdown)] // spec/domain terminology not appropriate for backticks

/// Process-global in-memory cache statics for calibration config + masters
/// snapshots (in-memory caching layer, F0 foundation). See each accessor's
/// doc comment for its owning write-site invalidation calls.
pub mod caches;
pub mod equipment;
mod matching;
mod tolerances;

// `app_core::calibration::*` historically resolved to the flat calibration
// use-case module. Flatten its public surface into this crate root so those
// paths (e.g. `app_core::calibration::masters_list`) remain stable once
// `app_core` re-exports this crate.
pub use matching::*;
pub use tolerances::*;
