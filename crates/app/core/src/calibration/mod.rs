//! Calibration matching and equipment use cases.
//!
//! Groups the calibration-domain use-case modules (spec 007 / spec 030). Each
//! sub-module is re-exported from the crate root so existing
//! `app_core::<module>` paths remain stable.

pub mod equipment;
mod matching;

// `app_core::calibration::*` historically resolved to the flat calibration
// use-case module. Flatten its public surface into this group module so those
// paths (e.g. `app_core::calibration::masters_list`) remain stable.
pub use matching::*;
