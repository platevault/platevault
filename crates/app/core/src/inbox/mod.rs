//! Inbox use cases for spec 005 (Inbox Mixed-Folder Split).
//!
//! # Modules
//!
//! - [`signature`] — content signature computation (R-Sig-1).
//! - [`scan`] — recursive folder scan, leaf detection, video lane.
//! - [`classify`] — `inbox.classify` use case: extract IMAGETYP, normalise,
//!   persist evidence, compute classification result.
//! - [`confirm`] — `inbox.confirm` use case: TOCTOU guard, plan creation.
//! - [`reclassify`] — `inbox.reclassify` use case: manual overrides + re-aggregate.

pub mod classify;
pub mod confirm;
pub mod inbox_plan;
pub mod metadata;
pub mod plan_listener;
pub mod reclassify;
pub mod scan;
pub mod signature;
